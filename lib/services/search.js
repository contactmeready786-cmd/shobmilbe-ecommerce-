'use strict';
// 🔎 Smart search for the shop: finds the product even when the customer
//   • misspells it            — "capasitor", "transistr", "soldring" → capacitor / transistor / soldering
//   • writes it in Bangla     — "ক্যাপাসিটর", "রিমোট", "সিঙ্গার এসি রিমোট" → capacitor / remote / Singer AC remote
//   • joins or splits numbers — "1000uf" = "1000 uf", "১০০০ মাইক্রো" works, Bangla digits work
//   • types only the start    — "transf" → transformer
// How: all shop products are kept in a small in-memory list (name, brand, model, SKU, category, short text).
// Each word the customer typed is compared with each word of a product: exact, beginning, inside, or a word that is
// one or two letters off. Bangla words become English through a word list (common electronics / shop words) and,
// for any other word, a sound-alike spelling (সিঙ্গার → singar ≈ singer). Products are ranked by how well they match.
// The list refreshes by itself when products change (checked at most once a minute), so search stays fast.
const db = require('../db');

// ---------------------------------------------------------------- Bangla → English words
// Common ways Bangladeshi customers write shop words. Several spellings per word on purpose.
const WORDS = {
  capacitor: 'ক্যাপাসিটর ক্যাপাসিটার কেপাসিটর কেপাসিটার ক্যাপাসিটি কন্ডেন্সার কনডেন্সার',
  resistor: 'রেজিস্টর রেজিস্টার রেসিস্টর রেজিস্ট্যান্স রেজিস্টেন্স',
  transistor: 'ট্রানজিস্টর ট্রানজিস্টার ট্রাঞ্জিস্টর',
  diode: 'ডায়োড ডাইওড ডায়েড',
  transformer: 'ট্রান্সফরমার ট্রান্সফর্মার ট্রান্সমিটার',
  ic: 'আইসি চিপ',
  relay: 'রিলে রিলেই',
  sensor: 'সেন্সর সেনসর',
  module: 'মডিউল মোডিউল মডুল',
  board: 'বোর্ড',
  circuit: 'সার্কিট সার্কেট',
  amplifier: 'অ্যামপ্লিফায়ার এমপ্লিফায়ার অ্যাম্পলিফায়ার এম্পলিফায়ার অ্যাম্প এম্প',
  speaker: 'স্পিকার স্পীকার',
  inverter: 'ইনভার্টার ইনভার্টর ইনভেটার আইপিএস',
  converter: 'কনভার্টার কনভার্টর',
  adapter: 'অ্যাডাপ্টার এডাপ্টার অ্যাডাপ্টর এডাপ্টর',
  charger: 'চার্জার চার্জের',
  battery: 'ব্যাটারি ব্যাটারী বেটারি',
  power: 'পাওয়ার পাওয়ার',
  supply: 'সাপ্লাই',
  remote: 'রিমোট রিমোর্ট রিমুট',
  ac: 'এসি এ.সি',
  tv: 'টিভি টি.ভি টেলিভিশন',
  fridge: 'ফ্রিজ ফ্রীজ রেফ্রিজারেটর',
  fan: 'ফ্যান ফেন পাখা',
  motor: 'মোটর মটর',
  light: 'লাইট বাতি',
  led: 'এলইডি এল.ই.ডি',
  bulb: 'বাল্ব বাল্প',
  switch: 'সুইচ সুইস',
  socket: 'সকেট',
  plug: 'প্লাগ',
  wire: 'তার ওয়্যার ওয়ার',
  cable: 'ক্যাবল কেবল ক্যাবেল',
  soldering: 'সোল্ডারিং সোলডারিং ঝালাই',
  solder: 'সোল্ডার',
  iron: 'আয়রন আইরন',
  flux: 'ফ্লাক্স ফ্লাক্‌স',
  multimeter: 'মাল্টিমিটার মালটিমিটার',
  tester: 'টেস্টার',
  fuse: 'ফিউজ ফিউস',
  coil: 'কয়েল কয়েল',
  heater: 'হিটার',
  geyser: 'গিজার',
  trimmer: 'ট্রিমার ট্রিমের',
  shaver: 'শেভার',
  bluetooth: 'ব্লুটুথ ব্লুটুত',
  usb: 'ইউএসবি',
  mic: 'মাইক মাইক্রোফোন',
  headphone: 'হেডফোন হেডফন',
  earphone: 'ইয়ারফোন এয়ারফোন',
  watch: 'ঘড়ি',
  shirt: 'শার্ট',
  pant: 'প্যান্ট',
  shoe: 'জুতা জুতো',
  bag: 'ব্যাগ',
  tape: 'টেপ',
  glue: 'গ্লু আঠা',
  sticker: 'স্টিকার',
  carton: 'কার্টন কাটুন',
  poly: 'পলি পলিথিন',
  packet: 'প্যাকেট পেকেট',
  box: 'বক্স',
  screw: 'স্ক্রু ইস্ক্রু',
  volt: 'ভোল্ট ভোল্টেজ',
  watt: 'ওয়াট',
  amp: 'অ্যাম্পিয়ার এম্পিয়ার',
  uf: 'মাইক্রোফ্যারাড মাইক্রো',
  ohm: 'ওহম ও্হম',
  mobile: 'মোবাইল',
  phone: 'ফোন',
  display: 'ডিসপ্লে ডিস্প্লে',
  charging: 'চার্জিং',
  port: 'পোর্ট',
  pin: 'পিন',
  jack: 'জ্যাক',
  regulator: 'রেগুলেটর রেগুলেটার',
  stabilizer: 'স্ট্যাবিলাইজার স্টেবিলাইজার',
  thermostat: 'থার্মোস্ট্যাট থার্মোস্টেট',
  sim: 'সিম',
  router: 'রাউটার',
  camera: 'ক্যামেরা',
  digital: 'ডিজিটাল',
  timer: 'টাইমার',
  clock: 'ক্লক',
  kit: 'কিট',
  set: 'সেট',
  pcs: 'পিস পিচ',
};
const BN_TO_EN = new Map();
for (const [en, bnList] of Object.entries(WORDS)) for (const w of bnList.split(/\s+/).filter(Boolean)) BN_TO_EN.set(w, en);

