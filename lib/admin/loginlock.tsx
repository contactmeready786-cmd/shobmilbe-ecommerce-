// Admin → নিরাপত্তা → লগইন তালা (owner only):
// passkeys (fingerprint / Windows Hello / phone QR), and whether the lock is on. (The camera face check was removed.)
// Also builds the "second check" page shown after the owner's password (see admin/index.js → /admin/verify).
import { Val, attrValue, attrProps, jsxList } from '../react/html';
import { raw, sign, unsign, parseCookies, fmtDate, int } from '../util';
import * as db from '../db';
import * as ui from './ui';
import * as lock from '../models/loginlock';
import * as security from '../security';
import { ASSET_V } from './layout';
import * as $recovery from './recovery';
import type { AdminCtx, Body, Loose, ShopRequest } from '../types';

const BASE = '/admin/security/login';

// ---------------------------------------------------------------- challenge cookie for this page
function chCookie(ctx: AdminCtx, value?: Loose) {
  const secure = String(ctx.req.headers['x-forwarded-proto'] || '').includes('https') ? '; Secure' : '';
  return `sm_ch2=${encodeURIComponent(sign(value, ctx.settings.session_secret))}; Path=/admin; HttpOnly; SameSite=Strict; Max-Age=300${secure}`;
}
function chValue(ctx: AdminCtx) { return unsign(parseCookies(ctx.req.headers.cookie).sm_ch2, ctx.settings.session_secret); }

// ---------------------------------------------------------------- the second-check page (after the password)
function verifyPage({ settings, need, mode, mobile, hasPasskey, otherHosts = [], error, blocked }: Body) {
  return <><div className="auth-card panel ll-verify" data-ll-verify="" data-need={attrValue(need || '')} data-mode={attrValue(mode || '')} data-mobile={mobile ? '1' : ''} data-has-passkey={hasPasskey ? '1' : ''}><p className="logo auth-logo"><Val v={settings.store_name} /><small>{' '}Admin</small></p><h1>🔐 মালিকের দ্বিতীয় যাচাই</h1>{(blocked ? <><p className="form-error"><Val v={error} /></p><p className="center"><a className="btn btn-block" href="/admin/login">আবার লগইন করুন</a></p></> : <><p className="muted">পাসওয়ার্ড ঠিক আছে ✅ এবার আঙুলের ছাপ দিয়ে নিজেকে যাচাই করুন।</p>{(error ? <p className="form-error"><Val v={error} /></p> : null)}<section className="ll-part" data-ll-pk="" hidden><h2>👆 আঙুলের ছাপ / পাসকি</h2>{(hasPasskey ? <><p className="small">{(mobile ? "নিচের বোতাম চাপুন, তারপর ফোনের আঙুলের ছাপ (বা ফোনের স্ক্রিন লক) দিন।" : "নিচের বোতাম চাপুন। ল্যাপটপে Windows Hello (মুখ/আঙুল/PIN) চাইবে। ল্যাপটপে না থাকলে \"অন্য ডিভাইস / ফোন\" বেছে নিন, স্ক্রিনের QR কোড ফোন দিয়ে স্ক্যান করে ফোনে আঙুল ছোঁয়ান।")}</p><button type="button" className="btn btn-block btn-lg" data-ll-pk-go="">👆 আঙুলের ছাপ দিয়ে যাচাই করুন</button></> : <><p className="form-error">এই ঠিকানায় কোনো পাসকি (আঙুলের ছাপ) সেভ করা নেই।</p>{(otherHosts.length ? <p className="small">আপনার পাসকি আছে এই ঠিকানায়:{' '}<b><Val v={otherHosts.join(', ')} /></b>। সেখানে লগইন করে "লগইন তালা" পেজ থেকে একটা{' '}<b>অনুমতি কোড</b>{' '}বানান, তারপর নিচে দিন।</p> : null)}</>)}</section><p className="form-error" data-ll-msg="" hidden></p><details className="ll-more"><summary>অন্য ঠিকানা থেকে পাওয়া অনুমতি কোড আছে?</summary><form method="post" action="/admin/verify/code" className="form">{ui.field('৮ সংখ্যার অনুমতি কোড', ui.input('code', '', { inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: 12, required: true }))}{' '}<button className="btn btn-ghost btn-block">কোড দিয়ে ঢুকুন</button></form></details><form method="post" action="/admin/verify/cancel" className="center"><button className="link-btn">বাতিল করে লগইন পেজে ফিরুন</button></form><p className="center small"><a href="/admin/reset">ফোন হারিয়েছেন / আঙুলের ছাপ কাজ করছে না?</a></p></>)}</div><script src={`/js/loginlock.js?v=${attrValue(ASSET_V)}`} defer /></>;
}

