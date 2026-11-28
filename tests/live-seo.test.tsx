// 🏏⚽ The live score pages carry today's matches in the page itself (search engines, slow phones) and
// the words people search with (owner, 2026-11-28).
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { loadRenderer } from '../lib/react/render';
import { renderHtml } from '../lib/react/html';
import * as shop from '../lib/views/shop';
import { LIVE_SEO } from '../lib/data/seo-live';

before(loadRenderer);

const data = { sport: 'cricket', updated: '', matches: [
  { id: '1', league: 'Bangladesh tour of India', date: '2026-11-28T09:00Z', state: 'in', completed: false, detail: '', description: '', cat: 'intl', fav: 1,
    summary: 'BAN need 40 runs', teams: [{ name: 'Bangladesh', short: 'BAN', logo: '', score: '210/5', winner: false }, { name: 'India', short: 'IND', logo: '', score: '249', winner: false }] },
] };

test('live page: matches are in the page before any script runs, with the text and questions', () => {
  const html = renderHtml(shop.livePage({ sport: 'cricket', on: { cricket: true, football: true }, data, embed: false, settings: {} as never, seo: LIVE_SEO.cricket }));
  assert.match(html, /Bangladesh 210\/5 — India 249/);
  assert.match(html, /BAN need 40 runs/);
  assert.match(html, /Live Cricket Score Today/);
  for (const f of LIVE_SEO.cricket.faq) assert.ok(html.includes(f.q), f.q);
  assert.doesNotMatch(html, /স্কোর লোড হচ্ছে/);
});

test('live page: no data yet → the loading line', () => {
  const html = renderHtml(shop.livePage({ sport: 'football', on: { cricket: true, football: true }, data: null, embed: false, settings: {} as never, seo: LIVE_SEO.football }));
  assert.match(html, /স্কোর লোড হচ্ছে/);
});

test('live search words: both sports, English and Bangla', () => {
  for (const k of ['cricket', 'football'] as const) {
    const s = LIVE_SEO[k];
    assert.match(s.keywords, /live .*score/);
    assert.match(s.keywords, /লাইভ/);
    assert.ok(s.description.length > 80 && s.faq.length >= 3);
  }
});
