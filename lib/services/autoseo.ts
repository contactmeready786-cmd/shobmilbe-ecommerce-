// 🤖 অটো SEO ইঞ্জিন (Admin → মার্কেটিং → Google ও Facebook → অটো SEO).
// 700+ products can't be fixed by hand, so the shop does it itself, round the clock:
//  1. 🔢 মডেল নম্বর — reads the part number out of the product name ("PAM8403", "HC-SR04", "1N4007") into the model
//     box. People search exactly these codes; Google/Facebook feeds also send it as "mpn".
//  2. ⚙️ স্পেসিফিকেশন — reads voltage, current, watt, mAh, µF, Ω, MHz, size, pins, channels … from the name and text
//     into the specification table (shown on the page and sent to Google as product properties).
//  3. 📝 অটো বিবরণ — a product whose own text is missing or very short gets a full Bangla description on its page:
//     what it is, where it is used, its specifications, what to know before buying, why buy here, and common
//     questions ("<name> এর দাম কত?"). It is made fresh on every page view (today's price, today's delivery charge)
//     and is NEVER saved over the owner's own text — once the owner writes 150+ characters, theirs alone shows.
// 1 and 2 only fill what is EMPTY, never change what the owner typed, never put back something the owner removed,
// and every change is logged with the old value, so one tap undoes it (one product or everything).
// Runs from the round-the-clock wake-up: a few dozen products every ~10 minutes, new and edited products first.
import type { SeoAutoLogRow, ProductsRow, SeoScoreHistoryRow } from '../data/rows';
import * as db from '../db';
import * as md from '../views/md';
import { bn } from '../util';
import { kindOf } from '../data/partinfo';
import * as $seo from './seo';
import * as $util from '../util';
import * as $admin_status from './seoscore';
import type { Id, Settings, Caught } from '../types';
import type { Product } from '../models/catalog';

const EVERY_MS = 9 * 60 * 1000;
const PER_RUN = 40;
const OWN_TEXT_ENOUGH = 150; // own description at least this long → no auto text

const cleanName = (n: string) => $seo.cleanName(n);

