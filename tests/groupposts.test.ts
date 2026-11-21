// 📣 Group posts / 🏷️ Marketplace helper: a new batch every Friday (Dhaka time); the Marketplace description never
// carries a link (Marketplace hides those), the reply does — tagged so visits from Marketplace show in the analytics.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { weekOf, listingText, listingTitle, replyText, WEEK_PLAN } from '../lib/services/groupposts';
import type { Settings } from '../lib/types';

const settings = { site_url: 'https://shobmilbe.com/', delivery_dhaka: '70', delivery_outside: '130' } as unknown as Settings;
const product = { name: 'PAM8403 Mini Amplifier Board', slug: 'pam8403-amp', price: 85, old_price: 120, stock: 12,
  short_description: 'ছোট ৫ ভোল্টের স্টেরিও অ্যামপ্লিফায়ার বোর্ড, ৩ ওয়াট + ৩ ওয়াট। দেখুন https://example.com/x', description: '' };

test('the week starts on Friday, Dhaka time', () => {
  assert.equal(weekOf(new Date('2026-11-20T10:00:00Z')), '2026-11-20'); // a Friday
  assert.equal(weekOf(new Date('2026-11-21T07:00:00Z')), '2026-11-20'); // Saturday → that Friday
  assert.equal(weekOf(new Date('2026-11-26T17:00:00Z')), '2026-11-20'); // Thursday 23:00 in Dhaka
  assert.equal(weekOf(new Date('2026-11-26T18:30:00Z')), '2026-11-27'); // Friday 00:30 in Dhaka → new week
  assert.equal(WEEK_PLAN.length, 7);
});

test('Marketplace description: price, delivery from the settings, no link', () => {
  const t = listingText(product as never, settings);
  assert.doesNotMatch(t, /https?:\/\//);
  assert.match(t, /৳৮৫/);
  assert.match(t, /আগে ৳১২০/);
  assert.match(t, /ঢাকায় ৳৭০/);
  assert.match(t, /ঢাকার বাইরে ৳১৩০/);
});

test('Marketplace title fits, reply has the tracked product link', () => {
  assert.ok(listingTitle({ name: 'x'.repeat(10) + ' ' + 'y'.repeat(200) }).length <= 100);
  const r = replyText(product as never, settings);
  assert.match(r, /https:\/\/shobmilbe\.com\/p\/pam8403-amp\?utm_source=marketplace/);
});
