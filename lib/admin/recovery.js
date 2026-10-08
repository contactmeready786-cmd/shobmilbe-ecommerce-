'use strict';
// Admin → নিরাপত্তা → জরুরি রিকভারি কোড (owner only).
// Six one-time codes the owner writes on paper. Any one of them opens /admin/reset when the phone is lost,
// the camera is broken or the password is forgotten — no Vercel setting needed.
// Only a slow hash (scrypt) of each code is stored; the codes are shown once, right after they are made.
const crypto = require('crypto');
const { html, fmtDate } = require('../util');
const db = require('../db');
const ui = require('./ui');

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I
function makeCode() {
  let s = '';
  for (let i = 0; i < 12; i++) s += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return s.match(/.{4}/g).join('-');
}
function normalize(c) { return String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }
function hash(c) { return crypto.scryptSync(normalize(c), 'shobmilbe-recovery-v1', 32).toString('hex'); }

async function available() { return (await db.one('SELECT count(*)::int AS n FROM recovery_codes WHERE used_at IS NULL')).n; }
// Is this a valid unused code? (does not use it up)
async function check(code) {
  if (normalize(code).length !== 12) return false;
  return !!(await db.one('SELECT id FROM recovery_codes WHERE hash=$1 AND used_at IS NULL', [hash(code)]));
}
// Use it up (only one request can win).
async function consume(code) {
  return !!(await db.one('UPDATE recovery_codes SET used_at=now() WHERE hash=$1 AND used_at IS NULL RETURNING id', [hash(code)]));
}

async function page(ctx, fresh) {
  const [left, made] = await Promise.all([
    available(),
    db.one('SELECT max(created_at) AS at, count(*)::int AS n FROM recovery_codes'),
  ]);
  const body = html`<h1>🆘 জরুরি রিকভারি কোড</h1>${ui.flash(ctx.flash)}
${fresh ? html`<section class="panel rc-fresh">
  <h2>✍️ এই ৬টা কোড এখনই কাগজে লিখে রাখুন</h2>
  <p>এগুলো <b>শুধু এখন একবার</b> দেখানো হচ্ছে। পেজ বন্ধ করলে আর দেখা যাবে না। প্রতিটা কোড একবারই কাজ করে।</p>
  <ol class="rc-list">${fresh.map((c) => html`<li><code>${c}</code></li>`)}</ol>
  <p class="small">কাগজটা আলমারি বা নিরাপদ জায়গায় রাখুন। ফোনে ছবি তুলে বা কাউকে পাঠিয়ে রাখবেন না।</p>
  <button type="button" class="btn btn-ghost" data-print>🖨️ প্রিন্ট করুন</button>
</section>` : ''}
<section class="panel">
  <h2>এটা কী কাজে লাগে?</h2>
  <p>ফোন হারালে, ক্যামেরা নষ্ট হলে বা পাসওয়ার্ড ভুলে গেলে লগইন পেজের <b>"পাসওয়ার্ড ভুলে গেছেন?"</b> চাপুন। সেখানে এই কাগজের যেকোনো একটা কোড দিলে নতুন পাসওয়ার্ড দিতে পারবেন, আর চাইলে আঙুল/মুখ যাচাইও বন্ধ করতে পারবেন।</p>
  <p>এখন হাতে আছে: ${left ? ui.pill(`${ui.bn(left)}টি কোড বাকি`, 'pill-delivered') : ui.pill('কোনো কোড নেই', 'pill-cancelled')}
    ${made && made.at ? html`<span class="small muted"> · শেষ বানানো: ${fmtDate(made.at)}</span>` : ''}</p>
  <form method="post" action="/admin/security/recovery" data-confirm="${left ? 'নতুন কোড বানালে আগের কাগজের কোডগুলো আর কাজ করবে না। বানাবেন?' : 'নতুন ৬টা কোড বানাবেন?'}">
    <button class="btn btn-lg">${left ? '🔄 নতুন কোড বানান (আগেরগুলো বাতিল হবে)' : '✨ রিকভারি কোড বানান'}</button>
  </form>
  ${left && left <= 2 ? html`<p class="small" style="color:#8A5300">⚠️ কোড প্রায় শেষ। নতুন সেট বানিয়ে নিন।</p>` : ''}
</section>
<script>document.querySelectorAll('[data-print]').forEach(function(b){b.addEventListener('click',function(){window.print()})});</script>`;
  return ctx.page('জরুরি রিকভারি কোড', body, 'recovery');
}

async function makeNew(ctx) {
  const codes = Array.from({ length: 6 }, makeCode);
  await db.tx(async (t) => {
    await t.query('DELETE FROM recovery_codes');
    for (const c of codes) await t.query('INSERT INTO recovery_codes(hash) VALUES($1)', [hash(c)]);
  });
  await ctx.log('recovery_codes', 'security', ctx.user.id, 'নতুন ৬টা জরুরি রিকভারি কোড বানানো হয়েছে (আগেরগুলো বাতিল)');
  return page(ctx, codes);
}

module.exports = {
  available, check, consume, normalize,
  routes: [
    { method: 'GET', path: '/admin/security/recovery', perm: 'owner', handler: (ctx) => page(ctx) },
    { method: 'POST', path: '/admin/security/recovery', perm: 'owner', handler: makeNew },
  ],
};
