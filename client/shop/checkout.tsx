// Checkout (/checkout): order summary, delivery charge, coupon, gift card, points, the unfinished-order draft,
// the checkout OTP (SMS code) and sending the order.
import { h, Fragment, paint } from '../jsx.js';
import { $, $all, bn, cleanPhone, getJson, hit, money, phoneOk, postJson, randomId, readJson, replay, store } from '../dom.js';
import type { GiftcardAnswer, OrderAnswer, OtpAnswer, ResumeAnswer } from '../api-types.js';
import { minNote, minShort, readCart, rule, saveCartQuietly, toPacks, writeCart } from './cart.js';
import { PackChoice, Thumb, VariantChoice, freeBase, giftRows, giftTotal, loadCart, swapInCart, variantTarget, type Gift, type Line } from './cartpage.js';
import { fillGeo } from './geo.js';
import { VA, track } from './track.js';

void Fragment;
type Coupon = { discount?: number; freeDelivery?: boolean; referral?: boolean; code?: string; message?: string; ok?: boolean };
type Points = { on: boolean; points: number; value?: number; maxPct?: number; min?: number; earnPer?: number };
type Zone = { key: 'dhaka' | 'zone' | 'outside'; name: string; fee: number };
type Field = HTMLInputElement & HTMLSelectElement & HTMLTextAreaElement;

export function startCheckout(): void {
  let checkout = $('[data-checkout]');
  // 📩 the link in the "your order isn't finished" SMS: the same products back in the cart, name / number filled in
  const resumeId = (location.search.match(/[?&]resume=([a-f0-9]{20})(?:&|$)/) || [])[1];
  if (checkout && resumeId) {
    checkout.style.opacity = '.4';
    void resume(resumeId);
    checkout = null;
  }
  if (checkout) runCheckout(checkout);
}

async function resume(id: string): Promise<void> {
  try {
    const j = await getJson<ResumeAnswer>(`/api/resume?id=${id}`);
    if (j?.ok && j.items?.length) {
      const c: Record<string, number> = {};
      for (const i of j.items) c[i.id] = (c[i.id] || 0) + i.qty;
      saveCartQuietly(c);
      let old = readJson<Record<string, string>>('sm_customer', {});
      if (j.phone && old.phone !== j.phone) old = {}; // someone else's saved address must not be mixed in
      old.name = old.name || j.name || '';
      old.phone = j.phone || old.phone || '';
      store('sm_customer', JSON.stringify(old));
    }
  } catch { /* the checkout opens anyway */ }
  location.replace('/checkout');
}

