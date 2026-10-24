// 🖼️ Pictures, robots.txt, the sitemap, product feeds, the e-mail counters and "leave the e-mail list", and the two
// scheduled jobs — each served by its own Next.js route (app/media, app/robots.txt, app/sitemap.xml, app/feeds,
// app/e, app/unsubscribe, app/api/*/tick). lib/next/api.ts runs the shop's gate first. Moved from lib/site.ts unchanged.
import * as db from '../db';
import * as catalog from '../models/catalog';
import * as feeds from '../services/feeds';
import * as seo from '../services/seo';
import * as dupcanon from '../services/dupcanon';
import * as security from '../security';
import * as $models_extras from '../models/extras';
import * as $services_imagekit from '../services/imagekit';
import * as $services_mailer from '../services/mailer';
import * as $services_health from '../services/health';
import * as $services_autobackup from '../services/autobackup';
import * as $services_research from '../services/research';
import * as $services_autoseo from '../services/autoseo';
import * as $services_autopost from '../services/autopost';
import * as $services_fbreply from '../services/fbreply';
import * as $services_telegram from '../services/telegram';
import * as $services_autoblog from '../services/autoblog';
import { siteUrl, blockedBots } from '../gate';
import { int, str, esc } from '../util';
import { allow, json, tooMany, type ApiCtx } from '../next/api';
import type { Body } from '../types';
import type { BlogPostsRow, BrandsRow, CategoriesRow, KitsRow, MediaRow, PagesRow, ProductsRow } from '../data/rows';

/** The original code's plain answer: its type, never kept unless said, the shop's security headers. */
function text(status: number, body: BodyInit | null, type = 'text/html; charset=utf-8', extra: Record<string, string> = {}): Response {
  return new Response(body, { status, headers: { 'Content-Type': type, 'Cache-Control': 'no-store', ...security.BASE_HEADERS, ...extra } });
}
/** "See over there" (303), never kept. */
const seeOther = (to: string) => new Response(null, { status: 303, headers: { Location: to, 'Cache-Control': 'no-store' } });
const notFound = () => text(404, 'Not found', 'text/plain');
const SAFE_IMAGE = /^image\/(jpeg|png|webp|gif|x-icon)$/;
const bytes = (b: Uint8Array | null | undefined) => (b ? new Uint8Array(b) : null);

