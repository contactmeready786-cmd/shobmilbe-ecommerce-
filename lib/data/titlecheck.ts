// 🏷️ Safety checks for a product name the AI wrote again (lib/services/titlefix.ts) — owner, 2026-11-28:
// "the title must always be the same product — never another product's title, no mistakes".
// Pure functions (no database), tested in tests/titlecheck.test.ts. A name that fails any check is never put in
// by itself: it waits for the owner on Admin → পণ্য → নাম ঠিক করা (AI).

/** "BC-327", "bc 327" and "BC327" are the same thing: letters and digits only, upper case */
export const squash = (s: string) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

// sizes and amounts ("12V", "25mm", "200RPM", "2000mAh", "3x4", "1/4W") are not part numbers: the AI may write a
// range "3V–12V" instead of "3V 6V 12V". Model / part codes (LM324N, BTA16-600B, HC-SR04, 18650, N20) must all stay.
const UNIT = /^(\d+(\.\d+)?)(V|VAC|VDC|KV|A|MA|W|KW|MW|MM|CM|M|KM|RPM|MAH|AH|WH|OHM|OHMS|K|KOHM|R|UF|NF|PF|MF|F|HZ|KHZ|MHZ|GHZ|DB|DBI|G|GM|KG|MG|PCS|PC|PIECE|PIN|PINS|P|INCH|IN|FT|L|ML|MBPS|KB|MB|GB|TB|C|S|MS|H|HR|HRS|MIN|PAIR|X|CH|CHANNEL|CELL|S\d*|PORT|WAY|LED|LEDS|BIT|AWG|GAUGE|TEETH|T|MIL|DEGREE|DEG|LM|LUX|PSI|BAR|NM|KGCM)$/;

/** the part / model codes in a name: tokens with letters and digits (or 4+ digit numbers like 18650), not sizes */
export function partCodes(name: string): string[] {
  const out = new Set<string>();
  for (const raw of String(name || '').split(/[\s,;:/()[\]{}|+&–—~]+/)) {
    const t = raw.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '');
    // a range of sizes "3V-12V" / "5-12V" is not a part code
    if (t.includes('-') && t.split('-').every((x) => /^\d+(\.\d+)?$/.test(x) || UNIT.test(squash(x)))) continue;
    const s = squash(t);
    if (s.length < 3) continue;
    const letters = /[A-Z]/.test(s), digits = /\d/.test(s);
    if (!digits) continue;
    if (UNIT.test(s)) continue;
    if (/^\d+X\d+(X\d+)?[A-Z]*$/.test(s)) continue; // 3x4, 320x160mm
    if (!letters && s.length < 4) continue; // "120" is a number, "18650" / "7805" are parts
    if (/^\d+(\.\d+)?$/.test(t) && s.length > 6) continue; // long plain numbers (barcodes) are not names
    out.add(s);
  }
  return [...out];
}

/** every number written in a text (digits only, Bangla digits read too) */
export function numbersIn(text: string): Set<string> {
  const t = String(text || '').replace(/[০-৯]/g, (d) => String('০১২৩৪৫৬৭৮৯'.indexOf(d)));
  return new Set((t.match(/\d+(?:\.\d+)?/g) || []).map((n) => n.replace(/^0+(?=\d)/, '').replace(/\.0+$/, '')));
}

const FILLER = /\b(price in (bd|bangladesh)|best quality|a class|medium class|electrical circuitry|buy now|free shipping|original product)\b/i;
const BROKEN = /\b[A-Za-z]{1,5}-[a-z]{2,}\b/; // "Comp-arator", "Regu-lating" (real ones like "Li-ion", "Wi-fi" are allowed below)
const OK_HYPHEN = /\b(li-ion|li-po|wi-fi|on-off|plug-in|built-in|add-on|t-shirt|x-ray|e-bike|non-slip|anti-static|step-up|step-down|dual-channel|single-channel|multi-color|hi-fi|in-line|push-button|snap-on|all-in-one|3-in-1|2-in-1|4-in-1|5-in-1|type-c|usb-c|micro-usb|mini-usb|o-ring|u-shaped|l-shaped|t-shaped|v-shaped|y-shaped|re-usable|self-locking|self-adhesive|high-speed|low-power|high-power|low-voltage|high-voltage|double-sided|single-sided|heat-shrink|non-woven|pre-tinned|half-bridge|full-bridge|h-bridge|n-channel|p-channel|d-sub|ip-camera|cctv-camera|a-type|b-type)\b/gi;

export type TitleVerdict = { ok: boolean; why: string[] };

/**
 * Is the new name safe to put in by itself?
 *  - every part / model code of the old name is still there (spelled the same, dashes and spaces aside)
 *  - no number that isn't in the old name or the description (nothing invented)
 *  - no new part code (it can't have become another product)
 *  - 12–110 letters, no filler words, no broken "Comp-arator" words left
 */
export function checkTitle(oldName: string, newName: string, description = ''): TitleVerdict {
  const why: string[] = [];
  const n = String(newName || '').replace(/\s+/g, ' ').trim();
  if (n.length < 12) why.push('খুব ছোট');
  if (n.length > 110) why.push('খুব লম্বা');
  const have = squash(n);
  const lost = partCodes(oldName).filter((c) => !have.includes(c));
  if (lost.length) why.push(`মডেল/কোড বাদ পড়েছে: ${lost.join(', ')}`);
  const known = squash(`${oldName} ${description}`);
  const added = partCodes(n).filter((c) => !known.includes(c));
  if (added.length) why.push(`নতুন কোড যোগ হয়েছে: ${added.join(', ')}`);
  const nums = numbersIn(`${oldName} ${description}`);
  const newNums = [...numbersIn(n)].filter((x) => !nums.has(x));
  if (newNums.length) why.push(`নতুন সংখ্যা: ${newNums.join(', ')}`);
  if (FILLER.test(n)) why.push('বাড়তি কথা রয়ে গেছে');
  if (BROKEN.test(n.replace(OK_HYPHEN, ''))) why.push('ভাঙা শব্দ রয়ে গেছে');
  return { ok: !why.length, why };
}

/** The Bangla name: Bangla letters only (Bangla digits), at least a few letters, no English left. */
export function checkBangla(bnName: string): string | null {
  const v = String(bnName || '').replace(/\d/g, (d) => '০১২৩৪৫৬৭৮৯'[Number(d)]).replace(/\s+/g, ' ').trim();
  if (v.length < 4 || v.length > 150) return null;
  if (/[A-Za-z]/.test(v)) return null;
  if (!/[ঀ-৿]{2,}/.test(v)) return null;
  return v;
}
