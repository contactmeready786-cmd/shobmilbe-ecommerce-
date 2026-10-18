// 🌍 দেশ ব্লক (Admin → ভিজিটর অ্যানালিটিক্স → 🌍 দেশ ব্লক, owner only): only visitors from the ticked countries
// may open the shop; everyone else gets a short "not available in your country" page.
//
// How a visitor's country is known: Vercel's geo-IP header (x-vercel-ip-country), or Cloudflare's (cf-ipcountry)
// if the shop ever sits behind Cloudflare. No header (local run, unknown) → let in, so a missing header can never
// shut the whole shop.
//
// VPN, both ways:
//  • A Bangladeshi using a VPN shows up from the VPN's country → shut out like any foreign visitor (that is what the
//    owner wants). Option geo_vpn_home lets them in anyway when their phone/computer clock is set to a ticked
//    country's time zone (the blocked page checks it and opens a pass for 7 days).
//  • A foreigner using a VPN that ends in Bangladesh shows up as Bangladesh → option geo_tz_check (on by default):
//    a tiny script in the page compares the browser's time zone with the ticked countries' time zones and sends a
//    visitor whose clock belongs elsewhere to the blocked page.
//
// Never shut out (or the shop breaks): anyone logged into the admin (the admin panel itself has its own country lock,
// see adminConfig below), payment/courier webhooks, the
// daily jobs, robots/sitemap/feeds/images, and the crawlers Google, Facebook, Bing etc. use (they visit from the
// USA/Europe — blocking them would drop the shop from Google, Merchant Center and Facebook link previews).
// A crawler's user agent alone is not trusted (anyone can type "Googlebot"): services/crawlers.ts checks search
// engines by DNS, and link-preview bots may only read public pages.
import * as db from '../db';
import { parseCookies, sign, unsign } from '../util';
import * as COUNTRIES from '../data/countries';
import type { Body, Loose, ShopRequest } from '../types';
import { clientIp } from '../security';
import * as crawlers from './crawlers';

const PASS_DAYS = 7;
const BLOCK_PATH = '/__region';

// search engines, link previews, shopping and ad checkers — matched by their user agent
const GOOD_BOTS = /googlebot|google-inspectiontool|googleother|storebot-google|adsbot-google|mediapartners-google|apis-google|feedfetcher-google|google-read-aloud|duplexweb-google|google-site-verification|googleimageproxy|google-pagerenderer|chrome-lighthouse|bingbot|bingpreview|msnbot|adidxbot|applebot|duckduckbot|yandex(bot|images)|facebookexternalhit|facebookcatalog|facebot|meta-externalagent|meta-externalfetcher|twitterbot|linkedinbot|pinterestbot|slackbot|telegrambot|whatsapp|discordbot|skypeuripreview|tiktokbot|bytespider-ads/i;
// paths other servers call, or that crawlers need, which must answer from anywhere
const OPEN_PATHS = /^\/(e\/[oc]\/|unsubscribe$|webhook\/|pay\/|media\/|img\/|brand\/|feeds\/|api\/(research|backup)\/tick$|robots\.txt$|sitemap[^/]*\.xml$|[a-f0-9]{32}\.txt$|favicon|__region)/;

const codeOk = (c?: Loose) => Object.prototype.hasOwnProperty.call(COUNTRIES, c);
function allowedList(s?: Loose) {
  return [...new Set(String(s.geo_allow || '').toUpperCase().split(/[\s,]+/).filter(codeOk))];
}
function config(s?: Loose) {
  const allow = allowedList(s);
  const zones = new Set();
  let zonesComplete = true;
  for (const c of allow) {
    if (!(COUNTRIES as Loose)[c].length) zonesComplete = false;
    (COUNTRIES as Loose)[c].forEach((z) => zones.add(z));
  }
  return {
    on: s.geo_lock_on === '1' && allow.length > 0,
    allow: new Set(allow),
    list: allow,
    zones,
    // the clock check needs every ticked country's time zones (a few tiny islands have none listed)
    tzCheck: s.geo_tz_check !== '0' && zonesComplete && zones.size > 0,
    vpnHome: s.geo_vpn_home === '1' && zonesComplete && zones.size > 0,
  };
}

function header(req: ShopRequest, name?: Loose) { return String((req.headers && req.headers[name]) || '').trim(); }
function countryOf(req: ShopRequest) {
  const c = (header(req, 'x-vercel-ip-country') || header(req, 'cf-ipcountry')).toUpperCase().slice(0, 2);
  return /^[A-Z]{2}$/.test(c) && c !== 'XX' ? c : '';
}
const isGoodBot = (ua?: Loose) => GOOD_BOTS.test(String(ua || ''));

