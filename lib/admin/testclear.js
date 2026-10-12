'use strict';
// 🧪 Testing history: while the shop is being tested, the customer-related pages fill up with test codes, logins,
// searches… Each page below gets a switch at the top ("🗑️ টেস্টের ইতিহাস মোছার বাটন"). While it is on, a
// "মুছুন" button shows at the bottom of that page and wipes only that page's history (never orders, customers,
// products or money). Off by default; once the shop goes live the owner turns them off and history stays.
const { html, raw } = require('../util');
const db = require('../db');
const ui = require('./ui');

// page (the admin menu key) → what its history is, and how to wipe it
const PAGES = {
  'cust-accounts': { path: '/admin/customer-accounts', what: 'লগইনের কোড, কে কখন লগইন করেছেন আর সেভ করা ঠিকানা',
    sql: ['DELETE FROM customer_otps', 'UPDATE customers SET last_login = NULL WHERE last_login IS NOT NULL', 'DELETE FROM customer_addresses'] },
  'checkout-otp': { path: '/admin/checkout-otp', what: 'চেকআউট OTP-র সব কোড আর তার হিসাব', sql: ['DELETE FROM checkout_otps'] },
  drafts: { path: '/admin/orders/incomplete', what: 'সব অসম্পূর্ণ অর্ডার', sql: ['DELETE FROM checkout_drafts'] },
  'search-report': { path: '/admin/reports/search', what: 'কাস্টমারের সব সার্চের হিসাব', sql: ['DELETE FROM search_log'] },
  restock: { path: '/admin/marketing/restock', what: '"স্টকে এলে জানাও" আর "দাম কমলে জানাও"-এর সব অনুরোধ', sql: ['DELETE FROM stock_alerts', 'DELETE FROM price_alerts'] },
  fraud: { path: '/admin/fraud', what: 'ফ্রড চেকের পুরনো ফলাফল', sql: ['DELETE FROM fraud_checks'] },
};
const BASE = '/admin/test-clear';
const key = (k) => `tc_${k.replace(/-/g, '_')}`;

// called from ctx.page: adds the switch under the page title and the button at the end
function decorate(ctx, active, body) {
  const p = PAGES[active];
  if (!p || !ctx.can('settings')) return body;
  const on = ctx.settings[key(active)] === '1';
  const top = html`<form method="post" action="${BASE}" class="panel form sms-clear-switch">
  <input type="hidden" name="page" value="${active}"><input type="hidden" name="action" value="switch">
  ${ui.switchRow('on', on, '🗑️ টেস্টের ইতিহাস মোছার বাটন', 'টেস্ট করার সময় চালু রাখুন — পেজের নিচে মোছার বাটন আসবে। দোকান আসলভাবে চালু করার পর বন্ধ করে দিন, তখন ইতিহাস থেকে যাবে।')}
  <button class="btn btn-sm">সেভ করুন</button>
</form>`;
  const bottom = on ? html`<section class="panel"><form method="post" action="${BASE}" data-confirm="এই পেজের ${p.what} মুছে যাবে। আর ফেরত আনা যাবে না। মুছবেন?">
  <input type="hidden" name="page" value="${active}"><input type="hidden" name="action" value="clear">
  <button class="btn btn-sm btn-danger">🗑️ এই পেজের ইতিহাস মুছুন</button>
  <span class="small muted">যা মুছবে: ${p.what}। অর্ডার, কাস্টমার, পণ্য বা টাকার হিসাব মুছবে না।</span></form></section>` : '';
  const s = String(body);
  const i = s.indexOf('</h1>');
  return raw(i < 0 ? String(top) + s + String(bottom) : s.slice(0, i + 5) + String(top) + s.slice(i + 5) + String(bottom));
}

async function post(ctx) {
  const b = await ctx.body();
  const page = String(b.page || '');
  const p = PAGES[page];
  if (!p) return ctx.back('/admin', 'noperm');
  const to = p.path;
  if (b.action === 'switch') {
    await db.setMany({ [key(page)]: b.on ? '1' : '0' });
    await ctx.log('settings', 'settings', null, `টেস্টের ইতিহাস মোছার বাটন (${page}): ${b.on ? 'চালু' : 'বন্ধ'}`);
    return ctx.back(to, 'saved');
  }
  if (b.action === 'clear') {
    if (ctx.settings[key(page)] !== '1') return ctx.back(to, 'noperm');
    for (const q of p.sql) await db.q(q);
    await ctx.log('settings', 'settings', null, `টেস্টের ইতিহাস মোছা হয়েছে: ${p.what}`);
    return ctx.back(to, 'saved');
  }
  return ctx.back(to);
}

module.exports = { PAGES, decorate, routes: [{ method: 'POST', path: BASE, perm: 'settings', handler: post }] };
