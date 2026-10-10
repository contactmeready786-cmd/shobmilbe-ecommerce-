'use strict';
// Customer side: "আমার অ্যাকাউন্ট" (login with mobile + SMS code, my orders, addresses, profile, referral, gift cards),
// the return / refund request form, and the gift card page.
const { html, raw, money, bn, fmtDate } = require('../util');
const O = require('../models/orders');

function maskPhone(p) { const s = String(p || ''); return s.length > 6 ? s.slice(0, 3) + '•'.repeat(s.length - 6) + s.slice(-3) : '•••'; }

// ---------------------------------------------------------------- login
function loginPage({ step = 'phone', phone = '', error = '', info = '', next = '' }) {
  return html`<div class="wrap section narrow acct-login">
  <div class="panel">
    <h1>👤 আমার অ্যাকাউন্ট</h1>
    <p class="muted">মোবাইল নম্বর দিয়ে ঢুকুন — কোনো পাসওয়ার্ড লাগবে না। SMS-এ একটা ৬ অঙ্কের কোড যাবে।</p>
    ${info ? html`<p class="flash">${info}</p>` : ''}
    ${error ? html`<p class="form-error">${error}</p>` : ''}
    ${step === 'code' ? html`<form method="post" action="/account/verify" class="form">
      <input type="hidden" name="phone" value="${phone}"><input type="hidden" name="next" value="${next}">
      <p><b translate="no">${phone}</b> নম্বরে কোড পাঠানো হয়েছে।</p>
      <div class="field"><label for="otp">৬ অঙ্কের কোড</label><input id="otp" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="7" required autofocus class="otp-input" placeholder="••••••"></div>
      <button class="btn btn-block btn-lg">ঢুকুন</button>
    </form>
    <form method="post" action="/account/code" class="center mt"><input type="hidden" name="phone" value="${phone}"><input type="hidden" name="next" value="${next}"><button class="link-btn small">কোড পাননি? আবার পাঠান</button></form>
    <p class="center small"><a href="/account">← অন্য নম্বর দিন</a></p>`
    : html`<form method="post" action="/account/code" class="form">
      <input type="hidden" name="next" value="${next}">
      <div class="field"><label for="aphone">মোবাইল নম্বর</label><input id="aphone" name="phone" inputmode="tel" autocomplete="tel" required maxlength="20" placeholder="01XXXXXXXXX" value="${phone}" autofocus></div>
      <button class="btn btn-block btn-lg">কোড পাঠান</button>
    </form>`}
    <ul class="acct-why small muted">
      <li>🧾 আগের সব অর্ডার এক জায়গায় — এক চাপে আবার অর্ডার</li>
      <li>📍 ঠিকানা সেভ থাকে, অর্ডারের সময় আর লিখতে হয় না</li>
      <li>↩️ ভুল/নষ্ট পণ্যের রিটার্ন আবেদন সহজে</li>
    </ul>
    <p class="center small muted">লগইন না করেও অর্ডার করা যায়।</p>
  </div>
</div>`;
}

// ---------------------------------------------------------------- dashboard
function addressForm(a, { action = '/account/address', submit = 'সেভ করুন' } = {}) {
  return html`<form method="post" action="${action}" class="form addr-form" data-geo-form>
    ${a.id ? html`<input type="hidden" name="id" value="${a.id}">` : ''}
    <div class="field-row">
      <div class="field"><label>নাম (ঐচ্ছিক, যেমন: বাসা / অফিস)</label><input name="label" maxlength="30" value="${a.label || ''}"></div>
      <div class="field"><label>প্রাপকের নাম</label><input name="name" maxlength="80" value="${a.name || ''}" autocomplete="name"></div>
      <div class="field"><label>প্রাপকের মোবাইল</label><input name="phone" inputmode="tel" maxlength="20" value="${a.phone || ''}" autocomplete="tel"></div>
    </div>
    <div class="field-row">
      <div class="field"><label>জেলা</label><select name="district" required data-district data-value="${a.district || 'Dhaka'}"><option value="">লোড হচ্ছে…</option></select></div>
      <div class="field"><label>থানা / উপজেলা</label><select name="thana" required data-thana data-value="${a.thana || ''}"><option value="">আগে জেলা বাছুন</option></select></div>
    </div>
    <div class="field"><label>পূর্ণ ঠিকানা</label><textarea name="address" rows="2" maxlength="400" required placeholder="বাসা নং, রোড, এলাকা">${a.address || ''}</textarea></div>
    <label class="check"><input type="checkbox" name="is_default" value="1" ${a.is_default ? raw('checked') : ''}> <span>এটাই আমার মূল ঠিকানা</span></label>
    <button class="btn btn-sm">${submit}</button>
  </form>`;
}

