// ✍️ Own words (owner, 2026-11-28). Most products came from other shops (Udvabony, creativetrade, স্বপ্ন সেল, …)
// with those shops' descriptions word for word. Google shows only one copy of the same text — the other shop's — so
// these pages hardly ever appear in search. Two jobs make each product the shop's own:
//
//  1. rewrite(): with the owner's free Gemini key, the description (and the short description) is written again in
//     the shop's own words — same facts, same language, nothing added. It goes in by itself only when a strict check
//     passes (factsProblem): every number and model code in the new text was already in the old text or the name,
//     almost all of the old numbers are still there, the product's own model codes are named, the text really is
//     reworded (few 5-word runs shared with the old one), no HTML / links / shop names. Anything else waits for the
//     owner (Admin → Products → ✍️ Own words). The old text is kept for ↩️ undo.
//     Order: products Google can show first (in stock, best sellers, most wished-for); copied products that are out
//     of stock are kept out of Google anyway (catalog COPIED_OUT_SQL), so they come last.
//  2. cleanShopNames(): another shop's name in a product's name or link ("… Shopno Sale", "… udvabony bd") is taken
//     out; a changed link keeps working (301 to the new one, catalog.addRedirect). Logged in shopname_fix for undo.
//
// Only copied products are touched (import_ref from another shop); the old shobmilbe.com products are the owner's own.
// Pictures need nothing here: ImageKit already sends every picture without its hidden data (camera, software, other
// shop), under the shop's own file names (checked 2026-11-28).
import * as db from '../db';
import * as cache from '../cache';
import { tx } from '../db';
import { slugify } from '../util';
import { partCodes, squash } from '../data/titlecheck';
import { sourceNames } from '../models/descclean';
import * as catalog from '../models/catalog';
import type { Settings } from '../types';

const MODELS = ['gemini-flash-latest', 'gemini-flash-lite-latest'];
const URL_OF = (m: string) => `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`;

export type OwnProposal = { short_description: string; description: string };
export type OwnOld = { short_description: string; description: string };

// ---------------------------------------------------------------- other shops' names
/** Names a copied product's own source shop goes by, plus the shops the owner copied from (2026-11-16 … 11-28). */
const KNOWN: string[] = ['shopno ?sale', 'shopno ?s(?=\\s*$)', 'স্বপ্ন ?সেল', 'udvabony(?:[ -]?bd)?', 'উদ্ভাবনী', 'creative ?trade', 'electro ?x ?bd', 'electrox'];
const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** the source shop's name parts: "daraz.com.bd/udvabony-bd#123" → ["udvabony"]; "electrox.com.bd#9" → ["electrox", …] */
export function shopWords(importRef: string): string[] {
  const ref = String(importRef || '').split('#')[0].toLowerCase();
  if (!ref || ref === 'file' || ref.startsWith('shobmilbe.com')) return [];
  const [host, store] = ref.split('/');
  if (/daraz\./.test(host)) {
    const s = String(store || '').replace(/[-_]?bd$/, '').replace(/[-_]+/g, ' ').trim();
    return s.length >= 4 ? [escRe(s).replace(/ /g, '[ -]?')] : [];
  }
  // marketplaces' names are product words too ("Cartup packaging poly", "Daraz packaging box"): never taken out
  if (MARKETPLACES.test(host)) return [];
  return sourceNames(host).filter((n) => n.length >= 5 && !/\./.test(n) && !MARKETPLACES.test(n));
}
const MARKETPLACES = /daraz|cartup|cart-up|othoba|evaly|pickaboo|chaldal|ajkerdeal|bikroy|alibaba|aliexpress|amazon|flipkart|meesho|shopee|lazada|temu/i;

/** a product name without another shop's name in it ('' left alone = nothing to change) */
export function stripShopName(name: string, importRef = ''): string {
  const words = [...KNOWN, ...shopWords(importRef)];
  if (!words.length) return name;
  const re = new RegExp(`[\\s(\\[|,–-]*(?:\\b(?:by|from)\\s+)?(?:${words.join('|')})(?:\\s*(?:bd|shop|store|sale))?\\b[\\s)\\]|,–-]*`, 'giu');
  const out = String(name || '').replace(re, ' ').replace(/\s*\/\s*\/\s*/g, '/').replace(/\s{2,}/g, ' ').replace(/^[\s|,–-]+|[\s|,–-]+$/g, '').trim();
  return out.length >= 4 ? out : name;
}

