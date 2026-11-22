// 1️⃣ Pack → single piece (owner, 2026-11-22): "everything on my site is sold by the piece; whoever needs more takes
// more". Products copied in as packs ("50Pcs- 100 Ohm Resistor" at ৳71, "LDR 5mm 10Pcs" …) become one piece: the
// pieces part leaves the name (English, Bangla, SEO title, descriptions), the price and buying price are divided by the
// pieces (rounded up to whole paisa, never below ৳0.50), the stock is counted in pieces, pack price tiers go.
// Sets / kits / combos stay as they are (packsingle-parse SET_WORDS), and so do packaging products (sold in packs on
// purpose, pack_sizes) and variants. Every change is written down (pack_singles) and "Undo" puts it back.
import { q, one, tx } from '../db';
import * as catalog from './catalog';
import { perPiece } from './vmerge-parse';
import { readPack, cleanBn, cleanText } from './packsingle-parse';
import { readPairs, cleanPairText } from './pairsingle-parse';
import type { ProductsRow } from '../data/rows';

type Row = Pick<ProductsRow, 'id' | 'sku' | 'name' | 'name_bn' | 'price' | 'old_price' | 'old_price_auto' | 'cost_price' | 'stock' | 'active' | 'image_id'>;
export type Kind = 'pcs' | 'pair';
export type Cand = Row & { pcs: number; new_name: string; new_bn: string; unit_price: number; unit_old: number | null };
export type Skipped = { id: number; sku: string; name: string; reason: string };

export async function plan(kind: Kind = 'pcs'): Promise<{ items: Cand[]; skipped: Skipped[] }> {
  if (kind === 'pair') return planPairs();
  const rows = await q<Row>(`SELECT p.id, p.sku, p.name, p.name_bn, p.price, p.old_price, p.old_price_auto, p.cost_price, p.stock, p.active, p.image_id
    FROM products p LEFT JOIN categories c ON c.id = p.category_id LEFT JOIN categories c2 ON c2.id = c.parent_id
    WHERE p.parent_id IS NULL AND p.variant_count = 0 AND p.product_type = 'single' AND coalesce(p.pack_sizes, '') = ''
      AND NOT coalesce(c.no_free_delivery, false) AND NOT coalesce(c2.no_free_delivery, false)
      AND (p.name ~* '\\d\\s*-?\\s*(pcs|pc|pieces?|psc|nos)([^a-z]|$)|(pack|packet|lot)\\s*of\\s*\\d' OR p.name_bn ~ '[০-৯0-9]\\s*পিস')
    ORDER BY p.id`);
  const items: Cand[] = [];
  const skipped: Skipped[] = [];
  for (const r of rows) {
    const p = readPack(r.name);
    if ('skip' in p) { skipped.push({ id: r.id, sku: r.sku, name: r.name, reason: p.skip }); continue; }
    // a piece that would cost under ৳0.40 (1000 staples, 500 zip bags) can't be sold alone at the shop's ৳0.50 floor
    if (Number(r.price) / p.pcs < 0.4) { skipped.push({ id: r.id, sku: r.sku, name: r.name, reason: 'one piece would cost under ৳0.40 — kept as a pack' }); continue; }
    const unit = perPiece(Number(r.price), p.pcs);
    const old = Number(r.old_price) || 0;
    let unitOld = r.old_price_auto ? catalog.autoOldPrice(unit) : (old > Number(r.price) ? perPiece(old, p.pcs) : null);
    // an old price over twice the price is a copying mistake at the source — no fake big discount
    if (unitOld !== null && (unitOld <= unit || unitOld > unit * 2)) unitOld = null;
    items.push({ ...r, pcs: p.pcs, new_name: p.name, new_bn: cleanBn(r.name_bn, p.pcs), unit_price: unit, unit_old: unitOld });
  }
  return { items, skipped };
}

