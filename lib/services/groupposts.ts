// 📣 Group posts + 🏷️ Marketplace helper (owner, 2026-11-21).
//
// Group posts: Facebook groups block shop links and "buy now" posts, and Facebook has no way for a program to post in
// groups. So every week the shop writes 7 helpful posts (an electronics tip, a project idea, a question) in Bangla —
// with no link and no price list — and the owner copies each one into a few groups (about 5 minutes a day). People
// who want the part write in the comments / inbox, and the owner sends the link there. The tips and questions are
// the same hand-checked ones the page's engagement posts use (lib/data/fbcontent.ts); projects come from the shop's
// own project kits. Nothing here is AI-written, so nothing untrue can slip in.
//
// Marketplace helper: Facebook doesn't let programs post on Marketplace for a personal profile (a bot there risks the
// owner's whole Facebook account), so the shop prepares each listing — title, price, text, the watermarked pictures
// and a ready reply with the product link — and the owner posts it by hand. Listings are renewed after 7 days.
import * as db from '../db';
import * as md from '../views/md';
import { bn } from '../util';
import * as C from '../data/fbcontent';
import { cleanName } from './seo';
import { copies } from './dupcanon';
import { ELIGIBLE, dhakaNow, siteBase } from './autopost';
import * as $kits from '../models/kits';
import type { Settings } from '../types';
import type { GroupPostsRow, ProductsRow } from '../data/rows';

const money = (n: number) => '৳' + bn(Math.round(Number(n) || 0).toLocaleString('en-IN'));
const shortName = (n: string, max = 70) => { const x = cleanName(n); return x.length > max ? x.slice(0, max).replace(/\s+\S*$/, '') + '…' : x; };

/** the week's order of posts: tips most days, a project idea and a question in between */
export const WEEK_PLAN = ['tip', 'kit', 'tip', 'question', 'tip', 'kit', 'question'] as const;
export const RENEW_DAYS = 7;

/** The Friday (Dhaka time) a week's posts start on, as YYYY-MM-DD. A new batch comes every Friday. */
export function weekOf(d = new Date()): string {
  const { day, weekday } = dhakaNow(d);
  const back = (weekday - 5 + 7) % 7;
  const t = new Date(day + 'T00:00:00Z');
  t.setUTCDate(t.getUTCDate() - back);
  return t.toISOString().slice(0, 10);
}

/** the list item used longest ago in group posts (never-used first) */
async function freshIndex(kind: string, length: number, taken: Set<string>): Promise<number | null> {
  const used = await db.q<{ ref: string; at: Date }>(`SELECT ref, max(created_at) AS at FROM group_posts WHERE kind=$1 GROUP BY ref`, [kind]).catch(() => []);
  const at = new Map(used.map((r) => [String(r.ref), new Date(r.at).getTime()]));
  const order = [...Array(length).keys()].filter((i) => !taken.has(`${kind}:${i}`))
    .sort((a, b) => (at.get(String(a)) || 0) - (at.get(String(b)) || 0) || a - b);
  return order.length ? order[0] : null;
}

/** a product of the shop that fits a tip (for the picture and the "parts for this" line) */
// The tip's words go from most to least exact ('7805' before 'regulator'), so they are tried one by one: a product
// with the model number wins over one that only shares a general word (a motor speed controller is not an LM7805).
// An English word must be a whole word ('led' is not in 'controlled'); model numbers and Bangla words may sit inside.
async function productFor(words?: string[] | null) {
  for (const w of words || []) {
    const word = String(w).replace(/[%_\\]/g, '').trim();
    if (word.length < 3) continue;
    const whole = /^[a-z]+$/i.test(word);
    const p = await db.one<Pick<ProductsRow, 'id' | 'name' | 'image_id'>>(`SELECT p.id, p.name, p.image_id FROM products p WHERE ${ELIGIBLE}
      AND ${whole ? `p.name ~* ('(^|[^a-z0-9])' || $1 || '([^a-z0-9]|$)')` : `p.name ILIKE ('%' || $1 || '%')`}
      ORDER BY coalesce(p.sold_count,0) DESC, length(p.name), p.id LIMIT 1`, [word]).catch(() => null);
    if (p) return p;
  }
  return null;
}

