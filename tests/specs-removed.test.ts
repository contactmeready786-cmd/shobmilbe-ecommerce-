// ⚙️ owner, 2026-11-14: products have no "specification" part any more — wherever a description has one, it goes
// (lib/services/autodesc.ts removeSpecs), the rest of the text stays as written.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { removeSpecs } from '../lib/services/autodesc';

test('a specification part goes, up to the next heading', () => {
  assert.equal(removeSpecs('Push Button কী? এটি একটি সুইচ।\n\n### স্পেসিফিকেশন\n- ধরন: মোমেন্টারি\n- পিন: 4\n\n### কোথায় ব্যবহার হয়\n- Arduino প্রজেক্টে'),
    'Push Button কী? এটি একটি সুইচ।\n\n### কোথায় ব্যবহার হয়\n- Arduino প্রজেক্টে');
  assert.equal(removeSpecs('Intro text\n\n**Specifications:**\n\n- Voltage: 5V\n\n**Applications:**\n- Robots'), 'Intro text\n\n**Applications:**\n- Robots');
  assert.equal(removeSpecs('ভালো পণ্য। স্পেসিফিকেশন • ধরন: স্লাইড • মাপ: 9cm'), 'ভালো পণ্য।');
  assert.equal(removeSpecs('মূল বৈশিষ্ট্য\n- ভালো'), 'মূল বৈশিষ্ট্য\n- ভালো');
});