function dashboard({ cu, orders, addresses, settings: s, tab = 'orders', flash = '', error = '', referral = null, cards = [] }) {
  const T = [['orders', '🧾 আমার অর্ডার'], ['addresses', '📍 ঠিকানা'], ['profile', '👤 প্রোফাইল']];
  if (referral) T.push(['refer', '🎁 বন্ধুকে আনুন']);
  if (s.gift_on === '1') T.push(['gift', '💳 গিফট কার্ড']);
  const reorderItems = (o) => (o.items || []).filter((i) => i.id && i.kind !== 'gift').map((i) => ({ id: i.id, qty: i.qty }));
  const returnable = (o) => s.returns_on === '1' && o.status === 'delivered';
  return html`<div class="wrap section acct">
  <div class="title-row"><h1>আসসালামু আলাইকুম${cu.name ? html`, <span translate="no">${cu.name.split(' ')[0]}</span>` : ''}!</h1>
    <form method="post" action="/account/logout"><button class="btn btn-sm btn-ghost">লগআউট</button></form></div>
  <p class="muted small">মোবাইল: <b translate="no">${cu.phone}</b>${cu.points ? html` · লয়ালটি পয়েন্ট: <b>${bn(cu.points)}</b>` : ''}</p>
  ${flash ? html`<p class="flash">${flash}</p>` : ''}${error ? html`<p class="form-error">${error}</p>` : ''}
  <nav class="acct-tabs" aria-label="অ্যাকাউন্ট">${T.map(([k, l]) => html`<a href="/account?tab=${k}" class="${tab === k ? 'on' : ''}" ${tab === k ? raw('aria-current="page"') : ''}>${l}</a>`)}</nav>
  ${tab === 'orders' ? html`<section class="panel">
    ${orders.length ? html`<ul class="acct-orders">${orders.map((o) => html`<li>
      <div><a href="/order/${o.code}"><b class="mono">${o.code}</b></a> <span class="pill st-${o.status}">${O.STATUSES[o.status] || o.status}</span><br>
        <span class="small muted">${fmtDate(o.created_at)} · ${bn((o.items || []).length)}টি পণ্য: ${(o.items || []).map((i) => i.name).slice(0, 3).join(', ')}${(o.items || []).length > 3 ? '…' : ''}</span></div>
      <div class="acct-order-act"><b>${money(o.total)}</b>
        <a class="btn btn-sm btn-ghost" href="/order/${o.code}">দেখুন</a>
        ${reorderItems(o).length ? html`<button type="button" class="btn btn-sm" data-reorder="${JSON.stringify(reorderItems(o))}">🔁 আবার অর্ডার</button>` : ''}
        ${returnable(o) ? html`<a class="btn btn-sm btn-ghost" href="/order/${o.code}/return">↩️ রিটার্ন</a>` : ''}</div>
    </li>`)}</ul>` : html`<div class="empty"><p>এখনো কোনো অর্ডার নেই।</p><a class="btn" href="/products">কেনাকাটা শুরু করুন</a></div>`}
  </section>` : ''}
  ${tab === 'addresses' ? html`<section class="panel">
    ${addresses.length ? html`<ul class="acct-addr">${addresses.map((a) => html`<li><details><summary><b>${a.label || 'ঠিকানা'}</b>${a.is_default ? html` <span class="pill">মূল</span>` : ''}<br>
      <span class="small">${a.name ? `${a.name}, ` : ''}${a.phone ? `${a.phone}, ` : ''}${a.address}, ${O.areaLabel({ district: a.district, thana: a.thana })}</span> <span class="small link-like">✏️ এডিট</span></summary>
      ${addressForm(a)}
      <form method="post" action="/account/address/delete" class="mt" data-confirm-shop="ঠিকানাটা মুছবেন?"><input type="hidden" name="id" value="${a.id}"><button class="link-btn danger small">🗑️ মুছুন</button></form>
    </details></li>`)}</ul>` : html`<p class="muted">কোনো ঠিকানা সেভ করা নেই। নিচে যোগ করুন — অর্ডারের সময় নিজে থেকে বসে যাবে।</p>`}
    <h2 class="mt">+ নতুন ঠিকানা</h2>
    ${addressForm({ name: cu.name, phone: cu.phone }, { submit: 'ঠিকানা সেভ করুন' })}
  </section><script src="/js/bd-geo.js" defer></script>` : ''}
  ${tab === 'profile' ? html`<section class="panel narrow-panel">
    <form method="post" action="/account/profile" class="form">
      <div class="field"><label>আপনার নাম</label><input name="name" maxlength="80" required value="${cu.name || ''}" autocomplete="name"></div>
      <div class="field"><label>ইমেইল (ঐচ্ছিক)</label><input name="email" type="email" maxlength="120" value="${cu.email || ''}" autocomplete="email"></div>
      <p class="small muted">মোবাইল নম্বর বদলাতে নতুন নম্বর দিয়ে আলাদা লগইন করুন, অথবা আমাদের জানান।</p>
      <button class="btn">সেভ করুন</button>
    </form>
    <form method="post" action="/account/logout-all" class="mt"><button class="link-btn small">🔒 সব ফোন/কম্পিউটার থেকে লগআউট করুন</button></form>
  </section>` : ''}
  ${tab === 'refer' && referral ? referralBox(referral, s) : ''}
  ${tab === 'gift' && s.gift_on === '1' ? html`<section class="panel">
    <h2>💳 আমার গিফট কার্ড</h2>
    ${cards.length ? html`<ul class="acct-orders">${cards.map((c) => html`<li><div><b class="mono">${c.code}</b> <span class="pill">${c.status === 'active' ? 'চালু' : c.status === 'pending' ? 'পেমেন্ট যাচাই চলছে' : c.status === 'used' ? 'শেষ' : c.status}</span><br>
      <span class="small muted">${c.source === 'referral' ? 'রেফারেলের পুরস্কার' : c.recipient_phone === cu.phone ? 'আপনাকে দেওয়া' : `আপনি কিনেছেন${c.recipient_name ? ` — ${c.recipient_name}` : ''}`}${c.expires_on ? ` · মেয়াদ ${c.expires_on}` : ''}</span></div>
      <div class="acct-order-act"><b>${money(c.balance)}</b> <span class="small muted">/ ${money(c.initial)}</span></div></li>`)}</ul>`
      : html`<p class="muted">আপনার কোনো গিফট কার্ড নেই।</p>`}
    <p><a class="btn btn-sm" href="/gift-card">🎁 গিফট কার্ড কিনুন</a></p>
  </section>` : ''}
</div>`;
}

