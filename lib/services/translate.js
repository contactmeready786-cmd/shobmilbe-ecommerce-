'use strict';
// English version of the shop (বাংলা ⇄ English switch near the cart).
//
// The fixed words of the shop (buttons, headings, messages) are translated by hand in public/js/i18n.js.
// Everything the shop owner writes — product names, descriptions, categories, banners, blog, notice —
// is translated here once, saved in the `translations` table and reused for every visitor. The owner can
// correct any line in Admin → স্টোর ডিজাইন → ভাষা (বাংলা / English); a corrected line is never overwritten.
//
// Machine translation: Google Cloud Translation when an API key is saved in the admin (most reliable),
// otherwise Google's free public translate endpoint.
const crypto = require('crypto');
const db = require('../db');
const security = require('../security');

const BN = /[\u0980-\u09E5\u09F0-\u09F2\u09F4-\u09FF]/; // Bangla letters (digits and ৳ alone don't need translating)
const BN_DIGITS = '০১২৩৪৫৬৭৮৯';
const MAX_LEN = 3000;
const BRAND = [['সবমিলবে', 'Shobmilbe']];

// same text → same key, whatever the spacing
function norm(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }
function hash(s) { return crypto.createHash('sha256').update(norm(s)).digest('hex').slice(0, 32); }
function hasBangla(s) { return BN.test(s); }
const latinDigits = (s) => String(s).replace(/[০-৯]/g, (d) => String(BN_DIGITS.indexOf(d)));

