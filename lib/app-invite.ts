// 📱 The rules of the "download our app" card (client/shop/appinvite.tsx), set by the owner on
// Admin → মার্কেটিং → মেসেজ → 📱 অ্যাপের কার্ড (lib/admin/appinvite.tsx). The shop hands them to the browser as
// window.SM.invite — only once the owner has saved the page; until then the card keeps its built-in rules
// (INVITE_DEFAULTS, the same as client/app-release.ts — tests/app-invite.test.ts checks they match).
import type { Settings } from './types';

export type InviteTexts = { title: string; sub: string; btn: string };
export type InviteConfig = {
  /** show the card at all */
  on: boolean;
  /** who gets it: Android phones, computers, people inside an older copy of the app */
  android: boolean; computer: boolean; update: boolean;
  /** seconds after the page opens */
  delay: number;
  /** after ✕: 0 = only on this page (back on the next page / refresh), otherwise hidden for this many days */
  hideDays: number;
  /** also on product pages */
  product: boolean;
  texts: { android: InviteTexts; computer: InviteTexts };
};

export const INVITE_DEFAULTS: InviteConfig = {
  on: true, android: true, computer: true, update: true, delay: 3, hideDays: 0, product: true,
  texts: {
    android: { title: '📱 সবমিলবে অ্যাপ', sub: 'অর্ডার, অফার আর ট্র্যাক — এক চাপে।', btn: 'ডাউনলোড' },
    computer: { title: '📱 আমাদের Android অ্যাপ আছে', sub: 'ফোনে অর্ডার, অফার আর ট্র্যাক — এক চাপে।', btn: 'দেখুন' },
  },
};

const clamp = (v: unknown, lo: number, hi: number, d: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && String(v ?? '').trim() !== '' ? Math.max(lo, Math.min(hi, n)) : d;
};
const txt = (v: unknown, d: string, max: number) => String(v ?? '').trim().slice(0, max) || d;

/** The card's rules from the settings (missing ones keep the built-in rule). */
export function inviteRules(s: Settings): InviteConfig {
  const D = INVITE_DEFAULTS;
  const flag = (k: string, d: boolean) => (s[k] === undefined || s[k] === null || s[k] === '' ? d : s[k] === '1');
  return {
    on: flag('app_invite_on', D.on), android: flag('app_invite_android', D.android), computer: flag('app_invite_computer', D.computer),
    update: flag('app_invite_update', D.update), product: flag('app_invite_product', D.product),
    delay: clamp(s.app_invite_delay, 0, 120, D.delay), hideDays: clamp(s.app_invite_hide_days, 0, 60, D.hideDays),
    texts: {
      android: { title: txt(s.app_invite_a_title, D.texts.android.title, 50), sub: txt(s.app_invite_a_sub, D.texts.android.sub, 90), btn: txt(s.app_invite_a_btn, D.texts.android.btn, 20) },
      computer: { title: txt(s.app_invite_c_title, D.texts.computer.title, 50), sub: txt(s.app_invite_c_sub, D.texts.computer.sub, 90), btn: txt(s.app_invite_c_btn, D.texts.computer.btn, 20) },
    },
  };
}

/** What the shop page hands to the browser: nothing until the owner has saved the rules once. */
export function inviteConfig(s: Settings): InviteConfig | null {
  return s.app_invite_saved === '1' ? inviteRules(s) : null;
}
