// Owner notifications: e-mail (Gmail, with an "App Password"), phone push, and Telegram (the shop's own bot, free).
//  - new order on the website  -> e-mail + push + Telegram to the owner
//  - security events (password reset, many wrong passwords, owner login) -> e-mail + push + Telegram
// No npm packages: a tiny SMTP client over TLS (smtp.gmail.com:465) and one HTTPS call for Telegram.
// (WhatsApp was removed on 2026-11-17: no free WhatsApp route worked reliably — CallMeBot / Green-API.)
// Every setting lives in Admin → নোটিফিকেশন (owner only). Passwords/API keys are stored encrypted.
import { emailHtml, OrderEmail, PlainEmail, type OrderMail } from '../emails';
import * as tls from 'node:tls';
import * as crypto from 'node:crypto';
import * as $db from '../db';
import * as $push from './push';
import type { Settings } from '../types';

/** One mail: to whom, the subject, the plain text, the HTML (drawn from the text when missing) and extra headers. */
export type Mail = { to: string; subject: string; text: string; htmlBody?: string | null; headers?: Record<string, string> };
/** A mail with the Gmail login that sends it. */
type SignedMail = Mail & { user: string; pass: string; fromName?: string };
/** A phone notification to the owner's devices. */
type PushMsg = Parameters<typeof $push.sendAll>[0];
/** What the new-order news says (the order just placed, with the customer's details). */
export type NewOrderNews = {
  id: number; code: string; name: string; phone: string; address: string; thana: string; district: string; total: number;
  payment?: string; trxId?: string; note?: string | null; lines?: { name: string; qty: number; price: number }[] | null;
};
/** What the new-complaint news reads of the complaint (a complaints row). */
type ComplaintNews = { id?: number; code?: string; name?: string; phone?: string; order_code?: string | null; message?: string };

const SMTP_HOST = 'smtp.gmail.com';
const SMTP_PORT = 465;
const DEFAULT_EMAIL = 'contact.shobmilbe@gmail.com';

