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
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { withSlots } from './html';
import { raw, Raw } from '../util';
// the React helpers live in ./html (usable in Next.js pages); they are re-exported here for the original router's pages
export { RawHtml, cx, Val, attrValue, htmlValue, attrProps, styleOf, jsxList } from './html';

/** Renders a React element to the shop's HTML (a Raw, so it can sit inside the html`…` pages that haven't moved yet). */
export function toHtml(el: ReactElement | Raw): Raw {
  if (el instanceof Raw) return el;
  return withSlots((mine) => {
    // React 19 puts <link rel="preload" as="image"> hints for big pictures at the very start of its output. The shop
    // decides its own preloads (in the page head), so these are dropped — the page stays exactly as it was.
    const out = renderToStaticMarkup(el).replace(/^(?:<link rel="preload" as="image"[^>]*>)+/, '');
    return raw(out.replace(/<template data-sm-raw="(\d+)"><\/template>/g, (_, i: string) => mine[Number(i)] ?? ''));
  });
}


