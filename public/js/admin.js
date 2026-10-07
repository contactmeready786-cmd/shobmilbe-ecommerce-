// সবমিলবে admin — menus, image uploads, product pickers, order forms
(function () {
  'use strict';
  var BN = '০১২৩৪৫৬৭৮৯';
  function bn(n) { return String(n).replace(/\d/g, function (d) { return BN[d]; }); }
  function money(n) { return '৳' + bn(Math.round(Number(n || 0)).toLocaleString('en-IN')); }
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
        return fetch('/admin/api/media', {
          method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data: full.data, thumb: th.png ? th.data : th.data, width: full.width, height: full.height }),
        }).then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || 'আপলোড হয়নি'); return j; }); });
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

  // product gallery (many images, reorder)
  var gallery = $('[data-gallery]');
  if (gallery) {
    var gValue = $('[data-gallery-value]');
    var gFile = $('[data-gallery-file]', gallery);
    var addBtn = $('[data-gallery-add]', gallery);
    var syncG = function () {
      var ids = $all('figure[data-img]', gallery).map(function (f) { return f.getAttribute('data-img'); });
      gValue.value = ids.join(',');
      addBtn.hidden = ids.length >= 8;
    };
    var figure = function (id, src) {
      var f = document.createElement('figure');
      f.setAttribute('data-img', id);
      f.innerHTML = '<img src="' + src + '" alt=""><div class="g-tools"><button type="button" data-move="-1" aria-label="আগে">◀</button><button type="button" data-move="1" aria-label="পরে">▶</button><button type="button" data-del aria-label="মুছুন">✕</button></div>';
      return f;
    };
    gFile.addEventListener('change', function () {
      var files = Array.prototype.slice.call(gFile.files, 0, 8 - $all('figure[data-img]', gallery).length);
      var save = $('[data-save]');
      if (save) save.disabled = true;
      var chain = Promise.resolve();
      files.forEach(function (f) {
        chain = chain.then(function () {
          var ph = document.createElement('figure');
          ph.className = 'uploading'; ph.innerHTML = '<span>আপলোড…</span>';
          gallery.insertBefore(ph, addBtn);
          return upload(f, { max: 1200 }).then(function (j) {
            gallery.replaceChild(figure(j.id, j.thumb), ph);
          }).catch(function (e) { ph.remove(); toast(e.message); });
        });
      });
      chain.then(function () { syncG(); gFile.value = ''; if (save) save.disabled = false; });
    });
    gallery.addEventListener('click', function (e) {
      var fig = e.target.closest('figure[data-img]');
      if (!fig) return;
      if (e.target.closest('[data-del]')) { fig.remove(); syncG(); return; }
      var mv = e.target.closest('[data-move]');
      if (mv) {
        if (mv.getAttribute('data-move') === '-1' && fig.previousElementSibling) gallery.insertBefore(fig, fig.previousElementSibling);
        else if (mv.getAttribute('data-move') === '1' && fig.nextElementSibling && fig.nextElementSibling.hasAttribute('data-img')) gallery.insertBefore(fig.nextElementSibling, fig);
        syncG();
      }
    });
    syncG();
  }

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
    if (cost) cost.addEventListener('input', calc);
    calc();
    var yt = $('[data-yt]', pform);
    if (yt) {
      yt.addEventListener('input', function () {
        var m = yt.value.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
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
      $('[data-grand]', oform).textContent = money(sub - (Number(discountIn.value) || 0) + (Number(deliveryIn.value) || 0));
    };
    picker($('[data-product-search]', oform), $('[data-product-results]', oform), function (p) {
      var exist = $all('input[name="item_id[]"]', rows).filter(function (i) { return i.value === String(p.id); })[0];
      if (exist) { var q = $('[data-qty]', exist.closest('tr')); q.value = Number(q.value) + 1; totalO(); return; }
      var tr = document.createElement('tr');
      tr.setAttribute('data-row', '');
      tr.innerHTML = '<td>' + esc(p.name) + (p.sku ? '<br><span class="small muted">' + esc(p.sku) + '</span>' : '') + '<br><span class="small muted">স্টক ' + bn(p.stock) + '</span><input type="hidden" name="item_id[]" value="' + p.id + '"></td>' +
        '<td class="num"><input type="number" name="item_price[]" value="' + p.price + '" min="0" class="w-num" data-price></td>' +
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
})();
