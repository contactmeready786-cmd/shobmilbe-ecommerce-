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
- Product cards (owner, 2026-10-20 and again 2026-10-22 — don't break it again): EVERY card looks the same, with
  "কার্টে যোগ করুন" + "এখনই কিনুন" — also pack products (adding puts the smallest pack in the cart; the cart/checkout
  switch packs) and products with colours/sizes (the buttons open the product page at `#choose`, where colour → size →
  pack is picked). Never a different card button such as "অপশন বাছুন".
- Offer SMS (bulk) skip customers with `promo_sms = false` and stay within `sms_mkt_day` / `sms_mkt_month`, so the free SIM plan keeps room for checkout codes.
- Permanent deletes need the e-mailed delete code (`services/delcode.ts`).
- Admin menu: related small pages are tabs (`TABS` in lib/admin/layout.tsx), not new menu lines.
- The camera face check was removed on purpose; only the fingerprint / passkey login lock stays.
- 📱 Android app releases (owner, 2026-10-20 — never ask the owner again): every change to the customer app that customers
  should get MUST raise `appVersionCode` and `appVersionName` in android/gradle.properties AND set the same version in
  lib/app-release.ts and client/app-release.ts (tests/app-release.test.ts fails otherwise). The "android" workflow then
  signs both apps with the owner's key (repository secrets ANDROID_KEYSTORE_B64 + ANDROID_KEY_PASS) and publishes them
  itself (android/publish.sh): the customer app becomes the latest GitHub release `app-v<version>` (file `shobmilbe.apk`)
  that the shop's download button opens (/app → /app/download → …/releases/latest/download/shobmilbe.apk), older customer
  releases are deleted; the admin app is a private draft release `admin-v<version>`. Older apps then show "নতুন সংস্করণ
  এসেছে" (client/shop/appinvite.tsx) and /app says so. Check the workflow's "Sign and publish" step after merging; if it
  warns that the key is missing, tell the owner. Never put the key or its password in the repository (it is public).
  The APK is served by GitHub, not by the web host, so it keeps working when the shop moves off Vercel (the repo must
  stay public for that link; if it ever goes private, move the file to the new host first).
  ⚠️ As of 2026-10-20 the owner chose NOT to put the key in the secrets, so the workflow only warns and nothing is
  published there. Until that changes, the app is served from the shop itself: the signed file is
  public/downloads/shobmilbe-v<version>.apk and lib/app-release.ts `file` points to it. For a new version: ask the
  owner for shobmilbe-release-2026.jks + its password note, sign the workflow's unsigned APK (android-builds branch)
  with apksigner, put the new file in public/downloads/ and DELETE the old one, update both app-release.ts files, and
  hand the signed admin APK to the owner. Delete your copies of the key afterwards. (A session cannot set repository
  secrets or create GitHub releases itself.)
- Automatic SEO (`services/autoseo.ts`) only fills EMPTY fields, never overwrites or re-adds what the owner wrote or removed,
  logs every change for undo; the auto description is made at page view and never saved over the owner's text.
- Admin script rule (2026-10-17): admin pages run only scripts that carry the page nonce. Every inline `<script>` in an
  admin template is written `<script nonce="${cspNonce()}">` (from `lib/security`), no `onclick="…"`-style handlers and no
  `javascript:` links — use `data-print` / `data-autosubmit` / `data-back` (client/admin/page-actions.ts) or client/admin.
  `tests/admin-scripts.test.ts` fails otherwise. Blocked scripts show up on Admin → সার্ভার ও ডাটাবেস (error list).
- Tests (2026-10-17): every change must pass `.github/workflows/tests.yml` (typecheck + `npm test` + build) before it
  goes to main. New money, OTP, order or security code gets a test in `tests/`. Database tests (`*.db.test.ts`) run only on
  `TEST_DATABASE_URL` (a throw-away Postgres) and refuse Supabase/Neon addresses. SMS in tests goes through
  `sms.setFakeSender`.
- The database certificate is checked with the bundled Supabase root (lib/data/supabase-ca.ts, valid to 2031-04-26);
  if a check ever fails the shop keeps running encrypted-unchecked and the owner is e-mailed — never remove that net.

## ⚛️ React + Next.js (2026-10-18: the whole site)
- Every shop and admin page is React. Pages and their pieces live in `components/` (hand-written: Pages, Complaint,
  Account, the page frames) and `lib/views/*.tsx`, `lib/admin/*.tsx`, `lib/shop/*.tsx` (React components and functions
  that return JSX). There are no html`…` templates, no toHtml wrapper and no attribute snippets any more
  (tests/admin-scripts.test.ts stops them coming back).
- A piece stays React all the way. HTML text is made only where text is really needed, with `renderHtml(piece)` from
  lib/react/html: the whole pages lib/site.ts answers (its frames are text on purpose — React 19 would reorder the
  head), the print pages (invoice, checklist, labels, memo, VAT: text frame + `${htmlValue(x)}` for each value), the
  product cards the shop's API sends as HTML. renderHtml needs lib/react/render's `loadRenderer()` (Next.js refuses
  react-dom/server imported up front; route handlers load it lazily). Never write a piece into text with String(x),
  `${x}` or x + '' — that is "[object Object]"; tests run with SM_STRICT_PIECES=throw and the parity run with =1, so it
  is caught and named (SM_PIECE_AS_TEXT).
- Values whose type isn't known (database rows, settings) are shown with `<Val v={x}/>` (text escaped; the shop's own
  ready-made HTML — `raw(…)`, a `Raw` — as HTML) and put into attributes with `attrValue(x)`. Known text, numbers and
  pieces go in directly: `{x}`. Ready-made HTML strings (owner-written content, the shop's own markup) go in as
  `<RawHtml html={…}/>`.
- Form fields stay the visitor's to change: a box ticked from the start is `defaultChecked`, a filled box
  `defaultValue` (React holds a `checked` / `value` field fixed once it takes the page over). ui.input / ui.textarea /
  ui.select take HTML-style attributes ({ maxlength, class, required }) and make React props of them.
- tests/golden holds pages as they were before they moved to React; tests/react-views.test.ts and tests/chrome.test.ts
  keep them identical. Every push to the `nextjs-migration` branch runs tools/parity: all ~577 pages of a seeded shop
  compared with main (0 differences), the same actions on both (orders, uploads, every admin form — must be identical),
  a real browser (no script errors, React takes over without hydration trouble, shop.js / admin.js start, every box
  can be ticked and unticked and every text box typed in) — only then merge to main. A change that is meant to change a
  page shows up there as exactly that difference; say so when merging.
- Next.js App Router: customer pages are `app/(shop)/` (Next.js pages with `generateMetadata` → lib/next/meta.ts).
  `lib/next/routes.ts` lists the addresses served there; proxy.ts runs the shop's front gate (`lib/gate.ts`: blocked
  IPs, hacking checks, country lock, blocked bots) for them and adds the security headers. Everything else goes to
  lib/site.ts (app/api/site), which uses the same gate helpers and the same React frame (`components/shop/chrome`).
  Page data loads through `lib/next/loaders.ts` / `shop-data.ts`.
