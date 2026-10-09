'use strict';
// Admin → ব্যাকআপ ও রিস্টোর (owner only): download a backup now, see every backup made (by hand and the nightly
// automatic one), and the step-by-step way to get the shop back from a backup.
const { html, bn, fmtDate, str } = require('../util');
const db = require('../db');
const ui = require('./ui');
const security = require('../security');
const backup = require('../services/backup');

const MAX_BYTES = 4 * 1024 * 1024; // Vercel can send at most ~4.5 MB in one reply

async function page(ctx) {
  const rows = await db.q(`SELECT b.*, s.name AS staff_name FROM backups b LEFT JOIN staff s ON s.id=b.staff_id ORDER BY b.created_at DESC LIMIT 40`);
  const lastAuto = rows.find((r) => r.kind === 'auto' && r.ok);
  const lastAny = rows.find((r) => r.ok);
  const age = lastAny ? (Date.now() - new Date(lastAny.created_at).getTime()) / 864e5 : null;
  const ik = require('../services/imagekit').configured();
  const auto = require('../services/autobackup');
  const pw = await auto.password();
  const KEEP = auto.KEEP;
  const autos = rows.filter((r) => r.kind === 'auto' && r.ok && r.ik_url);
  const body = html`<h1>💾 ব্যাকআপ ও রিস্টোর</h1>${ui.flash(ctx.flash)}
${age === null ? html`<p class="flash flash-error">⚠️ এখনো একটাও ব্যাকআপ নেই। নিচ থেকে এখনই একটা নামিয়ে রাখুন, আর নিজে থেকে প্রতিদিনের ব্যাকআপ চালু করুন।</p>`
    : age > 8 ? html`<p class="flash flash-error">⚠️ শেষ ব্যাকআপ ${bn(Math.floor(age))} দিন আগে। নিজে থেকে ব্যাকআপ চালু আছে কি না দেখুন।</p>` : ''}
<div class="two-col">
  <section class="panel">
    <h2>এখনই ব্যাকআপ নামান</h2>
    <p class="small muted">পণ্য, ক্যাটাগরি, অর্ডার, কাস্টমার, হিসাব, সেটিংস — সব এক ফাইলে। <b>ছবিগুলো এখানে আসে না</b> (ফাইল অনেক বড় হয়ে যায়) — ছবিসহ পুরো ব্যাকআপ প্রতিরাতে নিজে থেকে হয় (ডানে দেখুন)।</p>
    <form method="post" action="/admin/backup/download" class="form">
      ${ui.field('পাসওয়ার্ড দিয়ে তালা দিন (খুব দরকারি)', ui.input('password', '', { type: 'password', minlength: 8, autocomplete: 'new-password', placeholder: 'কমপক্ষে ৮ অক্ষর' }),
    'ফাইলে কাস্টমারদের নাম, ফোন আর ঠিকানা থাকে। তালা দিলে পাসওয়ার্ড ছাড়া কেউ খুলতে পারবে না। পাসওয়ার্ডটা কোথাও লিখে রাখুন — হারালে ব্যাকআপ আর খোলা যাবে না।')}
      ${ui.check('analytics', false, 'ভিজিটর অ্যানালিটিক্স আর মার্কেট রিসার্চের ডাটাও রাখুন (ফাইল বড় হবে)')}
      <button class="btn">⬇ ব্যাকআপ নামান</button>
    </form>
    <h2 class="mt">যেসব ব্যাকআপ নেওয়া হয়েছে</h2>
    ${rows.length ? html`<div class="table-wrap"><table class="table compact"><thead><tr><th>সময়</th><th>ধরন</th><th class="num">আকার</th><th class="num">সারি</th><th>কে</th></tr></thead>
    <tbody>${rows.map((r) => html`<tr class="${r.ok ? '' : 'row-warn'}"><td class="small">${fmtDate(r.created_at)}</td>
      <td class="small">${r.ok ? '✅' : '❌'} ${r.kind === 'auto' ? 'নিজে থেকে (রাতে)' : 'হাতে নামানো'}${r.with_images ? ' · ছবিসহ' : ''}${r.encrypted ? ' · 🔒' : ''}${r.ok ? '' : html`<br><span class="warn">${r.note}</span>`}</td>
      <td class="num">${r.size_bytes ? `${bn((r.size_bytes / 1048576).toFixed(1))} MB` : '—'}</td><td class="num">${bn(r.rows_count)}</td><td class="small">${r.staff_name || (r.kind === 'auto' ? 'GitHub' : '')}</td></tr>`)}</tbody></table></div>`
    : html`<p class="muted">এখনো কিছু নেই।</p>`}
  </section>
  <section class="panel">
    <h2>🌙 প্রতিদিন নিজে থেকে ব্যাকআপ</h2>
    ${!ik ? html`<p class="flash flash-error">ImageKit চালু না থাকায় নিজে থেকে ব্যাকআপ হচ্ছে না।</p>`
    : lastAuto ? html`<p class="flash">✅ চালু আছে — শেষটা ${fmtDate(lastAuto.created_at)}। প্রতিদিন ভোর ৩টার দিকে (ঢাকা) নতুন একটা হয়, শেষ ${bn(KEEP)}টি রাখা থাকে।</p>`
      : html`<p class="flash">⏳ চালু করা হয়েছে — প্রথমটা কিছুক্ষণের মধ্যে হবে। চাইলে নিচের বাটনে এখনই নিন।</p>`}
    <form method="post" action="/admin/backup/now" class="form"><button class="btn">💾 এখনই একটা ব্যাকআপ নিন</button></form>
    <h3 class="mt">🔑 ব্যাকআপ খোলার পাসওয়ার্ড</h3>
    <p class="small">এই পাসওয়ার্ড ছাড়া ব্যাকআপ ফাইল কেউ খুলতে পারবে না — <b>কাগজে লিখে নিরাপদ জায়গায় রাখুন।</b></p>
    <p><code class="secret-box" data-reveal="${pw.pw}">••••••••••••••••</code> <button type="button" class="btn btn-sm btn-ghost" data-reveal-btn>👁️ দেখুন</button></p>
    <p class="small muted">${pw.from === 'settings' ? 'পাসওয়ার্ডটা ডাটাবেসে রাখা — তাই অবশ্যই লিখে রাখুন।' : 'পাসওয়ার্ডটা Vercel-এর গোপন সেটিং থেকে তৈরি, ডাটাবেস হারালেও বদলাবে না।'}</p>
    ${autos.length ? html`<h3 class="mt">নিজে থেকে নেওয়া ব্যাকআপ</h3>
    <div class="table-wrap"><table class="table compact"><thead><tr><th>সময়</th><th class="num">আকার</th><th></th></tr></thead><tbody>
      ${autos.map((r) => html`<tr><td class="small">${fmtDate(r.created_at)}</td><td class="num">${bn((r.size_bytes / 1048576).toFixed(1))} MB</td>
        <td><a class="btn btn-sm btn-ghost" href="${r.ik_url}" rel="noopener noreferrer" download>⬇ নামান</a></td></tr>`)}
    </tbody></table></div>` : ''}
    <h2 class="mt">↩️ ব্যাকআপ থেকে দোকান ফেরত আনা</h2>
    <p class="small">কোনো বিপদ হলে Claude-কে বলুন — কোন দিনের ব্যাকআপ আর উপরের পাসওয়ার্ড দিলে Claude দোকান ফেরত এনে দেবে। (কারিগরি পদ্ধতি: <code>node tools/restore.js ফাইল --password=… --yes</code>, নতুন একটা খালি ডাটাবেসে।)</p>
  </section>
</div>`;
  return ctx.page('ব্যাকআপ ও রিস্টোর', body, 'backup');
}

