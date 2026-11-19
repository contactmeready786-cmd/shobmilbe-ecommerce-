// Admin → মার্কেটিং → ল্যান্ডিং পেজ ও বিজ্ঞাপন → 🚀 ল্যান্ডিং পেজ: one page per product for Facebook / Google ads
// (/lp/<slug>). Made from a product in one step (headline, line under it and benefits filled from the product), then
// the owner sharpens the words, sets an offer and a countdown, and watches visits → orders for each page.
import { Val, attrValue, jsxList } from '../react/html';
import { bn, money, int, str } from '../util';
import * as ui from './ui';
import * as L from '../models/landing';
import * as db from '../db';
import type { AdminCtx, RouteMatch } from '../types';
import type { ProductsRow } from '../data/rows';

const BASE = '/admin/landing';

const site = (ctx: AdminCtx) => (ctx.settings.site_url || '').replace(/\/+$/, '') || `https://${ctx.req.headers.host}`;
const rate = (orders: number, visits: number) => (visits ? `${bn((Math.round((orders / visits) * 1000) / 10).toFixed(1))}%` : '—');

/** "SKU 1379", "1379", a product link (/p/…) or a few words of its name → the main product. */
async function findProduct(text: string): Promise<Pick<ProductsRow, 'id' | 'name'> | null> {
  const t = text.trim();
  if (!t) return null;
  const slug = (t.match(/\/p\/([^/?#\s]+)/) || [])[1];
  if (slug) return db.one('SELECT coalesce(parent_id, id) AS id, name FROM products WHERE slug = $1', [decodeURIComponent(slug)]);
  const code = t.replace(/^sku[\s:#-]*/i, '');
  const bySku = await db.one<Pick<ProductsRow, 'id' | 'name'>>('SELECT coalesce(parent_id, id) AS id, name FROM products WHERE lower(sku) = lower($1) ORDER BY parent_id NULLS FIRST LIMIT 1', [code]);
  if (bySku) return bySku;
  return db.one(`SELECT id, name FROM products WHERE parent_id IS NULL AND product_type <> 'bundle' AND (name ILIKE $1 OR name_bn ILIKE $1)
    ORDER BY active DESC, sold_count DESC, id DESC LIMIT 1`, [`%${t.replace(/[%_]/g, ' ').trim()}%`]);
}

/** The best sellers of the last 30 days that have no page yet — the first ones worth a page and an ad. */
async function suggestions() {
  return db.q<{ id: number; name: string; image_id: number | null; emoji: string; price: number; sold: number }>(`SELECT p.id, p.name, p.image_id, p.emoji, p.price, sum(oi.qty)::int AS sold
    FROM order_items oi JOIN orders o ON o.id = oi.order_id JOIN products v ON v.id = oi.product_id JOIN products p ON p.id = coalesce(v.parent_id, v.id)
    WHERE o.created_at > now() - interval '30 days' AND o.status NOT IN ('cancelled', 'returned') AND p.active AND p.product_type <> 'bundle'
      AND NOT EXISTS (SELECT 1 FROM landing_pages l WHERE l.product_id = p.id)
    GROUP BY p.id ORDER BY sold DESC LIMIT 6`);
}

async function listPage(ctx: AdminCtx) {
  if (ctx.method === 'POST') {
    const b = await ctx.body();
    try {
      const p = b.product_id ? { id: int(b.product_id), name: '' } : await findProduct(str(b.find, 300));
      if (!p) return ctx.fail(BASE, 'এই নামে / SKU-তে কোনো পণ্য পাওয়া যায়নি। পণ্যের SKU বা পণ্যের পেজের লিংক দিয়ে আবার চেষ্টা করুন।');
      const id = await L.create(p.id);
      await ctx.log('landing_save', 'landing', id, `ল্যান্ডিং পেজ বানানো: পণ্য ${p.id}`);
      return ctx.back(`${BASE}/${id}?info=${encodeURIComponent('✅ পেজ তৈরি হয়েছে — পণ্যের তথ্য থেকে লেখা বসানো হয়েছে। শিরোনাম আর সুবিধাগুলো একবার দেখে "সেভ করুন" চাপুন।')}`);
    } catch (e) {
      if (!(e instanceof L.LandingError)) throw e;
      return ctx.fail(BASE, e.message);
    }
  }
  const [pages, ideas] = await Promise.all([L.list(), suggestions().catch(() => [])]);
  const findDefault = ctx.query.get('find') || '';
  const body = <><div className="title-row"><h1>🚀 ল্যান্ডিং পেজ</h1></div>{ui.flash(ctx.flash)}
    {ui.helpBox('ল্যান্ডিং পেজ কী, কীভাবে কাজে লাগাবেন', <ol className="steps">
      <li>একটা পণ্যের জন্য একটা আলাদা পেজ — বড় ছবি, দাম, কেন কিনবে, অফারের সময় গোনা, রিভিউ, প্রশ্ন-উত্তর, আর <b>একই পেজে অর্ডার ফর্ম</b>। কাস্টমারকে কার্ট-চেকআউট ঘুরতে হয় না, তাই বিজ্ঞাপন থেকে অর্ডার বেশি আসে।</li>
      <li>পেজটা দোকানেরই অংশ: উপরে দোকানের মেনু, একই ডেলিভারি চার্জ, OTP, ফ্রড চেক, পিক্সেল — সব আগের মতো। অর্ডার সাধারণ অর্ডারের তালিকাতেই আসে।</li>
      <li>Facebook / Google বিজ্ঞাপনে পণ্যের সাধারণ লিংকের বদলে এই পেজের লিংক দিন। নিচের তালিকায় দেখবেন কতজন এসেছে আর কতজন অর্ডার করেছে।</li>
      <li>Google-এ পণ্যের আসল পেজটাই আসবে (এই পেজ সেটাকেই মূল হিসেবে দেখায়), তাই SEO-তে কোনো ক্ষতি হয় না।</li>
    </ol>)}
    <section className="set-sec"><div className="set-head"><h2 className="set-title">➕ নতুন পেজ বানান</h2></div><div className="panel set-card"><form method="post" action={attrValue(BASE)} className="form"><div className="field-row">{ui.field('পণ্যের SKU, নাম, বা পণ্যের পেজের লিংক', ui.input('find', findDefault, { maxlength: 300, required: true, placeholder: 'যেমন 1379 বা ব্লুটুথ স্পিকার' }))}</div><button className="btn">🚀 পেজ বানান</button></form>
      {(ideas.length ? <><h3>💡 যেগুলোর পেজ বানালে লাভ বেশি (গত ৩০ দিনে সবচেয়ে বেশি বিক্রি, এখনো পেজ নেই)</h3><div className="table-wrap"><table className="table compact"><tbody>{jsxList(ideas.map((p) => <tr><td className="thumb">{(p.image_id ? <img src={`/media/${attrValue(p.image_id)}/t`} alt="" /> : <span><Val v={p.emoji || '📦'} /></span>)}</td><td><Val v={p.name} /><br /><span className="small muted">{money(p.price)} · ৩০ দিনে {bn(p.sold)}টি বিক্রি</span></td><td><form method="post" action={attrValue(BASE)}><input type="hidden" name="product_id" defaultValue={attrValue(p.id)} /><button className="btn btn-sm">🚀 পেজ বানান</button></form></td></tr>))}</tbody></table></div></> : null)}
    </div></section>
    <section className="panel table-wrap"><h2>📊 সব পেজ ও ফলাফল</h2>{(pages.length ? <table className="table"><thead><tr><th></th><th>পেজ</th><th className="num">ভিজিট</th><th className="num">অর্ডার</th><th className="num">অর্ডার হার</th><th className="num">বিক্রি</th><th className="num">গত ৭ দিন</th><th>বেশি আসে</th><th>অবস্থা</th><th></th></tr></thead><tbody>{jsxList(pages.map((p) => <tr>
      <td className="thumb">{(p.image_id ? <img src={`/media/${attrValue(p.image_id)}/t`} alt="" /> : <span><Val v={p.emoji || '📦'} /></span>)}</td>
      <td><a href={`${attrValue(BASE)}/${attrValue(p.id)}`}><b><Val v={p.headline || p.product_name} /></b></a><br /><a className="small muted" href={`/lp/${attrValue(p.slug)}`} target="_blank" rel="noopener">/lp/<Val v={p.slug} /> ↗</a>{(p.stock <= 0 ? <> {ui.pill('স্টক শেষ', 'pill-bad')}</> : null)}</td>
      <td className="num">{bn(p.visits)}</td><td className="num"><b>{bn(p.orders)}</b></td><td className="num">{rate(p.orders, p.visits)}</td><td className="num">{money(p.sales)}</td>
      <td className="num small">{bn(p.visits7)} ভিজিট · {bn(p.orders7)} অর্ডার</td><td className="small"><Val v={p.top_source || '—'} /></td>
      <td>{(p.active && p.product_active ? ui.pill('চালু', 'pill-ok') : ui.pill('বন্ধ', 'pill-grey'))}</td>
      <td><a className="btn btn-sm" href={`${attrValue(BASE)}/${attrValue(p.id)}`}>✏️ এডিট</a></td></tr>))}</tbody></table>
      : <p className="muted">এখনো কোনো পেজ নেই। উপরে পণ্যের SKU দিয়ে প্রথমটা বানান।</p>)}
      <p className="small muted">ভিজিট = যারা সরাসরি এই পেজে এসে দোকানে ঢুকেছে (বিজ্ঞাপন বা লিংক থেকে)। অর্ডার হার ২–৫% হলে ভালো; ১%-এর নিচে থাকলে শিরোনাম, ছবি বা অফার বদলে দেখুন।</p>
    </section></>;
  return ctx.page('ল্যান্ডিং পেজ', body, 'landing');
}

/** a date-time box value in Bangladesh time (UTC+6) */
function bdLocal(d: Date | null): string {
  if (!d) return '';
  return new Date(new Date(d).getTime() + 6 * 3600e3).toISOString().slice(0, 16);
}

async function editPage(ctx: AdminCtx, m: RouteMatch) {
  const id = int(m[1]);
  const here = `${BASE}/${id}`;
  if (ctx.method === 'POST') {
    const b = await ctx.body();
    try {
      if (b.action === 'delete') { await L.remove(id); await ctx.log('landing_delete', 'landing', id, 'ল্যান্ডিং পেজ মুছেছে'); return ctx.back(BASE, 'deleted'); }
      await L.save(id, b);
      await ctx.log('landing_save', 'landing', id, str(b.headline, 80));
      return ctx.back(here, 'saved');
    } catch (e) {
      if (!(e instanceof L.LandingError)) throw e;
      return ctx.fail(here, e.message);
    }
  }
  const lp = await L.get(id);
  if (!lp) return ctx.redirect(BASE);
  const src = await L.sources(lp.slug).catch(() => []);
  const url = `${site(ctx)}/lp/${lp.slug}`;
  const adUrl = `${url}?utm_source=facebook&utm_medium=paid&utm_campaign=${encodeURIComponent(lp.slug)}`;
  const body = <><p className="crumbs"><a href={attrValue(BASE)}>← সব ল্যান্ডিং পেজ</a></p>
    <div className="title-row"><h1><Val v={lp.headline || lp.product_name} /></h1><div className="row-actions"><a className="btn btn-ghost btn-sm" href={`/lp/${attrValue(lp.slug)}`} target="_blank" rel="noopener">পেজটা দেখুন ↗</a><a className="btn btn-ghost btn-sm" href={`/p/${attrValue(lp.product_slug)}`} target="_blank" rel="noopener">পণ্যের পেজ ↗</a></div></div>{ui.flash(ctx.flash)}
    <section className="panel"><h2>🔗 বিজ্ঞাপনে দেওয়ার লিংক</h2>
      {ui.field('Facebook / Instagram বিজ্ঞাপনে এটা দিন', <input readOnly defaultValue={attrValue(adUrl)} className="w-full" />, 'শেষের utm অংশ থাকলে ভিজিটর অ্যানালিটিক্সে দেখা যায় কোন বিজ্ঞাপন থেকে এসেছে। Google বিজ্ঞাপনে utm_source=google দিন।')}
      {ui.field('সাধারণ লিংক (পোস্ট, মেসেজ, WhatsApp)', <input readOnly defaultValue={attrValue(url)} className="w-full" />)}
    </section>
    <form method="post" action={attrValue(here)} className="form"><div className="two-col"><section className="panel">
      {ui.field('বড় শিরোনাম (সবচেয়ে উপরে)', ui.input('headline', lp.headline, { maxlength: 140, required: true, placeholder: 'যেমন: ঘরে বসেই সিনেমা হলের মতো সাউন্ড!' }), 'পণ্যের নাম না লিখে কাস্টমারের লাভটা লিখুন — কী সমস্যা মেটাবে, কী সুবিধা দেবে।')}
      {ui.field('শিরোনামের নিচের লাইন', ui.textarea('subhead', lp.subhead, { rows: 2, maxlength: 300 }))}
      {ui.field('কেন কিনবে — সুবিধাগুলো (প্রতি লাইনে একটা)', ui.textarea('points', lp.points, { rows: 7, maxlength: 3000, placeholder: '১০ ঘণ্টা একটানা চলে\nপানিতে ভিজলেও নষ্ট হয় না\n১ বছরের ওয়ারেন্টি' }), '৩ থেকে ৬টা ছোট লাইন সবচেয়ে ভালো কাজ করে। প্রতিটার সামনে ✅ নিজে বসবে।')}
      <div className="field-row">{ui.field('অফারের লেখা (লাল ব্যাজে)', ui.input('offer', lp.offer, { maxlength: 120, placeholder: 'যেমন: আজ ডেলিভারি চার্জ মাত্র ৬০ টাকা' }), 'যে অফার সত্যি দিচ্ছেন শুধু সেটাই লিখুন। দাম কমাতে চাইলে পণ্যের দাম বা ফ্ল্যাশ সেল বদলান।')}{ui.field('অফার শেষ হবে (সময় গোনা দেখাবে)', ui.input('ends_at', bdLocal(lp.ends_at), { type: 'datetime-local' }), 'খালি রাখলে ফ্ল্যাশ সেল চললে তার সময় দেখাবে, নাহলে কিছু দেখাবে না।')}</div>
      {ui.field('ভিডিও লিংক (YouTube, ঐচ্ছিক)', ui.input('video_url', lp.video_url, { maxlength: 300, placeholder: 'খালি = পণ্যের নিজের ভিডিও' }))}
      {ui.field('প্রশ্ন-উত্তর (প্রতি লাইনে: প্রশ্ন | উত্তর)', ui.textarea('faq', lp.faq, { rows: 5, maxlength: 5000, placeholder: 'চার্জ কতক্ষণে হয়? | ২ ঘণ্টায় পুরো চার্জ হয়।\nওয়ারেন্টি আছে? | হ্যাঁ, ৬ মাস।' }), 'ডেলিভারি, ক্যাশ অন ডেলিভারি আর ফোন নম্বরের প্রশ্নগুলো দোকানের সেটিংস থেকে নিজেই নিচে যোগ হয়।')}
      {ui.field('লিংকের নাম (ইংরেজিতে)', ui.input('slug', lp.slug, { maxlength: 80, required: true }), 'বিজ্ঞাপন চালু হয়ে গেলে এটা আর বদলাবেন না — পুরোনো লিংক কাজ করবে না।')}
      {ui.switchRow('active', !!lp.active, 'পেজ চালু', 'বন্ধ করলে লিংকে গেলে "পাওয়া যায়নি" দেখাবে — বিজ্ঞাপনও বন্ধ করে দিন।')}
    </section><section className="panel"><h2>📊 কোথা থেকে কতজন এসেছে</h2>{(src.length ? <table className="table compact"><thead><tr><th>উৎস</th><th className="num">ভিজিট</th><th className="num">অর্ডার</th><th className="num">হার</th></tr></thead><tbody>{jsxList(src.map((r) => <tr><td><Val v={r.source} /></td><td className="num">{bn(r.visits)}</td><td className="num">{bn(r.orders)}</td><td className="num">{rate(r.orders, r.visits)}</td></tr>))}</tbody></table> : <p className="muted">এখনো কেউ আসেনি। লিংকটা বিজ্ঞাপন বা পোস্টে দিলে এখানে দেখা যাবে।</p>)}
      <h3>✍️ ভালো ফল পেতে</h3><ul className="small"><li>প্রথম ছবিটা সবচেয়ে পরিষ্কার হোক — পণ্যের পেজে ছবির ক্রম বদলালে এখানেও বদলায়।</li><li>রিভিউ থাকলে পেজ বেশি বিশ্বাসযোগ্য হয় — আগের কাস্টমারদের রিভিউ দিতে বলুন।</li><li>৩–৪ দিন পর অর্ডার হার দেখুন; কম হলে শিরোনাম বা অফার বদলে আবার দেখুন।</li></ul></section></div>
      <p className="row-actions"><button className="btn">সেভ করুন</button> <button className="btn btn-danger btn-sm" name="action" value="delete" data-confirm-btn="এই ল্যান্ডিং পেজটা মুছবেন? পণ্য মুছবে না।">🗑️ পেজ মুছুন</button></p></form></>;
  return ctx.page(lp.headline || 'ল্যান্ডিং পেজ', body, 'landing');
}

export const routes = [
  { method: '*', path: BASE, perm: 'marketing', handler: listPage },
  { method: '*', path: /^\/admin\/landing\/(\d+)$/, perm: 'marketing', handler: editPage },
];
