// সবমিলবে admin — menus, image uploads, product pickers, order forms
(function () {
  'use strict';
  var BN = '০১২৩৪৫৬৭৮৯';
  function bn(n) { return String(n).replace(/\d/g, function (d) { return BN[d]; }); }
  function money(n) {
    var v = Math.round(Number(n || 0) * 100) / 100, a = Math.abs(v);
    var t = Math.abs(a - Math.round(a)) < 0.005 ? Math.round(a).toLocaleString('en-IN') : a.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return (v < 0 ? '-' : '') + '৳' + bn(t);
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function $(s, r) { return (r || document).querySelector(s); }
  function $all(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function toast(text) {
    var t = $('[data-toast]');
    if (!t) { alert(text); return; }
    t.textContent = text; t.classList.add('show');
    clearTimeout(toast.t); toast.t = setTimeout(function () { t.classList.remove('show'); }, 3500);
  }
  function getJSON(url) {
    return fetch(url, { headers: { Accept: 'application/json' }, credentials: 'same-origin' }).then(function (r) {
      return r.json().then(function (j) { if (!r.ok && !j.rows) throw new Error(j.error || j.message || 'সমস্যা হয়েছে'); return j; });
    });
  }


  // ---------- 🔄 রিফ্রেশ: lists and reports get a button that loads this page's newest data ----------
  // (a new order or a change from another device shows at once — no need to reload the whole browser)
  var REFRESH_PAGES = /^\/admin(\/orders(\/incomplete)?|\/customers|\/products|\/inventory|\/purchases|\/suppliers|\/reports(\/[a-z-]+)?|\/marketing\/visitors(\/[a-z-]+)?|\/research|\/reach|\/growth|\/accounts(\/[a-z]+)?|\/reviews|\/blocklist)?\/?$/;
  if (REFRESH_PAGES.test(location.pathname)) (function () {
    var main = $('#main'); if (!main) return;
    var head = $('.title-row', main) || $('h1', main);
    if (!head) return;
    var btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'btn btn-ghost btn-sm refresh-btn';
    btn.title = 'এই পেজের সব তথ্য নতুন করে আনুন';
    btn.innerHTML = '<span class="refresh-ic" aria-hidden="true">🔄</span> রিফ্রেশ';
    btn.addEventListener('click', function () {
      btn.disabled = true; btn.classList.add('spinning');
      try { sessionStorage.setItem('sm_refresh_y', String(window.scrollY || 0)); } catch (_) {}
      location.reload();
    });
    if (head.tagName === 'H1') { var row = document.createElement('div'); row.className = 'title-row'; head.parentNode.insertBefore(row, head); row.appendChild(head); head = row; }
    var actions = head.querySelector('.title-actions, .btn-row, .actions');
    var place = document.createElement('div'); place.className = 'refresh-wrap'; place.appendChild(btn);
    var h1 = head.querySelector('h1');
    if (h1 && h1.nextSibling) head.insertBefore(place, h1.nextSibling); else head.appendChild(place);
    // after a refresh, come back to the same spot on the page
    try { var y = sessionStorage.getItem('sm_refresh_y'); if (y) { sessionStorage.removeItem('sm_refresh_y'); window.scrollTo(0, Number(y) || 0); } } catch (_) {}
    // a page shown again from the browser's memory (back button, phone woke up) may be old — load it fresh
    window.addEventListener('pageshow', function (e) { if (e.persisted) location.reload(); });
    var hiddenAt = 0;
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) { hiddenAt = Date.now(); return; }
      var busy = document.activeElement && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
      if (hiddenAt && Date.now() - hiddenAt > 120000 && !busy && !document.querySelector('[data-dirty], [data-changed]')) location.reload();
    });
  })();


  // ---------- DNS record form: show only the boxes the chosen type needs ----------
  var dnsForm = $('[data-dns-form]');
  if (dnsForm) (function () {
    var sel = $('[data-dns-type]', dnsForm), help = $('[data-dns-help]', dnsForm), texts = {};
    try { texts = JSON.parse(dnsForm.getAttribute('data-help') || '{}'); } catch (_) {}
    var paint = function () {
      var t = sel.value;
      $all('[data-dns-show]', dnsForm).forEach(function (el) {
        var on = el.getAttribute('data-dns-show').split(' ').indexOf(t) !== -1;
        el.hidden = !on;
        $all('input, textarea, select', el).forEach(function (i) { i.disabled = !on; });
      });
      if (help) help.textContent = texts[t] || '';
      var c = dnsForm.elements.content;
      if (c) c.placeholder = t === 'A' ? '76.76.21.21' : t === 'AAAA' ? '2001:db8::1' : t === 'CNAME' ? 'cname.vercel-dns.com' : t === 'MX' ? 'mail.example.com' : t === 'TXT' ? 'google-site-verification=…' : t === 'NS' ? 'ns1.example.com' : t === 'CAA' ? '0 issue "letsencrypt.org"' : '';
      if (t === 'SRV' && dnsForm.elements.name && dnsForm.elements.name.value === '@') dnsForm.elements.name.value = '_sip._tcp';
    };
    sel.addEventListener('change', paint);
    paint();
  })();

  // ---------- অটো কল: sample messages fill the message box ----------
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-ac-preset]');
    if (!b) return;
    var t = $('[data-ac-msg]');
    if (t) { t.value = b.getAttribute('data-ac-preset'); if (t.form) markChanged(t.form); t.focus(); }
  });

  // ---------- product warranty: "নিজে লিখুন" shows a text box ----------
  document.addEventListener('change', function (e) {
    var sel = e.target.closest && e.target.closest('[data-warranty-sel]');
    if (!sel) return;
    var box = $('[data-warranty-custom]', sel.closest('[data-warranty]'));
    if (box) { box.hidden = sel.value !== 'custom'; if (!box.hidden) { var i = $('input', box); if (i) i.focus(); } }
  });

  // ---------- running slider: live preview on its admin page ----------
  $all('[data-sl-preview]').forEach(function (box) {
    var track = $('.sl-track', box), n = track ? track.children.length : 0, k = 0;
    if (n < 2) return;
    var ms = (Number(box.getAttribute('data-interval')) || 4) * 1000;
    setInterval(function () {
      k = (k + 1) % n;
      if (box.classList.contains('fx-fade')) $all('img', track).forEach(function (im, j) { im.style.opacity = j === k ? '1' : '0'; });
      else track.style.transform = 'translateX(-' + (k * 100) + '%)';
    }, ms);
  });

  // ---------- ইনভয়েস ও চেকলিস্ট: the sample beside the form follows every change at once ----------
  var docForm = $('[data-doc-form]');
  if (docForm) (function () {
    var frame = $('[data-doc-preview]'), t = null, n = 0;
    var fit = function () { try { var d = frame.contentDocument; if (d && d.body) frame.style.height = Math.max(400, d.documentElement.scrollHeight + 10) + 'px'; } catch (_) {} };
    frame.addEventListener('load', fit);
    var redraw = function () {
      var my = ++n;
      var body = new URLSearchParams(new FormData(docForm)); body.delete('reset');
      fetch(location.pathname + '/preview', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() })
        .then(function (r) { return r.ok ? r.text() : null; }).then(function (h) { if (h && my === n) frame.srcdoc = h; }).catch(function () {});
    };
    docForm.addEventListener('input', function () { clearTimeout(t); t = setTimeout(redraw, 450); });
    docForm.addEventListener('change', function () { clearTimeout(t); t = setTimeout(redraw, 150); });
  })();


  // ---------- 📦 কুরিয়ারে হ্যান্ডওভার: scan → check → hand over ----------
  var ho = $('[data-handover]');
  if (ho) (function () {
    var input = $('[data-ho-input]', ho), msg = $('[data-ho-msg]', ho), box = $('[data-ho-order]', ho);
    var verifyEl = $('[data-ho-verify]', ho), autoEl = $('[data-ho-auto]', ho);
    var current = null, counts = {};
    try { verifyEl.checked = localStorage.getItem('sm_ho_verify') === '1'; autoEl.checked = localStorage.getItem('sm_ho_auto') === '1'; } catch (_) {}
    verifyEl.addEventListener('change', function () { try { localStorage.setItem('sm_ho_verify', verifyEl.checked ? '1' : '0'); } catch (_) {} if (current) draw(); });
    autoEl.addEventListener('change', function () { try { localStorage.setItem('sm_ho_auto', autoEl.checked ? '1' : '0'); } catch (_) {} });
    var beep = function (ok) { if (window.SMScan) window.SMScan.beep(ok); };
    var say = function (t, kind) { msg.textContent = t || ''; msg.className = 'ho-msg ' + (kind || ''); };
    var post = function (url, data) {
      return fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(data) })
        .then(function (r) { return r.json().then(function (j) { j.status = r.status; return j; }); });
    };
    var allPacked = function () { return current && current.items.every(function (it) { return (counts[it.product_id] || 0) >= it.qty; }); };
    function draw() {
      if (!current) { box.innerHTML = ''; return; }
      var o = current, verify = verifyEl.checked;
      var done = allPacked();
      box.innerHTML = '<div class="ho-card ' + (o.ready ? '' : 'not-ready') + '">' +
        '<div class="ho-head"><div><b class="ho-code">' + esc(o.code) + '</b> <span class="pill">' + esc(o.status_text) + '</span><br><b>' + esc(o.customer) + '</b> · ' + esc(o.phone) +
        '<br><span class="small muted">' + esc(o.address) + (o.area ? ', ' + esc(o.area) : '') + '</span></div>' +
        '<div class="ho-due"><span>নিতে হবে</span><b>' + money(o.due) + '</b>' + (o.courier ? '<small>' + esc(o.courier) + (o.consignment ? ' · ' + esc(o.consignment) : '') + '</small>' : '') + '</div></div>' +
        '<ul class="ho-items">' + o.items.map(function (it) {
          var c = counts[it.product_id] || 0, ok = c >= it.qty, over = c > it.qty;
          return '<li class="' + (verify ? (over ? 'over' : ok ? 'ok' : '') : '') + '">' + (it.image ? '<img src="' + esc(it.image) + '" alt="">' : '<span class="ho-pe">📦</span>') +
            '<span class="ho-n"><b>' + esc(it.name) + '</b><small>' + (it.barcode ? esc(it.barcode) : 'বারকোড নেই') + (it.sku ? ' · SKU ' + esc(it.sku) : '') + '</small></span>' +
            '<span class="ho-q">' + (verify ? bn(c) + ' / ' : '× ') + bn(it.qty) + (verify ? (over ? ' ⚠️' : ok ? ' ✅' : '') : '') + '</span></li>';
        }).join('') + '</ul>' +
        (verify && !done ? '<p class="ho-hint">👉 বক্সের প্রতিটা পণ্যের বারকোড স্ক্যান করুন</p>' : '') +
        '<div class="ho-actions">' + (o.status === 'shipped' ? '<p class="ho-msg ok">✅ এটা আগেই কুরিয়ারে দেওয়া হয়েছে।</p>' :
          '<button type="button" class="btn btn-lg ' + (verify && !done ? 'btn-ghost' : '') + '" data-ho-hand>' + (verify && !done ? 'যাচাই ছাড়াই হ্যান্ডওভার' : '✅ কুরিয়ারে হ্যান্ডওভার') + '</button>') +
        '<a class="btn btn-ghost" href="/admin/orders/' + o.id + '" target="_blank">অর্ডার খুলুন</a><button type="button" class="link-btn" data-ho-clear>পরেরটা স্ক্যান করুন</button></div></div>';
    }
    function hand(force) {
      if (!current) return;
      post('/admin/api/handover', { code: current.code, force: !!force, verified: verifyEl.checked && allPacked() }).then(function (j) {
        if (j.ok) { beep(true); say(j.message, 'ok'); addToday(current); current = null; counts = {}; draw(); input.value = ''; input.focus(); return; }
        if (j.pending && confirm(j.error)) return hand(true);
        beep(false); say(j.error || 'হলো না', 'bad');
      }).catch(function () { beep(false); say('সংযোগে সমস্যা — আবার চেষ্টা করুন', 'bad'); });
    }
    function addToday(o) {
      var t = $('[data-ho-today]'); if (!t) return;
      var tb = $('tbody', t);
      if (!tb) { t.innerHTML = '<table class="table compact"><thead><tr><th>সময়</th><th>অর্ডার</th><th>কাস্টমার</th><th class="num">নিতে হবে</th><th>কে দিল</th><th></th></tr></thead><tbody></tbody></table>'; tb = $('tbody', t); }
      var tr = document.createElement('tr');
      tr.innerHTML = '<td class="small">এইমাত্র</td><td><a href="/admin/orders/' + o.id + '"><b>' + esc(o.code) + '</b></a></td><td>' + esc(o.customer) + '</td><td class="num">' + money(o.due) + '</td><td class="small">আপনি</td><td><button type="button" class="link-btn small" data-ho-undo="' + esc(o.code) + '">↩️ ভুল হয়েছে</button></td>';
      tb.insertBefore(tr, tb.firstChild);
    }
    function scan(code) {
      code = String(code || '').trim();
      if (!code) return;
      // a product barcode while an order is open → packing check
      if (current) {
        var up = code.toUpperCase();
        var line = current.items.filter(function (it) { return it.barcode && it.barcode.toUpperCase() === up; })[0];
        if (line) {
          counts[line.product_id] = (counts[line.product_id] || 0) + 1;
          var over = counts[line.product_id] > line.qty;
          beep(!over); say(over ? '⚠️ "' + line.name + '" বেশি হয়ে গেছে (' + bn(counts[line.product_id]) + ' / ' + bn(line.qty) + ')' : '✔ ' + line.name, over ? 'bad' : 'ok');
          if (!verifyEl.checked) { verifyEl.checked = true; }
          draw();
          if (allPacked()) { say('✅ সব পণ্য মিলেছে — এখন হ্যান্ডওভার চাপুন', 'ok'); if (autoEl.checked) hand(false); }
          return;
        }
        if (up === current.code.toUpperCase()) { if (!verifyEl.checked || allPacked()) hand(false); return; }
      }
      say('খোঁজা হচ্ছে…', '');
      getJSON('/admin/api/handover?code=' + encodeURIComponent(code)).then(function (j) {
        if (!j.ok && j.product && current) { beep(false); say('❌ "' + j.product.name + '" এই অর্ডারে নেই! বক্স থেকে সরান।', 'bad'); return; }
        if (!j.ok) { beep(false); say(j.error, 'bad'); return; }
        current = j.order; counts = {};
        beep(true); draw();
        if (current.status === 'shipped') { say('এটা আগেই কুরিয়ারে দেওয়া হয়েছে।', 'bad'); return; }
        if (!current.ready) { say('⚠️ এই অর্ডারের অবস্থা "' + current.status_text + '"', 'bad'); return; }
        if (autoEl.checked && !verifyEl.checked) hand(false);
        else say(verifyEl.checked ? 'এখন বক্সের প্রতিটা পণ্যের বারকোড স্ক্যান করুন' : 'ঠিক থাকলে "কুরিয়ারে হ্যান্ডওভার" চাপুন', '');
      }, function (e) { beep(false); say(current ? '❌ "' + code + '" — এই অর্ডারের কোনো পণ্যের সাথে মেলেনি' : (e.message || 'পাওয়া যায়নি'), 'bad'); });
    }
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); var v = input.value; input.value = ''; scan(v); } });
    $('[data-ho-go]', ho).addEventListener('click', function () { var v = input.value; input.value = ''; scan(v); input.focus(); });
    ho.addEventListener('click', function (e) {
      if (e.target.closest('[data-ho-hand]')) {
        if (verifyEl.checked && !allPacked() && !confirm('সব পণ্যের বারকোড এখনো মেলেনি। তবুও হ্যান্ডওভার করবেন?')) return;
        hand(false);
      }
      if (e.target.closest('[data-ho-clear]')) { current = null; counts = {}; draw(); say(''); input.focus(); }
    });
    document.addEventListener('click', function (e) {
      var u = e.target.closest && e.target.closest('[data-ho-undo]');
      if (!u || !confirm(u.getAttribute('data-ho-undo') + ' — হ্যান্ডওভার বাতিল করে আবার "প্যাকিং চলছে" করবেন?')) return;
      post('/admin/api/handover/undo', { code: u.getAttribute('data-ho-undo') }).then(function (j) { say(j.message || j.error, j.ok ? 'ok' : 'bad'); if (j.ok) { var tr = u.closest('tr'); if (tr) tr.remove(); } });
    });
    // camera
    var camBox = $('[data-ho-cambox]', ho), stopCam = null;
    $('[data-ho-cam]', ho).addEventListener('click', function () {
      if (!window.SMScan) { say('স্ক্যানার লোড হয়নি — পেজ রিলোড দিন', 'bad'); return; }
      camBox.hidden = false;
      stopCam = window.SMScan.start($('video', camBox), function (code) { scan(code); }, function (err) { say(err, 'bad'); camBox.hidden = true; });
    });
    $('[data-ho-camoff]', ho).addEventListener('click', function () { if (stopCam) stopCam(); stopCam = null; camBox.hidden = true; input.focus(); });
    // the barcode gun types fast and presses Enter: keep the box ready
    document.addEventListener('keydown', function (e) { if (document.activeElement === document.body && /^[\w-]$/.test(e.key)) input.focus(); });
  })();

  // ---------- 📷 scan a product barcode into a search box (inventory, products) ----------
  $all('[data-scan-into]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var target = $(btn.getAttribute('data-scan-into'));
      var load = window.SMScan ? Promise.resolve() : new Promise(function (ok, no) { var sc = document.createElement('script'); sc.src = '/js/scan.js'; sc.onload = ok; sc.onerror = no; document.head.appendChild(sc); });
      load.then(function () {
        var m = document.createElement('div'); m.className = 'cam-modal';
        m.innerHTML = '<div class="cam-card"><h3>📷 বারকোড স্ক্যান করুন</h3><div class="cam-view ho-cam-wide"><video playsinline muted></video><div class="ho-aim"></div></div><p class="small muted">বারকোড লাল দাগ বরাবর ধরুন</p><button type="button" class="btn btn-ghost">বাতিল</button></div>';
        document.body.appendChild(m);
        var stop = window.SMScan.start($('video', m), function (code) { window.SMScan.beep(true); stop(); m.remove(); if (target) { target.value = code; if (target.form) target.form.submit(); } }, function (err) { alert(err); stop(); m.remove(); });
        $('button', m).addEventListener('click', function () { stop(); m.remove(); });
      });
    });
  });

  // ---------- side menu (phones) ----------
  document.addEventListener('click', function (e) {
    if (e.target.closest('[data-side-open]')) document.body.classList.add('side-open');
    else if (e.target.closest('[data-side-close]')) document.body.classList.remove('side-open');
  });

  // ---------- side menu groups: remember which ones are open ----------
  (function () {
    var KEY = 'sm_side_open';
    var groups = $all('[data-side-group]');
    if (!groups.length) return;
    var saved = [];
    try { saved = JSON.parse(localStorage.getItem(KEY) || '[]') || []; } catch (e) { saved = []; }
    groups.forEach(function (g) { if (saved.indexOf(g.getAttribute('data-side-group')) > -1) g.open = true; });
    groups.forEach(function (g) {
      g.addEventListener('toggle', function () {
        var open = groups.filter(function (x) { return x.open; }).map(function (x) { return x.getAttribute('data-side-group'); });
        try { localStorage.setItem(KEY, JSON.stringify(open)); } catch (e) { /* ignore */ }
      });
    });
    var on = $('.side a.on');
    if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest' });
  })();

  // ---------- 💾 every change waits for a clear "সেভ করুন" press ----------
  // Switches and boxes no longer save on their own: the form's save button lights up, and a bar at the
  // bottom of the screen reminds that something is changed but not saved yet. Nothing is lost by mistake.
  function isSaveBtn(b) {
    if (!b || b.disabled && !b.hasAttribute('data-auto-save-btn')) return false;
    if (b.type === 'button' || b.type === 'reset' || b.name === 'delete' || b.classList.contains('danger') || b.classList.contains('btn-danger')) return false;
    return /সেভ|save|আপডেট|সংরক্ষণ/i.test(b.textContent || b.value || '');
  }
  function saveBtnOf(f) {
    var own = f.querySelector('[data-auto-save-btn]'); if (own) return own;
    var list = $all('button, input[type="submit"]', f).filter(isSaveBtn);
    if (!list.length && f.id) list = $all('button[form="' + f.id + '"], input[type="submit"][form="' + f.id + '"]').filter(isSaveBtn);
    return list[0] || null;
  }
  // forms whose switches used to save by themselves get their own save button
  $all('[data-autosubmit]').forEach(function (el) {
    var f = el.form || el.closest('form');
    if (!f || f.getAttribute('method') === 'get' || f.querySelector('[data-auto-save-btn]')) return;
    var b = document.createElement('button');
    b.type = 'submit'; b.className = 'btn btn-sm auto-save-btn'; b.setAttribute('data-auto-save-btn', '');
    b.textContent = '💾 সেভ করুন'; b.disabled = true;
    var wrap = document.createElement('div'); wrap.className = 'auto-save-row'; wrap.appendChild(b);
    var note = document.createElement('span'); note.className = 'muted small auto-save-note'; note.textContent = 'বদল করার পর এই বাটন চাপলে তবেই সেভ হবে';
    wrap.appendChild(note);
    f.appendChild(wrap);
  });
  var saveBar = document.createElement('div');
  saveBar.className = 'save-bar'; saveBar.setAttribute('role', 'status');
  saveBar.innerHTML = '<span>⚠️ আপনি কিছু বদলেছেন — এখনো <b>সেভ হয়নি</b></span><button type="button" class="btn btn-sm" data-save-bar-go>💾 সেভ করুন</button>';
  document.body.appendChild(saveBar);
  var changedForm = null;
  function markChanged(f) {
    var b = saveBtnOf(f);
    if (!b) return;
    f.setAttribute('data-changed', '1');
    if (b.hasAttribute('data-auto-save-btn')) { b.disabled = false; f.setAttribute('data-dirty', '1'); }
    b.classList.add('needs-save');
    changedForm = f;
    saveBar.classList.add('show');
  }
  function watchChange(e) {
    var t = e.target;
    if (!e.isTrusted || !t || !t.closest || !t.closest('#main')) return;
    if (t.closest('[data-prod-toggle], [data-check-row], [data-check-all], [data-no-dirty]') || t.type === 'search' || t.type === 'file') return;
    var f = t.form || t.closest('form');
    if (!f || (f.getAttribute('method') || 'get').toLowerCase() !== 'post' || f.hasAttribute('data-no-dirty') || f.hasAttribute('data-ui-text')) return;
    markChanged(f);
  }
  document.addEventListener('change', watchChange);
  document.addEventListener('input', function (e) { if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName) && e.target.type !== 'checkbox' && e.target.type !== 'radio') watchChange(e); });
  saveBar.querySelector('[data-save-bar-go]').addEventListener('click', function () {
    var f = changedForm && document.body.contains(changedForm) ? changedForm : $('form[data-changed="1"]');
    if (!f) { saveBar.classList.remove('show'); return; }
    var b = saveBtnOf(f);
    if (f.requestSubmit) f.requestSubmit(b && b.form === f ? b : undefined); else if (b) b.click(); else f.submit();
  });

  // ---------- "select all" box for row checkboxes ----------
  document.addEventListener('change', function (e) {
    var all = e.target.closest && e.target.closest('[data-check-all]');
    if (!all) return;
    $all('[data-check-row]', all.form || document).forEach(function (c) { c.checked = all.checked; });
  });

  // ---------- product list: show / hide switch (saves right away, no page reload) ----------
  document.addEventListener('change', function (e) {
    var t = e.target.closest && e.target.closest('[data-prod-toggle]');
    if (!t) return;
    var f = t.form, txt = $('[data-prod-toggle-text]', f), row = f.closest('tr');
    var on = t.checked;
    t.disabled = true;
    var body = new URLSearchParams(); if (on) body.set('active', '1');
    fetch(f.action, { method: 'POST', credentials: 'same-origin', headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || 'সেভ হয়নি'); return j; }); })
      .then(function () {
        if (txt) txt.textContent = on ? 'চালু' : 'বন্ধ';
        if (row) row.classList.toggle('row-off', !on);
        toast(on ? (f.getAttribute('data-on') || 'পণ্যটি দোকানে আবার দেখাচ্ছে') : (f.getAttribute('data-off') || 'পণ্যটি দোকান থেকে লুকানো হয়েছে'));
        var li = f.closest('.ui-row'); if (li) li.classList.toggle('row-off', !on);
      }, function (err) { t.checked = !on; toast(err.message); })
      .then(function () { t.disabled = false; });
  });

  // ---------- shop texts (দোকানে কী দেখাবে): save without leaving the page ----------
  $all('[data-ui-text]').forEach(function (f) {
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var btn = $('button', f); btn.disabled = true;
      fetch(f.action, { method: 'POST', credentials: 'same-origin', headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(new FormData(f)).toString() })
        .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || 'সেভ হয়নি'); return j; }); })
        .then(function () { toast('✅ লেখা সেভ হয়েছে'); }, function (err) { toast(err.message); })
        .then(function () { btn.disabled = false; });
    });
  });

  // ---------- table rows that open a details page ----------
  document.addEventListener('click', function (e) {
    var row = e.target.closest && e.target.closest('tr[data-href]');
    if (!row || e.target.closest('a, button, input, select, label')) return;
    location.href = row.getAttribute('data-href');
  });
  // ---------- pages that refresh themselves (live visitors) ----------
  // A part marked data-live-refresh is fetched again every few seconds and swapped in place (no page flash).
  var liveBox = $('[data-live-refresh]');
  if (liveBox) {
    var busy = false;
    setInterval(function () {
      if (busy || document.visibilityState !== 'visible') return;
      busy = true;
      fetch(location.href, { credentials: 'same-origin', headers: { 'X-Live': '1' } }).then(function (r) { return r.ok ? r.text() : ''; }).then(function (t) {
        if (!t) return;
        var doc = new DOMParser().parseFromString(t, 'text/html');
        ['[data-live-refresh]', '.va-tabs'].forEach(function (sel) {
          var fresh = doc.querySelector(sel);
          var cur = document.querySelector(sel);
          if (fresh && cur && fresh.innerHTML !== cur.innerHTML) cur.innerHTML = fresh.innerHTML;
        });
      }).catch(function () {}).then(function () { busy = false; });
    }, (Number(liveBox.getAttribute('data-live-refresh')) || 5) * 1000);
  }
  var auto = $('[data-autoreload]');
  if (auto) {
    setInterval(function () {
      if (document.visibilityState === 'visible') location.reload();
    }, (Number(auto.getAttribute('data-autoreload')) || 30) * 1000);
  }

  // ---------- inventory: + / − buttons beside the stock change box ----------
  function markStep(inp) {
    var v = Number(inp.value) || 0;
    inp.classList.toggle('changed-up', v > 0);
    inp.classList.toggle('changed-down', v < 0);
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-step]');
    if (!b) return;
    var inp = $('[data-step-input]', b.closest('.stepper'));
    if (!inp) return;
    var v = (Number(inp.value) || 0) + Number(b.getAttribute('data-step'));
    inp.value = v === 0 ? '' : v;
    markStep(inp);
    if (inp.form) markChanged(inp.form);
  });
  document.addEventListener('input', function (e) {
    if (e.target.matches && e.target.matches('[data-step-input]')) markStep(e.target);
  });

  // ---------- confirmations ----------
  $all('form[data-confirm]').forEach(function (f) {
    f.addEventListener('submit', function (e) { if (!confirm(f.getAttribute('data-confirm'))) e.preventDefault(); });
  });
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-confirm-btn]');
    if (b && !confirm(b.getAttribute('data-confirm-btn'))) e.preventDefault();
  });
  // click-to-copy for codes
  document.addEventListener('click', function (e) {
    var c = e.target.closest('code.copy');
    if (!c || !navigator.clipboard) return;
    navigator.clipboard.writeText(c.textContent.trim()).then(function () { toast('কপি হয়েছে'); });
  });

  // ---------- picture fingerprint (finds the same photo even if resized, re-saved, bordered or mirrored) ----------
  // Always made from the small 420px copy, so new uploads and old pictures are measured the same way.
  function fingerprint(img) {
    try {
      var W = img.naturalWidth || img.width, H = img.naturalHeight || img.height;
      if (!W || !H) return null;
      // 1) find the real picture inside plain (white/single colour) borders, pixel-exact
      var sc = Math.min(1, 480 / Math.max(W, H));
      var w0 = Math.max(1, Math.round(W * sc)), h0 = Math.max(1, Math.round(H * sc));
      var c = document.createElement('canvas'); c.width = w0; c.height = h0;
      var x = c.getContext('2d', { willReadFrequently: true });
      x.fillStyle = '#fff'; x.fillRect(0, 0, w0, h0); x.drawImage(img, 0, 0, w0, h0);
      var d = x.getImageData(0, 0, w0, h0).data;
      var bg = [0, 0, 0];
      [0, w0 - 1, w0 * (h0 - 1), w0 * h0 - 1].forEach(function (k) { bg[0] += d[k * 4] / 4; bg[1] += d[k * 4 + 1] / 4; bg[2] += d[k * 4 + 2] / 4; });
      var minX = w0, minY = h0, maxX = -1, maxY = -1;
      for (var yy = 0; yy < h0; yy++) {
        for (var xx = 0; xx < w0; xx++) {
          var k = (yy * w0 + xx) * 4;
          if (Math.abs(d[k] - bg[0]) + Math.abs(d[k + 1] - bg[1]) + Math.abs(d[k + 2] - bg[2]) > 60) {
            if (xx < minX) minX = xx; if (xx > maxX) maxX = xx; if (yy < minY) minY = yy; if (yy > maxY) maxY = yy;
          }
        }
      }
      if (maxX < 0 || maxX - minX < 4 || maxY - minY < 4) return { h: '', m: '' }; // plain picture: nothing to compare
      var sx = minX / sc, sy = minY / sc, sw = (maxX + 1 - minX) / sc, sh = (maxY + 1 - minY) / sc;
      // 2) shrink to 32 x 32 grey squares (each the average of 4 x 4 pixels)
      var c2 = document.createElement('canvas'); c2.width = 128; c2.height = 128;
      var x2 = c2.getContext('2d', { willReadFrequently: true });
      x2.imageSmoothingQuality = 'high';
      x2.fillStyle = '#fff'; x2.fillRect(0, 0, 128, 128); x2.drawImage(img, sx, sy, sw, sh, 0, 0, 128, 128);
      var p = x2.getImageData(0, 0, 128, 128).data;
      var N = 32, K = 16, G = [], lo = 1e9, hi = -1e9;
      for (var r = 0; r < N; r++) {
        for (var cc = 0; cc < N; cc++) {
          var sum = 0;
          for (var by = 0; by < 4; by++) for (var bx = 0; bx < 4; bx++) {
            var q = ((r * 4 + by) * 128 + cc * 4 + bx) * 4;
            sum += p[q] * 0.299 + p[q + 1] * 0.587 + p[q + 2] * 0.114;
          }
          var v = sum / 16; G.push(v); if (v < lo) lo = v; if (v > hi) hi = v;
        }
      }
      if (hi - lo < 10) return { h: '', m: '' };
      // 3) the picture's 16 x 16 coarsest patterns (DCT, like JPEG uses).
      //    Each of the 256 bits: is this pattern stronger than the middle value?
      var cos = [];
      for (var kk = 0; kk < K; kk++) { cos.push([]); for (var n = 0; n < N; n++) cos[kk].push(Math.cos(((2 * n + 1) * kk * Math.PI) / (2 * N))); }
      var rowT = [];
      for (var r1 = 0; r1 < N; r1++) for (var u = 0; u < K; u++) {
        var t = 0; for (var n1 = 0; n1 < N; n1++) t += G[r1 * N + n1] * cos[u][n1];
        rowT[r1 * K + u] = t;
      }
      var D = [];
      for (var vv = 0; vv < K; vv++) for (var u2 = 0; u2 < K; u2++) {
        var t2 = 0; for (var r2 = 0; r2 < N; r2++) t2 += rowT[r2 * K + u2] * cos[vv][r2];
        D.push(t2);
      }
      var M = D.map(function (val, i) { return (i % K) % 2 ? -val : val; }); // mirror image: odd left-right patterns flip sign
      var bitsOf = function (arr) {
        var rest = arr.slice(1).sort(function (a2, b2) { return a2 - b2; });
        var med = rest[Math.floor(rest.length / 2)];
        var o = '';
        for (var i = 0; i < arr.length; i++) o += i === 0 ? '0' : arr[i] > med ? '1' : '0';
        return o;
      };
      var hex = function (bb) { var o = ''; for (var i = 0; i < bb.length; i += 4) o += parseInt(bb.slice(i, i + 4), 2).toString(16); return o; };
      return { h: hex(bitsOf(D)), m: hex(bitsOf(M)) };
    } catch (e) { return null; }
  }
  function loadImage(src) {
    return new Promise(function (resolve, reject) {
      var im = new Image();
      im.onload = function () { resolve(im); };
      im.onerror = function () { reject(new Error('bad image')); };
      // pictures on ImageKit are fetched through this site, so the browser may read their pixels (fingerprint, watermark)
      im.src = /^\/media\//.test(src) ? src + (src.indexOf('?') < 0 ? '?' : '&') + 'raw=1' : src;
    });
  }

  // ---------- image resizing & upload ----------
  function resize(file, max, quality, square) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onerror = reject;
      reader.onload = function () {
        var img = new Image();
        img.onerror = function () { reject(new Error('bad image')); };
        img.onload = function () {
          // square: the middle of the picture, cut to a square (profile pictures)
          var side = Math.min(img.width, img.height);
          var sx = square ? Math.round((img.width - side) / 2) : 0;
          var sy = square ? Math.round((img.height - side) / 2) : 0;
          var sw = square ? side : img.width;
          var sh = square ? side : img.height;
          var scale = Math.min(1, max / Math.max(sw, sh));
          var w = Math.round(sw * scale);
          var h = Math.round(sh * scale);
          var canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          var ctx = canvas.getContext('2d');
          var png = !square && (file.type === 'image/png' || file.type === 'image/webp');
          if (!png) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); }
          ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
          resolve({ data: png ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', quality), width: w, height: h, png: png });
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }
  function upload(file, opts) {
    opts = opts || {};
    var max = opts.max || 1200;
    return resize(file, max, 0.82, opts.square).then(function (full) {
      // Big PNGs (photos saved as PNG) become JPEG to stay small.
      if (full.png && full.data.length > 900000) return resize(new File([file], 'x.jpg', { type: 'image/jpeg' }), max, 0.82, opts.square);
      return full;
    }).then(function (full) {
      return resize(file, opts.thumb || 420, 0.78, opts.square).then(function (th) {
        return loadImage(th.data).then(fingerprint, function () { return null; }).then(function (fp) {
          return fetch('/admin/api/media', {
            method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ data: full.data, thumb: th.data, width: full.width, height: full.height,
              phash: fp ? fp.h : undefined, phash_m: fp ? fp.m : undefined, import: opts.import ? 1 : undefined, private: opts.private ? 1 : undefined }),
          }).then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || 'আপলোড হয়নি'); return j; }); });
        });
      });
    });
  }

  function show(el, on) { if (el) el.hidden = !on; }
  // 📸 take a photo with the device camera: live picture → "ছবি তুলুন" → look → "এই ছবি নিন" / "আবার তুলুন".
  // Resolves with a JPEG File (or null if closed).
  function cameraShot(title) {
    return new Promise(function (resolve, reject) {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return reject(new Error('এই ব্রাউজারে ক্যামেরা চালানো যায় না — "ছবি দিন" দিয়ে ছবি বেছে নিন।'));
      var m = document.createElement('div');
      m.className = 'cam-modal';
      m.innerHTML = '<div class="cam-card" role="dialog" aria-modal="true"><h3></h3><div class="cam-view"><video playsinline muted autoplay></video><img alt="" hidden></div>' +
        '<p class="small muted" data-cam-say>⏳ ক্যামেরা চালু হচ্ছে…</p>' +
        '<div class="cam-btns" data-cam-live><button type="button" class="btn" data-cam-snap disabled>📸 ছবি তুলুন</button><button type="button" class="btn btn-ghost" data-cam-close>বাতিল</button></div>' +
        '<div class="cam-btns" data-cam-done hidden><button type="button" class="btn" data-cam-use>✅ এই ছবি নিন</button><button type="button" class="btn btn-ghost" data-cam-retake>🔁 আবার তুলুন</button></div></div>';
      $('h3', m).textContent = title || '📸 ক্যামেরায় ছবি তুলুন';
      document.body.appendChild(m);
      var video = $('video', m), img = $('img', m), sayEl = $('[data-cam-say]', m), stream = null, blob = null;
      var stop = function () { if (stream) stream.getTracks().forEach(function (t) { t.stop(); }); stream = null; };
      var close = function (f) { stop(); m.remove(); resolve(f || null); };
      var start = function () {
        blob = null; show(img, false); show(video, true); show($('[data-cam-done]', m), false); show($('[data-cam-live]', m), true);
        sayEl.textContent = '⏳ ক্যামেরা চালু হচ্ছে…';
        navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 720 }, height: { ideal: 720 } }, audio: false }).then(function (s) {
          stream = s; video.srcObject = s; return video.play().catch(function () {});
        }).then(function () {
          $('[data-cam-snap]', m).disabled = false;
          sayEl.textContent = 'মুখ মাঝখানে রেখে "📸 ছবি তুলুন" চাপুন';
        }, function (e) {
          var n = e && e.name;
          sayEl.textContent = n === 'NotAllowedError' ? '❌ ক্যামেরার অনুমতি দেওয়া হয়নি। ঠিকানার পাশের 🔒 চিহ্নে চাপ দিয়ে Camera "Allow" করুন।' : n === 'NotFoundError' ? '❌ কোনো ক্যামেরা পাওয়া যায়নি।' : '❌ ক্যামেরা চালু করা যায়নি।';
        });
      };
      $('[data-cam-snap]', m).addEventListener('click', function () {
        if (!stream || !video.videoWidth) return;
        var side = Math.min(video.videoWidth, video.videoHeight), c = document.createElement('canvas');
        c.width = c.height = Math.min(side, 720);
        var g = c.getContext('2d');
        g.translate(c.width, 0); g.scale(-1, 1); // same as the mirror view the person saw
        g.drawImage(video, (video.videoWidth - side) / 2, (video.videoHeight - side) / 2, side, side, 0, 0, c.width, c.height);
        c.toBlob(function (b) {
          blob = b; img.src = URL.createObjectURL(b);
          stop(); show(video, false); show(img, true);
          show($('[data-cam-live]', m), false); show($('[data-cam-done]', m), true);
          sayEl.textContent = 'ছবিটা ঠিক আছে?';
        }, 'image/jpeg', 0.9);
      });
      $('[data-cam-retake]', m).addEventListener('click', start);
      $('[data-cam-use]', m).addEventListener('click', function () { close(new File([blob], 'camera.jpg', { type: 'image/jpeg' })); });
      $('[data-cam-close]', m).addEventListener('click', function () { close(null); });
      m.addEventListener('click', function (e) { if (e.target === m) close(null); });
      start();
    });
  }
  // profile picture (owner and staff): pick or take a photo, then "সেভ করুন"; "মুছুন" removes it
  $all('[data-avatar-pick]').forEach(function (box) {
    var file = $('[data-avatar-file]', box);
    var del = $('[data-avatar-remove]', box);
    var msg = $('[data-avatar-msg]', box);
    var action = box.getAttribute('data-action');
    var save = function (id) {
      return fetch(action, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ photo_id: id }) })
        .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || 'সেভ হয়নি'); return j; }); });
    };
    var busy = function (on, text) { box.classList.toggle('busy', on); if (msg) { msg.textContent = text || ''; msg.className = 'small muted'; } };
    var fail = function (e) { box.classList.remove('busy'); if (msg) { msg.textContent = e.message; msg.className = 'small warn'; } };
    // a chosen or camera picture is only shown first; "💾 সেভ করুন" saves it, "বাতিল" puts the old one back
    var confirmRow = $('[data-avatar-confirm]', box), pending = null;
    var avatarImg = function () { return box.querySelector('.avatar.avatar-xl'); };
    var oldHTML = null;
    var preview = function (f) {
      pending = f;
      var el = avatarImg();
      if (el) {
        if (oldHTML === null) oldHTML = el.outerHTML;
        var url = URL.createObjectURL(f);
        var sp = document.createElement('span'); sp.className = 'avatar has-photo avatar-xl avatar-preview';
        var img = document.createElement('img'); img.src = url; img.alt = ''; sp.appendChild(img);
        el.parentNode.replaceChild(sp, el);
      }
      show(confirmRow, true);
      if (msg) { msg.textContent = '👀 নতুন ছবি দেখাচ্ছে — রাখতে "💾 সেভ করুন" চাপুন'; msg.className = 'small warn'; }
    };
    var cancel = function () {
      pending = null; show(confirmRow, false);
      var el = box.querySelector('.avatar-preview');
      if (el && oldHTML !== null) { var t = document.createElement('div'); t.innerHTML = oldHTML; el.parentNode.replaceChild(t.firstChild, el); oldHTML = null; }
      if (msg) { msg.textContent = 'বাতিল করা হয়েছে — আগের ছবিই আছে।'; msg.className = 'small muted'; }
    };
    if (file) file.addEventListener('change', function () {
      if (file.files[0]) preview(file.files[0]);
      file.value = '';
    });
    var camBtn = $('[data-avatar-camera]', box);
    if (camBtn) camBtn.addEventListener('click', function () { cameraShot().then(function (f) { if (f) preview(f); }, function (e) { fail(e); }); });
    var saveBtn = $('[data-avatar-save]', box);
    if (saveBtn) saveBtn.addEventListener('click', function () {
      if (!pending) return;
      saveBtn.disabled = true;
      busy(true, 'ছবি আপলোড হচ্ছে…');
      upload(pending, { max: 600, thumb: 160, square: true, private: true })
        .then(function (j) { return save(j.id); })
        .then(function () { busy(true, '✅ ছবি সেভ হয়েছে'); location.reload(); }, function (e) { saveBtn.disabled = false; fail(e); });
    });
    var cancelBtn = $('[data-avatar-cancel]', box);
    if (cancelBtn) cancelBtn.addEventListener('click', cancel);
    if (del) del.addEventListener('click', function () {
      if (!confirm('প্রোফাইল ছবি মুছে ফেলবেন?')) return;
      busy(true, 'মুছছে…');
      save('').then(function () { location.reload(); }, fail);
    });
  });

  // single image pickers
  // After a picture is added or removed: say so clearly, and point at the form's save button.
  function pickStatus(box, what) {
    var st = $('[data-pick-status]', box);
    if (st) {
      st.className = 'pick-status ' + (what === 'added' ? 'is-added' : 'is-removed');
      st.textContent = what === 'added' ? '✅ ছবি যোগ হয়েছে — সাইটে দেখাতে নিচের "সেভ করুন" চাপুন' : '🗑️ ছবি সরানো হবে — নিশ্চিত করতে "সেভ করুন" চাপুন';
    }
    var form = box.closest('form');
    if (!form) return;
    var save = $('.form-actions button, button[type="submit"], .btn-lg', form);
    if (save) { save.classList.add('needs-save'); if (!save.getAttribute('data-orig')) { save.setAttribute('data-orig', save.textContent); } save.textContent = '💾 সেভ করুন (পরিবর্তন সেভ হয়নি)'; }
    form.setAttribute('data-dirty', '1');
  }
  window.addEventListener('beforeunload', function (e) {
    if (document.querySelector('form[data-dirty="1"]:not([data-submitting])')) { e.preventDefault(); e.returnValue = ''; }
  });
  document.addEventListener('submit', function (e) { if (e.target && e.target.setAttribute) e.target.setAttribute('data-submitting', '1'); }, true);

  // owner-only secrets (e.g. the backup password): hidden until "দেখুন" is pressed
  $all('[data-reveal-btn]').forEach(function (b) {
    b.addEventListener('click', function () {
      var c = b.parentNode.querySelector('[data-reveal]'); if (!c) return;
      var shown = c.getAttribute('data-shown') === '1';
      c.textContent = shown ? '••••••••••••••••' : c.getAttribute('data-reveal');
      c.setAttribute('data-shown', shown ? '0' : '1'); b.textContent = shown ? '👁️ দেখুন' : '🙈 লুকান';
    });
  });

  $all('[data-image-pick]').forEach(function (box) {
    var file = $('[data-pick-file]', box);
    var value = $('[data-pick-value]', box);
    var preview = $('[data-pick-preview]', box);
    var clear = $('[data-pick-clear]', box);
    var form = box.closest('form');
    file.addEventListener('change', function () {
      if (!file.files[0]) return;
      var btns = form ? $all('button', form) : [];
      btns.forEach(function (b) { b.disabled = true; });
      preview.innerHTML = '<span class="muted small">আপলোড হচ্ছে…</span>';
      upload(file.files[0], { max: file.hasAttribute('data-wide') ? 1800 : 1000 }).then(function (j) {
        value.value = j.id;
        preview.innerHTML = '<img src="' + j.thumb + '" alt="">';
        if (clear) clear.hidden = false;
        pickStatus(box, 'added');
      }).catch(function (e) {
        preview.innerHTML = '<span class="warn small">' + esc(e.message) + '</span>';
      }).then(function () { btns.forEach(function (b) { b.disabled = false; }); file.value = ''; });
    });
    if (clear) clear.addEventListener('click', function () { value.value = ''; preview.innerHTML = '<span class="muted small">ছবি নেই</span>'; clear.hidden = true; pickStatus(box, 'removed'); });
  });

  // product images: fixed numbered slots (slot 1 = main image)
  var slotsBox = $('[data-slots]');
  if (slotsBox) {
    var slotsValue = $('[data-slots-value]');
    var slots = $all('[data-slot]', slotsBox);
    var saveBtn = $('[data-save]');
    var busy = 0;
    var label = function (i) { return i === 0 ? 'মূল ছবি' : 'ছবি ' + bn(i + 1); };
    var paint = function (slot, id, src) {
      var i = Number(slot.getAttribute('data-slot'));
      var add = $('.slot-add', slot);
      var file = $('[data-slot-file]', slot);
      slot.setAttribute('data-img', id || '');
      slot.classList.toggle('filled', !!id);
      slot.classList.remove('busy');
      // keep the file input, replace what is shown
      $all('img, .slot-plus, .slot-hint, .slot-wait', add).forEach(function (n) { n.remove(); });
      if (id) {
        var img = document.createElement('img');
        img.src = src || ('/media/' + id + '/t'); img.alt = label(i);
        add.insertBefore(img, file);
      } else {
        add.insertAdjacentHTML('afterbegin', '<span class="slot-plus" aria-hidden="true">＋</span><span class="slot-hint">ছবি যোগ করুন</span>');
      }
      $('.g-tools', slot).hidden = !id;
    };
    var lastImgs = null;
    var sync = function () {
      slotsValue.value = slots.map(function (sl) { return sl.getAttribute('data-img'); }).filter(Boolean).join(',');
      if (saveBtn) saveBtn.disabled = busy > 0;
      if (busy === 0 && lastImgs !== null && lastImgs !== slotsValue.value) document.dispatchEvent(new Event('sm:images'));
      if (busy === 0) lastImgs = slotsValue.value;
    };
    var putFile = function (slot, f) {
      if (!f) return;
      if (!/^image\//.test(f.type)) { toast('শুধু ছবি (JPG, PNG, WEBP) দিন।'); return; }
      var add = $('.slot-add', slot);
      $all('img, .slot-plus, .slot-hint, .slot-wait', add).forEach(function (n) { n.remove(); });
      add.insertAdjacentHTML('afterbegin', '<span class="slot-wait">আপলোড হচ্ছে…</span>');
      slot.classList.add('busy');
      busy++; sync();
      var prev = slot.getAttribute('data-img');
      upload(f, { max: 1200 }).then(function (j) { paint(slot, j.id, j.thumb); })
        .catch(function (e) { paint(slot, prev); toast(e.message); })
        .then(function () { busy--; sync(); });
    };
    slots.forEach(function (slot) {
      var file = $('[data-slot-file]', slot);
      file.addEventListener('change', function () {
        var files = Array.prototype.slice.call(file.files || []);
        file.value = '';
        if (!files.length) return;
        putFile(slot, files[0]);
        // several photos picked at once: fill the next empty slots too
        var start = slots.indexOf(slot);
        files.slice(1).forEach(function (f) {
          var next = slots.filter(function (s2, k) { return k > start && !s2.getAttribute('data-img') && !s2.classList.contains('busy'); })[0];
          if (next) putFile(next, f);
        });
      });
    });
    slotsBox.addEventListener('click', function (e) {
      var slot = e.target.closest('[data-slot]');
      if (!slot || slot.classList.contains('busy')) return;
      if (e.target.closest('[data-slot-del]')) { paint(slot, ''); sync(); return; }
      if (e.target.closest('[data-slot-change]')) { $('[data-slot-file]', slot).click(); return; }
      var mv = e.target.closest('[data-slot-move]');
      if (mv) {
        var i = slots.indexOf(slot);
        var j = i + Number(mv.getAttribute('data-slot-move'));
        if (j < 0 || j >= slots.length || slots[j].classList.contains('busy')) return;
        var a = slot.getAttribute('data-img');
        var bId = slots[j].getAttribute('data-img');
        var aSrc = a ? $('img', slot).src : '';
        var bSrc = bId ? $('img', slots[j]).src : '';
        paint(slot, bId, bSrc); paint(slots[j], a, aSrc);
        sync();
      }
    });
    sync();
  }

  // ---------- duplicate product check (live, while the form is filled) ----------
  (function () {
  var dupBox = $('[data-dup-box]');
  if (dupBox && pformEl()) {
    var form = pformEl();
    var out = $('[data-dup-result]', dupBox);
    var allowRow = $('[data-dup-allow]', dupBox);
    var noperm = $('[data-dup-noperm]', dupBox);
    var allowInput = allowRow ? $('input[name="allow_duplicate"]', allowRow) : null;
    var field = function (n) { var el = form.elements[n]; return el ? el.value : ''; };
    var seq = 0, timer = null, lastKey = '';
    var check = function () {
      var data = {
        id: dupBox.getAttribute('data-dup-id') || '', name: field('name').trim(), description: field('description'),
        images: (field('images') || '').split(',').filter(Boolean), product_type: field('product_type'), youtube_url: field('youtube_url'),
      };
      if (!data.name && !data.images.length) return;
      var key = JSON.stringify([data.name, data.images, data.description.length, data.youtube_url]);
      if (key === lastKey) return;
      lastKey = key;
      var my = ++seq;
      dupBox.classList.add('checking');
      out.innerHTML = '<p class="muted small">🔍 যাচাই হচ্ছে — দোকানে একই পণ্য আছে কি না দেখা হচ্ছে…</p>';
      fetch('/admin/api/products/dup-check', {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
      }).then(function (r) { return r.json(); }).then(function (j) {
        if (my !== seq) return;
        dupBox.classList.remove('checking', 'is-block', 'is-warn');
        if (j.error) { out.innerHTML = '<p class="warn small">' + esc(j.error) + '</p>'; return; }
        var waiting = j.imagesWaiting ? '<p class="small muted">' + bn(j.imagesWaiting) + 'টি ছবির ছাপ এখনো তৈরি হয়নি, তাই শুধু হুবহু একই ফাইল ধরা যাবে।</p>' : '';
        if (!j.matches || !j.matches.length) {
          out.innerHTML = '<p class="good small">✅ একই রকম কোনো পণ্য পাওয়া যায়নি' + (data.images.length ? ' (নাম আর ' + bn(data.images.length) + 'টি ছবি মিলিয়ে দেখা হয়েছে)' : ' (নাম মিলিয়ে দেখা হয়েছে — ছবি দিলে ছবিও মেলানো হবে)') + '।</p>' + waiting;
        } else if (j.blocked) {
          dupBox.classList.add('is-block');
          out.innerHTML = '<p class="dup-head">⛔ এই পণ্যটি দোকানে আগে থেকেই আছে বলে মনে হচ্ছে। এভাবে সেভ দিলে আটকে যাবে:</p>' + j.html + waiting;
        } else {
          dupBox.classList.add('is-warn');
          out.innerHTML = '<p class="dup-head">⚠️ কাছাকাছি কিছু পণ্য আছে। একবার দেখে নিন (সেভ আটকাবে না):</p>' + j.html + waiting;
        }
        if (allowRow) allowRow.hidden = !(j.blocked || (allowInput && allowInput.checked));
        if (noperm) noperm.hidden = !j.blocked;
        var cancel = $('[data-dup-cancel]', dupBox); if (cancel) cancel.hidden = !j.blocked;
      }).catch(function () {
        if (my !== seq) return;
        dupBox.classList.remove('checking');
        lastKey = '';
        out.innerHTML = '<p class="muted small">এখন যাচাই করা গেল না (ইন্টারনেট?) — সেভ দেওয়ার সময় আবার যাচাই হবে।</p>';
      });
    };
    var later = function (ms) { clearTimeout(timer); timer = setTimeout(check, ms); };
    if (form.elements.name) {
      form.elements.name.addEventListener('input', function () { later(900); });
      form.elements.name.addEventListener('blur', function () { later(50); });
    }
    if (form.elements.description) form.elements.description.addEventListener('change', function () { later(50); });
    if (form.elements.youtube_url) form.elements.youtube_url.addEventListener('change', function () { later(50); });
    document.addEventListener('sm:images', function () { later(200); });
    // "বন্ধ করুন / চালু করুন" and "মুছুন" beside a product found as a duplicate
    dupBox.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('[data-dup-act]');
      if (!b) return;
      var box = b.closest('[data-dup-acts]'), id = box.getAttribute('data-id'), name = box.getAttribute('data-name');
      var item = box.closest('.dup-item');
      var act = b.getAttribute('data-dup-act');
      var body = new URLSearchParams();
      var url = '/admin/products/' + id + (act === 'delete' ? '/delete' : '/active');
      if (act === 'delete') {
        if (!confirm('"' + name + '" পণ্যটি মুছবেন? দোকান থেকে সরে যাবে, রিসাইকেল বিনে থাকবে। শুধু লুকাতে চাইলে "বন্ধ করুন" চাপুন।')) return;
        body.set('back', '/admin/products');
      } else if (!b.getAttribute('data-on')) body.set('active', '1');
      $all('button', box).forEach(function (x) { x.disabled = true; });
      fetch(url, { method: 'POST', credentials: 'same-origin', headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() })
        .then(function (r) { if (!r.ok) throw new Error('সেভ হয়নি, আবার চেষ্টা করুন'); })
        .then(function () {
          if (act === 'delete') {
            if (id === dupBox.getAttribute('data-dup-id')) { location.href = '/admin/products?msg=deleted'; return; }
            item.classList.add('dup-gone');
            box.innerHTML = '<span class="small">🗑️ মুছে ফেলা হয়েছে (রিসাইকেল বিনে)</span>';
            toast('পণ্যটি মুছে ফেলা হয়েছে');
            lastKey = ''; later(300); // check again: the block may be gone now
            return;
          }
          var on = !b.getAttribute('data-on');
          b.setAttribute('data-on', on ? '1' : '');
          b.textContent = on ? '🚫 বন্ধ করুন' : '✅ চালু করুন';
          item.classList.toggle('dup-off', !on);
          toast(on ? (f.getAttribute('data-on') || 'পণ্যটি দোকানে আবার দেখাচ্ছে') : (f.getAttribute('data-off') || 'পণ্যটি দোকান থেকে লুকানো হয়েছে'));
        var li = f.closest('.ui-row'); if (li) li.classList.toggle('row-off', !on);
        })
        .catch(function (err) { toast(err.message); })
        .then(function () { $all('button', box).forEach(function (x) { x.disabled = false; }); });
    });

    // editing an existing product: check once when the page opens (unless the page already shows a result)
    if (!$('.dup-list', dupBox) && dupBox.getAttribute('data-dup-id')) later(400);
  }
  })();
  function pformEl() { return $('[data-product-form]'); }

  // ---------- fingerprints for older product pictures (runs quietly on product pages) ----------
  if (/^\/admin\/products/.test(location.pathname)) (function () {
    var fpStatus = $('[data-fp-status]');
    var made = 0, rounds = 0;
    var round = function () {
      if (rounds++ > 40) return;
      getJSON('/admin/api/media/fingerprints').then(function (j) {
        var ids = j.ids || [];
        if (!ids.length) {
          if (fpStatus && made) { fpStatus.hidden = false; fpStatus.innerHTML = '✅ পুরোনো ' + bn(made) + 'টি ছবির ছাপ তৈরি হয়েছে। <a href="">পেজটা আবার লোড করুন</a> — ছবি দিয়েও ডুপ্লিকেট খোঁজা হবে।'; }
          return;
        }
        if (fpStatus) { fpStatus.hidden = false; fpStatus.textContent = '⏳ পুরোনো ছবির ছাপ তৈরি হচ্ছে… (' + bn(made) + 'টি হয়েছে) — এই পেজটা খোলা রাখুন।'; }
        return Promise.all(ids.map(function (id) {
          return loadImage('/media/' + id + '/t').then(function (im) {
            var fp = fingerprint(im);
            return { id: id, phash: fp ? fp.h : '', phash_m: fp ? fp.m : '' };
          }, function () { return { id: id, phash: '', phash_m: '' }; });
        })).then(function (items) {
          made += items.length;
          return fetch('/admin/api/media/fingerprints', {
            method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: items }),
          });
        }).then(function () { setTimeout(round, 300); });
      }).catch(function () { /* try again next time a product page opens */ });
    };
    setTimeout(round, 1500);
  })();

  // ---------- product form helpers ----------
  var pform = $('[data-product-form]');
  if (pform) {
    var price = $('[data-price]', pform);
    var cost = $('[data-cost]', pform);
    var marginBox = $('[data-margin]', pform);
    var calc = function () {
      if (!marginBox) return;
      var p = Number(price.value) || 0;
      var c = Number(cost && cost.value) || 0;
      if (!p || !c) { marginBox.textContent = ''; return; }
      var m = p - c;
      marginBox.innerHTML = 'প্রতি পিসে লাভ: <b class="' + (m < 0 ? 'warn' : 'good') + '">' + money(m) + '</b> (' + bn(((m / p) * 100).toFixed(1)) + '%)';
    };
    if (price) price.addEventListener('input', calc);
    // cheap parts: show how many a customer must buy at this price (Admin → সেটিংস → কম দামের পণ্যের নিয়ম)
    var ruleBox = $('[data-small-rule]', pform);
    if (ruleBox && price) {
      var R = {}; try { R = JSON.parse(ruleBox.getAttribute('data-small-rule')); } catch (e) { R = {}; }
      var showRule = function () {
        var p = Number(price.value) || 0;
        if (!R.on || p <= 0 || p > R.cap + 1e-9) { ruleBox.hidden = true; return; }
        var min = Math.max(1, Math.ceil(R.minVal / p - 1e-9));
        var max = Math.max(R.maxQty, min, Math.floor(R.maxVal / p + 1e-9));
        ruleBox.hidden = false;
        ruleBox.innerHTML = '🔩 কম দামের পণ্য: দোকানে দাম দেখাবে <b>' + money(p) + ' / পিস</b>, কিন্তু কাস্টমারকে কমপক্ষে <b>' + bn(min) + 'টি</b> (' + money(min * p) + ') নিতে হবে। সর্বোচ্চ ' + bn(max) + 'টি। <a href="/admin/settings#small-items">নিয়ম বদলান</a>';
      };
      price.addEventListener('input', showRule);
      showRule();
    }
    if (cost) cost.addEventListener('input', calc);
    calc();
    var yt = $('[data-yt]', pform);
    if (yt) {
      yt.addEventListener('input', function () {
        var m = /youtu\.?be|youtube/i.test(yt.value) ? yt.value.match(/(?:[?&;]v=|youtu\.be\/|\/(?:embed|shorts|live|v|e)\/)([A-Za-z0-9_-]{11})(?![A-Za-z0-9_-])/i) : null;
        $('[data-yt-preview]').innerHTML = m ? '<img src="https://i.ytimg.com/vi/' + m[1] + '/hqdefault.jpg" alt="">' : '';
      });
    }
  }

  // ---------- product search picker (order items, bundle parts, purchases) ----------
  function picker(input, results, onPick, opts) {
    if (!input) return;
    var timer;
    var run = function () {
      var q = input.value.trim();
      var url = '/admin/api/products/search?q=' + encodeURIComponent(q) + (opts && opts.all ? '&all=1' : '') + (opts && opts.type ? '&type=' + opts.type : '');
      getJSON(url).then(function (j) {
        results.innerHTML = j.products.length ? j.products.map(function (p, i) {
          return '<li><button type="button" data-i="' + i + '">' + (p.image ? '<img src="' + esc(p.image) + '" alt="">' : '<span class="pe">' + esc(p.emoji || '📦') + '</span>') +
            '<span><b>' + esc(p.name) + '</b><small>' + (p.sku ? esc(p.sku) + ' · ' : '') + money(p.price) + ' · স্টক ' + bn(p.stock) + '</small></span></button></li>';
        }).join('') : '<li class="muted small">কিছু পাওয়া যায়নি</li>';
        results.hidden = false;
        results.onclick = function (e) {
          var b = e.target.closest('[data-i]');
          if (!b) return;
          onPick(j.products[Number(b.getAttribute('data-i'))]);
          results.hidden = true; input.value = ''; input.focus();
        };
      }).catch(function (e) { results.innerHTML = '<li class="warn small">' + esc(e.message) + '</li>'; results.hidden = false; });
    };
    input.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(run, 250); });
    input.addEventListener('focus', run);
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); var f = $('[data-i]', results); if (f) f.click(); } });
    document.addEventListener('click', function (e) { if (!e.target.closest('.item-picker')) results.hidden = true; });
  }

  // order create/edit
  var oform = $('[data-order-form]');
  if (oform) {
    var rows = $('[data-item-rows]', oform);
    var none = $('[data-no-items]', oform);
    var deliveryIn = $('[data-delivery]', oform);
    var discountIn = $('[data-discount]', oform);
    var city = JSON.parse(oform.getAttribute('data-city') || '[]');
    var totalO = function () {
      var sub = 0;
      $all('[data-row]', rows).forEach(function (r) {
        var p = Number($('[data-price]', r).value) || 0;
        var q = Number($('[data-qty]', r).value) || 0;
        $('[data-line-total]', r).textContent = money(p * q);
        sub += p * q;
      });
      none.hidden = !!$('[data-row]', rows);
      $('[data-grand]', oform).textContent = money(Math.max(0, Math.round(sub - (Number(discountIn.value) || 0) + (Number(deliveryIn.value) || 0)))); // whole taka, like the server
    };
    picker($('[data-product-search]', oform), $('[data-product-results]', oform), function (p) {
      var exist = $all('input[name="item_id[]"]', rows).filter(function (i) {
        var k = $('input[name="item_kind[]"]', i.closest('tr'));
        return i.value === String(p.id) && !(k && k.value === 'gift');
      })[0];
      if (exist) { var q = $('[data-qty]', exist.closest('tr')); q.value = Number(q.value) + 1; totalO(); return; }
      var tr = document.createElement('tr');
      tr.setAttribute('data-row', '');
      tr.innerHTML = '<td>' + esc(p.name) + (p.sku ? '<br><span class="small muted">' + esc(p.sku) + '</span>' : '') + '<br><span class="small muted">স্টক ' + bn(p.stock) + '</span><input type="hidden" name="item_id[]" value="' + p.id + '"><input type="hidden" name="item_kind[]" value=""><input type="hidden" name="item_note[]" value=""></td>' +
        '<td class="num"><input type="number" name="item_price[]" value="' + p.price + '" min="0" step="0.01" class="w-num" data-price></td>' +
        '<td class="num"><input type="number" name="item_qty[]" value="1" min="1" class="w-num" data-qty></td>' +
        '<td class="num" data-line-total></td><td><button type="button" class="link-btn danger" data-remove-row aria-label="সরান">✕</button></td>';
      rows.appendChild(tr);
      totalO();
    });
    oform.addEventListener('input', totalO);
    oform.addEventListener('click', function (e) { var b = e.target.closest('[data-remove-row]'); if (b) { b.closest('tr').remove(); totalO(); } });
    var geoInit = function () {
      var g = fillGeo(oform);
      if (!g) return;
      var setFee = function () {
        if (!g.district.value) return;
        var inCity = g.district.value === 'Dhaka' && city.indexOf(g.thana.value) > -1;
        var zones = []; try { zones = JSON.parse(oform.getAttribute('data-zones') || '[]'); } catch (e) { /* none */ }
        var zone = inCity ? null : zones.filter(function (z) { return (z.districts || []).indexOf(g.district.value) > -1; })[0];
        deliveryIn.value = inCity ? oform.getAttribute('data-dhaka') : zone ? zone.fee : oform.getAttribute('data-outside');
        totalO();
      };
      g.district.addEventListener('change', setFee);
      g.thana.addEventListener('change', setFee);
    };
    if (window.BD_GEO) geoInit(); else window.addEventListener('load', geoInit);
    totalO();
  }

  // bundle parts
  var bundle = $('[data-bundle]');
  if (bundle) {
    var brows = $('[data-bundle-rows]', bundle);
    var bsum = function () {
      var sum = 0, rows = $all('[data-row]', brows);
      rows.forEach(function (r) {
        var line = (Number(r.getAttribute('data-price')) || 0) * (Number($('[data-qty]', r).value) || 0);
        sum += line;
        var lc = $('[data-line]', r); if (lc) lc.textContent = money(line);
      });
      var empty = $('[data-bundle-empty]', bundle); if (empty) empty.hidden = rows.length > 0;
      var priceIn = $('[data-price]');
      var p = Number(priceIn && priceIn.value) || 0;
      $('[data-bundle-sum]', bundle).innerHTML = sum ? 'আলাদা কিনলে মোট দাম: <b>' + money(sum) + '</b>' + (p ? (p < sum ? ' · প্যাকেজে কাস্টমারের সাশ্রয়: <b class="good">' + money(sum - p) + '</b>' : ' · <span class="warn">প্যাকেজের দাম আলাদা দামের চেয়ে বেশি!</span>') : '') : '';
    };
    var changed = function () { var f = bundle.closest('form'); if (f) markChanged(f); };
    picker($('[data-bundle-search]', bundle), $('[data-bundle-results]', bundle), function (p) {
      if (p.type === 'bundle') { toast('বান্ডেলের ভেতরে আরেকটা বান্ডেল রাখা যায় না।'); return; }
      var have = $all('input[name="bundle_id[]"]', brows).filter(function (i) { return i.value === String(p.id); })[0];
      if (have) { var q = $('[data-qty]', have.closest('tr')); q.value = (Number(q.value) || 0) + 1; bsum(); changed(); toast('আগে থেকেই আছে — পরিমাণ ১ বাড়ানো হলো'); return; }
      var tr = document.createElement('tr');
      tr.setAttribute('data-row', ''); tr.setAttribute('data-price', p.price);
      tr.innerHTML = '<td class="b-img">' + (p.image ? '<img src="' + esc(p.image) + '" alt="">' : '<span class="pe">' + esc(p.emoji || '📦') + '</span>') + '</td>' +
        '<td class="b-name"><b>' + esc(p.name) + '</b>' + (p.sku ? '<br><span class="small muted">SKU ' + esc(p.sku) + '</span>' : '') + '<input type="hidden" name="bundle_id[]" value="' + p.id + '"></td>' +
        '<td class="num">' + money(p.price) + '</td>' +
        '<td class="num"><span class="qty-step"><button type="button" class="qs-btn" data-bq="-1" aria-label="কমান">−</button><input type="number" name="bundle_qty[]" value="1" min="1" class="w-num" data-qty><button type="button" class="qs-btn" data-bq="1" aria-label="বাড়ান">+</button></span></td>' +
        '<td class="num" data-line></td><td class="num">' + bn(p.stock) + '</td>' +
        (bundle.hasAttribute('data-kit') ? '<td><label class="check"><input type="checkbox" name="kit_opt[]" value="' + p.id + '"> ঐচ্ছিক</label></td>' : '') +
        '<td class="b-act"><a class="btn btn-sm btn-ghost" href="/admin/products/' + p.id + '" target="_blank" rel="noopener">✏️ এডিট</a><button type="button" class="btn btn-sm btn-danger" data-remove-row>🗑️ মুছুন</button></td>';
      // 🧰 a kit: each part may carry a short note
      if (bundle.hasAttribute('data-kit')) $('.b-name', tr).insertAdjacentHTML('beforeend', '<input name="kit_note[]" value="" maxlength="120" placeholder="ছোট নোট (ঐচ্ছিক)" class="kit-note">');
      brows.appendChild(tr); bsum(); changed();
    }, { all: true, type: 'single' });
    bundle.addEventListener('input', bsum);
    document.addEventListener('input', function (e) { if (e.target.hasAttribute('data-price')) bsum(); });
    bundle.addEventListener('click', function (e) {
      var st = e.target.closest('[data-bq]');
      if (st) {
        var q = $('[data-qty]', st.closest('td'));
        q.value = Math.max(1, (Number(q.value) || 1) + Number(st.getAttribute('data-bq')));
        bsum(); changed(); return;
      }
      var b = e.target.closest('[data-remove-row]');
      if (b) {
        var name = ($('.b-name b', b.closest('tr')) || {}).textContent || 'পণ্যটি';
        if (!confirm('"' + name + '" বান্ডেল থেকে সরাবেন? (পণ্যটি দোকান থেকে মুছবে না)')) return;
        b.closest('tr').remove(); bsum(); changed();
      }
    });
    bsum();
  }

  // purchase form
  var pur = $('[data-purchase-form]');
  if (pur) {
    var prow = $('[data-item-rows]', pur);
    var pnone = $('[data-no-items]', pur);
    var ptotal = function () {
      var sub = 0;
      $all('[data-row]', prow).forEach(function (r) {
        var line = (Number($('[data-cost]', r).value) || 0) * (Number($('[data-qty]', r).value) || 0);
        $('[data-line-total]', r).textContent = money(line); sub += line;
      });
      var v = function (n) { return Number(pur.elements[n].value) || 0; };
      pnone.hidden = !!$('[data-row]', prow);
      $('[data-grand]', pur).textContent = money(sub - v('discount') + v('shipping') + v('other_cost') + v('vat'));
    };
    var addRow = function (p) {
      if (p.type === 'bundle') { toast('বান্ডেল কেনা যায় না — ভেতরের পণ্যগুলো আলাদা করে যোগ করুন।'); return; }
      if ($all('input[name="item_id[]"]', prow).some(function (i) { return i.value === String(p.id); })) { toast('এই পণ্য আগেই যোগ করা আছে'); return; }
      var tr = document.createElement('tr');
      tr.setAttribute('data-row', '');
      tr.innerHTML = '<td>' + esc(p.name) + (p.sku ? '<br><span class="small muted">SKU ' + esc(p.sku) + '</span>' : '') + '<br><span class="small muted">এখন স্টক ' + bn(p.stock) + ' · বিক্রি দাম ' + money(p.price) + '</span><input type="hidden" name="item_id[]" value="' + p.id + '">' +
        '<div class="pack-box" data-pack-box hidden><b class="small">📦 প্যাকেট হিসেবে কিনেছেন</b><div class="pack-grid">' +
        '<label class="small">কয় প্যাকেট<input type="number" min="1" step="1" value="1" data-pk-n></label>' +
        '<label class="small">প্রতি প্যাকেটে পিস<input type="number" min="1" step="1" placeholder="যেমন ১০০০" data-pk-per></label>' +
        '<label class="small">প্রতি প্যাকেটের দাম ৳<input type="number" min="0" step="0.01" placeholder="যেমন ২০০" data-pk-price></label></div>' +
        '<span class="small muted" data-pk-out>প্যাকেটের তথ্য দিলে পরিমাণ আর প্রতি পিসের দাম নিজে থেকে বসবে</span></div></td>' +
        '<td class="num"><input type="number" name="item_qty[]" value="1" min="1" class="w-num" data-qty required></td>' +
        '<td class="num"><input type="number" name="item_cost[]" value="' + (p.cost || '') + '" min="0" step="0.01" class="w-num" data-cost required><br><button type="button" class="link-btn small" data-pack-open>📦 প্যাকেট দামে</button></td>' +
        '<td class="num" data-line-total></td><td><button type="button" class="btn btn-sm btn-danger" data-remove-row>🗑️ মুছুন</button></td>';
      prow.appendChild(tr); ptotal();
    };
    picker($('[data-product-search]', pur), $('[data-product-results]', pur), function (p) { addRow(p); markChanged(pur); }, { all: true });
    try { JSON.parse(pur.getAttribute('data-prefill') || '[]').forEach(addRow); } catch (_) {}
    // pack maths: 2 packets × 1000 pcs at ৳200 each → 2000 pcs at ৳0.20
    pur.addEventListener('click', function (e) {
      var o = e.target.closest('[data-pack-open]');
      if (o) { var bx = $('[data-pack-box]', o.closest('tr')); bx.hidden = !bx.hidden; if (!bx.hidden) $('[data-pk-per]', bx).focus(); }
    });
    pur.addEventListener('input', function (e) {
      if (!e.target.closest('[data-pack-box]')) return;
      var tr = e.target.closest('tr'), n = Number($('[data-pk-n]', tr).value) || 0, per = Number($('[data-pk-per]', tr).value) || 0, price = Number($('[data-pk-price]', tr).value) || 0;
      var out = $('[data-pk-out]', tr);
      if (!n || !per) { out.textContent = 'প্যাকেটের তথ্য দিলে পরিমাণ আর প্রতি পিসের দাম নিজে থেকে বসবে'; return; }
      var unit = Math.round((price / per) * 100) / 100;
      $('[data-qty]', tr).value = n * per;
      if (price) $('[data-cost]', tr).value = unit;
      out.innerHTML = '➡ মোট <b>' + bn(n * per) + ' পিস</b>' + (price ? ', প্রতি পিস <b>' + money(unit) + '</b>' + (Math.abs(unit * per - price) > 0.009 ? ' (পয়সা গোল করা)' : '') : '');
      ptotal();
    });
    pur.addEventListener('input', ptotal);
    pur.addEventListener('click', function (e) { var b = e.target.closest('[data-remove-row]'); if (b && confirm('এই পণ্যটি পারচেজ থেকে সরাবেন?')) { b.closest('tr').remove(); ptotal(); markChanged(pur); } });
    ptotal();
  }

  // ---------- district / thana ----------
  function fillGeo(form) {
    var dSel = $('[data-district]', form);
    var tSel = $('[data-thana]', form);
    if (!dSel || !tSel || !window.BD_GEO) return null;
    var geo = window.BD_GEO.districts;
    var want = dSel.getAttribute('data-value') || '';
    dSel.innerHTML = '<option value="">জেলা বাছুন</option>' + geo.map(function (d) {
      return '<option value="' + esc(d.en) + '"' + (d.en === want ? ' selected' : '') + '>' + esc(d.bn) + ' (' + esc(d.en) + ')</option>';
    }).join('');
    var fillT = function (sel) {
      var d = geo.filter(function (x) { return x.en === dSel.value; })[0];
      tSel.innerHTML = '<option value="">' + (d ? 'থানা বাছুন' : 'আগে জেলা') + '</option>' + (d ? d.areas.map(function (a) {
        return '<option value="' + esc(a[0]) + '"' + (a[0] === sel ? ' selected' : '') + '>' + esc(a[1]) + '</option>';
      }).join('') : '');
    };
    fillT(tSel.getAttribute('data-value') || '');
    dSel.addEventListener('change', function () { fillT(''); });
    return { district: dSel, thana: tSel };
  }

  // ---------- courier send form ----------
  var cf = $('[data-courier-form]');
  if (cf) {
    var pick = $('[data-courier-pick]', cf);
    var loaded = {};
    var show = function () {
      var c = pick.value;
      $all('[data-courier-extra]', cf).forEach(function (x) { x.hidden = x.getAttribute('data-courier-extra') !== c; });
      if (c === 'pathao' && !loaded.pathao) {
        loaded.pathao = true;
        var citySel = $('[data-pathao="cities"]', cf);
        var zoneSel = $('[data-pathao="zones"]', cf);
        getJSON('/admin/api/courier/pathao?kind=cities').then(function (j) {
          citySel.innerHTML = '<option value="">অটো (ঠিকানা থেকে)</option>' + j.rows.map(function (r) { return '<option value="' + r.id + '">' + esc(r.name) + '</option>'; }).join('');
        }).catch(function (e) { toast('Pathao শহরের লিস্ট আনা যায়নি: ' + e.message); });
        citySel.addEventListener('change', function () {
          zoneSel.innerHTML = '<option value="">অটো</option>';
          if (!citySel.value) return;
          getJSON('/admin/api/courier/pathao?kind=zones&parent=' + citySel.value).then(function (j) {
            zoneSel.innerHTML = '<option value="">অটো</option>' + j.rows.map(function (r) { return '<option value="' + r.id + '">' + esc(r.name) + '</option>'; }).join('');
          });
        });
      }
      if (c === 'redx' && !loaded.redx) {
        loaded.redx = true;
        var aSel = $('[data-redx-area]', cf);
        var aName = $('[data-redx-area-name]', cf);
        getJSON('/admin/api/courier/redx?district=' + encodeURIComponent(cf.getAttribute('data-district') || '')).then(function (j) {
          aSel.innerHTML = '<option value="">এরিয়া বাছুন</option>' + j.rows.map(function (r) { return '<option value="' + r.id + '">' + esc(r.name) + '</option>'; }).join('');
        }).catch(function (e) { aSel.innerHTML = '<option value="">লোড হয়নি</option>'; toast(e.message); });
        aSel.addEventListener('change', function () { aName.value = aSel.options[aSel.selectedIndex].text; });
      }
    };
    pick.addEventListener('change', show);
    show();
    cf.addEventListener('submit', function () { var b = $('button', cf); b.disabled = true; b.textContent = 'পাঠানো হচ্ছে…'; });
  }

  // ---------- fraud check ----------
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-fraud-check]');
    if (!b) return;
    var out = b.closest('[data-fraud-out]') || b.parentNode.querySelector('[data-fraud-out]');
    out.textContent = 'চেক করা হচ্ছে…';
    getJSON('/admin/api/fraud?phone=' + encodeURIComponent(b.getAttribute('data-fraud-check')) + (b.hasAttribute('data-fresh') ? '&fresh=1' : '')).then(function (j) {
      if (!j.ok) { out.textContent = j.message || 'তথ্য পাওয়া যায়নি'; return; }
      var rows = [];
      var o = j.own || {};
      rows.push('<li>🏪 এই দোকানে: ডেলিভারি <b>' + bn(o.delivered || 0) + '</b> · বাতিল/ফেরত <b>' + bn(o.failed || 0) + '</b>' + (o.open ? ' · চলমান ' + bn(o.open) : '') + '</li>');
      if (j.fraudbd && j.fraudbd.ok) (j.fraudbd.couriers || []).forEach(function (c) {
        rows.push('<li>🚚 ' + esc(c.name) + ': ' + (c.type === 'rating' ? esc(c.message || c.rating || '—') : 'মোট <b>' + bn(c.total) + '</b> · সফল <b>' + bn(c.success) + '</b> · বাতিল <b>' + bn(c.cancel) + '</b>') + '</li>');
      });
      else if (j.fraudbd && !j.fraudbd.ok) rows.push('<li class="muted">FraudBD: ' + esc(j.fraudbd.message || '') + '</li>');
      if (j.pathao && j.pathao.ok && !(j.fraudbd && j.fraudbd.ok)) rows.push('<li>🚚 Pathao: মোট <b>' + bn(j.pathao.total) + '</b> · সফল <b>' + bn(j.pathao.success) + '</b>' + (j.pathao.rating ? ' · ' + esc(j.pathao.rating) : '') + '</li>');
      else if (j.pathao && !j.pathao.ok) rows.push('<li class="muted">Pathao: ' + esc(j.pathao.message || '') + '</li>');
      if (!j.sources.fraudbd && !j.sources.pathao) rows.push('<li class="muted">অন্য দোকানের রেকর্ড দেখতে <a href="/admin/fraud">ফ্রড চেক সেটিংস</a> এ FraudBD API key দিন।</li>');
      out.innerHTML = '<div class="risk risk-' + esc(j.level) + '"><b>' + esc(j.label) + '</b>' + (j.rate !== null ? ' — সব মিলিয়ে সফল <b>' + bn(j.rate) + '%</b> (' + bn(j.success) + '/' + bn(j.total) + ')' : '') +
        '<span>' + esc(j.advice) + '</span></div><ul class="fraud-list">' + rows.join('') + '</ul>' + (j.cached_at ? '<p class="muted">আগের চেক থেকে (২৪ ঘণ্টার মধ্যে) — <button type="button" class="link-btn small" data-fraud-check="' + esc(j.phone) + '" data-fresh>আবার চেক করুন</button></p>' : '');
    }).catch(function (err) { out.textContent = err.message; });
  });

  // ---------- bulk select on orders ----------
  var bulk = $('[data-bulk]');
  if (bulk) {
    var bar = $('[data-bulk-bar]', bulk);
    var all = $('[data-check-all]', bulk);
    var upd = function () {
      var n = $all('input[name="ids[]"]:checked', bulk).length;
      if (bar) { bar.hidden = n === 0; $('[data-bulk-count]', bar).textContent = bn(n); }
    };
    if (all) all.addEventListener('change', function () { $all('input[name="ids[]"]', bulk).forEach(function (c) { c.checked = all.checked; }); upd(); });
    bulk.addEventListener('change', upd);
    bulk.addEventListener('submit', function (e) {
      var btn = e.submitter;
      if (btn && btn.value === 'courier' && !confirm('বাছাই করা অর্ডারগুলো কুরিয়ারে পাঠাবেন?')) e.preventDefault();
    });
  }

  // ---------- product list: tick many products, then one action for all ----------
  var pb = $('[data-pbulk]');
  if (pb) {
    var pbRows = function () { return $all('[data-pbulk-row]'); };
    var pbUpd = function () {
      var n = pbRows().filter(function (c) { return c.checked; }).length;
      pb.hidden = n === 0;
      $('[data-pbulk-count]', pb).textContent = bn(n);
    };
    var pbAll = $('[data-pbulk-all]');
    if (pbAll) pbAll.addEventListener('change', function () { pbRows().forEach(function (c) { c.checked = pbAll.checked; }); pbUpd(); });
    document.addEventListener('change', function (e) { if (e.target.closest && e.target.closest('[data-pbulk-row]')) pbUpd(); });
    var act = $('[data-pbulk-action]', pb);
    var showFor = function () {
      $all('[data-pbulk-for]', pb).forEach(function (el) {
        var on = el.getAttribute('data-pbulk-for').split(' ').indexOf(act.value) >= 0;
        el.hidden = !on;
        $all('input,select', el).forEach(function (i) { i.disabled = !on; });
      });
    };
    act.addEventListener('change', showFor); showFor();
    var clr = $('[data-pbulk-clear]', pb);
    if (clr) clr.addEventListener('click', function () { pbRows().forEach(function (c) { c.checked = false; }); if (pbAll) pbAll.checked = false; pbUpd(); });
    pb.addEventListener('submit', function (e) {
      var n = pbRows().filter(function (c) { return c.checked; }).length;
      var label = act.options[act.selectedIndex] ? act.options[act.selectedIndex].text : '';
      if (!confirm(bn(n) + 'টি পণ্যে "' + label + '" করবেন?' + (act.value === 'delete' ? ' (রিসাইকেল বিনে থাকবে)' : ''))) e.preventDefault();
    });
  }

  // ---------- repeat rows (links, verification files) ----------
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-repeat-add]');
    if (!b) return;
    var box = $('[data-repeat="' + b.getAttribute('data-repeat-add') + '"]');
    var last = box.lastElementChild;
    var copy = last.cloneNode(true);
    $all('input, textarea', copy).forEach(function (i) { i.value = ''; });
    $all('select', copy).forEach(function (sel) { sel.selectedIndex = 0; });
    box.appendChild(copy);
  });

  // ---------- home sections order ----------
  $all('[data-sortable]').forEach(function (ul) {
    ul.addEventListener('click', function (e) {
      var li = e.target.closest('li');
      if (!li) return;
      if (e.target.closest('[data-up]') && li.previousElementSibling) ul.insertBefore(li, li.previousElementSibling);
      if (e.target.closest('[data-down]') && li.nextElementSibling) ul.insertBefore(li.nextElementSibling, li);
    });
  });

  // ---------- category icon grid ----------
  var lastIcon = null;
  document.addEventListener('focusin', function (e) { if (e.target.hasAttribute && e.target.hasAttribute('data-icon-input')) lastIcon = e.target; });
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-icon]');
    if (!b) return;
    var target = lastIcon || $('[data-icon-input]');
    if (target) { target.value = b.getAttribute('data-icon'); target.focus(); }
  });

  // ---------- staff permission presets ----------
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-preset]');
    if (!b) return;
    var want = b.getAttribute('data-preset').split(',');
    $all('[data-perms] input[type=checkbox]').forEach(function (c) { c.checked = want.indexOf(c.value) > -1; });
  });

  // ---------- SEO preview & counters ----------
  $all('[data-count]').forEach(function (el) {
    var max = Number(el.getAttribute('data-count'));
    var c = document.createElement('small');
    c.className = 'counter';
    el.parentNode.appendChild(c);
    var f = function () {
      c.textContent = bn(el.value.length) + ' / ' + bn(max);
      c.classList.toggle('warn', el.value.length > max);
      if (el.name === 'seo_title') { var t = $('[data-serp-title]'); if (t) t.textContent = el.value || el.placeholder; }
      if (el.name === 'seo_description') { var d = $('[data-serp-desc]'); if (d) d.textContent = el.value || el.placeholder; }
    };
    el.addEventListener('input', f); f();
  });
  // ---------- product import (পণ্য আমদানি) ----------
  var imp = $('[data-import]');
  if (imp) (function () {
    var canOverride = imp.getAttribute('data-can-override') === '1';
    var st = { items: [], running: false, paused: false, stop: false, k: { added: 0, updated: 0, exists: 0, duplicate: 0, error: 0 }, done: 0, total: 0 };
    var readStatus = $('[data-imp-read-status]');
    var step = function (n) { $all('[data-imp-step]', imp).forEach(function (s) { s.hidden = Number(s.getAttribute('data-imp-step')) > n; }); };
    var say = function (text, bad) { readStatus.hidden = !text; readStatus.innerHTML = text || ''; readStatus.classList.toggle('warn', !!bad); };
    var postJSON = function (url, body) {
      return fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) })
        .then(function (r) {
          return r.json().catch(function () { return { error: r.status === 413 ? 'ফাইলটি অনেক বড়।' : 'সার্ভার থেকে উত্তর আসেনি (' + r.status + ')।' } })
            .then(function (j) { if (!r.ok) throw new Error(j.error || 'সমস্যা হয়েছে'); return j; });
        });
    };
    var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

    // tabs
    $all('[data-imp-tab]', imp).forEach(function (t) {
      t.addEventListener('click', function () {
        $all('[data-imp-tab]', imp).forEach(function (x) { x.classList.toggle('on', x === t); });
        $all('[data-imp-pane]', imp).forEach(function (p) { p.hidden = p.getAttribute('data-imp-pane') !== t.getAttribute('data-imp-tab'); });
        say('');
      });
    });

    // ----- step 1: read -----
    var fileInput = $('[data-imp-file]', imp);
    var fileBtn = $('[data-imp-read="file"]', imp);
    var drop = $('[data-imp-drop]', imp);
    var pickedFile = null;
    var setFile = function (f) {
      pickedFile = f || null;
      $('[data-imp-filename]', imp).textContent = f ? '✅ ' + f.name + ' (' + bn(Math.max(1, Math.round(f.size / 1024))) + ' KB)' : '';
      fileBtn.disabled = !f;
    };
    fileInput.addEventListener('change', function () { setFile(fileInput.files[0]); });
    ['dragover', 'dragenter'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('over'); }); });
    ['dragleave', 'drop'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('over'); }); });
    drop.addEventListener('drop', function (e) { if (e.dataTransfer && e.dataTransfer.files[0]) setFile(e.dataTransfer.files[0]); });

    var found = [];
    var notes = [];
    var addResult = function (j) {
      (j.items || []).forEach(function (it) { found.push(it); });
      (j.notes || []).forEach(function (n) { if (notes.indexOf(n) < 0) notes.push(n); });
      if (j.unknownColumns) notes.push('⚠️ ফাইলের কলামের নাম চেনা যায়নি। প্রথম লাইনে title / name / পণ্যের নাম, price / দাম, image_link / ছবি — এমন নাম দিন (নমুনা ফাইল দেখুন)।');
    };
    var busy = function (on) { $all('[data-imp-read]', imp).forEach(function (b) { b.disabled = on || (b === fileBtn && !pickedFile); }); };

    // Visit a list of pages (category pages, sitemaps, product pages) a few at a time.
    var crawl = function (start) {
      var queue = start.slice();
      var seen = {};
      queue.forEach(function (l) { seen[l.url] = 1; });
      var pages = 0, failed = 0;
      st.stop = false;
      var show = function () {
        say('⏳ পেজ পড়া হচ্ছে… ' + bn(pages) + ' / ' + bn(pages + queue.length) + ' — পণ্য পাওয়া গেছে ' + bn(found.length) + 'টি' + (failed ? ' (পড়া যায়নি ' + bn(failed) + 'টি)' : '') + ' <button type="button" class="link-btn" data-imp-crawl-stop>থামান</button>');
      };
      var worker = function () {
        if (st.stop || !queue.length) return Promise.resolve();
        var l = queue.shift();
        return postJSON('/admin/api/import/read', { url: l.url, single: true }).then(function (j) {
          addResult(j);
          (j.links || []).forEach(function (x) { if (!seen[x.url] && pages + queue.length < 6000) { seen[x.url] = 1; queue.push(x); } });
          if (j.next && !seen[j.next]) { seen[j.next] = 1; queue.push({ url: j.next, kind: 'list' }); }
        }, function () { failed++; }).then(function () { pages++; show(); return worker(); });
      };
      show();
      return Promise.all([worker(), worker(), worker()]);
    };
    imp.addEventListener('click', function (e) { if (e.target.closest('[data-imp-crawl-stop]')) st.stop = true; });

    var finishRead = function () {
      busy(false);
      // the same product twice in one source: keep the first
      var seenRef = {}, seenName = {}, clean = [], twice = 0;
      found.forEach(function (it) {
        var nk = (it.title || '').toLowerCase().replace(/\s+/g, ' ').trim() + '|' + (it.price || '');
        if (seenRef[it.ref] || seenName[nk]) { twice++; return; }
        seenRef[it.ref] = 1; seenName[nk] = 1; clean.push(it);
      });
      if (twice) notes.push(bn(twice) + 'টি পণ্য একই তালিকায় দুইবার ছিল — একবারই নেওয়া হবে।');
      // A picture used by many different products is a logo / banner, not a product photo — leave it out
      // (otherwise every product after the first would look like a duplicate).
      var useCount = {};
      clean.forEach(function (it) { it.images.forEach(function (u) { useCount[u] = (useCount[u] || 0) + 1; }); });
      var shared = Object.keys(useCount).filter(function (u) { return useCount[u] >= 3 && useCount[u] >= clean.length * 0.05; });
      if (shared.length) {
        clean.forEach(function (it) { it.images = it.images.filter(function (u) { return shared.indexOf(u) < 0; }); });
        notes.push(bn(shared.length) + 'টি ছবি অনেকগুলো পণ্যে একই ছিল (যেমন লোগো/ব্যানার) — ওগুলো বাদ দিয়ে শুধু পণ্যের নিজের ছবি নেওয়া হবে।');
      }
      st.items = clean;
      if (!clean.length) { say('কোনো পণ্য পাওয়া যায়নি। ' + (notes.length ? notes.join(' ') : 'লিংক/ফাইলটি ঠিক আছে কি না দেখুন, অথবা অন্য পদ্ধতি চেষ্টা করুন।'), true); return; }
      say('');
      preview();
    };
    var startRead = function (kind) {
      found = []; notes = [];
      busy(true);
      var go;
      if (kind === 'file') {
        if (!pickedFile) { busy(false); return; }
        if (pickedFile.size > 3 * 1024 * 1024) { busy(false); say('ফাইলটি ৩ MB-এর বেশি বড়। ফাইলটি দুই ভাগ করে আলাদা আলাদা দিন।', true); return; }
        say('⏳ ফাইল পড়া হচ্ছে…');
        var binary = /\.(xlsx|xls)$/i.test(pickedFile.name) || /spreadsheet|excel/.test(pickedFile.type);
        go = new Promise(function (resolve, reject) {
          var r = new FileReader();
          r.onerror = function () { reject(new Error('ফাইলটি খোলা যায়নি।')); };
          r.onload = function () {
            resolve(binary ? { name: pickedFile.name, base64: String(r.result).split(',')[1] || '' } : { name: pickedFile.name, text: String(r.result) });
          };
          if (binary) r.readAsDataURL(pickedFile); else r.readAsText(pickedFile, 'utf-8');
        }).then(function (file) { return postJSON('/admin/api/import/read', { file: file }); })
          .then(function (j) { addResult(j); if ((j.links || []).length) return crawl(j.links); });
      } else if (kind === 'many') {
        var lines = ($('[data-imp-links]', imp).value || '').split(/\s+/).filter(function (x) { return /^https?:\/\/\S+\.\S+/i.test(x); });
        if (!lines.length) { busy(false); say('অন্তত একটা লিংক দিন (https:// দিয়ে শুরু)।', true); return; }
        go = crawl(lines.slice(0, 3000).map(function (u) { return { url: u, kind: 'page' }; }));
      } else {
        var url = ($('[data-imp-url]', imp).value || '').trim();
        if (!url) { busy(false); say('লিংক দিন।', true); return; }
        say('⏳ লিংক খোলা হচ্ছে… (বড় ফিড হলে ১০-২০ সেকেন্ড লাগতে পারে)');
        go = postJSON('/admin/api/import/read', { url: url }).then(function (j) {
          addResult(j);
          var more = (j.links || []).slice();
          if (j.next) more.push({ url: j.next, kind: 'list' });
          if (more.length) return crawl(more);
        });
      }
      go.then(finishRead, function (err) { busy(false); say('❌ ' + esc(err.message), true); });
    };
    $all('[data-imp-read]', imp).forEach(function (b) { b.addEventListener('click', function () { startRead(b.getAttribute('data-imp-read')); }); });
    $('[data-imp-url]', imp).addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); startRead('link'); } });

    // ----- step 2: preview -----
    var preview = function () {
      var items = st.items;
      var noPrice = 0, noImg = 0, noBrand = 0, had = 0;
      items.forEach(function (it) { if (!(it.price > 0)) noPrice++; if (!it.images.length) noImg++; if (!it.brand) noBrand++; if (it.exists) had++; });
      $('[data-imp-found]', imp).textContent = bn(items.length) + 'টি পণ্য';
      $('[data-imp-notes]', imp).innerHTML = notes.map(function (n) { return '<p class="small muted">ℹ️ ' + esc(n) + '</p>'; }).join('');
      var chip = function (cls, text) { return '<span class="imp-chip ' + cls + '">' + text + '</span>'; };
      $('[data-imp-check]', imp).innerHTML =
        chip('good', '✅ নাম আছে: ' + bn(items.length)) +
        chip(noPrice ? 'bad' : 'good', (noPrice ? '⛔ দাম নেই: ' + bn(noPrice) + ' (এগুলো বাদ যাবে)' : '✅ সবগুলোর দাম আছে')) +
        chip(noImg ? 'warn' : 'good', (noImg ? '⚠️ ছবি নেই: ' + bn(noImg) : '✅ সবগুলোর ছবি আছে')) +
        chip(noBrand ? 'warn' : 'good', (noBrand ? 'ব্র্যান্ড নেই: ' + bn(noBrand) + ' (ঐচ্ছিক)' : '✅ সবগুলোর ব্র্যান্ড আছে')) +
        (had ? chip('', '↩️ আগে আনা হয়েছে: ' + bn(had)) : '');
      var LIMIT = 150;
      $('[data-imp-rows]', imp).innerHTML = items.slice(0, LIMIT).map(function (it) {
        var problems = [];
        if (!(it.price > 0)) problems.push('<span class="bad">দাম নেই — বাদ যাবে</span>');
        if (!it.images.length) problems.push('<span class="warn">ছবি নেই</span>');
        if (it.exists) problems.push('<span class="muted">আগে আনা হয়েছে (SKU ' + esc(it.exists.sku || '—') + ')</span>');
        return '<tr><td class="thumb">' + (it.images[0] ? '<img src="' + esc(it.images[0]) + '" alt="" loading="lazy" referrerpolicy="no-referrer">' : '<span>📦</span>') + '</td>' +
          '<td><b>' + esc(it.title) + '</b>' + (it.link ? '<br><a class="small muted" href="' + esc(it.link) + '" target="_blank" rel="noopener noreferrer">আসল পেজ ↗</a>' : '') + '</td>' +
          '<td class="small">' + (it.brand ? esc(it.brand) : '<span class="muted">—</span>') + '</td>' +
          '<td class="num">' + (it.price > 0 ? money(it.price) : '—') + (it.old_price > it.price ? '<br><s class="small muted">' + money(it.old_price) + '</s>' : '') + '</td>' +
          '<td class="num">' + bn(it.images.length) + '</td>' +
          '<td class="small">' + esc(it.category || '—') + '</td>' +
          '<td class="num">' + (it.stock !== null && it.stock !== undefined ? bn(it.stock) : it.in_stock === false ? '০' : '<span class="muted">—</span>') + '</td>' +
          '<td class="small">' + (problems.join('<br>') || '<span class="good">ঠিক আছে</span>') + '</td></tr>';
      }).join('');
      $('[data-imp-more]', imp).textContent = items.length > LIMIT ? 'প্রথম ' + bn(LIMIT) + 'টি দেখানো হলো — আমদানির সময় সব ' + bn(items.length) + 'টিই আনা হবে।' : '';
      step(2);
      $('[data-imp-step="2"]', imp).scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    $('[data-imp-reset]', imp).addEventListener('click', function () { st.items = []; step(1); say(''); });

    // ----- step 3: import -----
    var opts = function () {
      var v = function (n) { var el = imp.querySelector('[name="' + n + '"]'); return el ? (el.type === 'checkbox' ? el.checked : el.value) : ''; };
      return { cat_mode: v('imp_cat_mode'), category_id: v('imp_cat_id'), create_category: v('imp_create_cat'), default_stock: v('imp_stock'),
        existing: v('imp_existing'), active: v('imp_active'), hide_no_image: v('imp_hide_noimg') };
    };
    var paint = function () {
      Object.keys(st.k).forEach(function (k) { var el = $('[data-imp-k="' + k + '"]', imp); if (el) el.textContent = bn(st.k[k]); });
      $('[data-imp-bar]', imp).style.width = (st.total ? Math.round(st.done * 100 / st.total) : 0) + '%';
      $('[data-imp-count]', imp).textContent = bn(st.done) + ' / ' + bn(st.total) + ' টি পণ্য দেখা হয়েছে';
    };
    var logList = $('[data-imp-log]', imp);
    var log = function (li) { $('[data-imp-log-title]', imp).hidden = false; logList.appendChild(li); };
    var thumbHtml = function (it) { return it.images && it.images[0] ? '<img src="' + esc(it.images[0]) + '" alt="" loading="lazy" referrerpolicy="no-referrer">' : '<span>📦</span>'; };

    // bring each picture through our server, resize + fingerprint it in the browser, upload it
    var copyImages = function (it) {
      var ids = [];
      var list = (it.images || []).slice(0, 6);
      var one = function (i) {
        if (i >= list.length) return Promise.resolve();
        return fetch('/admin/api/import/image?u=' + encodeURIComponent(list[i]), { credentials: 'same-origin' }).then(function (r) {
          if (!r.ok) throw new Error('no image');
          return r.blob();
        }).then(function (blob) { return upload(blob, { max: 1200, import: true }); })
          .then(function (j) { ids[i] = j.id; }, function () { /* this picture is skipped */ })
          .then(function () { return one(i + 1); });
      };
      return one(0).then(function () { return ids.filter(Boolean); });
    };
    var saveChain = Promise.resolve();
    var save = function (it, ids, allow) {
      var job = saveChain.then(function () {
        return postJSON('/admin/api/import/save', { item: it, images: ids, options: opts(), allow_duplicate: allow ? 1 : 0 });
      });
      saveChain = job.catch(function () {});
      return job;
    };
    var handle = function (it, ids, r) {
      if (r.result === 'duplicate') {
        st.k.duplicate++;
        var li = document.createElement('li');
        li.className = 'dup-item is-block';
        li.innerHTML = '<span class="dup-thumb">' + thumbHtml(it) + '</span><div class="dup-info"><b>' + esc(it.title) + '</b>' +
          '<span class="dup-why">⛔ দোকানে আগে থেকেই আছে: ' + (r.matches || []).map(function (m) {
            return '<a href="/admin/products/' + m.id + '" target="_blank" rel="noopener">' + esc(m.name) + (m.sku ? ' (SKU ' + esc(m.sku) + ')' : '') + '</a> — ' + esc((m.reasons || []).join(' · '));
          }).join('<br>') + '</span></div>' +
          (canOverride ? '<button type="button" class="btn btn-ghost btn-sm" data-imp-force>তবুও যোগ করুন</button>' : '');
        var btn = $('[data-imp-force]', li);
        if (btn) btn.addEventListener('click', function () {
          btn.disabled = true; btn.textContent = '⏳';
          save(it, r.images || ids, true).then(function (r2) {
            if (r2.result === 'added') { st.k.duplicate--; st.k.added++; paint(); li.classList.remove('is-block'); btn.outerHTML = '<a class="btn btn-ghost btn-sm" href="/admin/products/' + r2.id + '" target="_blank">✅ যোগ হয়েছে (SKU ' + esc(r2.sku) + ')</a>'; }
            else { btn.disabled = false; btn.textContent = 'তবুও যোগ করুন'; toast(r2.message || 'যোগ করা যায়নি'); }
          }, function (e) { btn.disabled = false; btn.textContent = 'তবুও যোগ করুন'; toast(e.message); });
        });
        log(li);
      } else if (r.result === 'error') {
        st.k.error++;
        var le = document.createElement('li');
        le.className = 'dup-item is-warn';
        le.innerHTML = '<span class="dup-thumb">' + thumbHtml(it) + '</span><div class="dup-info"><b>' + esc(it.title || '(নাম নেই)') + '</b><span class="dup-why">⚠️ ' + esc(r.message || 'সমস্যা') + '</span></div>';
        log(le);
      } else if (st.k[r.result] !== undefined) st.k[r.result]++;
    };
    var processOne = function (it) {
      if (!(it.price > 0)) return Promise.resolve(handle(it, [], { result: 'error', message: 'দাম নেই — বাদ দেওয়া হলো' }));
      var o = opts();
      if (it.exists && o.existing === 'skip') return Promise.resolve(handle(it, [], { result: 'exists' }));
      var pics = it.exists ? Promise.resolve([]) : copyImages(it);
      return pics.then(function (ids) {
        if (it.images.length && !ids.length && !it.exists) it._noPics = true;
        return save(it, ids).then(function (r) { handle(it, ids, r); }, function (e) {
          // one retry after a short wait (network blip)
          return sleep(2500).then(function () { return save(it, ids); }).then(function (r) { handle(it, ids, r); },
            function () { handle(it, ids, { result: 'error', message: e.message || 'সেভ হয়নি' }); });
        });
      });
    };
    var pauseBtn = $('[data-imp-pause]', imp);
    pauseBtn.addEventListener('click', function () {
      st.paused = !st.paused;
      pauseBtn.textContent = st.paused ? '▶ আবার চালু করুন' : '⏸ থামান';
      $('[data-imp-warn]', imp).textContent = st.paused ? '⏸ থামানো আছে। "আবার চালু করুন" চাপলে যেখানে থেমেছিল সেখান থেকে চলবে।' : '⏳ কাজ চলার সময় এই পেজটা বন্ধ করবেন না।';
    });
    var warnLeave = function (e) { if (st.running) { e.preventDefault(); e.returnValue = ''; return ''; } };
    window.addEventListener('beforeunload', warnLeave);

    $('[data-imp-start]', imp).addEventListener('click', function () {
      if (st.running) return;
      var o = opts();
      if (o.cat_mode === 'one' && !o.category_id && !confirm('কোনো ক্যাটাগরি বাছা হয়নি — সব পণ্য ক্যাটাগরি ছাড়া আসবে। চালিয়ে যাবেন?')) return;
      st.running = true; st.paused = false; st.done = 0; st.total = st.items.length;
      Object.keys(st.k).forEach(function (k) { st.k[k] = 0; });
      logList.innerHTML = ''; $('[data-imp-log-title]', imp).hidden = true;
      $('[data-imp-done]', imp).hidden = true; pauseBtn.hidden = false;
      $all('[data-imp-step="1"], [data-imp-step="2"]', imp).forEach(function (s) { s.hidden = true; });
      $('[data-imp-step="3"]', imp).hidden = false;
      paint();
      var next = 0;
      var worker = function () {
        if (next >= st.items.length) return Promise.resolve();
        if (st.paused) return sleep(500).then(worker);
        var it = st.items[next++];
        return processOne(it).catch(function (e) { handle(it, [], { result: 'error', message: e.message }); })
          .then(function () { st.done++; paint(); return worker(); });
      };
      Promise.all([worker(), worker(), worker()]).then(function () {
        st.running = false;
        pauseBtn.hidden = true;
        $('[data-imp-done]', imp).hidden = false;
        var noPics = st.items.filter(function (x) { return x._noPics; }).length;
        $('[data-imp-warn]', imp).innerHTML = '✅ আমদানি শেষ! ' + bn(st.k.added) + 'টি নতুন পণ্য যোগ হয়েছে' + (st.k.updated ? ', ' + bn(st.k.updated) + 'টি আপডেট হয়েছে' : '') + '।' +
          (noPics ? '<br>⚠️ ' + bn(noPics) + 'টি পণ্যের ছবি ওই সাইট থেকে আনা যায়নি — পণ্যগুলো খুলে হাতে ছবি দিন।' : '');
        toast('আমদানি শেষ');
      });
    });
  })();
  // ---------- watermark (ওয়াটারমার্ক) ----------
  // Finds the product on its (white) background and blends the mark into the product itself:
  // on light parts it darkens a little, on dark parts it lightens a little, and on the plain
  // background it is much fainter — so it looks printed on the product.
  var WM_ALPHA = { soft: 0.12, normal: 0.2, clear: 0.32 };
  var WM_SIZE = { s: 0.28, m: 0.4, l: 0.55 };
  function drawWatermark(img, cfg, logo) {
    var W = img.naturalWidth || img.width, H = img.naturalHeight || img.height;
    var c = document.createElement('canvas'); c.width = W; c.height = H;
    var x = c.getContext('2d', { willReadFrequently: true });
    x.fillStyle = '#fff'; x.fillRect(0, 0, W, H); x.drawImage(img, 0, 0, W, H);
    // 1) where is the product?
    var sc = Math.min(1, 220 / Math.max(W, H)), sw = Math.max(1, Math.round(W * sc)), sh = Math.max(1, Math.round(H * sc));
    var s = document.createElement('canvas'); s.width = sw; s.height = sh;
    var sx = s.getContext('2d', { willReadFrequently: true }); sx.drawImage(c, 0, 0, sw, sh);
    var d = sx.getImageData(0, 0, sw, sh).data, bg = [0, 0, 0];
    [0, sw - 1, sw * (sh - 1), sw * sh - 1].forEach(function (k) { bg[0] += d[k * 4] / 4; bg[1] += d[k * 4 + 1] / 4; bg[2] += d[k * 4 + 2] / 4; });
    var isProd = function (r, g, b) { return Math.abs(r - bg[0]) + Math.abs(g - bg[1]) + Math.abs(b - bg[2]) > 54; };
    var cols = new Array(sw).fill(0), rows = new Array(sh).fill(0);
    for (var yy = 0; yy < sh; yy++) for (var xx = 0; xx < sw; xx++) { var k = (yy * sw + xx) * 4; if (isProd(d[k], d[k + 1], d[k + 2])) { cols[xx]++; rows[yy]++; } }
    var edge = function (arr, min) { var a = 0, b = arr.length - 1; while (a < b && arr[a] < min) a++; while (b > a && arr[b] < min) b--; return [a, b]; };
    var cx2 = edge(cols, Math.max(1, sh * 0.02)), ry2 = edge(rows, Math.max(1, sw * 0.02));
    var box = { x: cx2[0] / sc, y: ry2[0] / sc, w: (cx2[1] - cx2[0] + 1) / sc, h: (ry2[1] - ry2[0] + 1) / sc };
    if (box.w < W * 0.12 || box.h < H * 0.12) box = { x: 0, y: 0, w: W, h: H };
    if (cfg.place === 'center') box = { x: 0, y: 0, w: W, h: H };
    // 2) draw the mark (white on transparent) at the right size
    var mw = Math.max(60, Math.min(box.w * (WM_SIZE[cfg.size] || 0.4), W * 0.7)), mh;
    var m = document.createElement('canvas'), mx;
    var useLogo = cfg.type === 'logo' && logo;
    if (useLogo) {
      var lw = logo.naturalWidth || logo.width, lh = logo.naturalHeight || logo.height;
      mh = mw * lh / lw;
      if (mh > box.h * 0.4) { mh = box.h * 0.4; mw = mh * lw / lh; }
    } else {
      var text = String(cfg.text || '').trim() || 'shobmilbe.com';
      var font = function (px) { return '800 ' + px + 'px "Noto Sans Bengali", "Hind Siliguri", system-ui, sans-serif'; };
      var t = document.createElement('canvas').getContext('2d'); t.font = font(100);
      var fs = 100 * mw / Math.max(1, t.measureText(text).width);
      fs = Math.max(12, Math.min(fs, box.h * 0.2, H * 0.12));
      t.font = font(fs); mw = Math.ceil(t.measureText(text).width) + 4; mh = Math.ceil(fs * 1.35);
    }
    mw = Math.round(mw); mh = Math.round(mh);
    m.width = mw; m.height = mh; mx = m.getContext('2d', { willReadFrequently: true });
    if (useLogo) mx.drawImage(logo, 0, 0, mw, mh);
    else { mx.font = font(fs); mx.fillStyle = '#fff'; mx.textBaseline = 'middle'; mx.textAlign = 'center'; mx.fillText(text, mw / 2, mh / 2); }
    var md = mx.getImageData(0, 0, mw, mh).data;
    // a logo on a plain (non-transparent) background: only its darker drawing counts
    var opaque = useLogo && md[3] > 250 && md[(mw - 1) * 4 + 3] > 250 && md[(mw * mh - 1) * 4 + 3] > 250;
    // 3) where it goes
    var cx, cy;
    if (cfg.place === 'corner') { cx = box.x + box.w - mw / 2 - box.w * 0.06; cy = box.y + box.h - mh / 2 - box.h * 0.07; }
    else { cx = box.x + box.w / 2; cy = box.y + box.h * (cfg.place === 'center' ? 0.5 : 0.6); }
    var ox = Math.round(Math.max(0, Math.min(W - mw, cx - mw / 2))), oy = Math.round(Math.max(0, Math.min(H - mh, cy - mh / 2)));
    var rw = Math.min(mw, W - ox), rh = Math.min(mh, H - oy);
    var area = x.getImageData(ox, oy, rw, rh), p = area.data, a = WM_ALPHA[cfg.strength] || 0.2;
    for (var j = 0; j < rh; j++) for (var i = 0; i < rw; i++) {
      var mk = (j * mw + i) * 4, pk = (j * rw + i) * 4;
      var cov = md[mk + 3] / 255;
      if (opaque) cov = 1 - (md[mk] * 0.3 + md[mk + 1] * 0.59 + md[mk + 2] * 0.11) / 255;
      if (cov <= 0) continue;
      var r = p[pk], g = p[pk + 1], b = p[pk + 2];
      var k2 = cov * a * (isProd(r, g, b) ? 1 : 0.35);
      var lum = r * 0.3 + g * 0.59 + b * 0.11;
      if (lum > 140) { p[pk] = r * (1 - k2 * 0.85); p[pk + 1] = g * (1 - k2 * 0.85); p[pk + 2] = b * (1 - k2 * 0.85); }
      else { p[pk] = r + (255 - r) * k2; p[pk + 1] = g + (255 - g) * k2; p[pk + 2] = b + (255 - b) * k2; }
    }
    x.putImageData(area, ox, oy);
    return c;
  }
  var wmLogos = {};
  function wmLogo(cfg) {
    if (cfg.type !== 'logo' || !cfg.logo) return Promise.resolve(null);
    if (!wmLogos[cfg.logo]) wmLogos[cfg.logo] = loadImage('/media/' + cfg.logo).catch(function () { return null; });
    return wmLogos[cfg.logo];
  }
  function fontsReady() { return document.fonts && document.fonts.ready ? document.fonts.ready.catch(function () {}) : Promise.resolve(); }

  // settings page: live sample
  var wmForm = $('[data-wm-form]');
  if (wmForm) (function () {
    var cv = $('[data-wm-preview]'), src = null;
    var current = function () {
      var v = function (n) { var el = wmForm.elements[n]; return el ? el.value : ''; };
      var type = (wmForm.querySelector('[name=wm_type]:checked') || {}).value || 'domain';
      return { type: type, text: type === 'text' ? v('wm_text') : $('[data-wm-domain]').value, logo: Number(v('wm_logo_id')) || Number($('[data-wm-store-logo]').value) || null,
        strength: v('wm_strength'), size: v('wm_size'), place: v('wm_place') };
    };
    var render = function () {
      $all('[data-wm-show]', wmForm).forEach(function (el) { el.hidden = el.getAttribute('data-wm-show') !== current().type; });
      if (!cv) return;
      var cfg = current();
      Promise.all([src || (src = loadImage(cv.getAttribute('data-src'))), wmLogo(cfg), fontsReady()]).then(function (r) {
        var out = drawWatermark(r[0], cfg, r[1]);
        cv.width = out.width; cv.height = out.height; cv.getContext('2d').drawImage(out, 0, 0);
      }).catch(function () {});
    };
    wmForm.addEventListener('input', render);
    wmForm.addEventListener('change', function () { setTimeout(render, 50); });
    // the logo picker fills a hidden box without an input event
    var lv = wmForm.querySelector('[name=wm_logo_id]');
    if (lv) { var last = lv.value; setInterval(function () { if (lv.value !== last) { last = lv.value; render(); } }, 700); }
    if (cv) cv.addEventListener('click', function () { cv.parentNode.classList.toggle('big'); });
    render();
  })();

  // every admin page: quietly mark product pictures that are new or were made with older settings
  if (/^\/admin/.test(location.pathname)) (function () {
    var prog = $('[data-wm-progress]');
    var done = prog ? Number(prog.getAttribute('data-done')) : 0, total = prog ? Number(prog.getAttribute('data-total')) : 0, rounds = 0;
    var round = function () {
      if (rounds++ > 300) return;
      getJSON('/admin/api/watermark/pending').then(function (j) {
        var ids = j.ids || [];
        if (!ids.length) { if (prog && j.cfg && rounds > 1) prog.textContent = '✅ সব ছবিতে ওয়াটারমার্ক বসেছে (' + bn(total) + 'টি)।'; return; }
        var cfg = j.cfg;
        return Promise.all([wmLogo(cfg), fontsReady()]).then(function (r) {
          var logo = r[0], seq = Promise.resolve();
          ids.forEach(function (id) {
            seq = seq.then(function () {
              return loadImage('/media/' + id).then(function (im) {
                var data = drawWatermark(im, cfg, logo).toDataURL('image/jpeg', 0.9);
                return fetch('/admin/api/watermark/' + id, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ver: cfg.ver, data: data }) });
              }, function () {
                // a picture that can't be read: note it, so it is not tried again and again
                return fetch('/admin/api/watermark/' + id, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ver: cfg.ver, skip: 1 }) });
              }).then(function () { done++; if (prog) prog.textContent = '⏳ ' + bn(Math.min(done, total)) + ' / ' + bn(total) + ' টি ছবিতে ওয়াটারমার্ক বসেছে — পেজটা খোলা রাখুন।'; });
            });
          });
          return seq;
        }).then(function () { setTimeout(round, 200); });
      }).catch(function () { /* try again next time an admin page opens */ });
    };
    setTimeout(round, prog ? 300 : 2500);
  })();
  // ---------- ⬜ সাদা ব্যাকগ্রাউন্ড: every admin page quietly puts waiting product pictures on pure white ----------
  if (/^\/admin/.test(location.pathname)) (function () {
    var msg = $('[data-wb-msg]'), btn = $('[data-wb-run]'), running = false, rounds = 0, made = 0;
    var show = function (t) { if (msg) msg.textContent = t; };
    var step = function () {
      if (rounds++ > 500) { running = false; return; }
      fetch('/admin/api/white-bg/run', { method: 'POST', credentials: 'same-origin', headers: { Accept: 'application/json' } })
        .then(function (r) { return r.json(); })
        .then(function (j) {
          if (j.off) { running = false; return; }
          made += (j.done || []).length;
          if (!j.left || !(j.done || []).length) {
            running = false;
            if (msg) { show(j.left ? '⏳ ' + bn(j.left) + 'টি ছবি একটু পরে নিজে থেকে হবে (AI ব্যস্ত বা আবার চেষ্টার অপেক্ষায়)।' : '✅ সব ছবি সাদা ব্যাকগ্রাউন্ডে — পেজ আবার লোড হচ্ছে…'); if (made) setTimeout(function () { location.reload(); }, 1200); }
            return;
          }
          show('⏳ ' + bn(j.white) + ' / ' + bn(j.total) + ' টি ছবি সাদা হয়েছে, বাকি ' + bn(j.left) + 'টি — পেজটা খোলা রাখুন।');
          setTimeout(step, 150);
        })
        .catch(function () { running = false; show('একটু সমস্যা হলো — কিছুক্ষণ পর আবার চাপুন।'); if (btn) btn.disabled = false; });
    };
    var start = function () { if (running) return; running = true; rounds = 0; if (btn) btn.disabled = true; step(); };
    if (btn) btn.addEventListener('click', start);
    // on every admin page: start by itself after a short pause (only when the white page says something is left, or on other pages)
    if (!msg || Number(msg.getAttribute('data-left')) > 0) setTimeout(start, msg ? 400 : 4000);
  })();
  // ---------- market research: "এখনই আপডেট করুন" reads every shop once, one per call ----------
  var rsBtn = $('[data-rs-run]');
  if (rsBtn) rsBtn.addEventListener('click', function () {
    var msg = $('[data-rs-msg]'), done = 0, max = 30, seen = {};
    rsBtn.disabled = true;
    var step = function () {
      return fetch('/admin/api/research/run', { method: 'POST', credentials: 'same-origin', headers: { Accept: 'application/json' } })
        .then(function (r) { return r.json(); }).then(function (j) {
          if (j.idle || !j.source || seen[j.source] || ++done > max) return false;
          seen[j.source] = 1;
          msg.textContent = '⏳ ' + j.source + (j.error ? ' — ' + j.error : ' — ' + bn(j.items || 0) + 'টি পণ্য পড়া হলো');
          return true;
        });
    };
    var loop = function () { return step().then(function (more) { if (more) return loop(); }); };
    loop().then(function () { msg.textContent = '✅ আপডেট শেষ — পেজ আবার লোড হচ্ছে…'; setTimeout(function () { location.reload(); }, 900); },
      function () { msg.textContent = 'আপডেট করা যায়নি, একটু পরে চেষ্টা করুন।'; rsBtn.disabled = false; });
  });
  // import page opened from market research with a product link
  var impUrl = $('[data-imp-url]');
  if (impUrl) { var pre = new URLSearchParams(location.search).get('url'); if (pre && /^https?:\/\//.test(pre)) impUrl.value = pre; }

  // ---------- more pictures from the old site (each product's own page) ----------
  var mp = $('[data-morepics]');
  if (mp) (function () {
    var post = function (url, body) {
      return fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) })
        .then(function (r) {
          return r.json().catch(function () { return { error: 'সার্ভার থেকে উত্তর আসেনি (' + r.status + ')।' }; })
            .then(function (j) { if (!r.ok) throw new Error(j.error || 'সমস্যা হয়েছে'); return j; });
        });
    };
    var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
    var status = $('[data-mp-status]', mp);
    var say = function (t, bad) { status.hidden = !t; status.innerHTML = t || ''; status.classList.toggle('warn', !!bad); };
    var st = { list: [], max: 12, running: false, paused: false, done: 0, k: { added: 0, done: 0, pics: 0, none: 0, error: 0 } };
    var paint = function () {
      Object.keys(st.k).forEach(function (k) { var el = $('[data-mp-k="' + k + '"]', mp); if (el) el.textContent = bn(st.k[k]); });
      $('[data-mp-bar]', mp).style.width = (st.list.length ? Math.round(st.done * 100 / st.list.length) : 0) + '%';
      $('[data-mp-count]', mp).textContent = bn(st.done) + ' / ' + bn(st.list.length) + ' টি কাজ শেষ';
    };
    var logList = $('[data-mp-log]', mp);
    var log = function (p, cls, text) {
      $('[data-mp-log-title]', mp).hidden = false;
      var li = document.createElement('li');
      li.className = 'dup-item mp-row ' + cls;
      var name = p.id ? '<a href="/admin/products/' + p.id + '" target="_blank" rel="noopener"><b>' + esc(p.name) + '</b></a>'
        : (p.link ? '<a href="' + esc(p.link) + '" target="_blank" rel="noopener noreferrer"><b>' + esc(p.name || p.link) + '</b></a>' : '<b>' + esc(p.name) + '</b>');
      li.innerHTML = '<span class="dup-thumb">' + (p.thumb ? '<img src="' + esc(p.thumb) + '" alt="">' : '<span>📦</span>') + '</span>' +
        '<div class="dup-info">' + name + (p.sku ? ' <span class="small muted">SKU ' + esc(bn(p.sku)) + '</span>' : '') + '<span class="dup-why">' + text + '</span></div>';
      if (cls === 'is-ok') logList.insertBefore(li, logList.firstChild); else logList.appendChild(li);
    };

    // 1. which products
    $('[data-mp-plan]', mp).addEventListener('click', function () {
      var btn = this;
      var url = ($('[data-mp-feed]', mp).value || '').trim();
      var addNew = !!($('[name=mp_new]', mp) || {}).checked;
      if (!url) { say('ফিড লিংক দিন।', true); return; }
      btn.disabled = true; say('⏳ ফিড আর পুরোনো সাইটের পণ্যের তালিকা পড়া হচ্ছে… (এক মিনিট লাগতে পারে)');
      post('/admin/api/morepics/plan', { url: url, max: $('[data-mp-max]', mp).value }).then(function (j) {
        btn.disabled = false;
        st.max = j.max;
        // new products first (the most important), then pages only the sitemap knows, then more pictures
        st.list = (addNew ? (j.missing || []).map(function (it) { return { kind: 'new', item: it }; })
          .concat((j.extra || []).map(function (u) { return { kind: 'link', link: u }; })) : [])
          .concat(j.products.map(function (p) { return { kind: 'pics', p: p }; }));
        var t = '✅ পুরোনো সাইটে মোট <b>' + bn(j.oldTotal) + 'টি</b> পণ্য পাওয়া গেছে (ফিডে ' + bn(j.feedItems) + 'টি' +
          (j.extra && j.extra.length ? ', ফিডের বাইরে সাইটে আরও ' + bn(j.extra.length) + 'টি' : '') + ')।<br>' +
          'এই দোকানে আছে ' + bn(j.matched) + 'টি' + (j.full ? ' (' + bn(j.full) + 'টিতে আগে থেকেই সব ছবি আছে)' : '') + '। ' +
          ((j.missing || []).length ? '<b>' + bn(j.missing.length) + 'টি নেই</b> — ' + (addNew ? 'এগুলো যোগ করা হবে।' : 'এগুলো যোগ করতে উপরের টিক দিন।') : 'ফিডের সব পণ্যই দোকানে আছে।') +
          (j.extra && j.extra.length ? ' ফিডের বাইরের ' + bn(j.extra.length) + 'টি পেজ খুলে দেখা হবে — দোকানে না থাকলে যোগ হবে।' : '') +
          (!j.sitemapRead ? '<br><span class="small">(পুরোনো সাইটের sitemap পড়া যায়নি — শুধু ফিডের পণ্য ধরা হয়েছে।)</span>' : '') +
          ((j.inTrash || []).length ? '<br>🗑️ ' + bn(j.inTrash.length) + 'টি পণ্য আপনি মুছে ফেলেছিলেন (রিসাইকেল বিনে আছে), তাই আবার আনা হবে না — চাইলে <a href="/admin/trash">রিসাইকেল বিন</a> থেকে ফেরত আনুন।' : '');
        say(t);
        var tl = $('[data-mp-trash]', mp);
        tl.innerHTML = (j.inTrash || []).map(function (x) { return '<li>🗑️ ' + esc(x.title) + '</li>'; }).join('');
        tl.hidden = !(j.inTrash || []).length;
        $('[data-mp-found]', mp).textContent = bn(st.list.length) + 'টি কাজ';
        $('[data-mp-step="2"]', mp).hidden = false;
        $('[data-mp-start]', mp).disabled = !st.list.length;
        st.done = 0; paint();
      }, function (e) { btn.disabled = false; say('⚠️ ' + esc(e.message), true); });
    });

    // bring one picture through our server, resize + fingerprint it here, upload it
    var copyPic = function (u) {
      return fetch('/admin/api/import/image?u=' + encodeURIComponent(u), { credentials: 'same-origin' }).then(function (r) {
        if (!r.ok) throw new Error('no image');
        return r.blob();
      }).then(function (blob) { return upload(blob, { max: 1200, import: true }); });
    };
    var copyAll = function (urls) {
      var ids = [];
      return urls.reduce(function (c, u) {
        return c.then(function () { return copyPic(u).then(function (j) { ids.push(j.id); }, function () { /* skipped */ }); });
      }, Promise.resolve()).then(function () { return ids; });
    };
    // the same picture written two ways (…/a.webp and …/a.webp?w=600) counts once
    var uniq = function (list) {
      var seen = {};
      return list.filter(function (u) { var k = String(u || '').split('?')[0].toLowerCase(); if (!u || seen[k]) return false; seen[k] = 1; return true; });
    };
    // more pictures for a product already in the shop
    var one = function (p) {
      return post('/admin/api/morepics/find', { link: p.link, main: p.main }).then(function (f) {
        if (f.error) { st.k.error++; log(p, 'is-warn', '⚠️ ' + esc(f.error)); return; }
        if (!f.confirmed) { st.k.error++; log(p, 'is-warn', '⚠️ ' + esc(f.note)); return; }
        var pics = uniq(f.images || []).slice(0, st.max + 3); // the whole old gallery (a few spare in case some are the same photo)
        if (!pics.length) { st.k.none++; return; }
        return copyAll(pics).then(function (ids) {
          if (!ids.length) { st.k.error++; log(p, 'is-warn', '⚠️ ছবিগুলো আনা যায়নি'); return; }
          return post('/admin/api/morepics/attach', { product_id: p.id, ids: ids, max: st.max }).then(function (r) {
            if (r.added) {
              st.k.done++; st.k.pics += r.added;
              log(p, 'is-ok', '✅ ' + bn(r.added) + 'টি নতুন ছবি — এখন মোট ' + bn(r.total) + 'টি');
            } else st.k.none++;
          });
        });
      });
    };
    // a product the shop doesn't have yet: saved with its main picture, then the rest of its gallery is added
    // the same careful way as for the old products (same photo never twice, never another product's)
    var addNew = function (it) {
      var row = { name: it.title, link: it.link };
      var feedPics = uniq(it.images || []);
      var gallery = it.link ? post('/admin/api/morepics/find', { link: it.link, main: feedPics[0] || '' }).catch(function () { return {}; }) : Promise.resolve({});
      return gallery.then(function (f) {
        var found = f.confirmed ? uniq(f.images || []) : [];
        var mainUrl = feedPics[0] || found[0] || '';
        var rest = uniq(found.concat(feedPics.slice(1))).filter(function (u) { return u.split('?')[0] !== mainUrl.split('?')[0]; });
        return copyAll(mainUrl ? [mainUrl] : []).then(function (mainIds) {
          return post('/admin/api/import/save', { item: it, images: mainIds, allow_duplicate: 1,
            options: { active: true, hide_no_image: true, cat_mode: 'auto', default_stock: 10, existing: 'skip' } }).then(function (r) {
            if (r.result === 'exists') { st.k.none++; return; }
            if (r.result === 'duplicate') {
              st.k.error++;
              log(row, 'is-warn', '⚠️ দোকানে একই রকম পণ্য আছে, তাই যোগ হয়নি' + (r.matches && r.matches[0] ? ' (মিলেছে: <a href="/admin/products/' + r.matches[0].id + '" target="_blank">' + esc(r.matches[0].name) + '</a>)' : '') + ' — দরকার হলে নিজে যোগ করুন');
              return;
            }
            if (r.result !== 'added') { st.k.error++; log(row, 'is-warn', '⚠️ ' + esc(r.message || 'যোগ হয়নি')); return; }
            st.k.added++;
            row.id = r.id; row.sku = r.sku;
            var more = rest.length ? copyAll(rest.slice(0, st.max + 3)).then(function (ids) {
              return ids.length ? post('/admin/api/morepics/attach', { product_id: r.id, ids: ids, max: st.max }) : { added: 0, total: mainIds.length };
            }) : Promise.resolve({ added: 0, total: mainIds.length });
            return more.then(function (a) {
              var total = a.total || mainIds.length;
              st.k.pics += total;
              log(row, 'is-ok', '🆕 নতুন পণ্য যোগ হয়েছে — ' + bn(total) + 'টি ছবিসহ' + (total || r.active ? '' : ' (ছবি না থাকায় দোকানে লুকানো)'));
            });
          });
        });
      });
    };
    // a page only the old site's sitemap knows: read it, then add it or fill its pictures
    var fromLink = function (t) {
      return post('/admin/api/morepics/page', { link: t.link }).then(function (r) {
        if (r.error) { st.k.error++; log({ name: t.link, link: t.link }, 'is-warn', '⚠️ ' + esc(r.error)); return; }
        if (r.trashed) { st.k.none++; log({ name: r.item.title, link: t.link }, 'is-skip', '🗑️ রিসাইকেল বিনে আছে — আনা হয়নি'); return; }
        if (r.exists) {
          if (r.exists.pics >= st.max) { st.k.none++; return; }
          return one({ id: r.exists.id, name: r.exists.name, sku: r.exists.sku, thumb: r.exists.thumb, pics: r.exists.pics, link: r.item.link || t.link, main: (r.item.images || [])[0] || '' });
        }
        return addNew(r.item);
      });
    };
    var run = function (t) { return t.kind === 'new' ? addNew(t.item) : t.kind === 'link' ? fromLink(t) : one(t.p); };
    var label = function (t) { return t.kind === 'pics' ? t.p : t.kind === 'new' ? { name: t.item.title, link: t.item.link } : { name: t.link, link: t.link }; };
    var pauseBtn = $('[data-mp-pause]', mp);
    pauseBtn.addEventListener('click', function () {
      st.paused = !st.paused;
      pauseBtn.textContent = st.paused ? '▶ আবার চালু করুন' : '⏸ থামান';
    });
    window.addEventListener('beforeunload', function (e) { if (st.running) { e.preventDefault(); e.returnValue = ''; return ''; } });
    $('[data-mp-start]', mp).addEventListener('click', function () {
      if (st.running || !st.list.length) return;
      st.running = true; st.paused = false; st.done = 0;
      Object.keys(st.k).forEach(function (k) { st.k[k] = 0; });
      logList.innerHTML = ''; $('[data-mp-log-title]', mp).hidden = true;
      this.hidden = true; pauseBtn.hidden = false; $('[data-mp-done]', mp).hidden = true;
      $('[data-mp-step="1"]', mp).hidden = true;
      paint();
      var next = 0;
      var worker = function () {
        if (next >= st.list.length) return Promise.resolve();
        if (st.paused) return wait(500).then(worker);
        var t = st.list[next++];
        return run(t).catch(function (e) {
          // one retry after a short wait (network blip)
          return wait(2500).then(function () { return run(t); }).catch(function () { st.k.error++; log(label(t), 'is-warn', '⚠️ ' + esc(e.message || 'সমস্যা')); });
        }).then(function () { st.done++; paint(); return worker(); });
      };
      Promise.all([worker(), worker()]).then(function () {
        st.running = false; pauseBtn.hidden = true;
        $('[data-mp-done]', mp).hidden = false;
        $('[data-mp-warn]', mp).textContent = '✅ শেষ! ' + (st.k.added ? bn(st.k.added) + 'টি নতুন পণ্য যোগ হয়েছে। ' : '') + (st.k.done ? bn(st.k.done) + 'টি আগের পণ্যে নতুন ছবি বসেছে। ' : '') + 'মোট ' + bn(st.k.pics) + 'টি ছবি এসেছে।' +
          (st.k.none ? ' ' + bn(st.k.none) + 'টি পণ্যে আগে থেকেই পুরোনো সাইটের সব ছবি ছিল (নতুন কিছু লাগেনি)।' : '') + (st.k.error ? ' ' + bn(st.k.error) + 'টিতে সমস্যা — নিচের তালিকায় দেখুন, পরে আবার চালালে বাকিগুলো হবে।' : '');
      });
    });

    // test with one product page (nothing saved)
    $('[data-mp-test]', mp).addEventListener('click', function () {
      var btn = this, out = $('[data-mp-test-out]', mp);
      var link = ($('[data-mp-test-url]', mp).value || '').trim();
      if (!link) return;
      btn.disabled = true; out.innerHTML = '<p class="small muted">⏳ পেজ পড়া হচ্ছে…</p>';
      post('/admin/api/morepics/find', { link: link }).then(function (f) {
        btn.disabled = false;
        if (f.error) { out.innerHTML = '<p class="warn">⚠️ ' + esc(f.error) + '</p>'; return; }
        var imgs = f.images || [];
        out.innerHTML = '<p><b>' + (imgs.length ? '✅ ' + bn(imgs.length) + 'টি ছবি পাওয়া গেছে' : 'এই পেজে বাড়তি কোনো ছবি পাওয়া যায়নি') + '</b>' +
          (imgs.length ? ' <span class="small muted">(মূল ছবিসহ — আসল কাজের সময় মূল ছবি বাদ দিয়ে বাকিগুলো বসবে)</span>' : '') + '</p>' +
          '<div class="mp-pics">' + imgs.map(function (u) { return '<img src="/admin/api/import/image?u=' + encodeURIComponent(u) + '" alt="" loading="lazy">'; }).join('') + '</div>';
      }, function (e) { btn.disabled = false; out.innerHTML = '<p class="warn">⚠️ ' + esc(e.message) + '</p>'; });
    });
  })();

  // ---------- ভাষা (বাংলা / English): "এখনই সব অনুবাদ করে রাখুন" — one batch per call until nothing is left ----------
  var i18nBtn = $('[data-i18n-fill]');
  if (i18nBtn) i18nBtn.addEventListener('click', function () {
    var prog = $('[data-i18n-progress]'), rounds = 0;
    i18nBtn.disabled = true;
    var step = function () {
      return fetch('/admin/design/language/fill', { method: 'POST', credentials: 'same-origin', headers: { Accept: 'application/json' } })
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(function (j) {
          var done = j.total - j.left;
          prog.textContent = '⏳ ' + bn(done) + ' / ' + bn(j.total) + ' টি লেখা অনুবাদ হয়েছে…';
          if (j.error && !j.done) throw new Error(j.error);
          return j.left > 0 && j.done > 0 && ++rounds < 200;
        });
    };
    var loop = function () { return step().then(function (more) { if (more) return loop(); }); };
    loop().then(function () { prog.textContent = '✅ সব অনুবাদ হয়ে গেছে — পেজ আবার লোড হচ্ছে…'; setTimeout(function () { location.reload(); }, 900); },
      function (e) { prog.textContent = '⚠️ ' + (e && e.message ? e.message : 'অনুবাদ করা যায়নি') + ' — একটু পরে আবার চেষ্টা করুন।'; i18nBtn.disabled = false; });
  });

  // ---------- 🎨 variants page: on/off switch per row, add a row ----------
  var vform = $('[data-var-form]');
  if (vform) {
    vform.addEventListener('change', function (e) {
      var sw = e.target.closest('[data-var-active]');
      if (!sw) return;
      var row = sw.closest('tr'); var hv = row && $('[data-var-active-val]', row);
      if (hv) hv.value = sw.checked ? '1' : '0';
      if (row) row.classList.toggle('row-off', !sw.checked);
    });
    var vadd = $('[data-var-add]'), vtpl = $('[data-var-template]'), vbody = $('[data-var-body]');
    if (vadd && vtpl && vbody) vadd.addEventListener('click', function () { vbody.appendChild(vtpl.content.cloneNode(true)); var ins = $all('input[name=vlabel]', vbody); if (ins.length) ins[ins.length - 1].focus(); });
  }
})();
