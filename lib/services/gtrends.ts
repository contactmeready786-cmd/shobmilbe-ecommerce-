// 📊 গুগলে চাহিদা (owner, 2026-11-21) — what people in Bangladesh search for on Google, product by product, read every
// day by itself and turned into a short "do this today" list (Admin → মার্কেট রিসার্চ → 📊 গুগলে চাহিদা, and the
// AI স্টাফ daily report / e-mail).
//
// How it works:
//   • A watch list of product words (trend_terms): made by itself from the kinds of products the shop sells
//     (SEEDS, only the groups the shop really has) and from what customers searched for on the site; the owner can
//     add any word and hide any automatic one (a hidden word is never added back).
//   • The shop's timer (lib/api/files.ts runShopJobs, every 5 minutes) reads ONE word at a time from Google Trends
//     (12 months, Bangladesh, week by week + the searches that go with it). Every word is read again once a day, so
//     ~60 words take ~5 hours and Google is never hurried. Google Trends has no official free API: the same public
//     data its own page shows is read (robots.txt allows /trends/api). If Google says "too many" (429) everything
//     waits (2 h, then longer) and the page says so; the last good numbers stay.
//   • Google gives no real search counts — only 0–100 within each word's own 12 months. So the page shows how each
//     word moves (this month against last month and against its year, its high months), never "how many people".
//   • advise() joins that with the shop's own facts (stock, price, buying price) and other shops' prices (research
//     items) into the advice. It only advises: nothing in the shop is changed.
import type { Caught } from '../types';
import { q, one, setSetting } from '../db';
import { safeFetch, type Fetched, type SafeFetchOpts } from './safefetch';
import { allowed, segmentOf, sourcingLinks } from './research';
import { bn, money } from '../util';

// ---------------------------------------------------------------- the watch list
// Product words people really type (English: in Bangladesh product searches are mostly written in English letters).
export const SEEDS: Record<string, string[]> = {
  remote: ['tv remote', 'ac remote', 'smart tv remote', 'set top box remote', 'remote control'],
  components: ['arduino', 'esp32', 'sensor', 'relay module', 'servo motor', 'transistor', 'capacitor', 'lcd display', 'breadboard', 'voltage regulator'],
  tools: ['soldering iron', 'multimeter', 'glue gun', 'soldering station', 'screwdriver set', 'soldering paste'],
  electronics: ['power bank', 'earbuds', 'smart watch', 'charger', 'bluetooth speaker', 'ip camera', 'router', 'trimmer', 'hair dryer'],
  electrical: ['led light', 'mini ups', 'ups for router', 'extension board', 'voltage stabilizer', 'ips battery'],
  home: ['rechargeable fan', 'blender', 'rice cooker', 'electric kettle', 'room heater', 'air cooler', 'humidifier', 'weight scale', 'massage gun'],
  fashion_men: ['panjabi', 't shirt', 'polo shirt', 'jeans pant'],
  fashion_women: ['three piece', 'saree', 'kurti', 'hijab', 'borka'],
  fashion: ['panjabi', 'three piece', 'saree', 't shirt'],
  digital: ['free fire diamond', 'gift card'],
};
const ALWAYS = ['remote', 'components', 'tools']; // what the shop is known for, whatever is in stock
const MAX_AUTO = 60;
const MAX_ALL = 150;
const READ_AGAIN_H = 20; // a word is read again after this many hours

export function cleanTerm(s: unknown) {
  return String(s ?? '').normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}\p{M}\s.+-]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
}
/** words used to find the word in our products / other shops ("price", "bd" … say nothing about the product) */
const STOP = new Set(['price', 'in', 'bd', 'bangladesh', 'best', 'for', 'the', 'buy', 'online', 'shop', 'dam', 'দাম', 'new', 'and', 'with', 'of', 'a', 'set']);
export function termWords(term: string) {
  const ws = cleanTerm(term).split(' ').filter((w) => w && !STOP.has(w));
  return ws.length ? ws.slice(0, 5) : cleanTerm(term).split(' ').slice(0, 3);
}
// searches that come with a word but are not about buying the product ("yes bank share price" with "power bank")
const JUNK = /\b(share|shares|stock market|news|jobs?|salary|results?|movie|song|lyrics|login|apk|download|work|meaning|loan|statement|ltd|limited|company)\b/i;
/** Is a related search about this product? It has one of the word's own words (at a word's start) and no junk. */
export function relevant(query: string, term: string) {
  const q = cleanTerm(query);
  if (!q || JUNK.test(q)) return false;
  const ws = termWords(term);
  const hits = ws.filter((w) => new RegExp(`(^|[^a-z0-9])${w.replace(/[.+\-]/g, (c) => `\\${c}`)}`, 'i').test(q)).length;
  return hits >= 1;
}
/** Each word as a Postgres pattern (~*): English words start at a word's start ("ac" is not inside "pack"), short
 *  ones (≤3 letters) must be the whole word ("ips" is not "chips"); Bangla words match anywhere. */
