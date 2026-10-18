// Small forms and boxes: reviews, "tell me when it's back", questions, price alerts, account, returns, gift cards,
// offer notifications, delivery date, the order page's number check, sharing, project kits and the e-mail list.
import { h, paint } from '../jsx.js';
import { $, $all, bn, cleanPhone, copyText, hit, money, postJson, shrinkPhoto, store } from '../dom.js';
import type { GiftcardAnswer, MessageAnswer, OtpAnswer } from '../api-types.js';
import type { ShopConfig } from '../shop-config.js';
import { readCart, toastLink, writeCart } from './cart.js';
import { fillGeo } from './geo.js';
import { track } from './track.js';

const SM: Partial<ShopConfig> = window.SM || {};
type Answer = { ok: boolean; j: MessageAnswer };

export function startForms(): void {
  reviews();
  simpleForms();
  account();
  returns();
  giftCards();
  offerNotifications();
  deliveryDate();
  orderPhoneCheck();
  share();
  kit();
  newsletter();
}

/** "পাঠানো হচ্ছে…" → the server's answer, in the form's message line. */
function answerIn(msg: HTMLElement, x: Answer, fallback: string): void {
  msg.textContent = x.ok ? x.j.message ?? null : x.j.error || fallback; // (no message → empty, as before)
  msg.className = `small ${x.ok ? 'good' : 'warn'}`;
}
const field = (f: HTMLFormElement, name: string) => f.elements.namedItem(name) as HTMLInputElement;

// ---------- review forms (order page, after delivery) ----------
const photosOf = new WeakMap<HTMLFormElement, string[]>();
function reviews(): void {
  // 📸 photo picker for review forms (several on one page): photos made small in the browser, kept on the form
  for (const pick of $all<HTMLInputElement>('[data-photo-pick]')) {
    const holder = pick.closest('form')!;
    const thumbs = $('[data-photo-thumbs]', holder);
    const max = Number(pick.getAttribute('data-photo-max')) || 3;
    photosOf.set(holder, []);
    const draw = () => paint(thumbs, (photosOf.get(holder) || []).map((src, i) =>
      <button type="button" className="thumb-x" data-photo-del={String(i)} aria-label="ছবি সরান"><img src={src} alt="" /></button>));
    pick.addEventListener('change', async () => {
      const have = photosOf.get(holder) || [];
      const list = await Promise.all(Array.from(pick.files || []).slice(0, max - have.length).map(shrinkPhoto));
      photosOf.set(holder, have.concat(list.filter((x): x is string => !!x)).slice(0, max));
      draw();
      pick.value = '';
    });
    thumbs?.addEventListener('click', (e) => {
      const b = hit(e, '[data-photo-del]');
      if (!b) return;
      photosOf.get(holder)?.splice(Number(b.getAttribute('data-photo-del')), 1);
      draw();
    });
  }
  for (const rf of $all<HTMLFormElement>('[data-review-form]')) {
    rf.addEventListener('submit', async (e) => {
      e.preventDefault();
      const msg = $('[data-review-msg]', rf)!;
      const btn = $<HTMLButtonElement>('button', rf)!;
      const r = rf.querySelector<HTMLInputElement>('input[name=rating]:checked');
      const d = {
        code: rf.getAttribute('data-code'), product: Number(rf.getAttribute('data-product')), rating: r ? Number(r.value) : 5,
        name: field(rf, 'name').value.trim(), body: field(rf, 'body').value.trim(), website: field(rf, 'website').value, photos: photosOf.get(rf) || [],
      };
      if (d.body.length < 5) { msg.textContent = 'আপনার মতামত একটু লিখুন।'; return; }
      btn.disabled = true;
      msg.textContent = 'পাঠানো হচ্ছে…';
      try {
        const x = await postJson<MessageAnswer>('/api/review', d);
        answerIn(msg, x, 'পাঠানো যায়নি।');
        if (x.ok) {
          for (const el of $all('fieldset, label, button', rf)) el.hidden = true;
          const det = rf.closest('details');
          const sm = det?.querySelector('summary');
          if (sm) sm.hidden = true;
          if (det) det.open = true;
        } else btn.disabled = false;
      } catch { msg.textContent = 'পাঠানো যায়নি, আবার চেষ্টা করুন।'; btn.disabled = false; }
    });
  }
}

