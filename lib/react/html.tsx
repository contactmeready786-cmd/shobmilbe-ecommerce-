// ⚛️ Ready-made HTML inside React (no react-dom/server here, so Next.js server components can use it too).
import { cloneElement, createElement, Fragment, isValidElement, type ReactElement, type ReactNode } from 'react';
import { Raw } from '../util';

// ---------------------------------------------------------------- renderHtml: a React piece as HTML text
// The page pieces are React all the way. Only where HTML text is really needed — the whole pages lib/site.ts answers,
// print pages, the cards the shop's API sends as HTML — is a piece turned into text, by the renderer lib/react/render.tsx
// registers (Next.js pages never need it, and may not load react-dom/server).
type Renderer = (el: ReactElement) => string;
let renderer: Renderer | null = null;
/** lib/react/render.tsx registers react-dom/server's renderer here. */
export function setRenderer(fn: Renderer): void { renderer = fn; }

// A piece that is only words (in fragments): its HTML text, escaped as React would; null = it has real tags.
function plainText(node: unknown): string | null {
  if (node === null || node === undefined || node === false || node === true) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
  if (Array.isArray(node)) { let out = ''; for (const x of node) { const t = plainText(x); if (t === null) return null; out += t; } return out; }
  if (isValidElement(node) && node.type === Fragment) return plainText((node.props as { children?: unknown }).children);
  return null;
}

// "<span class=pill>…" — which piece was asked for as text (to find the code that did it)
function describe(el: ReactElement): string {
  const t = el.type as unknown;
  const props = (el.props || {}) as Record<string, unknown>;
  const name = typeof t === 'string' ? t : typeof t === 'function' ? (t as { name?: string }).name || 'component' : t === Fragment ? 'fragment' : 'element';
  const cls = typeof props.className === 'string' ? ` class=${props.className}` : '';
  const kids = props.children;
  const first = Array.isArray(kids) ? kids.find((k) => k && typeof k === 'object') : kids;
  return `<${name}${cls}>` + (first && isValidElement(first) && name === 'fragment' ? ' ' + describe(first) : '');
}

/** A page piece (React, ready-made HTML or text) as HTML text. Needs lib/react/render's renderer unless it is only words. */
export function renderHtml(node: unknown): string {
  if (node instanceof Raw) return node.s;
  const plain = plainText(node);
  if (plain !== null) return plain;
  const el = isValidElement(node) ? node : createElement(Fragment, null, node as ReactNode);
  if (!renderer) throw new Error(`renderHtml needs lib/react/render (not available in a Next.js page — keep the piece as React): ${describe(el)}`);
  return renderer(el);
}

// 🧪 Tests (SM_STRICT_PIECES=throw) and the parity check (=1): a React piece written into text by mistake — String(x),
// `${x}`, x + '' — would show "[object Object]" on the page. It is reported (SM_PIECE_AS_TEXT: the test fails, or the
// parity check finds it in the server's log) with the place. Never on in the live shop.
const STRICT = typeof process !== 'undefined' && process.env ? process.env.SM_STRICT_PIECES : undefined;
if (STRICT === '1' || STRICT === 'throw') {
  const plain = Object.prototype.toString;
  // eslint-disable-next-line no-extend-native -- test-only tripwire
  Object.prototype.toString = function (this: unknown) {
    if (this && typeof this === 'object' && isValidElement(this)) {
      const msg = 'SM_PIECE_AS_TEXT ' + describe(this) + ' ' + String(new Error().stack || '').split('\n').slice(2, 7).map((l) => l.trim()).join(' < ');
      if (STRICT === 'throw') throw new Error(msg); // the tests: fail right there
      console.error(msg);
    }
    return plain.call(this);
  };
}

// Inside renderHtml (lib/react/render.tsx) React leaves a marker and the HTML is spliced in after rendering, so the
// page is exactly as before. In a Next.js page there is nothing to splice into: a see-through wrapper holds it.
let slots: string[] | null = null;

/** Runs fn with a fresh list of HTML pieces (used by the renderer). */
export function withSlots<T>(fn: (mine: string[]) => T): T {
  const outer = slots;
  const mine: string[] = [];
  slots = mine;
  try { return fn(mine); } finally { slots = outer; }
}