export function wordPatterns(term: string) {
  return termWords(term).map((w) => {
    const e = w.replace(/[.+\-]/g, (c) => `\\${c}`);
    if (!/^[a-z0-9.+-]+$/.test(w)) return e;
    return w.length <= 3 ? `(^|[^a-z0-9])${e}($|[^a-z0-9])` : `(^|[^a-z0-9])${e}`;
  });
}

/** The automatic words: the groups the shop sells (by its own product names) + what customers searched for here. */
async function autoTerms(): Promise<string[]> {
  const names = await q<{ name: string }>(`SELECT name FROM products WHERE active AND parent_id IS NULL LIMIT 5000`).catch(() => []);
  const count: Record<string, number> = {};
  for (const p of names) { const g = segmentOf(p.name, '', 'other'); count[g] = (count[g] || 0) + 1; }
  const groups = Object.entries(count).filter(([g, n]) => n >= 3 && SEEDS[g]).sort((a, b) => b[1] - a[1]).map(([g]) => g);
  for (const g of ALWAYS) if (!groups.includes(g)) groups.push(g);
  const out: string[] = [];
  const add = (t: string) => { const c = cleanTerm(t); if (c.length >= 2 && !out.includes(c)) out.push(c); };
  // customers' own searches first (people really typed them), English letters, 2+ people in 30 days
  const searched = await q<{ term: string }>(`SELECT lower(trim(label)) AS term FROM visit_events
      WHERE event='search' AND label <> '' AND created_at > now() - interval '30 days'
      GROUP BY 1 HAVING count(DISTINCT visitor_id) >= 2 ORDER BY count(DISTINCT visitor_id) DESC LIMIT 12`).catch(() => []);
  for (const s of searched) if (/^[a-z0-9 .+-]{3,40}$/.test(s.term)) add(s.term);
  // then each group's words, a few from every group in turn so all groups get a place
  const lists = groups.map((g) => [...SEEDS[g]]);
  while (out.length < MAX_AUTO && lists.some((l) => l.length)) for (const l of lists) { const t = l.shift(); if (t) add(t); if (out.length >= MAX_AUTO) break; }
  return out;
}

/** Keep the automatic words current (once a day): new ones come in, hidden ones stay hidden, the owner's stay. */
export async function syncTerms({ force = false } = {}) {
  const day = `${new Date().toISOString().slice(0, 10)}#2`; // (#2: the list's rules changed — made again at once)
  const last = await one<{ value: string }>(`SELECT value FROM settings WHERE key='gtrends_terms_day'`);
  if (!force && last?.value === day) return;
  const want = await autoTerms();
  for (const t of want) await q(`INSERT INTO trend_terms(term, origin) VALUES($1, 'auto') ON CONFLICT (term) DO NOTHING`, [t]);
  if (want.length >= 10) await q(`DELETE FROM trend_terms WHERE origin='auto' AND NOT hidden AND NOT (term = ANY($1))`, [want]);
  await setSetting('gtrends_terms_day', day);
}

export async function addTerm(input: string): Promise<{ id: number; term: string; isNew: boolean }> {
  const term = cleanTerm(input);
  if (term.length < 2) throw new Error('অন্তত ২ অক্ষরের শব্দ লিখুন।');
  const had = await one<{ id: number; hidden: boolean }>(`SELECT id, hidden FROM trend_terms WHERE term=$1`, [term]);
  if (had) { if (had.hidden) await q(`UPDATE trend_terms SET hidden=false, origin='owner' WHERE id=$1`, [had.id]); return { id: had.id, term, isNew: false }; }
  const n = await one<{ n: number }>(`SELECT count(*)::int AS n FROM trend_terms WHERE NOT hidden`);
  if ((n?.n || 0) >= MAX_ALL) throw new Error(`তালিকায় ${bn(MAX_ALL)}টির বেশি শব্দ রাখা যায় না — কম দরকারি কিছু সরিয়ে দিন।`);
  const r = await one<{ id: number }>(`INSERT INTO trend_terms(term, origin) VALUES($1, 'owner') RETURNING id`, [term]);
  return { id: r!.id, term, isNew: true };
}
export async function setHidden(id: number, hidden: boolean) { await q(`UPDATE trend_terms SET hidden=$2 WHERE id=$1`, [id, hidden]); }

