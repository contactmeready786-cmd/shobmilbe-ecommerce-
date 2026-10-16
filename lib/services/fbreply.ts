// @ts-nocheck — converted from JavaScript; types are added file by file.
// 💬 কমেন্টে অটো উত্তর — when someone asks "দাম কত?" / "price?" / "available?" under the shop's Facebook post,
// the shop answers in the comment itself within minutes: the product's price, stock and the order link.
// On Bangladeshi pages most comments are exactly this question, and a fast answer is what turns them into orders;
// Facebook also shows posts with replies to more people.
//
// How: every ~10 minutes (the round-the-clock wake-up) it reads the newest comments on the page's posts of the last
// 10 days through the official Graph API (the same page token as অটো পোস্ট) and replies once per comment.
// Which product? The product the post was about (the shop posted it, so social_posts knows), or a model number /
// name written in the comment ("PAM8403 er dam koto"). Nothing found → a short "send us the name" answer with the link.
// Never: a comment the page wrote itself, a quiz answer ("ক"), a comment older than 2 days, the same comment twice,
// more than 12 replies in one go or 150 in a day.
// Needs two more permissions on the token: pages_read_user_content (read comments), pages_manage_engagement (reply).
import * as db from '../db';
import { bn, str } from '../util';
import * as autopost from './autopost';
import * as $seo from './seo';

const EVERY_MS = 9 * 60 * 1000;
const PER_RUN = 12;
const PER_DAY = 150;

const money = (n) => '৳' + bn(Math.round(Number(n) || 0).toLocaleString('en-IN'));

// "দাম কত", "price koto", "rate?", "available?", "ache?", "kivabe kinbo", "order dibo" … (Bangla, English, Banglish)
const ASK = /(দাম|দামটা|প্রাইস|মূল্য|কত\s*টাকা|কতো|কত\s*দাম|price|prise|pric|rate|dam\s*koto|dam\s*kto|koto\s*taka|kto\s*tk|\bkoto\b|\bkto\b|\bdam\b|available|avilable|availabl|stock|স্টক|আছে\s*কি|আছে\?|ache\s*ki|\bache\b|পাওয়া\s*যাবে|pawa\s*jabe|অর্ডার|order|অডার|কিভাবে\s*কিন|কীভাবে\s*কিন|kivabe\s*kin|kibhabe|লিংক|link|ডেলিভারি|delivery|ক্যাশ\s*অন|cash\s*on|inbox|ইনবক্স|\bib\b|details|বিস্তারিত)/i;
// a quiz answer ("ক", "খ)", "gha") — the answer post covers it
const QUIZ = /^\s*[(]?\s*(ক|খ|গ|ka|kha|ga|a|b|c)\s*[)।.!]?\s*$/i;

function dhakaDay() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(new Date()); }

// a product named in the comment: model numbers first (letters+digits: "pam8403", "hc-05", "18650"), then words
async function productInText(text) {
  const words = String(text || '').toLowerCase().match(/[a-z]*\d+[a-z0-9-]*|[a-z]+-\d+[a-z0-9-]*/g) || [];
  const codes = [...new Set(words.map((w) => w.replace(/-+$/, '')).filter((w) => (w.length >= 3 && /[a-z]/.test(w)) || /^\d{4,}$/.test(w)))].slice(0, 5);
  for (const c of codes) {
    const flat = c.replace(/-/g, '');
    const r = await db.one(`SELECT p.* FROM products p WHERE p.active AND p.parent_id IS NULL AND p.price > 0
      AND (lower(p.model) = $1 OR replace(lower(p.name),'-','') LIKE $2 OR replace(lower(p.model),'-','') = $3)
      ORDER BY (p.stock > 0) DESC, coalesce(p.sold_count,0) DESC LIMIT 1`, [c, `%${flat}%`, flat]).catch(() => null);
    if (r) return r;
  }
  // no model number: the English words of a name ("arduino uno er price?") — every word must be in the product's name
  const STOP = new Set(['price', 'prise', 'dam', 'koto', 'kto', 'taka', 'tk', 'er', 'ar', 'bhai', 'vai', 'apu', 'available', 'avilable', 'ache', 'ase', 'ki',
    'order', 'link', 'details', 'inbox', 'stock', 'plz', 'please', 'pls', 'the', 'how', 'much', 'what', 'is', 'this', 'that', 'for', 'and', 'delivery', 'rate',
    'kivabe', 'kinbo', 'dibo', 'nibo', 'chai', 'lagbe', 'hobe', 'jabe', 'pawa', 'ta', 'te', 'koi', 'kothay', 'cash', 'on', 'dam', 'new', 'sir']);
  const names = [...new Set((String(text || '').toLowerCase().match(/[a-z]{3,}/g) || []).filter((w) => !STOP.has(w)))].slice(0, 4);
  if (names.length && names.some((w) => w.length >= 4)) {
    return db.one(`SELECT p.* FROM products p WHERE p.active AND p.parent_id IS NULL AND p.price > 0 AND p.name ILIKE ALL($1::text[])
      ORDER BY (p.stock > 0) DESC, coalesce(p.sold_count,0) DESC, length(p.name) LIMIT 1`, [names.map((w) => `%${w}%`)]).catch(() => null);
  }
  return null;
}

