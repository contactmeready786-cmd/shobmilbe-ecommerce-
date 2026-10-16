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
import * as db from '../db';
import * as md from '../views/md';
import { bn, str } from '../util';
import { kindOf } from '../data/partinfo';
import * as $seo from './seo';
import * as $util from '../util';
import * as $admin_status from '../admin/status';
import type { Body, Id, Loose, Settings } from '../types';
import type { Tx } from '../pg';

const EVERY_MS = 9 * 60 * 1000;
const PER_RUN = 40;
const OWN_TEXT_ENOUGH = 150; // own description at least this long → no auto text

const money = (n?: Loose) => '৳' + bn(Math.round(Number(n) || 0).toLocaleString('en-IN'));
const cleanName = (n?: Loose) => $seo.cleanName(n);

// ---------------------------------------------------------------- 1. model / part number from the name
// a size, an amount or a unit is not a model: 5V, 3W, 2000mAh, 16x2, 10K, 40pcs, 2.4GHz, 12V-5V …
const UNIT = /^\d+(?:\.\d+)?(?:v|vac|vdc|w|kw|a|ma|mah|ah|mm|cm|m|km|k|kg|g|mg|ohm|ohms|r|kr|uf|nf|pf|mf|pcs|pc|pin|pins|p|ch|gb|mb|kb|tb|mhz|khz|ghz|hz|rpm|db|dbi|s|ms|ft|inch|in|t|th|nd|st|rd|l|ml|w\+w|c|f|lm|x|w?rms|bit|core|mp|d|h|yr|years?|months?)$/i;
const RANGE = /^\d+(?:\.\d+)?[a-z]{0,4}[-~]\d/i;
const SIZE = /^\d+(?:\.\d+)?x\d+(?:\.\d+)?(?:x\d+(?:\.\d+)?)?[a-z]*$/i;
const GENERIC = /^(?:i2c|iic|spi|uart|ttl\d*|ps2|rs\d{3}|db\d+|m\d|cr\d{4}|ag\d+|lr\d+|usb\d*(?:\.\d)?|dc\d*|ac\d*|led\d*|rgb\d*|ip\d+|type-?[abc]\d*|hdmi\d*|wi-?fi\d*|cat\d+[a-z]?|v\d+(?:\.\d+)*|ver\d*|r\d|mk\d+|gen\d+|bt\d(?:\.\d)?|[2345]g|[48]k|\d{3,4}p|a\d|aa+|aaa|ble\d*|lipo\d*|li-?ion\d*|\d+s\d*p?|sma\d*|smd\d*|dip\d*|to-?\d+|sot-?\d+|qfn\d*|\d+[a-z]{1,3}\d*(?:x|\*)\d+.*)$/i;
function extractModel(name?: Loose) {
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
const SPEC_RULES = [
  ['ভোল্টেজ', new RegExp(`(?:DC|AC)?\\s*${NUM}\\s*V(?:DC|AC)?(?:\\s*(?:-|~|to|থেকে)\\s*${NUM}\\s*V(?:DC|AC)?)?(?![a-z])`, 'i'), (m?: Loose) => m[0].replace(/\s+/g, ' ').trim()],
  ['কারেন্ট', new RegExp(`${NUM}\\s*(mA|A)(?![a-z])`, 'i'), (m?: Loose) => `${m[1]}${/^ma$/i.test(m[2]) ? 'mA' : 'A'}`],
  ['পাওয়ার', new RegExp(`(?:(\\d+)\\s*[x×]\\s*)?${NUM}\\s*W(?:att)?(?![a-z])`, 'i'), (m?: Loose) => (m[1] ? `${m[1]}×${m[2]}W` : `${m[2]}W`)],
  ['ক্যাপাসিটি', new RegExp(`${NUM}\\s*mAh(?![a-z])`, 'i'), (m?: Loose) => `${m[1]}mAh`],
  ['রেজিস্ট্যান্স', new RegExp(`${NUM}\\s*(K|M)?\\s*(?:ohms?|Ω)`, 'i'), (m?: Loose) => `${m[1]}${m[2] ? m[2].toUpperCase() : ''}Ω`],
  ['ক্যাপাসিট্যান্স', new RegExp(`${NUM}\\s*(uF|µF|μF|nF|pF)(?![a-z])`, 'i'), (m?: Loose) => `${m[1]}${m[2].replace(/^u|μ/i, 'µ').replace(/f$/i, 'F').replace(/^n/i, 'n').replace(/^p/i, 'p')}`],
  ['ফ্রিকোয়েন্সি', new RegExp(`${NUM}\\s*(GHz|MHz|KHz|Hz)(?![a-z])`, 'i'), (m?: Loose) => `${m[1]}${(<Record<string, string>>{ ghz: 'GHz', mhz: 'MHz', khz: 'kHz', hz: 'Hz' })[m[2].toLowerCase()]}`],
  ['ডিসপ্লে', /(?<![\d.])(16x2|16x1|20x4|128x64|128x32|240x320|320x480|8x8)(?![\d])/i, (m?: Loose) => m[1].toLowerCase()],
  ['স্ক্রিন সাইজ', new RegExp(`${NUM}\\s*(?:inch|in|")(?![a-z])`, 'i'), (m?: Loose) => `${m[1]} ইঞ্চি`],
  ['চ্যানেল', /(?<![\d.])(\d{1,2})\s*-?\s*(?:channel|ch)(?![a-z])/i, (m?: Loose) => `${m[1]} চ্যানেল`],
  ['পিন', /(?<![\d.])(\d{1,3})\s*-?\s*pins?(?![a-z])/i, (m?: Loose) => `${m[1]} পিন`],
  ['গতি', new RegExp(`${NUM}\\s*RPM(?![a-z])`, 'i'), (m?: Loose) => `${m[1]} RPM`],
  ['ব্লুটুথ ভার্সন', /bluetooth\s*(?:v|ver(?:sion)?)?\s*(\d\.\d)/i, (m?: Loose) => m[1]],
  ['প্যাকে', /(?<![\d.])(\d{1,4})\s*(?:pcs|pc|pieces|piece|টি|টা|পিস)(?![a-z])/i, (m?: Loose) => `${m[1]} পিস`],
];
function extractSpecs(...texts: Loose[]) {
  const text = texts.map((t) => String(t || '')).join(' \n ');
  const out: Loose[] = [];
  for (const [label, re, fmt] of SPEC_RULES as Loose[]) {
    const m = text.match(re);
    if (!m) continue;
    const v = fmt(m);
    if (v && v.length <= 40) out.push([label, v]);
  }
  return out;
}

// ---------------------------------------------------------------- 3. the description
const pick = (list?: Loose, seed?: Loose) => list[Math.abs(seed) % list.length];
function seedOf(id?: Id) { let h = 7; for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) | 0; return h; }
function ownTextLength(p?: Loose) { return md.plain(`${p.short_description || ''} ${p.description || ''}`, 5000).trim().length; }
function needsAuto(p?: Loose, settings: Settings = {} as Settings) { return settings.autoseo_desc !== '0' && ownTextLength(p) < OWN_TEXT_ENOUGH; }
function cheapRule(settings: Settings, price?: Loose) { try { return $util.qtyRule(settings, price).cheap; } catch (_) { return false; } }

