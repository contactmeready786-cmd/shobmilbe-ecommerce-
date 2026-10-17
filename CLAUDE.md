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
  admin login and caching still live in `lib/app.ts` (served through `pages/api/legacy` — Next.js forbids
  react-dom/server in App-Router routes).
- New UI is JSX. Values from old helpers that return Raw go in as `<Val v={…}/>`; ready-made HTML as `<RawHtml html={…}/>`.
  Don't write new html`…` in lib/admin or lib/views (tests/admin-scripts.test.ts counts them). Page frames
  (<html>/<head>) stay as text on purpose — React 19 would reorder the head. <link>/<meta>/<title>/async <script> in a
  page body are written through RawHtml for the same reason (the converter does this).
- Moving a page: record the old page first (copy to lib/views/__old_<name>.ts, add cases to tests/fixtures/cases.ts,
  `npx tsx tools/make-golden.ts`), then change it; tests/react-views.test.ts must stay green. Every push to the
  `nextjs-migration` branch runs tools/parity: all ~560 pages of a seeded shop compared with main (must be 0 differences,
  actions identical) — only then merge to main.
- Next stage (not done yet): split the converted JSX into reusable components and serve pages from Next.js App-Router
  pages (moving the gate from lib/app.ts into proxy.ts / server code), then retire pages/api/legacy.
