// ✍️ AI স্টাফ — পণ্যের লেখা (owner, 2026-10-24: "the AI staff must itself look the product up on the internet and put
// in the best, SEO-friendly title, SEO title, keywords, meta description, short and long description — like a real
// staff member"). With the owner's free Gemini key (Admin → AI স্টাফ) it takes the products whose pages are weakest
// (services/seoscore.ts), looks each one up with Google Search (Gemini's search grounding), and writes them again.
// Safety: model / part numbers in the old name must stay; nothing is invented that the search didn't show; limits on
// every field; every change is written down before it is made (ai_staff_edits) and "↩️ ফেরত" puts the old text back.
// With "নিজে বসাও" off, the new texts wait on the AI স্টাফ page for the owner's ✅ instead.
import * as db from '../db';
import * as cache from '../cache';
import * as seoscore from './seoscore';
import { fullBangla } from './bntitle';
import { productOnly } from './autodesc';
import type { Settings } from '../types';

export const FIELDS = ['name', 'name_bn', 'seo_title', 'seo_description', 'seo_keywords', 'short_description', 'description'] as const;
export type Field = (typeof FIELDS)[number];
export const FIELD_LABEL: Record<Field, string> = { name: 'নাম (টাইটেল)', name_bn: 'বাংলা নাম', seo_title: 'SEO টাইটেল', seo_description: 'মেটা বিবরণ', seo_keywords: 'কিওয়ার্ড', short_description: 'ছোট বিবরণ', description: 'বিস্তারিত বিবরণ' };
const LIMIT: Record<Field, [number, number]> = { name: [10, 120], name_bn: [5, 150], seo_title: [20, 65], seo_description: [70, 165], seo_keywords: [3, 300], short_description: [40, 700], description: [200, 8000] };

type P = { id: number; name: string; name_bn: string; brand: string; model: string; category: string | null; price: number; specs: unknown; short_description: string; description: string; seo_title: string; seo_description: string; seo_keywords: string };
export type Draft = Partial<Record<Field, string>>;

/** the numbers / part codes a name carries (DT9205A, 12V, 18650 …) — none may be lost */
export function codesIn(name: string): string[] {
  return [...new Set((String(name).match(/[A-Za-z]*\d+[A-Za-z0-9.\-]*/g) || []).map((x) => x.toLowerCase().replace(/[-.]/g, '')))];
}
const clean = (s: unknown) => String(s ?? '').replace(/<[^>]*>/g, '').replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

/** what the AI wrote → only fields that are safe to use */
export function check(p: Pick<P, 'name'>, raw: Record<string, unknown>): Draft {
  const out: Draft = {};
  for (const f of FIELDS) {
    let v = clean(raw[f]);
    if (f !== 'description' && f !== 'short_description') v = v.replace(/\s*\n\s*/g, ' ');
    if (f === 'seo_keywords') v = v.split(/[,،]/).map((x) => x.trim()).filter(Boolean).slice(0, 12).join(', ');
    const [min, max] = LIMIT[f];
    if (v.length < min || v.length > max) continue;
    if (/(https?:\/\/|www\.)|\b01[3-9]\d{8}\b/i.test(v)) continue; // no links, no phone numbers (another shop's)
    if (f === 'name_bn') {
      const have = v.toLowerCase().replace(/[^a-z0-9]/g, ''); // DT-9205A = DT9205A
      if (!codesIn(p.name).every((c) => have.includes(c)) || !/[\u0980-\u09ff]/.test(v)) continue; // Bangla, numbers kept
      v = fullBangla(v); // owner, 2026-11-14: no English letters or digits in the Bangla name (২০০ এ, ডিটি৯২০৫এ)
    }
    if (f === 'description' || f === 'short_description') {
      // only the product's own text, compact lists (the same clean-up every description gets: services/autodesc.ts)
      v = productOnly(v);
      if (v.length < 40) continue; // (a short but real text is fine — owner: "even one line")
    }
    if (f === 'name') {
      const have = v.toLowerCase().replace(/[^a-z0-9]/g, ''); // DT-9205A = DT9205A
      if (!codesIn(p.name).every((c) => have.includes(c))) continue; // a model / size number went missing
      // still the same product: at least one real word of the old name stays (no wandering off to another thing)
      const words = (x: string) => new Set(x.toLowerCase().match(/[a-z]{3,}|[\u0980-\u09ff]{2,}/g) || []);
      const old = words(p.name), now = words(v);
      if (old.size && ![...old].some((w) => now.has(w))) continue;
    }
    out[f] = v;
  }
  return out;
}