// a short paragraph — meta description, feeds, Google's product description
function summary(p?: Loose) {
  const name = cleanName(p.name);
  const k = kindOf(name, p.category_name);
  const what = k ? k.what : p.category_name ? `${p.category_name} ক্যাটাগরির পণ্য` : 'পণ্য';
  return `${name} একটি ${what}${p.model ? ` (মডেল ${p.model})` : ''}। ${k ? k.uses : ''}`.replace(/\s+/g, ' ').trim();
}

// for the Google snippet, after "<name> কিনুন ৳…।": what it is and what it is for
function metaLine(p?: Loose, room: Loose = 999) {
  const k = kindOf(cleanName(p.name), p.category_name);
  if (!k) return '';
  const full = `${k.what}${p.model ? ` (${p.model})` : ''}। ${k.uses}`.replace(/\s+/g, ' ').trim();
  return full.length <= room ? full : `${k.what}${p.model ? ` (${p.model})` : ''}`;
}

// The full description (markdown). With settings, the price and delivery charges of today are in the questions.
function describe(p?: Loose, settings: Settings = {} as Settings) {
  const name = cleanName(p.name);
  const shop = settings.store_name || 'সবমিলবে';
  const k = kindOf(name, p.category_name);
  const seed = seedOf(p.id || name);
  const brand = p.brand && !/^(made\s*in|china|chinese|generic|no\s*brand|unbranded|চায়না|চাইনিজ)/i.test(String(p.brand).trim()) ? p.brand : '';
  const what = k ? k.what : p.category_name ? `${p.category_name} ক্যাটাগরির পণ্য` : 'পণ্য';
  const specs = (Array.isArray(p.specs) ? p.specs : []).filter((r?: Loose) => Array.isArray(r) && r[0] && r[1]).slice(0, 12);
  const dhaka = Number(settings.delivery_dhaka) || 60;
  const outside = Number(settings.delivery_outside) || 110;
  const lines: Loose[] = [];
  lines.push(`## ${name} — ${pick(['বিস্তারিত', 'পণ্য পরিচিতি', 'যা জানা দরকার'], seed)}`);
  lines.push([
    pick([`**${name}** একটি ${what}${brand ? `, ব্র্যান্ড ${brand}` : ''}।`, `**${name}** হলো ${brand ? `${brand}-এর ` : ''}একটি ${what}।`], seed),
    p.model ? pick([`এর মডেল / পার্ট নম্বর **${p.model}**।`, `মডেল নম্বর: **${p.model}**।`], seed >> 3) : '',
    k ? k.uses : '',
  ].filter(Boolean).join(' '));
  if (specs.length) {
    lines.push('', `### ${pick(['মূল বৈশিষ্ট্য', 'স্পেসিফিকেশন এক নজরে', 'বৈশিষ্ট্য'], seed >> 2)}`);
    specs.forEach(([a, b]: Loose[]) => lines.push(`- **${a}:** ${b}`));
  }
  lines.push('', `### ${pick(['কেনার আগে জেনে নিন', 'ব্যবহারের টিপস', 'যা খেয়াল রাখবেন'], seed >> 4)}`);
  if (k) lines.push(`- ${k.tip}`);
  lines.push(`- ${pick(['ছবি আর স্পেসিফিকেশন মিলিয়ে নিন — আপনার প্রজেক্টে ঠিক এই মডেলটাই লাগবে কিনা।', 'অর্ডারের আগে মডেল নম্বর আর মাপ আপনার সার্কিটের সাথে মিলিয়ে নিন।', 'নিশ্চিত না হলে পণ্যের পেজে প্রশ্ন করুন বা WhatsApp-এ ছবি পাঠান — আমরা মিলিয়ে দেব।'], seed >> 5)}`);
  lines.push('', `### ${pick([`কেন ${shop} থেকে কিনবেন`, `${shop} থেকে অর্ডার করলে`], seed >> 6)}`);
  lines.push(`- 🚚 সারা বাংলাদেশে হোম ডেলিভারি — ঢাকায় ${money(dhaka)}, ঢাকার বাইরে ${money(outside)}`);
  lines.push('- 💵 ক্যাশ অন ডেলিভারি — পণ্য হাতে পেয়ে টাকা দিন');
  if (p.price > 0 && cheapRule(settings, p.price)) lines.push('- 🔩 ১টা করেও কেনা যায় (পুরো অর্ডারে সর্বনিম্ন পরিমাণ মানলেই হলো)');
  lines.push('- 📷 পণ্যের আসল ছবি, আর সমস্যা হলে রিটার্নের সুযোগ');
  lines.push('', '### সাধারণ প্রশ্ন');
  if (p.price > 0) {
    lines.push(`**${pick([`বাংলাদেশে ${name} এর দাম কত?`, `${name} এর দাম কত?`], seed >> 7)}**`);
    lines.push(`${shop} অনলাইন শপে এখন ${name} এর দাম ${money(p.price)}${p.old_price > p.price ? ` (আগে ছিল ${money(p.old_price)})` : ''}। ${p.stock > 0 ? 'স্টকে আছে।' : 'এই মুহূর্তে স্টকে নেই — "স্টকে এলে জানাও" চাপলে SMS পাবেন।'}`);
    lines.push('');
  }
  lines.push(`**${name} price in Bangladesh?**`);
  lines.push(`${p.price > 0 ? `দাম ${money(p.price)} — ` : ''}সারা দেশে ক্যাশ অন ডেলিভারিতে অর্ডার করা যায়।`, '');
  lines.push(`**${pick(['অনলাইনে কীভাবে অর্ডার করব?', `${name} কোথায় পাওয়া যায়?`], seed >> 8)}**`);
  lines.push(`এই পেজে "কার্টে যোগ করুন" চেপে নাম, মোবাইল নম্বর আর ঠিকানা দিলেই অর্ডার হয়ে যায়। চাইলে WhatsApp বা ফোনেও অর্ডার করতে পারেন।`, '');
  lines.push('**ঢাকার বাইরে কত দিনে পাব?**');
  lines.push('সাধারণত ঢাকায় ১-২ দিনে আর ঢাকার বাইরে ২-৪ দিনে কুরিয়ারে পৌঁছে যায়।');
  return lines.join('\n');
}

