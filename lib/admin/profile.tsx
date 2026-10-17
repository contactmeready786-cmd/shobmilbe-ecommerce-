// Profiles for the owner and every staff member: picture (add / change / remove), job title, address,
// emergency number, joining date and a short note. The owner fills them in at Admin → স্টাফ → (name);
// everyone can keep their own up to date at Admin → আমার প্রোফাইল ও অ্যাকাউন্ট.
// Profile pictures are private — they are only sent to people logged in to the admin.

// 2026-03-01 from a date column (Date or text)
import { toHtml, Val, attrValue } from '../react/html';
import { html, fmtDate, str, int, normalizePhone, validPhone } from '../util';
import * as db from '../db';
import * as ui from './ui';
import * as S from '../models/staff';
import type { AdminCtx, Body, Id, Loose } from '../types';
function ymd(v?: Loose) {
  if (!v) return '';
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  const m = String(v).match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : '';
}
// how long someone has been with the shop: "২ বছর ৩ মাস"
function since(v?: Loose) {
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
function avatar(u?: Loose, cls: Loose = '') {
  if (!u) return toHtml(<span className={`avatar ${attrValue(cls)}`}>?</span>);
  if (u.photo_id) return toHtml(<span className={`avatar has-photo ${attrValue(cls)}`}><img src={`/admin/avatar/${attrValue(u.id)}?v=${attrValue(u.photo_id)}`} alt={attrValue(u.name)} loading="lazy" /></span>);
  return toHtml(<span className={`avatar ${attrValue(cls)}`} {...({ "aria-hidden": "true" } as Record<string, string>)}><Val v={String(u.name || '?').trim().slice(0, 1).toUpperCase()} /></span>);
}

// Picture with "ছবি দিন / বদলান", "ক্যামেরায় তুলুন" and "মুছুন" — a new picture is shown first, then saved with its own "সেভ করুন"
function photoBox(u?: Loose, action?: Loose) {
  return toHtml(<div className="avatar-box" data-avatar-pick="" data-action={attrValue(action)}><Val v={avatar(u, 'avatar-xl')} /><div className="avatar-box-act"><b>প্রোফাইল ছবি</b>{' '}<span className="row-actions">{' '}<label className={`btn btn-sm ${attrValue(u.photo_id ? 'btn-ghost' : '')}`}>🖼️{' '}{(u.photo_id ? "ছবি বদলান" : "ছবি দিন")}<input type="file" accept="image/*" hidden data-avatar-file="" /></label>{' '}<button type="button" className="btn btn-sm btn-ghost" data-avatar-camera="">📸 ক্যামেরায় তুলুন</button>{' '}{(u.photo_id ? <button type="button" className="btn btn-sm btn-ghost danger-text" data-avatar-remove="">🗑️ ছবি মুছুন</button> : null)}{' '}</span>{' '}<span className="row-actions" data-avatar-confirm="" hidden>{' '}<button type="button" className="btn btn-sm" data-avatar-save="">💾 সেভ করুন</button>{' '}<button type="button" className="btn btn-sm btn-ghost" data-avatar-cancel="">বাতিল</button>{' '}</span>{' '}<small className="small muted" data-avatar-msg="">{(u.photo_id ? "নতুন ছবি দিলে আগেরটা বদলে যাবে।" : "মুখের পরিষ্কার ছবি দিন — মাঝখান থেকে গোল করে কেটে নেওয়া হবে।")}</small></div></div>);
}

// The profile boxes inside a form. ownerEdit: the owner is filling it in (job title and joining date can be changed).
function fields(u: Loose, { ownerEdit }: Body) {
  return toHtml(<><div className="field-row">{(ownerEdit ? <Val v={ui.field('পদবি / কাজ', ui.input('designation', u.designation || '', { maxlength: 60, placeholder: 'যেমন: ম্যানেজার, অর্ডার কনফার্ম, প্যাকিং' }))} /> : <div className="field"><span className="label">পদবি / কাজ</span><p><Val v={u.designation || toHtml(<span className="muted">—</span>)} /></p></div>)}{' '}{(ownerEdit ? <Val v={ui.field('যোগদানের তারিখ', ui.input('joined_on', ymd(u.joined_on), { type: 'date' }), u.joined_on ? since(u.joined_on) : '')} /> : <div className="field"><span className="label">যোগদানের তারিখ</span><p>{(u.joined_on ? <><Val v={fmtDate(ymd(u.joined_on), false)} />{' '}<span className="small muted">(<Val v={since(u.joined_on)} />)</span></> : <span className="muted">—</span>)}</p></div>)}</div><Val v={ui.field('ঠিকানা', ui.textarea('address', u.address || '', { rows: 2, maxlength: 300, placeholder: 'বাসার ঠিকানা' }))} />{' '}<Val v={ui.field('জরুরি যোগাযোগের নম্বর', ui.input('emergency_phone', u.emergency_phone || '', { inputmode: 'tel', maxlength: 20, placeholder: 'পরিবারের কারো নম্বর' }), 'কোনো দরকারে যাকে ফোন করা যাবে (বাবা-মা, ভাই-বোন)।')} />{' '}<Val v={ui.field('নিজের সম্পর্কে', ui.textarea('bio', u.bio || '', { rows: 2, maxlength: 500, placeholder: 'ছোট করে — যেমন কোন কাজে দক্ষ, কোন সময় কাজ করেন' }))} /></>);
}

// Same phone / email can't be on two accounts (both can be used to log in)
async function contactProblem(id?: Id, phone?: Loose, email?: Loose) {
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
async function servePhoto(ctx: AdminCtx, m?: Loose) {
  const p = await S.photoOf(int(m[1]), ctx.query.get('full') !== '1');
  if (!p) { ctx.res.writeHead(404, { 'Content-Type': 'text/plain' }); return ctx.res.end('Not found'); }
  const type = /^image\/(jpeg|png|webp|gif)$/.test(p.mime) ? p.mime : 'application/octet-stream';
  ctx.res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'private, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox" });
  return ctx.res.end(p.data);
}

function answer(ctx: AdminCtx, ok?: Loose, back?: Loose, msg?: Loose) {
  if (String(ctx.req.headers.accept || '').includes('application/json')) return ctx.json(ctx.res, ok ? 200 : 400, ok ? { ok: true } : { error: msg });
  return ok ? ctx.back(back, 'saved') : ctx.fail(back, msg);
}
async function changePhoto(ctx: AdminCtx, id?: Id, back?: Loose) {
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
async function staffPhoto(ctx: AdminCtx, m?: Loose) {
  const id = int(m[1]);
  if (!(await S.getStaff(id))) return answer(ctx, false, '/admin/staff', 'স্টাফ পাওয়া যায়নি।');
  return changePhoto(ctx, id, `/admin/staff/${id}`);
}
// everyone changes their own picture
async function myPhoto(ctx: AdminCtx) { return changePhoto(ctx, ctx.user.id, '/admin/account'); }

// POST /admin/account/profile — my own details (the owner can change everything; staff: contact details only)
async function saveMine(ctx: AdminCtx) {
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
function myPanel(u?: Loose) {
  const owner = u.role === 'owner';
  return toHtml(<section className="panel profile-panel" id="profile"><h2>👤 আমার প্রোফাইল</h2><Val v={photoBox(u, '/admin/account/photo')} /><form method="post" action="/admin/account/profile" className="form"><div className="field-row">{(owner ? <Val v={ui.field('নাম', ui.input('name', u.name || '', { required: true, maxlength: 80 }))} /> : <div className="field"><span className="label">নাম</span><p><b {...({ "translate": "no" } as Record<string, string>)}><Val v={u.name} /></b>{' '}<span className="small muted">(নাম বদলাতে মালিককে বলুন)</span></p></div>)}<div className="field"><span className="label">ইউজারনেম</span><p className="mono" {...({ "translate": "no" } as Record<string, string>)}><Val v={u.username} /></p></div></div><div className="field-row"><Val v={ui.field('মোবাইল (এটা দিয়েও লগইন করা যায়)', ui.input('phone', u.phone || '', { inputmode: 'tel', maxlength: 20 }))} /><Val v={ui.field('ইমেইল', ui.input('email', u.email || '', { type: 'email', maxlength: 120 }))} /></div><Val v={fields(u, { ownerEdit: owner })} />{' '}<button className="btn">প্রোফাইল সেভ করুন</button></form></section>);
}

export const routes = [
    { method: 'GET', path: /^\/admin\/avatar\/(\d+)$/, handler: servePhoto },
    { method: 'POST', path: '/admin/account/photo', handler: myPhoto },
    { method: 'POST', path: '/admin/account/profile', handler: saveMine },
    { method: 'POST', path: /^\/admin\/staff\/(\d+)\/photo$/, perm: 'owner', handler: staffPhoto },
  ];
export { avatar, photoBox, fields, contactProblem, myPanel, ymd, since };
