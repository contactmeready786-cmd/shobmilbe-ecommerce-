// 🔎 পাঠশালা and tools search words (lib/data/seo-learn.ts): every page has its English name and FAQ,
// and product pages link only to the tool that really fits the part.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOL_SEO, LESSON_SEO, LIST_SEO, toolsForProduct, faqLd, seoTitle } from '../lib/data/seo-learn';
import { tools } from '../lib/data/tools';
import { lessons } from '../lib/data/lessons';

const ALL = tools().map((t) => t.key);

test('every tool and lesson has an English name, keywords and at least 2 questions', () => {
  for (const t of tools()) { const s = TOOL_SEO[t.key]; assert.ok(s, t.key); assert.ok(s.en.length >= 10 && s.faq.length >= 3, t.key); }
  for (const l of lessons()) { const s = LESSON_SEO[l.slug]; assert.ok(s, l.slug); assert.ok(s.en.length >= 10 && s.faq.length >= 2, l.slug); }
  for (const s of [...Object.values(TOOL_SEO), ...Object.values(LESSON_SEO)]) for (const f of s.faq) assert.ok(f.q.trim() && f.a.trim().length > 10);
  assert.equal(Object.keys(TOOL_SEO).length, tools().length);
  assert.equal(Object.keys(LESSON_SEO).length, lessons().length);
});

test('the class name has no "ফ্রি" (owner, 2026-11-28)', () => {
  assert.ok(!/ফ্রি|free/i.test(LIST_SEO.learn.en));
  assert.ok(!/ফ্রি/.test(JSON.stringify(LIST_SEO.learn.faq.map((f) => f.q))));
});

test('FAQ JSON-LD repeats the questions', () => {
  const j = faqLd([{ q: 'ক?', a: 'খ' }]);
  assert.equal(j['@type'], 'FAQPage');
  assert.equal(j.mainEntity[0].acceptedAnswer.text, 'খ');
  assert.equal(seoTitle('A', 'খ'), 'A — খ');
});

test('product → tool links fit the part', () => {
  const k = (n: string) => toolsForProduct(n, ALL).map((h) => h.key);
  assert.deepEqual(k('1/4W Carbon Film Resistor 220 Ohm'), ['resistor-color-code']);
  assert.deepEqual(k('SMD Resistor 0805 10K'), ['smd-resistor-code']);
  assert.deepEqual(k('104 Ceramic Capacitor 0.1uF'), ['capacitor-code']);
  assert.deepEqual(k('5mm Red LED'), ['led-resistor']);
  assert.deepEqual(k('BC547 NPN Transistor'), ['transistor-switch']);
  assert.deepEqual(k('NE555 Timer IC'), ['555-timer']);
  assert.deepEqual(k('18650 Li-ion Battery 2000mAh'), ['battery-life']);
  assert.deepEqual(k('12V LED Strip Light 5m'), []);
  assert.deepEqual(k('10K Potentiometer'), []);
  assert.deepEqual(k('TP4056 Battery Charger Module'), []);
  assert.deepEqual(k('TV Remote Control'), []);
  assert.deepEqual(k('5W Wire Wound Resistor'), []);
  assert.deepEqual(k('5W Resistor'), []);
  assert.deepEqual(k('1/2W Carbon Film Resistor'), ['resistor-color-code']);
  assert.deepEqual(k('50V Electrolytic Capacitor'), []);
  assert.deepEqual(k('14V LED Monitor Adapter Charger'), []);
  assert.deepEqual(k('2S BMS 18650 Battery Protection Board'), []);
  assert.deepEqual(toolsForProduct('5mm Red LED', ['ohms-law']), []); // tool switched off → no link
});
