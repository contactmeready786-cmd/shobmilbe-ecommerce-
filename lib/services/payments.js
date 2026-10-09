'use strict';
// Online payments: bKash Tokenized Checkout and SSLCommerz (cards, Nagad, Rocket, bank).
const db = require('../db');
const { fetchJson, int } = require('../util');

const MANUAL = { manual_bkash: ['বিকাশ', 'manual_bkash'], manual_nagad: ['নগদ', 'manual_nagad'], manual_rocket: ['রকেট', 'manual_rocket'], manual_upay: ['উপায়', 'manual_upay'] };

// Which payment options the checkout shows.
function methods(settings) {
  const out = [];
  if (settings.pay_cod === '1') {
    const cod = { id: 'cod', label: 'ক্যাশ অন ডেলিভারি', note: settings.pay_cod_note || 'পণ্য হাতে পেয়ে টাকা দিন' };
    // delivery charge first (Admin → সেটিংস): needs a Send Money number to send it to
    const adv = ['new', 'all'].includes(settings.cod_advance) ? Object.entries(MANUAL).find(([, [, key]]) => settings[key]) : null;
    if (adv) Object.assign(cod, { advance: settings.cod_advance, number: settings[adv[1][1]], numberLabel: adv[1][0] });
    out.push(cod);
  }
  if (settings.pay_bkash === '1' && settings.bkash_app_key && settings.bkash_app_secret && settings.bkash_username && settings.bkash_password) {
    out.push({ id: 'bkash', label: 'বিকাশ দিয়ে পেমেন্ট', note: 'বিকাশ পেমেন্ট পেজে নিয়ে যাওয়া হবে' });
  }
  if (settings.pay_ssl === '1' && settings.ssl_store_id && settings.ssl_store_password) {
    out.push({ id: 'ssl', label: 'কার্ড / নগদ / রকেট / ব্যাংক', note: 'Visa, Mastercard, নগদ, রকেট সহ সব মাধ্যম (SSLCommerz)' });
  }
  if (settings.pay_manual === '1') {
    for (const [id, [label, key]] of Object.entries(MANUAL)) {
      if (settings[key]) out.push({ id, label: `${label} Send Money`, note: `${settings[key]} (${settings.manual_type || 'Personal'}) নম্বরে টাকা পাঠিয়ে TrxID দিন`, number: settings[key], manual: true });
    }
  }
  if (!out.length) out.push({ id: 'cod', label: 'ক্যাশ অন ডেলিভারি', note: 'পণ্য হাতে পেয়ে টাকা দিন' });
  return out;
}

// ---------------------------------------------------------------- bKash (tokenized checkout)
function bkBase(s) { return s.bkash_sandbox === '1' ? 'https://tokenized.sandbox.bka.sh/v1.2.0-beta' : 'https://tokenized.pay.bka.sh/v1.2.0-beta'; }
let bkToken = null; // { token, exp, key }
async function bkashToken(s) {
  const key = s.bkash_app_key + s.bkash_username + s.bkash_sandbox;
  if (bkToken && bkToken.key === key && bkToken.exp > Date.now() + 60e3) return bkToken.token;
  const r = await fetchJson(`${bkBase(s)}/tokenized/checkout/token/grant`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', username: s.bkash_username, password: s.bkash_password },
    body: JSON.stringify({ app_key: s.bkash_app_key, app_secret: s.bkash_app_secret }),
  });
  if (r.ok && r.data && r.data.id_token) {
    bkToken = { token: r.data.id_token, exp: Date.now() + (int(r.data.expires_in) || 3600) * 1000, key };
    return bkToken.token;
  }
  throw new Error('বিকাশ টোকেন পাওয়া যায়নি: ' + ((r.data && (r.data.statusMessage || r.data.msg)) || r.text));
}
function bkHeaders(s, token) { return { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: token, 'X-App-Key': s.bkash_app_key }; }

async function bkashCreate(order, s, siteUrl) {
  const token = await bkashToken(s);
  const amount = Math.max(1, order.total - (order.paid_amount || 0));
  const r = await fetchJson(`${bkBase(s)}/tokenized/checkout/create`, {
    method: 'POST', headers: bkHeaders(s, token),
    body: JSON.stringify({
      mode: '0011', payerReference: order.phone, callbackURL: `${siteUrl}/pay/bkash/callback`,
      amount: amount.toFixed(2), currency: 'BDT', intent: 'sale', merchantInvoiceNumber: order.code,
    }),
  });
  if (r.ok && r.data && r.data.bkashURL && r.data.paymentID) {
    await db.q('INSERT INTO payments(order_id, method, amount, status, gateway_ref, raw) VALUES($1,$2,$3,$4,$5,$6)',
      [order.id, 'bkash', amount, 'initiated', r.data.paymentID, JSON.stringify(r.data)]);
    return { ok: true, url: r.data.bkashURL };
  }
  const msg = (r.data && (r.data.statusMessage || r.data.errorMessage)) || r.text;
  await db.logIntegration('bkash', 'create', false, msg, order.code);
  return { ok: false, message: msg };
}
async function bkashExecute(paymentID, s) {
  const token = await bkashToken(s);
  let r = await fetchJson(`${bkBase(s)}/tokenized/checkout/execute`, { method: 'POST', headers: bkHeaders(s, token), body: JSON.stringify({ paymentID }) });
  // If execute timed out or was already done, ask for the payment's state.
  if (!r.ok || !r.data || !r.data.transactionStatus) {
    r = await fetchJson(`${bkBase(s)}/tokenized/checkout/payment/status`, { method: 'POST', headers: bkHeaders(s, token), body: JSON.stringify({ paymentID }) });
  }
  const d = r.data || {};
  return { ok: d.transactionStatus === 'Completed', trxID: d.trxID || '', amount: Number(d.amount) || 0, raw: d, message: d.statusMessage || d.errorMessage || r.text };
}

