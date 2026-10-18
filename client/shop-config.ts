// What the shop page hands to its browser code as window.SM (written by components/shop/chrome/Chrome.tsx, read by
// client/shop/* and client/i18n). One type for both sides, so a field can't be renamed on one side only.

/** A product line in a tracked event. */
export type TrackItem = { id: string | number; name?: string; price: number; qty?: number; category?: string };

/** The event the page itself reports when it opens (product view, checkout start, order placed, search). */
export type PageTrack =
  | { event: 'view_item'; id: number; name: string; price: number; category: string }
  | { event: 'begin_checkout' }
  | { event: 'purchase'; code: string; value: number; items: TrackItem[] }
  | { event: 'search'; q: string };

export type ShopConfig = {
  /** most of one product per order */
  maxQty: number;
  phone: string;
  /** WhatsApp number (digits) */
  wa: string;
  /** the small-quantity rule: cheap items only in small numbers */
  rule: { on: boolean; cap: number; maxVal: number };
  /** the smallest order (goods total), ৳ */
  minOrder: number;
  fb: boolean; tt: boolean; ga: boolean; g4: boolean;
  /** stop copying text / product titles */
  protect: boolean; copyTitle: boolean;
  track: PageTrack | null;
  /** the shop's own visitor analytics */
  va: boolean;
  i18n: { rev: string; def: 'bn' | 'en' } | null;
  /** offer notifications */
  push: { key: string; ask: boolean; delay: number; text: string } | null;
};
