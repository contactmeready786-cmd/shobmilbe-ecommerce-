'use strict';
// Database core: query helpers, schema + migrations, settings, activity log.
const crypto = require('crypto');
const pg = require('./pg');
const { slugify, randomCode } = require('./util');

const q = async (sql, params = []) => (await pg.query(sql, params)).rows;
const one = async (sql, params = []) => (await pg.query(sql, params)).rows[0] || null;
const tx = (fn) => pg.transaction(fn);

// ---------------------------------------------------------------------------
// Schema. BASE is the original v1 schema (kept so old databases line up);
// MIGRATIONS run once each, in order, and are recorded in settings.schema_version.
// ---------------------------------------------------------------------------
const BASE = `
CREATE TABLE IF NOT EXISTS settings (key text PRIMARY KEY, value text);
CREATE TABLE IF NOT EXISTS categories (
  id serial PRIMARY KEY, name text NOT NULL, slug text UNIQUE NOT NULL, icon text DEFAULT '📦', sort int DEFAULT 0
);
CREATE TABLE IF NOT EXISTS products (
  id serial PRIMARY KEY, name text NOT NULL, slug text UNIQUE NOT NULL,
  category_id int REFERENCES categories(id) ON DELETE SET NULL,
  price int NOT NULL DEFAULT 0, old_price int, stock int NOT NULL DEFAULT 0, description text DEFAULT '',
  emoji text DEFAULT '📦', image text, featured boolean DEFAULT false, active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS orders (
  id serial PRIMARY KEY, code text UNIQUE NOT NULL, customer_name text NOT NULL, phone text NOT NULL,
  address text NOT NULL, area text NOT NULL, note text DEFAULT '', subtotal int NOT NULL, delivery int NOT NULL,
  total int NOT NULL, payment text DEFAULT 'cod', status text DEFAULT 'pending',
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS order_items (
  id serial PRIMARY KEY, order_id int REFERENCES orders(id) ON DELETE CASCADE, product_id int,
  name text NOT NULL, price int NOT NULL, qty int NOT NULL
);
CREATE INDEX IF NOT EXISTS products_category_idx ON products(category_id);
CREATE INDEX IF NOT EXISTS orders_created_idx ON orders(created_at DESC);
`;

