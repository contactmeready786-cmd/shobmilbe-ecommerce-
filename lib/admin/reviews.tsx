// Admin → মার্কেটিং → রিভিউ ও পছন্দের তালিকা: approve / hide / answer / delete customer reviews,
// the review switches, and which products customers put on their wishlist (♡) most.
import { Val, attrValue, jsxList } from '../react/html';
import { bn, int, str, fmtDate, pageNum } from '../util';
import * as db from '../db';
import * as ui from './ui';
import * as R from '../models/reviews';
import type { AdminCtx, Loose, RouteMatch } from '../types';

const BASE = '/admin/reviews';
const PER = 30;
const MSG: Record<string, string> = { approved: 'রিভিউ এখন দোকানে দেখাচ্ছে।', hidden: 'রিভিউ লুকানো হয়েছে।', replied: 'উত্তর সেভ হয়েছে।', gone: 'রিভিউ মুছে ফেলা হয়েছে।', set: 'সেটিংস সেভ হয়েছে।' };
const stars = (n?: Loose) => <span className="stars" aria-label={`${bn(n)} স্টার`}>{'★'.repeat(n)}<span className="muted">{'★'.repeat(5 - n)}</span></span>;

async function page(ctx: AdminCtx) {
  const status = R.STATUS[ctx.query.get('status')] ? ctx.query.get('status') : '';
  const q = str(ctx.query.get('q'), 60);
  const pg = pageNum(ctx.query);
  const [{ rows, total }, counts, wished] = await Promise.all([
    R.list({ status, q, limit: PER, offset: (pg - 1) * PER }), R.counts(),
    db.q('SELECT id, name, sku, wish_count, rating_avg, rating_count FROM products WHERE wish_count > 0 ORDER BY wish_count DESC, id LIMIT 15'),
  ]);
  const s = ctx.settings;
  const qs = new URLSearchParams();
  if (status) qs.set('status', status);
  if (q) qs.set('q', q);
  const chip = (key?: Loose, label?: Loose, n?: Loose) => <a className={`chip ${status === key ? 'on' : ''}`} href={`${attrValue(BASE)}${key ? `?status=${key}` : ''}`}><Val v={label} />{' '}<b>{bn(n)}</b></a>;
  const msg = MSG[ctx.query.get('m')];
  const body = <><h1>⭐ রিভিউ ও পছন্দের তালিকা</h1>{(msg ? ui.flash({ text: msg }) : ui.flash(ctx.flash))}<div className="chips">{chip('', 'সব', counts.all)}{chip('pending', '⏳ অনুমোদনের অপেক্ষায়', counts.pending)}{chip('approved', '✅ দেখানো হচ্ছে', counts.approved)}{chip('hidden', '🙈 লুকানো', counts.hidden)}</div><form className="toolbar" method="get" action={attrValue(BASE)}>{(status ? <input type="hidden" name="status" defaultValue={attrValue(status)} /> : null)}{' '}<input type="search" name="q" defaultValue={attrValue(q)} placeholder="লেখা, নাম, পণ্য বা SKU দিয়ে খুঁজুন" />{' '}<button className="btn btn-sm">খুঁজুন</button></form><div className="two-col wide-left"><section className="panel">{(rows.length ? <><ul className="review-admin">{jsxList(rows.map((r) => <li className={r.status === 'pending' ? 'is-pending' : ''}><span className="thumb">{(r.image_id ? <img src={`/media/${attrValue(r.image_id)}/t`} alt="" loading="lazy" /> : "📦")}</span><div><p>{stars(r.rating)}{' '}<b translate="no"><Val v={r.name} /></b>{(r.verified ? <>{' '}<span className="pill pill-delivered">✓ যাচাই করা ক্রেতা</span></> : null)}{' '}{ui.pill(R.STATUS[r.status], r.status === 'pending' ? 'pill-pending' : '')}{' '}<span className="small muted">{fmtDate(r.created_at)}{(r.phone ? ` · ${r.phone}` : null)}</span></p><p className="small"><a href={`/p/${attrValue(r.product_slug)}`} target="_blank" rel="noopener"><Val v={r.product_name} /></a>{' '}<span className="muted">SKU{' '}<Val v={r.sku || '—'} /></span>{(r.order_id ? <>{' '}·{' '}<a href={`/admin/orders/${attrValue(r.order_id)}`}>অর্ডার</a></> : null)}</p><p className="review-body" translate="no"><Val v={r.body} /></p>{(r.photos && r.photos.length ? <div className="ret-photos">{jsxList(r.photos.map((pid: Loose) => <a href={`${attrValue(BASE)}/photo/${attrValue(pid)}`} target="_blank" rel="noopener"><img src={`${attrValue(BASE)}/photo/${attrValue(pid)}`} alt="রিভিউয়ের ছবি" loading="lazy" /></a>))}</div> : null)}{' '}{(r.reply ? <p className="review-reply"><b>আপনার উত্তর:</b>{' '}<Val v={r.reply} /></p> : null)}<div className="row-actions">{(r.status !== 'approved' ? <form method="post" action={`${attrValue(BASE)}/${attrValue(r.id)}/status`}><input type="hidden" name="status" defaultValue="approved" /><button className="btn btn-sm">✅ দেখান</button></form> : null)}{' '}{(r.status !== 'hidden' ? <form method="post" action={`${attrValue(BASE)}/${attrValue(r.id)}/status`}><input type="hidden" name="status" defaultValue="hidden" /><button className="btn btn-sm btn-ghost">🙈 লুকান</button></form> : null)}<form method="post" action={`${attrValue(BASE)}/${attrValue(r.id)}/delete`} data-confirm="এই রিভিউটা একদম মুছে ফেলবেন? মনে রাখুন: আইন (ডিজিটাল কমার্স নির্দেশিকা ২০২১) অনুযায়ী খারাপ রিভিউ মুছে ফেলা যায় না — শুধু স্প্যাম, গালিগালাজ বা ভুয়া রিভিউ মুছুন।"><button className="btn btn-sm btn-danger">🗑️ মুছুন</button></form></div><details><summary className="small">💬{' '}{(r.reply ? "উত্তর বদলান" : "উত্তর দিন")}{' '}(দোকানে রিভিউর নিচে দেখাবে)</summary><form method="post" action={`${attrValue(BASE)}/${attrValue(r.id)}/reply`} className="reply-box">{ui.textarea('reply', r.reply || '', { rows: 2, maxlength: 1000, placeholder: 'যেমন: ধন্যবাদ! আবার আসবেন।' })}<button className="btn btn-sm">সেভ</button></form></details></div></li>))}</ul>{ui.pager(total, pg, PER, BASE + (qs.toString() ? '?' + qs : ''))}</> : <p className="muted">{(status === 'pending' ? "অনুমোদনের অপেক্ষায় কোনো রিভিউ নেই।" : "কোনো রিভিউ পাওয়া যায়নি।")}</p>)}</section><div><section className="panel"><h2>⚙️ সেটিংস</h2><form method="post" action={`${attrValue(BASE)}/settings`} className="form">{ui.switchRow('reviews_on', s.reviews_on !== '0', 'কাস্টমার রিভিউ চালু', 'চালু: ডেলিভারি হওয়া অর্ডারের পেজে "রিভিউ দিন" আসে, আর পণ্যের পেজে অনুমোদিত রিভিউ দেখায়। বন্ধ: দুটোই লুকিয়ে যায়।')}{' '}{ui.switchRow('reviews_auto_approve', s.reviews_auto_approve === '1', 'অনুমোদন ছাড়াই সাথে সাথে দেখাও', 'বন্ধ রাখাই ভালো — তাহলে স্প্যাম বা ভুয়া রিভিউ দোকানে যাবে না, আপনি আগে দেখে নেবেন।')}{' '}{ui.switchRow('review_photos_on', s.review_photos_on !== '0', '📸 রিভিউতে ছবি দেওয়া যাবে', 'কাস্টমার রিভিউয়ের সাথে সর্বোচ্চ ৩টা ছবি দিতে পারবেন। রিভিউ "দেখান" করলে তবেই ছবি দোকানে দেখা যায়।')}<p className="small muted">🔒 রিভিউ শুধু তারাই দিতে পারেন যাদের অর্ডার{' '}<b>ডেলিভারি হয়েছে</b>{' '}— নিজের অর্ডারের পেজ থেকে (অর্ডারটা যে ফোন/কম্পিউটার থেকে করেছেন সেখানে, অথবা "অর্ডার ট্র্যাক" পেজে অর্ডার নম্বর + মোবাইল নম্বর দিয়ে খুলে)। প্রতি অর্ডারের প্রতিটা পণ্যে একটাই রিভিউ। অন্য কেউ রিভিউর অপশনই দেখে না।</p>{ui.switchRow('wishlist_on', s.wishlist_on !== '0', 'পছন্দের তালিকা (♡) চালু', 'পণ্যের ছবির কোণে ♡ বাটন আর "পছন্দের তালিকা" পেজ।')}{' '}<button className="btn">সেভ করুন</button></form><p className="small muted">রিভিউ অনুমোদন হলে গুগলেও পণ্যের পাশে তারা (★★★★★) দেখানোর তথ্য পাঠানো হয়।</p></section><section className="panel"><h2>♡ সবচেয়ে বেশি পছন্দ করা পণ্য</h2><p className="small muted">কাস্টমাররা কোন পণ্য ♡ দিয়ে রেখেছে — এগুলোতে ছোট অফার দিলে বিক্রি হওয়ার সম্ভাবনা বেশি।</p>{(wished.length ? <table className="table compact"><thead><tr><th>পণ্য</th><th className="num">♡</th><th className="num">রেটিং</th></tr></thead><tbody>{jsxList(wished.map((p) => <tr><td><a href={`/admin/products/${attrValue(p.id)}`}><Val v={p.name} /></a><br /><span className="small muted">SKU{' '}<Val v={p.sku || '—'} /></span></td><td className="num"><b>{bn(p.wish_count)}</b></td><td className="num small">{(p.rating_count ? <>{bn(Number(p.rating_avg).toFixed(1))}★ ({bn(p.rating_count)})</> : "—")}</td></tr>))}</tbody></table> : <p className="muted small">এখনো কেউ ♡ দেয়নি।</p>)}</section></div></div></>;
  return ctx.page('রিভিউ', body, 'reviews');
}

