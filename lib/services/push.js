'use strict';
// Phone notifications (Web Push) for the owner — no app, no account, no password:
// the owner taps "এই ফোনে নোটিফিকেশন চালু করুন" in the admin once, and new orders / security alerts
// pop up on that phone like any app notification.
//
// Standard Web Push: VAPID (RFC 8292) to prove the message is from this site, and aes128gcm (RFC 8291) so
// only that phone's browser can read the message. Built with Node's crypto only (no npm packages).
const crypto = require('crypto');
const db = require('../db');

const b64u = (b) => Buffer.from(b).toString('base64url');
const fromB64u = (s) => Buffer.from(String(s || ''), 'base64url');

// ---------------------------------------------------------------- the site's own key pair (made once)
let cached = null;
async function vapid() {
  if (cached) return cached;
  const s = await db.getSettings();
  let pub = s.push_vapid_public;
  let priv = s.push_vapid_private;
  if (!pub || !priv) {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const jwk = publicKey.export({ format: 'jwk' });
    pub = b64u(Buffer.concat([Buffer.from([4]), fromB64u(jwk.x), fromB64u(jwk.y)]));
    priv = JSON.stringify(privateKey.export({ format: 'jwk' }));
    // made once, on the owner's first "turn on" tap (private half stored encrypted)
    await db.setSetting('push_vapid_private', priv);
    await db.setSetting('push_vapid_public', pub);
  }
  cached = { pub, key: crypto.createPrivateKey({ key: JSON.parse(priv), format: 'jwk' }) };
  return cached;
}
async function publicKey() { return (await vapid()).pub; }