// ---------------------------------------------------------------- reading Google Trends
type FetchFn = (url: string, opts?: SafeFetchOpts) => Promise<Fetched>;
let fetchImpl: FetchFn = (url, opts) => safeFetch(url, opts);
export function setFetch(fn?: FetchFn | null) { fetchImpl = fn || ((url, opts) => safeFetch(url, opts)); cookie = { v: '', at: 0 }; }
const HOST = 'https://trends.google.com';
let cookie = { v: '', at: 0 };
class Blocked extends Error {}
let gap = 1200; // a short wait between Google's requests, like a person clicking
export function setGap(ms: number) { gap = ms; }
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Google's answers start with ")]}'," so no page can run them — the JSON is what follows. */
export function parseGoogleJson<T = unknown>(text: string): T {
  const i = text.indexOf('{');
  if (i < 0) throw new Error('Google-এর উত্তর বোঝা যায়নি');
  return JSON.parse(text.slice(i)) as T;
}

async function getText(url: string): Promise<string> {
  if (!(await allowed(url))) throw new Error('Google এই তথ্য রোবটকে পড়তে দেয় না');
  const r = await fetchImpl(url, { maxBytes: 3 * 1024 * 1024, timeoutMs: 15000, accept: 'application/json,text/plain,*/*', headers: cookie.v ? { Cookie: cookie.v } : {} });
  if (r.status === 429) throw new Blocked('Google বলছে "একটু পরে" (429)');
  if (!r.ok) throw new Error(`Google উত্তর দিয়েছে ${r.status}`);
  return r.body.toString('utf8');
}
async function ensureCookie() {
  if (cookie.v && Date.now() - cookie.at < 3600e3) return;
  try {
    const r = await fetchImpl(`${HOST}/trends/?geo=BD`, { maxBytes: 2 * 1024 * 1024, timeoutMs: 12000, accept: 'text/html,*/*' });
    const set = r.headers['set-cookie'];
    const list = Array.isArray(set) ? set : set ? [String(set)] : [];
    const v = list.map((c) => c.split(';')[0]).filter((c) => /^NID=/.test(c)).join('; ');
    cookie = { v, at: Date.now() };
  } catch (_) { cookie = { v: '', at: Date.now() }; }
}

type Widget = { id: string; token: string; request: unknown };
type Point = { time: string; value: number[]; isPartial?: boolean; hasData?: boolean[] };
type Ranked = { query: string; value: number; formattedValue?: string };
export type Week = { t: number; v: number };
export type Related = { query: string; value: string };
export type Read = { series: Week[]; top: Related[]; rising: Related[] };

export function readSeries(text: string): Week[] {
  const j = parseGoogleJson<{ default?: { timelineData?: Point[] } }>(text);
  return (j.default?.timelineData || []).filter((p) => !p.isPartial).map((p) => ({ t: Number(p.time) * 1000, v: Number(p.value?.[0]) || 0 })).filter((p) => p.t > 0);
}
export function readRelated(text: string): { top: Related[]; rising: Related[] } {
  const j = parseGoogleJson<{ default?: { rankedList?: { rankedKeyword?: Ranked[] }[] } }>(text);
  const list = (k: number) => (j.default?.rankedList?.[k]?.rankedKeyword || []).slice(0, 15)
    .map((x) => ({ query: cleanTerm(x.query).slice(0, 80), value: String(x.formattedValue ?? x.value ?? '').slice(0, 20) })).filter((x) => x.query);
  return { top: list(0), rising: list(1) };
}

