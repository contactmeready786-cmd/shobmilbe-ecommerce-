// 📧 ইমেইল মার্কেটিং (owner, 2026-10-16): offer / news e-mails to people who asked for them.
//  - Who gets them: email_subs — the footer box, the checkout tick, or added by the owner. Everyone can leave with one click
//    (link in every mail + the "List-Unsubscribe" header Gmail shows at the top).
//  - Sent by Brevo (free: ~300 a day, made for bulk mail) — set ONCE in Admin → মার্কেটিং → ইমেইল. The shop's own Gmail can be
//    used instead for a small list, but only up to a small daily number, so Google never locks the Gmail that carries the
//    order mails and codes.
//  - Every mail is written to email_log (opened / clicked are noted through a tiny picture and the shop's own links).
//  - Automatic mails (tick, every hour): welcome, the weekly "new products", a review request after delivery, "we miss you".
import * as crypto from 'node:crypto';
import * as db from '../db';
import { safeFetch } from './safefetch';
import * as notify from './notify';
import { str, money, bn } from '../util';
import * as $autopost from './autopost';
import * as $security from '../security';
import type { Body, Id, Loose, Settings } from '../types';

const MAX_GMAIL_DAY = 80;
const KINDS = { campaign: 'ক্যাম্পেইন', weekly: 'সাপ্তাহিক নতুন পণ্য', welcome: 'স্বাগতম', review: 'রিভিউ চাওয়া', winback: 'আবার আসুন', test: 'পরীক্ষা' };
const AUDIENCES: Record<string, Loose> = { all: 'সবাই (লিস্টের সবাই)', buyers: 'যারা কিনেছেন', nonbuyers: 'যারা এখনো কেনেননি' };

