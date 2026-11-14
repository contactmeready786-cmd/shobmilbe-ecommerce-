// 🔎 SEO fields written into every product (lib/services/autoseo.ts seoFields, owner 2026-11-14): Google's limits kept,
// the delivery line never cut off, no price (it would go stale), search words people type in English and Bangla.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seoFields } from '../lib/services/autoseo';

test('title ≤ 60, description ≤ 160 with the whole delivery line, keywords in English and Bangla', () => {
  const f = seoFields({ id: 1, name: 'Arduino 37 in 1 Sensor Kit for DIY Projects', name_bn: 'ডিআইওয়াই প্রজেক্টের জন্য আরডুইনো ৩৭ ইন ১ সেন্সর কিট', model: '', brand: '',
    category_name: 'সেন্সর', short_description: 'Number of Modules: 37 sensors and components. Compatibility: Arduino, ESP32, Raspberry Pi', description: '',
    seo_title: '', seo_description: '', seo_keywords: '' }, { store_name: 'সবমিলবে' } as never);
  assert.ok(f.seo_title.length <= 60 && /Price in BD$/.test(f.seo_title), f.seo_title);
  assert.ok(f.seo_description.length <= 160, String(f.seo_description.length));
  assert.match(f.seo_description, /ক্যাশ অন ডেলিভারি — সবমিলবে।$/);
  assert.ok(!/৳/.test(f.seo_description));
  assert.match(f.seo_keywords, /price in bd/);
  assert.match(f.seo_keywords, /সেন্সর কিট দাম/);
});
