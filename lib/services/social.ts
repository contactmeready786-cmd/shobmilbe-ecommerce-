// 📣 সোশ্যাল মিডিয়া অটো পোস্ট (owner, 2026-11-13): besides the Facebook page (+ Instagram, lib/services/autopost.ts) and the
// Telegram channel (lib/services/telegram.ts), the shop now posts its own products by itself on
//   🧵 Threads    — photo + short text with the order link (Meta's official Threads API)
//   📌 Pinterest  — a Pin per product, in a board per main category, linking to the product page. Pinterest is a
//                   search engine: people search "Arduino Uno price" there and land on the shop — the best organic channel
//   ▶️ YouTube    — a 9-second vertical Short of the product (made on GitHub's computers, see below)
//   🎵 TikTok     — the same short video, sent to the owner's TikTok inbox as a draft (owner adds a sound and posts)
//
// Goal (owner): real buyers who need the part, not likes. So every post is the real product photo, the real price,
// cash on delivery and a link straight to the product page, with search words people actually type ("… price in BD").
// Each link carries utm_source=<platform>, so Admin → ভিজিটর shows which platform brought visits and orders.
//
// Connecting: the owner makes a free developer app on the platform once, pastes its ID + secret here and presses
// "লগইন করে অনুমতি দিন"; the platform asks them to allow it and sends them back to
// /admin/marketing/channels/callback with a code, which is swapped for tokens. Tokens are refreshed here by themselves.
//
// Videos: GitHub's free computers (.github/workflows/social-video.yml) ask GET /api/social-video-jobs which products
// need a video, make each with ffmpeg and put it on this repository's `social-videos` branch. The shop reads the file
// from there — it never accepts a file sent to it.
//
// Runs from the hourly /api/research/tick: each platform posts at its own hours (max 4 a day), a slot claimed once.
import * as db from '../db';
import { bn, fetchJson, randomCode } from '../util';
import * as autopost from './autopost';
import * as $seo from './seo';
import * as gh from './ghfile';
import type { Settings, Caught } from '../types';
import type { SocialPostsRow } from '../data/rows';

export const CHANNELS = ['threads', 'pinterest', 'youtube', 'tiktok'] as const;
export type Channel = typeof CHANNELS[number];
export const isChannel = (c: unknown): c is Channel => (CHANNELS as readonly string[]).includes(String(c));

/** what each platform is good at, and the hours it posts by default (Dhaka time; people are online lunch + evening) */
export const INFO: Record<Channel, { name: string; icon: string; hours: string; video: boolean }> = {
  threads: { name: 'Threads', icon: '🧵', hours: '13,21', video: false },
  pinterest: { name: 'Pinterest', icon: '📌', hours: '10,14,19,22', video: false },
  youtube: { name: 'YouTube Shorts', icon: '▶️', hours: '19', video: true },
  tiktok: { name: 'TikTok', icon: '🎵', hours: '20', video: true },
};
const REPEAT_DAYS = 45;
const money = (n: number) => '৳' + bn(Math.round(Number(n) || 0).toLocaleString('en-IN'));
const k = (ch: Channel, name: string) => `social_${ch}_${name}`;

