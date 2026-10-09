// Admin English check: lists admin phrases (Bangla) that public/js/admin-en.json doesn't translate yet.
//   node tools/admin-i18n-check.js            → prints the missing phrases
//   node tools/admin-i18n-check.js out.json   → also writes them to out.json (fill in the English, merge into admin-en.json)
// It reads every Bangla run of text between tags / ${} / quotes in the admin's code.
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const files = [
  ...fs.readdirSync(root + '/lib/admin').map((f) => 'lib/admin/' + f),
  'lib/views/admin.js', 'lib/views/invoice.js', 'public/js/admin.js', 'public/js/loginlock.js',
  'lib/models/catalog.js', 'lib/models/orders.js', 'lib/models/finance.js', 'lib/models/trash.js', 'lib/models/duplicates.js',
  'lib/models/staff.js', 'lib/models/customers.js', 'lib/models/loginlock.js', 'lib/models/content.js',
  'lib/services/research.js', 'lib/services/uiswitch.js', 'lib/services/sms.js', 'lib/services/courier.js', 'lib/services/importer.js', 'lib/security.js', 'lib/util.js',
];
const BN_LETTER = /[ঀ-৥ৰ-৿]/;
const set = new Map();
function stripComments(src) {
  src = src.replace(/\/\*[\s\S]*?\*\//g, ' ');
  return src.split('\n').map((line) => {
    // a // comment: starts the line, or follows code (not inside a URL like https://)
    const m = line.match(/(^|[\s;,{}()])\/\/(?!\S*\.(com|net|org|bd|me|io)\b)/);
    if (m) line = line.slice(0, m.index + m[1].length);
    return line;
  }).filter((l) => !/new RegExp|\.replace\(\/|\.test\(|\.match\(\/|^\s*const [A-Z_]+ = \//.test(l)).join('\n');
}
for (const f of [...new Set(files)]) {
  if (!f.endsWith('.js') || !fs.existsSync(path.join(root, f))) continue;
  const src = stripComments(fs.readFileSync(path.join(root, f), 'utf8'));
  // texts inside HTML attributes people see: placeholder, title, aria-label, confirm messages, alt
  for (const m of src.matchAll(/\b(?:placeholder|title|aria-label|data-confirm|data-confirm-btn|alt|data-on|data-off)\s*=\s*"([^"]*)"/g)) {
    for (let p of m[1].split(/\$\{|\}/)) {
      p = p.replace(/\s+/g, ' ').trim().replace(/^[\s,;:.\-–—|/(·•+=]+|[\s,;(|/·•—–\-+=]+$/g, '').trim();
      if (p && BN_LETTER.test(p) && !/=>|\bconst\b/.test(p)) set.set(p, (set.get(p) || 0) + 1);
    }
  }
  const pieces = src.split(/<\/?[a-zA-Z][^<>]*>|\$\{|\}|`|'|"|\n|=>|\|\||<|>/);
  for (let p of pieces) {
    if (!BN_LETTER.test(p)) continue;
    p = p.replace(/\s+/g, ' ').trim();
    p = p.replace(/^[\s,;:.\-–—|/(·•+=]+|[\s,;(|/·•—–\-+=]+$/g, '').trim();
    if (!p || !BN_LETTER.test(p) || p.length > 700) continue;
    if (/[{}]|=>|\bconst\b|\breturn\b|\bfunction\b|\.push\(|\.replace\(/.test(p)) continue;
    set.set(p, (set.get(p) || 0) + 1);
  }
}
const dict = JSON.parse(fs.readFileSync(path.join(root, 'public/js/admin-en.json'), 'utf8'));
const norm = (x) => x.replace(/\s+/g, ' ').trim();
const have = new Set(Object.keys(dict).map(norm));
const missing = [...set.keys()].filter((p) => !have.has(norm(p))).sort((a, b) => b.length - a.length);
if (process.argv[2]) fs.writeFileSync(process.argv[2], JSON.stringify(Object.fromEntries(missing.map((m) => [m, ''])), null, 1));
console.log(`${set.size} admin phrases, ${missing.length} without English`);
for (const m of missing.slice(0, 200)) console.log('  ' + m);
