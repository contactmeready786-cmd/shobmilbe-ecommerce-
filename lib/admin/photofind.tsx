// Admin → Inventory → Scan stock → 📸 ছবি দিয়ে খুঁজুন (owner, 2026-11-19: "I have many products at home and don't know
// which of them are on the website — I take a picture from any angle and it must find the product").
// The phone / computer turns each photo into the picture-recognition AI's description (client/admin/photofind.tsx:
// DINOv2, the same AI that already described every product picture for the duplicate search — media.emb), three
// times: the whole photo, the middle and closer in, so a hand or a table around the product matters less. The server
// compares them with every product picture (cosine likeness of the 384 numbers) and answers the closest products,
// best first — the owner always picks; the AI only suggests. Stock and price are set right there.
import { attrValue } from '../react/html';
import { int, bn, amount, shopPrice, priceProblem } from '../util';
import * as db from '../db';
import * as catalog from '../models/catalog';
import * as W from '../models/warehouses';
import { embFrom } from '../models/recognize';
import { EMB } from '../models/duplicates';
import { ASSET_V } from './layout';
import type { AdminCtx } from '../types';
import type { ProductsRow } from '../data/rows';

const BASE = '/admin/photo-find';
const SHOW = 6;

// ---------- the product pictures the AI knows (kept in memory, read again when pictures change) ----------
type Pic = { media: number; product: number; e: Int8Array; n: number };
let known: { key: string; pics: Pic[] } = { key: '', pics: [] };
async function pictures(): Promise<Pic[]> {
  const k = await db.one<{ n: number; top: number | null; touched: string | null }>(`SELECT count(*)::int AS n, max(id) AS top, max(owner_id)::text AS touched
    FROM media WHERE owner_type='product' AND emb IS NOT NULL`);
  const key = `${k?.n}|${k?.top}|${k?.touched}`;
  if (key === known.key) return known.pics;
  const rows = await db.q<{ id: number; owner_id: number; emb: Buffer }>(`SELECT id, owner_id, emb FROM media WHERE owner_type='product' AND emb IS NOT NULL AND owner_id IS NOT NULL`);
  const pics: Pic[] = [];
  for (const r of rows) {
    if (!r.emb || r.emb.length !== EMB) continue;
    const e = new Int8Array(r.emb.buffer, r.emb.byteOffset, EMB);
    let n = 0;
    for (let i = 0; i < EMB; i++) n += e[i] * e[i];
    if (n) pics.push({ media: r.id, product: r.owner_id, e, n: Math.sqrt(n) });
  }
  known = { key, pics };
  return pics;
}

/** Each product's best likeness (0…1) to any of the photo's views, best first. */
export function rank(views: Int8Array[], pics: Pic[]): { product: number; media: number; score: number }[] {
  const qs = views.map((v) => { let n = 0; for (let i = 0; i < EMB; i++) n += v[i] * v[i]; return { v, n: Math.sqrt(n) }; }).filter((x) => x.n);
  const best = new Map<number, { media: number; score: number }>();
  for (const p of pics) {
    let s = 0;
    for (const q of qs) {
      let d = 0;
      for (let i = 0; i < EMB; i++) d += q.v[i] * p.e[i];
      s = Math.max(s, d / (q.n * p.n));
    }
    const cur = best.get(p.product);
    if (!cur || s > cur.score) best.set(p.product, { media: p.media, score: s });
  }
  return [...best].map(([product, v]) => ({ product, ...v })).sort((a, b) => b.score - a.score);
}

/** How sure: the best is clearly the same product, maybe, or most likely not in the shop yet. */
export function verdict(list: { score: number }[]): 'sure' | 'maybe' | 'none' {
  const [a, b] = list;
  if (!a) return 'none';
  if (a.score >= 0.72 && (!b || a.score - b.score >= 0.04 || a.score >= 0.85)) return 'sure';
  if (a.score >= 0.5) return 'maybe';
  return 'none';
}

async function find(ctx: AdminCtx) {
  const b = await ctx.body();
  const raw = Array.isArray(b.views) ? (b.views as unknown[]).slice(0, 4) : [];
  const views = raw.map((x) => embFrom(x)).filter((x): x is Buffer => !!x).map((x) => new Int8Array(x.buffer, x.byteOffset, EMB));
  if (!views.length) return ctx.json(400, { ok: false, error: 'ছবিটা AI পড়তে পারেনি — আবার তুলুন।' });
  const pics = await pictures();
  const ranked = rank(views, pics);
  const top = ranked.slice(0, SHOW * 2);
  const rows = await catalog.getProductsByIds(top.map((t) => t.product), { includeInactive: true });
  const byId = new Map(rows.map((p) => [p.id, p]));
  const shown = top.filter((t) => byId.has(t.product)).slice(0, SHOW);
  const ids = shown.map((t) => t.product);
  const [st, held] = await Promise.all([W.stockFor(ids), catalog.reservedFor(ids)]);
  const matches = shown.map((t) => {
    const p = byId.get(t.product)!;
    const main = (st.get(p.id) || { main: p.stock }).main;
    const h = held.get(p.id) || 0;
    return {
      id: p.id, name: p.name, sku: p.sku || '', price: Number(p.base_price ?? p.price) || 0, active: !!p.active, unit: p.unit || 'পিস',
      variants: Number(p.variant_count) || 0, bundle: p.product_type === 'bundle', location: p.location || '',
      main, held: h, shelf: main + h, image: `/media/${t.media}/t`, score: Math.round(t.score * 100),
    };
  });
  return ctx.json(200, { ok: true, verdict: verdict(shown), matches, known: pics.length, canPrice: ctx.can('products') });
}

