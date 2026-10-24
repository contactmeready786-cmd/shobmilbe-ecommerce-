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
import { gemini } from './aistaff';
import type { Settings } from '../types';

export const FIELDS = ['name', 'seo_title', 'seo_description', 'seo_keywords', 'short_description', 'description'] as const;
export type Field = (typeof FIELDS)[number];
export const FIELD_LABEL: Record<Field, string> = { name: 'নাম (টাইটেল)', seo_title: 'SEO টাইটেল', seo_description: 'মেটা বিবরণ', seo_keywords: 'কিওয়ার্ড', short_description: 'ছোট বিবরণ', description: 'বিস্তারিত বিবরণ' };
const LIMIT: Record<Field, [number, number]> = { name: [10, 120], seo_title: [20, 65], seo_description: [70, 165], seo_keywords: [3, 300], short_description: [40, 700], description: [200, 8000] };

type P = { id: number; name: string; brand: string; model: string; category: string | null; price: number; specs: unknown; short_description: string; description: string; seo_title: string; seo_description: string; seo_keywords: string };
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
    if (f === 'name') {
      const have = codesIn(v).join(' ');
      if (!codesIn(p.name).every((c) => have.includes(c))) continue; // a model / size number went missing
    }
    out[f] = v;
  }
  return out;
}

function prompt(p: P): string {
  const specs = Array.isArray(p.specs) ? (p.specs as unknown[][]).filter((r) => Array.isArray(r) && r[0]).map((r) => `${r[0]}: ${r[1]}`).join('; ') : '';
  return `বাংলাদেশের অনলাইন দোকানের একটা পণ্যের পেজ নতুন করে লিখতে হবে, যাতে গুগলে উপরে আসে আর কাস্টমার কিনতে আগ্রহী হয়।
আগে Google-এ এই পণ্যটা খুঁজে আসল তথ্য (কী কাজে লাগে, মূল স্পেসিফিকেশন, মানুষ কী লিখে খোঁজে) জেনে নাও। যা নিশ্চিত না, লিখবে না।
এখনকার তথ্য:
নাম: ${p.name}
ব্র্যান্ড: ${p.brand || '-'} | মডেল: ${p.model || '-'} | ক্যাটাগরি: ${p.category || '-'} | দাম: ৳${p.price}
স্পেসিফিকেশন: ${specs || '-'}
ছোট বিবরণ: ${p.short_description.slice(0, 600) || '-'}
বিস্তারিত বিবরণ: ${p.description.slice(0, 2500) || '-'}

শুধু একটা JSON দাও (আর কিছু না):
{"name": "ইংরেজিতে পরিষ্কার পণ্যের নাম — মানুষ যেভাবে খোঁজে; মডেল/মাপ নম্বর হুবহু রাখবে; ১২০ অক্ষরের মধ্যে; অন্য দোকানের নাম নয়",
 "seo_title": "৬০ অক্ষরের মধ্যে, মূল কিওয়ার্ড শুরুতে, শেষে 'Price in BD' জাতীয় শব্দ চলবে",
 "seo_description": "১২০–১৫৫ অক্ষর, বাংলা+ইংরেজি মিশিয়ে, দাম/ক্যাশ অন ডেলিভারির কথা থাকতে পারে",
 "seo_keywords": "৬–১০টা কিওয়ার্ড, কমা দিয়ে (ইংরেজি ও বাংলা — মানুষ যা লিখে খোঁজে)",
 "short_description": "বাংলায় ২–৪ লাইন: পণ্যটা কী আর কেন কিনবে",
 "description": "বাংলায় বিস্তারিত (প্রযুক্তিগত শব্দ ইংরেজিতে): কী কাজে লাগে, বৈশিষ্ট্য ('- ' দিয়ে তালিকা), স্পেসিফিকেশন, কীভাবে ব্যবহার করবেন, প্যাকেজে কী থাকে (জানা থাকলে)। কোনো লিংক, ফোন নম্বর, অন্য দোকানের নাম বা HTML নয়।"}`;
}

/** Gemini with Google Search: the answer's JSON (search answers can't be forced into JSON, so it is read out) */
async function draftFor(key: string, p: P): Promise<Draft> {
  const text = await geminiSearch(key, prompt(p));
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('AI ঠিকমতো উত্তর দেয়নি');
  return check(p, JSON.parse(m[0]) as Record<string, unknown>);
}
async function geminiSearch(key: string, text: string): Promise<string> {
  try {
    const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent', {
      method: 'POST', signal: AbortSignal.timeout(45000), headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text }] }], tools: [{ google_search: {} }], generationConfig: { temperature: 0.4, maxOutputTokens: 4096 } }),
    });
    const j = (await r.json().catch(() => ({}))) as { candidates?: { content?: { parts?: { text?: string }[] } }[]; error?: { message?: string } };
    if (!r.ok) throw new Error(j.error?.message || `Gemini ${r.status}`);
    const out = (j.candidates?.[0]?.content?.parts || []).map((x) => x.text || '').join('').trim();
    if (out) return out;
  } catch (e) { console.error('aiwriter search', (e as Error).message); }
  return gemini(key, text, 40000); // search unavailable: the model's own knowledge, same checks
}

