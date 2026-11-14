// 🚀 ল্যান্ডিং পেজ (owner, 2026-11-15) — one product, one page for ads: /lp/<slug>. The page sells that one product
// (big pictures, headline, benefits, offer with a countdown, video, reviews, questions) and has the shop's own order form
// right on it, so an ad visitor orders without leaving. It stays part of the whole shop: same header, same cart, same
// order rules (delivery, OTP, fraud checks, pixels), and the product's own page stays the one Google indexes.
// Numbers come from the visitor log: a visit that started on /lp/<slug> (visit_sessions.landing) and how many of them
// ordered (visit_sessions.order_code).
import * as db from '../db';
import { str, int, slugify } from '../util';
import * as $catalog from './catalog';
import * as md from '../views/md';
import type { Body, Id } from '../types';
import type { LandingPagesRow, ProductsRow } from '../data/rows';

export class LandingError extends Error {}

export type LandingStats = { visits: number; orders: number; sales: number; visits7: number; orders7: number; top_source: string };
export type LandingListRow = LandingPagesRow & LandingStats & { product_name: string; product_slug: string; price: number; stock: number; image_id: number | null; emoji: string; product_active: boolean };
export type ShopLanding = { page: LandingPagesRow; product: $catalog.FullProduct };

const STATS = `
  (SELECT count(*)::int FROM visit_sessions s WHERE s.landing LIKE '/lp/%' AND split_part(s.landing, '?', 1) = '/lp/' || l.slug AND s.started_at >= l.created_at) AS visits,
  (SELECT count(*)::int FROM visit_sessions s WHERE s.landing LIKE '/lp/%' AND split_part(s.landing, '?', 1) = '/lp/' || l.slug AND s.started_at >= l.created_at AND s.order_code <> '') AS orders,
  (SELECT coalesce(sum(o.total), 0)::float FROM visit_sessions s JOIN orders o ON o.code = s.order_code
     WHERE s.landing LIKE '/lp/%' AND split_part(s.landing, '?', 1) = '/lp/' || l.slug AND s.started_at >= l.created_at AND s.order_code <> '' AND o.status NOT IN ('cancelled', 'returned')) AS sales,
  (SELECT count(*)::int FROM visit_sessions s WHERE s.landing LIKE '/lp/%' AND split_part(s.landing, '?', 1) = '/lp/' || l.slug AND s.started_at >= greatest(l.created_at, now() - interval '7 days')) AS visits7,
  (SELECT count(*)::int FROM visit_sessions s WHERE s.landing LIKE '/lp/%' AND split_part(s.landing, '?', 1) = '/lp/' || l.slug AND s.started_at >= greatest(l.created_at, now() - interval '7 days') AND s.order_code <> '') AS orders7,
  coalesce((SELECT s.source FROM visit_sessions s WHERE s.landing LIKE '/lp/%' AND split_part(s.landing, '?', 1) = '/lp/' || l.slug AND s.started_at >= l.created_at AND s.source <> ''
     GROUP BY s.source ORDER BY count(*) DESC LIMIT 1), '') AS top_source`;

export async function list(): Promise<LandingListRow[]> {
  return db.q<LandingListRow>(`SELECT l.*, p.name AS product_name, p.slug AS product_slug, p.price, p.stock, p.image_id, p.emoji, p.active AS product_active, ${STATS}
    FROM landing_pages l JOIN products p ON p.id = l.product_id ORDER BY l.active DESC, l.id DESC`);
}

export async function get(id: Id): Promise<(LandingPagesRow & { product_name: string; product_slug: string }) | null> {
  return db.one(`SELECT l.*, p.name AS product_name, p.slug AS product_slug FROM landing_pages l JOIN products p ON p.id = l.product_id WHERE l.id = $1`, [int(id)]);
}

/** The shop side: a page that is on, with its product as the shop shows it (flash-sale price counts). */
export async function forShop(slug: string): Promise<ShopLanding | null> {
  const page = await db.one<LandingPagesRow>('SELECT * FROM landing_pages WHERE slug = $1 AND active', [String(slug || '').slice(0, 120)]);
  if (!page) return null;
  const product = await $catalog.getProduct({ id: page.product_id, public: true });
  if (!product || !product.active || product.parent_id) return null;
  return { page, product };
}