// What the post was about: the product (or kit) the shop posted there
async function postSubject(postId) {
  const sp = await db.one(`SELECT product_id, kind, ref FROM social_posts WHERE channel='facebook' AND ok AND post_id=$1 ORDER BY created_at DESC LIMIT 1`, [postId]).catch(() => null);
  if (!sp) return {};
  if (sp.kind === 'kit' && /^\d+$/.test(sp.ref || '')) {
    const k = await db.one('SELECT id, slug, title FROM kits WHERE id=$1 AND active', [Number(sp.ref)]).catch(() => null);
    if (k) return { kit: k };
  }
  if (sp.product_id && sp.kind !== 'quiz') {
    const p = await db.one('SELECT * FROM products WHERE id=$1 AND active', [sp.product_id]).catch(() => null);
    if (p) return { product: p };
  }
  return { quiz: sp.kind === 'quiz' };
}

const pick = (list, seed) => list[Math.abs(seed) % list.length];
function seedOf(id) { let h = 0; for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) | 0; return h; }

// The answer. A few wordings in turn, so the page never posts the same sentence over and over.
function replyText({ product: p, kit }, settings, commentId) {
  const base = autopost.siteBase(settings);
  const seed = seedOf(commentId);
  const utm = 'utm_source=facebook&utm_medium=comment&utm_campaign=auto-reply';
  const deliv = `ঢাকায় ডেলিভারি ${money(settings.delivery_dhaka || 60)}, ঢাকার বাইরে ${money(settings.delivery_outside || 110)} — ক্যাশ অন ডেলিভারি।`;
  if (kit) {
    return `${pick(['ধন্যবাদ! 🙏', 'আগ্রহের জন্য ধন্যবাদ! 😊', 'জি, অবশ্যই! 👍'], seed)} এই প্রজেক্টের সব পার্টসের দাম আর বানানোর ধাপ এখানে — যেটা লাগবে টিক দিয়ে এক চাপে অর্ডার করুন: ${base}/kit/${encodeURIComponent(kit.slug)}?${utm}\n${deliv}`;
  }
  if (p) {
    const name = $seo.cleanName(p.name);
    const short = name.length > 60 ? name.slice(0, 60).replace(/\s+\S*$/, '') + '…' : name;
    const stock = p.stock > 0 ? 'স্টকে আছে ✅' : p.preorder ? 'প্রি-অর্ডারে পাওয়া যাবে' : 'এই মুহূর্তে স্টকে নেই — লিংকে "স্টকে এলে জানাও" চাপলে SMS পাবেন';
    const link = `${base}/p/${encodeURIComponent(p.slug)}?${utm}`;
    return pick([
      `ধন্যবাদ! 🙏 ${short} — দাম ${money(p.price)}, ${stock}।\nঅর্ডার করুন: ${link}\n${deliv}`,
      `জি! 😊 ${short} এর দাম ${money(p.price)} (${stock})।\nসরাসরি অর্ডারের লিংক: ${link}\n${deliv}`,
      `আগ্রহের জন্য ধন্যবাদ! 👍 দাম মাত্র ${money(p.price)}, ${stock}।\nবিস্তারিত ও অর্ডার: ${link}\n${deliv}`,
    ], seed);
  }
  return `${pick(['ধন্যবাদ! 🙏', 'জি, বলছি! 😊'], seed)} কোন পণ্যটা চান তার নাম বা মডেল (যেমন PAM8403) লিখুন, অথবা এখানে খুঁজে দাম দেখে অর্ডার করুন: ${base}/products?${utm}\n${deliv}`;
}

