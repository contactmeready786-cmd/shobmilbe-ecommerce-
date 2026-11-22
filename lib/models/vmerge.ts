// 🧩 Merge into variants (owner, 2026-11-22): the same part copied in as many separate products — one per value
// (e.g. "50Pcs 100 Ohm Resistor 1/4W Carbon Film", "50Pcs 220 Ohm …") — becomes ONE product with a value picker,
// like the packaging products. One product = one ad, one page, every value inside.
//
// How (the shop's own variant system, lib/models/catalog.ts): a new main product is made, and each old product
// becomes one of its variants (parent_id) — so its SKU, barcode, stock, sold count, order history and old link all
// stay (an old link opens the main product with that value chosen). Prices become PER PIECE: the pack price ÷ the
// pieces in the pack ("50Pcs" at ৳39 → ৳0.78 a piece, never below the shop's ৳0.50), the same for the buying price,
// and the stock is counted in pieces (packs × pieces). The same value listed twice (10 pcs and 50 pcs) keeps the
// cheaper-per-piece one; the other's pieces are added to it and it goes to the recycle bin.
// Everything is written down (variant_merges) and one press on "Undo" puts it all back as it was.
//
// Group = kind (carbon film, metal film, …) + power (1/4 W, 1 W …) (+ size for SMD): only the same part in the same
// power is put together, as the owner asked — a 1 W product never gets a 1/4 W value.
import { q, one, tx, uniqueSlug } from '../db';
import { slugify } from '../util';
import * as catalog from './catalog';
import * as trash from './trash';
import type { Tx } from '../pg';
import type { ProductsRow } from '../data/rows';

import { parse, groupKey, groupNames, ohmLabel, ohmBn, perPiece, wattBn, bnNum, KINDS, type Parsed } from './vmerge-parse';

// ---------------------------------------------------------------- the plan (what would happen)
type Cand = Pick<ProductsRow, 'id' | 'sku' | 'name' | 'name_bn' | 'price' | 'old_price' | 'old_price_auto' | 'cost_price' | 'stock' | 'active' | 'category_id' | 'image_id' | 'sold_count' | 'import_ref' | 'slug'>;
export type PlanItem = Cand & { p: Parsed; label: string; unit_price: number; unit_old: number | null; unit_stock: number; dup_of?: number };
export type PlanGroup = { key: string; en: string; bn: string; items: PlanItem[]; dups: PlanItem[]; min: number; max: number };
export type Plan = { groups: PlanGroup[]; skipped: { id: number; sku: string; name: string; reason: string }[]; singles: PlanItem[] };

const MAX_IN_GROUP = 150;