/** One word from Google: 12 months week by week for Bangladesh, and the searches that go with it. */
export async function readTerm(term: string): Promise<Read> {
  await ensureCookie();
  const req = { comparisonItem: [{ keyword: term, geo: 'BD', time: 'today 12-m' }], category: 0, property: '' };
  const ex = parseGoogleJson<{ widgets?: Widget[] }>(await getText(`${HOST}/trends/api/explore?hl=en-US&tz=-360&req=${encodeURIComponent(JSON.stringify(req))}`));
  const w = (id: string) => (ex.widgets || []).find((x) => x.id === id);
  const ts = w('TIMESERIES');
  if (!ts) throw new Error('Google এই শব্দের তথ্য দেয়নি');
  const data = (x: Widget, kind: string) => getText(`${HOST}/trends/api/widgetdata/${kind}?hl=en-US&tz=-360&req=${encodeURIComponent(JSON.stringify(x.request))}&token=${encodeURIComponent(x.token)}`);
  await pause(gap);
  const series = readSeries(await data(ts, 'multiline'));
  let rel = { top: [] as Related[], rising: [] as Related[] };
  const rq = w('RELATED_QUERIES');
  if (rq) { await pause(gap); try { rel = readRelated(await data(rq, 'relatedsearches')); } catch (caught) { if (caught instanceof Blocked) throw caught; } }
  return { series, ...rel };
}

// ---------------------------------------------------------------- the numbers
export type Stats = { now: number; month: number; prev: number; year: number; change: number | null; vsYear: number | null; peaks: number[]; low: boolean };
const avg = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
const dhakaMonth = (t: number) => new Date(t + 6 * 3600e3).getUTCMonth();
/** weeks → this fortnight, last 4 weeks, the 4 weeks before, the year; % change; the months that were highest */
export function stats(series: Week[]): Stats {
  const v = series.map((p) => p.v);
  const now = avg(v.slice(-2)), month = avg(v.slice(-4)), prev = avg(v.slice(-8, -4)), year = avg(v);
  const zeros = v.filter((x) => x === 0).length;
  const low = v.length < 20 || year < 3 || zeros > v.length * 0.35;
  const change = prev >= 2 ? Math.round(((month - prev) / prev) * 100) : null;
  const vsYear = year >= 2 ? Math.round(((month - year) / year) * 100) : null;
  const byMonth = new Map<number, number[]>();
  for (const p of series) { const m = dhakaMonth(p.t); if (!byMonth.has(m)) byMonth.set(m, []); byMonth.get(m)!.push(p.v); }
  const months = [...byMonth.entries()].map(([m, xs]) => ({ m, a: avg(xs) })).sort((a, b) => b.a - a.a);
  const peaks = low ? [] : months.filter((x) => x.a >= year * 1.3 && x.a >= year + 5).slice(0, 3).map((x) => x.m).sort((a, b) => a - b);
  const r = (x: number) => Math.round(x * 10) / 10;
  return { now: r(now), month: r(month), prev: r(prev), year: r(year), change, vsYear, peaks, low };
}

// ---------------------------------------------------------------- one round of the timer
const BLOCK_KEY = 'gtrends_wait';
export async function blockedUntil(): Promise<number> {
  const r = await one<{ value: string }>(`SELECT value FROM settings WHERE key=$1`, [BLOCK_KEY]);
  return Number(r?.value) || 0;
}

/** Read one word now and save it. Returns false when Google asked to wait. */
export async function refresh(id: number): Promise<{ ok: boolean; error?: string }> {
  const t = await one<{ id: number; term: string }>(`SELECT id, term FROM trend_terms WHERE id=$1`, [id]);
  if (!t) return { ok: false, error: 'শব্দটা আর নেই' };
  const wait = await blockedUntil();
  if (wait > Date.now()) return { ok: false, error: 'Google একটু বিরতি চেয়েছে — কিছু পরে নিজে থেকে পড়া হবে' };
  try {
    const r = await readTerm(t.term);
    r.top = r.top.filter((x) => relevant(x.query, t.term));
    r.rising = r.rising.filter((x) => relevant(x.query, t.term));
    const s = stats(r.series);
    await q(`UPDATE trend_terms SET series=$2, top=$3, rising=$4, now_v=$5, month_v=$6, prev_v=$7, year_v=$8, change=$9, vs_year=$10,
        peaks=$11, low=$12, fetched_at=now(), ok_at=now(), error='' WHERE id=$1`,
      [id, JSON.stringify(r.series), JSON.stringify(r.top), JSON.stringify(r.rising), s.now, s.month, s.prev, s.year, s.change, s.vsYear, s.peaks.join(','), s.low]);
    for (const x of r.rising) {
      await q(`INSERT INTO trend_rising(term_id, query, value) VALUES($1, $2, $3)
        ON CONFLICT (term_id, query) DO UPDATE SET value=EXCLUDED.value, last_seen=now()`, [id, x.query, x.value]);
    }
    await q(`DELETE FROM settings WHERE key='gtrends_backoff'`);
    return { ok: true };
  } catch (caught) {
    const e = caught as Caught;
    const msg = String(e.message || e).slice(0, 200);
    if (caught instanceof Blocked) {
      const b = await one<{ value: string }>(`SELECT value FROM settings WHERE key='gtrends_backoff'`);
      const hours = Math.min(24, Math.max(2, (Number(b?.value) || 1) * 2));
      await setSetting('gtrends_backoff', String(hours));
      await setSetting(BLOCK_KEY, String(Date.now() + hours * 3600e3));
    }
    await q(`UPDATE trend_terms SET fetched_at=now(), error=$2 WHERE id=$1`, [id, msg]);
    return { ok: false, error: msg };
  }
}