function referralBox(r, s) {
  const base = String(s.site_url || '').replace(/\/+$/, '');
  const link = `${base}/?ref=${r.code}`;
  return html`<section class="panel ref-box">
    <h2>🎁 বন্ধুকে আনুন, দুজনেই ছাড় পান</h2>
    <p>আপনার কোড বা লিংক দিয়ে কোনো নতুন কাস্টমার প্রথম অর্ডার করলে তিনি পাবেন <b>${money(r.friendGets)}</b> ছাড়${r.friendMin ? html` (কমপক্ষে ${money(r.friendMin)} এর অর্ডারে)` : ''}।
      তার অর্ডার ডেলিভারি হলে আপনি পাবেন <b>${money(r.youGet)}</b> এর গিফট কার্ড — পরের কেনাকাটায় ব্যবহার করবেন।</p>
    <div class="ref-code"><span class="small muted">আপনার কোড</span><b class="mono" data-copy-text>${r.code}</b></div>
    ${base ? html`<div class="ref-code"><span class="small muted">আপনার লিংক</span><input readonly value="${link}" class="mono" data-select-all></div>` : ''}
    <div class="row-actions">
      <a class="btn btn-wa" href="https://wa.me/?text=${encodeURIComponent(`${s.store_name} থেকে কিনুন, আমার কোড ${r.code} দিলে প্রথম অর্ডারে ৳${r.friendGets} ছাড় পাবেন${base ? ': ' + link : ''}`)}" target="_blank" rel="noopener">WhatsApp এ পাঠান</a>
      <a class="btn btn-ghost" href="https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(link)}" target="_blank" rel="noopener">Facebook এ শেয়ার</a>
    </div>
    <p class="small muted">এখন পর্যন্ত: <b>${bn(r.joined)}</b> জন আপনার কোডে অর্ডার করেছেন, <b>${bn(r.rewarded)}</b>টা পুরস্কার পেয়েছেন।</p>
  </section>`;
}

