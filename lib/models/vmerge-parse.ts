// 🧩 Merge into variants — reading a product's name (pure, no database: tests/vmerge.test.ts).
// lib/models/vmerge.ts does the merging.
import { shopPrice, PRICE_MIN } from '../util';

// ---------------------------------------------------------------- reading a product's name
export type Kind = 'carbon_film' | 'metal_film' | 'metal_oxide' | 'carbon_comp' | 'wirewound' | 'cement' | 'smd' | 'std';
export const KINDS: Record<Kind, { en: string; bn: string }> = {
  carbon_film: { en: 'Carbon Film Resistor', bn: 'কার্বন ফিল্ম রেজিস্টর' },
  metal_film: { en: 'Metal Film Resistor', bn: 'মেটাল ফিল্ম রেজিস্টর' },
  metal_oxide: { en: 'Metal Oxide Resistor', bn: 'মেটাল অক্সাইড রেজিস্টর' },
  carbon_comp: { en: 'Carbon Composition Resistor', bn: 'কার্বন কম্পোজিশন রেজিস্টর' },
  wirewound: { en: 'Wire Wound Resistor', bn: 'ওয়্যার উন্ড রেজিস্টর' },
  cement: { en: 'Ceramic Cement Resistor', bn: 'সিরামিক সিমেন্ট রেজিস্টর' },
  smd: { en: 'SMD Resistor', bn: 'এসএমডি রেজিস্টর' },
  std: { en: 'Resistor', bn: 'রেজিস্টর' },
};
/** prec: 1 % tolerance (precision) — sold apart from the usual 5 %; ni: non-inductive; fp: flameproof (each its own product) */
export type Parsed = { kind: Kind; watt: number; pkg: string; ohm: number; pcs: number; tol: string; prec: boolean; ni: boolean; fp: boolean };
export type Skip = { reason: string };

// not a plain fixed resistor (or not one value): left alone
const NOT_FIXED = /potentiometer|\bpots?\b|preset|trimmer|trim\s*pot|variable|rheostat|\bldr\b|photo\s*-?\s*resist|thermistor|\bntc\b|\bptc\b|varistor|\bmov\b|\bkits?\b|assort|network|array|\bsip\b|\bdip\b|book|colou?r\s*code|sample|module|board|calculator|\bvalues?\b|combo/i;
const SMD_SIZE = /\b(0201|0402|0603|0805|1206|1210|2010|2512)\b/;

function kindOf(name: string): Kind {
  const n = name.toLowerCase();
  if (/\bsmd\b|\bsmt\b|chip\s*resistor/.test(n) || SMD_SIZE.test(n)) return 'smd';
  if (/cement|ceramic/.test(n)) return 'cement';
  if (/wire\s*-?\s*wound/.test(n)) return 'wirewound';
  if (/metal\s*oxide/.test(n)) return 'metal_oxide';
  if (/metal\s*film|\bmf\b/.test(n)) return 'metal_film';
  if (/carbon\s*comp/.test(n)) return 'carbon_comp';
  if (/carbon\s*film|\bcf\b/.test(n)) return 'carbon_film';
  return 'std';
}
const WATTS = [0.0625, 0.1, 0.125, 0.167, 0.25, 0.333, 0.5, 0.75, 1, 2, 3, 4, 5, 7, 8, 10, 15, 20, 25, 30, 50, 100];
/** the power the name says first ("1/2 Watt … 0.25 Watt" → 0.5: the later numbers are often copied wrongly) */
function wattOf(name: string): number | null {
  const found: { at: number; w: number }[] = [];
  for (const m of name.matchAll(/(\d+)\s*\/\s*(\d+)\s*-?\s*(?:w\b|watts?\b)/gi)) found.push({ at: m.index ?? 0, w: Number(m[1]) / Number(m[2]) });
  for (const m of name.matchAll(/(?<![\d/.])(\d+(?:\.\d+)?)\s*-?\s*(?:w\b|watts?\b)/gi)) found.push({ at: m.index ?? 0, w: Number(m[1]) });
  for (const m of name.matchAll(/quarter\s*-?\s*watt/gi)) found.push({ at: m.index ?? 0, w: 0.25 });
  for (const m of name.matchAll(/half\s*-?\s*watt/gi)) found.push({ at: m.index ?? 0, w: 0.5 });
  found.sort((a, b) => a.at - b.at);
  for (const f of found) {
    const w = WATTS.find((x) => Math.abs(x - f.w) < 0.01);
    if (w) return w;
  }
  return null;
}
const MULT: Record<string, number> = { '': 1, r: 1, k: 1e3, m: 1e6 };
/** every resistance the name mentions, in ohm (distinct) */
export function ohmsOf(name: string): number[] {
  const out = new Set<number>();
  const add = (v: number) => { if (v >= 0 && v < 1e9) out.add(Math.round(v * 1000) / 1000); };
  const clean = name.replace(/(\d),(\d{3})\b/g, '$1$2');
  for (const m of clean.matchAll(/(?<![\d.A-Za-z])(\d+(?:\.\d+)?)\s*([kKmM])?\s*(?:ohms?\b|Ω|ω|Ω)/gi)) add(Number(m[1]) * MULT[(m[2] || '').toLowerCase()]);
  for (const m of clean.matchAll(/\b(\d+)([kKmMrR])(\d+)\b/g)) add(Number(`${m[1]}.${m[3]}`) * MULT[m[2].toLowerCase()]); // 4K7, 4R7
  if (!out.size) {
    // "10K Resistor", "100R", "2.2M" with no "ohm" written
    for (const m of clean.matchAll(/(?<![\d./])(\d+(?:\.\d+)?)\s*([kKmMrR])\b(?!\s*-?\s*(?:pcs|pc|pieces?|watt|w\b))/g)) add(Number(m[1]) * MULT[m[2].toLowerCase()]);
  }
  return [...out];
}
export function pcsOf(name: string): number {
  const m = /(\d+)\s*-?\s*(?:pcs|pc|pieces?|nos|psc)(?![a-z])/i.exec(name) || /pack\s*of\s*(\d+)/i.exec(name) || /(\d+)\s*x\s+(?=.*resist)/i.exec(name);
  const n = m ? Number(m[1]) : 1;
  return n >= 1 && n <= 5000 ? n : 1;
}

