// Product page: photo gallery, zoom, full-screen viewer, photo download, and the variant (size / colour) picker.
import { $, $all, bn, hit, money } from '../dom.js';
import { rule } from './cart.js';

export function startProduct(): void {
  gallery();
  variants();
}

function gallery(): void {
  const gal = $('[data-gallery]');
  if (!gal) return;
  const main = $<HTMLImageElement>('[data-g-main]', gal);
  const vid = $('[data-g-video]', gal);
  gal.addEventListener('click', (e) => {
    const th = hit(e, '.g-thumb');
    if (!th || th.classList.contains('g-empty')) return;
    for (const x of $all('.g-thumb', gal)) x.classList.remove('on');
    th.classList.add('on');
    if (th.hasAttribute('data-g-yt') && vid) {
      const f = $<HTMLIFrameElement>('iframe', vid);
      if (f && !f.src) f.src = f.getAttribute('data-src') || '';
      vid.hidden = false;
      gal.classList.add('playing');
    } else if (main) {
      if (vid) { vid.hidden = true; $('iframe', vid)?.removeAttribute('src'); }
      gal.classList.remove('playing');
      main.src = th.getAttribute('data-g-img') || '';
    }
  });
  // big red "ভিডিও দেখুন" button under the photos = same as tapping the video thumbnail
  const vbtn = $('[data-g-yt-btn]', gal);
  const vthumb = $('[data-g-yt]', gal);
  if (vbtn && vthumb) vbtn.addEventListener('click', () => { vthumb.click(); $('.g-main', gal)?.scrollIntoView({ behavior: 'smooth', block: 'center' }); });

  const gm = $('.g-main', gal);
  // computer with a mouse (not a phone/tablet)
  const fine = !!window.matchMedia?.('(hover: hover) and (pointer: fine)').matches;
  const onZoomBtn = (e: Event) => !!hit(e, '[data-g-zoom]');

  // ---- computer: mouse over the big picture = zoom right inside the box ----
  if (main && gm && fine) {
    const hz = (e: MouseEvent) => {
      if (gal.classList.contains('playing') || onZoomBtn(e)) { gm.classList.remove('hz'); return; }
      const r = gm.getBoundingClientRect();
      const x = Math.max(0, Math.min(100, ((e.clientX - r.left) / r.width) * 100));
      const y = Math.max(0, Math.min(100, ((e.clientY - r.top) / r.height) * 100));
      main.style.transformOrigin = `${x}% ${y}%`;
      gm.classList.add('hz');
    };
    gm.addEventListener('mouseenter', hz);
    gm.addEventListener('mousemove', hz);
    gm.addEventListener('mouseleave', () => gm.classList.remove('hz'));
  }

  const lb = $('[data-lightbox]');
  if (lb && main) lightbox(gal, gm, main, lb, fine);

  // swipe between photos on phones
  let gx: number | null = null;
  gm?.addEventListener('touchstart', (e) => { gx = e.touches[0].clientX; }, { passive: true });
  gm?.addEventListener('touchend', (e) => {
    if (gx === null) return;
    const dx = e.changedTouches[0].clientX - gx;
    gx = null;
    if (Math.abs(dx) < 40) return;
    const thumbs = $all('.g-thumb:not(.g-empty)', gal);
    const cur = thumbs.findIndex((x) => x.classList.contains('on'));
    thumbs[(cur + (dx < 0 ? 1 : -1) + thumbs.length) % thumbs.length]?.click();
  });
}

