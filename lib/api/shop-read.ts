// 🔌 The shop's read-only APIs the pages and the Android app ask for (cart contents, search suggestions, product cards,
// "আপনার জন্য", offer notifications). Each one is served by its own route in app/api/… (lib/next/api.ts runs the gate).
import * as db from '../db';
import * as catalog from '../models/catalog';
import * as drafts from '../services/drafts';
import * as shop from '../views/shop';
import * as $services_search from '../services/search';
import { loadRenderer, renderHtml } from '../react/render';
import { myOrders } from '../gate';
import { int, str, contact, packSizes } from '../util';
import { allow, json, tooMany, type ApiCtx } from '../next/api';
import type { OrderItemsRow, PushCampaignsRow } from '../data/rows';

const ids = (v: string | null, max: number) => (v || '').split(',').map((x) => int(x)).filter((x) => x > 0).slice(0, max);
// small read-only lists the shop pages ask for: generous limits, only a flood is turned away (one count for all of them)
const readLimit = (ctx: ApiCtx) => allow(ctx, 'readapi:', 600, 600);

/** Product cards as HTML (the pages put them straight into a list). */
async function cardsHtml(prods: Parameters<typeof shop.productCard>[0][], ctx: ApiCtx): Promise<string> {
  await loadRenderer();
  return prods.map((p) => renderHtml(shop.productCard(p, ctx.settings))).join('');
}
const sortLike = <T extends { id: number }>(prods: T[], order: number[]) => {
  const pos = new Map(order.map((id, i) => [id, i]));
  return prods.sort((a, b) => (pos.get(a.id) as number) - (pos.get(b.id) as number));
};

// 🛒 what the cart (kept in the browser) holds, with today's prices and stock
export async function cart(ctx: ApiCtx) {
  if (!(await readLimit(ctx))) return tooMany(ctx);
  const products = await catalog.getProductsByIds(ids(ctx.query.get('ids'), 100), { public: true });
  // 🎨 a colour/size line: its brothers and sisters, so the cart and checkout can switch colour / size right there
  const parents = [...new Set(products.map((p) => p.parent_id).filter((x): x is number => !!x))];
  const sibs = parents.length ? await db.q<{ id: number; parent_id: number; label: string; price: number; stock: number; title: string; dims: string }>(`SELECT v.id, v.parent_id, v.variant_label AS label, v.price, v.stock, v.dims,
      (SELECT pp.variant_title FROM products pp WHERE pp.id=v.parent_id) AS title
    FROM products v WHERE v.parent_id = ANY($1::int[]) AND v.active ORDER BY v.variant_sort, v.id`, [parents]) : [];
  const byParent = new Map<number, typeof sibs>();
  for (const v of sibs) byParent.set(v.parent_id, [...(byParent.get(v.parent_id) || []), v]);
  return json(200, {
    products: products.map((p) => ({
      ...(p.parent_id && (byParent.get(p.parent_id) || []).length > 1 ? {
        vtitle: (byParent.get(p.parent_id) || [])[0].title || '',
        variants: (byParent.get(p.parent_id) || []).map((v) => ({ id: v.id, label: v.label, price: Number(v.price), stock: Number(v.stock), ...(v.dims ? { dims: v.dims } : {}) })),
      } : {}),
      id: p.id, name: p.name, slug: p.slug, price: p.price, stock: p.stock, preorder: !!p.preorder && p.product_type !== 'bundle', preorder_days: p.preorder_days || 0, emoji: p.emoji, sku: p.sku, weight: p.weight_g || 0,
      category: p.category_name || '', image: p.image_id ? `/media/${p.image_id}/t` : null,
      ...(packSizes(p.pack_sizes).length ? { packs: packSizes(p.pack_sizes) } : {}),
    })),
  });
}

// 🔎 instant results under the search box while typing (smart search: spelling mistakes, Bangla)
export async function searchSuggest(ctx: ApiCtx) {
  const q = str(ctx.query.get('q'), 80);
  if (q.length < 2 || ctx.settings.ui_search === '0') return json(200, { products: [] });
  if (!(await allow(ctx, 'ssug:', 300, 3600))) return json(200, { products: [] });
  const found = (await $services_search.find(q, { limit: 60 }).catch(() => [])) || [];
  const rows = found.length ? await catalog.listProducts({ public: true, ids: found, hideOut: ctx.settings.ui_show_out_of_stock === '0', limit: 6 }) : [];
  return json(200, { total: found.length, products: rows.map((p) => ({ name: p.name, slug: p.slug, price: p.price, image: p.image_id ? `/media/${p.image_id}/t` : null, emoji: p.emoji, out: p.stock <= 0 })) },
    { 'Cache-Control': 'public, max-age=60' });
}

// "এর সাথে নিতে পারেন": products bought together with the cart's
export async function suggest(ctx: ApiCtx) {
  if (!(await readLimit(ctx))) return tooMany(ctx);
  const rows = await catalog.crossFor(ids(ctx.query.get('ids'), 50), 6);
  return json(200, { products: rows.map((p) => ({ id: p.id, name: p.name, slug: p.slug, price: p.price, image: p.image_id ? `/media/${p.image_id}/t` : null, emoji: p.emoji })) });
}

