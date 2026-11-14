// 📣 সোশ্যাল মিডিয়া অটো পোস্ট (lib/services/social.ts): every platform's limits are kept and every link says where the visitor
// came from (so the owner sees which platform brings real orders). Owner, 2026-11-14: only Threads here (plus Facebook,
// Instagram, Telegram elsewhere) — Pinterest, YouTube and TikTok were removed, and the video maker with them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OPEN_PATHS } from '../lib/services/geolock';

const settings = { store_name: 'সবমিলবে', session_secret: 'x', site_url: 'https://shobmilbe.com', whatsapp: '01700000000' } as const;
const product = {
  id: 7, name: 'PAM8403 Mini Digital Amplifier Board 5V '.repeat(4), slug: 'pam8403', price: 45, old_price: 60, stock: 20, image_id: 3, category_id: 1,
  short_description: 'ছোট কিন্তু শক্তিশালী অ্যাম্প্লিফায়ার। '.repeat(40), description: '', brand: '', featured: false, sold: 2, category: 'ইলেকট্রনিক্স', last_posted: null,
};

test('Threads posts keep the 500-letter limit and carry the platform in the link', async () => {
  const social = await import('../lib/services/social');
  const p = product as unknown as Parameters<typeof social.threadsText>[0];
  const s = { ...settings } as unknown as Parameters<typeof social.threadsText>[1];
  const th = social.threadsText(p, s);
  assert.ok(th.length <= 500, 'Threads allows 500 letters');
  assert.match(th, /\/p\/pam8403\?utm_source=threads/);
});

test('only the free, publicly-posting platforms are offered', async () => {
  const social = await import('../lib/services/social');
  assert.deepEqual([...social.CHANNELS], ['threads']);
  assert.ok(!social.isChannel('tiktok') && !social.isChannel('youtube') && !social.isChannel('pinterest'));
});

test('posting hours: at most 4 a day, the default when none set', async () => {
  const social = await import('../lib/services/social');
  const s = { ...settings, social_threads_hours: '22, 9, 9, 30, 13, 15, 18' } as unknown as Parameters<typeof social.hoursFor>[0];
  assert.deepEqual(social.hoursFor(s, 'threads'), [9, 13, 15, 18]);
  assert.deepEqual(social.hoursFor({ ...settings } as unknown as Parameters<typeof social.hoursFor>[0], 'threads'), [13, 21]);
  assert.equal(social.connected(s, 'threads'), false);
});

test('the removed video maker\'s address is no longer open past the country lock', () => {
  assert.ok(!OPEN_PATHS.test('/api/social-video-jobs'));
  assert.ok(OPEN_PATHS.test('/api/whiten-jobs'));
});
