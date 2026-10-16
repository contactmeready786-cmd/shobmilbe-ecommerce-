// @ts-nocheck — converted from JavaScript; types are added file by file.
// Admin → পণ্য → 🧰 প্রজেক্ট কিট: make a kit for a project ("ব্লুটুথ স্পিকার বানান"), list its parts (how many of each,
// which are optional), and switch it on. Customers see it at /kits and add the parts to the cart together.
import { html, raw, bn, money, int } from '../util';
import * as ui from './ui';
import * as K from '../models/kits';
import * as $db from '../db';

const BASE = '/admin/kits';

async function listPage(ctx) {
  const s = ctx.settings;
  if (ctx.method === 'POST') {
    const b = await ctx.body();
    // 📚 a ready-made guide → a kit (parts matched from the shop's own products)
    if (b.action === 'guide') {
      try {
        const r = await K.fromGuide(String(b.key || ''));
        if (r.existed) return ctx.back(`${BASE}/${r.id}?info=${encodeURIComponent('এই গাইড থেকে কিট আগেই বানানো আছে।')}`);
        await ctx.log('kit_save', 'kit', r.id, `তৈরি গাইড থেকে কিট: ${b.key}`);
        const msg = r.active ? '✅ কিট তৈরি হয়ে দোকানে চালু হয়েছে। পার্টসগুলো একবার মিলিয়ে দেখুন।'
          : `⚠️ কিট তৈরি হয়েছে কিন্তু বন্ধ রাখা হলো — দোকানে এই পার্টস নেই: ${r.missing.map((x) => x.note || x.find[0]).join(', ')}। পার্টস তুলে কিটে যোগ করে "দোকানে দেখাও" চালু করুন।`;
        return ctx.back(`${BASE}/${r.id}?${r.active ? 'info' : 'err'}=${encodeURIComponent(msg)}`);
      } catch (e) {
        if (!(e instanceof K.KitError)) throw e;
        return ctx.fail(BASE, e.message);
      }
    }
    if (!ctx.can('settings')) return ctx.back(BASE, 'noperm');
    await $db.setMany({ kits_on: b.kits_on ? '1' : '0' });
    return ctx.back(BASE, 'saved');
  }
  const [kits, guides] = await Promise.all([K.list(), K.guideStatus().catch(() => [])]);
  const body = html`<div class="title-row"><h1>🧰 প্রজেক্ট কিট</h1><div class="row-actions"><a class="btn" href="${BASE}/new">+ নতুন কিট</a><a class="btn btn-ghost btn-sm" href="/kits" target="_blank" rel="noopener">দোকানে দেখুন ↗</a></div></div>
${ui.flash(ctx.flash)}
${ui.helpBox('কিট কী, কীভাবে কাজে লাগাবেন', html`<ol class="steps">
  <li>একটা প্রজেক্টের জন্য যা যা পার্টস লাগে সেগুলো এক জায়গায় রাখুন — যেমন "ব্লুটুথ স্পিকার বানান": মডিউল, অ্যামপ্লিফায়ার, স্পিকার, ব্যাটারি, তার।</li>
  <li>কাস্টমার কিটের পেজে দেখেন কী কী লাগবে আর মোট কত টাকা। যেটা তার কাছে আছে সেটার টিক তুলে দেন, পরিমাণ বদলান, তারপর এক চাপে সব কার্টে।</li>
  <li>প্রতিটা পার্টস আলাদা পণ্য হিসেবেই বিক্রি হয় — স্টক, দাম, SKU সব নিজের। (বান্ডেল থেকে পার্থক্য: বান্ডেল এক দামে একসাথে বিক্রি হয়।)</li>
  <li>"ঐচ্ছিক" দিলে কাস্টমারের কাছে টিক ছাড়া থাকে — যেমন বাড়তি ব্যাটারি বা বক্স।</li>
</ol>`)}
<section class="panel table-wrap">
${kits.length ? html`<table class="table"><thead><tr><th></th><th>কিট</th><th class="num">পার্টস</th><th class="num">দরকারি পার্টসের দাম</th><th>অবস্থা</th><th></th></tr></thead><tbody>
${kits.map((k) => html`<tr><td class="thumb">${k.image_id ? html`<img src="/media/${k.image_id}/t" alt="">` : html`<span>${k.emoji}</span>`}</td>
  <td><a href="${BASE}/${k.id}"><b>${k.title}</b></a><br><a class="small muted" href="/kit/${k.slug}" target="_blank" rel="noopener">/kit/${k.slug}</a></td>
  <td class="num">${bn(k.parts)}</td><td class="num">${money(k.base_total)}</td><td>${k.active ? ui.pill('চালু', 'pill-ok') : ui.pill('বন্ধ', 'pill-grey')}</td>
  <td><a class="btn btn-sm" href="${BASE}/${k.id}">✏️ এডিট</a></td></tr>`)}
</tbody></table>` : html`<p class="muted">এখনো কোনো কিট নেই। "+ নতুন কিট" চেপে প্রথমটা বানান।</p>`}
</section>
<section class="panel" id="guides"><h2>📚 তৈরি প্রজেক্ট গাইড — এক চাপে কিট</h2>
  <p class="small">প্রতিটা গাইডে বানানোর ধাপ লেখা আছে। "কিট বানান" চাপলে দোকানের পণ্য থেকে পার্টস নিজে খুঁজে নিয়ে কিট তৈরি হয়। সব দরকারি পার্টস পাওয়া গেলে সাথে সাথে চালু হয়; না পেলে বন্ধ থাকে আর কোন পার্টস নেই বলে দেয় (সেগুলো তুললেই চালু করা যাবে)।
  মানুষ Google-এ "ব্লুটুথ স্পিকার কিভাবে বানাবো" এভাবে খোঁজে — এই পেজগুলো ঠিক সেই উত্তর দেয় আর পার্টস বিক্রি করে।</p>
  ${guides.length ? html`<div class="table-wrap"><table class="table compact"><thead><tr><th>গাইড</th><th>দোকানে পার্টস</th><th></th></tr></thead><tbody>
  ${guides.map((g) => { const need = g.parts.filter((x) => !x.optional).length; const have = need - g.missing.length; return html`<tr>
    <td>${g.emoji} <b>${g.title}</b><br><span class="small muted">${g.level} · ${g.time} · ${bn(g.steps.length)}টা ধাপ</span></td>
    <td class="small">${g.missing.length ? html`<span class="warn">${bn(have)}/${bn(need)}টা পাওয়া গেছে</span><br><span class="muted">নেই: ${g.missing.map((x) => x.note || x.find[0]).join(', ')}</span>` : html`<span class="ok">✅ সব ${bn(need)}টা আছে</span>`}</td>
    <td>${g.kit ? html`<a class="btn btn-sm btn-ghost" href="${BASE}/${g.kit.id}">✏️ কিট দেখুন${g.kit.active ? '' : ' (বন্ধ)'}</a>` : html`<form method="post" action="${BASE}"><input type="hidden" name="action" value="guide"><input type="hidden" name="key" value="${g.key}"><button class="btn btn-sm">➕ কিট বানান</button></form>`}</td></tr>`; })}
  </tbody></table></div>` : ''}
</section>
${ctx.can('settings') ? html`<section class="panel"><form method="post" action="${BASE}" class="form">
  ${ui.switchRow('kits_on', s.kits_on !== '0', 'দোকানে "🧰 প্রজেক্ট কিট" চালু', 'বন্ধ করলে /kits পেজ আর পণ্যের পেজে কিটের লিংক থাকবে না।')}
  <button class="btn">সেভ করুন</button></form></section>` : ''}`;
  return ctx.page('প্রজেক্ট কিট', body, 'kits');
}

