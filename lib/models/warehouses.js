'use strict';
// 🏬 Stores / branches (গুদাম ও শাখা).
// The shop's total stock of a product stays where it always was (products.stock — the online shop sells from it).
// Each extra store keeps its own count; the "মূল গুদাম" (main store, where online orders are packed) is whatever is left:
//   main = total − all other stores.
// So nothing else in the shop changes: purchases and online orders move the main store; a transfer moves pieces
// between stores; a counter sale at a branch (POS) takes from that branch (and from the total).
const db = require('../db');
const { str, int } = require('../util');

class WhError extends Error {}

async function list({ activeOnly = false } = {}) {
  return db.q(`SELECT w.*, coalesce(sum(s.qty),0)::int AS units, count(s.product_id) FILTER (WHERE s.qty > 0)::int AS products
    FROM warehouses w LEFT JOIN warehouse_stock s ON s.warehouse_id=w.id ${activeOnly ? 'WHERE w.active' : ''} GROUP BY w.id ORDER BY w.sort, w.id`);
}
async function get(id) { return db.one('SELECT * FROM warehouses WHERE id=$1', [int(id)]); }
async function save(b) {
  const name = str(b.name, 80);
  if (name.length < 2) throw new WhError('গুদাম / শাখার নাম দিন।');
  const id = int(b.id);
  const v = [name, str(b.address, 300), str(b.phone, 30), !!b.is_shop, b.active === undefined ? true : !!b.active, int(b.sort), str(b.note, 300)];
  if (id) { await db.q('UPDATE warehouses SET name=$1, address=$2, phone=$3, is_shop=$4, active=$5, sort=$6, note=$7 WHERE id=$8', [...v, id]); return id; }
  return (await db.one('INSERT INTO warehouses(name, address, phone, is_shop, active, sort, note) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id', v)).id;
}

// How many pieces of these products each store has, plus the main store. → Map(product_id → { total, main, by: { whId: qty } })
async function stockFor(productIds) {
  const ids = (productIds || []).map((x) => int(x)).filter((x) => x > 0);
  if (!ids.length) return new Map();
  const [prods, rows] = await Promise.all([
    db.q('SELECT id, stock FROM products WHERE id = ANY($1::int[])', [ids]),
    db.q('SELECT warehouse_id, product_id, qty FROM warehouse_stock WHERE product_id = ANY($1::int[])', [ids]),
  ]);
  const m = new Map(prods.map((p) => [p.id, { total: p.stock, main: p.stock, by: {} }]));
  rows.forEach((r) => { const x = m.get(r.product_id); if (x) { x.by[r.warehouse_id] = r.qty; x.main -= r.qty; } });
  return m;
}
// One store's products (with the main store's count beside it).
async function storeStock(whId, { q = '', limit = 200 } = {}) {
  const params = [int(whId)];
  let where = 's.warehouse_id=$1 AND s.qty > 0';
  if (q) { params.push(`%${q}%`); where += ` AND (p.name ILIKE $2 OR p.sku ILIKE $2 OR p.barcode ILIKE $2)`; }
  params.push(limit);
  return db.q(`SELECT p.id, p.name, p.sku, p.barcode, p.image_id, p.emoji, p.stock, s.qty,
      p.stock - (SELECT coalesce(sum(x.qty),0) FROM warehouse_stock x WHERE x.product_id=p.id)::int AS main
    FROM warehouse_stock s JOIN products p ON p.id=s.product_id WHERE ${where} ORDER BY p.name LIMIT $${params.length}`, params);
}

