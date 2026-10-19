// 🔐 মোছার কোড (owner, 2026-10-14): anything that deletes for good — the recycle bin's "স্থায়ীভাবে মুছুন", emptying
// the bin, sending every product to the bin at once, and the test-history "মুছুন" buttons — needs a 6-digit code that
// is e-mailed to the shop's own Gmail. Someone who stole the admin password still can't wipe anything, and the code
// e-mail on the owner's phone is itself the warning that somebody is trying. Restoring from the bin needs no code.
//
// Where the code goes is fixed here in the code, NOT in Admin → সেটিংস: a person inside the admin panel must not be able
// to point the codes to their own mailbox. (Changing it needs a change on GitHub.)
import { emailHtml, DeleteCodeEmail } from '../emails';
import * as crypto from 'node:crypto';
import * as db from '../db';
import * as security from '../security';
import * as notify from './notify';
import { bn } from '../util';
import type { AdminCtx, Caught } from '../types';
import type { DeleteCodesRow } from '../data/rows';

const CODE_EMAIL = (process.env.DELETE_CODE_EMAIL || 'contact.shobmilbe@gmail.com').trim();
const MINUTES = 10;
const MAX_TRIES = 5; // wrong codes for one code, then it is spent
const FAIL_MAX = 10; // wrong codes per staff per hour, then deleting is shut for that hour
const ACTIONS: Record<string, string> = {
  trash_purge: 'রিসাইকেল বিন থেকে স্থায়ীভাবে মোছা',
  trash_empty: 'পুরো রিসাইকেল বিন খালি করা',
  trash_all_products: 'দোকানের সব পণ্য একসাথে মুছে বিনে পাঠানো',
  test_clear: 'টেস্টের ইতিহাস স্থায়ীভাবে মোছা',
  // not a delete, but just as dangerous in the wrong hands: seeing the shop's secret key (owner, 2026-10-17)
  show_key: 'দোকানের গোপন চাবি (ENCRYPTION_KEY) দেখা',
};
// actions that don't delete anything: the e-mail calls the code what it is
const NOT_DELETE = new Set(['show_key']);

// "contact.shobmilbe@gmail.com" → "co••••••be@gmail.com"
function masked(e = CODE_EMAIL) {
  const [u, d] = String(e).split('@');
  if (!u || !d) return '';
  return (u.length <= 4 ? u.slice(0, 1) : u.slice(0, 2)) + '••••••' + (u.length <= 4 ? '' : u.slice(-2)) + '@' + d;
}