const esc = (v?: Loose) => notify.escapeHtml(v);
const cleanEmail = (e?: Loose) => String(e || '').trim().toLowerCase().slice(0, 120);
function siteBase(settings: Settings) { return String(settings.site_url || 'https://shobmilbe.com').replace(/\/+$/, ''); }
function secret(settings: Settings) { return String(settings.session_secret || 'shobmilbe-mail'); }
function mac(settings: Settings, value?: Loose) { return crypto.createHmac('sha256', secret(settings)).update('mail:' + value).digest('base64url').slice(0, 16); }
function macOk(settings: Settings, value?: Loose, given?: Loose) {
  const a = Buffer.from(mac(settings, value)); const b = Buffer.from(String(given || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ---------------------------------------------------------------- set-up
function cfg(settings: Settings) {
  const provider = settings.email_mkt_provider === 'gmail' ? 'gmail' : 'brevo';
  const asked = Math.max(1, Number(settings.email_mkt_day) || 280);
  const perDay = provider === 'gmail' ? Math.min(asked, MAX_GMAIL_DAY) : asked;
  const from = notify.validEmail(settings.email_mkt_from) ? String(settings.email_mkt_from).trim() : notify.emailConfig(settings).user;
  const fromName = str(settings.email_mkt_from_name, 60) || settings.store_name || 'সবমিলবে';
  let why = '';
  if (provider === 'brevo' && !String(settings.brevo_api_key || '').trim()) why = 'Brevo-র API Key দেওয়া নেই';
  else if (provider === 'gmail' && !notify.emailConfig(settings).ready) why = 'দোকানের Gmail সেটআপ নেই (সেটিংস → আমার নোটিফিকেশন)';
  return { on: settings.email_mkt_on === '1', provider, perDay, from, fromName, ready: !why, why };
}
async function sentToday() {
  const r = await db.one(`SELECT count(*)::int AS n FROM email_log WHERE ok AND kind<>'test'
    AND created_at >= date_trunc('day', now() AT TIME ZONE 'Asia/Dhaka') AT TIME ZONE 'Asia/Dhaka'`).catch(() => ({ n: 0 }));
  return r!.n;
}
async function leftToday(settings: Settings) { return Math.max(0, cfg(settings).perDay - (await sentToday())); }

// ---------------------------------------------------------------- the list
// Add (or bring back) someone who asked for the mails. `explicit` = they ticked / typed it just now, so an
// earlier "unsubscribe" is undone; otherwise (e.g. imported by the owner) someone who left stays out.
async function addSub(email?: Loose, { name = '', phone = '', source = '', explicit = true }: Body = {}) {
  const em = cleanEmail(email);
  if (!notify.validEmail(em)) return null;
  const token = crypto.randomBytes(18).toString('base64url');
  const row = await db.one(`INSERT INTO email_subs(email, name, phone, source, token) VALUES($1,$2,$3,$4,$5)
    ON CONFLICT (lower(email)) DO UPDATE SET
      name = CASE WHEN email_subs.name='' THEN EXCLUDED.name ELSE email_subs.name END,
      phone = CASE WHEN email_subs.phone='' THEN EXCLUDED.phone ELSE email_subs.phone END,
      on_list = CASE WHEN $6 THEN true ELSE email_subs.on_list END,
      unsub_at = CASE WHEN $6 THEN NULL ELSE email_subs.unsub_at END,
      fails = CASE WHEN $6 THEN 0 ELSE email_subs.fails END
    RETURNING *, (xmax = 0) AS fresh`, [em, str(name, 80), str(phone, 20), str(source, 30), token, !!explicit]);
  return row;
}
async function unsubscribe(token?: Loose) {
  const t = String(token || '').slice(0, 60);
  if (!/^[A-Za-z0-9_-]{20,40}$/.test(t)) return null;
  return db.one('UPDATE email_subs SET on_list=false, unsub_at=coalesce(unsub_at, now()) WHERE token=$1 RETURNING email', [t]);
}
async function bySubToken(token?: Loose) {
  const t = String(token || '').slice(0, 60);
  if (!/^[A-Za-z0-9_-]{20,40}$/.test(t)) return null;
  return db.one('SELECT * FROM email_subs WHERE token=$1', [t]);
}

// ---------------------------------------------------------------- the mail itself
async function productCards(settings: Settings, ids?: Loose, utm?: Loose) {
  const list = (ids || []).map(Number).filter((n?: Loose) => Number.isInteger(n) && n > 0).slice(0, 12);
  if (!list.length) return [];
  const rows = await db.q(`SELECT p.id, p.name, p.slug, p.price, p.old_price, p.stock, p.image_id, m.ik_url
    FROM products p LEFT JOIN media m ON m.id=p.image_id WHERE p.id = ANY($1::int[]) AND p.active`, [list]);
  const byId = new Map(rows.map((r) => [r.id, r]));
  return list.map((id?: Loose) => byId.get(id)).filter(Boolean).map((p?: Loose) => ({
    ...p,
    img: p.ik_url ? `${p.ik_url}${p.ik_url.includes('?') ? '&' : '?'}tr=f-jpg,w-400,h-400,c-at_max` : p.image_id ? `${siteBase(settings)}/media/${p.image_id}/t` : '',
    path: `/p/${encodeURIComponent(p.slug)}?${utm}`,
  }));
}
// Plain text the owner typed → safe paragraphs (a blank line = new paragraph). {name} = the reader's first name.
function paragraphs(text?: Loose, name?: Loose) {
  return String(text || '').replace(/\{name\}/g, name || 'প্রিয় গ্রাহক').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)
    .map((p) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.7;color:#24324a">${esc(p).replace(/\n/g, '<br>')}</p>`).join('');
}
function textVersion(text?: Loose, name?: Loose, products?: Loose, site?: Loose) {
  const lines = [String(text || '').replace(/\{name\}/g, name || 'প্রিয় গ্রাহক')];
  for (const p of products) lines.push(`• ${p.name} — ${money(p.price)}: ${site}${p.path}`);
  return lines.join('\n\n');
}
// Links in the mail go through /e/c/… (counts the click), then to the shop's own page. Only the shop's own paths are allowed.
function trackLink(settings: Settings, logId?: Id, path?: Loose) {
  const p = String(path || '/').startsWith('/') && !String(path).startsWith('//') ? String(path) : '/';
  return `${siteBase(settings)}/e/c/${logId}/${mac(settings, `${logId}:${p}`)}?u=${encodeURIComponent(p)}`;
}
function layout(settings: Settings, { logId, sub, heading, intro, products, button, utm }: Body) {
  const site = siteBase(settings);
  const name = String(sub.name || '').split(/\s+/)[0];
  const link = (path?: Loose) => (logId ? trackLink(settings, logId, path) : site + path);
  const cards = products.map((p?: Loose) => `<td width="50%" valign="top" style="padding:6px">
      <a href="${esc(link(p.path))}" style="text-decoration:none;color:#14213d;display:block;border:1px solid #e3e8f0;border-radius:12px;overflow:hidden;background:#fff">
        ${p.img ? `<img src="${esc(p.img)}" width="260" alt="${esc(p.name)}" style="display:block;width:100%;height:auto;max-height:200px;object-fit:contain;background:#f6f8fb">` : ''}
        <div style="padding:10px 12px 12px"><div style="font-size:14px;line-height:1.4;height:40px;overflow:hidden">${esc(p.name)}</div>
        <div style="margin-top:6px;font-size:16px;font-weight:bold;color:#0866D6">${esc(money(p.price))}${p.old_price > p.price ? ` <span style="font-size:12px;color:#8a94a6;text-decoration:line-through;font-weight:normal">${esc(money(p.old_price))}</span>` : ''}</div></div>
      </a></td>`);
  const rows: Loose[] = [];
  for (let i = 0; i < cards.length; i += 2) rows.push(`<tr>${cards[i]}${cards[i + 1] || '<td width="50%"></td>'}</tr>`);
  const btn = button && button.text ? `<p style="text-align:center;margin:22px 0 6px"><a href="${esc(link(button.path || '/'))}" style="display:inline-block;background:#f59e0b;color:#14213d;font-weight:bold;text-decoration:none;padding:13px 30px;border-radius:10px;font-size:16px">${esc(button.text)}</a></p>` : '';
  const unsub = `${site}/unsubscribe?t=${encodeURIComponent(sub.token)}`;
  const pixel = logId ? `<img src="${site}/e/o/${logId}/${mac(settings, String(logId))}.gif" width="1" height="1" alt="" style="display:block;border:0;width:1px;height:1px">` : '';
  const contact = [settings.phone || settings.whatsapp, settings.address].filter(Boolean).map(esc).join(' · ');
  return `<!doctype html><html lang="bn"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(heading)}</title></head>
<body style="margin:0;padding:0;background:#eef2f7;font-family:'Hind Siliguri','Noto Sans Bengali',Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef2f7"><tr><td align="center" style="padding:20px 10px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:580px;background:#ffffff;border-radius:16px;overflow:hidden">
<tr><td style="background:#0866D6;padding:18px 22px"><a href="${esc(link('/?' + utm))}" style="color:#fff;text-decoration:none;font-size:22px;font-weight:bold">🛍️ ${esc(settings.store_name || 'সবমিলবে')}</a></td></tr>
<tr><td style="padding:24px 22px 8px">
<h1 style="margin:0 0 14px;font-size:21px;line-height:1.4;color:#14213d">${esc(heading)}</h1>
${paragraphs(intro, name)}
</td></tr>
${rows.length ? `<tr><td style="padding:0 16px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows.join('')}</table></td></tr>` : ''}
<tr><td style="padding:4px 22px 22px">${btn}
<p style="margin:16px 0 0;font-size:13px;color:#5b6475;text-align:center">🚚 সারা বাংলাদেশে হোম ডেলিভারি · ✅ ক্যাশ অন ডেলিভারি</p></td></tr>
<tr><td style="background:#f6f8fb;padding:16px 22px;font-size:12px;line-height:1.6;color:#8a94a6;text-align:center">
${contact ? `${contact}<br>` : ''}আপনি ${esc(settings.store_name || 'সবমিলবে')}-এর অফার ও নতুন পণ্যের খবর পেতে চেয়েছিলেন বলে এই ইমেইল পাচ্ছেন।<br>
<a href="${esc(unsub)}" style="color:#5b6475">আর ইমেইল চাই না (আনসাবস্ক্রাইব)</a>
</td></tr></table>${pixel}
</td></tr></table></body></html>`;
}

// Send one mail to one subscriber. Never throws — returns { ok, msg } and writes email_log.
async function sendOne(settings: Settings, sub: Loose, { kind, subject, heading, intro, productIds = [], button = null, campaignId = null, orderId = null }: Body) {
  const c = cfg(settings);
  const log = await db.one('INSERT INTO email_log(sub_id, email, kind, campaign_id, order_id) VALUES($1,$2,$3,$4,$5) RETURNING id',
    [sub.id || null, sub.email, kind, campaignId, orderId]);
  const utm = `utm_source=email&utm_medium=email&utm_campaign=${encodeURIComponent(kind + (campaignId ? '-' + campaignId : ''))}`;
  let result;
  try {
    if (!c.ready) throw new Error(c.why);
    const products = await productCards(settings, productIds, utm);
    const htmlBody = layout(settings, { logId: log!.id, sub, heading: heading || subject, intro, products, button, utm });
    const text = textVersion(intro, String(sub.name || '').split(/\s+/)[0], products, siteBase(settings))
      + `\n\nআর ইমেইল না চাইলে: ${siteBase(settings)}/unsubscribe?t=${sub.token}`;
    const unsub = `${siteBase(settings)}/unsubscribe?t=${encodeURIComponent(sub.token)}`;
    const headers = { 'List-Unsubscribe': `<${unsub}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' };
    if (c.provider === 'gmail') {
      await notify.sendVia(settings, { to: sub.email, subject: str(subject, 150), text, htmlBody, headers });
      result = { ok: true, msg: 'Gmail দিয়ে পাঠানো হয়েছে' };
    } else {
      const res = await safeFetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST', maxBytes: 64 * 1024, timeoutMs: 12000, maxRedirects: 0,
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'api-key': String(settings.brevo_api_key || '').trim() },
        body: JSON.stringify({ sender: { name: c.fromName, email: c.from }, to: [{ email: sub.email, ...(sub.name ? { name: str(sub.name, 60) } : {}) }],
          subject: str(subject, 150), htmlContent: htmlBody, textContent: text, headers, tags: [kind] }),
      });
      const t = res.body.toString('utf8').slice(0, 400);
      let j = null;
      try { j = JSON.parse(t); } catch (_) { /* not JSON */ }
      if (res.status === 401) throw new Error('Brevo-র API Key মিলছে না — Brevo → SMTP & API → API Keys থেকে নতুন Key দিন');
      if (res.status < 200 || res.status >= 300) throw new Error(`Brevo: ${(j && (j.message || j.code)) || 'HTTP ' + res.status}`);
      result = { ok: true, msg: 'Brevo দিয়ে পাঠানো হয়েছে' };
    }
  } catch (e: Loose) {
    result = { ok: false, msg: String(e.message || e).slice(0, 250) };
  }
  await db.q('UPDATE email_log SET ok=$1, detail=$2 WHERE id=$3', [result.ok, result.msg, log!.id]).catch(() => {});
  // an address that keeps failing (wrong / closed mailbox) is taken off the list after 3 tries, so it doesn't hurt the shop's name
  if (sub.id && !/Key|সেটআপ|Brevo: (Unauthorized|permission|sender)/i.test(result.msg)) {
    await db.q(`UPDATE email_subs SET fails = CASE WHEN $1 THEN 0 ELSE fails+1 END,
      on_list = CASE WHEN NOT $1 AND fails+1 >= 3 THEN false ELSE on_list END WHERE id=$2`, [result.ok, sub.id]).catch(() => {});
  }
  return result;
}

