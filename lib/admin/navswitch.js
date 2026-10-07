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
// Links in the store's footer (bottom of every page). [setting, label, column]
const FOOTER = {
  products: { key: 'foot_products', label: 'সব পণ্য', where: 'ফুটারের "কেনাকাটা" কলামে' },
  offer: { key: 'foot_offer', label: 'অফার', where: 'ফুটারের "কেনাকাটা" কলামে' },
  track: { key: 'foot_track', label: 'অর্ডার ট্র্যাক করুন', where: 'ফুটারের "কেনাকাটা" কলামে' },
  blog: { key: 'foot_blog', label: 'ব্লগ', where: 'ফুটারের "কেনাকাটা" কলামে' },
  contact: { key: 'foot_contact', label: 'যোগাযোগ (ফোন, WhatsApp, ইমেইল, ঠিকানা)', where: 'ফুটারের ডান পাশের "যোগাযোগ" কলাম' },
};

function menuRows(s) { return db.jsonSetting(s, 'header_menu', []); }
function isOn(row) { return row.on !== false; }

// Small panel with switches for the given menu links (by url) and fixed buttons ('live', 'cart').
// Every switch saves the moment it is clicked.
function box(ctx, { urls = [], fixed = [], footer = [], back, note } = {}) {
  if (!ctx.can('design')) return '';
  const s = ctx.settings;
  const rows = menuRows(s).filter((r) => urls.includes(r.url));
  const top = [
    ...rows.map((r) => ({ id: 'url:' + r.url, on: isOn(r), title: `"${r.label}" বাটন`, desc: `জায়গা: উপরের মেনু, সার্চ বারের পাশে · লিংক: ${r.url}` })),
    ...fixed.map((k) => ({ id: k, on: s[FIXED[k].key] !== '0', title: `"${FIXED[k].label}" বাটন`, desc: `জায়গা: উপরের মেনু · ${FIXED[k].desc}` })),
  ];
  const bottom = footer.map((k) => ({ id: 'foot:' + k, on: s[FOOTER[k].key] !== '0', title: `"${FOOTER[k].label}" লিংক`, desc: `জায়গা: পেজের একদম নিচে, ${FOOTER[k].where}` }));
  const items = [...top, ...bottom];
  if (!items.length) return '';
  const group = (title, list) => (list.length ? html`<p class="nav-sw-group">${title}</p>
    <div class="switch-list" data-autosubmit>${list.map((it) => ui.switchRow('on_' + it.id, it.on, it.title, it.desc))}</div>` : '');
  return html`<section class="panel nav-switch-box">
  <h2>🧭 দোকানে এর বাটন ও লিংক — চালু / বন্ধ</h2>
  <p class="muted small">${note || ''} সুইচ চাপলেই সাথে সাথে সেভ হবে। বন্ধ করলে শুধু লিংক লুকায়, পেজ মুছে যায় না। সব একসাথে দেখতে: <a href="/admin/design/menus">হেডার ও ফুটার মেনু</a></p>
  <form method="post" action="/admin/design/menus/toggle">
    <input type="hidden" name="back" value="${back}">
    ${items.map((it) => html`<input type="hidden" name="keys[]" value="${it.id}">`)}
    ${group('⬆ উপরের মেনুতে (হেডার)', top)}
    ${group('⬇ নিচের ফুটারে', bottom)}
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
    } else if (k.startsWith('foot:') && FOOTER[k.slice(5)]) {
      const key = FOOTER[k.slice(5)].key;
      fixedKeys.push(key);
      if (on) fixedBody[key] = '1';
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
  box, FIXED, FOOTER, isOn,
  routes: [{ method: 'POST', path: '/admin/design/menus/toggle', perm: 'design', handler: toggle }],
};