/** Take other shops' names out of product names and links. Returns how many changed. */
export async function cleanShopNames(limit = 200): Promise<number> {
  const rows = await db.q<{ id: number; name: string; slug: string; import_ref: string }>(`SELECT id, name, slug, coalesce(import_ref, '') AS import_ref FROM products p
    WHERE NOT EXISTS (SELECT 1 FROM shopname_fix f WHERE f.product_id = p.id)
      AND (p.name ~* $1 OR p.slug ~* $2 OR (coalesce(p.import_ref, '') <> '' AND split_part(p.import_ref, '#', 1) <> 'shobmilbe.com'))
    ORDER BY id LIMIT $3`, [KNOWN.join('|'), 'shopno|udvabony|creativetrade|electrox', limit * 5]);
  let changed = 0;
  for (const r of rows) {
    const name = stripShopName(r.name, r.import_ref);
    const fromSlug = stripShopName(r.slug.replace(/-/g, ' '), r.import_ref);
    const wantSlug = slugify(name !== r.name ? name : fromSlug);
    const slugChanged = wantSlug && wantSlug !== 'item' && wantSlug !== r.slug && (name !== r.name || fromSlug !== r.slug.replace(/-/g, ' '));
    if (name === r.name && !slugChanged) {
      // looked at, nothing to change: remembered so it isn't read again
      await db.q(`INSERT INTO shopname_fix(product_id, old_name, old_slug, new_name, new_slug, undone) VALUES($1,$2,$3,$2,$3,true) ON CONFLICT DO NOTHING`, [r.id, r.name, r.slug]);
      continue;
    }
    await tx(async (t) => {
      let slug = r.slug;
      if (slugChanged) {
        slug = await db.uniqueSlug('products', wantSlug, r.id);
        if (slug !== r.slug) {
          await t.query('UPDATE products SET slug=$1 WHERE id=$2', [slug, r.id]);
          await catalog.addRedirect(t, '/p/' + r.slug, '/p/' + slug);
        }
      }
      if (name !== r.name) await t.query('UPDATE products SET name=$1, seo_title=CASE WHEN seo_title ~* $3 THEN \'\' ELSE seo_title END, updated_at=now() WHERE id=$2', [name, r.id, KNOWN.join('|')]);
      await t.query(`INSERT INTO shopname_fix(product_id, old_name, old_slug, new_name, new_slug) VALUES($1,$2,$3,$4,$5)
        ON CONFLICT (product_id) DO UPDATE SET old_name=EXCLUDED.old_name, old_slug=EXCLUDED.old_slug, new_name=EXCLUDED.new_name, new_slug=EXCLUDED.new_slug, undone=false, created_at=now()`,
      [r.id, r.name, r.slug, name, slug]);
    });
    changed++;
    if (changed >= limit) break;
  }
  if (changed) cache.clearAll();
  return changed;
}

// ---------------------------------------------------------------- the rewrite
const plain = (s: string, n: number) => String(s || '').replace(/<[^>]*>/g, ' ').replace(/[ \t]+/g, ' ').trim().slice(0, n);
const BN_DIGITS = '০১২৩৪৫৬৭৮৯';
const ascii = (s: string) => String(s || '').replace(/[০-৯]/g, (d) => String(BN_DIGITS.indexOf(d)));
const isBangla = (s: string) => { const t = String(s || ''); const bn = (t.match(/[ঀ-৿]/g) || []).length; const en = (t.match(/[A-Za-z]/g) || []).length; return bn > en; };

