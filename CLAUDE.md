# সবমিলবে — rules for anyone changing this code

## One setup per service — never ask the owner to enter the same thing twice

The owner sets each outside service up **once**, in one admin page. Every feature — today's and any added later —
uses that one setup. Never add a second Gmail / App Password / SMS / API-key field for a new feature.

| Service | The one place it is set | Code every feature must use |
|---|---|---|
| Gmail (all e-mail: order news, customer sign-up codes, delete codes, password-reset links, security alerts, any future code or mail) | Admin → সেটিংস → **আমার নোটিফিকেশন** (`notify_email` + `gmail_app_password`) | `services/notify.ts` → `sendEmail(settings, subject, text, html, to)` |
| SMS (all SMS: checkout OTP, customer login codes, order SMS, any future code) | Admin → মার্কেটিং → কাস্টমারকে মেসেজ → **SMS** | `services/sms.ts` → `send(settings, phone, text, { kind })` |
| WhatsApp to the owner | আমার নোটিফিকেশন | `services/notify.ts` → `sendWhatsApp(settings, text)` |
| Sentry (site error alerts) | আমার নোটিফিকেশন (`sentry_dsn`; `SENTRY_DSN` in Vercel wins if set) | `services/errors.ts` → `report(error, context)` |
| Offer / news e-mail to customers (campaigns, welcome, weekly, review, win-back) | Admin → মার্কেটিং → মেসেজ → **ইমেইল** (Brevo key, or the Gmail above — capped) | `services/mailer.ts` → `sendOne(settings, sub, {...})` — only to people on `email_subs` |

- A new feature that needs to send a code or a mail calls the function above. If the service isn't set up yet,
  the feature shows a link to that one page — it never shows its own credential form.
- `sendEmail` already retries with the older code saved on the customer-accounts page (`acct_gmail_password`)
  when Gmail refuses the main one, and promotes a code that works. Keep that behaviour.
- A new Google code is tested before it is saved (admin/notify.ts), so a wrong code never replaces a working one.

## Other standing rules from the owner
- Product prices: ৳0.50 – ৳2000 only (`util.priceProblem`). ৳10 or more = whole taka.
- Offer SMS (bulk) skip customers with `promo_sms = false` and stay within `sms_mkt_day` / `sms_mkt_month`, so the free SIM plan keeps room for checkout codes.
- Permanent deletes need the e-mailed delete code (`services/delcode.ts`).
- Admin menu: related small pages are tabs (`TABS` in admin/layout.ts), not new menu lines.
- The camera face check was removed on purpose; only the fingerprint / passkey login lock stays.
- Automatic SEO (`services/autoseo.ts`) only fills EMPTY fields, never overwrites or re-adds what the owner wrote or removed,
  logs every change for undo; the auto description is made at page view and never saved over the owner's text.
- Admin script rule (2026-10-17): admin pages run only scripts that carry the page nonce. Every inline `<script>` in an
  admin template is written `<script nonce="${cspNonce()}">` (from `lib/security`), no `onclick="…"`-style handlers and no
  `javascript:` links — use `data-print` / `data-autosubmit` / `data-back` (public/js/page-actions.js) or admin.js.
  `tests/admin-scripts.test.ts` fails otherwise. Blocked scripts show up on Admin → সার্ভার ও ডাটাবেস (error list).
- Tests (2026-10-17): every change must pass `.github/workflows/tests.yml` (typecheck + `npm test` + build) before it
  goes to main. New money, OTP, order or security code gets a test in `tests/`. Database tests (`*.db.test.ts`) run only on
  `TEST_DATABASE_URL` (a throw-away Postgres) and refuse Supabase/Neon addresses. SMS in tests goes through
  `sms.setFakeSender`.
- The database certificate is checked with the bundled Supabase root (lib/data/supabase-ca.ts, valid to 2031-04-26);
  if a check ever fails the shop keeps running encrypted-unchecked and the owner is e-mailed — never remove that net.

## ⚛️ React (2026-10-17)
- Every shop and admin page is rendered by React. Hand-written components live in `components/` (shop: Pages, Complaint,
  Account); the rest of `lib/admin/*.tsx` and `lib/views/*.tsx` is JSX made by `tools/html2jsx.ts` from the old
  html`…` templates, rendered with `toHtml(<…/>)` from `lib/react/render.tsx`. The router, security gate, country lock,
  admin login and caching live in `lib/site.ts` (served through the App-Router route `app/api/site`; its text pages
  load react-dom/server lazily — lib/react/render.tsx `loadRenderer()` — because Next.js refuses it imported up front).
- New UI is JSX. Values from old helpers that return Raw go in as `<Val v={…}/>`; ready-made HTML as `<RawHtml html={…}/>`.
  Don't write new html`…` in lib/admin or lib/views (tests/admin-scripts.test.ts counts them). Page frames
  (<html>/<head>) stay as text on purpose — React 19 would reorder the head. <link>/<meta>/<title>/async <script> in a
  page body are written through RawHtml for the same reason (the converter does this).
