// 📦 Packing costs (owner, 2026-10-23). A parcel costs more than the goods in it: the box, the tape, the invoice
// sticker or the cello poly. The owner lists those things once (Admin → হিসাব → লাভ-ক্ষতি → 📦 প্যাকিং খরচ) with
// their cost per use — a ৳12.50 box is used once; a ৳55 tape roll does about 25 boxes, so one use is ৳2.20 — puts
// them into ready-made sets ("৩ নং বক্স সেট" = box + tape + sticker), and gives each product (or a whole category)
// its set. One set (invoice sticker / cello poly) can go on every order once.
//
// When an order goes to the courier (or is marked delivered straight away), what it used is written down in
// order_packing at that day's prices: that is the real packing cost in profit & loss. A thing that is also a shop
// product (the shop sells boxes too) can be taken from that product's stock. When a returned parcel's box is still
// good, the owner marks it "reused": its cost leaves the order and the box goes back on the shelf.
import { q, one } from '../db';
import { int, str, amount, round2 } from '../util';
import * as catalog from './catalog';
import type { OrderPackingRow, PackingItemsRow, PackingSetsRow } from '../data/rows';
import type { Id } from '../types';
import type { Tx } from '../pg';

export type SetLine = { item_id: number; qty: number };
export type PackingItem = PackingItemsRow & { unit_cost: number; product_name: string | null; product_stock: number | null };
export type PackingSet = Omit<PackingSetsRow, 'items'> & { items: SetLine[] };

/** One use of a thing: its price ÷ how many parcels it does (a box: 1; a tape roll: about 25). */
export function unitCost(item: { buy_price: number | string; uses: number | string }): number {
  return Math.round((Number(item.buy_price) / Math.max(1, Number(item.uses) || 1)) * 10000) / 10000;
}
/** What a set costs, with the things' current prices. */
export function setCost(set: { items: SetLine[] } | null | undefined, items: Map<number, { buy_price: number; uses: number }>): number {
  if (!set) return 0;
  return round2(set.items.reduce((s, l) => { const it = items.get(l.item_id); return it ? s + unitCost(it) * Number(l.qty) : s; }, 0));
}
const lines = (v: unknown): SetLine[] => (Array.isArray(v) ? v : [])
  .map((l: { item_id?: unknown; qty?: unknown }) => ({ item_id: int(l.item_id), qty: Math.round(Number(l.qty) * 1000) / 1000 }))
  .filter((l) => l.item_id > 0 && l.qty > 0);

export async function listItems(): Promise<PackingItem[]> {
  const rows = await q<PackingItemsRow & { product_name: string | null; product_stock: number | null }>(`SELECT i.*, p.name AS product_name, p.stock AS product_stock
    FROM packing_items i LEFT JOIN products p ON p.id=i.product_id ORDER BY i.active DESC, i.name`);
  return rows.map((r) => ({ ...r, unit_cost: unitCost(r) }));
}
export async function listSets(): Promise<PackingSet[]> {
  return (await q<PackingSetsRow>('SELECT * FROM packing_sets ORDER BY active DESC, name')).map((r) => ({ ...r, items: lines(r.items) }));
}
export async function itemMap(): Promise<Map<number, PackingItem>> {
  return new Map((await listItems()).map((i) => [i.id, i]));
}

export async function saveItem(data: { id?: unknown; name?: unknown; buy_price?: unknown; uses?: unknown; product_id?: unknown; note?: unknown; active?: unknown }): Promise<number> {
  const name = str(data.name, 80);
  if (!name) throw new Error('জিনিসের নাম দিন (যেমন ৩ নং বক্স)।');
  const price = amount(data.buy_price);
  if (price <= 0) throw new Error('কেনা দাম দিন।');
  const uses = Math.max(1, Math.min(10000, int(data.uses, 1)));
  const pid = int(data.product_id) || null;
  const f = [name, price, uses, pid, str(data.note, 200), data.active === undefined ? true : !!data.active];
  if (int(data.id)) {
    await q('UPDATE packing_items SET name=$1, buy_price=$2, uses=$3, product_id=$4, note=$5, active=$6 WHERE id=$7', [...f, int(data.id)]);
    return int(data.id);
  }
  return (await one<{ id: number }>('INSERT INTO packing_items(name, buy_price, uses, product_id, note, active) VALUES($1,$2,$3,$4,$5,$6) RETURNING id', f))!.id;
}
export async function saveSet(data: { id?: unknown; name?: unknown; per?: unknown; items?: unknown; active?: unknown }): Promise<number> {
  const name = str(data.name, 80);
  if (!name) throw new Error('সেটের নাম দিন (যেমন ৩ নং বক্স সেট)।');
  const items = lines(data.items);
  if (!items.length) throw new Error('সেটে অন্তত একটা জিনিস দিন।');
  const per = data.per === 'line' ? 'line' : 'piece';
  const f = [name, per, JSON.stringify(items), data.active === undefined ? true : !!data.active];
  if (int(data.id)) {
    await q('UPDATE packing_sets SET name=$1, per=$2, items=$3, active=$4 WHERE id=$5', [...f, int(data.id)]);
    return int(data.id);
  }
  return (await one<{ id: number }>('INSERT INTO packing_sets(name, per, items, active) VALUES($1,$2,$3,$4) RETURNING id', f))!.id;
}

/** The set a product is packed with: its own, else its main product's (a colour / size), else its category's
 *  (or the category above it). */
