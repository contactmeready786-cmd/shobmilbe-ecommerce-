#!/usr/bin/env node
// Write-action parity: runs the same customer and admin actions (POST forms, JSON APIs, image upload)
// against a site on a fresh test database, then records every answer plus the resulting database rows.
// Running it on the old and the new site and diffing the two files proves the actions behave the same.
//   node tools/parity/scenarios.mjs <base-url> <out-file>
// Only for a LOCAL test server on a copy of the test template — it changes data.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { normalise } from './normalise.mjs';

const [base, outFile] = process.argv.slice(2);
const origin = new URL(base).origin;
const log = [];
const jars = { svc: {}, shop: {}, admin: {} };
const jarHeader = (j) => Object.entries(jars[j]).map(([k, v]) => `${k}=${v}`).join('; ');
function keep(j, res) {
  for (const c of res.headers.getSetCookie()) {
    const [pair] = c.split(';'); const i = pair.indexOf('=');
    const k = pair.slice(0, i).trim(), v = pair.slice(i + 1).trim();
    if (!v || /max-age=0/i.test(c)) delete jars[j][k]; else jars[j][k] = v;
  }
}
async function call(step, jar, method, path, body, type = 'form') {
  const headers = { cookie: jarHeader(jar), origin, referer: origin + path, 'user-agent': 'Mozilla/5.0 parity-scenarios', 'accept-language': 'bn' };
  let payload;
  if (body !== undefined) {
    if (type === 'json') { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
    else { headers['content-type'] = 'application/x-www-form-urlencoded'; payload = new URLSearchParams(body).toString(); }
  }
  let res;
  try { res = await fetch(origin + path, { method, headers, body: payload, redirect: 'manual', signal: AbortSignal.timeout(30000) }); }
  catch (e) { log.push({ step, method, path, status: 'no answer: ' + e.name }); return { res: null, text: '' }; }
  keep(jar, res);
  const text = await res.text();
  const ct = res.headers.get('content-type') || '';
  // HTML pages are already covered page by page by the crawl; here the error/notice text is what matters
  const short = /json/.test(ct) ? text : (text.match(/class="(?:alert|notice|error|flash)[^"]*"[^>]*>([\s\S]{0,300}?)</) || [, ''])[1];
  log.push({ step, method, path, status: res.status, location: res.headers.get('location') ? normalise(res.headers.get('location')) : undefined, body: normalise(short || '') });
  return { res, text };
}
const id = (sql) => execFileSync('psql', ['-Atc', sql, process.env.PGDATABASE]).toString().trim();

// Every admin form address (POST) from the admin's own route tables (tools/parity/routes.ts, bundled like coverage.mjs).
// Addresses with an id get 1; ones that would end this login (log out, lock, passwords, two-step login) are left out.
function adminFormPaths() {
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
  const esbuild = process.env.ESBUILD || ['node_modules/.bin/esbuild', '/opt/npm-tools/node_modules/esbuild/bin/esbuild'].map((p) => path.resolve(root, p)).find((p) => fs.existsSync(p));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'forms-'));
  fs.writeFileSync(path.join(tmp, 'entry.ts'), `import { adminRoutes } from ${JSON.stringify(path.join(root, 'tools/parity/routes.ts'))};
console.log(JSON.stringify(adminRoutes().filter((r) => r.method === 'POST' || r.method === '*').map((r) => (r.path instanceof RegExp ? { re: r.path.source } : r.path))));`);
  execFileSync(esbuild, [path.join(tmp, 'entry.ts'), '--bundle', '--platform=node', '--format=cjs', `--alias:@=${root}`, '--external:pg-native', '--external:pg-cloudflare', '--external:cloudflare:sockets', '--log-level=error', '--outfile=' + path.join(tmp, 'out.cjs')]);
  const list = JSON.parse(execFileSync('node', [path.join(tmp, 'out.cjs')], { env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL || 'postgres://x@127.0.0.1:1/x' } }).toString());
  const asPath = (r) => (typeof r === 'string' ? r : r.re.replace(/^\^/, '').replace(/\$$/, '').replace(/\\\//g, '/').replace(/\(\\d\+\)|\\d\+/g, '1'));
  const ends = /logout|login|lock|passkey|webauthn|password|2fa|tfa|verify|reset|session|staff|setup/;
  // answers that depend on an outside service over the internet (machine translation, web research) differ run to run
  const internet = /\/design\/language\/(fill|redo)$|\/api\/research\/run$/;
  return [...new Set(list.map(asPath))].filter((p) => p.startsWith('/admin') && !/[\\[\](){}*+|?^$]/.test(p) && !ends.test(p) && !internet.test(p)).sort();
}

// a 1x1 PNG
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

async function main() {
  const uno = id("select id from products where slug='arduino-uno-r3'");
  const servo = id("select id from products where slug='sg90-servo'");
  const cat = id("select id from categories where slug='module'");

  // ---------- customer ----------
  await call('open shop', 'shop', 'GET', '/');
  await call('cart api', 'shop', 'GET', `/api/cart?ids=${uno},${servo}`);
  await call('quote', 'shop', 'POST', '/api/quote', { items: [{ id: uno, qty: 2 }, { id: servo, qty: 1 }] }, 'json');
  await call('order: missing name', 'shop', 'POST', '/api/orders', { items: [{ id: uno, qty: 1 }], name: '', phone: '01711111111' }, 'json');
  await call('order: bad phone', 'shop', 'POST', '/api/orders', { items: [{ id: uno, qty: 1 }], name: 'জামাল', phone: '123' }, 'json');
  await call('order: no consent', 'shop', 'POST', '/api/orders', { items: [{ id: uno, qty: 1 }], name: 'জামাল', phone: '01711111111', district: 'Dhaka', thana: 'Adabor', address: 'বাসা ৫, রোড ৭' }, 'json');
  await call('order: ok', 'shop', 'POST', '/api/orders', { items: [{ id: uno, qty: 2 }, { id: servo, qty: 1 }], name: 'জামাল হোসেন', phone: '01711111111',
    district: 'Dhaka', thana: 'Adabor', address: 'বাসা ৫, রোড ৭, আদাবর', consent: '1', payment: 'cod', note: 'বিকেলে দিন' }, 'json');
  await call('coupon: unknown', 'shop', 'POST', '/api/coupon', { code: 'NOPE' }, 'json');
  await call('subscribe', 'shop', 'POST', '/api/subscribe', { email: 'test@example.com' }, 'json');
  await call('stock alert', 'shop', 'POST', '/api/stock-alert', { product: id("select id from products where slug='arduino-nano'"), phone: '01722222222' }, 'json');
  await call('question', 'shop', 'POST', '/api/question', { product: uno, name: 'রাফি', phone: '01733333333', question: 'এটা কি অরিজিনাল?' }, 'json');
  await call('track', 'shop', 'GET', '/track?phone=01711111111');
  // the small APIs the pages call (each now its own Next.js route — lib/api/)
  await call('price alert', 'shop', 'POST', '/api/price-alert', { product: uno, phone: '01744444444' }, 'json');
  await call('price alert: robot', 'shop', 'POST', '/api/price-alert', { product: uno, phone: '01744444444', website: 'x' }, 'json');
  await call('wish on', 'shop', 'POST', '/api/wish', { id: uno, on: 1 }, 'json');
  await call('points', 'shop', 'POST', '/api/points', { phone: '01711111111' }, 'json');
  await call('gift card check', 'shop', 'POST', '/api/giftcard', { code: 'NOPE-1234' }, 'json');
  await call('checkout draft', 'shop', 'POST', '/api/checkout-draft', { phone: '01755555555', name: 'সাকিব', items: [{ id: uno, qty: 1 }] }, 'json');
  await call('review: not my order', 'shop', 'POST', '/api/review', { code: 'TEST1002', product: uno, rating: 5, body: 'ভালো' }, 'json');
  await call('push subscribe: off', 'shop', 'POST', '/api/push/subscribe', { sub: {} }, 'json');
  await call('i18n: off', 'shop', 'POST', '/api/i18n', { t: ['হ্যালো'] }, 'json');
  await call('i18n fix: off', 'shop', 'GET', '/api/i18n/fix');
  await call('live: off', 'shop', 'GET', '/api/live/cricket');
  await call('live click', 'shop', 'POST', '/api/live/click', { sport: 'cricket', cat: 'bpl' }, 'json');
  await call('visit beacon', 'shop', 'POST', '/api/v', { t: 'pv', p: '/' }, 'json');
  await call('csp report', 'shop', 'POST', '/api/csp-report', { 'csp-report': { 'document-uri': 'https://x/admin', 'violated-directive': 'script-src', 'blocked-uri': 'inline' } }, 'json');
  await call('suggest', 'shop', 'GET', `/api/suggest?ids=${uno}`);
  await call('cards', 'shop', 'GET', `/api/cards?ids=${uno},${servo}`);
  await call('for you', 'shop', 'GET', `/api/for-you?seen=${uno}`);
  await call('search suggest', 'shop', 'GET', '/api/search-suggest?q=arduino');
  await call('resume: unknown', 'shop', 'GET', '/api/resume?id=1');
  await call('app offers', 'shop', 'GET', '/api/app/offers?after=1');
  await call('app inbox', 'shop', 'GET', '/api/app/inbox');
  await call('GET where POST is meant', 'shop', 'GET', '/api/coupon');

  // ---------- outside services calling in (payments, couriers, daily jobs) — fake data, must be refused alike ----------
  await call('steadfast webhook: no token', 'svc', 'POST', '/webhook/steadfast', { consignment_id: 1, status: 'delivered' }, 'json');
  await call('steadfast webhook: wrong token', 'svc', 'POST', '/webhook/steadfast?token=wrong', { consignment_id: 1, status: 'delivered' }, 'json');
  await call('pathao webhook: bad', 'svc', 'POST', '/webhook/pathao', { event: 'order.delivered', consignment_id: 'X' }, 'json');
  await call('sslcommerz success: no session', 'svc', 'POST', '/pay/ssl/success', { tran_id: 'TEST1001', val_id: 'fake', status: 'VALID' });
  await call('sslcommerz ipn: fake', 'svc', 'POST', '/pay/ssl/ipn', { tran_id: 'TEST1001', val_id: 'fake', status: 'VALID' });
  await call('bkash callback: fake', 'svc', 'GET', '/pay/bkash/callback?paymentID=fake&status=success');
  await call('autocall webhook: unknown', 'svc', 'POST', '/webhook/autocall/aaaaaaaaaaaaaaaa', { digit: '1' });
  await call('autocall webhook: bad address', 'svc', 'POST', '/webhook/autocall/short', { digit: '1' });
  await call('picture: sent a form', 'svc', 'POST', '/media/1', { x: '1' });
  await call('pay: unknown order', 'svc', 'GET', '/pay/NOPE1234');
  await call('pay: unknown step', 'svc', 'POST', '/pay/zz/zz', { a: '1' });
  await call('mail open pixel: bad', 'svc', 'GET', '/e/o/1/aaaaaaaaaaaaaaaa.gif');
  await call('mail click: bad', 'svc', 'GET', '/e/c/1/aaaaaaaaaaaaaaaa');
  await call('unsubscribe: bad', 'svc', 'GET', '/unsubscribe?e=x&t=y');
  await call('backup tick: no secret', 'svc', 'GET', '/api/backup/tick');
  await call('research tick: no secret', 'svc', 'GET', '/api/research/tick');
  await call('HEAD home', 'svc', 'HEAD', '/');
  await call('OPTIONS api', 'svc', 'OPTIONS', '/api/cart');

  // ---------- admin ----------
  await call('login: wrong', 'admin', 'POST', '/admin/login', { login: 'owner', password: 'wrong-password' });
  await call('login', 'admin', 'POST', '/admin/login', { login: 'owner', password: 'Parity-Test-9271!' });
  await call('upload image', 'admin', 'POST', '/admin/api/media', { data: PNG, thumb: PNG, width: 1, height: 1 }, 'json');
  const media = id('select max(id) from media');
  await call('product: no price', 'admin', 'POST', '/admin/products/new', { name: 'LM7805 Regulator', price: '', stock: '10', category_id: cat });
  await call('product: too dear', 'admin', 'POST', '/admin/products/new', { name: 'LM7805 Regulator', price: '2500', stock: '10', category_id: cat });
  await call('product: ok', 'admin', 'POST', '/admin/products/new', { name: 'LM7805 Regulator', price: '12.40', stock: '30', category_id: cat,
    short_description: '৫ ভোল্ট রেগুলেটর', description: 'TO-220 প্যাকেজ', images: media, active: '1', unit: 'পিস' });
  await call('category: new', 'admin', 'POST', '/admin/categories', { name: 'রেগুলেটর', icon: '⚡' });
  const ord = id("select id from orders where phone='01711111111' order by id desc limit 1") || '1';
  await call('order: confirm', 'admin', 'POST', `/admin/orders/${ord}/status`, { status: 'confirmed' });
  await call('order: deliver', 'admin', 'POST', `/admin/orders/${ord}/status`, { status: 'delivered' });
  await call('order: bulk', 'admin', 'POST', '/admin/orders/bulk', { action: 'status', status: 'processing', 'ids[]': '1' });
  await call('product: hide', 'admin', 'POST', `/admin/products/${servo}/active`, { active: '0' });
  await call('product: delete (to bin)', 'admin', 'POST', `/admin/products/${id("select id from products where slug='1k-resistor'")}/delete`, {});
  // every other admin form once, sent empty: the same check, message or redirect on both sites
  const forms = adminFormPaths();
  console.error(`scenarios: ${forms.length} admin forms`);
  for (const p of forms) await call('admin form: ' + p, 'admin', 'POST', p, {});
  await call('logout', 'admin', 'POST', '/admin/logout', {});

  // ---------- resulting data ----------
  const tables = ['orders', 'order_items', 'products', 'categories', 'customers', 'stock_moves', 'activity_log', 'trash', 'email_subs', 'stock_alerts', 'product_questions', 'media', 'price_alerts', 'checkout_drafts', 'live_clicks', 'shop_push_subs'];
  const data = {};
  for (const t of tables) {
    const exists = id(`select to_regclass('public.${t}') is not null`) === 't';
    if (!exists) continue;
    const cols = id(`select string_agg(column_name, ',' order by ordinal_position) from information_schema.columns where table_name='${t}'
      and data_type not like 'timestamp%' and data_type <> 'bytea' and column_name not in ('ip','token','session_ver','code','password_hash')`);
    data[t] = normalise(execFileSync('psql', ['-Atc', `select ${cols} from ${t} order by 1`, process.env.PGDATABASE]).toString());
  }
  fs.writeFileSync(outFile, JSON.stringify({ log, data }, null, 1));
  console.error(`scenarios: ${log.length} steps, statuses ${[...new Set(log.map((l) => l.status))].join(',')}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
