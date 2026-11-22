// 🧩 Merge into variants — the product families (owner, 2026-11-22: "find every product like the resistors: the same
// thing, only the value differs"). Each family reads a name and says: which group it belongs to (same kind / size /
// voltage …), what its value is (for the button and the order), and the facts the main product's description holds.
// Pure, no database (tests/vfamilies.test.ts). Resistors are read by vmerge-parse; the others here.
import { parse as parseResistor, groupKey, groupNames, ohmLabel, ohmBn, wattBn, bnNum, KINDS, ohmsOf, pcsOf } from './vmerge-parse';

export type Item = {
  /** the group: products with the same key become one product */
  key: string; en: string; bn: string;
  /** the value: sorts the buttons; the same value twice = a duplicate */
  value: number; label: string; labelBn: string;
  /** the picker's heading on the product page */
  title: string;
  /** the main product's facts (only facts every value shares are kept) and the description's first line */
  facts: string[]; intro: string;
  pcs: number;
  /** a part with no kind written only joins others from the same shop */
  byShop: boolean;
};
export type NoFamily = { reason: string; listed: boolean };

const trim = (v: number) => String(Math.round(v * 1000) / 1000);
const VOLTS = (n: string) => { const m = /(?<![\d.])(\d+(?:\.\d+)?)\s*v(?:olts?|dc)?\b/i.exec(n); return m ? Number(m[1]) : null; };
const NOT_PLAIN = /\bsmd\b|\bchip\b|\bkits?\b|\bsets?\b|\bvalues?\b|assort|combo|module|board/i;

// ---- capacitors
function pf(n: string): number | null {
  const m = /(?<![\d.])(\d+(?:\.\d+)?)\s*(pf|nf|uf|µf|mfd)\b/i.exec(n);
  if (m) {
    const v = Number(m[1]); const u = m[2].toLowerCase();
    // "224pF" is the code 224 (22 × 10⁴ pF) written with a unit by mistake: a 3-digit number not ending in 0
    if (u === 'pf' && /^\d{3}$/.test(m[1]) && !m[1].endsWith('0')) return Number(m[1].slice(0, 2)) * 10 ** Number(m[1][2]);
    return u === 'pf' ? v : u === 'nf' ? v * 1e3 : v * 1e6;
  }
  const c = /(?<![\d.])([1-9]\d)([0-6])(?![\d.])/.exec(n.replace(/\d+\s*v\b/gi, ' '));
  return c ? Number(c[1]) * 10 ** Number(c[2]) : null;
}
export function capLabel(p: number): string {
  if (p >= 1e6) return `${trim(p / 1e6)}µF`;
  if (p >= 1e3) return `${trim(p / 1e3)}nF`;
  return `${trim(p)}pF`;
}
const capBn = (p: number) => bnNum(capLabel(p)).replace('µF', ' মাইক্রোফ্যারাড').replace('nF', ' ন্যানোফ্যারাড').replace('pF', ' পিকোফ্যারাড');

