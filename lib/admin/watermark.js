'use strict';
// Watermark (ওয়াটারমার্ক): one mark — the shop's domain, your own text, or a logo — placed softly
// on the product itself in the big picture of every product page. Shop cards, thumbnails and the
// Google/Facebook feeds keep the clean picture.
//
// The marked copies are drawn in the admin's browser (it finds where the product sits on the white
// background and blends the mark into it), then stored next to the original picture. Any admin page
// that is open quietly finishes pictures that are new or were made with older settings.
const crypto = require('crypto');
const { html, raw, bn, int, str } = require('../util');
const db = require('../db');
const catalog = require('../models/catalog');
const security = require('../security');
const ui = require('./ui');

const TYPES = { domain: 'ওয়েবসাইটের ডোমেইন নাম', text: 'নিজের লেখা', logo: 'লোগো (ছবি)' };
const STRENGTH = { soft: 'খুব হালকা (প্রায় চোখে পড়ে না)', normal: 'হালকা (প্রস্তাবিত)', clear: 'একটু স্পষ্ট' };
const SIZES = { s: 'ছোট', m: 'মাঝারি', l: 'বড়' };
const PLACES = { auto: 'স্বয়ংক্রিয় — পণ্যের গায়ে (প্রস্তাবিত)', center: 'ছবির ঠিক মাঝখানে', corner: 'পণ্যের নিচের ডান কোণে' };

function domainOf(ctx) {
  const s = ctx.settings;
  const from = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (_) { return ''; } };
  const host = from(s.site_url || '') || String(ctx.req.headers['x-forwarded-host'] || ctx.req.headers.host || '').split(',')[0].split(':')[0].replace(/^www\./, '');
  return host && !/vercel\.app$|localhost|^\d/.test(host) ? host : 'shobmilbe.com';
}
function config(s) {
  return {
    on: s.wm_on === '1', type: TYPES[s.wm_type] ? s.wm_type : 'domain', text: s.wm_type === 'text' ? (s.wm_text || '') : (s.wm_domain || ''),
    logo: int(s.wm_logo_id) || int(s.logo_id) || null, strength: STRENGTH[s.wm_strength] ? s.wm_strength : 'normal',
    size: SIZES[s.wm_size] ? s.wm_size : 'm', place: PLACES[s.wm_place] ? s.wm_place : 'auto', ver: s.wm_ver || '',
  };
}

