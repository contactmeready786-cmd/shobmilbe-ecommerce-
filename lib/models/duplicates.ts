// Duplicate product guard.
// A new or edited product is compared with every other product of the same kind
// (single with single, bundle with bundle) in three ways:
//   1. pictures  — exact same file, or the same photo resized / re-saved / with a border / mirrored
//   2. name      — same words in any order, spelling-tolerant match, Bangla/English digits, units (60 W = 60W)
//   3. long description — word-for-word the same text
// Names that differ only in a size/model number (Soldering Iron 40W vs 60W) are treated as different products.

// ---------------------------------------------------------------- strictness
import { q, one } from '../db';
import { int, str } from '../util';
import type { Body, Id, Settings } from '../types';
import type { MediaRow, ProductsRow } from '../data/rows';
/** How strict the guard is: how alike two names (0…1) or two pictures (bit distance) must be. */
// aiStrong / aiWeak: how alike the picture-recognition AI must find two pictures (0…1). Measured on DINOv2: the
// same thing photographed again / cropped / turned / brighter ≈ 0.8–0.95, two different cars of the same colour 0.72,
// unrelated pictures under 0.4.
type Level = { label: string; titleHigh: number; titleMid: number; imgStrong: number; imgWeak: number; aiStrong: number; aiWeak: number };
const LEVELS: Record<string, Level> = {
  strict: { label: 'কড়া', titleHigh: 0.84, titleMid: 0.66, imgStrong: 38, imgWeak: 56, aiStrong: 0.8, aiWeak: 0.68 },
  normal: { label: 'সাধারণ (প্রস্তাবিত)', titleHigh: 0.9, titleMid: 0.75, imgStrong: 30, imgWeak: 46, aiStrong: 0.84, aiWeak: 0.72 },
  relaxed: { label: 'নরম', titleHigh: 0.95, titleMid: 0.86, imgStrong: 18, imgWeak: 30, aiStrong: 0.88, aiWeak: 0.78 },
};
function levelOf(settings: Settings) { return LEVELS[(settings && settings.dup_level) || 'normal'] || LEVELS.normal; }

// ---------------------------------------------------------------- names
const BN = '০১২৩৪৫৬৭৮৯';
// Marketing words that do not make a product different.
const STOP = new Set(('new original orginal orignal genuine best quality high premium top price prices in bd bangladesh '
  + 'for the and with of a an hot sale offer 100 percent হট নতুন অরিজিনাল অরজিনাল আসল সেরা ভালো ভাল দাম দামে মূল্য বাংলাদেশে বাংলাদেশ '
  + 'উন্নত মানের মান এর ও এবং জন্য সাথে সহ অফার').split(/\s+/));
const UNITS: Record<string, string> = {
  v: 'v', volt: 'v', volts: 'v', ভোল্ট: 'v', w: 'w', watt: 'w', watts: 'w', ওয়াট: 'w', a: 'a', amp: 'a', amps: 'a',
  ma: 'ma', mah: 'mah', mm: 'mm', cm: 'cm', m: 'm', meter: 'm', মিটার: 'm', kg: 'kg', কেজি: 'kg', g: 'g', gm: 'g', gram: 'g', গ্রাম: 'g',
  gb: 'gb', tb: 'tb', mb: 'mb', ml: 'ml', l: 'l', ltr: 'l', liter: 'l', litre: 'l', লিটার: 'l', inch: 'inch', inches: 'inch', ইঞ্চি: 'inch',
  pcs: 'pcs', pc: 'pcs', piece: 'pcs', pieces: 'pcs', পিস: 'pcs', টি: 'pcs', hz: 'hz', khz: 'khz', mhz: 'mhz', uf: 'uf', µf: 'uf', nf: 'nf',
  pf: 'pf', k: 'k', ohm: 'ohm', ohms: 'ohm', rpm: 'rpm', x: 'x',
};

