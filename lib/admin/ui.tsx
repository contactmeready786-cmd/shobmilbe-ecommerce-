// Small building blocks shared by admin pages.
import { Val, RawHtml, attrValue, jsxList, styleOf } from '../react/html';
import { bn, money } from '../util';
import * as $models_catalog from '../models/catalog';
import type { Body, Id, Loose } from '../types';
import type { JSX } from 'react/jsx-runtime';
import type { DbRow } from '../pg';

/** A short message at the top of an admin page (a red one for errors). */
export type Flash = { type?: 'error'; text: string };
const MESSAGES: Record<string, string | Flash> = {
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
  removed: 'মুছে ফেলা হয়েছে।',
  analytics_cleared: 'ভিজিটর অ্যানালিটিক্সের সব হিসাব শূন্য করা হয়েছে — এখন থেকে নতুন করে গোনা শুরু হলো।',
  order_deleted: 'অর্ডার মুছে ফেলা হয়েছে — রিসাইকেল বিনে আছে (পণ্য স্টকে ফেরত গেছে), দরকার হলে সেখান থেকে ফেরত আনতে পারবেন।',
  cust_deleted: 'কাস্টমার মুছে ফেলা হয়েছে — রিসাইকেল বিনে আছে, দরকার হলে সেখান থেকে ফেরত আনতে পারবেন।',
  noperm: { type: 'error', text: 'এই কাজের অনুমতি আপনার নেই। মালিকের সাথে কথা বলুন।' },
};

function flash(msg?: Flash | null | '') {
  if (!msg) return '';
  return <p className={`flash ${msg.type === 'error' ? 'flash-error' : ''}`} role="status"><Val v={msg.text} /></p>;
}
function flashFrom(query: URLSearchParams): Flash | null {
  if (query.get('err')) return { type: 'error' as const, text: query.get('err')!.slice(0, 300) };
  if (query.get('info')) return { text: query.get('info')!.slice(0, 500) };
  const m = MESSAGES[query.get('msg') || ''];
  return m ? (typeof m === 'string' ? { text: m } : m) : null;
}

// 🏳️ A country's flag as a small picture (public/flags, from flag-icons — MIT): emoji flags don't show on Windows
// and look different on every phone, so the admin draws the same picture everywhere. The emoji stays as its alt text.
function flag(code: string) {
  const c = String(code || '').toUpperCase();
  if (!/^[A-Z]{2}$/.test(c)) return <span className="flag flag-none" aria-hidden="true">🌐</span>;
  const emoji = String.fromCodePoint(...[...c].map((ch) => 0x1F1E6 + ch.charCodeAt(0) - 65));
  return <img className="flag" src={`/flags/${c.toLowerCase()}.svg`} alt={emoji} width={20} height={15} loading="lazy" decoding="async" />;
}

function pill(text?: Loose, cls = '') { return <span className={`pill ${attrValue(cls)}`}><Val v={text} /></span>; }

// ---------- form fields ----------
function field(label?: Loose, control?: Loose, hint?: Loose) {
  return <div className="field"><label><Val v={label} /><Val v={control} /></label>{(hint ? <small><Val v={hint} /></small> : null)}</div>;
}
// Money boxes accept paisa (৳0.25).
const MONEY_FIELDS = new Set(['price', 'old_price', 'cost_price', 'amount', 'paid_amount', 'discount', 'delivery', 'shipping', 'other_cost',
  'vat', 'paid_now', 'opening_due', 'opening_balance', 'small_max_price', 'small_min_value', 'small_max_value']);
// The fields' extra attributes, written by the callers as in HTML ({ maxlength: 80, class: 'wide', required: true }), as
// React props. A true/false attribute (required, disabled …) is on whenever it is given at all; false / null / undefined
// leave an attribute out.
const PROP: Record<string, string> = { class: 'className', autocomplete: 'autoComplete', autofocus: 'autoFocus', autocapitalize: 'autoCapitalize',
  inputmode: 'inputMode', maxlength: 'maxLength', minlength: 'minLength', readonly: 'readOnly', spellcheck: 'spellCheck', tabindex: 'tabIndex', for: 'htmlFor' };