function hasPass(req: ShopRequest, s?: Loose) {
  const v = unsign(parseCookies(req.headers.cookie).sm_geo, s.session_secret);
  if (!v) return false;
  const [k, at] = v.split(':');
  return k === 'geo' && Date.now() - Number(at) < PASS_DAYS * 864e5;
}
function passCookie(req: ShopRequest, s?: Loose) {
  const secure = String(req.headers['x-forwarded-proto'] || '').includes('https') ? '; Secure' : '';
  return `sm_geo=${encodeURIComponent(sign(`geo:${Date.now()}`, s.session_secret))}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${PASS_DAYS * 86400}${secure}`;
}
const loggedIntoAdmin = (req: ShopRequest, s?: Loose) => !!unsign(parseCookies(req.headers.cookie).sm_admin, s.session_secret);

// For a shop request (not /admin): null = let in, or { country } = show the blocked page.
async function check(req: ShopRequest, path?: Loose, s?: Loose, method = 'GET'): Promise<{ country: string } | null> {
  const c = config(s);
  if (!c.on) return null;
  if (OPEN_PATHS.test(path)) return null;
  const country = countryOf(req);
  if (!country || c.allow.has(country)) return null;
  const ua = String(req.headers['user-agent'] || '');
  if (isGoodBot(ua)) {
    const v = await crawlers.verdict(ua, clientIp(req));
    if (v === 'verified') return null;
    if (v === 'preview' && crawlers.previewMayOpen(method, String(path))) return null;
    // a fake search engine, or a preview bot asking for a private address: treated like any visitor from there
  }
  if (loggedIntoAdmin(req, s)) return null; // the owner/staff abroad still sees the shop
  if (c.vpnHome && hasPass(req, s)) return null;
  return { country };
}

// how many visits each country lost (shown on the admin page), one row per day + country + reason
function count(country?: Loose, why?: Loose) {
  db.q(`INSERT INTO geo_blocks(day, country, why, n) VALUES((now() AT TIME ZONE 'Asia/Dhaka')::date, $1, $2, 1)
    ON CONFLICT (day, country, why) DO UPDATE SET n = geo_blocks.n + 1`, [String(country || '??').slice(0, 2), why]).catch(() => {});
  if (Math.random() < 0.01) db.q(`DELETE FROM geo_blocks WHERE day < (now() AT TIME ZONE 'Asia/Dhaka')::date - 90`).catch(() => {});
}

// The tiny script put in every shop page when the clock check is on: a browser whose time zone belongs to no
// ticked country goes to the blocked page. Crawlers are skipped (their clocks are in the USA).
function headScript(s?: Loose) {
  const c = config(s);
  if (!c.on || !c.tzCheck) return '';
  return `<script>(()=>{try{const u=navigator.userAgent||'';if(/bot|crawl|spider|slurp|lighthouse|headless|preview|facebookexternalhit|meta-external|whatsapp|telegram/i.test(u))return;const z=Intl.DateTimeFormat().resolvedOptions().timeZone;if(!z||/^(Etc\\/|UTC$|GMT)/.test(z))return;const ok=${JSON.stringify([...c.zones]).replace(/</g, '\\u003c')};if(!ok.includes(z))location.replace('${BLOCK_PATH}?w=tz&z='+encodeURIComponent(z));}catch{}})();</script>`;
}

function esc(v?: Loose) { return String(v ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as Record<string, string>)[ch]); }
function countryName(code?: Loose, lang: Loose = 'bn') {
  try { return new Intl.DisplayNames([lang], { type: 'region' }).of(code) || code; } catch (_) { return code; }
}