const SVG_TAG = /^\s*<(?:line|text|path|rect|circle|ellipse|g|polyline|polygon|defs|stop|tspan|use|linearGradient|radialGradient|clipPath|mask|pattern|symbol|image)\b/;
const ENTITY: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' };
/** Text with no tags: what it says (entities read); null when it has a tag or an entity this doesn't know. */
function wordsOf(s: string): string | null {
  if (s.includes('<')) return null;
  let unknown = false;
  const out = s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (_, e: string) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    const v = ENTITY[e.toLowerCase()];
    if (v === undefined) unknown = true;
    return v ?? '';
  });
  return unknown || /&/.test(out.replace(/&(?![a-z#])/gi, '')) ? null : out;
}
const BLOCK_TAG = /<(?:div|p|ul|ol|li|dl|dt|dd|table|thead|tbody|tr|td|th|section|article|aside|nav|header|footer|main|form|fieldset|details|summary|h[1-6]|pre|blockquote|figure|hr|address|menu|option|select|textarea|svg|template|script|style)\b/i;

/** Puts ready-made HTML (a string the shop made itself, or a legacy Raw) into a React page, unescaped — only HTML the shop made, never visitor text. */
export function RawHtml({ html }: { html: unknown }): ReactNode {
  if (isValidElement(html)) return html;
  const s = html instanceof Raw ? html.s : html === null || html === undefined || html === false ? '' : String(html);
  if (!s) return null;
  if (!slots) {
    // only words (with &amp; and the like): plain React text, no wrapper at all
    const words = wordsOf(s);
    if (words !== null) return words;
    // Otherwise a see-through wrapper the browser keeps exactly where it is: <g> inside a picture (SVG), <div> for
    // blocks, <span> for small inline pieces (a <div> inside a <p> would make the browser close the <p> early, and
    // React would then find a different page than it drew).
    const Tag = SVG_TAG.test(s) ? 'g' : BLOCK_TAG.test(s) ? 'div' : 'span';
    return <Tag style={{ display: 'contents' }} data-unwrap="" dangerouslySetInnerHTML={{ __html: s }} />;
  }
  slots.push(s);
  return <template data-sm-raw={slots.length - 1} />;
}

/** Joins class names, skipping empty ones: cx('chip', on && 'on') → "chip on". */
export function cx(...names: unknown[]): string {
  return names.filter((n) => typeof n === 'string' && n).join(' ');
}

// ---------------------------------------------------------------- showing values whose type isn't known
// Many values come straight from the database or the settings (any type). These helpers show such a value the one
// safe way: as escaped text, unless it is the shop's own ready-made HTML (Raw) or a React piece.

/** A value of unknown type on the page: a React piece as it is, Raw as HTML, a list item by item, false/null/undefined as nothing, the rest as escaped text. */
export function Val({ v }: { v: unknown }): ReactNode {
  if (isValidElement(v)) return v; // a piece that is React already
  if (v instanceof Raw) return <RawHtml html={v} />;
  if (Array.isArray(v)) return createElement(Fragment, null, ...v.map((x) => (isValidElement(x) ? x : x instanceof Raw ? <RawHtml html={x} /> : x === null || x === undefined || x === false ? null : String(x))));
  if (v === false || v === null || v === undefined) return null;
  return String(v);
}

const unescape = (s: string) => s.replace(/&quot;/g, '"').replace(/&#0?39;|&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
/** A value of unknown type as an attribute's text (React escapes it, so the shop's ready-made HTML is unescaped first). */
export function attrValue(v: unknown): string {
  if (v instanceof Raw) return unescape(v.s);
  if (isValidElement(v)) return unescape(renderHtml(v));
  if (Array.isArray(v)) return v.map((x) => (x instanceof Raw ? unescape(x.s) : isValidElement(x) ? unescape(renderHtml(x)) : x === null || x === undefined ? '' : String(x))).join('');
  if (v === false || v === null || v === undefined) return '';
  return String(v);
}

/** A value of unknown type as HTML text (escaped unless it is ready-made HTML or a React piece): for text pages and <script> / <style>. */
export function htmlValue(v: unknown): string {
  const esc = (x: unknown) => String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  if (v instanceof Raw) return v.s;
  if (isValidElement(v)) return renderHtml(v);
  if (Array.isArray(v)) return v.map((x) => (x instanceof Raw ? x.s : isValidElement(x) ? renderHtml(x) : x === null || x === undefined ? '' : esc(x))).join('');
  if (v === false || v === null || v === undefined) return '';
  return esc(v);
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

/** A list of JSX pieces made by .map() (no "key" needed: they are passed as separate children). */
export function jsxList(items: unknown): ReactNode {
  if (!Array.isArray(items)) return items instanceof Raw ? <Val v={items} /> : (items as ReactNode);
  // ready-made HTML among them is shown as it is
  return createElement(Fragment, null, ...items.map((x) => (x instanceof Raw ? <Val v={x} /> : (x as ReactNode))));
}

/**
 * Puts extra right after the first <tag>…</tag> of a page piece (e.g. a switch under the page's <h1>), the way the old
 * text code did with indexOf('</h1>'). Works on React pieces (also inside Val / RawHtml) and on ready-made
 * HTML. found = false: there was no such tag (the piece comes back unchanged).
 */
export function insertAfterTag(node: unknown, tag: string, extra: ReactNode): { node: unknown; found: boolean } {
  if (node instanceof Raw) {
    const text = (node as Raw).s;
    const i = text.indexOf(`</${tag}>`);
    if (i < 0) return { node, found: false };
    const cut = i + tag.length + 3;
    return { node: <>{<RawHtml html={text.slice(0, cut)} />}{extra}{<RawHtml html={text.slice(cut)} />}</>, found: true };
  }
  if (Array.isArray(node)) {
    for (let k = 0; k < node.length; k++) {
      const item = node[k];
      if (isValidElement(item) && item.type === tag) return { node: [...node.slice(0, k + 1), extra, ...node.slice(k + 1)], found: true };
      const r = insertAfterTag(item, tag, extra);
      if (r.found) return { node: [...node.slice(0, k), r.node, ...node.slice(k + 1)], found: true };
    }
    return { node, found: false };
  }
  if (!isValidElement(node)) return { node, found: false };
  const props = (node.props || {}) as Record<string, unknown>;
  if (node.type === Val) {
    const r = insertAfterTag(props.v, tag, extra);
    return r.found ? { node: <Val v={r.node} />, found: true } : { node, found: false };
  }
  if (node.type === RawHtml) {
    const r = insertAfterTag(props.html instanceof Raw ? props.html : new Raw(String(props.html ?? '')), tag, extra);
    return r.found ? { node: r.node, found: true } : { node, found: false };
  }
  if (node.type === tag) return { node: <>{node}{extra}</>, found: true };
  if (props.children === undefined) return { node, found: false };
  const kids = Array.isArray(props.children) ? props.children : [props.children];
  const r = insertAfterTag(kids, tag, extra);
  return r.found ? { node: cloneElement(node, undefined, ...(r.node as ReactNode[])), found: true } : { node, found: false };
}