async function page(ctx) {
  const s = ctx.settings;
  if (ctx.method === 'POST') {
    const b = await ctx.body();
    const type = TYPES[b.wm_type] ? b.wm_type : 'domain';
    const text = str(b.wm_text, 40);
    if (type === 'text' && !text) return ctx.fail('/admin/products/watermark', 'নিজের লেখা বাছলে লেখাটা দিন।');
    const logoId = int(b.wm_logo_id) || null;
    if (logoId) await db.q(`UPDATE media SET owner_type='setting', owner_id=0 WHERE id=$1 AND owner_type IS NULL`, [logoId]);
    if (type === 'logo' && !logoId && !int(s.logo_id)) return ctx.fail('/admin/products/watermark', 'লোগো বাছলে একটা লোগোর ছবি দিন।');
    const vals = {
      wm_on: b.wm_on ? '1' : '0', wm_type: type, wm_text: text, wm_domain: domainOf(ctx), wm_logo_id: logoId ? String(logoId) : '',
      wm_strength: STRENGTH[b.wm_strength] ? b.wm_strength : 'normal', wm_size: SIZES[b.wm_size] ? b.wm_size : 'm', wm_place: PLACES[b.wm_place] ? b.wm_place : 'auto',
    };
    // same look → same version (nothing redrawn); any change → all pictures are redrawn
    const look = JSON.stringify([vals.wm_type, vals.wm_type === 'text' ? text : vals.wm_type === 'domain' ? vals.wm_domain : (logoId || s.logo_id),
      vals.wm_strength, vals.wm_size, vals.wm_place, 2]);
    vals.wm_ver = crypto.createHash('sha256').update(look).digest('hex').slice(0, 10);
    const old = int(s.wm_logo_id);
    await db.setMany(vals);
    if (old && old !== logoId && old !== int(s.logo_id)) await db.q(`DELETE FROM media WHERE id=$1 AND owner_type='setting'`, [old]);
    await ctx.reloadSettings();
    await ctx.log('settings', 'product', null, `ওয়াটারমার্ক ${vals.wm_on === '1' ? 'চালু' : 'বন্ধ'} (${TYPES[type]})`);
    return ctx.back('/admin/products/watermark', 'saved');
  }
  const c = config(s);
  const domain = domainOf(ctx);
  const prog = await catalog.watermarkProgress(c.ver);
  const sample = await db.one(`SELECT m.id FROM products p JOIN media m ON m.id=p.image_id ORDER BY p.featured DESC, p.id DESC LIMIT 1`);
  const body = html`<p class="crumbs"><a href="/admin/products">← সব পণ্য</a></p>
<h1>💧 ওয়াটারমার্ক</h1>
${ui.flash(ctx.flash)}
<p class="muted">পণ্যের পেজের <b>বড় ছবিতে</b> পণ্যের গায়ে খুব হালকাভাবে আপনার ডোমেইন / লেখা / লোগো বসে যাবে — দেখে মনে হবে পণ্যেরই অংশ, কিন্তু কেউ ছবি কপি করলে আপনার নাম সাথে যাবে।
দোকানের হোমপেজ, পণ্যের কার্ড আর ছোট ছবিতে কিছু বদলাবে না। Google/Facebook ফিডেও আসল ছবি যাবে (ওরা ওয়াটারমার্কওয়ালা ছবি বাতিল করে দেয়)।</p>
<div class="two-col">
  <form method="post" action="/admin/products/watermark" class="form panel" data-wm-form>
    ${ui.switchRow('wm_on', c.on, 'ওয়াটারমার্ক চালু', 'চালু করলে সব পণ্যের বড় ছবিতে বসবে। বন্ধ করলে সাথে সাথে আসল ছবি দেখাবে।')}
    <h2>কী বসবে</h2>
    <div class="wm-types">
      ${Object.entries(TYPES).map(([k, v]) => html`<label class="wm-type"><input type="radio" name="wm_type" value="${k}" ${c.type === k ? raw('checked') : ''} data-wm-in>
        <span><b>${v}</b><small>${k === 'domain' ? domain : k === 'text' ? 'যেমন: সবমিলবে' : 'আপনার দোকানের লোগো বা অন্য ছবি'}</small></span></label>`)}
    </div>
    <div data-wm-show="text" ${c.type === 'text' ? '' : raw('hidden')}>
      ${ui.field('লেখা', ui.input('wm_text', s.wm_text || '', { maxlength: 40, placeholder: 'যেমন: সবমিলবে', 'data-wm-in': true }), 'ছোট লেখা সবচেয়ে সুন্দর দেখায় (১-৩ শব্দ)।')}
    </div>
    <div data-wm-show="logo" ${c.type === 'logo' ? '' : raw('hidden')}>
      ${ui.imagePicker('wm_logo_id', int(s.wm_logo_id) || null, { label: 'লোগো', hint: '' })}
      <p class="small muted">খালি রাখলে দোকানের মূল লোগো (স্টোর ডিজাইন থেকে) ব্যবহার হবে। স্বচ্ছ (transparent) PNG লোগো সবচেয়ে ভালো মেশে।</p>
    </div>
    <input type="hidden" value="${domain}" data-wm-domain>
    <input type="hidden" value="${int(s.logo_id) || ''}" data-wm-store-logo>
    <div class="field-row">
      ${ui.field('কতটা দেখা যাবে', ui.select('wm_strength', Object.entries(STRENGTH), c.strength, { 'data-wm-in': true }))}
      ${ui.field('মাপ', ui.select('wm_size', Object.entries(SIZES), c.size, { 'data-wm-in': true }))}
    </div>
    ${ui.field('কোথায় বসবে', ui.select('wm_place', Object.entries(PLACES), c.place, { 'data-wm-in': true }), 'স্বয়ংক্রিয় হলে ছবির সাদা জায়গা বাদ দিয়ে পণ্যটা কোথায় আছে খুঁজে, পণ্যের গায়ে রঙ মিলিয়ে বসানো হয়।')}
    <button class="btn btn-lg">সেভ করুন</button>
  </form>
  <section class="panel">
    <h2>নমুনা <small>সেভ করার আগেই দেখুন</small></h2>
    ${sample ? html`<div class="wm-preview"><canvas data-wm-preview data-src="/media/${sample.id}"></canvas></div>
      <p class="small muted">একটা পণ্যের ছবিতে দেখানো হচ্ছে। ছবিতে চাপ দিয়ে বড় করে দেখুন।</p>`
    : html`<p class="muted">এখনো কোনো পণ্যের ছবি নেই — পণ্য যোগ করলে এখানে নমুনা দেখাবে।</p>`}
    <h2>অবস্থা</h2>
    <p data-wm-progress data-total="${prog.total}" data-done="${prog.done}">${c.on
      ? html`${bn(prog.done)} / ${bn(prog.total)} টি ছবিতে ওয়াটারমার্ক বসেছে।${prog.total > prog.done ? ' বাকিগুলো এখন বসানো হচ্ছে — পেজটা খোলা রাখুন।' : ' ✅ সব হয়ে গেছে।'}`
      : 'ওয়াটারমার্ক এখন বন্ধ আছে।'}</p>
    <p class="small muted">নতুন পণ্যের ছবিতে নিজে থেকেই বসে যায় (Admin প্যানেল খোলা থাকলে কয়েক সেকেন্ডে)। যতক্ষণ বসানো না হয়, ততক্ষণ আসল ছবি দেখায়।</p>
  </section>
</div>`;
  return ctx.page('ওয়াটারমার্ক', body, 'watermark');
}

