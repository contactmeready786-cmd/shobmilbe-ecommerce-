#!/usr/bin/env node
// Real-browser check of the Next.js pages (the crawl reads HTML; this one runs it): each page must open without a
// script error, React must take the page over without "hydration" trouble, and the shop's / admin's own scripts
// must start (the cart badge, the admin menu button), and the form fields must still change (tick / untick, type).
// Runs on a LOCAL test server only.
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

// React draws exactly the HTML it sent; if the browser had to re-arrange that HTML while reading it (a <div> inside a
// <p>, a <form> inside a <form> …), React finds a different page. This finds the first place where that happened.
async function whereHtmlWasFixed(page) {
  return page.evaluate(async () => {
    const raw = await (await fetch(location.href, { credentials: 'include' })).text();
    const body = (raw.match(/<body[^>]*>([\s\S]*)<\/body>/) || [, ''])[1].replace(/<(script|style)\b[\s\S]*?<\/\1>/g, '');
    const parsed = new DOMParser().parseFromString('<!doctype html><html><body>' + body + '</body></html>', 'text/html').body.innerHTML;
    const VOID = /^(area|base|br|col|embed|hr|img|input|link|meta|source|track|wbr)$/i;
    const tags = (h) => [...h.matchAll(/<(\/?)([a-zA-Z][\w-]*)/g)].filter((m) => !VOID.test(m[2])).map((m) => ({ t: m[1] + m[2].toLowerCase(), i: m.index }));
    const a = tags(body), b = tags(parsed);
    for (let k = 0; k < Math.min(a.length, b.length); k++) {
      if (a[k].t !== b[k].t) return `sent <${a[k].t}> where the browser has <${b[k].t}>: …${body.slice(Math.max(0, a[k].i - 300), a[k].i + 120)}…`;
    }
    return a.length === b.length ? 'the HTML itself is not re-arranged (text differs?)' : `tag count ${a.length} vs ${b.length}`;
  }).catch((e) => 'could not check: ' + e.message);
}

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
    // form fields must still change after React took over (a field React "controls" snaps back: a ticked box that can't be
    // unticked, a text box you can't type in). Forms are kept from being sent while trying.
    if (st.next) {
      const stuck = await page.evaluate(() => {
        HTMLFormElement.prototype.submit = function () {}; HTMLFormElement.prototype.requestSubmit = function () {};
        document.addEventListener('submit', (e) => e.preventDefault(), true);
        window.fetch = () => new Promise(() => {});
        const name = (el) => el.name || el.id || el.outerHTML.slice(0, 90);
        const out = [];
        for (const b of [...document.querySelectorAll('input[type=checkbox]')].filter((x) => !x.disabled).slice(0, 12)) {
          const was = b.checked; b.click();
          if (b.checked === was) out.push(`a ${was ? 'ticked' : 'unticked'} box can't be changed: ${name(b)}`);
          else b.click();
        }
        const texts = [...document.querySelectorAll('input:not([type]), input[type=text], input[type=search], input[type=number], input[type=email], input[type=tel], textarea')]
          .filter((x) => !x.disabled && !x.readOnly).slice(0, 8);
        for (const t of texts) {
          const was = t.value;
          // a number inside the box's own limits (the shop's script keeps a quantity within the stock)
          let want = was + 'x';
          if (t.type === 'number') {
            const lo = t.min !== '' ? Number(t.min) : 0; const hi = t.max !== '' ? Number(t.max) : lo + 10;
            const pick = [lo, lo + 1, hi].find((v) => v >= lo && v <= hi && String(v) !== was);
            if (pick === undefined) continue;
            want = String(pick);
          }
          t.value = want; t.dispatchEvent(new Event('input', { bubbles: true })); t.dispatchEvent(new Event('change', { bubbles: true }));
          if (t.value !== want) out.push(`a text box snaps back when typed in: ${name(t)}`);
          t.value = was;
        }
        return out;
      }).catch((e) => ['could not try the form fields: ' + e.message.slice(0, 120)]);
      problems.push(...stuck);
    }
    if (admin && (await page.$('[data-side-toggle]'))) {
      // the menu button is admin.js's: it must work after React took over
      // (the choice is remembered between pages, so the class may go either way — it must change)
      const before = await page.evaluate(() => document.body.className);
      await page.evaluate(() => document.querySelector('.burger').click());
      const after = await page.evaluate(() => document.body.className);
      if (before === after) problems.push('admin menu button does nothing (admin.js not running?)');
    }
  }
  if (problems.some((p) => /#418|hydration/.test(p))) problems.push('where: ' + (await whereHtmlWasFixed(page)));
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