// ---------------------------------------------------------------- campaigns
function audienceSql(aud?: Loose) {
  const bought = `(EXISTS (SELECT 1 FROM orders o WHERE o.status='delivered' AND (lower(o.email)=lower(s.email) OR (s.phone<>'' AND o.phone=s.phone)))
    OR EXISTS (SELECT 1 FROM orders o JOIN customers c ON c.id=o.account_id WHERE o.status='delivered' AND lower(c.email)=lower(s.email)))`;
  if (aud === 'buyers') return bought;
  if (aud === 'nonbuyers') return `NOT ${bought}`;
  return 'true';
}
async function audienceCount(aud?: Loose) {
  return (await db.one(`SELECT count(*)::int AS n FROM email_subs s WHERE s.on_list AND ${audienceSql(aud)}`))!.n;
}
async function createCampaign(settings: Settings, { subject, intro, productIds = [], buttonText = '', buttonPath = '', audience = 'all', kind = 'manual', staffId = null }: Body) {
  const total = await audienceCount(audience);
  return db.one(`INSERT INTO email_campaigns(subject, intro, product_ids, button_text, button_url, audience, kind, total, staff_id)
    VALUES($1,$2,$3::int[],$4,$5,$6,$7,$8,$9) RETURNING *`,
  [str(subject, 150), str(intro, 4000), productIds.slice(0, 12), str(buttonText, 40), safePath(buttonPath), AUDIENCES[audience] ? audience : 'all', kind, total, staffId]);
}
// "/offers" or "https://shobmilbe.com/offers" → "/offers"; anything outside the shop → "/"
function safePath(v?: Loose, settings: Settings = {} as Settings) {
  let s = String(v || '').trim();
  if (!s) return '/';
  const site = siteBase(settings);
  for (const host of [site, 'https://shobmilbe.com', 'https://www.shobmilbe.com']) if (s.toLowerCase().startsWith(host)) s = s.slice(host.length) || '/';
  return s.startsWith('/') && !s.startsWith('//') ? s.slice(0, 300) : '/';
}
// Send the next part of every campaign that is still going, within today's allowance. Returns how many went.
async function runCampaigns(settings: Settings, budget?: Loose) {
  let done = 0;
  const camps = await db.q("SELECT * FROM email_campaigns WHERE status='sending' ORDER BY id LIMIT 5");
  for (const camp of camps) {
    if (done >= budget) break;
    // the automatic weekly mail waits for anyone who got a mail in the last 20 hours (e.g. the welcome) — they get it tomorrow
    const rest = camp.kind === 'weekly' ? "AND NOT EXISTS (SELECT 1 FROM email_log r WHERE r.sub_id=s.id AND r.ok AND r.kind<>'test' AND r.created_at > now() - interval '20 hours')" : '';
    const subs = await db.q(`SELECT s.* FROM email_subs s WHERE s.on_list AND ${audienceSql(camp.audience)} ${rest}
      AND NOT EXISTS (SELECT 1 FROM email_log l WHERE l.campaign_id=$1 AND l.sub_id=s.id) ORDER BY s.id LIMIT $2`, [camp.id, budget - done]);
    if (!subs.length) {
      // a weekly mail still waiting for someone (20-hour rule) stays open; it closes after 3 days in any case
      const waiting = camp.kind === 'weekly' && camp.created_at > new Date(Date.now() - 3 * 86400e3)
        && await db.one(`SELECT 1 AS x FROM email_subs s WHERE s.on_list AND NOT EXISTS (SELECT 1 FROM email_log l WHERE l.campaign_id=$1 AND l.sub_id=s.id) LIMIT 1`, [camp.id]);
      if (!waiting) await db.q("UPDATE email_campaigns SET status='done', finished_at=now(), updated_at=now() WHERE id=$1", [camp.id]);
      continue;
    }
    let ok = 0; let bad = 0;
    for (let i = 0; i < subs.length; i += 4) {
      const res = await Promise.all(subs.slice(i, i + 4).map((s) => sendOne(settings, s, { kind: camp.kind === 'weekly' ? 'weekly' : 'campaign', subject: camp.subject,
        intro: camp.intro, productIds: camp.product_ids, button: camp.button_text ? { text: camp.button_text, path: camp.button_url } : null, campaignId: camp.id })));
      res.forEach((r) => (r.ok ? ok++ : bad++));
      if (bad >= 8 && ok === 0) break; // the service refuses everything (key / sender problem) — stop, the owner sees why
    }
    done += ok + bad;
    await db.q('UPDATE email_campaigns SET sent=sent+$1, failed=failed+$2, updated_at=now() WHERE id=$3', [ok, bad, camp.id]);
    if (bad && !ok) break;
  }
  return done;
}

