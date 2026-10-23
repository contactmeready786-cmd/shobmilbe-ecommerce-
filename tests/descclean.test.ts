// 🧹 বিবরণ পরিষ্কার (lib/models/descclean.ts): the copied shop's own text goes, the product's text stays exactly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clean, sourceNames } from '../lib/models/descclean';

const PRODUCT = `DT9205A একটি ডিজিটাল মাল্টিমিটার। এটি দিয়ে AC/DC ভোল্টেজ, কারেন্ট, রেজিস্ট্যান্স, ক্যাপাসিট্যান্স মাপা যায়। বড় LCD ডিসপ্লে আর অটো পাওয়ার অফ আছে।

## বৈশিষ্ট্য
- DC ভোল্টেজ: 200mV – 1000V
- AC ভোল্টেজ: 2V – 750V
- ক্যাপাসিট্যান্স: 2nF – 200µF
- Voltage: 9V battery`;

test('the copied shop\'s FAQ, contact and selling talk go; the product text stays exactly', () => {
  const text = `${PRODUCT}

## কেন ElectroX BD থেকে কিনবেন?
আমরা সারা বাংলাদেশে হোম ডেলিভারি দিয়ে থাকি।

## সাধারণ জিজ্ঞাসা
প্রশ্ন: ডেলিভারি কতদিনে?
উত্তর: ঢাকায় ১ দিন।

অর্ডার করতে কল করুন 01711-223344 অথবা ভিজিট করুন www.electrox.com.bd`;
  const r = clean(text, 'electrox.com.bd');
  assert.equal(r.text, PRODUCT);
  assert.ok(r.changed);
  assert.ok(r.removed.some((x) => x.includes('01711')));
});

test('English FAQ and the shop named in the middle', () => {
  const text = `High quality soldering iron, 60W, fast heating ceramic core with adjustable temperature 200–450°C.

Buy this from Electro X BD at the best price in Bangladesh.

Comes with 5 spare tips and a stand.

Frequently Asked Questions
Q: Is it original?
A: Yes.`;
  const r = clean(text, 'https://www.electrox.com.bd/product/abc');
  assert.equal(r.text, `High quality soldering iron, 60W, fast heating ceramic core with adjustable temperature 200–450°C.

Comes with 5 spare tips and a stand.`);
});

test('a clean description is left untouched', () => {
  const r = clean(PRODUCT, 'electrox.com.bd');
  assert.equal(r.changed, false);
  assert.equal(r.text, PRODUCT);
  assert.deepEqual(r.removed, []);
});

test('a "delivery" heading right at the start is not taken for the shop part (no product text before it)', () => {
  const text = `## Delivery information\nThis USB cable charges fast and transfers data at 480 Mbps. Length 1 m, braided nylon.`;
  assert.equal(clean(text, 'x.com').text.includes('USB cable'), true);
});

test('shop names from its web address', () => {
  assert.deepEqual(sourceNames('www.electrox.com.bd'), ['electrox.com.bd', 'electrox', 'electro[ -]?x']);
  assert.deepEqual(sourceNames('file'), []);
});

test('product lines that only look like shop words stay (a relay\'s "Contact type")', () => {
  const text = `5V single channel relay module for Arduino, optocoupler isolated, LED indicator, screw terminals for easy wiring.

Contact type: NO / NC
Payment terminal: none

Delivery of power: up to 10A at 250V AC.`;
  assert.equal(clean(text, 'electrox.com.bd').text, text);
});
