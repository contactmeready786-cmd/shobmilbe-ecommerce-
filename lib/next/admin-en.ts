// 🇬🇧 The admin panel in English, made on the server (owner, 2026-11-17: "solid English, not a drop of Bangla —
// and pages must open in the blink of an eye like before").
//
// The admin's code is written in Bangla; public/js/admin-en.json holds the hand-made English of every phrase in it.
// Until now the browser swapped the words after the page arrived, and hid the page for up to 2.5 s while it did.
// Now the page is turned into English here, before it is sent: the browser gets English at once and shows it at once.
// The rules are the same as the browser's (client/admin/i18n.ts, which still handles words added later — toasts,
// search results): only the dictionary's phrases change; data marked translate="no" (names, addresses, notes),
// <textarea>, <code>, <pre>, <script> and <style> stay as they are; Bangla digits become 0-9.
//
//  - adminEnglish(node)  — a React page (app/(admin)/admin): every text and the wording attributes of the tree.
//  - adminEnglishHtml(s) — a page as text (app/api/admin answers: a form's answer page, an error page).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Fragment, cloneElement, createElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { Raw } from '../util';
import type { Settings } from '../types';

const LETTER = /[ঀ-৥ৰ-৲৴-৿]/; // Bangla letters (not digits, not ৳)
const HAS_DIGIT = /[০-৯]/;
const WHOLE: Record<string, string> = { 'থেকে': 'From', 'পর্যন্ত': 'Until', 'আছে': 'Yes', 'নেই': 'No' };
const NEVER = new Set(['কো', 'লা', 'হা', 'এ', 'কে', 'সে', 'মি', 'ঘ', 'বাং', 'টি', 'জন']);
const UNITS: Record<string, string> = { 'হা': 'k', 'লা': 'L', 'কো': 'Cr', 'মি': 'm', 'ঘ': 'h', 'সে': 's' };
/** attributes that hold wording a person reads (never ones the code or the CSS look up, like data-side-group) */
const ATTRS = new Set(['placeholder', 'title', 'aria-label', 'alt', 'data-confirm', 'data-confirm-btn', 'data-confirm-shop', 'data-on', 'data-off',
  'data-tip', 'data-label', 'data-delcode-what', 'data-delcode-title', 'data-delcode-intro', 'data-delcode-go']);
const SKIP_TAGS = new Set(['script', 'style', 'textarea', 'code', 'pre', 'noscript', 'template']);
const BLOCK_TAGS = new Set(['p', 'li', 'label', 'td', 'div', 'span', 'small', 'b', 'strong']);
const INLINE_TAGS = new Set(['b', 'strong', 'i', 'em', 'code', 'span', 'small', 'u', 'br']);

let dict: Record<string, string> | null = null;
let buckets: Record<string, string[]> = Object.create(null);
let failed = false;

const norm = (s: string) => String(s).replace(/\s+/g, ' ').trim();
const isLetter = (ch: string | undefined) => !!ch && LETTER.test(ch);
const isAscii = (ch: string | undefined) => !!ch && /[A-Za-z0-9]/.test(ch);
const lettersIn = (s: string) => Array.from(s).filter((c) => LETTER.test(c)).length;
const digits = (s: string) => String(s).replace(/[০-৯]/g, (d) => String('০১২৩৪৫৬৭৮৯'.indexOf(d))).replace(/।/g, '.');

function ready(): boolean {
  if (dict) return true;
  if (failed) return false;
  try {
    const raw = JSON.parse(readFileSync(join(process.cwd(), 'public/js/admin-en.json'), 'utf8')) as Record<string, string>;
    const d: Record<string, string> = Object.create(null);
    buckets = Object.create(null);
    const add = (key: string, v: string) => {
      const k = norm(key);
      if (!k || k in d) return;
      d[k] = v;
      if (NEVER.has(k) || /^[০-৯]+\s?(টি|টা|জন)$/.test(k)) return;
      (buckets[k.slice(0, 2)] ||= []).push(k);
    };
    for (const [k, v] of Object.entries(raw)) {
      add(k, v);
      const m = k.match(/^[^ঀ-৿A-Za-z0-9]+/);
      if (m) {
        const lead = m[0].trim();
        const core = k.slice(m[0].length);
        if (core && v.startsWith(lead)) add(core, v.slice(lead.length).replace(/^\s+/, ''));
      }
    }
    for (const list of Object.values(buckets)) list.sort((x, y) => y.length - x.length);
    dict = d;
    return true;
  } catch (e) {
    failed = true; // the page is still sent (in Bangla; the browser's translator then does it) — never a broken page
    console.error('admin English: dictionary not loaded:', (e as Error).message);
    return false;
  }
}

