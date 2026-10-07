'use strict';
const { html, money, bn, fmtDate } = require('../util');
const { STATUSES } = require('../db');

function flash(msg) {
  if (!msg) return '';
  return html`<p class="flash ${msg.type === 'error' ? 'flash-error' : ''}" role="status">${msg.text}</p>`;
}

function statusPill(s) {
  return html`<span class="pill pill-${s}">${STATUSES[s] || s}</span>`;
}

function loginPage({ settings, setup, error }) {
  return html`<div class="auth-card panel">
  <p class="logo">${settings.store_name}<small> Admin</small></p>
  ${setup ? html`
  <h1>Admin পাসওয়ার্ড তৈরি করুন</h1>
  <p class="muted">এটাই প্রথমবার। একটা পাসওয়ার্ড ঠিক করুন, এরপর থেকে এটা দিয়েই Admin Panel-এ ঢুকবেন। কমপক্ষে ৮ অক্ষর দিন আর কোথাও লিখে রাখুন।</p>
  <form method="post" action="/admin/setup" class="form">
    <div class="field"><label for="pw">নতুন পাসওয়ার্ড</label><input id="pw" name="password" type="password" minlength="8" required autocomplete="new-password"></div>
    <div class="field"><label for="pw2">আবার লিখুন</label><input id="pw2" name="password2" type="password" minlength="8" required autocomplete="new-password"></div>
    ${error ? html`<p class="form-error">${error}</p>` : ''}
    <button class="btn btn-block">পাসওয়ার্ড সেভ করুন</button>
  </form>` : html`
  <h1>Admin লগইন</h1>
  <form method="post" action="/admin/login" class="form">
    <div class="field"><label for="pw">পাসওয়ার্ড</label><input id="pw" name="password" type="password" required autocomplete="current-password" autofocus></div>
    ${error ? html`<p class="form-error">${error}</p>` : ''}
    <button class="btn btn-block">লগইন</button>
  </form>`}
  <p class="center small"><a href="/">দোকানে ফিরে যান</a></p>
</div>`;
}

function dashboard({ stats, orders }) {
  return html`<h1>ড্যাশবোর্ড</h1>
<div class="stats">
  <a class="stat ${stats.pending ? 'stat-alert' : ''}" href="/admin/orders?status=pending"><b>${bn(stats.pending)}</b><span>নতুন অর্ডার, কনফার্ম করা বাকি</span></a>
  <div class="stat"><b>${bn(stats.today)}</b><span>গত ২৪ ঘণ্টার অর্ডার</span></div>
  <div class="stat"><b>${money(stats.revenue30)}</b><span>গত ৩০ দিনের বিক্রি</span></div>
  <a class="stat ${stats.low_stock ? 'stat-warn' : ''}" href="/admin/products?low=1"><b>${bn(stats.low_stock)}</b><span>পণ্যের স্টক ৩ বা তার কম</span></a>
</div>
<div class="section-head"><h2>সাম্প্রতিক অর্ডার</h2><a href="/admin/orders">সব অর্ডার</a></div>
${ordersTable(orders)}
<div class="quick">
  <a class="btn" href="/admin/products/new">+ নতুন পণ্য যোগ করুন</a>
  <a class="btn btn-ghost" href="/admin/settings">ডেলিভারি চার্জ ও যোগাযোগ বদলান</a>
</div>`;
}

function ordersTable(orders) {
  if (!orders.length) return html`<div class="empty panel"><p>এখনো কোনো অর্ডার আসেনি। দোকান থেকে একটা টেস্ট অর্ডার দিয়ে দেখতে পারেন।</p></div>`;
  return html`<div class="table-wrap panel"><table class="table">
  <thead><tr><th>অর্ডার</th><th>কাস্টমার</th><th>পণ্য</th><th class="num">মোট</th><th>অবস্থা</th><th>তারিখ</th></tr></thead>
  <tbody>${orders.map((o) => html`<tr>
    <td><a href="/admin/orders/${o.id}"><b>${o.code}</b></a></td>
    <td>${o.customer_name}<br><a class="muted small" href="tel:${o.phone}">${o.phone}</a></td>
    <td>${bn(o.item_count || 0)}টি</td>
    <td class="num">${money(o.total)}</td>
    <td>${statusPill(o.status)}</td>
    <td class="small muted">${fmtDate(o.created_at)}</td>
  </tr>`)}</tbody></table></div>`;
}