// 👟 Pairs → one pair (owner, 2026-11-23): "2 Pairs …" / "৩ জোড়া …" become one pair — price, buying price ÷ pairs,
// stock × pairs, "(1 Pair)" in the name. Same rules otherwise as packs (variants, sets, packaging left alone).
const BN_PAIR_SQL = '[০-৯0-9]\\s*(জো(\u09dc|\u09a1\u09bc|র)া|পে(\u09df|\u09af\u09bc)ার)';
async function planPairs(): Promise<{ items: Cand[]; skipped: Skipped[] }> {
  const rows = await q<Row>(`SELECT p.id, p.sku, p.name, p.name_bn, p.price, p.old_price, p.old_price_auto, p.cost_price, p.stock, p.active, p.image_id
    FROM products p LEFT JOIN categories c ON c.id = p.category_id LEFT JOIN categories c2 ON c2.id = c.parent_id
    WHERE p.parent_id IS NULL AND p.variant_count = 0 AND p.product_type = 'single' AND coalesce(p.pack_sizes, '') = ''
      AND NOT coalesce(c.no_free_delivery, false) AND NOT coalesce(c2.no_free_delivery, false)
      AND (p.name ~* '\\d\\s*-?\\s*(pairs?|prs)([^a-z]|$)|(pack|packet|lot|set|bundle)\\s*of\\s*\\d+\\s*pairs?' OR p.name_bn ~ $1)
    ORDER BY p.id`, [BN_PAIR_SQL]);
  const items: Cand[] = [];
  const skipped: Skipped[] = [];
  for (const r of rows) {
    const p = readPairs(r.name, r.name_bn);
    if ('skip' in p) { skipped.push({ id: r.id, sku: r.sku, name: r.name, reason: p.skip }); continue; }
    const unit = perPiece(Number(r.price), p.pairs);
    const old = Number(r.old_price) || 0;
    let unitOld = r.old_price_auto ? catalog.autoOldPrice(unit) : (old > Number(r.price) ? perPiece(old, p.pairs) : null);
    if (unitOld !== null && (unitOld <= unit || unitOld > unit * 2)) unitOld = null;
    items.push({ ...r, pcs: p.pairs, new_name: p.name, new_bn: p.bn || r.name_bn, unit_price: unit, unit_old: unitOld });
  }
  return { items, skipped };
}

type Before = Pick<ProductsRow, 'id' | 'name' | 'name_bn' | 'price' | 'old_price' | 'old_price_auto' | 'cost_price' | 'stock' | 'seo_title' | 'seo_description' | 'seo_keywords' | 'short_description' | 'description'> & { pcs: number; tiers: { min_qty: number; price: number }[] };

/** Make the given products (or every one the plan finds) single pieces. Returns how many changed. */
export async function apply(ids: number[] | null, who: { id?: number | null } = {}, kind: Kind = 'pcs'): Promise<number> {
  const p = await plan(kind);
  const clean = kind === 'pair' ? cleanPairText : cleanText;
  const pick = ids ? p.items.filter((i) => ids.includes(i.id)) : p.items;
  if (!pick.length) return 0;
  const log: Before[] = [];
  await tx(async (t) => {
    for (const it of pick) {
      const cur = (await t.query<ProductsRow>('SELECT * FROM products WHERE id=$1 FOR UPDATE', [it.id])).rows[0];
      if (!cur || cur.parent_id || cur.variant_count || cur.name !== it.name) continue; // changed meanwhile
      const tiers = (await t.query<{ min_qty: number; price: number }>('SELECT min_qty, price FROM price_tiers WHERE product_id=$1', [it.id])).rows;
      log.push({ id: cur.id, name: cur.name, name_bn: cur.name_bn, price: cur.price, old_price: cur.old_price, old_price_auto: cur.old_price_auto, cost_price: cur.cost_price,
        stock: cur.stock, seo_title: cur.seo_title, seo_description: cur.seo_description, seo_keywords: cur.seo_keywords, short_description: cur.short_description,
        description: cur.description, pcs: it.pcs, tiers });
      if (tiers.length) await t.query('DELETE FROM price_tiers WHERE product_id=$1', [it.id]);
      const cost = Math.round((Number(cur.cost_price) / it.pcs) * 100) / 100;
      await catalog.logPriceChange(t, it.id, cur, { price: it.unit_price, old_price: it.unit_old, name: it.new_name }, who.id, kind === 'pair' ? 'এক জোড়ায় (একাধিক জোড়া থেকে)' : 'এক পিসে (প্যাক থেকে)');
      await t.query(`UPDATE products SET name=$2, name_bn=$3, price=$4, old_price=$5, old_price_auto=false, cost_price=$6,
          seo_title=$7, seo_description=$8, seo_keywords=$9, short_description=$10, description=$11, updated_at=now() WHERE id=$1`,
      [it.id, it.new_name.slice(0, 200), it.new_bn || cur.name_bn, it.unit_price, it.unit_old, cost,
        clean(cur.seo_title, it.pcs), clean(cur.seo_description, it.pcs), clean(cur.seo_keywords, it.pcs),
        clean(cur.short_description, it.pcs), clean(cur.description, it.pcs)]);
      const extra = Math.max(0, Number(cur.stock) || 0) * (it.pcs - 1);
      if (extra > 0) await catalog.moveStock(t, it.id, extra, 'adjust', 'product', it.id, kind === 'pair' ? `একাধিক জোড়া থেকে এক জোড়ায় (${it.pcs} জোড়া/লিস্টিং)` : `প্যাক থেকে পিসে (${it.pcs} পিস/প্যাক)`, who.id ?? null);
    }
    if (log.length) await t.query('INSERT INTO pack_singles(n, data, staff_id, kind) VALUES($1,$2,$3,$4)', [log.length, JSON.stringify(log), who.id ?? null, kind]);
  });
  return log.length;
}