// Move pieces from one store to another (0 / null = the main store).
async function transfer({ productId, qty, from, to, note }, staffId) {
  const n = int(qty);
  const f = int(from) || null; const tw = int(to) || null;
  if (n < 1) throw new WhError('কয়টা সরাবেন লিখুন।');
  if (f === tw) throw new WhError('কোথা থেকে আর কোথায় — দুটো আলাদা বাছুন।');
  return db.tx(async (t) => {
    const p = (await t.query('SELECT id, name, stock, variant_count, product_type FROM products WHERE id=$1 FOR UPDATE', [int(productId)])).rows[0];
    if (!p) throw new WhError('পণ্যটা পাওয়া যায়নি।');
    if (p.variant_count > 0) throw new WhError('এই পণ্যের ভ্যারিয়েন্ট আছে — নির্দিষ্ট ভ্যারিয়েন্ট (রং/সাইজ) বাছাই করুন।');
    if (p.product_type === 'bundle') throw new WhError('বান্ডেল সরানো যায় না — ভেতরের পণ্যগুলো আলাদা করে সরান।');
    for (const w of [f, tw].filter(Boolean)) {
      const ok = (await t.query('SELECT id FROM warehouses WHERE id=$1 AND active', [w])).rows[0];
      if (!ok) throw new WhError('গুদাম / শাখা পাওয়া যায়নি (বা বন্ধ)।');
    }
    const others = (await t.query('SELECT coalesce(sum(qty),0)::int AS n FROM warehouse_stock WHERE product_id=$1', [p.id])).rows[0].n;
    if (!f) {
      const main = p.stock - others;
      if (main < n) throw new WhError(`মূল গুদামে "${p.name}" আছে মাত্র ${Math.max(0, main)}টি।`);
    } else {
      const got = (await t.query('UPDATE warehouse_stock SET qty = qty - $1 WHERE warehouse_id=$2 AND product_id=$3 AND qty >= $1 RETURNING qty', [n, f, p.id])).rows[0];
      if (!got) throw new WhError(`এই শাখায় "${p.name}" ${n}টি নেই।`);
    }
    if (tw) {
      await t.query(`INSERT INTO warehouse_stock(warehouse_id, product_id, qty) VALUES($1,$2,$3)
        ON CONFLICT (warehouse_id, product_id) DO UPDATE SET qty = warehouse_stock.qty + EXCLUDED.qty`, [tw, p.id, n]);
    }
    await t.query('INSERT INTO warehouse_moves(product_id, from_wh, to_wh, qty, reason, note, staff_id) VALUES($1,$2,$3,$4,$5,$6,$7)', [p.id, f, tw, n, 'transfer', str(note, 200), staffId]);
    return { name: p.name };
  });
}
// A branch's count corrected after counting the shelf (the difference comes from / goes to the main store).
async function setCount(whId, productId, qty, staffId) {
  const n = Math.max(0, int(qty));
  return db.tx(async (t) => {
    const p = (await t.query('SELECT id, name, stock FROM products WHERE id=$1 FOR UPDATE', [int(productId)])).rows[0];
    if (!p) throw new WhError('পণ্যটা পাওয়া যায়নি।');
    const cur = (await t.query('SELECT qty FROM warehouse_stock WHERE warehouse_id=$1 AND product_id=$2', [int(whId), p.id])).rows[0];
    const was = cur ? cur.qty : 0;
    const others = (await t.query('SELECT coalesce(sum(qty),0)::int AS n FROM warehouse_stock WHERE product_id=$1', [p.id])).rows[0].n;
    if (n - was > p.stock - others) throw new WhError(`মূল গুদামে যথেষ্ট "${p.name}" নেই — আগে মোট স্টক ঠিক করুন (ইনভেন্টরি)।`);
    await t.query(`INSERT INTO warehouse_stock(warehouse_id, product_id, qty) VALUES($1,$2,$3) ON CONFLICT (warehouse_id, product_id) DO UPDATE SET qty=EXCLUDED.qty`, [int(whId), p.id, n]);
    if (n !== was) await t.query('INSERT INTO warehouse_moves(product_id, from_wh, to_wh, qty, reason, note, staff_id) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [p.id, n > was ? null : int(whId), n > was ? int(whId) : null, Math.abs(n - was), 'count', 'গণনা ঠিক করা', staffId]);
    return { name: p.name, was, now: n };
  });
}
async function moves({ whId = null, limit = 60 } = {}) {
  const params = [];
  let where = '';
  if (whId) { params.push(int(whId)); where = 'WHERE m.from_wh=$1 OR m.to_wh=$1'; }
  params.push(limit);
  return db.q(`SELECT m.*, p.name, p.sku, f.name AS from_name, t.name AS to_name, s.name AS staff_name, o.code AS order_code
    FROM warehouse_moves m LEFT JOIN products p ON p.id=m.product_id LEFT JOIN warehouses f ON f.id=m.from_wh LEFT JOIN warehouses t ON t.id=m.to_wh
    LEFT JOIN staff s ON s.id=m.staff_id LEFT JOIN orders o ON o.id=m.ref_id AND m.reason IN ('sale','sale_cancel')
    ${where} ORDER BY m.id DESC LIMIT $${params.length}`, params);
}
// Products whose main-store count went below zero (sold online while the pieces were counted in a branch).
async function problems() {
  return db.q(`SELECT p.id, p.name, p.sku, p.stock, (SELECT coalesce(sum(qty),0) FROM warehouse_stock x WHERE x.product_id=p.id)::int AS branches
    FROM products p WHERE EXISTS (SELECT 1 FROM warehouse_stock x WHERE x.product_id=p.id AND x.qty > 0)
      AND p.stock < (SELECT coalesce(sum(qty),0) FROM warehouse_stock x WHERE x.product_id=p.id) ORDER BY p.name LIMIT 50`);
}

module.exports = { WhError, list, get, save, stockFor, storeStock, transfer, setCount, moves, problems };