// ---------------------------------------------------------------- Bangla → sound-alike Latin
const BN_CONS = {
  'ক': 'k', 'খ': 'kh', 'গ': 'g', 'ঘ': 'gh', 'ঙ': 'ng', 'চ': 'ch', 'ছ': 'ch', 'জ': 'j', 'ঝ': 'jh', 'ঞ': 'n', 'ট': 't', 'ঠ': 'th', 'ড': 'd', 'ঢ': 'dh',
  'ণ': 'n', 'ত': 't', 'থ': 'th', 'দ': 'd', 'ধ': 'dh', 'ন': 'n', 'প': 'p', 'ফ': 'f', 'ব': 'b', 'ভ': 'v', 'ম': 'm', 'য': 'j', 'র': 'r', 'ল': 'l',
  'শ': 's', 'ষ': 's', 'স': 's', 'হ': 'h', 'ড়': 'r', 'ঢ়': 'r', 'য়': 'y', 'ৎ': 't', 'ং': 'ng', 'ঃ': 'h', 'ঁ': '',
};
const BN_VOW = { 'অ': 'o', 'আ': 'a', 'ই': 'i', 'ঈ': 'i', 'উ': 'u', 'ঊ': 'u', 'ঋ': 'ri', 'এ': 'e', 'ঐ': 'oi', 'ও': 'o', 'ঔ': 'ou' };
const BN_SIGN = { 'া': 'a', 'ি': 'i', 'ী': 'i', 'ু': 'u', 'ূ': 'u', 'ৃ': 'ri', 'ে': 'e', 'ৈ': 'oi', 'ো': 'o', 'ৌ': 'ou' };
// Product names in Bangla are mostly English words written in Bangla letters, so the silent "o" between letters is left
// out (স্যামসাং → samsang ≈ samsung, ট্রান্সফরমার → transformar ≈ transformer).
function translit(word) {
  const w = String(word).replace(/য়/g, 'য়').replace(/ড়/g, 'ড়').replace(/ঢ়/g, 'ঢ়')
    .replace(/্য/g, '') // য-ফলা: ক্যা = "ka"
    .replace(/^\u0993\u09DF/, 'w').replace(/\u0993\u09DF/g, 'w'); // ওয়াট → wat, ওয়ালটন → walton
  let out = '';
  for (const c of w) {
    if (BN_CONS[c] !== undefined) out += BN_CONS[c];
    else if (BN_VOW[c]) out += BN_VOW[c];
    else if (BN_SIGN[c]) out += BN_SIGN[c];
    else if (/[a-z0-9]/.test(c)) out += c;
  }
  return out.replace(/(.)\1+/g, '$1'); // ক্ক → k
}