function prompt(p: P): string {
  const specs = Array.isArray(p.specs) ? (p.specs as unknown[][]).filter((r) => Array.isArray(r) && r[0]).map((r) => `${r[0]}: ${r[1]}`).join('; ') : '';
  return `বাংলাদেশের অনলাইন দোকানের একটা পণ্যের পেজ নতুন করে লিখতে হবে, যাতে গুগলে উপরে আসে আর কাস্টমার কিনতে আগ্রহী হয়।
আগে Google-এ এই পণ্যটা (নাম আর মডেল নম্বর দিয়ে) খুঁজে অন্তত ২-৩টা ওয়েবসাইট (বাংলাদেশি ও বিদেশি দোকান, নির্মাতার পাতা, ডেটাশিট) থেকে আসল তথ্য জোগাড় করো। শুধু সেই পাতার তথ্য নেবে যেখানে পণ্যটা হুবহু এটাই (একই মডেল/একই জিনিস) — মিল না থাকলে নেবে না। যা নিশ্চিত না, লিখবে না।
কাজের তথ্যই আসল (দোকানের মালিকের নিয়ম): পণ্যের ধরন অনুযায়ী সংখ্যা আর একক সহ মূল তথ্য খুঁজবে — যেমন স্পিকারে: কয়টা স্পিকার/ড্রাইভার, আউটপুট কত ওয়াট, ব্যাটারি কত mAh, কত ঘণ্টা চলে, চার্জ হতে কত সময়, ব্লুটুথ ভার্সন, কত দূর পর্যন্ত কানেক্ট হয়, কোন কোন ইনপুট (USB/TF/AUX/FM); সেন্সর/মডিউলে: কত ভোল্টে চলে, কী মাপে বা কী করে, আউটপুট ধরন (ডিজিটাল/অ্যানালগ), মাপার সীমা, পিন, কোন বোর্ডে চলে; টুলে: পাওয়ার, তাপমাত্রা, মাপ; কাপড়/ফ্যাশনে: উপাদান, মাপ, রং। নামটাই ঘুরিয়ে-ফিরিয়ে লেখা ফাঁকা কথা ("এটি একটি উন্নত মানের পণ্য" ধরনের) একদম নয় — এখনকার বিবরণে এমন কথা থাকলে বাদ দিয়ে নতুন করে লিখবে।
এখনকার তথ্য:
নাম: ${p.name}
ব্র্যান্ড: ${p.brand || '-'} | মডেল: ${p.model || '-'} | ক্যাটাগরি: ${p.category || '-'} | দাম: ৳${p.price}
স্পেসিফিকেশন: ${specs || '-'}
ছোট বিবরণ: ${p.short_description.slice(0, 600) || '-'}
বিস্তারিত বিবরণ: ${p.description.slice(0, 2500) || '-'}

শুধু একটা JSON দাও (আর কিছু না)। খোঁজে যদি নিশ্চিত না হও যে এটা ঠিক এই পণ্যটাই, তাহলে শুধু {"same_product": false} দাও।
{"same_product": true,
 "name": "ইংরেজিতে পরিষ্কার পণ্যের নাম — মানুষ যেভাবে খোঁজে; মডেল/মাপ নম্বর হুবহু রাখবে; ১২০ অক্ষরের মধ্যে; অন্য দোকানের নাম নয়",
 "seo_title": "৬০ অক্ষরের মধ্যে, মূল কিওয়ার্ড শুরুতে, শেষে 'Price in BD' জাতীয় শব্দ চলবে",
 "seo_description": "১২০–১৫৫ অক্ষর, বাংলা+ইংরেজি মিশিয়ে, দাম/ক্যাশ অন ডেলিভারির কথা থাকতে পারে",
 "seo_keywords": "৬–১০টা কিওয়ার্ড, কমা দিয়ে (ইংরেজি ও বাংলা — মানুষ যা লিখে খোঁজে)",
 "name_bn": "বাংলা নাম — যতটা পারা যায় বাংলায়; শুধু যে শব্দ বাংলায় অদ্ভুত শোনায় বা কাস্টমার চিনবে না (মডেল নম্বর, Arduino, PCB, Bluetooth, USB, ব্র্যান্ড) সেটুকু ইংরেজিতে; মাপ/মডেল নম্বর হুবহু",
 "short_description": "বাংলায় ২–৪ লাইন: পণ্যটা কী আর এর মূল তথ্য (মাপ, ভোল্টেজ, কাজ) — শুধু পণ্যের তথ্য",
 "description": "বাংলায়: ১-২ লাইনে পণ্যটা কী আর কী কাজে লাগে; তারপর '### মূল তথ্য' শিরোনামে খুঁজে পাওয়া সব তথ্য '- **নাম:** মান' তালিকায় (প্রতিটা এক লাইনে, সংখ্যা আর একক সহ, মাঝে ফাঁকা লাইন নয়); তারপর দরকার হলে কীভাবে ব্যবহার করবেন আর প্যাকেজে কী থাকে (জানা থাকলে)। কোনো লিংক, ফোন নম্বর, অন্য দোকানের নাম বা HTML নয়।"}

শুধু পণ্যের তথ্য (খুব জরুরি — দোকানের মালিকের নিয়ম): বিবরণে দোকান, দাম, অফার, ডেলিভারি, ক্যাশ অন ডেলিভারি, অর্ডার করার নিয়ম, রিটার্ন/গ্যারান্টি নীতি, "কেন আমাদের থেকে কিনবেন", "কেনার আগে জেনে নিন", প্রশ্ন-উত্তর (FAQ) — এসব কিছুই লিখবে না। বিক্রির কথা বা প্রশংসার বাড়াবাড়ি ("সেরা", "অসাধারণ সুযোগ") নয়। তথ্য অল্প হলে অল্পই লিখবে — এক লাইন হলেও চলবে, বানিয়ে লম্বা করবে না।

ভাষার নিয়ম (খুব জরুরি — দোকানটা বাংলাদেশের কাস্টমারদের জন্য): ছোট ও বিস্তারিত বিবরণ যতটা সম্ভব সহজ, সাবলীল বাংলায় লিখবে — মানুষ যেভাবে কথা বলে। শুধু যে শব্দ বাংলায় লিখলে কাস্টমার বুঝবে না বা অদ্ভুত লাগে, সেগুলো ইংরেজিতে রাখবে: মডেল/পার্ট নম্বর, একক (V, A, mAh, W, Hz), আর পরিচিত প্রযুক্তি শব্দ (Arduino, Bluetooth, USB, PCB, Module, Sensor, Driver, IC, LED, Battery ইত্যাদি)। পুরো বাক্য ইংরেজিতে লিখবে না। "স্পেসিফিকেশন" নামে আলাদা অংশ লিখবে না (দোকানের নিয়ম)। বাংলা বানান শুদ্ধ রাখবে।`;
}

