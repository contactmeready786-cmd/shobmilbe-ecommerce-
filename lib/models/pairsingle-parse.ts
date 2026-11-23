// 👟 Pairs → one pair — reading a name (pure, no database: tests/pairsingle.test.ts). lib/models/packsingle.ts does
// the change. Owner (2026-11-23): "things sold as a pair stay a pair, but one listing must never sell 2 or 3 pairs".
// "2 Pairs 4mm Banana Plug" / "Alligator Clip (5 Pair)" / "10Pcs (5 Pairs) JST Connector" / "২ জোড়া …" → 2 / 5 / 5
// pairs, and the name without that part plus "(1 Pair)". A cable's wire pairs ("4 Pair Cat6"), a pair that comes with
// one item ("Earphone with 3 pairs ear tips") and mixed/combo sets (different colours in one pack) are left alone.

const BN = '০১২৩৪৫৬৭৮৯';
const toLatin = (s: string) => s.replace(/[০-৯]/g, (d) => String(BN.indexOf(d)));

// জোড়া / জোড়া (two ways of writing ড়) / জোরা, পেয়ার / পেয়ার (two ways of writing য়)
const BN_PAIR = '(?:জো(?:ড়|ড়|র)া|পে(?:য়|য়)ার)';
const BN_PAIR_WORD = new RegExp(BN_PAIR);

const PAIR_RE = /(?:^|(?<=[\s(\[,|/–—-]))\(?\s*(\d{1,3})\s*-?\s*(?:pairs?|prs)(?![a-z])\s*\)?\s*[-–—:|]*\s*/gi;
const PAIR_OF_RE = /[\s(\[,–—-]*\(?\s*(?:pack|packet|lot|set|bundle)\s*of\s*(\d{1,3})\s*pairs?\s*\)?/gi;
const BN_RE = new RegExp(`(?:^|(?<=[\\s(–—-]))\\(?\\s*([০-৯0-9]{1,3})\\s*-?\\s*${BN_PAIR}\\s*\\)?\\s*[-–—:]*\\s*`, 'g');

// the pairs are wires inside one cable / lead
const CABLE = /\bcat\s*-?\s*[5-8]e?\b|\butp\b|\bftp\b|telephone|\b(?:lan|network|ethernet)\s*cable|twisted|\d+\s*-?\s*pairs?\s*(?:cables?|wires?)\b/i;
// the pairs come with one item ("with 3 pairs ear tips", "+ 2 pair pads")
const PART_OF_ONE = /(?:\bwith\b|\band\b|&|\+|\bincl\w*)\s*\(?\s*\d+\s*-?\s*(?:pairs?|prs)\b/i;
// different things in one pack can't be split into equal pairs
const MIXED = /combo|assort|\bmixed\b|\bmix\b|different|\bvarious\b|\d+\s*colou?rs?\b|কম্বো|মিক্স/i;

export type PairRead = { pairs: number; name: string; bn: string } | { skip: string };

function tidy(s: string): string {
  return s.replace(/\(\s*\)|\[\s*\]/g, ' ').replace(/\s*[-–—:|,]\s*$/g, '').replace(/^\s*[-–—:|,]\s*/g, '').replace(/\s{2,}/g, ' ').trim();
}

const pcsRe = (n: number) => new RegExp(`(?:^|(?<=[\\s(\\[,|/–—-]))\\(?\\s*${n}\\s*-?\\s*(?:pcs|pc|pieces?|psc)(?![a-z])\\s*\\)?\\s*[-–—:|/]*\\s*`, 'gi');
const anyPcs = /(?:^|[\s(\[,|/–—-])\(?\s*(\d{1,4})\s*-?\s*(?:pcs|pc|pieces?|psc)(?![a-z])/gi;

/** How many pairs a product is sold in (English name first, else the Bangla name), and both names for one pair. */
export function readPairs(name: string, nameBn = ''): PairRead {
  const n = String(name || '').replace(/\s+/g, ' ').trim();
  const b = String(nameBn || '').replace(/\s+/g, ' ').trim();
  const head = n.slice(0, 70);
  if (PART_OF_ONE.test(n)) return { skip: 'the pairs come with one item' };
  const found = new Set<number>();
  for (const m of n.matchAll(PAIR_RE)) found.add(Number(m[1]));
  for (const m of n.matchAll(PAIR_OF_RE)) found.add(Number(m[1]));
  if (!found.size) for (const m of b.matchAll(BN_RE)) found.add(Number(toLatin(m[1])));
  if (!found.size) return { skip: 'no pairs count in the name' };
  if (found.size > 1) return { skip: 'two different pair counts in the name' };
  const pairs = [...found][0];
  if (pairs < 2) return { skip: 'already one pair' };
  if (pairs > 200) return { skip: 'pair count too big to trust' };
  if (CABLE.test(head)) return { skip: 'a cable (the pairs are wires inside it)' };
  if (MIXED.test(head) || MIXED.test(b)) return { skip: 'mixed / combo set (different items — can’t split)' };
  // "10Pcs (5 Pairs)": the pieces part goes too; any other pieces count means we can't be sure
  const pcsCounts = new Set([...n.matchAll(anyPcs)].map((m) => Number(m[1])));
  for (const c of pcsCounts) if (c !== pairs * 2 && c !== pairs) return { skip: 'pieces and pairs counts disagree' };
  let clean = n.replace(PAIR_OF_RE, ' ').replace(PAIR_RE, ' ');
  for (const c of pcsCounts) clean = clean.replace(pcsRe(c), ' ');
  clean = tidy(clean);
  if (clean.length < 4) return { skip: 'name would be empty' };
  if (!/\bpairs?\b/i.test(clean)) clean = `${clean} (1 Pair)`;
  let bn = tidy(b.replace(BN_RE, (all, d) => (Number(toLatin(d)) === pairs ? ' ' : all))
    .replace(/(?:^|(?<=[\s(–—-]))\(?\s*([০-৯0-9]{1,4})\s*(?:পিস|পিচ)(?:ের)?\s*\)?\s*[-–—:]*\s*/g, (all, d) => ([pairs, pairs * 2].includes(Number(toLatin(d))) ? ' ' : all)));
  if (bn && !BN_PAIR_WORD.test(bn)) bn = `${bn} (১ জোড়া)`;
  return { pairs, name: clean, bn };
}

/** the same count removed from other text (SEO title, descriptions): "2 Pairs", "Pack of 2 Pairs", "৪ পিস", "২ জোড়া" */
export function cleanPairText(text: string, pairs: number): string {
  if (!text) return text;
  const p = new RegExp(`(?:(?:pack|packet|lot|set|bundle)\\s*of\\s*)?(?<![\\d.])${pairs}\\s*-?\\s*(?:pairs?|prs)(?![a-z])`, 'gi');
  const pc = new RegExp(`\\(?\\s*(?<![\\d.])${pairs * 2}\\s*-?\\s*(?:pcs|pc|pieces?|psc)(?![a-z])\\s*\\)?`, 'gi');
  const bnN = [...String(pairs)].map((d) => BN[Number(d)]).join('');
  const bp = new RegExp(`(?:${pairs}|${bnN})\\s*${BN_PAIR}`, 'g');
  return text.replace(p, '1 Pair').replace(pc, '').replace(bp, '১ জোড়া').replace(/[ \t]{2,}/g, ' ');
}