// ---- full-screen photo viewer (phone: pinch / double-tap zoom; computer: click / wheel zoom) ----
function lightbox(gal: HTMLElement, gm: HTMLElement | null, main: HTMLImageElement, lb: HTMLElement, fine: boolean): void {
  const lbImg = $<HTMLImageElement>('[data-lb-img]', lb)!;
  const lbCount = $('[data-lb-count]', lb);
  const lbHint = $('[data-lb-hint]', lb);
  const photos = $all('[data-g-img]', gal).map((b) => b.getAttribute('data-g-img') || '');
  let li = 0;
  let z = 1;
  let tx = 0;
  let ty = 0;
  const apply = () => {
    lbImg.style.transform = `translate(${tx}px,${ty}px) scale(${z})`;
    lb.classList.toggle('zoomed', z > 1);
  };
  const reset = () => { z = 1; tx = 0; ty = 0; apply(); };
  const clampPan = () => {
    if (z <= 1.01) { z = 1; tx = 0; ty = 0; return; }
    const w = (lbImg.offsetWidth * (z - 1)) / 2;
    const hh = (lbImg.offsetHeight * (z - 1)) / 2;
    tx = Math.max(-w, Math.min(w, tx));
    ty = Math.max(-hh, Math.min(hh, ty));
  };
  // zoom keeping the spot under the finger / mouse in place
  const zoomAt = (nz: number, cx: number, cy: number) => {
    nz = Math.max(1, Math.min(4, nz));
    const r = lbImg.getBoundingClientRect();
    const k = nz / z;
    tx += (cx - (r.left + r.width / 2)) * (1 - k);
    ty += (cy - (r.top + r.height / 2)) * (1 - k);
    z = nz;
    clampPan();
    apply();
  };
  const show = (i: number) => {
    li = (i + photos.length) % photos.length;
    reset();
    lbImg.src = photos[li];
    if (lbCount) lbCount.textContent = photos.length > 1 ? `${bn(li + 1)} / ${bn(photos.length)}` : '';
  };
  let hintT = 0;
  const open = () => {
    const cur = photos.indexOf(main.getAttribute('src') || '');
    show(cur < 0 ? 0 : cur);
    lb.hidden = false;
    document.body.classList.add('lb-open');
    if (lbHint) {
      lbHint.textContent = fine ? 'ক্লিক করুন বা মাউসের চাকা ঘুরিয়ে জুম করুন' : 'দুই আঙুলে টেনে বা দুবার ট্যাপ করে জুম করুন';
      lbHint.classList.add('show');
      clearTimeout(hintT);
      hintT = window.setTimeout(() => lbHint.classList.remove('show'), 3000);
    }
  };
  const close = () => { lb.hidden = true; reset(); document.body.classList.remove('lb-open'); };
  gm?.addEventListener('click', (e) => {
    if (gal.classList.contains('playing') || hit(e, '[data-g-zoom]')) return;
    gm.classList.remove('hz');
    open();
  });
  $('[data-g-zoom]', gal)?.addEventListener('click', open);

  // computer: click = zoom in / out, mouse wheel = zoom, drag = move around
  let drag: { x: number; y: number; tx: number; ty: number } | null = null;
  let dragged = false;
  lbImg.addEventListener('click', (e) => {
    if (!fine) return;
    if (dragged) { dragged = false; return; }
    if (z > 1) reset(); else zoomAt(2.5, e.clientX, e.clientY);
  });
  lb.addEventListener('wheel', (e) => {
    if (lb.hidden) return;
    e.preventDefault();
    zoomAt(z * (e.deltaY < 0 ? 1.25 : 0.8), e.clientX, e.clientY);
  }, { passive: false });
  lbImg.addEventListener('mousedown', (e) => {
    if (z <= 1 || e.button !== 0) return;
    e.preventDefault();
    drag = { x: e.clientX, y: e.clientY, tx, ty };
    dragged = false;
    lb.classList.add('dragging');
  });
  window.addEventListener('mousemove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) dragged = true;
    tx = drag.tx + dx;
    ty = drag.ty + dy;
    clampPan();
    apply();
  });
  window.addEventListener('mouseup', () => { if (drag) { drag = null; lb.classList.remove('dragging'); } });

  // ⬇️ owner's switch (Admin → স্টোর ডিজাইন): save the photo on screen as a JPG — the original, without the watermark
  const origs = $all('[data-g-img]', gal).map((b) => b.getAttribute('data-g-orig') || b.getAttribute('data-g-img') || '');
  const lbDl = $<HTMLButtonElement>('[data-lb-dl]', lb);
  const download = async () => {
    const src = origs[li];
    if (!src || !lbDl || lbDl.disabled) return;
    const label = lbDl.textContent;
    lbDl.disabled = true;
    lbDl.textContent = '⏳ নামানো হচ্ছে...';
    const done = (ok: boolean) => {
      lbDl.disabled = false;
      lbDl.textContent = ok ? '✓ ডাউনলোড হয়েছে' : '⚠️ হয়নি, আবার চাপুন';
      setTimeout(() => { lbDl.textContent = label; }, 1800);
    };
    const name = `${lbDl.getAttribute('data-name') || 'product'}-${li + 1}.jpg`;
    try {
      const r = await fetch(`${src}${src.includes('?') ? '&' : '?'}raw=1`, { credentials: 'same-origin' });
      if (!r.ok) throw new Error('http');
      const jpg = await toJpeg(await r.blob());
      const u = URL.createObjectURL(jpg);
      const a = document.createElement('a');
      a.href = u;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(u), 4000);
      done(true);
    } catch { done(false); }
  };
  lb.addEventListener('click', (e) => {
    if (lbDl && hit(e, '[data-lb-dl]')) { void download(); return; }
    const st = hit(e, '[data-lb-step]');
    if (st) { show(li + Number(st.getAttribute('data-lb-step'))); return; }
    if (hit(e, '[data-lb-close]') || e.target === lb) close();
  });
  document.addEventListener('keydown', (e) => {
    if (lb.hidden) return;
    if (e.key === 'Escape') close();
    if (e.key === 'ArrowRight') show(li + 1);
    if (e.key === 'ArrowLeft') show(li - 1);
  });

  // phone: two fingers = pinch zoom, double tap = zoom, one finger = move (zoomed) or swipe to next photo
  const dist = (a: Touch, b: Touch) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) || 1;
  let pinch: { d: number; z: number } | null = null;
  let pan: { x: number; y: number; tx: number; ty: number } | null = null;
  let multi = false;
  let lastTap = 0;
  const startPan = (t: Touch) => { pan = { x: t.clientX, y: t.clientY, tx, ty }; };
  lb.addEventListener('touchstart', (e) => {
    if (hit(e, 'button')) return;
    if (e.touches.length >= 2) {
      multi = true;
      pan = null;
      pinch = { d: dist(e.touches[0], e.touches[1]), z };
      lb.classList.add('dragging');
    } else if (e.touches.length === 1) {
      startPan(e.touches[0]);
      if (z > 1) lb.classList.add('dragging');
    }
  }, { passive: true });
  lb.addEventListener('touchmove', (e) => {
    if (pinch && e.touches.length >= 2) {
      e.preventDefault();
      const [a, b] = [e.touches[0], e.touches[1]];
      zoomAt((pinch.z * dist(a, b)) / pinch.d, (a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2);
    } else if (pan && e.touches.length === 1 && z > 1) {
      e.preventDefault();
      const t = e.touches[0];
      tx = pan.tx + (t.clientX - pan.x);
      ty = pan.ty + (t.clientY - pan.y);
      clampPan();
      apply();
    }
  }, { passive: false });
  lb.addEventListener('touchend', (e) => {
    if (e.touches.length) { pinch = null; if (e.touches.length === 1) startPan(e.touches[0]); return; }
    lb.classList.remove('dragging');
    const was = pan;
    const wasMulti = multi;
    pinch = null;
    pan = null;
    multi = false;
    if (!was || wasMulti) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - was.x;
    const dy = t.clientY - was.y;
    if (z <= 1 && Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) && photos.length > 1) { show(li + (dx < 0 ? 1 : -1)); return; }
    if (Math.abs(dx) < 10 && Math.abs(dy) < 10 && e.target === lbImg) {
      const now = Date.now();
      if (now - lastTap < 320) {
        e.preventDefault();
        if (z > 1) reset(); else zoomAt(2.5, t.clientX, t.clientY);
        lastTap = 0;
      } else lastTap = now;
    }
  });
}