function runCheckout(checkout: HTMLElement): void {
  const form = document.getElementById('checkout-form') as HTMLFormElement;
  const el = (name: string) => form.elements.namedItem(name) as Field | null;
  const val = (name: string) => el(name)?.value ?? '';
  const summary = $('[data-summary]', checkout)!;
  const errorBox = $('[data-error]', form)!;
  const submit = $<HTMLButtonElement>('[data-submit]', form)!;
  const zoneNote = $('[data-zone-note]', form);
  const manualBox = $('[data-manual-box]', form);
  const state = { lines: [] as Line[], gifts: [] as Gift[], coupon: null as Coupon | null, couponCode: '', pts: null as Points | null, ptsPhone: '', usePoints: false, gift: null as { code: string; balance: number } | null };

  // loyalty points: same rule as the server (at least `min` points, at most maxPct % of the goods)
  const pointsFor = (goods: number) => {
    const P = state.pts;
    if (!P || !P.on || !P.points) return { points: 0, discount: 0 };
    const cap = Math.floor((Math.max(0, goods) * (P.maxPct || 0)) / 100 / (P.value || 1));
    const n = Math.min(P.points, cap);
    if (n < (P.min || 0)) return { points: 0, discount: 0 };
    return { points: n, discount: Math.round(n * (P.value || 0) * 100) / 100 };
  };
  const num = (k: string, f = parseInt) => f(checkout.getAttribute(k) || '') || 0;
  const fee = {
    dhaka: num('data-dhaka'),
    outside: num('data-outside'),
    freeMin: num('data-free-min'),
    city: JSON.parse(checkout.getAttribute('data-city') || '[]') as string[],
    zones: JSON.parse(checkout.getAttribute('data-zones') || '[]') as { name: string; fee: unknown; districts?: string[] }[],
    perKg: num('data-per-kg', parseFloat),
    freeKg: parseFloat(checkout.getAttribute('data-free-kg') || '') || 1,
  };

  void fillGeo(form).then((g) => {
    if (!g) return;
    try {
      // logged-in customers already have their saved address filled in by the page
      const saved = form.hasAttribute('data-account') ? null : readJson<Record<string, string> | null>('sm_customer', null);
      if (saved) {
        for (const k of ['name', 'phone', 'address']) { const f = el(k); if (saved[k] && f && !f.value) f.value = saved[k]; }
        if (saved.district) { g.district.value = saved.district; g.district.dispatchEvent(new Event('change')); }
        if (saved.thana) g.thana.value = saved.thana;
      }
    } catch { /* ignore */ }
    renderSummary();
  });

  // same rules as the server: Dhaka city → the owner's own zones → outside Dhaka; heavy parcels pay per extra kg
  const zone = (): Zone | null => {
    const d = val('district');
    const t = val('thana');
    if (!d) return null;
    if (d === 'Dhaka' && fee.city.includes(t)) return { key: 'dhaka', name: 'ঢাকা সিটির ভেতরে', fee: fee.dhaka };
    if (d === 'Dhaka' && !t) return null;
    const z = fee.zones.find((x) => (x.districts || []).includes(d));
    if (z) return { key: 'zone', name: z.name, fee: Number(z.fee) || 0 };
    return { key: 'outside', name: 'ঢাকা সিটির বাইরে', fee: fee.outside };
  };
  const weightExtra = () => {
    if (!fee.perKg) return 0;
    const g = state.lines.reduce((s, l) => s + (l.product.weight || 0) * l.qty, 0);
    if (!g) return 0;
    return Math.max(0, Math.ceil(g / 1000 - 1e-9) - fee.freeKg) * fee.perKg;
  };
  const totals = () => {
    const subtotal = state.lines.reduce((s, l) => s + l.price * l.qty, 0) + giftTotal(state.gifts);
    const z = zone();
    let delivery: number | null = z ? z.fee + weightExtra() : null;
    // 🚚 packaging materials don't count towards free delivery (same as the server)
    if (fee.freeMin > 0 && freeBase(state.lines) + giftTotal(state.gifts) >= fee.freeMin) delivery = 0;
    let discount = 0;
    if (state.coupon) {
      discount = Math.min(subtotal, state.coupon.discount || 0);
      if (state.coupon.freeDelivery) delivery = 0;
    }
    const pts = pointsFor(subtotal - discount);
    const exact = Math.round((subtotal - discount - (state.usePoints ? pts.discount : 0) + (delivery || 0)) * 100) / 100;
    const total = Math.max(0, Math.floor(exact + 1e-9)); // whole taka, same as the server: paisa are a rounding discount
    const gift = state.gift ? Math.min(state.gift.balance, total) : 0;
    return {
      subtotal: Math.round(subtotal * 100) / 100, delivery, discount, points: state.usePoints ? pts : null, canPoints: pts,
      total, roundOff: delivery === null ? 0 : Math.round((total - exact) * 100) / 100, gift, due: Math.round((total - gift) * 100) / 100,
    };
  };
  type Totals = ReturnType<typeof totals>;

  const Row = ({ cls, label, value }: { cls?: string; label: string; value: string }) => <div className={cls}><span>{label}</span><span>{value}</span></div>;

  function renderSummary(): void {
    if (!state.lines.length) {
      paint(summary, <p>কার্ট খালি।</p>, <a className="btn" href="/products">পণ্য দেখুন</a>);
      submit.disabled = true;
      return;
    }
    const t = totals();
    const rows = state.lines.map((l) =>
      <div className="cart-line"><Thumb p={l.product} /><div><b>{l.product.name}</b><br />{l.note ? <><span className="small good">{l.note}</span><br /></> : null}
        <span className="muted small">{bn(l.qty)} × {money(l.price)}</span><VariantChoice l={l} /><PackChoice l={l} /></div><div className="line-total">{money(l.price * l.qty)}</div></div>);
    paint(summary, rows, giftRows(state.gifts, 'div'),
      <div className="totals">
        <Row label="পণ্যের দাম" value={money(t.subtotal)} />
        {t.discount ? <Row cls="good" label={`${state.coupon?.referral ? 'রেফারেল ছাড়' : 'কুপন ছাড়'} (${state.couponCode})`} value={`− ${money(t.discount)}`} /> : null}
        {t.points?.points ? <Row cls="good" label={`পয়েন্ট ছাড় (${bn(t.points.points)} পয়েন্ট)`} value={`− ${money(t.points.discount)}`} /> : null}
        <Row label="ডেলিভারি চার্জ" value={t.delivery === null ? 'এলাকা বাছুন' : t.delivery ? money(t.delivery) : 'ফ্রি'} />
        {t.roundOff ? <Row cls={t.roundOff < 0 ? 'good' : undefined} label={t.roundOff > 0 ? 'রাউন্ড ফিগার' : 'রাউন্ড ফিগারের জন্য ছাড়'} value={`${t.roundOff > 0 ? '+ ' : '− '}${money(Math.abs(t.roundOff))}`} /> : null}
        <Row cls="grand" label="মোট" value={money(t.total)} />
        {t.gift ? <><Row cls="good" label="💳 গিফট কার্ড থেকে" value={`− ${money(t.gift)}`} /><Row cls="grand" label="বাকি দিতে হবে" value={money(t.due)} /></> : null}
      </div>,
      <p className="small center"><a href="/cart">কার্ট এডিট করুন</a></p>);
    const z = zone();
    const wx = weightExtra();
    if (zoneNote) zoneNote.textContent = z ? `${z.key === 'dhaka' ? '✓ ' : ''}${z.name} — ডেলিভারি চার্জ ${money(z.fee)}${wx ? ` + ভারী পার্সেলের জন্য ${money(wx)}` : ''}` : '';
    const amt = $('[data-pay-amount]', form);
    if (amt) amt.textContent = money(t.gift ? t.due : t.total);
    const advAmt = $('[data-adv-amount]', form);
    if (advAmt) advAmt.textContent = t.delivery === null ? 'এলাকা বাছুন' : money(t.delivery || 0);
    const short = minShort(t.subtotal);
    let mBox = $('[data-min-note]', checkout);
    if (!mBox) {
      mBox = <p className="min-order-note" data-min-note="" />;
      summary.after(mBox);
    }
    mBox.hidden = !short;
    if (short) paint(mBox, `🔩 ${minNote(t.subtotal)} `, <a href="/products">পণ্য দেখুন →</a>); else paint(mBox);
    submit.disabled = !!short;
    submit.textContent = short ? `আরও ${money(short)} এর পণ্য লাগবে` : `অর্ডার কনফার্ম করুন · ${money(t.gift ? t.due : t.total)}`;
    renderPoints(t);
  }

  const ptsBox = $('[data-points]');
  function renderPoints(t: Totals): void {
    if (!ptsBox) return;
    const P = state.pts;
    if (!P || !P.on) { ptsBox.hidden = true; return; }
    ptsBox.hidden = false;
    const earn = P.earnPer ? Math.floor(Math.max(0, t.subtotal - t.discount - (t.points ? t.points.discount : 0)) / P.earnPer) : 0;
    const earnEl = $('[data-points-earn]', ptsBox);
    if (earnEl) earnEl.textContent = earn > 0 ? `🎁 এই অর্ডার ডেলিভারি হলে পাবেন আরও ${bn(earn)} পয়েন্ট।` : '';
    const use = $('[data-points-use]', ptsBox);
    const text = $('[data-points-text]', ptsBox);
    if (!P.points) {
      if (text) text.textContent = `⭐ প্রতি ${money(P.earnPer)} কেনাকাটায় ১ পয়েন্ট — পরের অর্ডারে টাকার মতো খরচ করা যায়।`;
      if (use) use.hidden = true;
      return;
    }
    const can = t.canPoints;
    if (use) use.hidden = !can.points;
    const have = <>⭐ আপনার <b>{bn(P.points)}</b> পয়েন্ট আছে ({money(P.points * (P.value || 0))})।</>;
    if (!can.points) {
      state.usePoints = false;
      paint(text, have, ' ', <span className="small muted">কমপক্ষে {bn(P.min)} পয়েন্ট হলে খরচ করা যায়।</span>);
    } else {
      paint(text, have);
      const label = $('[data-points-label]', ptsBox);
      if (label) label.textContent = `${bn(can.points)} পয়েন্ট খরচ করে ${money(can.discount)} ছাড় নিন`;
    }
  }
  const phoneNow = () => latinPhone(val('phone'));
  async function loadPoints(): Promise<void> {
    if (!ptsBox) return;
    const ph = phoneNow();
    if (!/^01[3-9]\d{8}$/.test(ph)) { if (state.pts) state.pts.points = 0; renderSummary(); return; }
    if (state.ptsPhone === ph) return;
    state.ptsPhone = ph;
    try {
      const { j } = await postJson<Points>('/api/points', { phone: ph });
      state.pts = j;
      state.usePoints = false;
      const cb = el('use_points');
      if (cb) cb.checked = false;
      renderSummary();
    } catch { /* points are a bonus */ }
  }
  if (ptsBox) {
    state.pts = { on: true, points: 0 };
    postJson<Points>('/api/points', {}).then(({ j }) => { if (!j.on) { state.pts = null; ptsBox.hidden = true; } }).catch(() => {});
    el('phone')?.addEventListener('change', loadPoints);
    el('phone')?.addEventListener('blur', loadPoints);
    ptsBox.addEventListener('change', (e) => {
      const t = e.target as HTMLInputElement;
      if (t.name === 'use_points') { state.usePoints = t.checked; renderSummary(); }
    });
    setTimeout(loadPoints, 1200);
  }

  loadCart().then((res) => {
    state.lines = res.lines;
    state.gifts = res.gifts || [];
    renderSummary();
    const key = `sm_ic_${Object.keys(res.cart).join('-')}`;
    if (res.lines.length && !store(key)) {
      store(key, '1');
      track('begin_checkout', { items: res.lines.map((l) => ({ id: l.product.id, name: l.product.name, price: l.price, qty: l.qty })) });
    }
  }).catch(() => paint(summary, <p className="form-error">কার্ট লোড করা যায়নি। পেজটি রিফ্রেশ করুন।</p>));
  // 📦 a pack product: the customer can still switch the pack here (25 → 50 → 100 pieces)
  summary.addEventListener('click', (e) => {
    const pk = hit(e, '[data-pack-set]');
    if (!pk) return;
    const id = pk.getAttribute('data-pack-set') || '';
    const cart = readCart();
    const l = state.lines.find((x) => String(x.product.id) === id);
    if (!l) return;
    cart[id] = toPacks(Number(pk.getAttribute('data-pack')) || 1, rule(l.product.price, id));
    writeCart(cart);
    loadCart().then((r) => {
      state.lines = r.lines;
      state.gifts = r.gifts || [];
      renderSummary();
      if (state.coupon) cApply?.click(); // the coupon is checked again for the new amount
    }).catch(() => {});
  });
  // 🎨 a colour/size line: switch colour / size here too
  summary.addEventListener('change', (e) => {
    const vs = hit<HTMLSelectElement>(e, 'select[data-var-line]');
    if (!vs) return;
    e.stopPropagation();
    const cart = readCart();
    if (!swapInCart(cart, vs.getAttribute('data-var-line') || '', variantTarget(vs))) return;
    writeCart(cart);
    loadCart().then((r) => {
      state.lines = r.lines;
      state.gifts = r.gifts || [];
      renderSummary();
      if (state.coupon) cApply?.click();
    }).catch(() => {});
  });
  form.addEventListener('change', (e) => {
    const name = (e.target as Field).name;
    if (name === 'district' || name === 'thana') renderSummary();
    if (name === 'payment') syncPay();
  });
  form.addEventListener('input', (e) => (e.target as HTMLElement).classList.remove('invalid'));

  // Incomplete order: once a full mobile number is typed, what's filled in so far is kept for the shop
  // (the notice under the phone box says so), so they can call if the order isn't finished.
  const draft = { on: form.hasAttribute('data-draft'), id: '', last: '', timer: 0 };
  if (draft.on) {
    draft.id = store('sm_draft') || '';
    if (!/^[a-f0-9]{20}$/.test(draft.id)) { draft.id = randomId(); store('sm_draft', draft.id); }
  }
  const saveDraft = () => {
    if (!draft.on || !state.lines.length) return;
    const phone = phoneNow();
    if (!/^01[3-9]\d{8}$/.test(phone)) return;
    const body = JSON.stringify({
      id: draft.id, vid: VA.vid || '', sid: VA.sid || '', name: val('name').trim(), phone,
      district: val('district'), thana: val('thana'), address: val('address').trim(), note: val('note').trim(),
      items: state.lines.map((l) => ({ id: l.product.id, qty: l.qty })),
    });
    if (body === draft.last) return;
    draft.last = body;
    try {
      if (navigator.sendBeacon && document.visibilityState === 'hidden') navigator.sendBeacon('/api/checkout-draft', new Blob([body], { type: 'application/json' }));
      else {
        fetch('/api/checkout-draft', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true })
          .then((r) => r.json() as Promise<{ off?: number } | null>).then((j) => { if (j?.off) draft.on = false; }).catch(() => {});
      }
    } catch { /* ignore */ }
  };
  if (draft.on) {
    const later = () => { clearTimeout(draft.timer); draft.timer = window.setTimeout(saveDraft, 1500); };
    form.addEventListener('input', later);
    form.addEventListener('change', later);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') { clearTimeout(draft.timer); saveDraft(); } });
    setTimeout(saveDraft, 4000); // a returning customer's number is already filled in
  }

  // Send Money box: for a Send Money method (whole amount), or cash on delivery with "delivery charge first"
  function syncPay(): void {
    const c = form.querySelector<HTMLInputElement>('input[name=payment]:checked');
    const manual = !!c && c.getAttribute('data-manual') === '1';
    const adv = !!c && !!c.getAttribute('data-advance');
    if (manualBox) manualBox.hidden = !(manual || adv);
    const mt = $('[data-manual-text]', form);
    const at = $('[data-adv-text]', form);
    if (mt) mt.hidden = !manual;
    if (at) at.hidden = !adv;
    const setText = (sel: string, v: string) => { const x = $(sel, form); if (x) x.textContent = v; };
    if (manual && c) setText('[data-pay-number]', c.getAttribute('data-number') || '');
    if (adv && c) {
      setText('[data-adv-number]', c.getAttribute('data-number') || '');
      setText('[data-adv-label]', c.getAttribute('data-number-label') || '');
      const t = totals();
      setText('[data-adv-amount]', t.delivery === null ? 'এলাকা বাছুন' : money(t.delivery || 0));
    }
  }
  syncPay();

  // coupon
  const cBox = $('[data-coupon]', checkout);
  const cMsg = $('[data-coupon-msg]', cBox);
  const cApply = $('[data-apply-coupon]', cBox);
  cApply?.addEventListener('click', async () => {
    const code = ($<HTMLInputElement>('#coupon', cBox)?.value || '').trim();
    if (!cMsg) return;
    if (!code) { state.coupon = null; state.couponCode = ''; cMsg.textContent = ''; renderSummary(); return; }
    cMsg.textContent = 'যাচাই হচ্ছে…';
    try {
      const { j } = await postJson<Coupon>('/api/coupon', { code, subtotal: totals().subtotal, phone: val('phone'), items: state.lines.map((l) => ({ id: l.product.id, qty: l.qty })) });
      cMsg.textContent = j.message || '';
      cMsg.className = `small ${j.ok ? 'good' : 'warn'}`;
      state.coupon = j.ok ? j : null;
      state.couponCode = j.ok ? j.code || '' : '';
      renderSummary();
    } catch { cMsg.textContent = 'যাচাই করা যায়নি, আবার চেষ্টা করুন।'; }
  });
  // a friend's referral link (?ref=…) filled the box: check it once the cart is loaded
  if ($('#coupon[data-auto-apply]', cBox)) {
    setTimeout(() => {
      if (val('phone')) cApply?.click();
      else if (cMsg) cMsg.textContent = 'বন্ধুর রেফারেল কোড বসানো আছে — মোবাইল নম্বর লিখে "প্রয়োগ" চাপুন।';
    }, 1500);
  }
  // 💳 gift card
  const gBox = $('[data-gift]', checkout);
  if (gBox) {
    const gMsg = $('[data-gift-msg]', gBox)!;
    $('[data-apply-gift]', gBox)?.addEventListener('click', async () => {
      const code = ($<HTMLInputElement>('#giftcode', gBox)?.value || '').trim();
      if (!code) { state.gift = null; gMsg.textContent = ''; renderSummary(); return; }
      gMsg.textContent = 'যাচাই হচ্ছে…';
      try {
        const { j } = await postJson<GiftcardAnswer>('/api/giftcard', { code });
        state.gift = j.ok ? { code: j.code, balance: Number(j.balance) } : null;
        gMsg.className = `small ${j.ok ? 'good' : 'warn'}`;
        gMsg.textContent = j.ok ? `${j.message} — এই অর্ডারে কাটা হবে।` : j.message;
        renderSummary();
      } catch { gMsg.textContent = 'যাচাই করা যায়নি, আবার চেষ্টা করুন।'; }
    });
  }
  // 📍 a saved address (logged-in customers)
  const sAddr = $<HTMLSelectElement>('[data-saved-addr]', form);
  sAddr?.addEventListener('change', () => {
    const opt = sAddr.options[sAddr.selectedIndex];
    let a: Record<string, string> | null = null;
    try { a = JSON.parse(opt.getAttribute('data-a') || 'null'); } catch { a = null; }
    const f = (k: string) => el(k)!;
    if (!a) { f('address').value = ''; f('address').focus(); return; }
    f('name').value = a.name || f('name').value;
    f('phone').value = a.phone || f('phone').value;
    f('address').value = a.address || '';
    f('district').value = a.district;
    f('district').dispatchEvent(new Event('change', { bubbles: true }));
    f('thana').value = a.thana;
    f('thana').dispatchEvent(new Event('change', { bubbles: true }));
    void loadPoints();
  });

  const otp = checkoutOtp(form, val, el, errorBox, submit, showError);

  function showError(msg: string, field?: string): void {
    errorBox.textContent = msg;
    errorBox.hidden = false;
    for (const x of $all('.invalid', form)) x.classList.remove('invalid');
    const f = field ? el(field) : null;
    if (f) { f.classList.add('invalid'); f.focus(); } else errorBox.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorBox.hidden = true;
    const pay = form.querySelector<HTMLInputElement>('input[name=payment]:checked');
    const data: Record<string, unknown> & { name: string; phone: string; address: string; district: string; thana: string } = {
      name: val('name').trim(), phone: val('phone').trim(), address: val('address').trim(),
      district: val('district'), thana: val('thana'), note: val('note').trim(),
      payment: pay ? pay.value : 'cod', coupon: state.couponCode,
      trx: el('trx') ? val('trx').trim() : '', payment_number: el('payment_number') ? val('payment_number').trim() : '',
      items: state.lines.map((l) => ({ id: l.product.id, qty: l.qty })),
      use_points: state.usePoints ? '1' : '', gift_code: state.gift ? state.gift.code : '',
    };
    const sub = totals().subtotal;
    if (minShort(sub)) return showError(minNote(sub));
    if (data.name.length < 2) return showError('আপনার নাম লিখুন।', 'name');
    if (!data.phone) return showError('মোবাইল নম্বর লিখুন।', 'phone');
    if (!data.district) return showError('জেলা বাছুন।', 'district');
    if (!data.thana) return showError('থানা / উপজেলা বাছুন।', 'thana');
    if (data.address.length < 5) return showError('পূর্ণ ঠিকানা লিখুন, যাতে ডেলিভারিম্যান সহজে খুঁজে পান।', 'address');
    const consentBox = $<HTMLInputElement>('[data-consent]', form);
    if (consentBox && !consentBox.checked) return showError('অর্ডার করতে নিচের ঘরে টিক দিয়ে আপনার তথ্য ব্যবহারে সম্মতি দিন।', 'consent');
    data.consent = consentBox ? (consentBox.checked ? '1' : '') : '1';
    data.promo = $<HTMLInputElement>('[data-promo]', form)?.checked ? '1' : '';
    if (el('email')) {
      data.email = val('email').trim();
      if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(data.email))) return showError('ইমেইল ঠিকানাটা ঠিক নেই (অথবা খালি রাখুন)।', 'email');
    }
    if (otp) {
      const p = cleanPhone(data.phone);
      if (!phoneOk(p)) return showError('সঠিক মোবাইল নম্বর দিন, যেমন 01712345678।', 'phone');
      if (!otp.ready(p)) { otp.beforeSubmit(p); return undefined; }
      data.otp_token = otp.token();
    }
    submit.disabled = true;
    submit.textContent = 'অর্ডার পাঠানো হচ্ছে…';
    try {
      const res = await postJson<OrderAnswer>('/api/orders', data);
      if (!res.ok) throw res.j;
      store('sm_customer', JSON.stringify({ name: data.name, phone: data.phone, address: data.address, district: data.district, thana: data.thana }));
      draft.on = false;
      clearTimeout(draft.timer);
      store('sm_draft', '');
      writeCart({});
      location.href = res.j.redirect || `/order/${res.j.code}?new=1`;
    } catch (err) {
      const x = err as OrderAnswer | undefined; // the server's answer (thrown above), or a network error
      submit.disabled = false;
      renderSummary();
      if (x?.otp && otp) otp.rejected();
      showError(x?.error || 'অর্ডার পাঠানো যায়নি। ইন্টারনেট সংযোগ দেখে আবার চেষ্টা করুন।', x?.field);
      loadCart().then((r) => { state.lines = r.lines; renderSummary(); }).catch(() => {});
    }
    return undefined;
  });
}

