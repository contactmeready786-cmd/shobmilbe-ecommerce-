// 🧠 ছবি চেনা (owner, 2026-10-24): every product picture gets the picture-recognition AI's "description" —
// 384 numbers made in the admin's own browser (client/admin/recognize.ts, DINOv2 small, free, nothing leaves for
// another service). lib/models/duplicates.ts compares them, so the same product photographed by another shop, from
// another angle or on another background is found as a duplicate even under a different name.
import { q, one } from '../db';
import { int } from '../util';
import { EMB } from './duplicates';

/** 384 bytes from what the browser sends (base64), or null when it isn't one */
export function embFrom(v: unknown): Buffer | null {
  const s = typeof v === 'string' ? v : '';
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(s) || s.length > 600) return null;
  const b = Buffer.from(s, 'base64');
  return b.length === EMB ? b : null;
}
/** product pictures the AI hasn't seen yet (newest first) */
export async function waiting(limit = 24): Promise<number[]> {
  return (await q<{ id: number }>(`SELECT id FROM media WHERE owner_type='product' AND emb IS NULL ORDER BY id DESC LIMIT $1`, [limit])).map((r) => r.id);
}
export async function save(id: unknown, emb: unknown): Promise<boolean> {
  const b = embFrom(emb);
  if (!b || !int(id)) return false;
  await q('UPDATE media SET emb=$1 WHERE id=$2', [b, int(id)]);
  return true;
}
export async function progress(): Promise<{ total: number; done: number }> {
  const r = await one<{ total: number; done: number }>(`SELECT count(*)::int AS total, count(emb)::int AS done FROM media WHERE owner_type='product'`);
  return r || { total: 0, done: 0 };
}

// ☁️ The same AI on GitHub's computers (owner, 2026-10-24: "no load on my laptop or phone"; the browser way had
// described 0 of 2,582 pictures because it never runs on a phone). tools/whiten/cloud.py reads the list below from
// GET /api/whiten-jobs, describes each picture exactly as the browser does, and keeps the results in
// results/emb.json on the repository's `whiten-results` branch; the shop copies them in from there (never from a visitor).
/** pictures waiting for the AI, with an address the cloud computer can read them from */
export async function cloudWaiting(siteUrl: string, limit = 300): Promise<{ id: number; src: string }[]> {
  const base = String(siteUrl || '').replace(/\/+$/, '');
  const rows = await q<{ id: number; ik_url: string | null }>(`SELECT id, ik_url FROM media WHERE owner_type='product' AND emb IS NULL ORDER BY id DESC LIMIT $1`, [limit]);
  return rows.map((r) => ({ id: r.id, src: r.ik_url || `${base}/media/${r.id}?raw=1` }));
}
let lastImport = 0;
/** where the last copy-in stands (shown on the duplicates page; empty = fine) */
export let lastImportNote = '';
/** Is this the live shop? (the ids in the cloud's file are the live shop's pictures — a test copy has others) */
export const liveHost = (host: string) => /^(www\.)?shobmilbe\.com$/i.test(String(host || '').split(':')[0]);
/** copy the cloud AI's finished descriptions in (at most every 2 minutes per server unless forced); returns how many */
export async function importCloud(rawUrl: (path: string) => string, host: string, force = false): Promise<number> {
  if (!liveHost(host)) return 0;
  if (!force && Date.now() - lastImport < 120_000) return 0;
  lastImport = Date.now();
  let data: Record<string, string>;
  try {
    const r = await fetch(rawUrl(`results/emb.json?t=${Date.now()}`), { signal: AbortSignal.timeout(8000), cache: 'no-store' });
    if (!r.ok) { lastImportNote = `GitHub ${r.status}`; return 0; }
    data = (await r.json()) as Record<string, string>;
  } catch (e) { lastImportNote = (e as Error).message; return 0; }
  const ids: number[] = [], vals: string[] = [];
  for (const [k, v] of Object.entries(data || {})) {
    const id = int(k);
    // '' = the cloud couldn't read that picture: 384 zeros, so it is never asked again and never matches anything
    const b = v === '' ? Buffer.alloc(EMB) : embFrom(v);
    if (id > 0 && b) { ids.push(id); vals.push(b.toString('base64')); }
  }
  if (!ids.length) return 0;
  try {
    const done = await q<{ id: number }>(`UPDATE media SET emb = decode(v.emb, 'base64') FROM (SELECT unnest($1::int[]) AS id, unnest($2::text[]) AS emb) v
      WHERE media.id = v.id AND media.emb IS NULL AND media.owner_type='product' RETURNING media.id`, [ids, vals]);
    lastImportNote = '';
    return done.length;
  } catch (e) { lastImportNote = (e as Error).message; return 0; }
}