/** The timer's turn (every 5 minutes): keep the list current, then read the word that waited longest. */
export async function tick(): Promise<{ read?: string; skipped?: string }> {
  if (process.env.CI) return { skipped: 'ci' }; // test runs never knock on Google
  if ((await blockedUntil()) > Date.now()) return { skipped: 'waiting' };
  await syncTerms();
  const t = await one<{ id: number; term: string }>(`SELECT id, term FROM trend_terms WHERE NOT hidden
      AND (fetched_at IS NULL OR fetched_at < now() - make_interval(hours => $1::int)) ORDER BY fetched_at NULLS FIRST, id LIMIT 1`, [READ_AGAIN_H]);
  if (!t) return { skipped: 'all fresh' };
  await refresh(t.id);
  return { read: t.term };
}

// ---------------------------------------------------------------- with the shop's own facts → advice
export type Ours = { n: number; stock: number; price: number | null; cost: number | null; id: number | null; name: string };
export type Market = { shops: number; min: number | null; median: number | null };
export type TermRow = {
  id: number; term: string; origin: string; hidden: boolean; series: Week[] | null; top: Related[] | null; rising: Related[] | null;
  now_v: number | null; month_v: number | null; prev_v: number | null; year_v: number | null; change: number | null; vs_year: number | null;
  peaks: string; low: boolean; fetched_at: Date | null; ok_at: Date | null; error: string;
};
export type View = TermRow & { peakList: number[]; ours: Ours; market: Market; fresh: { query: string; value: string; first_seen: Date }[] };

async function oursFor(term: string): Promise<Ours> {
  const pats = wordPatterns(term);
  const r = await one<{ n: number; stock: number; price: number | null; cost: number | null }>(`SELECT count(*)::int AS n, coalesce(sum(greatest(stock, 0)), 0)::int AS stock,
      min(price)::float AS price, avg(nullif(cost_price, 0))::float AS cost
    FROM products WHERE active AND parent_id IS NULL AND (name ~* ALL($1) OR coalesce(name_bn, '') ~* ALL($1))`, [pats]);
  const top = await one<{ id: number; name: string }>(`SELECT id, name FROM products WHERE active AND parent_id IS NULL
      AND (name ~* ALL($1) OR coalesce(name_bn, '') ~* ALL($1)) ORDER BY (stock > 0) DESC, id DESC LIMIT 1`, [pats]);
  return { n: r?.n || 0, stock: r?.stock || 0, price: r?.price ?? null, cost: r?.cost ?? null, id: top?.id ?? null, name: top?.name || '' };
}
async function marketFor(term: string): Promise<Market> {
  const pats = wordPatterns(term);
  const r = await one<{ shops: number; min: number | null; median: number | null }>(`SELECT count(DISTINCT i.source_id)::int AS shops, min(i.price)::float AS min,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY i.price)::float AS median
    FROM research_items i JOIN research_sources s ON s.id=i.source_id
    WHERE s.active AND i.price > 0 AND i.last_seen > now() - interval '14 days' AND i.title ~* ALL($1)`, [pats]).catch(() => null);
  return { shops: r?.shops || 0, min: r?.min ?? null, median: r?.median ?? null };
}

