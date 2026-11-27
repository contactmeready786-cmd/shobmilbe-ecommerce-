// District / thana drop-downs (checkout, account addresses, the admin's order form).
import { h, paint } from '../jsx.js';
import { $, loadGeo } from '../dom.js';

export type GeoBoxes = { district: HTMLSelectElement; thana: HTMLSelectElement };

/** labels: the empty thana choice — [district picked, no district yet] (the admin's order form says it shorter) */
export async function fillGeo(form: ParentNode, labels: [string, string] = ['থানা / উপজেলা বাছুন', 'আগে জেলা বাছুন']): Promise<GeoBoxes | null> {
  const dSel = $<HTMLSelectElement>('[data-district]', form);
  const tSel = $<HTMLSelectElement>('[data-thana]', form);
  if (!dSel || !tSel) return null;
  const geo = (await loadGeo()).districts;
  const want = dSel.getAttribute('data-value') || '';
  paint(dSel, <option value="">জেলা বাছুন</option>, geo.map((d) => <option value={d.en} selected={d.en === want}>{d.bn} ({d.en})</option>));
  const fillThana = (selected: string) => {
    const d = geo.find((x) => x.en === dSel.value);
    paint(tSel, <option value="">{d ? labels[0] : labels[1]}</option>,
      d ? d.areas.map((a) => <option value={a[0]} selected={a[0] === selected}>{a[1]}</option>) : null);
  };
  fillThana(tSel.getAttribute('data-value') || '');
  dSel.addEventListener('change', () => fillThana(''));
  return { district: dSel, thana: tSel };
}

// ---------------------------------------------------------------- 🔎 smart area search (owner, 2026-11-27)
// The customer types a thana, area or bazar — in Bangla or English ("মধ্য বাড্ডা", "Mirpur 10", "tongi") — and picks
// one of the suggestions; the district and thana boxes fill in by themselves (they can still change both).
// Works only on the district / thana list already on the page: nothing is sent anywhere.

// well-known places that are not thana names themselves → [district, thana] (only ones that are certain)
const PLACES: [string[], string, string][] = [
  [['bashundhara', 'বসুন্ধরা'], 'Dhaka', 'Bhatara'],
  [['farmgate', 'ফার্মগেট'], 'Dhaka', 'Tejgaon'],
  [['nikunja', 'নিকুঞ্জ'], 'Dhaka', 'Khilkhet'],
  [['tongi', 'টঙ্গী', 'টংগী'], 'Gazipur', 'Gazipur Sadar'],
  [['ashulia', 'আশুলিয়া'], 'Dhaka', 'Savar'],
];

type Hit = { d: string; t: string; label: string; score: number };
const norm = (x: string) => x.toLowerCase().normalize('NFC').replace(/[০-৯0-9#.,\-/()]+/g, ' ').replace(/\s+/g, ' ').trim();

export async function areaSearch(form: HTMLElement, g: GeoBoxes): Promise<void> {
  const host = form.closest('[data-area-search]') || (form.hasAttribute('data-area-search') ? form : null);
  if (!host || $('[data-area-find]', form)) return;
  const geo = (await loadGeo()).districts;
  // one list: every thana (with its district), every district (thana left empty), and the well-known places
  const all: { keys: string[]; d: string; t: string; label: string }[] = [];
  for (const d of geo) {
    all.push({ keys: [norm(d.en), norm(d.bn)], d: d.en, t: '', label: `${d.bn} জেলা` });
    for (const a of d.areas) all.push({ keys: [norm(a[0]), norm(a[1])], d: d.en, t: a[0], label: `${a[1].trim()}, ${d.bn}` });
  }
  for (const [keys, d, t] of PLACES) {
    const dd = geo.find((x) => x.en === d);
    const aa = dd && dd.areas.find((x) => x[0] === t);
    if (dd && aa) all.push({ keys: keys.map(norm), d, t, label: `${keys[1]} (${aa[1].trim()}, ${dd.bn})` });
  }
  const find = (q: string): Hit[] => {
    const n = norm(q);
    if (n.length < 2) return [];
    const hits: Hit[] = [];
    for (const x of all) {
      let best = 0;
      for (const k of x.keys) {
        if (!k) continue;
        if (k === n) best = Math.max(best, 4);
        else if (k.startsWith(n)) best = Math.max(best, 3);
        else if (k.length >= 3 && n.includes(k)) best = Math.max(best, 2); // "middle badda" → Badda
        else if (n.length >= 3 && k.includes(n)) best = Math.max(best, 1);
      }
      if (best) hits.push({ d: x.d, t: x.t, label: x.label, score: best + (x.t ? 0.5 : 0) });
    }
    return hits.sort((a, b) => b.score - a.score || a.label.length - b.label.length).slice(0, 8);
  };
  const input = <input type="search" autoComplete="off" enterKeyHint="search" maxLength={60} placeholder="থানা, এলাকা বা বাজারের নাম লিখুন" aria-label="এলাকা খুঁজুন" /> as HTMLInputElement;
  const list = <div className="area-hits" role="listbox" hidden></div> as HTMLElement;
  const note = <small className="muted">বাংলা বা ইংরেজিতে লিখুন, যেমন: মধ্য বাড্ডা, Mirpur 10, Tongi — জেলা আর থানা নিজে বসে যাবে।</small> as HTMLElement;
  const pick = (h: Hit) => {
    g.district.value = h.d;
    g.district.dispatchEvent(new Event('change', { bubbles: true }));
    if (h.t) { g.thana.value = h.t; g.thana.dispatchEvent(new Event('change', { bubbles: true })); }
    input.value = h.label;
    list.hidden = true;
    (h.t ? (form.querySelector('[name="address"]') as HTMLElement | null) : g.thana)?.focus();
  };
  let current: Hit[] = [];
  const show = () => {
    current = find(input.value);
    paint(list, current.map((h) => <button type="button" className="area-hit" role="option" onClick={() => pick(h)}>📍 {h.label}</button>));
    list.hidden = !current.length;
  };
  input.addEventListener('input', show);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); if (current[0]) pick(current[0]); } if (e.key === 'Escape') list.hidden = true; });
  input.addEventListener('blur', () => setTimeout(() => { list.hidden = true; }, 200));
  const box = <div className="field area-find" data-area-find=""><label>🔎 এলাকা খুঁজুন (সহজ উপায়){input}</label>{list}{note}</div> as HTMLElement;
  const anchor = g.district.closest('.field-row') || g.district.closest('.field') || g.district;
  anchor.parentNode?.insertBefore(box, anchor);
}
