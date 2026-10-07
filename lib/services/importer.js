'use strict';
// Product import: reads products out of a file or a link and turns them into one plain shape.
//
// Understands:
//   • CSV / TSV / semicolon files (Excel "Save as CSV", WooCommerce, Shopify, Facebook catalog …)
//   • Excel .xlsx (first sheet)
//   • Facebook / Google product feeds (XML RSS or Atom, CSV/TSV)
//   • JSON (Shopify products.json, WooCommerce Store API, a plain list)
//   • A product page link (reads the page's product data: JSON-LD / Open Graph)
//   • A category / shop page or a sitemap (returns the product page links, read one by one)
//
// The plain shape (every field optional except title):
//   { ref, title, description, short_description, price, old_price, cost_price, images[], brand,
//     category, stock, in_stock, link, youtube, weight_g, group }
const zlib = require('zlib');

const MAX_ITEMS = 5000;
const MAX_IMAGES = 6;
const BN = '০১২৩৪৫৬৭৮৯';

// ---------------------------------------------------------------- text helpers
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', bull: '•', times: '×', copy: '©', reg: '®', trade: '™', deg: '°', middot: '·', laquo: '«', raquo: '»', euro: '€', pound: '£', yen: '¥', micro: 'µ', plusmn: '±', frac12: '½', frac14: '¼', frac34: '¾', sup2: '²', sup3: '³', ohm: 'Ω', Omega: 'Ω' };
function decodeEntities(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return n > 0 && n < 0x110000 && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : '';
    }
    return ENT[e] !== undefined ? ENT[e] : ENT[e.toLowerCase()] !== undefined ? ENT[e.toLowerCase()] : m;
  });
}
function unCdata(s) { return String(s).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1'); }

// HTML description → the shop's simple text format (## heading, - bullet, blank line = paragraph)
function htmlToText(input) {
  let s = String(input ?? '');
  if (!/<[a-z!/]/i.test(s)) return decodeEntities(s).replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  s = s.replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|noscript|iframe|svg|template)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/gi, (m, t) => `\n\n## ${t.replace(/<[^>]+>/g, '').trim()}\n\n`)
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<\/(p|div|section|article|ul|ol|table|tr|h[5-6]|blockquote)>/gi, '\n\n')
    .replace(/<(p|div|section|article|ul|ol|table|tr|blockquote)\b[^>]*>/gi, '\n')
    .replace(/<\/t[dh]>/gi, '  ')
    .replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, (m, t, inner) => (inner.trim() ? `**${inner.trim()}**` : ''))
    .replace(/<[^>]+>/g, '');
  s = decodeEntities(s).replace(/\u00a0/g, ' ').replace(/\r\n?/g, '\n');
  return s.split('\n').map((l) => l.replace(/[ \t]+/g, ' ').trim()).join('\n')
    .replace(/\n- \n/g, '\n').replace(/^## \s*$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
}
function oneLine(s) { return htmlToText(s).replace(/\s+/g, ' ').trim(); }

function toAsciiDigits(s) { return String(s ?? '').replace(/[০-৯]/g, (d) => String(BN.indexOf(d))); }
// "1,250.00 BDT", "৳ ২৫০", "Tk. 99", "250 - 300" → 1250 / 250 / 99 / 250
function parsePrice(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) && v >= 0 ? Math.round(v * 100) / 100 : null;
  let s = toAsciiDigits(oneLine(v));
  s = s.replace(/(\d),(?=\d{2,3}\b)/g, '$1'); // thousands separators (1,250 / 1,25,000)
  const m = s.match(/\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) && n >= 0 && n < 1e9 ? Math.round(n * 100) / 100 : null;
}
function parseIntSafe(v) {
  if (v === null || v === undefined || v === '') return null;
  const m = toAsciiDigits(String(v)).replace(/,/g, '').match(/-?\d+/);
  if (!m) return null;
  const n = parseInt(m[0], 10);
  return Number.isFinite(n) ? Math.max(0, Math.min(n, 1e7)) : null;
}
// "0.5 kg" / "500 g" / "500" (grams) → grams
function parseWeight(v, unitHint) {
  if (v === null || v === undefined || v === '') return null;
  const s = toAsciiDigits(String(v)).toLowerCase();
  const m = s.match(/(\d+(?:\.\d+)?)\s*(kg|kilo|g|gm|gram|lb|oz)?/);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2] || unitHint || 'g';
  const g = unit.startsWith('k') ? n * 1000 : unit === 'lb' ? n * 453.6 : unit === 'oz' ? n * 28.35 : n;
  return Number.isFinite(g) ? Math.round(Math.min(g, 1e6)) : null;
}
function availability(v) {
  const s = String(v ?? '').toLowerCase().replace(/[\s_-]+/g, '');
  if (!s) return null;
  if (/^(instock|available|availablefororder|yes|true|1|in|preorder|backorder|onbackorder|স্টকেআছে|আছে)$/.test(s) || s.includes('schema.org/instock')) return true;
  if (/^(outofstock|soldout|no|false|0|out|discontinued|unavailable|স্টকেনেই|নেই)$/.test(s) || s.includes('outofstock')) return false;
  return null;
}

