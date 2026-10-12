'use strict';
// 🤖 অটো পোস্ট — every day, at the hours the owner picked, the shop posts one of its own products on its
// Facebook page (and Instagram, if linked): the real photo, price, a Bangla caption and the order link.
// It uses the official Facebook Graph API with the page's own token, so nothing is "botted" and the page
// is never at risk. One product is not posted again for 45 days; each weekday leans on a different category.
//
// Runs from the hourly /api/research/tick wake-up. A slot ("2026-10-12 @ 11") is claimed with a unique row
// first, so two wake-ups at the same moment can never post twice.
const db = require('../db');
const md = require('../views/md');
const { bn, fetchJson, TZ } = require('../util');

const GRAPH = 'https://graph.facebook.com/v21.0';
const REPEAT_DAYS = 45;

const money = (n) => '৳' + bn(Math.round(Number(n) || 0).toLocaleString('en-IN'));

// Today's date and hour in Dhaka
function dhakaNow(d = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23', weekday: 'short' })
    .formatToParts(d).map((p) => [p.type, p.value]));
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
  return { day: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour), weekday: wd };
}

function hoursOf(settings) {
  const hs = String(settings.autopost_hours || '11,20').split(/[,\s]+/).map(Number).filter((h) => Number.isInteger(h) && h >= 0 && h <= 23);
  return [...new Set(hs)].sort((a, b) => a - b).slice(0, 4);
}

function siteBase(settings) { return String(settings.site_url || 'https://shobmilbe.com').replace(/\/+$/, ''); }

// ---------------------------------------------------------------- picking the product
// Root category of every category (sub-categories post under their main one).
async function rootCategories() {
  const cats = await db.q('SELECT id, name, parent_id FROM categories WHERE coalesce(active,true)');
  const byId = new Map(cats.map((c) => [c.id, c]));
  const rootOf = (id) => { let c = byId.get(id); for (let i = 0; c && c.parent_id && i < 10; i++) c = byId.get(c.parent_id) || c; return c; };
  return { byId, rootOf };
}

const ELIGIBLE = `p.active AND p.parent_id IS NULL AND p.stock > 0 AND p.price > 0 AND p.image_id IS NOT NULL AND NOT coalesce(p.noindex,false)`;

async function pickProduct(weekday, { exclude = [] } = {}) {
  const rows = await db.q(`SELECT p.id, p.name, p.slug, p.price, p.old_price, p.stock, p.image_id, p.category_id, p.short_description, p.description,
      p.brand, coalesce(p.sold_count,0)::int AS sold, coalesce(p.featured,false) AS featured,
      (SELECT max(sp.created_at) FROM social_posts sp WHERE sp.product_id=p.id AND sp.ok) AS last_posted
    FROM products p WHERE ${ELIGIBLE}`);
  if (!rows.length) return null;
  const { rootOf } = await rootCategories();
  const cutoff = Date.now() - REPEAT_DAYS * 864e5;
  // the same product listed twice ("…-2"): only its main page is posted
  const copies = await require('./dupcanon').copies().catch(() => new Map());
  const usable = rows.filter((p) => !exclude.includes(p.id) && !copies.has(p.slug));
  let pool = usable.filter((p) => !p.last_posted || new Date(p.last_posted).getTime() < cutoff);
  if (!pool.length) pool = usable; // everything was posted lately: start the round again
  if (!pool.length) return null;
  // the weekday picks the main category (biggest categories first), so the page shows a different kind of thing each day
  const groups = new Map();
  for (const p of pool) {
    const root = rootOf(p.category_id);
    const key = root ? root.id : 0;
    if (!groups.has(key)) groups.set(key, { name: root ? root.name : '', items: [] });
    groups.get(key).items.push(p);
  }
  const ordered = [...groups.values()].sort((a, b) => b.items.length - a.items.length);
  const group = ordered[weekday % ordered.length];
  // within the category: offers, best sellers and featured first, with some chance so it never feels repetitive
  const score = (p) => (p.old_price > p.price ? 3 : 0) + Math.min(p.sold, 20) / 4 + (p.featured ? 2 : 0) + (p.last_posted ? 0 : 1.5) + Math.random() * 4;
  const best = group.items.map((p) => ({ p, s: score(p) })).sort((a, b) => b.s - a.s)[0].p;
  best.category = group.name;
  return best;
}

