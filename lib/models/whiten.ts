// ⬜ White background for chosen product pictures (owner, 2026-10-24). The picture is cut out by an AI that runs in
// the owner's own browser (client/admin/whiten.ts) and put on pure white; the owner sees before / after and keeps
// only the good ones. Nothing here runs by itself (the 2026-10-11 automatic version damaged pictures and was removed).
//
// Keeping one: the white copy is saved as a NEW picture (its own address — no phone, browser or CDN can keep
// showing the old one) and takes the original's place in the product, same position, cover picture too. The
// original is set aside as owner_type 'wb_orig' (same owner id), and the white copy's wb_from points to it.
// Undo puts the original back exactly where it was and removes the white copy.
import { q, one, tx } from '../db';
import { int } from '../util';
import * as catalog from './catalog';
import type { MediaRow } from '../data/rows';

export class WhitenError extends Error {}

/** Keep the white copy of product picture `mediaId`. Returns the new picture's id. */
export async function keep(mediaId: number, jpeg: Buffer, size: { width?: number; height?: number } = {}): Promise<number> {
  const m = await one<Pick<MediaRow, 'id' | 'owner_type' | 'owner_id' | 'sort' | 'wb_from'>>('SELECT id, owner_type, owner_id, sort, wb_from FROM media WHERE id=$1', [int(mediaId)]);
  if (!m || m.owner_type !== 'product' || !m.owner_id) throw new WhitenError('ছবিটা কোনো পণ্যের নয়।');
  // made white again: the new copy replaces the earlier white one, and still points to the real original
  const original = m.wb_from || m.id;
  const id = await catalog.saveMedia({ mime: 'image/jpeg', data: jpeg, width: size.width || null, height: size.height || null });
  await tx(async (t) => {
    const now = (await t.query<{ owner_type: string | null }>('SELECT owner_type FROM media WHERE id=$1 FOR UPDATE', [m.id])).rows[0];
    if (!now || now.owner_type !== 'product') throw new WhitenError('ছবিটা এর মধ্যে বদলে গেছে — পেজটা আবার খুলুন।');
    await t.query(`UPDATE media SET owner_type='product', owner_id=$1, sort=$2, wb_from=$3 WHERE id=$4`, [m.owner_id, m.sort, original, id]);
    await t.query('UPDATE products SET image_id=$1 WHERE image_id=$2', [id, m.id]);
    if (m.wb_from) await t.query('DELETE FROM media WHERE id=$1', [m.id]); // the earlier white copy
    else await t.query(`UPDATE media SET owner_type='wb_orig' WHERE id=$1`, [m.id]);
  });
  return id;
}

/** Put the original back in place of white copy `mediaId`. Returns the original's id. */
export async function undo(mediaId: number): Promise<number> {
  return tx(async (t) => {
    const w = (await t.query<Pick<MediaRow, 'id' | 'owner_type' | 'owner_id' | 'sort' | 'wb_from'>>('SELECT id, owner_type, owner_id, sort, wb_from FROM media WHERE id=$1 FOR UPDATE', [int(mediaId)])).rows[0];
    if (!w || w.owner_type !== 'product' || !w.wb_from) throw new WhitenError('এটা সাদা করা ছবি নয়।');
    const o = (await t.query<Pick<MediaRow, 'id' | 'owner_type'>>('SELECT id, owner_type FROM media WHERE id=$1 FOR UPDATE', [w.wb_from])).rows[0];
    if (!o || o.owner_type !== 'wb_orig') throw new WhitenError('আসল ছবিটা আর পাওয়া যাচ্ছে না।');
    await t.query(`UPDATE media SET owner_type='product', owner_id=$1, sort=$2 WHERE id=$3`, [w.owner_id, w.sort, o.id]);
    await t.query('UPDATE products SET image_id=$1 WHERE image_id=$2', [o.id, w.id]);
    await t.query('DELETE FROM media WHERE id=$1', [w.id]);
    return o.id;
  });
}

/** How far a shop's pictures are: all, already white. */
export async function progress(productIds: number[]): Promise<{ pics: number; white: number }> {
  if (!productIds.length) return { pics: 0, white: 0 };
  const r = await q<{ pics: number; white: number }>(`SELECT count(*)::int AS pics, count(*) FILTER (WHERE wb_from IS NOT NULL)::int AS white
    FROM media WHERE owner_type='product' AND owner_id = ANY($1::int[])`, [productIds]);
  return r[0] || { pics: 0, white: 0 };
}
