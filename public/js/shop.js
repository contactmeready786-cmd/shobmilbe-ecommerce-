// সবমিলবে — storefront: cart, checkout, gallery, tracking events, copy protection
(function () {
  'use strict';
  var SM = window.SM || {};
  var KEY = 'sm_cart';
  var BN = '০১২৩৪৫৬৭৮৯';
  function bn(n) { return String(n).replace(/\d/g, function (d) { return BN[d]; }); }
  function money(n) {
    var v = Math.round(Number(n || 0) * 100) / 100, a = Math.abs(v);
    var t = Math.abs(a - Math.round(a)) < 0.005 ? Math.round(a).toLocaleString('en-IN') : a.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return (v < 0 ? '-' : '') + '৳' + bn(t);
  }
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
    // GA4 added directly (Measurement ID, not through GTM) only listens to gtag() calls — send the same event there too
    try {
      if (SM.g4 && typeof window.gtag === 'function') {
        window.gtag('event', event, { currency: 'BDT', value: value, items: items, transaction_id: d.code || undefined, search_term: d.q || undefined });
      }
    } catch (e) { /* ignore */ }
    var fbMap = { view_item: 'ViewContent', add_to_cart: 'AddToCart', begin_checkout: 'InitiateCheckout', purchase: 'Purchase', search: 'Search', contact: 'Contact', add_to_wishlist: 'AddToWishlist' };
    var ttMap = { view_item: 'ViewContent', add_to_cart: 'AddToCart', begin_checkout: 'InitiateCheckout', purchase: 'CompletePayment', search: 'Search', contact: 'Contact', add_to_wishlist: 'AddToWishlist' };
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
  function vaTz() { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { return ''; } }
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
      w: (window.screen ? screen.width + 'x' + screen.height : ''), l: (navigator.language || '').slice(0, 12),
      tz: vaTz(), dpr: Math.round((window.devicePixelRatio || 1) * 100) / 100 }).then(function (j) {
      if (j && j.off) { VA.on = false; return; }
      VA.pv = (j && j.pv) || 0;
      // New Chrome on Android hides the phone model; it tells it only when asked (no permission needed).
      var uad = navigator.userAgentData;
      var sent = VA.sid;
      try { sent = sessionStorage.getItem('sm_dev'); } catch (e) { /* ignore */ }
      if (VA.pv && sent !== VA.sid && uad && uad.mobile && uad.getHighEntropyValues) {
        uad.getHighEntropyValues(['model', 'platformVersion']).then(function (h) {
          try { sessionStorage.setItem('sm_dev', VA.sid); } catch (e) { /* ignore */ }
          if (h && (h.model || h.platformVersion)) vaSend({ t: 'dev', m: h.model || '', pv: h.platformVersion || '', pf: h.platform || uad.platform || '' });
        }).catch(function () {});
      }
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
  // How many pieces of one product a customer may order (same formula as the server, Admin → সেটিংস):
  // normally 1 to SM.maxQty; cheap parts (price up to rule.cap, e.g. ৳5) need at least rule.minVal worth (e.g. ৳10).
  var MAXQ = Math.max(1, Number(SM.maxQty) || 10);
  var RULE = SM.rule || { on: true, cap: 5, minVal: 10, maxVal: 100 };
  function rule(price) {
    var p = Number(price) || 0;
    if (!RULE.on || p <= 0 || p > RULE.cap + 1e-9) return { min: 1, max: MAXQ, small: false };
    var min = Math.max(1, Math.ceil(RULE.minVal / p - 1e-9));
    return { min: min, max: Math.max(MAXQ, min, Math.floor(RULE.maxVal / p + 1e-9)), small: min > 1 };
  }
  var PRICES = {}; // product id -> price, so the cart knows each product's rule
  function contactLinks() {
    var how = [];
    if (SM.phone) how.push('<a href="tel:' + esc(SM.phone) + '">📞 কল করুন</a>');
    if (SM.wa) how.push('<a href="https://wa.me/' + esc(SM.wa) + '" target="_blank" rel="noopener">💬 WhatsApp</a>');
    return how.length ? ' — ' + how.join(' · ') : '।';
  }
  function limitText(max) {
    return 'এই পণ্যটি একসাথে সর্বোচ্চ ' + bn(max) + 'টি অর্ডার করা যাবে। এর বেশি দরকার হলে সরাসরি আমাদের সাথে যোগাযোগ করুন' + contactLinks();
  }
  function minText(r, price) {
    return 'এটি কম দামের পণ্য — কমপক্ষে ' + bn(r.min) + 'টি নিতে হবে (' + money(r.min * price) + ')। না চাইলে "সরান" চাপুন।';
  }
  function say(text) {
    var box = $('[data-qty-limit]');
    if (box) { box.innerHTML = '⚠️ ' + text; box.hidden = false; return; } // product page: message under the buttons
    toast('<span>⚠️ ' + text + '</span>', 6500);
  }
  // Adds pieces, keeping the product between its minimum and maximum. Returns what happened.
  function add(id, qty, price) {
    var cart = read();
    var r = rule(price);
    var want = (cart[id] || 0) + qty;
    var got = Math.min(Math.max(want, r.min), r.max);
    cart[id] = got;
    write(cart);
    return { raised: want < r.min, capped: want > r.max, qty: got, rule: r };
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
  function toast(htmlText, ms) {
    var t = $('[data-toast]');
    if (!t) return;
    t.innerHTML = htmlText;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, ms || 3200);
  }

  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-add]');
    if (!btn) return;
    var qty = 1;
    if (btn.hasAttribute('data-with-qty')) {
      var input = $('[data-qty] input');
      qty = Math.max(1, parseInt(input && input.value, 10) || 1);
    }
    var id = btn.getAttribute('data-add');
    var price = Number(btn.getAttribute('data-price')) || 0;
    var inCart = read()[id] || 0;
    var r0 = rule(price);
    if (inCart >= r0.max && !btn.hasAttribute('data-buy-now')) { say(limitText(r0.max)); return; }
    var res = add(id, qty, price);
    track('add_to_cart', { items: [{ id: id, name: btn.getAttribute('data-name'), price: price, qty: Math.max(1, res.qty - inCart) }] });
    if (btn.hasAttribute('data-buy-now')) { location.href = '/checkout'; return; }
    updateCount(true);
    if (res.capped) { say(limitText(res.rule.max)); return; }
    if (res.raised) {
      toast('<span>✅ "' + esc(btn.getAttribute('data-name')) + '" — কম দামের পণ্য, তাই কমপক্ষে ' + bn(res.rule.min) + 'টি (' + money(res.rule.min * price) + ') কার্টে যোগ হয়েছে</span><a href="/cart">কার্ট দেখুন</a>', 5000);
      return;
    }
    toast('<span>✅ "' + esc(btn.getAttribute('data-name')) + '" কার্টে যোগ হয়েছে</span><a href="/cart">কার্ট দেখুন</a>');
  });

  $all('[data-qty]').forEach(function (box) {
    var input = $('input', box);
    var addBtn = $('[data-add][data-with-qty]');
    var price = addBtn ? Number(addBtn.getAttribute('data-price')) || 0 : 0;
    var r = rule(price);
    var fix = function (v) {
      var max = parseInt(input.max, 10) || r.max;
      var min = parseInt(input.min, 10) || 1;
      if (v > max && max >= r.max) say(limitText(r.max));
      else if (v < min && r.small) say('কম দামের পণ্য — কমপক্ষে ' + bn(min) + 'টি নিতে হবে (' + money(min * price) + ')।');
      input.value = Math.min(max, Math.max(min, v));
    };
    box.addEventListener('click', function (e) {
      var b = e.target.closest('[data-step]');
      if (!b) return;
      fix((parseInt(input.value, 10) || 1) + parseInt(b.getAttribute('data-step'), 10));
    });
    input.addEventListener('change', function () { fix(parseInt(input.value, 10) || 1); });
  });
  // WhatsApp button on the product page: message carries the product name, price and this page's link
  document.addEventListener('click', function (e) {
    var w = e.target.closest && e.target.closest('[data-wa-text]');
    if (!w) return;
    w.href = 'https://wa.me/' + w.getAttribute('data-wa') + '?text=' + encodeURIComponent(w.getAttribute('data-wa-text') + '\n' + location.href.split('#')[0]);
    track('contact', { method: 'whatsapp' });
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
        gal.classList.add('playing');
      } else if (main) {
        if (vid) { vid.hidden = true; var fr = $('iframe', vid); fr.removeAttribute('src'); }
        gal.classList.remove('playing');
        main.src = th.getAttribute('data-g-img');
      }
    });
    // big red "ভিডিও দেখুন" button under the photos = same as tapping the video thumbnail
    var vbtn = $('[data-g-yt-btn]', gal);
    var vthumb = $('[data-g-yt]', gal);
    if (vbtn && vthumb) vbtn.addEventListener('click', function () { vthumb.click(); var gm0 = $('.g-main', gal); if (gm0 && gm0.scrollIntoView) gm0.scrollIntoView({ behavior: 'smooth', block: 'center' }); });

    // full-screen photo viewer
    var lb = $('[data-lightbox]');
    if (lb && main) {
      var lbImg = $('[data-lb-img]', lb);
      var lbCount = $('[data-lb-count]', lb);
      var photos = $all('[data-g-img]', gal).map(function (b) { return b.getAttribute('data-g-img'); });
      var li = 0;
      var lbShow = function (i) {
        li = (i + photos.length) % photos.length;
        lbImg.src = photos[li];
        if (lbCount) lbCount.textContent = photos.length > 1 ? bn(li + 1) + ' / ' + bn(photos.length) : '';
      };
      var lbOpen = function () {
        var cur = photos.indexOf(main.getAttribute('src'));
        lbShow(cur < 0 ? 0 : cur);
        lb.hidden = false;
        document.body.classList.add('lb-open');
      };
      var lbClose = function () { lb.hidden = true; document.body.classList.remove('lb-open'); };
      main.addEventListener('click', lbOpen);
      var zb = $('[data-g-zoom]', gal);
      if (zb) zb.addEventListener('click', lbOpen);
      lb.addEventListener('click', function (e) {
        var st = e.target.closest('[data-lb-step]');
        if (st) return lbShow(li + Number(st.getAttribute('data-lb-step')));
        if (e.target.closest('[data-lb-close]') || e.target === lb) lbClose();
      });
      document.addEventListener('keydown', function (e) {
        if (lb.hidden) return;
        if (e.key === 'Escape') lbClose();
        if (e.key === 'ArrowRight') lbShow(li + 1);
        if (e.key === 'ArrowLeft') lbShow(li - 1);
      });
      var lx = null;
      lb.addEventListener('touchstart', function (e) { lx = e.touches[0].clientX; }, { passive: true });
      lb.addEventListener('touchend', function (e) {
        if (lx === null) return;
        var dx = e.changedTouches[0].clientX - lx; lx = null;
        if (Math.abs(dx) > 40 && photos.length > 1) lbShow(li + (dx < 0 ? 1 : -1));
      });
    }
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
  // ---------- YouTube video: loads only when tapped ----------
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-yt-lite] .yt-play');
    if (!b) return;
    var box = b.closest('[data-yt-lite]');
    var id = box.getAttribute('data-yt-lite');
    box.innerHTML = '<iframe src="https://www.youtube-nocookie.com/embed/' + encodeURIComponent(id) + '?autoplay=1&rel=0&playsinline=1" title="পণ্যের ভিডিও" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe>';
  });
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
        var changed = false;
        var lines = data.products.map(function (p) {
          known[p.id] = true;
          PRICES[p.id] = p.price;
          var r = rule(p.price);
          var fixed = Math.min(Math.max(cart[p.id], r.min), r.max);
          if (fixed !== cart[p.id]) { cart[p.id] = fixed; changed = true; }
          return { product: p, qty: cart[p.id] };
        });
        ids.forEach(function (id) { if (!known[id]) { delete cart[id]; changed = true; } });
        if (changed) write(cart);
        lines.forEach(function (l) { l.price = l.product.price; });
        if (!lines.length) return { cart: cart, lines: lines, gifts: [] };
        // the server works out the real price of each line: flash sale, cheaper price for more pieces, free gifts
        return fetch('/api/quote', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ items: lines.map(function (l) { return { id: l.product.id, qty: l.qty }; }) }) })
          .then(function (r) { return r.json(); })
          .then(function (qt) {
            var byId = {};
            (qt.lines || []).forEach(function (x) { byId[x.id] = x; });
            lines.forEach(function (l) {
              var x = byId[l.product.id];
              if (!x) return;
              l.price = Number(x.price);
              l.kind = x.kind || '';
              l.note = x.note || '';
              l.base = Number(x.base);
              l.tiers = x.tiers || [];
            });
            return { cart: cart, lines: lines, gifts: qt.gifts || [] };
          })
          .catch(function () { return { cart: cart, lines: lines, gifts: [] }; });
      });
  }
  // "10+ pieces ৳4 each" — the next cheaper step for this line, if any
  function nextTier(l) {
    var max = rule(l.product.price).max;
    var t = (l.tiers || []).filter(function (x) { return x.min_qty > l.qty && x.min_qty <= max && x.price < l.price; })[0];
    return t ? 'আরও ' + bn(t.min_qty - l.qty) + 'টি নিলে প্রতিটা ' + money(t.price) + ' করে পড়বে' : '';
  }
  function giftRows(gifts, cls) {
    return (gifts || []).map(function (g) {
      return '<' + cls + ' class="cart-line gift-line">' + thumb(g) + '<div><b>' + esc(g.name) + '</b><br><span class="small good">' + esc(g.note) + '</span><br><span class="muted small">' +
        bn(g.qty) + 'টি' + (g.price > 0 ? ' × ' + money(g.price) : '') + '</span></div><div class="line-total">' + (g.price > 0 ? money(g.price * g.qty) : '<span class="good">ফ্রি</span>') + '</div></' + cls + '>';
    }).join('');
  }
  function giftTotal(gifts) { return (gifts || []).reduce(function (s, g) { return s + g.price * g.qty; }, 0); }
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
        subtotal += l.price * l.qty;
        var hint = nextTier(l);
        return '<li class="cart-line">' + thumb(p) +
          '<div><h3><a href="/p/' + esc(p.slug) + '">' + esc(p.name) + '</a></h3>' +
          (l.note ? '<p class="small good line-note">' + esc(l.note) + '</p>' : '') +
          '<div class="cart-line-controls">' +
          '<div class="qty sm" data-line="' + p.id + '"><button type="button" data-d="-1" aria-label="কমান">−</button>' +
          '<input type="number" min="' + rule(p.price).min + '" max="' + rule(p.price).max + '" value="' + l.qty + '" aria-label="পরিমাণ"><button type="button" data-d="1" aria-label="বাড়ান">+</button></div>' +
          '<button class="link-btn danger" data-remove="' + p.id + '">সরান</button>' +
          '<span class="muted small">' + (l.base && l.price < l.base ? '<s>' + money(l.base) + '</s> ' : '') + money(l.price) + ' করে</span></div>' +
          (hint ? '<p class="small tier-hint">💡 ' + hint + '</p>' : '') +
          (rule(p.price).small ? '<p class="muted small">🔩 কম দামের পণ্য: কমপক্ষে ' + bn(rule(p.price).min) + 'টি (' + money(rule(p.price).min * p.price) + ')</p>' : '') +
          (over ? '<p class="cart-warn">' + (p.stock > 0 ? 'স্টকে আছে মাত্র ' + bn(p.stock) + 'টি' : 'এখন স্টকে নেই') + '</p>' : '') +
          '</div><div class="line-total">' + money(l.price * l.qty) + '</div></li>';
      }).join('') + giftRows(res.gifts, 'li');
      subtotal += giftTotal(res.gifts);
      subtotal = Math.round(subtotal * 100) / 100;
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
        var pr = PRICES[id] || 0;
        var r = rule(pr);
        var want = (cart[id] || 1) + parseInt(step.getAttribute('data-d'), 10);
        if (want > r.max) { say(limitText(r.max)); return; }
        if (want < r.min) { say(r.small ? minText(r, pr) : 'কমপক্ষে ১টি থাকতে হবে। না চাইলে "সরান" চাপুন।'); return; }
        cart[id] = want;
        write(cart); renderCart();
      }
    });
    cartRoot.addEventListener('change', function (e) {
      var box = e.target.closest('[data-line]');
      if (!box) return;
      var cart = read();
      var lid = box.getAttribute('data-line');
      var pr = PRICES[lid] || 0;
      var r = rule(pr);
      var v = parseInt(e.target.value, 10) || 1;
      if (v > r.max) say(limitText(r.max));
      else if (v < r.min) say(minText(r, pr));
      cart[lid] = Math.min(r.max, Math.max(r.min, v));
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
    var state = { lines: [], gifts: [], coupon: null, couponCode: '', pts: null, usePoints: false };
    // loyalty points: same rule as the server (at least `min` points, at most maxPct % of the goods)
    function pointsFor(goods) {
      var P = state.pts;
      if (!P || !P.on || !P.points) return { points: 0, discount: 0 };
      var cap = Math.floor((Math.max(0, goods) * P.maxPct) / 100 / P.value);
      var n = Math.min(P.points, cap);
      if (n < P.min) return { points: 0, discount: 0 };
      return { points: n, discount: Math.round(n * P.value * 100) / 100 };
    }
    var fee = {
      dhaka: parseInt(checkout.getAttribute('data-dhaka'), 10) || 0,
      outside: parseInt(checkout.getAttribute('data-outside'), 10) || 0,
      freeMin: parseInt(checkout.getAttribute('data-free-min'), 10) || 0,
      city: JSON.parse(checkout.getAttribute('data-city') || '[]'),
      zones: JSON.parse(checkout.getAttribute('data-zones') || '[]'),
      perKg: parseFloat(checkout.getAttribute('data-per-kg')) || 0,
      freeKg: parseFloat(checkout.getAttribute('data-free-kg')) || 1,
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

    // same rules as the server: Dhaka city → the owner's own zones → outside Dhaka; heavy parcels pay per extra kg
    function zone() {
      var d = form.elements.district.value;
      var t = form.elements.thana.value;
      if (!d) return null;
      if (d === 'Dhaka' && fee.city.indexOf(t) > -1) return { key: 'dhaka', name: 'ঢাকা সিটির ভেতরে', fee: fee.dhaka };
      if (d === 'Dhaka' && !t) return null;
      for (var i = 0; i < fee.zones.length; i++) {
        if ((fee.zones[i].districts || []).indexOf(d) > -1) return { key: 'zone', name: fee.zones[i].name, fee: Number(fee.zones[i].fee) || 0 };
      }
      return { key: 'outside', name: 'ঢাকা সিটির বাইরে', fee: fee.outside };
    }
    function weightExtra() {
      if (!fee.perKg) return 0;
      var g = state.lines.reduce(function (s, l) { return s + (l.product.weight || 0) * l.qty; }, 0);
      if (!g) return 0;
      return Math.max(0, Math.ceil(g / 1000 - 1e-9) - fee.freeKg) * fee.perKg;
    }
    function totals() {
      var subtotal = state.lines.reduce(function (s, l) { return s + l.price * l.qty; }, 0) + giftTotal(state.gifts);
      var z = zone();
      var delivery = z ? z.fee + weightExtra() : null;
      if (fee.freeMin > 0 && subtotal >= fee.freeMin) delivery = 0;
      var discount = 0;
      if (state.coupon) {
        discount = Math.min(subtotal, state.coupon.discount || 0);
        if (state.coupon.freeDelivery) delivery = 0;
      }
      var pts = pointsFor(subtotal - discount);
      var exact = Math.round((subtotal - discount - (state.usePoints ? pts.discount : 0) + (delivery || 0)) * 100) / 100;
      var total = Math.max(0, Math.round(exact)); // whole taka, same as the server
      return { subtotal: Math.round(subtotal * 100) / 100, delivery: delivery, discount: discount, points: state.usePoints ? pts : null, canPoints: pts,
        total: total, roundOff: delivery === null ? 0 : Math.round((total - exact) * 100) / 100 };
    }
    function renderSummary() {
      if (!state.lines.length) {
        summary.innerHTML = '<p>কার্ট খালি।</p><a class="btn" href="/products">পণ্য দেখুন</a>';
        submit.disabled = true;
        return;
      }
      var t = totals();
      var rows = state.lines.map(function (l) {
        return '<div class="cart-line">' + thumb(l.product) + '<div><b>' + esc(l.product.name) + '</b><br>' + (l.note ? '<span class="small good">' + esc(l.note) + '</span><br>' : '') + '<span class="muted small">' +
          bn(l.qty) + ' × ' + money(l.price) + '</span></div><div class="line-total">' + money(l.price * l.qty) + '</div></div>';
      }).join('') + giftRows(state.gifts, 'div');
      summary.innerHTML = rows + '<div class="totals">' +
        '<div><span>পণ্যের দাম</span><span>' + money(t.subtotal) + '</span></div>' +
        (t.discount ? '<div class="good"><span>কুপন ছাড় (' + esc(state.couponCode) + ')</span><span>− ' + money(t.discount) + '</span></div>' : '') +
        (t.points && t.points.points ? '<div class="good"><span>পয়েন্ট ছাড় (' + bn(t.points.points) + ' পয়েন্ট)</span><span>− ' + money(t.points.discount) + '</span></div>' : '') +
        '<div><span>ডেলিভারি চার্জ</span><span>' + (t.delivery === null ? 'এলাকা বাছুন' : t.delivery ? money(t.delivery) : 'ফ্রি') + '</span></div>' +
        (t.roundOff ? '<div><span>রাউন্ড ফিগার</span><span>' + (t.roundOff > 0 ? '+ ' : '− ') + money(Math.abs(t.roundOff)) + '</span></div>' : '') +
        '<div class="grand"><span>মোট</span><span>' + money(t.total) + '</span></div></div>' +
        '<p class="small center"><a href="/cart">কার্ট এডিট করুন</a></p>';
      var z = zone();
      var wx = weightExtra();
      zoneNote.textContent = z ? (z.key === 'dhaka' ? '✓ ' : '') + z.name + ' — ডেলিভারি চার্জ ' + money(z.fee) + (wx ? ' + ভারী পার্সেলের জন্য ' + money(wx) : '') : '';
      var amt = $('[data-pay-amount]', form);
      if (amt) amt.textContent = money(t.total);
      var advAmt = $('[data-adv-amount]', form);
      if (advAmt) advAmt.textContent = t.delivery === null ? 'এলাকা বাছুন' : money(t.delivery || 0);
      submit.disabled = false;
      submit.textContent = 'অর্ডার কনফার্ম করুন · ' + money(t.total);
      renderPoints(t);
    }
    var ptsBox = $('[data-points]');
    function renderPoints(t) {
      if (!ptsBox) return;
      var P = state.pts;
      if (!P || !P.on) { ptsBox.hidden = true; return; }
      ptsBox.hidden = false;
      var earn = P.earnPer ? Math.floor(Math.max(0, t.subtotal - t.discount - (t.points ? t.points.discount : 0)) / P.earnPer) : 0;
      $('[data-points-earn]', ptsBox).textContent = earn > 0 ? '🎁 এই অর্ডার ডেলিভারি হলে পাবেন আরও ' + bn(earn) + ' পয়েন্ট।' : '';
      var use = $('[data-points-use]', ptsBox);
      if (!P.points) { $('[data-points-text]', ptsBox).textContent = '⭐ প্রতি ' + money(P.earnPer) + ' কেনাকাটায় ১ পয়েন্ট — পরের অর্ডারে টাকার মতো খরচ করা যায়।'; use.hidden = true; return; }
      $('[data-points-text]', ptsBox).innerHTML = '⭐ আপনার <b>' + bn(P.points) + '</b> পয়েন্ট আছে (' + money(P.points * P.value) + ')।';
      var can = t.canPoints;
      use.hidden = !can.points;
      if (!can.points) {
        state.usePoints = false;
        $('[data-points-text]', ptsBox).innerHTML += ' <span class="small muted">কমপক্ষে ' + bn(P.min) + ' পয়েন্ট হলে খরচ করা যায়।</span>';
      } else {
        $('[data-points-label]', ptsBox).textContent = bn(can.points) + ' পয়েন্ট খরচ করে ' + money(can.discount) + ' ছাড় নিন';
      }
    }
    function loadPoints() {
      if (!ptsBox) return;
      var ph = form.elements.phone.value.replace(/[০-৯]/g, function (c) { return '০১২৩৪৫৬৭৮৯'.indexOf(c); }).replace(/\D/g, '').replace(/^88/, '');
      if (!/^01[3-9]\d{8}$/.test(ph)) { if (state.pts) { state.pts.points = 0; } renderSummary(); return; }
      if (state.ptsPhone === ph) return;
      state.ptsPhone = ph;
      fetch('/api/points', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: ph }) })
        .then(function (r) { return r.json(); }).then(function (j) { state.pts = j; state.usePoints = false; var cb = form.elements.use_points; if (cb) cb.checked = false; renderSummary(); })
        .catch(function () {});
    }
    if (ptsBox) {
      state.pts = { on: true, points: 0 };
      fetch('/api/points', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) })
        .then(function (r) { return r.json(); }).then(function (j) { if (!j.on) { state.pts = null; ptsBox.hidden = true; } }).catch(function () {});
      form.elements.phone.addEventListener('change', loadPoints);
      form.elements.phone.addEventListener('blur', loadPoints);
      ptsBox.addEventListener('change', function (e) { if (e.target.name === 'use_points') { state.usePoints = e.target.checked; renderSummary(); } });
      setTimeout(loadPoints, 1200);
    }
    loadCart().then(function (res) {
      state.lines = res.lines;
      state.gifts = res.gifts || [];
      renderSummary();
      if (res.lines.length && !store('sm_ic_' + Object.keys(res.cart).join('-'))) {
        store('sm_ic_' + Object.keys(res.cart).join('-'), '1');
        track('begin_checkout', { items: res.lines.map(function (l) { return { id: l.product.id, name: l.product.name, price: l.price, qty: l.qty }; }) });
      }
    }).catch(function () { summary.innerHTML = '<p class="form-error">কার্ট লোড করা যায়নি। পেজটি রিফ্রেশ করুন।</p>'; });
    form.addEventListener('change', function (e) {
      if (e.target.name === 'district' || e.target.name === 'thana') renderSummary();
      if (e.target.name === 'payment') syncPay();
    });
    form.addEventListener('input', function (e) { e.target.classList.remove('invalid'); });

    // Incomplete order: once a full mobile number is typed, what's filled in so far is kept for the shop
    // (the notice under the phone box says so), so they can call if the order isn't finished.
    var draft = { on: form.hasAttribute('data-draft'), id: '', last: '', timer: 0 };
    if (draft.on) {
      draft.id = store('sm_draft') || '';
      if (!/^[a-f0-9]{20}$/.test(draft.id)) { draft.id = rid(); store('sm_draft', draft.id); }
    }
    function saveDraft() {
      if (!draft.on || !state.lines.length) return;
      var phone = form.elements.phone.value.replace(/[০-৯]/g, function (c) { return '০১২৩৪৫৬৭৮৯'.indexOf(c); }).replace(/\D/g, '').replace(/^88/, '');
      if (!/^01[3-9]\d{8}$/.test(phone)) return;
      var d = {
        id: draft.id, vid: VA.vid || '', sid: VA.sid || '', name: form.elements.name.value.trim(), phone: phone,
        district: form.elements.district.value, thana: form.elements.thana.value, address: form.elements.address.value.trim(), note: form.elements.note.value.trim(),
        items: state.lines.map(function (l) { return { id: l.product.id, qty: l.qty }; }),
      };
      var body = JSON.stringify(d);
      if (body === draft.last) return;
      draft.last = body;
      try {
        if (navigator.sendBeacon && document.visibilityState === 'hidden') navigator.sendBeacon('/api/checkout-draft', new Blob([body], { type: 'application/json' }));
        else fetch('/api/checkout-draft', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body, keepalive: true })
          .then(function (r) { return r.json(); }).then(function (j) { if (j && j.off) draft.on = false; }).catch(function () {});
      } catch (e) { /* ignore */ }
    }
    if (draft.on) {
      var later = function () { clearTimeout(draft.timer); draft.timer = setTimeout(saveDraft, 1500); };
      form.addEventListener('input', later);
      form.addEventListener('change', later);
      document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') { clearTimeout(draft.timer); saveDraft(); } });
      setTimeout(saveDraft, 4000); // a returning customer's number is already filled in
    }
    // Send Money box: for a Send Money method (whole amount), or cash on delivery with "delivery charge first"
    function syncPay() {
      var c = form.querySelector('input[name=payment]:checked');
      var manual = !!c && c.getAttribute('data-manual') === '1';
      var adv = !!c && !!c.getAttribute('data-advance');
      manualBox.hidden = !(manual || adv);
      $('[data-manual-text]', form).hidden = !manual;
      $('[data-adv-text]', form).hidden = !adv;
      if (manual) $('[data-pay-number]', form).textContent = c.getAttribute('data-number');
      if (adv) {
        $('[data-adv-number]', form).textContent = c.getAttribute('data-number');
        $('[data-adv-label]', form).textContent = c.getAttribute('data-number-label') || '';
        var t = totals();
        $('[data-adv-amount]', form).textContent = t.delivery === null ? 'এলাকা বাছুন' : money(t.delivery || 0);
      }
    }
    syncPay();

    // coupon
    var cBox = $('[data-coupon]', checkout);
    var cMsg = $('[data-coupon-msg]', cBox);
    $('[data-apply-coupon]', cBox).addEventListener('click', function () {
      var code = $('#coupon', cBox).value.trim();
      if (!code) { state.coupon = null; state.couponCode = ''; cMsg.textContent = ''; renderSummary(); return; }
      cMsg.textContent = 'যাচাই হচ্ছে…';
      fetch('/api/coupon', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: code, subtotal: totals().subtotal, phone: form.elements.phone.value, items: state.lines.map(function (l) { return { id: l.product.id, qty: l.qty }; }) }) })
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
        use_points: state.usePoints ? '1' : '',
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
          draft.on = false; clearTimeout(draft.timer); store('sm_draft', '');
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

  // ---------- header dropdown (live scores) ----------
  document.addEventListener('click', function (e) {
    $all('[data-nav-drop][open]').forEach(function (d) { if (!d.contains(e.target)) d.removeAttribute('open'); });
  });

  // ---------- live scores ----------
  var liveBox = $('[data-live]');
  if (liveBox) {
    var sport = liveBox.getAttribute('data-live');
    var every = Math.max(10, Number(liveBox.getAttribute('data-refresh')) || 20) * 1000;
    var filter = 'all';
    var last = null;
    var timer = null;
    var TIME = { timeZone: 'Asia/Dhaka', hour: 'numeric', minute: '2-digit' };
    var DAY = { timeZone: 'Asia/Dhaka', weekday: 'short', day: 'numeric', month: 'short' };
    function fmt(d, o) { try { return new Date(d).toLocaleString('bn-BD', o); } catch (_) { return ''; } }
    function sameDay(a, b) { return fmt(a, { timeZone: 'Asia/Dhaka', year: 'numeric', month: 'numeric', day: 'numeric' }) === fmt(b, { timeZone: 'Asia/Dhaka', year: 'numeric', month: 'numeric', day: 'numeric' }); }
    // Bangladesh-style time: "রাত ৮:৩০", "বিকাল ৪:০০"
    function bnTime(d) {
      var h = 0, mi = '00';
      try {
        new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dhaka', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(d))
          .forEach(function (p) { if (p.type === 'hour') h = Number(p.value); if (p.type === 'minute') mi = p.value; });
      } catch (_) { return fmt(d, TIME); }
      var part = h < 4 ? 'রাত' : h < 12 ? 'সকাল' : h < 16 ? 'দুপুর' : h < 18 ? 'বিকাল' : h < 20 ? 'সন্ধ্যা' : 'রাত';
      return part + ' ' + bn((h % 12) || 12) + ':' + bn(mi);
    }
    function when(d) {
      var now = new Date();
      var tmr = new Date(now.getTime() + 864e5);
      var day = sameDay(d, now) ? 'আজ' : sameDay(d, tmr) ? 'আগামীকাল' : fmt(d, DAY);
      return day + ', ' + bnTime(d);
    }
    function badge(m) {
      if (m.state === 'in') return '<span class="badge-live">লাইভ</span>';
      if (m.state === 'pre') return '<span class="badge-pre">' + esc(when(m.date)) + '</span>';
      return '<span class="badge-post">শেষ</span>';
    }
    function teamRow(t) {
      var logo = t.logo ? '<img src="' + esc(t.logo) + '" alt="" loading="lazy" onerror="this.outerHTML=\'<span class=ph></span>\'">' : '<span class="ph"></span>';
      return '<div class="team-row' + (t.winner ? ' win' : '') + (t.batting ? ' bat' : '') + '">' + logo +
        '<span class="tn" title="' + esc(t.name) + '">' + esc(t.name) + '</span><span class="sc">' + esc(t.score) + '</span></div>';
    }
    function card(m, inFavGroup) {
      var foot = '';
      if (sport === 'cricket') {
        var line = m.summary || (m.state === 'pre' ? '' : m.description);
        foot = line ? '<div class="match-foot">' + esc(line) + (m.session && m.state === 'in' ? ' · ' + esc(m.session) : '') + '</div>' : '';
      } else {
        var bits = [];
        if (m.state === 'in' && m.clock) bits.push('<span class="clock">' + esc(m.clock) + '</span>');
        if (m.state === 'in' && /half/i.test(m.description + ' ' + m.detail)) bits.push('বিরতি');
        if (m.venue) bits.push(esc(m.venue));
        foot = bits.length ? '<div class="match-foot">' + bits.join(' · ') + '</div>' : '';
        if (m.goals && m.goals.length) foot += '<div class="goals">⚽ ' + m.goals.map(function (g) { return esc(g.who) + ' ' + esc(g.min); }).join(', ') + '</div>';
      }
      var teams = m.teams.map(function (t) { return sport === 'cricket' ? t : { name: t.name, logo: t.logo, winner: t.winner, score: m.state === 'pre' ? '' : t.score }; });
      return '<article class="match ' + sport + ' is-' + m.state + (m.fav ? ' is-fav' : '') + '" data-live-click="' + sport + '|' + esc(m.cat || '') + '|' + esc(m.id) + '">' +
        '<div class="match-top"><span class="title">' + esc(sport === 'cricket' ? (inFavGroup ? m.league + (m.title ? ' · ' + m.title : '') : m.title) : (inFavGroup ? m.league : '')) + '</span>' + badge(m) + '</div>' +
        teams.map(teamRow).join('') + foot + '</article>';
    }
    function render() {
      if (!last) return;
      var list = (last.matches || []).filter(function (m) { return filter === 'all' || m.state === filter; });
      var liveN = (last.matches || []).filter(function (m) { return m.state === 'in'; }).length;
      var cnt = $('[data-live-count]');
      if (cnt) cnt.textContent = liveN ? '(' + bn(liveN) + ')' : '';
      if (!list.length) {
        liveBox.innerHTML = '<p class="live-empty muted">' + (filter === 'in' ? 'এই মুহূর্তে কোনো খেলা চলছে না।' : 'এখন দেখানোর মতো কোনো খেলা নেই। একটু পরে আবার দেখুন।') + '</p>';
      } else {
        // Bangladesh / favourite matches first, then group the rest by tournament
        var groups = [];
        var byName = {};
        list.forEach(function (m) {
          var g = m.fav ? '⭐ বাংলাদেশ ও প্রিয় দল' : m.league;
          if (!byName[g]) { byName[g] = { name: g, fav: !!m.fav, items: [] }; groups.push(byName[g]); }
          byName[g].items.push(m);
        });
        liveBox.innerHTML = groups.map(function (g) {
          return '<section class="live-group"><h2>' + esc(g.name) + '</h2><div class="live-cards">' + g.items.map(function (m) { return card(m, g.fav); }).join('') + '</div></section>';
        }).join('');
      }
      var up = $('[data-live-updated]');
      if (up) up.textContent = 'সর্বশেষ আপডেট: ' + bnTime(last.updated) + ':' + bn(('0' + new Date(last.updated).getSeconds()).slice(-2)) + (last.stale ? ' (পুরনো)' : '');
    }
    function load() {
      clearTimeout(timer);
      fetch('/api/live/' + sport, { headers: { Accept: 'application/json' } })
        .then(function (r) { if (!r.ok) throw r; return r.json(); })
        .then(function (d) { last = d; render(); })
        .catch(function () {
          if (!last) liveBox.innerHTML = '<p class="live-empty muted">স্কোর আনা যাচ্ছে না। ইন্টারনেট সংযোগ দেখুন, কিছুক্ষণ পর নিজে থেকেই আবার চেষ্টা করবে।</p>';
        })
        .then(function () { if (!document.hidden) timer = setTimeout(load, every); });
    }
    $all('[data-live-filter]').forEach(function (b) {
      b.addEventListener('click', function () {
        filter = b.getAttribute('data-live-filter');
        $all('[data-live-filter]').forEach(function (x) { x.classList.toggle('on', x === b); });
        render();
      });
    });
    document.addEventListener('visibilitychange', function () { if (!document.hidden) load(); else clearTimeout(timer); });
    try { last = JSON.parse(($('[data-live-initial]') || {}).textContent || 'null'); } catch (_) { last = null; }
    if (last) { render(); timer = setTimeout(load, every); } else { load(); }
  }

  // ---------- count which matches visitors tap (admin sees the most-watched competitions) ----------
  var liveClicked = {};
  document.addEventListener('click', function (e) {
    var el = e.target.closest && e.target.closest('[data-live-click]');
    if (!el || e.target.closest('[data-mini-close]')) return;
    var parts = el.getAttribute('data-live-click').split('|');
    var once = parts.join('|');
    if (!parts[1] || liveClicked[once]) return; // one count per match per page visit
    liveClicked[once] = 1;
    var body = JSON.stringify({ sport: parts[0], cat: parts[1] });
    try {
      if (navigator.sendBeacon) navigator.sendBeacon('/api/live/click', new Blob([body], { type: 'application/json' }));
      else fetch('/api/live/click', { method: 'POST', body: body, keepalive: true, headers: { 'Content-Type': 'application/json' } });
    } catch (_) { /* never block the visitor */ }
  });

  // ---------- live score in the thin top bar (next to the notice text) ----------
  var tick = $('[data-live-mini]');
  if (tick) {
    var lmSports = tick.getAttribute('data-live-mini').split(',').filter(Boolean);
    var lmEvery = Math.max(10, Number(tick.getAttribute('data-refresh')) || 20) * 1000;
    var lmTimer = null, lmIndex = 0, lmItems = [];
    var bar = tick.closest('[data-notice]');
    function lmTime(d) {
      var h = 0, mi = '00';
      try {
        new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dhaka', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(d))
          .forEach(function (p) { if (p.type === 'hour') h = Number(p.value); if (p.type === 'minute') mi = p.value; });
      } catch (_) { return ''; }
      var part = h < 4 ? 'রাত' : h < 12 ? 'সকাল' : h < 16 ? 'দুপুর' : h < 18 ? 'বিকাল' : h < 20 ? 'সন্ধ্যা' : 'রাত';
      return part + ' ' + bn((h % 12) || 12) + ':' + bn(mi);
    }
    // running matches first (Bangladesh first); if none, one that just ended or starts within 3 hours
    function lmPick(sp, list) {
      var now = Date.now();
      var on = list.filter(function (m) { return m.state === 'in'; });
      if (!on.length) on = list.filter(function (m) { return Math.abs(new Date(m.date).getTime() - now) < 108e5; }).slice(0, 1);
      on.sort(function (a, b) { return b.fav - a.fav; });
      return on.slice(0, 6).map(function (m) { m.sport = sp; return m; });
    }
    function lmTeam(t, showScore) {
      var n = t.short || t.name || '';
      return '<b class="lt-team' + (t.winner ? ' win' : '') + '" title="' + esc(t.name) + '">' + esc(n) + (t.batting ? '*' : '') + '</b>' +
        (showScore && t.score ? ' <span class="lt-sc">' + esc(t.score) + '</span>' : '');
    }
    function lmDraw() {
      if (!lmItems.length) { tick.hidden = true; if (bar) bar.classList.remove('has-live'); return; }
      var m = lmItems[lmIndex % lmItems.length];
      var sp = m.sport;
      var tag = m.state === 'in' ? '<span class="lt-live">● লাইভ</span>' : m.state === 'pre' ? '<span class="lt-tag">' + esc(lmTime(m.date)) + '</span>' : '<span class="lt-tag">শেষ</span>';
      var status = sp === 'cricket' ? (m.summary || (m.state === 'in' ? m.session : '') || '') : (m.state === 'in' ? (m.clock || m.detail || '') : (m.state === 'post' ? m.detail || '' : ''));
      var showScore = m.state !== 'pre' || sp === 'cricket';
      var t = m.teams || [];
      tick.href = '/live/' + sp;
      tick.setAttribute('data-live-click', sp + '|' + (m.cat || ''));
      tick.innerHTML = tag + ' <span class="lt-ic">' + (sp === 'cricket' ? '🏏' : '⚽') + '</span> ' +
        (t[0] ? lmTeam(t[0], showScore) : '') + ' <span class="lt-vs">vs</span> ' + (t[1] ? lmTeam(t[1], showScore) : '') +
        (status ? ' <span class="lt-st">· ' + esc(status) + '</span>' : '') +
        (lmItems.length > 1 ? ' <span class="lt-n">' + bn(lmIndex % lmItems.length + 1) + '/' + bn(lmItems.length) + '</span>' : '');
      tick.hidden = false;
      if (bar) bar.classList.add('has-live');
    }
    function lmLoad() {
      clearTimeout(lmTimer);
      Promise.all(lmSports.map(function (sp) {
        return fetch('/api/live/' + sp, { headers: { Accept: 'application/json' } })
          .then(function (r) { if (!r.ok) throw r; return r.json(); })
          .then(function (d) { return lmPick(sp, d.matches || []); })
          .catch(function () { return []; });
      })).then(function (g) { lmItems = [].concat.apply([], g); lmDraw(); })
        .then(function () { if (!document.hidden) lmTimer = setTimeout(lmLoad, lmEvery); });
    }
    // several matches: one after another every 6 seconds
    setInterval(function () { if (!document.hidden && lmItems.length > 1) { lmIndex++; lmDraw(); } }, 6000);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) lmLoad(); else clearTimeout(lmTimer); });
    lmLoad();
  }

  updateCount();
  // ---------- category menu: keep drop-downs on screen; on touch screens first tap opens, second tap goes ----------
  var catMenu = $('[data-cat-menu]');
  if (catMenu) {
    var place = function (li) {
      var sub = li.querySelector(':scope > .cm-sub');
      if (!sub) return;
      sub.classList.remove('flip');
      var r = sub.getBoundingClientRect();
      if (r.width && r.right > window.innerWidth - 8) sub.classList.add('flip');
    };
    $all('.cm-item.has-sub', catMenu).forEach(function (li) {
      li.addEventListener('mouseenter', function () { place(li); });
      li.addEventListener('focusin', function () { place(li); });
    });
    var touch = window.matchMedia && window.matchMedia('(hover: none)').matches;
    catMenu.addEventListener('click', function (e) {
      var a = e.target.closest('.has-sub > a');
      if (!a || !touch) return;
      var li = a.parentNode;
      if (li.classList.contains('open')) return; // second tap: open the category page
      e.preventDefault();
      $all('.cm-item.open', catMenu).forEach(function (x) { if (!x.contains(li)) x.classList.remove('open'); });
      li.classList.add('open'); place(li);
    });
    document.addEventListener('click', function (e) { if (!catMenu.contains(e.target)) $all('.cm-item.open', catMenu).forEach(function (x) { x.classList.remove('open'); }); });
  }
  // ---------- home page rows: arrows, and the "নতুন এসেছে" row moves on by itself ----------
  $all('.rail-sec').forEach(function (sec) {
    var rail = $('[data-rail]', sec), prev = $('[data-rail-prev]', sec), next = $('[data-rail-next]', sec);
    if (!rail) return;
    var step = function () { var c = rail.querySelector('.card'); return c ? c.getBoundingClientRect().width + 14 : rail.clientWidth; };
    var atEnd = function () { return rail.scrollLeft + rail.clientWidth >= rail.scrollWidth - 4; };
    var paint = function () { if (prev) prev.disabled = rail.scrollLeft <= 2; if (next) next.disabled = atEnd(); };
    if (prev) prev.addEventListener('click', function () { rail.scrollBy({ left: -rail.clientWidth, behavior: 'smooth' }); });
    if (next) next.addEventListener('click', function () { rail.scrollBy({ left: rail.clientWidth, behavior: 'smooth' }); });
    rail.addEventListener('scroll', function () { clearTimeout(rail._t); rail._t = setTimeout(paint, 80); }, { passive: true });
    paint();
    if (!rail.hasAttribute('data-rail-auto') || (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)) return;
    var hold = false, seen = true;
    ['mouseenter', 'touchstart', 'focusin'].forEach(function (e) { rail.addEventListener(e, function () { hold = true; }, { passive: true }); });
    ['mouseleave', 'touchend', 'focusout'].forEach(function (e) { rail.addEventListener(e, function () { setTimeout(function () { hold = false; }, 2500); }, { passive: true }); });
    if ('IntersectionObserver' in window) new IntersectionObserver(function (en) { seen = en[0].isIntersecting; }).observe(rail);
    setInterval(function () {
      if (hold || !seen || document.hidden || rail.scrollWidth <= rail.clientWidth + 4) return;
      if (atEnd()) rail.scrollTo({ left: 0, behavior: 'smooth' }); else rail.scrollBy({ left: step(), behavior: 'smooth' });
    }, 3500);
  });

  // ---------- top bar stays one thin line: a notice that doesn't fit glides sideways ----------
  var nt = $('[data-notice-text]');
  if (nt) {
    var ntIn = nt.firstElementChild;
    var ntFit = function () {
      nt.classList.remove('is-long');
      var over = ntIn.scrollWidth - nt.clientWidth;
      if (over > 2) {
        nt.classList.add('is-long');
        over = ntIn.scrollWidth - nt.clientWidth; // measured again with the side fade padding
        nt.style.setProperty('--nt-move', -over + 'px');
        nt.style.setProperty('--nt-time', Math.min(30, Math.max(6, over / 18)).toFixed(1) + 's');
      }
    };
    ntFit();
    window.addEventListener('resize', ntFit);
    document.addEventListener('sm:lang', function () { setTimeout(ntFit, 30); });
    if (window.MutationObserver) new MutationObserver(function () { setTimeout(ntFit, 30); }).observe(ntIn, { childList: true, characterData: true, subtree: true });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(ntFit);
  }

  // ---------- ♡ wishlist (kept in this browser only) ----------
  var WKEY = 'sm_wish';
  function wishes() { try { var w = JSON.parse(store(WKEY) || '[]'); return Array.isArray(w) ? w.map(String) : []; } catch (e) { return []; } }
  function paintWish() {
    var w = wishes();
    $all('[data-wish]').forEach(function (b) {
      var on = w.indexOf(b.getAttribute('data-wish')) > -1;
      b.classList.toggle('on', on);
      b.textContent = on ? '♥' : '♡';
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }
  paintWish();
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-wish]');
    if (!b) return;
    e.preventDefault();
    var id = b.getAttribute('data-wish');
    var w = wishes();
    var i = w.indexOf(id);
    var on = i < 0;
    if (on) w.unshift(id); else w.splice(i, 1);
    store(WKEY, JSON.stringify(w.slice(0, 60)));
    paintWish();
    toast(on ? '<span>♥ পছন্দের তালিকায় রাখা হয়েছে</span><a href="/wishlist">তালিকা দেখুন</a>' : '<span>পছন্দের তালিকা থেকে সরানো হয়েছে</span>', 2500);
    try { fetch('/api/wish', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: Number(id), on: on }), keepalive: true }); } catch (err) { /* ignore */ }
    if (on) track('add_to_wishlist', { items: [{ id: id, name: b.getAttribute('aria-label') || '', price: 0, qty: 1 }] });
  });
  var wp = $('[data-wish-load]');
  if (wp) location.replace('/wishlist?ids=' + encodeURIComponent(wishes().join(',')));

  // ---------- flash sale countdown ----------
  var cds = $all('[data-countdown]');
  if (cds.length) {
    var tick = function () {
      cds.forEach(function (el) {
        var left = Math.max(0, Math.floor((new Date(el.getAttribute('data-countdown')).getTime() - Date.now()) / 1000));
        if (!left) { el.textContent = 'শেষ'; return; }
        var d = Math.floor(left / 86400); var h = Math.floor((left % 86400) / 3600); var m = Math.floor((left % 3600) / 60); var sec = left % 60;
        var pad = function (n) { return bn(n < 10 ? '0' + n : String(n)); };
        el.textContent = (d ? bn(d) + ' দিন ' : '') + pad(h) + ':' + pad(m) + ':' + pad(sec);
      });
    };
    tick();
    setInterval(tick, 1000);
  }

  // ---------- review form ----------
  var rf = $('[data-review-form]');
  if (rf) {
    rf.addEventListener('submit', function (e) {
      e.preventDefault();
      var msg = $('[data-review-msg]', rf);
      var btn = $('button', rf);
      var r = rf.querySelector('input[name=rating]:checked');
      var d = { product: Number(rf.getAttribute('data-product')), rating: r ? Number(r.value) : 5, name: rf.elements.name.value.trim(),
        phone: rf.elements.phone.value.trim(), body: rf.elements.body.value.trim(), website: rf.elements.website.value };
      if (d.name.length < 2) { msg.textContent = 'আপনার নাম লিখুন।'; return; }
      if (d.body.length < 5) { msg.textContent = 'আপনার মতামত একটু লিখুন।'; return; }
      btn.disabled = true;
      msg.textContent = 'পাঠানো হচ্ছে…';
      fetch('/api/review', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(d) })
        .then(function (res) { return res.json().then(function (j) { return { ok: res.ok, j: j }; }); })
        .then(function (x) {
          msg.textContent = x.ok ? x.j.message : x.j.error || 'পাঠানো যায়নি।';
          msg.className = 'small ' + (x.ok ? 'good' : 'warn');
          if (x.ok) { rf.reset(); } else { btn.disabled = false; }
        }).catch(function () { msg.textContent = 'পাঠানো যায়নি, আবার চেষ্টা করুন।'; btn.disabled = false; });
    });
  }

  // ---------- cart: "these go with it" ----------
  var sug = $('[data-cart-suggest]');
  function loadSuggest() {
    if (!sug) return;
    var ids = Object.keys(read());
    if (!ids.length) { sug.hidden = true; return; }
    fetch('/api/suggest?ids=' + ids.join(','), { headers: { Accept: 'application/json' } }).then(function (r) { return r.json(); }).then(function (j) {
      var list = (j.products || []).filter(function (p) { return !read()[p.id]; });
      sug.hidden = !list.length;
      $('[data-suggest-list]', sug).innerHTML = list.map(function (p) {
        return '<li>' + thumb(p) + '<a href="/p/' + esc(p.slug) + '">' + esc(p.name) + '</a><b>' + money(p.price) + '</b>' +
          '<button type="button" class="btn btn-sm btn-ghost" data-add="' + p.id + '" data-name="' + esc(p.name) + '" data-price="' + p.price + '" data-suggest-add>+ কার্টে</button></li>';
      }).join('');
    }).catch(function () { sug.hidden = true; });
  }
  if (sug) {
    loadSuggest();
    sug.addEventListener('click', function (e) { if (e.target.closest('[data-suggest-add]')) setTimeout(function () { renderCart(); loadSuggest(); }, 50); });
  }
})();