async function editPage(ctx, m) {
  const isNew = m[1] === 'new';
  const back = isNew ? `${BASE}/new` : `${BASE}/${int(m[1])}`;
  if (ctx.method === 'POST') {
    const b = await ctx.body();
    try {
      if (b.action === 'delete' && !isNew) { await K.remove(m[1]); await ctx.log('kit_delete', 'kit', int(m[1]), 'কিট মুছেছে'); return ctx.back(BASE, 'deleted'); }
      const id = await K.save({ ...b, id: isNew ? 0 : int(m[1]) });
      await ctx.log('kit_save', 'kit', id, String(b.title || '').slice(0, 80));
      return ctx.back(`${BASE}/${id}`, 'saved');
    } catch (e) {
      if (!(e instanceof K.KitError)) throw e;
      return ctx.fail(back, e.message);
    }
  }
  const k = isNew ? { title: '', description: '', emoji: '🧰', active: true, sort: 0, items: [], steps: '', level: '', duration: '' } : await K.get({ id: m[1] });
  if (!k) return ctx.redirect(ctx.res, BASE);
  const body = html`<p class="crumbs"><a href="${BASE}">← সব কিট</a></p>
<div class="title-row"><h1>${isNew ? 'নতুন প্রজেক্ট কিট' : k.title}</h1>${isNew ? '' : html`<div class="row-actions"><a class="btn btn-ghost btn-sm" href="/kit/${k.slug}" target="_blank" rel="noopener">দোকানে দেখুন ↗</a></div>`}</div>
${ui.flash(ctx.flash)}
<form method="post" action="${back}" class="form">
<div class="two-col">
  <section class="panel">
    ${ui.field('কিটের নাম', ui.input('title', k.title, { maxlength: 120, required: true, placeholder: 'যেমন: ব্লুটুথ স্পিকার বানানোর কিট' }))}
    ${ui.field('বিবরণ (কী বানানো যাবে, কীভাবে)', ui.textarea('description', k.description, { rows: 6, maxlength: 5000 }), 'লাইনের শুরুতে "- " দিলে তালিকা, "1. " দিলে ধাপে ধাপে, YouTube লিংক দিলে ভিডিও দেখাবে।')}
    ${ui.field('কীভাবে বানাবেন — ধাপগুলো (প্রতি লাইনে একটা ধাপ)', ui.textarea('steps', k.steps, { rows: 8, maxlength: 12000, placeholder: 'মডিউলের 5V আর GND সাপ্লাইয়ে জুড়ুন\nঅডিও আউটপুট অ্যাম্পের ইনপুটে দিন\n…' }), 'দোকানে নম্বর দিয়ে ধাপে ধাপে দেখাবে, আর Google এটাকে "কীভাবে বানাবেন" (HowTo) পেজ হিসেবে পড়বে।')}
    <div class="field-row">${ui.field('কঠিনতা', ui.input('level', k.level, { maxlength: 60, placeholder: 'সহজ / মাঝারি' }))}${ui.field('কত সময় লাগে', ui.input('duration', k.duration, { maxlength: 60, placeholder: '১-২ ঘণ্টা' }))}</div>
    <div class="field-row">${ui.field('ইমোজি', ui.input('emoji', k.emoji, { maxlength: 8, class: 'w-num' }))}${ui.field('ক্রম', ui.input('sort', k.sort, { type: 'number', class: 'w-num' }))}</div>
    ${ui.imagePicker('image_id', k.image_id, { label: 'ছবি (ঐচ্ছিক)' })}
    ${ui.switchRow('active', !!k.active, 'দোকানে দেখাও', '')}
  </section>
  <section class="panel" data-bundle data-kit>
    <h2>কী কী পার্টস লাগবে</h2>
    <div class="item-picker"><input type="search" placeholder="পণ্য খুঁজে যোগ করুন…" data-bundle-search autocomplete="off"><ul class="picker-results" data-bundle-results hidden></ul></div>
    <div class="table-wrap"><table class="table item-rows bundle-rows"><thead><tr><th>ছবি</th><th>পণ্য</th><th class="num">দাম</th><th class="num">পরিমাণ</th><th class="num">মোট</th><th class="num">স্টক</th><th>ঐচ্ছিক</th><th>কাজ</th></tr></thead>
      <tbody data-bundle-rows>${k.items.map((i) => html`<tr data-row data-price="${i.price}">
        <td class="b-img">${i.image_id ? html`<img src="/media/${i.image_id}/t" alt="" loading="lazy">` : html`<span class="pe">${i.emoji || '📦'}</span>`}</td>
        <td class="b-name"><b>${i.name}</b>${i.sku ? html`<br><span class="small muted">SKU ${i.sku}</span>` : ''}<input type="hidden" name="bundle_id[]" value="${i.product_id}">
          <input name="kit_note[]" value="${i.note}" maxlength="120" placeholder="ছোট নোট (ঐচ্ছিক)" class="kit-note"></td>
        <td class="num">${money(i.price)}</td>
        <td class="num"><span class="qty-step"><button type="button" class="qs-btn" data-bq="-1" aria-label="কমান">−</button><input type="number" name="bundle_qty[]" value="${i.qty}" min="1" class="w-num" data-qty><button type="button" class="qs-btn" data-bq="1" aria-label="বাড়ান">+</button></span></td>
        <td class="num" data-line>${money(i.price * i.qty)}</td><td class="num">${bn(i.stock)}</td>
        <td><label class="check"><input type="checkbox" name="kit_opt[]" value="${i.product_id}" ${i.optional ? raw('checked') : ''}> ঐচ্ছিক</label></td>
        <td class="b-act"><button type="button" class="btn btn-sm btn-danger" data-remove-row>🗑️ মুছুন</button></td></tr>`)}</tbody></table></div>
    <p class="muted small" data-bundle-empty ${k.items.length ? raw('hidden') : ''}>এখনো কোনো পার্টস যোগ হয়নি — উপরে খুঁজে যোগ করুন।</p>
    <p class="muted small" data-bundle-sum></p>
  </section>
</div>
<p class="row-actions"><button class="btn">সেভ করুন</button>${isNew ? '' : html` <button class="btn btn-danger btn-sm" name="action" value="delete" data-confirm-btn="এই কিটটা মুছবেন? পণ্যগুলো মুছবে না।">🗑️ কিট মুছুন</button>`}</p>
</form>`;
  return ctx.page(isNew ? 'নতুন কিট' : k.title, body, 'kits');
}

export const routes = [
    { method: '*', path: BASE, perm: 'products', handler: listPage },
    { method: '*', path: /^\/admin\/kits\/(new|\d+)$/, perm: 'products', handler: editPage },
  ];
