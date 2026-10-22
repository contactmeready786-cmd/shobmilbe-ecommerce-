// 📥 Admin → মেসেজ → Excel তালিকা (owner, 2026-10-22): bring a list of people from Excel / CSV and message them.
//   • mobile numbers → the customer list, with the list's name as a TAG (new numbers are added, old ones keep everything
//     and only get the tag) → Admin → মেসেজ → SMS → "একটা ট্যাগ" sends to them with the shop's own SMS setup
//     (services/sms.ts — the offer-SMS day/month limits and "no offer SMS" still apply).
//   • e-mail addresses → the e-mail list with source "xl:<name>" → Admin → মেসেজ → ইমেইল → "📥 Excel তালিকা: <name>"
//     (services/mailer.ts — every mail has its unsubscribe link; people who unsubscribed before stay off the list).
// One setup per service: nothing here asks for an SMS / Gmail key.
import crypto from 'node:crypto';
import { Val, attrValue, jsxList } from '../react/html';
import { bn, str, fmtDate, normalizePhone, validPhone } from '../util';
import * as db from '../db';
import * as ui from './ui';
import * as importer from '../services/importer';
import { validEmail } from '../services/notify';
import type { AdminCtx } from '../types';

export const CONTACTS_BASE = '/admin/marketing/contacts';
const MAX_ROWS = 5000;
const FILE_MAX = 3 * 1024 * 1024;

type Contact = { name: string; phone: string; email: string };
type ListInfo = { name: string; phones: number; emails: number; newPhones: number; newEmails: number; at: string };

/** A list name that is safe everywhere it goes (a tag, an e-mail source "xl:<name>"): letters, digits, spaces, - _ */
export function listName(v: unknown): string {
  return String(v ?? '').normalize('NFC').replace(/[^\p{L}\p{N}\p{M} _-]+/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 27);
}

/** Bangladeshi mobile number from a cell — also when Excel dropped the leading 0 (1712345678) or wrote +880 / 880 */
export function phoneOf(cell: unknown): string {
  const raw = String(cell ?? '').trim();
  if (!raw || /@/.test(raw)) return '';
  let d = normalizePhone(raw);
  if (/^1[3-9]\d{8}$/.test(d)) d = '0' + d;
  return validPhone(d) ? d : '';
}

/** The people in a table (first row may be headings): any cell that is a mobile number or an e-mail counts, so the
 * columns can be in any order; a "name / নাম" column (or else the first plain-text cell) is the name. Duplicates once. */
export function readContacts(table: string[][]): { contacts: Contact[]; rows: number } {
  const rows = table.filter((r) => Array.isArray(r) && r.some((c) => String(c ?? '').trim()));
  const head = (rows[0] || []).map((c) => String(c ?? '').trim().toLowerCase());
  const nameCol = head.findIndex((h) => /^(name|full ?name|customer|নাম|কাস্টমার)/i.test(h));
  const seenP = new Set<string>();
  const seenE = new Set<string>();
  const out: Contact[] = [];
  for (const r of rows.slice(0, MAX_ROWS + 1)) {
    const cells = r.map((c) => String(c ?? '').trim());
    const phone = cells.map(phoneOf).find(Boolean) || '';
    const emailCell = cells.find((c) => validEmail(c.toLowerCase()));
    const email = emailCell ? emailCell.toLowerCase() : '';
    if (!phone && !email) continue; // headings, totals, empty lines
    const name = (nameCol >= 0 ? cells[nameCol] : cells.find((c) => c && !phoneOf(c) && !validEmail(c.toLowerCase()) && !/^[\d\s+().-]+$/.test(c))) || '';
    const p = phone && !seenP.has(phone) ? phone : '';
    const e = email && !seenE.has(email) ? email : '';
    if (!p && !e) continue;
    if (p) seenP.add(p);
    if (e) seenE.add(e);
    out.push({ name: name.slice(0, 80), phone: p, email: e });
  }
  return { contacts: out.slice(0, MAX_ROWS), rows: rows.length };
}