// ---------------------------------------------------------------- words
const BN_DIGITS = '০১২৩৪৫৬৭৮৯';
const STOP = new Set(['er', 'and', 'the', 'for', 'with', 'of', 'a', 'an', 'to', 'in', 'এর', 'ও', 'এবং', 'জন্য', 'দাম', 'কত', 'চাই', 'দরকার', 'আছে', 'price', 'buy', 'best']);
function norm(text) {
  return String(text || '').toLowerCase().normalize('NFC')
    .replace(/[০-৯]/g, (d) => BN_DIGITS.indexOf(d))
    .replace(/[µμ]/g, 'u').replace(/Ω|ω/g, 'ohm').replace(/[‐-―]/g, '-')
    .replace(/[^a-z0-9.ঀ-৿\s-]/g, ' ');
}
// "1000uF-25V" → 1000uf 1000 uf 25v 25 v ; "a.b" stays only when it's a number (0.25)
function words(text) {
  const out = [];
  for (let w of norm(text).split(/[\s\-/]+/)) {
    w = w.replace(/^\.+|\.+$/g, '');
    if (!w) continue;
    if (!/^\d+(\.\d+)?$/.test(w)) w = w.replace(/\./g, '');
    if (!w) continue;
    out.push(w);
    const parts = w.match(/[a-z]+|\d+(?:\.\d+)?|[ঀ-৿]+/g);
    if (parts && parts.length > 1) out.push(...parts);
  }
  return out;
}
// a Bangla word → the English it may mean (word list, then sound-alike)
function bnVariants(w) {
  if (!/[ঀ-৿]/.test(w)) return [];
  const v = [];
  if (BN_TO_EN.has(w)) v.push(BN_TO_EN.get(w));
  // with a Bangla ending stuck on: "রিমোটের", "ব্যাটারিটা"
  const stem = w.replace(/(ের|গুলো|গুলি|গুলা)$/, '');
  if (stem !== w && stem.length >= 2 && BN_TO_EN.has(stem)) v.push(BN_TO_EN.get(stem));
  for (const x of new Set([w, stem])) {
    const t = translit(x);
    if (t.length >= 2) { v.push(t); if (t.includes('k')) v.push(t.replace(/k/g, 'c')); } // panasonik → panasonic
  }
  return [...new Set(v)];
}

// Damerau–Levenshtein distance, stops early once over `max`
function dist(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const m = a.length; const n = b.length;
  let prev2 = null; let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (prev2 && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur.push(v);
      if (v < best) best = v;
    }
    if (best > max) return max + 1;
    prev2 = prev; prev = cur;
  }
  return prev[n];
}
// how well one typed word matches one product word (0 = not at all)
function wordScore(q, p) {
  if (q === p) return 10;
  const num = /^\d/.test(q);
  if (p.startsWith(q) && (q.length >= 2 || num)) return num ? 8 : 7 + Math.min(2, q.length / 4);
  if (num) return 0; // numbers: only exact or beginning ("1000" ≠ "100")
  if (q.length >= 4 && p.includes(q)) return 5;
  if (q.length >= 4 && p.length >= 4) {
    const max = q.length >= 8 ? 2 : 1;
    const d = dist(q, p, max);
    if (d <= max) return d === 1 ? 6 : 4;
    // a misspelt start of a long word: "transfo" ≈ "transformer"
    if (p.length > q.length + 1 && dist(q, p.slice(0, q.length), 1) <= 1 && q.length >= 5) return 4;
  }
  return 0;
}