/** One benefit per line, "- " or "• " in front or not. */
export function lines(text: unknown, max = 12): string[] {
  return String(text || '').split(/\r?\n/).map((l) => l.replace(/^\s*(?:[-*•✅✔️]+|\d+[.)])\s*/u, '').replace(/\*\*/g, '').trim()).filter(Boolean).slice(0, max);
}
/** "প্রশ্ন | উত্তর" (or "প্রশ্ন? উত্তর") per line. */
export function faqPairs(text: unknown): { q: string; a: string }[] {
  return lines(text, 20).map((l) => {
    const bar = l.indexOf('|');
    if (bar > 0) return { q: l.slice(0, bar).trim(), a: l.slice(bar + 1).trim() };
    const m = l.match(/^(.+?[?？])\s*(.+)$/u);
    return m ? { q: m[1].trim(), a: m[2].trim() } : { q: '', a: '' };
  }).filter((x) => x.q && x.a);
}

/** A fresh page filled from the product: headline = its name, the line under it = its short text, the benefits = the
 *  facts list in its description (the "- …" lines). The owner changes any of it afterwards. */
export function draftFrom(p: Pick<ProductsRow, 'name' | 'short_description' | 'description'>): { headline: string; subhead: string; points: string } {
  const listed = String(p.description || '').split(/\r?\n/).filter((l) => /^\s*[-*•]\s+\S/.test(l));
  return {
    headline: str(p.name, 140),
    subhead: md.plain(p.short_description || p.description || '', 180),
    points: lines(listed.join('\n'), 6).map((x) => str(x, 160)).join('\n'),
  };
}

function endsAt(v: unknown): Date | null {
  const s = String(v || '').trim();
  if (!s) return null;
  // the admin's date-time box: local Bangladesh time (UTC+6)
  const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s}${s.length <= 10 ? 'T23:59' : ''}+06:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function create(productId: Id): Promise<number> {
  const p = await db.one<ProductsRow>('SELECT * FROM products WHERE id = $1', [int(productId)]);
  if (!p) throw new LandingError('পণ্যটা পাওয়া যায়নি।');
  if (p.parent_id) throw new LandingError('মূল পণ্যটা বাছুন (রং/সাইজের আলাদা অপশন নয়)।');
  if (p.product_type === 'bundle') throw new LandingError('বান্ডেলের জন্য ল্যান্ডিং পেজ হয় না — একটা সাধারণ পণ্য বাছুন।');
  const d = draftFrom(p);
  const stem = (slugify(p.slug || p.name) || 'offer').slice(0, 60);
  let slug = stem;
  for (let n = 2; await db.one('SELECT 1 FROM landing_pages WHERE slug = $1', [slug]); n++) slug = `${stem}-${n}`;
  const row = await db.one<{ id: number }>(`INSERT INTO landing_pages(slug, product_id, headline, subhead, points) VALUES($1,$2,$3,$4,$5) RETURNING id`,
    [slug, p.id, d.headline, d.subhead, d.points]);
  return row!.id;
}

export async function save(id: Id, data: Body): Promise<void> {
  const headline = str(data.headline, 140).trim();
  if (headline.length < 3) throw new LandingError('বড় শিরোনামটা লিখুন।');
  let slug = slugify(str(data.slug, 80)) || '';
  if (!slug) throw new LandingError('লিংকের নাম লিখুন (ইংরেজি অক্ষর, যেমন bluetooth-speaker)।');
  if (await db.one('SELECT 1 FROM landing_pages WHERE slug = $1 AND id <> $2', [slug, int(id)])) throw new LandingError(`/lp/${slug} লিংকটা আরেকটা পেজে আছে — অন্য নাম দিন।`);
  slug = slug.slice(0, 80);
  await db.q(`UPDATE landing_pages SET slug=$1, headline=$2, subhead=$3, points=$4, offer=$5, ends_at=$6, faq=$7, video_url=$8, active=$9, updated_at=now() WHERE id=$10`,
    [slug, headline, str(data.subhead, 300), str(data.points, 3000), str(data.offer, 120), endsAt(data.ends_at), str(data.faq, 5000), str(data.video_url, 300).trim(), !!data.active, int(id)]);
}

export async function remove(id: Id): Promise<void> {
  await db.q('DELETE FROM landing_pages WHERE id = $1', [int(id)]);
}

/** Where a visit to one page came from, newest days first (for its edit page). */
export async function sources(slug: string): Promise<{ source: string; visits: number; orders: number }[]> {
  return db.q(`SELECT coalesce(nullif(s.source, ''), 'direct') AS source, count(*)::int AS visits, count(*) FILTER (WHERE s.order_code <> '')::int AS orders
    FROM visit_sessions s JOIN landing_pages l ON l.slug = $1 WHERE s.landing LIKE '/lp/%' AND split_part(s.landing, '?', 1) = '/lp/' || $1 AND s.started_at >= l.created_at
    GROUP BY 1 ORDER BY visits DESC LIMIT 12`, [slug]);
}
