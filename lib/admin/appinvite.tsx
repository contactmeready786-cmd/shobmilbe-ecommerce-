// Admin → মার্কেটিং → মেসেজ → 📱 অ্যাপের কার্ড: the owner controls the "download our Android app" card the shop shows
// at the bottom of the screen (client/shop/appinvite.tsx) — on/off, who sees it, after how many seconds, the texts,
// on product pages or not, and what "✕" does (only this page, or hidden for some days). The rules are read by
// lib/app-invite.ts (inviteRules) and handed to the browser as window.SM.invite.
import { bn } from '../util';
import * as db from '../db';
import * as ui from './ui';
import { inviteRules } from '../app-invite';
import { APP_RELEASE } from '../app-release';
import type { AdminCtx } from '../types';

const BASE = '/admin/marketing/app-invite';
const HIDE: [string, string][] = [
  ['0', 'শুধু এই পেজে বন্ধ — অন্য পেজে গেলে বা রিফ্রেশ করলে আবার আসবে'],
  ['1', '১ দিন আর দেখাবে না'], ['3', '৩ দিন আর দেখাবে না'], ['7', '৭ দিন আর দেখাবে না'],
  ['15', '১৫ দিন আর দেখাবে না'], ['30', '৩০ দিন আর দেখাবে না'],
];

function page(ctx: AdminCtx) {
  const r = inviteRules(ctx.settings);
  const hideOpts = HIDE.some(([v]) => Number(v) === r.hideDays) ? HIDE : [...HIDE, [String(r.hideDays), `${bn(r.hideDays)} দিন আর দেখাবে না`] as [string, string]];
  const body = <>
    <div className="title-row"><h1>📱 অ্যাপ ডাউনলোডের কার্ড</h1><div className="row-actions"><a className="btn btn-ghost btn-sm" href="/app" target="_blank" rel="noopener">👀 অ্যাপের পেজ দেখুন</a></div></div>
    {ui.flash(ctx.flash)}
    <div className="kpis kpis-tight">{ui.kpi('অবস্থা', r.on ? '✅ দোকানে দেখাচ্ছে' : '⚪ বন্ধ', '')}{' '}{ui.kpi('অ্যাপের সংস্করণ', APP_RELEASE.version, `${APP_RELEASE.sizeMb} MB`, 'kpi-blue')}{' '}{ui.kpi('✕ চাপলে', r.hideDays ? `${bn(r.hideDays)} দিন লুকানো` : 'শুধু এই পেজে', '')}</div>
    {ui.helpBox('কার্ডটা কী', <ol className="steps"><li>দোকানের পেজ খোলার কিছুক্ষণ পর স্ক্রিনের নিচে ছোট একটা কার্ড আসে: "📱 সবমিলবে অ্যাপ — ডাউনলোড"। চাপলে অ্যাপের পেজ (/app) খোলে।</li><li>Android ফোনে "ডাউনলোড", কম্পিউটারে "দেখুন" (ফোনে কীভাবে নেবেন)। iPhone-এ দেখায় না — ওদের জন্য অ্যাপ নেই।</li><li>যার ফোনে অ্যাপের পুরনো সংস্করণ আছে, অ্যাপের ভেতরে তাকে "নতুন সংস্করণ এসেছে — আপডেট" দেখায়।</li><li>কার্ট, চেকআউট, অর্ডারের পেজ আর অ্যাপের পেজে কখনো আসে না। নিচে অন্য কিছু (কেনার বার, নোটিফিকেশনের প্রশ্ন, অফার পপ-আপ) থাকলে সেটা সরা পর্যন্ত অপেক্ষা করে।</li></ol>)}
    <form method="post" action={BASE} className="form">
      <div className="two-col">
        <section className="panel"><h2>⚙️ কখন, কাকে দেখাবে</h2>
          {ui.switchRow('app_invite_on', r.on, 'দোকানে কার্ডটা দেখাও', 'বন্ধ করলে কোনো কাস্টমার এই কার্ড দেখবে না (অ্যাপের পেজ /app আর ফুটারের লিংক থাকবে)।')}{' '}
          {ui.switchRow('app_invite_android', r.android, 'Android ফোনে দেখাও', '"ডাউনলোড" বাটনসহ।')}{' '}
          {ui.switchRow('app_invite_computer', r.computer, 'কম্পিউটারে দেখাও', '"দেখুন" — ফোনে অ্যাপ নেওয়ার নিয়ম দেখায়।')}{' '}
          {ui.switchRow('app_invite_update', r.update, 'পুরনো অ্যাপে "নতুন সংস্করণ এসেছে" দেখাও', 'যার ফোনে আগের সংস্করণ আছে, অ্যাপের ভেতরে।')}{' '}
          {ui.switchRow('app_invite_product', r.product, 'পণ্যের পেজেও দেখাও', 'বন্ধ করলে পণ্যের পেজে আসবে না — শুধু হোম, ক্যাটাগরি, সার্চ ইত্যাদিতে।')}{' '}
          {ui.field('পেজ খোলার কত সেকেন্ড পর আসবে', ui.input('app_invite_delay', r.delay, { type: 'number', min: 0, max: 120, class: 'w-num' }), '০ = সাথে সাথে। আগে ছিল ৩ সেকেন্ড।')}{' '}
          {ui.field('কাস্টমার ✕ (বা ডাউনলোড) চাপলে', ui.select('app_invite_hide_days', hideOpts, String(r.hideDays)), 'দিন বেছে নিলে সেই ফোন/কম্পিউটারে ততদিন আর আসবে না।')}
        </section>
        <section className="panel"><h2>✍️ কার্ডের লেখা</h2>
          <p className="small muted">খালি রাখলে আগের লেখাটাই থাকবে।</p>
          <h3>📱 Android ফোনে</h3>
          {ui.field('শিরোনাম', ui.input('app_invite_a_title', r.texts.android.title, { maxlength: 50 }))}{' '}
          {ui.field('নিচের ছোট লেখা', ui.input('app_invite_a_sub', r.texts.android.sub, { maxlength: 90 }))}{' '}
          {ui.field('বাটনের লেখা', ui.input('app_invite_a_btn', r.texts.android.btn, { maxlength: 20 }))}
          <h3>💻 কম্পিউটারে</h3>
          {ui.field('শিরোনাম', ui.input('app_invite_c_title', r.texts.computer.title, { maxlength: 50 }))}{' '}
          {ui.field('নিচের ছোট লেখা', ui.input('app_invite_c_sub', r.texts.computer.sub, { maxlength: 90 }))}{' '}
          {ui.field('বাটনের লেখা', ui.input('app_invite_c_btn', r.texts.computer.btn, { maxlength: 20 }))}
        </section>
      </div>
      <button className="btn">💾 সেভ করুন</button>
    </form>
  </>;
  return ctx.page('অ্যাপ ডাউনলোডের কার্ড', body, 'appinvite');
}

