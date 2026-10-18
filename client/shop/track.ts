// Tracking: one call sends to dataLayer (GTM/GA4), Facebook and TikTok, plus the shop's own visitor analytics
// (Admin → মার্কেটিং → ভিজিটর অ্যানালিটিক্স).
import { randomId, store } from '../dom.js';
import type { ShopConfig } from '../shop-config.js';

const SM: Partial<ShopConfig> = window.SM || {};

type Item = { id: string | number; name?: string; price: number; qty?: number; category?: string };
type TrackData = { items?: Item[]; value?: number; code?: string; q?: string; label?: string; method?: string };
type GaItem = { item_id: string; item_name?: string; price: number; quantity: number; item_category?: string };

const FB: Record<string, string> = { view_item: 'ViewContent', add_to_cart: 'AddToCart', begin_checkout: 'InitiateCheckout', purchase: 'Purchase', search: 'Search', contact: 'Contact', add_to_wishlist: 'AddToWishlist' };
const TT: Record<string, string> = { ...FB, purchase: 'CompletePayment' };

export const VA = {
  on: !!SM.va,
  vid: '' as string,
  sid: '' as string,
  pv: 0,
  active: 0,
  since: 0,
  scroll: 0,
  beats: 0,
};

export function track(event: string, d: TrackData = {}): void {
  window.dataLayer = window.dataLayer || [];
  const items: GaItem[] = (d.items || []).map((i) => ({ item_id: String(i.id), item_name: i.name, price: i.price, quantity: i.qty || 1, item_category: i.category || undefined }));
  const value = d.value ?? items.reduce((s, i) => s + i.price * i.quantity, 0);
  try {
    window.dataLayer.push({ ecommerce: null });
    window.dataLayer.push({ event, ecommerce: { currency: 'BDT', value, items, transaction_id: d.code || undefined }, search_term: d.q || undefined });
  } catch { /* ignore */ }
  // GA4 added directly (Measurement ID, not through GTM) only listens to gtag() calls — send the same event there too
  try {
    if (SM.g4 && typeof window.gtag === 'function') window.gtag('event', event, { currency: 'BDT', value, items, transaction_id: d.code || undefined, search_term: d.q || undefined });
  } catch { /* ignore */ }
  const ids = items.map((i) => i.item_id);
  try {
    if (window.fbq && FB[event]) {
      const fd = event === 'search' ? { search_string: d.q }
        : { currency: 'BDT', value, content_ids: ids, content_type: 'product', contents: items.map((i) => ({ id: i.item_id, quantity: i.quantity })) };
      window.fbq('track', FB[event], fd, d.code ? { eventID: d.code } : undefined);
    }
  } catch { /* ignore */ }
  try {
    if (window.ttq && TT[event]) {
      const td = event === 'search' ? { query: d.q }
        : { currency: 'BDT', value, content_type: 'product', contents: items.map((i) => ({ content_id: i.item_id, content_name: i.item_name, quantity: i.quantity, price: i.price })) };
      window.ttq.track(TT[event], td, d.code ? { event_id: d.code } : undefined);
    }
  } catch { /* ignore */ }
  visitEvent(event, d, items, value);
}

// ---------- visitor analytics ----------
/** POST /api/v answers: off = the shop has visitor analytics switched off; pv = this page view's number */
type VisitAnswer = { off?: boolean | number; pv?: number };
/** Chrome's navigator.userAgentData (not in every browser, nor in TypeScript's own list yet) */
type UAData = { mobile?: boolean; platform?: string; getHighEntropyValues?: (hints: string[]) => Promise<{ model?: string; platformVersion?: string; platform?: string }> };
async function vaSend(data: Record<string, unknown>, beacon = false): Promise<VisitAnswer> {
  if (!VA.on) return {};
  const body = JSON.stringify({ ...data, vid: VA.vid, sid: VA.sid });
  try {
    if (beacon && navigator.sendBeacon?.('/api/v', new Blob([body], { type: 'text/plain' }))) return {};
    const r = await fetch('/api/v', { method: 'POST', body, keepalive: true, credentials: 'same-origin', headers: { 'Content-Type': 'text/plain' } });
    return await r.json();
  } catch { return {}; }
}
const vaTz = (): string => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { return ''; } };
const vaTouch = (): void => { store('sm_sess', JSON.stringify({ id: VA.sid, t: Date.now() })); };
const vaActive = (): number => Math.round((VA.active + (VA.since ? Date.now() - VA.since : 0)) / 1000);
function vaFlush(kind: 'end' | 'hb'): void {
  if (!VA.pv) return;
  void vaSend({ t: kind, pv: VA.pv, d: vaActive(), s: VA.scroll }, kind === 'end');
  vaTouch();
}