// ---------------------------------------------------------------- automatic mails
const ELIGIBLE = 'p.active AND p.parent_id IS NULL AND p.stock > 0 AND p.price > 0 AND p.image_id IS NOT NULL';
function dhakaNow() { return $autopost.dhakaNow(); }

async function welcome(settings: Settings, budget?: Loose) {
  if (settings.email_auto_welcome === '0' || budget <= 0) return 0;
  const subs = await db.q(`SELECT s.* FROM email_subs s WHERE s.on_list AND s.created_at > now() - interval '7 days'
    AND NOT EXISTS (SELECT 1 FROM email_log l WHERE l.sub_id=s.id AND l.kind='welcome') ORDER BY s.id LIMIT $1`, [Math.min(budget, 40)]);
  if (!subs.length) return 0;
  const picks = await db.q(`SELECT p.id FROM products p WHERE ${ELIGIBLE} ORDER BY coalesce(p.featured,false) DESC, coalesce(p.sold_count,0) DESC, p.id DESC LIMIT 4`);
  const shop = settings.store_name || 'সবমিলবে';
  const intro = str(settings.email_welcome_text, 2000) || `{name}, ${shop}-এ আপনাকে স্বাগতম! 🎉\n\nএখন থেকে নতুন পণ্য, দাম কমা আর বিশেষ অফারের খবর সবার আগে আপনার ইমেইলে পাবেন। নিচে আমাদের জনপ্রিয় কিছু পণ্য দেওয়া হলো।`;
  let n = 0;
  for (const s of subs) {
    await sendOne(settings, s, { kind: 'welcome', subject: `${shop}-এ স্বাগতম 🎉`, heading: 'স্বাগতম!', intro, productIds: picks.map((p) => p.id), button: { text: 'কেনাকাটা শুরু করুন', path: '/' } });
    n++;
  }
  return n;
}