/** Gemini with Google Search: the answer's JSON (search answers can't be forced into JSON, so it is read out) */
type Found = { text: string; via: string };
async function draftFor(key: string, p: P): Promise<{ d: Draft; via: string }> {
  const { text, via } = await geminiSearch(key, prompt(p));
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('AI ঠিকমতো উত্তর দেয়নি');
  const raw = JSON.parse(m[0]) as Record<string, unknown>;
  if (raw.same_product === false || raw.skip === true) return { d: {}, via }; // not sure it is this exact product: leave it
  return { d: check(p, raw), via };
}
async function geminiSearch(key: string, text: string): Promise<Found> {
  // 1) with Google Search: the bigger model, then the quick one; 2) if Search isn't allowed on this key / is busy,
  // the same models from what they already know (the same safety checks run on the answer either way)
  const why: string[] = [];
  const started = Date.now();
  const tries: [string, boolean][] = [['gemini-flash-latest', true], ['gemini-flash-lite-latest', true], ['gemini-flash-lite-latest', false], ['gemini-flash-latest', false]];
  for (const [m, search] of tries) {
    const left = 55000 - (Date.now() - started);
    if (left < 8000) break; // the page must answer within a minute
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, {
        method: 'POST', signal: AbortSignal.timeout(Math.min(left - 3000, search ? 25000 : 20000)), headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text }] }], ...(search ? { tools: [{ google_search: {} }] } : {}), generationConfig: { temperature: 0.4, maxOutputTokens: 4096 } }),
      });
      const j = (await r.json().catch(() => ({}))) as { candidates?: { content?: { parts?: { text?: string }[] }; groundingMetadata?: { webSearchQueries?: string[]; groundingChunks?: { web?: { title?: string } }[] } }[]; error?: { message?: string } };
      if (!r.ok) { why.push(`${m}${search ? '+search' : ''}: ${r.status} ${String(j.error?.message || '').slice(0, 120)}`); continue; }
      const out = (j.candidates?.[0]?.content?.parts || []).map((x) => x.text || '').join('').trim();
      // did it really search? Google says so in the answer (the searches it made and the pages it read)
      const g = j.candidates?.[0]?.groundingMetadata;
      const pages = (g?.groundingChunks || []).map((c) => c.web?.title).filter(Boolean).slice(0, 4).join(', ');
      const via = search && g && (g.webSearchQueries?.length || pages) ? `🔎 গুগলে খুঁজে${pages ? ` (${pages})` : ''}` : '🧠 AI-এর নিজের জানা থেকে';
      if (out) return { text: out, via };
      why.push(`${m}: খালি উত্তর`);
    } catch (e) { why.push(`${m}: ${(e as Error).name === 'TimeoutError' || /abort/i.test((e as Error).message) ? 'সময় শেষ' : (e as Error).message}`); }
  }
  console.error('aiwriter', why.join(' | '));
  throw new Error(`Google এখন উত্তর দিল না — পরে নিজে থেকে আবার চেষ্টা হবে। (${why.slice(-2).join(' · ')})`);
}