// ---------------------------------------------------------------- settings page
function deviceGuess(req: ShopRequest) {
  const ua = String(req.headers['user-agent'] || '');
  if (/iPhone/i.test(ua)) return 'iPhone';
  if (/iPad/i.test(ua)) return 'iPad';
  if (/Android/i.test(ua)) return /Mobile/i.test(ua) ? 'Android ফোন' : 'Android ট্যাব';
  if (/Windows/i.test(ua)) return 'Windows কম্পিউটার';
  if (/Macintosh/i.test(ua)) return 'Mac কম্পিউটার';
  return 'আমার ডিভাইস';
}

async function page(ctx: AdminCtx, extra: Loose = {}) {
  const u = ctx.user;
  const m = lock.mode(ctx.settings);
  const host = lock.rpId(ctx.req);
  const keys = await lock.passkeys(u.id);
  const keysHere = keys.filter((k) => k.rp_id === host);
  const ready: Record<string, Loose> = {};
  for (const x of lock.MODES) ready[x] = x === 'off' ? null : await lock.readyFor(x, u.id, ctx.req);
  const hasReset = String(process.env.ADMIN_RESET_CODE || '').trim().length >= 12 || (await $recovery.available()) > 0;

  const modeCard = (x?: Loose, title?: Loose, lines?: Loose, rec?: Loose) => <label className={`ll-mode ${m === x ? 'is-on' : ''} ${ready[x] ? 'is-off' : ''}`}>{' '}<input type="radio" name="mode" defaultValue={attrValue(x)} defaultChecked={!!(m === x)} disabled={!!(ready[x] && m !== x)} />{' '}<span><b><Val v={title} /></b>{(rec ? <>{' '}<span className="pill pill-green"><Val v={rec} /></span></> : null)}{' '}<span className="small muted"><Val v={lines} /></span>{' '}{(ready[x] ? <span className="small ll-need">⚠️{' '}<Val v={ready[x]} /></span> : null)}</span></label>;

  const body = <><h1>🔐 লগইন তালা (আঙুলের ছাপ)</h1>{ui.flash(ctx.flash)}{(extra.flash ? ui.flash(extra.flash) : null)}<p className="muted">শুধু{' '}<b>মালিকের</b>{' '}লগইনে কাজ করে। পাসওয়ার্ড দেওয়ার পরেও আঙুলের ছাপ (পাসকি) না মিললে কেউ ঢুকতে পারবে না। স্টাফদের লগইন আগের মতোই থাকবে।</p>{(extra.code ? <section className="panel ll-codebox"><h2>🔑 এক-বারের অনুমতি কোড</h2><p className="ll-code"><Val v={extra.code} /></p><p className="small">১৫ মিনিট কাজ করবে, একবারই। নতুন ঠিকানায় পাসওয়ার্ড দেওয়ার পর যাচাই পেজে "অনুমতি কোড আছে?" খুলে এই কোড দিন, তারপর সেখানে নতুন করে পাসকি যোগ করুন। কাউকে দেবেন না।</p></section> : null)}<section className="panel"><h2>এখন চালু:{' '}{(m === 'off' ? ui.pill('বন্ধ', 'pill-grey') : ui.pill(lock.MODE_NAMES[m], 'pill-green'))}</h2><p className="small muted">দুই ধাপ: আগে পাসকি যোগ করুন, তারপর তালা চালু করুন।</p></section><section className="panel" id="passkeys"><h2>ধাপ ১ · 👆 পাসকি (আঙুলের ছাপ / Windows Hello / ফোন দিয়ে QR)</h2><p className="small">যে ফোন বা ল্যাপটপ দিয়ে লগইন করবেন,{' '}<b>সেই ডিভাইস থেকে এই পেজ খুলে</b>{' '}নিচের বোতাম চাপুন। ফোনে আঙুলের ছাপ চাইবে, ল্যাপটপে Windows Hello। ল্যাপটপে কিছু না থাকলে "অন্য ডিভাইস / ফোন" বেছে নিয়ে QR কোড ফোন দিয়ে স্ক্যান করুন।</p>{(keys.length ? <div className="ll-table"><table className="table"><thead><tr><th>ডিভাইস</th><th>ঠিকানা</th><th>যোগ হয়েছে</th><th>শেষ ব্যবহার</th><th></th></tr></thead><tbody>{jsxList(keys.map((k) => <tr><td><b><Val v={k.name} /></b></td><td className="small"><Val v={k.rp_id} />{(k.rp_id !== host ? <>{' '}{ui.pill('অন্য ঠিকানা', 'pill-amber')}</> : null)}</td><td className="small">{fmtDate(k.created_at)}</td><td className="small">{(k.last_used ? fmtDate(k.last_used) : "এখনো না")}</td><td><form method="post" action={`${attrValue(BASE)}/passkey/${attrValue(k.id)}/delete`} data-confirm="এই ডিভাইসের পাসকি মুছে ফেলবেন? হারানো বা বিক্রি করা ফোন হলে অবশ্যই মুছুন।"><button className="btn btn-sm btn-danger">🗑️ মুছুন</button></form></td></tr>))}</tbody></table></div> : <p className="muted">এখনো কোনো পাসকি যোগ করা হয়নি।</p>)}<div className="ll-add" data-ll-pk-add="">{ui.field('এই ডিভাইসের নাম', ui.input('pk_name', deviceGuess(ctx.req), { maxlength: 60 }), 'যেমন: আমার Samsung ফোন, অফিসের ল্যাপটপ')}{' '}<button type="button" className="btn" data-ll-pk-register="">➕ এই ডিভাইসে পাসকি যোগ করুন</button><p className="small muted" data-ll-pk-note="" hidden></p></div><p className="small muted">পাসকি শুধু এই ঠিকানায় কাজ করে:{' '}<b><Val v={host} /></b>। পরে নতুন ডোমেইনে (যেমন shobmilbe.com) গেলে নিচের "অনুমতি কোড" দিয়ে সেখানে আবার যোগ করতে হবে।</p></section><section className="panel" id="mode"><h2>ধাপ ২ · তালা চালু / বন্ধ</h2><form method="post" action={`${attrValue(BASE)}/mode`} className="form ll-modes">{modeCard('off', '⛔ বন্ধ — শুধু পাসওয়ার্ড', 'আগের মতো, শুধু ইউজারনেম আর পাসওয়ার্ড।')}{' '}{modeCard('passkey', '১ · শুধু পাসকি', 'মোবাইলে আঙুলের ছাপ। ল্যাপটপে Windows Hello, অথবা ফোন দিয়ে QR স্ক্যান করে ফোনে আঙুল। সবচেয়ে নিরাপদ আর সহজ।', 'সবচেয়ে নিরাপদ')}{' '}<button className="btn btn-lg">💾 সেভ করুন</button></form></section><div className="two-col"><section className="panel"><h2>🔑 নতুন ঠিকানার জন্য অনুমতি কোড</h2><p className="small">সাইট নতুন ডোমেইনে নিলে সেখানে পুরোনো পাসকি কাজ করবে না। এখান থেকে কোড বানিয়ে নতুন ঠিকানার যাচাই পেজে একবার দিন, তারপর সেখানে নতুন পাসকি যোগ করুন।</p><form method="post" action={`${attrValue(BASE)}/code`}><button className="btn btn-ghost">কোড বানান</button></form></section><section className="panel"><h2>🆘 ফোন হারালে</h2><p className="small">লগইন পেজের{' '}<b>"পাসওয়ার্ড ভুলে গেছেন?"</b>{' '}থেকে কাগজে লেখা রিকভারি কোড দিয়ে নতুন পাসওয়ার্ড দিন, আর{' '}<b>"আঙুলের ছাপের তালা বন্ধ করে দিন"</b>{' '}টিক দিন। পরে ঢুকে হারানো ফোনের পাসকি মুছে দিন।</p><p className="small">{(hasReset ? <>✅ জরুরি রিকভারি কোড বানানো আছে।</> : <>⚠️ জরুরি রিকভারি কোড এখনো বানানো হয়নি। লগইন তালা চালুর আগে{' '}<a href="/admin/security/recovery">এখান থেকে বানিয়ে</a>{' '}কাগজে লিখে রাখুন, নইলে ফোন হারালে নিজেই আটকে যেতে পারেন।</>)}</p></section></div><script src={`/js/loginlock.js?v=${attrValue(ASSET_V)}`} defer /></>;
  return ctx.page('লগইন তালা', body, 'loginlock');
}

