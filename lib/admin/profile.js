'use strict';
// Profiles for the owner and every staff member: picture (add / change / remove), job title, address,
// emergency number, joining date and a short note. The owner fills them in at Admin → স্টাফ → (name);
// everyone can keep their own up to date at Admin → আমার প্রোফাইল ও অ্যাকাউন্ট.
// Profile pictures are private — they are only sent to people logged in to the admin.
const { html, fmtDate, str, int, normalizePhone, validPhone } = require('../util');
const db = require('../db');
const ui = require('./ui');
const S = require('../models/staff');

// 2026-03-01 from a date column (Date or text)
function ymd(v) {
  if (!v) return '';
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  const m = String(v).match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : '';
}
// how long someone has been with the shop: "২ বছর ৩ মাস"
function since(v) {
  const d = ymd(v);
  if (!d) return '';
  const [y, m] = d.split('-').map(Number);
  const now = new Date();
  let months = (now.getFullYear() - y) * 12 + (now.getMonth() + 1 - m);
  if (months < 0) return '';
  const yrs = Math.floor(months / 12); months %= 12;
  return ui.bn([yrs ? `${yrs} বছর` : '', months ? `${months} মাস` : '', !yrs && !months ? 'এই মাসে যোগ দিয়েছেন' : ''].filter(Boolean).join(' '));
}

// The round picture (or the first letter of the name when there is no picture)
function avatar(u, cls = '') {
  if (!u) return html`<span class="avatar ${cls}">?</span>`;
  if (u.photo_id) return html`<span class="avatar has-photo ${cls}"><img src="/admin/avatar/${u.id}?v=${u.photo_id}" alt="${u.name}" loading="lazy"></span>`;
  return html`<span class="avatar ${cls}" aria-hidden="true">${String(u.name || '?').trim().slice(0, 1).toUpperCase()}</span>`;
}

// Picture with "ছবি দিন / বদলান", "ক্যামেরায় তুলুন" and "মুছুন" — a new picture is shown first, then saved with its own "সেভ করুন"
function photoBox(u, action) {
  return html`<div class="avatar-box" data-avatar-pick data-action="${action}">
    ${avatar(u, 'avatar-xl')}
    <div class="avatar-box-act">
      <b>প্রোফাইল ছবি</b>
      <span class="row-actions">
        <label class="btn btn-sm ${u.photo_id ? 'btn-ghost' : ''}">🖼️ ${u.photo_id ? 'ছবি বদলান' : 'ছবি দিন'}<input type="file" accept="image/*" hidden data-avatar-file></label>
        <button type="button" class="btn btn-sm btn-ghost" data-avatar-camera>📸 ক্যামেরায় তুলুন</button>
        ${u.photo_id ? html`<button type="button" class="btn btn-sm btn-ghost danger-text" data-avatar-remove>🗑️ ছবি মুছুন</button>` : ''}
      </span>
      <span class="row-actions" data-avatar-confirm hidden>
        <button type="button" class="btn btn-sm" data-avatar-save>💾 সেভ করুন</button>
        <button type="button" class="btn btn-sm btn-ghost" data-avatar-cancel>বাতিল</button>
      </span>
      <small class="small muted" data-avatar-msg>${u.photo_id ? 'নতুন ছবি দিলে আগেরটা বদলে যাবে।' : 'মুখের পরিষ্কার ছবি দিন — মাঝখান থেকে গোল করে কেটে নেওয়া হবে।'}</small>
    </div>
  </div>`;
}

// The profile boxes inside a form. ownerEdit: the owner is filling it in (job title and joining date can be changed).
function fields(u, { ownerEdit }) {
  return html`<div class="field-row">
    ${ownerEdit ? ui.field('পদবি / কাজ', ui.input('designation', u.designation || '', { maxlength: 60, placeholder: 'যেমন: ম্যানেজার, অর্ডার কনফার্ম, প্যাকিং' }))
      : html`<div class="field"><span class="label">পদবি / কাজ</span><p>${u.designation || html`<span class="muted">—</span>`}</p></div>`}
    ${ownerEdit ? ui.field('যোগদানের তারিখ', ui.input('joined_on', ymd(u.joined_on), { type: 'date' }), u.joined_on ? since(u.joined_on) : '')
      : html`<div class="field"><span class="label">যোগদানের তারিখ</span><p>${u.joined_on ? html`${fmtDate(ymd(u.joined_on), false)} <span class="small muted">(${since(u.joined_on)})</span>` : html`<span class="muted">—</span>`}</p></div>`}
  </div>
  ${ui.field('ঠিকানা', ui.textarea('address', u.address || '', { rows: 2, maxlength: 300, placeholder: 'বাসার ঠিকানা' }))}
  ${ui.field('জরুরি যোগাযোগের নম্বর', ui.input('emergency_phone', u.emergency_phone || '', { inputmode: 'tel', maxlength: 20, placeholder: 'পরিবারের কারো নম্বর' }), 'কোনো দরকারে যাকে ফোন করা যাবে (বাবা-মা, ভাই-বোন)।')}
  ${ui.field('নিজের সম্পর্কে', ui.textarea('bio', u.bio || '', { rows: 2, maxlength: 500, placeholder: 'ছোট করে — যেমন কোন কাজে দক্ষ, কোন সময় কাজ করেন' }))}`;
}

// Same phone / email can't be on two accounts (both can be used to log in)
async function contactProblem(id, phone, email) {
  const p = normalizePhone(phone || '');
  const e = String(email || '').trim().toLowerCase();
  if (p) {
    const x = await db.one(`SELECT name FROM staff WHERE id<>$1 AND phone<>'' AND phone=$2`, [id || 0, p]);
    if (x) return `এই মোবাইল নম্বর আরেকজনের (${x.name}) অ্যাকাউন্টে আছে।`;
  }
  if (e) {
    const x = await db.one(`SELECT name FROM staff WHERE id<>$1 AND email<>'' AND lower(email)=$2`, [id || 0, e]);
    if (x) return `এই ইমেইল আরেকজনের (${x.name}) অ্যাকাউন্টে আছে।`;
  }
  return null;
}