const load = (id: number) => db.one<P>(`SELECT p.id, p.name, p.name_bn, p.brand, p.model, c.name AS category, p.price, p.specs, p.short_description, p.description, p.seo_title, p.seo_description, p.seo_keywords
  FROM products p LEFT JOIN categories c ON c.id=p.category_id WHERE p.id=$1`, [id]);

/** write the changes down, then make them (or leave them waiting for the owner) */
async function keep(p: P, d: Draft, applyIfAuto: boolean, via: string): Promise<number> {
  // owner, 2026-10-24: put it in by itself either way ("no waiting for my ✅") — where it came from is shown beside it
  const apply = applyIfAuto;
  let n = 0;
  for (const f of FIELDS) {
    const v = d[f];
    if (!v || v === String(p[f] || '').trim()) continue;
    await db.q(`INSERT INTO ai_staff_edits(product_id, field, old_value, new_value, status, via) VALUES($1, $2, $3, $4, $5, $6)`, [p.id, f, String(p[f] || ''), v, apply ? 'applied' : 'proposed', via.slice(0, 300)]);
    if (apply) await db.q(`UPDATE products SET ${f}=$2, ${f === 'name_bn' ? 'name_bn_auto=false, ' : ''}updated_at=now() WHERE id=$1`, [p.id, v]);
    n++;
  }
  await db.q(`INSERT INTO ai_staff_edits(product_id, field, old_value, new_value, status) VALUES($1, 'checked', '', '', 'checked')`, [p.id]);
  if (apply && n) cache.clearAll();
  return n;
}

