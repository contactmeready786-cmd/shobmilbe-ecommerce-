// Write-action parity: runs the same customer and admin actions (POST forms, JSON APIs, image upload)
// against a site on a fresh test database, then records every answer plus the resulting database rows.
// Running it on the old and the new site and diffing the two files proves the actions behave the same.
//   npx tsx tools/parity/scenarios.mts <base-url> <out-file>
// Only for a LOCAL test server on a copy of the test template — it changes data.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { normalise } from './normalise.ts';

type Jar = 'svc' | 'shop' | 'admin';
type Step = { step: string; method: string; path: string; status: number | string; location?: string; body?: string };
type Payload = Record<string, unknown>;

const [base, outFile] = process.argv.slice(2);
const origin = new URL(base).origin;
const log: Step[] = [];
// customer form answers are whole pages (or a redirect): while this is on, the whole page is compared, not only its message
let wholePage = false;
const jars: Record<Jar, Record<string, string>> = { svc: {}, shop: {}, admin: {} };
const jarHeader = (j: Jar) => Object.entries(jars[j]).map(([k, v]) => `${k}=${v}`).join('; ');
function keep(j: Jar, res: Response): void {
  for (const c of res.headers.getSetCookie()) {
    const [pair] = c.split(';'); const i = pair.indexOf('=');
    const k = pair.slice(0, i).trim(), v = pair.slice(i + 1).trim();
    if (!v || /max-age=0/i.test(c)) delete jars[j][k]; else jars[j][k] = v;
  }
}
// a new complaint's and a new return request's numbers are drawn at random (C + 6 digits, R + 6 letters/digits)
const newCodes = (t: string) => t.replace(/\bC\d{6}\b/g, '«complaint-no»').replace(/\bR[A-Z0-9]{6}\b/g, '«return-no»');
async function call(step: string, jar: Jar, method: string, path: string, body?: Payload | unknown[], type: 'form' | 'json' = 'form', extra: Record<string, string> = {}): Promise<{ res: Response | null; text: string }> {
  const headers: Record<string, string> = { cookie: jarHeader(jar), origin, referer: origin + path, 'user-agent': 'Mozilla/5.0 parity-scenarios', 'accept-language': 'bn', ...extra };
  let payload: string | undefined;
  if (body !== undefined) {
    if (type === 'json') { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
    else { headers['content-type'] = 'application/x-www-form-urlencoded'; payload = new URLSearchParams(body as Record<string, string>).toString(); }
  }
  let res: Response;
  try { res = await fetch(origin + path, { method, headers, body: payload, redirect: 'manual', signal: AbortSignal.timeout(30000) }); }
  catch (e) { log.push({ step, method, path, status: 'no answer: ' + (e as Error).name }); return { res: null, text: '' }; }
  keep(jar, res);
  const text = await res.text();
  const ct = res.headers.get('content-type') || '';
  // HTML pages are already covered page by page by the crawl; here the error/notice text is what matters
  const short = /json/.test(ct) || wholePage ? text : (text.match(/class="(?:alert|notice|error|flash)[^"]*"[^>]*>([\s\S]{0,300}?)</) || [, ''])[1];
  log.push({ step, method, path, status: res.status, location: res.headers.get('location') ? normalise(res.headers.get('location')) : undefined, body: wholePage ? newCodes(normalise(short || '')) : normalise(short || '') });
  return { res, text };
}
const id = (sql: string): string => execFileSync('psql', ['-Atc', sql, process.env.PGDATABASE || '']).toString().trim();

// Every admin form address (POST) from the admin's own route tables (tools/parity/routes.ts, loaded by tsx).
// Addresses with an id get 1; ones that would end this login (log out, lock, passwords, two-step login) are left out.
async function adminFormPaths(): Promise<string[]> {
  type Route = { method: string; path: string | RegExp };
  const { adminRoutes } = (await import('./routes.ts')) as { adminRoutes: () => Route[] };
  const list = adminRoutes().filter((r) => r.method === 'POST' || r.method === '*').map((r) => r.path);
  const asPath = (r: string | RegExp) => (typeof r === 'string' ? r : r.source.replace(/^\^/, '').replace(/\$$/, '').replace(/\\\//g, '/').replace(/\(\\d\+\)|\\d\+/g, '1'));
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

  // ---------- customer forms: complaint, track, own order (cancel / change / return), gift card, account ----------
  // (each answers with a page or a redirect; the whole page, the redirect and the saved rows are compared)
  wholePage = true;
  await call('complaint: from another site', 'shop', 'POST', '/complaint', { name: 'রহিম', phone: '01700000001', topic: 'delivery', message: 'দেরি' }, 'form', { origin: 'https://example.com', referer: 'https://example.com/' });
  await call('complaint: robot', 'shop', 'POST', '/complaint', { website: 'x', name: 'রহিম' });
  await call('complaint: empty', 'shop', 'POST', '/complaint', {});
  await call('complaint: ok', 'shop', 'POST', '/complaint', { name: 'রহিম উদ্দিন', phone: '01700000001', email: '', order_code: 'TEST1001', topic: 'delivery', message: 'পণ্য এখনো পাইনি, একটু দেখবেন?' });
  await call('complaint status: wrong phone', 'shop', 'GET', '/complaint/status?code=CMP-1&phone=01799999999');
  await call('complaint status: ok', 'shop', 'GET', '/complaint/status?code=CMP-1&phone=01700000001');
  await call('track: wrong phone', 'shop', 'GET', '/track?code=TEST1002&phone=01799999999');
  await call('order cancel: not opened here', 'shop', 'POST', '/order/TEST1001/cancel', { reason: 'ভুল অর্ডার' });
  await call('return: not opened here', 'shop', 'POST', '/order/TEST1002/return', { reason: 'ভাঙা' });
  await call('track: TEST1001', 'shop', 'GET', '/track?code=TEST1001&phone=01700000001');
  await call('track: TEST1002', 'shop', 'GET', '/track?code=TEST1002&phone=01800000002');
  await call('order cancel: GET', 'shop', 'GET', '/order/TEST1001/cancel');
  await call('order edit: bad phone', 'shop', 'POST', '/order/TEST1001/edit', { name: 'রহিম উদ্দিন', phone: '12', address: 'বাড়ি ১, রোড ২' });
  await call('order edit: ok', 'shop', 'POST', '/order/TEST1001/edit', { name: 'রহিম উদ্দিন', phone: '01700000001', address: 'বাড়ি ৩, রোড ৪', district: 'Dhaka', thana: 'Adabor', note: 'সকালে' });
  await call('order cancel: ok', 'shop', 'POST', '/order/TEST1001/cancel', { reason: 'ভুল অর্ডার', details: 'আর লাগবে না' });
  const item = id("select min(i.id) from order_items i join orders o on o.id=i.order_id where o.code='TEST1002'");
  await call('return: robot', 'shop', 'POST', '/order/TEST1002/return', { website: 'x' });
  await call('return: nothing picked', 'shop', 'POST', '/order/TEST1002/return', { reason: 'damaged', want: 'refund' });
  await call('return: ok', 'shop', 'POST', '/order/TEST1002/return', { item, [`qty_${item}`]: '1', reason: 'damaged', want: 'replace', details: 'বোর্ড কাজ করছে না', refund_method: 'bkash', refund_number: '01800000002' });
  await call('gift card: robot', 'shop', 'POST', '/gift-card', { website: 'x' });
  await call('gift card: empty', 'shop', 'POST', '/gift-card', {});
  await call('gift card: no payment way', 'shop', 'POST', '/gift-card', { amount: '500', recipient_name: 'রাফি', recipient_phone: '01733333333', buyer_name: 'সাকিব', buyer_phone: '01755555555', pay_method: 'bkash', pay_number: '01755555555', trx: 'AB12CD34EF' });
  await call('account: send SMS code', 'shop', 'POST', '/account/code', { phone: '01766666666', next: '/cart' });
  await call('account: bad phone', 'shop', 'POST', '/account/code', { phone: '12' });
  await call('account: wrong SMS code', 'shop', 'POST', '/account/verify', { phone: '01766666666', code: '000000' });
  await call('account: e-mail sign-up code', 'shop', 'POST', '/account/email-code', { email: 'new@example.com', mode: 'signup', password: 'Abcdef123456', password2: 'Abcdef123456' });
  await call('account: e-mail reset code', 'shop', 'POST', '/account/email-code', { email: 'bad', mode: 'reset' });
  await call('account: e-mail login wrong', 'shop', 'POST', '/account/email-login', { email: 'nobody@example.com', password: 'wrong-one-123' });
  await call('account: wrong e-mail code', 'shop', 'POST', '/account/email-verify', { email: 'new@example.com', code: '000000', mode: 'signup' });
  await call('account: profile while logged out', 'shop', 'POST', '/account/profile', { name: 'x' });
  await call('account: address while logged out', 'shop', 'POST', '/account/address', { line: 'x' });
  await call('account: address delete while logged out', 'shop', 'POST', '/account/address/delete', { id: '1' });
  await call('account: log out everywhere while logged out', 'shop', 'POST', '/account/logout-all', {});
  await call('account: from another site', 'shop', 'POST', '/account/code', { phone: '01766666666' }, 'form', { origin: 'https://example.com', referer: 'https://example.com/' });
  await call('account: logout', 'shop', 'POST', '/account/logout', {});
  await call('account: unknown address', 'shop', 'POST', '/account/nothing-here', {});
  wholePage = false;

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
  const forms = await adminFormPaths();
  console.error(`scenarios: ${forms.length} admin forms`);
  for (const p of forms) await call('admin form: ' + p, 'admin', 'POST', p, {});
  await call('logout', 'admin', 'POST', '/admin/logout', {});

  // ---------- resulting data ----------
  const tables = ['complaints', 'gift_cards', 'return_requests', 'customers', 'customer_addresses', 'orders', 'order_items', 'products', 'categories', 'customers', 'stock_moves', 'activity_log', 'trash', 'email_subs', 'stock_alerts', 'product_questions', 'media', 'price_alerts', 'checkout_drafts', 'live_clicks', 'shop_push_subs'];
  const data: Record<string, string> = {};
  for (const t of tables) {
    const exists = id(`select to_regclass('public.${t}') is not null`) === 't';
    if (!exists) continue;
    const cols = id(`select string_agg(column_name, ',' order by ordinal_position) from information_schema.columns where table_name='${t}'
      and data_type not like 'timestamp%' and data_type <> 'bytea' and column_name not in ('ip','token','session_ver','code','password_hash')`);
    data[t] = normalise(execFileSync('psql', ['-Atc', `select ${cols} from ${t} order by 1`, process.env.PGDATABASE || '']).toString());
  }
  fs.writeFileSync(outFile, JSON.stringify({ log, data }, null, 1));
  console.error(`scenarios: ${log.length} steps, statuses ${[...new Set(log.map((l) => l.status))].join(',')}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
