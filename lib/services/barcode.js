'use strict';
// Code 128 barcodes (no outside library): text → SVG. Every phone scanner app, USB/Bluetooth barcode
// gun and courier scanner reads Code 128. Uses code set B (all normal letters, digits and signs),
// switching to code set C for long runs of digits so number-only codes stay short.

// bar/space widths for values 0–106 (each symbol is 11 modules; stop is 13)
const P = ['212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213', '221312', '231212', '112232', '122132', '122231', '113222',
  '123122', '123221', '223211', '221132', '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211', '212123', '212321', '232121',
  '111323', '131123', '131321', '112313', '132113', '132311', '211313', '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111', '314111', '221411', '431111', '111224', '111422', '121124', '121421',
  '141122', '141221', '112214', '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111', '111242', '121142', '121241', '114212',
  '124112', '124211', '411212', '421112', '421211', '212141', '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141', '114131',
  '311141', '411131', '211412', '211214', '211232', '2331112'];
const START_B = 104; const START_C = 105; const TO_C = 99; const TO_B = 100; const STOP = 106;

// Only printable ASCII is allowed in a barcode (what a scanner can type back)
function clean(text) { return String(text || '').replace(/[^\x20-\x7e]/g, '').slice(0, 48); }

// text → list of symbol values (with start, checksum and stop)
function values(text) {
  const s = clean(text);
  if (!s) throw new Error('empty barcode');
  const out = [];
  const digitsAt = (i) => { let n = 0; while (i + n < s.length && s[i + n] >= '0' && s[i + n] <= '9') n += 1; return n; };
  let set = digitsAt(0) >= 4 && digitsAt(0) % 2 === 0 ? 'C' : 'B';
  out.push(set === 'C' ? START_C : START_B);
  let i = 0;
  while (i < s.length) {
    const run = digitsAt(i);
    if (set === 'B' && run >= 6) {
      // switch to C for an even number of digits (one odd digit stays in B first)
      if (run % 2 === 1) { out.push(s.charCodeAt(i) - 32); i += 1; }
      out.push(TO_C); set = 'C';
      continue;
    }
    if (set === 'C') {
      if (digitsAt(i) >= 2) { out.push(Number(s.slice(i, i + 2))); i += 2; continue; }
      out.push(TO_B); set = 'B';
      continue;
    }
    out.push(s.charCodeAt(i) - 32); i += 1;
  }
  let sum = out[0];
  for (let k = 1; k < out.length; k++) sum += out[k] * k;
  out.push(sum % 103, STOP);
  return out;
}
// list of module widths, alternating bar, space, bar …
function widths(text) { return values(text).map((v) => P[v]).join('').split('').map(Number); }

function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

// SVG picture. module = width of the thinnest bar (in SVG units), height of bars, show the text below.
function svg(text, { height = 60, module = 2, showText = true, fontSize = 14, quiet = 10, label } = {}) {
  const w = widths(text);
  let x = quiet * module;
  let rects = '';
  w.forEach((n, k) => {
    if (k % 2 === 0) rects += `<rect x="${x}" y="0" width="${n * module}" height="${height}"/>`;
    x += n * module;
  });
  const total = x + quiet * module;
  const th = showText ? fontSize + 6 : 0;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${height + th}" width="${total}" height="${height + th}" role="img" aria-label="${esc(label || 'বারকোড ' + clean(text))}" class="bc" preserveAspectRatio="none" shape-rendering="crispEdges">`
    + `<rect width="${total}" height="${height + th}" fill="#fff"/><g fill="#000">${rects}</g>`
    + (showText ? `<text x="${total / 2}" y="${height + fontSize + 2}" text-anchor="middle" font-family="ui-monospace,Menlo,Consolas,monospace" font-size="${fontSize}" letter-spacing="1" fill="#000">${esc(clean(text))}</text>` : '')
    + '</svg>';
}

// The shop's own product barcode: SB + 6 digits of the product number (SB000123). Never reused.
function productCode(id) { return 'SB' + String(id).padStart(6, '0'); }

module.exports = { svg, values, widths, clean, productCode, PATTERNS: P };