const MIGRATIONS = [
  // 1 — the big admin upgrade
  `
CREATE TABLE IF NOT EXISTS staff (
  id serial PRIMARY KEY, name text NOT NULL, username text UNIQUE NOT NULL, phone text DEFAULT '', email text DEFAULT '',
  password text NOT NULL, role text NOT NULL DEFAULT 'staff', permissions jsonb NOT NULL DEFAULT '[]',
  active boolean DEFAULT true, note text DEFAULT '', last_login timestamptz, created_at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS activity_log (
  id bigserial PRIMARY KEY, staff_id int, action text NOT NULL, entity text DEFAULT '', entity_id int,
  detail text DEFAULT '', created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS activity_created_idx ON activity_log(created_at DESC);
CREATE INDEX IF NOT EXISTS activity_entity_idx ON activity_log(entity, entity_id);
CREATE INDEX IF NOT EXISTS activity_staff_idx ON activity_log(staff_id, created_at DESC);

CREATE TABLE IF NOT EXISTS media (
  id serial PRIMARY KEY, mime text NOT NULL, data bytea NOT NULL, thumb bytea, width int, height int,
  owner_type text, owner_id int, sort int DEFAULT 0, created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS media_owner_idx ON media(owner_type, owner_id, sort);

ALTER TABLE categories ADD COLUMN IF NOT EXISTS image_id int;
ALTER TABLE categories ADD COLUMN IF NOT EXISTS active boolean DEFAULT true;

ALTER TABLE products ADD COLUMN IF NOT EXISTS sku text DEFAULT '';
ALTER TABLE products ADD COLUMN IF NOT EXISTS short_description text DEFAULT '';
ALTER TABLE products ADD COLUMN IF NOT EXISTS cost_price int DEFAULT 0;
ALTER TABLE products ADD COLUMN IF NOT EXISTS youtube_url text DEFAULT '';
ALTER TABLE products ADD COLUMN IF NOT EXISTS product_type text DEFAULT 'single';
ALTER TABLE products ADD COLUMN IF NOT EXISTS image_id int;
ALTER TABLE products ADD COLUMN IF NOT EXISTS seo_title text DEFAULT '';
ALTER TABLE products ADD COLUMN IF NOT EXISTS seo_description text DEFAULT '';
ALTER TABLE products ADD COLUMN IF NOT EXISTS low_stock int DEFAULT 3;
ALTER TABLE products ADD COLUMN IF NOT EXISTS weight_g int DEFAULT 0;
ALTER TABLE products ADD COLUMN IF NOT EXISTS unit text DEFAULT 'পিস';
ALTER TABLE products ADD COLUMN IF NOT EXISTS brand text DEFAULT '';
ALTER TABLE products ADD COLUMN IF NOT EXISTS sold_count int DEFAULT 0;
CREATE INDEX IF NOT EXISTS products_sku_idx ON products(sku);

CREATE TABLE IF NOT EXISTS bundle_items (
  id serial PRIMARY KEY, bundle_id int NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  product_id int NOT NULL REFERENCES products(id) ON DELETE CASCADE, qty int NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS bundle_items_bundle_idx ON bundle_items(bundle_id);

ALTER TABLE orders ADD COLUMN IF NOT EXISTS email text DEFAULT '';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS district text DEFAULT '';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS thana text DEFAULT '';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount int DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS coupon_code text DEFAULT '';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_status text DEFAULT 'unpaid';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS paid_amount int DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS transaction_id text DEFAULT '';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_number text DEFAULT '';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS courier text DEFAULT '';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS consignment_id text DEFAULT '';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS tracking_code text DEFAULT '';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS courier_status text DEFAULT '';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS courier_sent_at timestamptz;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS admin_note text DEFAULT '';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS ip text DEFAULT '';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS source text DEFAULT 'web';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS created_by int;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_id int;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cost_total int DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivered_at timestamptz;
CREATE INDEX IF NOT EXISTS orders_phone_idx ON orders(phone);
CREATE INDEX IF NOT EXISTS orders_status_idx ON orders(status);

ALTER TABLE order_items ADD COLUMN IF NOT EXISTS sku text DEFAULT '';
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS cost int DEFAULT 0;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS components jsonb;
CREATE INDEX IF NOT EXISTS order_items_order_idx ON order_items(order_id);
CREATE INDEX IF NOT EXISTS order_items_product_idx ON order_items(product_id);

CREATE TABLE IF NOT EXISTS customers (
  id serial PRIMARY KEY, name text NOT NULL DEFAULT '', phone text UNIQUE NOT NULL, email text DEFAULT '',
  address text DEFAULT '', district text DEFAULT '', thana text DEFAULT '', note text DEFAULT '',
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS blocklist (
  id serial PRIMARY KEY, kind text NOT NULL, value text NOT NULL, reason text DEFAULT '',
  created_by int, created_at timestamptz DEFAULT now(), UNIQUE(kind, value)
);

CREATE TABLE IF NOT EXISTS suppliers (
  id serial PRIMARY KEY, name text NOT NULL, company text DEFAULT '', phone text DEFAULT '', email text DEFAULT '',
  address text DEFAULT '', note text DEFAULT '', opening_due int DEFAULT 0, active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS purchases (
  id serial PRIMARY KEY, code text UNIQUE NOT NULL, supplier_id int REFERENCES suppliers(id) ON DELETE SET NULL,
  purchase_date date NOT NULL DEFAULT CURRENT_DATE, status text NOT NULL DEFAULT 'received',
  subtotal int NOT NULL DEFAULT 0, discount int NOT NULL DEFAULT 0, shipping int NOT NULL DEFAULT 0,
  other_cost int NOT NULL DEFAULT 0, vat int NOT NULL DEFAULT 0, total int NOT NULL DEFAULT 0,
  note text DEFAULT '', created_by int, received_at timestamptz, created_at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS purchase_items (
  id serial PRIMARY KEY, purchase_id int NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  product_id int REFERENCES products(id) ON DELETE SET NULL, name text NOT NULL, qty int NOT NULL, unit_cost int NOT NULL
);
CREATE TABLE IF NOT EXISTS stock_movements (
  id bigserial PRIMARY KEY, product_id int NOT NULL, change int NOT NULL, balance int, reason text NOT NULL,
  ref_type text DEFAULT '', ref_id int, note text DEFAULT '', staff_id int, created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS stock_movements_product_idx ON stock_movements(product_id, created_at DESC);

CREATE TABLE IF NOT EXISTS accounts (
  id serial PRIMARY KEY, name text NOT NULL, type text NOT NULL DEFAULT 'cash', details text DEFAULT '',
  opening_balance int NOT NULL DEFAULT 0, active boolean DEFAULT true, sort int DEFAULT 0
);
CREATE TABLE IF NOT EXISTS transactions (
  id serial PRIMARY KEY, tx_date date NOT NULL DEFAULT CURRENT_DATE, type text NOT NULL, category text DEFAULT '',
  amount int NOT NULL, account_id int REFERENCES accounts(id) ON DELETE SET NULL,
  to_account_id int REFERENCES accounts(id) ON DELETE SET NULL,
  supplier_id int, order_id int, purchase_id int, vat int NOT NULL DEFAULT 0, note text DEFAULT '',
  created_by int, created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS transactions_date_idx ON transactions(tx_date DESC);

CREATE TABLE IF NOT EXISTS coupons (
  id serial PRIMARY KEY, code text UNIQUE NOT NULL, type text NOT NULL DEFAULT 'percent', value int NOT NULL DEFAULT 0,
  min_order int NOT NULL DEFAULT 0, max_discount int NOT NULL DEFAULT 0, starts_on date, ends_on date,
  usage_limit int NOT NULL DEFAULT 0, used_count int NOT NULL DEFAULT 0, per_phone int NOT NULL DEFAULT 0,
  active boolean DEFAULT true, note text DEFAULT '', created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS blog_categories (
  id serial PRIMARY KEY, name text NOT NULL, slug text UNIQUE NOT NULL, sort int DEFAULT 0
);
CREATE TABLE IF NOT EXISTS blog_posts (
  id serial PRIMARY KEY, title text NOT NULL, slug text UNIQUE NOT NULL,
  category_id int REFERENCES blog_categories(id) ON DELETE SET NULL, excerpt text DEFAULT '', content text DEFAULT '',
  cover_id int, status text NOT NULL DEFAULT 'draft', published_at timestamptz, seo_title text DEFAULT '',
  seo_description text DEFAULT '', author_id int, views int DEFAULT 0,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS pages (
  id serial PRIMARY KEY, title text NOT NULL, slug text UNIQUE NOT NULL, content text DEFAULT '',
  in_footer boolean DEFAULT true, active boolean DEFAULT true, sort int DEFAULT 0, updated_at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS banners (
  id serial PRIMARY KEY, image_id int, title text DEFAULT '', subtitle text DEFAULT '', link text DEFAULT '',
  button text DEFAULT '', placement text NOT NULL DEFAULT 'slider', sort int DEFAULT 0, active boolean DEFAULT true
);
CREATE TABLE IF NOT EXISTS payments (
  id serial PRIMARY KEY, order_id int REFERENCES orders(id) ON DELETE CASCADE, method text NOT NULL,
  amount int NOT NULL, status text NOT NULL DEFAULT 'initiated', gateway_ref text DEFAULT '', trx_id text DEFAULT '',
  raw jsonb, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS payments_ref_idx ON payments(gateway_ref);
CREATE TABLE IF NOT EXISTS integration_logs (
  id bigserial PRIMARY KEY, service text NOT NULL, action text NOT NULL, ok boolean NOT NULL, message text DEFAULT '',
  ref text DEFAULT '', created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS integration_logs_created_idx ON integration_logs(created_at DESC);
`,
  // 2 — product SEO keywords + visitor analytics
  `
ALTER TABLE products ADD COLUMN IF NOT EXISTS seo_keywords text DEFAULT '';

CREATE TABLE IF NOT EXISTS visitors (
  id text PRIMARY KEY, first_seen timestamptz DEFAULT now(), last_seen timestamptz DEFAULT now(),
  visits int NOT NULL DEFAULT 0, pageviews int NOT NULL DEFAULT 0, orders int NOT NULL DEFAULT 0,
  name text NOT NULL DEFAULT '', phone text NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS visitors_last_idx ON visitors(last_seen);
CREATE TABLE IF NOT EXISTS visit_sessions (
  id text PRIMARY KEY, visitor_id text NOT NULL, started_at timestamptz DEFAULT now(), last_seen timestamptz DEFAULT now(),
  duration int NOT NULL DEFAULT 0, pageviews int NOT NULL DEFAULT 0, is_new boolean DEFAULT false,
  ip text DEFAULT '', country text DEFAULT '', region text DEFAULT '', city text DEFAULT '',
  device text DEFAULT '', os text DEFAULT '', browser text DEFAULT '', screen text DEFAULT '', lang text DEFAULT '',
  referrer text DEFAULT '', ref_host text DEFAULT '', source text DEFAULT '', medium text DEFAULT '', campaign text DEFAULT '',
  landing text DEFAULT '', exit_path text DEFAULT '', order_code text NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS visit_sessions_started_idx ON visit_sessions(started_at DESC);
CREATE INDEX IF NOT EXISTS visit_sessions_last_idx ON visit_sessions(last_seen DESC);
CREATE INDEX IF NOT EXISTS visit_sessions_visitor_idx ON visit_sessions(visitor_id, started_at DESC);
CREATE TABLE IF NOT EXISTS page_views (
  id bigserial PRIMARY KEY, session_id text NOT NULL, visitor_id text NOT NULL, path text NOT NULL, title text DEFAULT '',
  product_id int, duration int NOT NULL DEFAULT 0, scroll int NOT NULL DEFAULT 0, created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS page_views_created_idx ON page_views(created_at DESC);
CREATE INDEX IF NOT EXISTS page_views_session_idx ON page_views(session_id, id);
CREATE INDEX IF NOT EXISTS page_views_product_idx ON page_views(product_id, created_at) WHERE product_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS visit_events (
  id bigserial PRIMARY KEY, session_id text NOT NULL, visitor_id text NOT NULL, event text NOT NULL, label text DEFAULT '',
  ref text DEFAULT '', value int NOT NULL DEFAULT 0, path text DEFAULT '', created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS visit_events_created_idx ON visit_events(created_at DESC);
CREATE INDEX IF NOT EXISTS visit_events_session_idx ON visit_events(session_id, event);
`,
  // 3 — which live-score competitions visitors click on most
  `
CREATE TABLE IF NOT EXISTS live_clicks (
  day date NOT NULL, sport text NOT NULL, cat text NOT NULL, n int NOT NULL DEFAULT 0,
  PRIMARY KEY (day, sport, cat)
);
`,
];