// ---------------------------------------------------------------- return request (customer)
const REASONS = [['broken', 'ভাঙা / নষ্ট পণ্য এসেছে'], ['wrong', 'ভুল পণ্য এসেছে'], ['missing', 'পণ্য কম এসেছে / পার্টস নেই'], ['not_working', 'কাজ করছে না'],
  ['not_as_described', 'ছবি/বিবরণের সাথে মিলছে না'], ['warranty', 'ওয়ারেন্টি দাবি'], ['other', 'অন্য কারণ']];
const WANTS = [['refund', '💵 টাকা ফেরত'], ['replace', '🔄 বদলে দিন (একই পণ্য)'], ['fix', '🛠️ মেরামত / ওয়ারেন্টি সার্ভিস']];
function returnForm({ order, existing = [], settings: s, error = '', done = null, mine }) {
  const items = (order.items || []).filter((i) => i.product_id);
  return html`<div class="wrap section narrow">
  <p class="crumbs"><a href="/order/${order.code}">← অর্ডার ${order.code}</a></p>
  <h1>↩️ রিটার্ন / রিফান্ড আবেদন</h1>
  ${done ? html`<div class="success-banner"><div class="tick" aria-hidden="true">✓</div><h2>আবেদন পেয়েছি — নম্বর <span class="mono">${done}</span></h2><p>আমরা দেখে শীঘ্রই আপনার সাথে যোগাযোগ করব। এই পেজে আবেদনের অবস্থা দেখতে পাবেন।</p></div>` : ''}
  ${existing.length ? html`<section class="panel"><h2>আপনার আবেদন</h2><ul class="acct-orders">${existing.map((r) => html`<li><div><b class="mono">${r.code}</b> <span class="pill">${RETURN_LABELS[r.status] || r.status}</span><br>
    <span class="small muted">${fmtDate(r.created_at)} · ${(r.items || []).map((i) => `${i.name} ×${bn(i.qty)}`).join(', ')}</span>
    ${r.reply ? html`<br><span class="small"><b>${s.store_name}:</b> ${r.reply}</span>` : ''}</div>
    <div class="acct-order-act">${Number(r.refund_amount) ? html`<b>${money(r.refund_amount)}</b> ফেরত` : ''}</div></li>`)}</ul></section>` : ''}
  ${!mine ? html`<p class="note">আবেদন করতে আগে <a href="/track?code=${order.code}">অর্ডার ট্র্যাক</a> পেজে অর্ডার নম্বর আর মোবাইল নম্বর দিন${s.acct_on === '1' ? html`, অথবা <a href="/account?next=/order/${order.code}/return">লগইন করুন</a>` : ''}।</p>`
    : order.status !== 'delivered' ? html`<p class="note">অর্ডার ডেলিভারি হওয়ার পর রিটার্নের আবেদন করা যায়। ডেলিভারির সময় সমস্যা দেখলে ডেলিভারিম্যানের সামনেই জানান।</p>`
      : html`<form class="form panel" method="post" action="/order/${order.code}/return" data-return-form>
    ${error ? html`<p class="form-error">${error}</p>` : ''}
    <p class="muted small">পণ্য হাতে পাওয়ার ${bn(Number(s.returns_days) || 7)} দিনের মধ্যে আবেদন করা যায়। যে পণ্য ফেরত দিতে চান টিক দিন আর পরিমাণ লিখুন।</p>
    <table class="lines"><tbody>${items.map((it) => html`<tr><td><label class="check"><input type="checkbox" name="item" value="${it.id}"> <span>${it.name}</span></label></td>
      <td class="num"><input type="number" name="qty_${it.id}" min="1" max="${it.qty}" value="${it.qty}" class="w-num" aria-label="পরিমাণ"> / ${bn(it.qty)}</td></tr>`)}</tbody></table>
    <div class="field-row">
      <div class="field"><label>কারণ</label><select name="reason" required>${REASONS.map(([k, l]) => html`<option value="${k}">${l}</option>`)}</select></div>
      <div class="field"><label>আপনি কী চান</label><select name="want">${WANTS.map(([k, l]) => html`<option value="${k}">${l}</option>`)}</select></div>
    </div>
    <div class="field"><label>বিস্তারিত লিখুন</label><textarea name="details" rows="3" maxlength="1000" required minlength="10" placeholder="কী সমস্যা হয়েছে, কবে খেয়াল করলেন…"></textarea></div>
    <div class="field"><label>📷 ছবি (সমস্যাটা দেখা যায় এমন, সর্বোচ্চ ৪টা)</label><input type="file" accept="image/*" multiple data-return-photos>
      <div class="ret-thumbs" data-return-thumbs></div><input type="hidden" name="photos" value="" data-return-photo-data>
      <small>ছবি ছোট করে পাঠানো হয়। ছবি দিলে আবেদন দ্রুত যাচাই হয়।</small></div>
    <div class="field-row">
      <div class="field"><label>টাকা কোথায় নেবেন (টাকা ফেরত চাইলে)</label><select name="refund_method"><option value="bkash">বিকাশ</option><option value="nagad">নগদ</option><option value="rocket">রকেট</option><option value="bank">ব্যাংক</option><option value="cash">নগদ টাকা</option></select></div>
      <div class="field"><label>সেই নম্বর / অ্যাকাউন্ট</label><input name="refund_number" maxlength="60" inputmode="tel" placeholder="01XXXXXXXXX"></div>
    </div>
    <input type="text" name="website" class="hp" tabindex="-1" autocomplete="off" aria-hidden="true">
    <button class="btn btn-amber btn-lg btn-block" data-return-submit>আবেদন পাঠান</button>
    <p class="small muted center">আবেদন পাঠানো মানেই রিটার্ন নিশ্চিত না — আমরা দেখে জানাব। <a href="/page/return-policy">রিটার্ন নীতি</a></p>
  </form>`}
</div>`;
}
const RETURN_LABELS = { requested: 'আবেদন পেয়েছি', approved: 'অনুমোদিত — পণ্য পাঠান', received: 'পণ্য ফেরত পেয়েছি', refunded: 'টাকা ফেরত দেওয়া হয়েছে', replaced: 'বদলে দেওয়া হয়েছে', rejected: 'গ্রহণ করা যায়নি', cancelled: 'বাতিল' };