// the same words come again and again (every row's buttons, every page's menu): each is worked out once
const memo = new Map<string, string>();
/** One piece of text → English (the same rules as client/admin/i18n.ts tr()). */
export function tr(src: string): string {
  if (!src || (!LETTER.test(src) && !HAS_DIGIT.test(src)) || !ready() || !dict) return src;
  const known = memo.get(src);
  if (known !== undefined) return known;
  const en = trOnce(src);
  if (memo.size > 50000) memo.clear();
  memo.set(src, en);
  return en;
}
function trOnce(src: string): string {
  if (!dict) return src;
  const lead = (src.match(/^\s*/) || [''])[0];
  const trail = (src.match(/\s*$/) || [''])[0];
  const s = norm(src);
  if (s in WHOLE) return lead + WHOLE[s] + trail;
  if (s in dict) return lead + digits(dict[s]) + trail;
  let out = '';
  let i = 0;
  let hits = 0;
  while (i < s.length) {
    const prev = i ? s[i - 1] : '';
    const start = !(isLetter(prev) || (isAscii(prev) && isAscii(s[i])));
    let found: string | null = null;
    if (start) {
      for (const k of buckets[s.substr(i, 2)] || []) {
        if (s.substr(i, k.length) !== k) continue;
        const next = s[i + k.length];
        const last = k[k.length - 1];
        if ((isLetter(last) && isLetter(next)) || (isAscii(last) && isAscii(next))) continue;
        found = k;
        break;
      }
    }
    if (found) {
      const v = dict[found];
      if (v && /[A-Za-z0-9০-৯)\]]$/.test(out) && /^[A-Za-z0-9(]/.test(v)) out += ' ';
      out += v;
      i += found.length;
      hits++;
      if (v && /[A-Za-z0-9.,:)]$/.test(v) && s[i] && /[A-Za-z0-9ঀ-৿(]/.test(s[i])) out += ' ';
    } else { out += s[i]; i++; }
  }
  out = out.replace(/([০-৯0-9])\s?(টি|টা|জন)(?![ঀ-৥ৰ-৲৴-৿])/g, '$1')
    .replace(/([০-৯0-9])(হা|লা|কো|মি|ঘ|সে)(?![ঀ-৥ৰ-৲৴-৿])/g, (_, d: string, u: string) => d + UNITS[u]);
  if (!hits && out === s) return lead + digits(s) + trail;
  const before = lettersIn(s);
  if (hits && before >= 12 && lettersIn(out) > before * 0.45) return lead + digits(s) + trail;
  out = out.replace(/\s+([,.;:!?)])/g, '$1').replace(/\s{2,}/g, ' ');
  return lead + digits(out) + trail;
}

// Page titles: plural nouns, "&", no emoji in front (the template's way). The dictionary translates a word the same
// everywhere ("কাস্টমার" → "Customer" on a button too), so a title gets this extra step.
const TITLES: Record<string, string> = {
  'Order': 'Orders', 'Customer': 'Customers', 'Supplier': 'Suppliers', 'Category': 'Categories', 'Brand': 'Brands',
  'Banner': 'Banners', 'Page': 'Pages', 'Variant': 'Variants', 'Complaint': 'Complaints', 'Return': 'Returns',
  'Purchase': 'Purchases', 'Profit-loss': 'Profit & loss', 'Description cleaned': 'Description clean-up',
  'Reach the customer': 'Reach customers', 'Tell me when in stock': 'Back-in-stock alerts',
  'Income-expense entries': 'Income & expense entries', 'Bank and cash balances': 'Bank & cash balances',
  'VAT and tax': 'VAT & tax', 'Pixels and tracking': 'Pixels & tracking', 'Social media and live chat': 'Social media & live chat',
  'Logo, colours and home page': 'Logo, colours & home page', 'Header and footer menu': 'Header & footer menus',
  'Product feed (Google and Facebook)': 'Product feeds (Google & Facebook)', 'Live match score': 'Live match scores',
  'Product import': 'Import products', 'Packing cost': 'Packing costs', 'Inventory (stock)': 'Inventory',
  'Purchases (buying goods)': 'Purchases', 'New purchase (buying goods)': 'New purchase', 'Scan stock': 'Stock scan',
};
const EMOJI_LEAD = /^[\s\p{Extended_Pictographic}️‍\u{1F1E6}-\u{1F1FF}]+/u;
/** A page title in English, the template's way. */
export function titleEn(t: string): string {
  const core = norm(tr(String(t)).replace(EMOJI_LEAD, ''));
  return TITLES[core] || core;
}

