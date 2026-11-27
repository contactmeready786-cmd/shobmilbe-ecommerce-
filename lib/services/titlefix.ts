// 🏷️ নাম ঠিক করা (AI) — owner, 2026-11-28. Many product names were copied from other shops: keyword-stuffed,
// words broken on purpose ("Comp-arator", "G-U-N"), model numbers repeated ("BC327 BC-327 BC 327"), cut at 140
// letters in the middle of a word, the Bangla name made letter by letter ("পাকাগ জেনারেল পুর্পোস"), and products
// put in the wrong category. With the owner's free Gemini key, every product is looked at once — its PHOTO, its
// name, its description and the category list — and Gemini writes a clean English name, a real Bangla name and
// picks the category.
//
// Safety (owner: "the title must always be this product, never another one"):
//  - Gemini first says what the photo shows and whether it is the product the name describes; anything but a clear
//    "yes" waits for the owner (status 'review') — nothing changes in the shop.
//  - lib/data/titlecheck.ts: every model / part code stays, no invented number or code, length, no filler.
//  - the category changes only when Gemini is sure; the old values are kept (title_fix.old) for ↩️ undo.
//  - a few products every 5 minutes (lib/api/files.ts runShopJobs); Google's "too many" → waits half an hour.
import * as db from '../db';
import * as cache from '../cache';
import { cut } from './seo';
import { checkTitle, checkBangla } from '../data/titlecheck';
import type { Settings } from '../types';

const MODELS = ['gemini-flash-latest', 'gemini-flash-lite-latest'];
const URL_OF = (m: string) => `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`;

export type Proposal = {
  photo_shows: string; photo_matches: 'yes' | 'no' | 'unsure';
  title_en: string; title_bn: string; category_id: number; category_sure: boolean; issues: string[];
};
type Prod = { id: number; name: string; name_bn: string; name_bn_auto: boolean; category_id: number | null; description: string; short_description: string;
  brand: string; model: string; image_id: number | null; seo_title: string; seo_keywords: string; seo_description: string };
type Cat = { id: number; path: string };

const on = (s: Settings) => s.titlefix_on !== '0' && !!String(s.ai_gemini_key || '').trim();

async function categories(): Promise<Cat[]> {
  const rows = await db.q<{ id: number; name: string; parent_id: number | null; active: boolean }>('SELECT id, name, parent_id, coalesce(active, true) AS active FROM categories');
  const by = new Map(rows.map((r) => [r.id, r]));
  const path = (r: { id: number; name: string; parent_id: number | null }): string => {
    const parts = [r.name]; let p = r.parent_id ? by.get(r.parent_id) : undefined; let guard = 0;
    while (p && guard++ < 6) { parts.unshift(p.name); p = p.parent_id ? by.get(p.parent_id) : undefined; }
    return parts.join(' › ');
  };
  return rows.filter((r) => r.active).map((r) => ({ id: r.id, path: path(r) })).sort((a, b) => a.path.localeCompare(b.path));
}

/** the product's main photo as base64 JPEG (ImageKit makes it 640 px wide; else the stored file) */
async function photo(imageId: number | null): Promise<{ mime: string; b64: string } | null> {
  if (!imageId) return null;
  const m = await db.one<{ ik_url: string | null; mime: string; data: Buffer | null; thumb: Buffer | null }>('SELECT ik_url, mime, data, thumb FROM media WHERE id=$1', [imageId]);
  if (!m) return null;
  if (m.ik_url) {
    try {
      const r = await fetch(`${m.ik_url}${m.ik_url.includes('?') ? '&' : '?'}tr=w-640,f-jpg`, { signal: AbortSignal.timeout(20000) });
      if (r.ok) return { mime: 'image/jpeg', b64: Buffer.from(await r.arrayBuffer()).toString('base64') };
    } catch { /* the stored copy below */ }
  }
  const buf = m.data || m.thumb;
  return buf ? { mime: m.mime || 'image/jpeg', b64: buf.toString('base64') } : null;
}

const plain = (s: string, n: number) => String(s || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);

