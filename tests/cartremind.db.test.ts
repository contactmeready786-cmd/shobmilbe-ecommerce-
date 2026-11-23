// 🛒 Cart reminders (lib/services/cartremind.ts, owner 2026-11-24): at most 3 (1 h / 24 h / 72 h after the cart was
// left), never at night, honest words only, stops when ordered — and "won back" is counted only after a reminder.
// Run locally: TEST_DATABASE_URL=postgres://user:pass@localhost:5432/empty_db npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const URL_ = process.env.TEST_DATABASE_URL || '';
if (URL_ && /supabase|neon\.tech/i.test(URL_)) throw new Error('Tests must never run on the live shop database.');
if (URL_) process.env.DATABASE_URL = URL_;
const skip = URL_ ? false : 'needs TEST_DATABASE_URL (a throw-away Postgres)';

import * as db from '../lib/db';
import { closeConnection } from '../lib/pg';
import * as CR from '../lib/services/cartremind';
import type { Settings } from '../lib/types';

const S = { cart_remind_on: '1', site_url: 'https://shop.test' } as unknown as Settings;

test('the words: {product} / {more}, stock-out products left out, low stock and lower price only when true', () => {
  const prods = [
    { id: 1, name: 'Arduino Uno', name_bn: 'আরডুইনো উনো', price: 500, stock: 20, active: true, image_id: null, ik_url: null },
    { id: 2, name: 'Sensor', name_bn: 'সেন্সর', price: 80, stock: 0, active: true, image_id: null, ik_url: null },
    { id: 3, name: 'Wire', name_bn: 'তার', price: 10, stock: 40, active: true, image_id: null, ik_url: null },
  ];
  const m = CR.message(S, 1, [{ id: 2, qty: 1, price: 80 }, { id: 1, qty: 1, price: 500 }, { id: 3, qty: 2, price: 10 }], prods);
  assert.equal(m.live.length, 2); // the stock-out sensor is never offered
  assert.match(m.body, /আরডুইনো উনো সহ আরও ১টি পণ্য/);
  assert.doesNotMatch(m.body, /মাত্র|দাম কমেছে/);
  const low = CR.message(S, 2, [{ id: 1, qty: 1, price: 500 }], [{ ...prods[0], stock: 3 }]);
  assert.match(low.title, /আরডুইনো উনো/);
  assert.match(low.body, /স্টকে আর মাত্র ৩টি আছে/);
  const cheaper = CR.message(S, 3, [{ id: 1, qty: 1, price: 550 }], [prods[0]]);
  assert.match(cheaper.body, /^🔻 দাম কমেছে: আরডুইনো উনো এখন ৳৫০০/);
  assert.equal(CR.message(S, 1, [{ id: 2, qty: 1, price: 80 }], prods).live.length, 0);
});

let a = 0;
let b = 0;
const EP = 'https://fcm.googleapis.com/fcm/send/cart-test-' + Date.now();
const KEY_ROW = () => db.one<{ id: number; step: number; status: string; token: string; order_total: number }>(`SELECT id, step, status, token, order_total FROM cart_reminders WHERE endpoint=$1`, [EP]);
const sent: { title: string; body: string; url: string }[] = [];
const fakePush = async (_e: string, msg: { title: string; body: string; url: string }) => { sent.push(msg); return 'ok' as const; };

before(async () => {
  if (skip) return;
  await db.ensureReady();
  a = (await db.one<{ id: number }>("INSERT INTO products(name, slug, price, stock, active) VALUES('কার্ট টেস্ট এক', $1, 120, 50, true) RETURNING id", [`cr-a-${Date.now()}`]))!.id;
  b = (await db.one<{ id: number }>("INSERT INTO products(name, slug, price, stock, active) VALUES('কার্ট টেস্ট দুই', $1, 60, 50, true) RETURNING id", [`cr-b-${Date.now()}`]))!.id;
  await db.q(`INSERT INTO shop_push_subs(endpoint, p256dh, auth) VALUES($1, 'x', 'y')`, [EP]);
});
after(async () => { if (!skip) await closeConnection(); });