export function hoursFor(settings: Settings, ch: Channel) {
  const hs = String(settings[k(ch, 'hours')] || INFO[ch].hours).split(/[,\s]+/).map(Number).filter((h) => Number.isInteger(h) && h >= 0 && h <= 23);
  return [...new Set(hs)].sort((a, b) => a - b).slice(0, 4);
}
export function connected(settings: Settings, ch: Channel) {
  return !!(ch === 'youtube' || ch === 'tiktok' || ch === 'pinterest' ? settings[k(ch, 'refresh')] : settings[k(ch, 'token')]);
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
/** Pinterest: a searchable title ("… Price in BD") and a description with the words people search */
export function pinText(p: P, settings: Settings) {
  const name = $seo.cleanName(p.name);
  const title = `${name} — দাম ${money(p.price)} | Price in BD`.slice(0, 100);
  const description = [about(p, 260), `${name} এর দাম বাংলাদেশে ${money(p.price)}।`, 'সারা দেশে হোম ডেলিভারি, ক্যাশ অন ডেলিভারি।', `অর্ডার করুন ${settings.store_name || 'সবমিলবে'} থেকে।`, tags(p, 5)]
    .filter(Boolean).join(' ').slice(0, 500);
  return { title, description, link: link(p, settings, 'pinterest'), alt: `${name} — ${settings.store_name || 'সবমিলবে'}`.slice(0, 500) };
}
/** YouTube / TikTok: title + description of the short video */
export function videoText(p: P, settings: Settings, ch: 'youtube' | 'tiktok') {
  const name = $seo.cleanName(p.name);
  const title = ch === 'youtube' ? `${name.slice(0, 60)} দাম ${money(p.price)} | Price in Bangladesh #shorts` : `${name.slice(0, 70)} — ${money(p.price)}`;
  const description = [`${name}`, about(p, 400) || null, '', priceLine(p), '🚚 সারা বাংলাদেশে হোম ডেলিভারি, ক্যাশ অন ডেলিভারি', `🛒 অর্ডার: ${link(p, settings, ch)}`,
    settings.whatsapp || settings.phone ? `📞 WhatsApp/ফোন: ${settings.whatsapp || settings.phone}` : null, '', tags(p, 5)]
    .filter((l) => l !== null).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return { title: title.slice(0, 100), description: description.slice(0, ch === 'youtube' ? 4900 : 2100) };
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
const jsonBody = (o: unknown, token?: string) => ({ method: 'POST', headers: { 'Content-Type': 'application/json; charset=UTF-8', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(o) });

async function save(settings: Settings, obj: Record<string, string>) {
  for (const [key, v] of Object.entries(obj)) { await db.setSetting(key, v); settings[key] = v; }
}

// ---------------------------------------------------------------- connecting (OAuth)
const PIN_API = (settings: Settings) => (settings.social_pinterest_sandbox === '0' ? 'https://api.pinterest.com/v5' : 'https://api-sandbox.pinterest.com/v5');

/** the address the owner is sent to, to log in and allow the shop to post */
export async function authUrl(settings: Settings, ch: Channel) {
  const id = String(settings[k(ch, 'app_id')] || '').trim();
  if (!id || !settings[k(ch, 'secret')]) throw new Error('আগে App ID আর App Secret দিয়ে সেভ করুন।');
  const state = `${ch}.${randomCode(24)}`;
  await save(settings, { social_oauth_state: `${state}.${Date.now()}` });
  const redirect = redirectUri(settings);
  const q = (o: Record<string, string>) => new URLSearchParams(o).toString();
  if (ch === 'threads') return `https://threads.net/oauth/authorize?${q({ client_id: id, redirect_uri: redirect, scope: 'threads_basic,threads_content_publish', response_type: 'code', state })}`;
  if (ch === 'pinterest') return `https://www.pinterest.com/oauth/?${q({ client_id: id, redirect_uri: redirect, response_type: 'code', scope: 'boards:read,boards:write,pins:read,pins:write,user_accounts:read', state })}`;
  if (ch === 'youtube') return `https://accounts.google.com/o/oauth2/v2/auth?${q({ client_id: id, redirect_uri: redirect, response_type: 'code', scope: 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly', access_type: 'offline', prompt: 'consent', state })}`;
  return `https://www.tiktok.com/v2/auth/authorize/?${q({ client_key: id, redirect_uri: redirect, response_type: 'code', scope: 'user.info.basic,video.upload', state })}`;
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
  if (ch === 'threads') {
    const short = await call<{ access_token: string; user_id: string | number }>('https://graph.threads.net/oauth/access_token', form({ client_id: id, client_secret: secret, grant_type: 'authorization_code', redirect_uri: redirect, code }), 'Threads');
    const long = await call<{ access_token: string }>(`https://graph.threads.net/access_token?${new URLSearchParams({ grant_type: 'th_exchange_token', client_secret: secret, access_token: short.access_token })}`, {}, 'Threads');
    const me = await call<{ id: string; username?: string }>(`https://graph.threads.net/v1.0/me?fields=id,username&access_token=${encodeURIComponent(long.access_token)}`, {}, 'Threads');
    await save(settings, { social_threads_token: long.access_token, social_threads_token_at: now, social_threads_user: String(me.id), social_threads_name: me.username || '' });
    return { ch, name: me.username ? '@' + me.username : 'Threads' };
  }
  if (ch === 'pinterest') {
    const t = await call<{ access_token: string; refresh_token: string }>('https://api.pinterest.com/v5/oauth/token', {
      ...form({ grant_type: 'authorization_code', code, redirect_uri: redirect }),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64') },
    }, 'Pinterest');
    const me = await call<{ username?: string }>('https://api.pinterest.com/v5/user_account', { headers: { Authorization: `Bearer ${t.access_token}` } }, 'Pinterest').catch(() => ({ username: '' }));
    await save(settings, { social_pinterest_token: t.access_token, social_pinterest_token_at: now, social_pinterest_refresh: t.refresh_token, social_pinterest_name: me.username || '', social_pinterest_boards: '{}' });
    return { ch, name: me.username ? '@' + me.username : 'Pinterest' };
  }
  if (ch === 'youtube') {
    const t = await call<{ access_token: string; refresh_token?: string }>('https://oauth2.googleapis.com/token', form({ client_id: id, client_secret: secret, grant_type: 'authorization_code', redirect_uri: redirect, code }), 'Google');
    if (!t.refresh_token) throw new Error('Google স্থায়ী অনুমতি দেয়নি — myaccount.google.com/permissions থেকে অ্যাপটা সরিয়ে আবার চেষ্টা করুন।');
    const c = await call<{ items?: { id: string; snippet?: { title?: string } }[] }>('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', { headers: { Authorization: `Bearer ${t.access_token}` } }, 'YouTube');
    const chan = (c.items || [])[0];
    if (!chan) throw new Error('এই Google অ্যাকাউন্টে কোনো YouTube চ্যানেল নেই — আগে youtube.com এ চ্যানেল খুলুন।');
    await save(settings, { social_youtube_token: t.access_token, social_youtube_token_at: now, social_youtube_refresh: t.refresh_token, social_youtube_user: chan.id, social_youtube_name: chan.snippet?.title || '' });
    return { ch, name: chan.snippet?.title || 'YouTube' };
  }
  const t = await call<{ access_token: string; refresh_token: string; open_id: string }>('https://open.tiktokapis.com/v2/oauth/token/', form({ client_key: id, client_secret: secret, code, grant_type: 'authorization_code', redirect_uri: redirect }), 'TikTok');
  const me = await call<{ data?: { user?: { display_name?: string } } }>('https://open.tiktokapis.com/v2/user/info/?fields=display_name', { headers: { Authorization: `Bearer ${t.access_token}` } }, 'TikTok').catch(() => ({ data: {} as { user?: { display_name?: string } } }));
  const name = me.data?.user?.display_name || '';
  await save(settings, { social_tiktok_token: t.access_token, social_tiktok_token_at: now, social_tiktok_refresh: t.refresh_token, social_tiktok_user: t.open_id, social_tiktok_name: name });
  return { ch, name: name || 'TikTok' };
}

export async function disconnect(settings: Settings, ch: Channel) {
  const keys = ['token', 'token_at', 'refresh', 'user', 'name', 'on'];
  await save(settings, Object.fromEntries(keys.map((x) => [k(ch, x), ''])));
  if (ch === 'pinterest') await save(settings, { social_pinterest_boards: '{}' });
}

/** a fresh access token (each platform's tokens expire; the long-lasting refresh key makes a new one) */
async function token(settings: Settings, ch: Channel) {
  const at = Number(settings[k(ch, 'token_at')]) || 0;
  const age = Date.now() - at;
  const id = String(settings[k(ch, 'app_id')] || '');
  const secret = String(settings[k(ch, 'secret')] || '');
  const now = String(Date.now());
  if (ch === 'threads') {
    if (age > 20 * 864e5) { // 60-day token: renew every 20 days
      const r = await call<{ access_token: string }>(`https://graph.threads.net/refresh_access_token?grant_type=th_refresh_token&access_token=${encodeURIComponent(String(settings.social_threads_token))}`, {}, 'Threads');
      await save(settings, { social_threads_token: r.access_token, social_threads_token_at: now });
    }
    return String(settings.social_threads_token);
  }
  if (ch === 'pinterest') {
    if (age > 20 * 864e5) { // 30-day token
      const r = await call<{ access_token: string; refresh_token?: string }>('https://api.pinterest.com/v5/oauth/token', {
        ...form({ grant_type: 'refresh_token', refresh_token: String(settings.social_pinterest_refresh) }),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64') },
      }, 'Pinterest');
      await save(settings, { social_pinterest_token: r.access_token, social_pinterest_token_at: now, ...(r.refresh_token ? { social_pinterest_refresh: r.refresh_token } : {}) });
    }
    return String(settings.social_pinterest_token);
  }
  if (ch === 'youtube') {
    if (age > 45 * 60e3) { // 1-hour token
      const r = await call<{ access_token: string }>('https://oauth2.googleapis.com/token', form({ client_id: id, client_secret: secret, grant_type: 'refresh_token', refresh_token: String(settings.social_youtube_refresh) }), 'Google');
      await save(settings, { social_youtube_token: r.access_token, social_youtube_token_at: now });
    }
    return String(settings.social_youtube_token);
  }
  if (age > 20 * 3600e3) { // 24-hour token
    const r = await call<{ access_token: string; refresh_token?: string }>('https://open.tiktokapis.com/v2/oauth/token/', form({ client_key: id, client_secret: secret, grant_type: 'refresh_token', refresh_token: String(settings.social_tiktok_refresh) }), 'TikTok');
    await save(settings, { social_tiktok_token: r.access_token, social_tiktok_token_at: now, ...(r.refresh_token ? { social_tiktok_refresh: r.refresh_token } : {}) });
  }
  return String(settings.social_tiktok_token);
}

// ---------------------------------------------------------------- videos (made on GitHub, see the top)
export const VIDEO_BRANCH = 'social-videos';
let videoCache: { at: number; ids: Set<number> } = { at: 0, ids: new Set() };
/** product ids that have a finished video */
export async function readyVideos(): Promise<Set<number>> {
  if (Date.now() - videoCache.at < 5 * 60e3) return videoCache.ids;
  // (through the owner's GitHub key when the repository is private — lib/services/ghfile.ts)
  const r = await gh.repoFile(VIDEO_BRANCH, 'index.json', { timeoutMs: 15000 }).catch(() => null);
  const data = r && r.ok ? ((await r.json().catch(() => null)) as Record<string, unknown> | null) : null;
  const ids = new Set(Object.keys(data || {}).map(Number).filter((n) => n > 0));
  videoCache = { at: Date.now(), ids: data ? ids : videoCache.ids };
  return videoCache.ids;
}
const videoOn = (settings: Settings) => (['youtube', 'tiktok'] as const).some((ch) => settings[k(ch, 'on')] === '1' && connected(settings, ch));

/** GET /api/social-video-jobs: the next few products that will need a video (only when YouTube or TikTok posts) */
export async function videoJobs(settings: Settings) {
  if (!videoOn(settings)) return [];
  const ready = await readyVideos().catch(() => new Set<number>());
  const recentIds = (await db.q<{ product_id: number }>(`SELECT DISTINCT product_id FROM social_posts WHERE ok AND channel IN ('youtube','tiktok') AND product_id IS NOT NULL AND created_at > now() - interval '${REPEAT_DAYS} days'`).catch(() => [])).map((r) => r.product_id);
  const waiting = [...ready].filter((id) => !recentIds.includes(id));
  if (waiting.length >= 3) return [];
  const out: { id: number; image: string; price: string; name: string }[] = [];
  const exclude: unknown[] = [...recentIds, ...ready];
  const day = autopost.dhakaNow().weekday;
  for (let i = 0; i < 3 - waiting.length; i++) {
    const p = await autopost.pickProduct((day + i) % 7, { exclude });
    if (!p) break;
    exclude.push(p.id);
    const ascii = $seo.cleanName(p.name).replace(/[^\x20-\x7E]+/g, ' ').replace(/\s+/g, ' ').trim();
    out.push({ id: p.id, image: await autopost.imageUrl(p, settings), price: `Tk ${Math.round(Number(p.price) * 100) / 100}`, name: ascii.length >= 4 ? ascii.slice(0, 60) : '' });
  }
  return out;
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

async function pinBoard(settings: Settings, t: string, category: string) {
  const boards = db.jsonSetting<Record<string, string>>(settings, 'social_pinterest_boards', {});
  const name = (category || settings.store_name || 'সবমিলবে').slice(0, 50);
  if (boards[name]) return boards[name];
  const api = PIN_API(settings);
  const auth = { Authorization: `Bearer ${t}` };
  // a board of that name already there?
  const list = await call<{ items?: { id: string; name: string }[] }>(`${api}/boards?page_size=100`, { headers: auth }, 'Pinterest').catch(() => ({ items: [] as { id: string; name: string }[] }));
  let id = (list.items || []).find((b) => b.name.trim().toLowerCase() === name.toLowerCase())?.id;
  if (!id) {
    const b = await call<{ id: string }>(`${api}/boards`, jsonBody({ name, description: `${name} — দাম ও অর্ডার, সারা বাংলাদেশে হোম ডেলিভারি। ${autopost.siteBase(settings).replace(/^https?:\/\//, '')}`, privacy: 'PUBLIC' }, t), 'Pinterest');
    id = b.id;
  }
  await save(settings, { social_pinterest_boards: JSON.stringify({ ...boards, [name]: id }) });
  return id;
}
async function postPinterest(p: P, settings: Settings) {
  const t = await token(settings, 'pinterest');
  const board = await pinBoard(settings, t, p.category || '');
  const x = pinText(p, settings);
  const r = await call<{ id: string }>(`${PIN_API(settings)}/pins`, jsonBody({ board_id: board, title: x.title, description: x.description, link: x.link, alt_text: x.alt, media_source: { source_type: 'image_url', url: await autopost.imageUrl(p, settings) } }, t), 'Pinterest');
  return r.id;
}

async function videoBytes(p: P) {
  const buf = await gh.repoBytes(VIDEO_BRANCH, `videos/${p.id}.mp4`, 60e6, 60000);
  if (!buf) throw new Error('ভিডিও ফাইল পাওয়া গেল না');
  if (buf.length < 10000) throw new Error('ভিডিও ফাইলটা ঠিক নেই');
  return buf;
}
async function postYoutube(p: P, settings: Settings) {
  const t = await token(settings, 'youtube');
  const buf = await videoBytes(p);
  const x = videoText(p, settings, 'youtube');
  const meta = { snippet: { title: x.title, description: x.description, categoryId: '22', defaultLanguage: 'bn', tags: [$seo.cleanName(p.name).slice(0, 60), 'price in bangladesh', 'online shop bd', p.category || ''].filter(Boolean) }, status: { privacyStatus: 'public', selfDeclaredMadeForKids: false } };
  const start = await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': 'video/mp4', 'X-Upload-Content-Length': String(buf.length) }, body: JSON.stringify(meta),
  });
  const where = start.headers.get('location');
  if (!start.ok || !where) throw new Error('YouTube: ' + (await start.text()).replace(/\s+/g, ' ').slice(0, 220));
  const up = await fetch(where, { method: 'PUT', headers: { 'Content-Type': 'video/mp4' }, body: buf });
  const d = (await up.json().catch(() => ({}))) as { id?: string; error?: { message?: string } };
  if (!up.ok || !d.id) throw new Error('YouTube: ' + (d.error?.message || `HTTP ${up.status}`));
  return d.id;
}
async function postTiktok(p: P, settings: Settings) {
  const t = await token(settings, 'tiktok');
  const buf = await videoBytes(p);
  // goes to the owner's TikTok inbox as a draft: they add a trending sound and post it (TikTok allows full auto-posting
  // only for apps it has audited; drafts work for every app)
  const init = await call<{ data?: { publish_id?: string; upload_url?: string } }>('https://open.tiktokapis.com/v2/post/publish/inbox/video/init/',
    jsonBody({ source_info: { source: 'FILE_UPLOAD', video_size: buf.length, chunk_size: buf.length, total_chunk_count: 1 } }, t), 'TikTok');
  const url = init.data?.upload_url;
  if (!url) throw new Error('TikTok আপলোডের জায়গা দিল না');
  const up = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(buf.length), 'Content-Range': `bytes 0-${buf.length - 1}/${buf.length}` }, body: buf });
  if (!up.ok) throw new Error('TikTok: ' + (await up.text()).slice(0, 200));
  return init.data?.publish_id || 'draft';
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
  if (!INFO[ch].video) return autopost.pickProduct(day, { exclude: recentIds });
  const ready = [...(await readyVideos())].filter((id) => !recentIds.includes(id));
  for (const id of ready) {
    const p = await db.one<P>(`SELECT p.*, coalesce(p.sold_count,0)::int AS sold FROM products p WHERE p.id=$1 AND ${autopost.ELIGIBLE}`, [id]);
    if (p) return p;
  }
  return null;
}

