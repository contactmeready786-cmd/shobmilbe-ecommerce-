// Lists kept in this browser (wishlist, compare, recently viewed), "আপনার জন্য" and the instant search under the search box.
import { h, Fragment, paint, serverHtml } from '../jsx.js';
import { $, $all, bn, getJson, hit, money, readJson, store } from '../dom.js';
import { readCart, toastLink } from './cart.js';
import { track } from './track.js';

void Fragment;
const ids = (k: string): string[] => { const v = readJson<unknown>(k, []); return Array.isArray(v) ? v.map(String) : []; };

export function startLists(): void {
  wishlist();
  compare();
  recent();
  forYou();
  search();
}

// ---------- ♡ wishlist (kept in this browser only) ----------
const WKEY = 'sm_wish';
export function paintWish(): void {
  const w = ids(WKEY);
  for (const b of $all('[data-wish]')) {
    const on = w.includes(b.getAttribute('data-wish') || '');
    b.classList.toggle('on', on);
    b.textContent = on ? '♥' : '♡';
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
}
function wishlist(): void {
  paintWish();
  document.addEventListener('click', (e) => {
    const b = hit(e, '[data-wish]');
    if (!b) return;
    e.preventDefault();
    const id = b.getAttribute('data-wish') || '';
    const w = ids(WKEY);
    const i = w.indexOf(id);
    const on = i < 0;
    if (on) w.unshift(id); else w.splice(i, 1);
    store(WKEY, JSON.stringify(w.slice(0, 60)));
    paintWish();
    if (on) toastLink('♥ পছন্দের তালিকায় রাখা হয়েছে', ['/wishlist', 'তালিকা দেখুন'], 2500);
    else toastLink('পছন্দের তালিকা থেকে সরানো হয়েছে', undefined, 2500);
    try { void fetch('/api/wish', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: Number(id), on }), keepalive: true }).catch(() => {}); } catch { /* ignore */ }
    if (on) track('add_to_wishlist', { items: [{ id, name: b.getAttribute('aria-label') || '', price: 0, qty: 1 }] });
  });
  if ($('[data-wish-load]')) location.replace(`/wishlist?ids=${encodeURIComponent(ids(WKEY).join(','))}`);
}

// ---------- ⚖️ compare (up to 4 products, kept in this browser) ----------
const CKEY = 'sm_cmp';
const cmpList = () => ids(CKEY).slice(0, 4);
const cmpSave = (list: string[]) => { store(CKEY, JSON.stringify(list.slice(0, 4))); paintCmp(); };
export function paintCmp(): void {
  const c = cmpList();
  for (const b of $all('[data-compare]')) {
    const on = c.includes(b.getAttribute('data-compare') || '');
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    b.textContent = on ? '⚖️ তুলনায় আছে' : '⚖️ তুলনা';
  }
  const onPage = !!$('[data-compare-page]');
  let bar = $('[data-compare-bar]');
  if (!bar && c.length && !onPage) {
    bar = <div className="compare-bar" data-compare-bar="" />;
    document.body.appendChild(bar);
  }
  if (bar) {
    bar.hidden = !c.length || onPage;
    paint(bar, <span>⚖️ তুলনার তালিকায় {bn(c.length)}টি পণ্য</span>,
      <a className="btn btn-sm btn-amber" href={`/compare?ids=${c.join(',')}`}>তুলনা দেখুন</a>,
      <button type="button" className="link-btn small" data-compare-clear="">✕</button>);
  }
}
function compare(): void {
  paintCmp();
  document.addEventListener('click', (e) => {
    const b = hit(e, '[data-compare]');
    if (b) {
      const id = b.getAttribute('data-compare') || '';
      const c = cmpList();
      const i = c.indexOf(id);
      if (i > -1) c.splice(i, 1);
      else {
        if (c.length >= 4) { toastLink('সর্বোচ্চ ৪টা পণ্য তুলনা করা যায় — আগে একটা সরান।', [`/compare?ids=${c.join(',')}`, 'তালিকা'], 4000); return; }
        c.push(id);
      }
      cmpSave(c);
      if (i < 0) toastLink(`⚖️ তুলনার তালিকায় যোগ হয়েছে${c.length < 2 ? ' — আরেকটা পণ্য যোগ করুন' : ''}`, [`/compare?ids=${c.join(',')}`, 'তুলনা দেখুন'], 3500);
      return;
    }
    const rm = hit(e, '[data-compare-remove]');
    if (rm) {
      const c2 = cmpList().filter((x) => x !== rm.getAttribute('data-compare-remove'));
      cmpSave(c2);
      location.replace(`/compare?ids=${c2.join(',')}`);
      return;
    }
    if (hit(e, '[data-compare-clear]')) { cmpSave([]); if ($('[data-compare-page]')) location.replace('/compare?ids='); }
  });
  if ($('[data-compare-load]')) location.replace(`/compare?ids=${encodeURIComponent(cmpList().join(','))}`);
}

