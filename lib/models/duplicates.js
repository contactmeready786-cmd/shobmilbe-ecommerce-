'use strict';
// Duplicate product guard.
// A new or edited product is compared with every other product of the same kind
// (single with single, bundle with bundle) in three ways:
//   1. pictures  — exact same file, or the same photo resized / re-saved / with a border / mirrored
//   2. name      — same words in any order, spelling-tolerant match, Bangla/English digits, units (60 W = 60W)
//   3. long description — word-for-word the same text
// Names that differ only in a size/model number (Soldering Iron 40W vs 60W) are treated as different products.
const { q, one } = require('../db');
const { int, str } = require('../util');

// ---------------------------------------------------------------- strictness
const LEVELS = {
  strict: { label: 'কড়া', titleHigh: 0.84, titleMid: 0.66, imgStrong: 38, imgWeak: 56 },
  normal: { label: 'সাধারণ (প্রস্তাবিত)', titleHigh: 0.9, titleMid: 0.75, imgStrong: 30, imgWeak: 46 },
  relaxed: { label: 'নরম', titleHigh: 0.95, titleMid: 0.86, imgStrong: 18, imgWeak: 30 },
};
function levelOf(settings) { return LEVELS[(settings && settings.dup_level) || 'normal'] || LEVELS.normal; }

// ---------------------------------------------------------------- names
const BN = '০১২৩৪৫৬৭৮৯';
// Marketing words that do not make a product different.
const STOP = new Set(('new original orginal orignal genuine best quality high premium top price prices in bd bangladesh '
  + 'for the and with of a an hot sale offer 100 percent হট নতুন অরিজিনাল অরজিনাল আসল সেরা ভালো ভাল দাম দামে মূল্য বাংলাদেশে বাংলাদেশ '
  + 'উন্নত মানের মান এর ও এবং জন্য সাথে সহ অফার').split(/\s+/));
const UNITS = {
  v: 'v', volt: 'v', volts: 'v', ভোল্ট: 'v', w: 'w', watt: 'w', watts: 'w', ওয়াট: 'w', ওয়াট: 'w', a: 'a', amp: 'a', amps: 'a',
  ma: 'ma', mah: 'mah', mm: 'mm', cm: 'cm', m: 'm', meter: 'm', মিটার: 'm', kg: 'kg', কেজি: 'kg', g: 'g', gm: 'g', gram: 'g', গ্রাম: 'g',
  gb: 'gb', tb: 'tb', mb: 'mb', ml: 'ml', l: 'l', ltr: 'l', liter: 'l', litre: 'l', লিটার: 'l', inch: 'inch', inches: 'inch', ইঞ্চি: 'inch',
  pcs: 'pcs', pc: 'pcs', piece: 'pcs', pieces: 'pcs', পিস: 'pcs', টি: 'pcs', hz: 'hz', khz: 'khz', mhz: 'mhz', uf: 'uf', µf: 'uf', nf: 'nf',
  pf: 'pf', k: 'k', ohm: 'ohm', ohms: 'ohm', rpm: 'rpm', x: 'x',
};

