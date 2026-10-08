'use strict';
// Owner login lock: a second check after the username + password, only for the owner.
//
//   Passkey  — the phone's fingerprint / face unlock, Windows Hello on a laptop, or a phone scanning a QR code.
//              Standard WebAuthn: the secret key never leaves the owner's device; the site only keeps a public key.
//   Face     — the camera checks the owner's face against the saved photo(s), after a "live person" test
//              (blink + turn the head left and right, in a random order chosen by the server).
//
// Modes (setting login_lock_mode):
//   off      — password only
//   passkey  — password + passkey on every device
//   both     — password + passkey; on a computer also the face check
//   split    — password + (phone: passkey / fingerprint, computer or no fingerprint: face check)
const crypto = require('crypto');
const { q, one } = require('../db');
const security = require('../security');

const MODES = ['off', 'passkey', 'both', 'split'];
const MODE_NAMES = {
  off: 'বন্ধ (শুধু পাসওয়ার্ড)',
  passkey: 'পাসকি (আঙুলের ছাপ / Windows Hello / ফোন দিয়ে QR)',
  both: 'পাসকি + ক্যামেরায় মুখ যাচাই',
  split: 'মোবাইলে আঙুলের ছাপ, কম্পিউটারে মুখ যাচাই',
};
function mode(settings) { return MODES.includes(settings.login_lock_mode) ? settings.login_lock_mode : 'off'; }
function isOn(settings) { return mode(settings) !== 'off'; }
function isMobile(req) { return /Android|iPhone|iPod|iPad|Mobile|Opera Mini|IEMobile/i.test(String(req.headers['user-agent'] || '')); }

// What this login still needs, given the mode, the device and what is already passed.
//   passed = { passkey: bool, face: bool }
function needs(settings, req, passed) {
  const m = mode(settings);
  if (m === 'off') return null;
  if (m === 'passkey') return passed.passkey ? null : 'passkey';
  if (m === 'both') {
    if (!passed.passkey) return 'passkey';
    if (!isMobile(req) && !passed.face) return 'face';
    return null;
  }
  // split: either one is enough
  return passed.passkey || passed.face ? null : 'either';
}

// ---------------------------------------------------------------- host (WebAuthn "relying party")
function hostOf(req) {
  return String(req.headers['x-forwarded-host'] || req.headers.host || 'localhost').split(',')[0].trim().toLowerCase();
}
function rpId(req) { return hostOf(req).replace(/:\d+$/, ''); }
function origin(req) {
  const host = hostOf(req);
  const proto = String(req.headers['x-forwarded-proto'] || (/^(localhost|127\.0\.0\.1)(:|$)/.test(host) ? 'http' : 'https')).split(',')[0].trim();
  return `${proto}://${host}`;
}

// ---------------------------------------------------------------- base64url
const b64u = (buf) => Buffer.from(buf).toString('base64url');
const fromB64u = (s) => Buffer.from(String(s || ''), 'base64url');

// ---------------------------------------------------------------- tiny CBOR reader (enough for WebAuthn)
function cborDecode(buf, start = 0) {
  let pos = start;
  function len(info) {
    if (info < 24) return info;
    if (info === 24) return buf.readUInt8(pos++);
    if (info === 25) { const v = buf.readUInt16BE(pos); pos += 2; return v; }
    if (info === 26) { const v = buf.readUInt32BE(pos); pos += 4; return v; }
    if (info === 27) { const v = Number(buf.readBigUInt64BE(pos)); pos += 8; return v; }
    throw new Error('CBOR: unsupported length');
  }
  function item() {
    if (pos >= buf.length) throw new Error('CBOR: truncated');
    const b = buf.readUInt8(pos++);
    const major = b >> 5;
    const info = b & 31;
    switch (major) {
      case 0: return len(info);
      case 1: return -1 - len(info);
      case 2: { const n = len(info); const v = buf.subarray(pos, pos + n); pos += n; if (v.length !== n) throw new Error('CBOR: truncated'); return v; }
      case 3: { const n = len(info); const v = buf.subarray(pos, pos + n).toString('utf8'); pos += n; return v; }
      case 4: { const n = len(info); const a = []; for (let i = 0; i < n; i++) a.push(item()); return a; }
      case 5: { const n = len(info); const m = new Map(); for (let i = 0; i < n; i++) { const k = item(); m.set(k, item()); } return m; }
      case 6: len(info); return item(); // tag: ignore
      case 7:
        if (info === 20) return false;
        if (info === 21) return true;
        if (info === 22 || info === 23) return null;
        throw new Error('CBOR: unsupported simple value');
      default: throw new Error('CBOR: bad type');
    }
  }
  const value = item();
  return { value, end: pos };
}

