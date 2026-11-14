// 🇧🇩 বাংলা নাম (lib/services/bntitle.ts): English product names → the Bangla people in Bangladesh use, fully in Bangla
// (owner, 2026-11-14: no English letters or digits — 200A → ২০০ এ, DT9205A → ডিটি৯২০৫এ); nothing odd ("তক্তা", "লোহা") ever appears.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bnTitle, worthShowing } from '../lib/services/bntitle';

test('electronics names', () => {
  const cases: [string, string][] = [
    ['Digital Multimeter DT9205A', 'ডিজিটাল মাল্টিমিটার ডিটি৯২০৫এ'],
    ['Soldering Iron 60W with Stand', 'স্ট্যান্ড সহ সোল্ডারিং আয়রন ৬০ ওয়াট'],
    ['5V Relay Module for Arduino', 'আরডুইনো-এর জন্য ৫ ভোল্ট রিলে মডিউল'],
    ['10 Pcs 1N4007 Diode', '১০ পিস ১এন৪০০৭ ডায়োড'],
    ['PAM8403 Mini Amplifier Board', 'পিএএম৮৪০৩ মিনি অ্যামপ্লিফায়ার বোর্ড'],
    ['Kemei KM-1550 Hair Trimmer', 'কেমেই কেএম-১৫৫০ হেয়ার ট্রিমার'],
    ['XL4015 5A DC-DC Step Down Buck Converter', 'এক্সএল৪০১৫ ৫ এ ডিসি-ডিসি স্টেপ ডাউন বাক কনভার্টার'],
    ['Pack of 10 Jumper Wires Male to Female', '১০টির প্যাক জাম্পার তার মেল টু ফিমেল'],
    ['Waterproof Smart Watch for Men Black', 'ছেলেদের ওয়াটারপ্রুফ স্মার্ট ওয়াচ কালো'],
    ['Glue Gun 40W with 10 Glue Sticks', '১০ গ্লু স্টিক সহ গ্লু গান ৪০ ওয়াট'],
    ['Charger for Mobile Phone', 'মোবাইল ফোনের জন্য চার্জার'],
    ['Product details of LED Strip Light RGB 5 Meter Waterproof', 'এলইডি স্ট্রিপ লাইট আরজিবি ৫ মিটার ওয়াটারপ্রুফ'],
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

test('fully Bangla: digits, sizes, codes and brand names in Bangla letters', () => {
  assert.equal(bnTitle('200A Battery Clamp'), '২০০ এ ব্যাটারি ক্ল্যাম্প');
  assert.equal(bnTitle('USB Type C 2000mAh Power Bank 5V 2.1A'), 'ইউএসবি টাইপ-সি ২০০০ এমএএইচ পাওয়ার ব্যাংক ৫ ভোল্ট ২.১ এ');
  assert.equal(bnTitle('HC-SR04 Ultrasonic Sensor'), 'এইচসি-এসআর০৪ আল্ট্রাসনিক সেন্সর');
  assert.equal(bnTitle('0.96 inch OLED Display I2C SSD1306'), '০.৯৬ ইঞ্চি ওলেড ডিসপ্লে আই২সি এসএসডি১৩০৬');
  assert.ok(bnTitle('KD-900M-T-SK Soldering Iron Tip').includes('৯০০এম'), bnTitle('KD-900M-T-SK Soldering Iron Tip'));
  for (const n of ['Walton Original Air Conditioner Remote', 'BONG BADA 250w infrared heating bulb', 'ESP32 NodeMCU WiFi Bluetooth']) {
    assert.ok(!/[A-Za-z0-9]/.test(bnTitle(n)), bnTitle(n));
  }
});
