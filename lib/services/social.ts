// 📣 সোশ্যাল মিডিয়া অটো পোস্ট (owner, 2026-11-13): besides the Facebook page (+ Instagram, lib/services/autopost.ts) and the
// Telegram channel (lib/services/telegram.ts), the shop posts its own products by itself on
//   🧵 Threads    — photo + short text with the order link (Meta's official Threads API, free)
// Owner, 2026-11-14: only platforms that are completely free AND post publicly without an app review are kept.
// Pinterest, YouTube and TikTok were removed: their APIs keep posts private / sandboxed until the platform audits the
// app, and YouTube/TikTok would need videos made for each product (heavy). The owner posts there by hand if at all.
//
// Goal (owner): real buyers who need the part, not likes. So every post is the real product photo, the real price,
// cash on delivery and a link straight to the product page, with search words people actually type ("… price in BD").
// Each link carries utm_source=<platform>, so Admin → ভিজিটর shows which platform brought visits and orders.
//
// Connecting: the owner makes a free developer app once, pastes its ID + secret here and presses
// "লগইন করে অনুমতি দিন"; the platform asks them to allow it and sends them back to
// /admin/marketing/channels/callback with a code, which is swapped for tokens. Tokens are refreshed here by themselves.
//
// Runs from the scheduler (lib/api/files.ts runShopJobs): each platform posts at its own hours (max 4 a day), a slot claimed once.
import * as db from '../db';
import { bn, fetchJson, randomCode } from '../util';
import * as autopost from './autopost';
import * as $seo from './seo';
import type { Settings, Caught } from '../types';
import type { SocialPostsRow } from '../data/rows';

export const CHANNELS = ['threads'] as const;
export type Channel = typeof CHANNELS[number];
export const isChannel = (c: unknown): c is Channel => (CHANNELS as readonly string[]).includes(String(c));

/** what each platform is good at, and the hours it posts by default (Dhaka time; people are online lunch + evening) */
export const INFO: Record<Channel, { name: string; icon: string; hours: string; video: boolean }> = {
  threads: { name: 'Threads', icon: '🧵', hours: '13,21', video: false },
};
const REPEAT_DAYS = 45;
const money = (n: number) => '৳' + bn(Math.round(Number(n) || 0).toLocaleString('en-IN'));
const k = (ch: Channel, name: string) => `social_${ch}_${name}`;

export function hoursFor(settings: Settings, ch: Channel) {
  const hs = String(settings[k(ch, 'hours')] || INFO[ch].hours).split(/[,\s]+/).map(Number).filter((h) => Number.isInteger(h) && h >= 0 && h <= 23);
  return [...new Set(hs)].sort((a, b) => a - b).slice(0, 4);
}
export function connected(settings: Settings, ch: Channel) {
  return !!settings[k(ch, 'token')];
}
export function redirectUri(settings: Settings) { return `${autopost.siteBase(settings)}/admin/marketing/channels/callback`; }