// Background job (admin browser): which pictures still need the current mark, and how to draw it.
async function pendingApi(ctx) {
  const c = config(ctx.settings);
  if (!c.on || !c.ver) return ctx.json(ctx.res, 200, { ids: [] });
  const rows = await catalog.mediaNeedingWatermark(c.ver, 6);
  return ctx.json(ctx.res, 200, { ids: rows.map((r) => r.id), cfg: c });
}
async function saveApi(ctx, m) {
  if (!(await security.hit(db, 'wm:' + ctx.user.id, 6000, 3600))) return ctx.json(ctx.res, 429, { error: 'অনেক বেশি, একটু পরে।' });
  const b = await ctx.body();
  const c = config(ctx.settings);
  if (!c.on || b.ver !== c.ver) return ctx.json(ctx.res, 409, { error: 'ওয়াটারমার্কের সেটিং বদলে গেছে।' });
  // a picture the browser could not read: remember it, so it is not tried again (the normal picture shows)
  if (b.skip) { await catalog.setWatermark(int(m[1]), c.ver, null); return ctx.json(ctx.res, 200, { ok: true }); }
  const mm = String(b.data || '').match(/^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/);
  if (!mm) return ctx.json(ctx.res, 400, { error: 'ছবি পড়া যায়নি।' });
  const data = Buffer.from(mm[1], 'base64');
  if (data.length > 2.5 * 1024 * 1024 || security.imageKind(data) !== 'image/jpeg') return ctx.json(ctx.res, 400, { error: 'ছবি ঠিক নেই।' });
  await catalog.setWatermark(int(m[1]), c.ver, data);
  return ctx.json(ctx.res, 200, { ok: true });
}

module.exports = {
  routes: [
    { method: '*', path: '/admin/products/watermark', perm: 'products', handler: page },
    { method: 'GET', path: '/admin/api/watermark/pending', perm: 'products', handler: pendingApi },
    { method: 'POST', path: /^\/admin\/api\/watermark\/(\d+)$/, perm: 'products', handler: saveApi },
  ],
};