function words(name: string) {
  let s = String(name || '').normalize('NFC').toLowerCase()
    .replace(/[০-৯]/g, (d) => String(BN.indexOf(d)))
    .replace(/\((?:কপি|copy)\)/g, ' ')
    .replace(/(\d)[.,](\d)/g, '$1p$2') // 3.7v -> 3p7v (keeps the decimal)
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, ' ')
    .trim();
  // "60 w" -> "60w", "60 watt" -> "60w"
  const parts = s.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const t = parts[i];
    const nxt = parts[i + 1];
    if (/^\d+(p\d+)?$/.test(t) && nxt && UNITS[nxt]) { out.push(t + UNITS[nxt]); i++; continue; }
    const m = t.match(/^(\d+(?:p\d+)?)(\p{L}+)$/u);
    if (m && UNITS[m[2]]) { out.push(m[1] + UNITS[m[2]]); continue; }
    out.push(t);
  }
  return out.filter((w) => !STOP.has(w));
}
// letter pairs inside each word (order of words does not matter)
function pairs(ws: string[]) {
  const m = new Map<string, number>();
  let n = 0;
  for (const w of ws) {
    const t = ` ${w} `;
    const chars = Array.from(t);
    for (let i = 0; i < chars.length - 1; i++) {
      const k = chars[i] + chars[i + 1];
      m.set(k, (m.get(k) || 0) + 1);
      n++;
    }
  }
  return { m, n };
}
type Pairs = { m: Map<string, number>; n: number };
function dice(a: Pairs, b: Pairs) {
  if (!a.n || !b.n) return 0;
  let both = 0;
  const [small, big] = a.m.size < b.m.size ? [a.m, b.m] : [b.m, a.m];
  for (const [k, c] of small) { const d = big.get(k); if (d) both += Math.min(c, d); }
  return (2 * both) / (a.n + b.n);
}
// words that hold a number: model numbers and sizes (pam8403, 60w, 12v, 3p7v). A model number's letters in front
// don't count (owner, 2026-10-24: "DT9205A", "DT-9205A" and "9205A" are the same multimeter), so 9205a, 8403, 60w.
function numberWords(ws: string[]) { return new Set(ws.filter((w) => /\d/.test(w)).map((w) => w.replace(/^\p{L}+(?=\d)/u, ''))); }
function sameSet(a: Set<string>, b: Set<string>) { if (a.size !== b.size) return false; for (const x of a) if (!b.has(x)) return false; return true; }

function prepName(name: string) {
  const ws = words(name);
  return { ws, key: ws.join(' '), sorted: [...ws].sort().join(' '), pairs: pairs(ws), nums: numberWords(ws) };
}

