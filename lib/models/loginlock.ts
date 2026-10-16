// Owner login lock: a second check after the username + password, only for the owner.
//
//   Passkey  — the phone's fingerprint / face unlock, Windows Hello on a laptop, or a phone scanning a QR code.
//              Standard WebAuthn: the secret key never leaves the owner's device; the site only keeps a public key.
//   (The camera face check was removed on 2026-10-14 — it did not work well. Old "both"/"split" settings act as passkey.)
//
// Modes (setting login_lock_mode):
//   off      — password only
//   passkey  — password + passkey on every device
import * as crypto from 'node:crypto';
import { q, one } from '../db';
import * as security from '../security';
import type { Body, Id, Loose, Settings, ShopRequest, StaffUser } from '../types';

const MODES = ['off', 'passkey'];
const MODE_NAMES: Record<string, string> = {
  off: 'বন্ধ (শুধু পাসওয়ার্ড)',
  passkey: 'পাসকি (আঙুলের ছাপ / Windows Hello / ফোন দিয়ে QR)',
};
function mode(settings: Settings): string {
  const m = settings.login_lock_mode;
  if (m === 'both' || m === 'split') return 'passkey'; // the old face modes (a database step moves them for good)
  return MODES.includes(m as string) ? (m as string) : 'off';
}
function isOn(settings: Settings) { return mode(settings) !== 'off'; }
function isMobile(req: ShopRequest) { return /Android|iPhone|iPod|iPad|Mobile|Opera Mini|IEMobile/i.test(String(req.headers['user-agent'] || '')); }

// What this login still needs, given the mode, the device and what is already passed.
//   passed = { passkey: bool, face: bool }
function needs(settings: Settings, req: ShopRequest, passed?: Loose) {
  const m = mode(settings);
  if (m === 'off') return null;
  return passed.passkey ? null : 'passkey';
}

// ---------------------------------------------------------------- host (WebAuthn "relying party")
function hostOf(req: ShopRequest) {
  return String(req.headers['x-forwarded-host'] || req.headers.host || 'localhost').split(',')[0].trim().toLowerCase();
}
function rpId(req: ShopRequest) { return hostOf(req).replace(/:\d+$/, ''); }
function origin(req: ShopRequest) {
  const host = hostOf(req);
  const proto = String(req.headers['x-forwarded-proto'] || (/^(localhost|127\.0\.0\.1)(:|$)/.test(host) ? 'http' : 'https')).split(',')[0].trim();
  return `${proto}://${host}`;
}

// ---------------------------------------------------------------- base64url
const b64u = (buf?: Loose) => Buffer.from(buf).toString('base64url');
const fromB64u = (s: Settings) => Buffer.from(String(s || ''), 'base64url');