// ------------------------------------------------------------------------------------------------ text pages (HTML)
const ATTR_RE = /(\s)(placeholder|title|aria-label|alt|data-confirm|data-confirm-btn|data-confirm-shop|data-on|data-off|data-tip|data-label|data-delcode-what|data-delcode-title|data-delcode-intro|data-delcode-go)="([^"]*)"/g;
const unesc = (s: string) => s.replace(/&quot;/g, '"').replace(/&#0?39;|&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (s: string) => esc(s).replace(/"/g, '&quot;');
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);

/** A page (or a piece of one) as HTML text → English with the dictionary. Code (script, style, textarea…) is never
 *  touched; data marked translate="no" (names, addresses) is left for the second step (`owner` words). */
export function adminEnglishHtml(html: string, owner?: Map<string, string>, collect?: Map<string, string>): string {
  if (!html || (!LETTER.test(html) && !HAS_DIGIT.test(html)) || !ready()) return html;
  const parts = html.split(/(<!--[\s\S]*?-->|<[^>]+>)/);
  type Mode = 'text' | 'data' | 'code';
  const stack: { tag: string; mode: Mode }[] = [];
  const mode = (): Mode => (stack.length ? stack[stack.length - 1].mode : 'text');
  let out = '';
  for (const p of parts) {
    if (!p) continue;
    if (p.startsWith('<!--')) { out += p; continue; }
    if (p[0] === '<') {
      const close = /^<\/\s*([a-zA-Z0-9-]+)/.exec(p);
      if (close) {
        const tag = close[1].toLowerCase();
        const at = stack.map((x) => x.tag).lastIndexOf(tag);
        if (at >= 0) stack.length = at;
        out += p;
        continue;
      }
      const open = /^<\s*([a-zA-Z0-9-]+)/.exec(p);
      if (!open) { out += p; continue; }
      const tag = open[1].toLowerCase();
      const outer = mode();
      const code = SKIP_TAGS.has(tag) || /\sdata-no-i18n|\scontenteditable/i.test(p);
      const data = /\stranslate="no"/i.test(p);
      const m: Mode = outer === 'code' || code ? 'code' : outer === 'data' || data ? 'data' : 'text';
      // the wording attributes (a textarea's own hint too), unless inside code or data
      let tagText = p;
      if (outer === 'text' && !data && (!code || tag === 'textarea')) {
        tagText = p.replace(ATTR_RE, (whole, sp: string, name: string, val: string) => {
          const en = tr(unesc(val));
          return en === unesc(val) ? whole : `${sp}${name}="${escAttr(en)}"`;
        });
        if (tag === 'input' && /\stype="(submit|button)"/i.test(p)) {
          tagText = tagText.replace(/(\svalue=")([^"]*)"/, (whole, a: string, v: string) => { const en = tr(unesc(v)); return en === unesc(v) ? whole : `${a}${escAttr(en)}"`; });
        }
      }
      out += tagText;
      if (!VOID.has(tag) && !/\/>$/.test(p)) stack.push({ tag, mode: m });
      continue;
    }
    const cur = mode();
    if (cur === 'code' || !LETTER.test(p) && !HAS_DIGIT.test(p)) { out += p; continue; }
    const orig = unesc(p);
    const mine = owner?.get(orig);
    if (mine !== undefined) { out += esc(mine); continue; }
    if (cur === 'data') { if (collect && LETTER.test(orig)) collect.set(orig, orig); out += p; continue; }
    const en = tr(orig);
    if (collect && LETTER.test(en)) collect.set(orig, orig);
    out += en === orig ? p : esc(en);
  }
  return out;
}

/** A whole page as text in English: the dictionary, then the owner's and customers' own words (names, addresses,
 *  product titles…) from the shop's English version. Never throws: on any trouble the page goes as it was. */
export async function adminEnglishPage(html: string, settings: Settings): Promise<string> {
  try {
    if (!ready() || !LETTER.test(html)) return adminEnglishHtml(html);
    const collect = new Map<string, string>();
    adminEnglishHtml(html, undefined, collect);
    const owner = collect.size ? await ownerWords([...collect.entries()], settings) : new Map<string, string>();
    return adminEnglishHtml(html, owner);
  } catch (e) {
    console.error('admin English (page):', (e as Error).message);
    return html;
  }
}

// ------------------------------------------------------------------------------------------------ React pages
type Props = Record<string, unknown> & { children?: ReactNode };
const isClass = (t: unknown) => typeof t === 'function' && !!(t as { prototype?: { isReactComponent?: unknown } }).prototype?.isReactComponent;

const flat = (x: unknown): unknown[] => (Array.isArray(x) ? x.flatMap((y: unknown) => flat(y)) : [x]);

/** The text of a plain sentence split by small inline pieces (<p>Turn <b>on</b> here</p>), or null. */
function plainText(children: ReactNode): string | null {
  let s = '';
  let hasEl = false;
  for (const c of flat(children)) {
    if (c === null || c === undefined || c === false || c === true) continue;
    if (typeof c === 'string' || typeof c === 'number') { s += String(c); continue; }
    if (!isValidElement(c) || typeof c.type !== 'string' || !INLINE_TAGS.has(c.type)) return null;
    const innerList = flat((c.props as Props).children);
    if (innerList.some((g) => g !== null && g !== undefined && typeof g !== 'string' && typeof g !== 'number' && typeof g !== 'boolean')) return null;
    hasEl = true;
    s += innerList.filter((g) => typeof g === 'string' || typeof g === 'number').join('');
  }
  return hasEl ? s : null;
}

// Bangla still left after the dictionary (the owner's own words: product and category names…), gathered for the
// second step — they are looked up in the shop's English version (the `translations` table).
let leftover: Map<string, string> | null = null; // what the page shows now → the original Bangla
const keep = (orig: string, en: string) => { if (leftover && LETTER.test(en)) leftover.set(en, orig); return en; };

function walk(node: ReactNode, depth: number, data = false): ReactNode {
  if (depth > 400) return node;
  if (typeof node === 'string') return data ? keep(node, node) : keep(node, tr(node));
  if (node === null || node === undefined || typeof node === 'boolean' || typeof node === 'number' || typeof node === 'bigint') return node;
  if (node instanceof Raw) return data ? node : new Raw(adminEnglishHtml(node.s)) as unknown as ReactNode;
  if (Array.isArray(node)) return node.map((x) => walk(x as ReactNode, depth + 1, data));
  if (!isValidElement(node)) return node;
  const el = node as ReactElement<Props>;
  const props = el.props || {};
  const type = el.type as unknown;

  // a component: draw it now (they are plain functions of their props) and translate what it drew
  if (typeof type === 'function' && !isClass(type)) {
    let drawn: unknown;
    try { drawn = (type as (p: Props) => unknown)(props); } catch { return node; }
    if (drawn && typeof (drawn as Promise<unknown>).then === 'function') return node; // an async one: left to the browser
    const out = walk(drawn as ReactNode, depth + 1, data);
    return el.key !== null && el.key !== undefined ? createElement(Fragment, { key: el.key }, out) : out;
  }
  if (typeof type !== 'string') {
    // Fragment and the like
    return 'children' in props ? cloneElement(el, undefined, ...childArgs(walk(props.children, depth + 1, data))) : node;
  }

  const tag = type.toLowerCase();
  // code (script, style, textarea…) is never touched; data (translate="no": names, addresses, notes) gets no
  // dictionary — its words are gathered for the second step (the shop's English version)
  const own = SKIP_TAGS.has(tag) || 'data-no-i18n' in props || !!props.contentEditable;
  if (!own && (data || props.translate === 'no')) {
    if (!('children' in props) || props.dangerouslySetInnerHTML) return node;
    return cloneElement(el, undefined, ...childArgs(walk(props.children, depth + 1, true)));
  }
  const next: Props = {};
  let changed = false;
  if (!own || tag === 'textarea') {
    for (const [k, v] of Object.entries(props)) {
      if (!ATTRS.has(k) && k !== 'aria-label' && k !== 'ariaLabel') continue;
      if (typeof v !== 'string') continue;
      const en = keep(v, tr(v));
      if (en !== v) { next[k] = en; changed = true; }
    }
    if (tag === 'input' && /^(submit|button)$/i.test(String(props.type || ''))) {
      for (const k of ['value', 'defaultValue']) {
        const v = props[k];
        if (typeof v === 'string') { const en = tr(v); if (en !== v) { next[k] = en; changed = true; } }
      }
    }
  }
  if (own) return changed ? cloneElement(el, next) : node;

  const html = (props.dangerouslySetInnerHTML as { __html?: unknown } | undefined)?.__html;
  if (typeof html === 'string') {
    const en = adminEnglishHtml(html);
    if (en !== html) { next.dangerouslySetInnerHTML = { __html: en }; changed = true; }
    return changed ? cloneElement(el, next) : node;
  }
  if (!('children' in props)) return changed ? cloneElement(el, next) : node;

  // a sentence split by bold pieces has its own whole English in the dictionary (word order!)
  if (BLOCK_TAGS.has(tag) && dict) {
    const text = plainText(props.children);
    if (text !== null && LETTER.test(text)) {
      const en = dict[norm(text)];
      if (en) return cloneElement(el, next, digits(en));
    }
  }
  let kids = walk(props.children, depth + 1);
  if (tag === 'h1') kids = titleKids(kids);
  return cloneElement(el, next, ...childArgs(kids));
}

/** The first words of a page title, the template's way ("🧑 Customer" → "Customers"). */
function titleKids(kids: ReactNode): ReactNode {
  const list = Array.isArray(kids) ? [...kids] : [kids];
  const i = list.findIndex((k) => typeof k === 'string' && norm(k));
  if (i < 0) return kids;
  const t = list[i] as string;
  list[i] = titleEn(t) + (/\s$/.test(t) ? ' ' : '');
  // an emoji alone in front of the title (its own piece) goes too
  for (let j = 0; j < i; j++) if (typeof list[j] === 'string' && !norm((list[j] as string).replace(EMOJI_LEAD, ''))) list[j] = '';
  return Array.isArray(kids) ? list : list[0];
}

/** children as cloneElement's arguments — an array stays one array (its keys are kept), a single child stays single. */
function childArgs(kids: ReactNode): ReactNode[] {
  return [kids];
}

// ------------------------------------------------------------------------------------------------ the owner's words
// "└ সেন্সর (12)" → lead "└ ", core "সেন্সর", trail " (12)"
const SPLIT = /^([^ঀ-৿A-Za-z]*)([\s\S]*?)(\s*\(\s*[0-9০-৯]+\s*\)\s*|\s*)$/;
type Lookup = (pairs: [string, string][]) => Promise<Map<string, string>>;

// Place names: Bangladesh's districts and areas (lib/data/bd-geo.json has both languages) and every country.
let names: Map<string, string> | null = null;
function placeNames(): Map<string, string> {
  if (names) return names;
  const m = new Map<string, string>();
  try {
    const geo = JSON.parse(readFileSync(join(process.cwd(), 'lib/data/bd-geo.json'), 'utf8')) as { districts?: { en: string; bn: string; division?: string; areas?: [string, string][] }[] };
    for (const d of geo.districts || []) {
      m.set(norm(d.bn), d.en);
      for (const [en, bn] of d.areas || []) if (bn && en) m.set(norm(bn), en);
    }
  } catch { /* the page goes without them */ }
  try {
    const bnN = new Intl.DisplayNames(['bn'], { type: 'region' });
    const enN = new Intl.DisplayNames(['en'], { type: 'region' });
    for (let a = 65; a <= 90; a++) for (let b = 65; b <= 90; b++) {
      const code = String.fromCharCode(a, b);
      let bn = '', en = '';
      try { bn = bnN.of(code) || ''; en = enN.of(code) || ''; } catch { continue; }
      if (bn && en && bn !== code && LETTER.test(bn)) m.set(norm(bn), en);
    }
  } catch { /* no region names in this Node */ }
  names = m;
  return m;
}

/** The owner's own words (product, category, brand names, the AI staff's notes…) in English: place names from the
 *  lists above, the rest from the shop's English version (the `translations` table — a text not translated yet is
 *  translated once and kept). Never slower than ~1 s: what isn't ready by then goes as it is and is ready next time. */
const working = new Set<string>(); // texts being translated in the background now
async function ownerWords(pairs: [string, string][], settings: Settings): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const places = placeNames();
  const cores = new Map<string, [string, string, string][]>(); // Bangla core → [shown text, lead, trail]
  for (const [shown, orig] of pairs) {
    // "বাগেরহাট (Bagerhat)" — the English is already there
    const both = /^([\s\S]*?)\s*\(([A-Za-z][A-Za-z .'&-]*)\)\s*$/.exec(orig);
    if (both && LETTER.test(both[1]) && !/[A-Za-z]/.test(both[1])) { out.set(shown, both[2]); continue; }
    const m = SPLIT.exec(orig);
    const lead = m ? m[1] : '', core = norm(m ? m[2] : orig), trail = m ? m[3] : '';
    if (!core || core.length > 3000 || !LETTER.test(core)) continue;
    const place = places.get(core);
    if (place) { out.set(shown, lead + place + digits(trail)); continue; }
    const list = cores.get(core) || [];
    list.push([shown, lead, trail]);
    cores.set(core, list);
  }
  if (!cores.size) return out;
  const translate = await import('../services/translate');
  // what is already kept: one database question for the whole page
  const found = await translate.lookup([...cores.keys()], settings, { auto: false }) as Record<string, unknown>;
  // the missing ones are translated in the background (a few at a time) — the page never waits for them; they
  // show in English from the next visit on
  const missing = [...cores.keys()].filter((c) => !found[c] && !working.has(c)).slice(0, 25);
  if (missing.length) {
    for (const c of missing) working.add(c);
    translate.lookup(missing, settings, { auto: true, deadline: Date.now() + 20000 })
      .catch(() => {}).finally(() => { for (const c of missing) working.delete(c); });
  }
  for (const [core, list] of cores) {
    const en = found[core];
    if (typeof en !== 'string' || !en) continue;
    for (const [shown, lead, trail] of list) out.set(shown, lead + en + digits(trail));
  }
  return out;
}

function swap(node: ReactNode, map: Map<string, string>, depth: number): ReactNode {
  if (depth > 400) return node;
  if (typeof node === 'string') return map.get(node) ?? node;
  if (Array.isArray(node)) return node.map((x) => swap(x as ReactNode, map, depth + 1));
  if (!isValidElement(node)) return node;
  const el = node as ReactElement<Props>;
  const props = el.props || {};
  if (typeof el.type !== 'string') return 'children' in props ? cloneElement(el, undefined, swap(props.children, map, depth + 1)) : node;
  const tag = el.type.toLowerCase();
  if (SKIP_TAGS.has(tag) || 'data-no-i18n' in props || props.dangerouslySetInnerHTML) return node;
  const next: Props = {};
  for (const [k, v] of Object.entries(props)) if (ATTRS.has(k) && typeof v === 'string' && map.has(v)) next[k] = map.get(v);
  return 'children' in props ? cloneElement(el, next, swap(props.children, map, depth + 1)) : Object.keys(next).length ? cloneElement(el, next) : node;
}

/** A whole admin page (React) in English: the admin's words from the dictionary, then the owner's own words
 *  (product / category names) from the shop's English version. Never throws: on any trouble the page goes as it is. */
export async function adminEnglish(node: ReactNode, settings?: Settings, lookup?: Lookup): Promise<ReactNode> {
  if (!ready()) return node;
  const t0 = performance.now();
  let out: ReactNode = node;
  let left: [string, string][] = [];
  try {
    leftover = new Map();
    out = walk(node, 0);
    left = [...leftover];
  } catch (e) {
    console.error('admin English:', (e as Error).message);
    return node;
  } finally { leftover = null; }
  if (left.length && (settings || lookup)) {
    try {
      const map = lookup ? await lookup(left) : await ownerWords(left, settings!);
      if (map.size) out = swap(out, map, 0);
    } catch (e) { console.error('admin English (owner words):', (e as Error).message); }
  }
  const ms = Math.round(performance.now() - t0);
  if (ms > 300) console.warn(`admin English: ${ms} ms`);
  // how long it took, for checking speed (an empty hidden tag)
  return createElement(Fragment, null, out, createElement('template', { 'data-en-ms': String(ms) }));
}
