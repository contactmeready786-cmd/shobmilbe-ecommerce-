// 📥 Admin → মেসেজ → Excel তালিকা (lib/admin/contacts.tsx): people are read from any Excel / CSV layout — mobile numbers
// (also when Excel dropped the leading 0, or wrote +880), e-mails, names; duplicates once; junk rows skipped; list names safe.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readContacts, phoneOf, listName } from '../lib/admin/contacts';

test('contacts: mobile numbers in every common form', () => {
  assert.equal(phoneOf('01712345678'), '01712345678');
  assert.equal(phoneOf('1712345678'), '01712345678'); // Excel dropped the 0
  assert.equal(phoneOf('+880 1712-345678'), '01712345678');
  assert.equal(phoneOf('৮৮০১৭১২৩৪৫৬৭৮'), '01712345678');
  assert.equal(phoneOf('01212345678'), ''); // not a mobile number
  assert.equal(phoneOf('rafi@example.com'), '');
  assert.equal(phoneOf(''), '');
});

test('contacts: any column order, names, e-mails, duplicates once, junk skipped', () => {
  const { contacts, rows } = readContacts([
    ['ক্রমিক', 'Mobile', 'নাম', 'Email'],
    ['1', '1712345678', 'রাফি', 'Rafi@Example.com'],
    ['2', '01812345678', 'সুমি', ''],
    ['3', '+8801712345678', 'রাফি আবার', ''], // same number again
    ['4', '', 'শুধু ইমেইল', 'only@mail.com'],
    ['', 'মোট', '', ''], // a totals line
    ['5', '12345', 'ভুল নম্বর', 'not-an-email'],
  ]);
  assert.equal(rows, 7);
  assert.deepEqual(contacts, [
    { name: 'রাফি', phone: '01712345678', email: 'rafi@example.com' },
    { name: 'সুমি', phone: '01812345678', email: '' },
    { name: 'শুধু ইমেইল', phone: '', email: 'only@mail.com' },
  ]);
  // no headings at all: the first plain-text cell is the name
  assert.deepEqual(readContacts([['করিম', '01912345678']]).contacts, [{ name: 'করিম', phone: '01912345678', email: '' }]);
});

test('contacts: list names are safe for tags and e-mail lists', () => {
  assert.equal(listName("  ফেসবুক লিড' অক্টোবর; DROP  "), 'ফেসবুক লিড অক্টোবর DROP');
  assert.equal(listName('a'.repeat(40)).length, 27);
  assert.equal(listName('<>'), '');
});