// ---------------------------------------------------------------- gift card page
function giftPage({ settings: s, methods = [], error = '', done = null, values = {} }) {
  const amounts = String(s.gift_amounts || '500,1000,2000,5000').split(',').map((x) => Number(x)).filter((x) => x > 0).slice(0, 8);
  const min = Number(s.gift_min) || 200; const max = Number(s.gift_max) || 20000;
  return html`<div class="wrap section narrow">
  <h1>🎁 গিফট কার্ড</h1>
  <p class="muted">প্রিয়জনকে উপহার দিন — তিনি নিজের পছন্দে ${s.store_name} থেকে কিনবেন। গিফট কার্ডের কোড SMS-এ যাবে, চেকআউটে কোড দিলেই টাকা কাটা যাবে। ${Number(s.gift_valid_days) ? `মেয়াদ ${bn(s.gift_valid_days)} দিন।` : ''}</p>
  ${done ? html`<div class="success-banner"><div class="tick" aria-hidden="true">✓</div><h2>অনুরোধ পেয়েছি!</h2><p>আপনার পাঠানো টাকা (TrxID <b class="mono">${done.trx}</b>) যাচাই করে গিফট কার্ড চালু করা হবে, আর কোড SMS-এ যাবে <b>${done.to}</b> নম্বরে।</p></div>` : html`
  <form method="post" action="/gift-card" class="form panel" data-gift-form>
    ${error ? html`<p class="form-error">${error}</p>` : ''}
    <div class="field"><span class="label">পরিমাণ</span><div class="gift-amounts">${amounts.map((a, i) => html`<label class="gift-amt"><input type="radio" name="amount" value="${a}" ${Number(values.amount || amounts[1] || amounts[0]) === a ? raw('checked') : i === 0 && !values.amount && amounts.length === 1 ? raw('checked') : ''}><span>${money(a)}</span></label>`)}
      <label class="gift-amt"><input type="radio" name="amount" value="custom" ${values.amount === 'custom' ? raw('checked') : ''}><span>অন্য</span></label></div>
      <input name="custom_amount" type="number" min="${min}" max="${max}" value="${values.custom_amount || ''}" placeholder="${bn(min)} – ${bn(max)} টাকা" class="mt" data-gift-custom></div>
    <h2>কাকে দেবেন</h2>
    <div class="field-row">
      <div class="field"><label>প্রাপকের নাম</label><input name="recipient_name" maxlength="80" required value="${values.recipient_name || ''}"></div>
      <div class="field"><label>প্রাপকের মোবাইল (কোড এখানে যাবে)</label><input name="recipient_phone" inputmode="tel" maxlength="20" required value="${values.recipient_phone || ''}"></div>
    </div>
    <div class="field"><label>শুভেচ্ছা বার্তা (ঐচ্ছিক)</label><input name="message" maxlength="120" value="${values.message || ''}" placeholder="যেমন: শুভ জন্মদিন!"></div>
    <h2>আপনার তথ্য</h2>
    <div class="field-row">
      <div class="field"><label>আপনার নাম</label><input name="buyer_name" maxlength="80" required value="${values.buyer_name || ''}" autocomplete="name"></div>
      <div class="field"><label>আপনার মোবাইল</label><input name="buyer_phone" inputmode="tel" maxlength="20" required value="${values.buyer_phone || ''}" autocomplete="tel"></div>
    </div>
    <h2>পেমেন্ট (Send Money)</h2>
    ${methods.length ? html`<div class="pay-methods">${methods.map((m, i) => html`<label class="pay-opt"><input type="radio" name="pay_method" value="${m.id}" ${i === 0 ? raw('checked') : ''}><span><b>${m.label}</b><small>${m.number} (${s.manual_type || 'Personal'}) নম্বরে Send Money করুন</small></span></label>`)}</div>
    <div class="field-row">
      <div class="field"><label>যে নম্বর থেকে পাঠিয়েছেন</label><input name="pay_number" inputmode="tel" maxlength="20" required value="${values.pay_number || ''}"></div>
      <div class="field"><label>Transaction ID (TrxID)</label><input name="trx" maxlength="40" required autocapitalize="characters" value="${values.trx || ''}"></div>
    </div>
    <input type="text" name="website" class="hp" tabindex="-1" autocomplete="off" aria-hidden="true">
    <button class="btn btn-amber btn-lg btn-block">অনুরোধ পাঠান</button>
    <p class="small muted center">টাকা যাচাই হলে গিফট কার্ড চালু হবে (সাধারণত কয়েক ঘণ্টার মধ্যে)।</p>` : html`<p class="note">এখন অনলাইনে গিফট কার্ড বিক্রি বন্ধ আছে। কিনতে আমাদের কল করুন বা দোকানে আসুন।</p>`}
  </form>`}
  <section class="panel mt"><h2>গিফট কার্ডে কত আছে দেখুন</h2>
    <form class="coupon-row" data-gift-check><input name="code" placeholder="গিফট কার্ডের কোড" maxlength="30" autocapitalize="characters"><button class="btn btn-sm btn-ghost">দেখুন</button></form>
    <p class="small" data-gift-check-msg role="status"></p></section>
</div>`;
}

module.exports = { loginPage, dashboard, returnForm, giftPage, REASONS, WANTS, RETURN_LABELS, maskPhone };