function ordersPage({ orders, status, q }) {
  return html`<h1>অর্ডার</h1>
<form class="toolbar" method="get" action="/admin/orders">
  <div class="chips">
    <a class="chip ${!status ? 'on' : ''}" href="/admin/orders">সব</a>
    ${Object.entries(STATUSES).map(([k, v]) => html`<a class="chip ${status === k ? 'on' : ''}" href="/admin/orders?status=${k}">${v}</a>`)}
  </div>
  <input type="search" name="q" value="${q || ''}" placeholder="অর্ডার নম্বর, নাম বা ফোন">
  ${status ? html`<input type="hidden" name="status" value="${status}">` : ''}
  <button class="btn btn-sm">খুঁজুন</button>
</form>
${ordersTable(orders)}`;
}

function orderDetail({ order, msg }) {
  const waNumber = order.phone.replace(/\D/g, '').replace(/^0/, '880');
  return html`<p class="crumbs"><a href="/admin/orders">← সব অর্ডার</a></p>
<h1>অর্ডার ${order.code} ${statusPill(order.status)}</h1>
${flash(msg)}
<div class="two-col">
  <div class="panel">
    <h2>পণ্যসমূহ</h2>
    <table class="lines"><tbody>
      ${order.items.map((it) => html`<tr><td>${it.name} <span class="muted">× ${bn(it.qty)} (${money(it.price)} করে)</span></td><td class="num">${money(it.price * it.qty)}</td></tr>`)}
    </tbody><tfoot>
      <tr><td>পণ্যের দাম</td><td class="num">${money(order.subtotal)}</td></tr>
      <tr><td>ডেলিভারি (${order.area === 'dhaka' ? 'ঢাকা' : 'ঢাকার বাইরে'})</td><td class="num">${money(order.delivery)}</td></tr>
      <tr class="total"><td>কাস্টমার দেবেন</td><td class="num">${money(order.total)}</td></tr>
    </tfoot></table>
  </div>
  <div class="panel">
    <h2>কাস্টমার</h2>
    <p><b>${order.customer_name}</b></p>
    <p><a href="tel:${order.phone}">📞 ${order.phone}</a> · <a href="https://wa.me/${waNumber}" rel="noopener" target="_blank">WhatsApp</a></p>
    <p>${order.address}</p>
    ${order.note ? html`<p class="note">📝 ${order.note}</p>` : ''}
    <p class="muted small">অর্ডারের সময়: ${fmtDate(order.created_at)}</p>
    <h2>অবস্থা বদলান</h2>
    <form method="post" action="/admin/orders/${order.id}/status" class="status-form">
      ${Object.entries(STATUSES).map(([k, v]) => html`<button name="status" value="${k}" class="btn btn-sm ${order.status === k ? 'is-current' : 'btn-ghost'}" ${order.status === k ? 'disabled' : ''}>${v}</button>`)}
    </form>
    <p class="muted small">বাতিল করলে পণ্যগুলো আবার স্টকে যোগ হবে।</p>
  </div>
</div>`;
}

function productsPage({ products, msg, low }) {
  return html`<div class="title-row"><h1>পণ্য <small>${bn(products.length)}টি</small></h1><a class="btn" href="/admin/products/new">+ নতুন পণ্য</a></div>
${flash(msg)}
${low ? html`<p class="muted">শুধু যেসব পণ্যের স্টক ৩ বা তার কম। <a href="/admin/products">সব পণ্য দেখুন</a></p>` : ''}
${products.length ? html`<div class="table-wrap panel"><table class="table">
<thead><tr><th></th><th>নাম</th><th>ক্যাটাগরি</th><th class="num">দাম</th><th class="num">স্টক</th><th>দোকানে</th></tr></thead>
<tbody>${products.map((p) => html`<tr class="${p.active ? '' : 'row-off'}">
  <td class="thumb">${p.has_image ? html`<img src="/img/p/${p.id}?v=${p.version}" alt="">` : html`<span>${p.emoji}</span>`}</td>
  <td><a href="/admin/products/${p.id}"><b>${p.name}</b></a>${p.featured ? html` <span class="pill">জনপ্রিয়</span>` : ''}</td>
  <td>${p.category_name || '—'}</td>
  <td class="num">${money(p.price)}</td>
  <td class="num ${p.stock <= 3 ? 'warn' : ''}">${bn(p.stock)}</td>
  <td>${p.active ? 'দেখা যাচ্ছে' : 'লুকানো'}</td>
</tr>`)}</tbody></table></div>`
    : html`<div class="empty panel"><p>এখনো কোনো পণ্য নেই।</p><a class="btn" href="/admin/products/new">প্রথম পণ্য যোগ করুন</a></div>`}`;
}

