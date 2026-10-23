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
