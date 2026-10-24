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
import type { Settings } from '../types';

/** where the cloud AI puts the finished pictures (this shop's public repository) */
export const REPO = process.env.WHITEN_REPO || 'contactmeready786-cmd/shobmilbe-ecommerce-';
export const RAW = (path: string) => `https://raw.githubusercontent.com/${REPO}/whiten-results/${path}`;
const WORKFLOW = 'whiten-cloud.yml';

/** ⚡ Start the cloud AI now instead of waiting for GitHub's timer (which can lag 30–60 minutes). Needs the owner's
 *  GitHub key (Admin → ব্যাকগ্রাউন্ড সাদা → ⚡ সাথে সাথে শুরু; only "Actions: write" on this one repository).
 *  At most once a minute per server; a run that is already going picks the new pictures up by itself. */
let lastKick = 0;
export async function kick(settings: Settings, force = false): Promise<{ ok: boolean; message: string }> {
  const token = String(settings.whiten_gh_token || '').trim();
  if (!token) return { ok: false, message: 'none' };
  if (!force && Date.now() - lastKick < 60_000) return { ok: true, message: 'recent' };
  lastKick = Date.now();
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`, {
      method: 'POST', signal: AbortSignal.timeout(8000),
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'shobmilbe', 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref: 'main' }),
    });
    if (r.status === 204) return { ok: true, message: 'started' };
    const why = r.status === 401 ? 'চাবিটা ঠিক নেই বা মেয়াদ শেষ' : r.status === 403 || r.status === 404 ? 'চাবিতে এই রিপোজিটরির "Actions: Read and write" অনুমতি নেই' : `GitHub উত্তর দিল ${r.status}`;
    lastKick = 0;
    await db_log(false, why);
    return { ok: false, message: why };
  } catch (e) {
    lastKick = 0;
    await db_log(false, (e as Error).message);
    return { ok: false, message: 'GitHub-এ পৌঁছানো যায়নি' };
  }
}
async function db_log(ok: boolean, msg: string) {
  try { const db = await import('../db'); await db.logIntegration('github', 'whiten_kick', ok, msg); } catch { /* best effort */ }
}

export type CloudOpts = { bright?: boolean; clean?: boolean; base?: boolean; glare?: boolean; contact?: boolean };

/** Queue pictures (product pictures only; one waiting job per picture). Returns job ids by media id. */
export async function queue(mediaIds: number[], opts: CloudOpts, userId?: number, kind: 'product' | 'mine' = 'product'): Promise<Record<number, number>> {
  const ids = [...new Set(mediaIds.map((x) => int(x)).filter((x) => x > 0))].slice(0, 60);
  if (!ids.length) return {};
  const ok = kind === 'mine'
    ? await q<{ id: number }>(`SELECT id FROM media WHERE id = ANY($1::int[]) AND owner_type=$2 AND owner_id=$3`, [ids, MINE, int(userId)])
    : await q<{ id: number }>(`SELECT id FROM media WHERE id = ANY($1::int[]) AND owner_type='product'`, [ids]);
  const out: Record<number, number> = {};
  for (const { id } of ok) {
    const old = await one<{ id: number }>(`SELECT id FROM whiten_jobs WHERE media_id=$1 AND status='queued' AND created_at > now() - interval '2 days'`, [id]);
    if (old) { await q('UPDATE whiten_jobs SET opts=$2 WHERE id=$1', [old.id, JSON.stringify(opts)]); out[id] = old.id; continue; }
    const r = await one<{ id: number }>(`INSERT INTO whiten_jobs(media_id, token, opts, by_user) VALUES($1, $2, $3, $4) RETURNING id`,
      [id, randomCode(20).toLowerCase(), JSON.stringify({ bright: !!opts.bright, clean: opts.clean !== false, base: !!opts.base, glare: !!opts.glare, contact: !!opts.contact }), userId || null]);
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

// 📤 নিজের ছবি সাদা (owner, 2026-10-24): any picture of the owner's own (not a product's) made white the same way,
// then downloaded. Kept 7 days, then removed by itself.
export const MINE = 'whiten_mine';
export const MINE_DAYS = 7;
/** claim freshly uploaded pictures as this person's own (only pictures nobody owns yet) */
export async function claimMine(mediaIds: number[], userId: number): Promise<number[]> {
  const ids = [...new Set(mediaIds.map((x) => int(x)).filter((x) => x > 0))].slice(0, 60);
  if (!ids.length) return [];
  return (await q<{ id: number }>(`UPDATE media SET owner_type=$2, owner_id=$3 WHERE id = ANY($1::int[]) AND owner_type IS NULL RETURNING id`, [ids, MINE, int(userId)])).map((r) => r.id);
}
/** this person's own pictures and where each one is (newest first) */
export async function listMine(userId: number): Promise<{ job: number; media_id: number; status: string; created_at: Date; error: string }[]> {
  await q(`DELETE FROM whiten_jobs WHERE media_id IN (SELECT id FROM media WHERE owner_type=$1 AND created_at < now() - ($2 || ' days')::interval)`, [MINE, String(MINE_DAYS)]);
  await q(`DELETE FROM media WHERE owner_type=$1 AND created_at < now() - ($2 || ' days')::interval`, [MINE, String(MINE_DAYS)]);
  return q(`SELECT DISTINCT ON (m.id) j.id AS job, m.id AS media_id, j.status, m.created_at, j.error FROM media m JOIN whiten_jobs j ON j.media_id=m.id
    WHERE m.owner_type=$1 AND m.owner_id=$2 ORDER BY m.id DESC, j.id DESC LIMIT 200`, [MINE, int(userId)]);
}
/** remove one of this person's own pictures */
export async function deleteMine(mediaId: number, userId: number): Promise<boolean> {
  await q('DELETE FROM whiten_jobs WHERE media_id=$1 AND EXISTS (SELECT 1 FROM media WHERE id=$1 AND owner_type=$2 AND owner_id=$3)', [int(mediaId), MINE, int(userId)]);
  return !!(await one('DELETE FROM media WHERE id=$1 AND owner_type=$2 AND owner_id=$3 RETURNING id', [int(mediaId), MINE, int(userId)]));
}
/** the finished white picture of one job (fetched by the shop itself from the repository) */
export async function resultFile(jobId: number, userId?: number): Promise<{ data: Buffer; media_id: number }> {
  const j = await one<WhitenJobsRow>(userId === undefined ? 'SELECT * FROM whiten_jobs WHERE id=$1'
    : `SELECT j.* FROM whiten_jobs j JOIN media m ON m.id=j.media_id WHERE j.id=$1 AND m.owner_type='${MINE}' AND m.owner_id=$2`, userId === undefined ? [int(jobId)] : [int(jobId), int(userId)]);
  if (!j || (j.status !== 'done' && j.status !== 'kept')) throw new CloudError('ছবিটা এখনো তৈরি হয়নি।');
  const r = await safeFetch(RAW(`results/${j.token}.jpg`), { timeoutMs: 15000, maxBytes: 4 * 1024 * 1024 });
  if (!r.ok || security.imageKind(r.body) !== 'image/jpeg') throw new CloudError('তৈরি ছবিটা আনা যায়নি — একটু পরে আবার চেষ্টা করুন।');
  return { data: r.body, media_id: j.media_id };
}
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
