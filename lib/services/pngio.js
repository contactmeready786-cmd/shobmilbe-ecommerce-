'use strict';
// Tiny PNG reader/writer (only Node's own zlib — no extra packages).
// Read: 8/16-bit grey, grey+alpha, RGB, RGBA and palette pictures, non-interlaced
// (ImageKit always hands pictures over like that when asked for f-png).
// Write: 8-bit RGB (a white-background product photo needs no transparency).
const zlib = require('zlib');

const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const isPng = (b) => Buffer.isBuffer(b) && b.length > 8 && b.subarray(0, 8).equals(SIG);

// → { width, height, data } where data is RGBA, 4 bytes per pixel
function decode(buf) {
  if (!isPng(buf)) throw new Error('not a PNG');
  let pos = 8, width = 0, height = 0, depth = 0, ctype = 0, interlace = 0, palette = null, trns = null;
  const idat = [];
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('latin1', pos + 4, pos + 8);
    const body = buf.subarray(pos + 8, pos + 8 + len);
    pos += 12 + len;
    if (type === 'IHDR') { width = body.readUInt32BE(0); height = body.readUInt32BE(4); depth = body[8]; ctype = body[9]; interlace = body[12]; }
    else if (type === 'PLTE') palette = body;
    else if (type === 'tRNS') trns = body;
    else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
  }
  if (!width || !height || width * height > 40e6) throw new Error('picture size not readable');
  if (interlace) throw new Error('interlaced PNG');
  const chans = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ctype];
  if (!chans || ![1, 2, 4, 8, 16].includes(depth) || (depth < 8 && ctype !== 3 && ctype !== 0)) throw new Error('PNG type not supported');
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = Math.max(1, (chans * depth) >> 3); // bytes per complete pixel (for the filters)
  const stride = Math.ceil((width * chans * depth) / 8);
  if (raw.length < (stride + 1) * height) throw new Error('PNG data cut short');
  const rows = Buffer.alloc(stride * height);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = rows.subarray(y * stride, (y + 1) * stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
      let v = src[i];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      cur[i] = v & 255;
    }
    prev = cur;
  }
  const out = Buffer.alloc(width * height * 4);
  const sample = (row, x, c) => { // one channel value scaled to 0-255
    if (depth === 8) return row[x * chans + c];
    if (depth === 16) return row[(x * chans + c) * 2];
    const per = 8 / depth, byte = row[Math.floor(x / per)], shift = 8 - depth * ((x % per) + 1);
    const v = (byte >> shift) & ((1 << depth) - 1);
    return ctype === 3 ? v : Math.round((v * 255) / ((1 << depth) - 1));
  };
  const rawSample = (row, x) => { // palette index / grey level before scaling (for tRNS)
    if (depth === 16) return row.readUInt16BE(x * 2);
    if (depth === 8) return row[x];
    const per = 8 / depth, byte = row[Math.floor(x / per)];
    return (byte >> (8 - depth * ((x % per) + 1))) & ((1 << depth) - 1);
  };
  for (let y = 0; y < height; y++) {
    const row = rows.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      if (ctype === 3) {
        const idx = rawSample(row, x);
        out[o] = palette ? palette[idx * 3] : 0; out[o + 1] = palette ? palette[idx * 3 + 1] : 0; out[o + 2] = palette ? palette[idx * 3 + 2] : 0;
        out[o + 3] = trns && idx < trns.length ? trns[idx] : 255;
      } else if (ctype === 0 || ctype === 4) {
        const g = sample(row, x, 0);
        out[o] = out[o + 1] = out[o + 2] = g;
        out[o + 3] = ctype === 4 ? sample(row, x, 1) : (trns && trns.length >= 2 && rawSample(row, x) === trns.readUInt16BE(0) ? 0 : 255);
      } else {
        out[o] = sample(row, x, 0); out[o + 1] = sample(row, x, 1); out[o + 2] = sample(row, x, 2);
        out[o + 3] = ctype === 6 ? sample(row, x, 3) : 255;
      }
    }
  }
  return { width, height, data: out };
}

const CRC = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; })();
function crc32(buf) { let c = -1; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; }
function chunk(type, body) {
  const len = Buffer.alloc(4); len.writeUInt32BE(body.length);
  const tb = Buffer.concat([Buffer.from(type, 'latin1'), body]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(tb));
  return Buffer.concat([len, tb, crc]);
}

// RGBA pixels → 8-bit RGB PNG (alpha is dropped: the picture is already on white).
function encodeRGB(width, height, rgba) {
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  const line = Buffer.alloc(stride), prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) { const i = (y * width + x) * 4; line[x * 3] = rgba[i]; line[x * 3 + 1] = rgba[i + 1]; line[x * 3 + 2] = rgba[i + 2]; }
    // "Paeth" filter on every row: photos compress best with it
    const o = y * (stride + 1);
    raw[o] = 4;
    for (let i = 0; i < stride; i++) {
      const a = i >= 3 ? line[i - 3] : 0, b = prev[i], c = i >= 3 ? prev[i - 3] : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      raw[o + 1 + i] = (line[i] - (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
    }
    line.copy(prev);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([SIG, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 7 })), chunk('IEND', Buffer.alloc(0))]);
}

module.exports = { isPng, decode, encodeRGB };
