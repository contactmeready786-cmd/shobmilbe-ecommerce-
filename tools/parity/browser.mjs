#!/usr/bin/env node
// Real-browser check of the Next.js pages (the crawl reads HTML; this one runs it): each page must open without a
// script error, React must take the page over without "hydration" trouble, and the shop's / admin's own scripts
// must start (the cart badge, the admin menu button). Runs on a LOCAL test server only.
//   node tools/parity/browser.mjs <base-url> <out-file>
// Needs playwright-core and a Chrome / Chromium (CHROME_PATH, or the runner's google-chrome).
import fs from 'node:fs';
import { chromium } from 'playwright-core';

const [base, outFile] = process.argv.slice(2);
const origin = new URL(base).origin;
const SHOP = ['/', '/products', '/products?cat=arduino', '/p/arduino-uno-r3', '/cart', '/checkout', '/blog', '/track', '/account', '/complaint', '/order/TEST1001', '/kits'];
const ADMIN = ['/admin', '/admin/orders', '/admin/orders/1', '/admin/products', '/admin/products/1', '/admin/customers', '/admin/settings',
  '/admin/design/menus', '/admin/reports', '/admin/marketing/visitors', '/admin/orders/incomplete', '/admin/notify'];

async function form(path, data, cookie = '') {
  const res = await fetch(origin + path, { method: 'POST', redirect: 'manual', body: new URLSearchParams(data),
    headers: { origin, referer: origin + path, 'content-type': 'application/x-www-form-urlencoded', cookie } });
  return res.headers.getSetCookie();
}

const exe = process.env.CHROME_PATH || ['/usr/bin/google-chrome', '/opt/pw-browsers/chromium', '/usr/bin/chromium'].find((p) => fs.existsSync(p));
const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });
const results = [];
let failed = 0;

async function check(ctx, path, admin) {
  const page = await ctx.newPage();
  const problems = [];
  page.on('pageerror', (e) => problems.push('script error: ' + e.message.slice(0, 200)));
  page.on('console', (m) => {
    const t = m.text();
    if (m.type() === 'error' && !/favicon|Failed to load resource|ERR_|net::/.test(t)) problems.push('console: ' + t.slice(0, 200));
    if (/hydrat|did not match|#418|#423|#425/i.test(t)) problems.push('hydration: ' + t.slice(0, 1500));
  });
  const res = await page.goto(origin + path, { waitUntil: 'load', timeout: 120000 }).catch((e) => { problems.push('open: ' + e.message.slice(0, 120)); return null; });
  if (res) {
    await page.waitForTimeout(base.includes(':3301') ? 5000 : 1500);
    const st = await page.evaluate(() => ({ next: !!window.__next_f, hydrated: !!window.__smHydrated, ready: typeof window.smWhenReady === 'function', admin: !!window.__smAdminReady }));
    if (admin && !st.admin) problems.push("admin.js did not start");
    if (st.next && !st.hydrated) problems.push('React never took the page over');
    if (!st.ready) problems.push("the site's own script did not start");
    if (admin && res.status() === 200 && !(await page.$('[data-side-toggle], .admin-bare'))) problems.push('no admin frame');
    if (admin && (await page.$('[data-side-toggle]'))) {
      // the menu button is admin.js's: it must work after React took over
      await page.evaluate(() => document.querySelector('.burger').click());
      const open = await page.evaluate(() => document.body.className);
      if (!/side-(open|hidden)/.test(open)) problems.push('admin menu button does nothing (admin.js not running?)');
    }
  }
  results.push({ path, status: res ? res.status() : 'ERR', problems });
  if (problems.length) failed++;
  await page.close();
}

const shop = await browser.newContext();
for (const p of SHOP) await check(shop, p, false);

// the admin: the owner of the test shop (made by the crawl's set-up), logged in
await form('/admin/setup', { name: 'Test Owner', username: 'owner', password: 'Parity-Test-9271!', password2: 'Parity-Test-9271!' });
const login = await form('/admin/login', { login: 'owner', password: 'Parity-Test-9271!' });
const cookies = login.map((c) => { const [pair] = c.split(';'); const i = pair.indexOf('='); return { name: pair.slice(0, i), value: pair.slice(i + 1), url: origin }; }).filter((c) => c.value);
const adm = await browser.newContext();
await adm.addCookies(cookies);
for (const p of ADMIN) await check(adm, p, true);

await browser.close();
fs.writeFileSync(outFile, JSON.stringify(results, null, 1));
for (const r of results) console.log(`${r.problems.length ? '❌' : '✅'} ${r.path} (${r.status})${r.problems.length ? '\n   ' + r.problems.join('\n   ') : ''}`);
console.log(failed ? `${failed} page(s) with problems` : 'all pages fine in a real browser');
process.exit(failed ? 1 : 0);