// Data steps that need code, keyed by migration number (run after its SQL).
const MIGRATION_STEPS = {
  1: async () => {
    // Move old single product images (base64 text) into the media table.
    await pg.exec(`
      INSERT INTO media(mime, data, owner_type, owner_id, sort)
      SELECT substring(image from 6 for position(';' in image) - 6),
             decode(substring(image from position(',' in image) + 1), 'base64'), 'product', id, 0
      FROM products WHERE image LIKE 'data:image/%;base64,%' AND image_id IS NULL;
      UPDATE products p SET image_id = m.id FROM media m
        WHERE m.owner_type = 'product' AND m.owner_id = p.id AND p.image_id IS NULL;
      UPDATE products SET image = NULL WHERE image IS NOT NULL AND image_id IS NOT NULL;
      UPDATE orders SET payment_status = 'paid', paid_amount = total WHERE status = 'delivered' AND payment_status = 'unpaid';
    `);
    // Owner account from the old single admin password.
    const old = await one("SELECT value FROM settings WHERE key='admin_password'");
    const hasStaff = await one('SELECT id FROM staff LIMIT 1');
    if (old && old.value && !hasStaff) {
      await q(`INSERT INTO staff(name, username, password, role, permissions) VALUES('মালিক', 'admin', $1, 'owner', '[]')`, [old.value]);
    }
    // Customers from past orders.
    await pg.exec(`
      INSERT INTO customers(name, phone, address, created_at)
      SELECT DISTINCT ON (phone) customer_name, phone, address, created_at FROM orders ORDER BY phone, created_at DESC
      ON CONFLICT (phone) DO NOTHING;
      UPDATE orders o SET customer_id = c.id FROM customers c WHERE c.phone = o.phone AND o.customer_id IS NULL;
    `);
    // Default money accounts and the delivery charges the owner asked for.
    const acc = await one('SELECT id FROM accounts LIMIT 1');
    if (!acc) {
      await pg.exec(`INSERT INTO accounts(name, type, sort) VALUES ('ক্যাশ (হাতে)', 'cash', 0), ('ব্যাংক অ্যাকাউন্ট', 'bank', 1), ('বিকাশ', 'mobile', 2), ('নগদ', 'mobile', 3);`);
    }
    await setMany({ delivery_dhaka: '60', delivery_outside: '110' });
    await q(`INSERT INTO pages(title, slug, content, sort) VALUES
      ('আমাদের সম্পর্কে', 'about', 'এখানে আপনার দোকানের গল্প লিখুন। Admin → স্টোর ডিজাইন → পেজ থেকে এডিট করুন।', 0),
      ('রিটার্ন ও রিফান্ড নীতি', 'return-policy', 'পণ্য হাতে পাওয়ার সময় দেখে নিন। কোনো সমস্যা থাকলে ডেলিভারিম্যানের সামনেই জানান।', 1),
      ('প্রাইভেসি পলিসি', 'privacy-policy', 'আমরা শুধু অর্ডার ডেলিভারির জন্য আপনার নাম, ফোন আর ঠিকানা রাখি। কারো সাথে শেয়ার করি না।', 2),
      ('শর্তাবলি', 'terms', 'অর্ডার করার মাধ্যমে আপনি আমাদের শর্তাবলিতে সম্মত হচ্ছেন।', 3)
      ON CONFLICT (slug) DO NOTHING`);
  },
};