async function review(settings: Settings, budget?: Loose) {
  if (settings.email_auto_review === '0' || budget <= 0) return 0;
  // delivered 2–10 days ago, the buyer's e-mail is on the list, not asked before
  const rows = await db.q(`SELECT o.id, o.code, o.customer_name, s.id AS sub_id, s.email, s.name, s.token,
      (SELECT array_agg(i.product_id) FROM order_items i WHERE i.order_id=o.id AND i.product_id IS NOT NULL) AS pids
    FROM orders o
    LEFT JOIN customers c ON c.id=o.account_id
    JOIN email_subs s ON s.on_list AND (lower(s.email)=lower(nullif(o.email,'')) OR lower(s.email)=lower(nullif(c.email,'')))
    WHERE o.status='delivered' AND o.delivered_at BETWEEN now() - interval '10 days' AND now() - interval '2 days'
      AND NOT EXISTS (SELECT 1 FROM email_log l WHERE l.order_id=o.id AND l.kind='review')
    ORDER BY o.delivered_at LIMIT $1`, [Math.min(budget, 30)]);
  let n = 0;
  for (const r of rows) {
    const sub = { id: r.sub_id, email: r.email, name: r.name || r.customer_name, token: r.token };
    await sendOne(settings, sub, { kind: 'review', orderId: r.id, subject: `${r.code} অর্ডারের পণ্য কেমন লাগল?`, heading: 'পণ্য কেমন লাগল? ⭐',
      intro: '{name}, আশা করি আপনার অর্ডারের পণ্য ভালোভাবে হাতে পেয়েছেন।\n\nএক মিনিট সময় নিয়ে একটা রিভিউ দিলে অন্য ক্রেতারা উপকৃত হবেন, আর আমরাও আরও ভালো করতে পারব। কোনো সমস্যা হলে সরাসরি জানাবেন।',
      productIds: (r.pids || []).slice(0, 4), button: { text: '⭐ রিভিউ দিন', path: `/order/${encodeURIComponent(r.code)}` } });
    n++;
  }
  return n;
}

