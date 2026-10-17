// সবমিলবে admin — small helpers for single admin pages (they used to be written into the page itself):
// COD settlement, home-page rows, the country lock lists, the live numbers on "কাস্টমারের কাছে পৌঁছান".
import { $, $all, bn } from '../dom.js';

type Row = HTMLElement & { box: HTMLInputElement };
const rowsOf = (f: Element, sel: string): Row[] => $all(sel, f).map((r) => Object.assign(r, { box: $<HTMLInputElement>('input', r)! }));

// 🚚 কুরিয়ারের COD টাকা মিলানো: the ticked parcels add up; paste the courier's list to tick them at once
function codSettle(): void {
  const f = $('[data-cod-form]');
  if (!f) return;
  const n = $('[data-cod-n]', f);
  const s = $('[data-cod-sum]', f);
  const rc = $<HTMLInputElement>('[data-cod-received]', f);
  const fe = $<HTMLInputElement>('[data-cod-fee]', f);
  const sum = () => {
    const ticked = $all<HTMLInputElement>('[data-check-row]:checked', f);
    const t = ticked.reduce((a, x) => a + (Number(x.getAttribute('data-cod')) || 0), 0);
    if (n) n.textContent = bn(ticked.length);
    if (s) s.textContent = `৳${bn(Math.round(t * 100) / 100)}`;
    if (fe && rc && rc.value !== '') fe.placeholder = bn(Math.max(0, Math.round((t - Number(rc.value)) * 100) / 100));
  };
  f.addEventListener('change', sum);
  rc?.addEventListener('input', sum);
  $('[data-cod-pick]', f)?.addEventListener('click', () => {
    const words = ($<HTMLTextAreaElement>('[data-cod-paste]', f)?.value.toUpperCase().match(/[A-Z0-9-]{4,}/g) || []);
    let hits = 0;
    for (const x of $all<HTMLInputElement>('[data-check-row]', f)) {
      const k = ` ${x.getAttribute('data-keys')} `;
      if (words.some((w) => k.includes(` ${w} `))) { x.checked = true; hits++; }
    }
    const m = $('[data-cod-pick-msg]', f);
    if (m) m.textContent = `${bn(hits)}টি মিলেছে`;
    sum();
  });
  sum();
}

// home page rows: show only the boxes the chosen source needs; the chosen one is sent as "ref"
function homeRows(): void {
  const f = $<HTMLFormElement>('[data-row-form]');
  const src = f && $<HTMLSelectElement>('[name=source]', f);
  const ref = f && $<HTMLInputElement>('[data-ref]', f);
  if (!f || !src || !ref) return;
  const sync = () => { for (const el of $all('[data-show-when]', f)) el.hidden = el.getAttribute('data-show-when') !== `source=${src.value}`; };
  src.addEventListener('change', sync);
  sync();
  f.addEventListener('submit', () => {
    const pick = ({ category: 'ref_category', brand: 'ref_brand', search: 'ref_search' } as Record<string, string>)[src.value];
    ref.value = pick ? $<HTMLInputElement>(`[name=${pick}]`, f)?.value || '' : '';
  });
}

// the shop's country lock (ভিজিটর অ্যানালিটিক্স): search, "only ticked", untick all, at least one country
function shopCountries(): void {
  const f = $<HTMLFormElement>('[data-geo-form]');
  const q = f && $<HTMLInputElement>('[data-geo-search]', f);
  if (!f || !q) return;
  const rows = rowsOf(f, '[data-geo-row]');
  const cnt = $('[data-geo-count]', f);
  let only = false;
  const upd = () => {
    const t = q.value.trim().toLowerCase();
    let n = 0;
    for (const r of rows) {
      const c = r.box.checked;
      if (c) n++;
      r.style.display = (!t || (r.getAttribute('data-k') || '').includes(t)) && (!only || c) ? '' : 'none';
    }
    if (cnt) cnt.textContent = `(${n}টি টিক দেওয়া)`;
  };
  q.addEventListener('input', upd);
  f.addEventListener('change', upd);
  const onlyBtn = $('[data-geo-only]', f);
  onlyBtn?.addEventListener('click', () => { only = !only; onlyBtn.textContent = only ? 'সব দেশ দেখুন' : 'শুধু টিক দেওয়াগুলো দেখুন'; upd(); });
  $('[data-geo-none]', f)?.addEventListener('click', () => {
    if (!confirm('সব দেশের টিক তুলে দেবেন?')) return;
    for (const r of rows) r.box.checked = false;
    upd();
  });
  f.addEventListener('submit', (e) => {
    const on = $<HTMLInputElement>('[name=geo_lock_on]', f)?.checked;
    if (on && !rows.some((r) => r.box.checked)) { e.preventDefault(); alert('অন্তত একটা দেশে টিক দিন।'); }
  });
  upd();
}

// the admin's own country lock (নিরাপত্তা): search; ticked countries always stay in view
function adminCountries(): void {
  const f = $('[data-ac-form]');
  const q = f && $<HTMLInputElement>('[data-ac-search]', f);
  if (!f || !q) return;
  const rows = rowsOf(f, '[data-ac-row]');
  const cnt = $('[data-ac-count]', f);
  const upd = () => {
    const t = q.value.trim().toLowerCase();
    let n = 0;
    for (const r of rows) {
      const c = r.box.checked;
      if (c) n++;
      r.style.display = !t || c || (r.getAttribute('data-k') || '').includes(t) ? '' : 'none';
    }
    if (cnt) cnt.textContent = n ? `(${n}টি টিক দেওয়া)` : '';
  };
  q.addEventListener('input', upd);
  f.addEventListener('change', upd);
  upd();
}

// 🎯 কাস্টমারের কাছে পৌঁছান: the "right now" numbers refresh every minute
function reachLive(): void {
  const box = $('[data-reach-live]');
  if (!box) return;
  setInterval(async () => {
    try {
      const r = await fetch('/admin/reach/live', { credentials: 'same-origin', headers: { Accept: 'application/json' } });
      const j = await r.json();
      const v = $all('.kpi-value, .kpi b, .kpi strong', box);
      if (v.length >= 3) { v[0].textContent = j.now; v[1].textContent = j.views; v[2].textContent = j.orders; }
    } catch { /* next minute */ }
  }, 60000);
}

export function startPages(): void {
  for (const [name, start] of [['cod', codSettle], ['home rows', homeRows], ['shop countries', shopCountries], ['admin countries', adminCountries], ['reach', reachLive]] as [string, () => void][]) {
    try { start(); } catch (e) { console.error(`সবমিলবে admin: ${name} could not start`, e); }
  }
}
