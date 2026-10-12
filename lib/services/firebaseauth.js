'use strict';
// 🔥 Firebase phone OTP — the server side.
// When Admin → চেকআউট OTP is set to "Firebase", Google (Firebase Authentication) sends the SMS code and checks it in
// the customer's browser. The browser then hands us Firebase's "ID token": a small note signed by Google that says
// "this person owns +8801XXXXXXXXX". Here we check Google's signature ourselves (with Google's public keys), so a
// fake note can't pass — no secret key, no extra package, and nothing to keep in the database.
const crypto = require('crypto');

const CERTS = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';
const SKEW = 300;        // seconds of clock difference we accept
const FRESH = 15 * 60;   // the code must have been typed in the last 15 minutes

let cache = { at: 0, ttl: 0, keys: null };

async function certs(force = false) {
  if (!force && cache.keys && Date.now() < cache.at + cache.ttl) return cache.keys;
  const r = await fetch(CERTS, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`Google keys: HTTP ${r.status}`);
  const keys = await r.json();
  const m = /max-age=(\d+)/.exec(r.headers.get('cache-control') || '');
  cache = { at: Date.now(), ttl: Math.min(Number(m ? m[1] : 3600), 86400) * 1000, keys };
  return keys;
}

const part = (s) => JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));

class TokenError extends Error {}

// → the token's claims (with phone_number) — or throws TokenError
async function verifyIdToken(token, projectId, opts = {}) {
  const t = String(token || '');
  const bits = t.split('.');
  if (!projectId) throw new TokenError('no project id');
  if (bits.length !== 3 || t.length > 4096) throw new TokenError('bad token');
  let head; let pay;
  try { head = part(bits[0]); pay = part(bits[1]); } catch (_) { throw new TokenError('bad token'); }
  if (head.alg !== 'RS256' || !head.kid) throw new TokenError('bad algorithm');
  const getKeys = opts.certs || certs;
  let keys = await getKeys();
  if (!keys[head.kid]) keys = await getKeys(true); // Google rotated its keys
  const pem = keys[head.kid];
  if (!pem) throw new TokenError('unknown key');
  const ok = crypto.verify('RSA-SHA256', Buffer.from(`${bits[0]}.${bits[1]}`), crypto.createPublicKey(pem), Buffer.from(bits[2], 'base64url'));
  if (!ok) throw new TokenError('bad signature');
  const now = Math.floor((opts.now || Date.now()) / 1000);
  if (pay.aud !== projectId || pay.iss !== `https://securetoken.google.com/${projectId}`) throw new TokenError('other project');
  if (!(pay.exp > now - SKEW) || !(pay.iat < now + SKEW)) throw new TokenError('expired');
  if (!pay.sub || typeof pay.sub !== 'string') throw new TokenError('no user');
  if (!(pay.auth_time > now - FRESH - SKEW)) throw new TokenError('old sign-in');
  if (!pay.firebase || pay.firebase.sign_in_provider !== 'phone' || !pay.phone_number) throw new TokenError('not a phone sign-in');
  return pay;
}

module.exports = { verifyIdToken, TokenError, CERTS };