/** the selling price, set from here (same rules as the product page: ৳0.50 – ৳2000, whole taka from ৳10) */
async function setPrice(ctx: AdminCtx) {
  if (!ctx.can('products')) return ctx.json(403, { ok: false, error: 'দাম বদলানোর অনুমতি নেই।' });
  const b = await ctx.body();
  const id = int(b.id);
  const price = shopPrice(amount(b.price));
  const bad = priceProblem(price, 'বিক্রির দাম');
  if (bad) return ctx.json(400, { ok: false, error: bad });
  const p = await db.one<Pick<ProductsRow, 'id' | 'name' | 'price' | 'old_price' | 'variant_count'>>('SELECT id, name, price, old_price, variant_count FROM products WHERE id=$1', [id]);
  if (!p) return ctx.json(404, { ok: false, error: 'পণ্যটি পাওয়া যায়নি।' });
  if (Number(p.variant_count) > 0) return ctx.json(400, { ok: false, error: 'এই পণ্যের রং/সাইজ আছে — দাম পণ্যের পেজ থেকে দিন।' });
  if (Number(p.price) !== price) {
    // the crossed-out "was" price stays only while it is still above the new price
    const old = Number(p.old_price) > price ? Number(p.old_price) : null;
    await db.tx(async (t) => {
      await catalog.logPriceChange(t, id, p, { price, old_price: old, name: p.name }, ctx.user.id, 'ছবি দিয়ে খোঁজা');
      await t.query('UPDATE products SET price=$1, old_price=$2, updated_at=now() WHERE id=$3', [price, old, id]);
    });
  }
  return ctx.json(200, { ok: true, price, message: `✔ "${p.name}" — দাম ৳${price}` });
}

async function page(ctx: AdminCtx) {
  const n = (await db.one<{ n: number; done: number }>(`SELECT count(*)::int AS n, count(emb)::int AS done FROM media WHERE owner_type='product'`))!;
  const body = <><div className="title-row"><h1>📸 ছবি দিয়ে খুঁজুন</h1><div className="row-actions"><a className="btn btn-ghost btn-sm" href="/admin/stock-scan">📷 বারকোড স্ক্যান →</a></div></div>
    <section className="panel pf" data-photofind="" data-can-price={ctx.can('products') ? '1' : undefined}>
      <p className="muted">ঘরের পণ্যটা হাতে নিয়ে ছবি তুলুন — যে কোনো দিক থেকে। AI দোকানের <b>{bn(n.done)}</b>টা পণ্যের ছবির সাথে মিলিয়ে সবচেয়ে কাছের পণ্যগুলো দেখাবে। ঠিকটায় স্টক আর দাম বসিয়ে সেভ করুন; না থাকলে নতুন পণ্য হিসেবে তুলুন।</p>
      <div className="pf-actions">
        <label className="btn pf-big">📷 ছবি তুলুন<input type="file" accept="image/*" capture="environment" data-pf-camera="" hidden /></label>
        <label className="btn btn-ghost pf-big">🖼️ গ্যালারি থেকে (একসাথে অনেকগুলো)<input type="file" accept="image/*" multiple data-pf-files="" hidden /></label>
      </div>
      <p className="small muted">💡 পণ্যটা ছবির মাঝখানে রাখুন, পরিষ্কার আলোয়, পেছনে যত কম জিনিস তত ভালো। একটা না মিললে আরেক দিক থেকে আরেকটা তুলুন।</p>
      <p className="pf-status" data-pf-status="" role="status" aria-live="polite"></p>
      <div className="pf-list" data-pf-list=""></div>
    </section>
    {n.done < n.n ? <p className="small muted">⏳ {bn(n.n - n.done)}টা পণ্যের ছবি AI এখনো চেনেনি — ওগুলো কিছুক্ষণের মধ্যে নিজে থেকে হয়ে যাবে।</p> : null}
    <script type="module" src={`/js/admin/photofind.js?v=${attrValue(ASSET_V)}`} /></>;
  return ctx.page('ছবি দিয়ে খুঁজুন', body, 'photo-find');
}

export const routes = [
  { method: 'GET', path: BASE, perm: 'inventory', handler: page },
  { method: 'POST', path: '/admin/api/photo-find', perm: 'inventory', handler: find },
  { method: 'POST', path: '/admin/api/photo-find/price', perm: 'inventory', handler: setPrice },
];