export type ChannelResult = { ok?: boolean; id?: string; error?: string; product?: P | null; url?: string };
/** post one product on one platform now (slot = the scheduled hour, or a manual one) */
export async function postOne(settings: Settings, ch: Channel, slot?: string): Promise<ChannelResult> {
  if (!connected(settings, ch)) return { error: `${INFO[ch].name} যুক্ত করা নেই।` };
  const p = await productFor(settings, ch);
  const key = `${slot || `manual:${Date.now()}`}:${ch}`;
  if (!p) {
    const why = INFO[ch].video ? 'ভিডিও এখনো তৈরি হয়নি (GitHub প্রতি ২ ঘণ্টায় বানায়) — একটু পরে আবার হবে।' : 'পোস্ট করার মতো পণ্য পাওয়া যায়নি (স্টকে আছে, ছবি আছে, দোকানে চালু — এমন পণ্য লাগবে)।';
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
    const id = ch === 'threads' ? await postThreads(p, settings) : ch === 'pinterest' ? await postPinterest(p, settings) : ch === 'youtube' ? await postYoutube(p, settings) : await postTiktok(p, settings);
    await record(key, ch, p.id, true, String(id), ch === 'tiktok' ? 'TikTok ইনবক্সে ড্রাফট হিসেবে গেছে' : '');
    return { ok: true, id: String(id), product: p, url: postUrl(settings, ch, String(id)) };
  } catch (caught) { const e = caught as Caught;
    await record(key, ch, p.id, false, '', e.message);
    await db.logIntegration(`${ch}-autopost`, 'post', false, e.message, p.name);
    return { error: e.message, product: p };
  }
}