// ---------------------------------------------------------------- the caption
const OPENERS = [
  (p) => `🔥 ${p.name}`,
  (p) => `✨ নতুন করে দেখুন — ${p.name}`,
  (p) => `👉 ${p.name}`,
  (p) => `🛒 আজকের পছন্দ: ${p.name}`,
  (p) => `📦 স্টকে আছে — ${p.name}`,
];
function hashtags(p, settings) {
  const tag = (t) => '#' + String(t || '').replace(/[^\p{L}\p{M}\p{N}]+/gu, '');
  const list = [tag(settings.store_name || 'সবমিলবে'), '#shobmilbe', p.category ? tag(p.category) : '', p.brand && !/^(made\s*in|china|chinese|generic|no\s*brand|unbranded|চায়না|চাইনিজ)/i.test(String(p.brand).trim()) ? tag(p.brand) : '', '#OnlineShopBD', '#CashOnDelivery'];
  return [...new Set(list.filter((t) => t.length > 2))].slice(0, 6).join(' ');
}
function caption(p, settings, channel = 'facebook') {
  const name = require('./seo').cleanName(p.name); // "Product details of …" copied from other shops never shows
  const open = OPENERS[(p.id + new Date().getDate()) % OPENERS.length]({ name });
  // copied descriptions often just repeat the product name ("<name> <name> …"): take those repeats out
  const flat = (t) => String(t || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  let about = md.plain(p.short_description || p.description || '', 400).replace(/\s+/g, ' ').trim();
  const nameFlat = flat(name);
  for (let i = 0; i < 3 && nameFlat; i++) {
    const words = about.split(' ');
    let n = 0;
    let acc = '';
    while (n < words.length && acc.length < nameFlat.length) { acc = flat(words.slice(0, n + 1).join(' ')); n++; }
    if (acc !== nameFlat) break;
    about = words.slice(n).join(' ').replace(/^[\s,.:;|–-]+/, '');
  }
  if (flat(about).length < 15) about = '';
  const aboutCut = about.length > 220 ? about.slice(0, 220).replace(/\s+\S*$/, '') + '…' : about;
  const offer = p.old_price > p.price ? `💰 দাম: ${money(p.price)} (আগে ${money(p.old_price)} — ${bn(Math.round(((p.old_price - p.price) * 100) / p.old_price))}% ছাড়)` : `💰 দাম: ${money(p.price)}`;
  const stockNote = p.stock <= 5 ? `⚠️ স্টক সীমিত — মাত্র ${bn(p.stock)}টা আছে` : '';
  const dhaka = Number(settings.delivery_dhaka) || 60;
  const outside = Number(settings.delivery_outside) || 110;
  const link = `${siteBase(settings)}/p/${encodeURIComponent(p.slug)}?utm_source=${channel}&utm_medium=social&utm_campaign=autopost`;
  const phone = settings.whatsapp || settings.phone || '';
  const lines = [
    open, '',
    aboutCut, aboutCut ? '' : null,
    offer, stockNote || null,
    `🚚 সারা বাংলাদেশে হোম ডেলিভারি — ঢাকায় ${money(dhaka)}, ঢাকার বাইরে ${money(outside)}`,
    '✅ ক্যাশ অন ডেলিভারি — পণ্য হাতে পেয়ে টাকা',
    '',
    channel === 'instagram' ? `🛍️ অর্ডার করতে প্রোফাইলের লিংকে যান: ${siteBase(settings).replace(/^https?:\/\//, '')}` : `🛍️ এখনই অর্ডার করুন: ${link}`,
    phone ? `📞 WhatsApp/ফোন: ${phone}` : null,
    '',
    hashtags(p, settings),
  ];
  return lines.filter((l) => l !== null).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// ---------------------------------------------------------------- picture link
// Facebook / Instagram fetch the picture themselves, so it has to be a public JPEG link.
async function imageUrl(p, settings) {
  const m = await db.one('SELECT ik_url FROM media WHERE id=$1', [p.image_id]).catch(() => null);
  if (m && m.ik_url) return `${m.ik_url}${m.ik_url.includes('?') ? '&' : '?'}tr=f-jpg,w-1080`;
  return `${siteBase(settings)}/media/${p.image_id}`;
}

// ---------------------------------------------------------------- Graph API
async function graph(path, { method = 'GET', params = {}, token }) {
  const qs = new URLSearchParams({ ...params, access_token: token });
  const url = `${GRAPH}/${path}`;
  const r = method === 'GET'
    ? await fetchJson(`${url}?${qs}`, {}, 20000)
    : await fetchJson(url, { method, headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: qs.toString() }, 30000);
  const err = r.data && r.data.error;
  if (!r.ok || err) {
    const e = new Error((err && (err.error_user_msg || err.message)) || r.text || `HTTP ${r.status}`);
    e.code = err && err.code;
    throw e;
  }
  return r.data;
}

// Owner pastes the token from Facebook (and optionally the app id + secret). Works out the page, a
// page token that does not expire, and the linked Instagram account.
async function connect({ token, appId, appSecret, pageId }) {
  let t = String(token || '').trim();
  if (!t) throw new Error('টোকেন দিন।');
  if (appId && appSecret) {
    // a short user token (1 hour) → a long one (60 days); page tokens made from it never expire
    try {
      const ex = await graph('oauth/access_token', { token: t, params: { grant_type: 'fb_exchange_token', client_id: appId, client_secret: appSecret, fb_exchange_token: t } });
      if (ex.access_token) t = ex.access_token;
    } catch (e) { throw new Error('App ID / App Secret দিয়ে টোকেন লম্বা করা গেল না: ' + e.message); }
  }
  let page = null;
  let longLived = !!(appId && appSecret);
  try {
    const acc = await graph('me/accounts', { token: t, params: { fields: 'id,name,access_token,tasks', limit: '50' } });
    const pages = (acc.data || []).filter((x) => x.access_token);
    if (pages.length) page = pages.find((x) => String(x.id) === String(pageId || '')) || pages[0];
    if (pages.length > 1 && !pageId) page.others = pages.map((x) => ({ id: x.id, name: x.name }));
  } catch (_) { /* not a user token — maybe it is already a page token */ }
  if (!page) {
    const me = await graph('me', { token: t, params: { fields: 'id,name' } });
    page = { id: me.id, name: me.name, access_token: t };
    longLived = false;
  }
  // can we post? (a page token answers this; a wrong token fails here)
  await graph(page.id, { token: page.access_token, params: { fields: 'id,name' } });
  let ig = null;
  try {
    const r = await graph(page.id, { token: page.access_token, params: { fields: 'instagram_business_account{id,username}' } });
    if (r.instagram_business_account) ig = r.instagram_business_account;
  } catch (_) { /* no Instagram linked */ }
  return { pageId: page.id, pageName: page.name, pageToken: page.access_token, ig, others: page.others || [], longLived };
}

async function postFacebook(p, settings) {
  const r = await graph(`${settings.autopost_page_id}/photos`, {
    method: 'POST', token: settings.autopost_page_token,
    params: { url: await imageUrl(p, settings), caption: caption(p, settings, 'facebook'), published: 'true' },
  });
  return r.post_id || r.id;
}

async function postInstagram(p, settings) {
  const token = settings.autopost_page_token;
  const box = await graph(`${settings.autopost_ig_id}/media`, { method: 'POST', token, params: { image_url: await imageUrl(p, settings), caption: caption(p, settings, 'instagram') } });
  let lastErr = null;
  for (let i = 0; i < 4; i++) { // Instagram needs a few seconds to fetch the picture
    try { const r = await graph(`${settings.autopost_ig_id}/media_publish`, { method: 'POST', token, params: { creation_id: box.id } }); return r.id; } catch (e) { lastErr = e; }
    await new Promise((res) => setTimeout(res, 3000));
  }
  throw lastErr || new Error('Instagram পোস্ট হলো না');
}

async function record(slot, channel, productId, ok, postId, message, kind = 'product', ref = '') {
  await db.q(`INSERT INTO social_posts(slot, channel, product_id, ok, post_id, message, kind, ref) VALUES($1,$2,$3,$4,$5,$6,$7,$8)
    ON CONFLICT (slot) DO UPDATE SET product_id=EXCLUDED.product_id, ok=EXCLUDED.ok, post_id=EXCLUDED.post_id, message=EXCLUDED.message,
      kind=EXCLUDED.kind, ref=EXCLUDED.ref, created_at=now()`,
  [slot, channel, productId, ok, String(postId || ''), String(message || '').slice(0, 500), kind, String(ref || '').slice(0, 500)]);
}

// ================================================================ 💬 engagement posts (owner, 2026-10-13)
// Product-only pages don't grow: people follow a page that teaches them something or talks with them. So one post
// a day (the first hour picked; with a single hour, every other day) is an engagement post instead, in turn:
//   💡 tip      — a true electronics tip in Bangla (data/fbcontent.js), with the matching part from the shop
//   🧠 quiz     — a part's photo: "what is it?" with 3 choices; the answer comes in the NEXT engagement post
//   ✅ answer   — yesterday's quiz answered, with that part's price and link (people come back to check)
//   ❓ question — a real conversation starter ("what are you building?")
// Pattern: tip, quiz, (answer), tip, question … Facebook demotes "like/share if…" bait, so none of that is used.
const C = require('../data/fbcontent');
const ROTATION = ['tip', 'quiz', 'tip', 'question'];

async function lastEngagement() {
  return db.one(`SELECT kind, ref, product_id, post_id FROM social_posts WHERE channel='facebook' AND ok AND kind <> 'product' ORDER BY created_at DESC LIMIT 1`).catch(() => null);
}
async function nextKind() {
  const last = await lastEngagement();
  if (last && last.kind === 'quiz') return 'answer';
  const n = (await db.one(`SELECT count(*)::int AS n FROM social_posts WHERE channel='facebook' AND ok AND kind IN ('tip','quiz','question')`).catch(() => ({ n: 0 }))).n;
  return ROTATION[n % ROTATION.length];
}
// the item of a list that was used longest ago (never-used first)
async function freshIndex(kind, length) {
  const used = await db.q(`SELECT ref, max(created_at) AS at FROM social_posts WHERE kind=$1 AND ok GROUP BY ref`, [kind]).catch(() => []);
  const at = new Map(used.map((r) => [String(r.ref), new Date(r.at).getTime()]));
  const order = [...Array(length).keys()].sort((a, b) => (at.get(String(a)) || 0) - (at.get(String(b)) || 0) || Math.random() - 0.5);
  return order[0];
}
async function productFor(words) {
  if (!words || !words.length) return null;
  const like = words.map((w) => '%' + String(w).replace(/[%_]/g, '') + '%');
  return db.one(`SELECT p.*, coalesce(p.sold_count,0)::int AS sold FROM products p WHERE ${ELIGIBLE} AND p.name ILIKE ANY($1::text[])
    ORDER BY coalesce(p.sold_count,0) DESC, random() LIMIT 1`, [like]).catch(() => null);
}
const shortName = (n) => { const x = require('./seo').cleanName(n); return x.length > 70 ? x.slice(0, 70).replace(/\s+\S*$/, '') + '…' : x; };
const productLink = (p, settings, campaign) => `${siteBase(settings)}/p/${encodeURIComponent(p.slug)}?utm_source=facebook&utm_medium=social&utm_campaign=${campaign}`;
const BN_ABC = ['ক', 'খ', 'গ'];

// Builds the post (text + optional product photo). Nothing is sent here, so the admin page can preview it.
async function buildEngagement(settings, kind) {
  const shop = settings.store_name || 'সবমিলবে';
  const tagLine = `#${String(shop).replace(/[^\p{L}\p{M}\p{N}]+/gu, '')} #shobmilbe #ElectronicsBD #বাংলায়_ইলেকট্রনিক্স`;
  if (kind === 'tip') {
    const i = await freshIndex('tip', C.TIPS.length);
    const tip = C.TIPS[i];
    const p = await productFor(tip.find);
    const text = [`💡 ইলেকট্রনিক্স টিপস`, '', tip.t, '',
      p ? `🔧 এই কাজের পার্টস: ${shortName(p.name)} — ${money(p.price)}\n🛍️ ${productLink(p, settings, 'tip')}` : null,
      '', 'কাজে লাগলে পেজটা ফলো করে রাখুন — প্রতি সপ্তাহে এমন টিপস আসবে। প্রশ্ন থাকলে কমেন্টে লিখুন। 👇', '', tagLine].filter((l) => l !== null).join('\n').replace(/\n{3,}/g, '\n\n');
    return { kind, ref: String(i), product: p, text };
  }
  if (kind === 'question') {
    const i = await freshIndex('question', C.QUESTIONS.length);
    return { kind, ref: String(i), product: null, text: `${C.QUESTIONS[i]}\n\n${tagLine}` };
  }
  if (kind === 'quiz') {
    const p = await pickProduct(dhakaNow().weekday);
    if (!p) return null;
    // two wrong answers: parts from the shop with a different name
    const others = await db.q(`SELECT p.name FROM products p WHERE ${ELIGIBLE} AND p.id <> $1 AND coalesce(p.category_id,0) <> coalesce($2,0) ORDER BY random() LIMIT 6`, [p.id, p.category_id]).catch(() => []);
    const wrong = [...new Set(others.map((o) => shortName(o.name)).filter((n) => n && n !== shortName(p.name)))].slice(0, 2);
    if (wrong.length < 2) return buildEngagement(settings, 'tip');
    const right = Math.floor(Math.random() * 3);
    const choices = [...wrong];
    choices.splice(right, 0, shortName(p.name));
    const text = ['🧠 আজকের কুইজ: ছবির পার্টসটার নাম কী?', '',
      ...choices.map((c, k) => `${BN_ABC[k]}) ${c}`), '',
      'উত্তর কমেন্টে লিখুন (শুধু ক / খ / গ)। সঠিক উত্তর আর এর দাম জানাব পরের পোস্টে — পেজ ফলো করে রাখুন যেন মিস না হয়। 🔔', '', tagLine].join('\n');
    return { kind, ref: JSON.stringify({ right, choices }), product: p, text };
  }
  if (kind === 'answer') {
    const last = await lastEngagement();
    let quiz = null;
    try { quiz = JSON.parse(last.ref); } catch (_) { quiz = null; }
    const p = last && last.product_id ? await db.one(`SELECT p.*, coalesce(p.sold_count,0)::int AS sold FROM products p WHERE p.id=$1`, [last.product_id]) : null;
    if (!p || !quiz || !p.active) return buildEngagement(settings, 'tip'); // the part was removed meanwhile: skip to a tip
    const text = [`✅ গত কুইজের সঠিক উত্তর: ${BN_ABC[quiz.right]}) ${shortName(p.name)}`, '',
      'যারা ঠিক বলেছেন সবাইকে অভিনন্দন! 🎉', '',
      p.stock > 0 ? `💰 দাম: ${money(p.price)} — স্টকে আছে\n🛍️ অর্ডার: ${productLink(p, settings, 'quiz')}` : 'এই মুহূর্তে স্টকে নেই — শীঘ্রই আসবে।',
      '🚚 সারা দেশে হোম ডেলিভারি, ক্যাশ অন ডেলিভারি', '',
      'পরের কুইজ শীঘ্রই — পেজ ফলো করে রাখুন। 🔔', '', tagLine].join('\n');
    return { kind, ref: 'answer', product: p, text, quizPost: last.post_id };
  }
  return null;
}

async function postEngagement(settings, slot, kindWanted) {
  const kind = kindWanted || (await nextKind());
  const e = await buildEngagement(settings, kind);
  if (!e) return { error: 'পোস্ট বানানো গেল না (পণ্য নেই)।' };
  const base = slot || `manual:${Date.now()}`;
  try {
    const r = e.product && e.product.image_id
      ? await graph(`${settings.autopost_page_id}/photos`, { method: 'POST', token: settings.autopost_page_token, params: { url: await imageUrl(e.product, settings), caption: e.text, published: 'true' } })
      : await graph(`${settings.autopost_page_id}/feed`, { method: 'POST', token: settings.autopost_page_token, params: { message: e.text } });
    const id = r.post_id || r.id;
    await record(`${base}:fb`, 'facebook', e.product ? e.product.id : null, true, id, '', e.kind, e.ref);
    return { engagement: e.kind, fb: id, product: e.product };
  } catch (err) {
    await record(`${base}:fb`, 'facebook', e.product ? e.product.id : null, false, '', err.message, e.kind, e.ref);
    await db.logIntegration('facebook-autopost', 'engage', false, err.message, e.kind);
    return { engagement: e.kind, fbError: err.message, product: e.product };
  }
}
// Is this slot an engagement one? The first picked hour each day; with only one hour, every other day.
function engagementSlot(settings, hour, day) {
  if (settings.autopost_engage === '0') return false;
  const hs = hoursOf(settings);
  if (hs.length > 1) return hour === hs[0];
  const dayNo = Math.floor(new Date(day + 'T00:00:00Z').getTime() / 864e5);
  return dayNo % 2 === 0;
}

// Post one product now. Returns what happened on each channel.
async function postOne(settings, { slot, productId } = {}) {
  const now = dhakaNow();
  const p = productId
    ? await db.one(`SELECT p.*, coalesce(p.sold_count,0)::int AS sold FROM products p WHERE p.id=$1 AND ${ELIGIBLE}`, [productId])
    : await pickProduct(now.weekday);
  if (!p) return { error: 'পোস্ট করার মতো পণ্য পাওয়া যায়নি (স্টকে আছে, ছবি আছে, দোকানে চালু — এমন পণ্য লাগবে)।' };
  if (!p.category && p.category_id) { const { rootOf } = await rootCategories(); const r = rootOf(p.category_id); p.category = r ? r.name : ''; }
  const out = { product: p };
  const base = slot || `manual:${Date.now()}`;
  if (settings.autopost_fb !== '0') {
    try { out.fb = await postFacebook(p, settings); await record(`${base}:fb`, 'facebook', p.id, true, out.fb, ''); } catch (e) {
      out.fbError = e.message; await record(`${base}:fb`, 'facebook', p.id, false, '', e.message);
      await db.logIntegration('facebook-autopost', 'post', false, e.message, p.name);
    }
  }
  if (settings.autopost_ig === '1' && settings.autopost_ig_id) {
    try { out.ig = await postInstagram(p, settings); await record(`${base}:ig`, 'instagram', p.id, true, out.ig, ''); } catch (e) {
      out.igError = e.message; await record(`${base}:ig`, 'instagram', p.id, false, '', e.message);
      await db.logIntegration('instagram-autopost', 'post', false, e.message, p.name);
    }
  }
  return out;
}

// Called from the hourly wake-up: posts when an hour the owner picked has come and its slot is still free.
async function tick(settings) {
  if (settings.autopost_on !== '1' || !settings.autopost_page_token || !settings.autopost_page_id) return { off: true };
  const now = dhakaNow();
  const due = hoursOf(settings).filter((h) => h <= now.hour && now.hour - h <= 3); // a missed hour is caught up within 3 hours
  if (!due.length) return { idle: true };
  const slot = `${now.day}@${due[due.length - 1]}`;
  // claim the slot first: only one wake-up wins it
  const claimed = await db.one(`INSERT INTO social_posts(slot, channel, ok, message) VALUES($1,'claim',NULL,'') ON CONFLICT (slot) DO NOTHING RETURNING id`, [slot]);
  if (!claimed) return { done: true };
  const hour = due[due.length - 1];
  const r = settings.autopost_fb !== '0' && engagementSlot(settings, hour, now.day) ? await postEngagement(settings, slot) : await postOne(settings, { slot });
  await db.q(`UPDATE social_posts SET product_id=$2, ok=$3, message=$4 WHERE slot=$1`,
    [slot, r.product ? r.product.id : null, !r.error && !r.fbError, r.error || r.fbError || '']);
  return r;
}

async function recent(limit = 30) {
  return db.q(`SELECT sp.*, p.name AS product_name, p.slug FROM social_posts sp LEFT JOIN products p ON p.id=sp.product_id
    WHERE sp.channel <> 'claim' ORDER BY sp.created_at DESC LIMIT $1`, [limit]).catch(() => []);
}

module.exports = { tick, postOne, connect, caption, pickProduct, recent, hoursOf, dhakaNow, imageUrl, postEngagement, buildEngagement, nextKind, engagementSlot };