/** Any picture → JPG (a see-through PNG gets a white background, a JPG has no see-through). */
function toJpeg(blob: Blob): Promise<Blob> {
  return new Promise((ok, bad) => {
    const url = URL.createObjectURL(blob);
    const im = new Image();
    im.onload = () => {
      const c = document.createElement('canvas');
      c.width = im.naturalWidth;
      c.height = im.naturalHeight;
      const g = c.getContext('2d')!;
      g.fillStyle = '#fff';
      g.fillRect(0, 0, c.width, c.height);
      g.drawImage(im, 0, 0);
      URL.revokeObjectURL(url);
      c.toBlob((b) => (b ? ok(b) : bad(new Error('jpg'))), 'image/jpeg', 0.95);
    };
    im.onerror = () => { URL.revokeObjectURL(url); bad(new Error('img')); };
    im.src = url;
  });
}

// ---------- product variants (size / colour / model) ----------
function variants(): void {
  const vp = $('[data-variants]');
  if (!vp) return;
  const pick = (b: HTMLElement) => {
    for (const x of $all('[data-var]', vp)) { const on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-checked', on ? 'true' : 'false'); }
    const attr = (k: string) => b.getAttribute(k);
    const id = attr('data-var') || '';
    const price = Number(attr('data-price')) || 0;
    const old = Number(attr('data-old')) || 0;
    const stock = Number(attr('data-stock')) || 0;
    const low = Number(attr('data-low')) || 0;
    // 📐 a box's measure, when the owner gave one for this size
    const dl = $('[data-var-dims]', vp);
    if (dl) {
      const d = attr('data-dims') || '';
      dl.hidden = !d;
      const dt = $('[data-var-dims-text]', dl);
      if (dt) dt.textContent = d;
    }
    const nm = $('[data-var-name]', vp);
    if (nm) nm.textContent = attr('data-label');
    for (const el of $all('[data-p-price]')) el.textContent = money(price);
    const po = $('[data-p-old]');
    const ps = $('[data-p-save]');
    if (po) { po.hidden = !(old > price); po.textContent = old > price ? money(old) : ''; }
    if (ps) { ps.hidden = !(old > price); ps.textContent = old > price ? `${money(old - price)} সাশ্রয়` : ''; }
    const sku = $('[data-p-sku]');
    if (sku && attr('data-sku')) sku.textContent = attr('data-sku');
    const fl = $('[data-p-flash]');
    if (fl) {
      const fe = attr('data-flash');
      fl.hidden = !fe;
      $('[data-countdown]', fl)?.setAttribute('data-countdown', fe || '');
    }
    // ⏳ pre-order product: an out-of-stock option can still be ordered
    const pre = !!$('[data-buy-box][data-preorder]');
    const st = $('[data-p-stock]');
    if (st) {
      st.className = `stock ${stock <= 0 ? 'out' : stock <= low ? 'low' : 'ok'}`;
      st.textContent = stock <= 0 ? (pre ? 'স্টকে নেই — প্রি-অর্ডার চলছে' : 'স্টকে নেই') : stock <= low ? `মাত্র ${bn(stock)}টি বাকি আছে` : '✓ স্টকে আছে';
      st.hidden = !(stock <= 0 || st.getAttribute('data-show'));
    }
    for (const btn of $all<HTMLButtonElement>('[data-add][data-with-qty]')) {
      btn.setAttribute('data-add', id);
      btn.setAttribute('data-name', attr('data-name') || '');
      btn.setAttribute('data-price', String(price));
      btn.disabled = stock <= 0 && !pre;
      const label = btn.getAttribute('data-label');
      if (pre && label) btn.textContent = stock <= 0 ? (btn.hasAttribute('data-buy-now') ? '⏳ এখনই প্রি-অর্ডার করুন' : '⏳ প্রি-অর্ডার (কার্টে যোগ)') : label;
    }
    const pn = $('[data-pre-note]');
    if (pn) pn.hidden = !(pre && stock <= 0);
    const qi = $<HTMLInputElement>('[data-qty] input');
    if (qi) {
      const mx = Math.max(1, pre ? rule(price).max : Math.min(stock, rule(price).max));
      qi.max = String(mx);
      qi.setAttribute('data-stock', String(stock));
      if ((parseInt(qi.value, 10) || 1) > mx) qi.value = String(mx);
    }
    const vo = $('[data-var-out]');
    if (vo) vo.hidden = stock > 0 || pre;
    const nf = $('[data-notify]');
    if (nf) {
      nf.setAttribute('data-product', id);
      nf.hidden = stock > 0 || pre;
      const m = $('[data-notify-msg]', nf);
      if (m) m.textContent = '';
    }
    const sb = $('[data-sticky-buy]');
    if (sb) sb.hidden = stock <= 0 && !pre;
    const im = attr('data-img');
    const main = $<HTMLImageElement>('[data-g-main]');
    if (im && main) {
      main.src = im;
      for (const t of $all('[data-g-img]')) t.classList.toggle('on', t.getAttribute('data-g-img') === im);
    }
    try { history.replaceState(null, '', `${location.pathname}?v=${id}${location.hash}`); } catch { /* ignore */ }
    // 📦 the pack buttons and the quantity box follow the chosen variant's price (client/shop/cart.tsx)
    document.dispatchEvent(new CustomEvent('sm:variant'));
  };
  vp.addEventListener('click', (e) => { const b = hit(e, '[data-var]'); if (b) pick(b); });
  // "রং: সাদা · সিলভার" + "সাইজ: Small · Large": one row per option; the chosen values pick the matching variant
  const groups = Number(vp.getAttribute('data-var-groups')) || 0;
  const all = $all('[data-var]', vp);
  const partsOf = (b: Element) => (b.getAttribute('data-label') || '').split('/').map((x) => x.trim());
  const chosen = () => { const on = $('[data-var].on', vp) || all[0]; return on ? partsOf(on) : []; };
  const match = (want: string[]) => all.find((b) => partsOf(b).every((x, i) => x === want[i]));
  const paintGroups = () => {
    const cur = chosen();
    for (const o of $all('[data-vg]', vp)) {
      const g = Number(o.getAttribute('data-vg'));
      const val = o.getAttribute('data-vv') || '';
      const on = cur[g] === val;
      o.classList.toggle('on', on);
      o.setAttribute('aria-checked', on ? 'true' : 'false');
      const want = cur.slice(); want[g] = val;
      const m = match(want);
      o.classList.toggle('is-out', !m || Number(m.getAttribute('data-stock')) <= 0);
    }
    for (const el of $all('[data-var-gname]', vp)) el.textContent = cur[Number(el.getAttribute('data-var-gname'))] || '';
  };
  if (groups) {
    vp.addEventListener('click', (e) => {
      const o = hit(e, '[data-vg]');
      if (!o) return;
      const g = Number(o.getAttribute('data-vg'));
      const val = o.getAttribute('data-vv') || '';
      const want = chosen(); want[g] = val;
      // the exact combination, or else the first one with this value that is in stock (then any with this value)
      const b = match(want) || all.find((x) => partsOf(x)[g] === val && Number(x.getAttribute('data-stock')) > 0) || all.find((x) => partsOf(x)[g] === val);
      if (b) pick(b);
      paintGroups();
    });
  }
  const first = $('[data-var].on', vp);
  if (first) pick(first);
  if (groups) paintGroups();
  // came from a card's "কার্টে যোগ করুন" / "এখনই কিনুন" (#choose): show the options to pick first
  if (location.hash === '#choose') {
    vp.classList.add('var-attn');
    const note = document.createElement('p');
    note.className = 'var-note';
    note.textContent = '👇 আগে রং / সাইজ / প্যাক বেছে নিন, তারপর কার্টে যোগ করুন।';
    vp.prepend(note);
    setTimeout(() => vp.scrollIntoView({ behavior: 'smooth', block: 'center' }), 300);
  }
}
