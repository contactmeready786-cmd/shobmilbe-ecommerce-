'use strict';
// Visitor analytics: who visits the shop, from where, what they look at and for how long.
// The browser (public/js/shop.js) sends small beacons to POST /api/v; this file stores them
// and answers the questions the admin "ভিজিটর অ্যানালিটিক্স" page asks.
//
// Location comes from Vercel's geo-IP headers (x-vercel-ip-country / -country-region / -city),
// so it works on Vercel without any paid service. Locally these headers are missing.
const db = require('../db');
const { parseCookies, str, int } = require('../util');

const { q, one } = db;
const DAY = (col) => `(${col} AT TIME ZONE 'Asia/Dhaka')::date`;
const LIVE_MINUTES = 5;
const ID_RE = /^[a-f0-9]{20}$/;
const EVENTS = new Set(['add_to_cart', 'begin_checkout', 'purchase', 'search', 'contact']);

// ---------------------------------------------------------------- places
// ISO 3166-2:BD — divisions (letters) and the 64 districts (01–64).
const BD_DIVISIONS = { A: 'বরিশাল বিভাগ', B: 'চট্টগ্রাম বিভাগ', C: 'ঢাকা বিভাগ', D: 'খুলনা বিভাগ', E: 'রাজশাহী বিভাগ', F: 'রংপুর বিভাগ', G: 'সিলেট বিভাগ', H: 'ময়মনসিংহ বিভাগ' };
const BD_DISTRICTS = ['বান্দরবান', 'বরগুনা', 'বগুড়া', 'ব্রাহ্মণবাড়িয়া', 'বাগেরহাট', 'বরিশাল', 'ভোলা', 'কুমিল্লা', 'চাঁদপুর', 'চট্টগ্রাম', 'কক্সবাজার',
  'চুয়াডাঙ্গা', 'ঢাকা', 'দিনাজপুর', 'ফরিদপুর', 'ফেনী', 'গোপালগঞ্জ', 'গাজীপুর', 'গাইবান্ধা', 'হবিগঞ্জ', 'জামালপুর', 'যশোর', 'ঝিনাইদহ', 'জয়পুরহাট', 'ঝালকাঠি',
  'কিশোরগঞ্জ', 'খুলনা', 'কুড়িগ্রাম', 'খাগড়াছড়ি', 'কুষ্টিয়া', 'লক্ষ্মীপুর', 'লালমনিরহাট', 'মানিকগঞ্জ', 'ময়মনসিংহ', 'মুন্সিগঞ্জ', 'মাদারীপুর', 'মাগুরা', 'মৌলভীবাজার',
  'মেহেরপুর', 'নারায়ণগঞ্জ', 'নেত্রকোণা', 'নরসিংদী', 'নড়াইল', 'নাটোর', 'চাঁপাইনবাবগঞ্জ', 'নীলফামারী', 'নোয়াখালী', 'নওগাঁ', 'পাবনা', 'পিরোজপুর', 'পটুয়াখালী',
  'পঞ্চগড়', 'রাজবাড়ী', 'রাজশাহী', 'রংপুর', 'রাঙ্গামাটি', 'শেরপুর', 'সাতক্ষীরা', 'সিরাজগঞ্জ', 'সিলেট', 'সুনামগঞ্জ', 'শরীয়তপুর', 'টাঙ্গাইল', 'ঠাকুরগাঁও'];

let regionNames = null;
function countryName(code) {
  if (!code) return 'অজানা';
  try {
    regionNames = regionNames || new Intl.DisplayNames(['bn'], { type: 'region' });
    return regionNames.of(code) || code;
  } catch (_) { return code; }
}
function flag(code) {
  if (!/^[A-Z]{2}$/.test(code || '')) return '🌐';
  return String.fromCodePoint(...[...code].map((c) => 0x1F1E6 + c.charCodeAt(0) - 65));
}
function regionName(country, region) {
  if (!region) return '';
  if (country === 'BD') {
    if (BD_DIVISIONS[region]) return BD_DIVISIONS[region];
    const n = Number(region);
    if (n >= 1 && n <= 64) return BD_DISTRICTS[n - 1];
  }
  return region;
}
function place(row) {
  const parts = [row.city, regionName(row.country, row.region)].filter(Boolean);
  // "Dhaka, ঢাকা" -> keep both: city in English as Vercel sends it, district in Bangla
  return { flag: flag(row.country), text: parts.length ? parts.join(', ') : countryName(row.country), country: countryName(row.country) };
}
function header(req, name) {
  const v = String(req.headers[name] || '').trim();
  try { return decodeURIComponent(v); } catch (_) { return v; }
}
function geoFrom(req) {
  return {
    country: header(req, 'x-vercel-ip-country').toUpperCase().slice(0, 2),
    region: header(req, 'x-vercel-ip-country-region').slice(0, 10),
    city: header(req, 'x-vercel-ip-city').slice(0, 80),
  };
}

