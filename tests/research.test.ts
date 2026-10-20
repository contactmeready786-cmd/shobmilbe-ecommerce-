// 📊 Market research (lib/services/research.ts): every product is put in the owner's own product group by its name, and
// Google's "Trending now" feed for Bangladesh is read correctly (no network here: the feed text is given).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { segmentOf, parseTrends, SEGMENTS } from '../lib/services/research';

test('research: each product goes to the owner\'s product group by its name', () => {
  const cases: [string, string][] = [
    ['Arduino Uno R3 CH340', 'components'], ['HC-SR04 Ultrasonic Sensor', 'components'], ['ESP32 DevKit V1', 'components'],
    ['Universal AC Remote 1000 in 1', 'remote'], ['Walton LED TV Remote', 'remote'],
    ['60W Soldering Iron Adjustable', 'tools'], ['DT830B Digital Multimeter', 'tools'],
    ['Miyako Rice Cooker 2.8L', 'home'], ['Vision Blender 3 in 1', 'home'],
    ['Walton MCB 32A Circuit Breaker', 'electrical'], ['3 Pin Multi Plug Extension', 'electrical'],
    ['Ladies Cotton Kurti', 'fashion_women'], ['Georgette Three Piece', 'fashion_women'],
    ["Men's Premium Panjabi", 'fashion_men'], ['Polo T-Shirt for Boys', 'fashion_men'],
    ['Free Fire 520 Diamonds Top Up', 'digital'], ['Google Play Gift Card $10', 'digital'], ['PUBG Mobile 660 UC', 'digital'],
    ['TWS Earbuds Bluetooth 5.3', 'electronics'], ['20000mAh Power Bank', 'electronics'],
  ];
  for (const [title, want] of cases) assert.equal(segmentOf(title, '', 'other'), want, title);
  // nothing in the name: the shop's own group; an unknown group: "other"
  assert.equal(segmentOf('Something New', '', 'fashion'), 'fashion');
  assert.equal(segmentOf('Something New', '', 'no-such-group'), 'other');
  // a diamond ring is not a game top-up
  assert.notEqual(segmentOf('Diamond Ring Gold Plated', '', 'other'), 'digital');
  // every group has a Bangla name to show
  for (const k of ['components', 'tools', 'remote', 'home', 'electrical', 'fashion_men', 'fashion_women', 'digital', 'electronics']) assert.ok(SEGMENTS[k], k);
});

test('research: Google trending searches for Bangladesh are read from the feed', () => {
  const xml = `<?xml version="1.0"?><rss xmlns:ht="https://trends.google.com/trending/rss"><channel>
    <item><title>Bangladesh vs India</title><ht:approx_traffic>50000+</ht:approx_traffic><pubDate>Mon, 20 Oct 2026 03:00:00 -0700</pubDate>
      <ht:news_item><ht:news_item_title><![CDATA[Tigers win &amp; more]]></ht:news_item_title><ht:news_item_url>https://example.com/a</ht:news_item_url><ht:news_item_source>Daily Star</ht:news_item_source></ht:news_item>
      <ht:news_item><ht:news_item_title>Bad link</ht:news_item_title><ht:news_item_url>javascript:alert(1)</ht:news_item_url></ht:news_item></item>
    <item><title><![CDATA[iPhone 18 <b>price</b>]]></title><ht:approx_traffic>2000+</ht:approx_traffic></item>
    <item><title></title></item></channel></rss>`;
  const t = parseTrends(xml);
  assert.equal(t.length, 2);
  assert.equal(t[0].title, 'Bangladesh vs India');
  assert.equal(t[0].traffic, '50000+');
  assert.deepEqual(t[0].news, [{ title: 'Tigers win & more', url: 'https://example.com/a', source: 'Daily Star' }]); // only real web links
  assert.equal(t[1].title, 'iPhone 18 price'); // tags inside the text are dropped
  assert.deepEqual(parseTrends('not a feed'), []);
});
