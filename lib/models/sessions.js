'use strict';
// Admin logins kept on the server: every device that is logged in has a row here, so the owner can see
// "who is logged in where" and log any device out at once. The browser only holds a random token;
// the database keeps just its SHA-256, so even a copy of the database can't be used to log in.
// Also the login history: every login, wrong password, two-step failure and logout.
const crypto = require('crypto');
const { q, one } = require('../db');
const { str } = require('../util');

const MAX_DAYS = 30; // a login never lasts longer than this
const TOUCH_MS = 5 * 60e3; // "last seen" is written at most once per 5 minutes

const hashToken = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');
function idleHours(settings) {
  const h = Number(settings && settings.session_idle_hours);
  return Number.isFinite(h) && h >= 1 ? Math.min(h, MAX_DAYS * 24) : 72;
}

function deviceName(ua) {
  const { parseUA } = require('../services/visitors');
  const d = parseUA(ua);
  const kind = d.device === 'mobile' ? '📱 মোবাইল' : d.device === 'tablet' ? '📱 ট্যাবলেট' : '💻 কম্পিউটার';
  return `${kind} · ${d.os} · ${d.browser}`.slice(0, 120);
}
function placeOf(req) {
  const h = (n) => { const v = String(req.headers[n] || '').trim(); try { return decodeURIComponent(v); } catch (_) { return v; } };
  return [h('x-vercel-ip-city'), h('x-vercel-ip-country')].filter(Boolean).join(', ').slice(0, 80);
}

async function create(req, staffId, { verified = false, ip = '' } = {}) {
  const token = crypto.randomBytes(32).toString('base64url');
  const ua = str(req.headers['user-agent'], 300);
  await q(`INSERT INTO admin_sessions(id, staff_id, verified, ip, ua, device, place, expires_at)
    VALUES($1,$2,$3,$4,$5,$6,$7, now() + make_interval(days => $8))`,
  [hashToken(token), staffId, !!verified, str(ip, 64), ua, deviceName(ua), placeOf(req), MAX_DAYS]);
  if (Math.random() < 0.05) cleanup().catch(() => {});
  return token;
}

// The live session for a token, or null (logged out, expired, or unused for too long).
async function find(token, settings) {
  if (!token || token.length < 30) return null;
  const s = await one(`SELECT * FROM admin_sessions WHERE id=$1 AND revoked_at IS NULL AND expires_at > now()
    AND last_seen > now() - make_interval(hours => $2)`, [hashToken(token), idleHours(settings)]);
  if (s && Date.now() - new Date(s.last_seen).getTime() > TOUCH_MS) {
    q('UPDATE admin_sessions SET last_seen=now() WHERE id=$1', [s.id]).catch(() => {});
  }
  return s;
}

async function revoke(token, why = 'লগআউট') {
  if (!token) return;
  await q('UPDATE admin_sessions SET revoked_at=now(), revoked_why=$2 WHERE id=$1 AND revoked_at IS NULL', [hashToken(token), why]);
}
// One device, by its row id (the hash) — only for that staff member's own rows unless asOwner.
async function revokeId(id, staffId, why) {
  const r = await one(`UPDATE admin_sessions SET revoked_at=now(), revoked_why=$3 WHERE id=$1 AND ($2::int IS NULL OR staff_id=$2) AND revoked_at IS NULL RETURNING staff_id`,
    [String(id), staffId ?? null, why]);
  return r ? r.staff_id : null;
}
// Every device of one person (optionally keeping the current one).
async function revokeAll(staffId, why, exceptToken = null) {
  const rows = await q(`UPDATE admin_sessions SET revoked_at=now(), revoked_why=$2 WHERE staff_id=$1 AND revoked_at IS NULL
    AND ($3::text IS NULL OR id <> $3) RETURNING id`, [staffId, why, exceptToken ? hashToken(exceptToken) : null]);
  return rows.length;
}
async function revokeEveryone(why, exceptToken = null) {
  const rows = await q(`UPDATE admin_sessions SET revoked_at=now(), revoked_why=$1 WHERE revoked_at IS NULL AND ($2::text IS NULL OR id <> $2) RETURNING id`,
    [why, exceptToken ? hashToken(exceptToken) : null]);
  return rows.length;
}

