// SMS to customers (Admin → মার্কেটিং → কাস্টমারকে SMS). Two ways only (owner, 2026-11-28):
//   ownapp    — the shop's OWN app on the owner's phone (services/smsgw.ts, android-sms/): the SMS goes from that
//               phone's SIM, straight from the shop, no outside company or cloud in between. The main way.
//   bulksmsbd — BulkSMSBD (bulksmsbd.net), kept only as a spare for emergencies.
// Every SMS is written to sms_log (success or the reason), so the owner can see what happened.
import * as db from '../db';
import { safeFetch } from './safefetch';
import * as GW from './smsgw';
import { normalizePhone, validPhone, str, reviewPath } from '../util';
import type { Id, Settings } from '../types';

/** One way the shop can send SMS. */
type Provider = { label: string; site: string; needsKey: boolean };
/** Is SMS ready to go out, and which way (or why not)? */
export type SmsReady = { ok: true; p: string; why?: undefined } | { ok: false; why: string; p?: undefined };
/** What came of one SMS (always written to sms_log): sent or not, the reason, its id (own app). */
export type SmsResult = { ok: boolean; msg: string; id?: string };
/** What kind of SMS it is (for the log and the offer-SMS allowance), and which order / staff member it belongs to. */
export type SmsMeta = { kind?: string; orderId?: Id; staffId?: Id };
/** What an order SMS reads of the order. */
type SmsOrder = { id?: number; code?: string; phone?: string; total?: number | string; customer_name?: string; name?: string; tracking_code?: string | null; points_earned?: number | null };

const PROVIDERS: Record<string, Provider> = {
  ownapp: { label: '📱 নিজের ফোন — সবমিলবে SMS অ্যাপ (ফ্রি, সরাসরি)', site: '', needsKey: false },
  bulksmsbd: { label: 'BulkSMSBD (bulksmsbd.net) — বিপদে বিকল্প', site: 'https://bulksmsbd.net', needsKey: true },
};
/** A saved company that is no longer offered (the old SMS Gate / textbee apps) counts as the shop's own app. */
const provider = (settings: Settings): string => (PROVIDERS[settings.sms_provider as string] ? settings.sms_provider as string : 'ownapp');

function ready(settings: Settings): SmsReady {
  const p = provider(settings);
  if (settings.sms_on !== '1') return { ok: false, why: 'SMS বন্ধ আছে' };
  if (p === 'ownapp') return GW.paired(settings) ? { ok: true, p } : { ok: false, why: 'ফোন যুক্ত করা হয়নি — "📱 সবমিলবে SMS অ্যাপ" অংশে "ফোন যুক্ত করুন" চাপুন' };
  if (!settings.sms_api_key) return { ok: false, why: 'API key দেওয়া নেই' };
  if (!settings.sms_sender_id) return { ok: false, why: 'Sender ID দেওয়া নেই' };
  return { ok: true, p };
}
// 01712345678 → 8801712345678
const intl = (phone: unknown) => '88' + normalizePhone(phone);
// SMS length: Bangla text = 70 characters per SMS part (67 when it is long), English = 160 (153).
function parts(text: unknown): number {
  const t = String(text || '');
  const uni = /[^\x00-\x7F]/.test(t);
  const one = uni ? 70 : 160; const multi = uni ? 67 : 153;
  return t.length <= one ? 1 : Math.ceil(t.length / multi);
}

/** BulkSMSBD's answer → sent or its reason */
type BulkAnswer = { response_code?: string | number; success_message?: string; error_message?: string };
function readBulk(status: number, text: unknown): SmsResult {
  const t = String(text || '').slice(0, 400);
  let j: BulkAnswer | null = null;
  try { j = JSON.parse(t) as BulkAnswer; } catch (_) { /* not JSON */ }
  if (status < 200 || status >= 300) return { ok: false, msg: `HTTP ${status}: ${t.slice(0, 150)}` };
  return j && Number(j.response_code) === 202 ? { ok: true, msg: j.success_message || 'পাঠানো হয়েছে' } : { ok: false, msg: String((j && (j.error_message || j.response_code)) || t.slice(0, 150)) };
}

// Tests only (tests/*.db.test.ts): replace the SMS way with a fake, so a test can read the code that
// "went out" without sending a real SMS. Never set by the shop itself.
type FakeSender = (phone: string, text: string) => Promise<{ ok: boolean; msg: string; id?: string }>;
let fakeSender: FakeSender | null = null;
function setFakeSender(fn: FakeSender | null): void { fakeSender = fn; }