/** the numbers in a text ("3.3V", "১০০০mAh", "2x" → "3.3", "1000", "2") */
export function numbersIn(text: string): string[] {
  return (ascii(text).match(/\d+(?:[.,]\d+)?/g) || []).map((n) => n.replace(',', '.').replace(/^0+(?=\d)/, ''));
}
/** share of the new text's 5-word runs that are copied from the old text (0 = all new words, 1 = the same text) */
export function copiedShare(oldText: string, newText: string): number {
  const w = (s: string) => ascii(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(' ').filter(Boolean);
  const grams = (a: string[]) => { const g = new Set<string>(); for (let i = 0; i + 5 <= a.length; i++) g.add(a.slice(i, i + 5).join(' ')); return g; };
  const o = grams(w(oldText)); const n = grams(w(newText));
  if (!n.size) return 0;
  let same = 0; for (const g of n) if (o.has(g)) same++;
  return same / n.size;
}

/** Why the new text can't go in by itself ([] = safe): facts kept, nothing invented, really reworded, clean. */
export function factsProblem(name: string, old: OwnOld, prop: OwnProposal): string[] {
  const why: string[] = [];
  const oldAll = `${old.short_description}\n${old.description}`;
  const newAll = `${prop.short_description}\n${prop.description}`;
  if (prop.description.length < Math.min(120, old.description.length * 0.6) || prop.description.length > Math.max(3500, old.description.length * 1.6)) why.push('length looks wrong');
  if (old.short_description.trim().length >= 20 && prop.short_description.trim().length < 20) why.push('short description missing');
  // nothing invented: every number in the new text was in the old text or the name
  const known = new Set([...numbersIn(oldAll), ...numbersIn(name)]);
  const added = [...new Set(numbersIn(newAll).filter((n) => !known.has(n)))];
  if (added.length) why.push(`new numbers: ${added.slice(0, 5).join(', ')}`);
  // nothing lost: (almost) every number of the old text is still there
  const have = new Set(numbersIn(newAll));
  const oldNums = [...new Set(numbersIn(oldAll))];
  const lost = oldNums.filter((n) => !have.has(n));
  if (lost.length > Math.max(1, Math.floor(oldNums.length * 0.1))) why.push(`numbers left out: ${lost.slice(0, 5).join(', ')}`);
  // model codes: the product's own are named, no other part's code appears
  const sq = squash(newAll);
  const codes = partCodes(name);
  if (codes.length && !codes.some((c) => sq.includes(c))) why.push(`model code missing: ${codes.join(', ')}`);
  const knownSq = squash(`${name} ${oldAll}`);
  const foreign = partCodes(newAll).filter((c) => !knownSq.includes(c));
  if (foreign.length) why.push(`other model codes: ${foreign.slice(0, 4).join(', ')}`);
  // really reworded
  const share = copiedShare(oldAll, newAll);
  if (share > 0.3) why.push(`still ${Math.round(share * 100)}% the old wording`);
  // clean: no HTML, links, phone numbers or shop names
  if (/<[a-z]|https?:\/\/|www\.|\[[^\]]+\]\(/i.test(newAll)) why.push('HTML or a link');
  if (/(?:\+?88)?0 ?1[3-9]\d{2}[ -]?\d{6}/.test(ascii(newAll))) why.push('a phone number');
  if (new RegExp(KNOWN.join('|'), 'iu').test(newAll)) why.push('a shop name');
  if (isBangla(old.description) !== isBangla(prop.description) && old.description.length > 80) why.push('language changed');
  return why;
}

function prompt(name: string, old: OwnOld) {
  const bn = isBangla(old.description);
  return `You rewrite product descriptions for "Shobmilbe" (সবমিলবে), a Bangladeshi online shop. This text was copied from another shop, so it must be rewritten completely in our own words.

Product name: ${name}
Current short description:
"""
${old.short_description || '(none)'}
"""
Current description:
"""
${old.description}
"""

Rules:
- Write in ${bn ? 'Bangla (Bangladesh), natural and simple; keep model codes, units and technical terms as they are' : 'clear, simple English'} — the same language as the current description.
- Keep EVERY fact exactly: every number, unit, model code, size, colour, material, compatibility and package content. Do not round or convert numbers.
- Add NOTHING that is not in the current text: no new specs, no claims ("original", "best quality", "warranty"), no prices, no delivery or shop talk, no shop names, no links, no phone numbers.
- Change the wording and sentence order so it is clearly new writing, not a light edit. Lists may become sentences and the other way round.
- Format the description as plain text with Markdown only: short paragraphs, "## " headings and "- " list lines are fine. No HTML, no bold markers.
- short_description: 1–2 sentences of what it is and what it is for${old.short_description ? ', using only facts above' : ' — "" if the current one is "(none)"'}.

Answer with JSON only: {"short_description": "", "description": ""}`;
}

async function ask(key: string, name: string, old: OwnOld): Promise<{ prop: OwnProposal; model: string }> {
  let last = 'Gemini';
  for (const m of MODELS) {
    const r = await fetch(URL_OF(m), {
      method: 'POST', signal: AbortSignal.timeout(90000),
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt(name, old) }] }], generationConfig: { temperature: 0.7, maxOutputTokens: 4096, responseMimeType: 'application/json' } }),
    }).catch((e) => { last = (e as Error).message; return null; });
    if (!r) continue;
    const j = (await r.json().catch(() => ({}))) as { candidates?: { content?: { parts?: { text?: string }[] } }[]; error?: { message?: string } };
    if (!r.ok) { last = j.error?.message || `Gemini ${r.status}`; if ([404, 429, 500, 503].includes(r.status)) continue; throw new Error(last); }
    const text = (j.candidates?.[0]?.content?.parts || []).map((x) => x.text || '').join('').trim();
    try {
      const o = JSON.parse(text.replace(/^```(?:json)?|```$/g, '')) as Partial<OwnProposal>;
      const tidy = (s: unknown, n: number) => String(s || '').replace(/[​﻿]/g, '').replace(/\r/g, '').replace(/\*\*/g, '').trim().slice(0, n);
      return { model: m, prop: { short_description: tidy(o.short_description, 600), description: tidy(o.description, 5000) } };
    } catch { last = 'could not read Gemini’s answer'; }
  }
  throw new Error(/quota|exhaust|rate|429/i.test(last) ? 'busy' : last);
}