async function post(ctx: AdminCtx) {
  const b = await ctx.body();
  const s = (k: string, max: number) => String(b[k] ?? '').trim().slice(0, max);
  const n = (k: string, lo: number, hi: number, d: number) => {
    const v = Math.round(Number(b[k]));
    return String(Number.isFinite(v) && String(b[k] ?? '').trim() !== '' ? Math.max(lo, Math.min(hi, v)) : d);
  };
  await db.setMany({
    app_invite_saved: '1',
    app_invite_on: b.app_invite_on ? '1' : '0',
    app_invite_android: b.app_invite_android ? '1' : '0',
    app_invite_computer: b.app_invite_computer ? '1' : '0',
    app_invite_update: b.app_invite_update ? '1' : '0',
    app_invite_product: b.app_invite_product ? '1' : '0',
    app_invite_delay: n('app_invite_delay', 0, 120, 3),
    app_invite_hide_days: n('app_invite_hide_days', 0, 60, 0),
    app_invite_a_title: s('app_invite_a_title', 50), app_invite_a_sub: s('app_invite_a_sub', 90), app_invite_a_btn: s('app_invite_a_btn', 20),
    app_invite_c_title: s('app_invite_c_title', 50), app_invite_c_sub: s('app_invite_c_sub', 90), app_invite_c_btn: s('app_invite_c_btn', 20),
  });
  await ctx.log('settings', 'marketing', null, `অ্যাপের কার্ড: ${b.app_invite_on ? 'চালু' : 'বন্ধ'}`);
  return ctx.back(BASE, 'saved');
}

export const routes = [
  { method: 'GET', path: BASE, perm: 'marketing', handler: (ctx: AdminCtx) => page(ctx) },
  { method: 'POST', path: BASE, perm: 'marketing', handler: post },
];