function permissionHint(msg) {
  return /permission|\(#10\)|\(#200\)|pages_read_user_content|pages_manage_engagement|not authorized|requires/i.test(msg)
    ? 'টোকেনে কমেন্ট পড়া/উত্তরের অনুমতি নেই — অটো মার্কেটিং পেজের ধাপ অনুযায়ী pages_read_user_content আর pages_manage_engagement যোগ করে আবার যুক্ত করুন।' : '';
}

async function run(settings, { force = false } = {}) {
  if (settings.fbreply_on !== '1' || !settings.autopost_page_token || !settings.autopost_page_id) return { off: true };
  if (!force && Date.now() - (Number(settings.fbreply_try) || 0) < EVERY_MS) return { skipped: true };
  await db.setMany({ fbreply_try: String(Date.now()) });
  const today = dhakaDay();
  const doneToday = (await db.one(`SELECT count(*)::int AS n FROM fb_comments WHERE replied AND created_at > now() - interval '24 hours'`).catch(() => ({ n: 0 }))).n;
  let room = Math.min(PER_RUN, PER_DAY - doneToday);
  if (room <= 0) return { limit: true };
  const token = settings.autopost_page_token;
  const pageId = String(settings.autopost_page_id);
  const out = { checked: 0, replied: 0, errors: [] };
  let posts;
  try {
    const since = Math.floor((Date.now() - 10 * 864e5) / 1000);
    posts = (await autopost.graph(`${pageId}/posts`, { token, params: { fields: 'id,created_time', limit: '15', since: String(since) } })).data || [];
  } catch (e) {
    const msg = permissionHint(e.message) || e.message;
    await db.setMany({ fbreply_error: str(msg, 300), fbreply_error_at: String(Date.now()) });
    return { error: msg };
  }
  const twoDays = Date.now() - 2 * 864e5;
  for (const post of posts) {
    if (room <= 0) break;
    let comments;
    try {
      comments = (await autopost.graph(`${post.id}/comments`, { token, params: { fields: 'id,message,from,created_time,comment_count', filter: 'toplevel', order: 'reverse_chronological', limit: '50' } })).data || [];
    } catch (e) {
      const msg = permissionHint(e.message) || e.message;
      out.errors.push(msg);
      if (permissionHint(e.message)) break;
      continue;
    }
    const fresh = comments.filter((c) => c.id && new Date(c.created_time).getTime() > twoDays && !(c.from && String(c.from.id) === pageId));
    if (!fresh.length) continue;
    const seen = new Set((await db.q('SELECT id FROM fb_comments WHERE id = ANY($1::text[])', [fresh.map((c) => c.id)])).map((r) => r.id));
    let subject = null;
    for (const c of fresh.reverse()) { // oldest question first
      if (room <= 0) break;
      if (seen.has(c.id)) continue;
      out.checked++;
      const text = String(c.message || '').trim();
      // claim it first: two wake-ups never answer the same comment
      const mine = await db.one(`INSERT INTO fb_comments(id, post_id, message) VALUES($1,$2,$3) ON CONFLICT (id) DO NOTHING RETURNING id`, [c.id, post.id, str(text, 500)]);
      if (!mine) continue;
      if (!text || QUIZ.test(text) || !ASK.test(text)) continue; // not a buying question: left for the owner
      if (!subject) subject = await postSubject(post.id);
      const named = await productInText(text);
      const about = named ? { product: named } : subject.product || subject.kit ? subject : {};
      const reply = replyText(about, settings, c.id);
      try {
        const r = await autopost.graph(`${c.id}/comments`, { method: 'POST', token, params: { message: reply } });
        await db.q('UPDATE fb_comments SET replied=true, reply_id=$2, reply=$3, product_id=$4 WHERE id=$1', [c.id, String(r.id || ''), str(reply, 1000), about.product ? about.product.id : null]);
        out.replied++; room--;
      } catch (e) {
        const msg = permissionHint(e.message) || e.message;
        await db.q('UPDATE fb_comments SET error=$2, reply=$3 WHERE id=$1', [c.id, str(msg, 300), str(reply, 1000)]);
        out.errors.push(msg);
        if (permissionHint(e.message)) { room = 0; break; }
      }
    }
  }
  await db.setMany({ fbreply_error: out.errors.length ? str(out.errors[0], 300) : '', fbreply_error_at: out.errors.length ? String(Date.now()) : '', fbreply_last: String(Date.now()), fbreply_day: today });
  if (Math.random() < 0.05) db.q(`DELETE FROM fb_comments WHERE created_at < now() - interval '90 days'`).catch(() => {});
  return out;
}

async function recent(limit = 25) {
  return db.q(`SELECT c.*, p.name AS product_name, p.slug FROM fb_comments c LEFT JOIN products p ON p.id=c.product_id
    WHERE c.replied OR c.error <> '' ORDER BY c.created_at DESC LIMIT $1`, [limit]).catch(() => []);
}
async function stats() {
  return db.one(`SELECT count(*) FILTER (WHERE replied)::int AS replied, count(*) FILTER (WHERE replied AND created_at > now() - interval '7 days')::int AS week,
    count(*)::int AS seen FROM fb_comments`).catch(() => ({ replied: 0, week: 0, seen: 0 }));
}

export { run, recent, stats, replyText, productInText, ASK, QUIZ };
