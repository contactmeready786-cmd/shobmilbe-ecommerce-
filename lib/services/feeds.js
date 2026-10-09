'use strict';
// Product feeds for Google Merchant Center and Facebook (Meta) Commerce Manager.
// Google spec: https://support.google.com/merchants/answer/7052112
// Meta spec:   https://www.facebook.com/business/help/120325381656392
// The product id in the feeds is the same id the Pixel / GA4 events send, so dynamic ads match correctly.
const db = require('../db');

const CHANNELS = {
  google: { title: 150, desc: 5000, extraImages: 10, label: 'Google Merchant Center' },
  facebook: { title: 200, desc: 9999, extraImages: 20, label: 'Facebook / Instagram ক্যাটালগ' },
};
const MIN_IMAGE = { google: 100, facebook: 500 };

// XML 1.0 can't carry control characters; strip them so the feed never breaks.
function cleanText(v) {
  return String(v ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '');
}
function xml(v) {
  return cleanText(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}
function csvCell(v) {
  const s = cleanText(v).replace(/\r?\n/g, ' ');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function tsvCell(v) { return cleanText(v).replace(/[\t\r\n]+/g, ' '); }
function cut(s, max) {
  const t = String(s || '').trim();
  if (t.length <= max) return t;
  return t.slice(0, max - 1).replace(/\s+\S*$/, '').trim() + '…';
}
// Product descriptions are written in simple markdown; feeds need plain text.
function plainText(md) {
  return String(md || '')
    .replace(/^\s*\/p\/\S+\s*$/gm, ' ')               // embedded product cards
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')            // images
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')          // links -> their text
    .replace(/<[^>]+>/g, ' ')                          // stray html
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')                // headings
    .replace(/^\s*[-*+]\s+/gm, '• ')                   // bullets
    .replace(/(\*\*|__|`|~~)/g, '')                    // bold/code/strike
    .replace(/(^|\s)[*_]([^*_\n]+)[*_](?=\s|$|[.,!?।])/g, '$1$2') // *italic* / _italic_
    .replace(/^\s*>\s?/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}
function priceStr(n) { return `${(Math.max(0, Number(n) || 0)).toFixed(2)} BDT`; }

async function loadProducts(settings) {
  const includeOut = settings.feed_include_out !== '0';
  const rows = await db.q(`
    SELECT p.id, p.name, p.slug, p.price, p.old_price, p.description, p.short_description, p.image_id, p.brand, p.model, p.weight_g,
      p.product_type, p.sku, p.updated_at, c.name AS category_name,
      CASE WHEN p.product_type='bundle' THEN
        coalesce((SELECT min(c2.stock / greatest(bi.qty,1)) FROM bundle_items bi JOIN products c2 ON c2.id=bi.product_id WHERE bi.bundle_id=p.id), 0)
      ELSE p.stock END AS stock,
      mi.width AS img_w, mi.height AS img_h
    FROM products p LEFT JOIN categories c ON c.id=p.category_id LEFT JOIN media mi ON mi.id=p.image_id
    WHERE p.active ORDER BY p.id`);
  const ids = rows.map((r) => r.id);
  const media = ids.length ? await db.q(`SELECT id, owner_id FROM media WHERE owner_type='product' AND owner_id = ANY($1::int[]) ORDER BY owner_id, sort, id`, [ids]) : [];
  const imgs = new Map();
  for (const m of media) { if (!imgs.has(m.owner_id)) imgs.set(m.owner_id, []); imgs.get(m.owner_id).push(m.id); }
  return rows.map((p) => {
    const all = imgs.get(p.id) || [];
    const main = p.image_id || all[0] || null;
    return { ...p, main_image: main, extra_images: all.filter((x) => x !== main), in_stock: Number(p.stock) > 0, includeOut };
  });
}

// Which products go in the feed, and why the others are left out (shown in the admin).
function check(p, channel) {
  const problems = [];
  if (!p.main_image) problems.push('ছবি নেই');
  if (!(Number(p.price) > 0)) problems.push('দাম ০');
  if (!p.includeOut && !p.in_stock) problems.push('স্টকে নেই');
  const warnings = [];
  const min = MIN_IMAGE[channel];
  if (p.main_image && p.img_w && p.img_h && (p.img_w < min || p.img_h < min)) warnings.push(`ছবি ছোট (${p.img_w}×${p.img_h}, কমপক্ষে ${min}×${min} দরকার)`);
  if (!plainText(p.description || p.short_description)) warnings.push('বিবরণ নেই (নাম দিয়ে চালানো হচ্ছে)');
  return { ok: !problems.length, problems, warnings };
}

function item(p, channel, settings, base) {
  const lim = CHANNELS[channel];
  const sale = p.old_price && Number(p.old_price) > Number(p.price);
  const brand = cut(p.brand || settings.feed_brand || settings.store_name || 'Generic', channel === 'google' ? 70 : 100);
  const desc = cut(plainText(p.description) || plainText(p.short_description) || p.name, lim.desc);
  const shipping = Number(settings.feed_shipping || settings.delivery_outside || 0);
  return {
    id: String(p.id),
    title: cut(p.name, lim.title),
    description: desc,
    link: `${base}/p/${encodeURIComponent(p.slug)}`,
    image_link: `${base}/media/${p.main_image}`,
    additional_image_link: p.extra_images.slice(0, lim.extraImages).map((id) => `${base}/media/${id}`),
    availability: channel === 'google' ? (p.in_stock ? 'in_stock' : 'out_of_stock') : (p.in_stock ? 'in stock' : 'out of stock'),
    condition: ['new', 'refurbished', 'used'].includes(settings.feed_condition) ? settings.feed_condition : 'new',
    price: priceStr(sale ? p.old_price : p.price),
    sale_price: sale ? priceStr(p.price) : '',
    brand,
    // a real brand + the maker's model/part number is a valid product identifier for Google; otherwise say there is none
    mpn: p.model && p.brand ? cut(p.model, 70) : '',
    identifier_exists: channel === 'google' && !(p.model && p.brand) ? 'no' : '',
    product_type: cut(p.category_name || '', 750),
    google_product_category: String(settings.feed_google_category || '').trim(),
    inventory: channel === 'facebook' ? String(Math.max(0, Number(p.stock) || 0)) : '',
    shipping: channel === 'google' && shipping >= 0 && settings.feed_shipping !== 'none' ? { country: 'BD', service: 'Standard', price: priceStr(shipping) } : null,
    shipping_weight: channel === 'google' && Number(p.weight_g) > 0 ? `${Number(p.weight_g)} g` : '',
    custom_label_0: cut(p.category_name || '', 100),
    custom_label_1: p.product_type === 'bundle' ? 'bundle' : 'single',
  };
}

function toXml(items, channel, settings, base) {
  const tag = (k, v) => (v === '' || v === null || v === undefined ? '' : `<g:${k}>${xml(v)}</g:${k}>`);
  const body = items.map((it) => '<item>' + [
    tag('id', it.id), tag('title', it.title), tag('description', it.description), tag('link', it.link),
    tag('image_link', it.image_link), ...it.additional_image_link.map((u) => tag('additional_image_link', u)),
    tag('availability', it.availability), tag('condition', it.condition), tag('price', it.price), tag('sale_price', it.sale_price),
    tag('brand', it.brand), tag('mpn', it.mpn), tag('identifier_exists', it.identifier_exists), tag('product_type', it.product_type),
    tag('google_product_category', it.google_product_category), tag('inventory', it.inventory),
    it.shipping ? `<g:shipping>${tag('country', it.shipping.country)}${tag('service', it.shipping.service)}${tag('price', it.shipping.price)}</g:shipping>` : '',
    tag('shipping_weight', it.shipping_weight), tag('custom_label_0', it.custom_label_0), tag('custom_label_1', it.custom_label_1),
  ].join('') + '</item>').join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
<channel>
<title>${xml(settings.store_name)} — ${xml(CHANNELS[channel].label)}</title>
<link>${xml(base)}</link>
<description>${xml(settings.seo_description || settings.tagline || settings.store_name)}</description>
${body}
</channel>
</rss>
`;
}

function toTable(items, channel, sep) {
  const cols = ['id', 'title', 'description', 'availability', 'condition', 'price', 'sale_price', 'link', 'image_link', 'additional_image_link', 'brand', 'mpn']
    .concat(channel === 'google' ? ['identifier_exists', 'product_type', 'google_product_category', 'shipping', 'shipping_weight']
      : ['product_type', 'google_product_category', 'inventory'])
    .concat(['custom_label_0', 'custom_label_1']);
  const cell = sep === '\t' ? tsvCell : csvCell;
  const val = (it, c) => {
    if (c === 'additional_image_link') return it.additional_image_link.join(',');
    if (c === 'shipping') return it.shipping ? `${it.shipping.country}::${it.shipping.service}:${it.shipping.price}` : '';
    return it[c] ?? '';
  };
  return [cols.join(sep), ...items.map((it) => cols.map((c) => cell(val(it, c))).join(sep))].join('\n') + '\n';
}

async function build(channel, settings, base) {
  const products = await loadProducts(settings);
  const report = { total: products.length, included: 0, excluded: [], warnings: [] };
  const items = [];
  for (const p of products) {
    const c = check(p, channel);
    if (!c.ok) { report.excluded.push({ id: p.id, name: p.name, why: c.problems }); continue; }
    if (c.warnings.length) report.warnings.push({ id: p.id, name: p.name, why: c.warnings });
    items.push(item(p, channel, settings, base));
  }
  report.included = items.length;
  return { items, report };
}

// GET /feeds/google.xml?key=…  /feeds/facebook.csv?key=…
async function serve({ res, query, settings, send, siteUrl, req }, channel, format) {
  const token = settings[`feed_${channel}_token`];
  if (!token || query.get('key') !== token) return send(res, 404, 'Feed not found. Generate the feed link in Admin → মার্কেটিং → প্রোডাক্ট ফিড.', 'text/plain; charset=utf-8');
  const base = siteUrl.replace(/\/+$/, '');
  const { items } = await build(channel, settings, base);
  // who read the feed, and when (once an hour) — shown on Admin → সংযোগের অবস্থা
  try {
    if (await require('../security').hit(db, 'log:feed:' + channel, 1, 3600)) {
      const ua = String((req && req.headers['user-agent']) || '');
      const who = /Googlebot|Google-|Storebot/i.test(ua) ? 'Google' : /facebook|meta/i.test(ua) ? 'Facebook' : 'কেউ';
      await db.logIntegration(channel + '-feed', 'fetch', true, who, `${items.length}`);
    }
  } catch (_) { /* never block the feed */ }
  const cache = { 'Cache-Control': 'public, max-age=300, s-maxage=900', 'X-Robots-Tag': 'noindex' };
  if (format === 'xml') return send(res, 200, toXml(items, channel, settings, base), 'application/xml; charset=utf-8', cache);
  const sep = format === 'tsv' ? '\t' : ',';
  return send(res, 200, toTable(items, channel, sep), `${format === 'tsv' ? 'text/tab-separated-values' : 'text/csv'}; charset=utf-8`,
    { ...cache, 'Content-Disposition': `inline; filename="${channel}-products.${format}"` });
}

module.exports = { serve, build, CHANNELS, plainText };