// ---------------------------------------------------------------- the round-the-clock sweep
const LOG_FIELDS: Record<string, string> = { model: 'মডেল নম্বর', specs: 'স্পেসিফিকেশন' };

async function processOne(p: Loose, settings: Settings) {
  const changes: Loose[] = [];
  const past = await db.q(`SELECT field, new_value FROM seo_auto_log WHERE product_id=$1`, [p.id]);
  // 🔢 model: only when empty, and never again after the owner removed / changed one we filled
  if (settings.autoseo_model !== '0' && !String(p.model || '').trim() && !past.some((l) => l.field === 'model')) {
    const model = extractModel(cleanName(p.name));
    if (model) changes.push({ field: 'model', old: '', value: model });
  }
  // ⚙️ specs: add only labels that are missing, never a label we added before (the owner may have taken it out)
  if (settings.autoseo_specs !== '0') {
    const cur = (Array.isArray(p.specs) ? p.specs : []).filter((r?: Loose) => Array.isArray(r) && r[0]);
    const have = new Set(cur.map((r?: Loose) => String(r[0]).trim().toLowerCase()));
    const addedBefore = new Set(past.filter((l) => l.field === 'specs').flatMap((l) => { try { return JSON.parse(l.new_value).map((r?: Loose) => String(r[0]).toLowerCase()); } catch (_) { return []; } }));
    // the owner's own English labels mean the same thing
    const same: Record<string, Loose> = { 'ভোল্টেজ': ['voltage', 'input voltage', 'operating voltage', 'working voltage'], 'কারেন্ট': ['current', 'output current'], 'পাওয়ার': ['power', 'output power'], 'ক্যাপাসিটি': ['capacity'] };
    const add = extractSpecs(cleanName(p.name), md.plain(`${p.short_description || ''} ${p.description || ''}`, 1500))
      .filter(([label]) => !have.has(label.toLowerCase()) && !addedBefore.has(label.toLowerCase()) && !(same[label] || []).some((x?: Loose) => have.has(x)))
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
async function snapshot(force: Loose = false) {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(new Date());
  if (!force) {
    const had = await db.one('SELECT 1 FROM seo_score_history WHERE day=$1', [day]).catch(() => null);
    if (had) return null;
  }
  const { total, avg, perfect } = await $admin_status.seoProblems();
  await db.q(`INSERT INTO seo_score_history(day, avg, perfect, total) VALUES($1,$2,$3,$4)
    ON CONFLICT (day) DO UPDATE SET avg=EXCLUDED.avg, perfect=EXCLUDED.perfect, total=EXCLUDED.total`, [day, avg, perfect, total]);
  return { day, avg, perfect, total };
}

async function sweep(settings: Settings, { force = false, max = PER_RUN }: Body = {}) {
  if (settings.autoseo_on === '0') return { off: true };
  if (!force && Date.now() - (Number(settings.autoseo_try) || 0) < EVERY_MS) return { skipped: true };
  await db.setMany({ autoseo_try: String(Date.now()) });
  const rows = await db.q(`SELECT p.*, c.name AS category_name FROM products p LEFT JOIN categories c ON c.id=p.category_id
    WHERE p.active AND p.parent_id IS NULL AND (p.seo_auto_at IS NULL OR p.updated_at > p.seo_auto_at)
    ORDER BY p.seo_auto_at NULLS FIRST, p.updated_at DESC LIMIT $1`, [max]);
  let changed = 0; let models = 0; let specs = 0;
  for (const p of rows) {
    try {
      const c = await processOne(p, settings);
      if (c) { changed++; if (c.some((x) => x.field === 'model')) models++; if (c.some((x) => x.field === 'specs')) specs++; }
    } catch (e: Loose) { console.error('autoseo', p.id, e.message); }
  }
  await snapshot().catch((e) => console.error('autoseo snapshot', e.message));
  await db.setMany({ autoseo_last: String(Date.now()) });
  return { looked: rows.length, changed, models, specs };
}

// ---------------------------------------------------------------- undo
async function undo(logId?: Id) {
  const l = await db.one('SELECT * FROM seo_auto_log WHERE id=$1 AND NOT undone', [Number(logId) || 0]);
  if (!l) return false;
  const p = await db.one('SELECT id, model, specs FROM products WHERE id=$1', [l.product_id]);
  if (p) {
    if (l.field === 'model' && String(p.model || '') === l.new_value) await db.q(`UPDATE products SET model='', updated_at=now(), seo_auto_at=now() WHERE id=$1`, [p.id]);
    if (l.field === 'specs') {
      let added: Loose[] = [];
      try { added = JSON.parse(l.new_value); } catch (_) { added = []; }
      const key = (r?: Loose) => `${r[0]}\u0001${r[1]}`;
      const drop = new Set(added.map(key));
      const keep = (Array.isArray(p.specs) ? p.specs : []).filter((r) => !(Array.isArray(r) && drop.has(key(r))));
      await db.q('UPDATE products SET specs=$2::jsonb, updated_at=now(), seo_auto_at=now() WHERE id=$1', [p.id, JSON.stringify(keep)]);
    }
  }
  await db.q('UPDATE seo_auto_log SET undone=true WHERE id=$1', [l.id]);
  return true;
}
async function undoAll() {
  const ids = await db.q('SELECT id FROM seo_auto_log WHERE NOT undone ORDER BY id DESC');
  let n = 0;
  for (const r of ids) if (await undo(r.id)) n++;
  return n;
}

async function stats(): Promise<Loose> {
  const [a, b, hist] = await Promise.all([
    db.one(`SELECT count(*) FILTER (WHERE seo_auto_at IS NOT NULL AND seo_auto_at >= updated_at)::int AS done, count(*)::int AS total
      FROM products WHERE active AND parent_id IS NULL`),
    db.one(`SELECT count(*) FILTER (WHERE field='model' AND NOT undone)::int AS models, count(*) FILTER (WHERE field='specs' AND NOT undone)::int AS specs,
      coalesce(sum(CASE WHEN field='specs' AND NOT undone THEN jsonb_array_length(new_value::jsonb) END),0)::int AS spec_rows FROM seo_auto_log`),
    db.q('SELECT day, avg, perfect, total FROM seo_score_history ORDER BY day DESC LIMIT 30'),
  ]);
  const own = await db.q(`SELECT short_description, description FROM products WHERE active AND parent_id IS NULL`);
  const autoDesc = own.filter((p) => ownTextLength(p) < OWN_TEXT_ENOUGH).length;
  return { ...a, ...b, autoDesc, hist };
}
async function recent(limit: Loose = 40) {
  return db.q(`SELECT l.*, p.name, p.slug FROM seo_auto_log l JOIN products p ON p.id=l.product_id ORDER BY l.id DESC LIMIT $1`, [limit]);
}

export { extractModel, extractSpecs, describe, summary, metaLine, needsAuto, ownTextLength, sweep, snapshot, processOne, undo, undoAll, stats, recent, LOG_FIELDS, OWN_TEXT_ENOUGH };
