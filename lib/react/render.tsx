// ⚛️ Turning React pieces into HTML text, where text is really needed: the whole pages lib/site.ts answers (forms, the
// shop's 404, the admin's print pages), the product cards the shop's API sends as HTML, and tests. Every page piece is
// React (lib/views, lib/admin, components/); Next.js pages draw them directly and never load this.
//
// tools/parity compares every page's HTML with the live site; tests/react-views.test.ts checks the pieces.
import type { ReactElement } from 'react';
import { withSlots, setRenderer } from './html';
// the React helpers live in ./html (usable in Next.js pages); they are re-exported here for the original router's pages
export { RawHtml, cx, Val, attrValue, htmlValue, attrProps, styleOf, jsxList, renderHtml } from './html';

// The original router's pages are text: this loads react-dom/server and registers it as the renderer that turns a
// React piece into HTML (renderHtml in ./html). It is loaded when first needed (lib/site.ts's bridge awaits it before a
// request; tests in their before() hook): Next.js refuses react-dom/server in an App-Router route when it is imported
// up front, and allows it loaded this way.
// React 19 puts <link rel="preload" as="image"> hints for big pictures at the very start of its output. The shop
// decides its own preloads (in the page head), so these are dropped — the page stays exactly as it was.
let loading: Promise<void> | null = null;
export function loadRenderer(): Promise<void> {
  loading ??= import('react-dom/server').then(({ renderToStaticMarkup }) => setRenderer((el: ReactElement) => withSlots((mine) => {
    const out = renderToStaticMarkup(el).replace(/^(?:<link rel="preload" as="image"[^>]*>)+/, '');
    return out.replace(/<template data-sm-raw="(\d+)"><\/template>/g, (_, i: string) => mine[Number(i)] ?? '');
  })));
  return loading;
}
