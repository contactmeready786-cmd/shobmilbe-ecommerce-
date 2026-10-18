// Page furniture: drawer, slider, tabs, pop-up, menus, home-page rows, the notice line, countdowns, copy protection.
import { h, paint } from '../jsx.js';
import { $, $all, bn, copyText, hit, store } from '../dom.js';
import type { ShopConfig } from '../shop-config.js';

const SM: Partial<ShopConfig> = window.SM || {};

export function startUi(): void {
  // inside the সবমিলবে Android app: the app has its own bottom bar (হোম, কার্ট, অ্যাকাউন্ট…), so the site hides its copies
  if (/ShobmilbeApp\//.test(navigator.userAgent)) document.documentElement.classList.add('in-app');
  copyProtection();
  drawer();
  sliders();
  tabsAndVideo();
  popup();
  menus();
  rails();
  notice();
  countdowns();
}

function copyProtection(): void {
  if (SM.protect) {
    const TITLE = '.p-title, .card-title';
    const elOf = (n: Node | null): Element | null => (n && n.nodeType === 3 ? n.parentElement : (n as Element | null));
    // owner's switch (Admin → স্টোর ডিজাইন): product names may be copied while it is on
    const inTitle = (n: Node | null) => { const el = elOf(n); return !!(SM.copyTitle && el?.closest?.(TITLE)); };
    const selInTitle = () => { const s = window.getSelection(); return !!(s && s.rangeCount && !s.isCollapsed && inTitle(s.anchorNode) && inTitle(s.focusNode)); };
    const editable = (n: EventTarget | null) => { const el = elOf(n as Node | null); return !!el?.closest?.('input, textarea, select, [contenteditable]') || inTitle(el); };
    document.addEventListener('contextmenu', (e) => { if (!editable(e.target)) e.preventDefault(); });
    document.addEventListener('copy', (e) => { if (!editable(e.target) && !selInTitle()) e.preventDefault(); });
    document.addEventListener('cut', (e) => { if (!editable(e.target) && !selInTitle()) e.preventDefault(); });
    document.addEventListener('dragstart', (e) => { if ((e.target as Element | null)?.tagName === 'IMG') e.preventDefault(); });
    document.addEventListener('selectstart', (e) => { if (!editable(e.target)) e.preventDefault(); });
    document.addEventListener('keydown', (e) => {
      const k = (e.key || '').toLowerCase();
      const mod = e.ctrlKey || e.metaKey;
      if (mod && ['c', 'x', 'a', 's', 'u', 'p'].includes(k) && !editable(e.target) && !(k === 'c' && selInTitle())) e.preventDefault();
      if (mod && e.shiftKey && ['i', 'j', 'c'].includes(k)) e.preventDefault();
    });
  }
  // 📋 "নাম কপি" button next to the product name (only while the owner's switch is on)
  document.addEventListener('click', async (e) => {
    const b = hit(e, '[data-copy-title]');
    if (!b) return;
    const text = b.getAttribute('data-copy-title') || '';
    if (await copyText(text, 'নামটা কপি করুন:')) {
      const o = b.textContent;
      b.textContent = '✓ কপি হয়েছে';
      setTimeout(() => { b.textContent = o; }, 1500);
    }
  });
}

function drawer(): void {
  const d = $('#drawer');
  const set = (open: boolean) => {
    if (!d) return;
    d.hidden = !open;
    document.body.classList.toggle('drawer-open', open);
  };
  document.addEventListener('click', (e) => {
    if (hit(e, '[data-drawer-open]')) set(true);
    else if (hit(e, '[data-drawer-close]') || (d && !d.hidden && !hit(e, '#drawer'))) set(false);
  });
}

function sliders(): void {
  for (const sl of $all('[data-slider]')) {
    const slides = $all('.slide', sl);
    const dots = $all('[data-dot]', sl);
    if (slides.length < 2) continue;
    let i = 0;
    let timer = 0;
    const slideFx = sl.classList.contains('fx-slide');
    const ms = Math.max(1, Number(sl.getAttribute('data-interval')) || 4) * 1000;
    const instant = (el: HTMLElement, f: () => void) => { el.style.transition = 'none'; f(); void el.offsetWidth; el.style.transition = ''; };
    const go = (n: number) => {
      const old = slides[i];
      const next = (n + slides.length) % slides.length;
      if (next === i) return;
      dots[i]?.classList.remove('on');
      if (slideFx) {
        // the new picture comes in from the right, the old one moves out to the left
        instant(slides[next], () => slides[next].classList.remove('out'));
        old.classList.remove('on');
        old.classList.add('out');
        setTimeout(() => instant(old, () => old.classList.remove('out')), 800);
      } else old.classList.remove('on');
      i = next;
      slides[i].classList.add('on');
      dots[i]?.classList.add('on');
    };
    const auto = () => { clearInterval(timer); timer = window.setInterval(() => { if (!document.hidden) go(i + 1); }, ms); };
    for (const d of dots) d.addEventListener('click', () => { go(Number(d.getAttribute('data-dot'))); auto(); });
    sl.addEventListener('mouseenter', () => clearInterval(timer));
    sl.addEventListener('mouseleave', auto);
    let x0: number | null = null;
    sl.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; clearInterval(timer); }, { passive: true });
    sl.addEventListener('touchend', (e) => {
      if (x0 === null) return;
      const dx = e.changedTouches[0].clientX - x0;
      if (Math.abs(dx) > 40) go(i + (dx < 0 ? 1 : -1));
      x0 = null;
      auto();
    });
    auto();
  }
}