export async function plan(): Promise<Plan> {
  const rows = await q<Cand>(`SELECT id, sku, name, name_bn, price, old_price, old_price_auto, cost_price, stock, active, category_id, image_id, sold_count, import_ref, slug
    FROM products WHERE parent_id IS NULL AND variant_count = 0 AND product_type = 'single' AND (name ~* 'resist' OR name_bn ~ 'রেজিস্ট')
    ORDER BY id`);
  const groups = new Map<string, PlanItem[]>();
  const skipped: Plan['skipped'] = [];
  for (const r of rows) {
    const p = parse(r.name);
    if ('reason' in p) { if (p.reason !== 'not a resistor') skipped.push({ id: r.id, sku: r.sku, name: r.name, reason: p.reason }); continue; }
    const item: PlanItem = { ...r, p, label: ohmLabel(p.ohm), unit_price: perPiece(Number(r.price), p.pcs), unit_old: null, unit_stock: Math.max(0, Number(r.stock) || 0) * p.pcs };
    const old = Number(r.old_price) || 0;
    item.unit_old = r.old_price_auto ? catalog.autoOldPrice(item.unit_price) : (old > Number(r.price) ? perPiece(old, p.pcs) : null);
    if (item.unit_old !== null && item.unit_old <= item.unit_price) item.unit_old = null;
    const k = groupKey(p, (r.import_ref || '').split('#')[0]);
    groups.set(k, [...(groups.get(k) || []), item]);
  }
  const out: PlanGroup[] = [];
  const singles: PlanItem[] = [];
  for (const [key, list] of groups) {
    // a pack whose name doesn't say how many pieces ("2Watt 15 Ohm Resistor" at the 10-piece price): when the price
    // only makes sense as the usual pack of this group, count it as that pack
    const counts = new Map<number, number>();
    for (const it of list) counts.set(it.p.pcs, (counts.get(it.p.pcs) || 0) + 1);
    const usual = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const unitPrices = list.filter((i) => i.p.pcs === usual).map((i) => i.unit_price).sort((a, b) => a - b);
    const median = unitPrices[Math.floor(unitPrices.length / 2)] || 0;
    if (usual > 1 && median > 0) {
      for (const it of list) {
        if (it.p.pcs !== 1) continue;
        const guess = Number(it.price) / usual;
        if (guess >= median / 2 && guess <= median * 2) {
          it.p = { ...it.p, pcs: usual };
          it.unit_price = perPiece(Number(it.price), usual);
          it.unit_stock = Math.max(0, Number(it.stock) || 0) * usual;
          const old = Number(it.old_price) || 0;
          it.unit_old = it.old_price_auto ? catalog.autoOldPrice(it.unit_price) : (old > Number(it.price) ? perPiece(old, usual) : null);
          if (it.unit_old !== null && it.unit_old <= it.unit_price) it.unit_old = null;
        }
      }
    }
    // the same value twice: keep the one that is switched on, then in stock, then the cheaper piece, then the older product
    const byOhm = new Map<number, PlanItem[]>();
    for (const it of list) byOhm.set(it.p.ohm, [...(byOhm.get(it.p.ohm) || []), it]);
    const items: PlanItem[] = [];
    const dups: PlanItem[] = [];
    for (const same of byOhm.values()) {
      same.sort((a, b) => Number(b.active) - Number(a.active) || Number(Number(b.stock) > 0) - Number(Number(a.stock) > 0) || a.unit_price - b.unit_price || a.id - b.id);
      items.push(same[0]);
      for (const d of same.slice(1)) dups.push({ ...d, dup_of: same[0].id });
    }
    items.sort((a, b) => a.p.ohm - b.p.ohm);
    if (items.length < 2) { singles.push(...items); continue; }
    const names = groupNames(items[0].p);
    const prices = items.map((i) => i.unit_price);
    out.push({ key, en: names.en, bn: names.bn, items: items.slice(0, MAX_IN_GROUP), dups, min: Math.min(...prices), max: Math.max(...prices) });
  }
  out.sort((a, b) => b.items.length - a.items.length);
  return { groups: out, skipped, singles };
}

// ---------------------------------------------------------------- doing it
type Before = Pick<ProductsRow, 'id' | 'name' | 'name_bn' | 'price' | 'old_price' | 'cost_price' | 'stock' | 'noindex' | 'image_id' | 'pack_sizes' | 'sold_count' | 'category_id'> & { tiers: { min_qty: number; price: number }[]; pcs: number };
export type MergeLog = { parent_id: number; key: string; children: Before[]; binned: { id: number; trash_id: number | null; into: number; pcs: number; stock: number; sold: number }[] };

function descriptions(p: Parsed, n: number, tol: string): { short: string; long: string } {
  const k = KINDS[p.kind];
  const facts = [
    `ধরন: ${k.bn}`,
    p.watt ? `পাওয়ার রেটিং: ${wattBn(p.watt)}` : '',
    p.pkg ? `সাইজ (প্যাকেজ): ${bnNum(p.pkg)}` : '',
    tol ? `টলারেন্স: ±${bnNum(tol)}%` : '',
    p.ni ? 'নন-ইন্ডাক্টিভ' : '',
    p.fp ? 'ফ্লেমপ্রুফ' : '',
    p.kind === 'smd' ? '' : 'দুই পিন লিড (থ্রু-হোল)',
  ].filter(Boolean);
  const short = `${facts.join(' · ')}। দাম প্রতি পিস; ${bnNum(String(n))}টি মান (ওহম) পাওয়া যায়।`;
  const long = [`${wattBn(p.watt) ? wattBn(p.watt) + ' ' : ''}${k.bn} — ফিক্সড রেজিস্টর, সার্কিটে কারেন্ট সীমিত বা ভোল্টেজ ভাগ করতে ব্যবহার হয়।`, '', ...facts.map((f) => `- ${f}`)].join('\n');
  return { short, long };
}