function ceramic(n: string): Item | NoFamily | null {
  if (!/ceramic/i.test(n) || !/capacit/i.test(n)) return null;
  if (NOT_PLAIN.test(n.slice(0, 60)) || /\bkv\b|high\s*voltage|y\s*cap/i.test(n)) return { reason: 'not a plain ceramic disc capacitor', listed: true };
  const v = pf(n); const volt = VOLTS(n);
  if (!v || !volt) return { reason: 'value or voltage not written in the name', listed: true };
  return { key: `cap-ceramic|${volt}`, en: `${trim(volt)}V Ceramic Disc Capacitor`, bn: `${bnNum(trim(volt))} ভোল্ট সিরামিক ডিস্ক ক্যাপাসিটর`,
    value: v, label: capLabel(v), labelBn: capBn(v), title: 'মান (ক্যাপাসিট্যান্স)', pcs: pcsOf(n), byShop: false,
    facts: ['ধরন: সিরামিক ডিস্ক ক্যাপাসিটর (নন-পোলারাইজড)', `ভোল্টেজ: ${bnNum(trim(volt))} ভোল্ট`, 'দুই পিন লিড (থ্রু-হোল)'],
    intro: 'সিরামিক ডিস্ক ক্যাপাসিটর — ফিল্টার, ডিকাপলিং ও টাইমিং সার্কিটে ব্যবহার হয়।' };
}
function electrolytic(n: string): Item | NoFamily | null {
  if (!/electrolytic/i.test(n) || !/capacit/i.test(n)) return null;
  if (NOT_PLAIN.test(n.slice(0, 60))) return { reason: 'not a plain electrolytic capacitor', listed: true };
  const m = /(?<![\d.])(\d+(?:\.\d+)?)\s*(uf|µf|mfd)\b/i.exec(n); const volt = VOLTS(n);
  if (!m || !volt) return { reason: 'value or voltage not written in the name', listed: true };
  const v = Number(m[1]) * 1e6;
  return { key: `cap-elec|${volt}`, en: `${trim(volt)}V Electrolytic Capacitor`, bn: `${bnNum(trim(volt))} ভোল্ট ইলেক্ট্রোলাইটিক ক্যাপাসিটর`,
    value: v, label: `${trim(v / 1e6)}µF`, labelBn: `${bnNum(trim(v / 1e6))} মাইক্রোফ্যারাড`, title: 'মান (ক্যাপাসিট্যান্স)', pcs: pcsOf(n), byShop: false,
    facts: ['ধরন: অ্যালুমিনিয়াম ইলেক্ট্রোলাইটিক (পোলারাইজড)', `ভোল্টেজ: ${bnNum(trim(volt))} ভোল্ট`, 'রেডিয়াল দুই পিন লিড'],
    intro: 'ইলেক্ট্রোলাইটিক ক্যাপাসিটর — পাওয়ার সাপ্লাই ফিল্টার ও কাপলিংয়ে ব্যবহার হয়। লাগানোর সময় + আর − দিক মিলিয়ে লাগাতে হয়।' };
}

// ---- LEDs and LED holders (the value is the colour)
const COLOURS: [RegExp, string, string][] = [
  [/warm\s*white/i, 'Warm White', 'ওয়ার্ম হোয়াইট'], [/\bred\b/i, 'Red', 'লাল'], [/\bgreen\b/i, 'Green', 'সবুজ'], [/\bblue\b/i, 'Blue', 'নীল'],
  [/\byellow\b/i, 'Yellow', 'হলুদ'], [/\borange\b/i, 'Orange', 'কমলা'], [/\bwhite\b/i, 'White', 'সাদা'], [/\bpink\b/i, 'Pink', 'গোলাপি'],
  [/\b(purple|violet)\b/i, 'Purple', 'বেগুনি'], [/\brgb\b/i, 'RGB', 'আরজিবি'],
];
function colour(n: string): { i: number; bn: string } | null {
  const hits = COLOURS.map((c, i) => ({ i, at: n.search(c[0]), bn: c[2] })).filter((h) => h.at >= 0);
  // "Water Clear LED 5mm Blue … Transparent RED LED" (copied wrongly): the first colour said wins
  hits.sort((a, b) => a.at - b.at);
  return hits[0] ? { i: hits[0].i, bn: hits[0].bn } : null;
}
function led(n: string): Item | NoFamily | null {
  if (!/\bleds?\b/i.test(n)) return null;
  const size = /(?<![\d.])(3|5|8|10)\s*mm\b/i.exec(n)?.[1];
  if (!size) return null;
  const holder = /holder/i.test(n);
  if (!holder && /board|strip|module|watt|\d\s*w\b|\bcob\b|\bsmd\b|\buv\b|money|infrared|\bir\b|flash|blink|rgb\s*fast|tester/i.test(n)) return null;
  const c = colour(n);
  if (!c) return { reason: 'colour not written in the name', listed: true };
  const style = holder ? 'holder' : /ice\s*cream/i.test(n) ? 'icecream' : /water\s*clear|transparent/i.test(n) ? 'clear' : 'diffused';
  const names: Record<string, [string, string, string]> = {
    holder: [`${size}mm Plastic LED Holder`, `${bnNum(size)} মিমি প্লাস্টিক এলইডি হোল্ডার`, `${bnNum(size)} মিমি এলইডি লাগানোর প্লাস্টিক হোল্ডার (প্যানেল মাউন্ট)।`],
    icecream: [`${size}mm Ice Cream LED`, `${bnNum(size)} মিমি আইসক্রিম এলইডি`, `${bnNum(size)} মিমি আইসক্রিম (রঙিন, ছড়ানো আলো) এলইডি।`],
    clear: [`${size}mm Water Clear LED (Ultra Bright)`, `${bnNum(size)} মিমি ওয়াটার ক্লিয়ার এলইডি (আল্ট্রা ব্রাইট)`, `${bnNum(size)} মিমি ওয়াটার ক্লিয়ার (স্বচ্ছ, উজ্জ্বল) এলইডি।`],
    diffused: [`${size}mm Colored LED`, `${bnNum(size)} মিমি রঙিন এলইডি`, `${bnNum(size)} মিমি রঙিন (ডিফিউজড) রাউন্ড এলইডি।`],
  };
  const [en, bn, intro] = names[style];
  return { key: `led|${style}|${size}`, en, bn, value: c.i, label: c.bn, labelBn: c.bn, title: 'রং', pcs: pcsOf(n), byShop: false,
    facts: holder ? [`সাইজ: ${bnNum(size)} মিমি এলইডির জন্য`, 'প্লাস্টিক'] : [`সাইজ: ${bnNum(size)} মিমি`, 'দুই পিন লিড (লম্বা পা +)'], intro };
}