/** which kind of Facebook groups a post suits (shown next to it; the owner searches these on Facebook) */
function groupsFor(kind: string, text: string): string {
  if (/রিমোট|টিভি|এসি/.test(text)) return 'TV / AC repair groups, mobile & electronics servicing groups';
  if (kind === 'kit') return 'Arduino, robotics & project groups, polytechnic / engineering student groups';
  if (kind === 'question') return 'Electronics hobby groups, Arduino Bangladesh groups';
  return 'Electronics hobby groups, Arduino & robotics groups, technician groups';
}

type Built = { kind: string; ref: string; body: string; image_id: number | null; groups: string };

async function buildTip(taken: Set<string>): Promise<Built | null> {
  const i = await freshIndex('tip', C.TIPS.length, taken);
  if (i === null) return null;
  const tip = C.TIPS[i];
  const p = await productFor(tip.find);
  const body = ['💡 ইলেকট্রনিক্স টিপস', '', tip.t, '',
    p ? `🔧 এই কাজে যে পার্টস লাগে: ${shortName(p.name)}। লাগলে ইনবক্স করুন।` : null,
    p ? '' : null, 'আপনার অভিজ্ঞতা বা প্রশ্ন কমেন্টে লিখুন। 👇'].filter((l) => l !== null).join('\n').replace(/\n{3,}/g, '\n\n');
  return { kind: 'tip', ref: String(i), body, image_id: p ? p.image_id : null, groups: groupsFor('tip', tip.t) };
}

async function buildQuestion(taken: Set<string>): Promise<Built | null> {
  const i = await freshIndex('question', C.QUESTIONS.length, taken);
  if (i === null) return null;
  return { kind: 'question', ref: String(i), body: C.QUESTIONS[i], image_id: null, groups: groupsFor('question', C.QUESTIONS[i]) };
}

async function buildKit(taken: Set<string>): Promise<Built | null> {
  const kits = await db.q<{ id: number; slug: string; at: Date | null }>(`SELECT k.id, k.slug,
      (SELECT max(g.created_at) FROM group_posts g WHERE g.kind='kit' AND g.ref=k.id::text) AS at
    FROM kits k WHERE k.active AND k.steps <> ''
      AND EXISTS (SELECT 1 FROM kit_items i JOIN products p ON p.id=i.product_id WHERE i.kit_id=k.id AND p.active)`).catch(() => []);
  const pick = kits.filter((k) => !taken.has(`kit:${k.id}`))
    .sort((a, b) => (a.at ? new Date(a.at).getTime() : 0) - (b.at ? new Date(b.at).getTime() : 0) || a.id - b.id)[0];
  if (!pick) return null;
  const kit = await $kits.forShop(pick.slug).catch(() => null);
  if (!kit || !kit.items.length) return null;
  const need = kit.items.filter((i) => !i.optional);
  if (!need.length) return null;
  const total = need.reduce((t: number, i) => t + Number(i.product.price) * i.qty, 0);
  const about = md.plain(kit.description || '', 300).replace(/\s+/g, ' ').trim();
  const body = [`🛠️ প্রজেক্ট আইডিয়া: ${kit.title}`, '',
    about || null, about ? '' : null,
    '🔩 যা যা লাগবে:', ...need.slice(0, 8).map((i) => `• ${shortName(i.product.name, 60)}${i.qty > 1 ? ` × ${bn(i.qty)}` : ''}`),
    need.length > 8 ? `• …আরও ${bn(need.length - 8)}টা` : null, '',
    `💰 সব পার্টস মিলিয়ে খরচ প্রায় ${money(total)}`, '',
    'বানানোর ধাপগুলো লাগলে কমেন্টে "ধাপ" লিখুন, শেয়ার করে দেব। 👇'].filter((l) => l !== null).join('\n').replace(/\n{3,}/g, '\n\n');
  const photo = kit.image_id || (need.find((i) => i.product.image_id) || { product: { image_id: null } }).product.image_id || null;
  return { kind: 'kit', ref: String(kit.id), body, image_id: photo, groups: groupsFor('kit', '') };
}