// ---------------------------------------------------------------- tiny CBOR reader (enough for WebAuthn)
function cborDecode(buf?: Loose, start: Loose = 0) {
  let pos = start;
  function len(info?: Loose) {
    if (info < 24) return info;
    if (info === 24) return buf.readUInt8(pos++);
    if (info === 25) { const v = buf.readUInt16BE(pos); pos += 2; return v; }
    if (info === 26) { const v = buf.readUInt32BE(pos); pos += 4; return v; }
    if (info === 27) { const v = Number(buf.readBigUInt64BE(pos)); pos += 8; return v; }
    throw new Error('CBOR: unsupported length');
  }
  function item(): Loose {
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
function coseToKey(cose?: Loose) {
  const kty = cose.get(1);
  const alg = cose.get(3);
  let jwk;
  if (kty === 2) {
    const crv = ({ 1: 'P-256', 2: 'P-384', 3: 'P-521' } as Record<number, string>)[cose.get(-1)];
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

function parseAuthData(ad?: Loose): Loose {
  if (!Buffer.isBuffer(ad) || ad.length < 37) throw new Error('authenticator data too short');
  const out: { rpIdHash: Buffer; flags: number; signCount: number; up?: boolean; uv?: boolean; credId?: Buffer; cose?: Loose } = { rpIdHash: ad.subarray(0, 32), flags: ad[32], signCount: ad.readUInt32BE(33) };
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

function checkClientData(clientDataJSON: Loose, type: Loose, challenge: Loose, req: ShopRequest) {
  let cd;
  try { cd = JSON.parse(Buffer.from(clientDataJSON).toString('utf8')); } catch (_) { throw new Error('ক্লায়েন্ট ডেটা পড়া যায়নি'); }
  if (cd.type !== type) throw new Error('ভুল ধরনের উত্তর');
  if (cd.challenge !== challenge) throw new Error('চ্যালেঞ্জ মেলেনি');
  if (cd.origin !== origin(req)) throw new Error('অন্য ঠিকানা থেকে উত্তর এসেছে');
}

function verifySig(alg: Loose, keyPem: Loose, data: Buffer, sig?: Loose) {
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
function newChallenge(purpose?: Loose, staffId?: Id, extra: Loose = '') {
  const c = b64u(crypto.randomBytes(32));
  const exp = Date.now() + CHALLENGE_SECONDS * 1000;
  return { challenge: c, value: `${purpose}|${staffId}|${c}|${exp}|${extra}` };
}
function readChallenge(value?: Loose, purpose?: Loose, staffId?: Id) {
  if (!value) return null;
  const [p, id, c, exp, extra] = String(value).split('|');
  if (p !== purpose || Number(id) !== Number(staffId) || !c || Date.now() > Number(exp)) return null;
  return { challenge: c, extra: extra || '' };
}
// A challenge may be answered once; a copied answer can't be sent again.
async function useOnce(db?: Loose, challenge?: Loose) { return security.hit(db, 'chal:' + challenge, 1, CHALLENGE_SECONDS + 60); }

// ---------------------------------------------------------------- passkeys
async function passkeys(staffId?: Id) {
  return q('SELECT id, cred_id, rp_id, name, transports, created_at, last_used FROM owner_passkeys WHERE staff_id=$1 ORDER BY id', [staffId]);
}
async function passkeysFor(staffId?: Id, rp?: Loose) { return (await passkeys(staffId)).filter((k) => k.rp_id === rp); }

function registrationOptions(req: ShopRequest, user: StaffUser, settings: Settings, challenge?: Loose, existing?: Loose) {
  return {
    challenge,
    rp: { id: rpId(req), name: (settings.store_name || 'Shop') + ' Admin' },
    user: { id: b64u(Buffer.from('owner-' + user.id)), name: user.username, displayName: user.name || user.username },
    pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -8 }, { type: 'public-key', alg: -257 }],
    authenticatorSelection: { residentKey: 'preferred', requireResidentKey: false, userVerification: 'required' },
    attestation: 'none',
    timeout: 120000,
    excludeCredentials: existing.map((k?: Loose) => ({ type: 'public-key', id: k.cred_id })),
  };
}

async function addPasskey(req: ShopRequest, user: StaffUser, challenge?: Loose, body?: Loose) {
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
  const transports = Array.isArray(body.transports) ? body.transports.filter((t?: Loose) => /^[a-z-]{2,20}$/.test(t)).slice(0, 6).join(',') : '';
  const name = String(body.name || '').replace(/[<>]/g, '').trim().slice(0, 60) || 'আমার ডিভাইস';
  await q(`INSERT INTO owner_passkeys(staff_id, cred_id, public_key, alg, sign_count, rp_id, name, transports)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [user.id, credId, pem, alg, ad.signCount, rp, name, transports]);
  return { name, rp };
}

async function loginOptions(req: ShopRequest, staffId?: Id, challenge?: Loose) {
  const keys = await passkeysFor(staffId, rpId(req));
  return {
    challenge,
    rpId: rpId(req),
    timeout: 120000,
    userVerification: 'required',
    allowCredentials: keys.map((k) => ({ type: 'public-key', id: k.cred_id, transports: k.transports ? k.transports.split(',') : undefined })),
  };
}

async function checkPasskey(req: ShopRequest, staffId?: Id, challenge?: Loose, body?: Loose) {
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

// ---------------------------------------------------------------- one-time code for a new web address
// Passkeys belong to one web address. When the shop moves to a new address (e.g. shobmilbe.com),
// the owner makes a code at the old address and types it once at the new one.
function hashCode(c?: Loose) { return crypto.createHash('sha256').update('llc:' + String(c).replace(/\D/g, '')).digest('hex'); }
async function makeCode(staffId?: Id) {
  const code = String(crypto.randomInt(10000000, 100000000));
  await q("DELETE FROM login_lock_codes WHERE staff_id=$1 OR expires_at < now()", [staffId]);
  await q("INSERT INTO login_lock_codes(hash, staff_id, expires_at) VALUES($1,$2, now() + interval '15 minutes')", [hashCode(code), staffId]);
  return code;
}
async function useCode(staffId?: Id, code?: Loose) {
  const r = await one('DELETE FROM login_lock_codes WHERE hash=$1 AND staff_id=$2 AND expires_at > now() RETURNING hash', [hashCode(code), staffId]);
  return !!r;
}

// What a mode needs before it can be switched on.
async function readyFor(m: Loose, staffId: Id, req: ShopRequest) {
  const keys = await passkeysFor(staffId, rpId(req));
  if (m === 'passkey' && !keys.length) return 'আগে এই ঠিকানায় অন্তত একটা পাসকি (আঙুলের ছাপ) যোগ করুন।';
  return null;
}

export const _ = { cborDecode, parseAuthData, coseToKey };
export { MODES, MODE_NAMES, mode, isOn, isMobile, needs, rpId, origin, newChallenge, readChallenge, useOnce, passkeys, passkeysFor, registrationOptions, addPasskey, loginOptions, checkPasskey, makeCode, useCode, readyFor };