export async function rewriteOne(settings: Settings, id: number): Promise<string> {
  const p = await db.one<{ id: number; name: string; description: string; short_description: string }>(`SELECT id, name, coalesce(description, '') AS description,
    coalesce(short_description, '') AS short_description FROM products WHERE id=$1`, [id]);
  if (!p) return 'gone';
  const old: OwnOld = { description: plain(p.description, 4000), short_description: plain(p.short_description, 600) };
  const key = String(settings.ai_gemini_key || '').trim();
  let { prop, model } = await ask(key, p.name, old);
  let why = factsProblem(p.name, old, prop);
  // one more try when it only stayed too close to the old wording
  if (why.length === 1 && /old wording/.test(why[0])) {
    const again = await ask(key, p.name, old);
    const why2 = factsProblem(p.name, old, again.prop);
    if (why2.length < why.length || !why2.length) { prop = again.prop; model = again.model; why = why2; }
  }
  let status = 'review';
  if (!why.length && settings.ownwords_auto !== '0') {
    await db.q(`UPDATE products SET description=$2, short_description=CASE WHEN $3 <> '' THEN $3 ELSE short_description END, updated_at=now() WHERE id=$1`,
      [id, prop.description, prop.short_description]);
    cache.clearAll();
    status = 'applied';
  }
  await db.q(`INSERT INTO own_words(product_id, status, old, proposal, why, model, applied_at) VALUES($1,$2,$3,$4,$5,$6,$7)
    ON CONFLICT (product_id) DO UPDATE SET status=EXCLUDED.status, old=EXCLUDED.old, proposal=EXCLUDED.proposal, why=EXCLUDED.why, model=EXCLUDED.model, applied_at=EXCLUDED.applied_at, created_at=now()`,
  [id, status, JSON.stringify({ description: p.description, short_description: p.short_description }), JSON.stringify(prop), why.join(' · ').slice(0, 500), model, status === 'applied' ? new Date() : null]);
  return status;
}

export async function approve(id: number): Promise<boolean> {
  const r = await db.one<{ proposal: OwnProposal }>(`SELECT proposal FROM own_words WHERE product_id=$1 AND status='review'`, [id]);
  if (!r || !r.proposal?.description) return false;
  const p = await db.one<{ description: string; short_description: string }>(`SELECT coalesce(description, '') AS description, coalesce(short_description, '') AS short_description FROM products WHERE id=$1`, [id]);
  if (!p) return false;
  await db.q(`UPDATE products SET description=$2, short_description=CASE WHEN $3 <> '' THEN $3 ELSE short_description END, updated_at=now() WHERE id=$1`, [id, r.proposal.description, r.proposal.short_description || '']);
  await db.q(`UPDATE own_words SET status='applied', old=$2, applied_at=now() WHERE product_id=$1`, [id, JSON.stringify(p)]);
  cache.clearAll();
  return true;
}
export async function skip(id: number): Promise<void> { await db.q(`UPDATE own_words SET status='skipped' WHERE product_id=$1 AND status='review'`, [id]); }
export async function undo(id: number): Promise<boolean> {
  const r = await db.one<{ old: OwnOld | null }>(`SELECT old FROM own_words WHERE product_id=$1 AND status='applied'`, [id]);
  if (!r || !r.old) return false;
  await db.q('UPDATE products SET description=$2, short_description=$3, updated_at=now() WHERE id=$1', [id, r.old.description || '', r.old.short_description || '']);
  await db.q(`UPDATE own_words SET status='undone' WHERE product_id=$1`, [id]);
  cache.clearAll();
  return true;
}
export async function undoName(id: number): Promise<boolean> {
  const r = await db.one<{ old_name: string; old_slug: string; new_name: string; new_slug: string }>(`SELECT old_name, old_slug, new_name, new_slug FROM shopname_fix WHERE product_id=$1 AND NOT undone`, [id]);
  if (!r) return false;
  await tx(async (t) => {
    await t.query('UPDATE products SET name=$2, updated_at=now() WHERE id=$1', [id, r.old_name]);
    if (r.old_slug !== r.new_slug) {
      await t.query('DELETE FROM redirects WHERE from_path=$1', ['/p/' + r.old_slug]);
      await t.query('UPDATE products SET slug=$2 WHERE id=$1', [id, r.old_slug]);
      await catalog.addRedirect(t, '/p/' + r.new_slug, '/p/' + r.old_slug);
    }
    await t.query('UPDATE shopname_fix SET undone=true WHERE product_id=$1', [id]);
  });
  cache.clearAll();
  return true;
}

