// 🤖 AI স্টাফ: the whole-shop check runs on any shop (even an empty one) without failing, finds what a careful
// employee would (a product sold below its buying price, a new order nobody looked at), keeps the report, and
// never changes anything by itself. Run locally: TEST_DATABASE_URL=postgres://user:pass@localhost:5432/empty_db npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const URL_ = process.env.TEST_DATABASE_URL || '';
if (URL_ && /supabase|neon\.tech/i.test(URL_)) throw new Error('Tests must never run on the live shop database.');
if (URL_) process.env.DATABASE_URL = URL_;
const skip = URL_ ? false : 'needs TEST_DATABASE_URL (a throw-away Postgres)';

import * as db from '../lib/db';
import { closeConnection } from '../lib/pg';
import * as staff from '../lib/services/aistaff';

let pid = 0;
before(async () => {
  if (skip) return;
  await db.ensureReady();
  pid = (await db.one<{ id: number }>("INSERT INTO products(name, slug, price, cost_price, stock, active) VALUES('লোকসানের পণ্য AI', $1, 80, 120, 5, true) RETURNING id", [`ai-${Date.now()}`]))!.id;
});
after(() => closeConnection());

test('the check runs, finds a loss-making product, and keeps the report', { skip }, async () => {
  const s = await db.getSettings();
  const before = await db.one<{ price: number }>('SELECT price FROM products WHERE id=$1', [pid]);
  const r = await staff.run({ ...s, ai_gemini_key: '' }, { send: false });
  assert.ok(r.sections.length >= 5);
  const money = r.sections.find((x) => x.key === 'money')!;
  assert.ok(money.items.some((i) => i.level === 'bad' && i.text.includes('লোকসানের পণ্য AI')));
  assert.ok(r.counts.bad >= 1);
  assert.equal((await staff.latest())!.at, r.at);
  assert.match(staff.asText(r, s), /AI স্টাফ/);
  // it only looks: the product is exactly as it was
  assert.equal((await db.one<{ price: number }>('SELECT price FROM products WHERE id=$1', [pid]))!.price, before!.price);
});

test('the daily run happens once a day, only after the owner\'s hour', { skip }, async () => {
  const s = await db.getSettings();
  await db.q('DELETE FROM ai_staff_reports');
  await staff.tick({ ...s, ai_staff_on: '0' });
  assert.equal(await staff.latest(), null);
  await staff.tick({ ...s, ai_staff_hour: '0', ai_staff_email: '0', ai_gemini_key: '' });
  await staff.tick({ ...s, ai_staff_hour: '0', ai_staff_email: '0', ai_gemini_key: '' });
  const n = await db.one<{ n: number }>('SELECT count(*)::int AS n FROM ai_staff_reports');
  assert.equal(n!.n, 1);
});
