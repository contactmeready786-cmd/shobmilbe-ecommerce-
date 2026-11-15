// 🧪 How many visitors can the shop serve at once? (owner, 2026-11-15) — run by .github/workflows/loadtest.yml at night.
// Opens real shop pages (home, lists, product pages from the sitemap, search) with more and more visitors at the same
// time, each one opening a page, waiting a moment and opening the next, like a person browsing. Every step runs a
// little while; the test stops by itself as soon as pages get slow (95% slower than 4 s) or fail (more than 2%), so
// the shop is never pushed over. Nothing is bought or written: only GET pages.
// Usage: node tools/loadtest.mjs https://shobmilbe.com [maxVisitors=200]
const BASE = (process.argv[2] || 'https://shobmilbe.com').replace(/\/$/, '');
const MAX = Number(process.argv[3] || 200);
const STEPS = [5, 10, 25, 50, 75, 100, 150, 200, 300].filter((n) => n <= MAX);
const SECONDS = 30;
const THINK_MS = 1000; // a "visitor" here waits 1 s between pages — a real shopper waits 10–30 s, see the summary
const UA = 'Mozilla/5.0 (shobmilbe load test; owner-approved)';

async function urls() {
  const list = ['/', '/products', '/products?q=remote', '/products?q=ব্যাটারি', '/products?sort=new'];
  try {
    const xml = await (await fetch(`${BASE}/sitemap.xml`, { headers: { 'User-Agent': UA } })).text();
    let locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    const sub = locs.filter((u) => u.endsWith('.xml'));
    for (const s of sub.slice(0, 3)) {
      const x = await (await fetch(s, { headers: { 'User-Agent': UA } })).text();
      locs = locs.concat([...x.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]));
    }
    const pages = locs.filter((u) => !u.endsWith('.xml') && u.startsWith(BASE)).map((u) => u.slice(BASE.length) || '/');
    const products = pages.filter((p) => p.startsWith('/p/')).sort(() => Math.random() - 0.5).slice(0, 40);
    const cats = pages.filter((p) => p.startsWith('/products?cat=') || p.startsWith('/brand/')).slice(0, 15);
    return list.concat(products, products, cats); // product pages twice as often, like real traffic
  } catch (e) {
    console.log('sitemap not read:', e.message);
    return list;
  }
}

const pct = (arr, p) => { if (!arr.length) return 0; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function step(n, pages) {
  const times = []; let fails = 0; let codes = {};
  const end = Date.now() + SECONDS * 1000;
  async function visitor() {
    await sleep(Math.random() * THINK_MS);
    while (Date.now() < end) {
      const path = pages[Math.floor(Math.random() * pages.length)];
      const t = Date.now();
      try {
        const r = await fetch(BASE + path, { headers: { 'User-Agent': UA, 'Accept-Language': 'bn' }, signal: AbortSignal.timeout(15000) });
        await r.arrayBuffer();
        codes[r.status] = (codes[r.status] || 0) + 1;
        if (r.status >= 500 || r.status === 429 || r.status === 403) fails++;
        times.push(Date.now() - t);
      } catch { fails++; times.push(15000); codes.timeout = (codes.timeout || 0) + 1; }
      await sleep(THINK_MS);
    }
  }
  await Promise.all(Array.from({ length: n }, visitor));
  const total = times.length;
  return { n, total, perSec: +(total / SECONDS).toFixed(1), p50: pct(times, 0.5), p95: pct(times, 0.95), failPct: +((fails / Math.max(1, total)) * 100).toFixed(1), codes };
}

const pages = await urls();
console.log(`${pages.length} addresses, steps ${STEPS.join(', ')}, ${SECONDS}s each`);
const rows = [];
let best = null;
for (const n of STEPS) {
  const r = await step(n, pages);
  rows.push(r);
  console.log(JSON.stringify(r));
  const ok = r.p95 <= 4000 && r.failPct <= 2;
  if (ok) best = r;
  if (!ok) { console.log(`stopped at ${n}: pages got slow or failed`); break; }
  await sleep(10000); // let the server breathe between steps
}
let md = `## 🧪 Load test ${new Date().toISOString()}\n\n| visitors at once (1 page/s each) | pages / s | median | 95% under | failed |\n|---|---|---|---|---|\n`;
for (const r of rows) md += `| ${r.n} | ${r.perSec} | ${r.p50} ms | ${r.p95} ms | ${r.failPct}% ${JSON.stringify(r.codes)} |\n`;
if (best) {
  md += `\n**Comfortable: ${best.perSec} pages per second** (${best.n} test visitors, 95% of pages under ${best.p95} ms).\n`;
  md += `A real shopper opens a page about every 15 s, so this is roughly **${Math.round(best.perSec * 15)} real shoppers browsing at the same moment**.\n`;
}
console.log(md);
if (process.env.GITHUB_STEP_SUMMARY) (await import('node:fs')).appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
(await import('node:fs')).writeFileSync('loadtest-result.md', md);