/** What a product's name says — or why it is left alone. */
export function parse(name: string): Parsed | Skip {
  const n = String(name || '').replace(/\s+/g, ' ').trim();
  if (!/resist|রেজিস্ট/i.test(n)) return { reason: 'not a resistor' };
  if (NOT_FIXED.test(n)) return { reason: 'not a single fixed resistor (variable / kit / set / module)' };
  const ohms = ohmsOf(n);
  if (!ohms.length) return { reason: 'value (ohm) not written in the name' };
  if (ohms.length > 1) return { reason: 'more than one value in the name (a set)' };
  const kind = kindOf(n);
  const pkg = kind === 'smd' ? (SMD_SIZE.exec(n)?.[1] || '') : '';
  const watt = wattOf(n);
  if (watt === null && kind !== 'smd') return { reason: 'power (watt) not written in the name' };
  const tol = /(?<![\d.])(\d+(?:\.\d+)?)\s*%/.exec(n)?.[1] || '';
  const prec = tol !== '' && Number(tol) <= 1;
  return { kind, watt: watt ?? 0, pkg, ohm: ohms[0], pcs: pcsOf(n), tol, prec, ni: /non\s*-?\s*inductive/i.test(n), fp: /flame\s*-?\s*proof/i.test(n) };
}

// ---------------------------------------------------------------- labels
const BN_DIGITS = '০১২৩৪৫৬৭৮৯';
export const bnNum = (s: string) => s.replace(/\d/g, (d) => BN_DIGITS[Number(d)]);
const trimNum = (v: number) => String(Math.round(v * 1000) / 1000);
/** 4700 → "4.7kΩ" (the label on the value button; the same in both languages) */
export function ohmLabel(ohm: number): string {
  if (ohm >= 1e6) return `${trimNum(ohm / 1e6)}MΩ`;
  if (ohm >= 1e3) return `${trimNum(ohm / 1e3)}kΩ`;
  return `${trimNum(ohm)}Ω`;
}
/** 4700 → "৪.৭ কিলো ওহম" (for the Bangla name) */
export function ohmBn(ohm: number): string {
  if (ohm >= 1e6) return `${bnNum(trimNum(ohm / 1e6))} মেগা ওহম`;
  if (ohm >= 1e3) return `${bnNum(trimNum(ohm / 1e3))} কিলো ওহম`;
  return `${bnNum(trimNum(ohm))} ওহম`;
}
const FRACTION: Record<string, string> = { '0.0625': '1/16', '0.125': '1/8', '0.167': '1/6', '0.25': '1/4', '0.333': '1/3', '0.5': '1/2', '0.75': '3/4' };
export function wattLabel(w: number): string { return w ? `${FRACTION[String(w)] || trimNum(w)}W` : ''; }
export function wattBn(w: number): string { return w ? `${bnNum(FRACTION[String(w)] || trimNum(w))} ওয়াট` : ''; }
/** the same part = same kind, power, size, tolerance class and build; a part with no kind written also only joins
 *  others from the same shop (`from`), so two different-looking "5 W resistors" are never put together */
export function groupKey(p: Parsed, from = ''): string {
  return [p.kind, p.watt, p.pkg, p.prec ? '1%' : '', p.ni ? 'ni' : '', p.fp ? 'fp' : '', p.kind === 'std' ? from : ''].join('|');
}
export function groupNames(p: Pick<Parsed, 'kind' | 'watt' | 'pkg'> & Partial<Pick<Parsed, 'prec' | 'ni' | 'fp'>>): { en: string; bn: string } {
  const k = KINDS[p.kind];
  const en = [wattLabel(p.watt), p.ni ? 'Non-Inductive' : '', p.fp ? 'Flameproof' : '', k.en, p.pkg, p.prec ? '1%' : ''].filter(Boolean).join(' ');
  const bn = [wattBn(p.watt), p.ni ? 'নন-ইন্ডাক্টিভ' : '', p.fp ? 'ফ্লেমপ্রুফ' : '', k.bn, p.pkg ? bnNum(p.pkg) : '', p.prec ? '১%' : ''].filter(Boolean).join(' ');
  return { en, bn };
}
/** the pack price → the price of one piece: whole paisa, rounded up (never a loss), at least ৳0.50 */
export function perPiece(price: number, pcs: number): number {
  const v = pcs > 1 ? Math.ceil((Number(price) / pcs) * 100 - 1e-6) / 100 : Number(price);
  return shopPrice(Math.max(PRICE_MIN, v));
}

