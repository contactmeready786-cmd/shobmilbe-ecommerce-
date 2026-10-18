// Owner notifications: e-mail (Gmail, with an "App Password") and WhatsApp (CallMeBot free personal API).
//  - new order on the website  -> e-mail + WhatsApp to the owner
//  - security events (password reset, many wrong passwords, owner login) -> e-mail + WhatsApp
// No npm packages: a tiny SMTP client over TLS (smtp.gmail.com:465) and one HTTPS call for WhatsApp.
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
function waConfig(settings: Settings) {
  let phone = String(settings.wa_notify_phone || settings.whatsapp || '').replace(/[^\d+]/g, '');
  if (/^01\d{9}$/.test(phone)) phone = '+88' + phone;
  if (/^8801\d{9}$/.test(phone)) phone = '+' + phone;
  // two services: CallMeBot (free, sometimes slow to activate) or TextMeBot (about $1/month, links your own WhatsApp)
  const provider = ['textmebot', 'greenapi'].includes(settings.wa_provider as string) ? settings.wa_provider : 'callmebot';
  if (provider === 'greenapi') {
    // Green-API free "Developer" plan: a WhatsApp linked by QR sends the message (idInstance + apiTokenInstance)
    const id = String(settings.greenapi_id || '').replace(/\D/g, '');
    const key = String(settings.greenapi_token || '').trim();
    return { phone, key, id, provider, ready: /^\+\d{10,15}$/.test(phone) && /^\d{6,15}$/.test(id) && /^[A-Za-z0-9]{20,80}$/.test(key) };
  }
  const key = String(provider === 'textmebot' ? settings.textmebot_key || '' : settings.callmebot_key || '').trim();
  return { phone, key, provider, ready: /^\+\d{10,15}$/.test(phone) && /^[A-Za-z0-9_-]{4,60}$/.test(key) };
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
    sock.on('error', (e) => finish(e));
    sock.on('data', (d) => {
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

// ---------------------------------------------------------------- WhatsApp (CallMeBot)
async function sendWhatsApp(settings: Settings, text: unknown): Promise<void> {
  const c = waConfig(settings);
  if (!c.ready) throw new Error('WhatsApp নোটিফিকেশন এখনো সেটআপ করা হয়নি');
  if (c.provider === 'greenapi') return sendGreenApi(c, text);
  const url = c.provider === 'textmebot'
    ? 'https://api.textmebot.com/send.php?' + new URLSearchParams({ recipient: c.phone, apikey: c.key, text: String(text).slice(0, 1500) }).toString()
    : 'https://api.callmebot.com/whatsapp.php?' + new URLSearchParams({ phone: c.phone, text: String(text).slice(0, 1500), apikey: c.key }).toString();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10000);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    const body = (await r.text()).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (!r.ok || /APIKey is invalid|not valid|error|invalid|expired|not (linked|connected)/i.test(body)) throw new Error('WhatsApp মেসেজ যায়নি: ' + (body.slice(0, 160) || r.status));
  } finally { clearTimeout(t); }
}

// Green-API: the server for an instance is <first 4 digits of idInstance>.api.greenapi.com
async function sendGreenApi(c: { id?: string; key: string; phone: string }, text: unknown): Promise<void> {
  const id = String(c.id || '');
  const hosts = [`https://${id.slice(0, 4)}.api.greenapi.com`, 'https://api.green-api.com'];
  let last: unknown;
  for (const h of hosts) {
    try {
      const r = await fetch(`${h}/waInstance${id}/sendMessage/${c.key}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId: c.phone.replace(/\D/g, '') + '@c.us', message: String(text).slice(0, 4000) }),
        signal: AbortSignal.timeout(10000),
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.idMessage) return;
      last = new Error('WhatsApp মেসেজ যায়নি: ' + (j.message || (r.status === 401 || r.status === 403 ? 'idInstance বা apiTokenInstance ঠিক নেই' : r.status === 466 ? 'ফ্রি প্ল্যানের ৩টা চ্যাটের সীমা' : 'Green-API ' + r.status)));
      if (r.status !== 404) break;
    } catch (e) { last = e; }
  }
  throw last || new Error('WhatsApp মেসেজ যায়নি');
}

// ---------------------------------------------------------------- running after the reply
// On Vercel, work started after the page is sent can be frozen. Vercel gives a "waitUntil" hook for exactly
// this; if it isn't there (local server), we simply wait up to a few seconds.
function later(promise: unknown, capMs = 6000): Promise<unknown> {
  const p = Promise.resolve(promise).catch((e) => console.error('notify', e && e.message));
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
  if (settings.notify_order_wa !== '0' && waConfig(settings).ready) {
    jobs.push(logResult('notify-whatsapp', 'order ' + o.code, () => sendWhatsApp(settings, `*আপনার একটা নতুন অর্ডার এসেছে!* ✅\n\n${text}`)));
  }
  return later(Promise.all(jobs));
}

// 📮 A new complaint: the owner hears at once (phone notification, e-mail, WhatsApp — whatever is set up).
function newComplaint(settings: Settings, site: string, c: ComplaintNews, topicLabel: string, hours: number | string) {
  const link = `${site}/admin/complaints/${c.id}`;
  const text = [`📮 নতুন অভিযোগ (${c.code}) — ${hours} ঘণ্টার মধ্যে সমাধান করতে হবে`, '', `কাস্টমার: ${cleanLine(c.name, 80)} · ${c.phone}`,
    `বিষয়: ${topicLabel}${c.order_code ? ` · অর্ডার ${c.order_code}` : ''}`, '', cleanLine(c.message, 500), '', `খুলুন: ${link}`].join('\n');
  const jobs: Promise<unknown>[] = [pushJob('complaint ' + c.code, { title: `📮 নতুন অভিযোগ — ${topicLabel}`, body: `${cleanLine(c.name, 60)}: ${cleanLine(c.message, 120)}`, url: `/admin/complaints/${c.id}`, tag: 'complaint-' + c.id })];
  if (settings.notify_order_email !== '0' && emailConfig(settings).ready) jobs.push(logResult('notify-email', 'complaint ' + c.code, () => sendEmail(settings, `📮 নতুন অভিযোগ ${c.code} — ${topicLabel}`, text)));
  if (settings.notify_order_wa !== '0' && waConfig(settings).ready) jobs.push(logResult('notify-whatsapp', 'complaint ' + c.code, () => sendWhatsApp(settings, `*নতুন অভিযোগ এসেছে* 📮\n\n${text}`)));
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
  if (waConfig(settings).ready) jobs.push(logResult('notify-whatsapp', 'security', () => sendWhatsApp(settings, `*নিরাপত্তা সতর্কতা* 🔐\n${text}`)));
  return later(Promise.all(jobs));
}

export { DEFAULT_EMAIL, sendVia, emailConfig, acctEmailConfig, sendAcctEmail, waConfig, validEmail, maskEmail, sendEmail, sendWhatsApp, smtpSend, newOrder, newComplaint, securityAlert, later, escapeHtml };
