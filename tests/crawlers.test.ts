// Country block vs. crawlers: a real Googlebot gets in, someone who only types "Googlebot" does not.
// Run: npx tsx --test tests/*.test.ts
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as crawlers from '../lib/services/crawlers';
import * as geo from '../lib/services/geolock';

// Fake DNS: one real Googlebot IP, one Bing IP, and an IP whose owner set its reverse name to look like Google.
const PTR: Record<string, string[]> = {
  '66.249.66.1': ['crawl-66-249-66-1.googlebot.com'],
  '157.55.39.1': ['msnbot-157-55-39-1.search.msn.com'],
  '203.0.113.9': ['crawl-1.googlebot.com'], // reverse name faked, forward lookup won't match
  '198.51.100.7': ['host.example.net'],
};
const A: Record<string, string[]> = {
  'crawl-66-249-66-1.googlebot.com': ['66.249.66.1'],
  'msnbot-157-55-39-1.search.msn.com': ['157.55.39.1'],
  'crawl-1.googlebot.com': ['66.249.66.200'],
  'host.example.net': ['198.51.100.7'],
};
let dnsCalls = 0;
beforeEach(() => {
  dnsCalls = 0;
  crawlers.setResolver({
    reverse: async (ip) => { dnsCalls++; if (!PTR[ip]) throw new Error('ENOTFOUND'); return PTR[ip]; },
    lookup: async (h) => { dnsCalls++; if (!A[h]) throw new Error('ENOTFOUND'); return A[h]; },
  });
});

const GOOGLEBOT = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';
const BINGBOT = 'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)';
const FB = 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)';
const PHONE = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130 Mobile Safari/537.36';

test('real Googlebot and Bingbot are verified', async () => {
  assert.equal(await crawlers.verdict(GOOGLEBOT, '66.249.66.1'), 'verified');
  assert.equal(await crawlers.verdict(BINGBOT, '157.55.39.1'), 'verified');
});

test('"Googlebot" from an ordinary IP is fake', async () => {
  assert.equal(await crawlers.verdict(GOOGLEBOT, '198.51.100.7'), 'fake');
  assert.equal(await crawlers.verdict(GOOGLEBOT, '192.0.2.1'), 'fake'); // no reverse name at all
});

test('a faked reverse name without the matching forward record is fake', async () => {
  assert.equal(await crawlers.verdict(GOOGLEBOT, '203.0.113.9'), 'fake');
});

test('a Bing IP claiming to be Googlebot is fake (domains are per engine)', async () => {
  assert.equal(await crawlers.verdict(GOOGLEBOT, '157.55.39.1'), 'fake');
});

test('preview bots and normal browsers', async () => {
  assert.equal(await crawlers.verdict(FB, '198.51.100.7'), 'preview');
  assert.equal(await crawlers.verdict(PHONE, '198.51.100.7'), 'none');
});

test('preview bots may only read public pages', () => {
  for (const p of ['/', '/p/arduino-uno-r3', '/products', '/blog/arduino-start']) assert.ok(crawlers.previewMayOpen('GET', p), p);
  for (const p of ['/cart', '/checkout', '/account', '/account/orders', '/api/cart', '/order/SM123456', '/track', '/wishlist']) {
    assert.ok(!crawlers.previewMayOpen('GET', p), p);
  }
  assert.ok(!crawlers.previewMayOpen('POST', '/'));
});

test('answers are cached per IP', async () => {
  await crawlers.verdict(GOOGLEBOT, '66.249.66.1');
  const after = dnsCalls;
  await crawlers.verdict(GOOGLEBOT, '66.249.66.1');
  assert.equal(dnsCalls, after);
});

// ---- the country block itself ----
const settings = { store_name: 'Test', geo_lock_on: '1', geo_allow: 'BD', session_secret: 'test-secret', geo_tz_check: '0' };
const req = (ua: string, ip: string, country: string) => ({ headers: { 'user-agent': ua, 'x-real-ip': ip, 'x-vercel-ip-country': country } });

test('country block: Bangladesh in, USA visitor out', async () => {
  assert.equal(await geo.check(req(PHONE, '103.4.1.1', 'BD') as never, '/', settings), null);
  assert.deepEqual(await geo.check(req(PHONE, '198.51.100.7', 'US') as never, '/', settings), { country: 'US' });
});

test('country block: real Googlebot in, fake Googlebot out', async () => {
  assert.equal(await geo.check(req(GOOGLEBOT, '66.249.66.1', 'US') as never, '/p/arduino-uno-r3', settings), null);
  assert.deepEqual(await geo.check(req(GOOGLEBOT, '198.51.100.7', 'US') as never, '/p/arduino-uno-r3', settings), { country: 'US' });
});

test('country block: Facebook preview reads product pages, not checkout', async () => {
  assert.equal(await geo.check(req(FB, '198.51.100.7', 'US') as never, '/p/arduino-uno-r3', settings, 'GET'), null);
  assert.deepEqual(await geo.check(req(FB, '198.51.100.7', 'US') as never, '/checkout', settings, 'GET'), { country: 'US' });
  assert.deepEqual(await geo.check(req(FB, '198.51.100.7', 'US') as never, '/api/orders', settings, 'POST'), { country: 'US' });
});