function vapidHeader(endpoint, v) {
  const aud = new URL(endpoint).origin;
  const head = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const body = b64u(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: 'mailto:contact.shobmilbe@gmail.com' }));
  const sig = crypto.sign('sha256', Buffer.from(head + '.' + body), { key: v.key, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${head}.${body}.${b64u(sig)}, k=${v.pub}`;
}

// ---------------------------------------------------------------- RFC 8291 message encryption
function encrypt(sub, payload) {
  const uaPublic = fromB64u(sub.p256dh);
  const authSecret = fromB64u(sub.auth);
  if (uaPublic.length !== 65 || authSecret.length < 16) throw new Error('bad subscription keys');
  const ecdh = crypto.createECDH('prime256v1');
  const asPublic = ecdh.generateKeys();
  const shared = ecdh.computeSecret(uaPublic);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', shared, authSecret, keyInfo, 32));
  const salt = crypto.randomBytes(16);
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const c = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const ct = Buffer.concat([c.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), c.final(), c.getAuthTag()]);
  const rs = Buffer.alloc(4); rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([65]), asPublic, ct]);
}

// Only the real push services of phone/computer browsers (stops the admin being tricked into calling other sites).
const PUSH_HOSTS = /(^|\.)(fcm\.googleapis\.com|android\.googleapis\.com|push\.services\.mozilla\.com|push\.apple\.com|notify\.windows\.com)$/;
function okEndpoint(u) {
  try { const x = new URL(u); return x.protocol === 'https:' && PUSH_HOSTS.test(x.hostname); } catch (_) { return false; }
}

async function sendOne(sub, msg, v) {
  const body = encrypt(sub, JSON.stringify(msg));
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch(sub.endpoint, {
      method: 'POST', signal: ctrl.signal, body,
      headers: { Authorization: vapidHeader(sub.endpoint, v), TTL: '86400', Urgency: 'high', 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream' },
    });
    if (r.status === 404 || r.status === 410) { await db.q('DELETE FROM push_subs WHERE id=$1', [sub.id]); return 'gone'; }
    if (!r.ok) throw new Error('push ' + r.status + ' ' + (await r.text()).slice(0, 120));
    await db.q('UPDATE push_subs SET last_ok=now(), fails=0 WHERE id=$1', [sub.id]);
    return 'ok';
  } catch (e) {
    await db.q('UPDATE push_subs SET fails=fails+1 WHERE id=$1', [sub.id]).catch(() => {});
    throw e;
  } finally { clearTimeout(t); }
}

// msg = { title, body, url, tag }
async function sendAll(msg) {
  const subs = await db.q("SELECT p.* FROM push_subs p JOIN staff s ON s.id=p.staff_id WHERE s.role='owner' AND s.active");
  if (!subs.length) return 0;
  const v = await vapid();
  let ok = 0;
  let lastErr = null;
  await Promise.all(subs.map((s) => sendOne(s, msg, v).then((r) => { if (r === 'ok') ok += 1; }).catch((e) => { lastErr = e; })));
  if (!ok && lastErr) throw lastErr;
  return ok;
}
async function count() { return (await db.one("SELECT count(*)::int AS n FROM push_subs p JOIN staff s ON s.id=p.staff_id WHERE s.role='owner'")).n; }

async function subscribe(staffId, sub, device) {
  const endpoint = String(sub && sub.endpoint || '');
  const keys = (sub && sub.keys) || {};
  if (!okEndpoint(endpoint) || endpoint.length > 1000) throw new Error('এই ব্রাউজারের নোটিফিকেশন ঠিকানা চেনা যায়নি');
  if (fromB64u(keys.p256dh).length !== 65 || fromB64u(keys.auth).length < 16) throw new Error('নোটিফিকেশনের চাবি ঠিক নেই');
  if ((await count()) >= 10) throw new Error('সর্বোচ্চ ১০টা ডিভাইস রাখা যায়, পুরোনো একটা মুছুন');
  await db.q(`INSERT INTO push_subs(staff_id, endpoint, p256dh, auth, device) VALUES($1,$2,$3,$4,$5)
    ON CONFLICT (endpoint) DO UPDATE SET staff_id=EXCLUDED.staff_id, p256dh=EXCLUDED.p256dh, auth=EXCLUDED.auth, device=EXCLUDED.device, fails=0`,
  [staffId, endpoint, String(keys.p256dh), String(keys.auth), String(device || '').slice(0, 60)]);
}

// ---------------------------------------------------------------- customers (offer notifications)
// Customers who tapped "হ্যাঁ" on the shop's 🔔 box. Same Web Push, separate list (shop_push_subs).
async function shopSubscribe(sub, { customerId = null, device = '' } = {}) {
  const endpoint = String(sub && sub.endpoint || '');
  const keys = (sub && sub.keys) || {};
  if (!okEndpoint(endpoint) || endpoint.length > 1000) throw new Error('bad endpoint');
  if (fromB64u(keys.p256dh).length !== 65 || fromB64u(keys.auth).length < 16) throw new Error('bad keys');
  await db.q(`INSERT INTO shop_push_subs(endpoint, p256dh, auth, customer_id, device) VALUES($1,$2,$3,$4,$5)
    ON CONFLICT (endpoint) DO UPDATE SET p256dh=EXCLUDED.p256dh, auth=EXCLUDED.auth, customer_id=coalesce(EXCLUDED.customer_id, shop_push_subs.customer_id), fails=0`,
  [endpoint, String(keys.p256dh), String(keys.auth), customerId, String(device || '').slice(0, 60)]);
}
async function shopUnsubscribe(endpoint) { await db.q('DELETE FROM shop_push_subs WHERE endpoint=$1', [String(endpoint || '').slice(0, 1000)]); }
async function shopCount() { return (await db.one('SELECT count(*)::int AS n FROM shop_push_subs')).n; }
// One batch of a campaign: the next `limit` subscribers after `afterId`. Returns { sent, failed, lastId, done }.
async function shopSendBatch(msg, { afterId = 0, limit = 300 } = {}) {
  const subs = await db.q('SELECT * FROM shop_push_subs WHERE id > $1 ORDER BY id LIMIT $2', [afterId, limit]);
  if (!subs.length) return { sent: 0, failed: 0, lastId: afterId, done: true };
  const v = await vapid();
  let sent = 0; let failed = 0;
  for (let i = 0; i < subs.length; i += 25) {
    await Promise.all(subs.slice(i, i + 25).map(async (sub) => {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 8000);
      try {
        const r = await fetch(sub.endpoint, { method: 'POST', signal: ctrl.signal, body: encrypt(sub, JSON.stringify(msg)),
          headers: { Authorization: vapidHeader(sub.endpoint, v), TTL: '172800', Urgency: 'normal', 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream' } });
        if (r.status === 404 || r.status === 410) { await db.q('DELETE FROM shop_push_subs WHERE id=$1', [sub.id]); failed += 1; return; }
        if (!r.ok) throw new Error('push ' + r.status);
        sent += 1;
        await db.q('UPDATE shop_push_subs SET last_ok=now(), fails=0 WHERE id=$1', [sub.id]);
      } catch (_) {
        failed += 1;
        // a phone that failed many times in a row is dropped
        await db.q('UPDATE shop_push_subs SET fails=fails+1 WHERE id=$1', [sub.id]).catch(() => {});
        await db.q('DELETE FROM shop_push_subs WHERE id=$1 AND fails >= 5', [sub.id]).catch(() => {});
      } finally { clearTimeout(t); }
    }));
  }
  return { sent, failed, lastId: subs[subs.length - 1].id, done: subs.length < limit };
}

module.exports = { publicKey, sendAll, subscribe, count, okEndpoint, shopSubscribe, shopUnsubscribe, shopCount, shopSendBatch, _: { encrypt, vapidHeader } };