async function winback(settings: Settings, budget?: Loose) {
  if (settings.email_auto_winback === '0' || budget <= 0) return 0;
  const days = Math.max(20, Math.min(365, Number(settings.email_winback_days) || 60));
  const subs = await db.q(`SELECT s.* FROM email_subs s WHERE s.on_list
      AND (SELECT max(o.created_at) FROM orders o WHERE o.status='delivered' AND (lower(o.email)=lower(s.email) OR (s.phone<>'' AND o.phone=s.phone)))
        < now() - make_interval(days => $1)
      AND NOT EXISTS (SELECT 1 FROM email_log l WHERE l.sub_id=s.id AND l.kind='winback' AND l.created_at > now() - interval '90 days')
      AND NOT EXISTS (SELECT 1 FROM email_log r WHERE r.sub_id=s.id AND r.ok AND r.kind<>'test' AND r.created_at > now() - interval '20 hours')
      AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.status<>'cancelled' AND (lower(o.email)=lower(s.email) OR (s.phone<>'' AND o.phone=s.phone)) AND o.created_at > now() - make_interval(days => $1))
    ORDER BY s.id LIMIT $2`, [days, Math.min(budget, 20)]);
  if (!subs.length) return 0;
  const picks = await db.q(`SELECT p.id FROM products p WHERE ${ELIGIBLE} ORDER BY p.created_at DESC LIMIT 4`);
  const intro = str(settings.email_winback_text, 2000) || '{name}, অনেক দিন আপনাকে দেখি না! 😊\n\nএর মধ্যে দোকানে অনেক নতুন পণ্য এসেছে। দেখে নিন — হয়তো আপনার পরের প্রজেক্টের জিনিসটা এখানেই আছে।';
  let n = 0;
  for (const s of subs) {
    await sendOne(settings, s, { kind: 'winback', subject: `${s.name ? String(s.name).split(/\s+/)[0] + ', ' : ''}নতুন কী এসেছে দেখুন 👀`, heading: 'আপনাকে মিস করছি!',
      intro, productIds: picks.map((p) => p.id), button: { text: 'নতুন পণ্য দেখুন', path: '/' } });
    n++;
  }
  return n;
}