// ---------------------------------------------------------------- browser / device
const BOT_RE = /bot|crawl|spider|slurp|facebookexternalhit|facebookcatalog|meta-externalagent|bingpreview|headless|lighthouse|pagespeed|gtmetrix|pingdom|uptime|monitor|curl|wget|python|axios|node-fetch|go-http|java\/|okhttp|preview|whatsapp\/|telegrambot|discordbot|skypeuripreview|vercel/i;
function isBot(ua) { return !ua || ua.length < 20 || BOT_RE.test(ua); }

function parseUA(ua) {
  ua = String(ua || '');
  const tablet = /iPad|Tablet|PlayBook|Silk|(Android(?!.*Mobile))/i.test(ua);
  const mobile = !tablet && /Mobi|iPhone|iPod|Android|Opera Mini|IEMobile/i.test(ua);
  const device = tablet ? 'tablet' : mobile ? 'mobile' : 'desktop';
  let os = 'অন্যান্য';
  let m;
  if ((m = ua.match(/Android\s([\d.]+)/))) os = 'Android ' + m[1].split('.')[0];
  else if (/Android/.test(ua)) os = 'Android';
  else if ((m = ua.match(/(?:iPhone|CPU) OS (\d+)/)) || /iPhone|iPad|iPod/.test(ua)) os = 'iOS' + (m ? ' ' + m[1] : '');
  else if (/Windows NT 10/.test(ua)) os = 'Windows 10/11';
  else if (/Windows/.test(ua)) os = 'Windows';
  else if (/Mac OS X|Macintosh/.test(ua)) os = 'macOS';
  else if (/CrOS/.test(ua)) os = 'ChromeOS';
  else if (/Linux/.test(ua)) os = 'Linux';
  let browser = 'অন্যান্য';
  // In-app browsers first: they tell you which app sent the visitor.
  if (/FBAN\/Messenger|FB_IAB\/Orca|MessengerLite|Orca-Android/i.test(ua)) browser = 'Messenger অ্যাপ';
  else if (/FBAN|FBAV|FB_IAB|FBIOS|\[FB/i.test(ua)) browser = 'Facebook অ্যাপ';
  else if (/Instagram/i.test(ua)) browser = 'Instagram অ্যাপ';
  else if (/musical_ly|BytedanceWebview|TikTok|trill/i.test(ua)) browser = 'TikTok অ্যাপ';
  else if (/Line\//.test(ua)) browser = 'LINE অ্যাপ';
  else if (/SamsungBrowser/.test(ua)) browser = 'Samsung Internet';
  else if (/UCBrowser|UCWEB/.test(ua)) browser = 'UC Browser';
  else if (/OPR\/|Opera|OPiOS/.test(ua)) browser = 'Opera';
  else if (/MiuiBrowser|XiaoMi/.test(ua)) browser = 'Mi Browser';
  else if (/EdgA?\/|Edg\//.test(ua)) browser = 'Edge';
  else if (/Firefox|FxiOS/.test(ua)) browser = 'Firefox';
  else if (/CriOS|Chrome\//.test(ua)) browser = 'Chrome';
  else if (/Safari\//.test(ua)) browser = 'Safari';
  return { device, os, browser };
}

// ---------------------------------------------------------------- phone brand & model
// Android phones tell their model ("SM-A515F", "RMX3363", "Redmi Note 12") — in the browser name or,
// on new Chrome, only when the page asks (navigator.userAgentData). iPhones never tell the model, so it
// is guessed from the screen size (CSS pixels + pixel ratio) — shown as "আনুমানিক".
const BRANDS = [
  [/^SM-|galaxy|samsung/i, 'Samsung'], [/redmi|poco|xiaomi|^mi\s|^M2\d{3}|^2[0-4]\d{6}[A-Z]{1,3}$|^2[0-4]\d{2}[A-Z0-9]{4,}$/i, 'Xiaomi'],
  [/^RMX|realme/i, 'Realme'], [/oneplus|^(NE|LE|KB|IN|HD|GM)\d{4}/i, 'OnePlus'], [/^CPH|oppo/i, 'Oppo'], [/^V2\d{3}|vivo|^I2\d{3}/i, 'Vivo'],
  [/infinix|^X6\d{2}/i, 'Infinix'], [/tecno|^(KE|KF|KG|KH|KI|KJ|BG|BD|CK|CL|LH|LG|BF)\d/i, 'Tecno'], [/itel/i, 'itel'],
  [/pixel/i, 'Google Pixel'], [/nokia|^TA-\d/i, 'Nokia'], [/huawei|^(ANE|ELE|VOG|JNY|MAR|STK|LYA)-/i, 'Huawei'],
  [/honor|^(HRY|BKL|ALI|ANY|CMA|RMO|LGE)-/i, 'Honor'], [/symphony/i, 'Symphony'], [/walton|primo/i, 'Walton'],
  [/moto|motorola|^XT\d{4}/i, 'Motorola'], [/lenovo/i, 'Lenovo'], [/^(SO-|XQ-)|xperia/i, 'Sony'], [/^LM-|lg-/i, 'LG'], [/asus|^ASUS_/i, 'Asus'],
];
function brandOf(model) {
  const m = String(model || '');
  const hit = BRANDS.find(([re]) => re.test(m));
  return hit ? hit[1] : '';
}
// "Mozilla/5.0 (Linux; Android 13; SM-A536E Build/TP1A…)" → "SM-A536E"; the reduced "Android 10; K" → ''
function androidModel(ua) {
  const m = String(ua).match(/Android[\s\d.]*;\s*(?:[a-z]{2}[-_][a-z]{2};\s*)?([^;)]+?)(?:\s+Build\/|\s*\)|;)/i);
  const model = m ? m[1].trim() : '';
  return !model || /^K$|^wv$|^Mobile$|^Linux$|^U$/i.test(model) ? '' : model.slice(0, 60);
}
const IPHONES = {
  '320x568@2': 'iPhone SE (১ম) / 5s', '375x667@2': 'iPhone 6/7/8 / SE', '414x736@3': 'iPhone 6/7/8 Plus', '375x812@3': 'iPhone X/XS/11 Pro/12 mini/13 mini',
  '414x896@2': 'iPhone XR / 11', '414x896@3': 'iPhone XS Max / 11 Pro Max', '390x844@3': 'iPhone 12/13/14', '428x926@3': 'iPhone 12/13 Pro Max / 14 Plus',
  '393x852@3': 'iPhone 14 Pro / 15 / 16', '430x932@3': 'iPhone 15 Plus / 15 Pro Max / 16 Plus', '402x874@3': 'iPhone 16 Pro / 17', '440x956@3': 'iPhone 16 Pro Max / 17 Pro Max',
};
function iphoneModel(screen, dpr) {
  const m = String(screen || '').match(/^(\d+)x(\d+)$/);
  if (!m) return '';
  const [a, b] = [Number(m[1]), Number(m[2])].sort((x, y) => x - y);
  const name = IPHONES[`${a}x${b}@${Math.round(Number(dpr) || 0)}`];
  return name ? name + ' (আনুমানিক)' : '';
}
// Samsung's A/M/F phones: "SM-A536E" → "Galaxy A53 (SM-A536E)", "SM-A057F" → "Galaxy A05s"
function friendlyModel(model) {
  const m = String(model || '').match(/^SM-([AMF])(\d)(\d)(\d)[A-Z0-9/]*$/i);
  if (!m) return model;
  const s = m[4] === '7' ? 's' : '';
  return `Galaxy ${m[1].toUpperCase()}${m[2]}${m[3]}${s} (${model})`.slice(0, 80);
}
function deviceDetails(ua, screen, dpr) {
  if (/iPhone/.test(ua)) return { brand: 'Apple', model: iphoneModel(screen, dpr) || 'iPhone' };
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && Number(dpr) >= 2 && /^(7[68]\d|8[0-3]\d|10[0-9]{2})x/.test(String(screen)))) return { brand: 'Apple', model: /iPad/.test(ua) ? 'iPad' : '' };
  if (/Android/.test(ua)) { const model = androidModel(ua); return { brand: brandOf(model), model: friendlyModel(model) }; }
  if (/Macintosh/.test(ua)) return { brand: 'Apple', model: 'Mac' };
  if (/Windows/.test(ua)) return { brand: '', model: 'Windows কম্পিউটার/ল্যাপটপ' };
  return { brand: '', model: '' };
}

// ---------------------------------------------------------------- VPN / abroad
// The IP's country (from Vercel) against the clock setting of the visitor's own phone/computer:
// a Bangladesh clock (Asia/Dhaka) with a foreign IP = almost surely a Bangladeshi using a VPN, proxy,
// or a browser with a data-saver (Opera Mini, some UC modes). A foreign IP with a foreign clock = abroad.
const TZ_RE = /^[A-Za-z_]+(?:\/[A-Za-z0-9_+\-]+){0,2}$/;
function netFlag(country, tz) {
  if (!country) return '';
  if (country === 'BD') return '';
  if (tz === 'Asia/Dhaka' || tz === 'Asia/Dacca') return 'vpn';
  return 'abroad';
}

// ---------------------------------------------------------------- traffic source
const SOURCES = [
  [/(^|\.)(facebook\.com|fb\.com|fb\.me|messenger\.com)$/, 'Facebook', 'social'],
  [/(^|\.)instagram\.com$/, 'Instagram', 'social'],
  [/(^|\.)(tiktok\.com|tiktokv\.com)$/, 'TikTok', 'social'],
  [/(^|\.)(youtube\.com|youtu\.be)$/, 'YouTube', 'social'],
  [/(^|\.)(t\.co|twitter\.com|x\.com)$/, 'X (Twitter)', 'social'],
  [/(^|\.)linkedin\.com$|^lnkd\.in$/, 'LinkedIn', 'social'],
  [/(^|\.)pinterest\./, 'Pinterest', 'social'],
  [/(^|\.)(whatsapp\.com|wa\.me)$/, 'WhatsApp', 'social'],
  [/(^|\.)(t\.me|telegram\.org)$/, 'Telegram', 'social'],
  [/(^|\.)reddit\.com$/, 'Reddit', 'social'],
  [/(^|\.)google\.[a-z.]+$|^android-app:\/\/com\.google/, 'Google', 'organic'],
  [/(^|\.)bing\.com$/, 'Bing', 'organic'],
  [/(^|\.)(yahoo\.com|search\.yahoo)/, 'Yahoo', 'organic'],
  [/(^|\.)duckduckgo\.com$/, 'DuckDuckGo', 'organic'],
  [/(^|\.)yandex\./, 'Yandex', 'organic'],
  [/(^|\.)(chatgpt\.com|openai\.com|perplexity\.ai|claude\.ai|gemini\.google\.com|copilot\.microsoft\.com)$/, 'AI চ্যাট', 'referral'],
];
const UTM_NAMES = { fb: 'Facebook', facebook: 'Facebook', ig: 'Instagram', instagram: 'Instagram', tiktok: 'TikTok', google: 'Google', youtube: 'YouTube', yt: 'YouTube', messenger: 'Facebook', whatsapp: 'WhatsApp' };

function hostOf(u) {
  try { return new URL(u).hostname.toLowerCase().replace(/^www\.|^m\.|^l\.|^lm\.|^mobile\./, ''); } catch (_) { return ''; }
}
// Decide where a visit came from. `params` are the landing page's query params.
function sourceOf({ referrer, params, ownHost, browser }) {
  const p = (k) => str(params.get(k), 100);
  const out = { source: 'সরাসরি (Direct)', medium: 'direct', campaign: p('utm_campaign'), refHost: '' };
  const host = hostOf(referrer);
  if (host && host !== ownHost && !host.endsWith('.' + ownHost)) out.refHost = host;
  const utm = p('utm_source').toLowerCase();
  if (utm) {
    out.source = UTM_NAMES[utm] || p('utm_source');
    out.medium = p('utm_medium').toLowerCase() || 'campaign';
    return out;
  }
  if (p('fbclid')) { out.source = 'Facebook'; out.medium = 'social'; return out; }
  if (p('gclid') || p('gbraid') || p('wbraid')) { out.source = 'Google'; out.medium = 'cpc'; return out; }
  if (p('ttclid')) { out.source = 'TikTok'; out.medium = 'cpc'; return out; }
  if (out.refHost) {
    const hit = SOURCES.find(([re]) => re.test(out.refHost));
    if (hit) { out.source = hit[1]; out.medium = hit[2]; } else { out.source = out.refHost; out.medium = 'referral'; }
    return out;
  }
  // No referrer, but opened inside an app's browser: that app is the source.
  const app = { 'Facebook অ্যাপ': 'Facebook', 'Messenger অ্যাপ': 'Facebook', 'Instagram অ্যাপ': 'Instagram', 'TikTok অ্যাপ': 'TikTok' }[browser];
  if (app) { out.source = app; out.medium = 'social'; }
  return out;
}

// ---------------------------------------------------------------- recording
function cleanPath(p) {
  let s = str(p, 300);
  if (!s.startsWith('/')) s = '/';
  // drop tracking params so the same page is counted together
  try {
    const u = new URL(s, 'http://x');
    ['fbclid', 'gclid', 'gbraid', 'wbraid', 'ttclid', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'new', 'msg'].forEach((k) => u.searchParams.delete(k));
    s = u.pathname + (u.search || '');
  } catch (_) { /* keep */ }
  return s.slice(0, 300);
}
function readJson(text) {
  try { const v = JSON.parse(text || '{}'); return v && typeof v === 'object' ? v : {}; } catch (_) { return {}; }
}
function shouldSkip(req, settings) {
  if (settings.visitor_tracking === '0') return true;
  if (isBot(String(req.headers['user-agent'] || ''))) return true;
  if (settings.visitor_exclude_admin !== '0' && parseCookies(req.headers.cookie).sm_admin) return true;
  if (/^(prefetch|prerender)$/i.test(String(req.headers['purpose'] || req.headers['sec-purpose'] || ''))) return true;
  return false;
}

async function cleanup(settings) {
  const keep = Math.min(730, Math.max(7, int(settings.visitor_keep_days, 60)));
  await q(`DELETE FROM page_views WHERE created_at < now() - make_interval(days => $1::int)`, [keep]);
  await q(`DELETE FROM visit_events WHERE created_at < now() - make_interval(days => $1::int)`, [keep]);
  await q(`DELETE FROM visit_sessions WHERE started_at < now() - make_interval(days => $1::int)`, [keep]);
  await q(`DELETE FROM visitors WHERE last_seen < now() - make_interval(days => $1::int)`, [keep]);
}

// One call per beacon. Returns a small object for the browser (or null).
async function record({ req, settings, body, ip, ownHost }) {
  const b = readJson(body);
  const vid = String(b.vid || '');
  const sid = String(b.sid || '');
  if (!ID_RE.test(vid) || !ID_RE.test(sid)) return null;
  if (shouldSkip(req, settings)) return { off: 1 };

  if (b.t === 'pv') {
    const path = cleanPath(b.p);
    const title = str(b.ti, 160);
    let sess = await one('SELECT id FROM visit_sessions WHERE id=$1', [sid]);
    if (!sess) {
      const ua = String(req.headers['user-agent'] || '').slice(0, 400);
      const { device, os, browser } = parseUA(ua);
      let params;
      try { params = new URL(str(b.u, 1000) || path, 'http://x').searchParams; } catch (_) { params = new URLSearchParams(); }
      const src = sourceOf({ referrer: str(b.r, 500), params, ownHost, browser });
      const geo = geoFrom(req);
      const tz = TZ_RE.test(String(b.tz || '')) ? String(b.tz).slice(0, 60) : '';
      const dev = deviceDetails(ua, str(b.w, 12), b.dpr);
      const v = await one(`INSERT INTO visitors(id, visits, pageviews) VALUES($1, 1, 0)
        ON CONFLICT (id) DO UPDATE SET visits = visitors.visits + 1, last_seen = now()
        RETURNING (xmax = 0) AS fresh`, [vid]);
      sess = await one(`INSERT INTO visit_sessions(id, visitor_id, is_new, ip, country, region, city, device, os, browser, screen, lang,
          referrer, ref_host, source, medium, campaign, landing, exit_path, brand, model, tz, net)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$18,$19,$20,$21,$22)
        ON CONFLICT (id) DO NOTHING RETURNING id`,
      [sid, vid, !!(v && v.fresh), str(ip, 64), geo.country, geo.region, geo.city, device, os, browser, str(b.w, 12), str(b.l, 12),
        str(b.r, 500), src.refHost, src.source, src.medium, str(src.campaign, 100), path, dev.brand, str(dev.model, 80), tz, netFlag(geo.country, tz)]);
    }
    await q(`UPDATE visit_sessions SET last_seen = now(), pageviews = pageviews + 1, exit_path = $2 WHERE id = $1`, [sid, path]);
    await q(`UPDATE visitors SET last_seen = now(), pageviews = pageviews + 1 WHERE id = $1`, [vid]);
    const slug = (path.match(/^\/p\/([^/?#]+)/) || [])[1];
    const pv = await one(`INSERT INTO page_views(session_id, visitor_id, path, title, product_id)
      VALUES($1,$2,$3,$4, ${slug ? '(SELECT id FROM products WHERE slug=$5)' : 'NULL'}) RETURNING id`,
    slug ? [sid, vid, path, title, slug] : [sid, vid, path, title]);
    if (Math.random() < 0.01) cleanup(settings).catch((e) => console.error('visitor cleanup', e.message));
    return { pv: pv.id };
  }

  // new Chrome on Android hides the model in its name, but tells it when the page asks
  if (b.t === 'dev') {
    const model = str(b.m, 60).replace(/[^\w\s.+()\-]/g, '').trim();
    const ver = str(b.pv, 20).replace(/[^\d.]/g, '');
    const pf = str(b.pf, 20);
    if (!model && !ver) return {};
    const os = /android/i.test(pf) && ver ? 'Android ' + ver.split('.')[0] : null;
    await q(`UPDATE visit_sessions SET model = CASE WHEN $2 <> '' THEN $5 ELSE model END, brand = CASE WHEN $3 <> '' THEN $3 ELSE brand END,
        os = coalesce($4, os) WHERE id = $1`, [sid, model, brandOf(model), os, friendlyModel(model)]);
    return {};
  }

  if (b.t === 'hb' || b.t === 'end') {
    const pv = int(b.pv);
    const secs = Math.min(3600, Math.max(0, int(b.d)));
    const scroll = Math.min(100, Math.max(0, int(b.s)));
    if (pv) {
      await q(`UPDATE page_views SET duration = greatest(duration, $3), scroll = greatest(scroll, $4) WHERE id = $1 AND session_id = $2`, [pv, sid, secs, scroll]);
    }
    await q(`UPDATE visit_sessions SET last_seen = now(),
      duration = coalesce((SELECT sum(duration) FROM page_views WHERE session_id = $1), 0) WHERE id = $1`, [sid]);
    return {};
  }

  if (b.t === 'ev') {
    const event = String(b.e || '');
    if (!EVENTS.has(event)) return null;
    const exists = await one('SELECT id FROM visit_sessions WHERE id=$1', [sid]);
    if (!exists) return null;
    const label = str(b.lb, 200);
    const ref = str(b.ref, 60);
    await q(`INSERT INTO visit_events(session_id, visitor_id, event, label, ref, value, path) VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [sid, vid, event, label, ref, Math.max(0, int(b.v)), cleanPath(b.p)]);
    if (event === 'purchase' && ref) {
      // Link the order to this visit, so the admin sees who the visitor was.
      const order = await one(`SELECT code, customer_name, phone FROM orders WHERE code=$1 AND created_at > now() - interval '2 days'`, [ref]);
      if (order) {
        const first = await one(`UPDATE visit_sessions SET order_code = $2 WHERE id = $1 AND order_code = '' RETURNING id`, [sid, order.code]);
        await q(`UPDATE visitors SET name = $2, phone = $3, orders = orders + $4 WHERE id = $1`, [vid, order.customer_name, order.phone, first ? 1 : 0]);
      }
    }
    return {};
  }
  return null;
}

// ---------------------------------------------------------------- reports
const RANGE = (col, a = 1) => `${DAY(col)} BETWEEN $${a}::date AND $${a + 1}::date`;

async function overview(from, to) {
  const r = [from, to];
  const [k, live, daily, hours, pages, products, sources, cities, regions, countries, devices, browsers, oses, referrers, campaigns, funnel, contacts, brands, models, net] = await Promise.all([
    one(`SELECT count(*)::int AS sessions, count(DISTINCT visitor_id)::int AS visitors, count(*) FILTER (WHERE is_new)::int AS new_visitors,
      coalesce(sum(pageviews),0)::int AS pageviews, coalesce(round(avg(duration)),0)::int AS avg_duration,
      count(*) FILTER (WHERE pageviews <= 1)::int AS bounces, count(*) FILTER (WHERE order_code <> '')::int AS orders
      FROM visit_sessions WHERE ${RANGE('started_at')}`, r),
    one(`SELECT count(*)::int AS n FROM visit_sessions WHERE last_seen > now() - interval '${LIVE_MINUTES} minutes'`),
    q(`SELECT d::date AS day, coalesce(s.visitors,0)::int AS visitors, coalesce(s.pageviews,0)::int AS pageviews
       FROM generate_series($1::date, $2::date, interval '1 day') d
       LEFT JOIN (SELECT ${DAY('started_at')} AS day, count(DISTINCT visitor_id) AS visitors, sum(pageviews) AS pageviews
                  FROM visit_sessions WHERE ${RANGE('started_at')} GROUP BY 1) s ON s.day = d::date ORDER BY d`, r),
    q(`SELECT extract(hour FROM started_at AT TIME ZONE 'Asia/Dhaka')::int AS h, count(*)::int AS n FROM visit_sessions WHERE ${RANGE('started_at')} GROUP BY 1`, r),
    q(`SELECT path, (array_agg(title ORDER BY id DESC))[1] AS title, count(*)::int AS views, count(DISTINCT session_id)::int AS visits,
       coalesce(round(avg(duration) FILTER (WHERE duration > 0)),0)::int AS avg_time
       FROM page_views WHERE ${RANGE('created_at')} GROUP BY path ORDER BY views DESC LIMIT 15`, r),
    q(`SELECT p.id, p.name, p.slug, v.views, v.viewers, coalesce(c.carts,0)::int AS carts, coalesce(v.avg_time,0)::int AS avg_time
       FROM (SELECT product_id, count(*)::int AS views, count(DISTINCT visitor_id)::int AS viewers, round(avg(duration) FILTER (WHERE duration > 0)) AS avg_time
             FROM page_views WHERE product_id IS NOT NULL AND ${RANGE('created_at')} GROUP BY product_id) v
       JOIN products p ON p.id = v.product_id
       LEFT JOIN (SELECT ref, count(*) AS carts FROM visit_events WHERE event='add_to_cart' AND ${RANGE('created_at')} GROUP BY ref) c ON c.ref = p.id::text
       ORDER BY v.views DESC LIMIT 15`, r),
    q(`SELECT source, count(*)::int AS n, count(*) FILTER (WHERE order_code <> '')::int AS orders FROM visit_sessions WHERE ${RANGE('started_at')} GROUP BY source ORDER BY n DESC LIMIT 12`, r),
    q(`SELECT country, region, city, count(*)::int AS n, count(DISTINCT visitor_id)::int AS visitors FROM visit_sessions
       WHERE ${RANGE('started_at')} GROUP BY 1,2,3 ORDER BY n DESC LIMIT 15`, r),
    q(`SELECT country, region, count(*)::int AS n FROM visit_sessions WHERE ${RANGE('started_at')} AND region <> '' GROUP BY 1,2 ORDER BY n DESC LIMIT 15`, r),
    q(`SELECT country, count(*)::int AS n FROM visit_sessions WHERE ${RANGE('started_at')} GROUP BY 1 ORDER BY n DESC LIMIT 10`, r),
    q(`SELECT device, count(*)::int AS n FROM visit_sessions WHERE ${RANGE('started_at')} GROUP BY 1 ORDER BY n DESC`, r),
    q(`SELECT browser, count(*)::int AS n FROM visit_sessions WHERE ${RANGE('started_at')} GROUP BY 1 ORDER BY n DESC LIMIT 10`, r),
    q(`SELECT os, count(*)::int AS n FROM visit_sessions WHERE ${RANGE('started_at')} GROUP BY 1 ORDER BY n DESC LIMIT 10`, r),
    q(`SELECT ref_host, count(*)::int AS n FROM visit_sessions WHERE ${RANGE('started_at')} AND ref_host <> '' GROUP BY 1 ORDER BY n DESC LIMIT 10`, r),
    q(`SELECT campaign, source, count(*)::int AS n, count(*) FILTER (WHERE order_code <> '')::int AS orders FROM visit_sessions
       WHERE ${RANGE('started_at')} AND campaign <> '' GROUP BY 1,2 ORDER BY n DESC LIMIT 10`, r),
    one(`SELECT count(*)::int AS all_sessions,
       count(*) FILTER (WHERE EXISTS (SELECT 1 FROM page_views pv WHERE pv.session_id = s.id AND pv.product_id IS NOT NULL))::int AS viewed,
       count(*) FILTER (WHERE EXISTS (SELECT 1 FROM visit_events e WHERE e.session_id = s.id AND e.event = 'add_to_cart'))::int AS carted,
       count(*) FILTER (WHERE EXISTS (SELECT 1 FROM visit_events e WHERE e.session_id = s.id AND e.event = 'begin_checkout'))::int AS checkout,
       count(*) FILTER (WHERE s.order_code <> '')::int AS ordered
       FROM visit_sessions s WHERE ${RANGE('s.started_at')}`, r),
    q(`SELECT label, count(*)::int AS n FROM visit_events WHERE event='contact' AND ${RANGE('created_at')} GROUP BY 1 ORDER BY n DESC`, r),
    q(`SELECT CASE WHEN brand <> '' THEN brand WHEN device = 'desktop' THEN 'কম্পিউটার/ল্যাপটপ' ELSE 'অজানা' END AS brand, count(*)::int AS n
       FROM visit_sessions WHERE ${RANGE('started_at')} GROUP BY 1 ORDER BY n DESC LIMIT 12`, r),
    q(`SELECT brand, model, count(*)::int AS n FROM visit_sessions WHERE ${RANGE('started_at')} AND model <> '' GROUP BY 1,2 ORDER BY n DESC LIMIT 15`, r),
    one(`SELECT count(*) FILTER (WHERE country = 'BD')::int AS bd, count(*) FILTER (WHERE net = 'vpn')::int AS vpn,
       count(*) FILTER (WHERE net = 'abroad')::int AS abroad, count(*) FILTER (WHERE country = '')::int AS unknown
       FROM visit_sessions WHERE ${RANGE('started_at')}`, r),
  ]);
  return { k, live: live.n, daily, hours, pages, products, sources, cities, regions, countries, devices, browsers, oses, referrers, campaigns, funnel, contacts, brands, models, net };
}

async function liveSessions() {
  return q(`SELECT s.*, extract(epoch FROM (s.last_seen - s.started_at))::int AS on_site,
      (SELECT title FROM page_views pv WHERE pv.session_id = s.id ORDER BY pv.id DESC LIMIT 1) AS exit_title,
      v.visits AS total_visits, v.name AS visitor_name, v.phone AS visitor_phone, oa.*
    FROM visit_sessions s JOIN visitors v ON v.id = s.visitor_id
    LEFT JOIN LATERAL (SELECT o.district AS o_district, o.thana AS o_thana, o.address AS o_address FROM orders o
      WHERE o.code = s.order_code OR (v.phone <> '' AND o.phone = v.phone) ORDER BY (o.code = s.order_code) DESC, o.created_at DESC LIMIT 1) oa ON true
    WHERE s.last_seen > now() - interval '${LIVE_MINUTES} minutes' ORDER BY s.last_seen DESC LIMIT 200`);
}

function sessionWhere(f, params) {
  const where = [];
  if (f.from) { params.push(f.from); where.push(`${DAY('s.started_at')} >= $${params.length}::date`); }
  if (f.to) { params.push(f.to); where.push(`${DAY('s.started_at')} <= $${params.length}::date`); }
  if (f.source) { params.push(f.source); where.push(`s.source = $${params.length}`); }
  if (f.device) { params.push(f.device); where.push(`s.device = $${params.length}`); }
  if (f.ordered) where.push(`s.order_code <> ''`);
  if (f.net === 'vpn' || f.net === 'abroad') { params.push(f.net); where.push(`s.net = $${params.length}`); }
  if (f.net === 'bd') where.push(`s.country = 'BD'`);
  if (f.visitor) { params.push(f.visitor); where.push(`s.visitor_id = $${params.length}`); }
  if (f.q) {
    params.push(`%${f.q}%`);
    const n = params.length;
    where.push(`(s.city ILIKE $${n} OR s.ip ILIKE $${n} OR s.landing ILIKE $${n} OR s.exit_path ILIKE $${n} OR s.order_code ILIKE $${n}
      OR v.name ILIKE $${n} OR v.phone ILIKE $${n} OR EXISTS (SELECT 1 FROM page_views pv WHERE pv.session_id = s.id AND (pv.path ILIKE $${n} OR pv.title ILIKE $${n})))`);
  }
  return where.length ? 'WHERE ' + where.join(' AND ') : '';
}
async function listSessions(f, { limit = 50, offset = 0 } = {}) {
  const params = [];
  const where = sessionWhere(f, params);
  params.push(limit, offset);
  return q(`SELECT s.*, v.visits AS total_visits, v.name AS visitor_name, v.phone AS visitor_phone,
      (SELECT count(*) FROM visit_events e WHERE e.session_id = s.id AND e.event = 'add_to_cart')::int AS carts, oa.*
    FROM visit_sessions s JOIN visitors v ON v.id = s.visitor_id
    LEFT JOIN LATERAL (SELECT o.district AS o_district, o.thana AS o_thana, o.address AS o_address FROM orders o
      WHERE o.code = s.order_code OR (v.phone <> '' AND o.phone = v.phone) ORDER BY (o.code = s.order_code) DESC, o.created_at DESC LIMIT 1) oa ON true ${where}
    ORDER BY s.started_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
}
async function countSessions(f) {
  const params = [];
  const where = sessionWhere(f, params);
  return (await one(`SELECT count(*)::int AS n FROM visit_sessions s JOIN visitors v ON v.id = s.visitor_id ${where}`, params)).n;
}
async function sourceList() {
  return (await q(`SELECT DISTINCT source FROM visit_sessions WHERE started_at > now() - interval '90 days' ORDER BY source LIMIT 60`)).map((r) => r.source);
}

async function getSession(id) {
  const s = await one(`SELECT s.*, v.first_seen, v.visits AS total_visits, v.pageviews AS total_pageviews, v.name AS visitor_name,
      v.phone AS visitor_phone, v.orders AS total_orders, oa.*
    FROM visit_sessions s JOIN visitors v ON v.id = s.visitor_id
    LEFT JOIN LATERAL (SELECT o.district AS o_district, o.thana AS o_thana, o.address AS o_address FROM orders o
      WHERE o.code = s.order_code OR (v.phone <> '' AND o.phone = v.phone) ORDER BY (o.code = s.order_code) DESC, o.created_at DESC LIMIT 1) oa ON true WHERE s.id = $1`, [id]);
  if (!s) return null;
  const [views, events, others] = await Promise.all([
    q(`SELECT pv.*, p.name AS product_name FROM page_views pv LEFT JOIN products p ON p.id = pv.product_id WHERE pv.session_id = $1 ORDER BY pv.id`, [id]),
    q(`SELECT * FROM visit_events WHERE session_id = $1 ORDER BY id`, [id]),
    q(`SELECT id, started_at, pageviews, duration, source, order_code FROM visit_sessions WHERE visitor_id = $1 AND id <> $2 ORDER BY started_at DESC LIMIT 20`, [s.visitor_id, id]),
  ]);
  return { ...s, views, events, others };
}

async function clearAll() {
  await db.pg.exec('TRUNCATE page_views, visit_events, visit_sessions, visitors');
}

module.exports = {
  record, overview, liveSessions, listSessions, countSessions, sourceList, getSession, clearAll, cleanup,
  parseUA, sourceOf, deviceDetails, netFlag, brandOf, place, countryName, flag, regionName, isBot, LIVE_MINUTES,
};
