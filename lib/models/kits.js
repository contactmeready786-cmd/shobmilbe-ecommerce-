'use strict';
// 🧰 প্রজেক্ট কিট — like a "PC builder" for electronics projects. The owner makes a kit ("ব্লুটুথ স্পিকার বানান"):
// a list of parts with how many of each, some marked "ঐচ্ছিক". On the kit's page the customer ticks off what they
// already have, changes amounts, and adds everything else to the cart in one tap. Each part stays its own product
// (own stock, own price, own SKU) — unlike a bundle, which is sold as one product.
const db = require('../db');
const { str, int, slugify } = require('../util');

class KitError extends Error {}

async function list({ activeOnly = false } = {}) {
  return db.q(`SELECT k.*, (SELECT count(*)::int FROM kit_items i WHERE i.kit_id=k.id) AS parts,
      (SELECT coalesce(sum(p.price * i.qty), 0) FROM kit_items i JOIN products p ON p.id=i.product_id WHERE i.kit_id=k.id AND NOT i.optional) AS base_total
    FROM kits k ${activeOnly ? 'WHERE k.active' : ''} ORDER BY k.sort, k.id DESC`);
}
async function get({ id, slug }) {
  const k = await db.one(`SELECT * FROM kits WHERE ${id ? 'id=$1' : 'slug=$1'}`, [id ? int(id) : String(slug || '')]);
  if (!k) return null;
  k.items = await db.q(`SELECT i.id, i.product_id, i.qty, i.optional, i.note, p.name, p.slug, p.sku, p.price, p.stock, p.image_id, p.emoji, p.active,
      p.variant_count, p.product_type
    FROM kit_items i JOIN products p ON p.id=i.product_id WHERE i.kit_id=$1 ORDER BY i.optional, i.sort, i.id`, [k.id]);
  return k;
}
// The shop side: prices the customer pays now (flash sale counts), only parts that are switched on.
async function forShop(slug) {
  const k = await get({ slug });
  if (!k || !k.active) return null;
  const catalog = require('./catalog');
  const prods = await catalog.getProductsByIds(k.items.map((i) => i.product_id), { public: true });
  const byId = new Map(prods.map((p) => [p.id, p]));
  k.items = k.items.filter((i) => byId.has(i.product_id)).map((i) => ({ ...i, product: byId.get(i.product_id) }));
  return k;
}
async function kitsWith(productId) {
  return db.q(`SELECT DISTINCT k.id, k.slug, k.title FROM kits k JOIN kit_items i ON i.kit_id=k.id WHERE k.active AND i.product_id=$1 ORDER BY k.title LIMIT 5`, [int(productId)]);
}

async function save(data) {
  const title = str(data.title, 120).trim();
  if (title.length < 3) throw new KitError('কিটের নাম লিখুন।');
  const ids = [].concat(data['bundle_id[]'] || data.bundle_id || []).map(int);
  const qtys = [].concat(data['bundle_qty[]'] || data.bundle_qty || []).map((x) => Math.max(1, Math.min(999, int(x, 1))));
  const opt = new Set([].concat(data['kit_opt[]'] || data.kit_opt || []).map(int));
  const notes = [].concat(data['kit_note[]'] || data.kit_note || []);
  const rows = []; const seen = new Set();
  ids.forEach((pid, i) => { if (pid > 0 && !seen.has(pid)) { seen.add(pid); rows.push({ pid, qty: qtys[i] || 1, optional: opt.has(pid), note: str(notes[i], 120), sort: i }); } });
  if (!rows.length) throw new KitError('কিটে অন্তত একটা পণ্য যোগ করুন।');
  const bad = await db.q(`SELECT name FROM products WHERE id = ANY($1::int[]) AND (product_type='bundle' OR variant_count > 0)`, [rows.map((r) => r.pid)]);
  if (bad.length) throw new KitError(`"${bad[0].name}" কিটে রাখা যাবে না (বান্ডেল বা অপশনওয়ালা পণ্য)। এর একটা নির্দিষ্ট অপশন/পণ্য যোগ করুন।`);
  return db.tx(async (t) => {
    let id = int(data.id);
    const vals = [title, str(data.description, 5000), int(data.image_id) || null, str(data.emoji, 8) || '🧰', !!data.active, int(data.sort)];
    if (id) {
      await t.query('UPDATE kits SET title=$1, description=$2, image_id=$3, emoji=$4, active=$5, sort=$6, updated_at=now() WHERE id=$7', [...vals, id]);
    } else {
      let slug = slugify(title) || 'kit';
      for (let n = 2; (await t.query('SELECT 1 FROM kits WHERE slug=$1', [slug])).rows.length; n++) slug = `${slugify(title) || 'kit'}-${n}`;
      id = (await t.query('INSERT INTO kits(title, description, image_id, emoji, active, sort, slug) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id', [...vals, slug])).rows[0].id;
    }
    await t.query('DELETE FROM kit_items WHERE kit_id=$1', [id]);
    for (const r of rows) {
      await t.query('INSERT INTO kit_items(kit_id, product_id, qty, optional, note, sort) VALUES($1,$2,$3,$4,$5,$6)', [id, r.pid, r.qty, r.optional, r.note, r.sort]);
    }
    return id;
  });
}
async function remove(id) { await db.q('DELETE FROM kits WHERE id=$1', [int(id)]); }

module.exports = { KitError, list, get, forShop, kitsWith, save, remove };