function hash(code: string, salt: string) { return salt + '$' + crypto.createHash('sha256').update(salt + ':' + code).digest('hex'); }
function same(code: string, stored: string) {
  const [salt] = String(stored).split('$');
  const a = Buffer.from(hash(String(code), salt));
  const b = Buffer.from(String(stored));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const device = (ctx: AdminCtx) => String((ctx.req && ctx.req.headers && ctx.req.headers['user-agent']) || '').replace(/[\r\n]+/g, ' ').slice(0, 140);
const when = () => new Date().toLocaleString('en-GB', { timeZone: 'Asia/Dhaka' });

// Make a new code for this person and this kind of delete, and e-mail it. Throws with a message the admin can read.
async function send(ctx: AdminCtx, action: string, detail = '') {
  if (!ACTIONS[action]) throw new Error('অজানা কাজ।');
  if (!notify.emailConfig(ctx.settings).ready) {
    throw new Error('কোড পাঠানোর ইমেইল (Gmail) সেটআপ করা নেই, তাই এখন স্থায়ীভাবে মোছা যাবে না। Admin → নোটিফিকেশনে Gmail App Password দিন।');
  }
  const uid = ctx.user.id;
  if (await security.blocked(db, 'delcode-fail:' + uid, FAIL_MAX)) throw new Error('অনেকবার ভুল কোড দেওয়া হয়েছে — এক ঘণ্টা মোছা বন্ধ থাকবে।');
  if (!(await security.hit(db, 'delcode-wait:' + uid, 1, 45))) throw new Error('একটু আগেই কোড পাঠানো হয়েছে। ইমেইল দেখুন, না এলে ৪৫ সেকেন্ড পর আবার চান।');
  if (!(await security.hit(db, 'delcode-send:' + uid, 8, 3600))) throw new Error('এক ঘণ্টায় অনেক কোড চাওয়া হয়েছে — পরে চেষ্টা করুন।');

  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  const salt = crypto.randomBytes(8).toString('hex');
  // an older unused code for the same thing stops working: only the newest one counts
  await db.q('UPDATE delete_codes SET used_at=now() WHERE staff_id=$1 AND action=$2 AND used_at IS NULL', [uid, action]);
  await db.q(`INSERT INTO delete_codes(staff_id, action, code_hash, ip, expires_at) VALUES($1,$2,$3,$4, now() + make_interval(mins => $5))`,
    [uid, action, hash(code, salt), String(ctx.ip || '').slice(0, 60), MINUTES]);

  const what = ACTIONS[action] + (detail ? ` — ${String(detail).slice(0, 200)}` : '');
  const name = NOT_DELETE.has(action) ? 'নিরাপত্তা কোড' : 'মোছার কোড';
  const whatLabel = NOT_DELETE.has(action) ? 'কী করা হবে' : 'কী মোছা হবে';
  const warnDo = NOT_DELETE.has(action) ? 'আপনার দোকানের গোপন তথ্য দেখতে' : 'কিছু মুছতে';
  const text = `${name}: ${code}\n\n`
    + `${whatLabel}: ${what}\n`
    + `কে চাইলো: ${ctx.user.name || ctx.user.username || 'অ্যাডমিন'}\n`
    + `কোথা থেকে (IP): ${ctx.ip || '—'}\n`
    + `ডিভাইস: ${device(ctx) || '—'}\n`
    + `সময়: ${when()} (ঢাকা)\n\n`
    + `কোডটি ${bn(MINUTES)} মিনিট চলবে, একবারই কাজ করবে।\n\n`
    + `⚠️ আপনি নিজে না চেয়ে থাকলে কেউ আপনার অ্যাডমিনে ঢুকে ${warnDo} চাইছে। কোডটি কাউকে দেবেন না — এখনই অ্যাডমিনের পাসওয়ার্ড বদলান আর Admin → নিরাপত্তা থেকে অন্য সব ডিভাইস লগআউট করুন।`;
  const htmlBody = await emailHtml(DeleteCodeEmail({ m: {
    name, code, whatLabel, what, who: ctx.user.name || ctx.user.username || 'অ্যাডমিন', ip: ctx.ip || '—', device: device(ctx) || '—',
    when: when(), minutes: bn(MINUTES), warnDo,
  } }));
  try {
    await notify.sendEmail(ctx.settings, `🔐 ${name} ${code} — ${ctx.settings.store_name || 'সবমিলবে'}`, text, htmlBody, CODE_EMAIL);
  } catch (caught) { const err = caught as Caught;
    await db.logIntegration('notify-email', 'delete code', false, err.message).catch(() => {});
    throw new Error('কোডের ইমেইল পাঠানো গেল না: ' + err.message);
  }
  await db.logActivity(uid, 'delete_code', 'security', null, `${name} পাঠানো হলো (${ACTIONS[action]}) · ${ctx.ip || ''}`).catch(() => {});
  return { to: masked(), minutes: MINUTES };
}

// Check the code typed for this kind of delete. Returns null when it is right (and spends it), or the error to show.
async function check(ctx: AdminCtx, action: string, typed?: unknown) {
  const uid = ctx.user.id;
  const code = String(typed || '').replace(/[^\d০-৯]/g, '').replace(/[০-৯]/g, (d) => String('০১২৩৪৫৬৭৮৯'.indexOf(d))).slice(0, 6);
  if (await security.blocked(db, 'delcode-fail:' + uid, FAIL_MAX)) return 'অনেকবার ভুল কোড দেওয়া হয়েছে — এক ঘণ্টা মোছা বন্ধ থাকবে।';
  if (code.length !== 6) return `ইমেইলে আসা ৬ সংখ্যার কোড দিন — কোডটি ${masked()} ঠিকানায় যায়।`;
  const row = await db.one<Pick<DeleteCodesRow, 'id' | 'code_hash' | 'tries'>>(`SELECT id, code_hash, tries FROM delete_codes WHERE staff_id=$1 AND action=$2 AND used_at IS NULL AND expires_at > now()
    ORDER BY id DESC LIMIT 1`, [uid, action]);
  if (!row) return 'কোডটির মেয়াদ শেষ বা আগেই ব্যবহার হয়েছে — নতুন কোড চান।';
  if (same(code, row.code_hash)) {
    // spent at once, so the same code can't be sent twice
    const r = await db.one<Pick<DeleteCodesRow, 'id'>>('UPDATE delete_codes SET used_at=now() WHERE id=$1 AND used_at IS NULL RETURNING id', [row.id]);
    if (!r) return 'কোডটি আগেই ব্যবহার হয়েছে — নতুন কোড চান।';
    await security.clear(db, 'delcode-fail:' + uid);
    return null;
  }
  const tries = row.tries + 1;
  await db.q(`UPDATE delete_codes SET tries=$2::int, used_at = CASE WHEN $2::int >= $3::int THEN now() ELSE used_at END WHERE id=$1`, [row.id, tries, MAX_TRIES]);
  await security.hit(db, 'delcode-fail:' + uid, FAIL_MAX, 3600);
  await db.logActivity(uid, 'blocked', 'security', null, `ভুল মোছার কোড (${ACTIONS[action]}) · ${ctx.ip || ''}`).catch(() => {});
  if (tries >= MAX_TRIES) {
    notify.securityAlert(ctx.settings, 'বারবার ভুল মোছার কোড',
      `কেউ ${bn(MAX_TRIES)} বার ভুল কোড দিয়ে "${ACTIONS[action]}" করার চেষ্টা করেছে।\nকে: ${ctx.user.name || ctx.user.username || ''}\nযেখান থেকে: ${ctx.ip || ''}\nডিভাইস: ${device(ctx)}`,
      { extraEmail: CODE_EMAIL }).catch(() => {});
    return `${bn(MAX_TRIES)} বার ভুল কোড — এই কোডটি বাতিল হয়ে গেছে। নতুন কোড চান।`;
  }
  return `কোড ঠিক হয়নি। আর ${bn(MAX_TRIES - tries)} বার চেষ্টা করা যাবে।`;
}

// JSON route the "কোড পাঠান" button calls.
async function sendRoute(ctx: AdminCtx) {
  const b = await ctx.body();
  const action = String(b.action || '');
  if (!ACTIONS[action]) return ctx.json(400, { error: 'অজানা কাজ।' });
  // the same people who may do the delete may ask for its code
  const need = action === 'test_clear' ? 'settings' : 'owner';
  if (!(need === 'owner' ? ctx.user.role === 'owner' : ctx.can(need))) return ctx.json(403, { error: 'অনুমতি নেই।' });
  try {
    const r = await send(ctx, action, String(b.detail || '').slice(0, 200));
    return ctx.json(200, { ok: true, ...r });
  } catch (caught) { const e = caught as Caught;
    return ctx.json(200, { error: e.message });
  }
}

export { ACTIONS, CODE_EMAIL, masked, send, check, sendRoute };
