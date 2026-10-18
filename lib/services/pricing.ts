// Prices the shop works out on the server (never trusted from the browser):
//   • flash sale  — a lower price for a few hours/days (Admin → মার্কেটিং → ফ্ল্যাশ সেল)
//   • quantity price — cheaper per piece when buying more (set on each product: "১০টি বা বেশি নিলে ৳x করে")
//   • "buy X get Y" offers — a free or discounted gift line added to the order on its own
// One rule keeps it from selling at a loss by stacking: each line gets the LOWEST of normal / flash / quantity
// price — never two discounts on top of each other — and flash-sale lines and gifts never take a coupon.
import { q } from '../db';
import { int, ymd, round2, shopPrice, fields } from '../util';
import * as $models_catalog from '../models/catalog';
import type { Tx } from '../pg';
import type { OffersRow } from '../data/rows';

type Tier = { min_qty: number; price: number };
type Flash = { item_id: number; price: number; left: number; title: string; ends_at: Date };
/** The price of one cart line and why. */
export type LinePrice = { price: number; kind: '' | 'flash' | 'tier'; note: string; ref_id: number | null };
/** a running offer, with the names and price of the products it is about */
export type OfferRow = OffersRow & { get_name: string | null; get_base: number | null; get_active: boolean | null; get_sku: string | null; buy_name: string };
export type GiftLine = { offer: OfferRow; product_id: number; qty: number; price: number; note: string };

const r2 = (v: unknown): number => shopPrice(Number(v) || 0); // ৳10+ prices never carry paisa (see util.shopPrice)

// Quantity prices for these products: Map id → [{ min_qty, price }] (biggest quantity first).
async function tiersFor(ids: unknown[] | null | undefined, t: Tx | null = null): Promise<Map<number, Tier[]>> {
  const clean = [...new Set((ids || []).map((x) => int(x)).filter((x) => x > 0))];
  if (!clean.length) return new Map<number, Tier[]>();
  const sql = 'SELECT product_id, min_qty, price FROM price_tiers WHERE product_id = ANY($1::int[]) ORDER BY product_id, min_qty DESC';
  type Row = { product_id: number; min_qty: number; price: number };
  const rows = t ? (await t.query<Row>(sql, [clean])).rows : await q<Row>(sql, [clean]);
  const m = new Map<number, Tier[]>();
  rows.forEach((r) => { if (!m.has(r.product_id)) m.set(r.product_id, []); m.get(r.product_id)!.push({ min_qty: r.min_qty, price: Number(r.price) }); });
  return m;
}
function tierPrice(tiers: Tier[] | null | undefined, qty: number, base: number): number | null {
  for (const x of tiers || []) if (qty >= x.min_qty && x.price < base) return x.price;
  return null;
}

// Running flash-sale items: Map id → { item_id, price, left, title, ends_at } (the cheapest one per product).
async function flashFor(ids: unknown[] | null | undefined, t: Tx | null = null): Promise<Map<number, Flash>> {
  const clean = [...new Set((ids || []).map((x) => int(x)).filter((x) => x > 0))];
  if (!clean.length) return new Map<number, Flash>();
  const sql = `SELECT DISTINCT ON (fi.product_id) fi.id AS item_id, fi.product_id, fi.price, fi.max_qty, fi.sold, fs.title, fs.ends_at
    FROM flash_items fi JOIN flash_sales fs ON fs.id=fi.sale_id JOIN products p ON p.id=fi.product_id
    WHERE fi.product_id = ANY($1::int[]) AND fs.active AND now() >= fs.starts_at AND now() < fs.ends_at
      AND (fi.max_qty = 0 OR fi.sold < fi.max_qty) AND fi.price < p.price
    ORDER BY fi.product_id, fi.price, fi.id`;
  type Row = { item_id: number; product_id: number; price: number; max_qty: number; sold: number; title: string; ends_at: Date };
  const rows = t ? (await t.query<Row>(sql, [clean])).rows : await q<Row>(sql, [clean]);
  return new Map(rows.map((r): [number, Flash] => [r.product_id, { item_id: r.item_id, price: Number(r.price), left: r.max_qty ? r.max_qty - r.sold : Infinity, title: r.title, ends_at: r.ends_at }]));
}

// The price of one cart line: { price, kind: '' | 'flash' | 'tier', note, ref_id }.
// base = the product's normal price. A flash price needs enough pieces left in the sale for the whole line.
function linePrice({ base, qty, flash, tiers }: { base: unknown; qty: number; flash?: Flash | null; tiers?: Tier[] | null }): LinePrice {
  const b = r2(base);
  const options: LinePrice[] = [{ price: b, kind: '', note: '', ref_id: null }];
  if (flash && flash.left >= qty) options.push({ price: r2(flash.price), kind: 'flash', note: `⚡ ফ্ল্যাশ সেল: ${String(flash.title || '').slice(0, 60)}`, ref_id: flash.item_id });
  const tp = tierPrice(tiers, qty, b);
  if (tp !== null) options.push({ price: r2(tp), kind: 'tier', note: '📦 বেশি কেনায় কম দাম', ref_id: null });
  return options.reduce((best, o) => (o.price < best.price ? o : best));
}