// ---------------------------------------------------------------- pictures
// A picture on ImageKit: send the visitor straight there (fast CDN). raw=1 (admin tools that read the
// pixels) gets the bytes through this site instead, because browsers only allow that for same-site pictures.
async function fromImageKit(url: string, mime: string, raw: boolean): Promise<Response> {
  if (!raw) {
    // s-maxage: Vercel's CDN keeps the redirect too, so a new visitor's pictures don't each wake the server and database
    return new Response(null, { status: 302, headers: { Location: url, 'Cache-Control': 'public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800', 'X-Content-Type-Options': 'nosniff' } });
  }
  const r = await fetch(url, { signal: AbortSignal.timeout(12000) }).catch(() => null);
  if (!r || !r.ok) return text(502, 'Picture not reachable', 'text/plain');
  // never kept by the browser: the admin draws watermarks from this, and an old copy must never be reused
  return new Response(await r.arrayBuffer(), { status: 200, headers: { 'Content-Type': SAFE_IMAGE.test(mime) ? mime : 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox" } });
}

/** /media/<id> and /media/<id>/t (the small one). */
export function media(thumb: boolean) {
  return async (ctx: ApiCtx) => {
    const id = int(ctx.path.split('/')[2]);
    const raw = ctx.query.get('raw') === '1';
    const m = await catalog.getMedia(id, thumb);
    if (!m) return notFound();
    if (m.ik_url) return fromImageKit(thumb ? String($services_imagekit.thumbUrl(m.ik_url, !raw)) : m.ik_url, m.mime, raw);
    return new Response(bytes(m.data), { status: 200, headers: { 'Content-Type': SAFE_IMAGE.test(m.mime) ? m.mime : 'application/octet-stream', 'Cache-Control': 'public, max-age=31536000, s-maxage=31536000, immutable', 'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox" } });
  };
}

/** /media/<id>/w — the product page's big picture with the shop's watermark. Until the marked copy is ready the
 *  normal picture is sent, and only cached briefly so the marked one shows up soon. */
export async function mediaWatermarked(ctx: ApiCtx) {
  const id = int(ctx.path.split('/')[2]);
  const raw = ctx.query.get('raw') === '1';
  const settings = ctx.settings;
  const ver = settings.wm_on === '1' ? String(settings.wm_ver || '') : '';
  const m: Pick<MediaRow, 'mime' | 'data' | 'ik_url'> & Partial<Pick<MediaRow, 'wm' | 'wm_url'>> | null = ver ? await catalog.getWatermarked(id, ver) : await catalog.getMedia(id, false);
  if (!m) return notFound();
  if (m.wm_url) return fromImageKit(m.wm_url, 'image/jpeg', raw);
  if (!m.wm && m.ik_url) return fromImageKit(m.ik_url, m.mime, raw);
  const ready = !!(ver && m.wm);
  const type = ready ? 'image/jpeg' : SAFE_IMAGE.test(m.mime) ? m.mime : 'application/octet-stream';
  return new Response(bytes(ready ? m.wm : m.data), { status: 200, headers: { 'Content-Type': type, 'Cache-Control': ready ? 'public, max-age=31536000, s-maxage=31536000, immutable' : 'public, max-age=120, s-maxage=60', 'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox" } });
}

/** /img/p/<product id> — a product's main picture (old links). */
export async function productImage(ctx: ApiCtx) {
  const p = await db.one<Pick<ProductsRow, 'image_id'>>('SELECT image_id FROM products WHERE id=$1', [int(ctx.path.split('/')[3])]);
  return p && p.image_id ? seeOther(`/media/${p.image_id}`) : notFound();
}

// ---------------------------------------------------------------- crawlers
// Robots: Google, Bing, Facebook, TikTok … are welcome on the shop (that is how customers find it).
// Private parts are always closed. Optionally (Admin → গ্রোথ গাইড), competitor SEO-spy tools and
// AI-training copiers are told to stay away — they never bring customers, so this costs no sales.
export async function robots(ctx: ApiCtx) {
  const base = siteUrl(ctx.req, ctx.settings);
  const closed = blockedBots(ctx.settings).map((b) => `User-agent: ${b}\nDisallow: /\n`).join('\n');
  return text(200, `${closed ? closed + '\n' : ''}User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /cart\nDisallow: /checkout\nDisallow: /order/\nDisallow: /api/\nDisallow: /pay/\nDisallow: /track\nDisallow: /*?q=\nDisallow: /*&q=\n\nSitemap: ${base}/sitemap.xml\n`,
    'text/plain; charset=utf-8', { 'Cache-Control': 'public, max-age=3600' });
}

export async function sitemap(ctx: ApiCtx) {
  const settings = ctx.settings;
  const base = siteUrl(ctx.req, settings);
  const [products, categories, posts, pages, brands] = await Promise.all([
    db.q<Pick<ProductsRow, 'slug' | 'updated_at' | 'image_id' | 'name'>>('SELECT slug, updated_at, image_id, name FROM products WHERE active AND NOT noindex AND parent_id IS NULL ORDER BY id'),
    db.q<Pick<CategoriesRow, 'slug'>>('SELECT slug FROM categories WHERE coalesce(active,true) AND NOT noindex ORDER BY sort'),
    db.q<Pick<BlogPostsRow, 'slug' | 'updated_at'>>(`SELECT slug, updated_at FROM blog_posts WHERE status='published' AND published_at <= now()`),
    db.q<Pick<PagesRow, 'slug' | 'updated_at'>>('SELECT slug, updated_at FROM pages WHERE active'),
    db.q<Pick<BrandsRow, 'slug'>>('SELECT b.slug FROM brands b WHERE b.active AND NOT b.noindex AND EXISTS (SELECT 1 FROM products p WHERE p.brand_id=b.id AND p.active) ORDER BY b.sort, b.id'),
  ]);
  // 🧰 project kits / guides (when the kit pages are switched on)
  const kits = settings.kits_on !== '0' ? await db.q<Pick<KitsRow, 'slug' | 'updated_at' | 'image_id'>>('SELECT slug, updated_at, image_id FROM kits WHERE active ORDER BY sort, id').catch(() => []) : [];
  // the same product listed twice: only its main page goes to Google
  const dupSlugs = await dupcanon.copies().catch(() => new Map());
  const u = (loc: string, lastmod: string | number | Date | null, pri: string, img?: string | undefined) => `<url><loc>${esc(base + loc)}</loc>${lastmod ? `<lastmod>${new Date(lastmod).toISOString().slice(0, 10)}</lastmod>` : ''}${pri ? `<priority>${pri}</priority>` : ''}${img ? `<image:image><image:loc>${esc(base + img)}</image:loc></image:image>` : ''}</url>`;
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">${[
    u('/', null, '1.0'), u('/products', null, '0.9'), u('/blog', null, '0.5'),
    ...categories.map((c) => u(`/products?cat=${encodeURIComponent(c.slug)}`, null, '0.8')),
    ...brands.map((b) => u(`/brand/${encodeURIComponent(b.slug)}`, null, '0.6')),
    ...products.filter((p) => !dupSlugs.has(p.slug)).map((p) => u(`/p/${encodeURIComponent(p.slug)}`, p.updated_at, '0.7', p.image_id ? `/media/${p.image_id}` : '')),
    ...posts.map((p) => u(`/blog/${encodeURIComponent(p.slug)}`, p.updated_at, '0.5')),
    ...pages.map((p) => u(`/page/${encodeURIComponent(p.slug)}`, p.updated_at, '0.3')),
    ...(kits.length ? [u('/kits', null, '0.6')] : []),
    ...kits.map((k) => u(`/kit/${encodeURIComponent(k.slug)}`, k.updated_at, '0.7', k.image_id ? `/media/${k.image_id}` : '')),
  ].join('')}</urlset>`;
  return text(200, xml, 'application/xml; charset=utf-8', { 'Cache-Control': 'public, max-age=3600' });
}

/** /feeds/google.xml … — product feeds for Google Merchant Center / Facebook catalog (services/feeds.ts). */
export async function feed(ctx: ApiCtx) {
  const m = ctx.path.match(/^\/feeds\/(google|facebook)\.(xml|csv|tsv)$/)!;
  let out: Response = notFound();
  const send = (status: number, body: string, type?: string, extra: Record<string, string> = {}) => { out = text(status, body, type, extra); };
  await feeds.serve({ req: ctx.req, query: ctx.query, settings: ctx.settings, send, siteUrl: siteUrl(ctx.req, ctx.settings) }, m[1], m[2]);
  return out;
}

// ---------------------------------------------------------------- 📧 the e-mail list
const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

/** /e/o/<log id>/<mark>.gif — a mail was opened (the tiny picture in each mail). */
export async function mailOpened(ctx: ApiCtx) {
  const m = ctx.path.match(/^\/e\/o\/(\d{1,15})\/([A-Za-z0-9_-]{16})\.gif$/)!;
  if ($services_mailer.macOk(ctx.settings, m[1], m[2])) {
    db.q('UPDATE email_log SET opened_at=coalesce(opened_at, now()) WHERE id=$1', [int(m[1])]).catch(() => {});
    db.q('UPDATE email_subs SET last_open_at=now() WHERE id=(SELECT sub_id FROM email_log WHERE id=$1)', [int(m[1])]).catch(() => {});
  }
  return text(200, new Uint8Array(GIF), 'image/gif', { 'Cache-Control': 'no-store, private' });
}

/** /e/c/<log id>/<mark>?u=/… — a link in a mail was pressed: counted, then on to the shop's page. */
export async function mailClicked(ctx: ApiCtx) {
  const m = ctx.path.match(/^\/e\/c\/(\d{1,15})\/([A-Za-z0-9_-]{16})$/)!;
  const to = String(ctx.query.get('u') || '/');
  const safe = to.startsWith('/') && !to.startsWith('//') && !to.includes('\\') ? to.slice(0, 400) : '/';
  if ($services_mailer.macOk(ctx.settings, `${m[1]}:${to}`, m[2])) {
    db.q('UPDATE email_log SET clicked_at=coalesce(clicked_at, now()), opened_at=coalesce(opened_at, now()) WHERE id=$1', [int(m[1])]).catch(() => {});
  }
  return seeOther(safe);
}

/** /unsubscribe?t=… — leave the offer list (a mail scanner opening the link changes nothing: the person presses the button). */
export async function unsubscribe(ctx: ApiCtx) {
  const M = $services_mailer;
  const settings = ctx.settings;
  const t = str(ctx.query.get('t'), 60);
  const page = (title?: unknown, msg?: unknown, extra = '') => text(200, `<!doctype html><html lang="bn"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title><body style="font-family:'Hind Siliguri',sans-serif;max-width:480px;margin:60px auto;padding:0 18px;text-align:center;color:#14213d"><div style="font-size:46px">📧</div><h1 style="font-size:22px">${esc(title)}</h1><p style="color:#5b6475;line-height:1.7">${msg}</p>${extra}<p><a href="/" style="display:inline-block;margin-top:14px;background:#0866D6;color:#fff;text-decoration:none;padding:11px 24px;border-radius:10px">দোকানে যান</a></p></body></html>`, 'text/html; charset=utf-8', { 'X-Robots-Tag': 'noindex' });
  if (ctx.request.method === 'POST') {
    // Gmail's one-click "Unsubscribe" button (RFC 8058) and the button on this page both POST here
    if (!(await allow(ctx, 'unsub:', 30, 3600))) return tooManyPage(ctx);
    const b: Body = await ctx.body().catch(() => ({}));
    const tok = t || str(b.t, 60);
    if (str(b.again, 2) === '1') {
      const sub = await M.bySubToken(tok);
      if (sub) await M.addSub(sub.email, { explicit: true, source: sub.source });
      return page('আবার তালিকায় যোগ হলেন', '✅ ধন্যবাদ! আবার অফারের খবর পাবেন।');
    }
    const r = await M.unsubscribe(tok);
    if (!r) return page('লিংকটা ঠিক নেই', 'এই লিংকটা কাজ করছে না। ইমেইলের নিচের লিংকটা আবার চাপুন।');
    return page('তালিকা থেকে বাদ দেওয়া হলো', `<b>${esc(r.email)}</b> ঠিকানায় আর অফারের ইমেইল যাবে না। অর্ডারের দরকারি ইমেইল আগের মতোই যাবে।`,
      `<form method="post" action="/unsubscribe?t=${encodeURIComponent(tok)}"><input type="hidden" name="again" value="1"><button style="background:none;border:0;color:#0866D6;text-decoration:underline;cursor:pointer;font:inherit">ভুল করে চেপেছি — আবার ইমেইল চাই</button></form>`);
  }
  const sub = await M.bySubToken(t);
  if (!sub) return page('লিংকটা ঠিক নেই', 'এই লিংকটা কাজ করছে না। ইমেইলের নিচের লিংকটা আবার চাপুন।');
  if (!sub.on_list) return page('আপনি তালিকায় নেই', `<b>${esc(sub.email)}</b> ঠিকানায় অফারের ইমেইল আগেই বন্ধ করা হয়েছে।`);
  return page('অফারের ইমেইল বন্ধ করবেন?', `<b>${esc(sub.email)}</b> ঠিকানায় ${esc(settings.store_name || '')}-এর অফার ও নতুন পণ্যের ইমেইল আর যাবে না।`,
    `<form method="post" action="/unsubscribe?t=${encodeURIComponent(t)}"><button style="background:#e11d48;color:#fff;border:0;padding:12px 26px;border-radius:10px;font:inherit;cursor:pointer">হ্যাঁ, বন্ধ করুন</button></form>`);
}
// the original code's "wait a little" page (as HTML here, not JSON)
function tooManyPage(ctx: ApiCtx): Response {
  const r = tooMany(ctx); // (notes it for the security watch)
  return text(429, '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>একটু অপেক্ষা করুন</title><body style="font-family:sans-serif;padding:40px;text-align:center"><h1>একটু অপেক্ষা করুন</h1><p>অনেক বেশি চেষ্টা হয়েছে। কিছুক্ষণ পর আবার চেষ্টা করুন।</p><p><a href="/">হোমে ফিরে যান</a></p></body>', 'text/html; charset=utf-8', { 'Retry-After': r.headers.get('Retry-After') || '120' });
}

// ---------------------------------------------------------------- the scheduled jobs
// Market research (GitHub every hour, Vercel cron daily) and the shop's own daily backup (Vercel cron). Safe to call
// by anyone: they do nothing unless one is due; one connection may knock only a few times an hour.
export async function backupTick(ctx: ApiCtx) {
  if (!(await allow(ctx, 'tick:', 30, 3600))) return json(429, { ok: false });
  let r: Record<string, unknown> = {};
  try { r = await $services_autobackup.run(); } catch (_) { r = {}; }
  await $services_health.checkAndAlert(ctx.settings);
  return json(200, { ok: true, done: !!r.ok });
}
export async function researchTick(ctx: ApiCtx) {
  if (!(await allow(ctx, 'tick:', 30, 3600))) return json(429, { ok: false });
  const settings = ctx.settings;
  let r: Record<string, unknown> = {};
  try { r = await $services_research.tick(); } catch (_) { r = {}; }
  try { const ik = $services_imagekit; await ik.moveOld(db, 10); await ik.flushTrash(db, 30); } catch (_) { /* next time */ }
  try { await $models_extras.restockSweep(settings); } catch (_) { /* next time */ }
  try { await seo.indexNowSweep(settings); } catch (_) { /* next hour */ }
  // 🤖 অটো SEO: model numbers and specifications for a few dozen products, and the daily score
  try { await $services_autoseo.sweep(settings); } catch (e) { console.error('autoseo', (e as Error).message); }
  // 🤖 অটো মার্কেটিং: the day's Facebook / Instagram post at the owner's hours, and the weekly price-list articles
  try { await $services_autopost.tick(settings); } catch (e) { console.error('autopost', (e as Error).message); }
  // 💬 "দাম কত?" under the page's posts → price + order link in the comment (every ~10 minutes, when switched on)
  try { await $services_fbreply.run(settings); } catch (e) { console.error('fbreply', (e as Error).message); }
  // ✈️ the same daily posts to the shop's Telegram channel (when one is connected)
  try { await $services_telegram.tick(settings); } catch (e) { console.error('telegram', (e as Error).message); }
  try { await $services_autoblog.run(settings, { max: 1 }); } catch (e) { console.error('autoblog', (e as Error).message); }
  // 📧 ইমেইল মার্কেটিং: welcome / review / weekly new products / campaigns / 'we miss you' (within the day's allowance)
  try { await $services_mailer.tick(settings); } catch (e) { console.error('mailer', (e as Error).message); }
  try { await $services_autobackup.run(); } catch (_) { /* the daily one will try again */ }
  return json(200, { ok: true, done: !r.skipped && !r.idle });
}

/** /api/aistaff/tick (app/api/aistaff/tick, called every few minutes by .github/workflows/market-research.yml):
 *  🤖 AI স্টাফ — the day's whole-shop report at the owner's hour, and ✍️ one product page written again (when on). */
export async function aistaffTick(ctx: ApiCtx) {
  if (!(await allow(ctx, 'aistaff:', 40, 3600))) return json(429, { ok: false });
  const settings = ctx.settings;
  try { await (await import('../services/aistaff')).tick(settings); } catch (e) { console.error('aistaff', (e as Error).message); }
  try { await (await import('../services/aiwriter')).tick(settings); } catch (e) { console.error('aiwriter', (e as Error).message); }
  return json(200, { ok: true });
}