// product cards for lists the browser keeps itself (🕘 recently viewed)
export async function cards(ctx: ApiCtx) {
  if (!(await readLimit(ctx))) return tooMany(ctx);
  const want = ids(ctx.query.get('ids'), 24);
  const prods = sortLike(want.length ? (await catalog.getProductsByIds(want, { public: true })).filter((p) => !p.parent_id) : [], want);
  return json(200, { ids: prods.map((p) => p.id), html: await cardsHtml(prods, ctx) });
}

// ✨ "আপনার জন্য": products picked for this shopper from what they viewed, have in the cart and bought before
//    (bought together by other customers first, then popular ones from the same categories)
export async function forYou(ctx: ApiCtx) {
  if (!(await readLimit(ctx))) return tooMany(ctx);
  if (ctx.settings.for_you_on === '0') return json(200, { html: '' });
  const codes = myOrders(ctx.req, ctx.settings);
  const bought = codes.length ? (await db.q<Pick<OrderItemsRow, 'product_id'>>(`SELECT DISTINCT i.product_id FROM order_items i JOIN orders o ON o.id=i.order_id WHERE o.code = ANY($1::text[]) AND i.product_id IS NOT NULL`, [codes])).map((r) => r.product_id) : [];
  const seeds = [...new Set([...ids(ctx.query.get('cart'), 30), ...ids(ctx.query.get('seen'), 30), ...bought])].slice(0, 40);
  if (!seeds.length) return json(200, { html: '' });
  const rows = await db.q<{ id: number; score: number }>(`WITH seed AS (SELECT coalesce(p.parent_id, p.id) AS id, p.category_id FROM products p WHERE p.id = ANY($1::int[])),
      together AS (SELECT coalesce(pp.id, i2.product_id) AS id, count(DISTINCT i2.order_id)::int AS n FROM order_items i1
        JOIN order_items i2 ON i2.order_id=i1.order_id AND i2.product_id <> i1.product_id
        LEFT JOIN products v ON v.id=i2.product_id LEFT JOIN products pp ON pp.id=v.parent_id
        WHERE i1.product_id = ANY($1::int[]) GROUP BY 1),
      cats AS (SELECT category_id, count(*)::int AS w FROM seed WHERE category_id IS NOT NULL GROUP BY 1)
    SELECT p.id, coalesce(t.n, 0) * 10 + coalesce(c.w, 0) * 3 + least(5, coalesce(p.sold_count, 0) / 5.0) AS score
    FROM products p LEFT JOIN together t ON t.id=p.id LEFT JOIN cats c ON c.category_id=p.category_id
    WHERE p.active AND p.parent_id IS NULL AND NOT (p.id IN (SELECT id FROM seed)) AND (t.id IS NOT NULL OR c.category_id IS NOT NULL)
      AND (p.stock > 0 OR p.product_type='bundle' OR p.variant_count > 0)
    ORDER BY score DESC, p.sold_count DESC, p.id DESC LIMIT 8`, [seeds]);
  const picked = rows.map((r) => r.id);
  const prods = sortLike(picked.length ? await catalog.getProductsByIds(picked, { public: true }) : [], picked);
  return json(200, { html: await cardsHtml(prods, ctx) });
}

// 📩 the reminder SMS link: put the same products (and name / number) back into the checkout
export async function resume(ctx: ApiCtx) {
  if (!(await allow(ctx, 'resume:', 30, 3600))) return json(429, {});
  const r = await drafts.resume(ctx.query.get('id'));
  return json(200, r ? { ok: true, ...r } : { ok: false });
}

// 🔔 the customer Android app asks every ~30 min: "any new offer notification?" (same ones the owner sends from Admin)
export async function appOffers(ctx: ApiCtx) {
  const after = Math.max(0, int(ctx.query.get('after')) || 0);
  const last = await db.one<{ id: number }>('SELECT COALESCE(max(id),0)::int AS id FROM push_campaigns');
  let items: unknown[] = [];
  if (ctx.settings.shoppush_on === '1' && after > 0) {
    // only the newest one, and only if it is fresh — never a pile of old offers
    items = (await db.q<Pick<PushCampaignsRow, 'id' | 'title' | 'body' | 'url' | 'image_id'>>(`SELECT id, title, body, url, image_id FROM push_campaigns WHERE id > $1 AND created_at > now() - interval '2 days' ORDER BY id DESC LIMIT 1`, [after]))
      .map((c) => ({ id: c.id, title: c.title, body: c.body, url: c.url || '/', image: c.image_id ? `/media/${c.image_id}` : '' }));
  }
  return json(200, { latest: last!.id, items });
}

// 📥 Android app's ইনবক্স tab: the shop's recent offer messages + how to reach the shop
export async function appInbox(ctx: ApiCtx) {
  const s = ctx.settings;
  const rows = await db.q<Pick<PushCampaignsRow, 'id' | 'title' | 'body' | 'url' | 'image_id' | 'created_at'>>(`SELECT id, title, body, url, image_id, created_at FROM push_campaigns WHERE created_at > now() - interval '30 days' ORDER BY id DESC LIMIT 30`);
  const C = contact(s);
  return json(200, {
    shop: s.store_name || '',
    phone: C.phone || '',
    wa: C.wa && C.wa.length >= 11 ? C.wa : '',
    messenger: /^[\w.-]{1,80}$/.test(String(s.chat_messenger_page || '')) ? 'https://m.me/' + s.chat_messenger_page : '',
    items: rows.map((c) => ({ id: c.id, title: c.title, body: c.body, url: c.url || '/', image: c.image_id ? `/media/${c.image_id}/t` : '', at: c.created_at })),
  });
}
