'use strict';
// "Stock is running low" message to the owner (phone notification, e-mail, WhatsApp — whichever is set up).
// Checked after a web order and after a stock change in the admin. Each product is reported at most once a day.
const db = require('../db');
const security = require('../security');

async function check(settings, productIds) {
  if (!settings || settings.notify_low_stock === '0') return;
  const ids = [...new Set((productIds || []).map(Number).filter((x) => x > 0))].slice(0, 200);
  if (!ids.length) return;
  const rows = await db.q(`SELECT id, name, sku, stock, low_stock FROM products
    WHERE id = ANY($1::int[]) AND active AND product_type='single' AND stock <= low_stock ORDER BY stock, id`, [ids]);
  const fresh = [];
  for (const r of rows) if (await security.hit(db, 'lowstock:' + r.id, 1, 86400)) fresh.push(r);
  if (!fresh.length) return;
  const notify = require('./notify');
  const lines = fresh.slice(0, 15).map((r) => `• ${String(r.name).slice(0, 70)}${r.sku ? ` (SKU ${r.sku})` : ''} — ${r.stock <= 0 ? 'স্টক শেষ!' : `বাকি ${r.stock}টি`}`);
  const more = fresh.length > 15 ? `\n…আরও ${fresh.length - 15}টি` : '';
  const text = `⚠️ স্টক কমে গেছে\n\n${lines.join('\n')}${more}\n\nনতুন মাল কিনে পারচেজ এন্ট্রি দিন: Admin → স্টক ও কেনাকাটা`;
  const jobs = [];
  if (notify.emailConfig(settings).ready) {
    jobs.push(notify.sendEmail(settings, `⚠️ স্টক কম: ${fresh.length}টি পণ্য`, text).then(() => db.logIntegration('notify-email', 'low stock', true, 'পাঠানো হয়েছে'))
      .catch((e) => db.logIntegration('notify-email', 'low stock', false, e.message)));
  }
  if (notify.waConfig(settings).ready) {
    jobs.push(notify.sendWhatsApp(settings, `*স্টক কম* ⚠️\n${lines.join('\n')}${more}`).then(() => db.logIntegration('notify-whatsapp', 'low stock', true, 'পাঠানো হয়েছে'))
      .catch((e) => db.logIntegration('notify-whatsapp', 'low stock', false, e.message)));
  }
  const push = require('./push');
  jobs.push(push.count().then((n) => (n ? push.sendAll({ title: `⚠️ স্টক কম — ${fresh.length}টি পণ্য`, body: lines.slice(0, 4).join('\n'), url: '/admin/inventory?low=1', tag: 'lowstock' }) : null)).catch(() => null));
  await notify.later(Promise.all(jobs));
}

module.exports = { check };
