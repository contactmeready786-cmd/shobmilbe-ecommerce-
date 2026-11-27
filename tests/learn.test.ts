// 🎓 Free electronics classes (owner, 2026-11-27): every lesson is complete and its quiz answerable, slugs are unique and
// safe for addresses, the AI teacher only runs when switched on with a key, and its "PARTS:" line is split off cleanly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lessons, lesson, around, tutorOn } from '../lib/data/lessons';
import { splitParts, norm, nameFits } from '../lib/services/tutor';

test('every lesson is complete, numbered in order, with a quiz whose answers exist', () => {
  const list = lessons();
  assert.ok(list.length >= 5);
  const slugs = new Set<string>();
  list.forEach((l, i) => {
    assert.equal(l.no, i + 1, l.slug);
    assert.match(l.slug, /^[a-z0-9]+(-[a-z0-9]+)*$/, l.slug);
    assert.ok(!slugs.has(l.slug), `duplicate ${l.slug}`);
    slugs.add(l.slug);
    assert.ok(l.title && l.intro && l.parts.length, l.slug);
    assert.ok(l.summary.length > 40 && l.summary.length <= 160, `${l.slug} summary ${l.summary.length}`);
    assert.ok(l.quiz.length >= 3, l.slug);
    for (const q of l.quiz) {
      assert.ok(q.options.length >= 2 && q.answer >= 0 && q.answer < q.options.length, `${l.slug}: ${q.q}`);
      assert.ok(q.why.length > 10, q.q);
    }
  });
});

test('lessons are found by slug, with the one before and after', () => {
  const [a, b] = lessons();
  assert.equal(lesson(b.slug)?.slug, b.slug);
  assert.equal(lesson('nope'), null);
  assert.equal(around(a.slug).prev, null);
  assert.equal(around(a.slug).next?.slug, b.slug);
  assert.equal(around(b.slug).prev?.slug, a.slug);
});

test('the AI teacher needs its switch and a Gemini key', () => {
  assert.equal(tutorOn({ ai_gemini_key: 'k' }), true);
  assert.equal(tutorOn({ ai_gemini_key: 'k', learn_tutor_on: '0' }), false);
  assert.equal(tutorOn({ ai_gemini_key: '  ' }), false);
  assert.equal(tutorOn({}), false);
});

test("the teacher's PARTS line becomes part names, Markdown marks go", () => {
  const r = splitParts('**উত্তর:** ২২০ ওহম নিন।\n## হিসাব\n(৫ − ২) ÷ ০.০২ = ১৫০\n\nPARTS: 220 Ohm Resistor, LED, arduino uno, extra');
  assert.deepEqual(r.parts, ['220 ohm resistor', 'led', 'arduino uno']);
  assert.ok(!r.answer.includes('PARTS'));
  assert.ok(!r.answer.includes('**') && !r.answer.includes('##'));
  assert.ok(r.answer.startsWith('উত্তর: ২২০ ওহম'));
  assert.deepEqual(splitParts('শুধু উত্তর').parts, []);
  assert.equal(norm('LED কী?  '), norm('led কী'));
});

test('a product only fits a named part when every word of it is in the name', () => {
  assert.equal(nameFits('5mm red led', 'LED 5mm Red Diffused (1 pc)'), true);
  assert.equal(nameFits('5mm red led', 'PIR Infrared Motion Sensor LED Light Lamp Holder'), false);
  assert.equal(nameFits('220 ohm resistor', '220Ω Resistor 1/4W Carbon Film'), true);
  assert.equal(nameFits('arduino uno', 'Arduino Uno R3 (CH340)'), true);
  assert.equal(nameFits('arduino uno', 'Arduino Nano V3'), false);
  assert.equal(nameFits('jumper wire', 'Jumper Wires 20cm Male to Male'), true);
  assert.equal(nameFits('220', 'anything 220'), false);
});