// COSE public key -> Node KeyObject
function coseToKey(cose) {
  const kty = cose.get(1);
  const alg = cose.get(3);
  let jwk;
  if (kty === 2) {
    const crv = { 1: 'P-256', 2: 'P-384', 3: 'P-521' }[cose.get(-1)];
    if (!crv) throw new Error('unsupported curve');
    jwk = { kty: 'EC', crv, x: b64u(cose.get(-2)), y: b64u(cose.get(-3)) };
  } else if (kty === 3) {
    jwk = { kty: 'RSA', n: b64u(cose.get(-1)), e: b64u(cose.get(-2)) };
  } else if (kty === 1 && cose.get(-1) === 6) {
    jwk = { kty: 'OKP', crv: 'Ed25519', x: b64u(cose.get(-2)) };
  } else {
    throw new Error('unsupported key type');
  }
  return { key: crypto.createPublicKey({ key: jwk, format: 'jwk' }), alg };
}

function parseAuthData(ad) {
  if (!Buffer.isBuffer(ad) || ad.length < 37) throw new Error('authenticator data too short');
  const out = { rpIdHash: ad.subarray(0, 32), flags: ad[32], signCount: ad.readUInt32BE(33) };
  out.up = !!(out.flags & 0x01);
  out.uv = !!(out.flags & 0x04);
  if (out.flags & 0x40) {
    let p = 37 + 16; // skip AAGUID
    const n = ad.readUInt16BE(p); p += 2;
    out.credId = ad.subarray(p, p + n); p += n;
    const { value } = cborDecode(ad, p);
    out.cose = value;
  }
  return out;
}

function checkClientData(clientDataJSON, type, challenge, req) {
  let cd;
  try { cd = JSON.parse(Buffer.from(clientDataJSON).toString('utf8')); } catch (_) { throw new Error('ক্লায়েন্ট ডেটা পড়া যায়নি'); }
  if (cd.type !== type) throw new Error('ভুল ধরনের উত্তর');
  if (cd.challenge !== challenge) throw new Error('চ্যালেঞ্জ মেলেনি');
  if (cd.origin !== origin(req)) throw new Error('অন্য ঠিকানা থেকে উত্তর এসেছে');
}

function verifySig(alg, keyPem, data, sig) {
  const key = crypto.createPublicKey(keyPem);
  if (alg === -7) return crypto.verify('sha256', data, { key, dsaEncoding: 'der' }, sig);
  if (alg === -35) return crypto.verify('sha384', data, { key, dsaEncoding: 'der' }, sig);
  if (alg === -36) return crypto.verify('sha512', data, { key, dsaEncoding: 'der' }, sig);
  if (alg === -257) return crypto.verify('sha256', data, key, sig);
  if (alg === -8) return crypto.verify(null, data, key, sig);
  return false;
}

// ---------------------------------------------------------------- challenges (signed cookie + one-time use)
const CHALLENGE_SECONDS = 300;
function newChallenge(purpose, staffId, extra = '') {
  const c = b64u(crypto.randomBytes(32));
  const exp = Date.now() + CHALLENGE_SECONDS * 1000;
  return { challenge: c, value: `${purpose}|${staffId}|${c}|${exp}|${extra}` };
}
function readChallenge(value, purpose, staffId) {
  if (!value) return null;
  const [p, id, c, exp, extra] = String(value).split('|');
  if (p !== purpose || Number(id) !== Number(staffId) || !c || Date.now() > Number(exp)) return null;
  return { challenge: c, extra: extra || '' };
}
// A challenge may be answered once; a copied answer can't be sent again.
async function useOnce(db, challenge) { return security.hit(db, 'chal:' + challenge, 1, CHALLENGE_SECONDS + 60); }

