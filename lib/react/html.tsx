// ⚛️ Ready-made HTML inside React (no react-dom/server here, so Next.js server components can use it too).
import type { ReactNode } from 'react';
import { Raw } from '../util';

// Inside toHtml() (lib/react/render.tsx) React leaves a marker and the HTML is spliced in after rendering, so the
// page is exactly as before. In a Next.js page there is nothing to splice into: a see-through wrapper holds it.
let slots: string[] | null = null;

/** Runs fn with a fresh list of HTML pieces (used by toHtml). */
export function withSlots<T>(fn: (mine: string[]) => T): T {
  const outer = slots;
  const mine: string[] = [];
  slots = mine;
  try { return fn(mine); } finally { slots = outer; }
}

/** Puts ready-made HTML (a string the shop made itself, or a legacy Raw) into a React page, unescaped — only HTML the shop made, never visitor text. */
export function RawHtml({ html }: { html: unknown }): ReactNode {
  const s = html instanceof Raw ? html.s : html === null || html === undefined || html === false ? '' : String(html);
  if (!s) return null;
  if (!slots) return <div style={{ display: 'contents' }} data-unwrap="" dangerouslySetInnerHTML={{ __html: s }} />;
  slots.push(s);
  return <template data-sm-raw={slots.length - 1} />;
}

/** Joins class names, skipping empty ones: cx('chip', on && 'on') → "chip on". */
export function cx(...names: unknown[]): string {
  return names.filter((n) => typeof n === 'string' && n).join(' ');
}
