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

  // ---------- on/off switches save right away ----------
  document.addEventListener('change', function (e) {
    var sw = e.target.closest && e.target.closest('[data-autosubmit]');
    var f = sw && (sw.form || sw.closest('form'));
    if (!f) return;
    f.submit();
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
        toast(on ? 'পণ্যটি দোকানে আবার দেখাচ্ছে' : 'পণ্যটি দোকান থেকে লুকানো হয়েছে');
      }, function (err) { t.checked = !on; toast(err.message); })
      .then(function () { t.disabled = false; });
  });

  // ---------- table rows that open a details page ----------
  document.addEventListener('click', function (e) {
    var row = e.target.closest && e.target.closest('tr[data-href]');
    if (!row || e.target.closest('a, button, input, select, label')) return;
    location.href = row.getAttribute('data-href');
  });
  // ---------- pages that refresh themselves (live visitors) ----------
  var auto = $('[data-autoreload]');
  if (auto) {
    setInterval(function () {
      if (document.visibilityState === 'visible') location.reload();
    }, (Number(auto.getAttribute('data-autoreload')) || 30) * 1000);
  }

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
      im.src = src;
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
          var scale = Math.min(1, max / Math.max(img.width, img.height));
          var w = Math.round(img.width * scale);
          var h = Math.round(img.height * scale);
          var canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          var ctx = canvas.getContext('2d');
          var png = file.type === 'image/png' || file.type === 'image/webp';
          if (!png) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); }
          ctx.drawImage(img, 0, 0, w, h);
          resolve({ data: png ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', quality), width: w, height: h, png: png });
          void square;
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }
  function upload(file, opts) {
    opts = opts || {};
    var max = opts.max || 1200;
    return resize(file, max, 0.82).then(function (full) {
      // Big PNGs (photos saved as PNG) become JPEG to stay small.
      if (full.png && full.data.length > 900000) return resize(new File([file], 'x.jpg', { type: 'image/jpeg' }), max, 0.82);
      return full;
    }).then(function (full) {
      return resize(file, opts.thumb || 420, 0.78).then(function (th) {
        return loadImage(th.data).then(fingerprint, function () { return null; }).then(function (fp) {
          return fetch('/admin/api/media', {
            method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ data: full.data, thumb: th.data, width: full.width, height: full.height,
              phash: fp ? fp.h : undefined, phash_m: fp ? fp.m : undefined, import: opts.import ? 1 : undefined }),
          }).then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || 'আপলোড হয়নি'); return j; }); });
        });
      });
    });
  }

  // single image pickers
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
      }).catch(function (e) {
        preview.innerHTML = '<span class="warn small">' + esc(e.message) + '</span>';
      }).then(function () { btns.forEach(function (b) { b.disabled = false; }); file.value = ''; });
    });
    if (clear) clear.addEventListener('click', function () { value.value = ''; preview.innerHTML = '<span class="muted small">ছবি নেই</span>'; clear.hidden = true; });
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
      var exist = $all('input[name="item_id[]"]', rows).filter(function (i) { return i.value === String(p.id); })[0];
      if (exist) { var q = $('[data-qty]', exist.closest('tr')); q.value = Number(q.value) + 1; totalO(); return; }
      var tr = document.createElement('tr');
      tr.setAttribute('data-row', '');
      tr.innerHTML = '<td>' + esc(p.name) + (p.sku ? '<br><span class="small muted">' + esc(p.sku) + '</span>' : '') + '<br><span class="small muted">স্টক ' + bn(p.stock) + '</span><input type="hidden" name="item_id[]" value="' + p.id + '"></td>' +
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
        deliveryIn.value = inCity ? oform.getAttribute('data-dhaka') : oform.getAttribute('data-outside');
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
      var sum = 0;
      $all('[data-row]', brows).forEach(function (r) { sum += (Number(r.getAttribute('data-price')) || 0) * (Number($('[data-qty]', r).value) || 0); });
      var priceIn = $('[data-price]');
      var p = Number(priceIn && priceIn.value) || 0;
      $('[data-bundle-sum]', bundle).innerHTML = sum ? 'আলাদা কিনলে মোট দাম: <b>' + money(sum) + '</b>' + (p ? (p < sum ? ' · প্যাকেজে কাস্টমারের সাশ্রয়: <b class="good">' + money(sum - p) + '</b>' : ' · <span class="warn">প্যাকেজের দাম আলাদা দামের চেয়ে বেশি!</span>') : '') : '';
    };
    picker($('[data-bundle-search]', bundle), $('[data-bundle-results]', bundle), function (p) {
      if (p.type === 'bundle') { toast('বান্ডেলের ভেতরে আরেকটা বান্ডেল রাখা যায় না।'); return; }
      if ($all('input[name="bundle_id[]"]', brows).some(function (i) { return i.value === String(p.id); })) return;
      var tr = document.createElement('tr');
      tr.setAttribute('data-row', ''); tr.setAttribute('data-price', p.price);
      tr.innerHTML = '<td>' + esc(p.name) + (p.sku ? '<br><span class="small muted">' + esc(p.sku) + '</span>' : '') + '<input type="hidden" name="bundle_id[]" value="' + p.id + '"></td>' +
        '<td class="num">' + money(p.price) + '</td><td class="num"><input type="number" name="bundle_qty[]" value="1" min="1" class="w-num" data-qty></td>' +
        '<td class="num">' + bn(p.stock) + '</td><td><button type="button" class="link-btn danger" data-remove-row>✕</button></td>';
      brows.appendChild(tr); bsum();
    }, { all: true, type: 'single' });
    bundle.addEventListener('input', bsum);
    document.addEventListener('input', function (e) { if (e.target.hasAttribute('data-price')) bsum(); });
    bundle.addEventListener('click', function (e) { var b = e.target.closest('[data-remove-row]'); if (b) { b.closest('tr').remove(); bsum(); } });
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
    picker($('[data-product-search]', pur), $('[data-product-results]', pur), function (p) {
      if (p.type === 'bundle') { toast('বান্ডেল কেনা যায় না — ভেতরের পণ্যগুলো আলাদা করে যোগ করুন।'); return; }
      var tr = document.createElement('tr');
      tr.setAttribute('data-row', '');
      tr.innerHTML = '<td>' + esc(p.name) + (p.sku ? '<br><span class="small muted">' + esc(p.sku) + '</span>' : '') + '<br><span class="small muted">এখন স্টক ' + bn(p.stock) + ' · বিক্রি দাম ' + money(p.price) + '</span><input type="hidden" name="item_id[]" value="' + p.id + '"></td>' +
        '<td class="num"><input type="number" name="item_qty[]" value="1" min="1" class="w-num" data-qty required></td>' +
        '<td class="num"><input type="number" name="item_cost[]" value="' + (p.cost || '') + '" min="0" step="0.01" class="w-num" data-cost required></td>' +
        '<td class="num" data-line-total></td><td><button type="button" class="link-btn danger" data-remove-row>✕</button></td>';
      prow.appendChild(tr); ptotal();
    }, { all: true });
    pur.addEventListener('input', ptotal);
    pur.addEventListener('click', function (e) { var b = e.target.closest('[data-remove-row]'); if (b) { b.closest('tr').remove(); ptotal(); } });
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
    var out = b.parentNode.querySelector('[data-fraud-out]');
    out.textContent = 'চেক করা হচ্ছে…';
    getJSON('/admin/api/fraud?phone=' + encodeURIComponent(b.getAttribute('data-fraud-check'))).then(function (j) {
      if (!j.ok) { out.textContent = j.message || 'তথ্য পাওয়া যায়নি'; return; }
      var ratio = j.total ? Math.round((j.success / j.total) * 100) : null;
      out.innerHTML = 'Pathao রেকর্ড: মোট <b>' + bn(j.total) + '</b>টি পার্সেল, সফল <b>' + bn(j.success) + '</b>টি' + (ratio !== null ? ' (<b class="' + (ratio < 60 ? 'warn' : 'good') + '">' + bn(ratio) + '%</b>)' : '') + (j.rating ? ' · রেটিং: ' + esc(j.rating) : '');
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

  // ---------- repeat rows (links, verification files) ----------
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-repeat-add]');
    if (!b) return;
    var box = $('[data-repeat="' + b.getAttribute('data-repeat-add') + '"]');
    var last = box.lastElementChild;
    var copy = last.cloneNode(true);
    $all('input', copy).forEach(function (i) { i.value = ''; });
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
})();
