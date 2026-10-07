'use strict';
const crypto = require('crypto');
const pg = require('./pg');
const { slugify, randomCode, int, bn } = require('./util');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (
  key text PRIMARY KEY,
  value text
);
CREATE TABLE IF NOT EXISTS categories (
  id serial PRIMARY KEY,
  name text NOT NULL,
  slug text UNIQUE NOT NULL,
  icon text DEFAULT '📦',
  sort int DEFAULT 0
);
CREATE TABLE IF NOT EXISTS products (
  id serial PRIMARY KEY,
  name text NOT NULL,
  slug text UNIQUE NOT NULL,
  category_id int REFERENCES categories(id) ON DELETE SET NULL,
  price int NOT NULL DEFAULT 0,
  old_price int,
  stock int NOT NULL DEFAULT 0,
  description text DEFAULT '',
  emoji text DEFAULT '📦',
  image text,
  featured boolean DEFAULT false,
  active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS orders (
  id serial PRIMARY KEY,
  code text UNIQUE NOT NULL,
  customer_name text NOT NULL,
  phone text NOT NULL,
  address text NOT NULL,
  area text NOT NULL,
  note text DEFAULT '',
  subtotal int NOT NULL,
  delivery int NOT NULL,
  total int NOT NULL,
  payment text DEFAULT 'cod',
  status text DEFAULT 'pending',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS order_items (
  id serial PRIMARY KEY,
  order_id int REFERENCES orders(id) ON DELETE CASCADE,
  product_id int,
  name text NOT NULL,
  price int NOT NULL,
  qty int NOT NULL
);
CREATE INDEX IF NOT EXISTS products_category_idx ON products(category_id);
CREATE INDEX IF NOT EXISTS orders_created_idx ON orders(created_at DESC);
`;

const SEED_CATEGORIES = [
  ['ইলেকট্রনিক্স', 'electronics', '📟'],
  ['সার্কিট', 'circuits', '🧩'],
  ['কম্পোনেন্ট', 'components', '🔋'],
  ['সোল্ডারিং', 'soldering', '🔥'],
  ['ইলেকট্রিক্যাল', 'electrical', '🔌'],
  ['ফ্যাশন', 'fashion', '👕'],
];

const SEED_PRODUCTS = [
  ['CA6928 Bluetooth Audio Module', 'electronics', 250, 300, '🔊', true, 'পুরনো স্পিকার বা অ্যামপ্লিফায়ারকে ব্লুটুথ স্পিকার বানাতে এই মডিউল লাগান। ৫ ভোল্টে চলে, পরিষ্কার স্টেরিও সাউন্ড।'],
  ['PAM8403 Mini Amplifier Board', 'circuits', 120, null, '🎵', true, '৫ ভোল্টের ছোট স্টেরিও অ্যামপ্লিফায়ার বোর্ড, প্রতি চ্যানেলে ৩ ওয়াট। ছোট স্পিকার প্রজেক্টের জন্য উপযুক্ত।'],
  ['12V DC-DC Converter', 'electrical', 180, null, '⚡', true, 'ভোল্টেজ কমিয়ে বা বাড়িয়ে স্থির ১২ ভোল্ট দেয়। ব্যাটারি আর সোলার প্রজেক্টে কাজে লাগে।'],
  ['1000µF Capacitor', 'components', 25, null, '🔋', false, '১০০০ মাইক্রোফ্যারাড ইলেকট্রোলাইটিক ক্যাপাসিটর। পাওয়ার সাপ্লাই ফিল্টারিংয়ের জন্য।'],
  ['Soldering Iron 60W', 'soldering', 350, 420, '🔥', true, '৬০ ওয়াট সোল্ডারিং আয়রন, তাপমাত্রা নিয়ন্ত্রণসহ। দ্রুত গরম হয়, হাতে আরামদায়ক।'],
  ['Bridge Rectifier', 'components', 30, null, '🔌', false, 'এসি থেকে ডিসি করার জন্য ব্রিজ রেক্টিফায়ার। পাওয়ার সাপ্লাই বানাতে দরকার।'],
  ['Inverter Circuit Board', 'circuits', 650, 750, '🔧', true, '১২ ভোল্ট ব্যাটারি থেকে এসি পাওয়ার তৈরির ইনভার্টার বোর্ড।'],
  ['DC Motor 3V–9V', 'electrical', 90, null, '⚙️', false, '৩ থেকে ৯ ভোল্টে চলা ছোট ডিসি মোটর। খেলনা, রোবট আর সায়েন্স প্রজেক্টের জন্য।'],
];

const DEFAULT_SETTINGS = {
  store_name: 'সবমিলবে',
  tagline: 'ইলেকট্রনিক্স কম্পোনেন্ট থেকে প্রতিদিনের দরকারি জিনিস, সবই এক জায়গায়।',
  notice: '🚚 সারা বাংলাদেশে হোম ডেলিভারি, পণ্য হাতে পেয়ে টাকা দিন',
  phone: '',
  whatsapp: '',
  delivery_dhaka: '60',
  delivery_outside: '120',
  free_delivery_min: '0',
};

let ready = null;
function ensureReady() {
  if (!ready) {
    ready = (async () => {
      await pg.exec(SCHEMA);
      const { rows } = await pg.query('SELECT count(*)::int AS n FROM categories');
      if (rows[0].n === 0) await seed();
      const secret = await pg.query("SELECT value FROM settings WHERE key='session_secret'");
      if (!secret.rows.length) {
        await pg.query("INSERT INTO settings(key,value) VALUES('session_secret',$1) ON CONFLICT DO NOTHING",
          [crypto.randomBytes(32).toString('hex')]);
      }
    })().catch((e) => { ready = null; throw e; });
  }
  return ready;
}

async function seed() {
  for (const [i, [name, slug, icon]] of SEED_CATEGORIES.entries()) {
    await pg.query('INSERT INTO categories(name,slug,icon,sort) VALUES($1,$2,$3,$4) ON CONFLICT (slug) DO NOTHING',
      [name, slug, icon, i]);
  }
  for (const [name, cat, price, oldPrice, emoji, featured, desc] of SEED_PRODUCTS) {
    await pg.query(
      `INSERT INTO products(name,slug,category_id,price,old_price,stock,description,emoji,featured)
       VALUES($1,$2,(SELECT id FROM categories WHERE slug=$3),$4,$5,$6,$7,$8,$9) ON CONFLICT (slug) DO NOTHING`,
      [name, slugify(name), cat, price, oldPrice, 25, desc, emoji, featured]);
  }
}

// ---------- settings ----------
async function getSettings() {
  const { rows } = await pg.query('SELECT key, value FROM settings');
  const s = { ...DEFAULT_SETTINGS };
  rows.forEach((r) => { s[r.key] = r.value; });
  return s;
}
async function setSetting(key, value) {
  await pg.query('INSERT INTO settings(key,value) VALUES($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value',
    [key, value]);
}

// ---------- categories ----------
async function listCategories() {
  const { rows } = await pg.query(
    `SELECT c.*, (SELECT count(*)::int FROM products p WHERE p.category_id=c.id AND p.active) AS product_count
     FROM categories c ORDER BY sort, id`);
  return rows;
}
async function getCategoryBySlug(slug) {
  const { rows } = await pg.query('SELECT * FROM categories WHERE slug=$1', [slug]);
  return rows[0] || null;
}
async function saveCategory({ id, name, icon, sort }) {
  if (id) {
    await pg.query('UPDATE categories SET name=$1, icon=$2, sort=$3 WHERE id=$4', [name, icon || '📦', int(sort), id]);
    return;
  }
  const slug = await uniqueSlug('categories', slugify(name));
  await pg.query('INSERT INTO categories(name,slug,icon,sort) VALUES($1,$2,$3,$4)', [name, slug, icon || '📦', int(sort)]);
}
async function deleteCategory(id) {
  await pg.query('DELETE FROM categories WHERE id=$1', [id]);
}

async function uniqueSlug(table, base, exceptId = null) {
  let slug = base;
  for (let i = 2; i < 200; i++) {
    const { rows } = await pg.query(`SELECT id FROM ${table} WHERE slug=$1`, [slug]);
    if (!rows.length || rows[0].id === exceptId) return slug;
    slug = `${base}-${i}`;
  }
  return `${base}-${randomCode(4).toLowerCase()}`;
}

// ---------- products ----------
const PRODUCT_COLS = `p.id, p.name, p.slug, p.category_id, p.price, p.old_price, p.stock, p.description,
  p.emoji, (p.image IS NOT NULL) AS has_image, p.featured, p.active, p.created_at, p.updated_at,
  extract(epoch from p.updated_at)::bigint AS version,
  c.name AS category_name, c.slug AS category_slug`;

async function listProducts({ category, q, sort, featured, includeInactive, limit } = {}) {
  const where = [];
  const params = [];
  if (!includeInactive) where.push('p.active');
  if (category) { params.push(category); where.push(`c.slug=$${params.length}`); }
  if (featured) where.push('p.featured');
  if (q) {
    params.push(`%${q}%`);
    where.push(`(p.name ILIKE $${params.length} OR p.description ILIKE $${params.length} OR c.name ILIKE $${params.length})`);
  }
  const order = {
    price_asc: 'p.price ASC',
    price_desc: 'p.price DESC',
    new: 'p.created_at DESC',
  }[sort] || 'p.featured DESC, (p.stock > 0) DESC, p.created_at DESC';
  let sql = `SELECT ${PRODUCT_COLS} FROM products p LEFT JOIN categories c ON c.id=p.category_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${order}`;
  if (limit) { params.push(limit); sql += ` LIMIT $${params.length}`; }
  const { rows } = await pg.query(sql, params);
  return rows;
}

async function getProduct({ id, slug }) {
  const { rows } = await pg.query(
    `SELECT ${PRODUCT_COLS} FROM products p LEFT JOIN categories c ON c.id=p.category_id
     WHERE ${id ? 'p.id=$1' : 'p.slug=$1'}`, [id || slug]);
  return rows[0] || null;
}

async function getProductsByIds(ids) {
  if (!ids.length) return [];
  const { rows } = await pg.query(
    `SELECT ${PRODUCT_COLS} FROM products p LEFT JOIN categories c ON c.id=p.category_id
     WHERE p.id = ANY($1::int[]) AND p.active`, [`{${ids.map((x) => int(x)).join(',')}}`]);
  return rows;
}

async function getProductImage(id) {
  const { rows } = await pg.query('SELECT image FROM products WHERE id=$1', [id]);
  return rows[0] ? rows[0].image : null;
}

async function saveProduct(data) {
  const fields = {
    name: data.name,
    category_id: data.category_id ? int(data.category_id) : null,
    price: int(data.price),
    old_price: data.old_price ? int(data.old_price) : null,
    stock: int(data.stock),
    description: data.description || '',
    emoji: data.emoji || '📦',
    featured: !!data.featured,
    active: !!data.active,
  };
  if (data.id) {
    const params = [fields.name, fields.category_id, fields.price, fields.old_price, fields.stock,
      fields.description, fields.emoji, fields.featured, fields.active, int(data.id)];
    let sql = `UPDATE products SET name=$1, category_id=$2, price=$3, old_price=$4, stock=$5, description=$6,
      emoji=$7, featured=$8, active=$9, updated_at=now()`;
    if (data.image === '__remove__') sql += ', image=NULL';
    else if (data.image) { params.push(data.image); sql += `, image=$${params.length}`; }
    sql += ' WHERE id=$10';
    await pg.query(sql, params);
    return int(data.id);
  }
  const slug = await uniqueSlug('products', slugify(fields.name));
  const { rows } = await pg.query(
    `INSERT INTO products(name,slug,category_id,price,old_price,stock,description,emoji,featured,active,image)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
    [fields.name, slug, fields.category_id, fields.price, fields.old_price, fields.stock, fields.description,
      fields.emoji, fields.featured, fields.active, data.image && data.image !== '__remove__' ? data.image : null]);
  return rows[0].id;
}