- Don't call notFound() to show a missing item: Next.js serves an empty page for it (github.com/vercel/next.js/issues/99793).
  Add the address to `drawableHere()` in lib/next/loaders.ts — proxy.ts then sends it to the shop's real 404 page.
- A page is drawn by one shared function both routers call (lib/shop/router.tsx: home/lists/products;
  lib/shop/more.tsx: live, cart, wishlist, compare, checkout, kits, order pages; lib/shop/blog.tsx: articles;
  lib/shop/forms.tsx: account, complaint, return, gift card) — change it there, once.
  The customer forms (account, own-order cancel/edit, complaint, /track look-up, return, gift card) are Next.js
  route handlers: lib/shopx.tsx has one handler per form, lib/next/shop-form.ts (`formRoute`) runs the gate and draws
  the answer pages. A form sent to an address that also has a Next.js page goes to its /api/forms/… route
  (proxy.ts, `formRouteFor` in lib/next/routes.ts); any other form still goes to lib/site.ts.
- The browser code is TypeScript in `client/` (2026-10-18: no hand-written .js files anywhere): `client/shop` (cart,
  checkout, OTP, gallery, live scores, search …), `client/i18n` (বাংলা ⇄ English), `client/admin` (menus, uploads,
  pickers, handover, POS, stock scan, import, login lock …), `client/sw` (the two service workers). `npm run build:client`
  (part of `npm run build`, `npm run dev`) compiles it to `public/js/**` and `public/sw.js` / `public/admin-sw.js` —
  generated, not kept in git. Pages load them with `<script type="module" src="/js/<part>/<file>.js">`.
  Changes to the page are made with JSX (`client/jsx.ts`: `<div>{text}</div>` makes real DOM nodes, text is never
  HTML) and `paint(el, …)` — never innerHTML strings; ready-made HTML from the shop's own API goes through
  `serverHtml()`. tests/client.test.ts keeps it that way. They start after React has taken over a Next.js page
  (`whenReady` in client/dom.ts, components/shop/chrome/Hydrated.tsx). The district list loads by itself where an
  address form is (`loadGeo`, client/geo-data.ts — the same data as lib/data/bd-geo.json).