test('a cart is followed only for a notification phone or a signed-in customer', { skip }, async () => {
  assert.deepEqual(await CR.save(S, { endpoint: 'https://fcm.googleapis.com/fcm/send/unknown', items: [{ id: a, qty: 1 }] }, null), { track: false });
  assert.deepEqual(await CR.save({ ...S, cart_remind_on: '0' } as Settings, { endpoint: EP, items: [{ id: a, qty: 1 }] }, null), { track: false });
  assert.deepEqual(await CR.save(S, { endpoint: EP, items: [{ id: a, qty: 2 }] }, null), { track: true });
  const r = await KEY_ROW();
  assert.equal(r!.step, 0);
  assert.equal(r!.status, 'open');
});

test('3 reminders at most, never at night, never early, then it stops', { skip }, async () => {
  const r = (await KEY_ROW())!;
  await db.q(`UPDATE cart_reminders SET cart_at = now() - interval '30 minutes' WHERE id=$1`, [r.id]);
  assert.equal((await CR.tick(S, { hour: 14, sendPush: fakePush })).sent, 0); // not yet an hour
  await db.q(`UPDATE cart_reminders SET cart_at = now() - interval '2 hours' WHERE id=$1`, [r.id]);
  assert.equal((await CR.tick(S, { hour: 23, sendPush: fakePush })).night, true);
  await CR.tick(S, { hour: 14, sendPush: fakePush });
  assert.equal((await KEY_ROW())!.step, 1);
  const mine = sent.filter((m) => m.url.includes(r.token));
  assert.equal(mine.length, 1);
  assert.match(mine[0].body, /কার্ট টেস্ট এক/);
  // reminder 2 waits for 24 h after the cart, and 12 h after reminder 1
  await CR.tick(S, { hour: 14, sendPush: fakePush });
  assert.equal((await KEY_ROW())!.step, 1);
  await db.q(`UPDATE cart_reminders SET cart_at = now() - interval '80 hours', last_sent_at = now() - interval '13 hours' WHERE id=$1`, [r.id]);
  await db.q(`UPDATE cart_reminder_sends SET created_at = now() - interval '13 hours' WHERE reminder_id=$1`, [r.id]);
  await CR.tick(S, { hour: 14, sendPush: fakePush });
  await db.q(`UPDATE cart_reminders SET last_sent_at = now() - interval '13 hours' WHERE id=$1`, [r.id]);
  await CR.tick(S, { hour: 14, sendPush: fakePush });
  assert.equal((await KEY_ROW())!.step, 3);
  await db.q(`UPDATE cart_reminders SET last_sent_at = now() - interval '13 hours' WHERE id=$1`, [r.id]);
  await CR.tick(S, { hour: 14, sendPush: fakePush });
  assert.equal(sent.filter((m) => m.url.includes(r.token)).length, 3);
});

test('the reminder link brings the products back; ordering ends it and counts as won back', { skip }, async () => {
  const r = (await KEY_ROW())!;
  assert.deepEqual(await CR.restore(r.token), [{ id: a, qty: 2 }]);
  assert.equal(await CR.restore('nope'), null);
  const code = 'CRT' + String(Date.now()).slice(-7);
  await db.q(`INSERT INTO orders(code, customer_name, phone, address, area, subtotal, delivery, total) VALUES($1,'টেস্ট','01712345678','ঠিকানা','dhaka',240,60,300)`, [code]);
  await CR.save(S, { endpoint: EP, items: [], order: code }, null);
  const done = (await KEY_ROW())!;
  assert.equal(done.status, 'ordered');
  assert.equal(done.order_total, 300);
  assert.ok((await CR.stats()).won >= 1);
  assert.equal(await CR.restore(r.token), null);
  // a new cart later starts the reminders again
  await CR.save(S, { endpoint: EP, items: [{ id: b, qty: 1 }] }, null);
  const again = (await KEY_ROW())!;
  assert.equal(again.status, 'open');
  assert.equal(again.step, 0);
});