async function deleteProduct(id) {
  await pg.query('DELETE FROM products WHERE id=$1', [id]);
}

// ---------- orders ----------
const STATUSES = {
  pending: 'নতুন অর্ডার',
  confirmed: 'কনফার্ম হয়েছে',
  shipped: 'পাঠানো হয়েছে',
  delivered: 'ডেলিভারি সম্পন্ন',
  cancelled: 'বাতিল',
};

function deliveryCharge(settings, area, subtotal) {
  const freeMin = int(settings.free_delivery_min);
  if (freeMin > 0 && subtotal >= freeMin) return 0;
  return area === 'dhaka' ? int(settings.delivery_dhaka) : int(settings.delivery_outside);
}

class OrderError extends Error {}

async function createOrder({ items, name, phone, address, area, note }) {
  const settings = await getSettings();
  const wanted = new Map();
  for (const it of items || []) {
    const id = int(it.id);
    const qty = Math.min(int(it.qty), 99);
    if (id > 0 && qty > 0) wanted.set(id, (wanted.get(id) || 0) + qty);
  }
  if (!wanted.size) throw new OrderError('কার্ট খালি। আগে পণ্য যোগ করুন।');

  return pg.transaction(async (tx) => {
    const lines = [];
    for (const [id, qty] of wanted) {
      const { rows } = await tx.query(
        'UPDATE products SET stock=stock-$1 WHERE id=$2 AND active AND stock>=$1 RETURNING id, name, price', [qty, id]);
      if (!rows.length) {
        const p = await tx.query('SELECT name, stock FROM products WHERE id=$1', [id]);
        const pname = p.rows[0] ? p.rows[0].name : 'একটি পণ্য';
        const left = p.rows[0] ? p.rows[0].stock : 0;
        throw new OrderError(left > 0
          ? `"${pname}" স্টকে আছে মাত্র ${bn(left)}টি। পরিমাণ কমিয়ে আবার চেষ্টা করুন।`
          : `"${pname}" এখন স্টকে নেই। কার্ট থেকে সরিয়ে আবার চেষ্টা করুন।`);
      }
      lines.push({ ...rows[0], qty });
    }
    const subtotal = lines.reduce((s, l) => s + l.price * l.qty, 0);
    const delivery = deliveryCharge(settings, area, subtotal);
    const total = subtotal + delivery;
    let order = null;
    for (let i = 0; i < 5 && !order; i++) {
      const { rows } = await tx.query(
        `INSERT INTO orders(code,customer_name,phone,address,area,note,subtotal,delivery,total)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (code) DO NOTHING RETURNING id, code`,
        ['SM' + randomCode(6), name, phone, address, area, note || '', subtotal, delivery, total]);
      order = rows[0];
    }
    for (const l of lines) {
      await tx.query('INSERT INTO order_items(order_id,product_id,name,price,qty) VALUES($1,$2,$3,$4,$5)',
        [order.id, l.id, l.name, l.price, l.qty]);
    }
    return order.code;
  });
}