- The only scripts inside a page are the tiny boot scripts that must run before it is drawn (lib/boot-scripts.ts:
  language, side menu, Tawk) and the country-lock checks (services/geolock.ts) — modern JavaScript, tested to parse.
- Admin in Next.js: every admin GET page is drawn by app/(admin)/admin/[[...path]] — lib/next/admin.ts runs the
  admin's own handler (lib/admin) with `drawPage` catching the page's pieces, and the React frame (AdminBody /
  AdminBare in lib/admin/layout.tsx; tests/admin-frame.test.ts) draws them. proxy.ts makes the nonce and the script
  rule (lib/security adminHeaders) and runs the admin's front checks (lib/gate.ts adminGateOk). Forms (POST),
  /admin/api, files and exports go to app/api/admin (lib/next/admin-route.ts; `ADMIN_SITE` in lib/next/routes.ts);
  a handler that answers with anything but a page is sent there too (?__site=1). After adding or changing an admin route run
  `npx tsx tools/gen-admin-routes.ts` (lib/next/admin-routes.ts; tests/routes.test.ts checks it).
- Shop APIs, pictures, robots/sitemap/feeds, e-mail counters, payments, webhooks and the scheduled jobs are Next.js
  route handlers (app/api/…, app/media, app/pay, app/webhook …) with their code in lib/api/*.ts; `apiRoute()`
  (lib/next/api.ts) runs the shop's gate first (`{ bots: false }` for pictures and robots.txt). A method or address a
  route doesn't handle goes to lib/site.ts (`otherMethods` / `toSite`), so its answer stays exactly the same.
- lib/site.ts (app/api/site → siteAnswer(Request) → Response) answers only the shop's own 404 / redirect answers, a
  page switched off, the country-lock page, verification files and methods a route doesn't take. The admin's forms
  and files: lib/next/admin-route.ts (app/api/admin). The customer forms: lib/shopx.tsx. All of them share
  lib/next/answers.ts (the request as the shop reads it, send/json/redirect, the fixed pages). Handlers answer through
  ctx.send(status, body, type?, headers?) / ctx.json(status, data) / ctx.redirect(to) and, for a file,
  ctx.reply.answer(status, headers, body) (lib/reply.ts → a Web Response). There is no Node req/res anywhere:
  ctx.req is a plain object (headers, url, method, socket.remoteAddress, the body text).
- E-mails are drawn with React too (lib/emails.tsx: the offer mail, new order, delete code, account code, plain alerts)
  and turned into HTML only when sent (`emailHtml`). A mail sent without its own HTML gets its text as a simple HTML mail.
  The only hand-written HTML left is the handful of fixed emergency pages (database down, too many requests, country
  closed, blocked visitor) that must still answer when nothing else works.
- Database rows have types: lib/data/rows.ts (one per table, made by `npx tsx tools/gen-row-types.ts` from the layout in
  lib/db.ts; tests/row-types.test.ts checks it). Read rows through them: `db.q<OrdersRow>(…)`, `OrdersRow & { extra: number }`
  for joined or computed columns. Run the generator after changing the database layout.
- Database: only a dropped connection is retried (lib/pg isConnectionError); an order is retried on a deadlock (db.txRetry).
  Tests run one file at a time (`--test-concurrency=1`): the database tests share one throw-away database.
