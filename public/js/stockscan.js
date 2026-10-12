// সবমিলবে admin — 📷 স্ক্যান করে স্টক (lib/admin/stockscan.js)
// scan → the product opens → type how many came / how many you counted → Enter. A barcode gun types the code and presses Enter.
(function () {
  'use strict';
  var root = document.querySelector('[data-stockscan]');
  if (!root) return;
  var $ = function (s, el) { return (el || root).querySelector(s); };
  var input = $('[data-ss-input]'), msg = $('[data-ss-msg]'), card = $('[data-ss-card]');
  var oneEl = $('[data-ss-onebyone]'), oneWrap = $('[data-ss-onebyone-wrap]'), boxNow = $('[data-ss-boxnow]'), helpEl = $('[data-ss-modehelp]');
  var logWrap = document.querySelector('[data-ss-log-wrap]'), logBody = document.querySelector('[data-ss-log]');
  var mode = 'in', current = null, lastCode = '', lastAt = 0;
  var BN = '০১২৩৪৫৬৭৮৯';
  var bn = function (n) { return String(n).replace(/\d/g, function (d) { return BN[d]; }); };
  var esc = function (t) { return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var beep = function (ok) { if (window.SMScan) window.SMScan.beep(ok); };
  var say = function (t, kind) { msg.textContent = t || ''; msg.className = 'ho-msg ' + (kind || ''); };
  var store = function (k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (_) {} return null; };
  var getJSON = function (url) {
    return fetch(url, { credentials: 'same-origin', headers: { Accept: 'application/json' } }).then(function (r) { return r.json(); });
  };
  var post = function (url, data) {
    return fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(data) })
      .then(function (r) { return r.json(); });
  };

  // ---------- mode ----------
  var HELP = {
    in: 'বারকোড স্ক্যান করুন → কতগুলো এসেছে লিখে Enter চাপুন। স্টকে যোগ হবে।',
    count: 'বক্স খুলে গুনুন → বারকোড স্ক্যান করে আসল সংখ্যাটা লিখে Enter। স্টক সেই সংখ্যায় ঠিক হয়ে যাবে।',
  };
  function setMode(m) {
    mode = m === 'count' ? 'count' : 'in';
    store('sm_ss_mode', mode);
    Array.prototype.forEach.call(root.querySelectorAll('[data-ss-mode]'), function (b) { b.classList.toggle('on', b.getAttribute('data-ss-mode') === mode); });
    helpEl.textContent = HELP[mode];
    oneWrap.hidden = mode !== 'in';
    if (current) draw();
    input.focus();
  }
  root.addEventListener('click', function (e) { var b = e.target.closest('[data-ss-mode]'); if (b) setMode(b.getAttribute('data-ss-mode')); });
  oneEl.checked = store('sm_ss_one') === '1';
  oneEl.addEventListener('change', function () { store('sm_ss_one', oneEl.checked ? '1' : '0'); input.focus(); });
  boxNow.value = store('sm_ss_box') || '';
  boxNow.addEventListener('change', function () { store('sm_ss_box', boxNow.value.trim()); });
  setMode(store('sm_ss_mode') || 'in');

  // ---------- one product ----------
  function pic(p) { return p.image ? '<img src="' + esc(p.image) + '" alt="">' : '<span class="ho-pe">' + esc(p.emoji || '📦') + '</span>'; }
  function draw() {
    var p = current;
    if (!p) { card.innerHTML = ''; return; }
    var loc = boxNow.value.trim() || p.location || '';
    card.innerHTML = '<div class="ho-card ss-card">' +
      '<div class="ss-head">' + pic(p) + '<div class="ss-name"><b>' + esc(p.name) + '</b>' +
      '<small>' + (p.barcode ? esc(p.barcode) : '') + (p.sku ? ' · SKU ' + esc(p.sku) : '') + (p.active ? '' : ' · দোকানে লুকানো') + '</small></div></div>' +
      '<div class="ss-nums"><span>এখন স্টক<b>' + bn(p.main) + '</b></span>' +
      (p.held ? '<span>অর্ডারে আটকে<b>' + bn(p.held) + '</b></span><span>তাকে মোট<b>' + bn(p.shelf) + '</b></span>' : '') +
      '<span>📍 বক্স<b>' + (p.location ? esc(p.location) : '—') + '</b></span></div>' +
      '<form class="ss-form" data-ss-form>' +
      '<label class="ss-qty"><span>' + (mode === 'count' ? '🔢 গুনে কতগুলো পেলেন?' : '📥 কতগুলো এসেছে?') + '</span>' +
      '<input type="text" inputmode="numeric" autocomplete="off" data-ss-qty placeholder="' + (mode === 'count' ? 'যেমন: ' + bn(p.shelf) : '১') + '" required></label>' +
      '<label class="ss-loc"><span>📍 কোথায় রাখা</span><input type="text" maxlength="40" list="ss-loc-list" data-ss-loc value="' + esc(loc) + '" placeholder="যেমন: বক্স ৩"></label>' +
      '<button class="btn btn-lg">' + (mode === 'count' ? '✔ গণনা সেভ' : '✔ স্টকে যোগ') + '</button></form>' +
      '<p class="small"><a href="/admin/products/' + p.id + '" target="_blank">পণ্য খুলুন</a> · <a href="/admin/products/labels?ids=' + p.id + '" target="_blank">🏷️ লেবেল প্রিন্ট</a> · <button type="button" class="link-btn small" data-ss-close>পরেরটা স্ক্যান করুন</button></p>' +
      '</div>';
    var q = $('[data-ss-qty]');
    if (q) setTimeout(function () { q.focus(); }, 30);
  }
  function save(qty, loc) {
    if (!current) return;
    var p = current;
    var data = { id: p.id, mode: mode, qty: qty };
    if (loc !== undefined) data.location = loc;
    return post('/admin/api/stock-scan/save', data).then(function (j) {
      if (!j.ok) { beep(false); say(j.error || 'হলো না', 'bad'); return; }
      beep(true);
      say(j.message + (j.warn ? '  ' + j.warn : ''), j.warn ? 'bad' : 'ok');
      current = j.product;
      if (j.change || data.location !== undefined) addLog(j.product, j.change);
      return j;
    }).catch(function () { beep(false); say('সংযোগে সমস্যা — আবার চেষ্টা করুন', 'bad'); });
  }
  card.addEventListener('submit', function (e) {
    var f = e.target.closest('[data-ss-form]');
    if (!f) return;
    e.preventDefault();
    var raw = $('[data-ss-qty]').value.trim().replace(/[০-৯]/g, function (d) { return BN.indexOf(d); });
    // the barcode gun typed a code into the number box (the next product was scanned) → treat it as a scan
    if (raw && !/^\d{1,6}$/.test(raw)) { $('[data-ss-qty]').value = ''; scan(raw); return; }
    var qty = raw;
    if (qty === '') { say(mode === 'count' ? 'গুনে কতগুলো পেলেন লিখুন' : 'কতগুলো এসেছে লিখুন', 'bad'); return; }
    save(qty, $('[data-ss-loc]').value.trim()).then(function (j) {
      if (j && j.ok) { current = null; draw(); input.value = ''; input.focus(); }
    });
  });
  card.addEventListener('click', function (e) {
    if (e.target.closest('[data-ss-close]')) { current = null; draw(); say(''); input.focus(); }
    var pick = e.target.closest('[data-ss-pick]');
    if (pick) { current = JSON.parse(pick.getAttribute('data-ss-pick')); say(''); draw(); }
  });

  // ---------- what was done (with undo) ----------
  function addLog(p, change) {
    logWrap.hidden = false;
    var tr = document.createElement('tr');
    tr.innerHTML = '<td><b>' + esc(p.name) + '</b>' + (p.sku ? '<br><span class="small muted">SKU ' + esc(p.sku) + '</span>' : '') + '</td>' +
      '<td class="num ' + (change < 0 ? 'warn' : 'good') + '">' + (change ? (change > 0 ? '+' : '−') + bn(Math.abs(change)) : '০') + '</td>' +
      '<td class="num">' + bn(p.main) + '</td><td class="small">' + esc(p.location || '—') + '</td>' +
      '<td>' + (change ? '<button type="button" class="link-btn small" data-ss-undo="' + p.id + '" data-ss-change="' + (-change) + '">↩️ ফেরান</button>' : '') + '</td>';
    logBody.insertBefore(tr, logBody.firstChild);
  }
  logBody.addEventListener('click', function (e) {
    var b = e.target.closest('[data-ss-undo]');
    if (!b || !confirm('এই বদলটা ফেরাবেন?')) return;
    post('/admin/api/stock-scan/save', { id: b.getAttribute('data-ss-undo'), mode: 'undo', change: b.getAttribute('data-ss-change') }).then(function (j) {
      say(j.message || j.error, j.ok ? 'ok' : 'bad');
      if (j.ok) { var tr = b.closest('tr'); tr.classList.add('row-off'); b.remove(); }
    });
  });

  // ---------- scan / search ----------
  function listHtml(title, list) {
    return '<div class="ho-card"><p><b>' + title + '</b></p><ul class="ho-items">' + list.map(function (p) {
      return '<li>' + pic(p) + '<span class="ho-n"><b>' + esc(p.name) + '</b>' + (p.location ? '<span class="loc-chip">📍 ' + esc(p.location) + '</span>' : '') +
        '<small>' + esc(p.barcode || '') + (p.sku ? ' · SKU ' + esc(p.sku) : '') + '</small></span><span class="ho-q">' + bn(p.shelf) + '</span>' +
        '<button type="button" class="btn btn-sm" data-ss-pick="' + esc(JSON.stringify(p)) + '">এটা</button></li>';
    }).join('') + '</ul></div>';
  }
  function scan(code) {
    code = String(code || '').trim();
    if (!code) return;
    // ⚡ one piece per scan: the same product again → +1 at once
    var oneByOne = mode === 'in' && oneEl.checked;
    if (oneByOne && current && current.barcode && current.barcode.toUpperCase() === code.toUpperCase()) {
      save(1, boxNow.value.trim() || undefined).then(function () { draw(); });
      return;
    }
    say('খোঁজা হচ্ছে…', '');
    getJSON('/admin/api/stock-scan/find?q=' + encodeURIComponent(code)).then(function (j) {
      if (j.exact) {
        current = j.exact;
        if (oneByOne) { save(1, boxNow.value.trim() || undefined).then(function () { draw(); }); return; }
        beep(true); say(''); draw();
        return;
      }
      current = null;
      if (j.box && j.list.length) { beep(true); say(''); card.innerHTML = listHtml('📍 ' + esc(j.box) + ' — ভেতরে ' + bn(j.list.length) + 'টি পণ্য', j.list); return; }
      if (j.list && j.list.length) { say(''); card.innerHTML = listHtml('কোনটা? (' + bn(j.list.length) + 'টি মিলেছে)', j.list); return; }
      beep(false);
      if (j.unknown) {
        var u = '/admin/products/new?barcode=' + encodeURIComponent(j.unknown) + (boxNow.value.trim() ? '&location=' + encodeURIComponent(boxNow.value.trim()) : '') + '&stock=0';
        say('"' + code + '" — এই বারকোডের কোনো পণ্য দোকানে নেই।', 'bad');
        card.innerHTML = '<div class="ho-card not-ready"><p>নতুন পণ্য হলে আগে দোকানে তুলুন — বারকোডটা বসানো থাকবে। তারপর এখানে এসে আবার স্ক্যান করে স্টক দিন।</p>' +
          '<a class="btn" href="' + esc(u) + '" target="_blank">➕ নতুন পণ্য হিসেবে যোগ করুন</a></div>';
        return;
      }
      say('"' + code + '" — কিছু পাওয়া যায়নি', 'bad'); card.innerHTML = '';
    }).catch(function () { beep(false); say('সংযোগে সমস্যা — আবার চেষ্টা করুন', 'bad'); });
  }
  input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); var v = input.value; input.value = ''; scan(v); } });
  $('[data-ss-go]').addEventListener('click', function () { var v = input.value; input.value = ''; scan(v); input.focus(); });
  // a barcode gun types fast: when nothing is focused, the keys go to the scan box
  document.addEventListener('keydown', function (e) { if (document.activeElement === document.body && /^[\w-]$/.test(e.key)) input.focus(); });

  // ---------- camera ----------
  var camBox = $('[data-ss-cambox]'), stopCam = null;
  $('[data-ss-cam]').addEventListener('click', function () {
    if (!window.SMScan) { say('স্ক্যানার লোড হয়নি — পেজ রিলোড দিন', 'bad'); return; }
    camBox.hidden = false;
    stopCam = window.SMScan.start($('video', camBox), function (code) {
      // the camera sees the same sticker many times a second: one scan per sticker (unless ⚡ one-by-one, then a pause)
      var now = Date.now();
      if (code === lastCode && now - lastAt < (oneEl.checked && mode === 'in' ? 1500 : 4000)) return;
      lastCode = code; lastAt = now;
      scan(code);
    }, function (err) { say(err, 'bad'); camBox.hidden = true; });
  });
  $('[data-ss-camoff]').addEventListener('click', function () { if (stopCam) stopCam(); stopCam = null; camBox.hidden = true; input.focus(); });
})();