/** how many real facts a text has: numbers with units (5V, 2000mAh, 10 ঘণ্টা, 5.3 …) and "label: value" lines.
 *  A long text that only repeats the name has none (owner, 2026-11-14: "the description is the title copied around"). */
export function factCount(text: string): number {
  const t = String(text || '');
  const units = t.match(/[\d০-৯]+(?:[.][\d০-৯]+)?\s*(?:v|vac|vdc|w|a|ma|mah|ah|hz|khz|mhz|ghz|mm|cm|m|kg|g|gm|inch|in|"|db|rpm|°c|ohm|Ω|pin|pins|ch|channel|watt|volt|hour|hours|hrs?|ঘণ্টা|মিনিট|ভোল্ট|ওয়াট|পিন|মিটার|গ্রাম|ইঞ্চি)(?![a-z])/giu) || [];
  const versions = t.match(/(?:bluetooth|ব্লুটুথ|version|ভার্সন|v)\s*[\d০-৯][.][\d০-৯]/giu) || [];
  const labels = t.match(/^\s*(?:[-*•]\s*)?(?:\*\*)?[^\n:]{2,40}(?:\*\*)?\s*:\s*\S/gmu) || [];
  return units.length + versions.length + labels.length;
}

/** the next products to write again: the ones with the fewest real facts first (then the weakest SEO), each at most
 *  once in 30 days — active products only */
async function nextProducts(limit: number): Promise<number[]> {
  const recent = new Set((await db.q<{ product_id: number }>(`SELECT DISTINCT product_id FROM ai_staff_edits WHERE created_at > now() - interval '30 days'`)).map((r) => r.product_id));
  const seo = await seoscore.seoProblems();
  const score = new Map(seo.list.map((p) => [p.id, p.score]));
  const rows = await db.q<{ id: number; t: string }>(`SELECT id, coalesce(short_description, '') || E'\n' || coalesce(description, '') AS t FROM products
    WHERE active AND parent_id IS NULL ORDER BY id DESC`);
  return rows.filter((r) => !recent.has(r.id))
    .map((r) => ({ id: r.id, facts: Math.min(factCount(r.t), 6), score: score.get(r.id) ?? 100 }))
    .sort((a, b) => a.facts - b.facts || a.score - b.score)
    .slice(0, limit).map((r) => r.id);
}

/** improve up to `limit` products now; returns how many fields changed / wait */
export async function improve(settings: Settings, { limit = 1, ids }: { limit?: number; ids?: number[] } = {}): Promise<{ products: number; fields: number; errors: string[]; via: string }> {
  const key = String(settings.ai_gemini_key || '').trim();
  if (!key) throw new Error('এর জন্য Gemini চাবি লাগবে (AI স্টাফ পেজে বসান — ফ্রি)।');
  const apply = settings.ai_write_auto !== '0';
  const out = { products: 0, fields: 0, errors: [] as string[], via: '' };
  for (const id of ids || (await nextProducts(limit))) {
    const p = await load(id);
    if (!p) continue;
    try { const r = await draftFor(key, p); out.fields += await keep(p, r.d, apply, r.via); out.products++; out.via = r.via; } catch (e) { out.errors.push(`${p.name}: ${(e as Error).message}`); }
  }
  return out;
}

/** a little every hour from the scheduled job, within the day's allowance (Gemini's free plan has daily limits) */
export async function tick(settings: Settings): Promise<void> {
  // the old texts are kept 30 days for "↩️ ফেরত", then removed (a few KB per product — the shop never gets heavier)
  await db.q(`DELETE FROM ai_staff_edits WHERE created_at < now() - interval '30 days'`);
  if (settings.ai_write_on === '0' || !String(settings.ai_gemini_key || '').trim()) return;
  // a working day like a person's: 9 to 6, Bangladesh time (the owner can change the hours)
  const h = new Date(Date.now() + 6 * 3600e3).getUTCHours();
  const from = Number(settings.ai_work_from ?? 9), to = Number(settings.ai_work_to ?? 18);
  if (h < from || h >= to) return;
  const perDay = Math.min(150, Math.max(1, Number(settings.ai_write_daily) || 100)); // (owner, 2026-11-14: faster — every product SEO-ready)
  const today = await db.one<{ n: number }>(`SELECT count(*)::int AS n FROM ai_staff_edits WHERE field='checked' AND created_at > now() - interval '24 hours'`);
  if ((today?.n || 0) >= perDay) return;
  await improve(settings, { limit: Math.min(4, perDay - (today?.n || 0)) });
}

/** put the old text back (only where nobody changed it since) */
export async function undo(productId: number): Promise<number> {
  const rows = await db.q<{ id: number; field: Field; old_value: string; new_value: string }>(`SELECT DISTINCT ON (field) id, field, old_value, new_value FROM ai_staff_edits
    WHERE product_id=$1 AND status='applied' ORDER BY field, id DESC`, [productId]);
  let n = 0;
  for (const r of rows) {
    if (!(FIELDS as readonly string[]).includes(r.field)) continue;
    const done = await db.q(`UPDATE products SET ${r.field}=$2, updated_at=now() WHERE id=$1 AND ${r.field}=$3 RETURNING id`, [productId, r.old_value, r.new_value]);
    await db.q(`UPDATE ai_staff_edits SET status='undone' WHERE id=$1`, [r.id]);
    n += done.length;
  }
  if (n) cache.clearAll();
  return n;
}
/** the owner's ✅ / ❌ on waiting texts of one product */
export async function decide(productId: number, ok: boolean): Promise<number> {
  const rows = await db.q<{ id: number; field: Field; new_value: string }>(`SELECT id, field, new_value FROM ai_staff_edits WHERE product_id=$1 AND status='proposed'`, [productId]);
  for (const r of rows) {
    if (ok && (FIELDS as readonly string[]).includes(r.field)) await db.q(`UPDATE products SET ${r.field}=$2, ${r.field === 'name_bn' ? 'name_bn_auto=false, ' : ''}updated_at=now() WHERE id=$1`, [productId, r.new_value]);
    await db.q(`UPDATE ai_staff_edits SET status=$2 WHERE id=$1`, [r.id, ok ? 'applied' : 'rejected']);
  }
  if (ok && rows.length) cache.clearAll();
  return rows.length;
}
/** the latest work, one entry per product */
export async function recent(limit = 30): Promise<{ product_id: number; name: string; at: Date; status: string; via: string | null; fields: { field: Field; old_value: string; new_value: string }[] }[]> {
  return db.q(`SELECT e.product_id, p.name, max(e.created_at) AS at,
      CASE WHEN bool_or(e.status='proposed') THEN 'proposed' WHEN bool_or(e.status='applied') THEN 'applied' WHEN bool_or(e.status='undone') THEN 'undone' ELSE 'rejected' END AS status,
      max(e.via) AS via, json_agg(json_build_object('field', e.field, 'old_value', left(e.old_value, 400), 'new_value', left(e.new_value, 600)) ORDER BY e.id) AS fields
    FROM ai_staff_edits e JOIN products p ON p.id=e.product_id WHERE e.field <> 'checked' AND e.created_at > now() - interval '30 days'
    GROUP BY e.product_id, p.name ORDER BY max(e.id) DESC LIMIT $1`, [limit]);
}