function productForm({ product, categories, error }) {
  const p = product || { active: true, stock: 10, emoji: '📦' };
  const isNew = !p.id;
  return html`<p class="crumbs"><a href="/admin/products">← সব পণ্য</a></p>
<h1>${isNew ? 'নতুন পণ্য যোগ করুন' : p.name}</h1>
${error ? html`<p class="flash flash-error">${error}</p>` : ''}
<form method="post" action="${isNew ? '/admin/products/new' : `/admin/products/${p.id}`}" class="form product-form" data-product-form>
  <div class="two-col">
    <div class="panel">
      <div class="field"><label for="name">পণ্যের নাম</label><input id="name" name="name" required maxlength="140" value="${p.name || ''}"></div>
      <div class="field-row">
        <div class="field"><label for="price">দাম (৳)</label><input id="price" name="price" type="number" min="0" required value="${p.price ?? ''}"></div>
        <div class="field"><label for="old_price">আগের দাম (৳, ঐচ্ছিক)</label><input id="old_price" name="old_price" type="number" min="0" value="${p.old_price ?? ''}"><small>দিলে ছাড়ের ব্যাজ দেখাবে</small></div>
        <div class="field"><label for="stock">স্টক (কয়টি আছে)</label><input id="stock" name="stock" type="number" min="0" required value="${p.stock ?? 0}"></div>
      </div>
      <div class="field"><label for="category_id">ক্যাটাগরি</label>
        <select id="category_id" name="category_id">
          <option value="">কোনোটি না</option>
          ${categories.map((c) => html`<option value="${c.id}" ${p.category_id === c.id ? 'selected' : ''}>${c.icon} ${c.name}</option>`)}
        </select>
      </div>
      <div class="field"><label for="description">বিবরণ</label><textarea id="description" name="description" rows="6" maxlength="5000">${p.description || ''}</textarea><small>প্রতিটা নতুন লাইন আলাদা প্যারাগ্রাফ হিসেবে দেখাবে।</small></div>
      <label class="check"><input type="checkbox" name="active" value="1" ${p.active ? 'checked' : ''}> দোকানে দেখাও</label>
      <label class="check"><input type="checkbox" name="featured" value="1" ${p.featured ? 'checked' : ''}> হোমপেজের "জনপ্রিয় পণ্য"-তে দেখাও</label>
    </div>
    <div class="panel">
      <h2>ছবি</h2>
      <div class="img-preview" data-preview>
        ${p.has_image ? html`<img src="/img/p/${p.id}?v=${p.version}" alt="">` : html`<span class="emoji">${p.emoji || '📦'}</span>`}
      </div>
      <div class="field">
        <label for="photo">ছবি আপলোড করুন</label>
        <input id="photo" type="file" accept="image/*" data-photo>
        <small>মোবাইলের ছবি দিলেও চলবে, আমরা নিজে থেকেই ছোট করে নেব।</small>
      </div>
      <input type="hidden" name="image" value="" data-image>
      ${p.has_image ? html`<label class="check"><input type="checkbox" data-remove-image> ছবি মুছে ফেলুন</label>` : ''}
      <div class="field"><label for="emoji">ছবি না থাকলে এই ইমোজি দেখাবে</label><input id="emoji" name="emoji" maxlength="8" value="${p.emoji || '📦'}"></div>
    </div>
  </div>
  <div class="form-actions">
    <button class="btn btn-lg" data-save>${isNew ? 'পণ্য যোগ করুন' : 'পরিবর্তন সেভ করুন'}</button>
    ${isNew ? '' : html`<a class="btn btn-ghost" href="/p/${p.slug}" target="_blank" rel="noopener">দোকানে দেখুন ↗</a>`}
  </div>
</form>
${isNew ? '' : html`<form method="post" action="/admin/products/${p.id}/delete" class="danger-zone" data-confirm="এই পণ্যটি পুরোপুরি মুছে ফেলবেন? এটা আর ফেরত আনা যাবে না। শুধু লুকাতে চাইলে 'দোকানে দেখাও' টিক তুলে দিন।">
  <button class="btn btn-danger btn-sm">পণ্যটি মুছে ফেলুন</button>
</form>`}`;
}

