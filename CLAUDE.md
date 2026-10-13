# সবমিলবে — rules for anyone changing this code

## One setup per service — never ask the owner to enter the same thing twice

The owner sets each outside service up **once**, in one admin page. Every feature — today's and any added later —
uses that one setup. Never add a second Gmail / App Password / SMS / API-key field for a new feature.

| Service | The one place it is set | Code every feature must use |
|---|---|---|
| Gmail (all e-mail: order news, customer sign-up codes, delete codes, password-reset links, security alerts, any future code or mail) | Admin → সেটিংস → **আমার নোটিফিকেশন** (`notify_email` + `gmail_app_password`) | `services/notify.js` → `sendEmail(settings, subject, text, html, to)` |
| SMS (all SMS: checkout OTP, customer login codes, order SMS, any future code) | Admin → মার্কেটিং → কাস্টমারকে মেসেজ → **SMS** | `services/sms.js` → `send(settings, phone, text, { kind })` |
| WhatsApp to the owner | আমার নোটিফিকেশন | `services/notify.js` → `sendWhatsApp(settings, text)` |

- A new feature that needs to send a code or a mail calls the function above. If the service isn't set up yet,
  the feature shows a link to that one page — it never shows its own credential form.
- `sendEmail` already retries with the older code saved on the customer-accounts page (`acct_gmail_password`)
  when Gmail refuses the main one, and promotes a code that works. Keep that behaviour.
- A new Google code is tested before it is saved (admin/notify.js), so a wrong code never replaces a working one.

## Other standing rules from the owner
- Product prices: ৳0.50 – ৳2000 only (`util.priceProblem`). ৳10 or more = whole taka.
- Permanent deletes need the e-mailed delete code (`services/delcode.js`).
- Admin menu: related small pages are tabs (`TABS` in admin/layout.js), not new menu lines.
- The camera face check was removed on purpose; only the fingerprint / passkey login lock stays.
- Automatic SEO (`services/autoseo.js`) only fills EMPTY fields, never overwrites or re-adds what the owner wrote or removed,
  logs every change for undo; the auto description is made at page view and never saved over the owner's text.