// ---------- 🕘 recently viewed (kept in this browser) ----------
const RKEY = 'sm_recent';
function recent(): void {
  const hereId = $('[data-recent-id]')?.getAttribute('data-recent-id') || '';
  const rbox = $('[data-recent-box]');
  if (rbox) {
    const show = ids(RKEY).filter((x) => x !== hereId).slice(0, 8);
    if (show.length) {
      getJson<{ html?: string }>(`/api/cards?ids=${show.join(',')}`).then((j) => {
        if (!j.html) return;
        serverHtml($('[data-recent-list]', rbox), j.html);
        rbox.hidden = false;
        paintWish();
        paintCmp();
      }).catch(() => { /* ignore */ });
    }
    rbox.addEventListener('click', (e) => { if (hit(e, '[data-recent-clear]')) { store(RKEY, '[]'); rbox.hidden = true; } });
  }
  if (hereId) store(RKEY, JSON.stringify([hereId, ...ids(RKEY).filter((x) => x !== hereId)].slice(0, 20)));
}

// ---------- ✨ "আপনার জন্য" (from what this browser looked at, has in the cart and ordered) ----------
function forYou(): void {
  const fy = $('[data-for-you]');
  if (!fy) return;
  const seen = ids(RKEY);
  const inCart = Object.keys(readCart());
  getJson<{ html?: string }>(`/api/for-you?seen=${seen.slice(0, 20).join(',')}&cart=${inCart.slice(0, 20).join(',')}`).then((j) => {
    if (!j.html) return;
    serverHtml($('[data-for-you-list]', fy), j.html);
    fy.hidden = false;
    paintWish();
    paintCmp();
  }).catch(() => {});
}

// ---------- 🔎 instant search results under the search box (spelling mistakes and Bangla words work) ----------
type Found = { products?: { slug: string; name: string; price: number; image?: string; emoji?: string; out?: boolean }[]; total?: number };
function search(): void {
  const input = document.getElementById('q') as HTMLInputElement | null;
  const form = input?.closest('form.search');
  if (!input || !form) return;
  const box = <div className="search-drop" hidden role="listbox" id="search-drop" />;
  form.appendChild(box);
  input.setAttribute('aria-controls', 'search-drop');
  input.setAttribute('aria-autocomplete', 'list');
  let timer = 0;
  let last = '';
  let seq = 0;
  const cache = new Map<string, Found>();
  const close = () => { box.hidden = true; };
  const show = (q: string, j: Found) => {
    if (input.value.trim() !== q) return;
    const list = j.products || [];
    if (!list.length) paint(box, <p className="sd-empty">"{q}" — কিছু পাওয়া যায়নি। অন্য নামে লিখে দেখুন।</p>);
    else {
      paint(box, list.map((p) =>
        <a className="sd-item" role="option" href={`/p/${encodeURIComponent(p.slug)}`}>
          {p.image ? <img src={p.image} alt="" loading="lazy" draggable="false" /> : <span className="sd-emo">{p.emoji || '📦'}</span>}
          <span className="sd-name">{p.name}{p.out ? <>{' '}<small className="sd-out">স্টকে নেই</small></> : null}</span><b className="sd-price">{money(p.price)}</b></a>),
      (j.total || 0) > list.length ? <a className="sd-all" href={`/products?q=${encodeURIComponent(q)}`}>সব {bn(j.total)}টি ফলাফল দেখুন →</a> : null);
    }
    box.hidden = false;
  };
  const run = async () => {
    const q = input.value.trim();
    if (q.length < 2) { last = ''; close(); return; }
    if (q === last && !box.hidden) return;
    last = q;
    const hitCache = cache.get(q);
    if (hitCache) { show(q, hitCache); return; }
    const my = ++seq;
    try {
      const j = await getJson<Found>(`/api/search-suggest?q=${encodeURIComponent(q)}`);
      cache.set(q, j);
      if (my === seq) show(q, j);
    } catch { /* the normal search still works */ }
  };
  const items = () => $all('.sd-item, .sd-all', box);
  input.addEventListener('input', () => { clearTimeout(timer); timer = window.setTimeout(run, 220); });
  input.addEventListener('focus', () => { if (input.value.trim().length >= 2) void run(); });
  input.addEventListener('keydown', (e) => {
    const list = items();
    if (e.key === 'Escape') { close(); return; }
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && list.length && !box.hidden) {
      e.preventDefault();
      const i = list.indexOf(document.activeElement as HTMLElement);
      (list[e.key === 'ArrowDown' ? Math.min(list.length - 1, i + 1) : Math.max(0, i - 1)] || list[0]).focus();
    }
  });
  box.addEventListener('keydown', (e) => {
    const list = items();
    const i = list.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); list[i + 1]?.focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); if (i <= 0) input.focus(); else list[i - 1].focus(); }
    if (e.key === 'Escape') { close(); input.focus(); }
  });
  document.addEventListener('click', (e) => { if (!form.contains(e.target as Node)) close(); });
}