// Once a week (the owner's day + hour, Dhaka time): a campaign with the week's new products — or, in a week with
// nothing new, the most popular ones in stock. It then goes out through runCampaigns like any campaign.
async function weekly(settings: Settings) {
  if (settings.email_auto_weekly === '0') return null;
  const now = dhakaNow();
  const day = Math.max(0, Math.min(6, Number(settings.email_weekly_day ?? 5)));
  const hour = Math.max(0, Math.min(23, Number(settings.email_weekly_hour) || 10));
  if (now.weekday !== day || now.hour < hour) return null;
  if (await db.one("SELECT 1 AS x FROM email_campaigns WHERE kind='weekly' AND created_at > now() - interval '6 days'")) return null;
  if (!(await audienceCount('all'))) return null;
  let rows = await db.q(`SELECT p.id FROM products p WHERE ${ELIGIBLE} AND p.created_at > now() - interval '7 days' ORDER BY coalesce(p.sold_count,0) DESC, p.id DESC LIMIT 6`);
  const fresh = rows.length >= 2;
  if (!fresh) rows = await db.q(`SELECT p.id FROM products p WHERE ${ELIGIBLE} ORDER BY coalesce(p.sold_count,0) DESC, coalesce(p.featured,false) DESC, p.id DESC LIMIT 6`);
  if (!rows.length) return null;
  const shop = settings.store_name || 'সবমিলবে';
  return createCampaign(settings, {
    kind: 'weekly', audience: 'all',
    subject: fresh ? `🆕 ${shop}-এ এই সপ্তাহের নতুন পণ্য` : `🔥 ${shop}-এ এই সপ্তাহের জনপ্রিয় পণ্য`,
    intro: fresh ? '{name}, এই সপ্তাহে দোকানে নতুন যা এসেছে তার কয়েকটা নিচে দিলাম। স্টক সীমিত — পছন্দ হলে দেরি করবেন না।'
      : '{name}, এই সপ্তাহে ক্রেতারা যেসব পণ্য সবচেয়ে বেশি দেখছেন ও কিনছেন, তার কয়েকটা নিচে দিলাম।',
    productIds: rows.map((r) => r.id), buttonText: 'সব পণ্য দেখুন', buttonPath: '/',
  });
}

