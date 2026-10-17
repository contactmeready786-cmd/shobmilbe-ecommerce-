// Admin → নিরাপত্তা → জরুরি রিকভারি কোড (owner only).
// Six one-time codes the owner writes on paper. Any one of them opens /admin/reset when the phone is lost,
// the camera is broken or the password is forgotten — no Vercel setting needed.
// Only a slow hash (scrypt) of each code is stored; the codes are shown once, right after they are made.
import { Val, styleOf, jsxList } from '../react/html';
import * as crypto from 'node:crypto';
import { fmtDate } from '../util';
import * as db from '../db';
import * as ui from './ui';
import type { AdminCtx, Loose } from '../types';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I
function makeCode() {
  let s = '';
  for (let i = 0; i < 12; i++) s += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return s.match(/.{4}/g)!.join('-');
}
function normalize(c?: Loose) { return String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }
function hash(c?: Loose) { return crypto.scryptSync(normalize(c), 'shobmilbe-recovery-v1', 32).toString('hex'); }

async function available() { return (await db.one('SELECT count(*)::int AS n FROM recovery_codes WHERE used_at IS NULL'))!.n; }
// Is this a valid unused code? (does not use it up)
async function check(code?: Loose) {
  if (normalize(code).length !== 12) return false;
  return !!(await db.one('SELECT id FROM recovery_codes WHERE hash=$1 AND used_at IS NULL', [hash(code)]));
}
// Use it up (only one request can win).
async function consume(code?: Loose) {
  return !!(await db.one('UPDATE recovery_codes SET used_at=now() WHERE hash=$1 AND used_at IS NULL RETURNING id', [hash(code)]));
}

async function page(ctx: AdminCtx, fresh?: Loose) {
  const [left, made] = await Promise.all([
    available(),
    db.one('SELECT max(created_at) AS at, count(*)::int AS n FROM recovery_codes'),
  ]);
  const body = <><h1>🆘 জরুরি রিকভারি কোড</h1>{ui.flash(ctx.flash)}{' '}{(fresh ? <section className="panel rc-fresh"><h2>✍️ এই ৬টা কোড এখনই কাগজে লিখে রাখুন</h2><p>এগুলো{' '}<b>শুধু এখন একবার</b>{' '}দেখানো হচ্ছে। পেজ বন্ধ করলে আর দেখা যাবে না। প্রতিটা কোড একবারই কাজ করে।</p><ol className="rc-list">{jsxList(fresh.map((c?: Loose) => <li><code><Val v={c} /></code></li>))}</ol><p className="small">কাগজটা আলমারি বা নিরাপদ জায়গায় রাখুন। ফোনে ছবি তুলে বা কাউকে পাঠিয়ে রাখবেন না।</p><button type="button" className="btn btn-ghost" data-print="">🖨️ প্রিন্ট করুন</button></section> : null)}<section className="panel"><h2>এটা কী কাজে লাগে?</h2><p>ফোন হারালে বা পাসওয়ার্ড ভুলে গেলে লগইন পেজের{' '}<b>"পাসওয়ার্ড ভুলে গেছেন?"</b>{' '}চাপুন। সেখানে এই কাগজের যেকোনো একটা কোড দিলে নতুন পাসওয়ার্ড দিতে পারবেন, আর চাইলে আঙুলের ছাপের তালাও বন্ধ করতে পারবেন।</p><p>এখন হাতে আছে:{' '}{(left ? ui.pill(`${ui.bn(left)}টি কোড বাকি`, 'pill-delivered') : ui.pill('কোনো কোড নেই', 'pill-cancelled'))}{' '}{(made && made.at ? <span className="small muted">{' '}· শেষ বানানো:{' '}{fmtDate(made.at)}</span> : null)}</p><form method="post" action="/admin/security/recovery" data-confirm={left ? 'নতুন কোড বানালে আগের কাগজের কোডগুলো আর কাজ করবে না। বানাবেন?' : 'নতুন ৬টা কোড বানাবেন?'}><button className="btn btn-lg">{(left ? "🔄 নতুন কোড বানান (আগেরগুলো বাতিল হবে)" : "✨ রিকভারি কোড বানান")}</button></form>{(left && left <= 2 ? <p className="small" style={styleOf("color:#8A5300")}>⚠️ কোড প্রায় শেষ। নতুন সেট বানিয়ে নিন।</p> : null)}</section></>; // the print button works through client/admin/page-actions.ts (data-print)
  return ctx.page('জরুরি রিকভারি কোড', body, 'recovery');
}

async function makeNew(ctx: AdminCtx) {
  const codes = Array.from({ length: 6 }, makeCode);
  await db.tx(async (t) => {
    await t.query('DELETE FROM recovery_codes');
    for (const c of codes) await t.query('INSERT INTO recovery_codes(hash) VALUES($1)', [hash(c)]);
  });
  await ctx.log('recovery_codes', 'security', ctx.user.id, 'নতুন ৬টা জরুরি রিকভারি কোড বানানো হয়েছে (আগেরগুলো বাতিল)');
  return page(ctx, codes);
}

export const routes = [
    { method: 'GET', path: '/admin/security/recovery', perm: 'owner', handler: (ctx: AdminCtx) => page(ctx) },
    { method: 'POST', path: '/admin/security/recovery', perm: 'owner', handler: makeNew },
  ];
export { available, check, consume, normalize };
