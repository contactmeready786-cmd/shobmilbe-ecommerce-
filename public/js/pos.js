/* সবমিলবে admin — 🧾 দোকানে বিক্রি (POS): scan → bill → paid → cash memo. */
(function () {
  'use strict';
  var root = document.querySelector('[data-pos]');
  if (!root) return;
  var BN = '০১২৩৪৫৬৭৮৯';
  function bn(n) { return String(n).replace(/\d/g, function (d) { return BN[d]; }); }
  function money(n) { var v = Math.round(Number(n || 0) * 100) / 100; return (v < 0 ? '-' : '') + '৳' + bn(Math.abs(v).toLocaleString('en-IN', { maximumFractionDigits: 2 })); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function $(s) { return root.querySelector(s); }
  var canPrice = root.getAttribute('data-can-price') === '1';
  var lines = []; // { id, name, sku, price, qty, here }
  var KEY = 'sm_pos_bill';
  try { lines = JSON.parse(sessionStorage.getItem(KEY) || '[]') || []; } catch (e) { lines = []; }
  var whSel = $('[data-pos-wh]');
  var msg = $('[data-pos-msg]');
  function say(t, bad) { msg.textContent = t; msg.className = 'pos-msg ' + (bad ? 'warn' : 'good'); }
  function wh() { return whSel ? whSel.value : '0'; }
  function save() { try { sessionStorage.setItem(KEY, JSON.stringify(lines)); } catch (e) { /* ignore */ } }

  function totals() {
    var sub = lines.reduce(function (s, l) { return s + l.price * l.qty; }, 0);
    var disc = Math.min(sub, Math.max(0, Number($('[data-pos-disc]').value) || 0));
    var total = Math.max(0, Math.round(sub - disc));
    return { sub: Math.round(sub * 100) / 100, disc: disc, total: total };
  }
  function render() {
    var body = $('[data-pos-lines]');
    if (!lines.length) body.innerHTML = '<tr><td class="muted">কোনো পণ্য নেই — বারকোড স্ক্যান করুন।</td></tr>';
    else body.innerHTML = lines.map(function (l, i) {
      return '<tr data-i="' + i + '"><td><b>' + esc(l.name) + '</b><br><span class="small muted">' + esc(l.sku || '') + (l.here !== undefined ? ' · এখানে আছে ' + bn(l.here) : '') + '</span>' +
        (l.here !== undefined && l.qty > l.here ? '<br><span class="small warn">⚠️ স্টকের চেয়ে বেশি</span>' : '') + '</td>' +
        '<td class="pos-qty"><button type="button" data-d="-1" aria-label="কমান">−</button><input type="number" min="1" value="' + l.qty + '" data-qty aria-label="পরিমাণ"><button type="button" data-d="1" aria-label="বাড়ান">+</button></td>' +
        '<td class="num">' + (canPrice ? '<input type="number" min="0" step="0.01" value="' + l.price + '" data-price class="pos-price" aria-label="দাম">' : money(l.price)) + '<br><b>' + money(l.price * l.qty) + '</b></td>' +
        '<td><button type="button" class="link-btn danger" data-rm aria-label="সরান">✕</button></td></tr>';
    }).join('');
    var t = totals();
    $('[data-pos-sub]').textContent = money(t.sub);
    $('[data-pos-total]').textContent = money(t.total);
    var given = Number($('[data-pos-given]').value) || 0;
    $('[data-pos-change]').textContent = given ? (given >= t.total ? money(given - t.total) : 'আরও ' + money(t.total - given) + ' লাগবে') : '—';
    $('[data-pos-done]').disabled = !lines.length;
    $('[data-pos-done]').textContent = lines.length ? '✅ বিক্রি সম্পন্ন · ' + money(t.total) : '✅ বিক্রি সম্পন্ন ও মেমো প্রিন্ট';
    save();
  }
  function addProduct(p) {
    if (!p.active) say('⚠️ "' + p.name + '" দোকানে বন্ধ করা আছে — তবুও বিলে যোগ হলো।', true);
    var ex = lines.filter(function (l) { return l.id === p.id; })[0];
    if (ex) ex.qty += 1;
    else lines.push({ id: p.id, name: p.name, sku: p.sku, price: p.price, qty: 1, here: p.here });
    if (window.SMScan) window.SMScan.beep(true);
    if (p.active) say('✅ ' + p.name + ' যোগ হয়েছে');
    render();
  }
  var results = $('[data-pos-results]');
  function find(q) {
    if (!q) return;
    say('খোঁজা হচ্ছে…');
    fetch('/admin/api/pos/find?q=' + encodeURIComponent(q) + '&wh=' + wh(), { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        results.innerHTML = '';
        if (j.exact) { addProduct(j.exact); return; }
        if (!j.list || !j.list.length) { say('"' + q + '" — কোনো পণ্য পাওয়া যায়নি।', true); if (window.SMScan) window.SMScan.beep(false); return; }
        say(bn(j.list.length) + 'টি পণ্য পাওয়া গেছে — বাছুন:');
        results.innerHTML = j.list.map(function (p, i) {
          return '<li><button type="button" data-pick="' + i + '">' + (p.image ? '<img src="' + esc(p.image) + '" alt="">' : '<span>' + esc(p.emoji || '📦') + '</span>') +
            '<span><b>' + esc(p.name) + '</b><br><span class="small muted">SKU ' + esc(p.sku) + ' · স্টক ' + bn(p.here) + '</span></span><b>' + money(p.price) + '</b></button></li>';
        }).join('');
        results._list = j.list;
      }).catch(function () { say('খোঁজা যায়নি, আবার চেষ্টা করুন।', true); });
  }
  var scanForm = $('[data-pos-scan]'), q = $('[data-pos-q]');
  scanForm.addEventListener('submit', function (e) { e.preventDefault(); var v = q.value.trim(); q.value = ''; find(v); q.focus(); });
  results.addEventListener('click', function (e) {
    var b = e.target.closest('[data-pick]');
    if (!b) return;
    addProduct(results._list[Number(b.getAttribute('data-pick'))]);
    results.innerHTML = ''; q.focus();
  });
  $('[data-pos-lines]').addEventListener('click', function (e) {
    var tr = e.target.closest('tr[data-i]'); if (!tr) return;
    var l = lines[Number(tr.getAttribute('data-i'))];
    var d = e.target.closest('[data-d]');
    if (d) { l.qty = Math.max(1, l.qty + Number(d.getAttribute('data-d'))); render(); }
    if (e.target.closest('[data-rm]')) { lines.splice(lines.indexOf(l), 1); render(); }
  });
  $('[data-pos-lines]').addEventListener('change', function (e) {
    var tr = e.target.closest('tr[data-i]'); if (!tr) return;
    var l = lines[Number(tr.getAttribute('data-i'))];
    if (e.target.matches('[data-qty]')) l.qty = Math.max(1, parseInt(e.target.value, 10) || 1);
    if (e.target.matches('[data-price]')) l.price = Math.max(0, Number(e.target.value) || 0);
    render();
  });
  ['[data-pos-disc]', '[data-pos-given]'].forEach(function (s) { $(s).addEventListener('input', render); });
  if (whSel) whSel.addEventListener('change', function () { lines = []; render(); say('দোকান বদলানো হয়েছে — বিল খালি করা হলো।'); });
  $('[data-pos-clear]').addEventListener('click', function () { if (!lines.length || confirm('বিল খালি করবেন?')) { lines = []; render(); } });

  // camera scanning
  var stopCam = null;
  var camBox = $('[data-pos-cam-box]');
  $('[data-pos-cam]').addEventListener('click', function () {
    if (!window.SMScan) return;
    camBox.hidden = false;
    stopCam = window.SMScan.start($('[data-pos-video]'), function (code) { find(code); }, function (err) { say(err, true); camBox.hidden = true; });
  });
  $('[data-pos-cam-stop]').addEventListener('click', function () { if (stopCam) stopCam(); stopCam = null; camBox.hidden = true; q.focus(); });

  // done → save the sale, open the memo
  var err = $('[data-pos-error]');
  $('[data-pos-done]').addEventListener('click', function () {
    var btn = this;
    err.hidden = true;
    var t = totals();
    var pay = root.querySelector('input[name=pos_pay]:checked');
    var given = Number($('[data-pos-given]').value) || 0;
    if (pay && pay.value === 'cash' && given && given < t.total) { err.textContent = 'কাস্টমার মোট টাকার চেয়ে কম দিয়েছেন।'; err.hidden = false; return; }
    btn.disabled = true; btn.textContent = 'সেভ হচ্ছে…';
    var memoWin = window.open('about:blank', '_blank');
    fetch('/admin/api/pos/sale', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ items: lines.map(function (l) { return { id: l.id, qty: l.qty, price: l.price }; }), discount: t.disc, wh: wh(),
        phone: $('[data-pos-phone]').value.trim(), name: $('[data-pos-name]').value.trim(), payment: pay ? pay.value : 'cash', given: given, note: $('[data-pos-note]').value.trim() }) })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (x) {
        if (!x.ok) throw new Error(x.j.error || 'সেভ হয়নি');
        if (memoWin) memoWin.location.href = '/admin/pos/memo/' + x.j.id + '?print=1'; else window.open('/admin/pos/memo/' + x.j.id + '?print=1', '_blank');
        say('✅ বিক্রি সেভ হয়েছে — মেমো ' + x.j.code + (x.j.change > 0 ? ' · ফেরত দিন ' + money(x.j.change) : ''));
        lines = []; ['[data-pos-disc]', '[data-pos-given]', '[data-pos-phone]', '[data-pos-name]', '[data-pos-note]'].forEach(function (s) { $(s).value = s === '[data-pos-disc]' ? '0' : ''; });
        render(); q.focus();
      })
      .catch(function (e) { if (memoWin) memoWin.close(); err.textContent = e.message; err.hidden = false; btn.disabled = false; render(); });
  });
  render();
})();
