// 📦 Files the GitHub workers leave for the shop (white pictures on the `whiten-results` branch, product videos on
// `social-videos`). While the repository was public the shop read them from raw.githubusercontent.com. The owner is
// making the repository PRIVATE (2026-11-13) — then only a request carrying the owner's GitHub key can read them. So:
//   • with the key saved in Admin → ব্যাকগ্রাউন্ড সাদা (whiten_gh_token; it needs "Contents: Read-only" besides
//     "Actions: Read and write") the file is read through GitHub's API — works for a private and a public repository
//   • without a key the public address is tried, as before (works only while the repository is public)
// Also here: starting a worker now (workflow_dispatch) instead of waiting for GitHub's slow timer.
import * as db from '../db';

export const REPO = process.env.WHITEN_REPO || 'contactmeready786-cmd/shobmilbe-ecommerce-';
const API = 'https://api.github.com';
const headers = (token: string, accept = 'application/vnd.github+json') => ({ Authorization: `Bearer ${token}`, Accept: accept, 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'shobmilbe' });

async function savedToken(): Promise<string> {
  try { return String((await db.getSettings()).whiten_gh_token || '').trim(); } catch { return ''; }
}
export const publicUrl = (branch: string, path: string) => `https://raw.githubusercontent.com/${REPO}/${branch}/${path}`;
const enc = (path: string) => path.split('/').map(encodeURIComponent).join('/');

/** one file of a branch, as a Response (check .ok). `token` — the key to use; left out = the saved one. */
export async function repoFile(branch: string, path: string, { timeoutMs = 10000, token }: { timeoutMs?: number; token?: string } = {}): Promise<Response> {
  const t = token === undefined ? await savedToken() : token;
  const signal = AbortSignal.timeout(timeoutMs);
  if (t) return fetch(`${API}/repos/${REPO}/contents/${enc(path)}?ref=${encodeURIComponent(branch)}`, { headers: headers(t, 'application/vnd.github.raw+json'), signal, cache: 'no-store' });
  return fetch(`${publicUrl(branch, path)}?t=${Date.now()}`, { signal, cache: 'no-store' });
}
/** the file's bytes, or null (missing, no access, too big) */
export async function repoBytes(branch: string, path: string, maxBytes: number, timeoutMs = 15000): Promise<Buffer | null> {
  try {
    const r = await repoFile(branch, path, { timeoutMs });
    if (!r.ok) return null;
    const b = Buffer.from(await r.arrayBuffer());
    return b.length && b.length <= maxBytes ? b : null;
  } catch { return null; }
}
/** can this key read the repository's files? (needed once the repository is private) */
export async function canRead(token: string): Promise<boolean> {
  try { return (await repoFile('main', 'package.json', { token, timeoutMs: 8000 })).ok; } catch { return false; }
}
/** start a workflow now; answers GitHub's status (204 = started), 0 when GitHub can't be reached or there is no key */
export async function dispatch(workflow: string, token?: string): Promise<number> {
  const t = token === undefined ? await savedToken() : token;
  if (!t) return 0;
  try {
    const r = await fetch(`${API}/repos/${REPO}/actions/workflows/${workflow}/dispatches`, { method: 'POST', signal: AbortSignal.timeout(8000), headers: { ...headers(t), 'Content-Type': 'application/json' }, body: JSON.stringify({ ref: 'main' }) });
    return r.status;
  } catch { return 0; }
}
