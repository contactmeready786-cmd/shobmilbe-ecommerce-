'use strict';
// Safe download from another website (used by product import).
// The admin types a link; the server fetches it. To stop that being used to reach
// our own private network (cloud metadata, the database host, localhost …):
//   • only http / https on normal ports
//   • every address the name points to is checked — private / local addresses are refused
//     (checked again on every redirect, and at connect time, so DNS tricks don't work)
//   • size and time limits, at most 5 redirects
const http = require('http');
const https = require('https');
const dns = require('dns');
const net = require('net');
const zlib = require('zlib');

// An ordinary browser name — other shops' logs never show who is reading their public lists.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const PORTS = new Set(['', '80', '443', '8080', '8443']);

function v4Private(ip) {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some((x) => !Number.isInteger(x) || x < 0 || x > 255)) return true;
  const [a, b] = p;
  return a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 100 && b >= 64 && b <= 127) // carrier NAT
    || (a === 169 && b === 254) // link-local / cloud metadata
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 192 && b === 0 && p[2] === 0)
    || (a === 192 && b === 0 && p[2] === 2)
    || (a === 198 && (b === 18 || b === 19))
    || (a === 198 && b === 51 && p[2] === 100)
    || (a === 203 && b === 0 && p[2] === 113);
}
function isPrivate(ip) {
  const s = String(ip || '').toLowerCase().replace(/^\[|\]$/g, '').split('%')[0];
  if (net.isIPv4(s)) return v4Private(s);
  if (!net.isIPv6(s)) return true;
  if (s === '::' || s === '::1') return true;
  const mapped = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/) || s.match(/^64:ff9b::(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return v4Private(mapped[1]);
  if (/^::ffff:/.test(s)) return true; // hex-written mapped address — refuse
  const first = parseInt(s.split(':')[0] || '0', 16);
  if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((first & 0xff00) === 0xff00) return true; // multicast
  if (s.startsWith('2001:db8')) return true;
  return false;
}

class FetchError extends Error {
  constructor(message, code) { super(message); this.code = code; }
}

// Checked at connect time: the address really used is the address that was checked.
function safeLookup(hostname, options, cb) {
  if (typeof options === 'function') { cb = options; options = {}; }
  dns.lookup(hostname, { all: true, verbatim: true }, (err, addrs) => {
    if (err) return cb(err);
    if (!addrs.length || addrs.some((a) => isPrivate(a.address))) {
      return cb(new FetchError('এই ঠিকানায় যাওয়া নিরাপদ নয় (ভেতরের নেটওয়ার্ক)।', 'EBLOCKED'));
    }
    const want = options && options.family ? addrs.filter((a) => a.family === options.family) : addrs;
    const list = want.length ? want : addrs;
    if (options && options.all) return cb(null, list);
    return cb(null, list[0].address, list[0].family);
  });
}

function checkUrl(u) {
  let url;
  try { url = new URL(String(u).trim()); } catch (_) { throw new FetchError('লিংকটি ঠিক নেই।', 'EURL'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new FetchError('শুধু http:// বা https:// লিংক দেওয়া যাবে।', 'EURL');
  if (url.username || url.password) throw new FetchError('লিংকে ইউজারনেম/পাসওয়ার্ড দেওয়া যাবে না।', 'EURL');
  if (!PORTS.has(url.port)) throw new FetchError('এই পোর্টের লিংক খোলা যাবে না।', 'EBLOCKED');
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || !host.includes('.') && !net.isIP(host)) {
    throw new FetchError('এই ঠিকানায় যাওয়া নিরাপদ নয়।', 'EBLOCKED');
  }
  if (net.isIP(host) && isPrivate(host)) throw new FetchError('এই ঠিকানায় যাওয়া নিরাপদ নয় (ভেতরের নেটওয়ার্ক)।', 'EBLOCKED');
  return url;
}

function once(url, { maxBytes, timeoutMs, accept, deadline }) {
  return new Promise((resolve, reject) => {
    const mod = url.protocol === 'https:' ? https : http;
    const left = Math.max(1000, Math.min(timeoutMs, deadline - Date.now()));
    const req = mod.request(url, {
      method: 'GET',
      lookup: safeLookup,
      agent: false,
      headers: {
        'User-Agent': UA,
        Accept: accept || '*/*',
        'Accept-Encoding': 'gzip, deflate, br',
        'Accept-Language': 'bn-BD,bn;q=0.9,en;q=0.8',
      },
      timeout: left,
    });
    const timer = setTimeout(() => req.destroy(new FetchError('ওয়েবসাইট সময়মতো উত্তর দেয়নি।', 'ETIMEOUT')), left);
    req.on('timeout', () => req.destroy(new FetchError('ওয়েবসাইট সময়মতো উত্তর দেয়নি।', 'ETIMEOUT')));
    req.on('error', (e) => { clearTimeout(timer); reject(e); });
    req.on('response', (res) => {
      const status = res.statusCode || 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume(); clearTimeout(timer);
        return resolve({ redirect: res.headers.location, status });
      }
      const enc = String(res.headers['content-encoding'] || '').toLowerCase().trim();
      let stream = res;
      if (enc === 'gzip' || enc === 'x-gzip') stream = res.pipe(zlib.createGunzip());
      else if (enc === 'deflate') stream = res.pipe(zlib.createInflate());
      else if (enc === 'br') stream = res.pipe(zlib.createBrotliDecompress());
      const chunks = [];
      let size = 0;
      stream.on('data', (c) => {
        size += c.length;
        if (size > maxBytes) { req.destroy(); stream.destroy(); clearTimeout(timer); reject(new FetchError('ফাইলটি অনেক বড়।', 'ETOOBIG')); return; }
        chunks.push(c);
      });
      stream.on('end', () => {
        clearTimeout(timer);
        resolve({ status, headers: res.headers, body: Buffer.concat(chunks), contentType: String(res.headers['content-type'] || '').toLowerCase() });
      });
      stream.on('error', (e) => { clearTimeout(timer); reject(e); });
    });
    req.end();
  });
}

// Returns { status, ok, body (Buffer), contentType, finalUrl }. Throws FetchError with a Bangla message.
async function safeFetch(u, { maxBytes = 15 * 1024 * 1024, timeoutMs = 12000, accept, maxRedirects = 5 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let url = checkUrl(u);
  for (let i = 0; i <= maxRedirects; i++) {
    let r;
    try {
      r = await once(url, { maxBytes, timeoutMs, accept, deadline });
    } catch (e) {
      if (e instanceof FetchError) throw e;
      if (e && e.code === 'ENOTFOUND') throw new FetchError('এই নামের কোনো ওয়েবসাইট পাওয়া যায়নি। লিংক ঠিক আছে কি না দেখুন।', 'ENOTFOUND');
      throw new FetchError('ওয়েবসাইটে ঢোকা যায়নি' + (e && e.code ? ` (${e.code})` : '') + '।', 'ENET');
    }
    if (r.redirect) {
      url = checkUrl(new URL(r.redirect, url).toString());
      continue;
    }
    return { ...r, ok: r.status >= 200 && r.status < 300, finalUrl: url.toString() };
  }
  throw new FetchError('লিংকটি বারবার অন্য জায়গায় পাঠাচ্ছে।', 'EREDIRECT');
}

module.exports = { safeFetch, isPrivate, checkUrl, FetchError };