export async function setIdFor(t: Tx | null, productId: number): Promise<number | null> {
  const sql = `SELECT coalesce(p.packing_set_id, pp.packing_set_id, c.packing_set_id, cp.packing_set_id) AS sid
    FROM products p LEFT JOIN products pp ON pp.id=p.parent_id
    LEFT JOIN categories c ON c.id=coalesce(p.category_id, pp.category_id) LEFT JOIN categories cp ON cp.id=c.parent_id
    WHERE p.id=$1`;
  const r = t ? (await t.query<{ sid: number | null }>(sql, [productId])).rows[0] : await one<{ sid: number | null }>(sql, [productId]);
  return r?.sid ?? null;
}

type Need = { item: PackingItemsRow; qty: number };
/** What an order needs: each line's set (per piece or once per line) + the order's own set once. */
async function needsFor(t: Tx, orderId: number, orderSetId: number | null): Promise<Need[]> {
  const items = new Map((await t.query<PackingItemsRow>('SELECT * FROM packing_items')).rows.map((i) => [i.id, i]));
  const sets = new Map((await t.query<PackingSetsRow>('SELECT * FROM packing_sets WHERE active')).rows.map((s) => [s.id, { ...s, items: lines(s.items) }]));
  const want = new Map<number, number>();
  const add = (setId: number | null | undefined, times: number) => {
    const set = setId ? sets.get(setId) : null;
    if (!set || times <= 0) return;
    for (const l of set.items) want.set(l.item_id, (want.get(l.item_id) || 0) + l.qty * times);
  };
  const ol = (await t.query<{ product_id: number | null; qty: number }>('SELECT product_id, qty FROM order_items WHERE order_id=$1', [orderId])).rows;
  for (const l of ol) {
    if (!l.product_id) continue;
    const sid = await setIdFor(t, l.product_id);
    const set = sid ? sets.get(sid) : null;
    if (set) add(sid, set.per === 'line' ? 1 : Number(l.qty));
  }
  if (ol.length) add(orderSetId, 1);
  return [...want].map(([id, qty]) => ({ item: items.get(id)!, qty: Math.round(qty * 1000) / 1000 })).filter((n) => n.item && n.item.active);
}

/** Write down what the order used (once — again only after its packing was marked reused). Inside the status change. */
export async function recordForOrder(t: Tx, orderId: number, staffId: Id = null): Promise<number> {
  const orderSet = int((await t.query<{ value: string }>(`SELECT value FROM settings WHERE key='packing_order_set'`)).rows[0]?.value) || null;
  const had = (await t.query<{ n: number }>(`SELECT count(*)::int AS n FROM order_packing WHERE order_id=$1 AND state='used'`, [orderId])).rows[0].n;
  if (had) return 0;
  let total = 0;
  for (const n of await needsFor(t, orderId, orderSet)) {
    const uc = unitCost(n.item);
    const cost = round2(uc * n.qty);
    // a thing that is a shop product and used whole (a box, not a bit of tape) comes out of that product's stock
    let taken = 0;
    if (n.item.product_id && Number(n.item.uses) === 1 && Number.isInteger(n.qty)) {
      const ok = await catalog.moveStock(t, n.item.product_id, -n.qty, 'packing', 'order', orderId, 'অর্ডারের প্যাকিংয়ে ব্যবহার', staffId);
      if (ok) taken = n.qty;
    }
    await t.query(`INSERT INTO order_packing(order_id, item_id, name, qty, unit_cost, cost, product_id, stock_taken) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
      [orderId, n.item.id, n.item.name, n.qty, uc, cost, n.item.product_id, taken]);
    total += cost;
  }
  return round2(total);
}

/** A returned parcel's packing is still good: its cost leaves the order, whole things go back on the shelf. */
export async function markReused(t: Tx, orderId: number, staffId: Id = null): Promise<number> {
  const rows = (await t.query<OrderPackingRow>(`SELECT * FROM order_packing WHERE order_id=$1 AND state='used' FOR UPDATE`, [orderId])).rows;
  for (const r of rows) {
    if (r.product_id && r.stock_taken > 0) await catalog.moveStock(t, r.product_id, r.stock_taken, 'packing_back', 'order', orderId, 'ফেরত আসা প্যাকিং আবার ব্যবহারযোগ্য', staffId);
  }
  await t.query(`UPDATE order_packing SET state='reused', reused_at=now() WHERE order_id=$1 AND state='used'`, [orderId]);
  return rows.length;
}

export async function forOrder(orderId: Id): Promise<OrderPackingRow[]> {
  return q<OrderPackingRow>('SELECT * FROM order_packing WHERE order_id=$1 ORDER BY id', [int(orderId)]);
}
/** Packing used in a period (for profit & loss): what was really spent, minus what came back for reuse. */
export async function totalBetween(from: string, to: string): Promise<{ cost: number; orders: number }> {
  const r = await one<{ cost: number; orders: number }>(`SELECT coalesce(sum(cost),0)::numeric(14,2) AS cost, count(DISTINCT order_id)::int AS orders
    FROM order_packing WHERE state='used' AND (created_at AT TIME ZONE 'Asia/Dhaka')::date BETWEEN $1 AND $2`, [from, to]).catch(() => null);
  return { cost: Number(r?.cost || 0), orders: Number(r?.orders || 0) };
}
/** What one piece of a product costs to pack (its set; a set per line counted once), for the product page. */
export async function costForProduct(productId: number): Promise<{ setName: string; cost: number; per: string } | null> {
  const sid = await setIdFor(null, productId).catch(() => null);
  if (!sid) return null;
  const set = (await listSets()).find((s) => s.id === sid);
  if (!set) return null;
  return { setName: set.name, cost: setCost(set, await itemMap()), per: set.per };
}