async function setStatus(ctx: AdminCtx, m: RouteMatch) {
  const b = await ctx.body();
  const r = await R.setStatus(int(m[1]), String(b.status || ''));
  if (r) await ctx.log('edit', 'product', r.product_id, `রিভিউ #${int(m[1])}: ${R.STATUS[b.status] || ''}`);
  return ctx.redirect(`${back(ctx)}${back(ctx).includes('?') ? '&' : '?'}m=${b.status === 'approved' ? 'approved' : 'hidden'}`);
}
async function reply(ctx: AdminCtx, m: RouteMatch) {
  const b = await ctx.body();
  const r = await R.reply(int(m[1]), b.reply);
  if (r) await ctx.log('edit', 'product', r.product_id, `রিভিউ #${int(m[1])}-এ উত্তর`);
  return ctx.redirect(`${back(ctx)}${back(ctx).includes('?') ? '&' : '?'}m=replied`);
}
async function remove(ctx: AdminCtx, m: RouteMatch) {
  const r = await R.remove(int(m[1]));
  if (r) await ctx.log('delete', 'product', r.product_id, `রিভিউ #${int(m[1])} মুছা`);
  return ctx.redirect(`${back(ctx)}${back(ctx).includes('?') ? '&' : '?'}m=gone`);
}
async function saveSettings(ctx: AdminCtx) {
  const b = await ctx.body();
  const v: Record<string, Loose> = {};
  for (const k of ['reviews_on', 'reviews_auto_approve', 'wishlist_on', 'review_photos_on']) v[k] = b[k] ? '1' : '0';
  await db.setMany(v);
  await ctx.log('settings', 'settings', null, `রিভিউ/পছন্দের তালিকা: ${Object.entries(v).map(([k, x]) => `${k}=${x}`).join(', ')}`);
  return ctx.redirect(`${BASE}?m=set`);
}
// back to the same list page (only our own page, never another site)
function back(ctx: AdminCtx) {
  try {
    const u = new URL(ctx.req.headers.referer || '');
    if (u.pathname === BASE) return BASE + u.search.replace(/([?&])m=[^&]*/g, '$1').replace(/[?&]+$/, '');
  } catch (_) { /* no referer */ }
  return BASE;
}