function words(name) {
  let s = String(name || '').normalize('NFC').toLowerCase()
    .replace(/[০-৯]/g, (d) => String(BN.indexOf(d)))
    .replace(/\((?:কপি|copy)\)/g, ' ')
    .replace(/(\d)[.,](\d)/g, '$1p$2') // 3.7v -> 3p7v (keeps the decimal)
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, ' ')
    .trim();
  // "60 w" -> "60w", "60 watt" -> "60w"
  const parts = s.split(/\s+/).filter(Boolean);
  const out = [];
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
function pairs(ws) {
  const m = new Map();
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
function dice(a, b) {
  if (!a.n || !b.n) return 0;
  let both = 0;
  const [small, big] = a.m.size < b.m.size ? [a.m, b.m] : [b.m, a.m];
  for (const [k, c] of small) { const d = big.get(k); if (d) both += Math.min(c, d); }
  return (2 * both) / (a.n + b.n);
}
// words that hold a number: model numbers and sizes (pam8403, 60w, 12v, 3p7v)
function numberWords(ws) { return new Set(ws.filter((w) => /\d/.test(w))); }
function sameSet(a, b) { if (a.size !== b.size) return false; for (const x of a) if (!b.has(x)) return false; return true; }

function prepName(name) {
  const ws = words(name);
  return { ws, key: ws.join(' '), sorted: [...ws].sort().join(' '), pairs: pairs(ws), nums: numberWords(ws) };
}

// ---------------------------------------------------------------- pictures
// A fingerprint is 256 bits (64 hex letters), made in the admin's browser from the picture's
// 16 x 16 coarsest DCT patterns. Distance = how many bits differ: same photo ≈ 0-30, different photo ≈ 80+.
function pop32(x) { x -= (x >>> 1) & 0x55555555; x = (x & 0x33333333) + ((x >>> 2) & 0x33333333); return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24; }
const okHash = (h) => typeof h === 'string' && /^[0-9a-f]{64}$/.test(h);
const split = (h) => (okHash(h) ? Uint32Array.from({ length: 8 }, (_, i) => parseInt(h.slice(i * 8, i * 8 + 8), 16)) : null);
function hamming(a, b) {
  const x = typeof a === 'string' ? split(a) : a;
  const y = typeof b === 'string' ? split(b) : b;
  let d = 0;
  for (let i = 0; i < 8; i++) d += pop32((x[i] ^ y[i]) >>> 0);
  return d;
}
const similarity = (d) => Math.max(0, Math.round(100 * (1 - d / 128)));
function prepImage(m) { return { sha: m.sha || null, h: split(m.phash), hm: split(m.phash_m) }; }
// smallest picture distance between two products (0 = same picture)
function imageDistance(newImgs, oldImgs) {
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
const bnNum = (n) => String(n).replace(/\d/g, (d) => BN[d]);
function compare(a, b, lv, { sameDesc = false } = {}) {
  const reasons = [];
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

  if (imgStrong || titleSame || titleHigh || (titleMid && (imgWeak || sameDesc)) || (sameDesc && imgWeak)) block = true;
  else if (imgWeak || titleMid || sameDesc || (a.youtube && a.youtube === b.youtube)) warn = true;
  if (block && numberClash && (imgStrong || imgWeak)) reasons.push('তবে নামে মাপ/মডেল আলাদা — একই ছবির আলাদা ভ্যারিয়েন্ট হলে নিচের সুইচ চালু করুন');

  score += (imgStrong ? 50 : imgWeak ? 20 : 0) + (titleSame ? 50 : titleHigh ? 35 : titleMid ? 15 : 0) + (sameDesc ? 25 : 0);
  return { level: block ? 'block' : warn ? 'warn' : null, reasons, score: Math.round(score), imageDistance: d };
}

// ---------------------------------------------------------------- loading
const youtubeKey = (u) => { const m = String(u || '').match(/[?&]v=([A-Za-z0-9_-]{11})/); return m ? m[1] : ''; };
const DESC_HASH = `md5(lower(regexp_replace(coalesce(description,''), '\\s', '', 'g')))`;
const DESC_LEN = `length(regexp_replace(coalesce(description,''), '\\s', '', 'g'))`;

async function loadCatalog(type, exceptId = 0) {
  const rows = await q(`SELECT p.id, p.name, p.sku, p.slug, p.active, p.price, p.image_id, p.emoji, p.youtube_url, p.allow_duplicate,
      p.created_at, CASE WHEN ${DESC_LEN} >= 60 THEN ${DESC_HASH} ELSE NULL END AS desc_hash
    FROM products p WHERE p.product_type=$1 AND p.id<>$2`, [type, int(exceptId)]);
  const media = await q(`SELECT owner_id, sha, phash, phash_m FROM media WHERE owner_type='product' AND owner_id = ANY($1::int[])`,
    [rows.map((r) => r.id)]);
  const byOwner = new Map();
  for (const m of media) { if (!byOwner.has(m.owner_id)) byOwner.set(m.owner_id, []); byOwner.get(m.owner_id).push(m); }
  return rows.map((r) => ({ ...r, name: prepName(r.name), title: r.name, youtube: youtubeKey(r.youtube_url), images: (byOwner.get(r.id) || []).map(prepImage) }));
}

// Is this product (new or being edited) a copy of another one?
// data: { id, name, description, images: [media ids], product_type, youtube_url }
async function findDuplicates(data, settings) {
  const lv = levelOf(settings);
  const type = data.product_type === 'bundle' ? 'bundle' : 'single';
  const id = int(data.id);
  const imageIds = (Array.isArray(data.images) ? data.images : String(data.images || '').split(','))
    .map((x) => int(x)).filter((x) => x > 0);
  const [others, imgs, desc] = await Promise.all([
    loadCatalog(type, id),
    imageIds.length ? q('SELECT id, sha, phash, phash_m FROM media WHERE id = ANY($1::int[])', [imageIds]) : [],
    one(`SELECT CASE WHEN length(regexp_replace($1::text, '\\s', '', 'g')) >= 60
      THEN md5(lower(regexp_replace($1::text, '\\s', '', 'g'))) END AS h`, [str(data.description, 20000)]),
  ]);
  const me = { name: prepName(data.name), images: imgs.map(prepImage), youtube: youtubeKey(data.youtube_url) };
  const matches = [];
  for (const o of others) {
    const r = compare(me, o, lv, { sameDesc: !!(desc && desc.h && desc.h === o.desc_hash) });
    if (!r.level) continue;
    matches.push({ id: o.id, name: o.title, sku: o.sku, slug: o.slug, active: o.active, price: o.price, image: o.image_id ? `/media/${o.image_id}/t` : null,
      emoji: o.emoji, level: r.level, reasons: r.reasons, score: r.score });
  }
  matches.sort((x, y) => (x.level === y.level ? y.score - x.score : x.level === 'block' ? -1 : 1));
  const hashed = imgs.filter((m) => m.phash !== null).length;
  return { blocked: matches.some((m) => m.level === 'block'), matches: matches.slice(0, 12), imagesChecked: imgs.length, imagesWaiting: imgs.length - hashed };
}

// Whole-catalog scan: groups of products that look like copies of each other.
async function scanCatalog(settings, { includeAllowed = false } = {}) {
  const lv = levelOf(settings);
  const pairsOut = [];
  for (const type of ['single', 'bundle']) {
    const all = (await loadCatalog(type)).filter((p) => includeAllowed || !p.allow_duplicate);
    // Only compare products that share a word, a picture or a description (fast enough for thousands).
    const cand = new Set();
    const pair = (i, j) => { if (i !== j) cand.add(i < j ? i * 100000 + j : j * 100000 + i); };
    const index = new Map();
    const add = (k, i) => { if (!index.has(k)) index.set(k, []); index.get(k).push(i); };
    const flat = [];
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
  const parent = new Map();
  const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  const unite = (x, y) => { [x, y].forEach((v) => { if (!parent.has(v)) parent.set(v, v); }); parent.set(find(x), find(y)); };
  pairsOut.forEach((p) => unite(p.older.id, p.newer.id));
  const groups = new Map();
  for (const p of pairsOut) {
    const g = find(p.older.id);
    if (!groups.has(g)) groups.set(g, { level: 'warn', products: new Map(), pairs: [], score: 0 });
    const G = groups.get(g);
    if (p.level === 'block') G.level = 'block';
    G.score = Math.max(G.score, p.score);
    for (const x of [p.older, p.newer]) G.products.set(x.id, x);
    G.pairs.push(p);
  }
  return [...groups.values()]
    .map((G) => ({ ...G, products: [...G.products.values()].sort((x, y) => x.created_at - y.created_at) }))
    .sort((x, y) => (x.level === y.level ? y.score - x.score : x.level === 'block' ? -1 : 1));
}

module.exports = { LEVELS, levelOf, findDuplicates, scanCatalog, prepName, compare, hamming, words };
