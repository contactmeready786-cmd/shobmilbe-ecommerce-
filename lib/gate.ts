// 🛡️ The shop's front gate: the checks every customer page passes before it is drawn — the same for the original
// router (lib/app.ts) and the Next.js pages (proxy.ts runs it for every address that has its own Next.js page).
//
//   1. the database is ready (the first visit after an update finishes the setup)
//   2. the one-time database move isn't running
//   3. an IP the owner shut out gets nothing (security watch), and the address is checked for hacking attempts
//   4. 🌍 only the countries the owner ticked may open the shop (VPN check, real search engines always let in)
//   5. spy / copier bots the owner closed get nothing
//   6. the small background jobs start now and then (reminder SMS, price-drop SMS, e-mails, health check)
import * as db from './db';
import * as security from './security';
import * as guard from './services/guard';
import * as notify from './services/notify';
import * as drafts from './services/drafts';
import * as $services_dbmove from './services/dbmove';
import * as $services_geolock from './services/geolock';
import * as $services_health from './services/health';
import * as $services_mailer from './services/mailer';
import * as $services_errors from './services/errors';
import * as $models_extras from './models/extras';
import { parseCookies, sign, unsign } from './util';
import type { Settings, ShopRequest } from './types';

export const SPY_BOTS = ['AhrefsBot', 'SemrushBot', 'MJ12bot', 'DotBot', 'BLEXBot', 'DataForSeoBot', 'Barkrowler', 'serpstatbot', 'SEOkicks', 'MegaIndex', 'ZoominfoBot'];
export const AI_COPIERS = ['GPTBot', 'CCBot', 'Google-Extended', 'ClaudeBot', 'anthropic-ai', 'Bytespider', 'Applebot-Extended', 'meta-externalagent', 'Diffbot', 'cohere-ai', 'omgili'];
export function blockedBots(settings: Settings): string[] {
  return [...(settings.block_seo_spies !== '0' ? SPY_BOTS : []), ...(settings.block_ai_copy !== '0' ? AI_COPIERS : [])];
}

export function siteUrl(req: Pick<ShopRequest, 'headers'>, settings: Settings): string {
  if (settings.site_url) return settings.site_url.replace(/\/+$/, '');
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || 'localhost');
  const proto = String(req.headers['x-forwarded-proto'] || (host.startsWith('localhost') ? 'http' : 'https')).split(',')[0];
  return `${proto}://${host}`;
}

// A page view starts the small background jobs: 📩 reminder SMS for unfinished checkouts, 🔔 price-drop SMS. Each server copy looks at most
// every 5 minutes, and only one copy across all servers does the work in any 5 minutes. Never slows the page.
let lastTick = 0;
export function backgroundTick(req: Pick<ShopRequest, 'headers'>, settings: Settings): void {
  if (Date.now() - lastTick < 5 * 60e3) return;
  lastTick = Date.now();
  // 🩺 database space / backups / connections: e-mail the owner before something runs out (services/health.ts)
  notify.later($services_health.checkAndAlert(settings), 8000).catch(() => {});
  const draftsOn = settings.draft_sms_on === '1';
  const priceOn = settings.price_alert_on !== '0';
  const mailOn = settings.email_mkt_on === '1';
  if (!draftsOn && !priceOn && !mailOn) return;
  notify.later((async () => {
    if (!(await security.hit(db, 'bg:tick', 1, 300))) return;
    if (draftsOn) await drafts.remindDue(settings, siteUrl(req, settings)).catch(() => {});
    // 🔔 prices that dropped: SMS the people who asked
    if (priceOn) await $models_extras.priceSweep(settings).catch(() => {});
    // 📧 campaigns go out in small parts through the day (the mailer itself works at most every 4 minutes)
    if (mailOn) await $services_mailer.tick(settings).catch(() => {});
  })(), 8000).catch(() => {});
}

export const SITE_BLOCKED_PAGE = '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>প্রবেশ বন্ধ</title><body style="font-family:sans-serif;padding:40px;text-align:center"><h1>দুঃখিত, এই সংযোগ থেকে সাইটে ঢোকা বন্ধ আছে</h1><p>ভুল হয়ে থাকলে আমাদের ফোন বা ফেসবুক পেজে যোগাযোগ করুন।</p></body>';
const SETUP_PAGE = '<!doctype html><html lang="bn"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>একটু অপেক্ষা করুন</title><body style="font-family:sans-serif;padding:40px;text-align:center"><h1>দোকান এই মুহূর্তে খুলছে না</h1><p>কিছুক্ষণ পর আবার চেষ্টা করুন।</p></body></html>';

/** A request as the gate sees it (works for Next.js requests too). */
export type GateRequest = Pick<ShopRequest, 'headers'> & { socket?: { remoteAddress?: string } | null; url?: string };
export type GateResult =
  | { ok: true; settings: Settings }
  | { ok: false; status: number; body: string; type: string; headers: Record<string, string> };

