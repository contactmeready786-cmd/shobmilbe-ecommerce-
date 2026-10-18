// 🧰 প্রজেক্ট কিট — like a "PC builder" for electronics projects. The owner makes a kit ("ব্লুটুথ স্পিকার বানান"):
// a list of parts with how many of each, some marked "ঐচ্ছিক". On the kit's page the customer ticks off what they
// already have, changes amounts, and adds everything else to the cart in one tap. Each part stays its own product
// (own stock, own price, own SKU) — unlike a bundle, which is sold as one product.
import * as db from '../db';
import { str, int, slugify } from '../util';
import * as $catalog from './catalog';
import * as $data_guides from '../data/guides';
import type { Body, Id, Loose } from '../types';
import type { KitsRow, ProductsRow } from '../data/rows';

class KitError extends Error {}

type ListOpts = {
  activeOnly?: boolean;
};
async function list({ activeOnly = false }: ListOpts = {}) {
  return db.q<{ id: number; slug: string; title: string; description: string; image_id: number | null; emoji: string; active: boolean; sort: number; created_at: Date; updated_at: Date; steps: string; level: string; duration: string; guide_key: string; parts: number; base_total: number | null }>(`SELECT k.*, (SELECT count(*)::int FROM kit_items i WHERE i.kit_id=k.id) AS parts,
      (SELECT coalesce(sum(p.price * i.qty), 0) FROM kit_items i JOIN products p ON p.id=i.product_id WHERE i.kit_id=k.id AND NOT i.optional) AS base_total
    FROM kits k ${activeOnly ? 'WHERE k.active' : ''} ORDER BY k.sort, k.id DESC`);
}
type GetOpts = {
  id?: string;
  slug?: string;
};
async function get({ id, slug }: GetOpts) {
  const k = await db.one(`SELECT * FROM kits WHERE ${id ? 'id=$1' : 'slug=$1'}`, [id ? int(id) : String(slug || '')]);
  if (!k) return null;
  k.items = await db.q<{ id: number; product_id: number; qty: number; optional: boolean; note: string; name: string; slug: string; sku: string; price: number; stock: number; image_id: number | null; emoji: string; active: boolean; variant_count: number; product_type: string }>(`SELECT i.id, i.product_id, i.qty, i.optional, i.note, p.name, p.slug, p.sku, p.price, p.stock, p.image_id, p.emoji, p.active,
      p.variant_count, p.product_type
    FROM kit_items i JOIN products p ON p.id=i.product_id WHERE i.kit_id=$1 ORDER BY i.optional, i.sort, i.id`, [k.id]);
  return k;
}
// The shop side: prices the customer pays now (flash sale counts), only parts that are switched on.
async function forShop(slug: string) {
  const k = await get({ slug });
  if (!k || !k.active) return null;
  const catalog = $catalog;
  const prods = await catalog.getProductsByIds(k.items.map((i: Loose) => i.product_id), { public: true });
  const byId = new Map(prods.map((p) => [p.id, p]));
  k.items = k.items.filter((i: { product_id: number; }) => byId.has(i.product_id)).map((i: { product_id: number; }) => ({ ...i, product: byId.get(i.product_id) }));
  return k;
}
async function kitsWith(productId?: Id) {
  return db.q<Pick<KitsRow, 'id' | 'slug' | 'title'>>(`SELECT DISTINCT k.id, k.slug, k.title FROM kits k JOIN kit_items i ON i.kit_id=k.id WHERE k.active AND i.product_id=$1 ORDER BY k.title LIMIT 5`, [int(productId)]);
}