// ---------------------------------------------------------------- handlers
async function saveMode(ctx: AdminCtx) {
  const b = await ctx.body();
  const m = lock.MODES.includes(b.mode) ? b.mode : 'off';
  const why = m === 'off' ? null : await lock.readyFor(m, ctx.user.id, ctx.req);
  if (why) return ctx.fail(BASE, why);
  const before = lock.mode(ctx.settings);
  await db.setSetting('login_lock_mode', m);
  await ctx.log('settings', 'security', ctx.user.id, `লগইন তালা: ${lock.MODE_NAMES[before]} → ${lock.MODE_NAMES[m]}`);
  // the owner set this up just now, so this login counts as verified (otherwise they'd be thrown out)
  await ctx.markVerified();
  return ctx.reply.answer(303, { Location: BASE + '?msg=saved#mode', 'Cache-Control': 'no-store' });
}

async function pkOptions(ctx: AdminCtx) {
  const ch = lock.newChallenge('create', ctx.user.id);
  const existing = await lock.passkeysFor(ctx.user.id, lock.rpId(ctx.req));
  return ctx.json(200, lock.registrationOptions(ctx.req, ctx.user, ctx.settings, ch.challenge, existing), { 'Set-Cookie': chCookie(ctx, ch.value) });
}
async function pkAdd(ctx: AdminCtx) {
  const c = lock.readChallenge(chValue(ctx), 'create', ctx.user.id);
  if (!c) return ctx.json(400, { error: 'সময় শেষ, আবার চাপুন।' });
  if (!(await lock.useOnce(db, c.challenge))) return ctx.json(400, { error: 'আবার চাপুন।' });
  const b = await ctx.body();
  try {
    const r = await lock.addPasskey(ctx.req, ctx.user, c.challenge, b);
    await ctx.log('passkey_add', 'security', ctx.user.id, `পাসকি যোগ: ${r.name} (${r.rp})`);
    return ctx.json(200, { ok: true });
  } catch (e: Loose) {
    if (/duplicate key/.test(e.message)) return ctx.json(400, { error: 'এই পাসকি আগেই যোগ করা আছে।' });
    return ctx.json(400, { error: 'যোগ করা যায়নি: ' + e.message });
  }
}
async function pkDelete(ctx: AdminCtx, m?: Loose) {
  const id = int(m[1]);
  const k = await db.one('SELECT id, name, rp_id FROM owner_passkeys WHERE id=$1 AND staff_id=$2', [id, ctx.user.id]);
  if (!k) return ctx.back(BASE);
  const mode = lock.mode(ctx.settings);
  if (['passkey', 'both'].includes(mode as string) && k.rp_id === lock.rpId(ctx.req)) {
    const here = await lock.passkeysFor(ctx.user.id, k.rp_id);
    if (here.length <= 1) return ctx.fail(BASE, 'এটাই এই ঠিকানার শেষ পাসকি। আগে অন্য ডিভাইসে পাসকি যোগ করুন, অথবা লগইন তালা বন্ধ করুন।');
  }
  await db.q('DELETE FROM owner_passkeys WHERE id=$1 AND staff_id=$2', [id, ctx.user.id]);
  await ctx.log('passkey_delete', 'security', ctx.user.id, `পাসকি মোছা: ${k.name} (${k.rp_id})`);
  return ctx.back(BASE, 'saved');
}