async function now(ctx) {
  if (!(await security.hit(db, 'backup-now:' + ctx.user.id, 6, 3600))) return ctx.fail('/admin/backup', 'এক ঘণ্টায় অনেকবার চেষ্টা হয়েছে, একটু পরে আবার চেষ্টা করুন।');
  const r = await require('../services/autobackup').run({ force: true });
  await ctx.log('export', 'security', null, 'নিজে থেকে ব্যাকআপ (হাতে চালানো)');
  if (r.ok) return ctx.back('/admin/backup', 'saved');
  return ctx.fail('/admin/backup', r.skipped === 'busy' ? 'একটা ব্যাকআপ এখন চলছে, এক মিনিট পর দেখুন।' : 'ব্যাকআপ হয়নি: ' + (r.error || r.skipped || ''));
}

async function download(ctx) {
  const b = await ctx.body();
  const pw = String(b.password || '');
  if (pw && pw.length < 8) return ctx.fail('/admin/backup', 'পাসওয়ার্ড কমপক্ষে ৮ অক্ষরের দিন।');
  if (!(await security.hit(db, 'backup:' + ctx.user.id, 10, 3600))) return ctx.fail('/admin/backup', 'এক ঘণ্টায় অনেকবার ব্যাকআপ নেওয়া হয়েছে, একটু পরে চেষ্টা করুন।');
  let r;
  try {
    r = await backup.dump(db, { withImages: false, withAnalytics: !!b.analytics, password: pw });
  } catch (e) {
    await db.q(`INSERT INTO backups(kind, ok, note, staff_id) VALUES('manual', false, $1, $2)`, [str(e.message, 300), ctx.user.id]);
    return ctx.fail('/admin/backup', 'ব্যাকআপ তৈরি করা যায়নি: ' + e.message);
  }
  if (r.buffer.length > MAX_BYTES) {
    await db.q(`INSERT INTO backups(kind, ok, note, staff_id, size_bytes) VALUES('manual', false, $1, $2, $3)`, ['ফাইল অনেক বড়', ctx.user.id, r.buffer.length]);
    return ctx.fail('/admin/backup', b.analytics ? 'ফাইল অনেক বড় হয়ে গেছে — অ্যানালিটিক্সের টিক তুলে আবার চেষ্টা করুন।' : 'ফাইল অনেক বড় — এখান থেকে নামানো যাচ্ছে না। প্রতিরাতের নিজে থেকে ব্যাকআপ চালু করুন (ডানে দেখুন)।');
  }
  await db.q(`INSERT INTO backups(kind, ok, size_bytes, tables, rows_count, with_images, encrypted, staff_id) VALUES('manual', true, $1, $2, $3, false, $4, $5)`,
    [r.buffer.length, r.tables, r.rows, r.encrypted, ctx.user.id]);
  await ctx.log('export', 'security', null, `ব্যাকআপ নামানো (${r.rows} সারি${r.encrypted ? ', তালাবদ্ধ' : ', তালা ছাড়া'})`);
  const name = `shobmilbe-backup-${new Date().toISOString().slice(0, 10)}${r.encrypted ? '.smbk' : '.json.gz'}`;
  ctx.res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="${name}"`, 'Content-Length': r.buffer.length, 'Cache-Control': 'no-store' });
  return ctx.res.end(r.buffer);
}

module.exports = {
  routes: [
    { method: 'GET', path: '/admin/backup', perm: 'owner', handler: page },
    { method: 'POST', path: '/admin/backup/download', perm: 'owner', handler: download },
    { method: 'POST', path: '/admin/backup/now', perm: 'owner', handler: now },
  ],
};
