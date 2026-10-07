'use strict';
// On/off switches for the buttons in the store's top menu (সব পণ্য, অফার, ব্লগ, অর্ডার ট্র্যাক, লাইভ স্কোর, কার্ট).
// The same switch shows up on the admin page each button belongs to (blog switch on the blog page, etc.)
// and all of them together on "হেডার ও ফুটার মেনু".
const { html, list, str } = require('../util');
const ui = require('./ui');
const db = require('../db');

// Buttons that are not part of the editable link list.
const FIXED = {
  live: { key: 'nav_live', label: 'লাইভ স্কোর', desc: 'ক্রিকেট বা ফুটবল স্কোর চালু থাকলে তবেই এই বাটন দেখা যায়' },
  cart: { key: 'nav_cart', label: 'কার্ট', desc: 'বন্ধ করলে উপরের কার্ট আইকন লুকাবে। "কার্টে যোগ" আর "এখনই কিনুন" বাটন আগের মতোই কাজ করবে' },
};

function menuRows(s) { return db.jsonSetting(s, 'header_menu', []); }
function isOn(row) { return row.on !== false; }

// Small panel with switches for the given menu links (by url) and fixed buttons ('live', 'cart').
// Every switch saves the moment it is clicked.
function box(ctx, { urls = [], fixed = [], back, note } = {}) {
  if (!ctx.can('design')) return '';
  const s = ctx.settings;
  const rows = menuRows(s).filter((r) => urls.includes(r.url));
  const items = [
    ...rows.map((r) => ({ id: 'url:' + r.url, on: isOn(r), label: r.label, desc: `লিংক: ${r.url}` })),
    ...fixed.map((k) => ({ id: k, on: s[FIXED[k].key] !== '0', label: FIXED[k].label, desc: FIXED[k].desc })),
  ];
  if (!items.length) return '';
  return html`<section class="panel nav-switch-box">
  <h2>🧭 দোকানের উপরের মেনুতে বাটন</h2>
  <p class="muted small">${note || 'সুইচ চাপলেই সাথে সাথে সেভ হবে।'} সব বাটন একসাথে দেখতে: <a href="/admin/design/menus">হেডার ও ফুটার মেনু</a></p>
  <form method="post" action="/admin/design/menus/toggle">
    <input type="hidden" name="back" value="${back}">
    ${items.map((it) => html`<input type="hidden" name="keys[]" value="${it.id}">`)}
    <div class="switch-list" data-autosubmit>${items.map((it) => ui.switchRow('on_' + it.id, it.on, `"${it.label}" বাটন`, it.desc))}</div>
    <noscript><button class="btn btn-sm">সেভ করুন</button></noscript>
  </form>
</section>`;
}

async function toggle(ctx) {
  const b = await ctx.body();
  const keys = list(b.keys);
  const rows = menuRows(ctx.settings);
  let rowsChanged = false;
  const fixedBody = {};
  const fixedKeys = [];
  for (const k of keys) {
    const on = !!b['on_' + k];
    if (k.startsWith('url:')) {
      const url = k.slice(4);
      for (const r of rows) if (r.url === url) { r.on = on; rowsChanged = true; }
    } else if (FIXED[k]) {
      fixedKeys.push(FIXED[k].key);
      if (on) fixedBody[FIXED[k].key] = '1';
    }
  }
  if (rowsChanged) await db.setSetting('header_menu', JSON.stringify(rows));
  const { saveKeys } = require('./marketing'); // loaded here to avoid a require loop
  if (fixedKeys.length) await saveKeys(ctx, fixedKeys, fixedBody, { checkboxes: fixedKeys });
  else await ctx.reloadSettings();
  await ctx.log('settings', 'design', null, 'মেনু বাটন চালু/বন্ধ');
  const back = str(b.back, 200);
  return ctx.back(back.startsWith('/admin') ? back : '/admin/design/menus', 'saved');
}

module.exports = {
  box, FIXED, isOn,
  routes: [{ method: 'POST', path: '/admin/design/menus/toggle', perm: 'design', handler: toggle }],
};