/** Bangla or English digits, +88 / 88 in front or not → 01XXXXXXXXX (for points and the draft) */
const latinPhone = (v: string): string => cleanPhone(v).replace(/^88/, '');

// ---------- 🔐 চেকআউট OTP: the mobile number is checked with an SMS code before the order goes in ----------
// The box shows only when this number still needs a code (not when the customer is logged in with it,
// or it was already checked in this browser). Typing the full code checks it at once — no extra button.
function checkoutOtp(
  form: HTMLFormElement, val: (n: string) => string, el: (n: string) => Field | null,
  errorBox: HTMLElement, submit: HTMLButtonElement, showError: (msg: string, field?: string) => void,
) {
  const box = $('[data-otp]', form);
  if (!box) return null;
  const code = $<HTMLInputElement>('[data-otp-code]', box)!;
  const send = $<HTMLButtonElement>('[data-otp-send]', box)!;
  const msg = $('[data-otp-msg]', box)!;
  const help = $('[data-otp-help]', box);
  const done = $('[data-otp-done]', form)!;
  const otp = { okPhone: '', token: '', asked: '', sentTo: '', timer: 0, watch: 0, busy: false, after: false, len: 4, abort: null as AbortController | null };
  const phone = () => cleanPhone(val('phone'));
  const post = (what: string, body: unknown) => postJson<OtpAnswer>(`/api/checkout-otp/${what}`, body).then(({ ok, j }) => ({ ...j, httpOk: ok }));
  const sayOtp = (t: string, kind?: string) => { msg.textContent = t || ''; msg.className = `otp-msg small${kind ? ` ${kind}` : ''}`; };
  const shake = () => replay(box, 'shake');
  const sendAgain = (label: string, disabled: boolean) => { send.disabled = disabled; send.textContent = label; };
  const goSubmit = () => { if (form.requestSubmit) form.requestSubmit(submit); else submit.click(); };
  const countdown = (sec: number) => {
    clearInterval(otp.timer);
    let left = Math.max(1, sec | 0);
    const tick = () => {
      if (left <= 0) { clearInterval(otp.timer); sendAgain('আবার পাঠান', false); if (help) help.hidden = false; return; }
      sendAgain(`আবার পাঠান (${bn(left)})`, true);
      left--;
    };
    tick();
    otp.timer = window.setInterval(tick, 1000);
  };
  // "verified" look: green line instead of the box
  const markOk = (p: string, token: string, text?: string) => {
    otp.okPhone = p;
    otp.token = token || '';
    clearInterval(otp.timer);
    if (otp.abort) { try { otp.abort.abort(); } catch { /* ignore */ } otp.abort = null; }
    box.hidden = true;
    done.textContent = text || '✅ নম্বর যাচাই হয়েছে';
    done.hidden = false;
    el('phone')?.classList.remove('invalid');
    if (errorBox.textContent && /যাচাই|কোড|OTP/.test(errorBox.textContent)) errorBox.hidden = true;
  };
  const reset = () => {
    otp.okPhone = '';
    otp.token = '';
    otp.sentTo = '';
    clearInterval(otp.timer);
    sendAgain('OTP পাঠান', false);
    code.value = '';
    sayOtp('');
    if (help) help.hidden = true;
    done.hidden = true;
  };
  // does the typed number need a code?
  const checkPhone = () => {
    const p = phone();
    if (p === otp.asked) return;
    otp.asked = p;
    reset();
    if (!phoneOk(p)) { box.hidden = true; return; }
    box.hidden = false; // shown at once; hidden again if this number is already checked
    post('status', { phone: p }).then((j) => {
      if (phone() !== p) return;
      if (j?.need === false) markOk(p, '', /acct|account/.test(j.why || '') ? '✅ আপনি লগইন করা আছেন — কোড লাগবে না' : '✅ নম্বর যাচাই করা আছে');
    }).catch(() => { /* box stays: the code can still be asked for */ });
  };
  // Android Chrome: fill the code in by itself from the SMS (only when Admin adds the "@domain #code" line)
  const webOtp = () => {
    if (!('OTPCredential' in window)) return;
    try {
      otp.abort = new AbortController();
      (navigator.credentials.get({ otp: { transport: ['sms'] }, signal: otp.abort.signal } as CredentialRequestOptions) as Promise<(Credential & { code?: string }) | null>)
        .then((c) => { if (c?.code && !otp.okPhone) { code.value = c.code; void verify(); } })
        .catch(() => { /* the customer types it */ });
    } catch { /* not supported */ }
  };
  const sendCode = async (): Promise<boolean> => {
    const p = phone();
    if (!phoneOk(p)) { showError('আগে সঠিক মোবাইল নম্বর লিখুন, যেমন 01712345678।', 'phone'); return false; }
    if (otp.busy) return false;
    otp.busy = true;
    sendAgain('পাঠানো হচ্ছে…', true);
    sayOtp('');
    try {
      const j = await post('send', { phone: p });
      otp.busy = false;
      if (phone() !== p) { reset(); return false; }
      if (j.need === false) { markOk(p, '', '✅ নম্বর যাচাই করা আছে'); return true; }
      if (!j.sent) {
        sendAgain('OTP পাঠান', false);
        sayOtp(j.error || 'কোড পাঠানো যায়নি। আবার চেষ্টা করুন।', 'bad');
        if (help) help.hidden = false;
        return false;
      }
      otp.sentTo = p;
      otp.len = j.len || 4;
      code.maxLength = otp.len;
      sayOtp(`${j.message || 'কোড পাঠানো হয়েছে।'} কোডটা পাশের ঘরে লিখুন।`, 'ok');
      countdown(j.wait || 60);
      try { code.focus({ preventScroll: true }); } catch { code.focus(); }
      webOtp();
      // 📱 75 seconds later, still no code typed: ask whether the SMS really left the shop's phone
      clearTimeout(otp.watch);
      otp.watch = window.setTimeout(() => {
        if (otp.okPhone === p || otp.sentTo !== p) return;
        post('smscheck', { phone: p }).then((c) => {
          if (!c.stuck || otp.okPhone === p) return;
          sayOtp('দুঃখিত, SMS আসতে দেরি হচ্ছে। একটু পরে "আবার পাঠান" চাপুন, অথবা আমাদের কল করে অর্ডার দিন।', 'bad');
          if (help) help.hidden = false;
        }).catch(() => {});
      }, 75000);
      return true;
    } catch {
      otp.busy = false;
      sendAgain('OTP পাঠান', false);
      sayOtp('ইন্টারনেট সংযোগে সমস্যা — আবার "OTP পাঠান" চাপুন।', 'bad');
      return false;
    }
  };
  const verify = async () => {
    const p = phone();
    const c = cleanPhone(code.value);
    if (otp.busy || c.length !== otp.len || !phoneOk(p)) return;
    otp.busy = true;
    sayOtp('যাচাই করা হচ্ছে…');
    try {
      const j = await post('verify', { phone: p, code: c });
      otp.busy = false;
      if (j.ok && j.token) {
        markOk(p, j.token);
        if (otp.after) { otp.after = false; goSubmit(); }
        return;
      }
      otp.after = false;
      code.value = '';
      shake();
      sayOtp(j.error || 'কোডটা মেলেনি। আবার লিখুন।', 'bad');
      if (j.expired) { clearInterval(otp.timer); sendAgain('আবার পাঠান', false); }
      code.focus();
    } catch {
      otp.busy = false;
      sayOtp('ইন্টারনেট সংযোগে সমস্যা — কোডটা আবার লিখুন।', 'bad');
    }
  };
  send.addEventListener('click', () => { void sendCode(); });
  code.addEventListener('input', () => {
    const c = cleanPhone(code.value).slice(0, otp.len);
    if (code.value !== c) code.value = c;
    if (c.length === otp.len) void verify();
  });
  code.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); void verify(); } });
  let phoneTimer = 0;
  el('phone')?.addEventListener('input', () => { clearTimeout(phoneTimer); phoneTimer = window.setTimeout(checkPhone, 500); });
  el('phone')?.addEventListener('change', checkPhone);
  // a saved address / returning customer fills the number in by itself
  form.addEventListener('change', (e) => { if ((e.target as Element)?.hasAttribute?.('data-saved-addr')) setTimeout(checkPhone, 50); });
  setTimeout(checkPhone, 300);
  setTimeout(checkPhone, 1500);

  return {
    ready: (p: string) => !!otp.okPhone && otp.okPhone === p,
    token: () => otp.token,
    // at "অর্ডার কনফার্ম করুন" without a checked number: send / check the code, then the order goes by itself
    beforeSubmit(p: string): void {
      box.hidden = false;
      box.scrollIntoView({ block: 'center', behavior: 'smooth' });
      shake();
      const typed = cleanPhone(code.value);
      if (otp.sentTo === p && typed.length === otp.len) { otp.after = true; void verify(); return; }
      if (otp.sentTo !== p) {
        void sendCode().then((ok) => {
          if (ok && otp.okPhone === p) { goSubmit(); return; }
          if (ok) { otp.after = true; showError('আপনার মোবাইলে একটা কোড পাঠানো হয়েছে — কোডটা লিখলেই অর্ডার চলে যাবে।'); }
        });
        return;
      }
      otp.after = true;
      showError('মোবাইলে আসা কোডটা লিখুন — লিখলেই অর্ডার চলে যাবে।');
      code.focus();
    },
    rejected(): void { otp.asked = ''; checkPhone(); },
  };
}