// Offers running today (Dhaka date) for these products.
async function offersFor(ids: unknown[], t: Tx | null = null): Promise<OfferRow[]> {
  const clean = [...new Set((ids || []).map((x) => int(x)).filter((x) => x > 0))];
  if (!clean.length) return [];
  const today = ymd();
  const sql = `SELECT o.*, g.name AS get_name, g.price AS get_base, g.active AS get_active, g.sku AS get_sku, b.name AS buy_name
    FROM offers o JOIN products b ON b.id=o.buy_product_id LEFT JOIN products g ON g.id=o.get_product_id
    WHERE o.active AND o.buy_product_id = ANY($1::int[]) AND (o.starts_on IS NULL OR o.starts_on <= $2::date)
      AND (o.ends_on IS NULL OR o.ends_on >= $2::date) ORDER BY o.id`;
  return t ? (await t.query<OfferRow>(sql, [clean, today])).rows : q<OfferRow>(sql, [clean, today]);
}
// The default name of an offer: "২টা কিনলে ১টা ফ্রি"
function offerTitle(o: Pick<OffersRow, 'title' | 'get_product_id' | 'buy_qty' | 'get_qty' | 'get_percent'> & { get_name?: string | null }, bn: (x: unknown) => unknown = (x) => x): string {
  if (o.title) return o.title;
  const what = o.get_product_id ? (o.get_name || 'উপহার') : 'আরও';
  return `${bn(o.buy_qty)}টা কিনলে ${bn(o.get_qty)}টা ${o.get_product_id ? what + ' ' : ''}${o.get_percent >= 100 ? 'ফ্রি' : `${bn(o.get_percent)}% ছাড়ে`}`;
}
// Gift lines for paid lines [{ product_id, qty }]: [{ offer, product_id, qty, price, note }]
async function giftsFor(lines: { kind?: string; product_id?: number; qty: unknown }[] | null | undefined, t: Tx | null = null, bnFn?: (x: unknown) => unknown): Promise<GiftLine[]> {
  const paid = new Map<number, number>();
  (lines || []).forEach((l) => { if (l.kind !== 'gift' && l.product_id) paid.set(l.product_id, (paid.get(l.product_id) || 0) + int(l.qty)); });
  if (!paid.size) return [];
  const offers = await offersFor([...paid.keys()], t);
  const out: GiftLine[] = [];
  const seen = new Set<string>(); // the same "buy this → get that" twice (made by mistake) counts once
  for (const o of offers) {
    const key = `${o.buy_product_id}:${o.get_product_id || o.buy_product_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const have = paid.get(o.buy_product_id) || 0;
    const times = Math.min(Math.floor(have / Math.max(1, o.buy_qty)), Math.max(1, o.max_times));
    if (times < 1) continue;
    const pid = o.get_product_id || o.buy_product_id;
    if (o.get_product_id && !o.get_active) continue;
    let base: number | null = o.get_product_id ? Number(o.get_base) : null;
    if (base === null) {
      const sql = 'SELECT price FROM products WHERE id=$1';
      const row = t ? (await t.query<{ price: number }>(sql, [pid])).rows[0] : (await q<{ price: number }>(sql, [pid]))[0];
      base = row ? Number(row.price) : 0;
    }
    const pct = Math.min(100, Math.max(1, int(o.get_percent, 100)));
    out.push({ offer: o, product_id: pid, qty: times * Math.max(1, o.get_qty), price: r2(base * (100 - pct) / 100), note: `🎁 অফার: ${offerTitle(o, bnFn)}`.slice(0, 120) });
  }
  return out;
}

// What the cart will cost, for the cart and checkout pages. items = [{ id, qty }] (from the browser).
async function quote(items: unknown) {
  const catalog = $models_catalog;
  const want = new Map<number, number>();
  for (const x of (Array.isArray(items) ? items : []).slice(0, 60)) {
    const it = fields(x);
    const id = int(it && it.id); const qty = Math.min(999, int(it && it.qty));
    if (id > 0 && qty > 0) want.set(id, (want.get(id) || 0) + qty);
  }
  const ids = [...want.keys()];
  if (!ids.length) return { lines: [], gifts: [], subtotal: 0 };
  const [prods, tiers, flash] = await Promise.all([catalog.getProductsByIds(ids, { public: true }), tiersFor(ids), flashFor(ids)]);
  const lines = prods.map((p) => {
    const qty = want.get(p.id)!;
    const lp = linePrice({ base: p.base_price, qty, flash: flash.get(p.id), tiers: tiers.get(p.id) });
    return { id: p.id, product_id: p.id, qty, price: lp.price, base: Number(p.base_price), kind: lp.kind, note: lp.note,
      tiers: (tiers.get(p.id) || []).slice().reverse(), flash_left: Number.isFinite(flash.get(p.id)?.left) ? flash.get(p.id)!.left : null };
  });
  const gifts = await giftsFor(lines);
  const giftProds = gifts.length ? await catalog.getProductsByIds(gifts.map((g) => g.product_id), { public: true }) : [];
  const giftOut = gifts.map((g) => {
    const p = giftProds.find((x) => x.id === g.product_id);
    if (!p) return null;
    const q2 = Math.min(g.qty, Math.max(0, p.stock - (want.get(p.id) || 0)));
    if (q2 < 1) return null;
    return { id: p.id, name: p.name, slug: p.slug, qty: q2, price: g.price, note: g.note, image: p.image_id ? `/media/${p.image_id}/t` : null, emoji: p.emoji };
  }).filter((g): g is NonNullable<typeof g> => !!g);
  const subtotal = round2(lines.reduce((s: number, l) => s + l.price * l.qty, 0) + giftOut.reduce((s, g) => s + g.price * g.qty, 0));
  return { lines, gifts: giftOut, subtotal };
}

export { tiersFor, tierPrice, flashFor, linePrice, offersFor, offerTitle, giftsFor, quote };
