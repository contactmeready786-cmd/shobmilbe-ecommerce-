// 🇧🇩 বাংলা নাম (lib/services/bntitle.ts): English product names → the Bangla people in Bangladesh use; brand names,
// model numbers and sizes stay exactly as written; nothing odd ("তক্তা", "লোহা") ever appears.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bnTitle, worthShowing } from '../lib/services/bntitle';

test('electronics names', () => {
  const cases: [string, string][] = [
    ['Digital Multimeter DT9205A', 'ডিজিটাল মাল্টিমিটার DT9205A'],
    ['Soldering Iron 60W with Stand', 'স্ট্যান্ড সহ সোল্ডারিং আয়রন 60W'],
    ['5V Relay Module for Arduino', 'Arduino-এর জন্য 5V রিলে মডিউল'],
    ['10 Pcs 1N4007 Diode', '10 পিস 1N4007 ডায়োড'],
    ['PAM8403 Mini Amplifier Board', 'PAM8403 মিনি অ্যামপ্লিফায়ার বোর্ড'],
    ['Kemei KM-1550 Hair Trimmer', 'Kemei KM-1550 হেয়ার ট্রিমার'],
    ['XL4015 5A DC-DC Step Down Buck Converter', 'XL4015 5A DC-DC স্টেপ ডাউন বাক কনভার্টার'],
    ['Pack of 10 Jumper Wires Male to Female', '10টির প্যাক জাম্পার তার মেল টু ফিমেল'],
    ['Waterproof Smart Watch for Men Black', 'ছেলেদের ওয়াটারপ্রুফ স্মার্ট ওয়াচ কালো'],
    ['Glue Gun 40W with 10 Glue Sticks', '10 গ্লু স্টিক সহ গ্লু গান 40W'],
    ['Charger for Mobile Phone', 'মোবাইল ফোনের জন্য চার্জার'],
    ['Product details of LED Strip Light RGB 5 Meter Waterproof', 'LED স্ট্রিপ লাইট RGB 5 মিটার ওয়াটারপ্রুফ'],
  ];
  for (const [en, bn] of cases) assert.equal(bnTitle(en), bn, en);
});

test('never the odd dictionary words', () => {
  const out = ['Soldering Iron', 'Amplifier Board', 'Iron Stand', 'Board'].map(bnTitle).join(' ');
  assert.ok(!/লোহা|তক্তা|ঝালাই|পরিবর্ধক/.test(out), out);
});

test('Bangla names stay, empty stays empty, the same letters again are not shown', () => {
  assert.equal(bnTitle('ডিজিটাল মাল্টিমিটার'), 'ডিজিটাল মাল্টিমিটার');
  assert.equal(bnTitle(''), '');
  assert.equal(worthShowing('ESP32', bnTitle('ESP32')), false);
  assert.equal(worthShowing('Digital Multimeter', 'ডিজিটাল মাল্টিমিটার'), true);
});