// ---------- 🔔 "tell me when it's back", ❓ questions, 🔔 "দাম কমলে জানাও" ----------
function simpleForms(): void {
  const phoneForm = (sel: string, url: string, after?: () => void) => {
    for (const f of $all<HTMLFormElement>(sel)) {
      f.addEventListener('submit', async (e) => {
        e.preventDefault();
        const msg = $('[data-notify-msg]', f)!;
        const btn = $<HTMLButtonElement>('button', f)!;
        const phone = field(f, 'phone').value.trim();
        if (phone.replace(/\D/g, '').length < 11) { msg.textContent = 'সঠিক মোবাইল নম্বর দিন, যেমন 01712345678।'; msg.className = 'small warn'; return; }
        btn.disabled = true;
        msg.textContent = 'পাঠানো হচ্ছে…';
        msg.className = 'small';
        try {
          const x = await postJson<MessageAnswer>(url, { product: Number(f.getAttribute('data-product')), phone, website: field(f, 'website').value });
          answerIn(msg, x, 'হয়নি, আবার চেষ্টা করুন।');
          if (x.ok) after?.();
        } catch { msg.textContent = 'হয়নি, আবার চেষ্টা করুন।'; msg.className = 'small warn'; }
        btn.disabled = false;
      });
    }
  };
  phoneForm('[data-notify]', '/api/stock-alert', () => track('lead', { method: 'restock' }));
  phoneForm('[data-price-alert]', '/api/price-alert');

  for (const f of $all<HTMLFormElement>('[data-qa-form]')) {
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const msg = $('[data-qa-msg]', f)!;
      const btn = $<HTMLButtonElement>('button', f)!;
      const d = { product: Number(f.getAttribute('data-product')), question: field(f, 'question').value.trim(), name: field(f, 'name').value.trim(), phone: field(f, 'phone').value.trim(), website: field(f, 'website').value };
      if (d.question.length < 5) { msg.textContent = 'প্রশ্নটা একটু বিস্তারিত লিখুন।'; msg.className = 'small warn'; return; }
      btn.disabled = true;
      msg.textContent = 'পাঠানো হচ্ছে…';
      msg.className = 'small';
      try {
        const x = await postJson<MessageAnswer>('/api/question', d);
        answerIn(msg, x, 'পাঠানো যায়নি।');
        if (x.ok) field(f, 'question').value = '';
      } catch { msg.textContent = 'পাঠানো যায়নি, আবার চেষ্টা করুন।'; }
      btn.disabled = false;
    });
  }
}

// ---------- 👤 account: address forms, confirm buttons, referral link ----------
function account(): void {
  for (const f of $all('[data-geo-form]')) void fillGeo(f);
  for (const f of $all<HTMLFormElement>('form[data-confirm-shop]')) f.addEventListener('submit', (e) => { if (!confirm(f.getAttribute('data-confirm-shop') || '')) e.preventDefault(); });
  for (const i of $all<HTMLInputElement>('[data-select-all]')) i.addEventListener('focus', () => i.select());
}

// ---------- ↩️ return request: photos made small in the browser (max 4) ----------
function returns(): void {
  const rp = $<HTMLInputElement>('[data-return-photos]');
  if (!rp) return;
  const data = $<HTMLInputElement>('[data-return-photo-data]');
  const thumbs = $('[data-return-thumbs]');
  let shots: string[] = [];
  rp.addEventListener('change', async () => {
    const list = await Promise.all(Array.from(rp.files || []).slice(0, 4 - shots.length).map(shrinkPhoto));
    shots = shots.concat(list.filter((x): x is string => !!x)).slice(0, 4);
    if (data) data.value = JSON.stringify(shots);
    paint(thumbs, shots.map((d) => <img src={d} alt="" />));
    rp.value = '';
  });
}

// ---------- 🎁 gift card balance check ----------
function giftCards(): void {
  const gc = $<HTMLFormElement>('[data-gift-check]');
  gc?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const out = $('[data-gift-check-msg]')!;
    out.textContent = 'দেখা হচ্ছে…';
    try {
      const { j } = await postJson<GiftcardAnswer>('/api/giftcard', { code: field(gc, 'code').value });
      out.textContent = j.message;
      out.className = `small ${j.ok ? 'good' : 'warn'}`;
    } catch { out.textContent = 'দেখা যায়নি।'; }
  });
  $('[data-gift-custom]')?.addEventListener('focus', () => { const r = $<HTMLInputElement>('input[name=amount][value=custom]'); if (r) r.checked = true; });
}

