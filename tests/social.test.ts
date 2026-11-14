// 📣 সোশ্যাল মিডিয়া অটো পোস্ট (lib/services/social.ts): every platform's limits are kept, every link says where the visitor
// came from (so the owner sees which platform brings real orders), and GitHub's video maker passes the country lock.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OPEN_PATHS } from '../lib/services/geolock';

const settings = { store_name: 'সবমিলবে', session_secret: 'x', site_url: 'https://shobmilbe.com', whatsapp: '01700000000' } as const;
const product = {
  id: 7, name: 'PAM8403 Mini Digital Amplifier Board 5V '.repeat(4), slug: 'pam8403', price: 45, old_price: 60, stock: 20, image_id: 3, category_id: 1,
  short_description: 'ছোট কিন্তু শক্তিশালী অ্যাম্প্লিফায়ার। '.repeat(40), description: '', brand: '', featured: false, sold: 2, category: 'ইলেকট্রনিক্স', last_posted: null,
};

test('posts keep each platform\'s limits and carry the platform in the link', async () => {
  const social = await import('../lib/services/social');
  const p = product as unknown as Parameters<typeof social.threadsText>[0];
  const s = { ...settings } as unknown as Parameters<typeof social.threadsText>[1];
  const th = social.threadsText(p, s);
  assert.ok(th.length <= 500, 'Threads allows 500 letters');
  assert.match(th, /utm_source=threads/);
  const pin = social.pinText(p, s);
  assert.ok(pin.title.length <= 100 && pin.description.length <= 500);
  assert.match(pin.link, /\/p\/pam8403\?utm_source=pinterest/);
  const yt = social.videoText(p, s, 'youtube');
  assert.ok(yt.title.length <= 100 && /#shorts/.test(yt.title));
  assert.match(yt.description, /utm_source=youtube/);
  assert.ok(social.videoText(p, s, 'tiktok').description.length <= 2200);
});

test('posting hours: at most 4 a day, the platform\'s own default when none set', async () => {
  const social = await import('../lib/services/social');
  const s = { ...settings, social_pinterest_hours: '22, 9, 9, 30, 13, 15, 18' } as unknown as Parameters<typeof social.hoursFor>[0];
  assert.deepEqual(social.hoursFor(s, 'pinterest'), [9, 13, 15, 18]);
  assert.deepEqual(social.hoursFor(s, 'youtube'), [19]);
  assert.equal(social.connected(s, 'youtube'), false);
});

test('GitHub\'s video maker passes the country lock', () => {
  assert.ok(OPEN_PATHS.test('/api/social-video-jobs'));
  assert.ok(!OPEN_PATHS.test('/api/social-video-jobs/x'));
});