// ---- zener diodes (the value is the voltage)
function zener(n: string): Item | NoFamily | null {
  if (!/zener/i.test(n)) return null;
  if (NOT_PLAIN.test(n.slice(0, 60))) return { reason: 'not a single zener diode', listed: true };
  const volt = VOLTS(n);
  if (!volt) return { reason: 'voltage not written in the name', listed: true };
  const fr = /(\d+)\s*\/\s*(\d+)\s*-?\s*w(?:att)?\b/i.exec(n); const mwm = /(\d+)\s*mw\b/i.exec(n); const wm = /(?<![\d./])(\d+(?:\.\d+)?)\s*-?\s*w(?:att)?s?\b/i.exec(n);
  const mw = fr ? Math.round((Number(fr[1]) / Number(fr[2])) * 1000) : mwm ? Number(mwm[1]) : wm ? Number(wm[1]) * 1000 : 500;
  const power = mw >= 1000 ? `${trim(mw / 1000)}W` : `${mw}mW`;
  const powerBn = mw >= 1000 ? `${bnNum(trim(mw / 1000))} ওয়াট` : `${bnNum(String(mw))} মিলিওয়াট`;
  return { key: `zener|${mw}`, en: `${power} Zener Diode`, bn: `${powerBn} জেনার ডায়োড`, value: volt, label: `${trim(volt)}V`, labelBn: `${bnNum(trim(volt))} ভোল্ট`,
    title: 'ভোল্টেজ', pcs: pcsOf(n), byShop: false, facts: [`পাওয়ার: ${powerBn}`, 'দুই পিন লিড (থ্রু-হোল)'],
    intro: 'জেনার ডায়োড — নির্দিষ্ট ভোল্টেজ ধরে রাখতে (ভোল্টেজ রেগুলেশন ও সুরক্ষায়) ব্যবহার হয়।' };
}

