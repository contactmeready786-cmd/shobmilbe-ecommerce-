'use strict';
// ⬜ সাদা ব্যাকগ্রাউন্ড — every product picture gets a pure white (#FFFFFF) background, automatically.
//
// How one picture is done (on the server, nothing needed from the owner):
//  1. The picture is read from ImageKit as PNG (at most 1600 px on the longer side).
//  2. Plain background (one colour, light or dark, small shading allowed): starting from the picture's
//     edges, only the connected background area is painted pure white. The product's own pixels are
//     never redrawn — only the 1-pixel border around it is cleaned of the old background tint.
//  3. Busy background (room, table, hand, pattern …): ImageKit's AI cut-out (e-bgremove) finds the
//     product; the product's ORIGINAL pixels are put on pure white using that cut-out.
//     ImageKit's free plan allows about 65 such AI pictures a month; when the month's units are used up,
//     those pictures wait and are done automatically the next time.
//  4. The white picture is saved on ImageKit; the original is kept, so any picture can be put back
//     with one click from Admin → পণ্য → সাদা ব্যাকগ্রাউন্ড.
//
// What gets processed: product pictures (gallery, variants) and kit pictures — never logos, banners,
// blog covers, staff photos or customers' photos. Pictures still inside the database (not yet on
// ImageKit) are done right after they move there.
const db = require('../db');
const imagekit = require('./imagekit');
const png = require('./pngio');

const OWNERS = ['product', 'kit'];
const MAX_SIDE = 1600;
const STATES = {
  done: 'সাদা হয়েছে', already: 'আগে থেকেই সাদা ছিল', kept: 'আসল ছবি রাখা হয়েছে', need_ai: 'AI-এর অপেক্ষায়',
  ai_busy: 'AI কাজ করছে', retry: 'আবার চেষ্টা হবে', fail: 'হয়নি', working: 'কাজ চলছে', skip: 'ব্যাকগ্রাউন্ড নেই (পণ্য পুরো ছবি জুড়ে)',
};
const on = (s) => (s || {}).wb_on !== '0';
const aiOn = (s) => (s || {}).wb_ai !== '0';

// ------------------------------------------------------------------ picture maths (pure functions)
const dist = (d, i, r, g, b) => Math.max(Math.abs(d[i] - r), Math.abs(d[i + 1] - g), Math.abs(d[i + 2] - b));

// difference from the background colour is grey (same change in R, G and B) → looks like shade, not product
function neutral(d, i, r, g, b) {
  const dr = d[i] - r, dg = d[i + 1] - g, db = d[i + 2] - b;
  return Math.max(dr, dg, db) - Math.min(dr, dg, db) <= 10;
}

// Transparent parts of a PNG/WebP/GIF are already "no background": put them on white first.
function flatten(img) {
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3];
    if (a === 255) continue;
    const k = a / 255;
    d[i] = Math.round(d[i] * k + 255 * (1 - k)); d[i + 1] = Math.round(d[i + 1] * k + 255 * (1 - k)); d[i + 2] = Math.round(d[i + 2] * k + 255 * (1 - k));
    d[i + 3] = 255;
  }
  return img;
}

// The colour along the picture's edges and how much of the edge has that colour.
function edgeInfo(img) {
  const { width: w, height: h, data: d } = img;
  const band = Math.max(2, Math.round(Math.min(w, h) * 0.015));
  const step = Math.max(1, Math.round((2 * (w + h) * band) / 20000));
  const rs = [], gs = [], bs = [], idx = [];
  let n = 0;
  for (let y = 0; y < h; y++) {
    const edgeRow = y < band || y >= h - band;
    for (let x = 0; x < w; x += edgeRow ? 1 : 1) {
      if (!edgeRow && x >= band && x < w - band) { x = w - band - 1; continue; }
      if (n++ % step) continue;
      const i = (y * w + x) * 4;
      rs.push(d[i]); gs.push(d[i + 1]); bs.push(d[i + 2]); idx.push(i);
    }
  }
  const med = (a) => { const s = a.slice().sort((p, q) => p - q); return s[s.length >> 1]; };
  const bg = [med(rs), med(gs), med(bs)];
  let close = 0, white = 0;
  for (const i of idx) {
    if (dist(d, i, bg[0], bg[1], bg[2]) <= 36) close++;
    if (d[i] === 255 && d[i + 1] === 255 && d[i + 2] === 255) white++;
  }
  return { bg, share: close / idx.length, whiteShare: white / idx.length };
}

