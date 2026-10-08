'use strict';
// Small building blocks shared by admin pages.
const { html, raw, esc, bn, money } = require('../util');

const MESSAGES = {
  saved: 'সেভ হয়েছে।',
  added: 'যোগ হয়েছে।',
  deleted: 'মুছে ফেলা হয়েছে — দোকান থেকে সরে গেছে, তবে রিসাইকেল বিনে আছে (মালিক চাইলে ফেরত আনতে পারবেন)।',
  status: 'অবস্থা বদলানো হয়েছে।',
  password: 'পাসওয়ার্ড বদলানো হয়েছে।',
  sent: 'কুরিয়ারে পাঠানো হয়েছে।',
  synced: 'কুরিয়ার থেকে আপডেট আনা হয়েছে।',
  blocked: 'ব্লক লিস্টে যোগ হয়েছে।',
  unblocked: 'ব্লক তুলে নেওয়া হয়েছে।',
  paid: 'পেমেন্ট রেকর্ড হয়েছে।',
  copied: 'কপি তৈরি হয়েছে (লুকানো অবস্থায়)। নাম আর ছবি ঠিক করে দোকানে দেখান।',
  noperm: { type: 'error', text: 'এই কাজের অনুমতি আপনার নেই। মালিকের সাথে কথা বলুন।' },
};

function flash(msg) {
  if (!msg) return '';
  return html`<p class="flash ${msg.type === 'error' ? 'flash-error' : ''}" role="status">${msg.text}</p>`;
}
function flashFrom(query) {
  if (query.get('err')) return { type: 'error', text: query.get('err').slice(0, 300) };
  if (query.get('info')) return { text: query.get('info').slice(0, 500) };
  const m = MESSAGES[query.get('msg')];
  return m ? (typeof m === 'string' ? { text: m } : m) : null;
}

function pill(text, cls = '') { return html`<span class="pill ${cls}">${text}</span>`; }

// ---------- form fields ----------
function field(label, control, hint) {
  return html`<div class="field"><label>${label}${control}</label>${hint ? html`<small>${hint}</small>` : ''}</div>`;
}
// Money boxes accept paisa (৳0.25).
const MONEY_FIELDS = new Set(['price', 'old_price', 'cost_price', 'amount', 'paid_amount', 'discount', 'delivery', 'shipping', 'other_cost',
  'vat', 'paid_now', 'opening_due', 'opening_balance', 'small_max_price', 'small_min_value', 'small_max_value']);
function input(name, value, attrs = {}) {
  if (attrs.type === 'number' && MONEY_FIELDS.has(name) && attrs.step === undefined) {
    attrs = { ...attrs, step: '0.01' };
    if (Number(attrs.min) === 1) attrs.min = '0.01';
  }
  const a = Object.entries(attrs).filter(([, v]) => v !== false && v !== null && v !== undefined)
    .map(([k, v]) => (v === true ? ` ${k}` : ` ${k}="${esc(v)}"`)).join('');
  return raw(`<input name="${esc(name)}" value="${esc(value ?? '')}"${a}>`);
}
function textarea(name, value, attrs = {}) {
  const a = Object.entries(attrs).filter(([, v]) => v !== false && v !== null && v !== undefined)
    .map(([k, v]) => (v === true ? ` ${k}` : ` ${k}="${esc(v)}"`)).join('');
  return raw(`<textarea name="${esc(name)}"${a}>${esc(value ?? '')}</textarea>`);
}
function select(name, options, value, attrs = {}) {
  const a = Object.entries(attrs).filter(([, v]) => v !== false && v !== null && v !== undefined)
    .map(([k, v]) => (v === true ? ` ${k}` : ` ${k}="${esc(v)}"`)).join('');
  const opts = (Array.isArray(options) ? options : Object.entries(options))
    .map(([v, l]) => `<option value="${esc(v)}"${String(v) === String(value ?? '') ? ' selected' : ''}>${esc(l)}</option>`).join('');
  return raw(`<select name="${esc(name)}"${a}>${opts}</select>`);
}
function check(name, checked, label, value = '1') {
  return html`<label class="check"><input type="checkbox" name="${name}" value="${value}" ${checked ? raw('checked') : ''}> <span>${label}</span></label>`;
}
// Big on/off switch with a title and explanation.
function switchRow(name, on, title, desc) {
  return html`<label class="switch-row">
    <span class="switch-text"><b>${title}</b>${desc ? html`<small>${desc}</small>` : ''}</span>
    <span class="switch"><input type="checkbox" name="${name}" value="1" ${on ? raw('checked') : ''}><span class="switch-ui" aria-hidden="true"></span></span>
    <span class="switch-state" data-on="চালু" data-off="বন্ধ"></span></label>`;
}
// Image picker: uploads in the browser, keeps the media id in a hidden input.
function imagePicker(name, mediaId, { label = 'ছবি', hint = '', wide = false } = {}) {
  return html`<div class="field image-pick ${wide ? 'wide' : ''}" data-image-pick>
    <span class="label">${label}</span>
    <div class="pick-preview" data-pick-preview>${mediaId ? html`<img src="/media/${mediaId}/t" alt="">` : html`<span class="muted small">ছবি নেই</span>`}</div>
    <input type="hidden" name="${name}" value="${mediaId || ''}" data-pick-value>
    <div class="pick-actions">
      <label class="btn btn-sm btn-ghost">ছবি বাছুন<input type="file" accept="image/*" hidden data-pick-file ${wide ? raw('data-wide') : ''}></label>
      <button type="button" class="link-btn danger" data-pick-clear ${mediaId ? '' : raw('hidden')}>সরান</button>
    </div>
    ${hint ? html`<small>${hint}</small>` : ''}
  </div>`;
}