function tabsAndVideo(): void {
  // ---------- YouTube video: loads only when tapped ----------
  document.addEventListener('click', (e) => {
    const b = hit(e, '[data-yt-lite] .yt-play');
    if (!b) return;
    const box = b.closest('[data-yt-lite]');
    const id = box?.getAttribute('data-yt-lite') || '';
    paint(box, <iframe src={`https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?autoplay=1&rel=0&playsinline=1`} title="পণ্যের ভিডিও"
      allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen />);
  });
  for (const box of $all('[data-tabs]')) {
    box.addEventListener('click', (e) => {
      const tb = hit(e, '[data-tab]');
      if (!tb) return;
      for (const x of $all('[data-tab]', box)) x.classList.toggle('on', x === tb);
      for (const p of $all('[data-panel]', box)) p.hidden = p.getAttribute('data-panel') !== tb.getAttribute('data-tab');
    });
  }
  const sticky = $('[data-sticky-buy]');
  const buyBox = $('.buy-box');
  if (sticky && buyBox && 'IntersectionObserver' in window) {
    new IntersectionObserver((en) => { sticky.classList.toggle('show', !en[0].isIntersecting && en[0].boundingClientRect.top < 0); }).observe(buyBox);
  }
}

// ---------- popup offer (once a day) ----------
function popup(): void {
  const pop = $('[data-popup]');
  if (!pop || /^\/(checkout|cart|order)/.test(location.pathname)) return;
  const pk = `sm_pop_${pop.getAttribute('data-popup')}`;
  if (Date.now() - Number(store(pk) || 0) > 864e5) setTimeout(() => { pop.hidden = false; store(pk, String(Date.now())); }, 2500);
  pop.addEventListener('click', (e) => { if (e.target === pop || hit(e, '[data-popup-close]')) pop.hidden = true; });
}

function menus(): void {
  // header dropdown (live scores)
  document.addEventListener('click', (e) => {
    for (const d of $all('[data-nav-drop][open]')) if (!d.contains(e.target as Node)) d.removeAttribute('open');
  });
  // category menu: keep drop-downs on screen; on touch screens first tap opens, second tap goes
  const catMenu = $('[data-cat-menu]');
  if (!catMenu) return;
  const place = (li: Element) => {
    const sub = li.querySelector(':scope > .cm-sub');
    if (!sub) return;
    sub.classList.remove('flip');
    const r = sub.getBoundingClientRect();
    if (r.width && r.right > window.innerWidth - 8) sub.classList.add('flip');
  };
  for (const li of $all('.cm-item.has-sub', catMenu)) {
    li.addEventListener('mouseenter', () => place(li));
    li.addEventListener('focusin', () => place(li));
  }
  const touch = window.matchMedia?.('(hover: none)').matches;
  catMenu.addEventListener('click', (e) => {
    const a = hit(e, '.has-sub > a');
    if (!a || !touch) return;
    const li = a.parentElement!;
    if (li.classList.contains('open')) return; // second tap: open the category page
    e.preventDefault();
    for (const x of $all('.cm-item.open', catMenu)) if (!x.contains(li)) x.classList.remove('open');
    li.classList.add('open');
    place(li);
  });
  document.addEventListener('click', (e) => {
    if (!catMenu.contains(e.target as Node)) for (const x of $all('.cm-item.open', catMenu)) x.classList.remove('open');
  });
}