// ---------- 🔔 offer notifications (a small box once; the footer link any time) ----------
function offerNotifications(): void {
  const PU = SM.push;
  const pushOk = !!PU && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const key = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')), (c) => c.charCodeAt(0));
  const pushOn = async (fromLink: boolean) => {
    if (!pushOk) { if (fromLink) toastLink('এই ব্রাউজারে নোটিফিকেশন চলে না। ফোনে Chrome দিয়ে খুলুন।', undefined, 4500); return; }
    if (Notification.permission === 'denied') { toastLink('এই ব্রাউজারে নোটিফিকেশন বন্ধ করা আছে। ঠিকানার পাশের 🔒 চিহ্ন → Notifications → Allow করুন।', undefined, 6000); return; }
    try {
      const reg = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key(PU.key) }));
      const ua = navigator.userAgent;
      const r = await fetch('/api/push/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sub: sub.toJSON(), device: /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iPhone' : 'Computer' }) });
      if (!r.ok) throw new Error('save');
      store('sm_push', 'on');
      toastLink('🔔 ঠিক আছে! নতুন অফার এলেই জানাব।', undefined, 3500);
      track('lead', { method: 'push' });
    } catch {
      if (Notification.permission !== 'granted') store('sm_push', 'no');
      else toastLink('নোটিফিকেশন চালু করা গেল না, পরে আবার চেষ্টা করুন।', undefined, 3500);
    }
  };
  document.addEventListener('click', (e) => { if (hit(e, '[data-push-ask]')) { e.preventDefault(); void pushOn(true); } });
  if (!pushOk || !PU.ask || Notification.permission !== 'default' || store('sm_push') || /^\/(checkout|order|account)/.test(location.pathname)) return;
  const seen = Number(store('sm_pv') || 0) + 1;
  store('sm_pv', String(seen));
  if (seen < 2) return;
  setTimeout(() => {
    if (store('sm_push')) return;
    const box = (
      <div className="push-ask"><p>🔔 {PU.text}</p>
        <div><button type="button" className="btn btn-sm" data-push-yes="">হ্যাঁ, জানাবেন</button><button type="button" className="btn btn-sm btn-ghost" data-push-no="">এখন না</button></div></div>
    );
    document.body.appendChild(box);
    box.addEventListener('click', (e) => {
      if (hit(e, '[data-push-yes]')) { box.remove(); void pushOn(false); }
      if (hit(e, '[data-push-no]')) { box.remove(); store('sm_push', `later:${Date.now()}`); }
    });
  }, PU.delay * 1000);
}

// ---------- 🚚 "order now, it arrives on …" (Dhaka time; after the cut-off hour the count starts tomorrow) ----------
function deliveryDate(): void {
  const el = $('[data-del-eta]');
  if (!el) return;
  try {
    const parts: Record<string, string> = {};
    for (const p of new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(new Date())) parts[p.type] = p.value;
    const late = Number(parts.hour) >= (Number(el.getAttribute('data-cutoff')) || 17);
    const extra = Number(el.getAttribute('data-extra')) || 0;
    const base = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)) + ((late ? 1 : 0) + extra) * 864e5;
    const fmt = (ms: number, withMonth: boolean) => new Date(ms).toLocaleDateString('bn-BD', withMonth ? { day: 'numeric', month: 'long', timeZone: 'UTC' } : { day: 'numeric', timeZone: 'UTC' });
    const range = (v: string | null) => {
      const m = String(v || '').match(/^(\d{1,2})(?:-(\d{1,2}))?$/);
      if (!m) return '';
      const a = base + Number(m[1]) * 864e5;
      const b = base + Number(m[2] || m[1]) * 864e5;
      if (a === b) return fmt(a, true);
      return new Date(a).getUTCMonth() === new Date(b).getUTCMonth() ? `${fmt(a, false)}–${fmt(b, true)}` : `${fmt(a, true)} – ${fmt(b, true)}`;
    };
    const d = range(el.getAttribute('data-dhaka'));
    const o = range(el.getAttribute('data-outside'));
    if (!d && !o) return;
    el.textContent = `📅 ${extra ? 'প্রি-অর্ডার — আজ অর্ডার করলে আনুমানিক পৌঁছাবে' : late ? 'এখন অর্ডার করলে পৌঁছাবে' : 'আজ অর্ডার করলে পৌঁছাবে'} — ঢাকায়: ${d} · ঢাকার বাইরে: ${o}`;
    el.hidden = false;
  } catch { /* old browser: the delivery days above are enough */ }
}