async function listFor(staffId, settings) {
  return q(`SELECT id, device, ip, place, created_at, last_seen, verified FROM admin_sessions
    WHERE staff_id=$1 AND revoked_at IS NULL AND expires_at > now() AND last_seen > now() - make_interval(hours => $2)
    ORDER BY last_seen DESC LIMIT 30`, [staffId, idleHours(settings)]);
}
async function listActive(settings) {
  return q(`SELECT a.id, a.staff_id, a.device, a.ip, a.place, a.created_at, a.last_seen, s.name, s.username, s.role
    FROM admin_sessions a JOIN staff s ON s.id=a.staff_id
    WHERE a.revoked_at IS NULL AND a.expires_at > now() AND a.last_seen > now() - make_interval(hours => $1)
    ORDER BY a.last_seen DESC LIMIT 200`, [idleHours(settings)]);
}

// ---------------------------------------------------------------- login history
const EVENTS = {
  login: '✅ লগইন', fail: '❌ ভুল পাসওয়ার্ড', locked: '⛔ আটকানো (অনেকবার ভুল)', inactive: '🚫 বন্ধ অ্যাকাউন্টে চেষ্টা',
  step: '🔑 পাসওয়ার্ড ঠিক, দ্বিতীয় যাচাই বাকি', code_fail: '❌ ভুল যাচাই কোড', logout: '👋 লগআউট', revoked: '🔒 দূর থেকে লগআউট করানো',
  reset: '🔁 পাসওয়ার্ড রিসেট',
};
async function record(req, { staffId = null, login = '', event, ok = false, ip = '', detail = '' }) {
  try {
    await q(`INSERT INTO login_history(staff_id, login, event, ok, ip, device, place, detail) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
      [staffId, str(login, 60), event, !!ok, str(ip, 64), deviceName(req.headers['user-agent']), placeOf(req), str(detail, 300)]);
  } catch (e) { console.error('login history', e.message); }
}
function historyWhere(f, params) {
  const w = [];
  if (f.staffId) { params.push(f.staffId); w.push(`h.staff_id=$${params.length}`); }
  if (f.event) { params.push(f.event); w.push(`h.event=$${params.length}`); }
  if (f.failed) w.push(`NOT h.ok AND h.event IN ('fail','locked','inactive','code_fail')`);
  if (f.ip) { params.push(f.ip); w.push(`h.ip=$${params.length}`); }
  if (f.from) { params.push(f.from); w.push(`h.created_at >= ($${params.length}::date)::timestamp AT TIME ZONE 'Asia/Dhaka'`); }
  if (f.to) { params.push(f.to); w.push(`h.created_at < (($${params.length}::date) + 1)::timestamp AT TIME ZONE 'Asia/Dhaka'`); }
  return w.length ? 'WHERE ' + w.join(' AND ') : '';
}
async function history(f = {}, { limit = 100, offset = 0 } = {}) {
  const params = [];
  const where = historyWhere(f, params);
  params.push(limit, offset);
  return q(`SELECT h.*, s.name AS staff_name FROM login_history h LEFT JOIN staff s ON s.id=h.staff_id ${where}
    ORDER BY h.created_at DESC, h.id DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
}
async function countHistory(f = {}) {
  const params = [];
  return (await one(`SELECT count(*)::int AS n FROM login_history h ${historyWhere(f, params)}`, params)).n;
}
// Wrong passwords in the last 24 hours, grouped by where they came from.
async function failedSummary() {
  return q(`SELECT ip, max(place) AS place, count(*)::int AS n, max(created_at) AS last, string_agg(DISTINCT nullif(login,''), ', ') AS logins
    FROM login_history WHERE NOT ok AND event IN ('fail','locked','inactive','code_fail') AND created_at > now() - interval '24 hours'
    GROUP BY ip ORDER BY n DESC LIMIT 20`);
}

async function cleanup() {
  await q(`DELETE FROM admin_sessions WHERE expires_at < now() - interval '7 days' OR (revoked_at IS NOT NULL AND revoked_at < now() - interval '30 days')`);
  await q(`DELETE FROM login_history WHERE created_at < now() - interval '400 days'`);
}

module.exports = {
  create, find, revoke, revokeId, revokeAll, revokeEveryone, listFor, listActive, hashToken, idleHours,
  record, history, countHistory, failedSummary, EVENTS, deviceName, cleanup, MAX_DAYS,
};