// Plain background → pure white. Returns { ok, changed, bgShare, method } (pixels changed in place).
function whitenPlain(img) {
  const { width: w, height: h, data: d } = img;
  const info = edgeInfo(img);
  if (info.share < 0.75) return { ok: false, reason: 'busy', info };
  const [R, G, B] = info.bg;
  const light = Math.min(R, G, B) >= 225;
  const T = light ? 34 : 30, STEP = 4, CAP = light ? 70 : 50;
  const N = w * h;
  const mask = new Uint8Array(N);
  const queue = new Int32Array(N);
  let head = 0, tail = 0;
  const seed = (p) => { if (!mask[p] && dist(d, p * 4, R, G, B) <= T) { mask[p] = 1; queue[tail++] = p; } };
  for (let x = 0; x < w; x++) { seed(x); seed((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { seed(y * w); seed(y * w + w - 1); }
  while (head < tail) {
    const p = queue[head++], x = p % w, pi = p * 4;
    const tryq = (q) => {
      if (mask[q]) return;
      const qi = q * 4, db = dist(d, qi, R, G, B);
      // close to the background colour, or a soft colourless shade continuing smoothly from it
      // (a shadow or light fall-off darkens/brightens all three colours alike; a product edge does not)
      if (db <= T || (db <= CAP && neutral(d, qi, R, G, B) && dist(d, qi, d[pi], d[pi + 1], d[pi + 2]) <= STEP)) { mask[q] = 1; queue[tail++] = q; }
    };
    if (x > 0) tryq(p - 1);
    if (x < w - 1) tryq(p + 1);
    if (p >= w) tryq(p - w);
    if (p < N - w) tryq(p + w);
  }
  let bgCount = tail;
  const bgShare = bgCount / N;
  if (bgShare < 0.02) return { ok: true, skip: true, changed: 0, bgShare, info };   // the product fills the whole picture
  if (bgShare > 0.985) return { ok: false, reason: 'lost', info };                 // nothing left = product looks like the background

  // Light background only: closed pockets of background inside the product (inside a ring, between legs)
  if (light) {
    const seen = new Uint8Array(N), comp = new Int32Array(N);
    const minSize = Math.max(40, Math.round(N * 0.0003)), TT = 20;
    for (let s = 0; s < N; s++) {
      if (mask[s] || seen[s] || dist(d, s * 4, R, G, B) > TT) continue;
      let ch = 0, ct = 0; seen[s] = 1; comp[ct++] = s;
      while (ch < ct) {
        const p = comp[ch++], x = p % w;
        const nb = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p >= w ? p - w : -1, p < N - w ? p + w : -1];
        for (const q of nb) if (q >= 0 && !seen[q] && !mask[q] && dist(d, q * 4, R, G, B) <= TT) { seen[q] = 1; comp[ct++] = q; }
      }
      if (ct >= minSize) for (let k = 0; k < ct; k++) { mask[comp[k]] = 1; bgCount++; }
    }
  }

  // 1-pixel ring around the product: take out the old background's tint (exact un-mixing, then onto white)
  let changed = 0;
  for (let p = 0; p < N; p++) {
    if (mask[p]) continue;
    const x = p % w;
    if (!((x > 0 && mask[p - 1]) || (x < w - 1 && mask[p + 1]) || (p >= w && mask[p - w]) || (p < N - w && mask[p + w]))) continue;
    const i = p * 4, a = Math.min(1, dist(d, i, R, G, B) / 60);
    if (a >= 1) continue;
    const k = 1 - a;
    const nr = Math.round(d[i] + k * (255 - R)), ng = Math.round(d[i + 1] + k * (255 - G)), nb = Math.round(d[i + 2] + k * (255 - B));
    if (nr !== d[i] || ng !== d[i + 1] || nb !== d[i + 2]) changed++;
    d[i] = Math.min(255, Math.max(0, nr)); d[i + 1] = Math.min(255, Math.max(0, ng)); d[i + 2] = Math.min(255, Math.max(0, nb));
  }
  for (let p = 0; p < N; p++) {
    if (!mask[p]) continue;
    const i = p * 4;
    if (d[i] !== 255 || d[i + 1] !== 255 || d[i + 2] !== 255) { d[i] = d[i + 1] = d[i + 2] = 255; changed++; }
  }
  return { ok: true, changed, bgShare: bgCount / N, info };
}

// AI cut-out → original product pixels on pure white. cut = RGBA picture whose alpha marks the product.
function whitenWithCutout(img, cut) {
  const { width: w, height: h, data: d } = img;
  const N = w * h;
  let fg = 0, changed = 0;
  for (let p = 0; p < N; p++) {
    // the cut-out may come back in a slightly different size: read it at the same relative spot
    const cx = cut.width === w ? p % w : Math.min(cut.width - 1, Math.floor(((p % w) * cut.width) / w));
    const cy = cut.height === h ? Math.floor(p / w) : Math.min(cut.height - 1, Math.floor((Math.floor(p / w) * cut.height) / h));
    let a = cut.data[(cy * cut.width + cx) * 4 + 3];
    if (a < 10) a = 0; else if (a > 245) a = 255;
    if (a > 128) fg++;
    if (a === 255) continue;
    const i = p * 4, k = a / 255;
    const nr = Math.round(d[i] * k + 255 * (1 - k)), ng = Math.round(d[i + 1] * k + 255 * (1 - k)), nb = Math.round(d[i + 2] * k + 255 * (1 - k));
    if (nr !== d[i] || ng !== d[i + 1] || nb !== d[i + 2]) changed++;
    d[i] = nr; d[i + 1] = ng; d[i + 2] = nb;
  }
  const fgShare = fg / N;
  if (fgShare < 0.005 || fgShare > 0.995) return { ok: false, reason: 'ai-empty' };
  return { ok: true, changed, bgShare: 1 - fgShare };
}

// How white the picture's outer edge is now (0-1) — shown in the admin list as a check.
function edgeWhite(img) { return edgeInfo(img).whiteShare; }

// ------------------------------------------------------------------ ImageKit + database
function withTr(url, tr) { return `${url}${url.includes('?') ? '&' : '?'}tr=${tr}`; }
const SIZE_TR = `w-${MAX_SIDE},h-${MAX_SIDE},c-at_max`;

async function fetchPng(url, ai) {
  const r = await fetch(withTr(url, ai ? `${SIZE_TR}:e-bgremove,f-png` : `${SIZE_TR},f-png`), { signal: AbortSignal.timeout(ai ? 45000 : 20000) });
  if (ai && r.headers.get('is-intermediate-response') === 'true') return { busy: true };
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    return { error: `ImageKit ${r.status}${t ? ': ' + t.replace(/\s+/g, ' ').slice(0, 120) : ''}`, status: r.status };
  }
  const buf = Buffer.from(await r.arrayBuffer());
  if (!png.isPng(buf)) return { error: 'ImageKit PNG দেয়নি' };
  return { img: png.decode(buf) };
}

const PICK = `owner_type = ANY($1::text[]) AND ik_url IS NOT NULL AND (
     wb_state IS NULL
  OR (wb_state = 'working' AND wb_at < now() - interval '5 minutes')
  OR (wb_state = 'ai_busy' AND wb_at < now() - interval '2 minutes')
  OR (wb_state = 'retry'   AND wb_at < now() - interval '20 minutes')
  OR (wb_state = 'need_ai' AND $2 AND wb_at < now() - interval '12 hours'))`;

// Take one waiting picture for this worker (two workers never get the same picture).
async function claim(settings, id = null) {
  return db.one(`UPDATE media SET wb_state='working', wb_at=now() WHERE id = (
      SELECT id FROM media WHERE ${PICK} ${id ? 'AND id = $3' : ''} ORDER BY (wb_state IS NULL) DESC, id DESC LIMIT 1 FOR UPDATE SKIP LOCKED)
    RETURNING id, mime, ik_url, ik_id, wb_orig_url, wb_orig_id, wb_orig_mime, wb_force, wb_try`, id ? [OWNERS, aiOn(settings), id] : [OWNERS, aiOn(settings)]);
}

async function mark(id, state, note = '', extra = {}) {
  await db.q(`UPDATE media SET wb_state=$2, wb_note=$3, wb_at=now(), wb_try=coalesce(wb_try,0)+$4 WHERE id=$1`, [id, state, String(note).slice(0, 300), extra.count ? 1 : 0]);
}

// Do one picture. → { id, state, method, note } or null when nothing is waiting.
async function processOne(settings, id = null) {
  if (!on(settings) || !imagekit.configured()) return null;
  const m = await claim(settings, id);
  if (!m) return null;
  const source = m.wb_orig_url || m.ik_url; // always start again from the original
  try {
    const got = await fetchPng(source, false);
    if (got.error) {
      if (m.wb_try >= 2) { await mark(m.id, 'fail', got.error, { count: 1 }); return { id: m.id, state: 'fail', note: got.error }; }
      await mark(m.id, 'retry', got.error, { count: 1 });
      return { id: m.id, state: 'retry', note: got.error };
    }
    const img = flatten(got.img);
    let res = m.wb_force === 'ai' ? { ok: false, reason: 'busy' } : whitenPlain(img);
    let method = 'plain';
    if (!res.ok) {
      if (!aiOn(settings)) { await mark(m.id, 'need_ai', 'ব্যাকগ্রাউন্ডে অনেক কিছু আছে — AI বন্ধ থাকায় অপেক্ষায়'); return { id: m.id, state: 'need_ai' }; }
      const cut = await fetchPng(source, true);
      if (cut.busy) { await mark(m.id, 'ai_busy', 'ImageKit AI কাজ করছে — একটু পরে নিজে থেকেই হবে'); return { id: m.id, state: 'ai_busy' }; }
      if (cut.error) {
        // usually: this month's free AI units are used up → try again later by itself
        await mark(m.id, 'need_ai', `AI দিয়ে করা যায়নি (${cut.error}) — ImageKit-এর মাসের ফ্রি AI শেষ হলে পরের মাসে নিজে থেকে হবে`);
        return { id: m.id, state: 'need_ai', note: cut.error };
      }
      // (whitenPlain changes nothing when it gives up, so img is still the untouched original here)
      res = whitenWithCutout(img, cut.img);
      if (!res.ok) { await mark(m.id, 'fail', 'AI ছবিতে পণ্য খুঁজে পায়নি — নিজে সাদা ব্যাকগ্রাউন্ডের ছবি দিন', { count: 1 }); return { id: m.id, state: 'fail' }; }
      method = 'ai';
    }
    if (res.skip) { await mark(m.id, 'skip', 'পণ্য পুরো ছবি জুড়ে — বদলানোর মতো ব্যাকগ্রাউন্ড নেই'); return { id: m.id, state: 'skip' }; }
    if (!m.wb_orig_url && res.changed < img.width * img.height * 0.001) {
      await mark(m.id, 'already', ''); return { id: m.id, state: 'already' };
    }
    const up = await imagekit.upload(png.encodeRGB(img.width, img.height, img.data), 'image/png', `w${m.id}`, 'white');
    const white = Math.round(edgeWhite(img) * 100);
    // the previous white copy (when a picture is done again) goes to the ImageKit bin
    if (m.wb_orig_url && m.ik_id && m.ik_id !== m.wb_orig_id) await db.q('INSERT INTO ik_trash(file_id) VALUES($1) ON CONFLICT DO NOTHING', [m.ik_id]);
    await db.q(`UPDATE media SET wb_orig_url=coalesce(wb_orig_url, ik_url), wb_orig_id=coalesce(wb_orig_id, ik_id), wb_orig_mime=coalesce(wb_orig_mime, mime),
        ik_url=$2, ik_id=$3, mime='image/png', width=$4, height=$5, wb_state='done', wb_method=$6, wb_note=$7, wb_force=NULL, wb_at=now(),
        wm=NULL, wm_url=NULL, wm_ik_id=NULL, wm_ver=NULL
      WHERE id=$1`, [m.id, up.url, up.fileId, img.width, img.height, method, white < 97 ? `কিনারার ${white}% সাদা — একবার দেখে নিন` : '']);
    return { id: m.id, state: 'done', method };
  } catch (e) {
    const note = String(e.message || e).slice(0, 200);
    await mark(m.id, m.wb_try >= 2 ? 'fail' : 'retry', note, { count: 1 }).catch(() => {});
    return { id: m.id, state: 'retry', note };
  }
}

// Work through waiting pictures for at most `ms` milliseconds.
async function run(settings, { ms = 20000, max = 20 } = {}) {
  const start = Date.now(), out = [];
  while (Date.now() - start < ms && out.length < max) {
    const r = await processOne(settings);
    if (!r) break;
    out.push(r);
  }
  return out;
}

// Put the original picture back (and leave it alone from now on).
async function keepOriginal(id) {
  const m = await db.one(`SELECT id, ik_id, wb_orig_url, wb_orig_id FROM media WHERE id=$1 AND owner_type = ANY($2::text[])`, [id, OWNERS]);
  if (!m) return false;
  if (m.wb_orig_url) {
    if (m.ik_id && m.ik_id !== m.wb_orig_id) await db.q('INSERT INTO ik_trash(file_id) VALUES($1) ON CONFLICT DO NOTHING', [m.ik_id]);
    await db.q(`UPDATE media SET ik_url=wb_orig_url, ik_id=wb_orig_id, mime=coalesce(wb_orig_mime, mime), wb_orig_url=NULL, wb_orig_id=NULL, wb_orig_mime=NULL,
      wm=NULL, wm_url=NULL, wm_ik_id=NULL, wm_ver=NULL WHERE id=$1`, [id]);
  }
  await db.q(`UPDATE media SET wb_state='kept', wb_method=NULL, wb_note='', wb_force=NULL, wb_at=now() WHERE id=$1`, [id]);
  return true;
}
// Do a picture again (ai = use the AI cut-out even if the background looks plain).
async function redo(id, ai = false) {
  await db.q(`UPDATE media SET wb_state=NULL, wb_try=0, wb_note='', wb_force=$2, wb_at=now() WHERE id=$1 AND owner_type = ANY($3::text[])`, [id, ai ? 'ai' : null, OWNERS]);
}
async function redoAll(states) {
  return (await db.q(`UPDATE media SET wb_state=NULL, wb_try=0, wb_note='', wb_at=now() WHERE owner_type = ANY($1::text[]) AND wb_state = ANY($2::text[]) RETURNING id`, [OWNERS, states])).length;
}

async function stats() {
  const rows = await db.q(`SELECT coalesce(wb_state, CASE WHEN ik_url IS NULL THEN 'in_db' ELSE 'waiting' END) AS s, count(*)::int AS n
    FROM media WHERE owner_type = ANY($1::text[]) GROUP BY 1`, [OWNERS]);
  const o = { total: 0 };
  for (const r of rows) { o[r.s] = r.n; o.total += r.n; }
  o.white = (o.done || 0) + (o.already || 0);
  o.left = (o.waiting || 0) + (o.working || 0) + (o.retry || 0) + (o.ai_busy || 0) + (o.in_db || 0);
  return o;
}

module.exports = { OWNERS, STATES, on, aiOn, flatten, whitenPlain, whitenWithCutout, edgeInfo, edgeWhite, processOne, run, keepOriginal, redo, redoAll, stats, withTr };
