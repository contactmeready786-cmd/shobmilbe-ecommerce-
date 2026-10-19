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
