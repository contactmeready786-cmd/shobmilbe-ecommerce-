// 🧮 The sums behind the electronics tools (/tools): colour bands, SMD and capacitor codes, standard values.
// Pure — used by the browser (client/shop/tools.tsx) and the server's tool data (lib/data/tools.ts) and tested in
// tests/tools.test.ts.

/** colour bands: digit (or null), multiplier, tolerance %, temperature coefficient ppm/°C, Bangla name, colour */
export type Band = { key: string; bn: string; hex: string; digit: number | null; mult: number | null; tol: number | null; ppm: number | null };
export const BANDS: Band[] = [
  { key: 'black', bn: 'কালো', hex: '#111111', digit: 0, mult: 1, tol: null, ppm: 250 },
  { key: 'brown', bn: 'বাদামি', hex: '#7b3f00', digit: 1, mult: 10, tol: 1, ppm: 100 },
  { key: 'red', bn: 'লাল', hex: '#d32f2f', digit: 2, mult: 100, tol: 2, ppm: 50 },
  { key: 'orange', bn: 'কমলা', hex: '#f57c00', digit: 3, mult: 1e3, tol: 0.05, ppm: 15 },
  { key: 'yellow', bn: 'হলুদ', hex: '#fbc02d', digit: 4, mult: 1e4, tol: 0.02, ppm: 25 },
  { key: 'green', bn: 'সবুজ', hex: '#2e7d32', digit: 5, mult: 1e5, tol: 0.5, ppm: 20 },
  { key: 'blue', bn: 'নীল', hex: '#1565c0', digit: 6, mult: 1e6, tol: 0.25, ppm: 10 },
  { key: 'violet', bn: 'বেগুনি', hex: '#7b1fa2', digit: 7, mult: 1e7, tol: 0.1, ppm: 5 },
  { key: 'grey', bn: 'ধূসর', hex: '#9e9e9e', digit: 8, mult: 1e8, tol: 0.05, ppm: 1 },
  { key: 'white', bn: 'সাদা', hex: '#f5f5f5', digit: 9, mult: 1e9, tol: null, ppm: null },
  { key: 'gold', bn: 'সোনালি', hex: '#c9a227', digit: null, mult: 0.1, tol: 5, ppm: null },
  { key: 'silver', bn: 'রুপালি', hex: '#c0c0c0', digit: null, mult: 0.01, tol: 10, ppm: null },
];

/** EIA-96 SMD codes 01–96 → the three significant digits (E96 series) */
export const E96 = [100, 102, 105, 107, 110, 113, 115, 118, 121, 124, 127, 130, 133, 137, 140, 143, 147, 150, 154, 158, 162, 165, 169, 174, 178, 182, 187, 191, 196, 200, 205, 210, 215, 221, 226, 232, 237, 243, 249, 255, 261, 267, 274, 280, 287, 294, 301, 309, 316, 324, 332, 340, 348, 357, 365, 374, 383, 392, 402, 412, 422, 432, 442, 453, 464, 475, 487, 499, 511, 523, 536, 549, 562, 576, 590, 604, 619, 634, 649, 665, 681, 698, 715, 732, 750, 768, 787, 806, 825, 845, 866, 887, 909, 931, 953, 976];
/** EIA-96 letter → multiplier */
export const E96_MULT: Record<string, number> = { Z: 0.001, Y: 0.01, R: 0.01, X: 0.1, S: 0.1, A: 1, B: 10, H: 10, C: 100, D: 1000, E: 1e4, F: 1e5 };
/** E12 standard values (one decade) */
export const E12 = [10, 12, 15, 18, 22, 27, 33, 39, 47, 56, 68, 82];