/** Runs the checks for one customer page or shop API call (not the admin). */
export async function shopGate(req: GateRequest, path: string, search: string, method: string, opts: { bots?: boolean } = {}): Promise<GateResult> {
  const html = 'text/html; charset=utf-8';
  try {
    await db.ensureReady();
  } catch (e) {
    console.error('Database setup failed:', e);
    return { ok: false, status: 503, body: SETUP_PAGE, type: html, headers: { 'Cache-Control': 'no-store', 'Retry-After': '30' } };
  }
  try {
    if (await $services_dbmove.pending()) return { ok: false, status: 503, body: $services_dbmove.page(), type: html, headers: { 'Cache-Control': 'no-store', 'Retry-After': '30' } };
  } catch (e) { console.error('DB move check failed:', e); }

  const settings = await db.getSettings();
  const r = req as ShopRequest;
  if (settings.guard_on !== '0') {
    if (await guard.siteBlocked(security.clientIp(r))) return { ok: false, status: 403, body: SITE_BLOCKED_PAGE, type: html, headers: { 'Cache-Control': 'no-store' } };
    guard.inspect(r, path, search, settings);
  }
  const geo = $services_geolock;
  const shut = await geo.check(r, path, settings, method);
  if (shut) {
    geo.count(shut.country, 'country');
    if (path.startsWith('/api/')) return { ok: false, status: 403, body: JSON.stringify({ error: 'region' }), type: 'application/json; charset=utf-8', headers: { 'Cache-Control': 'no-store' } };
    return { ok: false, status: 403, body: geo.blockedPage(settings, { country: shut.country }), type: html, headers: { 'X-Robots-Tag': 'noindex', 'Cache-Control': 'no-store' } };
  }
  $services_errors.ensure(settings); // Sentry on/off follows the key saved in Admin → আমার নোটিফিকেশন
  if (method === 'GET' && !path.startsWith('/api/') && !path.startsWith('/media/')) backgroundTick(r, settings);
  const ua = String(r.headers['user-agent'] || '');
  // (pictures and robots.txt are given even to the blocked bots — robots.txt is where they read they are not welcome)
  if (ua && opts.bots !== false) {
    const bad = blockedBots(settings);
    if (bad.length && bad.some((b) => ua.toLowerCase().includes(b.toLowerCase()))) return { ok: false, status: 403, body: 'Forbidden', type: 'text/plain', headers: { 'X-Robots-Tag': 'noindex' } };
  }
  return { ok: true, settings };
}

// The referral link (?ref=CODE) is remembered for 30 days, so the code is in the box at checkout.
export function refCookie(req: Pick<ShopRequest, 'headers'>, code?: unknown): string {
  const secure = String(req.headers['x-forwarded-proto'] || '').includes('https') ? '; Secure' : '';
  return `sm_ref=${encodeURIComponent(String(code).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20))}; Path=/; SameSite=Lax; Max-Age=${30 * 86400}${secure}`;
}
export function refFromCookie(req: Pick<ShopRequest, 'headers'>): string { return String(parseCookies(req.headers.cookie as string).sm_ref || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20); }
/** A friend's referral link: ?ref=CODE when the owner has referrals on. */
export function refToRemember(settings: Settings, ref: string | null): string | null {
  return settings.ref_on === '1' && ref && /^[A-Za-z0-9-]{4,24}$/.test(ref) ? ref : null;
}

/** The order numbers this browser placed or opened with its phone number (signed cookie sm_orders). */
export function myOrders(req: Pick<ShopRequest, 'headers'>, settings: Settings): string[] {
  const v = unsign(parseCookies(req.headers.cookie as string).sm_orders, settings.session_secret);
  return v ? v.split('.').filter(Boolean) : [];
}

/**
 * The admin's front checks, for an admin page drawn by Next.js: may Next.js draw it? false → the original code
 * answers (it shows the same "setting up", customer-app, country-lock or bot answers as always).
 */
export async function adminGateOk(req: GateRequest, method: string): Promise<{ ok: true; settings: Settings } | { ok: false }> {
  try {
    await db.ensureReady();
    if (await $services_dbmove.pending()) return { ok: false };
  } catch { return { ok: false }; }
  const settings = await db.getSettings();
  const r = req as ShopRequest;
  const ua = String(r.headers['user-agent'] || '');
  if (/ShobmilbeApp\//.test(ua)) return { ok: false }; // the customer Android app never shows the admin panel
  if ($services_geolock.adminBlocked(r, settings)) return { ok: false }; // 🔐 only from the countries the owner allows
  const bad = blockedBots(settings);
  if (ua && bad.length && bad.some((b) => ua.toLowerCase().includes(b.toLowerCase()))) return { ok: false };
  $services_errors.ensure(settings); // Sentry on/off follows the key saved in Admin → আমার নোটিফিকেশন
  if (method === 'GET') backgroundTick(r, settings);
  return { ok: true, settings };
}

// "This browser placed / verified these orders" — a signed cookie, so only that customer sees the full address and phone.
export function myOrdersCookie(req: Pick<ShopRequest, 'headers'>, settings: Settings, code: string): string {
  const codes = [code, ...myOrders(req, settings).filter((c) => c !== code)].slice(0, 15);
  const secure = String(req.headers['x-forwarded-proto'] || '').includes('https') ? '; Secure' : '';
  return `sm_orders=${encodeURIComponent(sign(codes.join('.'), settings.session_secret))}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${120 * 86400}${secure}`;
}
