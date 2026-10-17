// 🧪 Testing history: while the shop is being tested, the customer-related pages fill up with test codes, logins,
// searches… Each page below gets a switch at the top ("🗑️ ইতিহাস মোছার বাটন"). While it is on, a
// "মুছুন" button shows at the bottom of that page and wipes only that page's history (never orders, customers,
// products or money). Off by default; once the shop goes live the owner turns them off and history stays.

// page (the admin menu key) → what its history is, and how to wipe it
import { toHtml, Val, attrValue, insertAfterTag } from '../react/html';
import { html, raw } from '../util';
import * as db from '../db';
import * as ui from './ui';
import * as delcode from '../services/delcode';
import type { AdminCtx, Loose } from '../types';
const PAGES: Record<string, Loose> = {
  'cust-accounts': { path: '/admin/customer-accounts', what: 'লগইনের কোড, কে কখন লগইন করেছেন আর সেভ করা ঠিকানা',
    sql: ['DELETE FROM customer_otps', 'DELETE FROM customer_email_otps', 'DELETE FROM customer_addresses',
      // test e-mail accounts with no order go entirely
      `DELETE FROM customers c WHERE c.phone IS NULL AND c.email_verified AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.account_id=c.id OR o.customer_id=c.id)`,
      'UPDATE customers SET last_login = NULL WHERE last_login IS NOT NULL'] },
  'checkout-otp': { path: '/admin/checkout-otp', what: 'চেকআউট OTP-র সব কোড আর তার হিসাব', sql: ['DELETE FROM checkout_otps'] },
  drafts: { path: '/admin/orders/incomplete', what: 'সব অসম্পূর্ণ অর্ডার', sql: ['DELETE FROM checkout_drafts'] },
  'search-report': { path: '/admin/reports/search', what: 'কাস্টমারের সব সার্চের হিসাব', sql: ['DELETE FROM search_log'] },
  restock: { path: '/admin/marketing/restock', what: '"স্টকে এলে জানাও" আর "দাম কমলে জানাও"-এর সব অনুরোধ', sql: ['DELETE FROM stock_alerts', 'DELETE FROM price_alerts'] },
  fraud: { path: '/admin/fraud', what: 'ফ্রড চেকের পুরনো ফলাফল', sql: ['DELETE FROM fraud_checks'] },
};
const BASE = '/admin/test-clear';
const key = (k?: Loose) => `tc_${k.replace(/-/g, '_')}`;

// called from ctx.page: adds the switch under the page title and the button at the end
function decorate(ctx: AdminCtx, active?: Loose, body?: Loose) {
  const p = PAGES[active];
  if (!p || !ctx.can('settings')) return body;
  const on = ctx.settings[key(active)] === '1';
  const top = toHtml(<form method="post" action={attrValue(BASE)} className="panel form sms-clear-switch"><input type="hidden" name="page" defaultValue={attrValue(active)} /><input type="hidden" name="action" defaultValue="switch" />{' '}<Val v={ui.switchRow('on', on, '🗑️ ইতিহাস মোছার বাটন', 'চালু করলে পেজের নিচে মোছার বাটন আসবে। দোকান আসলভাবে চালু করার পর বন্ধ করে দিন, তখন ইতিহাস থেকে যাবে।')} />{' '}<button className="btn btn-sm">সেভ করুন</button></form>);
  const bottom = on ? toHtml(<section className="panel"><form method="post" action={attrValue(BASE)} data-confirm={`এই পেজের ${attrValue(p.what)} মুছে যাবে। আর ফেরত আনা যাবে না। মুছবেন?`} data-delcode="test_clear" data-delcode-to={attrValue(delcode.masked())} data-delcode-what={attrValue(p.what)}><input type="hidden" name="page" defaultValue={attrValue(active)} /><input type="hidden" name="action" defaultValue="clear" />{' '}<button className="btn btn-sm btn-danger">🗑️ এই পেজের ইতিহাস মুছুন</button>{' '}<span className="small muted">যা মুছবে:{' '}<Val v={p.what} />। অর্ডার, কাস্টমার, পণ্য বা টাকার হিসাব মুছবে না। মুছতে{' '}<Val v={delcode.masked()} />{' '}ঠিকানায় যাওয়া কোড লাগবে।</span></form></section>) : '';
  // the switch goes right under the page's heading (or on top when there is none), the delete button at the end
  if (typeof body === 'string') body = raw(body); // a page given as text is HTML, as it always was here
  const r = insertAfterTag(body, 'h1', <Val v={top} />);
  return toHtml(<>{r.found ? <Val v={r.node} /> : <><Val v={top} /><Val v={body} /></>}<Val v={bottom} /></>);
}

async function post(ctx: AdminCtx) {
  const b = await ctx.body();
  const page = String(b.page || '');
  const p = Object.hasOwn(PAGES, page) ? PAGES[page] : null;
  if (!p) return ctx.back('/admin', 'noperm');
  const to = p.path;
  if (b.action === 'switch') {
    await db.setMany({ [key(page)]: b.on ? '1' : '0' });
    await ctx.log('settings', 'settings', null, `ইতিহাস মোছার বাটন (${page}): ${b.on ? 'চালু' : 'বন্ধ'}`);
    return ctx.back(to, 'saved');
  }
  if (b.action === 'clear') {
    if (ctx.settings[key(page)] !== '1') return ctx.back(to, 'noperm');
    // 🔐 history goes for good: the code e-mailed to the shop's Gmail is needed
    const bad = await delcode.check(ctx, 'test_clear', b.del_code);
    if (bad) return ctx.fail(to, '🔐 ' + bad);
    for (const q of p.sql) await db.q(q);
    await ctx.log('settings', 'settings', null, `ইতিহাস মোছা হয়েছে: ${p.what}`);
    return ctx.back(to, 'saved');
  }
  return ctx.back(to);
}

export const routes = [{ method: 'POST', path: BASE, perm: 'settings', handler: post }];
export { PAGES, decorate };