const ON_OFF = new Set(['required', 'disabled', 'autoFocus', 'readOnly', 'multiple', 'hidden']);
function propsOf(attrs: Loose): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v === null || v === undefined) continue;
    const name = PROP[k] || k;
    if (name === 'style') out.style = styleOf(v);
    else if (ON_OFF.has(name)) out[name] = true;
    else out[name] = v === true ? '' : String(v);
  }
  return out;
}
const text = (v: unknown) => (v === null || v === undefined ? '' : String(v));
// (the box keeps what the owner types: defaultValue, never a value React would hold)
function input(name?: Loose, value?: Loose, attrs: Loose = {}) {
  if (attrs.type === 'number' && MONEY_FIELDS.has(name) && attrs.step === undefined) {
    attrs = { ...attrs, step: '0.01' };
    if (Number(attrs.min) === 1) attrs.min = '0.01';
  }
  return <input name={text(name)} defaultValue={text(value)} {...propsOf(attrs)} />;
}
function textarea(name?: Loose, value?: Loose, attrs = {}) {
  return <textarea name={text(name)} defaultValue={text(value)} {...propsOf(attrs)} />;
}
function select(name: Loose, options: Body, value?: Loose, attrs = {}) {
  const opts = Array.isArray(options) ? options : Object.entries(options);
  return <select name={text(name)} defaultValue={text(value)} {...propsOf(attrs)}>{jsxList(opts.map(([v, l]: Loose[]) => <option value={text(v)}>{text(l)}</option>))}</select>;
}
function check(name?: Loose, checked?: Loose, label?: Loose, value = '1') {
  return <label className="check"><input type="checkbox" name={attrValue(name)} defaultValue={attrValue(value)} defaultChecked={!!(checked)} />{' '}<span><Val v={label} /></span></label>;
}
// Big on/off switch with a title and explanation.
function switchRow(name?: Loose, on?: Loose, title?: Loose, desc?: Loose) {
  return <label className="switch-row">{' '}<span className="switch-text"><b><Val v={title} /></b>{(desc ? <small><Val v={desc} /></small> : null)}</span>{' '}<span className="switch"><input type="checkbox" name={attrValue(name)} defaultValue="1" defaultChecked={!!(on)} /><span className="switch-ui" aria-hidden="true"></span></span>{' '}<span className="switch-state" data-on="চালু" data-off="বন্ধ"></span></label>;
}
// Image picker: uploads in the browser, keeps the media id in a hidden input.
type ImagePickerProps = {
  label?: string;
  hint?: string;
  wide?: boolean;
};
function imagePicker(name?: Loose, mediaId?: Id, { label = 'ছবি', hint = '', wide = false }: ImagePickerProps = {}) {
  return <div className={`field image-pick ${wide ? 'wide' : ''}`} data-image-pick=""><span className="label"><Val v={label} /></span><div className="pick-preview" data-pick-preview="">{(mediaId ? <img src={`/media/${attrValue(mediaId)}/t`} alt="" /> : <span className="muted small">ছবি নেই</span>)}</div><p className={`pick-status ${mediaId ? 'is-live' : ''}`} data-pick-status="" data-live={mediaId ? '1' : ''}>{(mediaId ? "✅ এখন সাইটে এই ছবিটা চলছে" : "এখনো কোনো ছবি দেওয়া হয়নি")}</p><input type="hidden" name={attrValue(name)} defaultValue={attrValue(mediaId || '')} data-pick-value="" /><div className="pick-actions"><label className="btn btn-sm btn-ghost">{(mediaId ? "🔄 ছবি বদলান" : "📷 ছবি বাছুন")}<input type="file" accept="image/*" hidden data-pick-file="" data-wide={(wide) ? "" : undefined} /></label>{' '}{(mediaId ? <a className="btn btn-sm btn-ghost" href={`/media/${attrValue(mediaId)}`} target="_blank" rel="noopener">🔍 বড় করে দেখুন</a> : null)}{' '}<button type="button" className="link-btn danger" data-pick-clear="" hidden={!(mediaId)}>🗑️ সরান</button></div>{(hint ? <small><Val v={hint} /></small> : null)}</div>;
}

function pager(total?: Loose, page?: Loose, perPage?: Loose, baseUrl?: Loose) {
  const pages = Math.ceil(total / perPage);
  if (pages <= 1) return '';
  const link = (p: string | number) => baseUrl + (baseUrl.includes('?') ? '&' : '?') + 'page=' + p;
  const items = [];
  for (let p = Math.max(1, page - 2); p <= Math.min(pages, page + 2); p++) items.push(p);
  return <nav className="pager" aria-label="পেজ">{(page > 1 ? <a href={attrValue(link(page - 1))}>← আগের</a> : null)}{' '}{jsxList(items.map((p) => (p === page ? <b>{bn(p)}</b> : <a href={attrValue(link(p))}>{bn(p)}</a>)))}{' '}{(page < pages ? <a href={attrValue(link(page + 1))}>পরের →</a> : null)}{' '}<span className="muted small">মোট{' '}{bn(total)}টি</span></nav>;
}