/** Merge one group (by its key, as the plan shows it). Returns the new main product's id. */
export async function merge(key: string, who: { id?: number | null; name?: string; ip?: string } = {}): Promise<number> {
  const g = (await plan()).groups.find((x) => x.key === key);
  if (!g) throw new Error('This group is no longer there (already merged, or the products changed).');
  const log: MergeLog = { parent_id: 0, key, children: [], binned: [] };
  const parentId = await tx(async (t: Tx) => {
    const ids = g.items.map((i) => i.id);
    const locked = (await t.query<Pick<ProductsRow, 'id' | 'parent_id' | 'variant_count'>>('SELECT id, parent_id, variant_count FROM products WHERE id = ANY($1::int[]) FOR UPDATE', [ids])).rows;
    if (locked.length !== ids.length || locked.some((r) => r.parent_id || r.variant_count)) throw new Error('Some of these products changed just now — open the page again.');
    const first = g.items[0];
    // the category most of them are in; a picture from a product that has one
    const cats = new Map<number, number>();
    for (const i of g.items) if (i.category_id) cats.set(i.category_id, (cats.get(i.category_id) || 0) + 1);
    const category = [...cats.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    const pic = (g.items.find((i) => i.image_id && i.active) || g.items.find((i) => i.image_id))?.image_id ?? null;
    const tols = [...new Set(g.items.map((i) => i.p.tol).filter(Boolean))];
    const d = descriptions(first.p, g.items.length, tols.length === 1 ? tols[0] : '');
    const sku = await catalog.takeSku(t);
    const slug = await uniqueSlug('products', slugify(g.en).slice(0, 80) || 'resistor');
    const host = (first.import_ref || '').split('#')[0];
    const pid = (await t.query<{ id: number }>(`INSERT INTO products(name, name_bn, name_bn_auto, slug, category_id, price, stock, description, short_description, emoji, active, sku,
        product_type, image_id, unit, variant_title, import_ref, sold_count)
      VALUES($1,$2,false,$3,$4,$5,0,$6,$7,'🔩',$8,$9,'single',$10,'পিস','মান (ওহম)',$11,$12) RETURNING id`,
    [g.en, g.bn, slug, category, g.min, d.long, d.short, g.items.some((i) => i.active), sku, pic, host ? `${host}#variants:${key}` : '',
      g.items.reduce((s, i) => s + (Number(i.sold_count) || 0), 0) + g.dups.reduce((s, i) => s + (Number(i.sold_count) || 0), 0)])).rows[0].id;
    let sort = 0;
    for (const it of g.items) {
      sort += 1;
      const cur = (await t.query<ProductsRow>('SELECT * FROM products WHERE id=$1', [it.id])).rows[0];
      const tiers = (await t.query<{ min_qty: number; price: number }>('SELECT min_qty, price FROM price_tiers WHERE product_id=$1', [it.id])).rows;
      log.children.push({ id: cur.id, name: cur.name, name_bn: cur.name_bn, price: cur.price, old_price: cur.old_price, cost_price: cur.cost_price, stock: cur.stock,
        noindex: cur.noindex, image_id: cur.image_id, pack_sizes: cur.pack_sizes, sold_count: cur.sold_count, category_id: cur.category_id, tiers, pcs: it.p.pcs });
      if (tiers.length) await t.query('DELETE FROM price_tiers WHERE product_id=$1', [it.id]); // pack-price tiers mean nothing per piece
      const cost = it.p.pcs > 1 ? Math.round((Number(cur.cost_price) / it.p.pcs) * 100) / 100 : Number(cur.cost_price);
      await catalog.logPriceChange(t, it.id, cur, { price: it.unit_price, old_price: it.unit_old, name: cur.name }, who.id, 'ভ্যারিয়েন্টে একত্র (প্রতি পিস)');
      await t.query(`UPDATE products SET parent_id=$2, variant_label=$3, variant_sort=$4, price=$5, old_price=$6, old_price_auto=false, cost_price=$7,
          name_bn=$8, name_bn_auto=false, pack_sizes='', updated_at=now() WHERE id=$1`,
      [it.id, pid, it.label, sort, it.unit_price, it.unit_old, cost, `${g.bn} — ${ohmBn(it.p.ohm)}`]);
      // a pack was one piece of stock; now every piece counts
      const extra = Math.max(0, Number(cur.stock) || 0) * (it.p.pcs - 1);
      if (extra > 0) await catalog.moveStock(t, it.id, extra, 'adjust', 'product', pid, `প্যাক থেকে পিসে (${it.p.pcs} পিস/প্যাক)`, who.id ?? null);
    }
    // the same value listed twice: its pieces and sales go to the one that is kept; its old link opens the main product
    for (const dup of g.dups) {
      const pcs = Math.max(0, Number(dup.stock) || 0) * dup.p.pcs;
      if (pcs > 0 && dup.dup_of) await catalog.moveStock(t, dup.dup_of, pcs, 'adjust', 'product', dup.id, `একই মানের আরেকটা পণ্য (SKU ${dup.sku}) থেকে`, who.id ?? null);
      log.binned.push({ id: dup.id, trash_id: null, into: dup.dup_of || 0, pcs, stock: Number(dup.stock) || 0, sold: Number(dup.sold_count) || 0 });
    }
    await t.query(`UPDATE products SET image_id = coalesce(image_id, $2) WHERE parent_id=$1`, [pid, pic]);
    await catalog.syncVariants(t, pid);
    log.parent_id = pid;
    await t.query('INSERT INTO variant_merges(parent_id, key, name, data, staff_id) VALUES($1,$2,$3,$4,$5)', [pid, key, g.en, JSON.stringify(log), who.id ?? null]);
    return pid;
  });
  // duplicates: to the recycle bin (each in its own step, as the bin works), with their old link sent on
  const parent = await one<Pick<ProductsRow, 'slug'>>('SELECT slug FROM products WHERE id=$1', [parentId]);
  for (const b of log.binned) {
    const dup = g.dups.find((x) => x.id === b.id);
    if (dup && parent) await tx((t) => catalog.addRedirect(t, `/p/${dup.slug}`, `/p/${parent.slug}`));
    b.trash_id = (await trash.move('product', b.id, { id: who.id ?? null, name: who.name || '', path: '/admin/products/merge-variants', ip: who.ip || '' })) ?? null;
  }
  if (log.binned.length) await q(`UPDATE variant_merges SET data=$2 WHERE parent_id=$1 AND undone_at IS NULL`, [parentId, JSON.stringify(log)]);
  return parentId;
}

/** Put a merge back exactly as it was (the products alone again, pack prices, pack stock); the main product is removed. */
export async function undo(mergeId: number, who: { id?: number | null } = {}): Promise<void> {
  const m = await one<{ id: number; data: MergeLog; undone_at: Date | null }>('SELECT id, data, undone_at FROM variant_merges WHERE id=$1', [mergeId]);
  if (!m || m.undone_at) throw new Error('Nothing to undo.');
  const log = m.data;
  for (const b of log.binned) {
    if (b.trash_id) await trash.restore(b.trash_id).catch(() => null);
  }
  await tx(async (t) => {
    for (const b of log.binned) {
      if (b.pcs > 0 && b.into) await catalog.moveStock(t, b.into, -b.pcs, 'adjust', 'product', b.id, 'একত্র করা ফেরত', who.id ?? null);
    }
    for (const c of log.children) {
      const cur = (await t.query<Pick<ProductsRow, 'id' | 'stock' | 'parent_id'>>('SELECT id, stock, parent_id FROM products WHERE id=$1 FOR UPDATE', [c.id])).rows[0];
      if (!cur || cur.parent_id !== log.parent_id) continue;
      // pieces back to packs (pieces sold since then come off whole packs, never below 0)
      const packs = c.pcs > 1 ? Math.floor(Math.max(0, Number(cur.stock)) / c.pcs) : Number(cur.stock);
      const change = packs - Number(cur.stock);
      if (change) await catalog.moveStock(t, c.id, change, 'adjust', 'product', log.parent_id, 'একত্র করা ফেরত (পিস থেকে প্যাক)', who.id ?? null);
      await t.query(`UPDATE products SET parent_id=NULL, variant_label='', variant_sort=0, name=$2, name_bn=$3, price=$4, old_price=$5, cost_price=$6,
          noindex=$7, image_id=$8, pack_sizes=$9, category_id=$10, updated_at=now() WHERE id=$1`,
      [c.id, c.name, c.name_bn, c.price, c.old_price, c.cost_price, c.noindex, c.image_id, c.pack_sizes, c.category_id]);
      for (const tr of c.tiers) await t.query('INSERT INTO price_tiers(product_id, min_qty, price) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [c.id, tr.min_qty, tr.price]);
    }
    const parent = (await t.query<Pick<ProductsRow, 'slug'>>('SELECT slug FROM products WHERE id=$1', [log.parent_id])).rows[0];
    if (parent) await t.query('DELETE FROM redirects WHERE to_path=$1', [`/p/${parent.slug}`]);
    await t.query('DELETE FROM products WHERE id=$1 AND NOT EXISTS (SELECT 1 FROM products v WHERE v.parent_id=$1)', [log.parent_id]);
    await t.query('UPDATE variant_merges SET undone_at=now() WHERE id=$1', [m.id]);
  });
}

export async function history() {
  return q<{ id: number; parent_id: number; name: string; created_at: Date; undone_at: Date | null; n: number; dups: number; slug: string | null }>(`SELECT m.id, m.parent_id, m.name, m.created_at, m.undone_at,
      jsonb_array_length(m.data->'children')::int AS n, jsonb_array_length(m.data->'binned')::int AS dups, p.slug
    FROM variant_merges m LEFT JOIN products p ON p.id=m.parent_id ORDER BY m.id DESC LIMIT 50`);
}