/** copied products not yet rewritten: the ones Google can show first */
async function nextIds(n: number): Promise<number[]> {
  const rows = await db.q<{ id: number }>(`SELECT p.id FROM products p
    WHERE p.parent_id IS NULL AND p.active AND coalesce(p.import_ref, '') <> '' AND split_part(p.import_ref, '#', 1) NOT IN ('shobmilbe.com', 'file')
      AND length(coalesce(p.description, '')) >= 80
      AND NOT EXISTS (SELECT 1 FROM own_words w WHERE w.product_id = p.id)
      AND NOT EXISTS (SELECT 1 FROM desc_fix f WHERE f.product_id = p.id AND f.status = 'applied')
    ORDER BY ${catalog.COPIED_OUT_SQL} ASC, coalesce(p.sold_count, 0) DESC, coalesce(p.wish_count, 0) DESC, p.id LIMIT $1`, [n]);
  return rows.map((r) => r.id);
}

export async function tick(settings: Settings): Promise<{ done: number; names?: number; status?: string }> {
  if (settings.ownwords_on === '0') return { done: 0, status: 'off' };
  const names = await cleanShopNames(100).catch(() => 0);
  if (!String(settings.ai_gemini_key || '').trim()) return { done: 0, names, status: 'nokey' };
  // shares Google's free daily allowance with the name fix and the description check, which go first
  const now = Date.now();
  if (now < (Number(settings.titlefix_pause_until) || 0) || now < (Number(settings.descfix_pause_until) || 0) || now < (Number(settings.ownwords_pause_until) || 0)) return { done: 0, names, status: 'paused' };
  let done = 0;
  for (const id of await nextIds(Math.min(10, Math.max(1, Number(settings.ownwords_per_tick) || 3)))) {
    try { await rewriteOne(settings, id); done++; } catch (e) {
      const msg = (e as Error).message;
      if (msg === 'busy') { await db.setMany({ ownwords_pause_until: String(Date.now() + 30 * 60e3) }); return { done, names, status: 'busy' }; }
      await db.q(`INSERT INTO own_words(product_id, status, why) VALUES($1, 'error', $2) ON CONFLICT (product_id) DO UPDATE SET status='error', why=EXCLUDED.why, created_at=now()`, [id, msg.slice(0, 300)]);
    }
    await new Promise((r) => setTimeout(r, 4000));
  }
  await db.q(`DELETE FROM own_words WHERE status='error' AND created_at < now() - interval '1 day'`);
  return { done, names };
}

export async function counts(): Promise<Record<string, number>> {
  const [rows, left, names] = await Promise.all([
    db.q<{ status: string; n: number }>(`SELECT status, count(*)::int AS n FROM own_words GROUP BY status`),
    db.one<{ n: number }>(`SELECT count(*)::int AS n FROM products p WHERE p.parent_id IS NULL AND p.active AND coalesce(p.import_ref, '') <> ''
      AND split_part(p.import_ref, '#', 1) NOT IN ('shobmilbe.com', 'file') AND length(coalesce(p.description, '')) >= 80
      AND NOT EXISTS (SELECT 1 FROM own_words w WHERE w.product_id = p.id) AND NOT EXISTS (SELECT 1 FROM desc_fix f WHERE f.product_id = p.id AND f.status = 'applied')`),
    db.one<{ n: number }>(`SELECT count(*)::int AS n FROM shopname_fix WHERE NOT undone`),
  ]);
  return { ...Object.fromEntries(rows.map((r) => [r.status, r.n])), left: left?.n || 0, names: names?.n || 0 };
}