// ---------------------------------------------------------------- machine translation
async function googleCloud(texts, key) {
  const r = await fetch(`https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(key)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: texts, source: 'bn', target: 'en', format: 'text' }),
    signal: AbortSignal.timeout(8000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j.error && j.error.message) || `Google Cloud ${r.status}`);
  return (j.data && j.data.translations || []).map((t) => t.translatedText || '');
}
async function googleFree(text) {
  const u = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=bn&tl=en&dt=t&q=' + encodeURIComponent(text);
  const r = await fetch(u, { signal: AbortSignal.timeout(6000), headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!r.ok) throw new Error(`translate ${r.status}`);
  const j = await r.json();
  return (Array.isArray(j && j[0]) ? j[0] : []).map((x) => (Array.isArray(x) ? x[0] || '' : '')).join('');
}

// The shop's name and Bangla digits are fixed before sending, so they always come back right.
function prep(s) { let t = latinDigits(norm(s)); for (const [b, e] of BRAND) t = t.split(b).join(e); return t; }
function tidy(src, out) {
  let t = String(out || '').replace(/\s+([,.!?;:%)])/g, '$1').replace(/([(])\s+/g, '$1').replace(/\s{2,}/g, ' ').trim();
  // keep the leading emoji / symbol exactly as it was (Google sometimes drops or moves it)
  const lead = src.match(/^[^\p{L}\p{N}"'(]+/u);
  if (lead && !t.startsWith(lead[0].trim())) t = lead[0] + t.replace(/^[^\p{L}\p{N}"'(]+/u, '');
  return t;
}

// Translate a list of Bangla texts. Returns an array (empty string where it failed).
async function machine(texts, settings, deadline) {
  const key = String(settings.i18n_google_key || '').trim();
  const out = new Array(texts.length).fill('');
  const sent = texts.map(prep);
  if (key) {
    // Cloud API takes many at once (max 128 per call)
    for (let i = 0; i < sent.length && Date.now() < deadline; i += 100) {
      const part = await googleCloud(sent.slice(i, i + 100), key);
      part.forEach((t, j) => { out[i + j] = tidy(texts[i + j], t); });
    }
    return out;
  }
  let next = 0;
  const worker = async () => {
    while (next < sent.length && Date.now() < deadline) {
      const i = next++;
      try { out[i] = tidy(texts[i], await googleFree(sent[i])); } catch (e) { out[i] = ''; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, sent.length) }, worker));
  return out;
}

// ---------------------------------------------------------------- saved translations
async function getMany(texts) {
  const keys = [...new Set(texts.map(hash))];
  if (!keys.length) return new Map();
  const rows = await db.q('SELECT hash, en FROM translations WHERE hash = ANY($1::text[]) AND en <> \'\'', [keys]);
  if (rows.length) db.q('UPDATE translations SET hits = hits + 1, last_seen = now() WHERE hash = ANY($1::text[])', [rows.map((r) => r.hash)]).catch(() => {});
  return new Map(rows.map((r) => [r.hash, r.en]));
}
async function save(src, en, origin = 'auto') {
  const s = norm(src);
  await db.q(`INSERT INTO translations(hash, src, en, origin) VALUES ($1, $2, $3, $4)
    ON CONFLICT (hash) DO UPDATE SET en = EXCLUDED.en, origin = EXCLUDED.origin, updated_at = now()
    WHERE translations.origin <> 'manual' OR EXCLUDED.origin = 'manual'`, [hash(s), s, String(en || '').trim(), origin]);
}

// Look up texts for a visitor; translate the missing ones (when allowed) within the time left.
// Returns { [text]: english }.
async function lookup(texts, settings, { auto = true, deadline = Date.now() + 8000 } = {}) {
  const list = [...new Set(texts.map(norm))].filter((t) => t && t.length <= MAX_LEN && hasBangla(t));
  const found = await getMany(list);
  const result = {};
  const missing = [];
  for (const t of list) {
    const en = found.get(hash(t));
    if (en) result[t] = en; else missing.push(t);
  }
  if (auto && missing.length) {
    // a ceiling on new machine translations per day, so a flood of made-up text can't run up work
    const allowed = [];
    for (const t of missing) {
      if (!(await security.hit(db, 'i18n-mt-day', 30000, 86400))) break;
      allowed.push(t);
    }
    if (allowed.length) {
      let out = [];
      try { out = await machine(allowed, settings, deadline); } catch (e) { console.error('translate', e.message); out = []; }
      for (let i = 0; i < allowed.length; i++) {
        if (!out[i] || out[i] === prep(allowed[i])) continue;
        result[allowed[i]] = out[i];
        await save(allowed[i], out[i], 'auto').catch((e) => console.error('translate save', e.message));
      }
    }
  }
  return result;
}

// Lines the owner corrected by hand: sent to every English visitor (they win over the built-in words too).
async function manualAll() {
  const rows = await db.q("SELECT src, en FROM translations WHERE origin = 'manual' AND en <> '' ORDER BY updated_at DESC LIMIT 4000");
  const m = {};
  for (const r of rows) m[r.src] = r.en;
  return m;
}

// ---------------------------------------------------------------- what the shop owner wrote
// Short texts that appear on many pages, translated ahead of time from the admin (descriptions are
// translated the first time someone opens them in English).
async function siteTexts(settings) {
  const out = new Set();
  const add = (s) => { const t = norm(s); if (t && hasBangla(t) && t.length <= MAX_LEN) out.add(t); };
  const rows = await db.q(`
    SELECT name AS t FROM products WHERE active IS NOT FALSE
    UNION SELECT name FROM categories
    UNION SELECT brand FROM products WHERE coalesce(brand,'') <> ''
    UNION SELECT title FROM blog_posts WHERE status = 'published'
    UNION SELECT excerpt FROM blog_posts WHERE status = 'published' AND coalesce(excerpt,'') <> ''
    UNION SELECT name FROM blog_categories
    UNION SELECT title FROM pages WHERE active IS NOT FALSE
    UNION SELECT title FROM banners WHERE coalesce(title,'') <> ''
    UNION SELECT subtitle FROM banners WHERE coalesce(subtitle,'') <> ''
    UNION SELECT button FROM banners WHERE coalesce(button,'') <> ''`).catch(async (e) => {
    console.error('site texts', e.message);
    return db.q('SELECT name AS t FROM products UNION SELECT name FROM categories');
  });
  rows.forEach((r) => add(r.t));
  ['store_name', 'tagline', 'hero_title', 'notice', 'footer_about', 'manual_note', 'pay_cod_note', 'live_nav_label', 'block_message'].forEach((k) => add(settings[k]));
  for (const k of ['header_menu', 'footer_links']) db.jsonSetting(settings, k, []).forEach((m) => add(m && m.label));
  return [...out];
}

// Admin "translate everything now": does one batch per call and says how many are left.
async function fillBatch(settings, size = 60) {
  const all = await siteTexts(settings);
  const have = await getMany(all);
  const missing = all.filter((t) => !have.has(hash(t)));
  const batch = missing.slice(0, size);
  let done = 0;
  let error = '';
  if (batch.length) {
    let out = [];
    try { out = await machine(batch, settings, Date.now() + 9000); } catch (e) { error = e.message; }
    for (let i = 0; i < batch.length; i++) {
      if (!out[i] || out[i] === prep(batch[i])) continue;
      await save(batch[i], out[i], 'auto');
      done++;
    }
    if (!done && !error) error = 'অনুবাদের সার্ভার এই মুহূর্তে সাড়া দিচ্ছে না।';
  }
  return { total: all.length, done, left: Math.max(0, missing.length - done), error };
}

async function retranslate(id, settings) {
  const row = await db.one('SELECT src FROM translations WHERE id = $1', [id]);
  if (!row) return null;
  const [en] = await machine([row.src], settings, Date.now() + 9000);
  if (!en) return '';
  await db.q("UPDATE translations SET en = $2, origin = 'auto', updated_at = now() WHERE id = $1", [id, en]);
  return en;
}

module.exports = { lookup, manualAll, save, fillBatch, retranslate, siteTexts, norm, hash, hasBangla, machine, MAX_LEN };