function dateFilter(path?: Loose, from?: Loose, to?: Loose, extra = '') {
  const presets = [[7, '৭ দিন'], [30, '৩০ দিন'], [90, '৯০ দিন'], [365, '১ বছর']];
  return <form className="date-filter" method="get" action={attrValue(path)}><RawHtml html={extra} /><div className="chips">{jsxList(presets.map(([d, l]) => <a className="chip" href={`${attrValue(path)}?days=${attrValue(d)}`}><Val v={l} /></a>))}</div><label>থেকে{' '}<input type="date" name="from" defaultValue={attrValue(from)} /></label>{' '}<label>পর্যন্ত{' '}<input type="date" name="to" defaultValue={attrValue(to)} /></label>{' '}<button className="btn btn-sm">দেখুন</button></form>;
}

function kpi(label?: Loose, value?: Loose, sub?: Loose, cls = '', href = '') {
  const body = <><span className="kpi-label"><Val v={label} /></span><b className="kpi-value"><Val v={value} /></b>{(sub ? <span className="kpi-sub"><Val v={sub} /></span> : null)}</>;
  return href ? <a className={`kpi ${attrValue(cls)}`} href={attrValue(href)}>{body}</a> : <div className={`kpi ${attrValue(cls)}`}>{body}</div>;
}

// Category choices as a tree: "📟 ইলেকট্রনিক্স", "　└ সার্কিট ও মডিউল", "　　└ অডিও অ্যামপ্লিফায়ার বোর্ড"
function catOpts(categories: $models_catalog.Category[]) {
  const { categoryOptions } = $models_catalog;
  return categoryOptions(categories).map((c) => [c.id, c.depth ? `${'\u3000'.repeat(c.depth)}└ ${c.name}` : `${c.icon} ${c.name}`]);
}

// "কাজ" column for admin lists: ✏️ edit, optional on/off switch, optional 🗑️ delete (goes to the recycle bin).
function rowSwitch(action?: Loose, on?: Loose, label?: Loose) {
  return <form method="post" action={attrValue(action)} className="prod-toggle"><label className="switch" title={attrValue(label)}><input type="checkbox" name="active" defaultValue="1" defaultChecked={!!(on)} data-prod-toggle="" aria-label={attrValue(label)} /><span className="switch-ui" aria-hidden="true"></span></label>{' '}<span className="small prod-toggle-text" data-prod-toggle-text="">{(on ? "চালু" : "বন্ধ")}</span><noscript><button className="btn btn-sm btn-ghost">সেভ</button></noscript></form>;
}
type RowActionsProps = {
  edit: string;
  del?: string;
  delConfirm?: string;
  editLabel?: string;
};
function rowActions({ edit, del, delConfirm, editLabel = '✏️ এডিট' }: RowActionsProps) {
  return <td className="prod-actions">{(edit ? <a className="btn btn-sm btn-ghost" href={attrValue(edit)}><Val v={editLabel} /></a> : null)}{' '}{(del ? <form method="post" action={attrValue(del)} data-confirm={attrValue(delConfirm || 'মুছবেন? রিসাইকেল বিনে থাকবে, মালিক চাইলে ফেরত আনতে পারবেন।')}><button className="btn btn-sm btn-danger">🗑️ মুছুন</button></form> : null)}</td>;
}

// One "পণ্য আমদানি" place with two ways in (tabs at the top of both pages)
function importTabs(current: string) {
  const tabs = [
    ['import', '/admin/products/import', '📥', 'লিংক বা ফাইল থেকে আমদানি', 'ফিড লিংক, একটা পণ্যের লিংক, CSV / Excel'],
    ['old', '/admin/products/more-photos', '📸', 'পুরোনো সাইট থেকে সব পণ্য ও ছবি', 'বাকি পণ্য যোগ + প্রতিটা পণ্যের সব ছবি'],
  ];
  return <nav className="imp-tabs" aria-label="পণ্য আমদানির ধরন">{jsxList(tabs.map(([k, href, ic, t, d]) => <a href={attrValue(href)} className={`imp-tab ${k === current ? 'on' : ''}`} aria-current={(k === current) ? "page" : undefined}><span className="imp-tab-ic"><Val v={ic} /></span><span><b><Val v={t} /></b><small><Val v={d} /></small></span></a>))}</nav>;
}

function empty(text?: Loose, action?: JSX.Element | undefined) {
  return <div className="empty panel"><p><Val v={text} /></p><Val v={action || ''} /></div>;
}

function helpBox(title?: Loose, body?: Loose) {
  return <details className="help"><summary>💡{' '}<Val v={title} /></summary><div><Val v={body} /></div></details>;
}

export { flag, importTabs, rowSwitch, rowActions, catOpts, MESSAGES, flash, flashFrom, pill, field, input, textarea, select, check, switchRow, imagePicker, pager, dateFilter, kpi, empty, helpBox, money, bn };