function visitEvent(event: string, d: TrackData, items: GaItem[], value: number): void {
  if (!VA.on || !VA.sid) return;
  let label = '';
  let ref = '';
  if (event === 'add_to_cart' && items[0]) { label = items[0].item_name || ''; ref = items[0].item_id; }
  else if (event === 'begin_checkout') label = `${items.length} items`;
  else if (event === 'purchase') { label = d.code || ''; ref = d.code || ''; }
  else if (event === 'search') label = d.q || '';
  else if (event === 'contact') label = d.label || '';
  else return;
  void vaSend({ t: 'ev', e: event, lb: label, ref, v: Math.round(value || 0), p: location.pathname + location.search });
}

const ID = /^[a-f0-9]{20}$/;

export function startTracking(): void {
  if (VA.on) startAnalytics();
  const t = SM.track;
  if (!t) return;
  if (t.event === 'view_item') track('view_item', { items: [{ id: t.id, name: t.name, price: t.price, qty: 1, category: t.category }] });
  else if (t.event === 'purchase') {
    // Count each order once, even if the page is refreshed.
    if (!store(`sm_done_${t.code}`)) { store(`sm_done_${t.code}`, '1'); track('purchase', { code: t.code, value: t.value, items: t.items }); }
  } else if (t.event === 'search') track('search', { q: t.q });
}

function startAnalytics(): void {
  VA.vid = store('sm_vid') || '';
  if (!ID.test(VA.vid)) { VA.vid = randomId(); store('sm_vid', VA.vid); }
  let sess: { id?: string; t?: number } | null = null;
  try { sess = JSON.parse(localStorage.getItem('sm_sess') || 'null'); } catch { sess = null; }
  // A visit (session) ends after 30 minutes without activity, or when an ad link brings the visitor back.
  const fromAd = /[?&](utm_source|fbclid|gclid|ttclid)=/.test(location.search);
  VA.sid = sess && ID.test(sess.id || '') && Date.now() - (sess.t || 0) < 30 * 60 * 1000 && !fromAd ? sess.id! : randomId();
  vaTouch();
  if (document.visibilityState !== 'hidden') VA.since = Date.now();
  void vaSend({
    t: 'pv', p: location.pathname + location.search, u: location.href, ti: document.title, r: document.referrer || '',
    w: window.screen ? `${screen.width}x${screen.height}` : '', l: (navigator.language || '').slice(0, 12),
    tz: vaTz(), dpr: Math.round((window.devicePixelRatio || 1) * 100) / 100,
  }).then((j) => {
    if (j?.off) { VA.on = false; return; }
    VA.pv = j?.pv || 0;
    // New Chrome on Android hides the phone model; it tells it only when asked (no permission needed).
    const uad = (navigator as Navigator & { userAgentData?: UAData }).userAgentData;
    let sent: string | null = VA.sid;
    try { sent = sessionStorage.getItem('sm_dev'); } catch { /* ignore */ }
    if (VA.pv && sent !== VA.sid && uad?.mobile && uad.getHighEntropyValues) {
      uad.getHighEntropyValues(['model', 'platformVersion']).then((hv) => {
        try { sessionStorage.setItem('sm_dev', VA.sid); } catch { /* ignore */ }
        if (hv && (hv.model || hv.platformVersion)) void vaSend({ t: 'dev', m: hv.model || '', pv: hv.platformVersion || '', pf: hv.platform || uad.platform || '' });
      }).catch(() => {});
    }
  });
  window.addEventListener('scroll', () => {
    const hgt = document.documentElement.scrollHeight - window.innerHeight;
    const pct = hgt > 0 ? Math.round((100 * window.scrollY) / hgt) : 100;
    if (pct > VA.scroll) VA.scroll = Math.min(100, pct);
  }, { passive: true });
  const pause = () => { if (VA.since) { VA.active += Date.now() - VA.since; VA.since = 0; } vaFlush('end'); };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') pause();
    else if (!VA.since) { VA.since = Date.now(); vaTouch(); }
  });
  window.addEventListener('pagehide', pause);
  // While the page is open and visible, tell the server every 30 seconds (keeps "live now" correct).
  setInterval(() => {
    if (document.visibilityState === 'visible' && VA.pv && VA.beats < 60) { VA.beats++; vaFlush('hb'); }
  }, 30000);
  document.addEventListener('click', (e) => {
    const a = (e.target as Element | null)?.closest?.('a[href]');
    if (!a) return;
    const href = a.getAttribute('href') || '';
    const kind = /^tel:/.test(href) ? 'ফোন কল' : /wa\.me|whatsapp/i.test(href) ? 'WhatsApp' : /m\.me|messenger/i.test(href) ? 'Messenger' : '';
    if (kind) visitEvent('contact', { label: kind }, [], 0);
  });
}