// ---- trimmers / potentiometers of one model (the value is the resistance)
const POT_CODE = (n: string) => { const m = /(?<![\d.])([1-9]\d)([1-6])(?![\d.])/.exec(n); return m ? Number(m[1]) * 10 ** Number(m[2]) : null; };
const TRIMS: [RegExp, string, string, string, string][] = [
  [/\brm\s*-?\s*065\b/i, 'rm065', 'RM065 Trimmer Potentiometer (Trimpot)', 'আরএম০৬৫ ট্রিমার পোটেনশিওমিটার (ট্রিমপট)', 'একবার ঘোরানো (সিঙ্গেল টার্ন), ৬ মিমি, ৩ পিন'],
  [/\b3296\b/, '3296', '3296 Multi-Turn Trimpot (Square, Vertical)', '৩২৯৬ মাল্টি-টার্ন ট্রিমপট (চারকোনা, ভার্টিক্যাল)', '২৫ টার্ন, ৩ পিন, উপর থেকে অ্যাডজাস্ট'],
  [/\b3386\b/, '3386', '3386 Trimpot (Square, Top Adjust)', '৩৩৮৬ ট্রিমপট (চারকোনা, উপর থেকে অ্যাডজাস্ট)', 'একবার ঘোরানো, ৩ পিন'],
  [/\b3006p?\b/i, '3006', '3006P Multi-Turn Trimpot', '৩০০৬পি মাল্টি-টার্ন ট্রিমপট', 'মাল্টি-টার্ন, ৩ পিন, পাশ থেকে অ্যাডজাস্ট'],
  [/single\s*gang.*rotary|rotary.*single\s*gang/i, 'rotary1', 'Single Gang Rotary Potentiometer', 'সিঙ্গেল গ্যাং রোটারি পোটেনশিওমিটার', 'লিনিয়ার, ৩ পিন'],
];
function trimmer(n: string): Item | NoFamily | null {
  const t = TRIMS.find((x) => x[0].test(n));
  if (!t || !/potentio|trim|\bvr\b|variable/i.test(n)) return null;
  const ohms = ohmsOf(n.replace(t[0], ' ').replace(/\b\d+\s*(?:turn|pin|mm)\b/gi, ' ').replace(/\b\d+(?:\.\d+)?\s*(?:w|watt|mw)\b/gi, ' '));
  const v = ohms.length === 1 ? ohms[0] : ohms.length ? null : POT_CODE(n.replace(t[0], ' '));
  if (!v) return { reason: 'value (ohm) not clear in the name', listed: true };
  return { key: `pot|${t[1]}`, en: t[2], bn: t[3], value: v, label: ohmLabel(v), labelBn: ohmBn(v), title: 'মান (ওহম)', pcs: pcsOf(n), byShop: false,
    facts: [t[4].split(',').map((x) => x.trim()).join(' · ')], intro: `${t[3]} — সার্কিটে রেজিস্ট্যান্স (ভোল্টেজ, কারেন্ট, সেটিং) অ্যাডজাস্ট করতে ব্যবহার হয়।` };
}

// ---- resistors (vmerge-parse)
function resistor(n: string): Item | NoFamily | null {
  const p = parseResistor(n);
  if ('reason' in p) return p.reason === 'not a resistor' ? null : { reason: p.reason, listed: true };
  const k = KINDS[p.kind];
  const names = groupNames(p);
  return { key: groupKey(p, ''), en: names.en, bn: names.bn, value: p.ohm, label: ohmLabel(p.ohm), labelBn: ohmBn(p.ohm), title: 'মান (ওহম)', pcs: p.pcs, byShop: p.kind === 'std',
    facts: [`ধরন: ${k.bn}`, p.watt ? `পাওয়ার রেটিং: ${wattBn(p.watt)}` : '', p.pkg ? `সাইজ (প্যাকেজ): ${bnNum(p.pkg)}` : '', p.tol ? `টলারেন্স: ±${bnNum(p.tol)}%` : '',
      p.ni ? 'নন-ইন্ডাক্টিভ' : '', p.fp ? 'ফ্লেমপ্রুফ' : '', p.kind === 'smd' ? '' : 'দুই পিন লিড (থ্রু-হোল)'].filter(Boolean),
    intro: `${wattBn(p.watt) ? wattBn(p.watt) + ' ' : ''}${k.bn} — ফিক্সড রেজিস্টর, সার্কিটে কারেন্ট সীমিত বা ভোল্টেজ ভাগ করতে ব্যবহার হয়।` };
}

/** Which family a product's name belongs to (the first that knows it), or why it is left alone. */
export function read(name: string): Item | NoFamily {
  const n = String(name || '').replace(/\s+/g, ' ').trim();
  for (const f of [trimmer, ceramic, electrolytic, zener, led, resistor]) {
    const r = f(n);
    if (r) return r;
  }
  return { reason: 'not in a family', listed: false };
}
