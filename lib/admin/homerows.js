'use strict';
// Admin → স্টোর ডিজাইন → হোমপেজের সারি: the owner's own rows on the home page — add, edit, switch on/off,
// move up/down among all rows (built-in ones too) and delete (to the recycle bin).
const { html, raw, int, bn, list: asList } = require('../util');
const db = require('../db');
const ui = require('./ui');
const H = require('../models/homerows');
const catalog = require('../models/catalog');

const BASE = '/admin/design/rows';

// Built-in rows (same names as on "লোগো, রং ও হোমপেজ").
function builtIns() { return require('./design').SECTIONS; }

async function allLabels() {
  const own = await H.list();
  const labels = { ...builtIns() };
  for (const r of own) labels[H.keyOf(r.id)] = `✨ ${r.title}`;
  return { labels, own };
}

async function page(ctx) {
  const s = ctx.settings;
  const { labels, own } = await allLabels();
  const enabled = db.jsonSetting(s, 'home_sections', []).filter((k) => labels[k]);
  const ordered = [...enabled, ...Object.keys(labels).filter((k) => !enabled.includes(k))];
  const counts = new Map(await Promise.all(own.map(async (r) => [r.id, (await H.productsFor(r, {}).catch(() => [])).length])));
  const body = html`<h1>🏠 হোমপেজের সারি</h1>${ui.flash(ctx.flash)}
<p class="muted">হোমপেজে কোন কোন সারি দেখাবে, কোনটা আগে-পরে — সব এখানে। আগে থেকে থাকা সারির পাশাপাশি <b>নিজের নতুন সারি</b> বানাতে পারবেন (যেমন "শীতের অফার", "৳৫০ এর নিচে রিমোট", "নতুন সোল্ডারিং টুলস")।</p>
<p><a class="btn" href="${BASE}/new">➕ নতুন সারি বানান</a></p>

<section class="panel">
  <h2>সব সারি — ক্রম ও চালু/বন্ধ</h2>
  <p class="small muted">▲▼ দিয়ে ক্রম বদলান, টিক দিয়ে চালু/বন্ধ করুন, তারপর "ক্রম সেভ করুন" চাপুন। ✨ চিহ্ন = আপনার নিজের সারি।</p>
  <form method="post" action="${BASE}/order" class="form">
    <ul class="sortable" data-sortable>
      ${ordered.map((k) => {
    const id = H.idOf(k);
    return html`<li><input type="hidden" name="section_order[]" value="${k}">
        ${ui.check('section_on[]', enabled.includes(k), labels[k], k)}
        ${id ? html`<span class="small muted">(${bn(counts.get(id) || 0)}টি পণ্য)</span> <a class="small" href="${BASE}/${id}">✏️ এডিট</a>` : ''}
        <span class="sort-btns"><button type="button" data-up aria-label="উপরে">▲</button><button type="button" data-down aria-label="নিচে">▼</button></span></li>`;
  })}
    </ul>
    <div class="form-actions"><button class="btn">ক্রম সেভ করুন</button> <a href="/" target="_blank">দোকান দেখুন ↗</a></div>
  </form>
</section>

<section class="panel">
  <h2>✨ আপনার নিজের সারি (${bn(own.length)}টি)</h2>
  ${own.length ? html`<table class="table"><thead><tr><th>নাম</th><th>কোন পণ্য</th><th>পণ্য</th><th>অবস্থা</th><th></th><th></th></tr></thead><tbody>
    ${own.map((r) => html`<tr class="${enabled.includes(H.keyOf(r.id)) ? '' : 'row-off'}">
      <td><b>${r.title}</b>${r.sub ? html`<br><span class="small muted">${r.sub}</span>` : ''}</td>
      <td class="small">${H.SOURCES[r.source]}${r.ref && r.source !== 'brand' ? html`: <b>${r.ref}</b>` : ''}</td>
      <td>${bn(counts.get(r.id) || 0)}টি</td>
      <td>${enabled.includes(H.keyOf(r.id)) ? html`<span class="pill pill-green">চালু</span>` : html`<span class="pill">বন্ধ</span>`}</td>
      <td><a class="btn btn-sm btn-ghost" href="${BASE}/${r.id}">✏️ এডিট</a></td>
      <td><form method="post" action="${BASE}/${r.id}/delete" data-confirm="&quot;${r.title}&quot; সারিটা মুছবেন? (রিসাইকেল বিনে যাবে)"><button class="btn btn-sm btn-ghost danger-text">🗑️ মুছুন</button></form></td>
    </tr>`)}</tbody></table>` : ui.empty('এখনো নিজের কোনো সারি নেই। উপরের "নতুন সারি বানান" চাপুন।')}
</section>`;
  return ctx.page('হোমপেজের সারি', body, 'home-rows');
}

