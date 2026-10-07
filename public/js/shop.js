// সবমিলবে — cart, checkout and small storefront interactions
(function () {
  'use strict';
  var KEY = 'sm_cart';
  var BN = '০১২৩৪৫৬৭৮৯';
  function bn(n) { return String(n).replace(/\d/g, function (d) { return BN[d]; }); }
  function money(n) { return '৳' + bn(Number(n || 0).toLocaleString('en-IN')); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ---------- cart storage ----------
  function read() {
    try { var c = JSON.parse(localStorage.getItem(KEY) || '{}'); return c && typeof c === 'object' ? c : {}; }
    catch (e) { return {}; }
  }
  function write(cart) {
    try { localStorage.setItem(KEY, JSON.stringify(cart)); } catch (e) { /* storage blocked */ }
    updateCount();
  }
  function count(cart) { return Object.keys(cart).reduce(function (s, k) { return s + cart[k]; }, 0); }
  function add(id, qty) {
    var cart = read();
    cart[id] = Math.min((cart[id] || 0) + qty, 99);
    write(cart);
  }
  function updateCount(bump) {
    var n = count(read());
    document.querySelectorAll('[data-cart-count]').forEach(function (el) {
      el.textContent = bn(n);
      el.hidden = n === 0;
      if (bump) { el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); }
    });
  }

  // ---------- toast ----------
  var toastTimer;
  function toast(htmlText) {
    var t = document.querySelector('[data-toast]');
    if (!t) return;
    t.innerHTML = htmlText;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 3200);
  }

  // ---------- add to cart buttons ----------
  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-add]');
    if (!btn) return;
    var qty = 1;
    if (btn.hasAttribute('data-with-qty')) {
      var input = document.querySelector('[data-qty] input');
      qty = Math.max(1, parseInt(input && input.value, 10) || 1);
    }
    add(btn.getAttribute('data-add'), qty);
    if (btn.hasAttribute('data-buy-now')) { location.href = '/checkout'; return; }
    updateCount(true);
    toast('<span>✅ "' + esc(btn.getAttribute('data-name')) + '" কার্টে যোগ হয়েছে</span><a href="/cart">কার্ট দেখুন</a>');
  });

  // quantity steppers on product page
  document.querySelectorAll('[data-qty]').forEach(function (box) {
    var input = box.querySelector('input');
    box.addEventListener('click', function (e) {
      var b = e.target.closest('[data-step]');
      if (!b) return;
      var max = parseInt(input.max, 10) || 99;
      input.value = Math.min(max, Math.max(1, (parseInt(input.value, 10) || 1) + parseInt(b.getAttribute('data-step'), 10)));
    });
  });

  // auto-submit sort dropdown
  document.querySelectorAll('[data-autosubmit]').forEach(function (el) {
    el.addEventListener('change', function () { el.form.submit(); });
  });

  // ---------- load cart products from the server ----------
  function loadCart() {
    var cart = read();
    var ids = Object.keys(cart);
    if (!ids.length) return Promise.resolve({ cart: cart, lines: [] });
    return fetch('/api/cart?ids=' + ids.join(','), { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        var known = {};
        var lines = data.products.map(function (p) {
          known[p.id] = true;
          return { product: p, qty: cart[p.id] };
        });
        // Drop products that no longer exist
        var changed = false;
        ids.forEach(function (id) { if (!known[id]) { delete cart[id]; changed = true; } });
        if (changed) write(cart);
        return { cart: cart, lines: lines };
      });
  }

  function thumb(p) {
    return '<span class="cart-thumb">' + (p.image ? '<img src="' + esc(p.image) + '" alt="">' : esc(p.emoji || '📦')) + '</span>';
  }

  // ---------- cart page ----------
  var cartRoot = document.querySelector('[data-cart-page]');
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

  // ---------- checkout ----------
  var checkout = document.querySelector('[data-checkout]');
  if (checkout) {
    var form = document.getElementById('checkout-form');
    var summary = checkout.querySelector('[data-summary]');
    var errorBox = form.querySelector('[data-error]');
    var submit = form.querySelector('[data-submit]');
    var state = { lines: [] };
    var fee = {
      dhaka: parseInt(checkout.getAttribute('data-dhaka'), 10) || 0,
      outside: parseInt(checkout.getAttribute('data-outside'), 10) || 0,
      freeMin: parseInt(checkout.getAttribute('data-free-min'), 10) || 0,
    };

    // Remember the customer's details for next time (on this device only)
    try {
      var saved = JSON.parse(localStorage.getItem('sm_customer') || 'null');
      if (saved) ['name', 'phone', 'address'].forEach(function (k) { if (saved[k]) form.elements[k].value = saved[k]; });
      if (saved && saved.area) form.querySelector('input[name=area][value=' + saved.area + ']').checked = true;
    } catch (e) { /* ignore */ }

    function area() { return form.querySelector('input[name=area]:checked').value; }
    function renderSummary() {
      if (!state.lines.length) {
        summary.innerHTML = '<p>কার্ট খালি।</p><a class="btn" href="/products">পণ্য দেখুন</a>';
        submit.disabled = true;
        return;
      }
      var subtotal = 0;
      var rows = state.lines.map(function (l) {
        subtotal += l.product.price * l.qty;
        return '<div class="cart-line">' + thumb(l.product) + '<div><b>' + esc(l.product.name) + '</b><br><span class="muted small">' +
          bn(l.qty) + ' × ' + money(l.product.price) + '</span></div><div class="line-total">' + money(l.product.price * l.qty) + '</div></div>';
      }).join('');
      var delivery = fee.freeMin > 0 && subtotal >= fee.freeMin ? 0 : fee[area()];
      summary.innerHTML = rows + '<div class="totals">' +
        '<div><span>পণ্যের দাম</span><span>' + money(subtotal) + '</span></div>' +
        '<div><span>ডেলিভারি চার্জ</span><span>' + (delivery ? money(delivery) : 'ফ্রি') + '</span></div>' +
        '<div class="grand"><span>মোট</span><span>' + money(subtotal + delivery) + '</span></div></div>' +
        '<p class="small center"><a href="/cart">কার্ট এডিট করুন</a></p>';
      submit.disabled = false;
    }
    loadCart().then(function (res) { state.lines = res.lines; renderSummary(); })
      .catch(function () { summary.innerHTML = '<p class="form-error">কার্ট লোড করা যায়নি। পেজটি রিফ্রেশ করুন।</p>'; });
    form.addEventListener('change', function (e) { if (e.target.name === 'area') renderSummary(); });
    form.addEventListener('input', function (e) { e.target.classList.remove('invalid'); });

    function showError(msg, field) {
      errorBox.textContent = msg;
      errorBox.hidden = false;
      form.querySelectorAll('.invalid').forEach(function (el) { el.classList.remove('invalid'); });
      if (field && form.elements[field]) { form.elements[field].classList.add('invalid'); form.elements[field].focus(); }
      else errorBox.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      errorBox.hidden = true;
      var data = {
        name: form.elements.name.value.trim(),
        phone: form.elements.phone.value.trim(),
        address: form.elements.address.value.trim(),
        note: form.elements.note.value.trim(),
        area: area(),
        items: state.lines.map(function (l) { return { id: l.product.id, qty: l.qty }; }),
      };
      if (data.name.length < 2) return showError('আপনার নাম লিখুন।', 'name');
      if (!data.phone) return showError('মোবাইল নম্বর লিখুন।', 'phone');
      if (data.address.length < 8) return showError('পূর্ণ ঠিকানা লিখুন, যাতে ডেলিভারিম্যান সহজে খুঁজে পান।', 'address');
      submit.disabled = true;
      submit.textContent = 'অর্ডার পাঠানো হচ্ছে…';
      fetch('/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
        .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, body: j }; }); })
        .then(function (res) {
          if (!res.ok) throw res.body;
          try {
            localStorage.setItem('sm_customer', JSON.stringify({ name: data.name, phone: data.phone, address: data.address, area: data.area }));
          } catch (e2) { /* ignore */ }
          write({});
          location.href = '/order/' + res.body.code + '?new=1';
        })
        .catch(function (err) {
          submit.disabled = false;
          submit.textContent = 'অর্ডার কনফার্ম করুন';
          showError((err && err.error) || 'অর্ডার পাঠানো যায়নি। ইন্টারনেট সংযোগ দেখে আবার চেষ্টা করুন।', err && err.field);
          loadCart().then(function (r) { state.lines = r.lines; renderSummary(); });
        });
    });
  }

  if (document.querySelector('[data-clear-cart]')) write({});
  updateCount();
})();