async function getOrder({ code, id }) {
  const { rows } = await pg.query(`SELECT * FROM orders WHERE ${id ? 'id=$1' : 'code=$1'}`, [id || code]);
  if (!rows.length) return null;
  const order = rows[0];
  const items = await pg.query('SELECT * FROM order_items WHERE order_id=$1 ORDER BY id', [order.id]);
  order.items = items.rows;
  return order;
}

async function listOrders({ status, q, limit = 200 } = {}) {
  const where = [];
  const params = [];
  if (status) { params.push(status); where.push(`status=$${params.length}`); }
  if (q) { params.push(`%${q}%`); where.push(`(code ILIKE $${params.length} OR phone ILIKE $${params.length} OR customer_name ILIKE $${params.length})`); }
  params.push(limit);
  const { rows } = await pg.query(
    `SELECT o.*, (SELECT sum(qty)::int FROM order_items WHERE order_id=o.id) AS item_count FROM orders o
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC LIMIT $${params.length}`, params);
  return rows;
}

async function setOrderStatus(id, status) {
  if (!STATUSES[status]) return;
  await pg.transaction(async (tx) => {
    const { rows } = await tx.query('SELECT status FROM orders WHERE id=$1 FOR UPDATE', [id]);
    if (!rows.length) return;
    const prev = rows[0].status;
    if (prev === status) return;
    // Put stock back when an order is cancelled, take it again if un-cancelled.
    if (status === 'cancelled' || prev === 'cancelled') {
      const sign = status === 'cancelled' ? 1 : -1;
      await tx.query(
        `UPDATE products p SET stock = greatest(0, p.stock + $1 * i.qty)
         FROM (SELECT product_id, sum(qty)::int AS qty FROM order_items WHERE order_id=$2 GROUP BY product_id) i
         WHERE p.id = i.product_id`, [sign, id]);
    }
    await tx.query('UPDATE orders SET status=$1, updated_at=now() WHERE id=$2', [status, id]);
  });
}

async function dashboardStats() {
  const { rows } = await pg.query(`SELECT
    (SELECT count(*)::int FROM orders WHERE status='pending') AS pending,
    (SELECT count(*)::int FROM orders WHERE created_at > now() - interval '1 day') AS today,
    (SELECT coalesce(sum(total),0)::int FROM orders WHERE status<>'cancelled' AND created_at > now() - interval '30 days') AS revenue30,
    (SELECT count(*)::int FROM products WHERE active) AS products,
    (SELECT count(*)::int FROM products WHERE active AND stock <= 3) AS low_stock`);
  return rows[0];
}

module.exports = {
  ensureReady, getSettings, setSetting,
  listCategories, getCategoryBySlug, saveCategory, deleteCategory,
  listProducts, getProduct, getProductsByIds, getProductImage, saveProduct, deleteProduct,
  createOrder, getOrder, listOrders, setOrderStatus, dashboardStats, deliveryCharge,
  STATUSES, OrderError,
};
