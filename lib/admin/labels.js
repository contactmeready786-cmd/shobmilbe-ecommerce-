'use strict';
// Admin → পণ্য → 🏷️ বারকোড লেবেল: print stickers with each product's own barcode (name, price, barcode).
// Opened from a product's page or from the product list ("বাছাই করা পণ্য → বারকোড লেবেল প্রিন্ট").
const { html, raw, money, int, str, bn } = require('../util');
const db = require('../db');
const BC = require('../services/barcode');

// sticker sizes (mm). sheet = how many fit on one A4 page, or a roll printer (one per label)
const SIZES = {
  '38x25': { w: 38, h: 25, label: '৩৮×২৫ মিমি (ছোট রোল স্টিকার)' },
  '50x30': { w: 50, h: 30, label: '৫০×৩০ মিমি (রোল স্টিকার, প্রস্তাবিত)' },
  '60x40': { w: 60, h: 40, label: '৬০×৪০ মিমি (বড় রোল স্টিকার)' },
  a4: { w: 63.5, h: 38.1, label: 'A4 কাগজে ২১টা (৩×৭)', sheet: true },
};

async function labels(ctx) {
  const ids = String(ctx.query.get('ids') || '').split(',').map((x) => int(x)).filter(Boolean).slice(0, 300);
  if (!ids.length) return ctx.redirect(ctx.res, '/admin/products');
  const size = SIZES[ctx.query.get('size')] ? ctx.query.get('size') : (SIZES[ctx.settings.label_size] ? ctx.settings.label_size : '50x30');
  const copies = Math.min(100, Math.max(1, int(ctx.query.get('copies'), 1)));
  const byStock = ctx.query.get('stock') === '1';
  const showPrice = ctx.query.get('price') !== '0';
  const showName = ctx.query.get('name') !== '0';
  if (ctx.query.get('size') && ctx.query.get('size') !== ctx.settings.label_size) await db.setSetting('label_size', size).catch(() => {});
  const rows = await db.q(`SELECT id, name, sku, barcode, price, stock, unit FROM products WHERE id = ANY($1::int[]) ORDER BY array_position($1::int[], id)`, [ids]);
  const z = SIZES[size];
  const stickers = [];
  for (const p of rows) {
    const n = byStock ? Math.min(200, Math.max(1, p.stock)) : copies;
    for (let i = 0; i < n; i++) stickers.push(p);
  }
  const qs = (k, v) => { const q = new URLSearchParams(ctx.query); q.set(k, v); return '?' + q.toString(); };
  const page = '<!doctype html>' + html`<html lang="bn"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>বারকোড লেবেল (${bn(stickers.length)}টি)</title>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+Bengali:wght@500;700&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box}body{font-family:'Noto Sans Bengali',sans-serif;margin:0;background:#E9EEF5;color:#111}
.bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:center;padding:10px;background:#14213D;color:#fff;font-size:14px}
.bar a,.bar button{font:600 13.5px 'Noto Sans Bengali';padding:6px 12px;border-radius:8px;border:0;background:#334155;color:#fff;text-decoration:none;cursor:pointer}
.bar a.on{background:#F5A524;color:#111}.bar .go{background:#F5A524;color:#111;font-size:15px}
.bar form{display:inline-flex;gap:6px;align-items:center}.bar input{width:60px;padding:5px;border-radius:6px;border:0}
.sheet{display:flex;flex-wrap:wrap;gap:3mm;padding:6mm;justify-content:center}
.lab{width:${z.w}mm;height:${z.h}mm;background:#fff;border:1px dashed #cbd5e1;padding:1.2mm 1.6mm;display:flex;flex-direction:column;justify-content:space-between;overflow:hidden;page-break-inside:avoid}
.nm{font-size:${z.h < 30 ? 7 : 8.5}pt;font-weight:700;line-height:1.15;max-height:2.3em;overflow:hidden}
.row{display:flex;justify-content:space-between;align-items:baseline;font-size:${z.h < 30 ? 7 : 8}pt}.pr{font-weight:700}
.lab svg{width:100%;height:auto;max-height:${z.h * 0.58}mm;display:block}
@media print{@page{size:${z.sheet ? 'A4' : `${z.w}mm ${z.h}mm`};margin:${z.sheet ? '10mm 6mm' : '0'}}body{background:#fff}.bar{display:none}
  .sheet{padding:0;gap:${z.sheet ? '0' : '0'};justify-content:flex-start}.lab{border:${z.sheet ? '1px dashed #e5e7eb' : '0'};${z.sheet ? '' : 'page-break-after:always;'}}}
</style></head><body>
<div class="bar">
  <button class="go" onclick="window.print()">🖨️ প্রিন্ট (${bn(stickers.length)}টি লেবেল)</button>
  ${Object.entries(SIZES).map(([k, v]) => html`<a class="${k === size ? 'on' : ''}" href="${qs('size', k)}">${v.label}</a>`)}
  <form method="get">${['ids', 'size'].map((k) => html`<input type="hidden" name="${k}" value="${k === 'size' ? size : ctx.query.get(k)}">`)}
    প্রতিটা <input type="number" name="copies" min="1" max="100" value="${copies}"> কপি <button>✓</button></form>
  <a class="${byStock ? 'on' : ''}" href="${qs('stock', byStock ? '0' : '1')}">${byStock ? '✓ ' : ''}স্টক যতটা, ততটা লেবেল</a>
  <a class="${showPrice ? 'on' : ''}" href="${qs('price', showPrice ? '0' : '1')}">দাম ${showPrice ? 'দেখাচ্ছে' : 'লুকানো'}</a>
  <a class="${showName ? 'on' : ''}" href="${qs('name', showName ? '0' : '1')}">নাম ${showName ? 'দেখাচ্ছে' : 'লুকানো'}</a>
  <a href="javascript:history.back()">← ফিরে যান</a>
</div>
<div class="sheet">${stickers.map((p) => html`<div class="lab">
  ${showName ? html`<div class="nm">${str(p.name, 70)}</div>` : ''}
  ${raw(BC.svg(p.barcode || BC.productCode(p.id), { height: 40, module: 2, fontSize: 12, quiet: 6 }))}
  <div class="row"><span>${p.sku ? `SKU ${p.sku}` : ''}</span>${showPrice ? html`<span class="pr">${money(p.price)}${p.unit && p.unit !== 'পিস' ? `/${p.unit}` : ''}</span>` : ''}</div>
</div>`)}</div>
</body></html>`.s;
  return ctx.send(ctx.res, 200, page);
}

module.exports = { routes: [{ method: 'GET', path: '/admin/products/labels', perm: 'products', handler: labels }], SIZES };