const SEED_CATEGORIES = [
  ['ইলেকট্রনিক্স', 'electronics', '📟'], ['সার্কিট', 'circuits', '🧩'], ['কম্পোনেন্ট', 'components', '🔋'],
  ['সোল্ডারিং', 'soldering', '🔥'], ['ইলেকট্রিক্যাল', 'electrical', '🔌'], ['ফ্যাশন', 'fashion', '👕'],
];
const SEED_PRODUCTS = [
  ['CA6928 Bluetooth Audio Module', 'electronics', 250, 300, 170, '🔊', true, 'পুরনো স্পিকার বা অ্যামপ্লিফায়ারকে ব্লুটুথ স্পিকার বানাতে এই মডিউল লাগান। ৫ ভোল্টে চলে, পরিষ্কার স্টেরিও সাউন্ড।'],
  ['PAM8403 Mini Amplifier Board', 'circuits', 120, null, 70, '🎵', true, '৫ ভোল্টের ছোট স্টেরিও অ্যামপ্লিফায়ার বোর্ড, প্রতি চ্যানেলে ৩ ওয়াট। ছোট স্পিকার প্রজেক্টের জন্য উপযুক্ত।'],
  ['12V DC-DC Converter', 'electrical', 180, null, 110, '⚡', true, 'ভোল্টেজ কমিয়ে বা বাড়িয়ে স্থির ১২ ভোল্ট দেয়। ব্যাটারি আর সোলার প্রজেক্টে কাজে লাগে।'],
  ['1000µF Capacitor', 'components', 25, null, 12, '🔋', false, '১০০০ মাইক্রোফ্যারাড ইলেকট্রোলাইটিক ক্যাপাসিটর। পাওয়ার সাপ্লাই ফিল্টারিংয়ের জন্য।'],
  ['Soldering Iron 60W', 'soldering', 350, 420, 240, '🔥', true, '৬০ ওয়াট সোল্ডারিং আয়রন, তাপমাত্রা নিয়ন্ত্রণসহ। দ্রুত গরম হয়, হাতে আরামদায়ক।'],
  ['Bridge Rectifier', 'components', 30, null, 15, '🔌', false, 'এসি থেকে ডিসি করার জন্য ব্রিজ রেক্টিফায়ার। পাওয়ার সাপ্লাই বানাতে দরকার।'],
  ['Inverter Circuit Board', 'circuits', 650, 750, 450, '🔧', true, '১২ ভোল্ট ব্যাটারি থেকে এসি পাওয়ার তৈরির ইনভার্টার বোর্ড।'],
  ['DC Motor 3V–9V', 'electrical', 90, null, 50, '⚙️', false, '৩ থেকে ৯ ভোল্টে চলা ছোট ডিসি মোটর। খেলনা, রোবট আর সায়েন্স প্রজেক্টের জন্য।'],
];