// GET /admin/avatar/<staff id> — the picture, only for people logged in to the admin
async function servePhoto(ctx, m) {
  const p = await S.photoOf(int(m[1]), ctx.query.get('full') !== '1');
  if (!p) { ctx.res.writeHead(404, { 'Content-Type': 'text/plain' }); return ctx.res.end('Not found'); }
  const type = /^image\/(jpeg|png|webp|gif)$/.test(p.mime) ? p.mime : 'application/octet-stream';
  ctx.res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'private, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox" });
  return ctx.res.end(p.data);
}

function answer(ctx, ok, back, msg) {
  if (String(ctx.req.headers.accept || '').includes('application/json')) return ctx.json(ctx.res, ok ? 200 : 400, ok ? { ok: true } : { error: msg });
  return ok ? ctx.back(back, 'saved') : ctx.fail(back, msg);
}
async function changePhoto(ctx, id, back) {
  const b = await ctx.body();
  const want = int(b.photo_id) || null;
  if (want) {
    const m = await db.one(`SELECT id FROM media WHERE id=$1 AND (owner_type IS NULL OR (owner_type='staff' AND owner_id=$2))`, [want, id]);
    if (!m) return answer(ctx, false, back, 'ছবিটা পাওয়া যায়নি, আবার আপলোড করুন।');
  }
  await S.setPhoto(id, want || '');
  const who = id === ctx.user.id ? 'নিজের' : `${(await S.getStaff(id) || {}).name || ''}-এর`;
  await ctx.log('staff_photo', 'staff', id, `${who} প্রোফাইল ছবি ${want ? 'বদল' : 'মুছে ফেলা'}`);
  return answer(ctx, true, back);
}
// the owner changes anyone's picture
async function staffPhoto(ctx, m) {
  const id = int(m[1]);
  if (!(await S.getStaff(id))) return answer(ctx, false, '/admin/staff', 'স্টাফ পাওয়া যায়নি।');
  return changePhoto(ctx, id, `/admin/staff/${id}`);
}
// everyone changes their own picture
async function myPhoto(ctx) { return changePhoto(ctx, ctx.user.id, '/admin/account'); }

// POST /admin/account/profile — my own details (the owner can change everything; staff: contact details only)
async function saveMine(ctx) {
  const u = ctx.user;
  const b = await ctx.body();
  const owner = u.role === 'owner';
  const phone = normalizePhone(b.phone || '') || '';
  const email = str(b.email, 120).toLowerCase();
  if (phone && !validPhone(phone)) return ctx.fail('/admin/account', 'মোবাইল নম্বর ঠিক নেই (০১ দিয়ে শুরু, ১১ অঙ্ক)।');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return ctx.fail('/admin/account', 'ইমেইল ঠিক নেই।');
  const clash = await contactProblem(u.id, phone, email);
  if (clash) return ctx.fail('/admin/account', clash);
  const name = owner ? str(b.name, 80) : u.name;
  if (!name) return ctx.fail('/admin/account', 'নাম লিখুন।');
  await db.q('UPDATE staff SET name=$1, phone=$2, email=$3 WHERE id=$4', [name, phone, email, u.id]);
  const data = { address: b.address, emergency_phone: b.emergency_phone, bio: b.bio, designation: owner ? b.designation : u.designation, joined_on: owner ? b.joined_on : ymd(u.joined_on) };
  await S.saveProfile(u.id, data);
  await ctx.log('profile', 'staff', u.id, 'নিজের প্রোফাইল আপডেট');
  return ctx.redirect(ctx.res, '/admin/account?msg=profile#profile');
}

// The "আমার প্রোফাইল" panel on the account page
function myPanel(u) {
  const owner = u.role === 'owner';
  return html`<section class="panel profile-panel" id="profile">
  <h2>👤 আমার প্রোফাইল</h2>
  ${photoBox(u, '/admin/account/photo')}
  <form method="post" action="/admin/account/profile" class="form">
    <div class="field-row">
      ${owner ? ui.field('নাম', ui.input('name', u.name || '', { required: true, maxlength: 80 })) : html`<div class="field"><span class="label">নাম</span><p><b translate="no">${u.name}</b> <span class="small muted">(নাম বদলাতে মালিককে বলুন)</span></p></div>`}
      <div class="field"><span class="label">ইউজারনেম</span><p class="mono" translate="no">${u.username}</p></div>
    </div>
    <div class="field-row">${ui.field('মোবাইল (এটা দিয়েও লগইন করা যায়)', ui.input('phone', u.phone || '', { inputmode: 'tel', maxlength: 20 }))}${ui.field('ইমেইল', ui.input('email', u.email || '', { type: 'email', maxlength: 120 }))}</div>
    ${fields(u, { ownerEdit: owner })}
    <button class="btn">প্রোফাইল সেভ করুন</button>
  </form>
</section>`;
}

module.exports = {
  avatar, photoBox, fields, contactProblem, myPanel, ymd, since,
  routes: [
    { method: 'GET', path: /^\/admin\/avatar\/(\d+)$/, handler: servePhoto },
    { method: 'POST', path: '/admin/account/photo', handler: myPhoto },
    { method: 'POST', path: '/admin/account/profile', handler: saveMine },
    { method: 'POST', path: /^\/admin\/staff\/(\d+)\/photo$/, perm: 'owner', handler: staffPhoto },
  ],
};
