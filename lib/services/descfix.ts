// 📋 বিবরণ যাচাই (AI) — owner, 2026-11-28. Many electronics descriptions were copied from ANOTHER part (TIP122 had
// TIP31C's specs, IRF5210 had IRF4905's, 2SA1013 had a 2SC1015 sheet). With the owner's free Gemini key each
// product with a part / model number is checked once: does the description belong to this part, and do its specs
// match the part's datasheet? If not, Gemini writes a corrected description.
//
// Safety: it goes in by itself only when Gemini is sure of the datasheet, the new text names the same part code(s)
// and has no part code the product doesn't have; anything else waits for the owner (Admin → পণ্য → 📋 বিবরণ যাচাই).
// The old description is kept for ↩️. Runs a few products every 5 minutes after the name fix (lib/api/files.ts).
import * as db from '../db';
import * as cache from '../cache';
import { partCodes, squash } from '../data/titlecheck';
import type { Settings } from '../types';

const MODELS = ['gemini-flash-latest', 'gemini-flash-lite-latest'];
const URL_OF = (m: string) => `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`;

export type DescProposal = { about_this_part: 'yes' | 'no' | 'partly'; wrong: string[]; sure: boolean; description: string };

const plain = (s: string, n: number) => String(s || '').replace(/<[^>]*>/g, ' ').replace(/[ \t]+/g, ' ').trim().slice(0, n);

function prompt(name: string, desc: string) {
  return `You check product descriptions for "Shobmilbe", a Bangladeshi electronics-parts shop. Many descriptions were copied from a DIFFERENT part by mistake.

Product title: ${name}
Current description:
"""
${desc || '(empty)'}
"""

1. "about_this_part": does the description describe this exact part/model? "yes", "partly" (some of it is about another part), or "no".
2. "wrong": list every spec in the description that disagrees with the real datasheet of this part (e.g. "Ic is 3A in text, datasheet says 5A"; "describes TIP31C, not TIP122"). Empty list if all correct.
3. "sure": true only if this is a well-known part whose datasheet you know with certainty. For unbranded modules, gadgets or anything you are not certain about, false.
4. "description": only when "wrong" is not empty or "about_this_part" is not "yes": a corrected plain-text English description in this format — one or two sentences on what the part is and what it is used for, then "Specifications:" with "- " lines (only datasheet values you are certain of: type/polarity, main voltage, current, power, gain or other key ratings, package and pinout if well known), then "Package includes: 1 x <part>". No HTML, no Markdown, no prices, no shop names, no claims like "original". Otherwise "".

Answer with JSON only: {"about_this_part": "yes|partly|no", "wrong": [], "sure": false, "description": ""}`;
}

async function ask(key: string, name: string, desc: string): Promise<{ prop: DescProposal; model: string }> {
  let last = 'Gemini';
  for (const m of MODELS) {
    const r = await fetch(URL_OF(m), {
      method: 'POST', signal: AbortSignal.timeout(60000),
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt(name, desc) }] }], generationConfig: { temperature: 0.1, maxOutputTokens: 2048, responseMimeType: 'application/json' } }),
    }).catch((e) => { last = (e as Error).message; return null; });
    if (!r) continue;
    const j = (await r.json().catch(() => ({}))) as { candidates?: { content?: { parts?: { text?: string }[] } }[]; error?: { message?: string } };
    if (!r.ok) { last = j.error?.message || `Gemini ${r.status}`; if ([404, 429, 500, 503].includes(r.status)) continue; throw new Error(last); }
    const text = (j.candidates?.[0]?.content?.parts || []).map((x) => x.text || '').join('').trim();
    try {
      const o = JSON.parse(text.replace(/^```(?:json)?|```$/g, '')) as Partial<DescProposal>;
      return { model: m, prop: {
        about_this_part: o.about_this_part === 'no' || o.about_this_part === 'partly' ? o.about_this_part : 'yes',
        wrong: Array.isArray(o.wrong) ? o.wrong.map((x) => String(x).slice(0, 200)).slice(0, 8) : [],
        sure: o.sure === true,
        description: String(o.description || '').replace(/[​﻿]/g, '').replace(/\r/g, '').trim().slice(0, 3000),
      } };
    } catch { last = 'Gemini-র উত্তর পড়া যায়নি'; }
  }
  throw new Error(/quota|exhaust|rate|429/i.test(last) ? 'busy' : last);
}

