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
  const repo = 'https://github.com/contactmeready786-cmd/shobmilbe-ecommerce-';
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
    <h2>🌙 প্রতিরাতে নিজে থেকে ব্যাকআপ (ছবিসহ)</h2>
    ${lastAuto ? html`<p class="flash">✅ চালু আছে — শেষটা ${fmtDate(lastAuto.created_at)}।</p>` : html`<p class="flash flash-error">এখনো চালু হয়নি — নিচের ধাপগুলো একবার করুন (৫ মিনিট)।</p>`}
    <ol class="small steps">
      <li>Vercel → আপনার প্রজেক্ট → <b>Settings → Environment Variables</b> থেকে <b>DATABASE_URL</b>-এর মান কপি করুন।</li>
      <li>GitHub-এ <a href="${repo}/settings/secrets/actions/new" target="_blank" rel="noopener">রিপো → Settings → Secrets and variables → Actions → New repository secret</a>:
        <br>নাম <b>DATABASE_URL</b>, মান = কপি করা লেখা → Add secret।</li>
      <li>আরেকটা secret: নাম <b>BACKUP_PASSWORD</b>, মান = লম্বা একটা পাসওয়ার্ড (কমপক্ষে ১২ অক্ষর)। <b>এটা কাগজে লিখে রাখুন</b> — ব্যাকআপ খুলতে লাগবে।</li>
      <li><a href="${repo}/actions/workflows/backup.yml" target="_blank" rel="noopener">Actions → backup</a> → <b>Run workflow</b> চাপুন। ২-৩ মিনিট পর এখানে "নিজে থেকে" লেখা ব্যাকআপ দেখাবে।</li>
    </ol>
    <p class="small muted">এরপর প্রতিরাত ৩টায় (ঢাকা) ব্যাকআপ হবে, ৩০ দিন পর্যন্ত রাখা থাকে: Actions → backup → যেকোনো দিন → নিচে <b>Artifacts</b> থেকে নামানো যায়। ফাইল সবসময় পাসওয়ার্ডে তালাবদ্ধ, তাই GitHub-এ থাকলেও কেউ পড়তে পারবে না।</p>
    <p class="small muted">এছাড়া Neon নিজেও ডাটাবেসের সাম্প্রতিক অবস্থা কিছুদিন রাখে (Neon → Branches → <b>Restore</b> / point-in-time) — ভুল করে কিছু মুছে গেলে সবচেয়ে দ্রুত উপায়।</p>
    <h2 class="mt">↩️ ব্যাকআপ থেকে দোকান ফেরত আনা</h2>
    <ol class="small steps">
      <li><b>আগে নিরাপদ জায়গায় চেষ্টা:</b> Neon → Branches → <b>Create branch</b> (নতুন খালি ব্রাঞ্চ)। তার connection string কপি করুন।</li>
      <li>কম্পিউটারে এই রিপো নামিয়ে টার্মিনালে:<br><code>DATABASE_URL="নতুন-ব্রাঞ্চের-ঠিকানা" node tools/restore.js ব্যাকআপ-ফাইল --password=আপনার-পাসওয়ার্ড --yes</code></li>
      <li>সব ঠিক থাকলে Vercel-এর DATABASE_URL নতুন ব্রাঞ্চের ঠিকানায় বদলে Redeploy দিন।</li>
    </ol>
    <p class="small muted">নিজে করতে অসুবিধা হলে আমাকে (Claude) বলুন — ফাইল আর পাসওয়ার্ড দিলে আমি করে দিতে পারব। চলমান দোকানের ডাটাবেসে সরাসরি রিস্টোর করবেন না — এতে পরের সব অর্ডার মুছে যাবে।</p>
  </section>
</div>`;
  return ctx.page('ব্যাকআপ ও রিস্টোর', body, 'backup');
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
  ],
};
