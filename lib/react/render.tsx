// ⚛️ React for the shop's pages (owner, 2026-10-17: "move everything to React, step by step").
//
// How the move works: each page (or piece of a page) is rewritten as a React component in components/, and the old
// html`…` function becomes a one-line call to toHtml(<Component …/>). Everything around the page stays exactly as it
// is — the security gate, the country lock, admin login, caching, cookies, headers all still run in lib/app.ts — so a
// page can move without any risk to those. The components are plain server components (no hooks, no browser code),
// so once every page is React, the same components can be served by Next.js pages directly and lib/app.ts retires.
// The page's buttons keep working through the same public/js files as before.
//
// tools/parity compares every page's HTML before and after a move; tests/react-views.test.ts checks the moved pieces.
import { createElement, Fragment, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RawHtml, withSlots, cx } from './html';
export { RawHtml, cx };
import { raw, Raw } from '../util';

/** Renders a React element to the shop's HTML (a Raw, so it can sit inside the html`…` pages that haven't moved yet). */
export function toHtml(el: ReactElement): Raw {
  return withSlots((mine) => {
    // React 19 puts <link rel="preload" as="image"> hints for big pictures at the very start of its output. The shop
    // decides its own preloads (in the page head), so these are dropped — the page stays exactly as it was.
    const out = renderToStaticMarkup(el).replace(/^(?:<link rel="preload" as="image"[^>]*>)+/, '');
    return raw(out.replace(/<template data-sm-raw="(\d+)"><\/template>/g, (_, i: string) => mine[Number(i)] ?? ''));
  });
}


// ---------------------------------------------------------------- helpers for pages converted from html`…`
// tools/html2jsx turns html`…` templates into JSX. These helpers give the converted code exactly the same
// meaning the template had: a value inside html`…` was escaped text, unless it was ready-made HTML (Raw).

/** A value that used to sit inside html`…`: Raw stays HTML, a list is each item, false/null/undefined is nothing, the rest is escaped text. */
export function Val({ v }: { v: unknown }): ReactNode {
  if (v instanceof Raw) return <RawHtml html={v} />;
  if (Array.isArray(v)) return v.map((x, i) => (x instanceof Raw ? <RawHtml key={i} html={x} /> : x === null || x === undefined ? null : String(x)));
  if (v === false || v === null || v === undefined) return null;
  return String(v);
}

const unescape = (s: string) => s.replace(/&quot;/g, '"').replace(/&#0?39;|&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
/** The text a value gave inside an attribute of html`…` (before escaping — React escapes it, so ready-made HTML is unescaped first). */
export function attrValue(v: unknown): string {
  if (v instanceof Raw) return unescape(v.s);
  if (Array.isArray(v)) return v.map((x) => (x instanceof Raw ? unescape(x.s) : x === null || x === undefined ? '' : String(x))).join('');
  if (v === false || v === null || v === undefined) return '';
  return String(v);
}

/** The exact text html`…` would have put inside a <script> / <style> (escaped unless Raw). */
export function htmlValue(v: unknown): string {
  const esc = (x: unknown) => String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map((x) => (x instanceof Raw ? x.s : x === null || x === undefined ? '' : esc(x))).join('');
  if (v === false || v === null || v === undefined) return '';
  return esc(v);
}

const ATTR_NAMES: Record<string, string> = { class: 'className', for: 'htmlFor', readonly: 'readOnly', autofocus: 'autoFocus', novalidate: 'noValidate', tabindex: 'tabIndex', maxlength: 'maxLength' };
const BOOL_PROPS = new Set(['checked', 'selected', 'disabled', 'required', 'hidden', 'open', 'multiple', 'readOnly', 'autoFocus', 'noValidate', 'defer', 'async']);
/** Attributes written as text inside a tag, e.g. ${on ? raw('checked') : ''} or raw('aria-current="page"'), as JSX props. */
export function attrProps(v: unknown): Record<string, string | boolean> {
  const s = v instanceof Raw ? v.s : attrValue(v);
  const out: Record<string, string | boolean> = {};
  for (const m of s.matchAll(/([^\s=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) {
    const name = ATTR_NAMES[m[1].toLowerCase()] || m[1].toLowerCase();
    const val = m[2] ?? m[3] ?? m[4];
    // a true/false attribute (checked, selected …) is on whatever its value; React needs true for it
    out[name] = BOOL_PROPS.has(name) ? true : unescape(val ?? '');
  }
  return out;
}

/** style="a: b; c: d" text → the object React wants ({ a: 'b', c: 'd' }), keeping custom --properties. */
export function styleOf(text: unknown): Record<string, string> {
  const s = attrValue(text);
  const out: Record<string, string> = {};
  let depth = 0; let start = 0;
  const parts: string[] = [];
  for (let i = 0; i <= s.length; i++) {
    const ch = s[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    else if ((ch === ';' && depth === 0) || i === s.length) { parts.push(s.slice(start, i)); start = i + 1; }
  }
  for (const p of parts) {
    const i = p.indexOf(':');
    if (i < 0) continue;
    const prop = p.slice(0, i).trim();
    const val = p.slice(i + 1).trim();
    if (!prop) continue;
    const key = prop.startsWith('--') ? prop : prop.toLowerCase().replace(/^-ms-/, 'ms-').replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
    out[key] = val;
  }
  return out;
}

/** A list of JSX pieces made by .map() in converted code (no "key" needed: they are passed as separate children). */
export function jsxList(items: unknown): ReactNode {
  if (!Array.isArray(items)) return items as ReactNode;
  return createElement(Fragment, null, ...(items as ReactNode[]));
}
