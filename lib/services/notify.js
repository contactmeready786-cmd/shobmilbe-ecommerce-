'use strict';
// Owner notifications: e-mail (Gmail, with an "App Password") and WhatsApp (CallMeBot free personal API).
//  - new order on the website  -> e-mail + WhatsApp to the owner
//  - security events (password reset, many wrong passwords, owner login) -> e-mail + WhatsApp
// No npm packages: a tiny SMTP client over TLS (smtp.gmail.com:465) and one HTTPS call for WhatsApp.
// Every setting lives in Admin → নোটিফিকেশন (owner only). Passwords/API keys are stored encrypted.
const tls = require('tls');
const crypto = require('crypto');

const SMTP_HOST = 'smtp.gmail.com';
const SMTP_PORT = 465;
const DEFAULT_EMAIL = 'contact.shobmilbe@gmail.com';

function cleanLine(s, max = 300) { return String(s ?? '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, max); }
function validEmail(e) { return /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(String(e || '')) && String(e).length <= 120; }
function maskEmail(e) {
  const [u, d] = String(e || '').split('@');
  if (!u || !d) return '';
  return u.slice(0, 2) + '•••••' + '@' + d;
}
function b64(s) { return Buffer.from(String(s), 'utf8').toString('base64'); }
function wrap76(s) { return s.replace(/.{1,76}/g, (m) => m + '\r\n'); }
function encHeader(s) { return /^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(s)}?=`; }

function emailConfig(settings) {
  let to = String(settings.notify_email || DEFAULT_EMAIL).trim();
  if (to.toLowerCase() === 'contact.submilbe@gmail.com') to = DEFAULT_EMAIL; // old misspelt default
  const pass = String(settings.gmail_app_password || '').replace(/\s+/g, '');
  return { to, user: to, pass, ready: validEmail(to) && pass.length >= 16 };
}
function waConfig(settings) {
  let phone = String(settings.wa_notify_phone || settings.whatsapp || '').replace(/[^\d+]/g, '');
  if (/^01\d{9}$/.test(phone)) phone = '+88' + phone;
  if (/^8801\d{9}$/.test(phone)) phone = '+' + phone;
  const key = String(settings.callmebot_key || '').trim();
  return { phone, key, ready: /^\+\d{10,15}$/.test(phone) && /^[A-Za-z0-9-]{4,40}$/.test(key) };
}

// ---------------------------------------------------------------- SMTP (Gmail)
function smtpSend({ user, pass, to, subject, text, htmlBody, fromName }) {
  return new Promise((resolve, reject) => {
    const sock = tls.connect({ host: SMTP_HOST, port: SMTP_PORT, servername: SMTP_HOST });
    let buf = '';
    let waiting = null;
    let done = false;
    const finish = (err) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { sock.end(); } catch (_) { /* ignore */ }
      err ? reject(err) : resolve();
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
    const cmd = (line, expect) => new Promise((ok, bad) => {
      waiting = (code, reply) => (expect.includes(code) ? ok(reply) : bad(new Error(smtpError(code, reply))));
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
      wrap76(b64(htmlBody || `<pre style="font-family:sans-serif;white-space:pre-wrap">${escapeHtml(text)}</pre>`)),
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
function smtpError(code, reply) {
  if (code === 535 || code === 534) return 'Gmail লগইন হয়নি: ঠিকানা বা App Password ভুল (সাধারণ Gmail পাসওয়ার্ড এখানে চলে না, App Password লাগবে)';
  return `ইমেইল পাঠানো যায়নি (${code}): ${String(reply).slice(0, 160)}`;
}
function escapeHtml(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

async function sendEmail(settings, subject, text, htmlBody, to) {
  const c = emailConfig(settings);
  if (!c.ready) throw new Error('ইমেইল এখনো সেটআপ করা হয়নি');
  const target = to && validEmail(to) ? to : c.to;
  await smtpSend({ user: c.user, pass: c.pass, to: target, subject, text, htmlBody, fromName: settings.store_name });
}

// ---------------------------------------------------------------- WhatsApp (CallMeBot)
async function sendWhatsApp(settings, text) {
  const c = waConfig(settings);
  if (!c.ready) throw new Error('WhatsApp নোটিফিকেশন এখনো সেটআপ করা হয়নি');
  const url = 'https://api.callmebot.com/whatsapp.php?' + new URLSearchParams({ phone: c.phone, text: String(text).slice(0, 1500), apikey: c.key }).toString();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10000);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    const body = (await r.text()).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (!r.ok || /APIKey is invalid|not valid|error/i.test(body)) throw new Error('WhatsApp মেসেজ যায়নি: ' + (body.slice(0, 160) || r.status));
  } finally { clearTimeout(t); }
}

// ---------------------------------------------------------------- running after the reply
// On Vercel, work started after the page is sent can be frozen. Vercel gives a "waitUntil" hook for exactly
// this; if it isn't there (local server), we simply wait up to a few seconds.
function later(promise, capMs = 6000) {
  const p = Promise.resolve(promise).catch((e) => console.error('notify', e && e.message));
  try {
    const ctx = globalThis[Symbol.for('@vercel/request-context')];
    const w = ctx && ctx.get && ctx.get() && ctx.get().waitUntil;
    if (typeof w === 'function') { w(p); return Promise.resolve(); }
  } catch (_) { /* fall through */ }
  return Promise.race([p, new Promise((r) => setTimeout(r, capMs))]);
}

async function logResult(service, action, fn) {
  const db = require('../db');
  try { await fn(); await db.logIntegration(service, action, true, 'পাঠানো হয়েছে'); return true; } catch (e) {
    await db.logIntegration(service, action, false, e.message || String(e));
    return false;
  }
}

// Phone notification to every device the owner turned on (skipped quietly when none).
function pushJob(action, msg) {
  const push = require('./push');
  return push.count().then((n) => (n ? logResult('notify-push', action, () => push.sendAll(msg)) : null)).catch(() => null);
}

// ---------------------------------------------------------------- what gets sent
const PAY_NAMES = { cod: 'ক্যাশ অন ডেলিভারি', bkash: 'বিকাশ (অনলাইন)', ssl: 'কার্ড/নগদ/রকেট (SSLCommerz)' };
function tk(n) { return '৳' + (Math.round(Number(n || 0) * 100) / 100).toLocaleString('en-IN'); }

function newOrder(settings, site, o) {
  const items = (o.lines || []).map((l) => `• ${cleanLine(l.name, 80)} × ${l.qty} = ${tk(l.price * l.qty)}`).join('\n');
  const link = `${site}/admin/orders/${o.id}`;
  const pay = PAY_NAMES[o.payment] || (o.payment ? `${o.payment} Send Money${o.trxId ? ' · TrxID ' + o.trxId : ''}` : '');
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
  const htmlBody = `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:#222">
<h2 style="margin:0 0 8px;color:#0a7d3b">🛒 নতুন অর্ডার এসেছে — ${escapeHtml(o.code)}</h2>
<p><b>কাস্টমার:</b> ${escapeHtml(o.name)}<br><b>মোবাইল:</b> ${escapeHtml(o.phone)}<br>
<b>ঠিকানা:</b> ${escapeHtml(o.address)}, ${escapeHtml(o.thana)}, ${escapeHtml(o.district)}</p>
<table style="border-collapse:collapse;width:100%;max-width:520px">${(o.lines || []).map((l) => `<tr><td style="padding:4px 8px;border-bottom:1px solid #eee">${escapeHtml(l.name)}</td>
<td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:right">× ${l.qty}</td><td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:right">${tk(l.price * l.qty)}</td></tr>`).join('')}
<tr><td colspan="2" style="padding:6px 8px;text-align:right"><b>মোট</b></td><td style="padding:6px 8px;text-align:right"><b>${tk(o.total)}</b></td></tr></table>
<p><b>পেমেন্ট:</b> ${escapeHtml(pay)}${o.note ? `<br><b>নোট:</b> ${escapeHtml(o.note)}` : ''}</p>
<p><a href="${escapeHtml(link)}" style="display:inline-block;background:#0a7d3b;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">অর্ডারটি খুলুন ও প্রসেস করুন</a></p></div>`;
  const jobs = [];
  if (settings.notify_order_email !== '0' && emailConfig(settings).ready) {
    jobs.push(logResult('notify-email', 'order ' + o.code, () => sendEmail(settings, `🛒 নতুন অর্ডার ${o.code} — ${tk(o.total)}`, text, htmlBody)));
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

// Security alerts always try both channels (unless the owner switched them off).
function securityAlert(settings, title, detail, { extraEmail } = {}) {
  if (settings.notify_security === '0') return Promise.resolve();
  const when = new Date().toLocaleString('en-GB', { timeZone: 'Asia/Dhaka' });
  const text = `🔐 ${title}\n\n${detail}\n\nসময়: ${when} (ঢাকা)\n\nআপনি নিজে না করে থাকলে এখনই অ্যাডমিনে ঢুকে পাসওয়ার্ড বদলান, আর Admin → নিরাপত্তা দেখুন।`;
  const jobs = [];
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

module.exports = { DEFAULT_EMAIL, emailConfig, waConfig, validEmail, maskEmail, sendEmail, sendWhatsApp, smtpSend, newOrder, securityAlert, later, escapeHtml };
