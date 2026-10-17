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
import type { ReactElement, ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { raw, Raw } from '../util';

// Ready-made HTML (Markdown output, a legacy html`…` piece that hasn't moved yet, an icon) goes into a React page
// through <RawHtml html={…}/>: React leaves a marker, and toHtml swaps the marker for the HTML after rendering.
let slots: string[] | null = null;

/** Puts ready-made HTML (a string the shop made itself, or a legacy Raw) into a React page, unescaped. */
export function RawHtml({ html }: { html: unknown }): ReactNode {
  const s = html instanceof Raw ? html.s : html === null || html === undefined || html === false ? '' : String(html);
  if (!s) return null;
  if (!slots) throw new Error('RawHtml can only be used inside toHtml()');
  slots.push(s);
  return <template data-sm-raw={slots.length - 1} />;
}

/** Renders a React element to the shop's HTML (a Raw, so it can sit inside the html`…` pages that haven't moved yet). */
export function toHtml(el: ReactElement): Raw {
  const outer = slots;
  const mine: string[] = [];
  slots = mine;
  try {
    // React 19 puts <link rel="preload" as="image"> hints for big pictures at the very start of its output. The shop
    // decides its own preloads (in the page head), so these are dropped — the page stays exactly as it was.
    const out = renderToStaticMarkup(el).replace(/^(?:<link rel="preload" as="image"[^>]*>)+/, '');
    return raw(out.replace(/<template data-sm-raw="(\d+)"><\/template>/g, (_, i: string) => mine[Number(i)] ?? ''));
  } finally {
    slots = outer;
  }
}

/** Joins class names, skipping empty ones: cx('chip', on && 'on') → "chip on". */
export function cx(...names: unknown[]): string {
  return names.filter((n) => typeof n === 'string' && n).join(' ');
}