const load = (id: number) => db.one<P>(`SELECT p.id, p.name, p.brand, p.model, c.name AS category, p.price, p.specs, p.short_description, p.description, p.seo_title, p.seo_description, p.seo_keywords
  FROM products p LEFT JOIN categories c ON c.id=p.category_id WHERE p.id=$1`, [id]);

/** write the changes down, then make them (or leave them waiting for the owner) */
async function keep(p: P, d: Draft, apply: boolean): Promise<number> {
  let n = 0;
  for (const f of FIELDS) {
    const v = d[f];
    if (!v || v === String(p[f] || '').trim()) continue;
    await db.q(`INSERT INTO ai_staff_edits(product_id, field, old_value, new_value, status) VALUES($1, $2, $3, $4, $5)`, [p.id, f, String(p[f] || ''), v, apply ? 'applied' : 'proposed']);
    if (apply) await db.q(`UPDATE products SET ${f}=$2, updated_at=now() WHERE id=$1`, [p.id, v]);
    n++;
  }
  await db.q(`INSERT INTO ai_staff_edits(product_id, field, old_value, new_value, status) VALUES($1, 'checked', '', '', 'checked')`, [p.id]);
  if (apply && n) cache.clearAll();
  return n;
}

/** the next products to write again: weakest SEO first, each at most once in 30 days */
async function nextProducts(limit: number): Promise<number[]> {
  const recent = new Set((await db.q<{ product_id: number }>(`SELECT DISTINCT product_id FROM ai_staff_edits WHERE created_at > now() - interval '30 days'`)).map((r) => r.product_id));
  const seo = await seoscore.seoProblems();
  return seo.list.filter((p) => !recent.has(p.id)).sort((a, b) => a.score - b.score).slice(0, limit).map((p) => p.id);
}

/** improve up to `limit` products now; returns how many fields changed / wait */
export async function improve(settings: Settings, { limit = 1, ids }: { limit?: number; ids?: number[] } = {}): Promise<{ products: number; fields: number; errors: string[] }> {
  const key = String(settings.ai_gemini_key || '').trim();
  if (!key) throw new Error('এর জন্য Gemini চাবি লাগবে (AI স্টাফ পেজে বসান — ফ্রি)।');
  const apply = settings.ai_write_auto !== '0';
  const out = { products: 0, fields: 0, errors: [] as string[] };
  for (const id of ids || (await nextProducts(limit))) {
    const p = await load(id);
    if (!p) continue;
    try { out.fields += await keep(p, await draftFor(key, p), apply); out.products++; } catch (e) { out.errors.push(`${p.name}: ${(e as Error).message}`); }
  }
  return out;
}

/** a little every hour from the scheduled job, within the day's allowance (Gemini's free plan has daily limits) */
export async function tick(settings: Settings): Promise<void> {
  if (settings.ai_write_on === '0' || !String(settings.ai_gemini_key || '').trim()) return;
  // a working day like a person's: 9 to 6, Bangladesh time (the owner can change the hours)
  const h = new Date(Date.now() + 6 * 3600e3).getUTCHours();
  const from = Number(settings.ai_work_from ?? 9), to = Number(settings.ai_work_to ?? 18);
  if (h < from || h >= to) return;
  const perDay = Math.min(100, Math.max(1, Number(settings.ai_write_daily) || 30));
  const today = await db.one<{ n: number }>(`SELECT count(*)::int AS n FROM ai_staff_edits WHERE field='checked' AND created_at > now() - interval '24 hours'`);
  if ((today?.n || 0) >= perDay) return;
  await improve(settings, { limit: 1 });
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
    if (ok && (FIELDS as readonly string[]).includes(r.field)) await db.q(`UPDATE products SET ${r.field}=$2, updated_at=now() WHERE id=$1`, [productId, r.new_value]);
    await db.q(`UPDATE ai_staff_edits SET status=$2 WHERE id=$1`, [r.id, ok ? 'applied' : 'rejected']);
  }
  if (ok && rows.length) cache.clearAll();
  return rows.length;
}
/** the latest work, one entry per product */
export async function recent(limit = 30): Promise<{ product_id: number; name: string; at: Date; status: string; fields: { field: Field; old_value: string; new_value: string }[] }[]> {
  return db.q(`SELECT e.product_id, p.name, max(e.created_at) AS at,
      CASE WHEN bool_or(e.status='proposed') THEN 'proposed' WHEN bool_or(e.status='applied') THEN 'applied' WHEN bool_or(e.status='undone') THEN 'undone' ELSE 'rejected' END AS status,
      json_agg(json_build_object('field', e.field, 'old_value', left(e.old_value, 400), 'new_value', left(e.new_value, 600)) ORDER BY e.id) AS fields
    FROM ai_staff_edits e JOIN products p ON p.id=e.product_id WHERE e.field <> 'checked' AND e.created_at > now() - interval '30 days'
    GROUP BY e.product_id, p.name ORDER BY max(e.id) DESC LIMIT $1`, [limit]);
}