function prompt(p: Prod, cats: Cat[], current: string) {
  return `You are a careful product-data editor for "Shobmilbe", a Bangladeshi online shop for electronics parts, tools, remotes, home and personal items. You get ONE product: its photo, its current title (often copied from another shop: keyword-stuffed, words broken on purpose with hyphens or spaces like "Comp-arator", "Du al", "G-U-N", model numbers repeated, cut off at the end), its description and its current category.

Do this:
1. Look at the photo. In "photo_shows" say in a few English words what it shows. In "photo_matches" answer "yes" only if the photo clearly shows the same product the title and description describe; "no" if it is a different product; "unsure" if you cannot tell (no photo, too small, only packaging, many items).
2. "title_en": a clean English product title, 35–90 characters, for THIS product: [brand if a real brand is given] [model/part number] [what the product is] [1–3 key specs]. Rules:
   - Use ONLY facts that are in the current title or the description. Never invent or change a number, spec, brand, model, size, colour or quantity.
   - Keep every real model / part number exactly as written (e.g. LM324N, BTA16-600B, HC-SR04, 18650, TO-92) and write each only once.
   - Repair the broken words ("Comp-arator" → "Comparator", "Du al" → "Dual", "Ban-ana" → "Banana", "G-U-N" → "Gun"), fix spelling, and remove filler: "A Class", "Medium Class", "Best Quality", "Electrical Circuitry & Parts", "Electronics Components", "Passive Components", shop names, "Price in BD", repeated words.
   - If facts contradict each other or the photo (e.g. "2 slot" and "four slot"), keep only what the photo confirms, otherwise leave that detail out, and say so in "issues".
   - Title Case. ALL CAPS only for model numbers and abbreviations (LED, USB, DC, AC, IC, PCB, LCD, RGB, IR).
   - If the current title is already clean and correct, return it unchanged.
3. "title_bn": the same title in natural Bangladeshi Bangla, as a Bangla shopper would say it — NO English letters at all: write model numbers and English words with Bangla letters, digits as Bangla digits (০-৯). Example: "N20 Micro Metal Gear Motor 200RPM" → "এন২০ মাইক্রো মেটাল গিয়ার মোটর ২০০ আরপিএম".
4. "category_id": the best category from the list below for what the product IS (a soldering iron tip is a soldering tool, a remote is a remote, a transistor is a component). Categories named Digital are ONLY for software, licence keys and digital downloads — never for physical items. "category_sure": true only if you are clearly sure.
5. "issues": short English notes on anything wrong you noticed (wrong facts, photo mismatch); empty list if none.

Current title: ${p.name}
Brand: ${p.brand || '-'} · Model: ${p.model || '-'}
Current category: ${current || '-'}
Description: ${plain(`${p.short_description} ${p.description}`, 1500) || '-'}

Categories (id: path):
${cats.map((c) => `${c.id}: ${c.path}`).join('\n')}

Answer with JSON only: {"photo_shows": "", "photo_matches": "yes|no|unsure", "title_en": "", "title_bn": "", "category_id": 0, "category_sure": true, "issues": []}`;
}

/** one product → Gemini's proposal (throws 'busy' when Google says too many) */
async function ask(key: string, p: Prod, cats: Cat[]): Promise<{ prop: Proposal; model: string }> {
  const current = cats.find((c) => c.id === p.category_id)?.path || '';
  const img = await photo(p.image_id);
  const parts: unknown[] = [{ text: prompt(p, cats, current) }];
  if (img) parts.unshift({ inline_data: { mime_type: img.mime, data: img.b64 } });
  let last = 'Gemini';
  for (const m of MODELS) {
    const r = await fetch(URL_OF(m), {
      method: 'POST', signal: AbortSignal.timeout(60000),
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { temperature: 0.1, maxOutputTokens: 2048, responseMimeType: 'application/json' } }),
    }).catch((e) => { last = (e as Error).message; return null; });
    if (!r) continue;
    const j = (await r.json().catch(() => ({}))) as { candidates?: { content?: { parts?: { text?: string }[] } }[]; error?: { message?: string } };
    if (!r.ok) { last = j.error?.message || `Gemini ${r.status}`; if (r.status === 429) continue; if ([404, 500, 503].includes(r.status)) continue; throw new Error(last); }
    const text = (j.candidates?.[0]?.content?.parts || []).map((x) => x.text || '').join('').trim();
    try {
      const o = JSON.parse(text.replace(/^```(?:json)?|```$/g, '')) as Partial<Proposal>;
      const prop: Proposal = {
        photo_shows: String(o.photo_shows || '').slice(0, 200), photo_matches: o.photo_matches === 'yes' || o.photo_matches === 'no' ? o.photo_matches : 'unsure',
        title_en: String(o.title_en || '').replace(/\s+/g, ' ').trim(), title_bn: String(o.title_bn || '').replace(/\s+/g, ' ').trim(),
        category_id: Number(o.category_id) || 0, category_sure: o.category_sure === true, issues: Array.isArray(o.issues) ? o.issues.map((x) => String(x).slice(0, 200)).slice(0, 5) : [],
      };
      if (!img) prop.photo_matches = 'unsure';
      return { prop, model: m };
    } catch { last = 'Gemini-র উত্তর পড়া যায়নি'; }
  }
  throw new Error(/quota|exhaust|rate|429/i.test(last) ? 'busy' : last);
}

