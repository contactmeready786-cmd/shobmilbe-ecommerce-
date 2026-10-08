'use strict';
// Security watch ("সন্দেহজনক ভিজিটর"): notices visitors who try to harm the site and lets the owner shut them out.
//
// What counts as suspicious — things a normal shopper never does:
//   probe        asking for hacking targets that don't exist here (/wp-login.php, /.env, /phpmyadmin, *.php …)
//   attack       sending harmful code in a link (SQL injection, <script>, ../../etc/passwd …)
//   login_fail   wrong admin password
//   flood        far too many requests in a short time (fake orders, coupon guessing, copying the site)
//   blocked_order a blocked number/IP tried to order again
//
// Blocking: blocklist rows with kind 'site' shut that IP out of the whole shop (the admin panel stays open,
// so the owner can never lock himself out). Optional auto-block for 24 hours after repeated hacking attempts.
const db = require('../db');
const security = require('../security');

const KINDS = {
  probe: ['🕳️', 'হ্যাকিংয়ের দুর্বল জায়গা খুঁজেছে'],
  attack: ['💉', 'লিংকে ক্ষতিকর কোড পাঠিয়েছে'],
  login_fail: ['🔑', 'অ্যাডমিনে ভুল পাসওয়ার্ড'],
  flood: ['🌊', 'অস্বাভাবিক দ্রুত রিকোয়েস্ট'],
  blocked_order: ['⛔', 'ব্লক করা নম্বর/IP থেকে অর্ডারের চেষ্টা'],
};

