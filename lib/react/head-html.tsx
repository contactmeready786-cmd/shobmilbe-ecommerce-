// ⚛️ HTML the owner pasted for the page head (Admin → পিক্সেল ও ট্র্যাকিং: "কাস্টম হেড কোড", "যেকোনো স্ক্রিপ্ট বসান")
// as React elements, so it can sit inside the Next.js <head> exactly as typed: <script> (inline or src), <meta>,
// <link>, <style>, <noscript>. Comments are dropped; anything else is left out of the head (a browser would move it
// to the body anyway).
import { createElement, Fragment, type ReactNode } from 'react';

const RENAME: Record<string, string> = { class: 'className', for: 'htmlFor', crossorigin: 'crossOrigin', referrerpolicy: 'referrerPolicy', 'http-equiv': 'httpEquiv', charset: 'charSet', nomodule: 'noModule', fetchpriority: 'fetchPriority' };
const BOOL = new Set(['async', 'defer', 'noModule']);

function props(attrs: string): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (const m of attrs.matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) {
    const name = RENAME[m[1].toLowerCase()] || m[1].toLowerCase();
    if (/^on/.test(name)) continue; // inline handlers never run in this shop (Content-Security rules)
    const v = m[2] ?? m[3] ?? m[4];
    out[name] = BOOL.has(name) ? true : (v ?? '').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  }
  return out;
}

/** Parses head HTML into React elements. */
export function headElements(html: string): ReactNode[] {
  const out: ReactNode[] = [];
  const src = String(html || '').replace(/<!--[\s\S]*?-->/g, '');
  const re = /<(script|style|noscript)\b([^>]*)>([\s\S]*?)<\/\1\s*>|<(meta|link|base)\b([^>]*?)\/?>/gi;
  let k = 0;
  for (const m of src.matchAll(re)) {
    if (m[1]) {
      const tag = m[1].toLowerCase();
      const p = props(m[2]);
      const inner = m[3];
      out.push(createElement(tag, { key: k++, ...p, ...(inner.trim() ? { dangerouslySetInnerHTML: { __html: inner } } : {}) }));
    } else {
      out.push(createElement(m[4].toLowerCase(), { key: k++, ...props(m[5]) }));
    }
  }
  return out;
}

export function HeadHtml({ html }: { html: string }) {
  return createElement(Fragment, null, ...headElements(html));
}

/** Ready-made HTML inside the page body (chat widgets, the owner's body code): the browser runs its scripts as the page loads. */
export function BodyHtml({ html }: { html: string }) {
  if (!html) return null;
  return createElement('div', { style: { display: 'contents' }, 'data-unwrap': '', dangerouslySetInnerHTML: { __html: html } });
}
