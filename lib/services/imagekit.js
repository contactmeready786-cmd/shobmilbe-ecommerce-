'use strict';
// Pictures live on ImageKit (free CDN), not inside the database — the database only keeps
// each picture's address and fingerprints. Needs two Vercel environment variables:
//   IMAGEKIT_PRIVATE_KEY   ImageKit → Developer options → API keys → Private key
//   IMAGEKIT_URL_ENDPOINT  ImageKit → Developer options → URL-endpoint (https://ik.imagekit.io/<your id>)
// Without them, pictures simply stay in the database as before.
const FOLDER = '/shobmilbe';

function key() { return String(process.env.IMAGEKIT_PRIVATE_KEY || '').trim(); }
function endpoint() { return String(process.env.IMAGEKIT_URL_ENDPOINT || '').trim().replace(/\/+$/, ''); }
function configured() { return /^private_/.test(key()) && /^https:\/\/ik\.imagekit\.io\//.test(endpoint() + '/'); }
function auth() { return 'Basic ' + Buffer.from(key() + ':').toString('base64'); }

const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/x-icon': 'ico' };

// Upload one picture → { url, fileId }.
async function upload(buffer, mime, name, sub = 'media') {
  if (!configured()) throw new Error('ImageKit চাবি বসানো হয়নি');
  const fd = new FormData();
  fd.append('file', new Blob([buffer], { type: mime || 'application/octet-stream' }), `${name}.${EXT[mime] || 'jpg'}`);
  fd.append('fileName', `${name}.${EXT[mime] || 'jpg'}`);
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

module.exports = { configured, upload, remove, thumbUrl, flushTrash, moveOld, endpoint };