// ---------------------------------------------------------------- the words of a post
type P = NonNullable<Awaited<ReturnType<typeof autopost.pickProduct>>>;
function link(p: P, settings: Settings, ch: string) {
  return `${autopost.siteBase(settings)}/p/${encodeURIComponent(p.slug)}?utm_source=${ch}&utm_medium=social&utm_campaign=autopost`;
}
function about(p: P, max: number) {
  const t = String(p.short_description || p.description || '').replace(/<[^>]+>/g, ' ').replace(/[#*_`>\[\]]/g, ' ').replace(/\s+/g, ' ').trim();
  const name = $seo.cleanName(p.name).toLowerCase();
  const rest = t.toLowerCase().startsWith(name) ? t.slice(name.length).replace(/^[\s,.:;|–-]+/, '') : t;
  if (rest.length < 15) return '';
  return rest.length > max ? rest.slice(0, max).replace(/\s+\S*$/, '') + '…' : rest;
}
function tags(p: P, n: number) {
  const tag = (t: string) => '#' + String(t || '').replace(/[^\p{L}\p{M}\p{N}]+/gu, '');
  const list = ['#সবমিলবে', '#shobmilbe', p.category ? tag(p.category) : '', '#OnlineShopBD', '#CashOnDelivery', '#Bangladesh'];
  return [...new Set(list.filter((t) => t.length > 2))].slice(0, n).join(' ');
}
const priceLine = (p: P) => {
  const old = Number(p.old_price);
  return old > p.price ? `💰 দাম ${money(p.price)} (আগে ${money(old)})` : `💰 দাম ${money(p.price)}`;
};

/** Threads: 500 letters at most — name, price, delivery, link */
export function threadsText(p: P, settings: Settings) {
  const name = $seo.cleanName(p.name);
  const a = about(p, 140);
  const lines = [`🔌 ${name}`, a || null, '', priceLine(p), '🚚 সারা দেশে হোম ডেলিভারি · ক্যাশ অন ডেলিভারি', `🛒 অর্ডার: ${link(p, settings, 'threads')}`, '', tags(p, 3)];
  const t = lines.filter((l) => l !== null).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return t.length > 495 ? t.slice(0, 492) + '…' : t;
}
// ---------------------------------------------------------------- web calls
type Res = Record<string, unknown> & { error?: unknown; error_description?: string; message?: string };
async function call<T = Res>(url: string, opts: RequestInit = {}, what = ''): Promise<T> {
  const r = await fetchJson<Res>(url, opts, 30000);
  const d = r.data || {};
  const err = d.error as { message?: string; error_user_msg?: string } | string | undefined;
  const bad = !r.ok || (err && typeof err === 'object' && (err as { code?: string }).code !== 'ok') || (typeof err === 'string' && err);
  if (bad) {
    const msg = (typeof err === 'object' && err && (err.error_user_msg || err.message)) || d.error_description || d.message || (typeof err === 'string' ? err : '') || r.text || `HTTP ${r.status}`;
    throw new Error(`${what ? what + ': ' : ''}${String(msg).slice(0, 220)}`);
  }
  return d as T;
}
const form = (o: Record<string, string>) => ({ method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(o).toString() });

async function save(settings: Settings, obj: Record<string, string>) {
  for (const [key, v] of Object.entries(obj)) { await db.setSetting(key, v); settings[key] = v; }
}

// ---------------------------------------------------------------- connecting (OAuth)
/** the address the owner is sent to, to log in and allow the shop to post */
export async function authUrl(settings: Settings, ch: Channel) {
  const id = String(settings[k(ch, 'app_id')] || '').trim();
  if (!id || !settings[k(ch, 'secret')]) throw new Error('আগে App ID আর App Secret দিয়ে সেভ করুন।');
  // reuse a fresh state: the admin page can run this twice for one click (page draw + its fallback), and a second,
  // different state made the platform's answer look forged ("লিংকের মেয়াদ শেষ বা মিলছে না") — owner, 2026-11-14
  const [oldCh, oldCode, oldAt] = String(settings.social_oauth_state || '').split('.');
  const fresh = oldCh === ch && oldCode && Date.now() - Number(oldAt) < 10 * 60e3;
  const state = fresh ? `${ch}.${oldCode}` : `${ch}.${randomCode(24)}`;
  if (!fresh) await save(settings, { social_oauth_state: `${state}.${Date.now()}` });
  const redirect = redirectUri(settings);
  const q = (o: Record<string, string>) => new URLSearchParams(o).toString();
  return `https://threads.net/oauth/authorize?${q({ client_id: id, redirect_uri: redirect, scope: 'threads_basic,threads_content_publish', response_type: 'code', state })}`;
}

/** back from the platform with ?code=…&state=… → tokens saved; answers the account's name */
export async function finish(settings: Settings, code: string, state: string): Promise<{ ch: Channel; name: string }> {
  const [stCh, stCode, stAt] = String(settings.social_oauth_state || '').split('.');
  const [ch, sent] = String(state || '').split('.');
  if (!isChannel(ch) || ch !== stCh || sent !== stCode || Date.now() - Number(stAt) > 30 * 60e3) throw new Error('লিংকের মেয়াদ শেষ বা মিলছে না — আবার "লগইন করে অনুমতি দিন" চাপুন।');
  await save(settings, { social_oauth_state: '' });
  const id = String(settings[k(ch, 'app_id')] || '').trim();
  const secret = String(settings[k(ch, 'secret')] || '');
  const redirect = redirectUri(settings);
  const now = String(Date.now());
  const short = await call<{ access_token: string; user_id: string | number }>('https://graph.threads.net/oauth/access_token', form({ client_id: id, client_secret: secret, grant_type: 'authorization_code', redirect_uri: redirect, code }), 'Threads');
  const long = await call<{ access_token: string }>(`https://graph.threads.net/access_token?${new URLSearchParams({ grant_type: 'th_exchange_token', client_secret: secret, access_token: short.access_token })}`, {}, 'Threads');
  const me = await call<{ id: string; username?: string }>(`https://graph.threads.net/v1.0/me?fields=id,username&access_token=${encodeURIComponent(long.access_token)}`, {}, 'Threads');
  await save(settings, { social_threads_token: long.access_token, social_threads_token_at: now, social_threads_user: String(me.id), social_threads_name: me.username || '' });
  return { ch, name: me.username ? '@' + me.username : 'Threads' };
}

export async function disconnect(settings: Settings, ch: Channel) {
  const keys = ['token', 'token_at', 'refresh', 'user', 'name', 'on'];
  await save(settings, Object.fromEntries(keys.map((x) => [k(ch, x), ''])));
}

/** a fresh access token (each platform's tokens expire; the long-lasting refresh key makes a new one) */
async function token(settings: Settings, ch: Channel) {
  const at = Number(settings[k(ch, 'token_at')]) || 0;
  const age = Date.now() - at;
  const now = String(Date.now());
  if (age > 20 * 864e5) { // 60-day token: renew every 20 days
    const r = await call<{ access_token: string }>(`https://graph.threads.net/refresh_access_token?grant_type=th_refresh_token&access_token=${encodeURIComponent(String(settings.social_threads_token))}`, {}, 'Threads');
    await save(settings, { social_threads_token: r.access_token, social_threads_token_at: now });
  }
  return String(settings[k(ch, 'token')]);
}

// ---------------------------------------------------------------- posting
async function postThreads(p: P, settings: Settings) {
  const t = await token(settings, 'threads');
  const user = settings.social_threads_user;
  const box = await call<{ id: string }>(`https://graph.threads.net/v1.0/${user}/threads`, form({ media_type: 'IMAGE', image_url: await autopost.imageUrl(p, settings), text: threadsText(p, settings), access_token: t }), 'Threads');
  let last: unknown = null;
  for (let i = 0; i < 6; i++) { // Threads fetches the picture first
    await new Promise((res) => setTimeout(res, 4000));
    try { const r = await call<{ id: string }>(`https://graph.threads.net/v1.0/${user}/threads_publish`, form({ creation_id: box.id, access_token: t }), 'Threads'); return r.id; } catch (e) { last = e; }
  }
  throw last || new Error('Threads পোস্ট হলো না');
}

async function record(slot: string, ch: Channel, productId: number | null, ok: boolean, postId: string, message: string) {
  await db.q(`INSERT INTO social_posts(slot, channel, product_id, ok, post_id, message, kind, ref) VALUES($1,$2,$3,$4,$5,$6,'product','')
    ON CONFLICT (slot) DO UPDATE SET product_id=EXCLUDED.product_id, ok=EXCLUDED.ok, post_id=EXCLUDED.post_id, message=EXCLUDED.message, created_at=now()`,
  [slot, ch, productId, ok, postId, message.slice(0, 500)]);
}

/** a product for this platform: not posted THERE in the last 45 days (other platforms may have had it) */
async function productFor(settings: Settings, ch: Channel): Promise<P | null> {
  const recentIds = (await db.q<{ product_id: number }>(`SELECT DISTINCT product_id FROM social_posts WHERE ok AND channel=$1 AND product_id IS NOT NULL AND created_at > now() - interval '${REPEAT_DAYS} days'`, [ch]).catch(() => [])).map((r) => r.product_id);
  const day = autopost.dhakaNow().weekday;
  return autopost.pickProduct(day, { exclude: recentIds });
}

export type ChannelResult = { ok?: boolean; id?: string; error?: string; product?: P | null; url?: string };
/** post one product on one platform now (slot = the scheduled hour, or a manual one) */
export async function postOne(settings: Settings, ch: Channel, slot?: string): Promise<ChannelResult> {
  if (!connected(settings, ch)) return { error: `${INFO[ch].name} যুক্ত করা নেই।` };
  const p = await productFor(settings, ch);
  const key = `${slot || `manual:${Date.now()}`}:${ch}`;
  if (!p) {
    const why = 'পোস্ট করার মতো পণ্য পাওয়া যায়নি (স্টকে আছে, ছবি আছে, দোকানে চালু — এমন পণ্য লাগবে)।';
    if (slot) await record(key, ch, null, false, '', why);
    return { error: why };
  }
  if (!p.category && p.category_id) {
    const c = await db.one<{ name: string; parent_id: number | null }>('SELECT name, parent_id FROM categories WHERE id=$1', [p.category_id]).catch(() => null);
    let root = c;
    for (let i = 0; root && root.parent_id && i < 6; i++) root = await db.one<{ name: string; parent_id: number | null }>('SELECT name, parent_id FROM categories WHERE id=$1', [root.parent_id]).catch(() => null);
    p.category = root ? root.name : '';
  }
  try {
    const id = await postThreads(p, settings);
    await record(key, ch, p.id, true, String(id), '');
    return { ok: true, id: String(id), product: p, url: postUrl(settings, ch, String(id)) };
  } catch (caught) { const e = caught as Caught;
    await record(key, ch, p.id, false, '', e.message);
    await db.logIntegration(`${ch}-autopost`, 'post', false, e.message, p.name);
    return { error: e.message, product: p };
  }
}

export function postUrl(settings: Settings, ch: string, id: string) {
  if (!id) return '';
  if (ch === 'threads') return settings.social_threads_name ? `https://www.threads.net/@${settings.social_threads_name}` : '';
  if (ch === 'facebook') return `https://www.facebook.com/${id}`;
  if (ch === 'instagram') return settings.autopost_ig_name ? `https://www.instagram.com/${settings.autopost_ig_name}/` : '';
  return '';
}

/** from the hourly wake-up: each switched-on platform at its own hours, one claim per slot */
export async function tick(settings: Settings) {
  const now = autopost.dhakaNow();
  const out: Record<string, unknown> = {};
  for (const ch of CHANNELS) {
    if (settings[k(ch, 'on')] !== '1' || !connected(settings, ch)) continue;
    const due = hoursFor(settings, ch).filter((h) => h <= now.hour && now.hour - h <= 3);
    if (!due.length) continue;
    const slot = `${ch}:${now.day}@${due[due.length - 1]}`;
    const claimed = await db.one<Pick<SocialPostsRow, 'id'>>(`INSERT INTO social_posts(slot, channel, ok, message) VALUES($1,'claim',NULL,'') ON CONFLICT (slot) DO NOTHING RETURNING id`, [slot]);
    if (!claimed) continue;
    try { out[ch] = await postOne(settings, ch, slot); } catch (e) { out[ch] = { error: (e as Error).message }; }
  }
  return out;
}

// ---------------------------------------------------------------- what the hub page shows
export async function recent(limit = 40) {
  return db.q<{ id: number; channel: string; ok: boolean | null; post_id: string; message: string; created_at: Date; kind: string; product_name: string | null; slug: string | null }>(
    `SELECT sp.id, sp.channel, sp.ok, sp.post_id, sp.message, sp.created_at, sp.kind, p.name AS product_name, p.slug FROM social_posts sp LEFT JOIN products p ON p.id=sp.product_id
     WHERE sp.channel <> 'claim' ORDER BY sp.created_at DESC LIMIT $1`, [limit]).catch(() => []);
}
/** posts per platform (all time, last 7 days, last error) */
export async function counts() {
  const rows = await db.q<{ channel: string; total: number; week: number; failed: number }>(`SELECT channel, count(*) FILTER (WHERE ok)::int AS total,
      count(*) FILTER (WHERE ok AND created_at > now() - interval '7 days')::int AS week, count(*) FILTER (WHERE ok = false AND created_at > now() - interval '7 days')::int AS failed
    FROM social_posts WHERE channel <> 'claim' GROUP BY channel`).catch(() => []);
  return Object.fromEntries(rows.map((r) => [r.channel, r]));
}
/** 🎯 the real result: visits and orders that came from each platform (last 30 days) */
export async function results() {
  const rows = await db.q<{ source: string; visits: number; orders: number }>(`SELECT source, count(*)::int AS visits, count(*) FILTER (WHERE order_code <> '')::int AS orders
    FROM visit_sessions WHERE started_at > now() - interval '30 days' AND source IN ('Facebook','Instagram','Threads','Pinterest','YouTube','TikTok','Telegram') GROUP BY source`).catch(() => []);
  return Object.fromEntries(rows.map((r) => [r.source, r]));
}
