// 1️⃣ Pack → single piece — reading a name (pure, no database: tests/packsingle.test.ts). lib/models/packsingle.ts
// does the change. "50Pcs- 100 Ohm Resistor" / "LED 5mm Red (10 Pieces)" / "Pack of 20" → 50 / 10 / 20 pieces, and the
// name without that part. A set (kit, combo, assorted, "30 values", "3 in 1" …) is one thing and is left alone.

export const SET_WORDS = /\bkits?\b|combo|assort|\bvalues?\b|organi[sz]er|collection|\bmixed\b|\bmix\b|\btypes\b|\bsizes\b|\d+\s*colou?rs?\b|\d+\s*in\s*1\b|\bpairs?\b|\bjodi\b|সেট|কিট|কম্বো/i;
// "… Set" / "6 Pcs Set" is a tool set (one item); "Set of 10Pcs" / "Bundle of 5 Pieces" is a pack of the same thing
const TOOL_SET = (n: string) => /(?<![-\w])sets?\b/i.test(n) && !/\bset\s*of\s*\d/i.test(n);
const BIG_SHRINK = (n: string, pcs: number) => /heat\s*shrink/i.test(n) && pcs > 50;
// the count is a part inside one item: "Board & 4Pcs drivers", "Knife With 6 Pieces Blades", "Glue sticks with … gun"
const PART_OF_ONE = /(?:\bwith\b|\band\b|&|\+)\s*\d+\s*-?\s*(?:pcs|pieces?)|glue\s*sticks?\b.*\bwith\b.*\b(?:gun|machine)|\b(?:twist|strands?)\b/i;
// an LED board / bulb / strip says how many LEDs are on it ("50Watt … 48Pcs SMD LED") — it is one board
const LED_BOARD = (n: string) => /\bleds?\b/i.test(n) && /smd\s*leds?|leds?\s*light\s*bulbs?|\bboard\b|\bstrip\b|halogen/i.test(n) && /watt|\d\s*w\b/i.test(n);

const BN = '০১২৩৪৫৬৭৮৯';
const toLatin = (s: string) => s.replace(/[০-৯]/g, (d) => String(BN.indexOf(d)));

// the pieces part of a name, in the forms the copied shops write it
const PCS_RE = /(?:^|(?<=[\s(\[,|/–—-]))\(?\s*(\d{1,4})\s*-?\s*(?:pcs|pieces?|psc|nos)(?![a-z])\s*\)?\s*[-–—:|]*\s*/gi;
const PACK_OF_RE = /[\s(\[,–—-]*\(?\s*(?:pack|packet|lot|bundle|set)\s*of\s*(\d{1,4})\s*(?:pcs|pieces?)?\s*\)?/gi;
const BN_RE = /(?:^|(?<=[\s(–—-]))\(?\s*([০-৯0-9]{1,4})\s*(?:পিস|পিচ)(?:ের)?\s*\)?\s*[-–—:]*\s*/g;
const BN_PACK_RE = /[\s(–—-]*\(?\s*([০-৯0-9]{1,4})\s*(?:পিসের|পিস|টির|টি)\s*প্যাক(?:\s*পিস)?\s*\)?/g;

export type PackRead = { pcs: number; name: string } | { skip: string };

function tidy(s: string): string {
  return s.replace(/\(\s*\)|\[\s*\]/g, ' ').replace(/\s*[-–—:|]\s*$/g, '').replace(/^\s*[-–—:|,]\s*/g, '').replace(/\s{2,}/g, ' ').trim();
}

/** How many pieces an English name says the product is sold in, and the name without it. */
export function readPack(name: string): PackRead {
  const n = String(name || '').replace(/\s+/g, ' ').trim();
  if (SET_WORDS.test(n) || TOOL_SET(n)) return { skip: 'a set / kit (one item)' };
  if (PART_OF_ONE.test(n)) return { skip: 'the count is a part of one item' };
  if (LED_BOARD(n)) return { skip: 'an LED board (the count is LEDs on it)' };
  const found = new Set<number>();
  for (const m of n.matchAll(PCS_RE)) found.add(Number(m[1]));
  for (const m of n.matchAll(PACK_OF_RE)) found.add(Number(m[1]));
  if (!found.size) return { skip: 'no pieces count in the name' };
  if (found.size > 1) return { skip: 'two different piece counts in the name' };
  const pcs = [...found][0];
  if (pcs < 2) return { skip: 'already one piece' };
  if (BIG_SHRINK(n, pcs)) return { skip: 'a set / kit (one item)' };
  if (pcs > 2000) return { skip: 'piece count too big to trust' };
  const clean = tidy(n.replace(PACK_OF_RE, ' ').replace(PCS_RE, ' '));
  if (clean.length < 4) return { skip: 'name would be empty' };
  return { pcs, name: clean };
}

/** the Bangla name without its "৫০ পিস" part (only when it says the same count) */
export function cleanBn(nameBn: string, pcs: number): string {
  let out = String(nameBn || '');
  out = out.replace(BN_PACK_RE, (all, d) => (Number(toLatin(d)) === pcs ? ' ' : all));
  out = out.replace(BN_RE, (all, d) => (Number(toLatin(d)) === pcs ? ' ' : all));
  return tidy(out);
}

/** the same count removed from other text (SEO title, descriptions): "50Pcs", "50 pcs", "Pack of 50" */
export function cleanText(text: string, pcs: number): string {
  if (!text) return text;
  const one = new RegExp(`(?<![\\d.])${pcs}\\s*-?\\s*(?:pcs|pc|pieces?|psc)(?![a-z])\\s*[-–—:]?\\s*`, 'gi');
  const pack = new RegExp(`\\(?\\s*(?:pack|packet|lot|bundle|set)\\s*of\\s*${pcs}\\s*(?:pcs|pc|pieces?)?\\s*\\)?`, 'gi');
  return text.replace(pack, '').replace(one, '').replace(/[ \t]{2,}/g, ' ');
}