// Image links inside any text: "a.jpg, b.jpg | c.jpg"
function urlsIn(v) {
  if (v === null || v === undefined) return [];
  if (Array.isArray(v)) return v.flatMap(urlsIn);
  if (typeof v === 'object') return urlsIn(v.src || v.url || v.contentUrl || v.href || v.image || '');
  const s = decodeEntities(String(v));
  return (s.match(/(?:https?:)?\/\/[^\s,|"'<>\]\[]+/gi) || []).map((u) => (u.startsWith('//') ? 'https:' + u : u));
}
function absUrl(u, base) {
  if (!u) return '';
  try { return new URL(String(u).trim(), base || undefined).toString(); } catch (_) { return ''; }
}
function cleanImages(list, base) {
  const out = [];
  for (const u of list) {
    const a = absUrl(u, base);
    if (!/^https?:\/\//i.test(a)) continue;
    if (/\.(svg|ico)(\?|$)/i.test(a)) continue;
    if (!out.includes(a)) out.push(a);
    if (out.length >= MAX_IMAGES) break;
  }
  return out;
}
function hostOf(u) { try { return new URL(u).hostname.replace(/^www\./, '').toLowerCase(); } catch (_) { return ''; } }

// ---------------------------------------------------------------- column names
function normKey(k) {
  return String(k ?? '').normalize('NFC').replace(/^\uFEFF/, '').toLowerCase().replace(/^g:/, '')
    .replace(/[\s_\-.:()[\]/#*]+/g, '').trim();
}
const FIELDS = {
  id: ['id', 'productid', 'itemid', 'retailerid', 'contentid', 'handle', 'productcode', 'code', 'sku', 'variantsku', 'mpn', 'পণ্যআইডি', 'আইডি', 'কোড'],
  title: ['title', 'name', 'productname', 'producttitle', 'itemname', 'itemtitle', 'পণ্যেরনাম', 'নাম', 'পণ্য', 'টাইটেল', 'শিরোনাম'],
  description: ['description', 'longdescription', 'bodyhtml', 'body', 'productdescription', 'richtextdescription', 'details', 'content', 'fulldescription', 'বিবরণ', 'বিস্তারিতবিবরণ', 'বিস্তারিত'],
  short: ['shortdescription', 'summary', 'excerpt', 'shortdesc', 'ছোটবিবরণ', 'সংক্ষেপ'],
  price: ['price', 'regularprice', 'mrp', 'originalprice', 'variantprice', 'unitprice', 'listprice', 'retailprice', 'দাম', 'মূল্য', 'বিক্রিরদাম', 'বিক্রয়মূল্য'],
  sale: ['saleprice', 'offerprice', 'discountprice', 'specialprice', 'discountedprice', 'sellingprice', 'finalprice', 'অফারদাম', 'ছাড়েরদাম', 'অফারমূল্য'],
  compare: ['variantcompareatprice', 'compareatprice', 'comparedprice', 'oldprice', 'previousprice', 'beforeprice', 'আগেরদাম'],
  image: ['imagelink', 'image', 'imageurl', 'mainimage', 'mainimageurl', 'imagesrc', 'featuredimage', 'picture', 'photo', 'thumbnail', 'productimage', 'ছবি', 'ছবিরলিংক', 'মূলছবি', 'images'],
  extra: ['additionalimagelink', 'additionalimagelinks', 'additionalimages', 'additionalimageurls', 'gallery', 'galleryimages', 'galleryimage', 'otherimages', 'moreimages', 'images',
    'image2', 'image3', 'image4', 'image5', 'image6', 'imageurl2', 'imageurl3', 'imageurl4', 'imageurl5', 'imageurl6', 'ছবি২', 'ছবি৩', 'ছবি৪', 'ছবি৫', 'ছবি৬'],
  brand: ['brand', 'brands', 'brandname', 'vendor', 'manufacturer', 'make', 'ব্র্যান্ড', 'ব্রান্ড', 'কোম্পানি'],
  category: ['producttype', 'category', 'categories', 'productcategory', 'categoryname', 'collection', 'collections', 'type', 'ক্যাটাগরি', 'বিভাগ', 'googleproductcategory'],
  stock: ['quantitytosellonfacebook', 'quantity', 'qty', 'stock', 'stockqty', 'stockquantity', 'inventory', 'inventoryquantity', 'variantinventoryqty', 'স্টক', 'পরিমাণ'],
  avail: ['availability', 'stockstatus', 'instock', 'instock?', 'available', 'স্টকেআছে'],
  link: ['link', 'url', 'producturl', 'productlink', 'permalink', 'pageurl', 'লিংক'],
  youtube: ['youtube', 'youtubeurl', 'youtubelink', 'video', 'videourl', 'videolink', 'ভিডিও'],
  cost: ['costprice', 'purchaseprice', 'buyingprice', 'costperitem', 'buyprice', 'কেনাদাম'],
  weight: ['weight', 'shippingweight', 'productweight', 'weightg', 'weightgram', 'weightgrams', 'variantgrams', 'weightkg', 'ওজন'],
  group: ['itemgroupid', 'parent', 'parentid', 'groupid'],
  rowtype: ['type'],
};
const KNOWN = new Set(Object.values(FIELDS).flat());

// one row of named values → plain product (or null when it has no name and nothing to merge)
function fromRow(row, base) {
  const m = new Map();
  for (const [k, v] of Object.entries(row)) {
    const nk = normKey(k);
    if (!nk) continue;
    const val = Array.isArray(v) ? v.map((x) => String(x ?? '')).join(', ') : v;
    if (val === null || val === undefined || String(val).trim() === '') continue;
    if (!m.has(nk)) m.set(nk, val);
  }
  const pick = (name) => { for (const k of FIELDS[name]) if (m.has(k)) return m.get(k); return null; };
  const pickAll = (name) => FIELDS[name].filter((k) => m.has(k)).map((k) => m.get(k));
  const link = absUrl(pick('link'), base);

  let price = parsePrice(pick('price'));
  const sale = parsePrice(pick('sale'));
  const compare = parsePrice(pick('compare'));
  let oldPrice = null;
  if (sale !== null && sale > 0 && (price === null || sale < price)) { oldPrice = price; price = sale; }
  if (compare !== null && price !== null && compare > price) oldPrice = compare;
  if (oldPrice !== null && price !== null && oldPrice <= price) oldPrice = null;

  // first category-like column that holds a real name (not a Google number, not WooCommerce's "simple/variable")
  let category = null;
  for (const k of FIELDS.category) {
    if (!m.has(k)) continue;
    const v = oneLine(m.get(k));
    if (!v || /^\d+$/.test(v) || /^(simple|variable|variation|grouped|external)(,\s*\w+)*$/i.test(v)) continue;
    category = v; break;
  }
  const w = pick('weight');
  const weightKey = FIELDS.weight.find((k) => m.has(k));
  const rowType = String(pick('rowtype') ?? '').toLowerCase().trim();
  const item = {
    id: oneLine(pick('id') ?? '').slice(0, 120),
    title: oneLine(pick('title') ?? '').slice(0, 140),
    description: htmlToText(pick('description') ?? '').slice(0, 20000),
    short_description: htmlToText(pick('short') ?? '').slice(0, 1000),
    price, old_price: oldPrice,
    cost_price: parsePrice(pick('cost')),
    images: cleanImages([...pickAll('image'), ...pickAll('extra')].flatMap(urlsIn), link || base),
    brand: oneLine(pick('brand') ?? '').slice(0, 60),
    category: oneLine(category ?? '').slice(0, 200),
    stock: parseIntSafe(pick('stock')),
    in_stock: availability(pick('avail')),
    link,
    youtube: urlsIn(pick('youtube'))[0] || '',
    weight_g: parseWeight(w, weightKey === 'weightkg' ? 'kg' : 'g'),
    group: oneLine(pick('group') ?? '').slice(0, 120),
    variation: rowType === 'variation',
  };
  if (item.stock === null && item.in_stock === false) item.stock = 0;
  return item;
}

// Rows → products. Merges Shopify-style extra picture rows and keeps one product per variant group.
function fromRows(rows, base, notes) {
  const out = [];
  const byGroup = new Map();
  let variants = 0;
  let merged = 0;
  for (const row of rows) {
    const it = fromRow(row, base);
    const prev = out[out.length - 1];
    if (!it.title) {
      // a picture-only row belonging to the product above (Shopify export)
      if (prev && it.images.length && (!it.id || it.id === prev.id)) {
        prev.images = cleanImages([...prev.images, ...it.images]);
        merged++;
      }
      continue;
    }
    if (it.variation) { variants++; continue; }
    if (it.group) {
      const g = byGroup.get(it.group);
      if (g) { // another colour / size of the same product: keep the first, add its pictures
        g.images = cleanImages([...g.images, ...it.images]);
        if (g.stock !== null && it.stock !== null) g.stock += it.stock;
        variants++;
        continue;
      }
      byGroup.set(it.group, it);
    }
    out.push(it);
    if (out.length >= MAX_ITEMS) { notes.push(`একবারে সর্বোচ্চ ${MAX_ITEMS}টি পণ্য আনা যায় — বাকিগুলো পরের বার আনুন।`); break; }
  }
  if (variants) notes.push(`${variants}টি ভ্যারিয়েন্ট (রং/মাপ) সারি আলাদা পণ্য হিসেবে নেওয়া হয়নি — মূল পণ্যের সাথে রাখা হয়েছে।`);
  void merged;
  return out;
}

// ---------------------------------------------------------------- CSV / TSV
function detectDelimiter(text) {
  const head = text.split(/\r?\n/).slice(0, 5).join('\n');
  const count = (ch) => { let n = 0; let q = false; for (const c of head) { if (c === '"') q = !q; else if (!q && c === ch) n++; } return n; };
  const cands = [['\t', count('\t')], [',', count(',')], [';', count(';')], ['|', count('|')]];
  cands.sort((a, b) => b[1] - a[1]);
  return cands[0][1] > 0 ? cands[0][0] : ',';
}
function parseCsv(text, delim) {
  const rows = [];
  let row = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c;
    } else if (c === '"' && cell === '') q = true;
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((x) => x.trim() !== '')) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim() !== '')) rows.push(row);
  return rows;
}
// Table (first row = column names, possibly after a few title rows) → objects
function tableToObjects(table) {
  if (!table.length) return { header: [], rows: [] };
  // find the header row: the first row (of the first 10) with the most known column names
  let hi = 0;
  let best = -1;
  for (let i = 0; i < Math.min(10, table.length); i++) {
    const score = table[i].filter((h) => KNOWN.has(normKey(h))).length;
    if (score > best) { best = score; hi = i; }
  }
  const header = table[hi].map((h) => String(h ?? '').trim());
  const rows = table.slice(hi + 1).map((r) => {
    const o = {};
    header.forEach((h, j) => {
      if (!h) return;
      const v = r[j] === undefined || r[j] === null ? '' : r[j];
      if (o[h] !== undefined && o[h] !== '') o[h] = [].concat(o[h], v); // repeated column (e.g. several image columns)
      else o[h] = v;
    });
    return o;
  });
  return { header, rows, known: best };
}

// ---------------------------------------------------------------- XLSX (zip of XML)
function unzip(buf) {
  // central directory
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('zip');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = new Map();
  let total = 0;
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('zip');
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28);
    const xlen = buf.readUInt16LE(p + 30);
    const clen = buf.readUInt16LE(p + 32);
    const off = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nlen).toString('utf8');
    p += 46 + nlen + xlen + clen;
    if (!/^(xl\/(sharedStrings|workbook)\.xml|xl\/_rels\/workbook\.xml\.rels|xl\/worksheets\/[^/]+\.xml)$/.test(name)) continue;
    total += usize;
    if (usize > 60 * 1024 * 1024 || total > 120 * 1024 * 1024) throw new Error('big'); // zip bomb guard
    const lnlen = buf.readUInt16LE(off + 26);
    const lxlen = buf.readUInt16LE(off + 28);
    const data = buf.subarray(off + 30 + lnlen + lxlen, off + 30 + lnlen + lxlen + csize);
    const out = method === 0 ? data : method === 8 ? zlib.inflateRawSync(data, { maxOutputLength: 64 * 1024 * 1024 }) : null;
    if (out) files.set(name, out.toString('utf8'));
  }
  return files;
}
function xmlText(s) { return decodeEntities(unCdata(String(s).replace(/<rPh\b[\s\S]*?<\/rPh>/g, '')).replace(/<[^>]+>/g, '')); }
function colIndex(ref) {
  const m = String(ref).match(/^([A-Z]+)/);
  if (!m) return -1;
  let n = 0;
  for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}
