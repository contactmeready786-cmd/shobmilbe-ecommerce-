// JSX for the browser code: <div className="x">{text}</div> makes real DOM nodes.
// Text is always put in as text (never as HTML), so names, notes and prices can never break the page.
// Used instead of hand-built HTML strings; the server side of the shop draws its pages with React.

type Child = Node | string | number | boolean | null | undefined | Child[];
type Props = Record<string, unknown> & { children?: Child };

declare global {
  namespace JSX {
    type Element = HTMLElement;
    interface IntrinsicElements { [tag: string]: Record<string, unknown> }
    interface ElementChildrenAttribute { children: unknown }
  }
}

const ALIAS: Record<string, string> = { className: 'class', htmlFor: 'for' };
const SVG = new Set(['svg', 'path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'g']);

function append(parent: Node, c: Child): void {
  if (c == null || c === false || c === true) return;
  if (Array.isArray(c)) { for (const x of c) append(parent, x); return; }
  parent.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
}

export function h(tag: string | ((p: Props) => Node), props: Props | null, ...children: Child[]): HTMLElement {
  if (typeof tag === 'function') return tag({ ...(props || {}), children }) as HTMLElement;
  const el = SVG.has(tag) ? document.createElementNS('http://www.w3.org/2000/svg', tag) as unknown as HTMLElement : document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false || k === 'children') continue;
    if (k.startsWith('on') && typeof v === 'function') { el.addEventListener(k.slice(2).toLowerCase(), v as EventListener); continue; }
    if (k === 'style' && typeof v === 'object') { Object.assign(el.style, v); continue; }
    el.setAttribute(ALIAS[k] || k, v === true ? '' : String(v));
  }
  append(el, children);
  return el;
}

export function Fragment(props: { children?: Child }): DocumentFragment {
  const f = document.createDocumentFragment();
  append(f, props.children);
  return f as unknown as DocumentFragment;
}

/** Replaces what's inside `el` with the given nodes / text. */
export function paint(el: Element | null | undefined, ...nodes: Child[]): void {
  if (!el) return;
  const f = document.createDocumentFragment();
  append(f, nodes);
  el.replaceChildren(f);
}

/** Product cards and other ready-made markup the shop's own API sends (drawn on the server by React). */
export function serverHtml(el: Element | null | undefined, html: string): void {
  if (!el) return;
  const t = document.createElement('template');
  t.innerHTML = html;
  el.replaceChildren(t.content);
}
