// ✍️ AI স্টাফের লেখা: what the AI writes is used only when it is safe — model / size numbers kept, sensible lengths,
// no links or phone numbers (another shop's), no HTML.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { check, codesIn } from '../lib/services/aiwriter';

test('model and size numbers are never lost from the name', () => {
  assert.deepEqual(codesIn('DT-9205A Digital Multimeter 12V'), ['9205a', '12v']); // 'DT-' is a prefix: the number itself must stay
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

test('a new name must still be the same product', () => {
  assert.equal(check({ name: 'Soldering Iron Stand' }, { name: 'Wireless Bluetooth Speaker Portable' }).name, undefined);
  assert.equal(check({ name: 'Soldering Iron Stand' }, { name: 'Soldering Iron Stand with Sponge Holder' }).name, 'Soldering Iron Stand with Sponge Holder');
});

test('the Bangla name keeps the numbers and is really in Bangla', () => {
  assert.equal(check({ name: 'PAM8403 Amplifier Board' }, { name_bn: 'PAM8403 অ্যামপ্লিফায়ার বোর্ড' }).name_bn, 'পিএএম৮৪০৩ অ্যামপ্লিফায়ার বোর্ড');
  assert.equal(check({ name: 'PAM8403 Amplifier Board' }, { name_bn: 'অ্যামপ্লিফায়ার বোর্ড' }).name_bn, undefined);
  assert.equal(check({ name: 'PAM8403 Amplifier Board' }, { name_bn: 'PAM8403 Amplifier Board' }).name_bn, undefined);
});

test('descriptions keep only the product: no "why buy here", delivery or FAQ, compact lists', () => {
  const d = check({ name: 'PAM8403 Amplifier Board' }, { description: 'PAM8403 একটি ছোট ডিজিটাল অ্যামপ্লিফায়ার বোর্ড, ৫ ভোল্টে চলে আর দুই চ্যানেলে ৩ ওয়াট করে আউটপুট দেয়। ছোট স্পিকার প্রজেক্টে খুব কাজে লাগে।\n\n-\n\n**ভোল্টেজ:** 5V\n\n-\n\n**আউটপুট:** 3W x 2\n\n## কেনার আগে জেনে নিন\n\nস্পিকারের ওহম মিলিয়ে নিন।\n\n## ডেলিভারি তথ্য\n\nসারা দেশে হোম ডেলিভারি।' }).description || '';
  assert.match(d, /- \*\*ভোল্টেজ:\*\* 5V\n\n?- \*\*আউটপুট:\*\*/);
  assert.ok(!/কেনার আগে|ডেলিভারি/.test(d), d);
});