// Called every hour (and now and then from page views). Order: personal mails first, then campaigns, then "we miss you".
async function tick(settings: Settings) {
  const c = cfg(settings);
  if (!c.on || !c.ready) return { skipped: true };
  if (!(await $security.hit(db, 'mail:tick', 1, 240))) return { busy: true };
  await weekly(settings).catch((e) => console.error('mail weekly', e.message));
  let left = Math.min(await leftToday(settings), 120); // one run stays well inside the 60-second limit
  const out: Record<string, Loose> = {};
  out.welcome = await welcome(settings, left).catch(() => 0); left -= out.welcome;
  out.review = await review(settings, left).catch(() => 0); left -= out.review;
  out.campaigns = await runCampaigns(settings, left).catch((e) => { console.error('mail campaigns', e.message); return 0; }); left -= out.campaigns;
  out.winback = await winback(settings, left).catch(() => 0);
  return out;
}

async function stats() {
  return db.one(`SELECT
      (SELECT count(*)::int FROM email_subs WHERE on_list) AS subs,
      (SELECT count(*)::int FROM email_subs WHERE NOT on_list) AS left_list,
      (SELECT count(*)::int FROM email_subs WHERE on_list AND created_at > now() - interval '30 days') AS new30,
      count(*) FILTER (WHERE ok AND kind<>'test')::int AS sent30,
      count(*) FILTER (WHERE NOT ok)::int AS bad30,
      count(*) FILTER (WHERE opened_at IS NOT NULL)::int AS opened30,
      count(*) FILTER (WHERE clicked_at IS NOT NULL)::int AS clicked30
    FROM email_log WHERE created_at > now() - interval '30 days'`);
}

export const _ = { weekly, welcome, review, winback, paragraphs };
export { cfg, leftToday, sentToday, addSub, unsubscribe, bySubToken, sendOne, createCampaign, runCampaigns, audienceCount, tick, stats, mac, macOk, safePath, siteBase, KINDS, AUDIENCES, MAX_GMAIL_DAY, layout };