function parseXlsx(buf) {
  const files = unzip(buf);
  const shared = [];
  const ss = files.get('xl/sharedStrings.xml');
  if (ss) for (const m of ss.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) shared.push(xmlText(m[1]));
  // first sheet in workbook order
  let sheetPath = null;
  const wb = files.get('xl/workbook.xml');
  const rels = files.get('xl/_rels/workbook.xml.rels');
  if (wb && rels) {
    const first = wb.match(/<sheet\b[^>]*\br:id="([^"]+)"/) || wb.match(/<sheet\b[^>]*\bid="([^"]+)"/);
    if (first) {
      const rel = [...rels.matchAll(/<Relationship\b([^>]*)\/?>/g)].map((m) => m[1]).find((a) => a.includes(`Id="${first[1]}"`));
      const t = rel && rel.match(/Target="([^"]+)"/);
      if (t) sheetPath = 'xl/' + t[1].replace(/^\/?xl\//, '').replace(/^\//, '');
    }
  }
  if (!sheetPath || !files.has(sheetPath)) sheetPath = [...files.keys()].filter((k) => k.startsWith('xl/worksheets/')).sort()[0];
  const sheet = sheetPath && files.get(sheetPath);
  if (!sheet) throw new Error('sheet');
  const table = [];
  for (const rm of sheet.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row = [];
    let auto = 0;
    for (const cm of rm[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1];
      const inner = cm[2] || '';
      const r = attrs.match(/\br="([A-Z]+\d+)"/);
      const idx = r ? colIndex(r[1]) : auto;
      auto = idx + 1;
      const t = (attrs.match(/\bt="([^"]+)"/) || [])[1] || 'n';
      let v = '';
      if (t === 'inlineStr') v = xmlText((inner.match(/<is>([\s\S]*?)<\/is>/) || [])[1] || '');
      else {
        const raw = (inner.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
        if (raw !== undefined) v = t === 's' ? (shared[Number(raw)] ?? '') : t === 'b' ? (raw === '1' ? 'TRUE' : 'FALSE') : decodeEntities(raw);
      }
      if (idx >= 0 && idx < 400) row[idx] = v;
    }
    for (let i = 0; i < row.length; i++) if (row[i] === undefined) row[i] = '';
    table.push(row);
    if (table.length > MAX_ITEMS * 4) break;
  }
  return table;
}

// ---------------------------------------------------------------- XML feeds and sitemaps
function xmlItems(xml) {
  const blocks = [];
  for (const tag of ['item', 'entry', 'product', 'listing', 'offer']) {
    const re = new RegExp(`<(?:[\\w-]+:)?${tag}\\b[^>]*>([\\s\\S]*?)</(?:[\\w-]+:)?${tag}>`, 'gi');
    for (const m of xml.matchAll(re)) { blocks.push(m[1]); if (blocks.length > MAX_ITEMS * 2) break; }
    if (blocks.length) break;
  }
  return blocks.map((b) => {
    const o = {};
    const add = (k, v) => { if (o[k] === undefined) o[k] = v; else o[k] = [].concat(o[k], v); };
    for (const m of b.matchAll(/<([A-Za-z_][\w:.-]*)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/\1>)/g)) {
      const name = m[1];
      let val = m[3] !== undefined ? m[3] : '';
      if (!val && /^(?:[\w-]+:)?link$/i.test(name)) { const h = m[2].match(/\bhref="([^"]+)"/); if (h) val = h[1]; }
      if (!val) { const s = m[2].match(/\b(?:url|src)="([^"]+)"/); if (s) val = s[1]; }
      // a block with child tags (e.g. <g:price><value>) → its text
      add(name, /^\s*</.test(unCdata(val)) && !/<!\[CDATA\[/.test(val) ? xmlText(val) : decodeEntities(unCdata(val)).trim());
    }
    return o;
  });
}
function sitemapLinks(xml, base) {
  const locs = [...xml.matchAll(/<loc>\s*(?:<!\[CDATA\[)?\s*([^<\]]+?)\s*(?:\]\]>)?\s*<\/loc>/gi)].map((m) => absUrl(decodeEntities(m[1]), base)).filter(Boolean);
  const isIndex = /<sitemapindex\b/i.test(xml);
  if (isIndex) {
    const prod = locs.filter((u) => /product|item|shop|catalog/i.test(u));
    return { links: (prod.length ? prod : locs).slice(0, 50).map((url) => ({ url, kind: 'sitemap' })) };
  }
  const prod = locs.filter((u) => PRODUCT_PATH.test(new URL(u).pathname));
  const pick = prod.length ? prod : locs;
  return { links: [...new Set(pick)].slice(0, MAX_ITEMS).map((url) => ({ url, kind: 'page' })), filtered: prod.length > 0 };
}

// ---------------------------------------------------------------- JSON
function shopifyItems(products, base) {
  return products.map((p) => {
    const v = (p.variants || [])[0] || {};
    const stock = (p.variants || []).reduce((s, x) => (typeof x.inventory_quantity === 'number' ? s + Math.max(0, x.inventory_quantity) : s), 0);
    const anyStock = (p.variants || []).some((x) => typeof x.inventory_quantity === 'number');
    return fromRow({
      id: p.id, title: p.title, body_html: p.body_html, vendor: p.vendor, product_type: p.product_type,
      price: v.price, compare_at_price: v.compare_at_price, grams: v.grams,
      image: (p.images || []).map((i) => i.src), link: p.handle && base ? absUrl('/products/' + p.handle, base) : '',
      quantity: anyStock ? stock : '', availability: (p.variants || []).length ? ((p.variants || []).some((x) => x.available !== false) ? 'in stock' : 'out of stock') : '',
    }, base);
  });
}
function wooItems(products, base) {
  return products.map((p) => {
    const pr = p.prices || {};
    const unit = Math.pow(10, Number(pr.currency_minor_unit ?? 0));
    const val = (x) => (x === undefined || x === null || x === '' ? '' : Number(x) / unit);
    return fromRow({
      id: p.id, name: p.name, description: p.description, short_description: p.short_description,
      regular_price: val(pr.regular_price || pr.price), sale_price: pr.sale_price && pr.sale_price !== pr.regular_price ? val(pr.sale_price) : '',
      images: (p.images || []).map((i) => i.src), category: (p.categories || []).map((c) => c.name)[0] || '',
      brand: (p.brands || []).map((b) => b.name)[0] || '', link: p.permalink, availability: p.is_in_stock === false ? 'out of stock' : p.is_in_stock ? 'in stock' : '',
    }, base);
  });
}
function flatObj(o, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(o || {})) {
    if (v === null || v === undefined) continue;
    if (Array.isArray(v)) {
      if (v.every((x) => typeof x !== 'object')) out[prefix + k] = v.join(', ');
      else if (/image|photo|picture|gallery/i.test(k)) out[prefix + k] = urlsIn(v).join(', ');
      else if (/categor/i.test(k)) out[prefix + k] = v.map((x) => (x && (x.name || x.title)) || '').filter(Boolean)[0] || '';
    } else if (typeof v === 'object') {
      if (/brand|categor/i.test(k) && (v.name || v.title)) out[prefix + k] = v.name || v.title;
      else if (/image|photo|picture/i.test(k)) out[prefix + k] = urlsIn(v).join(', ');
      else if (!prefix) flatObj(v, '', out); // one level down (e.g. { price: …, details: { brand } })
    } else out[prefix + k] = v;
  }
  return out;
}
function jsonItems(data, base, notes) {
  if (data && Array.isArray(data.products) && data.products.some((p) => p && p.variants)) return { items: shopifyItems(data.products, base), shopify: true };
  const arr = Array.isArray(data) ? data : data && (data.products || data.items || data.data || data.results || data.records || data.rows);
  if (!Array.isArray(arr)) return { items: [] };
  if (arr.some((p) => p && p.prices && p.permalink)) return { items: wooItems(arr, base), woo: true };
  if (arr.some((p) => p && p.variants && p.handle)) return { items: shopifyItems(arr, base), shopify: true };
  const rows = arr.filter((x) => x && typeof x === 'object').map((x) => flatObj(x));
  return { items: fromRows(rows, base, notes) };
}