export function postUrl(settings: Settings, ch: string, id: string) {
  if (!id) return '';
  if (ch === 'youtube') return `https://youtube.com/shorts/${id}`;
  if (ch === 'pinterest') return settings.social_pinterest_sandbox === '0' ? `https://www.pinterest.com/pin/${id}/` : '';
  if (ch === 'threads') return settings.social_threads_name ? `https://www.threads.net/@${settings.social_threads_name}` : '';
  if (ch === 'facebook') return `https://www.facebook.com/${id}`;
  if (ch === 'instagram') return settings.autopost_ig_name ? `https://www.instagram.com/${settings.autopost_ig_name}/` : '';
  return '';
}

let lastVideoKick = 0;
/** videos are needed and none wait: start GitHub's video maker now (at most hourly; needs the owner's GitHub key) */
async function kickVideos(settings: Settings) {
  if (!videoOn(settings) || !settings.whiten_gh_token || Date.now() - lastVideoKick < 3600e3) return;
  lastVideoKick = Date.now();
  if ((await videoJobs(settings).catch(() => [])).length) await gh.dispatch('social-video.yml');
}

/** from the hourly wake-up: each switched-on platform at its own hours, one claim per slot */
export async function tick(settings: Settings) {
  await kickVideos(settings).catch(() => {});
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
