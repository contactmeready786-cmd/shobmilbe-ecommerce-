// 🧹 বিবরণ নিজে নিজে পরিষ্কার (owner, 2026-11-14: "I can't go through all this by hand — fix it automatically").
// Round the clock, a few dozen products at a time, every product's description and short description go through the
// same cleaner as Admin → "বিবরণ থেকে অন্য দোকানের লেখা সরানো" (lib/models/descclean.ts): the copied shop's own
// part (FAQ, delivery / return rules, "why buy from us", "কেনার আগে জেনে নিন", contact details, web links) goes, and
// list marks standing alone on their own lines are joined to their text again. Only the product's own text stays.
// Every change is written in desc_clean_log first, so the owner sees it on that page and can undo it (kept 7 days).
// After the last product the round starts again a week later (new imports and AI texts are cleaned when made).
import * as db from '../db';
import { clean } from '../models/descclean';

const KEY = 'desc_auto_cursor';
const AGAIN_DAYS = 7;

/** "-\n\n**Power:** 5V" → "- **Power:** 5V"; three or more empty lines → one */
export function tidyLists(text: string): string {
  return String(text || '').replace(/\r/g, '')
    .replace(/^[ \t]*([-•*]|\d+[.)])[ \t]*\n(?:[ \t]*\n)*[ \t]*(?=\S)/gm, '$1 ')
    .replace(/^[ \t]*[-•*][ \t]*$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
// ⚙️ owner, 2026-11-14: "my products have no specification part — only the short and long description. Wherever it
// says specification, remove that information." A part that starts with a "Specification(s)" / "স্পেসিফিকেশন" heading
// (a ## heading, a bold line, or a line of its own, maybe ending with ":") goes, up to the next heading.
const SPEC_HEAD = /^\s*(?:#{1,6}\s*)?(?:\*\*)?\s*(?:[⚙️🔧📋✅•*-]\s*)*(?:technical\s+|product\s+|key\s+)?(?:specifications?|specs?|টেকনিক্যাল\s+স্পেসিফিকেশন|স্পেসিফিকেশন(?:\s+এক\s+নজরে)?|স্পেসিফিকেশনস)\s*(?:\*\*)?\s*[:：]?\s*(?:\*\*)?\s*$/iu;
const ANY_HEAD = /^\s*(?:#{1,6}\s+\S|\*\*[^*]{2,80}\*\*\s*[:：]?\s*$)/;
export function removeSpecs(text: string): string {
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  const out: string[] = [];
  let skipping = false;
  for (const line of lines) {
    if (SPEC_HEAD.test(line)) { skipping = true; continue; }
    if (skipping && ANY_HEAD.test(line) && !SPEC_HEAD.test(line)) skipping = false;
    if (!skipping) out.push(line);
  }
  // "স্পেসিফিকেশন: …" written inside one line ("স্পেসিফিকেশন • ধরন: …")
  return out.join('\n').replace(/[ \t]*(?:স্পেসিফিকেশন|specifications?)\s*[•:：][^\n]*/giu, '').replace(/\n{3,}/g, '\n\n').trim();
}

/** the whole clean-up for one text: no specification part, the cleaner, then the lists */
export function productOnly(text: string, host = ''): string {
  const c = clean(removeSpecs(text), host);
  return tidyLists(c.text);
}

/** once (owner, 2026-11-14): every product's "specifications" list is taken off (kept in seo_auto_log as
 *  'specs_removed', so it can be brought back), the specification tab is switched off and Auto SEO adds no new ones */
export async function removeAllSpecs(): Promise<number> {
  const done = await db.one<{ value: string }>(`SELECT value FROM settings WHERE key='specs_removed_v1'`);
  if (done) return 0;
  const n = await db.tx(async (t) => {
    await t.query(`INSERT INTO seo_auto_log(product_id, field, old_value, new_value)
      SELECT id, 'specs_removed', specs::text, '[]' FROM products WHERE specs IS NOT NULL AND specs::text NOT IN ('[]', 'null', '')`);
    const r = await t.query(`UPDATE products SET specs='[]'::jsonb WHERE specs IS NOT NULL AND specs::text NOT IN ('[]', 'null', '')`);
    for (const [k, v] of [['autoseo_specs', '0'], ['ui_pdp_specs', '0'], ['specs_removed_v1', String(Date.now())]]) {
      await t.query(`INSERT INTO settings(key, value) VALUES($1, $2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value`, [k, v]);
    }
    return r.rowCount;
  });
  await db.q(`DELETE FROM settings WHERE key='desc_auto_cursor'`); // the descriptions get one more full round
  return n;
}

export async function sweep(per = 40): Promise<number> {
  const cur = await db.one<{ value: string }>(`SELECT value FROM settings WHERE key=$1`, [KEY]);
  const v = String(cur ? cur.value : '0');
  if (v.startsWith('done:')) {
    if (Date.now() - Number(v.slice(5)) < AGAIN_DAYS * 864e5) return 0;
  }
  const from = v.startsWith('done:') ? 0 : Number(v) || 0;
  const rows = await db.q<{ id: number; description: string; short_description: string; host: string }>(`SELECT p.id, coalesce(p.description, '') AS description,
      coalesce(p.short_description, '') AS short_description, split_part(coalesce(p.import_ref, ''), '#', 1) AS host
    FROM products p WHERE p.parent_id IS NULL AND p.id > $1 ORDER BY p.id LIMIT $2`, [from, per]);
  let n = 0;
  for (const r of rows) {
    const host = r.host === 'file' ? '' : r.host;
    // the specification part always goes (the owner asked); the other clean-up only when it leaves enough text
    const bd = removeSpecs(r.description), bs = removeSpecs(r.short_description);
    let d = productOnly(bd, host), s = productOnly(bs, host);
    if (bd.trim() && d.length < bd.trim().length * 0.3) d = tidyLists(bd);
    if (bs.trim() && !s.trim()) s = tidyLists(bs);
    const same = (a: string, b: string) => a.replace(/\s+/g, '') === b.replace(/\s+/g, '');
    if (same(d, r.description) && same(s, r.short_description)) continue;
    await db.tx(async (t) => {
      await t.query(`INSERT INTO desc_clean_log(product_id, before, after, removed, by_user) VALUES($1, $2, $3, $4, NULL)`,
        [r.id, JSON.stringify({ d: r.description, s: r.short_description }), JSON.stringify({ d, s }), 1]);
      await t.query('UPDATE products SET description=$2, short_description=$3, updated_at=now() WHERE id=$1', [r.id, d, s]);
    });
    n++;
  }
  const next = rows.length < per ? `done:${Date.now()}` : String(rows[rows.length - 1].id);
  await db.q(`INSERT INTO settings(key, value) VALUES($1, $2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value`, [KEY, next]);
  return n;
}