// ---------------------------------------------------------------- HTML product page
const PRODUCT_PATH = /\/(products?|p|item|items|shop|details?|pd|dp|buy|goods)\/[^/?#]+/i;
function ldNodes(html) {
  const out = [];
  for (const m of html.matchAll(/<script\b[^>]*type=["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi)) {
    let data;
    try { data = JSON.parse(unCdata(m[1]).trim().replace(/[\u0000-\u001f]+/g, ' ')); } catch (_) { continue; }
    const walk = (n, depth) => {
      if (!n || depth > 6) return;
      if (Array.isArray(n)) { n.forEach((x) => walk(x, depth + 1)); return; }
      if (typeof n !== 'object') return;
      out.push(n);
      if (n['@graph']) walk(n['@graph'], depth + 1);
      if (n.itemListElement) walk(n.itemListElement, depth + 1);
      if (n.item) walk(n.item, depth + 1);
      if (n.mainEntity) walk(n.mainEntity, depth + 1);
    };
    walk(data, 0);
  }
  return out;
}
const isType = (n, t) => [].concat(n['@type'] || []).some((x) => String(x).toLowerCase() === t);
function metaTags(html) {
  const m = new Map();
  for (const tag of html.matchAll(/<meta\b[^>]+>/gi)) {
    const t = tag[0];
    const key = (t.match(/\b(?:property|name|itemprop)\s*=\s*["']([^"']+)["']/i) || [])[1];
    const val = (t.match(/\bcontent\s*=\s*"([^"]*)"/i) || t.match(/\bcontent\s*=\s*'([^']*)'/i) || [])[1];
    if (!key || val === undefined) continue;
    const k = key.toLowerCase();
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(decodeEntities(val));
  }
  return m;
}
function ldProduct(n, base, meta) {
  const offers = [].concat(n.offers || []).flatMap((o) => (o && o.offers ? [].concat(o.offers) : [o])).filter(Boolean);
  const o = offers[0] || {};
  const spec = [].concat(o.priceSpecification || [])[0] || {};
  const price = o.price ?? o.lowPrice ?? spec.price;
  const brand = n.brand ? (typeof n.brand === 'string' ? n.brand : n.brand.name) : '';
  const imgs = urlsIn(n.image);
  const metaImgs = meta ? [...(meta.get('og:image') || []), ...(meta.get('og:image:secure_url') || [])] : [];
  return fromRow({
    id: n.sku || n.productID || n.mpn || '', title: n.name, description: n.description,
    price, image: (imgs.length ? imgs : metaImgs).join(', '), brand, category: typeof n.category === 'string' ? n.category : '',
    availability: o.availability || '', link: n.url || n['@id'] || '',
    old_price: meta ? (meta.get('product:original_price:amount') || [])[0] : '',
  }, base);
}
function htmlProducts(html, base) {
  const meta = metaTags(html);
  const nodes = ldNodes(html).filter((n) => isType(n, 'product') || isType(n, 'individualproduct') || isType(n, 'productgroup'));
  const items = [];
  const seen = new Set();
  for (const n of nodes) {
    const it = ldProduct(n, base, nodes.length === 1 ? meta : null);
    if (!it.title || seen.has(it.title + '|' + it.price)) continue;
    seen.add(it.title + '|' + it.price);
    if (!it.link) it.link = base;
    items.push(it);
  }
  if (items.length === 1) {
    const it = items[0];
    if (!it.description) it.description = htmlToText((meta.get('og:description') || meta.get('description') || [''])[0]);
    if (it.price === null) it.price = parsePrice((meta.get('product:price:amount') || meta.get('og:price:amount') || [])[0]);
    if (!it.brand) it.brand = oneLine((meta.get('product:brand') || [''])[0]).slice(0, 60);
  }
  if (items.length) return items;
  // Open Graph only
  const title = (meta.get('og:title') || [])[0];
  const price = parsePrice((meta.get('product:price:amount') || meta.get('og:price:amount') || meta.get('price') || [])[0]);
  if (title && price !== null) {
    return [fromRow({
      title, price, description: (meta.get('og:description') || meta.get('description') || [''])[0],
      image: (meta.get('og:image') || []).join(', '), brand: (meta.get('product:brand') || [''])[0],
      availability: (meta.get('product:availability') || meta.get('og:availability') || [''])[0], link: (meta.get('og:url') || [base])[0],
    }, base)];
  }
  return [];
}
function productLinks(html, base) {
  const host = hostOf(base);
  const out = new Set();
  for (const m of html.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"'#]+)["']/gi)) {
    const u = absUrl(decodeEntities(m[1]), base);
    if (!u || hostOf(u) !== host) continue;
    let path;
    try { path = new URL(u).pathname; } catch (_) { continue; }
    if (!PRODUCT_PATH.test(path) || /\/(cart|checkout|account|login|wishlist|compare|tag|category|categories|collections?)\b/i.test(path)) continue;
    out.add(u.split('#')[0]);
    if (out.size >= 1000) break;
  }
  return [...out];
}

// ---------------------------------------------------------------- entry points
function decodeText(buf, contentType = '') {
  if (typeof buf === 'string') return buf.replace(/^\uFEFF/, '');
  if (buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder('utf-16le').decode(buf.subarray(2));
  if (buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder('utf-16be').decode(buf.subarray(2));
  let cs = (String(contentType).match(/charset=["']?([\w-]+)/i) || [])[1];
  if (!cs) {
    const head = buf.subarray(0, 2048).toString('latin1');
    cs = (head.match(/<\?xml[^>]*encoding=["']([\w-]+)/i) || head.match(/<meta[^>]+charset=["']?([\w-]+)/i) || [])[1];
  }
  let dec;
  try { dec = new TextDecoder((cs || 'utf-8').toLowerCase()); } catch (_) { dec = new TextDecoder('utf-8'); }
  return dec.decode(buf).replace(/^\uFEFF/, '');
}

// What kind of content is this? (by the first bytes, not the file name)
function sniff(buf, name = '', contentType = '') {
  if (Buffer.isBuffer(buf) && buf.length > 4 && buf.readUInt32LE(0) === 0x04034b50) return 'xlsx';
  if (Buffer.isBuffer(buf) && buf.length > 8 && buf.readUInt32LE(0) === 0xe011cfd0) return 'xls';
  const head = decodeText(Buffer.isBuffer(buf) ? buf.subarray(0, 4096) : String(buf).slice(0, 4096), contentType).trimStart();
  if (/^</.test(head)) {
    if (/^<!doctype html|^<html|<head[\s>]|<body[\s>]/i.test(head)) return 'html';
    return 'xml';
  }
  if (/^[[{]/.test(head)) return 'json';
  if (/\.(xml|rss|atom)$/i.test(name) || /xml|rss|atom/.test(contentType)) return 'xml';
  if (/html/.test(contentType)) return 'html';
  return 'table';
}

// Parse already-downloaded content. Returns { items, links, next, format, notes }
function parseContent(buf, { name = '', contentType = '', baseUrl = '' } = {}) {
  const notes = [];
  const kind = sniff(buf, name, contentType);
  if (kind === 'xls') return { items: [], format: 'xls', notes, error: 'পুরোনো .xls ফাইল পড়া যায় না। Excel-এ খুলে "Save As" → "Excel Workbook (.xlsx)" বা "CSV UTF-8" হিসেবে সেভ করে আবার দিন।' };
  if (kind === 'xlsx') {
    let table;
    try { table = parseXlsx(buf); } catch (_) { return { items: [], format: 'xlsx', notes, error: 'Excel ফাইলটি পড়া যায়নি। ফাইলটি ঠিক আছে কি না দেখুন, অথবা CSV হিসেবে সেভ করে দিন।' }; }
    const t = tableToObjects(table);
    return { items: fromRows(t.rows, baseUrl, notes), format: 'xlsx', columns: t.header.filter(Boolean), unknownColumns: t.known === 0, notes };
  }
  const text = decodeText(buf, contentType);
  if (kind === 'json') {
    let data;
    try { data = JSON.parse(text); } catch (_) { return { items: [], format: 'json', notes, error: 'JSON ফাইলটি ঠিক নেই।' }; }
    const r = jsonItems(data, baseUrl, notes);
    return { items: r.items, format: r.shopify ? 'shopify' : r.woo ? 'woocommerce' : 'json', notes };
  }
  if (kind === 'xml') {
    if (/<(urlset|sitemapindex)\b/i.test(text.slice(0, 3000))) {
      const s = sitemapLinks(text, baseUrl);
      if (!s.filtered && s.links.length && s.links[0].kind === 'page') notes.push('সাইটম্যাপে পণ্যের পেজ আলাদা করে চেনা যায়নি — সব পেজ একে একে দেখা হবে, যেগুলোতে পণ্য আছে শুধু সেগুলো নেওয়া হবে।');
      return { items: [], links: s.links, format: 'sitemap', notes };
    }
    const rows = xmlItems(text);
    return { items: fromRows(rows, baseUrl, notes), format: /xmlns:g=|<g:/i.test(text.slice(0, 5000)) ? 'feed' : 'xml', notes };
  }
  if (kind === 'html') {
    const items = htmlProducts(text, baseUrl);
    if (items.length) return { items, format: 'page', notes };
    const links = productLinks(text, baseUrl);
    const shop = /cdn\.shopify\.com|Shopify\.theme/i.test(text) ? 'shopify' : /wp-content\/plugins\/woocommerce|woocommerce/i.test(text) ? 'woocommerce' : '';
    return { items: [], links: links.map((url) => ({ url, kind: 'page' })), format: 'html', shop, notes };
  }
  // CSV / TSV
  const table = parseCsv(text, detectDelimiter(text));
  const t = tableToObjects(table);
  return { items: fromRows(t.rows, baseUrl, notes), format: 'csv', columns: t.header.filter(Boolean), unknownColumns: t.known === 0, notes };
}

// A product's lasting identity from the old site: "oldsite.com#123"
function refFor(it, sourceUrl) {
  const host = hostOf(it.link) || hostOf(sourceUrl) || 'file';
  let key = it.id;
  if (!key && it.link) { try { const u = new URL(it.link); key = u.pathname.replace(/\/+$/, '') + u.search; } catch (_) { /* ignore */ } }
  if (!key) key = it.title.toLowerCase();
  return `${host}#${key}`.toLowerCase().slice(0, 300);
}
function finish(items, sourceUrl) {
  return items.map((it) => {
    const o = { ...it, ref: refFor(it, sourceUrl) };
    delete o.variation; delete o.group;
    return o;
  });
}

const TEMPLATE_HEADER = ['id', 'title', 'brand', 'price', 'sale_price', 'cost_price', 'quantity', 'category', 'image_link', 'additional_image_link', 'short_description', 'description', 'youtube', 'weight'];

module.exports = { parseContent, finish, refFor, htmlToText, parsePrice, parseCsv, parseXlsx, xmlItems, fromRow, normKey, sniff, TEMPLATE_HEADER, MAX_ITEMS, PRODUCT_PATH };