// ---------------------------------------------------------------- the product list in memory
let INDEX = null; let builtAt = 0; let sig = ''; let building = null;
async function index() {
  const fresh = INDEX && Date.now() - builtAt < 60e3;
  if (fresh) return INDEX;
  if (building) return building;
  building = (async () => {
    try {
      const s = await db.one(`SELECT count(*)::int AS n, coalesce(max(updated_at), 'epoch')::text AS u FROM products`);
      const nowSig = `${s.n}:${s.u}`;
      if (INDEX && nowSig === sig) { builtAt = Date.now(); return INDEX; }
      const rows = await db.q(`SELECT p.id, p.name, p.brand, p.model, p.sku, p.barcode, p.short_description, p.seo_keywords, c.name AS cat,
          coalesce(p.sold_count, 0) AS sold,
          (SELECT string_agg(v.variant_label || ' ' || coalesce(v.sku, ''), ' ') FROM products v WHERE v.parent_id=p.id) AS variants
        FROM products p LEFT JOIN categories c ON c.id=p.category_id WHERE p.active AND p.parent_id IS NULL`);
      INDEX = rows.map((r) => {
        const fields = [
          [words(`${r.name} ${r.brand || ''} ${r.model || ''} ${r.variants || ''}`), 1],
          [words(`${r.sku || ''} ${r.barcode || ''}`), 1],
          [words(`${r.cat || ''} ${r.seo_keywords || ''}`), 0.6],
          [words(String(r.short_description || '').slice(0, 300)), 0.35],
        ].map(([ws, wt]) => {
          const all = new Set(ws);
          for (const w of ws) for (const v of bnVariants(w)) all.add(v);
          return [[...all], wt];
        });
        return { id: r.id, sold: Number(r.sold) || 0, fields, nameLen: String(r.name || '').length };
      });
      sig = nowSig; builtAt = Date.now();
      return INDEX;
    } finally { building = null; }
  })();
  return building;
}
function clearCache() { builtAt = 0; sig = ''; }

// ---------------------------------------------------------------- search
// → product ids, best match first (at most `limit`)
async function find(query, { limit = 500 } = {}) {
  const typed = words(query).filter((w) => !STOP.has(w));
  // each typed word with the other ways it may be meant
  const groups = [];
  const seen = new Set();
  for (const w of typed) {
    if (seen.has(w)) continue;
    seen.add(w);
    groups.push([w, ...bnVariants(w)]);
  }
  if (!groups.length) return [];
  const list = await index();
  const need = groups.length <= 2 ? groups.length : Math.ceil(groups.length * 0.6);
  const hits = [];
  for (const p of list) {
    let total = 0; let matched = 0;
    for (const g of groups) {
      let best = 0;
      for (const [ws, wt] of p.fields) {
        for (const pw of ws) {
          for (const qw of g) {
            const s = wordScore(qw, pw) * wt;
            if (s > best) best = s;
          }
          if (best >= 10) break;
        }
        if (best >= 10) break;
      }
      if (best > 0) { matched++; total += best; }
    }
    if (matched >= need) hits.push({ id: p.id, score: total + matched * 3 + Math.min(3, Math.log10(1 + p.sold)), short: -p.nameLen });
  }
  hits.sort((a, b) => b.score - a.score || b.short - a.short || a.id - b.id);
  return hits.slice(0, limit).map((h) => h.id);
}

// What people searched for (Admin → সার্চ রিপোর্ট): the words and how many products were found.
async function log(query, found) {
  const q = norm(query).replace(/\s+/g, ' ').trim().slice(0, 80);
  if (q.length < 2) return;
  await db.q(`INSERT INTO search_log(q, found) VALUES($1,$2)`, [q, found]).catch(() => {});
  if (Math.random() < 0.02) db.q("DELETE FROM search_log WHERE created_at < now() - interval '90 days'").catch(() => {});
}

module.exports = { find, log, words, translit, bnVariants, dist, wordScore, clearCache };