async function build(kind: string, taken: Set<string>): Promise<Built | null> {
  if (kind === 'kit') return (await buildKit(taken)) || buildTip(taken);
  if (kind === 'question') return (await buildQuestion(taken)) || buildTip(taken);
  return (await buildTip(taken)) || buildQuestion(taken);
}

/** This week's posts, made the first time they are asked for. `fresh` replaces the ones not posted yet. */
export async function week({ fresh = false }: { fresh?: boolean } = {}): Promise<GroupPostsRow[]> {
  const wk = weekOf();
  if (fresh) await db.q(`DELETE FROM group_posts WHERE week=$1 AND posted_at IS NULL`, [wk]);
  const have = await db.q<GroupPostsRow>(`SELECT * FROM group_posts WHERE week=$1 ORDER BY place`, [wk]);
  const places = new Set(have.map((r) => r.place));
  if (places.size < WEEK_PLAN.length) {
    const taken = new Set(have.map((r) => `${r.kind}:${r.ref}`));
    for (let place = 1; place <= WEEK_PLAN.length; place++) {
      if (places.has(place)) continue;
      const b = await build(WEEK_PLAN[place - 1], taken);
      if (!b) continue;
      taken.add(`${b.kind}:${b.ref}`);
      await db.q(`INSERT INTO group_posts(week, place, kind, ref, body, image_id, groups) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (week, place) DO NOTHING`,
        [wk, place, b.kind, b.ref, b.body, b.image_id, b.groups]);
    }
    return db.q<GroupPostsRow>(`SELECT * FROM group_posts WHERE week=$1 ORDER BY place`, [wk]);
  }
  return have;
}

/** the owner ticked a post as posted (or took the tick back) */
export async function markPosted(id: number, posted: boolean): Promise<void> {
  await db.q(`UPDATE group_posts SET posted_at=${posted ? 'now()' : 'NULL'} WHERE id=$1`, [id]);
}

// ================================================================ 🏷️ Marketplace helper
export type MarketItem = Pick<ProductsRow, 'id' | 'name' | 'slug' | 'price' | 'old_price' | 'stock' | 'image_id' | 'short_description' | 'description'>
  & { sold: number; posted_at: Date | null; times: number; images: number[]; due: boolean };

/** Products worth listing today: listings due for renewal first, then good never-listed products (sell well, in
 *  stock, offers first). Copies of the same product ("…-2") are left out. */