// ---------- 🙋 order page: a new mobile number must pass the SMS code (when চেকআউট OTP is on) ----------
function orderPhoneCheck(): void {
  for (const f of $all<HTMLFormElement>('[data-self-edit][data-otp-need]')) {
    const orig = f.getAttribute('data-phone');
    const ph = $<HTMLInputElement>('[data-self-phone]', f)!;
    const box = $('[data-self-otp]', f)!;
    const code = $<HTMLInputElement>('[data-self-code]', f)!;
    const send = $<HTMLButtonElement>('[data-self-send]', f)!;
    const msg = $('[data-self-msg]', f)!;
    const tok = $<HTMLInputElement>('[data-self-token]', f)!;
    let okPhone = '';
    let timer = 0;
    let len = 4;
    let busy = false;
    const say = (t: string, k?: string) => { msg.textContent = t; msg.className = `otp-msg small${k ? ` ${k}` : ''}`; };
    const post = (w: string, b: unknown) => postJson<OtpAnswer>(`/api/checkout-otp/${w}`, b).then((x) => x.j);
    const sync = () => { const p = cleanPhone(ph.value); box.hidden = p === orig || p === okPhone; if (p !== okPhone) tok.value = ''; };
    ph.addEventListener('input', sync);
    send.addEventListener('click', async () => {
      const p = cleanPhone(ph.value);
      if (!/^01[3-9]\d{8}$/.test(p)) { say('সঠিক মোবাইল নম্বর দিন।', 'bad'); return; }
      send.disabled = true;
      say('পাঠানো হচ্ছে…');
      try {
        const j = await post('send', { phone: p });
        if (j.need === false) { okPhone = p; sync(); return; }
        if (!j.sent) { send.disabled = false; say(j.error || 'কোড পাঠানো যায়নি।', 'bad'); return; }
        len = j.len || 4;
        code.maxLength = len;
        say(`${j.message || 'কোড পাঠানো হয়েছে।'} কোডটা লিখুন।`, 'ok');
        code.focus();
        let left = j.wait || 60;
        clearInterval(timer);
        timer = window.setInterval(() => {
          left--;
          send.textContent = left > 0 ? `আবার পাঠান (${bn(left)})` : 'আবার পাঠান';
          if (left <= 0) { clearInterval(timer); send.disabled = false; }
        }, 1000);
      } catch { send.disabled = false; say('ইন্টারনেট সংযোগে সমস্যা।', 'bad'); }
    });
    code.addEventListener('input', async () => {
      const c = cleanPhone(code.value);
      if (c.length < len || busy) return;
      const p = cleanPhone(ph.value);
      busy = true;
      try {
        const j = await post('verify', { phone: p, code: c });
        busy = false;
        if (j.ok) { tok.value = j.token || ''; okPhone = p; say('✅ নম্বর যাচাই হয়েছে', 'ok'); setTimeout(sync, 800); }
        else { code.value = ''; say(j.error || 'কোড মেলেনি।', 'bad'); if (j.expired) send.disabled = false; }
      } catch { busy = false; say('ইন্টারনেট সংযোগে সমস্যা — কোডটা আবার লিখুন।', 'bad'); }
    });
    f.addEventListener('submit', (e) => {
      const p = cleanPhone(ph.value);
      if (p !== orig && p !== okPhone && !tok.value) { e.preventDefault(); box.hidden = false; say('নতুন নম্বরটি আগে যাচাই করুন — "OTP পাঠান" চাপুন।', 'bad'); }
    });
  }
}

