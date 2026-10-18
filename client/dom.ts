// Small helpers shared by the shop's and the admin's browser code.

import type { ShopConfig } from './shop-config.js';

declare global {
  interface Window {
    SM?: ShopConfig;
    BD_GEO?: { districts: { en: string; bn: string; division?: string; areas: [string, string][] }[] };
    dataLayer?: unknown[];
    gtag?: (...a: unknown[]) => void;
    fbq?: (...a: unknown[]) => void;
    ttq?: { track: (...a: unknown[]) => void };
    __next_f?: unknown;
    __smHydrated?: boolean;
    __smAdminReady?: boolean;
    smWhenReady?: (fn: () => void) => void;
  }
}

export const $ = <T extends Element = HTMLElement>(sel: string, root: ParentNode | null = document): T | null =>
  (root || document).querySelector<T>(sel as string) as T | null;
export const $all = <T extends Element = HTMLElement>(sel: string, root: ParentNode | null = document): T[] =>
  Array.from((root || document).querySelectorAll<T>(sel as string)) as T[];

/** The closest element matching `sel` from an event's target. */
export const hit = <T extends Element = HTMLElement>(e: Event, sel: string): T | null => {
  const t = e.target as Element | null;
  return t && t.closest ? (t.closest(sel) as T | null) : null;
};

export function store(k: string): string | null;
export function store(k: string, v: string): null;
export function store(k: string, v?: string): string | null {
  try {
    if (v === undefined) return localStorage.getItem(k);
    localStorage.setItem(k, v);
  } catch { /* private window / storage blocked */ }
  return null;
}
export const readJson = <T>(k: string, fallback: T): T => {
  try { return (JSON.parse(store(k) || 'null') as T) ?? fallback; } catch { return fallback; }
};

const BN = '০১২৩৪৫৬৭৮৯';
export const bn = (n: unknown): string => String(n).replace(/\d/g, (d) => BN[Number(d)]);
/** Bangla digits → 0-9 */
export const latin = (s: unknown): string => String(s ?? '').replace(/[০-৯]/g, (c) => String(BN.indexOf(c)));

export function money(n: unknown): string {
  const v = Math.round(Number(n || 0) * 100) / 100;
  const a = Math.abs(v);
  const t = Math.abs(a - Math.round(a)) < 0.005
    ? Math.round(a).toLocaleString('en-IN')
    : a.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${v < 0 ? '-' : ''}৳${bn(t)}`;
}

/** Bangladeshi mobile number as 01XXXXXXXXX */
export const cleanPhone = (v: unknown): string =>
  latin(v).replace(/\D/g, '').replace(/^880?(?=1)/, '0').replace(/^88(?=01)/, '');
export const phoneOk = (p: string): boolean => /^01[3-9]\d{8}$/.test(p);

export const sleep = (ms: number) => new Promise<void>((ok) => setTimeout(ok, ms));

/** POST JSON, answer as JSON (with the HTTP status) — never throws on a bad JSON body. */
export async function postJson<T = unknown>(url: string, body: unknown, init: RequestInit = {}): Promise<{ ok: boolean; j: T }> {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body), credentials: 'same-origin', ...init });
  const j = (await r.json().catch(() => ({}))) as T;
  return { ok: r.ok, j };
}
export async function getJson<T = unknown>(url: string): Promise<T> {
  const r = await fetch(url, { headers: { Accept: 'application/json' }, credentials: 'same-origin' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return (await r.json()) as T;
}

export function randomId(): string {
  const u = new Uint8Array(10);
  crypto.getRandomValues(u);
  return Array.from(u, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Copies text; when the browser refuses, shows it to copy by hand. */
export async function copyText(text: string, ask: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { prompt(ask, text); return false; }
}

/** Restarts a CSS animation class (shake, bump). */
export function replay(el: HTMLElement, cls: string): void {
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}

/** A photo made small in the browser (longest side 1280px, JPEG) — for review and return photos. */
export function shrinkPhoto(file: File): Promise<string | null> {
  return new Promise((ok) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, 1280 / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k);
      c.height = Math.round(img.height * k);
      c.getContext('2d')?.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      ok(c.toDataURL('image/jpeg', 0.8));
    };
    img.onerror = () => { URL.revokeObjectURL(url); ok(null); };
    img.src = url;
  });
}

/**
 * Runs `fn` once React has finished taking over a Next.js page (components/Hydrated.tsx), so React never finds
 * something this code already changed. Pages drawn as text by lib/site.ts have no React: `fn` runs at once.
 */
export function whenReady(fn: () => void): void {
  const w = window;
  if (!w.smWhenReady) {
    w.smWhenReady = (f) => {
      if (!w.__next_f || w.__smHydrated) { f(); return; }
      let done = false;
      const go = () => { if (!done) { done = true; f(); } };
      w.addEventListener('sm:hydrated', go, { once: true });
      setTimeout(go, 8000); // React never took over (a script error): run anyway rather than leave the page dead
    };
  }
  w.smWhenReady(fn);
}

/** Bangladesh districts and thanas — loaded only on pages with an address form. */
export async function loadGeo(): Promise<NonNullable<Window['BD_GEO']>> {
  if (!window.BD_GEO) {
    window.BD_GEO = (await import('./geo-data.js')).BD_GEO;
    document.dispatchEvent(new Event('sm:geo')); // the English switch can now translate district / thana names
  }
  return window.BD_GEO!;
}