function cleanLine(s: unknown, max = 300): string { return String(s ?? '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, max); }
function validEmail(e: unknown): boolean { return /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(String(e || '')) && String(e).length <= 120; }
function maskEmail(e: unknown): string {
  const [u, d] = String(e || '').split('@');
  if (!u || !d) return '';
  return u.slice(0, 2) + '•••••' + '@' + d;
}
function b64(s: unknown): string { return Buffer.from(String(s), 'utf8').toString('base64'); }
function wrap76(s: string): string { return s.replace(/.{1,76}/g, (m) => m + '\r\n'); }
function encHeader(s: string): string { return /^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(s)}?=`; }

// 📧 The shop has ONE Gmail (Admin → সেটিংস → আমার নোটিফিকেশন). It sends all three kinds of mail:
// new-order news to the owner, customers' sign-up codes, and the owner's delete codes.
function emailConfig(settings: Settings) {
  let to = String(settings.notify_email || DEFAULT_EMAIL).trim();
  if (to.toLowerCase() === 'contact.submilbe@gmail.com') to = DEFAULT_EMAIL; // old misspelt default
  const pass = String(settings.gmail_app_password || '').replace(/\s+/g, '');
  const backup = sendersOf(settings).length > 0;
  return { to, user: to, pass, ready: validEmail(to) && (pass.length >= 16 || backup) };
}
// Every Gmail + Google code saved in the admin, the main one first. The customer-accounts page used to keep its own
// Gmail; that code is still tried when the main one is refused, so a wrong code in one place can't stop the mail.
function sendersOf(settings: Settings) {
  let main = String(settings.notify_email || DEFAULT_EMAIL).trim();
  if (main.toLowerCase() === 'contact.submilbe@gmail.com') main = DEFAULT_EMAIL;
  const list = [
    { user: main, pass: String(settings.gmail_app_password || '').replace(/\s+/g, ''), key: 'gmail_app_password' },
    { user: String(settings.acct_gmail || '').trim() || main, pass: String(settings.acct_gmail_password || '').replace(/\s+/g, ''), key: 'acct_gmail_password' },
  ];
  const seen = new Set();
  return list.filter((c) => validEmail(c.user) && c.pass.length >= 16 && !seen.has(c.user.toLowerCase() + c.pass) && seen.add(c.user.toLowerCase() + c.pass));
}
// Send with the main Gmail; if Gmail refuses its code, try the other saved code. A code that works for the shop's own
// address becomes the main code, so the next mail goes straight through.
async function sendVia(settings: Settings, { to, subject, text, htmlBody, headers }: Mail): Promise<void> {
  const senders = sendersOf(settings);
  if (!senders.length) throw new Error('দোকানের Gmail এখনো সেটআপ করা হয়নি (সেটিংস → আমার নোটিফিকেশন)');
  let firstErr: unknown = null;
  for (const c of senders) {
    try {
      await smtpSend({ user: c.user, pass: c.pass, to, subject, text, htmlBody, fromName: settings.store_name, headers });
      if (firstErr && c.key !== 'gmail_app_password' && c.user.toLowerCase() === emailConfig(settings).user.toLowerCase()) {
        const db = $db;
        await db.setSetting('gmail_app_password', c.pass).catch(() => {});
        settings.gmail_app_password = c.pass;
      }
      return;
    } catch (e) {
      firstErr = firstErr || e;
      if (!/Gmail লগইন হয়নি/.test((e as Error)?.message || '')) throw e; // only a refused code is worth a second try
    }
  }
  throw firstErr;
}
function acctEmailConfig(settings: Settings) { return { ...emailConfig(settings), own: false }; }
async function sendAcctEmail(settings: Settings, subject: string, text: string, htmlBody: string | null | undefined, to: string): Promise<void> {
  await sendVia(settings, { to, subject, text, htmlBody });
}
// Telegram to the owner: the bot set up once on Admin → মার্কেটিং → অটো মার্কেটিং → Telegram (`telegram_bot_token`)
// sends a private message to the owner's own Telegram, linked once on Admin → নোটিফিকেশন (`tg_owner_chat`).
// The setting names `notify_order_wa` / `autocall_notify_wa` are kept (they now mean "the owner's chat app").
const TG_TOKEN = /^\d{5,}:[A-Za-z0-9_-]{30,}$/;
function tgConfig(settings: Settings) {
  const token = String(settings.telegram_bot_token || '').trim();
  const chat = String(settings.tg_owner_chat || '').trim();
  const hasBot = TG_TOKEN.test(token);
  return { token, chat, hasBot, ready: hasBot && /^-?\d{4,20}$/.test(chat) };
}

// ---------------------------------------------------------------- SMTP (Gmail)
/** Sends one mail through Gmail. A mail without its own HTML gets the text drawn as a simple HTML mail. */
async function smtpSend(mail: SignedMail): Promise<void> {
  const htmlBody = mail.htmlBody || (await emailHtml(PlainEmail({ text: String(mail.text ?? '') })));
  return smtpWire({ ...mail, htmlBody });
}
function smtpWire({ user, pass, to, subject, text, htmlBody, fromName, headers = {} }: SignedMail & { htmlBody: string }): Promise<void> {
  return new Promise((resolve, reject) => {
    const sock = tls.connect({ host: SMTP_HOST, port: SMTP_PORT, servername: SMTP_HOST });
    let buf = '';
    let waiting: ((code: number, reply: string) => void) | null = null;
    let done = false;
    const finish = (err?: unknown) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { sock.end(); } catch (_) { /* ignore */ }
      err ? reject(err) : resolve(undefined);
    };
    const timer = setTimeout(() => finish(new Error('ইমেইল সার্ভার সাড়া দেয়নি (timeout)')), 12000);
    sock.setEncoding('utf8');
    sock.on('error', (e: Error) => finish(e));
    sock.on('data', (d: string) => {
      buf += d;
      // a full reply ends with a line "NNN text" (no dash after the code)
      const lines = buf.split('\r\n');
      for (let i = 0; i < lines.length - 1; i++) {
        const m = lines[i].match(/^(\d{3})([ -])/);
        if (m && m[2] === ' ') {
          const reply = lines.slice(0, i + 1).join('\n');
          buf = lines.slice(i + 1).join('\r\n');
          if (waiting) { const w = waiting; waiting = null; w(Number(m[1]), reply); }
          return;
        }
      }
    });
    const cmd = (line: string | null, expect: number[]) => new Promise((ok, bad) => {
      waiting = (code: number, reply: string) => (expect.includes(code) ? ok(reply) : bad(new Error(smtpError(code, reply))));
      if (line !== null) sock.write(line + '\r\n');
    });

    const boundary = 'sm' + crypto.randomBytes(12).toString('hex');
    const from = `${encHeader(cleanLine(fromName || 'সবমিলবে', 60))} <${user}>`;
    const message = [
      `From: ${from}`,
      `To: <${to}>`,
      `Subject: ${encHeader(cleanLine(subject, 200))}`,
      `Date: ${new Date().toUTCString()}`,
      `Message-ID: <${crypto.randomBytes(16).toString('hex')}@${user.split('@')[1]}>`,
      // extra headers (e.g. List-Unsubscribe on offer e-mails) — one line each, never a line break inside
      ...Object.entries(headers || {}).filter(([k]) => /^[A-Za-z][A-Za-z0-9-]{1,40}$/.test(k)).map(([k, v]) => `${k}: ${cleanLine(v, 400)}`),
      'MIME-Version: 1.0',
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      '',
      `--${boundary}`,
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      wrap76(b64(text)),
      `--${boundary}`,
      'Content-Type: text/html; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      wrap76(b64(htmlBody)),
      `--${boundary}--`,
      '',
    ].join('\r\n');

    (async () => {
      await cmd(null, [220]);
      await cmd('EHLO shobmilbe.com', [250]);
      await cmd('AUTH LOGIN', [334]);
      await cmd(b64(user), [334]);
      await cmd(b64(pass), [235]);
      await cmd(`MAIL FROM:<${user}>`, [250]);
      await cmd(`RCPT TO:<${to}>`, [250, 251]);
      await cmd('DATA', [354]);
      await cmd(message + '\r\n.', [250]);
      sock.write('QUIT\r\n');
      finish();
    })().catch(finish);
  });
}
function smtpError(code: number, reply: string): string {
  if (code === 535 || code === 534) return 'Gmail লগইন হয়নি: ঠিকানা বা App Password ভুল (সাধারণ Gmail পাসওয়ার্ড এখানে চলে না, App Password লাগবে)';
  return `ইমেইল পাঠানো যায়নি (${code}): ${String(reply).slice(0, 160)}`;
}
function escapeHtml(s: unknown): string { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as Record<string, string>)[c]); }

async function sendEmail(settings: Settings, subject: string, text: string, htmlBody?: string | null, to?: string | null): Promise<void> {
  const c = emailConfig(settings);
  if (!c.ready) throw new Error('ইমেইল এখনো সেটআপ করা হয়নি');
  const target = to && validEmail(to) ? to : c.to;
  await sendVia(settings, { to: target, subject, text, htmlBody });
}

// ---------------------------------------------------------------- Telegram (the shop's bot → the owner)
type TgAnswer<T> = { ok?: boolean; description?: string; result?: T };
async function tgCall<T>(token: string, method: string, params: unknown): Promise<T> {
  if (!TG_TOKEN.test(token)) throw new Error('Telegram বট এখনো যুক্ত করা হয়নি');
  const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params || {}), signal: AbortSignal.timeout(10000),
  });
  const j = (await r.json().catch(() => ({}))) as TgAnswer<T>;
  if (!r.ok || !j.ok) {
    const d = String(j.description || `HTTP ${r.status}`);
    if (/blocked|deactivated|chat not found/i.test(d)) throw new Error('Telegram মেসেজ যায়নি: বটটা বন্ধ (Block/Stop) করা আছে — Telegram-এ বট খুলে Start চাপুন, তারপর অ্যাডমিনে আবার যুক্ত করুন');
    if (/unauthorized/i.test(d)) throw new Error('Telegram মেসেজ যায়নি: বটের টোকেন বাতিল — অটো মার্কেটিং → Telegram-এ নতুন টোকেন দিন');
    if (/conflict|webhook/i.test(d)) throw new Error('Telegram: বটে অন্য কোনো সার্ভিস (webhook) লাগানো আছে, তাই Start মেসেজ পড়া গেল না');
    throw new Error('Telegram মেসেজ যায়নি: ' + d.slice(0, 160));
  }
  return j.result as T;
}
/** WhatsApp-style *bold* → Telegram HTML; everything else is shown as plain text */
function tgHtml(text: unknown): string { return escapeHtml(String(text ?? '').slice(0, 3800)).replace(/\*([^*\n]+)\*/g, '<b>$1</b>'); }
async function sendTelegram(settings: Settings, text: unknown): Promise<void> {
  const c = tgConfig(settings);
  if (!c.ready) throw new Error('Telegram নোটিফিকেশন এখনো চালু হয়নি');
  await tgCall(c.token, 'sendMessage', { chat_id: c.chat, text: tgHtml(text), parse_mode: 'HTML', disable_web_page_preview: true });
}
const botNames = new Map<string, string>();
/** the bot's @username (for the t.me link the owner opens); asked once per token */
async function tgBotName(settings: Settings): Promise<string> {
  const c = tgConfig(settings);
  if (!c.hasBot) return '';
  if (!botNames.has(c.token)) {
    const me = await tgCall<{ username?: string }>(c.token, 'getMe', {});
    botNames.set(c.token, String(me.username || ''));
  }
  return botNames.get(c.token) || '';
}
/** finds the private chat that sent "/start <code>" to the bot (the link on Admin → নোটিফিকেশন) */
async function tgFindStart(settings: Settings, code: string): Promise<string | null> {
  const c = tgConfig(settings);
  if (!code) return null;
  const ups = await tgCall<{ message?: { text?: string; chat?: { id?: number; type?: string } } }[]>(c.token, 'getUpdates', { allowed_updates: ['message'], timeout: 0, limit: 100 });
  for (const u of [...(ups || [])].reverse()) {
    const m = u.message;
    if (m && m.chat && m.chat.type === 'private' && m.chat.id && String(m.text || '').trim() === '/start ' + code) return String(m.chat.id);
  }
  return null;
}

// ---------------------------------------------------------------- running after the reply
// On Vercel, work started after the page is sent can be frozen. Vercel gives a "waitUntil" hook for exactly
// this; if it isn't there (local server), we simply wait up to a few seconds.
function later(promise: unknown, capMs = 6000): Promise<unknown> {
  const p = Promise.resolve(promise).catch((e: Error) => console.error('notify', e && e.message));
  try {
    // Vercel's hook, when there: { get(): { waitUntil(p) } }
    const ctx = (globalThis as Record<symbol, { get?: () => { waitUntil?: (p: Promise<unknown>) => void } | undefined } | undefined>)[Symbol.for('@vercel/request-context')];
    const store = ctx && ctx.get ? ctx.get() : undefined;
    const w = store && store.waitUntil;
    if (typeof w === 'function') { w(p); return Promise.resolve(); }
  } catch (_) { /* fall through */ }
  return Promise.race([p, new Promise((r) => setTimeout(r, capMs))]);
}

async function logResult(service: string, action: string, fn: () => Promise<unknown>): Promise<boolean> {
  const db = $db;
  try { await fn(); await db.logIntegration(service, action, true, 'পাঠানো হয়েছে'); return true; } catch (e) {
    await db.logIntegration(service, action, false, (e as Error)?.message || String(e));
    return false;
  }
}

// Phone notification to every device the owner turned on (skipped quietly when none).
function pushJob(action: string, msg: PushMsg) {
  const push = $push;
  return push.count().then((n) => (n ? logResult('notify-push', action, () => push.sendAll(msg)) : null)).catch(() => null);
}

// ---------------------------------------------------------------- what gets sent
const PAY_NAMES: Record<string, string> = { cod: 'ক্যাশ অন ডেলিভারি', bkash: 'বিকাশ (অনলাইন)', ssl: 'কার্ড/নগদ/রকেট (SSLCommerz)' };
function tk(n: unknown): string { return '৳' + (Math.round(Number(n || 0) * 100) / 100).toLocaleString('en-IN'); }

function newOrder(settings: Settings, site: string, o: NewOrderNews) {
  const items = (o.lines || []).map((l) => `• ${cleanLine(l.name, 80)} × ${l.qty} = ${tk(l.price * l.qty)}`).join('\n');
  const link = `${site}/admin/orders/${o.id}`;
  const pay = PAY_NAMES[o.payment || ''] || (o.payment ? `${o.payment} Send Money${o.trxId ? ' · TrxID ' + o.trxId : ''}` : '');
  const text = [
    `🛒 নতুন অর্ডার এসেছে! (${o.code})`,
    '',
    `কাস্টমার: ${cleanLine(o.name, 80)}`,
    `মোবাইল: ${o.phone}`,
    `ঠিকানা: ${cleanLine(o.address, 200)}, ${cleanLine(o.thana, 60)}, ${cleanLine(o.district, 60)}`,
    '',
    items,
    '',
    `মোট: ${tk(o.total)}`,
    `পেমেন্ট: ${pay}`,
    o.note ? `নোট: ${cleanLine(o.note, 200)}` : '',
    '',
    `অর্ডারটি প্রসেস করুন: ${link}`,
  ].filter((x, i, a) => !(x === '' && a[i - 1] === '')).join('\n');
  const mail: OrderMail = {
    code: o.code, name: o.name, phone: o.phone, address: o.address, thana: o.thana, district: o.district,
    lines: (o.lines || []).map((l) => ({ name: l.name, qty: l.qty, amount: tk(l.price * l.qty) })),
    total: tk(o.total), pay, note: o.note || '', link,
  };
  const jobs: Promise<unknown>[] = [];
  if (settings.notify_order_email !== '0' && emailConfig(settings).ready) {
    jobs.push(logResult('notify-email', 'order ' + o.code, async () => sendEmail(settings, `🛒 নতুন অর্ডার ${o.code} — ${tk(o.total)}`, text, await emailHtml(OrderEmail({ o: mail })))));
  }
  if (settings.notify_order_push !== '0') {
    const n = (o.lines || []).reduce((t, l) => t + Number(l.qty || 0), 0);
    jobs.push(pushJob('order ' + o.code, {
      title: `🛒 নতুন অর্ডার — ${tk(o.total)}`,
      body: `${cleanLine(o.name, 60)} · ${n} টি পণ্য · ${cleanLine(o.district, 40)}\nচাপ দিয়ে অর্ডারটি খুলুন ও প্রসেস করুন`,
      url: `/admin/orders/${o.id}`, tag: 'order-' + o.id,
    }));
  }
  if (settings.notify_order_wa !== '0' && tgConfig(settings).ready) {
    jobs.push(logResult('notify-telegram', 'order ' + o.code, () => sendTelegram(settings, `*আপনার একটা নতুন অর্ডার এসেছে!* ✅\n\n${text}`)));
  }
  return later(Promise.all(jobs));
}

// 📮 A new complaint: the owner hears at once (phone notification, e-mail, Telegram — whatever is set up).
function newComplaint(settings: Settings, site: string, c: ComplaintNews, topicLabel: string, hours: number | string) {
  const link = `${site}/admin/complaints/${c.id}`;
  const text = [`📮 নতুন অভিযোগ (${c.code}) — ${hours} ঘণ্টার মধ্যে সমাধান করতে হবে`, '', `কাস্টমার: ${cleanLine(c.name, 80)} · ${c.phone}`,
    `বিষয়: ${topicLabel}${c.order_code ? ` · অর্ডার ${c.order_code}` : ''}`, '', cleanLine(c.message, 500), '', `খুলুন: ${link}`].join('\n');
  const jobs: Promise<unknown>[] = [pushJob('complaint ' + c.code, { title: `📮 নতুন অভিযোগ — ${topicLabel}`, body: `${cleanLine(c.name, 60)}: ${cleanLine(c.message, 120)}`, url: `/admin/complaints/${c.id}`, tag: 'complaint-' + c.id })];
  if (settings.notify_order_email !== '0' && emailConfig(settings).ready) jobs.push(logResult('notify-email', 'complaint ' + c.code, () => sendEmail(settings, `📮 নতুন অভিযোগ ${c.code} — ${topicLabel}`, text)));
  if (settings.notify_order_wa !== '0' && tgConfig(settings).ready) jobs.push(logResult('notify-telegram', 'complaint ' + c.code, () => sendTelegram(settings, `*নতুন অভিযোগ এসেছে* 📮\n\n${text}`)));
  return later(Promise.all(jobs));
}

// 🔎 A customer could not find something and left a number to be told when it comes in.
function searchRequest(settings: Settings, site: string, r: { id: number; q: string; name: string; phone: string }) {
  const link = `${site}/admin/reports/search#requests`;
  const who = `${r.name ? cleanLine(r.name, 60) + ' · ' : ''}${r.phone}`;
  const text = [`🔎 কাস্টমার একটা পণ্য খুঁজে পায়নি, নম্বর রেখে গেছে`, '', `যা খুঁজেছে: ${cleanLine(r.q, 80)}`, `কাস্টমার: ${who}`, '', `দেখুন: ${link}`].join('\n');
  const jobs: Promise<unknown>[] = [pushJob('search-request ' + r.id, { title: `🔎 খুঁজে পায়নি: ${cleanLine(r.q, 50)}`, body: `${who} — পণ্যটা এনে দিলে কল করুন`, url: '/admin/reports/search#requests', tag: 'sreq-' + r.id })];
  if (settings.notify_order_email !== '0' && emailConfig(settings).ready) jobs.push(logResult('notify-email', 'search-request', () => sendEmail(settings, `🔎 কাস্টমার খুঁজছে: ${cleanLine(r.q, 60)}`, text)));
  if (settings.notify_order_wa !== '0' && tgConfig(settings).ready) jobs.push(logResult('notify-telegram', 'search-request', () => sendTelegram(settings, text)));
  return later(Promise.all(jobs));
}

// Security alerts always try both channels (unless the owner switched them off).
function securityAlert(settings: Settings, title: string, detail: unknown, { extraEmail }: { extraEmail?: string | null } = {}) {
  if (settings.notify_security === '0') return Promise.resolve();
  const when = new Date().toLocaleString('en-GB', { timeZone: 'Asia/Dhaka' });
  const text = `🔐 ${title}\n\n${detail}\n\nসময়: ${when} (ঢাকা)\n\nআপনি নিজে না করে থাকলে এখনই অ্যাডমিনে ঢুকে পাসওয়ার্ড বদলান, আর Admin → নিরাপত্তা দেখুন।`;
  const jobs: Promise<unknown>[] = [];
  if (emailConfig(settings).ready) {
    jobs.push(logResult('notify-email', 'security', () => sendEmail(settings, `🔐 নিরাপত্তা সতর্কতা: ${title}`, text)));
    if (extraEmail && validEmail(extraEmail) && extraEmail.toLowerCase() !== emailConfig(settings).to.toLowerCase()) {
      jobs.push(logResult('notify-email', 'security', () => sendEmail(settings, `🔐 নিরাপত্তা সতর্কতা: ${title}`, text, null, extraEmail)));
    }
  }
  jobs.push(pushJob('security', { title: `🔐 ${title}`, body: String(detail).slice(0, 300), url: '/admin/security', tag: 'sec-' + Date.now() }));
  if (tgConfig(settings).ready) jobs.push(logResult('notify-telegram', 'security', () => sendTelegram(settings, `*নিরাপত্তা সতর্কতা* 🔐\n${text}`)));
  return later(Promise.all(jobs));
}

export { DEFAULT_EMAIL, sendVia, emailConfig, acctEmailConfig, sendAcctEmail, tgConfig, validEmail, maskEmail, sendEmail, sendTelegram, tgBotName, tgFindStart, smtpSend, newOrder, newComplaint, searchRequest, securityAlert, later, escapeHtml };
