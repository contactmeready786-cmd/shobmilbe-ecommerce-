// 🛵 the address the courier's hub reads: thana/upazila + district clearly labelled in English and Bangla, never cut
// off, and a warning when the customer's own words name a different place (চৌগাছা ↔ ঝিকরগাছা, owner 2026-11-23).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { courierArea, addressConflict } from '../lib/models/orders';
import { fullAddress } from '../lib/services/courier';

test('the courier gets the upazila and district in English and Bangla', () => {
  assert.equal(courierArea({ district: 'Jashore', thana: 'Chougachha' }), 'Upazila/Thana: Chougachha (চৌগাছা), District: Jashore (যশোর)');
  assert.equal(courierArea({ district: 'Dhaka', thana: 'Paltan' }), 'Thana: Paltan (পল্টন), District: Dhaka (ঢাকা)');
  assert.equal(courierArea({ district: '', thana: '' }), '');
});

test('a long address is cut, the thana and district at the end never', () => {
  const area = courierArea({ district: 'Jashore', thana: 'Chougachha' });
  const out = fullAddress('গ্রাম '.repeat(80), area, 250);
  assert.ok(out.length <= 250);
  assert.ok(out.endsWith(area));
  assert.equal(fullAddress('বাসা ১২, রোড ৩', '', 250), 'বাসা ১২, রোড ৩');
});

test('the address naming another upazila of the district is flagged', () => {
  assert.deepEqual(addressConflict({ district: 'Jashore', thana: 'Chougachha', address: 'ঝিকরগাছা বাজার, মসজিদের পাশে' }), ['ঝিকরগাছা']);
  assert.deepEqual(addressConflict({ district: 'Jashore', thana: 'Chougachha', address: 'Jhikargacha bazar' }), ['ঝিকরগাছা']);
  // the chosen one is named too → fine (e.g. "near the Jhikargacha road" inside Chougachha)
  assert.deepEqual(addressConflict({ district: 'Jashore', thana: 'Chougachha', address: 'চৌগাছা, ঝিকরগাছা রোডের পাশে' }), []);
  assert.deepEqual(addressConflict({ district: 'Dhaka', thana: 'Badda', address: 'মধ্য বাড্ডা, রামপুরা ব্রিজের কাছে' }), []);
  assert.deepEqual(addressConflict({ district: 'Jashore', thana: 'Chougachha', address: 'বাসা ৫, স্কুলের পাশে' }), []);
});

test('the address naming another district is flagged', () => {
  assert.deepEqual(addressConflict({ district: 'Dhaka', thana: 'Badda', address: 'টঙ্গী, গাজীপুর' }), ['গাজীপুর জেলা']);
});