const load = (id: number) => db.one<Prod>(`SELECT id, name, name_bn, name_bn_auto, category_id, coalesce(description, '') AS description, coalesce(short_description, '') AS short_description,
  coalesce(brand, '') AS brand, coalesce(model, '') AS model, image_id, coalesce(seo_title, '') AS seo_title, coalesce(seo_keywords, '') AS seo_keywords, coalesce(seo_description, '') AS seo_description
  FROM products WHERE id=$1`, [id]);

type Old = Pick<Prod, 'name' | 'name_bn' | 'name_bn_auto' | 'category_id' | 'seo_title' | 'seo_keywords' | 'seo_description'>;

/** put a proposal into the shop (old values kept for ↩️) */
async function apply(p: Prod, title: string | null, bnName: string | null, catId: number | null): Promise<Old> {
  const old: Old = { name: p.name, name_bn: p.name_bn, name_bn_auto: p.name_bn_auto, category_id: p.category_id, seo_title: p.seo_title, seo_keywords: p.seo_keywords, seo_description: p.seo_description };
  const name = title && title !== p.name ? title : p.name;
  const head = p.name.slice(0, 24).toLowerCase();
  const changedName = name !== p.name;
  // the SEO fields that were made from the old name follow the new one (ones the owner wrote himself stay)
  const seoTitle = changedName && p.seo_title.toLowerCase().includes(head) ? `${cut(name, 52)} Price in BD` : p.seo_title;
  const bn = bnName || p.name_bn;
  const seoKeywords = changedName && p.seo_keywords.toLowerCase().includes(head)
    ? [name, `${name} price in bd`, `${name} price in bangladesh`, bn, `${bn} দাম`].filter(Boolean).join(', ') : p.seo_keywords;
  const seoDescription = changedName && p.seo_description.includes(p.name) ? p.seo_description.split(p.name).join(name) : p.seo_description;
  await db.q(`UPDATE products SET name=$2, name_bn=$3, name_bn_auto=$4, category_id=$5, seo_title=$6, seo_keywords=$7, seo_description=$8, updated_at=now() WHERE id=$1`,
    [p.id, name, bn, bnName ? false : p.name_bn_auto, catId || p.category_id, seoTitle, seoKeywords, seoDescription]);
  return old;
}

/** look at one product; returns its new status */
export async function fixOne(settings: Settings, id: number): Promise<string> {
  const key = String(settings.ai_gemini_key || '').trim();
  const p = await load(id);
  if (!p) return 'gone';
  const cats = await categories();
  const { prop, model } = await ask(key, p, cats);
  const t = checkTitle(p.name, prop.title_en, `${p.short_description} ${p.description}`);
  const bnName = checkBangla(prop.title_bn);
  const catOk = prop.category_sure && cats.some((c) => c.id === prop.category_id) && prop.category_id !== p.category_id;
  const why = [...t.why];
  if (prop.photo_matches !== 'yes') why.unshift(prop.photo_matches === 'no' ? 'ছবির সাথে নাম মিলছে না' : 'ছবি দেখে নিশ্চিত হওয়া যায়নি');
  if (!bnName) why.push('বাংলা নাম ঠিক হয়নি');
  const same = prop.title_en === p.name && !catOk && (!bnName || bnName === p.name_bn);
  const auto = settings.titlefix_auto !== '0';
  let status: string;
  let old: Old | null = null;
  if (same) status = 'same';
  else if (prop.photo_matches === 'yes' && t.ok && auto) {
    old = await apply(p, prop.title_en, bnName, catOk ? prop.category_id : null);
    status = 'applied';
    cache.clearAll();
  } else status = 'review';
  await db.q(`INSERT INTO title_fix(product_id, status, old, proposal, why, model, applied_at) VALUES($1,$2,$3,$4,$5,$6,$7)
    ON CONFLICT (product_id) DO UPDATE SET status=EXCLUDED.status, old=EXCLUDED.old, proposal=EXCLUDED.proposal, why=EXCLUDED.why, model=EXCLUDED.model, applied_at=EXCLUDED.applied_at, created_at=now()`,
  [p.id, status, old ? JSON.stringify(old) : null, JSON.stringify({ ...prop, cat_ok: catOk, bn_ok: bnName }), why.join(' · ').slice(0, 500), model, status === 'applied' ? new Date() : null]);
  return status;
}