// a review's photo (also before the review is shown — only staff)
async function photo(ctx: AdminCtx, m: RouteMatch) {
  const p = await db.one(`SELECT mime, data, ik_url FROM media WHERE id=$1 AND owner_type IN ('review','review_wait')`, [int(m[1])]);
  if (!p || !p.data) return ctx.send(404, 'Not found', 'text/plain');
  return ctx.reply.answer(200, { 'Content-Type': /^image\/(jpeg|png|webp)$/.test(p.mime) ? p.mime : 'application/octet-stream', 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox" }, p.data);
}

export const routes = [
    { method: 'GET', path: BASE, perm: 'reviews', handler: page },
    { method: 'POST', path: `${BASE}/settings`, perm: 'reviews', handler: saveSettings },
    { method: 'POST', path: /^\/admin\/reviews\/(\d+)\/status$/, perm: 'reviews', handler: setStatus },
    { method: 'POST', path: /^\/admin\/reviews\/(\d+)\/reply$/, perm: 'reviews', handler: reply },
    { method: 'POST', path: /^\/admin\/reviews\/(\d+)\/delete$/, perm: 'reviews', handler: remove },
    { method: 'GET', path: /^\/admin\/reviews\/photo\/(\d+)$/, perm: 'reviews', handler: photo },
  ];