type SaveOpts = {
  title?: Loose;
  "bundle_id[]"?: Loose;
  bundle_id?: Loose;
  "bundle_qty[]"?: Loose;
  bundle_qty?: Loose;
  "kit_opt[]"?: Loose;
  kit_opt?: Loose;
  "kit_note[]"?: Loose;
  kit_note?: Loose;
  id?: number;
  description?: Loose;
  image_id?: Loose;
  emoji?: Loose;
  active?: boolean;
  sort?: number;
  steps?: Loose;
  level?: Loose;
  duration?: Loose;
  slug?: Loose;
  guide_key?: Loose;
};
async function save(data: SaveOpts) {
  const title = str(data.title, 120).trim();
  if (title.length < 3) throw new KitError('কিটের নাম লিখুন।');
  const ids = ([] as unknown[]).concat(data['bundle_id[]'] || data.bundle_id || []).map(int);
  const qtys = ([] as unknown[]).concat(data['bundle_qty[]'] || data.bundle_qty || []).map((x) => Math.max(1, Math.min(999, int(x, 1))));
  const opt = new Set(([] as unknown[]).concat(data['kit_opt[]'] || data.kit_opt || []).map(int));
  const notes = ([] as unknown[]).concat(data['kit_note[]'] || data.kit_note || []);
  const rows: Loose[] = []; const seen = new Set();
  ids.forEach((pid, i) => { if (pid > 0 && !seen.has(pid)) { seen.add(pid); rows.push({ pid, qty: qtys[i] || 1, optional: opt.has(pid), note: str(notes[i], 120), sort: i }); } });
  if (!rows.length) throw new KitError('কিটে অন্তত একটা পণ্য যোগ করুন।');
  const bad = await db.q<Pick<ProductsRow, 'name'>>(`SELECT name FROM products WHERE id = ANY($1::int[]) AND (product_type='bundle' OR variant_count > 0)`, [rows.map((r) => r.pid)]);
  if (bad.length) throw new KitError(`"${bad[0].name}" কিটে রাখা যাবে না (বান্ডেল বা অপশনওয়ালা পণ্য)। এর একটা নির্দিষ্ট অপশন/পণ্য যোগ করুন।`);
  return db.tx(async (t) => {
    let id = int(data.id);
    const vals = [title, str(data.description, 5000), int(data.image_id) || null, str(data.emoji, 8) || '🧰', !!data.active, int(data.sort),
      cleanSteps(data.steps), str(data.level, 60), str(data.duration, 60)];
    if (id) {
      await t.query('UPDATE kits SET title=$1, description=$2, image_id=$3, emoji=$4, active=$5, sort=$6, steps=$7, level=$8, duration=$9, updated_at=now() WHERE id=$10', [...vals, id]);
    } else {
      let slug = String(data.slug || '').trim() || slugify(title) || 'kit';
      const stem = slug;
      for (let n = 2; (await t.query<{ "?column?": number | null }>('SELECT 1 FROM kits WHERE slug=$1', [slug])).rows.length; n++) slug = `${stem}-${n}`;
      id = (await t.query<Pick<KitsRow, 'id'>>(`INSERT INTO kits(title, description, image_id, emoji, active, sort, steps, level, duration, slug, guide_key)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`, [...vals, slug, str(data.guide_key, 60)])).rows[0].id;
    }
    await t.query('DELETE FROM kit_items WHERE kit_id=$1', [id]);
    for (const r of rows) {
      await t.query('INSERT INTO kit_items(kit_id, product_id, qty, optional, note, sort) VALUES($1,$2,$3,$4,$5,$6)', [id, r.pid, r.qty, r.optional, r.note, r.sort]);
    }
    return id;
  });
}
async function remove(id?: Id) { await db.q('DELETE FROM kits WHERE id=$1', [int(id)]); }

// "কীভাবে বানাবেন": one step per line (a leading "1." / "-" is dropped — the page numbers them itself)
function cleanSteps(text?: unknown) {
  return String(text || '').split(/\r?\n/).map((l) => l.replace(/^\s*(?:\d+[.)।]|[-*•])\s*/, '').trim()).filter(Boolean).slice(0, 30)
    .map((l) => l.slice(0, 600)).join('\n');
}
function stepList(k: db.pg.DbRow) { return String((k && k.steps) || '').split('\n').map((l) => l.trim()).filter(Boolean); }