function pager(total, page, perPage, baseUrl) {
  const pages = Math.ceil(total / perPage);
  if (pages <= 1) return '';
  const link = (p) => baseUrl + (baseUrl.includes('?') ? '&' : '?') + 'page=' + p;
  const items = [];
  for (let p = Math.max(1, page - 2); p <= Math.min(pages, page + 2); p++) items.push(p);
  return html`<nav class="pager" aria-label="পেজ">
    ${page > 1 ? html`<a href="${link(page - 1)}">← আগের</a>` : ''}
    ${items.map((p) => (p === page ? html`<b>${bn(p)}</b>` : html`<a href="${link(p)}">${bn(p)}</a>`))}
    ${page < pages ? html`<a href="${link(page + 1)}">পরের →</a>` : ''}
    <span class="muted small">মোট ${bn(total)}টি</span>
  </nav>`;
}

function dateFilter(path, from, to, extra = '') {
  const presets = [[7, '৭ দিন'], [30, '৩০ দিন'], [90, '৯০ দিন'], [365, '১ বছর']];
  return html`<form class="date-filter" method="get" action="${path}">
    ${raw(extra)}
    <div class="chips">${presets.map(([d, l]) => html`<a class="chip" href="${path}?days=${d}">${l}</a>`)}</div>
    <label>থেকে <input type="date" name="from" value="${from}"></label>
    <label>পর্যন্ত <input type="date" name="to" value="${to}"></label>
    <button class="btn btn-sm">দেখুন</button>
  </form>`;
}

function kpi(label, value, sub, cls = '', href = '') {
  const body = html`<span class="kpi-label">${label}</span><b class="kpi-value">${value}</b>${sub ? html`<span class="kpi-sub">${sub}</span>` : ''}`;
  return href ? html`<a class="kpi ${cls}" href="${href}">${body}</a>` : html`<div class="kpi ${cls}">${body}</div>`;
}

// Category choices as a tree: "📟 ইলেকট্রনিক্স", "　└ সার্কিট ও মডিউল", "　　└ অডিও অ্যামপ্লিফায়ার বোর্ড"
function catOpts(categories) {
  const { categoryOptions } = require('../models/catalog');
  return categoryOptions(categories).map((c) => [c.id, c.depth ? `${'\u3000'.repeat(c.depth)}└ ${c.name}` : `${c.icon} ${c.name}`]);
}

// "কাজ" column for admin lists: ✏️ edit, optional on/off switch, optional 🗑️ delete (goes to the recycle bin).
function rowSwitch(action, on, label) {
  return html`<form method="post" action="${action}" class="prod-toggle">
    <label class="switch" title="${label}"><input type="checkbox" name="active" value="1" ${on ? raw('checked') : ''} data-prod-toggle aria-label="${label}"><span class="switch-ui" aria-hidden="true"></span></label>
    <span class="small prod-toggle-text" data-prod-toggle-text>${on ? 'চালু' : 'বন্ধ'}</span><noscript><button class="btn btn-sm btn-ghost">সেভ</button></noscript></form>`;
}
function rowActions({ edit, del, delConfirm, editLabel = '✏️ এডিট' }) {
  return html`<td class="prod-actions">${edit ? html`<a class="btn btn-sm btn-ghost" href="${edit}">${editLabel}</a>` : ''}
    ${del ? html`<form method="post" action="${del}" data-confirm="${delConfirm || 'মুছবেন? রিসাইকেল বিনে থাকবে, মালিক চাইলে ফেরত আনতে পারবেন।'}"><button class="btn btn-sm btn-danger">🗑️ মুছুন</button></form>` : ''}</td>`;
}

function empty(text, action) {
  return html`<div class="empty panel"><p>${text}</p>${action || ''}</div>`;
}

function helpBox(title, body) {
  return html`<details class="help"><summary>💡 ${title}</summary><div>${body}</div></details>`;
}

module.exports = { rowSwitch, rowActions, catOpts, MESSAGES, flash, flashFrom, pill, field, input, textarea, select, check, switchRow, imagePicker, pager, dateFilter, kpi, empty, helpBox, money, bn };