async function saveOrder(ctx) {
  const b = await ctx.body();
  const { labels } = await allLabels();
  const order = asList(b.section_order);
  const on = asList(b.section_on);
  await db.setSetting('home_sections', JSON.stringify(order.filter((k) => labels[k] && on.includes(k))));
  await ctx.log('settings', 'design', null, 'হোমপেজের সারির ক্রম');
  return ctx.back(BASE, 'saved');
}

async function form(ctx, m) {
  const id = m ? int(m[1]) : 0;
  const r = id ? await H.get(id) : null;
  if (id && !r) return ctx.fail(BASE, 'সারিটা পাওয়া যায়নি।');
  if (ctx.method === 'POST') {
    const b = await ctx.body();
    const { row, missing } = await H.save(id, b);
    if (!id) {
      // a new row goes on the home page straight away, at the end
      const list = db.jsonSetting(ctx.settings, 'home_sections', []);
      if (!list.includes(H.keyOf(row.id))) await db.setSetting('home_sections', JSON.stringify([...list, H.keyOf(row.id)]));
    }
    await ctx.log(id ? 'home_row_edit' : 'home_row_add', 'home_row', row.id, row.title);
    if (missing.length) return ctx.fail(`${BASE}/${row.id}`, `সেভ হয়েছে, কিন্তু এই SKU গুলো পাওয়া যায়নি: ${missing.join(', ')}`);
    return ctx.back(`${BASE}/${row.id}`, 'saved');
  }
  const v = r || { title: '', sub: '', source: 'category', ref: '', sort: 'popular', lim: 16, badge: '', style: 'rail', in_stock_only: false, product_ids: [] };
  const [cats, brands, skus, preview] = await Promise.all([
    catalog.listCategories({ includeInactive: false }),
    db.q('SELECT id, name FROM brands ORDER BY name').catch(() => []),
    H.skusOf(v.product_ids),
    r ? H.productsFor(r, {}).catch(() => []) : [],
  ]);
  const show = (src) => raw(`data-show-when="source=${src}"`);
  const body = html`<h1>${r ? '✏️ সারি এডিট' : '➕ নতুন সারি'}</h1>${ui.flash(ctx.flash)}
<p><a href="${BASE}">← সব সারি</a></p>
<form method="post" class="form panel" data-row-form>
  ${ui.field('সারির নাম (হোমপেজে বড় করে দেখাবে)', ui.input('title', v.title, { required: true, maxlength: 80, placeholder: 'যেমন: 🔥 শীতের অফার' }))}
  ${ui.field('নামের নিচে ছোট লেখা (ঐচ্ছিক)', ui.input('sub', v.sub, { maxlength: 160, placeholder: 'যেমন: সীমিত সময়ের জন্য' }))}
  ${ui.field('কোন পণ্য দেখাবে', ui.select('source', Object.entries(H.SOURCES), v.source))}
  <div ${show('category')}>${ui.field('ক্যাটাগরি', ui.select('ref_category', [['', '— বাছুন —'], ...cats.map((c) => [c.slug, `${c.icon || ''} ${c.name}`])], v.source === 'category' ? v.ref : ''))}</div>
  <div ${show('brand')}>${ui.field('ব্র্যান্ড', ui.select('ref_brand', [['', '— বাছুন —'], ...brands.map((x) => [String(x.id), x.name])], v.source === 'brand' ? v.ref : ''))}</div>
  <div ${show('search')}>${ui.field('যে শব্দ নামে/বর্ণনায় আছে', ui.input('ref_search', v.source === 'search' ? v.ref : '', { maxlength: 60, placeholder: 'যেমন: রিমোট' }))}</div>
  <div ${show('products')}>${ui.field('পণ্যের SKU (কমা দিয়ে, যে ক্রমে লিখবেন সেই ক্রমে দেখাবে)', ui.textarea('skus', skus, { rows: 2, placeholder: 'যেমন: 12, 45, 7, 103' }))}</div>
  <div class="field-row" ${show('price')}>
    ${ui.field('সর্বনিম্ন দাম (৳)', ui.input('min_price', v.min_price ?? '', { type: 'number', step: '0.01', min: 0 }))}
    ${ui.field('সর্বোচ্চ দাম (৳)', ui.input('max_price', v.max_price ?? '', { type: 'number', step: '0.01', min: 0 }))}
  </div>
  <div class="field-row">
    ${ui.field('ক্রম', ui.select('sort', Object.entries(H.SORTS), v.sort))}
    ${ui.field('কয়টা পণ্য', ui.input('lim', v.lim, { type: 'number', min: 4, max: 32, class: 'w-num' }))}
    ${ui.field('দেখানোর ধরন', ui.select('style', Object.entries(H.STYLES), v.style))}
  </div>
  ${ui.field('কার্ডের কোণে ছোট লেবেল (ঐচ্ছিক)', ui.input('badge', v.badge, { maxlength: 20, placeholder: 'যেমন: হট' }))}
  ${ui.check('in_stock_only', v.in_stock_only, 'শুধু স্টকে থাকা পণ্য দেখাও')}
  <input type="hidden" name="ref" value="${v.ref}" data-ref>
  <div class="form-actions sticky-actions"><button class="btn btn-lg">💾 সেভ করুন</button> ${r ? html`<a href="/" target="_blank">দোকানে দেখুন ↗</a>` : ''}</div>
</form>
${r ? html`<section class="panel"><h2>👀 এই সারিতে এখন যা দেখাচ্ছে (${bn(preview.length)}টি)</h2>
  ${preview.length ? html`<div class="row-preview">${preview.map((p) => html`<a class="rp" href="/admin/products/${p.id}"><img src="${p.image_id ? `/media/${p.image_id}/t` : ''}" alt="" loading="lazy"><span>${p.name}</span><b>${ui.money(p.price)}</b></a>`)}</div>`
    : ui.empty('এই নিয়মে কোনো পণ্য পাওয়া যাচ্ছে না — ক্যাটাগরি/শব্দ/দাম বদলে দেখুন।')}
</section>` : ''}
<script>
(function () {
  var f = document.querySelector('[data-row-form]'); if (!f) return;
  var src = f.querySelector('[name=source]'), ref = f.querySelector('[data-ref]');
  function sync() {
    f.querySelectorAll('[data-show-when]').forEach(function (el) { el.hidden = el.getAttribute('data-show-when') !== 'source=' + src.value; });
  }
  src.addEventListener('change', sync); sync();
  f.addEventListener('submit', function () {
    var pick = { category: 'ref_category', brand: 'ref_brand', search: 'ref_search' }[src.value];
    ref.value = pick ? (f.querySelector('[name=' + pick + ']').value || '') : '';
  });
})();
</script>`;
  return ctx.page(r ? 'সারি এডিট' : 'নতুন সারি', body, 'home-rows');
}

async function remove(ctx, m) {
  const id = int(m[1]);
  await ctx.trash('home_row', id);
  const list = db.jsonSetting(ctx.settings, 'home_sections', []).filter((k) => k !== H.keyOf(id));
  await db.setSetting('home_sections', JSON.stringify(list));
  await ctx.log('home_row_delete', 'home_row', id, '');
  return ctx.back(BASE, 'deleted');
}

module.exports = {
  routes: [
    { method: 'GET', path: BASE, perm: 'design', handler: page },
    { method: 'POST', path: `${BASE}/order`, perm: 'design', handler: saveOrder },
    { method: '*', path: `${BASE}/new`, perm: 'design', handler: (ctx) => form(ctx, null) },
    { method: '*', path: /^\/admin\/design\/rows\/(\d+)$/, perm: 'design', handler: form },
    { method: 'POST', path: /^\/admin\/design\/rows\/(\d+)\/delete$/, perm: 'design', handler: remove },
  ],
  allLabels,
};