// ================================================================ 📚 ready-made guides (lib/data/guides.js)
// Finds the shop's product for one part of a guide: the name must contain one of the words, none of the "not"
// words; switched on, a single product (no bundle / options). In stock and best-selling first; earlier words win.
async function matchPart(part?: Loose) {
  const like = part.find.map((w: unknown) => '%' + String(w).replace(/[%_\\]/g, '') + '%');
  const notLike = (part.not || []).map((w: unknown) => '%' + String(w).replace(/[%_\\]/g, '') + '%');
  const rows = await db.q<Pick<ProductsRow, 'id' | 'name' | 'price' | 'stock'>>(`SELECT p.id, p.name, p.price, p.stock FROM products p
    WHERE p.active AND p.parent_id IS NULL AND coalesce(p.product_type,'single') <> 'bundle' AND coalesce(p.variant_count,0) = 0
      AND p.name ILIKE ANY($1::text[]) AND NOT (p.name ILIKE ANY($2::text[]))
    ORDER BY (p.stock > 0) DESC, coalesce(p.sold_count,0) DESC, p.id DESC LIMIT 40`, [like, notLike.length ? notLike : ['']]);
  for (const w of part.find) { // the first word of the list is the best description of the part
    const hit = rows.find((r) => r.name.toLowerCase().includes(String(w).toLowerCase()));
    if (hit) return hit;
  }
  return rows[0] || null;
}
// What the shop has for each guide: parts found / missing, and whether a kit was already made from it.
async function guideStatus() {
  const { GUIDES } = $data_guides;
  const made = new Map((await db.q<Pick<KitsRow, 'id' | 'guide_key' | 'slug' | 'active'>>(`SELECT id, guide_key, slug, active FROM kits WHERE guide_key <> ''`)).map((k) => [k.guide_key, k]));
  const out: Loose[] = [];
  for (const g of GUIDES) {
    const parts: Loose[] = [];
    for (const part of g.parts) parts.push({ ...part, product: await matchPart(part) });
    const missing = parts.filter((p) => !p.product && !p.optional);
    out.push({ ...g, parts, missing, kit: made.get(g.key) || null });
  }
  return out;
}
// One tap: the guide becomes a kit. Switched on only when every needed part was found in the shop.
async function fromGuide(key: string) {
  const g = (await guideStatus()).find((x) => x.key === key);
  if (!g) throw new KitError('গাইড পাওয়া যায়নি।');
  if (g.kit) return { id: g.kit.id, existed: true, missing: g.missing };
  const found = g.parts.filter((p: Loose) => p.product);
  if (!found.length) throw new KitError(`"${g.title}" — এর কোনো পার্টসই দোকানে পাওয়া যায়নি।`);
  const seen = new Set(); const uniq = found.filter((p: { product: { id: unknown; }; }) => !seen.has(p.product.id) && seen.add(p.product.id));
  const id = await save({
    title: g.title, description: g.intro, emoji: g.emoji, steps: g.steps.join('\n'), level: g.level, duration: g.time,
    active: g.missing.length === 0, sort: 0, slug: slugify(g.key) || g.key, guide_key: g.key,
    'bundle_id[]': uniq.map((p: Loose) => p.product.id), 'bundle_qty[]': uniq.map((p: Loose) => p.qty || 1),
    'kit_opt[]': uniq.filter((p: Loose) => p.optional).map((p: Loose) => p.product.id), 'kit_note[]': uniq.map((p: Loose) => p.note || ''),
  });
  return { id, existed: false, missing: g.missing, active: g.missing.length === 0 };
}

export { KitError, list, get, forShop, kitsWith, save, remove, cleanSteps, stepList, matchPart, guideStatus, fromGuide };