// The page a shut-out visitor sees (Bangla + English, no shop design so it loads instantly).
function blockedPage(s?: Loose, { country = '', why = 'country' }: Body = {}) {
  const c = config(s);
  const shop = esc(s.store_name || 'সবমিলবে');
  const where = c.list.map((x) => esc(countryName(x))).join(', ');
  const whereEn = c.list.map((x) => esc(countryName(x, 'en'))).join(', ');
  const vpnLine = why === 'tz'
    ? `<p>আপনার ফোন/কম্পিউটারের সময় অঞ্চল অন্য দেশের। VPN চালু থাকলে বন্ধ করে আবার চেষ্টা করুন।</p><p class="en">Your device's time zone is outside our service area. If you use a VPN, please turn it off.</p>`
    : `<p>VPN চালু থাকলে সেটা বন্ধ করে আবার চেষ্টা করুন।</p><p class="en">If you are using a VPN, please turn it off and try again.</p>`;
  // a visitor whose own clock is in a ticked country (e.g. a Bangladeshi on a VPN) gets let in, if the owner allows
  const passScript = why === 'country' && c.vpnHome
    ? `<script>(async()=>{try{const z=Intl.DateTimeFormat().resolvedOptions().timeZone;if(!z||!${JSON.stringify([...c.zones]).replace(/</g, '\\u003c')}.includes(z))return;const r=await fetch('${BLOCK_PATH}/pass',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'tz='+encodeURIComponent(z),credentials:'same-origin'});if(r.ok)location.reload();}catch{}})();</script>`
    : '';
  return `<!doctype html><html lang="bn"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${shop} — এই দেশ থেকে খোলা যায় না</title>
<style>body{margin:0;font-family:system-ui,'Noto Sans Bengali',sans-serif;background:#f5f7fb;color:#14213d;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:20px;box-sizing:border-box}
.box{max-width:440px;background:#fff;border:1px solid #e3e8f0;border-radius:16px;padding:28px 22px;text-align:center}.ic{font-size:46px}h1{font-size:20px;margin:10px 0}p{color:#5b6475;line-height:1.6;margin:8px 0}.en{font-size:14px;color:#8a93a3}</style></head>
<body><main class="box"><div class="ic">🌍</div><h1>দুঃখিত, ${shop} আপনার দেশ থেকে খোলা যায় না</h1>
<p>আমরা শুধু ${where || 'নির্দিষ্ট দেশ'}-এ সেবা দিই।</p><p class="en">Sorry, ${shop} is only available in ${whereEn || 'selected countries'}.</p>
${vpnLine}</main>${passScript}</body></html>`;
}

// ---------------------------------------------------------------- 🔐 অ্যাডমিন দেশ তালা (owner, 2026-10-13)
// The admin panel opens only from Bangladesh. Before a trip the owner ticks the extra countries and the last day
// of the trip (Admin → নিরাপত্তা); after that day they close again by themselves.
// Emergency key, in case the owner is abroad and forgot: Vercel → Environment Variables → ADMIN_GEO_LOCK = off → Redeploy.
// No country header (local run) → let in, so a missing header can never lock the owner out.
const ADMIN_HOME = 'BD';
function adminUntil(s?: Loose) {
  const d = String(s.admin_geo_until || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return 0;
  const t = Date.parse(`${d}T23:59:59+06:00`);
  return Number.isFinite(t) ? t : 0;
}
function adminConfig(s?: Loose) {
  const envOff = /^(off|0|no|false)$/i.test(String(process.env.ADMIN_GEO_LOCK || '').trim());
  const extra = [...new Set(String(s.admin_geo_extra || '').toUpperCase().split(/[\s,]+/).filter((c) => codeOk(c) && c !== ADMIN_HOME))];
  const until = adminUntil(s);
  const extraActive = extra.length > 0 && until > Date.now();
  return {
    on: !envOff && s.admin_geo_on !== '0',
    envOff,
    extra,
    until,
    untilText: String(s.admin_geo_until || ''),
    extraActive,
    allow: new Set([ADMIN_HOME, ...(extraActive ? extra : [])]),
  };
}
// For an /admin request: null = let in, or the visitor's country code = shut out.
function adminBlocked(req: ShopRequest, s?: Loose) {
  const c = adminConfig(s);
  if (!c.on) return null;
  const country = countryOf(req);
  if (!country || c.allow.has(country)) return null;
  return country;
}
function adminBlockedPage() {
  return '<!doctype html><html lang="bn"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>পাওয়া যায়নি</title></head>'
    + '<body style="font-family:system-ui,sans-serif;padding:40px 20px;text-align:center;color:#14213d"><h1>পেজটি পাওয়া যায়নি</h1><p style="color:#5b6475">Page not found.</p><p><a href="/">হোমে যান</a></p></body></html>';
}

export { config, check, countryOf, isGoodBot, count, headScript, blockedPage, passCookie, allowedList, countryName, COUNTRIES, BLOCK_PATH, OPEN_PATHS, ADMIN_HOME, adminConfig, adminBlocked, adminBlockedPage };