/** Every word with its numbers, our products and other shops' prices. */
export async function views({ search = '', hidden = false } = {}): Promise<View[]> {
  const s = cleanTerm(search);
  const rows = await q<TermRow>(`SELECT * FROM trend_terms t WHERE hidden=$1 ${s ? `AND (t.term ILIKE $2 OR EXISTS (SELECT 1 FROM trend_rising r WHERE r.term_id=t.id AND r.query ILIKE $2))` : ''}
      ORDER BY (t.ok_at IS NULL), t.low, t.change DESC NULLS LAST, t.term`, s ? [hidden, `%${s}%`] : [hidden]);
  const out: View[] = [];
  for (const r of rows) {
    const fresh = await q<{ query: string; value: string; first_seen: Date }>(`SELECT query, value, first_seen FROM trend_rising
        WHERE term_id=$1 AND last_seen > now() - interval '45 days' ORDER BY first_seen DESC LIMIT 8`, [r.id]);
    out.push({ ...r, top: (r.top || []).filter((x) => relevant(x.query, r.term)), rising: (r.rising || []).filter((x) => relevant(x.query, r.term)), peakList: r.peaks ? r.peaks.split(',').map(Number).filter((x) => x >= 0 && x < 12) : [], ours: await oursFor(r.term), market: await marketFor(r.term), fresh: fresh.filter((x) => relevant(x.query, r.term)) });
  }
  return out;
}

export const BN_MONTHS = ['জানুয়ারি', 'ফেব্রুয়ারি', 'মার্চ', 'এপ্রিল', 'মে', 'জুন', 'জুলাই', 'আগস্ট', 'সেপ্টেম্বর', 'অক্টোবর', 'নভেম্বর', 'ডিসেম্বর'];
export type Advice = { kind: 'stock' | 'push' | 'season' | 'slow' | 'new' | 'price'; score: number; termId: number; term: string; title: string; why: string; todo: string; link?: string; source?: string };
export const pctText = (x: number) => `${x > 0 ? '+' : ''}${bn(x)}%`;
function priceLine(v: Pick<View, 'ours' | 'market'>) {
  const parts: string[] = [];
  if (v.ours.n && v.ours.price) parts.push(`আপনার দাম ${money(v.ours.price)}${v.ours.cost ? `, কেনা ${money(Math.round(v.ours.cost))} (লাভ ${money(Math.round(v.ours.price - v.ours.cost))})` : ''}`);
  if (v.market.shops && v.market.min) parts.push(`${bn(v.market.shops)}টি দোকানে বিক্রি হচ্ছে — সবচেয়ে কম ${money(v.market.min)}${v.market.median ? `, মাঝামাঝি ${money(Math.round(v.market.median))}` : ''}`);
  return parts.join(' · ');
}