// ---------------------------------------------------------------- SSLCommerz
function sslBase(s) { return s.ssl_sandbox === '1' ? 'https://sandbox.sslcommerz.com' : 'https://securepay.sslcommerz.com'; }
async function sslCreate(order, s, siteUrl) {
  const amount = Math.max(10, order.total - (order.paid_amount || 0));
  const tranId = `${order.code}-${Date.now().toString(36).toUpperCase()}`;
  const form = new URLSearchParams({
    store_id: s.ssl_store_id, store_passwd: s.ssl_store_password, total_amount: amount.toFixed(2), currency: 'BDT', tran_id: tranId,
    success_url: `${siteUrl}/pay/ssl/success`, fail_url: `${siteUrl}/pay/ssl/fail`, cancel_url: `${siteUrl}/pay/ssl/cancel`, ipn_url: `${siteUrl}/pay/ssl/ipn`,
    cus_name: order.customer_name, cus_email: order.email || 'customer@example.com', cus_add1: order.address.slice(0, 100),
    cus_city: order.district || 'Dhaka', cus_postcode: '1000', cus_country: 'Bangladesh', cus_phone: order.phone,
    shipping_method: 'NO', num_of_item: String((order.items || []).length || 1),
    product_name: (order.items || []).map((i) => i.name).join(', ').slice(0, 250) || 'Order ' + order.code,
    product_category: 'General', product_profile: 'general', value_a: order.code,
  });
  const r = await fetchJson(`${sslBase(s)}/gwprocess/v4/api.php`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form.toString() });
  if (r.data && r.data.status === 'SUCCESS' && r.data.GatewayPageURL) {
    await db.q('INSERT INTO payments(order_id, method, amount, status, gateway_ref, raw) VALUES($1,$2,$3,$4,$5,$6)',
      [order.id, 'ssl', amount, 'initiated', tranId, JSON.stringify({ sessionkey: r.data.sessionkey })]);
    return { ok: true, url: r.data.GatewayPageURL };
  }
  const msg = (r.data && r.data.failedreason) || r.text;
  await db.logIntegration('sslcommerz', 'create', false, msg, order.code);
  return { ok: false, message: msg };
}
async function sslValidate(valId, s) {
  const url = `${sslBase(s)}/validator/api/validationserverAPI.php?val_id=${encodeURIComponent(valId)}&store_id=${encodeURIComponent(s.ssl_store_id)}&store_passwd=${encodeURIComponent(s.ssl_store_password)}&format=json`;
  const r = await fetchJson(url);
  const d = r.data || {};
  return { ok: d.status === 'VALID' || d.status === 'VALIDATED', tranId: d.tran_id, amount: Number(d.amount) || 0, trxID: d.bank_tran_id || d.val_id || '', cardType: d.card_type || '', raw: d };
}

// Record a successful gateway payment on the order (and in the books).
async function recordSuccess(payment, { trxID, amount, raw, label }) {
  if (payment.status === 'paid') return;
  const settings = await db.getSettings();
  await db.tx(async (t) => {
    const cur = (await t.query('SELECT status FROM payments WHERE id=$1 FOR UPDATE', [payment.id])).rows[0];
    if (!cur || cur.status === 'paid') return;
    await t.query(`UPDATE payments SET status='paid', trx_id=$1, raw=$2, updated_at=now() WHERE id=$3`, [trxID || '', JSON.stringify(raw || {}), payment.id]);
    const o = (await t.query('SELECT id, total, paid_amount, code FROM orders WHERE id=$1 FOR UPDATE', [payment.order_id])).rows[0];
    const paid = Math.round(((Number(o.paid_amount) || 0) + Number(amount || payment.amount)) * 100) / 100;
    await t.query(`UPDATE orders SET paid_amount=$1, payment_status=CASE WHEN $1 >= total THEN 'paid' ELSE 'partial' END,
                   transaction_id=$2, payment=$3, updated_at=now() WHERE id=$4`, [paid, trxID || '', payment.method, o.id]);
    const acc = int(settings[payment.method === 'bkash' ? 'bkash_account_id' : 'ssl_account_id']);
    await t.query(`INSERT INTO transactions(tx_date, type, category, amount, account_id, order_id, note)
                   VALUES((now() AT TIME ZONE 'Asia/Dhaka')::date, 'income', 'অর্ডার পেমেন্ট', $1, $2, $3, $4)`,
    [Math.round(Number(amount || payment.amount) * 100) / 100, acc || null, o.id, `${label} · ${o.code} · ${trxID || ''}`]);
  });
  await db.logIntegration(payment.method === 'bkash' ? 'bkash' : 'sslcommerz', 'paid', true, `${trxID} ৳${amount}`, String(payment.order_id));
}

async function bkashTest(s) {
  try { await bkashToken({ ...s }); bkToken = null; return { ok: true, message: 'বিকাশের সাথে সংযোগ ঠিক আছে।' }; } catch (e) { return { ok: false, message: e.message }; }
}

module.exports = { methods, MANUAL, bkashCreate, bkashExecute, sslCreate, sslValidate, recordSuccess, bkashTest };