async function seed() {
  for (const [i, [name, slug, icon]] of SEED_CATEGORIES.entries()) {
    await q('INSERT INTO categories(name,slug,icon,sort) VALUES($1,$2,$3,$4) ON CONFLICT (slug) DO NOTHING', [name, slug, icon, i]);
  }
  for (const [i, [name, cat, price, oldPrice, cost, emoji, featured, desc]] of SEED_PRODUCTS.entries()) {
    await q(
      `INSERT INTO products(name,slug,category_id,price,old_price,cost_price,stock,description,short_description,emoji,featured,sku)
       VALUES($1,$2,(SELECT id FROM categories WHERE slug=$3),$4,$5,$6,25,$7,$7,$8,$9,$10) ON CONFLICT (slug) DO NOTHING`,
      [name, slugify(name), cat, price, oldPrice, cost, desc, emoji, featured, 'SM-' + String(1001 + i)]);
  }
}

let ready = null;
function ensureReady() {
  if (!ready) {
    ready = (async () => {
      await pg.exec(BASE);
      const v = await one("SELECT value FROM settings WHERE key='schema_version'");
      if (!v || Number(v.value) < MIGRATIONS.length) {
        // Only one server instance migrates at a time.
        await q('SELECT pg_advisory_lock(726201)');
        try {
          const fresh = (await one('SELECT count(*)::int AS n FROM categories')).n === 0;
          const cur = await one("SELECT value FROM settings WHERE key='schema_version'");
          let version = cur ? Number(cur.value) : 0;
          for (let i = version; i < MIGRATIONS.length; i++) {
            await pg.exec(MIGRATIONS[i]);
            if (MIGRATION_STEPS[i + 1]) await MIGRATION_STEPS[i + 1]();
            version = i + 1;
            await setSetting('schema_version', String(version));
          }
          if (fresh) await seed();
        } finally {
          await q('SELECT pg_advisory_unlock(726201)');
        }
      }
      const secret = await one("SELECT value FROM settings WHERE key='session_secret'");
      if (!secret) {
        await q("INSERT INTO settings(key,value) VALUES('session_secret',$1) ON CONFLICT DO NOTHING", [crypto.randomBytes(32).toString('hex')]);
      }
    })().catch((e) => { ready = null; throw e; });
  }
  return ready;
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
const DEFAULT_SETTINGS = {
  store_name: 'সবমিলবে',
  tagline: 'ইলেকট্রনিক্স কম্পোনেন্ট থেকে প্রতিদিনের দরকারি জিনিস, সবই এক জায়গায়।',
  hero_title: 'দরকারি সব পার্টস, এক দোকানে',
  notice: '🚚 সারা বাংলাদেশে হোম ডেলিভারি, পণ্য হাতে পেয়ে টাকা দিন',
  phone: '', whatsapp: '', email: '', address: '',
  site_url: '',
  delivery_dhaka: '60', delivery_outside: '110', free_delivery_min: '0',
  dhaka_city_areas: '', // JSON list; empty = default Dhaka Metropolitan thanas
  order_prefix: 'SM',
  min_order: '0',
  max_orders_per_phone_day: '5',
  block_message: 'দুঃখিত, এই নম্বর থেকে অনলাইনে অর্ডার নেওয়া যাচ্ছে না। অর্ডার করতে আমাদের কল করুন।',
  low_stock_default: '3',
  copy_protect: '1',
  // look & feel
  color_primary: '#0866D6', color_accent: '#F5A524',
  logo_id: '', favicon_id: '', og_image_id: '',
  grid_cols: '4', show_buy_now_on_card: '1', show_cat_strip: '1',
  // visitor analytics
  visitor_tracking: '1', visitor_exclude_admin: '1', visitor_keep_days: '60',
  home_sections: '["slider","categories","featured","new","bestsellers","blog"]',
  header_menu: '[{"label":"সব পণ্য","url":"/products"},{"label":"অফার","url":"/products?sort=offer"},{"label":"ব্লগ","url":"/blog"},{"label":"অর্ডার ট্র্যাক","url":"/track"}]',
  footer_about: '',
  footer_links: '[]',
  // marketing
  seo_title: '', seo_description: '', seo_keywords: '',
  fb_pixel_id: '', fb_capi_token: '', fb_domain_verification: '', fb_test_code: '',
  tiktok_pixel_id: '', tiktok_events_token: '', tiktok_domain_verification: '',
  gtm_id: '', ga4_id: '', google_site_verification: '', bing_site_verification: '',
  custom_head: '', custom_body: '',
  verification_files: '[]',
  social_facebook: '', social_instagram: '', social_youtube: '', social_tiktok: '', social_linkedin: '',
  social_x: '', social_pinterest: '', social_telegram: '',
  chat_whatsapp_button: '1', chat_messenger_page: '', chat_tawk_property: '', chat_tawk_widget: 'default', chat_script: '',
  // payments
  pay_cod: '1', pay_cod_note: 'পণ্য হাতে পেয়ে টাকা দিন',
  pay_bkash: '0', bkash_sandbox: '1', bkash_app_key: '', bkash_app_secret: '', bkash_username: '', bkash_password: '',
  bkash_account_id: '', ssl_account_id: '',
  pay_ssl: '0', ssl_sandbox: '1', ssl_store_id: '', ssl_store_password: '',
  pay_manual: '0', manual_bkash: '', manual_nagad: '', manual_rocket: '', manual_upay: '', manual_type: 'Personal',
  manual_note: 'নিচের নম্বরে Send Money করে Transaction ID লিখুন।',
  // courier
  courier_default: '', courier_auto_send: '0',
  steadfast_api_key: '', steadfast_secret_key: '', steadfast_base_url: 'https://portal.packzy.com/api/v1', steadfast_webhook_token: '',
  pathao_client_id: '', pathao_client_secret: '', pathao_username: '', pathao_password: '', pathao_store_id: '', pathao_sandbox: '0',
  pathao_token: '', pathao_token_expires: '', pathao_webhook_secret: '',
  redx_token: '', redx_sandbox: '0', redx_pickup_store_id: '',
  // accounting
  vat_mode: 'none', vat_rate: '15', vat_bin: '', tin: '', trade_license: '',
  // live sports scores
  live_cricket: '0', live_football: '0', live_nav_label: 'লাইভ স্কোর', live_refresh: '20', live_football_leagues: '', live_cricket_leagues: '', live_cricket_always_bd: '1', live_mini: '1', nav_live: '1', nav_cart: '1', foot_products: '1', foot_offer: '1', foot_track: '1', foot_blog: '1', foot_contact: '1',
  live_cricket_source: 'auto', live_cricket_embed: '', live_football_source: 'auto', live_football_embed: '',
  // product feeds for Google Merchant Center and Facebook catalog
  feed_google_token: '', feed_facebook_token: '', feed_brand: '', feed_condition: 'new', feed_include_out: '1',
  feed_google_category: '', feed_shipping: '', feed_title_lang: 'name',
  // domain
  vercel_token: '', vercel_project: '', custom_domain: '',
};
const SECRET_KEYS = new Set(['session_secret', 'admin_password', 'fb_capi_token', 'tiktok_events_token', 'bkash_app_secret',
  'bkash_password', 'ssl_store_password', 'steadfast_secret_key', 'pathao_client_secret', 'pathao_password',
  'pathao_token', 'redx_token', 'vercel_token']);

async function getSettings() {
  const rows = await q('SELECT key, value FROM settings');
  const s = { ...DEFAULT_SETTINGS };
  rows.forEach((r) => { if (r.value !== null) s[r.key] = r.value; });
  return s;
}
async function setSetting(key, value) {
  await q('INSERT INTO settings(key,value) VALUES($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value', [key, String(value ?? '')]);
}
async function setMany(obj) {
  for (const [k, v] of Object.entries(obj)) await setSetting(k, v);
}
function jsonSetting(settings, key, fallback = []) {
  try { const v = JSON.parse(settings[key] || ''); return v ?? fallback; } catch (_) { return fallback; }
}

// ---------------------------------------------------------------------------
// Activity log
// ---------------------------------------------------------------------------
async function logActivity(staffId, action, entity = '', entityId = null, detail = '') {
  try {
    await q('INSERT INTO activity_log(staff_id, action, entity, entity_id, detail) VALUES($1,$2,$3,$4,$5)',
      [staffId || null, action, entity, entityId, String(detail || '').slice(0, 500)]);
  } catch (e) { console.error('activity log failed', e.message); }
}
async function logIntegration(service, action, ok, message = '', ref = '') {
  try {
    await q('INSERT INTO integration_logs(service, action, ok, message, ref) VALUES($1,$2,$3,$4,$5)',
      [service, action, !!ok, String(message || '').slice(0, 1000), String(ref || '')]);
  } catch (e) { console.error('integration log failed', e.message); }
}

async function uniqueSlug(table, base, exceptId = null) {
  let slug = base;
  for (let i = 2; i < 200; i++) {
    const row = await one(`SELECT id FROM ${table} WHERE slug=$1`, [slug]);
    if (!row || row.id === exceptId) return slug;
    slug = `${base}-${i}`;
  }
  return `${base}-${randomCode(4).toLowerCase()}`;
}

module.exports = {
  pg, q, one, tx, ensureReady, getSettings, setSetting, setMany, jsonSetting, DEFAULT_SETTINGS, SECRET_KEYS,
  logActivity, logIntegration, uniqueSlug,
};