/** The day's advice, most useful first. month = the month now (0–11, Dhaka). */
export function advise(list: Pick<View, 'id' | 'term' | 'change' | 'vs_year' | 'month_v' | 'low' | 'peakList' | 'ours' | 'market' | 'fresh' | 'ok_at'>[], month: number, nowMs = Date.now()): Advice[] {
  const out: Advice[] = [];
  const next = (month + 1) % 12;
  for (const v of list) {
    if (!v.ok_at || v.low) continue;
    const ch = v.change ?? 0, price = priceLine(v);
    const has = v.ours.n > 0, inStock = v.ours.stock > 0;
    const pLink = v.ours.id ? `/admin/products/${v.ours.id}` : `/admin/research?tab=find&q=${encodeURIComponent(v.term)}`;
    if (ch >= 25 && (v.month_v ?? 0) >= 8) {
      if (!has) out.push({ kind: 'stock', score: 60 + Math.min(40, ch / 3), termId: v.id, term: v.term, title: `"${v.term}" — গুগলে খোঁজা বেড়েছে ${pctText(ch)}, আপনার দোকানে নেই`, why: price || 'গত মাসের চেয়ে এই মাসে অনেক বেশি মানুষ খুঁজছে।', todo: 'এনে দোকানে তুলুন — নিচের লিংকে কেনা দাম দেখুন।', link: `/admin/research?tab=find&q=${encodeURIComponent(v.term)}`, source: v.term });
      else if (!inStock) out.push({ kind: 'stock', score: 70 + Math.min(30, ch / 3), termId: v.id, term: v.term, title: `"${v.term}" — চাহিদা বেড়েছে ${pctText(ch)}, কিন্তু স্টক শেষ`, why: price, todo: 'এখনই স্টক আনুন — চাহিদার সময় স্টক না থাকলে কাস্টমার অন্য দোকানে চলে যায়।', link: pLink, source: v.term });
      else out.push({ kind: 'push', score: 50 + Math.min(40, ch / 3), termId: v.id, term: v.term, title: `"${v.term}" — চাহিদা বেড়েছে ${pctText(ch)}, আপনার স্টকে আছে (${bn(v.ours.stock)}টি)`, why: price, todo: 'আজ ফেসবুক/ইনস্টাগ্রামে পোস্ট দিন, হোম পেজে সামনে রাখুন — এখন বিক্রির সময়।', link: pLink });
    }
    if (v.peakList.includes(next) && !v.peakList.includes(month)) {
      out.push({ kind: 'season', score: 55, termId: v.id, term: v.term, title: `"${v.term}" — গত বছর ${BN_MONTHS[next]} মাসে খোঁজা সবচেয়ে বেশি ছিল`, why: price || 'আগামী মাসে চাহিদা বাড়তে পারে।', todo: has ? (inStock ? 'স্টক বাড়িয়ে রাখুন আর মাসের শুরুতেই পোস্ট দিন।' : 'মাস শুরুর আগেই স্টক আনুন।') : 'এই মাসেই এনে রাখুন — চাহিদা আসার আগে।', link: pLink, source: has ? undefined : v.term });
    }
    if (ch <= -30 && inStock && v.ours.stock >= 10) {
      out.push({ kind: 'slow', score: 30 + Math.min(20, -ch / 4), termId: v.id, term: v.term, title: `"${v.term}" — খোঁজা কমেছে ${pctText(ch)}, স্টকে ${bn(v.ours.stock)}টি`, why: price, todo: 'এখন বেশি কিনবেন না; জমে থাকলে ছোট অফার বা কম্বো দিন।', link: pLink });
    }
    if (has && v.ours.price && v.market.median && v.market.shops >= 2 && v.ours.price > v.market.median * 1.2 && ch >= 0) {
      out.push({ kind: 'price', score: 35, termId: v.id, term: v.term, title: `"${v.term}" — আপনার দাম বাজারের চেয়ে বেশি`, why: price, todo: 'দাম মিলিয়ে দেখুন — চাহিদা আছে, কিন্তু বেশি দামে কাস্টমার অন্য দোকানে কেনে।', link: pLink });
    }
    for (const f of v.fresh.filter((x) => nowMs - new Date(x.first_seen).getTime() < 8 * 864e5 && (/breakout/i.test(x.value) || Number(x.value.replace(/[^\d]/g, '')) >= 300)).slice(0, 2)) {
      out.push({ kind: 'new', score: 45, termId: v.id, term: v.term, title: `নতুন খোঁজা শুরু: "${f.query}" (${f.value === 'Breakout' ? 'হঠাৎ অনেক বেড়েছে' : f.value})`, why: `"${v.term}" খোঁজার সময় মানুষ এটাও খোঁজে।`, todo: 'জিনিসটা কী দেখুন — চলতি জিনিস হলে এনে রাখুন বা এ নিয়ে পোস্ট/ব্লগ দিন।', link: `/admin/research?tab=find&q=${encodeURIComponent(f.query)}`, source: f.query });
    }
  }
  return out.sort((a, b) => b.score - a.score);
}

export async function status() {
  const r = await one<{ all: number; done: number; today: number; last: Date | null; errors: number }>(`SELECT count(*)::int AS all,
      count(ok_at)::int AS done, count(*) FILTER (WHERE ok_at > now() - interval '24 hours')::int AS today, max(ok_at) AS last,
      count(*) FILTER (WHERE error <> '' AND fetched_at > now() - interval '24 hours')::int AS errors FROM trend_terms WHERE NOT hidden`);
  return { ...(r || { all: 0, done: 0, today: 0, last: null, errors: 0 }), wait: await blockedUntil() };
}

/** For the AI স্টাফ report: the top advice in one line each. */
export async function todayAdvice(limit = 6): Promise<Advice[]> {
  const month = new Date(Date.now() + 6 * 3600e3).getUTCMonth();
  return advise(await views(), month).slice(0, limit);
}
export { sourcingLinks };