async function makeCode(ctx: AdminCtx) {
  if (!(await security.hit(db, 'llcode:' + ctx.user.id, 10, 3600))) return ctx.fail(BASE, 'অনেকবার কোড বানানো হয়েছে, একটু পরে চেষ্টা করুন।');
  const code = await lock.makeCode(ctx.user.id);
  await ctx.log('login_code', 'security', ctx.user.id, 'নতুন ঠিকানার জন্য এক-বারের অনুমতি কোড তৈরি');
  return page(ctx, { code: code.replace(/(\d{4})(\d{4})/, '$1 $2') });
}

ui.MESSAGES.bridged = 'অনুমতি কোড দিয়ে ঢুকেছেন। এখন এই ঠিকানার জন্য নিচে নতুন পাসকি যোগ করুন।';

export const routes = [
    { method: 'GET', path: BASE, perm: 'owner', handler: (ctx: AdminCtx) => page(ctx) },
    { method: 'POST', path: BASE + '/mode', perm: 'owner', handler: saveMode },
    { method: 'POST', path: BASE + '/passkey/options', perm: 'owner', handler: pkOptions },
    { method: 'POST', path: BASE + '/passkey/add', perm: 'owner', handler: pkAdd },
    { method: 'POST', path: /^\/admin\/security\/login\/passkey\/(\d+)\/delete$/, perm: 'owner', handler: pkDelete },
    { method: 'POST', path: BASE + '/code', perm: 'owner', handler: makeCode },
  ];
export { verifyPage };