// ---------- 📤 share a product ----------
function share(): void {
  const mobile = /Android|iPhone|iPad/i.test(navigator.userAgent);
  for (const box of $all('[data-share]')) {
    const url = box.getAttribute('data-url') || location.origin + location.pathname;
    const title = box.getAttribute('data-title') || document.title;
    const text = box.getAttribute('data-text') || title;
    const u = encodeURIComponent(url);
    const msg = $('[data-share-msg]', box);
    const set = (k: string, href: string) => { const a = $<HTMLAnchorElement>(`[data-share-to="${k}"]`, box); if (a) a.href = href; };
    set('fb', `https://www.facebook.com/sharer/sharer.php?u=${u}`);
    set('ms', mobile ? `fb-messenger://share/?link=${u}` : `https://www.facebook.com/dialog/send?link=${u}&redirect_uri=${u}&app_id=`);
    set('wa', `https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`);
    if (!mobile) { const ms = $('[data-share-to="ms"]', box); if (ms) ms.hidden = true; }
    const nat = $('[data-share-native]', box);
    if (nat && 'share' in navigator) {
      nat.hidden = false;
      nat.addEventListener('click', () => { navigator.share({ title, text, url }).catch(() => {}); });
    }
    $('[data-share-copy]', box)?.addEventListener('click', async () => {
      if (msg && await copyText(url, 'লিংকটা কপি করুন:')) { msg.textContent = '✓ লিংক কপি হয়েছে'; setTimeout(() => { msg.textContent = ''; }, 2500); }
    });
    box.addEventListener('click', (e) => { const a = hit(e, '[data-share-to]'); if (a) track('share', { method: a.getAttribute('data-share-to') || '' }); });
  }
}

// ---------- 🧰 project kit: tick the parts you need, change amounts, all into the cart at once ----------
function kit(): void {
  const kp = $('[data-kit-page]');
  if (!kp) return;
  const rows = $all('[data-kit-item]', kp);
  const qty = (r: Element) => Math.max(1, parseInt($<HTMLInputElement>('[data-kit-qty]', r)?.value || '', 10) || 1);
  const ticked = (r: Element) => !!$<HTMLInputElement>('[data-kit-on]', r)?.checked;
  const sum = () => {
    let t = 0;
    for (const r of rows) {
      const on = ticked(r);
      const line = (Number(r.getAttribute('data-price')) || 0) * qty(r);
      const cell = $('[data-kit-line]', r);
      if (cell) cell.textContent = on ? money(line) : '—';
      r.classList.toggle('kit-off', !on);
      if (on) t += line;
    }
    const total = $('[data-kit-total]', kp);
    if (total) total.textContent = money(t);
  };
  kp.addEventListener('click', (e) => {
    const b = hit(e, '[data-kd]');
    if (!b) return;
    const inp = $<HTMLInputElement>('[data-kit-qty]', b.closest('[data-kit-item]'))!;
    const v = (parseInt(inp.value, 10) || 1) + Number(b.getAttribute('data-kd'));
    inp.value = String(Math.min(Number(inp.max) || 999, Math.max(Number(inp.min) || 1, v)));
    sum();
  });
  kp.addEventListener('input', sum);
  kp.addEventListener('change', sum);
  $('[data-kit-add]', kp)?.addEventListener('click', () => {
    const cart = readCart();
    let n = 0;
    const items: { id: number; qty: number; price: number }[] = [];
    for (const r of rows) {
      if (!ticked(r)) continue;
      const id = r.getAttribute('data-id') || '';
      const q = qty(r);
      cart[id] = (Number(cart[id]) || 0) + q;
      n += q;
      items.push({ id: Number(id), qty: q, price: Number(r.getAttribute('data-price')) || 0 });
    }
    const msg = $('[data-kit-msg]', kp)!;
    if (!n) { msg.textContent = 'অন্তত একটা পার্টস বাছাই করুন।'; return; }
    writeCart(cart);
    track('add_to_cart', { items });
    msg.textContent = `✅ ${bn(items.length)}টি পার্টস কার্টে যোগ হয়েছে।`;
    setTimeout(() => { location.href = '/cart'; }, 600);
  });
  sum();
}

// 📧 footer: join the offer e-mail list
function newsletter(): void {
  const f = $<HTMLFormElement>('[data-news-form]');
  if (!f) return;
  const msg = $('[data-news-msg]', f)!;
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = field(f, 'email').value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { msg.textContent = 'সঠিক ইমেইল ঠিকানা লিখুন।'; return; }
    const btn = $<HTMLButtonElement>('button', f)!;
    btn.disabled = true;
    try {
      const { j } = await postJson<MessageAnswer>('/api/subscribe', { email, website: field(f, 'website').value });
      msg.textContent = j.message || j.error || '';
      if (j.ok) field(f, 'email').value = '';
    } catch { msg.textContent = 'এখন যোগ করা গেল না, একটু পরে আবার চেষ্টা করুন।'; }
    btn.disabled = false;
  });
}