// ---------- home page rows: arrows, and the "নতুন এসেছে" row moves on by itself ----------
function rails(): void {
  for (const sec of $all('.rail-sec')) {
    const rail = $('[data-rail]', sec);
    const prev = $<HTMLButtonElement>('[data-rail-prev]', sec);
    const next = $<HTMLButtonElement>('[data-rail-next]', sec);
    if (!rail) continue;
    const step = () => { const c = rail.querySelector('.card'); return c ? c.getBoundingClientRect().width + 14 : rail.clientWidth; };
    const atEnd = () => rail.scrollLeft + rail.clientWidth >= rail.scrollWidth - 4;
    const paintArrows = () => { if (prev) prev.disabled = rail.scrollLeft <= 2; if (next) next.disabled = atEnd(); };
    prev?.addEventListener('click', () => rail.scrollBy({ left: -rail.clientWidth, behavior: 'smooth' }));
    next?.addEventListener('click', () => rail.scrollBy({ left: rail.clientWidth, behavior: 'smooth' }));
    let t = 0;
    rail.addEventListener('scroll', () => { clearTimeout(t); t = window.setTimeout(paintArrows, 80); }, { passive: true });
    paintArrows();
    if (!rail.hasAttribute('data-rail-auto') || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) continue;
    let hold = false;
    let seen = true;
    for (const ev of ['mouseenter', 'touchstart', 'focusin']) rail.addEventListener(ev, () => { hold = true; }, { passive: true });
    for (const ev of ['mouseleave', 'touchend', 'focusout']) rail.addEventListener(ev, () => { setTimeout(() => { hold = false; }, 2500); }, { passive: true });
    if ('IntersectionObserver' in window) new IntersectionObserver((en) => { seen = en[0].isIntersecting; }).observe(rail);
    setInterval(() => {
      if (hold || !seen || document.hidden || rail.scrollWidth <= rail.clientWidth + 4) return;
      if (atEnd()) rail.scrollTo({ left: 0, behavior: 'smooth' }); else rail.scrollBy({ left: step(), behavior: 'smooth' });
    }, 3500);
  }
}

// ---------- top bar stays one thin line: a notice that doesn't fit glides sideways ----------
function notice(): void {
  const nt = $('[data-notice-text]');
  const inner = nt?.firstElementChild;
  if (!nt || !inner) return;
  const fit = () => {
    nt.classList.remove('is-long');
    let over = inner.scrollWidth - nt.clientWidth;
    if (over > 2) {
      nt.classList.add('is-long');
      over = inner.scrollWidth - nt.clientWidth; // measured again with the side fade padding
      nt.style.setProperty('--nt-move', `${-over}px`);
      nt.style.setProperty('--nt-time', `${Math.min(30, Math.max(6, over / 18)).toFixed(1)}s`);
    }
  };
  fit();
  window.addEventListener('resize', fit);
  document.addEventListener('sm:lang', () => setTimeout(fit, 30));
  new MutationObserver(() => setTimeout(fit, 30)).observe(inner, { childList: true, characterData: true, subtree: true });
  void document.fonts?.ready.then(fit);
}

// ---------- flash sale countdown ----------
// (looked up on every tick: product-page variants and the "recently viewed" row add countdowns later)
function countdowns(): void {
  if (!$all('[data-countdown]').length && !$('[data-variants]') && !$('[data-recent-box]')) return;
  const pad = (n: number) => bn(n < 10 ? `0${n}` : String(n));
  const tick = () => {
    for (const el of $all('[data-countdown]')) {
      const end = el.getAttribute('data-countdown');
      if (!end) continue;
      const left = Math.max(0, Math.floor((new Date(end).getTime() - Date.now()) / 1000));
      if (!left) { el.textContent = 'শেষ'; continue; }
      const d = Math.floor(left / 86400);
      el.textContent = `${d ? `${bn(d)} দিন ` : ''}${pad(Math.floor((left % 86400) / 3600))}:${pad(Math.floor((left % 3600) / 60))}:${pad(left % 60)}`;
    }
  };
  tick();
  setInterval(tick, 1000);
}
