// ✍️ AI স্টাফের লেখা: what the AI writes is used only when it is safe — model / size numbers kept, sensible lengths,
// no links or phone numbers (another shop's), no HTML.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { check, codesIn } from '../lib/services/aiwriter';

test('model and size numbers are never lost from the name', () => {
  assert.deepEqual(codesIn('DT-9205A Digital Multimeter 12V'), ['dt9205a', '12v']);
  assert.equal(check({ name: 'DT9205A Multimeter' }, { name: 'Digital Multimeter for Electronics Repair' }).name, undefined);
  assert.equal(check({ name: 'DT9205A Multimeter' }, { name: 'DT-9205A Digital Multimeter with Backlight' }).name, 'DT-9205A Digital Multimeter with Backlight');
});

test('links, phone numbers, HTML and wrong lengths are refused', () => {
  const d = check({ name: 'X' }, {
    seo_title: 'Buy now at www.othershop.com cheap price in BD',
    seo_description: 'কল করুন 01712345678 — সেরা দামে মাল্টিমিটার, ক্যাশ অন ডেলিভারি সারা বাংলাদেশে, আজই অর্ডার করুন এখনই।',
    short_description: '<b>ভালো</b> একটা মাল্টিমিটার — ইলেকট্রনিক্সের কাজে ভোল্ট, অ্যাম্পিয়ার আর রেজিস্ট্যান্স মাপতে।',
    seo_keywords: 'multimeter, digital multimeter, মাল্টিমিটার',
    description: 'ছোট',
  });
  assert.equal(d.seo_title, undefined);
  assert.equal(d.seo_description, undefined);
  assert.equal(d.short_description, 'ভালো একটা মাল্টিমিটার — ইলেকট্রনিক্সের কাজে ভোল্ট, অ্যাম্পিয়ার আর রেজিস্ট্যান্স মাপতে।');
  assert.equal(d.seo_keywords, 'multimeter, digital multimeter, মাল্টিমিটার');
  assert.equal(d.description, undefined);
});