function categoriesPage({ categories, msg }) {
  return html`<h1>ক্যাটাগরি</h1>
${flash(msg)}
<div class="panel">
  <table class="table cat-table">
    <thead><tr><th>ইমোজি</th><th>নাম</th><th>ক্রম</th><th>পণ্য</th><th></th></tr></thead>
    <tbody>
    ${categories.map((c) => html`<tr>
      <td colspan="3">
        <form method="post" action="/admin/categories" class="inline-form" id="cat-${c.id}">
          <input type="hidden" name="id" value="${c.id}">
          <input name="icon" value="${c.icon}" maxlength="8" aria-label="ইমোজি" class="w-emoji">
          <input name="name" value="${c.name}" required maxlength="60" aria-label="নাম">
          <input name="sort" type="number" value="${c.sort}" aria-label="ক্রম" class="w-num">
          <button class="btn btn-sm btn-ghost">সেভ</button>
        </form>
      </td>
      <td>${bn(c.product_count)}টি</td>
      <td><form method="post" action="/admin/categories/${c.id}/delete" data-confirm="'${c.name}' ক্যাটাগরি মুছবেন? এর পণ্যগুলো মুছবে না, শুধু ক্যাটাগরিহীন হয়ে যাবে।"><button class="link-btn danger">মুছুন</button></form></td>
    </tr>`)}
    </tbody>
  </table>
  <h2>নতুন ক্যাটাগরি</h2>
  <form method="post" action="/admin/categories" class="inline-form">
    <input name="icon" value="📦" maxlength="8" aria-label="ইমোজি" class="w-emoji">
    <input name="name" required maxlength="60" placeholder="ক্যাটাগরির নাম" aria-label="নাম">
    <input name="sort" type="number" value="${categories.length}" aria-label="ক্রম" class="w-num">
    <button class="btn btn-sm">যোগ করুন</button>
  </form>
  <p class="muted small">"ক্রম" যত ছোট, হোমপেজে তত আগে দেখাবে।</p>
</div>`;
}

function settingsPage({ settings, msg }) {
  const s = settings;
  return html`<h1>সেটিংস</h1>
${flash(msg)}
<form method="post" action="/admin/settings" class="form panel">
  <h2>দোকানের তথ্য</h2>
  <div class="field"><label for="store_name">দোকানের নাম</label><input id="store_name" name="store_name" required value="${s.store_name}"></div>
  <div class="field"><label for="tagline">ছোট বর্ণনা (হোমপেজে দেখাবে)</label><input id="tagline" name="tagline" value="${s.tagline}" maxlength="160"></div>
  <div class="field"><label for="notice">উপরের নোটিশ বার</label><input id="notice" name="notice" value="${s.notice}" maxlength="160"><small>খালি রাখলে নোটিশ বার দেখাবে না।</small></div>
  <div class="field-row">
    <div class="field"><label for="phone">ফোন নম্বর</label><input id="phone" name="phone" value="${s.phone}" inputmode="tel"></div>
    <div class="field"><label for="whatsapp">WhatsApp নম্বর</label><input id="whatsapp" name="whatsapp" value="${s.whatsapp}" inputmode="tel"></div>
  </div>
  <h2>ডেলিভারি চার্জ</h2>
  <div class="field-row">
    <div class="field"><label for="delivery_dhaka">ঢাকার ভেতরে (৳)</label><input id="delivery_dhaka" name="delivery_dhaka" type="number" min="0" value="${s.delivery_dhaka}"></div>
    <div class="field"><label for="delivery_outside">ঢাকার বাইরে (৳)</label><input id="delivery_outside" name="delivery_outside" type="number" min="0" value="${s.delivery_outside}"></div>
    <div class="field"><label for="free_delivery_min">এত টাকার বেশি কিনলে ডেলিভারি ফ্রি (৳)</label><input id="free_delivery_min" name="free_delivery_min" type="number" min="0" value="${s.free_delivery_min}"><small>০ দিলে ফ্রি ডেলিভারি বন্ধ থাকবে।</small></div>
  </div>
  <button class="btn">সেটিংস সেভ করুন</button>
</form>
<form method="post" action="/admin/password" class="form panel">
  <h2>Admin পাসওয়ার্ড বদলান</h2>
  <div class="field-row">
    <div class="field"><label for="current">বর্তমান পাসওয়ার্ড</label><input id="current" name="current" type="password" required autocomplete="current-password"></div>
    <div class="field"><label for="npw">নতুন পাসওয়ার্ড</label><input id="npw" name="password" type="password" minlength="8" required autocomplete="new-password"></div>
  </div>
  <button class="btn btn-ghost">পাসওয়ার্ড বদলান</button>
</form>`;
}

module.exports = {
  loginPage, dashboard, ordersPage, orderDetail, productsPage, productForm, categoriesPage, settingsPage,
};