/** Put one change back: names, texts, pack prices, pack stock (pieces sold since come off whole packs). */
export async function undo(batchId: number, who: { id?: number | null } = {}): Promise<void> {
  const b = await one<{ id: number; data: Before[]; undone_at: Date | null }>('SELECT id, data, undone_at FROM pack_singles WHERE id=$1', [batchId]);
  if (!b || b.undone_at) throw new Error('Nothing to undo.');
  await tx(async (t) => {
    for (const c of b.data) {
      const cur = (await t.query<Pick<ProductsRow, 'id' | 'stock'>>('SELECT id, stock FROM products WHERE id=$1 FOR UPDATE', [c.id])).rows[0];
      if (!cur) continue;
      const packs = Math.floor(Math.max(0, Number(cur.stock)) / c.pcs);
      if (packs !== Number(cur.stock)) await catalog.moveStock(t, c.id, packs - Number(cur.stock), 'adjust', 'product', c.id, 'এক পিস ফেরত (পিস থেকে প্যাক)', who.id ?? null);
      await t.query(`UPDATE products SET name=$2, name_bn=$3, price=$4, old_price=$5, old_price_auto=$6, cost_price=$7, seo_title=$8, seo_description=$9,
          seo_keywords=$10, short_description=$11, description=$12, updated_at=now() WHERE id=$1`,
      [c.id, c.name, c.name_bn, c.price, c.old_price, c.old_price_auto, c.cost_price, c.seo_title, c.seo_description, c.seo_keywords, c.short_description, c.description]);
      for (const tr of c.tiers) await t.query('INSERT INTO price_tiers(product_id, min_qty, price) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [c.id, tr.min_qty, tr.price]);
    }
    await t.query('UPDATE pack_singles SET undone_at=now() WHERE id=$1', [b.id]);
  });
}

export async function history(kind: Kind = 'pcs') {
  return q<{ id: number; n: number; created_at: Date; undone_at: Date | null }>('SELECT id, n, created_at, undone_at FROM pack_singles WHERE kind=$1 ORDER BY id DESC LIMIT 30', [kind]);
}

/** Products made one pair and not undone — their pictures may still say "2 Pairs" (owner changes those by hand). */
export async function pairChanged() {
  return q<{ id: number; sku: string; name: string; image_id: number | null }>(`SELECT DISTINCT ON (p.id) p.id, p.sku, p.name, p.image_id
    FROM pack_singles b CROSS JOIN LATERAL jsonb_array_elements(b.data) e JOIN products p ON p.id = (e->>'id')::int
    WHERE b.kind = 'pair' AND b.undone_at IS NULL ORDER BY p.id`);
}
