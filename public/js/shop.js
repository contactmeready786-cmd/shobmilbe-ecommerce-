// সবমিলবে — storefront: cart, checkout, gallery, tracking events, copy protection
(function () {
  'use strict';
  var SM = window.SM || {};
  var KEY = 'sm_cart';
  var BN = '০১২৩৪৫৬৭৮৯';
  function bn(n) { return String(n).replace(/\d/g, function (d) { return BN[d]; }); }
  function money(n) { return '৳' + bn(Math.round(Number(n || 0)).toLocaleString('en-IN')); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } return null; }

  // ---------- tracking: one call sends to dataLayer (GTM/GA4), Facebook and TikTok ----------
  window.dataLayer = window.dataLayer || [];
  function track(event, d) {
    d = d || {};
    var items = (d.items || []).map(function (i) { return { item_id: String(i.id), item_name: i.name, price: i.price, quantity: i.qty || 1, item_category: i.category || undefined }; });
    var value = d.value != null ? d.value : items.reduce(function (s, i) { return s + i.price * i.quantity; }, 0);
    try {
      window.dataLayer.push({ ecommerce: null });
      window.dataLayer.push({ event: event, ecommerce: { currency: 'BDT', value: value, items: items, transaction_id: d.code || undefined }, search_term: d.q || undefined });
    } catch (e) { /* ignore */ }
    var fbMap = { view_item: 'ViewContent', add_to_cart: 'AddToCart', begin_checkout: 'InitiateCheckout', purchase: 'Purchase', search: 'Search' };
    var ttMap = { view_item: 'ViewContent', add_to_cart: 'AddToCart', begin_checkout: 'InitiateCheckout', purchase: 'CompletePayment', search: 'Search' };
    var ids = items.map(function (i) { return i.item_id; });
    try {
      if (window.fbq && fbMap[event]) {
        var fd = { currency: 'BDT', value: value, content_ids: ids, content_type: 'product', contents: items.map(function (i) { return { id: i.item_id, quantity: i.quantity }; }) };
        if (event === 'search') fd = { search_string: d.q };
        window.fbq('track', fbMap[event], fd, d.code ? { eventID: d.code } : undefined);
      }
    } catch (e) { /* ignore */ }
    try {
      if (window.ttq && ttMap[event]) {
        var td = { currency: 'BDT', value: value, content_type: 'product', contents: items.map(function (i) { return { content_id: i.item_id, content_name: i.item_name, quantity: i.quantity, price: i.price }; }) };
        if (event === 'search') td = { query: d.q };
        window.ttq.track(ttMap[event], td, d.code ? { event_id: d.code } : undefined);
      }
    } catch (e) { /* ignore */ }
    visitEvent(event, d, items, value);
  }

  // ---------- visitor analytics (our own: Admin → মার্কেটিং → ভিজিটর অ্যানালিটিক্স) ----------
  var VA = { on: !!SM.va && !!window.JSON, pv: 0, active: 0, since: 0, scroll: 0, beats: 0 };
  function rid() {
    var a = [];
    var c = window.crypto || window.msCrypto;
    if (c && c.getRandomValues) { var u = new Uint8Array(10); c.getRandomValues(u); for (var i = 0; i < 10; i++) a.push(u[i]); }
    else for (var j = 0; j < 10; j++) a.push(Math.floor(Math.random() * 256));
    return a.map(function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  }
  function vaSend(data, beacon) {
    if (!VA.on) return Promise.resolve({});
    data.vid = VA.vid; data.sid = VA.sid;
    var body = JSON.stringify(data);
    try {
      if (beacon && navigator.sendBeacon && navigator.sendBeacon('/api/v', new Blob([body], { type: 'text/plain' }))) return Promise.resolve({});
      return fetch('/api/v', { method: 'POST', body: body, keepalive: true, credentials: 'same-origin', headers: { 'Content-Type': 'text/plain' } })
        .then(function (r) { return r.json(); }).catch(function () { return {}; });
    } catch (e) { return Promise.resolve({}); }
  }
  function vaTouch() { try { localStorage.setItem('sm_sess', JSON.stringify({ id: VA.sid, t: Date.now() })); } catch (e) { /* ignore */ } }
  function vaActive() { return Math.round((VA.active + (VA.since ? Date.now() - VA.since : 0)) / 1000); }
  function vaFlush(kind) {
    if (!VA.pv) return;
    vaSend({ t: kind, pv: VA.pv, d: vaActive(), s: VA.scroll }, kind === 'end');
    vaTouch();
  }
  function visitEvent(event, d, items, value) {
    if (!VA.on || !VA.sid) return;
    var label = '';
    var ref = '';
    if (event === 'add_to_cart' && items[0]) { label = items[0].item_name || ''; ref = items[0].item_id; }
    else if (event === 'begin_checkout') label = items.length + ' items';
    else if (event === 'purchase') { label = d.code || ''; ref = d.code || ''; }
    else if (event === 'search') label = d.q || '';
    else if (event === 'contact') label = d.label || '';
    else return;
    vaSend({ t: 'ev', e: event, lb: label, ref: ref, v: Math.round(value || 0), p: location.pathname + location.search });
  }
  if (VA.on) {
    VA.vid = store('sm_vid');
    if (!/^[a-f0-9]{20}$/.test(VA.vid || '')) { VA.vid = rid(); store('sm_vid', VA.vid); }
    var sess = null;
    try { sess = JSON.parse(localStorage.getItem('sm_sess') || 'null'); } catch (e) { sess = null; }
    // A visit (session) ends after 30 minutes without activity, or when an ad link brings the visitor back.
    var fromAd = /[?&](utm_source|fbclid|gclid|ttclid)=/.test(location.search);
    VA.sid = sess && /^[a-f0-9]{20}$/.test(sess.id || '') && Date.now() - sess.t < 30 * 60 * 1000 && !fromAd ? sess.id : rid();
    vaTouch();
    if (document.visibilityState !== 'hidden') VA.since = Date.now();
    vaSend({ t: 'pv', p: location.pathname + location.search, u: location.href, ti: document.title, r: document.referrer || '',
      w: (window.screen ? screen.width + 'x' + screen.height : ''), l: (navigator.language || '').slice(0, 12) }).then(function (j) {
      if (j && j.off) { VA.on = false; return; }
      VA.pv = (j && j.pv) || 0;
    });
    var onScroll = function () {
      var h = document.documentElement.scrollHeight - window.innerHeight;
      var pct = h > 0 ? Math.round((100 * (window.scrollY || window.pageYOffset)) / h) : 100;
      if (pct > VA.scroll) VA.scroll = Math.min(100, pct);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') {
        if (VA.since) { VA.active += Date.now() - VA.since; VA.since = 0; }
        vaFlush('end');
      } else if (!VA.since) { VA.since = Date.now(); vaTouch(); }
    });
    window.addEventListener('pagehide', function () {
      if (VA.since) { VA.active += Date.now() - VA.since; VA.since = 0; }
      vaFlush('end');
    });
    // While the page is open and visible, tell the server every 30 seconds (keeps "live now" correct).
    setInterval(function () {
      if (document.visibilityState === 'visible' && VA.pv && VA.beats < 60) { VA.beats++; vaFlush('hb'); }
    }, 30000);
    document.addEventListener('click', function (e) {
      var a = e.target.closest && e.target.closest('a[href]');
      if (!a) return;
      var href = a.getAttribute('href') || '';
      var kind = /^tel:/.test(href) ? 'ফোন কল' : /wa\.me|whatsapp/i.test(href) ? 'WhatsApp' : /m\.me|messenger/i.test(href) ? 'Messenger' : '';
      if (kind) visitEvent('contact', { label: kind }, [], 0);
    });
  }

  if (SM.track) {
    var t = SM.track;
    if (t.event === 'view_item') track('view_item', { items: [{ id: t.id, name: t.name, price: t.price, qty: 1, category: t.category }] });
    else if (t.event === 'purchase') {
      // Count each order once, even if the page is refreshed.
      if (!store('sm_done_' + t.code)) { store('sm_done_' + t.code, '1'); track('purchase', { code: t.code, value: t.value, items: t.items }); }
    } else if (t.event === 'search') track('search', { q: t.q });
  }

  // ---------- copy protection ----------
  if (SM.protect) {
    var editable = function (el) { return el && el.closest && el.closest('input, textarea, select, [contenteditable]'); };
    document.addEventListener('contextmenu', function (e) { if (!editable(e.target)) e.preventDefault(); });
    document.addEventListener('copy', function (e) { if (!editable(e.target)) e.preventDefault(); });
    document.addEventListener('cut', function (e) { if (!editable(e.target)) e.preventDefault(); });
    document.addEventListener('dragstart', function (e) { if (e.target && e.target.tagName === 'IMG') e.preventDefault(); });
    document.addEventListener('selectstart', function (e) { if (!editable(e.target)) e.preventDefault(); });
    document.addEventListener('keydown', function (e) {
      var k = (e.key || '').toLowerCase();
      if ((e.ctrlKey || e.metaKey) && ['c', 'x', 'a', 's', 'u', 'p'].indexOf(k) > -1 && !editable(e.target)) e.preventDefault();
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && ['i', 'j', 'c'].indexOf(k) > -1) e.preventDefault();
    });
  }

  // ---------- cart storage ----------
  function read() {
    try { var c = JSON.parse(store(KEY) || '{}'); return c && typeof c === 'object' ? c : {}; } catch (e) { return {}; }
  }
  function write(cart) { store(KEY, JSON.stringify(cart)); updateCount(); }
  function count(cart) { return Object.keys(cart).reduce(function (s, k) { return s + cart[k]; }, 0); }
  function add(id, qty) {
    var cart = read();
    cart[id] = Math.min((cart[id] || 0) + qty, 99);
    write(cart);
  }
  function updateCount(bump) {
    var n = count(read());
    $all('[data-cart-count]').forEach(function (el) {
      el.textContent = bn(n);
      el.hidden = n === 0;
      if (bump) { el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); }
    });
  }

  var toastTimer;
  function toast(htmlText) {
    var t = $('[data-toast]');
    if (!t) return;
    t.innerHTML = htmlText;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 3200);
  }

  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-add]');
    if (!btn) return;
    var qty = 1;
    if (btn.hasAttribute('data-with-qty')) {
      var input = $('[data-qty] input');
      qty = Math.max(1, parseInt(input && input.value, 10) || 1);
    }
    add(btn.getAttribute('data-add'), qty);
    track('add_to_cart', { items: [{ id: btn.getAttribute('data-add'), name: btn.getAttribute('data-name'), price: Number(btn.getAttribute('data-price')) || 0, qty: qty }] });
    if (btn.hasAttribute('data-buy-now')) { location.href = '/checkout'; return; }
    updateCount(true);
    toast('<span>✅ "' + esc(btn.getAttribute('data-name')) + '" কার্টে যোগ হয়েছে</span><a href="/cart">কার্ট দেখুন</a>');
  });

  $all('[data-qty]').forEach(function (box) {
    var input = $('input', box);
    box.addEventListener('click', function (e) {
      var b = e.target.closest('[data-step]');
      if (!b) return;
      var max = parseInt(input.max, 10) || 99;
      input.value = Math.min(max, Math.max(1, (parseInt(input.value, 10) || 1) + parseInt(b.getAttribute('data-step'), 10)));
    });
  });
  $all('[data-autosubmit]').forEach(function (el) { el.addEventListener('change', function () { el.form.submit(); }); });

  // ---------- mobile drawer ----------
  var drawer = $('#drawer');
  function setDrawer(open) {
    if (!drawer) return;
    drawer.hidden = !open;
    document.body.classList.toggle('drawer-open', open);
  }
  document.addEventListener('click', function (e) {
    if (e.target.closest('[data-drawer-open]')) setDrawer(true);
    else if (e.target.closest('[data-drawer-close]') || (drawer && !drawer.hidden && !e.target.closest('#drawer'))) setDrawer(false);
  });

  // ---------- slider ----------
  $all('[data-slider]').forEach(function (sl) {
    var slides = $all('.slide', sl);
    var dots = $all('[data-dot]', sl);
    if (slides.length < 2) return;
    var i = 0;
    var timer;
    function go(n) {
      slides[i].classList.remove('on'); if (dots[i]) dots[i].classList.remove('on');
      i = (n + slides.length) % slides.length;
      slides[i].classList.add('on'); if (dots[i]) dots[i].classList.add('on');
    }
    function auto() { clearInterval(timer); timer = setInterval(function () { go(i + 1); }, 5000); }
    dots.forEach(function (d) { d.addEventListener('click', function () { go(Number(d.getAttribute('data-dot'))); auto(); }); });
    var x0 = null;
    sl.addEventListener('touchstart', function (e) { x0 = e.touches[0].clientX; }, { passive: true });
    sl.addEventListener('touchend', function (e) {
      if (x0 === null) return;
      var dx = e.changedTouches[0].clientX - x0;
      if (Math.abs(dx) > 40) { go(i + (dx < 0 ? 1 : -1)); auto(); }
      x0 = null;
    });
    auto();
  });

  // ---------- product gallery & tabs ----------
  var gal = $('[data-gallery]');
  if (gal) {
    var main = $('[data-g-main]', gal);
    var vid = $('[data-g-video]', gal);
    gal.addEventListener('click', function (e) {
      var th = e.target.closest('.g-thumb');
      if (!th || th.classList.contains('g-empty')) return;
      $all('.g-thumb', gal).forEach(function (x) { x.classList.remove('on'); });
      th.classList.add('on');
      if (th.hasAttribute('data-g-yt') && vid) {
        var f = $('iframe', vid);
        if (!f.src) f.src = f.getAttribute('data-src');
        vid.hidden = false;
        if (main) main.hidden = true;
      } else if (main) {
        if (vid) { vid.hidden = true; var fr = $('iframe', vid); fr.removeAttribute('src'); }
        main.hidden = false;
        main.src = th.getAttribute('data-g-img');
      }
    });
    // swipe between photos on phones
    var gx = null;
    var gm = $('.g-main', gal);
    gm.addEventListener('touchstart', function (e) { gx = e.touches[0].clientX; }, { passive: true });
    gm.addEventListener('touchend', function (e) {
      if (gx === null) return;
      var dx = e.changedTouches[0].clientX - gx; gx = null;
      if (Math.abs(dx) < 40) return;
      var thumbs = $all('.g-thumb:not(.g-empty)', gal);
      var cur = thumbs.findIndex(function (x) { return x.classList.contains('on'); });
      var next = thumbs[(cur + (dx < 0 ? 1 : -1) + thumbs.length) % thumbs.length];
      if (next) next.click();
    });
  }
  $all('[data-tabs]').forEach(function (box) {
    box.addEventListener('click', function (e) {
      var tb = e.target.closest('[data-tab]');
      if (!tb) return;
      $all('[data-tab]', box).forEach(function (x) { x.classList.toggle('on', x === tb); });
      $all('[data-panel]', box).forEach(function (p) { p.hidden = p.getAttribute('data-panel') !== tb.getAttribute('data-tab'); });
    });
  });
  var sticky = $('[data-sticky-buy]');
  var buyBox = $('.buy-box');
  if (sticky && buyBox && 'IntersectionObserver' in window) {
    new IntersectionObserver(function (en) { sticky.classList.toggle('show', !en[0].isIntersecting && en[0].boundingClientRect.top < 0); }).observe(buyBox);
  }

  // ---------- popup offer (once a day) ----------
  var pop = $('[data-popup]');
  if (pop && !location.pathname.match(/^\/(checkout|cart|order)/)) {
    var pk = 'sm_pop_' + pop.getAttribute('data-popup');
    var last = Number(store(pk) || 0);
    if (Date.now() - last > 864e5) {
      setTimeout(function () { pop.hidden = false; store(pk, String(Date.now())); }, 2500);
    }
    pop.addEventListener('click', function (e) { if (e.target === pop || e.target.closest('[data-popup-close]')) pop.hidden = true; });
  }

  // ---------- load cart products ----------
  function loadCart() {
    var cart = read();
    var ids = Object.keys(cart);
    if (!ids.length) return Promise.resolve({ cart: cart, lines: [] });
    return fetch('/api/cart?ids=' + ids.join(','), { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        var known = {};
        var lines = data.products.map(function (p) { known[p.id] = true; return { product: p, qty: cart[p.id] }; });
        var changed = false;
        ids.forEach(function (id) { if (!known[id]) { delete cart[id]; changed = true; } });
        if (changed) write(cart);
        return { cart: cart, lines: lines };
      });
  }
  function thumb(p) {
    return '<span class="cart-thumb">' + (p.image ? '<img src="' + esc(p.image) + '" alt="">' : esc(p.emoji || '📦')) + '</span>';
  }

  var cartRoot = $('[data-cart-page]');
  function renderCart() {
    loadCart().then(function (res) {
      var lines = res.lines;
      if (!lines.length) {
        cartRoot.innerHTML = '<div class="empty"><p>আপনার কার্ট এখন খালি।</p><a class="btn" href="/products">পণ্য দেখুন</a></div>';
        return;
      }
      var subtotal = 0;
      var problem = false;
      var items = lines.map(function (l) {
        var p = l.product;
        var over = l.qty > p.stock;
        if (over) problem = true;
        subtotal += p.price * l.qty;
        return '<li class="cart-line">' + thumb(p) +
          '<div><h3><a href="/p/' + esc(p.slug) + '">' + esc(p.name) + '</a></h3>' +
          '<div class="cart-line-controls">' +
          '<div class="qty sm" data-line="' + p.id + '"><button type="button" data-d="-1" aria-label="কমান">−</button>' +
          '<input type="number" min="1" max="99" value="' + l.qty + '" aria-label="পরিমাণ"><button type="button" data-d="1" aria-label="বাড়ান">+</button></div>' +
          '<button class="link-btn danger" data-remove="' + p.id + '">সরান</button>' +
          '<span class="muted small">' + money(p.price) + ' করে</span></div>' +
          (over ? '<p class="cart-warn">' + (p.stock > 0 ? 'স্টকে আছে মাত্র ' + bn(p.stock) + 'টি' : 'এখন স্টকে নেই') + '</p>' : '') +
          '</div><div class="line-total">' + money(p.price * l.qty) + '</div></li>';
      }).join('');
      var freeMin = parseInt(cartRoot.getAttribute('data-free-min'), 10) || 0;
      cartRoot.innerHTML = '<div class="panel"><ul class="cart-lines">' + items + '</ul>' +
        '<div class="totals"><div class="grand"><span>পণ্যের মোট দাম</span><span>' + money(subtotal) + '</span></div></div>' +
        (freeMin > 0 ? '<p class="muted small">' + (subtotal >= freeMin ? '🎉 আপনি ফ্রি ডেলিভারি পাচ্ছেন!' : 'আরও ' + money(freeMin - subtotal) + ' কিনলে ডেলিভারি ফ্রি।') + '</p>' : '') +
        '<p class="muted small">ডেলিভারি চার্জ পরের ধাপে এলাকা অনুযায়ী যোগ হবে।</p>' +
        (problem ? '<p class="form-error">কিছু পণ্যের পরিমাণ স্টকের চেয়ে বেশি। পরিমাণ কমিয়ে নিন।</p>' : '') +
        '<a class="btn btn-amber btn-lg btn-block" href="/checkout">অর্ডার করতে এগিয়ে যান</a>' +
        '<p class="center small"><a href="/products">আরও পণ্য দেখুন</a></p></div>';
    }).catch(function () {
      cartRoot.innerHTML = '<p class="form-error">কার্ট লোড করা যায়নি। ইন্টারনেট সংযোগ দেখে পেজটি রিফ্রেশ করুন।</p>';
    });
  }
  if (cartRoot) {
    renderCart();
    cartRoot.addEventListener('click', function (e) {
      var cart = read();
      var rm = e.target.closest('[data-remove]');
      if (rm) { delete cart[rm.getAttribute('data-remove')]; write(cart); renderCart(); return; }
      var step = e.target.closest('[data-d]');
      if (step) {
        var id = step.parentNode.getAttribute('data-line');
        cart[id] = Math.min(99, Math.max(1, (cart[id] || 1) + parseInt(step.getAttribute('data-d'), 10)));
        write(cart); renderCart();
      }
    });
    cartRoot.addEventListener('change', function (e) {
      var box = e.target.closest('[data-line]');
      if (!box) return;
      var cart = read();
      cart[box.getAttribute('data-line')] = Math.min(99, Math.max(1, parseInt(e.target.value, 10) || 1));
      write(cart); renderCart();
    });
  }

  // ---------- district / thana selects (also used by checkout) ----------
  function fillGeo(form) {
    var dSel = $('[data-district]', form);
    var tSel = $('[data-thana]', form);
    if (!dSel || !tSel || !window.BD_GEO) return null;
    var geo = window.BD_GEO.districts;
    var want = dSel.getAttribute('data-value') || '';
    dSel.innerHTML = '<option value="">জেলা বাছুন</option>' + geo.map(function (d) {
      return '<option value="' + esc(d.en) + '"' + (d.en === want ? ' selected' : '') + '>' + esc(d.bn) + ' (' + esc(d.en) + ')</option>';
    }).join('');
    function fillThana(selected) {
      var d = geo.filter(function (x) { return x.en === dSel.value; })[0];
      tSel.innerHTML = '<option value="">' + (d ? 'থানা / উপজেলা বাছুন' : 'আগে জেলা বাছুন') + '</option>' + (d ? d.areas.map(function (a) {
        return '<option value="' + esc(a[0]) + '"' + (a[0] === selected ? ' selected' : '') + '>' + esc(a[1]) + '</option>';
      }).join('') : '');
    }
    fillThana(tSel.getAttribute('data-value') || '');
    dSel.addEventListener('change', function () { fillThana(''); });
    return { district: dSel, thana: tSel };
  }

  // ---------- checkout ----------
  var checkout = $('[data-checkout]');
  if (checkout) {
    var form = document.getElementById('checkout-form');
    var summary = $('[data-summary]', checkout);
    var errorBox = $('[data-error]', form);
    var submit = $('[data-submit]', form);
    var zoneNote = $('[data-zone-note]', form);
    var manualBox = $('[data-manual-box]', form);
    var state = { lines: [], coupon: null, couponCode: '' };
    var fee = {
      dhaka: parseInt(checkout.getAttribute('data-dhaka'), 10) || 0,
      outside: parseInt(checkout.getAttribute('data-outside'), 10) || 0,
      freeMin: parseInt(checkout.getAttribute('data-free-min'), 10) || 0,
      city: JSON.parse(checkout.getAttribute('data-city') || '[]'),
    };
    var geoReady = function () {
      var g = fillGeo(form);
      if (!g) return;
      try {
        var saved = JSON.parse(store('sm_customer') || 'null');
        if (saved) {
          ['name', 'phone', 'address'].forEach(function (k) { if (saved[k] && !form.elements[k].value) form.elements[k].value = saved[k]; });
          if (saved.district) { g.district.value = saved.district; g.district.dispatchEvent(new Event('change')); }
          if (saved.thana) g.thana.value = saved.thana;
        }
      } catch (e) { /* ignore */ }
      renderSummary();
    };
    if (window.BD_GEO) geoReady(); else window.addEventListener('load', geoReady);

    function zone() {
      var d = form.elements.district.value;
      var t = form.elements.thana.value;
      if (!d) return null;
      return d === 'Dhaka' && fee.city.indexOf(t) > -1 ? 'dhaka' : (d === 'Dhaka' && !t ? null : 'outside');
    }
    function totals() {
      var subtotal = state.lines.reduce(function (s, l) { return s + l.product.price * l.qty; }, 0);
      var z = zone();
      var delivery = z ? (z === 'dhaka' ? fee.dhaka : fee.outside) : null;
      if (fee.freeMin > 0 && subtotal >= fee.freeMin) delivery = 0;
      var discount = 0;
      if (state.coupon) {
        discount = Math.min(subtotal, state.coupon.discount || 0);
        if (state.coupon.freeDelivery) delivery = 0;
      }
      return { subtotal: subtotal, delivery: delivery, discount: discount, total: subtotal - discount + (delivery || 0) };
    }
    function renderSummary() {
      if (!state.lines.length) {
        summary.innerHTML = '<p>কার্ট খালি।</p><a class="btn" href="/products">পণ্য দেখুন</a>';
        submit.disabled = true;
        return;
      }
      var t = totals();
      var rows = state.lines.map(function (l) {
        return '<div class="cart-line">' + thumb(l.product) + '<div><b>' + esc(l.product.name) + '</b><br><span class="muted small">' +
          bn(l.qty) + ' × ' + money(l.product.price) + '</span></div><div class="line-total">' + money(l.product.price * l.qty) + '</div></div>';
      }).join('');
      summary.innerHTML = rows + '<div class="totals">' +
        '<div><span>পণ্যের দাম</span><span>' + money(t.subtotal) + '</span></div>' +
        (t.discount ? '<div class="good"><span>কুপন ছাড় (' + esc(state.couponCode) + ')</span><span>− ' + money(t.discount) + '</span></div>' : '') +
        '<div><span>ডেলিভারি চার্জ</span><span>' + (t.delivery === null ? 'এলাকা বাছুন' : t.delivery ? money(t.delivery) : 'ফ্রি') + '</span></div>' +
        '<div class="grand"><span>মোট</span><span>' + money(t.total) + '</span></div></div>' +
        '<p class="small center"><a href="/cart">কার্ট এডিট করুন</a></p>';
      var z = zone();
      zoneNote.textContent = z === 'dhaka' ? '✓ ঢাকা সিটির ভেতরে — ডেলিভারি চার্জ ' + money(fee.dhaka) : z === 'outside' ? 'ঢাকা সিটির বাইরে — ডেলিভারি চার্জ ' + money(fee.outside) : '';
      var amt = $('[data-pay-amount]', form);
      if (amt) amt.textContent = money(t.total);
      submit.disabled = false;
      submit.textContent = 'অর্ডার কনফার্ম করুন · ' + money(t.total);
    }
    loadCart().then(function (res) {
      state.lines = res.lines;
      renderSummary();
      if (res.lines.length && !store('sm_ic_' + Object.keys(res.cart).join('-'))) {
        store('sm_ic_' + Object.keys(res.cart).join('-'), '1');
        track('begin_checkout', { items: res.lines.map(function (l) { return { id: l.product.id, name: l.product.name, price: l.product.price, qty: l.qty }; }) });
      }
    }).catch(function () { summary.innerHTML = '<p class="form-error">কার্ট লোড করা যায়নি। পেজটি রিফ্রেশ করুন।</p>'; });
    form.addEventListener('change', function (e) {
      if (e.target.name === 'district' || e.target.name === 'thana') renderSummary();
      if (e.target.name === 'payment') {
        var manual = e.target.getAttribute('data-manual') === '1';
        manualBox.hidden = !manual;
        if (manual) $('[data-pay-number]', form).textContent = e.target.getAttribute('data-number');
      }
    });
    form.addEventListener('input', function (e) { e.target.classList.remove('invalid'); });
    var checked = form.querySelector('input[name=payment]:checked');
    if (checked && checked.getAttribute('data-manual') === '1') { manualBox.hidden = false; $('[data-pay-number]', form).textContent = checked.getAttribute('data-number'); }

    // coupon
    var cBox = $('[data-coupon]', checkout);
    var cMsg = $('[data-coupon-msg]', cBox);
    $('[data-apply-coupon]', cBox).addEventListener('click', function () {
      var code = $('#coupon', cBox).value.trim();
      if (!code) { state.coupon = null; state.couponCode = ''; cMsg.textContent = ''; renderSummary(); return; }
      cMsg.textContent = 'যাচাই হচ্ছে…';
      fetch('/api/coupon', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: code, subtotal: totals().subtotal, phone: form.elements.phone.value }) })
        .then(function (r) { return r.json(); })
        .then(function (j) {
          cMsg.textContent = j.message;
          cMsg.className = 'small ' + (j.ok ? 'good' : 'warn');
          state.coupon = j.ok ? j : null;
          state.couponCode = j.ok ? j.code : '';
          renderSummary();
        }).catch(function () { cMsg.textContent = 'যাচাই করা যায়নি, আবার চেষ্টা করুন।'; });
    });

    function showError(msg, field) {
      errorBox.textContent = msg;
      errorBox.hidden = false;
      $all('.invalid', form).forEach(function (el) { el.classList.remove('invalid'); });
      if (field && form.elements[field]) { form.elements[field].classList.add('invalid'); form.elements[field].focus(); }
      else errorBox.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      errorBox.hidden = true;
      var pay = form.querySelector('input[name=payment]:checked');
      var data = {
        name: form.elements.name.value.trim(), phone: form.elements.phone.value.trim(), address: form.elements.address.value.trim(),
        district: form.elements.district.value, thana: form.elements.thana.value, note: form.elements.note.value.trim(),
        payment: pay ? pay.value : 'cod', coupon: state.couponCode,
        trx: form.elements.trx ? form.elements.trx.value.trim() : '', payment_number: form.elements.payment_number ? form.elements.payment_number.value.trim() : '',
        items: state.lines.map(function (l) { return { id: l.product.id, qty: l.qty }; }),
      };
      if (data.name.length < 2) return showError('আপনার নাম লিখুন।', 'name');
      if (!data.phone) return showError('মোবাইল নম্বর লিখুন।', 'phone');
      if (!data.district) return showError('জেলা বাছুন।', 'district');
      if (!data.thana) return showError('থানা / উপজেলা বাছুন।', 'thana');
      if (data.address.length < 5) return showError('পূর্ণ ঠিকানা লিখুন, যাতে ডেলিভারিম্যান সহজে খুঁজে পান।', 'address');
      submit.disabled = true;
      submit.textContent = 'অর্ডার পাঠানো হচ্ছে…';
      fetch('/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
        .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, body: j }; }); })
        .then(function (res) {
          if (!res.ok) throw res.body;
          store('sm_customer', JSON.stringify({ name: data.name, phone: data.phone, address: data.address, district: data.district, thana: data.thana }));
          write({});
          location.href = res.body.redirect || ('/order/' + res.body.code + '?new=1');
        })
        .catch(function (err) {
          submit.disabled = false;
          renderSummary();
          showError((err && err.error) || 'অর্ডার পাঠানো যায়নি। ইন্টারনেট সংযোগ দেখে আবার চেষ্টা করুন।', err && err.field);
          loadCart().then(function (r) { state.lines = r.lines; renderSummary(); });
        });
    });
  }

  updateCount();
})();