// Paths that only hacking tools ask for. Matched on whole path segments so product links like
// "/p/power-backup-ups" or "/p/shell-case" are never flagged.
const PROBE_RE = new RegExp([
  '(^|/)wp-(admin|login|content|includes|json|config)', '(^|/)xmlrpc\\.php', '(^|/)\\.(env|git|svn|hg|aws|ssh|htaccess|htpasswd|DS_Store|vscode|idea)(/|$|\\.)',
  '(^|/)(phpmyadmin|pma|myadmin|adminer|mysqladmin|dbadmin)(/|$|\\.php)', '(^|/)cgi-bin(/|$)', '(^|/)vendor/phpunit', '(^|/)server-status$',
  '(^|/)actuator(/|$)', '(^|/)(web\\.config|config\\.(php|json|yml|yaml|inc)|database\\.yml|settings\\.py|id_rsa|credentials)$',
  '(^|/)(backup|dump|db|database|site|www)\\.(zip|sql|tar|gz|rar|7z|bak)$', '\\.(php\\d?|asp|aspx|jsp|cgi|pl|sh)$', '(^|/)boaform(/|$)', '(^|/)HNAP1',
].join('|'), 'i');
// Harmful code inside the address (path or query).
const ATTACK_RE = /<\s*script|%3c\s*script|javascript:|union(\s|\+|%20|\/\*\*\/)+(all(\s|\+|%20)+)?select|\bsleep\s*\(\s*\d|benchmark\s*\(|\bwaitfor\s+delay\b|(\.\.\/){2,}|(\.\.%2f){2,}|\/etc\/(passwd|shadow)|\bonerror\s*=|\$\{jndi:|\bcmd\.exe\b|\/bin\/(ba)?sh\b/i;

function header(req, name) {
  const v = String((req && req.headers && req.headers[name]) || '').trim();
  try { return decodeURIComponent(v); } catch (_) { return v; }
}

// ---------------------------------------------------------------- recording
async function record({ req, ip, kind, detail = '', path = '', settings }) {
  try {
    if (!KINDS[kind]) return;
    const s = settings || (await db.getSettings());
    if (s.guard_on === '0') return;
    ip = String(ip || (req ? security.clientIp(req) : '')).slice(0, 64);
    if (!ip || ip === 'unknown') return;
    // never let an attacker fill the database: at most 60 saved events per IP per hour (the rest are still blocked/limited elsewhere)
    if (!(await security.hit(db, 'guard:' + ip, 60, 3600))) return;
    let country = req ? header(req, 'x-vercel-ip-country').toUpperCase().slice(0, 2) : '';
    let city = req ? header(req, 'x-vercel-ip-city').slice(0, 80) : '';
    if (!country) {
      const v = await db.one(`SELECT country, city FROM visit_sessions WHERE ip = $1 ORDER BY started_at DESC LIMIT 1`, [ip]).catch(() => null);
      if (v) { country = v.country; city = v.city; }
    }
    await db.q(`INSERT INTO security_events(ip, kind, detail, path, ua, country, city) VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [ip, kind, String(detail).slice(0, 300), String(path).slice(0, 300), req ? String(req.headers['user-agent'] || '').slice(0, 300) : '', country, city]);
    if (Math.random() < 0.02) db.q(`DELETE FROM security_events WHERE created_at < now() - interval '90 days'`).catch(() => {});
    await react(ip, kind, s);
  } catch (e) {
    console.error('guard', e.message);
  }
}

// After an event: tell the owner once, and (if allowed) shut out an IP that keeps trying to hack.
async function react(ip, kind, s) {
  const r = await db.one(`SELECT count(*) FILTER (WHERE kind IN ('probe','attack'))::int AS hack, count(*)::int AS n
    FROM security_events WHERE ip = $1 AND created_at > now() - interval '1 hour'`, [ip]);
  if (!r) return;
  const notify = require('./notify');
  if (r.hack >= 20 && s.guard_autoblock !== '0') {
    const done = await db.one(`INSERT INTO blocklist(kind, value, reason, expires_at) VALUES('site', $1, $2, now() + interval '24 hours')
      ON CONFLICT (kind, value) DO NOTHING RETURNING id`, [ip, `নিজে থেকে ব্লক: ১ ঘণ্টায় ${r.hack}বার হ্যাকিংয়ের চেষ্টা (২৪ ঘণ্টার জন্য)`]);
    if (done) {
      resetCache();
      await db.logActivity(null, 'blocked', 'security', null, `সাইট থেকে ২৪ ঘণ্টা ব্লক (বারবার হ্যাকিং চেষ্টা): ${ip}`);
      if (await security.hit(db, 'alert:autoblock', 1, 3600)) {
        await notify.securityAlert(s, 'হ্যাকিংয়ের চেষ্টা — IP ২৪ ঘণ্টা ব্লক করা হয়েছে', `একটা IP থেকে ১ ঘণ্টায় ${r.hack}বার সাইটে দুর্বল জায়গা খোঁজা/ক্ষতিকর কোড পাঠানো হয়েছে। তাকে ২৪ ঘণ্টার জন্য পুরো সাইট থেকে ব্লক করা হয়েছে।\nIP: ${ip}\nবিস্তারিত: অ্যাডমিন → স্টাফ ও নিরাপত্তা → সন্দেহজনক ভিজিটর`).catch(() => {});
      }
    }
    return;
  }
  if ((r.hack >= 5 || r.n >= 15) && (await security.hit(db, 'alert:guard:' + ip, 1, 6 * 3600)) && (await security.hit(db, 'alert:guard', 3, 3600))) {
    await notify.securityAlert(s, 'সন্দেহজনক ভিজিটর', `একটা IP থেকে গত ১ ঘণ্টায় ${r.n}টা সন্দেহজনক কাজ হয়েছে (${KINDS[kind][1]} ইত্যাদি)।\nIP: ${ip}\nদেখুন: অ্যাডমিন → স্টাফ ও নিরাপত্তা → সন্দেহজনক ভিজিটর`).catch(() => {});
  }
}

// Called for every shop request (not the admin): looks at the address only, costs nothing for normal visitors.
function inspect(req, path, search, settings) {
  if (settings.guard_on === '0') return;
  let q = String(search || '');
  try { q = decodeURIComponent(q.replace(/\+/g, ' ')); } catch (_) { /* keep raw */ }
  let kind = '';
  if (ATTACK_RE.test(path) || ATTACK_RE.test(q)) kind = 'attack';
  else if (PROBE_RE.test(path)) kind = 'probe';
  if (!kind) return;
  record({ req, kind, path: (path + (search || '')).slice(0, 300), settings }).catch(() => {});
}

// ---------------------------------------------------------------- whole-site block (cached for a minute per server)
let cache = null;
let cacheAt = 0;
function resetCache() { cache = null; cacheAt = 0; }
async function siteBlocked(ip) {
  if (!ip || ip === 'unknown') return false;
  if (!cache || Date.now() - cacheAt > 60e3) {
    try {
      const rows = await db.q(`SELECT value FROM blocklist WHERE kind = 'site' AND (expires_at IS NULL OR expires_at > now())`);
      cache = new Set(rows.map((r) => r.value));
      cacheAt = Date.now();
    } catch (_) { return false; }
  }
  return cache.has(ip);
}
async function blockSite(ip, reason, hours, staffId) {
  const v = String(ip || '').trim().slice(0, 64);
  if (!/^[0-9a-f:.]{3,64}$/i.test(v)) return false;
  await db.q(`INSERT INTO blocklist(kind, value, reason, created_by, expires_at) VALUES('site', $1, $2, $3, CASE WHEN $4::int > 0 THEN now() + make_interval(hours => $4::int) END)
    ON CONFLICT (kind, value) DO UPDATE SET reason = EXCLUDED.reason, expires_at = EXCLUDED.expires_at, created_at = now(), created_by = EXCLUDED.created_by`,
  [v, String(reason || '').slice(0, 300), staffId || null, Math.max(0, Number(hours) || 0)]);
  resetCache();
  return true;
}
async function unblockSite(ip) {
  await db.q(`DELETE FROM blocklist WHERE kind = 'site' AND value = $1`, [String(ip || '')]);
  resetCache();
}

// ---------------------------------------------------------------- reports
async function suspects({ days = 7, ip = '' } = {}) {
  const params = [days];
  if (ip) params.push(ip);
  return db.q(`WITH ev AS (SELECT * FROM security_events WHERE created_at > now() - make_interval(days => $1::int)${ip ? ' AND ip = $2' : ''}),
    k AS (SELECT ip, jsonb_object_agg(kind, c) AS kinds FROM (SELECT ip, kind, count(*)::int AS c FROM ev GROUP BY 1, 2) t GROUP BY ip),
    g AS (SELECT ip, count(*)::int AS n, min(created_at) AS first_at, max(created_at) AS last_at,
      (array_agg(country ORDER BY id DESC))[1] AS country, (array_agg(city ORDER BY id DESC))[1] AS city,
      (array_agg(DISTINCT path) FILTER (WHERE path <> ''))[1:4] AS paths, (array_agg(ua ORDER BY id DESC))[1] AS ua FROM ev GROUP BY ip)
    SELECT g.*, k.kinds, b.id AS block_id, b.expires_at AS block_until,
      (SELECT count(*)::int FROM visit_sessions vs WHERE vs.ip = g.ip) AS visits
    FROM g JOIN k USING (ip)
    LEFT JOIN blocklist b ON b.kind = 'site' AND b.value = g.ip AND (b.expires_at IS NULL OR b.expires_at > now())
    ORDER BY g.last_at DESC LIMIT 200`, params);
}
async function events(ip, limit = 200) {
  return db.q(`SELECT * FROM security_events WHERE ip = $1 ORDER BY id DESC LIMIT $2`, [ip, limit]);
}
async function summary(days = 7) {
  return db.one(`SELECT count(DISTINCT ip)::int AS ips, count(*)::int AS n,
      count(*) FILTER (WHERE kind IN ('probe','attack'))::int AS hack, count(*) FILTER (WHERE kind = 'login_fail')::int AS logins,
      (SELECT count(*)::int FROM blocklist WHERE kind = 'site' AND (expires_at IS NULL OR expires_at > now())) AS blocked
    FROM security_events WHERE created_at > now() - make_interval(days => $1::int)`, [days]);
}
async function siteBlocks() {
  return db.q(`SELECT b.*, s.name AS staff_name FROM blocklist b LEFT JOIN staff s ON s.id = b.created_by
    WHERE b.kind = 'site' AND (b.expires_at IS NULL OR b.expires_at > now()) ORDER BY b.created_at DESC`);
}

module.exports = { KINDS, PROBE_RE, ATTACK_RE, record, inspect, siteBlocked, blockSite, unblockSite, resetCache, suspects, events, summary, siteBlocks };