/** the value of a resistor from its colour bands (4, 5 or 6 bands), or null when a band can't be there */
export function bandsValue(keys: string[]): { ohms: number; tol: number | null; ppm: number | null } | null {
  const b = keys.map((k) => BANDS.find((x) => x.key === k));
  if (b.some((x) => !x)) return null;
  const n = keys.length;
  const digits = n === 4 ? 2 : 3;
  const d = b.slice(0, digits);
  if (d.some((x) => x!.digit === null) || d[0]!.digit === 0) return null;
  const mult = b[digits]!.mult;
  if (mult === null) return null;
  const sig = d.reduce((v, x) => v * 10 + (x!.digit as number), 0);
  const tol = n >= 4 ? b[digits + 1]!.tol : null;
  const ppm = n === 6 ? b[5]!.ppm : null;
  return { ohms: round(sig * mult), tol, ppm };
}
/** colour bands for a value (4 or 5 bands, significant digits rounded), or null when it can't be shown */
export function valueBands(ohms: number, count: 4 | 5): string[] | null {
  if (!(ohms > 0) || !isFinite(ohms)) return null;
  const digits = count === 4 ? 2 : 3;
  let exp = Math.floor(Math.log10(ohms)) - (digits - 1);
  let sig = Math.round(ohms / 10 ** exp);
  if (sig >= 10 ** digits) { sig = Math.round(sig / 10); exp += 1; }
  const m = BANDS.find((x) => x.mult !== null && Math.abs(Math.log10(x.mult) - exp) < 1e-9);
  if (!m) return null;
  const ds = String(sig).padStart(digits, '0').split('').map((c) => BANDS.find((x) => x.digit === Number(c))!.key);
  return [...ds, m.key];
}
/** a resistance written like 4.7k, 4k7, 220R, 1M, 10 → ohms (or NaN) */
export function parseOhms(text: string): number {
  const t = String(text).trim().replace(/[Ωω]|ohms?/gi, '').replace(/\s+/g, '').replace(/[০-৯]/g, (c) => String('০১২৩৪৫৬৭৮৯'.indexOf(c)));
  const m = /^(\d*\.?\d*)([rkmg]?)(\d*)$/i.exec(t);
  if (!m || (!m[1] && !m[3])) return NaN;
  const mult: Record<string, number> = { '': 1, r: 1, k: 1e3, m: 1e6, g: 1e9 };
  const unit = m[2].toLowerCase();
  // "4k7" style: the letter is the decimal point
  const num = m[3] ? Number(`${m[1] || '0'}.${m[3]}`) : Number(m[1]);
  // a capital M means mega for resistors (no milliohm resistors here)
  return isFinite(num) ? round(num * mult[unit === 'm' ? 'm' : unit]) : NaN;
}
/** an SMD resistor code (103, 4R7, 1002, 01C) → ohms, or null */
export function smdValue(code: string): { ohms: number; kind: string } | null {
  const c = String(code).trim().toUpperCase();
  if (/^0+$/.test(c)) return { ohms: 0, kind: 'জাম্পার (০Ω)' };
  if (/^\d*R\d*$/.test(c) && /\d/.test(c)) return { ohms: Number(c.replace('R', '.')), kind: 'R = দশমিক' };
  if (/^\d{3}$/.test(c)) return { ohms: round(Number(c.slice(0, 2)) * 10 ** Number(c[2])), kind: '৩ অঙ্ক (±৫%)' };
  if (/^\d{4}$/.test(c)) return { ohms: round(Number(c.slice(0, 3)) * 10 ** Number(c[3])), kind: '৪ অঙ্ক (±১%)' };
  const m = /^(\d{2})([ZYRXSABHCDEF])$/.exec(c);
  if (m) { const i = Number(m[1]); if (i >= 1 && i <= 96) return { ohms: round(E96[i - 1] * E96_MULT[m[2]]), kind: 'EIA-96 (±১%)' }; }
  return null;
}
/** a capacitor code (104, 473J, 2A104K, 4R7) → picofarads and the tolerance letter's meaning */
export function capValue(code: string): { pf: number; tol: string } | null {
  let c = String(code).trim().toUpperCase().replace(/^\d[A-Z](?=\d{3})/, ''); // "2A104K": the voltage code goes
  const TOL: Record<string, string> = { B: '±০.১pF', C: '±০.২৫pF', D: '±০.৫pF', F: '±১%', G: '±২%', J: '±৫%', K: '±১০%', M: '±২০%', Z: '+৮০% / −২০%' };
  let tol = '';
  const last = c.slice(-1);
  if (/[BCDFGJKMZ]/.test(last) && c.length > 1) { tol = TOL[last]; c = c.slice(0, -1); }
  if (/^\d*R\d+$/.test(c)) return { pf: Number(c.replace('R', '.')), tol };
  if (/^\d{3}$/.test(c)) return { pf: round(Number(c.slice(0, 2)) * 10 ** Number(c[2])), tol };
  if (/^\d{1,2}$/.test(c)) return { pf: Number(c), tol };
  return null;
}
/** the smallest E12 value ≥ ohms (for "a bit bigger is safe") and the largest ≤ ohms */
export function e12Around(ohms: number): { up: number; down: number } {
  if (!(ohms > 0)) return { up: 0, down: 0 };
  const dec = 10 ** Math.floor(Math.log10(ohms) - 1);
  const all: number[] = [];
  for (const k of [dec / 10, dec, dec * 10, dec * 100]) for (const v of E12) all.push(round(v * k));
  return { up: all.find((v) => v >= ohms * 0.9999) ?? ohms, down: [...all].reverse().find((v) => v <= ohms * 1.0001) ?? ohms };
}
/** ohms as people write it: 220Ω, 4.7kΩ, 1MΩ */
export function fmtOhms(o: number): string {
  if (!isFinite(o)) return '—';
  if (o >= 1e6) return `${trim(o / 1e6)}MΩ`;
  if (o >= 1e3) return `${trim(o / 1e3)}kΩ`;
  return `${trim(o)}Ω`;
}
/** picofarads as pF / nF / µF */
export function fmtCap(pf: number): string {
  if (pf >= 1e6) return `${trim(pf / 1e6)}µF`;
  if (pf >= 1e3) return `${trim(pf / 1e3)}nF`;
  return `${trim(pf)}pF`;
}
const round = (x: number) => Math.round(x * 1e6) / 1e6;
function trim(x: number): string { return String(Math.round(x * 1000) / 1000); }

/** a capacitance written like 100n, 0.1u, 10uF, 22p → picofarads (or NaN); a bare number is µF */
export function parseCap(text: string): number {
  const t = String(text).trim().replace(/[০-৯]/g, (c) => String('০১২৩৪৫৬৭৮৯'.indexOf(c))).replace(/\s+/g, '').replace(/f$/i, '').replace(/µ/g, 'u');
  const m = /^(\d*\.?\d+)([pnu]?)$/i.exec(t);
  if (!m) return NaN;
  const unit = m[2].toLowerCase();
  const mult: Record<string, number> = { '': 1e6, p: 1, n: 1e3, u: 1e6 };
  return round(Number(m[1]) * mult[unit]);
}
/** a number typed by the visitor (Bangla digits allowed) */
export function num(text: string): number {
  const t = String(text).trim().replace(/[০-৯]/g, (c) => String('০১২৩৪৫৬৭৮৯'.indexOf(c))).replace(',', '.');
  return t === '' ? NaN : Number(t);
}