// Send one SMS. Never throws — returns { ok, msg } and writes the log.
async function send(settings: Settings, phone: unknown, text: unknown, { kind = 'manual', orderId = null, staffId = null }: SmsMeta = {}): Promise<SmsResult> {
  const r = ready(settings);
  const ph = normalizePhone(phone);
  const message = str(text, 640);
  let result: SmsResult;
  if (!r.ok) result = { ok: false, msg: r.why };
  else if (!validPhone(ph)) result = { ok: false, msg: 'মোবাইল নম্বর ঠিক নেই' };
  else if (!message) result = { ok: false, msg: 'লেখা খালি' };
  else if (fakeSender) {
    try { result = await fakeSender(ph, message); } catch (e) { result = { ok: false, msg: 'সংযোগ হয়নি: ' + String((e as Error)?.message || e).slice(0, 120) }; }
  } else if (r.p === 'ownapp') {
    try { result = { ok: true, id: await GW.enqueue('+' + intl(ph), message), msg: '📱 ফোনের কাছে দেওয়া হয়েছে' }; } catch (e) { result = { ok: false, msg: 'সেভ হয়নি: ' + String((e as Error)?.message || e).slice(0, 120) }; }
  } else {
    try {
      const url = 'https://bulksmsbd.net/api/smsapi?' + new URLSearchParams({ api_key: settings.sms_api_key || '', type: 'text', number: intl(ph), senderid: settings.sms_sender_id || '', message });
      const res = await safeFetch(url, { maxBytes: 64 * 1024, timeoutMs: 10000, maxRedirects: 2 });
      result = readBulk(res.status, res.body.toString('utf8'));
    } catch (e) {
      result = { ok: false, msg: 'সংযোগ হয়নি: ' + String((e as Error)?.message || e).slice(0, 120) };
    }
  }
  const logged = await db.q<{ id: number }>('INSERT INTO sms_log(phone, body, kind, ok, detail, order_id, staff_id) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id',
    [ph || String(phone || '').slice(0, 20), message, kind, result.ok, str(result.msg, 300), orderId, staffId]).catch(() => []);
  // own app: the phone's later "sent / failed" answer updates this log line (smsgw.report)
  if (r.ok && r.p === 'ownapp' && result.id && logged[0]) await db.q('UPDATE sms_outbox SET log_id=$1 WHERE id=$2', [logged[0].id, result.id]).catch(() => {});
  return result;
}

// 📣 Offer SMS have their own small allowance, so the SIM's SMS pack is never
// used up by offers — checkout codes and order SMS always have room. 0 = no limit (for a paid SMS company).
const MKT_KINDS = ['bulk'];
async function mktLeft(settings: Settings) {
  const perDay = Math.max(0, Number(settings.sms_mkt_day) || 0);
  const perMonth = Math.max(0, Number(settings.sms_mkt_month) || 0);
  const r = await db.one<{ d: number; m: number }>(`SELECT count(*) FILTER (WHERE created_at >= date_trunc('day', now() AT TIME ZONE 'Asia/Dhaka') AT TIME ZONE 'Asia/Dhaka')::int AS d,
      count(*) FILTER (WHERE created_at >= date_trunc('month', now() AT TIME ZONE 'Asia/Dhaka') AT TIME ZONE 'Asia/Dhaka')::int AS m
    FROM sms_log WHERE ok AND kind = ANY($1::text[])`, [MKT_KINDS]).catch(() => ({ d: 0, m: 0 }));
  const day = perDay ? Math.max(0, perDay - r!.d) : Infinity;
  const month = perMonth ? Math.max(0, perMonth - r!.m) : Infinity;
  return { left: Math.min(day, month), day, month, usedDay: r!.d, usedMonth: r!.m, perDay, perMonth };
}

// Order messages: {shop} {code} {total} {name} {tracking} {points} {link} (the order's page — reviews are given there)
const ORDER_EVENTS: Record<string, string> = { placed: 'অর্ডার এলে', confirmed: 'কনফার্ম হলে', shipped: 'কুরিয়ারে দিলে', delivered: 'ডেলিভারি হলে' };
function fill(tpl: unknown, o: SmsOrder, settings: Settings, site = ''): string {
  const track = o.tracking_code ? `ট্র্যাকিং: ${o.tracking_code}` : site ? `ট্র্যাক করুন: ${site.replace(/\/+$/, '')}/order/${o.code}` : '';
  const pts = (o.points_earned || 0) > 0 ? ` আপনি ${o.points_earned} পয়েন্ট পেয়েছেন।` : '';
  return String(tpl || '').replace(/\{(shop|code|total|name|tracking|points|link)\}/g, (_, k: string) => ((<Record<string, string>>{
    shop: settings.store_name || '', code: o.code || '', total: `৳${Math.round(Number(o.total || 0))}`, name: String(o.customer_name || o.name || '').split(' ')[0],
    tracking: track, points: pts, link: site ? `${site.replace(/\/+$/, '')}${reviewPath(String(o.code || ''), settings.session_secret)}` : '',
  })[k])).replace(/\s+/g, ' ').trim();
}
// Called after an order is placed or its status changes. Quietly does nothing when that SMS is switched off.
async function orderEvent(settings: Settings, event: string, order: (SmsOrder & { id: number }) | null | undefined, site = ''): Promise<SmsResult | null> {
  if (!ORDER_EVENTS[event] || settings[`sms_on_${event}`] !== '1' || !ready(settings).ok || !order) return null;
  // the same order never gets the same message twice (e.g. status set to "confirmed" again)
  const dup = await db.one<{ "?column?": number | null }>('SELECT 1 FROM sms_log WHERE order_id=$1 AND kind=$2 AND ok', [order.id, 'order_' + event]).catch(() => null);
  if (dup) return null;
  return send(settings, order.phone, fill(settings[`sms_tpl_${event}`], order, settings, site), { kind: 'order_' + event, orderId: order.id });
}