/** the corrected text is safe to put in by itself: same part codes, nothing from another part, a sensible length */
export function descOk(name: string, text: string): string[] {
  const why: string[] = [];
  if (text.length < 120 || text.length > 2500) why.push('লেখার মাপ ঠিক নেই');
  const have = squash(text);
  const codes = partCodes(name);
  if (!codes.length) why.push('নামে মডেল নম্বর নেই');
  const missing = codes.filter((c) => !have.includes(c));
  if (codes.length && missing.length === codes.length) why.push(`মডেল নম্বর নেই: ${codes.join(', ')}`);
  const known = squash(name);
  const foreign = partCodes(text.replace(/Specifications:|Package includes:/g, ' ')).filter((c) => !known.includes(c) && !/^(TO|SOT|DIP|SOP|SOIC|DO|SMA|SMB|SMC|QFN|TQFP|LQFP)\d/.test(c));
  if (foreign.length > 2) why.push(`অন্য মডেলের নাম: ${foreign.slice(0, 4).join(', ')}`);
  if (/<[a-z]|\*\*|#{1,3} /i.test(text)) why.push('HTML বা Markdown আছে');
  return why;
}

export async function checkOne(settings: Settings, id: number): Promise<string> {
  const p = await db.one<{ id: number; name: string; description: string }>('SELECT id, name, coalesce(description, \'\') AS description FROM products WHERE id=$1', [id]);
  if (!p) return 'gone';
  const { prop, model } = await ask(String(settings.ai_gemini_key || '').trim(), p.name, plain(p.description, 2500));
  const bad = prop.wrong.length > 0 || prop.about_this_part !== 'yes';
  let status = 'ok';
  let why: string[] = [];
  let old: string | null = null;
  if (bad) {
    why = prop.description ? descOk(p.name, prop.description) : ['Gemini নতুন বিবরণ লেখেনি'];
    if (!prop.sure) why.unshift('Gemini ডেটাশিট নিয়ে নিশ্চিত নয়');
    if (!why.length && settings.descfix_auto !== '0') {
      old = p.description;
      await db.q('UPDATE products SET description=$2, updated_at=now() WHERE id=$1', [id, prop.description]);
      cache.clearAll();
      status = 'applied';
    } else status = 'review';
  }
  await db.q(`INSERT INTO desc_fix(product_id, status, old, proposal, why, model, applied_at) VALUES($1,$2,$3,$4,$5,$6,$7)
    ON CONFLICT (product_id) DO UPDATE SET status=EXCLUDED.status, old=EXCLUDED.old, proposal=EXCLUDED.proposal, why=EXCLUDED.why, model=EXCLUDED.model, applied_at=EXCLUDED.applied_at, created_at=now()`,
  [id, status, old, JSON.stringify(prop), why.join(' · ').slice(0, 500), model, status === 'applied' ? new Date() : null]);
  return status;
}

export async function approve(id: number): Promise<boolean> {
  const r = await db.one<{ proposal: DescProposal }>(`SELECT proposal FROM desc_fix WHERE product_id=$1 AND status='review'`, [id]);
  if (!r || !r.proposal.description) return false;
  const p = await db.one<{ description: string }>('SELECT coalesce(description, \'\') AS description FROM products WHERE id=$1', [id]);
  if (!p) return false;
  await db.q('UPDATE products SET description=$2, updated_at=now() WHERE id=$1', [id, r.proposal.description]);
  await db.q(`UPDATE desc_fix SET status='applied', old=$2, applied_at=now() WHERE product_id=$1`, [id, p.description]);
  cache.clearAll();
  return true;
}
export async function skip(id: number): Promise<void> { await db.q(`UPDATE desc_fix SET status='skipped' WHERE product_id=$1 AND status='review'`, [id]); }
export async function undo(id: number): Promise<boolean> {
  const r = await db.one<{ old: string | null }>(`SELECT old FROM desc_fix WHERE product_id=$1 AND status='applied'`, [id]);
  if (!r || r.old === null) return false;
  await db.q('UPDATE products SET description=$2, updated_at=now() WHERE id=$1', [id, r.old]);
  await db.q(`UPDATE desc_fix SET status='undone' WHERE product_id=$1`, [id]);
  cache.clearAll();
  return true;
}

/** products with a part / model number in the name (the ones a datasheet exists for), not yet checked */
async function nextIds(n: number): Promise<number[]> {
  const rows = await db.q<{ id: number; name: string }>(`SELECT p.id, p.name FROM products p WHERE p.parent_id IS NULL AND p.active
    AND p.name ~ '[A-Za-z]+-?[0-9]{2,}|[0-9]{3,}[A-Za-z]' AND NOT EXISTS (SELECT 1 FROM desc_fix f WHERE f.product_id = p.id)
    ORDER BY coalesce(p.sold_count, 0) DESC, p.id LIMIT $1`, [n * 3]);
  const out: number[] = [];
  for (const r of rows) {
    if (partCodes(r.name).length) out.push(r.id);
    else await db.q(`INSERT INTO desc_fix(product_id, status, why) VALUES($1, 'nocode', '') ON CONFLICT DO NOTHING`, [r.id]);
    if (out.length >= n) break;
  }
  return out;
}

export async function tick(settings: Settings): Promise<{ done: number; status?: string }> {
  if (settings.descfix_on === '0' || !String(settings.ai_gemini_key || '').trim()) return { done: 0, status: 'off' };
  // shares Google's free daily allowance with the name fix: that one goes first, this one uses what's left
  if (Date.now() < (Number(settings.titlefix_pause_until) || 0) || Date.now() < (Number(settings.descfix_pause_until) || 0)) return { done: 0, status: 'paused' };
  let done = 0;
  for (const id of await nextIds(Math.min(10, Math.max(1, Number(settings.descfix_per_tick) || 5)))) {
    try { await checkOne(settings, id); done++; } catch (e) {
      const msg = (e as Error).message;
      if (msg === 'busy') { await db.setMany({ descfix_pause_until: String(Date.now() + 30 * 60e3) }); return { done, status: 'busy' }; }
      await db.q(`INSERT INTO desc_fix(product_id, status, why) VALUES($1, 'error', $2) ON CONFLICT (product_id) DO UPDATE SET status='error', why=EXCLUDED.why, created_at=now()`, [id, msg.slice(0, 300)]);
    }
    await new Promise((r) => setTimeout(r, 4000));
  }
  await db.q(`DELETE FROM desc_fix WHERE status='error' AND created_at < now() - interval '1 day'`);
  return { done };
}

export async function counts(): Promise<Record<string, number>> {
  const rows = await db.q<{ status: string; n: number }>(`SELECT status, count(*)::int AS n FROM desc_fix GROUP BY status`);
  return Object.fromEntries(rows.map((r) => [r.status, r.n]));
}
