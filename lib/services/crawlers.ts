// Is this visitor really the crawler it says it is?
//
// The country block (services/geolock.ts) must let search engines and link-preview bots in — they visit from the
// USA/Europe. But a user agent is just text: anyone abroad can call themselves "Googlebot". So:
//
//  • Search engines that publish a way to check (Google, Bing, Apple, Yandex) are checked the way they ask:
//    the visitor's IP must reverse-resolve to the engine's own domain, and that name must resolve back to the
//    same IP. A fake gets no exception and is treated like any other visitor from its country.
//  • Link-preview bots (Facebook/WhatsApp, Telegram, X, LinkedIn, Pinterest, Slack, Discord, TikTok…) and a few
//    others publish no such check. They only ever need to read public pages, so a visitor with such a user agent
//    may READ the shop's public pages (GET/HEAD) — never the cart, checkout, account, order or API addresses,
//    and never send anything. A fake one can at most look at the same pages Google shows anyway.
//
// Answers are remembered for 6 hours per IP, so a crawler costs one DNS check, not one per page.
import * as dns from 'node:dns/promises';

export type CrawlerVerdict = 'verified' | 'preview' | 'fake' | 'none';

type Family = { name: string; ua: RegExp; domains: string[] };

// Domains as documented by each search engine for verifying its crawlers.
const VERIFIABLE: Family[] = [
  {
    name: 'Google',
    ua: /googlebot|google-inspectiontool|googleother|storebot-google|adsbot-google|mediapartners-google|apis-google|feedfetcher-google|google-read-aloud|duplexweb-google|google-site-verification|googleimageproxy|google-pagerenderer/i,
    domains: ['googlebot.com', 'google.com', 'gae.googleusercontent.com'],
  },
  { name: 'Bing', ua: /bingbot|bingpreview|msnbot|adidxbot/i, domains: ['search.msn.com'] },
  { name: 'Apple', ua: /applebot/i, domains: ['applebot.apple.com'] },
  { name: 'Yandex', ua: /yandex(bot|images)/i, domains: ['yandex.ru', 'yandex.net', 'yandex.com'] },
];

// No published DNS check: read-only access to public pages.
const PREVIEW = /chrome-lighthouse|duckduckbot|facebookexternalhit|facebookcatalog|facebot|meta-externalagent|meta-externalfetcher|twitterbot|linkedinbot|pinterestbot|slackbot|telegrambot|whatsapp|discordbot|skypeuripreview|tiktokbot|bytespider-ads/i;

// Addresses a preview bot never needs: anything personal, anything that changes data.
const PRIVATE_PATHS = /^\/(api\/|cart$|checkout|account|wishlist$|compare$|track$|order\/|complaint|gift-card$|unsubscribe$|__region\/pass$)/;

export function familyOf(ua: string): Family | null {
  return VERIFIABLE.find((f) => f.ua.test(ua)) || null;
}
export function isPreviewBot(ua: string): boolean {
  return !familyOf(ua) && PREVIEW.test(ua);
}
/** Would a crawler of this kind ever need this request? (Preview bots only read public pages.) */
export function previewMayOpen(method: string, path: string): boolean {
  return (method === 'GET' || method === 'HEAD') && !PRIVATE_PATHS.test(path);
}

const endsWithDomain = (host: string, domain: string) => {
  const h = host.toLowerCase().replace(/\.$/, '');
  return h === domain || h.endsWith('.' + domain);
};

// ---- DNS, swappable in tests ----
export type Resolver = { reverse: (ip: string) => Promise<string[]>; lookup: (host: string) => Promise<string[]> };
const realResolver: Resolver = {
  reverse: (ip) => dns.reverse(ip),
  lookup: async (host) => (await dns.lookup(host, { all: true, verbatim: true })).map((a) => a.address),
};
let resolver: Resolver = realResolver;
export function setResolver(r: Resolver | null) { resolver = r || realResolver; cache.clear(); }

const TTL = 6 * 3600e3;
const MAX = 5000;
const cache = new Map<string, { ok: boolean; at: number }>();

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('dns timeout')), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e: unknown) => { clearTimeout(t); reject(e); });
  });
}
const sameIp = (a: string, b: string) => a.toLowerCase().replace(/^::ffff:/, '') === b.toLowerCase().replace(/^::ffff:/, '');

/** Reverse DNS → one of the family's domains → forward DNS back to the same IP. */
export async function ipBelongsTo(ip: string, family: Family): Promise<boolean> {
  if (!ip) return false;
  const key = family.name + '|' + ip;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.ok;
  let ok = false;
  try {
    const names = await withTimeout(resolver.reverse(ip.replace(/^::ffff:/, '')), 2000);
    for (const name of names.filter((n) => family.domains.some((d) => endsWithDomain(n, d))).slice(0, 3)) {
      const addrs = await withTimeout(resolver.lookup(name), 2000);
      if (addrs.some((a) => sameIp(a, ip))) { ok = true; break; }
    }
  } catch (_) { ok = false; }
  if (cache.size >= MAX) cache.delete(cache.keys().next().value as string);
  cache.set(key, { ok, at: Date.now() });
  return ok;
}

/**
 * 'verified' — a real search-engine crawler (checked by DNS)
 * 'preview'  — claims to be a link-preview bot (can't be checked; read-only public pages)
 * 'fake'     — claims to be a search engine but its IP isn't theirs
 * 'none'     — not a crawler user agent at all
 */
export async function verdict(ua: string, ip: string): Promise<CrawlerVerdict> {
  const family = familyOf(ua);
  if (family) return (await ipBelongsTo(ip, family)) ? 'verified' : 'fake';
  if (PREVIEW.test(ua)) return 'preview';
  return 'none';
}