// ---------------------------------------------------------------- 1. model / part number from the name
// a size, an amount or a unit is not a model: 5V, 3W, 2000mAh, 16x2, 10K, 40pcs, 2.4GHz, 12V-5V …
const UNIT = /^\d+(?:\.\d+)?(?:v|vac|vdc|w|kw|a|ma|mah|ah|mm|cm|m|km|k|kg|g|mg|ohm|ohms|r|kr|uf|nf|pf|mf|pcs|pc|pin|pins|p|ch|gb|mb|kb|tb|mhz|khz|ghz|hz|rpm|db|dbi|s|ms|ft|inch|in|t|th|nd|st|rd|l|ml|w\+w|c|f|lm|x|w?rms|bit|core|mp|d|h|yr|years?|months?)$/i;
const RANGE = /^\d+(?:\.\d+)?[a-z]{0,4}[-~]\d/i;
const SIZE = /^\d+(?:\.\d+)?x\d+(?:\.\d+)?(?:x\d+(?:\.\d+)?)?[a-z]*$/i;
const GENERIC = /^(?:i2c|iic|spi|uart|ttl\d*|ps2|rs\d{3}|db\d+|m\d|cr\d{4}|ag\d+|lr\d+|usb\d*(?:\.\d)?|dc\d*|ac\d*|led\d*|rgb\d*|ip\d+|type-?[abc]\d*|hdmi\d*|wi-?fi\d*|cat\d+[a-z]?|v\d+(?:\.\d+)*|ver\d*|r\d|mk\d+|gen\d+|bt\d(?:\.\d)?|[2345]g|[48]k|\d{3,4}p|a\d|aa+|aaa|ble\d*|lipo\d*|li-?ion\d*|\d+s\d*p?|sma\d*|smd\d*|dip\d*|to-?\d+|sot-?\d+|qfn\d*|\d+[a-z]{1,3}\d*(?:x|\*)\d+.*)$/i;
function extractModel(name: string) {
  const tokens = String(name || '').replace(/[()[\]{},;:|/+&"“”'’]/g, ' ').split(/\s+/).map((t) => t.replace(/^[-.]+|[-.]+$/g, '')).filter(Boolean);
  for (const t of tokens) {
    if (t.length < 3 || t.length > 20) continue;
    if (!/[a-z]/i.test(t) || !/\d/.test(t)) continue; // a code has letters AND digits
    if (/[^\x20-\x7E]/.test(t)) continue; // Bangla mixed in
    if (UNIT.test(t) || RANGE.test(t) || SIZE.test(t) || GENERIC.test(t)) continue;
    return t.toUpperCase() === t || /^[a-z0-9-]+$/.test(t) ? t.toUpperCase() : t;
  }
  return '';
}

// ---------------------------------------------------------------- 2. specifications from the name and text
const NUM = '(\\d+(?:\\.\\d+)?)';
const SPEC_RULES: [string, RegExp, (m: RegExpMatchArray) => string][] = [
  ['ভোল্টেজ', new RegExp(`(?:DC|AC)?\\s*${NUM}\\s*V(?:DC|AC)?(?:\\s*(?:-|~|to|থেকে)\\s*${NUM}\\s*V(?:DC|AC)?)?(?![a-z])`, 'i'), (m) => m[0].replace(/\s+/g, ' ').trim()],
  ['কারেন্ট', new RegExp(`${NUM}\\s*(mA|A)(?![a-z])`, 'i'), (m) => `${m[1]}${/^ma$/i.test(m[2]) ? 'mA' : 'A'}`],
  ['পাওয়ার', new RegExp(`(?:(\\d+)\\s*[x×]\\s*)?${NUM}\\s*W(?:att)?(?![a-z])`, 'i'), (m) => (m[1] ? `${m[1]}×${m[2]}W` : `${m[2]}W`)],
  ['ক্যাপাসিটি', new RegExp(`${NUM}\\s*mAh(?![a-z])`, 'i'), (m) => `${m[1]}mAh`],
  ['রেজিস্ট্যান্স', new RegExp(`${NUM}\\s*(K|M)?\\s*(?:ohms?|Ω)`, 'i'), (m) => `${m[1]}${m[2] ? m[2].toUpperCase() : ''}Ω`],
  ['ক্যাপাসিট্যান্স', new RegExp(`${NUM}\\s*(uF|µF|μF|nF|pF)(?![a-z])`, 'i'), (m) => `${m[1]}${m[2].replace(/^u|μ/i, 'µ').replace(/f$/i, 'F').replace(/^n/i, 'n').replace(/^p/i, 'p')}`],
  ['ফ্রিকোয়েন্সি', new RegExp(`${NUM}\\s*(GHz|MHz|KHz|Hz)(?![a-z])`, 'i'), (m) => `${m[1]}${(<Record<string, string>>{ ghz: 'GHz', mhz: 'MHz', khz: 'kHz', hz: 'Hz' })[m[2].toLowerCase()]}`],
  ['ডিসপ্লে', /(?<![\d.])(16x2|16x1|20x4|128x64|128x32|240x320|320x480|8x8)(?![\d])/i, (m) => m[1].toLowerCase()],
  ['স্ক্রিন সাইজ', new RegExp(`${NUM}\\s*(?:inch|in|")(?![a-z])`, 'i'), (m) => `${m[1]} ইঞ্চি`],
  ['চ্যানেল', /(?<![\d.])(\d{1,2})\s*-?\s*(?:channel|ch)(?![a-z])/i, (m) => `${m[1]} চ্যানেল`],
  ['পিন', /(?<![\d.])(\d{1,3})\s*-?\s*pins?(?![a-z])/i, (m) => `${m[1]} পিন`],
  ['গতি', new RegExp(`${NUM}\\s*RPM(?![a-z])`, 'i'), (m) => `${m[1]} RPM`],
  ['ব্লুটুথ ভার্সন', /bluetooth\s*(?:v|ver(?:sion)?)?\s*(\d\.\d)/i, (m) => m[1]],
  ['প্যাকে', /(?<![\d.])(\d{1,4})\s*(?:pcs|pc|pieces|piece|টি|টা|পিস)(?![a-z])/i, (m) => `${m[1]} পিস`],
];
function extractSpecs(...texts: unknown[]) {
  const text = texts.map((t) => String(t || '')).join(' \n ');
  const out: [string, string][] = [];
  for (const [label, re, fmt] of SPEC_RULES) {
    const m = text.match(re);
    if (!m) continue;
    const v = fmt(m);
    if (v && v.length <= 40) out.push([label, v]);
  }
  return out;
}

// ---------------------------------------------------------------- 3. the description
const pick = <T,>(list: T[], seed: number) => list[Math.abs(seed) % list.length];
function seedOf(id?: Id) { let h = 7; for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) | 0; return h; }
type OwnText = { short_description?: string | null; description?: string | null };
function ownTextLength(p: OwnText) { return md.plain(`${p.short_description || ''} ${p.description || ''}`, 5000).trim().length; }
function needsAuto(p: OwnText, settings: Settings = {} as Settings) { return settings.autoseo_desc !== '0' && ownTextLength(p) < OWN_TEXT_ENOUGH; }

// a short paragraph — meta description, feeds, Google's product description
function summary(p: Pick<Product, 'name' | 'category_name' | 'model'>) {
  const name = cleanName(p.name);
  const k = kindOf(name, p.category_name);
  const what = k ? k.what : p.category_name ? `${p.category_name} ক্যাটাগরির পণ্য` : 'পণ্য';
  return `${name} একটি ${what}${p.model ? ` (মডেল ${p.model})` : ''}। ${k ? k.uses : ''}`.replace(/\s+/g, ' ').trim();
}

// for the Google snippet, after "<name> কিনুন ৳…।": what it is and what it is for
function metaLine(p: Pick<Product, 'name' | 'category_name' | 'model'>, room = 999) {
  const k = kindOf(cleanName(p.name), p.category_name);
  if (!k) return '';
  const full = `${k.what}${p.model ? ` (${p.model})` : ''}। ${k.uses}`.replace(/\s+/g, ' ').trim();
  return full.length <= room ? full : `${k.what}${p.model ? ` (${p.model})` : ''}`;
}

// The auto description (markdown): ONLY about the product (owner, 2026-11-13) — the real information another shop wrote
// for the same product when it was found (services/specfetch.ts), else what it is, its model, uses and specifications.
// No delivery charges, no "why buy here", no price questions: the page already shows those elsewhere.
function describe(p: Pick<Product, 'id' | 'name' | 'category_name' | 'brand' | 'model' | 'price' | 'old_price' | 'stock'> & { specs: unknown; auto_desc?: string | null }, settings: Settings = {} as Settings) {
  void settings;
  const name = cleanName(p.name);
  const k = kindOf(name, p.category_name);
  const seed = seedOf(p.id || name);
  const brand = p.brand && !/^(made\s*in|china|chinese|generic|no\s*brand|unbranded|চায়না|চাইনিজ)/i.test(String(p.brand).trim()) ? p.brand : '';
  const what = k ? k.what : p.category_name ? `${p.category_name} ক্যাটাগরির পণ্য` : 'পণ্য';
  const specs = (Array.isArray(p.specs) ? (p.specs as unknown[]) : []).filter((r): r is [string, string] => Array.isArray(r) && !!r[0] && !!r[1]).slice(0, 12);
  const fetched = String(p.auto_desc || '').trim();
  const lines: string[] = [];
  lines.push(`## ${name} — ${pick(['বিস্তারিত', 'পণ্য পরিচিতি', 'যা জানা দরকার'], seed)}`);
  if (fetched) {
    const top = [brand ? `ব্র্যান্ড: **${brand}**।` : '', p.model ? `মডেল / পার্ট নম্বর: **${p.model}**।` : ''].filter(Boolean).join(' ');
    if (top) lines.push(top);
    lines.push('', fetched);
  } else {
    lines.push([
      pick([`**${name}** একটি ${what}${brand ? `, ব্র্যান্ড ${brand}` : ''}।`, `**${name}** হলো ${brand ? `${brand}-এর ` : ''}একটি ${what}।`], seed),
      p.model ? pick([`এর মডেল / পার্ট নম্বর **${p.model}**।`, `মডেল নম্বর: **${p.model}**।`], seed >> 3) : '',
      k ? k.uses : '',
    ].filter(Boolean).join(' '));
  }
  if (specs.length) {
    lines.push('', `### ${pick(['মূল বৈশিষ্ট্য', 'স্পেসিফিকেশন এক নজরে', 'বৈশিষ্ট্য'], seed >> 2)}`);
    specs.forEach(([a, b]) => lines.push(`- **${a}:** ${b}`));
  }
  if (!fetched && k && k.tip) lines.push('', '### কেনার আগে জেনে নিন', `- ${k.tip}`);
  return lines.filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n').trim();
}

// ---------------------------------------------------------------- the round-the-clock sweep
const LOG_FIELDS: Record<string, string> = { model: 'মডেল নম্বর', specs: 'স্পেসিফিকেশন' };

type Change = { field: string; old: string; value: string; next?: unknown[] };
async function processOne(p: { id: number; name: string; model: string; specs: unknown; short_description: string; description: string }, settings: Settings) {
  const changes: Change[] = [];
  const past = await db.q<Pick<SeoAutoLogRow, 'field' | 'new_value'>>(`SELECT field, new_value FROM seo_auto_log WHERE product_id=$1`, [p.id]);
  // 🔢 model: only when empty, and never again after the owner removed / changed one we filled
  if (settings.autoseo_model !== '0' && !String(p.model || '').trim() && !past.some((l) => l.field === 'model')) {
    const model = extractModel(cleanName(p.name));
    if (model) changes.push({ field: 'model', old: '', value: model });
  }
  // ⚙️ specs: add only labels that are missing, never a label we added before (the owner may have taken it out)
  if (settings.autoseo_specs !== '0') {
    const cur = (Array.isArray(p.specs) ? (p.specs as unknown[]) : []).filter((r): r is unknown[] => Array.isArray(r) && !!r[0]);
    const have = new Set(cur.map((r) => String(r[0]).trim().toLowerCase()));
    const addedBefore = new Set(past.filter((l) => l.field === 'specs').flatMap((l) => { try { return (JSON.parse(l.new_value) as unknown[][]).map((r) => String(r[0]).toLowerCase()); } catch (_) { return []; } }));
    // the owner's own English labels mean the same thing
    const same: Record<string, string[]> = { 'ভোল্টেজ': ['voltage', 'input voltage', 'operating voltage', 'working voltage'], 'কারেন্ট': ['current', 'output current'], 'পাওয়ার': ['power', 'output power'], 'ক্যাপাসিটি': ['capacity'] };
    const add = extractSpecs(cleanName(p.name), md.plain(`${p.short_description || ''} ${p.description || ''}`, 1500))
      .filter(([label]) => !have.has(label.toLowerCase()) && !addedBefore.has(label.toLowerCase()) && !(same[label] || []).some((x) => have.has(x)))
      .slice(0, 8);
    if (add.length) changes.push({ field: 'specs', old: JSON.stringify(cur), value: JSON.stringify(add), next: [...cur, ...add] });
  }
  if (!changes.length) {
    await db.q('UPDATE products SET seo_auto_at=now() WHERE id=$1', [p.id]);
    return null;
  }
  await db.tx(async (t) => {
    const m = changes.find((c) => c.field === 'model');
    const sp = changes.find((c) => c.field === 'specs');
    await t.query(`UPDATE products SET model = CASE WHEN $2::text IS NOT NULL AND model = '' THEN $2 ELSE model END,
        specs = CASE WHEN $3::jsonb IS NOT NULL THEN $3::jsonb ELSE specs END, updated_at=now(), seo_auto_at=now() WHERE id=$1`,
    [p.id, m ? m.value : null, sp ? JSON.stringify(sp.next) : null]);
    for (const c of changes) {
      await t.query('INSERT INTO seo_auto_log(product_id, field, old_value, new_value) VALUES($1,$2,$3,$4)', [p.id, c.field, c.old, c.value]);
    }
  });
  return changes;
}

// Once a day: the shop's SEO score is written down, so the owner sees it climb.
async function snapshot(force = false) {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(new Date());
  if (!force) {
    const had = await db.one<{ "?column?": number | null }>('SELECT 1 FROM seo_score_history WHERE day=$1', [day]).catch(() => null);
    if (had) return null;
  }
  const { total, avg, perfect } = await $admin_status.seoProblems();
  await db.q(`INSERT INTO seo_score_history(day, avg, perfect, total) VALUES($1,$2,$3,$4)
    ON CONFLICT (day) DO UPDATE SET avg=EXCLUDED.avg, perfect=EXCLUDED.perfect, total=EXCLUDED.total`, [day, avg, perfect, total]);
  return { day, avg, perfect, total };
}

type SweepOpts = {
  force?: boolean;
  max?: number;
};
async function sweep(settings: Settings, { force = false, max = PER_RUN }: SweepOpts = {}) {
  if (settings.autoseo_on === '0') return { off: true };
  if (!force && Date.now() - (Number(settings.autoseo_try) || 0) < EVERY_MS) return { skipped: true };
  await db.setMany({ autoseo_try: String(Date.now()) });
  const rows = await db.q<{ id: number; name: string; slug: string; category_id: number | null; price: number; old_price: number | null; stock: number; description: string; emoji: string; image: string | null; featured: boolean; active: boolean; created_at: Date; updated_at: Date; sku: string; short_description: string; cost_price: number; youtube_url: string; product_type: string; image_id: number | null; seo_title: string; seo_description: string; low_stock: number; weight_g: number; unit: string; brand: string; sold_count: number; seo_keywords: string; allow_duplicate: boolean; import_ref: string; brand_id: number | null; model: string; specs: unknown; is_new: boolean; damaged_stock: number; supplier_id: number | null; noindex: boolean; wish_count: number; rating_avg: number; rating_count: number; warranty: string; warranty_type: string; barcode: string; parent_id: number | null; variant_label: string; variant_count: number; variant_title: string; variant_sort: number; preorder: boolean; preorder_days: number; location: string; seo_auto_at: Date | null; src_wm: boolean; src_wm_checked: boolean; category_name: string | null }>(`SELECT p.*, c.name AS category_name FROM products p LEFT JOIN categories c ON c.id=p.category_id
    WHERE p.active AND p.parent_id IS NULL AND (p.seo_auto_at IS NULL OR p.updated_at > p.seo_auto_at)
    ORDER BY p.seo_auto_at NULLS FIRST, p.updated_at DESC LIMIT $1`, [max]);
  let changed = 0; let models = 0; let specs = 0;
  for (const p of rows) {
    try {
      const c = await processOne(p, settings);
      if (c) { changed++; if (c.some((x) => x.field === 'model')) models++; if (c.some((x) => x.field === 'specs')) specs++; }
    } catch (caught) { const e = caught as Caught; console.error('autoseo', p.id, e.message); }
  }
  await snapshot().catch((e: Error) => console.error('autoseo snapshot', e.message));
  await db.setMany({ autoseo_last: String(Date.now()) });
  return { looked: rows.length, changed, models, specs };
}

// ---------------------------------------------------------------- undo
async function undo(logId?: Id) {
  const l = await db.one<SeoAutoLogRow>('SELECT * FROM seo_auto_log WHERE id=$1 AND NOT undone', [Number(logId) || 0]);
  if (!l) return false;
  const p = await db.one<Pick<ProductsRow, 'id' | 'model' | 'specs'>>('SELECT id, model, specs FROM products WHERE id=$1', [l.product_id]);
  if (p) {
    if (l.field === 'model' && String(p.model || '') === l.new_value) await db.q(`UPDATE products SET model='', updated_at=now(), seo_auto_at=now() WHERE id=$1`, [p.id]);
    if (l.field === 'specs') {
      let added: unknown[][] = [];
      try { added = JSON.parse(l.new_value); } catch (_) { added = []; }
      const key = (r: unknown[]) => `${r[0]}\u0001${r[1]}`;
      const drop = new Set(added.map(key));
      const keep = (Array.isArray(p.specs) ? (p.specs as unknown[]) : []).filter((r) => !(Array.isArray(r) && drop.has(key(r))));
      await db.q('UPDATE products SET specs=$2::jsonb, updated_at=now(), seo_auto_at=now() WHERE id=$1', [p.id, JSON.stringify(keep)]);
    }
  }
  await db.q('UPDATE seo_auto_log SET undone=true WHERE id=$1', [l.id]);
  return true;
}
async function undoAll() {
  const ids = await db.q<Pick<SeoAutoLogRow, 'id'>>('SELECT id FROM seo_auto_log WHERE NOT undone ORDER BY id DESC');
  let n = 0;
  for (const r of ids) if (await undo(r.id)) n++;
  return n;
}

async function stats() {
  const [a, b, hist] = await Promise.all([
    db.one<{ done: number; total: number }>(`SELECT count(*) FILTER (WHERE seo_auto_at IS NOT NULL AND seo_auto_at >= updated_at)::int AS done, count(*)::int AS total
      FROM products WHERE active AND parent_id IS NULL`),
    db.one<{ models: number; specs: number; spec_rows: number }>(`SELECT count(*) FILTER (WHERE field='model' AND NOT undone)::int AS models, count(*) FILTER (WHERE field='specs' AND NOT undone)::int AS specs,
      coalesce(sum(CASE WHEN field='specs' AND NOT undone THEN jsonb_array_length(new_value::jsonb) END),0)::int AS spec_rows FROM seo_auto_log`),
    db.q<SeoScoreHistoryRow>('SELECT day, avg, perfect, total FROM seo_score_history ORDER BY day DESC LIMIT 30'),
  ]);
  const own = await db.q<Pick<ProductsRow, 'short_description' | 'description'>>(`SELECT short_description, description FROM products WHERE active AND parent_id IS NULL`);
  const autoDesc = own.filter((p) => ownTextLength(p) < OWN_TEXT_ENOUGH).length;
  return { ...a!, ...b!, autoDesc, hist }; // (counts: always one row)
}
async function recent(limit = 40) {
  return db.q<{ id: number; product_id: number; field: string; old_value: string; new_value: string; undone: boolean; created_at: Date; name: string; slug: string }>(`SELECT l.*, p.name, p.slug FROM seo_auto_log l JOIN products p ON p.id=l.product_id ORDER BY l.id DESC LIMIT $1`, [limit]);
}

export { extractModel, extractSpecs, describe, summary, metaLine, needsAuto, ownTextLength, sweep, snapshot, processOne, undo, undoAll, stats, recent, LOG_FIELDS, OWN_TEXT_ENOUGH };