export async function picks(limit = 10): Promise<{ items: MarketItem[]; listed: number; due: number }> {
  const rows = await db.q<Omit<MarketItem, 'images' | 'due'> & { featured: boolean }>(`SELECT p.id, p.name, p.slug, p.price, p.old_price, p.stock, p.image_id,
      p.short_description, p.description, coalesce(p.sold_count,0)::int AS sold, coalesce(p.featured,false) AS featured, m.posted_at, coalesce(m.times,0)::int AS times
    FROM products p LEFT JOIN marketplace_posts m ON m.product_id=p.id WHERE ${ELIGIBLE}`);
  const dupes = await copies().catch(() => new Map<string, string>());
  const now = Date.now();
  const all = rows.filter((p) => !dupes.has(p.slug)).map((p) => ({ ...p, due: !!p.posted_at && now - new Date(p.posted_at).getTime() >= RENEW_DAYS * 864e5 }));
  const listed = all.filter((p) => p.posted_at).length;
  const dueList = all.filter((p) => p.due).sort((a, b) => new Date(a.posted_at!).getTime() - new Date(b.posted_at!).getTime());
  const score = (p: typeof all[number]) => Math.min(p.sold, 30) / 3 + (Number(p.old_price) > p.price ? 3 : 0) + (p.featured ? 2 : 0) + Math.min(p.stock, 20) / 10;
  const fresh = all.filter((p) => !p.posted_at).sort((a, b) => score(b) - score(a) || a.id - b.id);
  const chosen = [...dueList, ...fresh].slice(0, limit);
  const pics = chosen.length ? await db.q<{ owner_id: number; id: number }>(`SELECT owner_id, id FROM media WHERE owner_type='product' AND owner_id = ANY($1::int[]) ORDER BY sort, id`, [chosen.map((p) => p.id)]) : [];
  const byProduct = new Map<number, number[]>();
  for (const m of pics) { const l = byProduct.get(m.owner_id) || []; if (l.length < 6) l.push(m.id); byProduct.set(m.owner_id, l); }
  const items: MarketItem[] = chosen.map((p) => {
    const imgs = byProduct.get(p.id) || [];
    return { id: p.id, name: p.name, slug: p.slug, price: p.price, old_price: p.old_price, stock: p.stock, image_id: p.image_id,
      short_description: p.short_description, description: p.description, sold: p.sold, posted_at: p.posted_at, times: p.times, due: p.due,
      images: imgs.length ? imgs : p.image_id ? [p.image_id] : [] };
  });
  return { items, listed, due: dueList.length };
}

/** The listing title (Marketplace shows about 100 characters). */
export function listingTitle(p: Pick<ProductsRow, 'name'>): string { return shortName(p.name, 95); }

/** The listing's description: what it is, price, delivery, and that the shop has much more (no link: Marketplace
 *  hides listings with outside links; the link goes in the reply). */
export function listingText(p: Pick<ProductsRow, 'name' | 'price' | 'old_price' | 'stock' | 'short_description' | 'description'>, settings: Settings): string {
  let about = md.plain(p.short_description || p.description || '', 500).replace(/\s+/g, ' ').trim();
  const flat = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  if (flat(about) === flat(cleanName(p.name)) || flat(about).length < 15) about = '';
  if (about.length > 400) about = about.slice(0, 400).replace(/\s+\S*$/, '') + '…';
  const old = Number(p.old_price);
  const dhaka = Number(settings.delivery_dhaka) || 60;
  const outside = Number(settings.delivery_outside) || 110;
  return [
    `${cleanName(p.name)}`, '',
    old > p.price ? `💰 দাম: ${money(p.price)} (আগে ${money(old)})` : `💰 দাম: ${money(p.price)}`,
    '✅ নতুন পণ্য, স্টকে আছে', '',
    about || null, about ? '' : null,
    `🚚 সারা বাংলাদেশে হোম ডেলিভারি (ঢাকায় ${money(dhaka)}, ঢাকার বাইরে ${money(outside)})`,
    '💵 ক্যাশ অন ডেলিভারি — পণ্য হাতে পেয়ে টাকা',
    `📦 এরকম ৫০০+ ইলেকট্রনিক্স পার্টস, রিমোট আর গ্যাজেট আমাদের কাছে আছে। দরকার হলে ইনবক্স করুন।`,
  ].filter((l) => l !== null).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** The reply to send when someone messages about the listing: the product link (tracked as Marketplace). */
export function replyText(p: Pick<ProductsRow, 'slug'>, settings: Settings): string {
  const base = siteBase(settings);
  return `জি, আছে। 😊 অর্ডার করতে আর আমাদের আরও পণ্য দেখতে এখানে যান: ${base}/p/${encodeURIComponent(p.slug)}?utm_source=marketplace&utm_medium=social&utm_campaign=marketplace\n\nক্যাশ অন ডেলিভারি, সারা দেশে হোম ডেলিভারি।`;
}

/** the owner listed (or renewed) a product on Marketplace */
export async function markListed(productId: number): Promise<void> {
  await db.q(`INSERT INTO marketplace_posts(product_id) VALUES($1) ON CONFLICT (product_id) DO UPDATE SET posted_at=now(), times=marketplace_posts.times+1`, [productId]);
}