// owner, 2026-11-13: only ordinary visitors are shut out — Google, Facebook/Meta, TikTok, Claude and the shop's own
// GitHub jobs never are.
const TIKTOK = 'Mozilla/5.0 (Linux; Android 5.0) AppleWebKit/537.36 (KHTML, like Gecko) Mobile Safari/537.36 (compatible; TikTokSpider; ttspider-feedback@tiktok.com)';
const META_ADS = 'meta-externalads/1.1 (+https://developers.facebook.com/docs/sharing/webmasters/crawler)';
const META_INDEX = 'meta-webindexer/1.1 (+https://developers.facebook.com/docs/sharing/webmasters/crawler)';
const CLAUDE_USER = 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Claude-User/1.0; +Claude-User@anthropic.com)';
const CLAUDE_SEARCH = 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Claude-SearchBot/1.0; +Claude-SearchBot@anthropic.com)';
const STOREBOT = 'Mozilla/5.0 (X11; Linux x86_64; Storebot-Google/1.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';

test('country block: TikTok, Meta and Claude crawlers read public pages from abroad', async () => {
  for (const ua of [TIKTOK, META_ADS, META_INDEX, CLAUDE_USER, CLAUDE_SEARCH]) {
    assert.ok(geo.isGoodBot(ua), ua);
    assert.equal(await geo.check(req(ua, '198.51.100.7', 'US') as never, '/', settings, 'GET'), null, ua);
    assert.equal(await geo.check(req(ua, '198.51.100.7', 'SG') as never, '/p/arduino-uno-r3', settings, 'GET'), null, ua);
    // still only public pages: never the checkout or anything that changes data
    assert.deepEqual(await geo.check(req(ua, '198.51.100.7', 'US') as never, '/checkout', settings, 'GET'), { country: 'US' }, ua);
    assert.deepEqual(await geo.check(req(ua, '198.51.100.7', 'US') as never, '/api/orders', settings, 'POST'), { country: 'US' }, ua);
  }
});

test('country block: Google shopping crawler from a Google address gets in', async () => {
  assert.equal(await geo.check(req(STOREBOT, '66.249.66.1', 'US') as never, '/p/arduino-uno-r3', settings), null);
  assert.deepEqual(await geo.check(req(STOREBOT, '198.51.100.7', 'US') as never, '/p/arduino-uno-r3', settings), { country: 'US' });
});

test('country block: the GitHub jobs and the deploy check are never shut out', async () => {
  const CURL = 'curl/8.5.0';
  for (const p of ['/api/research/tick', '/api/aistaff/tick', '/api/whiten-jobs', '/robots.txt', '/sitemap.xml', '/webhook/steadfast', '/pay/bkash/callback', '/feeds/google.xml']) {
    assert.equal(await geo.check(req(CURL, '20.42.1.1', 'US') as never, p, settings), null, p);
  }
  // the auto-deploy checks the new version on the server itself: no country header → never shut out
  assert.equal(await geo.check({ headers: { 'user-agent': CURL, 'x-real-ip': '127.0.0.1' } } as never, '/', settings), null);
});

test('country block: an ordinary visitor abroad is still shut out, at home let in', async () => {
  assert.deepEqual(await geo.check(req(PHONE, '198.51.100.7', 'SG') as never, '/p/arduino-uno-r3', settings), { country: 'SG' });
  assert.equal(await geo.check(req(PHONE, '103.4.1.1', 'BD') as never, '/checkout', settings), null);
  // someone typing "TikTokSpider" gets public pages only — the same Google shows anyway
  assert.deepEqual(await geo.check(req(TIKTOK, '198.51.100.7', 'US') as never, '/cart', settings), { country: 'US' });
});

test('robots.txt and sitemap stay open to everyone', async () => {
  assert.equal(await geo.check(req(PHONE, '198.51.100.7', 'US') as never, '/robots.txt', settings), null);
  assert.equal(await geo.check(req(PHONE, '198.51.100.7', 'US') as never, '/sitemap.xml', settings), null);
});

// With real DNS (CI only — this sandbox has no outside DNS): Google's own published crawler address.
test('real DNS: a Googlebot address from Google\'s published list verifies', { skip: process.env.LIVE_DNS !== '1' }, async () => {
  crawlers.setResolver(null);
  assert.equal(await crawlers.verdict(GOOGLEBOT, '66.249.66.1'), 'verified');
  assert.equal(await crawlers.verdict(GOOGLEBOT, '1.1.1.1'), 'fake');
});

test('a DNS hiccup does not shut Google out for hours (checked again after 2 minutes)', async () => {
  let fail = true;
  crawlers.setResolver({
    reverse: async () => { if (fail) throw Object.assign(new Error('dns timeout'), { code: 'ETIMEOUT' }); return ['crawl-66-249-66-9.googlebot.com']; },
    lookup: async () => ['66.249.66.9'],
  });
  const ua = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';
  assert.equal(await crawlers.verdict(ua, '66.249.66.9'), 'fake');
  fail = false;
  const real = Date.now;
  Date.now = () => real() + 3 * 60e3;
  try { assert.equal(await crawlers.verdict(ua, '66.249.66.9'), 'verified'); } finally { Date.now = real; crawlers.setResolver(null); }
});
