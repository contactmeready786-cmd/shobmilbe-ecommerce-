// The owner's own marks on the set-up lists (🔌 সংযোগের অবস্থা, 🚀 গ্রোথ গাইড) — owner, 2026-10-13:
//   ✓ "করা আছে"   — done another way the site can't see (e.g. Search Console verified through the domain's DNS,
//                   not the meta tag; the domain added straight in Vercel) → shown as done.
//   ✕ "দরকার নেই" — a service the shop does not use (e.g. paid-ad pixels while only free marketing runs)
//                   → moved out of the list into a closed "দরকার নেই" box, and not counted as unfinished.
// Paid-ad tools (Pixel, Conversions API, TikTok …) that were never set up count as "দরকার নেই" by themselves.
// Saved in settings.setup_marks as {"key": "done" | "skip"}; every mark can be taken back.

// set up only when the shop runs paid ads — not a problem while they are empty
import { html } from '../util';
import * as db from '../db';
import type { AdminCtx, Loose, Settings } from '../types';
const ADS_ONLY = new Set(['fb_pixel', 'fb_capi', 'fb_domain', 'tiktok_pixel', 'tiktok_events']);

function marks(s: Settings) {
  try { const m = JSON.parse((s && s.setup_marks) || '{}'); return m && typeof m === 'object' ? m : {}; } catch (_) { return {}; }
}
// what the owner (or the ads rule) says about one item: 'done', 'skip' or ''
function markOf(s: Settings, key?: Loose, isSetUp?: Loose) {
  const m = marks(s)[key];
  if (m === 'done' || m === 'skip') return m;
  if (m === 'show') return '';
  if (!isSetUp && ADS_ONLY.has(key)) return 'skip';
  return '';
}
function buttons(key?: Loose, mark?: Loose, back?: Loose) {
  const f = (val?: Loose, label?: Loose, title?: Loose) => html`<form method="post" action="/admin/setup-mark" class="mark-form">
    <input type="hidden" name="key" value="${key}"><input type="hidden" name="val" value="${val}"><input type="hidden" name="back" value="${back}">
    <button class="link-btn small" title="${title}">${label}</button></form>`;
  if (mark === 'done') return html`<span class="small muted">✔ আপনি "করা আছে" দিয়েছেন</span> ${f('', '↩️ ফেরান', 'আবার সাইটের নিজের যাচাই দেখাবে')}`;
  if (mark === 'skip') return f('', '↩️ তালিকায় ফেরান', 'আবার তালিকায় দেখাবে');
  return html`${f('done', '✓ করা আছে', 'অন্যভাবে (যেমন DNS দিয়ে) করা আছে — সাইট দেখতে পায় না')} ${f('skip', '✕ দরকার নেই', 'এই সার্ভিস ব্যবহার করি না — তালিকা থেকে সরান')}`;
}

async function save(ctx: AdminCtx) {
  const b = await ctx.body();
  const key = String(b.key || '').replace(/[^\w-]/g, '').slice(0, 40);
  const back = /^\/admin\/(integrations\/status|growth)(#[\w-]+)?$/.test(String(b.back || '')) ? b.back : '/admin/integrations/status';
  if (!key) return ctx.back(back);
  const m = marks(ctx.settings);
  // "↩️ ফেরান" on a paid-ad item that was skipped by the rule keeps it in the list ('show')
  if (b.val === 'done' || b.val === 'skip') m[key] = b.val;
  else if (ADS_ONLY.has(key)) m[key] = 'show';
  else delete m[key];
  await db.setSetting('setup_marks', JSON.stringify(m));
  await ctx.reloadSettings();
  await ctx.log('settings', 'setup', null, `সেটআপ তালিকা: ${key} → ${b.val === 'done' ? 'করা আছে' : b.val === 'skip' ? 'দরকার নেই' : 'আগের মতো'}`);
  return ctx.back(back, 'saved');
}

export const routes = [{ method: 'POST', path: '/admin/setup-mark', perm: 'owner', handler: save }];
export { markOf, buttons, ADS_ONLY };
