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

test('✍️ the writer puts in the new texts, writes every change down, and ↩️ puts them back', { skip }, async () => {
  const writer = await import('../lib/services/aiwriter');
  const id = (await db.one<{ id: number }>("INSERT INTO products(name, slug, price, stock, active, description) VALUES('PAM8403 amp board', $1, 60, 9, true, 'ছোট') RETURNING id", [`aw-${Date.now()}`]))!.id;
  const answer = { name: 'PAM8403 Mini Digital Audio Amplifier Board 5V', seo_title: 'PAM8403 Amplifier Board Price in BD', seo_keywords: 'pam8403, amplifier board, অ্যামপ্লিফায়ার',
    short_description: 'ছোট ৫ ভোল্টের স্টেরিও অ্যামপ্লিফায়ার বোর্ড — স্পিকার প্রজেক্টের জন্য সহজ আর সস্তা সমাধান।' };
  const real = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '```json\n' + JSON.stringify(answer) + '\n```' }] }, groundingMetadata: { webSearchQueries: ['PAM8403'], groundingChunks: [{ web: { title: 'example.com' } }] } }] }), { status: 200 })) as typeof fetch;
  try {
    const s = await db.getSettings();
    const r = await writer.improve({ ...s, ai_gemini_key: 'AIzaTEST', ai_write_auto: '1' }, { ids: [id] });
    assert.equal(r.products, 1);
    assert.equal(r.fields, 4);
    assert.match(r.via, /গুগলে খুঁজে/); // researched → put in by itself
  } finally { globalThis.fetch = real; }
  const p = await db.one<{ name: string; seo_title: string; description: string }>('SELECT name, seo_title, description FROM products WHERE id=$1', [id]);
  assert.equal(p!.name, answer.name);
  assert.equal(p!.seo_title, answer.seo_title);
  assert.equal(p!.description, 'ছোট'); // nothing safe was written for it, so it stays
  assert.equal(await writer.undo(id), 4);
  const back = await db.one<{ name: string; seo_title: string }>('SELECT name, seo_title FROM products WHERE id=$1', [id]);
  assert.equal(back!.name, 'PAM8403 amp board');
  assert.equal(back!.seo_title, '');
});

test('✍️ written from the AI\'s memory alone (no Google Search): still put in, and marked as such', { skip }, async () => {
  const writer = await import('../lib/services/aiwriter');
  const id = (await db.one<{ id: number }>("INSERT INTO products(name, slug, price, stock, active) VALUES('LM2596 buck module', $1, 80, 9, true) RETURNING id", [`aw2-${Date.now()}`]))!.id;
  const answer = { seo_title: 'LM2596 Buck Converter Module Price in BD' };
  const real = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(answer) }] } }] }), { status: 200 })) as typeof fetch;
  let via = '';
  try {
    const s = await db.getSettings();
    via = (await writer.improve({ ...s, ai_gemini_key: 'k', ai_write_auto: '1' }, { ids: [id] })).via;
  } finally { globalThis.fetch = real; }
  assert.match(via, /নিজের জানা/);
  assert.equal((await db.one<{ seo_title: string }>('SELECT seo_title FROM products WHERE id=$1', [id]))!.seo_title, answer.seo_title);
});