// ---------------------------------------------------------------- passkeys
async function passkeys(staffId) {
  return q('SELECT id, cred_id, rp_id, name, transports, created_at, last_used FROM owner_passkeys WHERE staff_id=$1 ORDER BY id', [staffId]);
}
async function passkeysFor(staffId, rp) { return (await passkeys(staffId)).filter((k) => k.rp_id === rp); }

function registrationOptions(req, user, settings, challenge, existing) {
  return {
    challenge,
    rp: { id: rpId(req), name: (settings.store_name || 'Shop') + ' Admin' },
    user: { id: b64u(Buffer.from('owner-' + user.id)), name: user.username, displayName: user.name || user.username },
    pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -8 }, { type: 'public-key', alg: -257 }],
    authenticatorSelection: { residentKey: 'preferred', requireResidentKey: false, userVerification: 'required' },
    attestation: 'none',
    timeout: 120000,
    excludeCredentials: existing.map((k) => ({ type: 'public-key', id: k.cred_id })),
  };
}

async function addPasskey(req, user, challenge, body) {
  const resp = body && body.response;
  if (!resp || !resp.clientDataJSON || !resp.attestationObject) throw new Error('উত্তর অসম্পূর্ণ');
  checkClientData(fromB64u(resp.clientDataJSON), 'webauthn.create', challenge, req);
  const att = cborDecode(fromB64u(resp.attestationObject)).value;
  if (!(att instanceof Map)) throw new Error('attestation পড়া যায়নি');
  const ad = parseAuthData(att.get('authData'));
  const rp = rpId(req);
  if (!ad.rpIdHash.equals(crypto.createHash('sha256').update(rp).digest())) throw new Error('ঠিকানা মেলেনি');
  if (!ad.up || !ad.uv) throw new Error('আঙুলের ছাপ / স্ক্রিন লক যাচাই হয়নি');
  if (!ad.credId || !ad.cose) throw new Error('চাবি পাওয়া যায়নি');
  const { key, alg } = coseToKey(ad.cose);
  if (![-7, -8, -257, -35, -36].includes(alg)) throw new Error('এই ধরনের চাবি চলে না');
  const credId = b64u(ad.credId);
  if (body.id && body.id !== credId) throw new Error('চাবির নম্বর মেলেনি');
  const pem = key.export({ type: 'spki', format: 'pem' });
  const transports = Array.isArray(body.transports) ? body.transports.filter((t) => /^[a-z-]{2,20}$/.test(t)).slice(0, 6).join(',') : '';
  const name = String(body.name || '').replace(/[<>]/g, '').trim().slice(0, 60) || 'আমার ডিভাইস';
  await q(`INSERT INTO owner_passkeys(staff_id, cred_id, public_key, alg, sign_count, rp_id, name, transports)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [user.id, credId, pem, alg, ad.signCount, rp, name, transports]);
  return { name, rp };
}

async function loginOptions(req, staffId, challenge) {
  const keys = await passkeysFor(staffId, rpId(req));
  return {
    challenge,
    rpId: rpId(req),
    timeout: 120000,
    userVerification: 'required',
    allowCredentials: keys.map((k) => ({ type: 'public-key', id: k.cred_id, transports: k.transports ? k.transports.split(',') : undefined })),
  };
}

async function checkPasskey(req, staffId, challenge, body) {
  const resp = body && body.response;
  if (!resp || !resp.clientDataJSON || !resp.authenticatorData || !resp.signature) throw new Error('উত্তর অসম্পূর্ণ');
  const cred = await one('SELECT * FROM owner_passkeys WHERE cred_id=$1 AND staff_id=$2', [String(body.id || ''), staffId]);
  if (!cred) throw new Error('এই পাসকি এই অ্যাকাউন্টের না');
  const rp = rpId(req);
  if (cred.rp_id !== rp) throw new Error('এই পাসকি অন্য ঠিকানার');
  const cdj = fromB64u(resp.clientDataJSON);
  checkClientData(cdj, 'webauthn.get', challenge, req);
  const adBuf = fromB64u(resp.authenticatorData);
  const ad = parseAuthData(adBuf);
  if (!ad.rpIdHash.equals(crypto.createHash('sha256').update(rp).digest())) throw new Error('ঠিকানা মেলেনি');
  if (!ad.up || !ad.uv) throw new Error('আঙুলের ছাপ / স্ক্রিন লক যাচাই হয়নি');
  const data = Buffer.concat([adBuf, crypto.createHash('sha256').update(cdj).digest()]);
  if (!verifySig(cred.alg, cred.public_key, data, fromB64u(resp.signature))) throw new Error('সই মেলেনি');
  // A copied (cloned) key would send an old counter.
  const stored = Number(cred.sign_count || 0);
  if (ad.signCount && stored && ad.signCount <= stored) throw new Error('এই পাসকি কপি করা মনে হচ্ছে');
  await q('UPDATE owner_passkeys SET sign_count=$1, last_used=now() WHERE id=$2', [ad.signCount, cred.id]);
  return cred;
}

// ---------------------------------------------------------------- faces
// Each saved face = the photo (kept encrypted, shown only to the owner) + its 128-number "face print".
const FACE_MATCH = 0.5;    // smaller = stricter (same person is usually 0.25–0.45)
const FACE_WORST = 0.56;   // no single camera frame may be further than this
function cleanDescriptor(d) {
  if (!Array.isArray(d) || d.length !== 128) return null;
  const v = d.map(Number);
  if (!v.every((x) => Number.isFinite(x) && Math.abs(x) < 2)) return null;
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return norm > 0.3 && norm < 3 ? v : null;
}
function dist(a, b) { let s = 0; for (let i = 0; i < 128; i++) { const d = a[i] - b[i]; s += d * d; } return Math.sqrt(s); }

async function faces(staffId) {
  return q('SELECT id, source, created_at FROM owner_faces WHERE staff_id=$1 ORDER BY id', [staffId]);
}
async function faceCount(staffId) { return (await one('SELECT count(*)::int AS n FROM owner_faces WHERE staff_id=$1', [staffId])).n; }
async function facePrints(staffId) {
  const rows = await q('SELECT descriptor FROM owner_faces WHERE staff_id=$1', [staffId]);
  return rows.map((r) => { try { return cleanDescriptor(JSON.parse(security.decrypt(r.descriptor) || 'null')); } catch (_) { return null; } }).filter(Boolean);
}
async function facePhoto(staffId, id) {
  const r = await one('SELECT photo FROM owner_faces WHERE id=$1 AND staff_id=$2', [id, staffId]);
  if (!r) return null;
  const b64 = security.decrypt(r.photo);
  return b64 ? Buffer.from(b64, 'base64') : null;
}
async function addFace(staffId, { photo, descriptor, source }) {
  const d = cleanDescriptor(descriptor);
  if (!d) throw new Error('মুখের মাপ পড়া যায়নি, আবার চেষ্টা করুন');
  const m = String(photo || '').match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/);
  if (!m) throw new Error('ছবিটি পড়া যায়নি');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 900 * 1024 || !security.imageKind(buf)) throw new Error('ছবিটি ঠিক নেই বা অনেক বড়');
  if ((await faceCount(staffId)) >= 5) throw new Error('সর্বোচ্চ ৫টি মুখের ছবি রাখা যায়। পুরোনো একটা মুছে নতুনটা দিন।');
  // A new face must look like the faces already saved (stops someone adding their own face to a stolen session).
  const prints = await facePrints(staffId);
  if (prints.length && Math.min(...prints.map((p) => dist(p, d))) > 0.6) {
    throw new Error('এই মুখ আগের সেভ করা মুখের সাথে মিলছে না। আগের ছবি মুছে তারপর নতুনটা দিন।');
  }
  await q('INSERT INTO owner_faces(staff_id, photo, descriptor, source) VALUES($1,$2,$3,$4)',
    [staffId, security.encrypt(buf.toString('base64')), security.encrypt(JSON.stringify(d.map((x) => Math.round(x * 1e6) / 1e6))), source === 'camera' ? 'camera' : 'upload']);
}

// Steps of the live-person test, in a random order each time.
function faceSteps() {
  const s = ['blink', 'left', 'right'];
  for (let i = s.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [s[i], s[j]] = [s[j], s[i]]; }
  return s;
}

// Judge a finished camera check. Returns { ok, reason, best }.
async function judgeFace(staffId, steps, body) {
  const prints = await facePrints(staffId);
  if (!prints.length) return { ok: false, reason: 'কোনো মুখের ছবি সেভ করা নেই।' };
  // 1) live-person steps, in the order the server asked, at a human speed
  const events = Array.isArray(body.events) ? body.events.slice(0, 10) : [];
  const done = events.map((e) => String(e && e.step));
  if (done.join(',') !== steps.join(',')) return { ok: false, reason: 'পলক আর মাথা ঘোরানোর ধাপগুলো ঠিকমতো হয়নি।' };
  const times = events.map((e) => Number(e.t));
  if (!times.every((t, i) => Number.isFinite(t) && t > 0 && (i === 0 || t - times[i - 1] >= 250))) return { ok: false, reason: 'ধাপগুলো অস্বাভাবিক দ্রুত হয়েছে।' };
  const total = Number(body.duration);
  if (!Number.isFinite(total) || total < 1500 || total > 120000) return { ok: false, reason: 'সময় ঠিক নেই, আবার চেষ্টা করুন।' };
  // 2) the face prints taken during the test
  const ds = (Array.isArray(body.descriptors) ? body.descriptors.slice(0, 12) : []).map(cleanDescriptor).filter(Boolean);
  if (ds.length < 3) return { ok: false, reason: 'মুখ ভালোভাবে দেখা যায়নি। আলোতে বসে সোজা তাকান।' };
  // the same person the whole time
  for (let i = 1; i < ds.length; i++) if (dist(ds[0], ds[i]) > 0.6) return { ok: false, reason: 'যাচাইয়ের মাঝে মুখ বদলে গেছে।' };
  // a replayed still picture gives identical prints every frame
  let moved = false;
  for (let i = 1; i < ds.length && !moved; i++) if (dist(ds[0], ds[i]) > 0.004) moved = true;
  if (!moved) return { ok: false, reason: 'জীবন্ত মুখ মনে হচ্ছে না।' };
  // 3) compare with the owner's saved faces
  const each = ds.map((d) => Math.min(...prints.map((p) => dist(p, d))));
  const sorted = [...each].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const worst = sorted[sorted.length - 1];
  const best = sorted[0];
  if (median > FACE_MATCH || worst > FACE_WORST) return { ok: false, reason: 'মুখ মেলেনি।', best, median };
  return { ok: true, best, median };
}

// ---------------------------------------------------------------- one-time code for a new web address
// Passkeys belong to one web address. When the shop moves to a new address (e.g. shobmilbe.com),
// the owner makes a code at the old address and types it once at the new one.
function hashCode(c) { return crypto.createHash('sha256').update('llc:' + String(c).replace(/\D/g, '')).digest('hex'); }
async function makeCode(staffId) {
  const code = String(crypto.randomInt(10000000, 100000000));
  await q("DELETE FROM login_lock_codes WHERE staff_id=$1 OR expires_at < now()", [staffId]);
  await q("INSERT INTO login_lock_codes(hash, staff_id, expires_at) VALUES($1,$2, now() + interval '15 minutes')", [hashCode(code), staffId]);
  return code;
}
async function useCode(staffId, code) {
  const r = await one('DELETE FROM login_lock_codes WHERE hash=$1 AND staff_id=$2 AND expires_at > now() RETURNING hash', [hashCode(code), staffId]);
  return !!r;
}

// What a mode needs before it can be switched on.
async function readyFor(m, staffId, req) {
  const [keys, faceN] = await Promise.all([passkeysFor(staffId, rpId(req)), faceCount(staffId)]);
  if (m === 'passkey' && !keys.length) return 'আগে এই ঠিকানায় অন্তত একটা পাসকি (আঙুলের ছাপ) যোগ করুন।';
  if (m === 'both' && (!keys.length || !faceN)) return 'আগে অন্তত একটা পাসকি আর একটা মুখের ছবি যোগ করুন।';
  if (m === 'split' && !faceN) return 'আগে অন্তত একটা মুখের ছবি যোগ করুন।';
  return null;
}

module.exports = {
  MODES, MODE_NAMES, mode, isOn, isMobile, needs, rpId, origin,
  newChallenge, readChallenge, useOnce,
  passkeys, passkeysFor, registrationOptions, addPasskey, loginOptions, checkPasskey,
  faces, faceCount, facePhoto, addFace, faceSteps, judgeFace, FACE_MATCH,
  makeCode, useCode, readyFor,
  // for tests
  _: { cborDecode, parseAuthData, coseToKey, dist, cleanDescriptor },
};
