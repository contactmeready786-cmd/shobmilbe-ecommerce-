'use strict';
// Pictures live on ImageKit (free CDN), not inside the database — the database only keeps
// each picture's address and fingerprints. Needs two Vercel environment variables:
//   IMAGEKIT_PRIVATE_KEY   ImageKit → Developer options → API keys → Private key
//   IMAGEKIT_URL_ENDPOINT  ImageKit → Developer options → URL-endpoint (https://ik.imagekit.io/<your id>)
// Without them, pictures simply stay in the database as before.
const FOLDER = '/shobmilbe';

// Forgiving about copy-paste: stray spaces, quotes, a missing https:// are all fixed.
const clean = (v) => String(v || '').trim().replace(/^["']+|["']+$/g, '').trim();
function rawKey() { return clean(process.env.IMAGEKIT_PRIVATE_KEY || process.env.IMAGEKIT_PRIVATE || process.env.IMAGEKIT_KEY); }
function rawEndpoint() { return clean(process.env.IMAGEKIT_URL_ENDPOINT || process.env.IMAGEKIT_ENDPOINT || process.env.IMAGEKIT_URL); }
const looksUrl = (v) => /imagekit\.io|^https?:\/\//i.test(v);
// If the two values were pasted into each other's boxes, use them the right way round.
function swapped() { return looksUrl(rawKey()) && rawEndpoint() && !looksUrl(rawEndpoint()); }
function key() { return swapped() ? rawEndpoint() : rawKey(); }
function endpoint() {
  let e = swapped() ? rawKey() : rawEndpoint();
  if (e && !/^https?:\/\//i.test(e)) e = 'https://' + e;
  return e.replace(/^http:/i, 'https:').replace(/\/+$/, '');
}
// What is missing, in plain words ('' = all fine). Never shows the secret itself.
function shape(v) { return `${v.length} অক্ষর, শুরু "${v.slice(0, 4).replace(/[^a-z_:\/.]/gi, '•')}…"`; }
function problem() {
  const k = key();
  if (!k) return 'IMAGEKIT_PRIVATE_KEY পাওয়া যায়নি';
  if (/^public_/.test(k)) return 'IMAGEKIT_PRIVATE_KEY-এ ভুল করে Public key বসানো হয়েছে, Private key দিন';
  if (looksUrl(k)) return `IMAGEKIT_PRIVATE_KEY-এ চাবির বদলে একটা ঠিকানা বসানো হয়েছে (${shape(k)})`;
  if (k.length < 12) return `IMAGEKIT_PRIVATE_KEY খুব ছোট (${shape(k)})`;
  if (!endpoint()) return 'IMAGEKIT_URL_ENDPOINT পাওয়া যায়নি';
  if (!/^https:\/\/[^/\s]+\.[^/\s]+/.test(endpoint())) return 'IMAGEKIT_URL_ENDPOINT ঠিক মনে হচ্ছে না';
  return '';
}
function configured() { return !problem(); }
// Ask ImageKit itself whether the key works (cached for 10 minutes).
let checkCache = null;
async function check() {
  if (!configured()) return problem();
  if (checkCache && Date.now() - checkCache.at < 600000) return checkCache.msg;
  let msg = '';
  try {
    const r = await fetch('https://api.imagekit.io/v1/files?limit=1', { headers: { Authorization: auth() }, signal: AbortSignal.timeout(10000) });
    if (r.status === 401 || r.status === 403) msg = `ImageKit চাবিটা গ্রহণ করেনি — Private key ঠিকমতো কপি হয়নি (${shape(key())})`;
    else if (!r.ok) msg = `ImageKit সাড়া দিচ্ছে না (${r.status})`;
  } catch (e) { msg = 'ImageKit-এ পৌঁছানো যাচ্ছে না: ' + e.message; }
  checkCache = { at: Date.now(), msg };
  return msg;
}
function auth() { return 'Basic ' + Buffer.from(key() + ':').toString('base64'); }

const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/x-icon': 'ico' };

// Upload one picture → { url, fileId }. fileName (optional) gives the full name, e.g. for backup files.
async function upload(buffer, mime, name, sub = 'media', fileName = '') {
  if (!configured()) throw new Error('ImageKit চাবি বসানো হয়নি');
  const fd = new FormData();
  const fname = fileName || `${name}.${EXT[mime] || 'jpg'}`;
  fd.append('file', new Blob([buffer], { type: mime || 'application/octet-stream' }), fname);
  fd.append('fileName', fname);
  fd.append('folder', `${FOLDER}/${sub}`);
  fd.append('useUniqueFileName', 'true');
  let last;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch('https://upload.imagekit.io/api/v1/files/upload', { method: 'POST', headers: { Authorization: auth() }, body: fd, signal: AbortSignal.timeout(20000) });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.url && j.fileId) return { url: j.url, fileId: j.fileId };
      last = new Error(`ImageKit: ${j.message || r.status}`);
      if (r.status === 401 || r.status === 403) break; // wrong key: retrying won't help
    } catch (e) { last = e; }
    await new Promise((res) => setTimeout(res, 600 * (attempt + 1)));
  }
  throw last;
}

async function remove(fileId) {
  if (!configured() || !fileId) return false;
  const r = await fetch(`https://api.imagekit.io/v1/files/${encodeURIComponent(fileId)}`, { method: 'DELETE', headers: { Authorization: auth() }, signal: AbortSignal.timeout(10000) });
  return r.ok || r.status === 404;
}

// Small version for cards and lists (ImageKit resizes on the fly).
function thumbUrl(url) { return url ? `${url}${url.includes('?') ? '&' : '?'}tr=w-480` : url; }

// Pictures that were deleted on the site: remove them from ImageKit too (queued by a database trigger).
async function flushTrash(db, limit = 40) {
  if (!configured()) return 0;
  const rows = await db.q('SELECT file_id FROM ik_trash ORDER BY added_at LIMIT $1', [limit]).catch(() => []);
  let n = 0;
  for (const r of rows) {
    try { if (await remove(r.file_id)) { await db.q('DELETE FROM ik_trash WHERE file_id=$1', [r.file_id]); n++; } } catch (_) { /* try again next time */ }
  }
  return n;
}

// Pictures still kept inside the database (saved before ImageKit was set up, or when an upload failed):
// move a few to ImageKit and free the database space.
async function moveOld(db, limit = 20) {
  if (!configured()) return 0;
  const rows = await db.q(`SELECT id, mime, data, wm, wm_ver FROM media WHERE ik_url IS NULL AND data IS NOT NULL
    AND (owner_type IS NULL OR owner_type NOT IN ('staff', 'trash:staff')) ORDER BY id LIMIT $1`, [limit]);
  let n = 0;
  for (const m of rows) {
    try {
      const a = await upload(m.data, m.mime, `m${m.id}`);
      const w = m.wm ? await upload(m.wm, 'image/jpeg', `m${m.id}-wm`, 'wm') : null;
      await db.q('UPDATE media SET ik_url=$1, ik_id=$2, wm_url=$3, wm_ik_id=$4, data=NULL, thumb=NULL, wm=NULL WHERE id=$5',
        [a.url, a.fileId, w ? w.url : null, w ? w.fileId : null, m.id]);
      n++;
    } catch (e) { console.error('ImageKit move failed for media', m.id, e.message); break; }
  }
  return n;
}

module.exports = { configured, problem, check, upload, remove, thumbUrl, flushTrash, moveOld, endpoint };