function tableOf(buf: Buffer, fileName: string): string[][] {
  if (buf.length > 4 && buf.readUInt32LE(0) === 0x04034b50) return importer.parseXlsx(buf);
  if (/\.xls$/i.test(fileName)) throw new Error('পুরোনো .xls ফাইল পড়া যায় না — Excel-এ খুলে "Save As" → "Excel Workbook (.xlsx)" বা "CSV UTF-8" করে দিন।');
  const text = buf.toString('utf8').replace(/^﻿/, '');
  const first = text.split(/\r?\n/, 1)[0] || '';
  const delim = (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ';' : first.includes('\t') && !first.includes(',') ? '\t' : ',';
  return importer.parseCsv(text, delim);
}

async function save(list: string, contacts: Contact[]): Promise<{ phones: number; newPhones: number; emails: number; newEmails: number }> {
  const P = contacts.filter((c) => c.phone);
  const E = contacts.filter((c) => c.email);
  let newPhones = 0; let newEmails = 0;
  for (let i = 0; i < P.length; i += 1000) {
    const part = P.slice(i, i + 1000);
    const r = await db.q<{ fresh: boolean }>(`INSERT INTO customers(name, phone, email, tags, note)
        SELECT u.name, u.phone, u.email, $4, 'Excel তালিকা থেকে' FROM unnest($1::text[], $2::text[], $3::text[]) AS u(name, phone, email)
      ON CONFLICT (phone) DO UPDATE SET
        tags = CASE WHEN (', ' || customers.tags || ',') ILIKE ('%, ' || $4 || ',%') THEN customers.tags
                    WHEN customers.tags = '' THEN $4 ELSE customers.tags || ', ' || $4 END,
        name = CASE WHEN customers.name = '' THEN EXCLUDED.name ELSE customers.name END,
        email = CASE WHEN coalesce(customers.email, '') = '' THEN EXCLUDED.email ELSE customers.email END,
        updated_at = now()
      RETURNING (xmax = 0) AS fresh`, [part.map((c) => c.name), part.map((c) => c.phone), part.map((c) => c.email), list]);
    newPhones += r.filter((x) => x.fresh).length;
  }
  for (let i = 0; i < E.length; i += 1000) {
    const part = E.slice(i, i + 1000);
    // unsubscribed people stay unsubscribed; someone already on the list moves to this list only if they came from Excel
    const r = await db.q<{ fresh: boolean }>(`INSERT INTO email_subs(email, name, phone, source, token)
        SELECT u.email, u.name, u.phone, $4, u.token FROM unnest($1::text[], $2::text[], $3::text[], $5::text[]) AS u(email, name, phone, token)
      ON CONFLICT (lower(email)) DO UPDATE SET
        source = CASE WHEN email_subs.source = '' OR email_subs.source LIKE 'xl:%' THEN EXCLUDED.source ELSE email_subs.source END,
        name = CASE WHEN email_subs.name = '' THEN EXCLUDED.name ELSE email_subs.name END
      RETURNING (xmax = 0) AS fresh`, [part.map((c) => c.email), part.map((c) => c.name), part.map((c) => c.phone), `xl:${list}`,
      part.map(() => crypto.randomBytes(18).toString('base64url'))]);
    newEmails += r.filter((x) => x.fresh).length;
  }
  return { phones: P.length, newPhones, emails: E.length, newEmails };
}

async function page(ctx: AdminCtx) {
  const lists = db.jsonSetting<ListInfo[]>(ctx.settings, 'contact_lists', []);
  const body = <><h1>📥 Excel তালিকা থেকে SMS ও ইমেইল</h1>{ui.flash(ctx.flash)}
    <section className="panel"><h2>১. তালিকা তুলুন</h2>
      <p className="small muted">Excel (.xlsx) বা CSV ফাইল — যেকোনো কলামে <b>মোবাইল নম্বর</b> আর/অথবা <b>ইমেইল</b> থাকলেই হবে, "নাম" কলাম থাকলে নামও নেওয়া হবে। একবারে সর্বোচ্চ {bn(MAX_ROWS)} জন।</p>
      {(ctx.readOnly ? <p className="muted">আপনার শুধু দেখার অনুমতি আছে।</p> : <form method="post" action={CONTACTS_BASE} className="form">
        {ui.field('ফাইল', <input type="file" accept=".xlsx,.csv,.txt" data-file-into="file64" required />)}
        {ui.field('তালিকার নাম', ui.input('list', '', { maxlength: 27, required: true, placeholder: 'যেমন: ফেসবুক লিড অক্টোবর' }), 'পরে SMS / ইমেইল পাঠানোর সময় এই নাম দিয়ে তালিকাটা বাছবেন।')}
        <label className="check"><input type="checkbox" name="consent" defaultValue="1" required />{' '}<span>এই তালিকার মানুষেরা আমার দোকান থেকে অফার মেসেজ পেতে রাজি আছেন (যেমন আগে কিনেছেন বা নম্বর/ইমেইল নিজে দিয়েছেন)।</span></label>
        <p><button className="btn">📥 তালিকা তুলুন</button></p>
      </form>)}
      <ul className="small muted"><li>নম্বর আগে থেকে কাস্টমার তালিকায় থাকলে তার সব তথ্য যেমন আছে থাকবে — শুধু এই তালিকার নাম ট্যাগ হিসেবে যোগ হবে।</li><li>যারা আগে "অফার SMS চাই না" বলেছেন বা ইমেইলে আনসাবস্ক্রাইব করেছেন, তারা তালিকায় থাকলেও মেসেজ পাবেন না।</li><li>যাদের অনুমতি নেই তাদের অফার পাঠালে নম্বর/ইমেইল ব্লক বা স্প্যাম হতে পারে — শুধু রাজি মানুষদের তালিকা দিন।</li></ul>
    </section>
    <section className="panel"><h2>২. মেসেজ পাঠান</h2>
      <ol className="steps">
        <li><b>SMS:</b> <a href="/admin/marketing/sms">মেসেজ → SMS</a> → "পাঠাবেন কাকে" থেকে <b>একটা ট্যাগ</b> বাছুন → ট্যাগের ঘরে তালিকার নাম লিখুন → লেখা দিয়ে আগে "কতজন" দেখে তারপর পাঠান। আপনার সেট করা SMS কোম্পানি দিয়েই যাবে, দিনে/মাসে অফার SMS-এর সীমা মেনে।</li>
        <li><b>ইমেইল:</b> <a href="/admin/marketing/email">মেসেজ → ইমেইল</a> → নতুন ক্যাম্পেইনে "কাদের পাঠাবেন" থেকে <b>📥 Excel তালিকা: (নাম)</b> বাছুন। আপনার Gmail / Brevo দিয়েই যাবে, প্রতিটা মেইলে আনসাবস্ক্রাইব লিংক থাকবে।</li>
      </ol>
    </section>
    {(lists.length ? <section className="panel table-wrap"><h2>তোলা তালিকাগুলো</h2><table className="table compact"><thead><tr><th>তালিকা</th><th className="num">মোবাইল</th><th className="num">ইমেইল</th><th>কবে</th></tr></thead><tbody>{jsxList(lists.map((l) => <tr><td><b><Val v={l.name} /></b></td><td className="num">{bn(l.phones)}{' '}<span className="small muted">(নতুন {bn(l.newPhones)})</span></td><td className="num">{bn(l.emails)}{' '}<span className="small muted">(নতুন {bn(l.newEmails)})</span></td><td className="small"><Val v={fmtDate(l.at)} /></td></tr>))}</tbody></table></section> : null)}
  </>;
  return ctx.page('Excel তালিকা', body, 'contacts');
}

async function post(ctx: AdminCtx) {
  if (ctx.readOnly) return ctx.back(CONTACTS_BASE, 'noperm');
  const b = await ctx.body();
  const list = listName(b.list);
  if (!list) return ctx.fail(CONTACTS_BASE, 'তালিকার একটা নাম দিন (যেমন: ফেসবুক লিড অক্টোবর)।');
  if (b.consent !== '1') return ctx.fail(CONTACTS_BASE, 'তালিকার মানুষেরা মেসেজ পেতে রাজি — এই ঘরে টিক দিন।');
  const b64 = String(b.file64 || '');
  if (!b64) return ctx.fail(CONTACTS_BASE, 'একটা Excel (.xlsx) বা CSV ফাইল বাছুন।');
  const buf = Buffer.from(b64, 'base64');
  if (!buf.length) return ctx.fail(CONTACTS_BASE, 'ফাইলটি খালি।');
  if (buf.length > FILE_MAX) return ctx.fail(CONTACTS_BASE, 'ফাইলটি ৩ MB-এর বেশি বড় — দুই ভাগ করে তুলুন।');
  let table: string[][];
  try { table = tableOf(buf, str(b.file64_name, 200)); } catch (e) {
    return ctx.fail(CONTACTS_BASE, e instanceof Error && /xls/.test(e.message) ? e.message : 'ফাইলটি পড়া যায়নি — Excel-এ খুলে "CSV UTF-8" হিসেবে সেভ করে আবার দিন।');
  }
  const { contacts, rows } = readContacts(table);
  if (!contacts.length) return ctx.fail(CONTACTS_BASE, `${bn(rows)}টি সারির কোথাও সঠিক মোবাইল নম্বর (01XXXXXXXXX) বা ইমেইল পাওয়া যায়নি।`);
  const r = await save(list, contacts);
  const lists = db.jsonSetting<ListInfo[]>(ctx.settings, 'contact_lists', []).filter((l) => l.name !== list);
  await db.setSetting('contact_lists', JSON.stringify([{ name: list, ...r, at: new Date().toISOString() }, ...lists].slice(0, 30)));
  await ctx.log('settings', 'marketing', null, `Excel তালিকা "${list}": ${r.phones}টি মোবাইল (নতুন ${r.newPhones}), ${r.emails}টি ইমেইল (নতুন ${r.newEmails})`);
  return ctx.back(`${CONTACTS_BASE}?info=${encodeURIComponent(`✅ "${list}" তোলা হয়েছে: ${bn(r.phones)}টি মোবাইল নম্বর (নতুন ${bn(r.newPhones)}), ${bn(r.emails)}টি ইমেইল (নতুন ${bn(r.newEmails)})। এখন নিচের ধাপ ২ দেখে পাঠান।`)}`);
}

export const contactRoutes = [
  { method: 'GET', path: CONTACTS_BASE, perm: 'marketing', handler: (ctx: AdminCtx) => page(ctx) },
  { method: 'POST', path: CONTACTS_BASE, perm: 'marketing', handler: post },
];