/** the owner's ✅ on a waiting one (the photo check can be wrong — the code checks still run) */
export async function approve(id: number): Promise<boolean> {
  const r = await db.one<{ proposal: Proposal & { cat_ok?: boolean; bn_ok?: string | null } }>(`SELECT proposal FROM title_fix WHERE product_id=$1 AND status='review'`, [id]);
  const p = await load(id);
  if (!r || !p) return false;
  const t = checkTitle(p.name, r.proposal.title_en, `${p.short_description} ${p.description}`);
  const old = await apply(p, t.ok ? r.proposal.title_en : null, r.proposal.bn_ok || null, r.proposal.category_sure && r.proposal.category_id ? r.proposal.category_id : null);
  await db.q(`UPDATE title_fix SET status='applied', old=$2, applied_at=now() WHERE product_id=$1`, [id, JSON.stringify(old)]);
  cache.clearAll();
  return true;
}
export async function skip(id: number): Promise<void> { await db.q(`UPDATE title_fix SET status='skipped' WHERE product_id=$1 AND status='review'`, [id]); }

/** ↩️ the old name, Bangla name, category and SEO fields come back */
export async function undo(id: number): Promise<boolean> {
  const r = await db.one<{ old: Old }>(`SELECT old FROM title_fix WHERE product_id=$1 AND status='applied' AND old IS NOT NULL`, [id]);
  if (!r) return false;
  const o = r.old;
  await db.q(`UPDATE products SET name=$2, name_bn=$3, name_bn_auto=$4, category_id=$5, seo_title=$6, seo_keywords=$7, seo_description=$8, updated_at=now() WHERE id=$1`,
    [id, o.name, o.name_bn, o.name_bn_auto, o.category_id, o.seo_title, o.seo_keywords, o.seo_description]);
  await db.q(`UPDATE title_fix SET status='undone' WHERE product_id=$1`, [id]);
  cache.clearAll();
  return true;
}

/** the next products to look at: every main product once, best sellers first */
async function nextIds(n: number): Promise<number[]> {
  const rows = await db.q<{ id: number }>(`SELECT p.id FROM products p WHERE p.parent_id IS NULL AND p.active
    AND NOT EXISTS (SELECT 1 FROM title_fix f WHERE f.product_id = p.id) ORDER BY coalesce(p.sold_count, 0) DESC, p.id LIMIT $1`, [n]);
  return rows.map((r) => r.id);
}

/** the scheduled job: a few products each round; Google's "too many" → a break */
export async function tick(settings: Settings): Promise<{ done: number; status?: string }> {
  if (!on(settings)) return { done: 0, status: 'off' };
  if (Date.now() < (Number(settings.titlefix_pause_until) || 0)) return { done: 0, status: 'paused' };
  const per = Math.min(20, Math.max(1, Number(settings.titlefix_per_tick) || 8));
  let done = 0;
  for (const id of await nextIds(per)) {
    try { await fixOne(settings, id); done++; } catch (e) {
      const msg = (e as Error).message;
      if (msg === 'busy') { await db.setMany({ titlefix_pause_until: String(Date.now() + 30 * 60e3) }); return { done, status: 'busy' }; }
      await db.q(`INSERT INTO title_fix(product_id, status, why) VALUES($1, 'error', $2) ON CONFLICT (product_id) DO UPDATE SET status='error', why=EXCLUDED.why, created_at=now()`, [id, msg.slice(0, 300)]);
    }
    await new Promise((r) => setTimeout(r, 4000)); // Google's free plan: a few a minute
  }
  // errors are tried again after a day
  await db.q(`DELETE FROM title_fix WHERE status='error' AND created_at < now() - interval '1 day'`);
  return { done };
}

export async function counts(): Promise<Record<string, number> & { left: number; total: number }> {
  const rows = await db.q<{ status: string; n: number }>(`SELECT status, count(*)::int AS n FROM title_fix GROUP BY status`);
  const total = (await db.one<{ n: number }>(`SELECT count(*)::int AS n FROM products WHERE parent_id IS NULL AND active`))?.n || 0;
  const c: Record<string, number> = Object.fromEntries(rows.map((r) => [r.status, r.n]));
  const seen = rows.reduce((a, r) => a + r.n, 0);
  return { ...c, total, left: Math.max(0, total - seen) } as Record<string, number> & { left: number; total: number };
}
