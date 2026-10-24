// ☁️ ব্যাকগ্রাউন্ড সাদা — অনলাইনে (owner, 2026-10-24: "the computer / phone must not do the work; it must be online").
// The big picture AI (BiRefNet) runs on GitHub's free cloud computers, never on the owner's laptop or phone:
//   1. the owner picks pictures → whiten_jobs rows ('queued')
//   2. .github/workflows/whiten-cloud.yml (every few minutes) asks GET /api/whiten-jobs for the waiting ones, cuts
//      each product out (tools/whiten/cloud.py: BiRefNet, logo / stray-piece clean-up, clean edges, optional
//      brightening), puts it on pure white and commits the JPEG to the repository's `whiten-results` branch
//   3. the admin page sees it there (results/index.json) and shows before / after; nothing changes in the shop
//      until the owner presses "💾 এটা পণ্যে বসান" (then lib/models/whiten.ts keep(): original kept, undo works)
// The shop never accepts a picture from outside: it fetches the finished file itself from the repository.
import { q, one } from '../db';
import { int, randomCode } from '../util';
import { safeFetch } from '../services/safefetch';
import * as security from '../security';
import * as W from './whiten';
import type { WhitenJobsRow } from '../data/rows';

/** where the cloud AI puts the finished pictures (this shop's public repository) */
export const REPO = process.env.WHITEN_REPO || 'contactmeready786-cmd/shobmilbe-ecommerce-';
const RAW = (path: string) => `https://raw.githubusercontent.com/${REPO}/whiten-results/${path}`;
export type CloudOpts = { bright?: boolean; clean?: boolean };

/** Queue pictures (product pictures only; one waiting job per picture). Returns job ids by media id. */
export async function queue(mediaIds: number[], opts: CloudOpts, userId?: number): Promise<Record<number, number>> {
  const ids = [...new Set(mediaIds.map((x) => int(x)).filter((x) => x > 0))].slice(0, 60);
  if (!ids.length) return {};
  const ok = await q<{ id: number }>(`SELECT id FROM media WHERE id = ANY($1::int[]) AND owner_type='product'`, [ids]);
  const out: Record<number, number> = {};
  for (const { id } of ok) {
    const old = await one<{ id: number }>(`SELECT id FROM whiten_jobs WHERE media_id=$1 AND status='queued' AND created_at > now() - interval '2 days'`, [id]);
    if (old) { await q('UPDATE whiten_jobs SET opts=$2 WHERE id=$1', [old.id, JSON.stringify(opts)]); out[id] = old.id; continue; }
    const r = await one<{ id: number }>(`INSERT INTO whiten_jobs(media_id, token, opts, by_user) VALUES($1, $2, $3, $4) RETURNING id`,
      [id, randomCode(20).toLowerCase(), JSON.stringify({ bright: !!opts.bright, clean: opts.clean !== false }), userId || null]);
    out[id] = r!.id;
  }
  return out;
}

/** For the cloud AI: the waiting pictures, with an address it can read them from. */
export async function waiting(siteUrl: string): Promise<{ id: number; token: string; src: string; opts: CloudOpts }[]> {
  const base = String(siteUrl || '').replace(/\/+$/, '');
  const rows = await q<WhitenJobsRow & { ik_url: string | null }>(`SELECT j.*, m.ik_url FROM whiten_jobs j JOIN media m ON m.id=j.media_id
    WHERE j.status='queued' AND j.created_at > now() - interval '2 days' ORDER BY j.id LIMIT 40`);
  return rows.map((r) => ({ id: r.id, token: r.token, src: r.ik_url || `${base}/media/${r.media_id}?raw=1`, opts: safeJson(r.opts) }));
}
const safeJson = (s: string): CloudOpts => { try { return JSON.parse(s) as CloudOpts; } catch { return {}; } };

/** The finished list the cloud AI keeps (token → ok / error); read at most every 20 s. */
let index: { at: number; data: Record<string, { ok: boolean; error?: string }> } = { at: 0, data: {} };
async function results(): Promise<Record<string, { ok: boolean; error?: string }>> {
  if (Date.now() - index.at < 20_000) return index.data;
  try {
    const r = await fetch(RAW(`results/index.json?t=${Date.now()}`), { signal: AbortSignal.timeout(6000), cache: 'no-store' });
    if (r.ok) index = { at: Date.now(), data: (await r.json()) as typeof index.data };
    else index.at = Date.now();
  } catch { index.at = Date.now(); }
  return index.data;
}

/** Where these jobs are: waiting, done (with the picture's address) or failed. */
export async function status(jobIds: number[]): Promise<{ id: number; media_id: number; status: string; url?: string; error?: string }[]> {
  const ids = jobIds.map((x) => int(x)).filter((x) => x > 0).slice(0, 100);
  if (!ids.length) return [];
  const rows = await q<WhitenJobsRow>('SELECT * FROM whiten_jobs WHERE id = ANY($1::int[])', [ids]);
  const idx = rows.some((r) => r.status === 'queued') ? await results() : {};
  const out = [];
  for (const r of rows) {
    let st = r.status;
    const hit = idx[r.token];
    if (st === 'queued' && hit) {
      st = hit.ok ? 'done' : 'failed';
      await q('UPDATE whiten_jobs SET status=$2, error=$3, done_at=now() WHERE id=$1', [r.id, st, String(hit.error || '').slice(0, 300)]);
    }
    out.push({ id: r.id, media_id: r.media_id, status: st, url: st === 'done' ? RAW(`results/${r.token}.jpg`) : undefined, error: st === 'failed' ? (hit?.error || r.error) : undefined });
  }
  return out;
}

export class CloudError extends Error {}
/** Put a finished picture into its product (the original is kept; lib/models/whiten.ts). Returns the new media id. */
export async function keep(jobId: number): Promise<{ id: number; from: number }> {
  const j = await one<WhitenJobsRow>('SELECT * FROM whiten_jobs WHERE id=$1', [int(jobId)]);
  if (!j || j.status !== 'done') throw new CloudError('ছবিটা এখনো তৈরি হয়নি।');
  const r = await safeFetch(RAW(`results/${j.token}.jpg`), { timeoutMs: 15000, maxBytes: 4 * 1024 * 1024 });
  const data = r.body;
  if (!r.ok || security.imageKind(data) !== 'image/jpeg') throw new CloudError('তৈরি ছবিটা আনা যায়নি — একটু পরে আবার চেষ্টা করুন।');
  const id = await W.keep(j.media_id, data);
  await q(`UPDATE whiten_jobs SET status='kept' WHERE id=$1`, [j.id]);
  return { id, from: j.media_id };
}