- Moving a page: record the old page first (copy to lib/views/__old_<name>.ts, add cases to tests/fixtures/cases.ts,
  `npx tsx tools/make-golden.ts`), then change it; tests/react-views.test.ts must stay green. Every push to the
  `nextjs-migration` branch runs tools/parity: all ~560 pages of a seeded shop compared with main (must be 0 differences,
  actions identical) — only then merge to main.
- Next.js App Router (started 2026-10-17): customer pages move one by one into `app/(shop)/` (Next.js pages with
  `generateMetadata` → lib/next/meta.ts). `lib/next/routes.ts` lists the addresses already served there; proxy.ts runs
  the shop's front gate (`lib/gate.ts`: blocked IPs, hacking checks, country lock, blocked bots) for them and adds the
  security headers. Everything else still goes to lib/site.ts (app/api/site), which uses the same gate helpers and
  the same React frame (`components/shop/chrome`). Page data loads through `lib/next/loaders.ts` / `shop-data.ts`.
- Don't call notFound() to show a missing item: Next.js serves an empty page for it (github.com/vercel/next.js/issues/99793).
  Add the address to `drawableHere()` in lib/next/loaders.ts — proxy.ts then sends it to the shop's real 404 page.
- A page that moved is drawn by one shared function both routers call (lib/shop/router.tsx: home/lists/products;
  lib/shop/more.tsx: live, cart, wishlist, compare, checkout, kits, order pages; lib/shop/blog.tsx: articles;
  lib/shop/forms.tsx: account, complaint, return, gift card) — change it there, once.
  A form sent to an address that has a Next.js page still goes to lib/site.ts (proxy.ts, `hasNextPage`).
- public/js/shop.js and i18n.js start after React has taken over a Next.js page (`smWhenReady`, components/shop/chrome/Hydrated.tsx).
- tests/chrome.test.ts keeps the page frame identical to the old one (tests/golden/chrome-*.html).
- Admin in Next.js (2026-10-17): every admin GET page is drawn by app/(admin)/admin/[[...path]] — lib/next/admin.ts runs
  the admin's own handler (lib/admin, unchanged) with `drawPage` catching the page's pieces, and the React frame
  (AdminBody / AdminBare in lib/admin/layout.tsx; tests/admin-frame.test.ts) draws them. proxy.ts makes the nonce and the
  script rule (lib/security adminHeaders) and runs the admin's front checks (lib/gate.ts adminGateOk). Forms (POST),
  /admin/api, files and exports stay with lib/site.ts (`ADMIN_SITE` in lib/next/routes.ts); a handler that answers
  with anything but a page is sent there too (?__site=1). After adding or changing an admin route run
  `npx tsx tools/gen-admin-routes.ts` (lib/next/admin-routes.ts; tests/routes.test.ts checks it).
- Pieces made with toHtml (lib/react/html) stay React; only lib/site.ts can turn them into text (`.s`). In code a
  Next.js page runs, never use a piece as text (String(x), `${x}`, attrProps(toHtml(…))) — keep it React (Val, or
  insertAfterTag to put something under a heading). RawHtml picks a wrapper the browser keeps in place (text / g / span / div).
- Shop APIs, pictures, robots/sitemap/feeds, e-mail counters, payments, webhooks and the scheduled jobs are Next.js
  route handlers (app/api/…, app/media, app/pay, app/webhook …) with their code in lib/api/*.ts; `apiRoute()`
  (lib/next/api.ts) runs the shop's gate first (`{ bots: false }` for pictures and robots.txt). A method or address a
  route doesn't handle goes to the original code (`otherMethods` / `toSite`), so its answer stays exactly the same.
  What is left in lib/site.ts (app/api/site → siteAnswer(Request) → Response): shop and admin form POSTs, /admin/api
  and the admin's files, the shop's 404 / redirect answers, the country-lock page, verification files.
- Handlers answer through ctx.send(status, body, type?, headers?) / ctx.json(status, data) / ctx.redirect(to) and, for a
  file, ctx.reply.answer(status, headers, body) (lib/reply.ts → a Web Response). There is no Node req/res anywhere:
  ctx.req is a plain object (headers, url, method, socket.remoteAddress, the body text).
- Database: only a dropped connection is retried (lib/pg isConnectionError); an order is retried on a deadlock (db.txRetry).
  Tests run one file at a time (`--test-concurrency=1`): the database tests share one throw-away database.
- tools/parity/browser.mjs opens the Next.js pages in a real browser on every parity run: no script errors, React takes
  over without hydration trouble, shop.js / admin.js start. It names any HTML the browser had to re-arrange.