// 📱 own app: what happened to an SMS the shop handed to the phone? (the checkout's watch asks this)
//   Pending = the phone hasn't taken it (app stopped / no internet), Processed = the phone has it,
//   Sent / Delivered = it left the SIM, Failed = the phone couldn't (the error says why).
async function smsState(settings: Settings, id?: Id): Promise<{ state: string; error: string } | null> {
  if (!id || provider(settings) !== 'ownapp') return null;
  return GW.state(String(id));
}

// 📱 Is the phone that sends the SMS still alive? (owner, 2026-10-17: checkout codes stop the moment the phone
// switches off, loses internet or runs out of battery — the owner must hear about it before customers do.)
//   own app: the phone checks in every few seconds (last seen, battery) — services/smsgw.ts levelFor.
//   any way: the SMS log — several failed codes in a row and none sent means something is wrong.
// Never throws; null fields = not known.
type PhoneStatus = {
  provider: string; on: boolean;
  lastSeen: Date | null; minutesAgo: number | null; battery: number | null; charging: boolean | null; model: string;
  phoneLevel: 'ok' | 'warn' | 'bad' | 'off'; phoneWhy: string;
  failed6h: number; sent6h: number; lastOk: Date | null; sendLevel: 'ok' | 'warn' | 'bad';
};
/** Pure rule: failed vs sent codes in the last 6 hours. */
function sendLevelFor(failed: number, sent: number): 'ok' | 'warn' | 'bad' {
  if (failed >= 3 && sent === 0) return 'bad';
  if (failed >= 2 && failed > sent) return 'warn';
  return 'ok';
}
async function phoneStatus(settings: Settings): Promise<PhoneStatus> {
  const p = provider(settings);
  const out: PhoneStatus = { provider: p, on: settings.sms_on === '1', lastSeen: null, minutesAgo: null, battery: null, charging: null, model: '',
    phoneLevel: 'off', phoneWhy: '', failed6h: 0, sent6h: 0, lastOk: null, sendLevel: 'ok' };
  const log = await db.one<{ f: number; s: number; last_ok: Date | null }>(`SELECT count(*) FILTER (WHERE NOT ok AND created_at > now() - interval '6 hours')::int AS f,
      count(*) FILTER (WHERE ok AND created_at > now() - interval '6 hours')::int AS s, max(created_at) FILTER (WHERE ok) AS last_ok
    FROM sms_log WHERE kind NOT IN ('bulk','test') AND coalesce(detail, '') NOT LIKE 'SMS বন্ধ আছে%' AND coalesce(detail, '') NOT LIKE 'ফোন যুক্ত করা হয়নি%'
      AND coalesce(detail, '') NOT IN ('মোবাইল নম্বর ঠিক নেই', 'লেখা খালি') AND created_at > now() - interval '30 days'`).catch(() => null);
  if (log) { out.failed6h = Number(log.f) || 0; out.sent6h = Number(log.s) || 0; out.lastOk = log.last_ok ? new Date(log.last_ok) : null; }
  out.sendLevel = out.on ? sendLevelFor(out.failed6h, out.sent6h) : 'ok';
  if (!out.on || p !== 'ownapp') return out;
  // several phones (main + backup): the main phone is the one shown; the alarm only rings red when no phone works
  const list = await GW.phones();
  if (!list.length || !GW.paired(settings)) { out.phoneLevel = 'bad'; out.phoneWhy = 'সবমিলবে SMS অ্যাপে কোনো ফোন যুক্ত নেই'; return out; }
  const mainId = Number(settings.smsgw_main || 0);
  const ph = list.find((p) => p.id === mainId) || list[0];
  out.model = ph.model; out.lastSeen = ph.last_seen ? new Date(ph.last_seen) : null;
  out.minutesAgo = GW.minutesAgo(ph.last_seen);
  out.battery = ph.battery; out.charging = ph.charging;
  const lv = GW.levelFor(out.minutesAgo, out.battery, out.charging);
  out.phoneLevel = lv.level; out.phoneWhy = lv.why;
  if (lv.level !== 'ok') {
    const backup = list.find((p) => p.id !== ph.id && GW.levelFor(GW.minutesAgo(p.last_seen), p.battery, p.charging).level === 'ok');
    if (backup) { out.phoneLevel = 'warn'; out.phoneWhy = `মূল ফোন (${ph.model || 'ফোন'}): ${lv.why} — এখন ব্যাকআপ ফোন (${backup.model || 'ফোন'}) থেকে SMS যাচ্ছে`; }
  }
  return out;
}

export type { PhoneStatus };
export { setFakeSender, phoneStatus, sendLevelFor, PROVIDERS, ORDER_EVENTS, ready, send, orderEvent, fill, parts, smsState, mktLeft, provider };