// ---------------------------------------------------------------- pictures
// A fingerprint is 256 bits (64 hex letters), made in the admin's browser from the picture's
// 16 x 16 coarsest DCT patterns. Distance = how many bits differ: same photo ≈ 0-30, different photo ≈ 80+.
function pop32(x: number) { x -= (x >>> 1) & 0x55555555; x = (x & 0x33333333) + ((x >>> 2) & 0x33333333); return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24; }
const okHash = (h: string) => typeof h === 'string' && /^[0-9a-f]{64}$/.test(h);
const split = (h: string) => (okHash(h) ? Uint32Array.from({ length: 8 }, (_, i) => parseInt(h.slice(i * 8, i * 8 + 8), 16)) : null);
/** a picture fingerprint: 64 hex letters, or already split into 8 numbers */
type Fingerprint = string | Uint32Array;
function hamming(a: Fingerprint, b: Fingerprint) {
  const x = typeof a === 'string' ? split(a) : a;
  const y = typeof b === 'string' ? split(b) : b;
  let d = 0;
  for (let i = 0; i < 8; i++) d += pop32((x![i] ^ y![i]) >>> 0);
  return d;
}
const similarity = (d: number) => Math.max(0, Math.round(100 * (1 - d / 128)));
// 🧠 The picture-recognition AI's view of a picture (client/admin/recognize.ts): 384 numbers kept as 384 bytes
// (-127…127, the direction is what counts). Two pictures are alike by how much they point the same way (0…1).
type PrepImage = { sha: string | null; h: Uint32Array | null; hm: Uint32Array | null; e: Int8Array | null };
const EMB = 384;
function embOf(b: unknown): Int8Array | null {
  if (!b || !(b instanceof Uint8Array) || b.length !== EMB) return null;
  return new Int8Array(b.buffer, b.byteOffset, EMB);
}
function aiSim(a: Int8Array, b: Int8Array): number {
  let d = 0, na = 0, nb = 0;
  for (let i = 0; i < EMB; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? d / Math.sqrt(na * nb) : 0;
}
/** the best AI likeness between two products' pictures (0 when either has none yet) */
function aiBest(newImgs: PrepImage[], oldImgs: PrepImage[]): number {
  let best = 0;
  for (const a of newImgs) if (a.e) for (const b of oldImgs) if (b.e) best = Math.max(best, aiSim(a.e, b.e));
  return best;
}
function prepImage(m: Pick<MediaRow, 'sha' | 'phash' | 'phash_m'> & { emb?: unknown }): PrepImage { return { sha: m.sha || null, h: split(m.phash as string), hm: split(m.phash_m as string), e: embOf(m.emb) }; }
// smallest picture distance between two products (0 = same picture)
function imageDistance(newImgs: PrepImage[], oldImgs: PrepImage[]) {
  let best = 999;
  for (const a of newImgs) {
    for (const b of oldImgs) {
      if (a.sha && b.sha && a.sha === b.sha) return 0;
      if (b.h) {
        if (a.h) best = Math.min(best, hamming(a.h, b.h));
        if (a.hm) best = Math.min(best, hamming(a.hm, b.h));
      }
    }
  }
  return best;
}

// ---------------------------------------------------------------- compare two products
const bnNum = (n: number) => String(n).replace(/\d/g, (d) => BN[Number(d)]);
type CompareOpts = {
  sameDesc?: boolean;
};
/** what two products are compared on */
type Comparable = { name: ReturnType<typeof prepName>; images: PrepImage[]; youtube: string };
function compare(a: Comparable, b: Comparable, lv: Level, { sameDesc = false }: CompareOpts = {}) {
  const reasons: string[] = [];
  let block = false;
  let warn = false;
  let score = 0;

  // pictures
  const d = imageDistance(a.images, b.images);
  const imgStrong = d <= lv.imgStrong;
  const imgWeak = !imgStrong && d <= lv.imgWeak;
  if (d === 0) reasons.push('হুবহু একই ছবি');
  else if (imgStrong) reasons.push(`ছবি প্রায় একই (${bnNum(similarity(d))}% মিল)`);
  else if (imgWeak) reasons.push(`ছবি অনেকটা একই রকম (${bnNum(similarity(d))}% মিল)`);
  // 🧠 the AI looked at the pictures: the same product even from another angle, light or background
  const ai = imgStrong ? 0 : aiBest(a.images, b.images);
  const aiStrong = ai >= lv.aiStrong;
  const aiWeak = !aiStrong && ai >= lv.aiWeak;
  if (aiStrong) reasons.push(`🧠 ছবি দেখে একই পণ্য মনে হচ্ছে (AI: ${bnNum(Math.round(ai * 100))}% মিল)`);
  else if (aiWeak) reasons.push(`🧠 ছবিতে পণ্যটা দেখতে অনেকটা একই রকম (AI: ${bnNum(Math.round(ai * 100))}% মিল)`);

  // name
  let titleSame = false;
  let titleHigh = false;
  let titleMid = false;
  let numberClash = false;
  if (a.name.key && b.name.key) {
    const sim = dice(a.name.pairs, b.name.pairs);
    numberClash = a.name.nums.size > 0 && b.name.nums.size > 0 && !sameSet(a.name.nums, b.name.nums);
    const oneSided = (a.name.nums.size > 0) !== (b.name.nums.size > 0);
    if (a.name.key === b.name.key || a.name.sorted === b.name.sorted) titleSame = !numberClash;
    else if (!numberClash && sim >= lv.titleHigh && !oneSided) titleHigh = true;
    else if (!numberClash && sim >= lv.titleMid) titleMid = true;
    if (titleSame) reasons.push('নাম হুবহু একই');
    else if (titleHigh) reasons.push(`নাম প্রায় একই (${bnNum(Math.round(sim * 100))}% মিল)`);
    else if (titleMid) reasons.push(`নাম কাছাকাছি (${bnNum(Math.round(sim * 100))}% মিল)`);
    score += sim * 40;
  }
  if (sameDesc) reasons.push('বিস্তারিত বিবরণ হুবহু একই');
  if (a.youtube && a.youtube === b.youtube) reasons.push('একই YouTube ভিডিও');

  // a model / size number that differs in the names (40W vs 60W) keeps two look-alike pictures apart: only a warning
  const aiBlock = aiStrong && !numberClash;
  if (imgStrong || aiBlock || titleSame || titleHigh || (titleMid && (imgWeak || aiWeak || aiStrong || sameDesc)) || (sameDesc && (imgWeak || aiWeak))) block = true;
  else if (imgWeak || aiWeak || aiStrong || titleMid || sameDesc || (a.youtube && a.youtube === b.youtube)) warn = true;
  if (block && numberClash && (imgStrong || imgWeak)) reasons.push('তবে নামে মাপ/মডেল আলাদা — একই ছবির আলাদা ভ্যারিয়েন্ট হলে নিচের সুইচ চালু করুন');
  if (aiStrong && numberClash) reasons.push('তবে নামে মাপ/মডেল আলাদা — তাই শুধু সতর্ক করা হলো');

  score += (imgStrong ? 50 : imgWeak ? 20 : 0) + (aiStrong ? 40 : aiWeak ? 15 : 0) + (titleSame ? 50 : titleHigh ? 35 : titleMid ? 15 : 0) + (sameDesc ? 25 : 0);
  return { level: block ? 'block' : warn ? 'warn' : null, reasons, score: Math.round(score), imageDistance: d };
}

// ---------------------------------------------------------------- loading
const youtubeKey = (u?: unknown) => { const m = String(u || '').match(/[?&]v=([A-Za-z0-9_-]{11})/); return m ? m[1] : ''; };
const DESC_HASH = `md5(lower(regexp_replace(coalesce(description,''), '\\s', '', 'g')))`;
const DESC_LEN = `length(regexp_replace(coalesce(description,''), '\\s', '', 'g'))`;

type CatalogRow = Pick<ProductsRow, 'id' | 'name' | 'sku' | 'slug' | 'active' | 'price' | 'image_id' | 'emoji' | 'youtube_url' | 'allow_duplicate' | 'created_at'> & { desc_hash: string | null };
type CatalogEntry = Omit<CatalogRow, 'name'> & Comparable & { title: string };
async function loadCatalog(type: string, exceptId: Id = 0): Promise<CatalogEntry[]> {
  const rows = await q<CatalogRow>(`SELECT p.id, p.name, p.sku, p.slug, p.active, p.price, p.image_id, p.emoji, p.youtube_url, p.allow_duplicate,
      p.created_at, CASE WHEN ${DESC_LEN} >= 60 THEN ${DESC_HASH} ELSE NULL END AS desc_hash
    FROM products p WHERE p.product_type=$1 AND p.id<>$2 AND p.parent_id IS NULL`, [type, int(exceptId)]);
  const media = await q<Pick<MediaRow, 'owner_id' | 'sha' | 'phash' | 'phash_m' | 'emb'>>(`SELECT owner_id, sha, phash, phash_m, emb FROM media WHERE owner_type='product' AND owner_id = ANY($1::int[])`,
    [rows.map((r) => r.id)]);
  const byOwner = new Map<number | null, typeof media>();
  for (const m of media) { if (!byOwner.has(m.owner_id)) byOwner.set(m.owner_id, []); byOwner.get(m.owner_id)!.push(m); }
  return rows.map((r) => ({ ...r, name: prepName(r.name), title: r.name, youtube: youtubeKey(r.youtube_url), images: (byOwner.get(r.id) || []).map(prepImage) }));
}

// Is this product (new or being edited) a copy of another one?
// data: { id, name, description, images: [media ids], product_type, youtube_url }
async function findDuplicates(data: Body, settings: Settings) {
  const lv = levelOf(settings);
  const type = data.product_type === 'bundle' ? 'bundle' : 'single';
  const id = int(data.id);
  const imageIds = ((Array.isArray(data.images) ? data.images : String(data.images || '').split(',')) as unknown[])
    .map((x) => int(x)).filter((x) => x > 0);
  const [others, imgs, desc] = await Promise.all([
    loadCatalog(type, id),
    imageIds.length ? q<Pick<MediaRow, 'id' | 'sha' | 'phash' | 'phash_m' | 'emb'>>('SELECT id, sha, phash, phash_m, emb FROM media WHERE id = ANY($1::int[])', [imageIds]) : [],
    one<{ h: string | null }>(`SELECT CASE WHEN length(regexp_replace($1::text, '\\s', '', 'g')) >= 60
      THEN md5(lower(regexp_replace($1::text, '\\s', '', 'g'))) END AS h`, [str(data.description, 20000)]),
  ]);
  const me: Comparable = { name: prepName(String(data.name ?? '')), images: imgs.map(prepImage), youtube: youtubeKey(data.youtube_url) };
  const matches: { id: number; name: string; sku: string; slug: string; active: boolean; price: number; image: string | null; emoji: string; level: string; reasons: string[]; score: number; allowed: boolean }[] = [];
  for (const o of others) {
    const r = compare(me, o, lv, { sameDesc: !!(desc && desc.h && desc.h === o.desc_hash) });
    if (!r.level) continue;
    matches.push({ id: o.id, name: o.title, sku: o.sku, slug: o.slug, active: o.active, price: o.price, image: o.image_id ? `/media/${o.image_id}/t` : null,
      emoji: o.emoji, level: r.level, reasons: r.reasons, score: r.score, allowed: !!o.allow_duplicate });
  }
  matches.sort((x, y) => (x.level === y.level ? y.score - x.score : x.level === 'block' ? -1 : 1));
  const hashed = imgs.filter((m) => m.phash !== null).length;
  return { blocked: matches.some((m) => m.level === 'block'), matches: matches.slice(0, 12), imagesChecked: imgs.length, imagesWaiting: imgs.length - hashed };
}

// Whole-catalog scan: groups of products that look like copies of each other.
type ScanCatalogOpts = {
  includeAllowed?: boolean;
};
async function scanCatalog(settings: Settings, { includeAllowed = false }: ScanCatalogOpts = {}) {
  const lv = levelOf(settings);
  type Pair = { older: CatalogEntry; newer: CatalogEntry } & ReturnType<typeof compare>;
  const pairsOut: Pair[] = [];
  for (const type of ['single', 'bundle']) {
    const all = (await loadCatalog(type)).filter((p) => includeAllowed || !p.allow_duplicate);
    // Only compare products that share a word, a picture or a description (fast enough for thousands).
    const cand = new Set<number>();
    const pair = (i: number, j: number) => { if (i !== j) cand.add(i < j ? i * 100000 + j : j * 100000 + i); };
    const index = new Map<string, number[]>();
    const add = (k: string, i: number) => { if (!index.has(k)) index.set(k, []); index.get(k)!.push(i); };
    const flat: [number, Uint32Array, Uint32Array | null][] = [];
    all.forEach((p, i) => {
      new Set(p.name.ws.filter((w) => Array.from(w).length >= 3)).forEach((w) => add('w:' + w, i));
      for (const im of p.images) {
        if (im.sha) add('s:' + im.sha, i);
        if (im.h) flat.push([i, im.h, im.hm]);
      }
      if (p.desc_hash) add('d:' + p.desc_hash, i);
    });
    for (const [k, ids] of index) {
      if (ids.length < 2 || ids.length > (k.startsWith('w:') ? 80 : 200)) continue; // very common words say nothing
      for (let x = 0; x < ids.length; x++) for (let y = x + 1; y < ids.length; y++) pair(ids[x], ids[y]);
    }
    for (let x = 0; x < flat.length; x++) {
      const [i, h, hm] = flat[x];
      for (let y = x + 1; y < flat.length; y++) {
        const [j, h2] = flat[y];
        if (i === j) continue;
        if (hamming(h, h2) <= lv.imgWeak || (hm && hamming(hm, h2) <= lv.imgWeak)) pair(i, j);
      }
    }
    // 🧠 pictures the AI finds alike (all against all: 1,000 products × 3 pictures is well under a second)
    const embs: [number, Int8Array][] = [];
    all.forEach((p, i) => { for (const im of p.images) if (im.e) embs.push([i, im.e]); });
    for (let x = 0; x < embs.length; x++) {
      const [i, e] = embs[x];
      for (let y = x + 1; y < embs.length; y++) {
        const [j, e2] = embs[y];
        if (i !== j && aiSim(e, e2) >= lv.aiWeak) pair(i, j);
      }
    }
    for (const c of cand) {
      const a = all[Math.floor(c / 100000)];
      const b = all[c % 100000];
      // compare the newer one against the older one
      const [older, newer] = a.created_at <= b.created_at ? [a, b] : [b, a];
      const r = compare(newer, older, lv, { sameDesc: !!(a.desc_hash && a.desc_hash === b.desc_hash) });
      if (!r.level) continue;
      pairsOut.push({ older, newer, ...r });
    }
  }
  // join pairs into groups
  const parent = new Map<number, number>();
  const find = (x: number) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x)!)!); x = parent.get(x)!; } return x; };
  const unite = (x: number, y: number) => { [x, y].forEach((v) => { if (!parent.has(v)) parent.set(v, v); }); parent.set(find(x), find(y)); };
  pairsOut.forEach((p) => unite(p.older.id, p.newer.id));
  const groups = new Map<number, { level: string; products: Map<number, CatalogEntry>; pairs: Pair[]; score: number }>();
  for (const p of pairsOut) {
    const g = find(p.older.id);
    if (!groups.has(g)) groups.set(g, { level: 'warn', products: new Map(), pairs: [], score: 0 });
    const G = groups.get(g)!;
    if (p.level === 'block') G.level = 'block';
    G.score = Math.max(G.score, p.score);
    for (const x of [p.older, p.newer]) G.products.set(x.id, x);
    G.pairs.push(p);
  }
  return [...groups.values()]
    .map((G) => ({ ...G, products: [...G.products.values()].sort((x, y) => x.created_at.getTime() - y.created_at.getTime()) }))
    .sort((x, y) => (x.level === y.level ? y.score - x.score : x.level === 'block' ? -1 : 1));
}

export { LEVELS, levelOf, findDuplicates, scanCatalog, prepName, compare, hamming, words, aiSim, EMB };
