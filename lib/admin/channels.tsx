// Admin → মার্কেটিং → 📣 সোশ্যাল অটো পোস্ট (owner, 2026-11-13): one page with every platform the shop posts on by
// itself — Facebook, Instagram, Threads, Pinterest, YouTube Shorts, TikTok, Telegram — what each is doing, how to
// connect it (step by step, so the owner can do it again alone), its own posting hours, and the real result: how many
// visits and orders came from each platform. Facebook, Instagram and Telegram keep their settings on the
// "অটো মার্কেটিং" page (one place per switch); the four new platforms are set up here (lib/services/social.ts).
import { Val, attrValue, jsxList, styleOf } from '../react/html';
import { bn, fmtDate } from '../util';
import * as db from '../db';
import * as ui from './ui';
import * as social from '../services/social';
import * as autopost from '../services/autopost';
import { secretInput } from './marketing';
import type { AdminCtx, Caught } from '../types';
import type { Channel } from '../services/social';

const BASE = '/admin/marketing/channels';
const AUTO = '/admin/marketing/auto';

async function handle(ctx: AdminCtx) {
  if (ctx.method === 'POST') return post(ctx);
  return page(ctx);
}

async function save(ctx: AdminCtx, obj: Record<string, unknown>) {
  for (const [k, v] of Object.entries(obj)) await db.setSetting(k, v);
  await ctx.reloadSettings();
}

async function post(ctx: AdminCtx) {
  const b = await ctx.body();
  const s = ctx.settings;
  const ch = String(b.ch || '');
  if (!social.isChannel(ch)) return ctx.back(BASE);
  const here = `${BASE}#${ch}`;
  const name = social.INFO[ch].name;
  if (b.action === 'app') {
    const secretIn = String(b.secret || '').trim();
    const secret = secretIn && !/^•+$/.test(secretIn) ? secretIn : s[`social_${ch}_secret`] || '';
    const appId = String(b.app_id || '').trim();
    if (!appId || !secret) return ctx.fail(here, 'App ID আর App Secret দুটোই দিন।');
    await save(ctx, { [`social_${ch}_app_id`]: appId, [`social_${ch}_secret`]: secret });
    await ctx.log('settings', 'marketing', null, `${name}: অ্যাপের তথ্য সেভ`);
    return ctx.back(`${BASE}?info=${encodeURIComponent(`✅ ${name} অ্যাপের তথ্য সেভ হয়েছে — এবার "লগইন করে অনুমতি দিন" চাপুন।`)}#${ch}`);
  }
  if (b.action === 'auth') {
    let url;
    try { url = await social.authUrl(s, ch); } catch (caught) { return ctx.fail(here, (caught as Caught).message); }
    return ctx.redirect(url);
  }
  if (b.action === 'settings') {
    const hours = String(b.hours || '').split(/[,\s]+/).map(Number).filter((h) => Number.isInteger(h) && h >= 0 && h <= 23);
    const obj: Record<string, string> = {
      [`social_${ch}_on`]: b.on ? '1' : '0',
      [`social_${ch}_hours`]: [...new Set(hours)].sort((x, y) => x - y).slice(0, 4).join(',') || social.INFO[ch].hours,
    };
    if (ch === 'pinterest') obj.social_pinterest_sandbox = b.live ? '0' : '1';
    await save(ctx, obj);
    await ctx.log('settings', 'marketing', null, `${name} অটো পোস্ট: ${b.on ? 'চালু' : 'বন্ধ'}`);
    return ctx.back(here, 'saved');
  }
  if (b.action === 'now') {
    const r = await social.postOne(s, ch);
    if (r.error) return ctx.fail(here, `${name} ❌ ${r.error}`);
    await ctx.log('create', 'marketing', null, `${name} পোস্ট (এখনই): ${r.product ? r.product.name : ''}`);
    return ctx.back(`${BASE}?info=${encodeURIComponent(`${social.INFO[ch].icon} ${name} ✅ ${r.product ? r.product.name : ''}${ch === 'tiktok' ? ' — TikTok অ্যাপের ইনবক্সে দেখুন' : ''}`)}#${ch}`);
  }
  if (b.action === 'disconnect') {
    await social.disconnect(s, ch);
    await ctx.reloadSettings();
    await ctx.log('settings', 'marketing', null, `${name} সংযোগ সরানো হলো`);
    return ctx.back(here, 'saved');
  }
  return ctx.back(BASE);
}

/** back from the platform's "allow" page */
async function callback(ctx: AdminCtx) {
  const code = ctx.query.get('code') || '';
  const state = ctx.query.get('state') || '';
  const ch = state.split('.')[0];
  const back = social.isChannel(ch) ? `#${ch}` : '';
  if (!code) {
    const why = ctx.query.get('error_description') || ctx.query.get('error') || 'অনুমতি দেওয়া হয়নি';
    return ctx.back(`${BASE}?err=${encodeURIComponent('সংযোগ হলো না: ' + why.slice(0, 200))}${back}`);
  }
  try {
    const r = await social.finish(ctx.settings, code, state);
    await ctx.reloadSettings();
    await ctx.log('settings', 'marketing', null, `${social.INFO[r.ch].name} যুক্ত (${r.name})`);
    return ctx.back(`${BASE}?info=${encodeURIComponent(`✅ ${social.INFO[r.ch].name} যুক্ত হয়েছে: ${r.name} — এবার নিচে "প্রতিদিন নিজে থেকে পোস্ট করো" চালু করে সেভ করুন।`)}${back}`);
  } catch (caught) {
    return ctx.back(`${BASE}?err=${encodeURIComponent('সংযোগ হলো না: ' + (caught as Caught).message)}${back}`);
  }
}

const hourLabel = (h: number) => `${bn(h % 12 || 12)}টা ${h < 12 ? 'সকাল' : h < 16 ? 'দুপুর' : h < 19 ? 'বিকাল' : 'রাত'}`;
const CH_NAME: Record<string, string> = { facebook: '📘 Facebook', instagram: '📸 Instagram', telegram: '✈️ Telegram', threads: '🧵 Threads', pinterest: '📌 Pinterest', youtube: '▶️ YouTube', tiktok: '🎵 TikTok' };

/** step-by-step: making the free developer app once, on each platform */
function steps(ch: Channel, redirect: string) {
  const R = <><code>{redirect}</code></>;
  if (ch === 'threads') return <ol className="steps"><li>কম্পিউটারে <a href="https://developers.facebook.com/apps" target="_blank" rel="noopener">developers.facebook.com/apps</a> খুলুন (Facebook-এর অ্যাকাউন্ট দিয়ে) → <b>Create App</b> → "Use cases"-এ <b>Access the Threads API</b> বেছে নিন → নাম দিন (যেমন "Shobmilbe Threads") → Create।</li><li>বাঁ দিকে <b>Use cases → Access the Threads API → Customize</b>: Permissions-এ <code>threads_basic</code> আর <code>threads_content_publish</code> Add করুন। <b>Settings</b>-এ "Redirect Callback URLs" ঘরে এটা দিন: {R} (Uninstall / Delete callback ঘরেও একই লিংক দিতে পারেন) → Save।</li><li><b>App roles → Roles → Add People → Threads Tester</b>-এ আপনার Threads ইউজারনেম দিন। তারপর Threads অ্যাপে/threads.net-এ Settings → Account → Website permissions → Invites থেকে আমন্ত্রণ <b>Accept</b> করুন।</li><li><b>Use cases → Threads API → Settings</b> পাতা থেকে <b>Threads App ID</b> আর <b>Threads App Secret</b> কপি করে নিচে দিন → সেভ করুন।</li><li>"লগইন করে অনুমতি দিন" চাপুন → Threads-এ অনুমতি দিন → এখানে ফিরে সবুজ ✅ দেখবেন। অ্যাপ রিভিউ লাগে না — নিজের অ্যাকাউন্টে পোস্টের জন্য এটুকুই যথেষ্ট।</li></ol>;
  if (ch === 'pinterest') return <ol className="steps"><li>Pinterest অ্যাকাউন্টটা <b>Business</b> হতে হবে (pinterest.com → Settings → Account management → Convert to business — ফ্রি)।</li><li><a href="https://developers.pinterest.com/apps/" target="_blank" rel="noopener">developers.pinterest.com/apps</a> খুলুন → <b>Connect app</b> → নাম "Shobmilbe", ওয়েবসাইট <code>https://shobmilbe.com</code>, কাজের বিবরণে লিখুন: "Publishes our own shop's products as Pins to our own Pinterest business account" → Submit। ১-৩ দিনে "Trial access" দেয়।</li><li>অ্যাপের পাতায় <b>Redirect URIs</b>-এ এটা যোগ করুন: {R} → Save। <b>App ID</b> আর <b>App secret key</b> কপি করে নিচে দিন → সেভ → "লগইন করে অনুমতি দিন"।</li><li>⚠️ Trial access-এ Pinterest পিনগুলো শুধু পরীক্ষার জায়গায় (sandbox) রাখে, সবাই দেখে না। সব ঠিক চললে অ্যাপের পাতা থেকে <b>Upgrade to Standard access</b> চাইতে হয় (একটা ছোট ভিডিও দেখাতে বলে — কীভাবে পিন হয়, আমি বানিয়ে দিতে পারি)। অনুমতি পেলে নিচে "Standard access পেয়েছি" চালু করুন — তখন থেকে পিন সবার কাছে যাবে।</li></ol>;
  if (ch === 'youtube') return <ol className="steps"><li>যে Google অ্যাকাউন্টে আপনার YouTube চ্যানেল আছে, সেটা দিয়ে <a href="https://console.cloud.google.com/projectcreate" target="_blank" rel="noopener">console.cloud.google.com</a> এ একটা প্রজেক্ট বানান (নাম "Shobmilbe YouTube")।</li><li><a href="https://console.cloud.google.com/apis/library/youtube.googleapis.com" target="_blank" rel="noopener">YouTube Data API v3</a> খুলে <b>Enable</b> চাপুন।</li><li><b>APIs &amp; Services → OAuth consent screen</b> (Google Auth Platform): External → অ্যাপের নাম "সবমিলবে", আপনার ইমেইল → Save। <b>Audience</b>-এ "Publish app" চাপুন (Testing-এ রাখলে ৭ দিন পর সংযোগ কেটে যায়)।</li><li><b>Clients → Create client → Web application</b> → "Authorized redirect URIs"-এ এটা দিন: {R} → Create। <b>Client ID</b> আর <b>Client secret</b> কপি করে নিচে দিন → সেভ → "লগইন করে অনুমতি দিন" (Google "unverified app" দেখালে Advanced → Go to সবমিলবে)।</li><li>⚠️ Google-এর নিয়ম: নতুন অ্যাপ দিয়ে আপলোড করা ভিডিও প্রথমে <b>Private</b> থাকে, যতক্ষণ না Google অ্যাপটা যাচাই (audit) করে। ফ্রি — <a href="https://support.google.com/youtube/contact/yt_api_form" target="_blank" rel="noopener">এই ফর্মে</a> আবেদন করতে হয়, ফর্ম পূরণে আমি সাহায্য করব। তার আগ পর্যন্ত YouTube Studio থেকে ভিডিওগুলো নিজে Public করে দিতে পারেন।</li></ol>;
  return <ol className="steps"><li><a href="https://developers.tiktok.com/apps" target="_blank" rel="noopener">developers.tiktok.com</a> এ আপনার TikTok দিয়ে লগইন → <b>Manage apps → Connect an app</b> → নাম "সবমিলবে", ক্যাটাগরি Shopping, ওয়েবসাইট <code>https://shobmilbe.com</code>।</li><li><b>Add products</b>: <b>Login Kit</b> আর <b>Content Posting API</b> যোগ করুন। Login Kit-এ Redirect URI দিন: {R}। Scopes-এ <code>user.info.basic</code> আর <code>video.upload</code> রাখুন।</li><li>Terms ও Privacy Policy-র ঘরে দোকানের "শর্তাবলি" আর "প্রাইভেসি পলিসি" পাতার লিংক দিন (ওয়েবসাইটের ফুটারে আছে) → <b>Submit for review</b>। TikTok কয়েক দিনে অনুমোদন দেয়।</li><li>অনুমোদনের পর <b>Client key</b> আর <b>Client secret</b> নিচে দিন → সেভ → "লগইন করে অনুমতি দিন"।</li><li>কীভাবে কাজ করবে: ভিডিও আপনার TikTok অ্যাপের <b>ইনবক্সে ড্রাফট</b> হিসেবে যাবে (TikTok সম্পূর্ণ অটো পোস্ট শুধু বিশেষ অনুমোদিত অ্যাপকে দেয়)। আপনি নোটিফিকেশন খুলে একটা ট্রেন্ডিং গান বসিয়ে Post চাপবেন — গান থাকলে TikTok বেশি মানুষকে দেখায়।</li></ol>;
}

async function page(ctx: AdminCtx) {
  const s = ctx.settings;
  const redirect = social.redirectUri(s);
  const [counts, results, recent, videos] = await Promise.all([social.counts(), social.results(), social.recent(40), social.readyVideos().catch(() => new Set<number>())]);
  const fbOn = !!(s.autopost_page_token && s.autopost_page_id);
  const autoHours = autopost.hoursOf(s);
  const tgOn = !!(s.telegram_bot_token && s.telegram_chat);

  type Card = { key: string; icon: string; name: string; state: 'on' | 'off' | 'none' | 'warn'; account: string; note: string; href: string; source: string };
  const cards: Card[] = [
    { key: 'facebook', icon: '📘', name: 'Facebook পেজ', state: fbOn ? (s.autopost_on === '1' ? 'on' : 'off') : 'none', account: s.autopost_page_name || '', note: fbOn ? `প্রতিদিন ${autoHours.map(hourLabel).join(', ')}` : 'পেজ যুক্ত করুন', href: `${AUTO}#connect`, source: 'Facebook' },
    {
      key: 'instagram', icon: '📸', name: 'Instagram',
      state: !s.autopost_ig_id ? (fbOn ? 'warn' : 'none') : s.autopost_ig === '1' && s.autopost_on === '1' ? 'on' : 'off',
      account: s.autopost_ig_name ? '@' + s.autopost_ig_name : '',
      note: !s.autopost_ig_id ? 'Facebook-এর সাথে আবার যুক্ত করুন (নিচে দেখুন)' : s.autopost_ig === '1' ? 'Facebook-এর সাথে একই সময়ে' : '"Instagram-এ" সুইচ চালু করুন',
      href: s.autopost_ig_id ? `${AUTO}#connect` : '#instagram', source: 'Instagram',
    },
    ...social.CHANNELS.map((ch): Card => {
      const conn = social.connected(s, ch);
      const on = conn && s[`social_${ch}_on`] === '1';
      return { key: ch, icon: social.INFO[ch].icon, name: social.INFO[ch].name, state: on ? 'on' : conn ? 'off' : 'none', account: s[`social_${ch}_name`] ? (ch === 'youtube' ? '' : '@') + s[`social_${ch}_name`] : '',
        note: conn ? `দিনে ${bn(social.hoursFor(s, ch).length)}টা — ${social.hoursFor(s, ch).map(hourLabel).join(', ')}${ch === 'pinterest' && s.social_pinterest_sandbox !== '0' ? ' · ⚠️ পরীক্ষা মোড' : ''}` : 'নিচের ধাপে যুক্ত করুন', href: `#${ch}`, source: ch === 'youtube' ? 'YouTube' : ch === 'tiktok' ? 'TikTok' : social.INFO[ch].name };
    }),
    { key: 'telegram', icon: '✈️', name: 'Telegram চ্যানেল', state: tgOn ? (s.telegram_on === '1' ? 'on' : 'off') : 'none', account: s.telegram_chat_title || s.telegram_chat || '', note: tgOn ? `প্রতিদিন ${autoHours.map(hourLabel).join(', ')}` : 'চ্যানেল যুক্ত করুন', href: `${AUTO}#telegram`, source: 'Telegram' },
  ];
  const STATE: Record<Card['state'], [string, string]> = { on: ['✅ চালু', 'pill-ok'], off: ['⏸ বন্ধ', ''], none: ['⚪ যুক্ত নেই', ''], warn: ['⚠️ যুক্ত হয়নি', 'pill-warn'] };
  const onCount = cards.filter((c) => c.state === 'on').length;
  const weekPosts = Object.values(counts).reduce((n, c) => n + (c.week || 0), 0);
  const visits = Object.values(results).reduce((n, r) => n + r.visits, 0);
  const orders = Object.values(results).reduce((n, r) => n + r.orders, 0);

  const channelSection = (ch: Channel) => {
    const I = social.INFO[ch];
    const conn = social.connected(s, ch);
    const hasApp = !!(s[`social_${ch}_app_id`] && s[`social_${ch}_secret`]);
    const idLabel = ch === 'tiktok' ? 'Client key' : ch === 'youtube' ? 'Client ID' : 'App ID';
    const secretLabel = ch === 'tiktok' || ch === 'youtube' ? 'Client secret' : 'App Secret';
    return <section className="panel" id={ch}>
      <h2>{I.icon} {I.name} {conn ? <small>✅ <Val v={s[`social_${ch}_name`] || 'যুক্ত'} /></small> : null}</h2>
      <p className="small">{ch === 'threads' ? 'Instagram-এর মানুষরাই Threads-এ থাকে। প্রতিটা পোস্টে আসল ছবি, দাম আর অর্ডারের সরাসরি লিংক (Threads-এ লিংক চাপা যায়)।'
        : ch === 'pinterest' ? 'Pinterest আসলে একটা সার্চ ইঞ্জিন — মানুষ "Arduino price", "LED strip" খুঁজে পিন দেখে সোজা পণ্যের পাতায় আসে, আর একটা পিন মাসের পর মাস কাস্টমার আনে। প্রতিটা বড় ক্যাটাগরির জন্য আলাদা বোর্ড নিজেই বানায়, শিরোনামে "দাম … | Price in BD" থাকে।'
        : ch === 'youtube' ? 'প্রতিটা পণ্যের ৯ সেকেন্ডের খাড়া ভিডিও (Shorts) — ছবি ধীরে বড় হয়, নিচে দাম আর shobmilbe.com লেখা। শিরোনামে "দাম … | Price in Bangladesh" থাকে, তাই YouTube আর Google সার্চে আসে; বিবরণে অর্ডারের লিংক।'
        : 'একই ভিডিও TikTok-এ — বাংলাদেশে সবচেয়ে বেশি মানুষ এখানে। ভিডিও আপনার TikTok ইনবক্সে ড্রাফট হয়ে যায়, আপনি গান বসিয়ে পোস্ট করবেন (১ মিনিটের কাজ)।'}</p>
      {I.video ? <p className="small muted">🎬 ভিডিও বানানো হয় GitHub-এর ফ্রি কম্পিউটারে (প্রতি ২ ঘণ্টায়) — এখন তৈরি আছে {bn(videos.size)}টা।{videos.size ? null : ' প্রথম ভিডিও সংযোগের পর ২-৩ ঘণ্টার মধ্যে তৈরি হবে।'}</p> : null}
      <details className="help" open={!conn}><summary>💡 কীভাবে যুক্ত করবেন (একবারই)</summary><div>{steps(ch, redirect)}</div></details>
      <form method="post" action={attrValue(BASE)} className="form"><input type="hidden" name="action" defaultValue="app" /><input type="hidden" name="ch" defaultValue={ch} />
        <div className="field-row">{ui.field(idLabel, ui.input('app_id', s[`social_${ch}_app_id`] || '', { autocomplete: 'off' }))}{' '}{ui.field(secretLabel, secretInput('secret', s[`social_${ch}_secret`]))}</div>
        <button className="btn btn-sm btn-ghost">💾 সেভ করুন</button></form>
      <form method="post" action={attrValue(BASE)}><input type="hidden" name="action" defaultValue="auth" /><input type="hidden" name="ch" defaultValue={ch} />
        <button className="btn btn-sm" disabled={!hasApp}>🔗 {conn ? 'আবার লগইন করে অনুমতি দিন' : 'লগইন করে অনুমতি দিন'}</button>{hasApp ? null : <small className="muted"> — আগে উপরের দুটো ঘর সেভ করুন</small>}</form>
      {conn ? <>
        <form method="post" action={attrValue(BASE)} className="form"><input type="hidden" name="action" defaultValue="settings" /><input type="hidden" name="ch" defaultValue={ch} />
          {ui.switchRow('on', s[`social_${ch}_on`] === '1', 'প্রতিদিন নিজে থেকে পোস্ট করো', `একই পণ্য ${I.name}-এ ৪৫ দিনের মধ্যে আবার যায় না; স্টক নেই এমন পণ্য যায় না`)}
          {ch === 'pinterest' ? ui.switchRow('live', s.social_pinterest_sandbox === '0', 'Standard access পেয়েছি (পিন সবাই দেখবে)', 'Pinterest অনুমতি না দেওয়া পর্যন্ত বন্ধ রাখুন — তখন পিন শুধু পরীক্ষার জায়গায় যায়') : null}
          {ui.field('পোস্টের সময় (২৪ ঘণ্টার হিসাবে, কমা দিয়ে — সর্বোচ্চ ৪টা)', ui.input('hours', social.hoursFor(s, ch).join(','), { placeholder: I.hours }),
            ch === 'pinterest' ? 'Pinterest-এ দিনে ৩-৪টা পিন সবচেয়ে ভালো কাজ করে।' : I.video ? 'ভিডিও দিনে ১টা যথেষ্ট — বেশি দিলে প্ল্যাটফর্ম কম দেখায়। রাত ৭-১০টায় সবচেয়ে বেশি মানুষ থাকে।' : 'দুপুর ১টা আর রাত ৯টার দিকে সবচেয়ে বেশি মানুষ থাকে।')}
          <button className="btn btn-sm">সেভ করুন</button></form>
        <div className="row-actions">
          <form method="post" action={attrValue(BASE)} data-confirm={`এখনই ${I.name}-এ একটা পণ্য পোস্ট করবেন?`}><input type="hidden" name="action" defaultValue="now" /><input type="hidden" name="ch" defaultValue={ch} /><button className="btn btn-sm btn-ghost">📤 এখনই একটা পোস্ট</button></form>
          <form method="post" action={attrValue(BASE)} data-confirm={`${I.name} সংযোগ সরিয়ে দেবেন?`}><input type="hidden" name="action" defaultValue="disconnect" /><input type="hidden" name="ch" defaultValue={ch} /><button className="btn btn-sm btn-ghost">সংযোগ সরিয়ে দিন</button></form>
        </div>
      </> : null}
    </section>;
  };

  const body = <>
    <div className="title-row"><h1>📣 সোশ্যাল অটো পোস্ট</h1><div className="row-actions"><a className="btn btn-ghost btn-sm" href={attrValue(BASE)}>🔄 রিফ্রেশ</a></div></div>
    {ui.flash(ctx.flash)}
    <div className="kpis kpis-tight">
      {ui.kpi('চালু প্ল্যাটফর্ম', `${bn(onCount)} / ${bn(cards.length)}`, 'নিজে থেকে পোস্ট হচ্ছে')}{' '}
      {ui.kpi('গত ৭ দিনে পোস্ট', bn(weekPosts), 'সব প্ল্যাটফর্ম মিলিয়ে', 'kpi-blue')}{' '}
      {ui.kpi('সোশ্যাল থেকে ভিজিটর', bn(visits), 'গত ৩০ দিন')}{' '}
      {ui.kpi('সোশ্যাল থেকে অর্ডার', bn(orders), 'গত ৩০ দিন — আসল ফলাফল', 'kpi-green')}
    </div>
    {ui.helpBox('এটা কী করে, আর কেন এভাবে?', <ol className="steps">
      <li><b>উদ্দেশ্য — আসল কাস্টমার:</b> লাইক বা ভুয়া ফলোয়ার নয়, যার পণ্যটা দরকার সে যেন খুঁজে পায় আর বিশ্বাস করে কেনে। তাই প্রতিটা পোস্টে আসল ছবি, আসল দাম, ক্যাশ অন ডেলিভারি, আর পণ্যের পাতার সরাসরি লিংক — কোনো "লাইক দিন, শেয়ার করুন" ধরনের কৌশল নেই (প্ল্যাটফর্মগুলো ওগুলো কম দেখায়)।</li>
      <li><b>সার্চে খুঁজে পাওয়া:</b> শিরোনামে মানুষ যেভাবে খোঁজে ঠিক সেভাবে লেখা থাকে ("… দাম | Price in BD")। Pinterest আর YouTube সার্চ থেকে মাসের পর মাস কাস্টমার আসে।</li>
      <li><b>সঠিক নিয়মে:</b> প্রতিটা প্ল্যাটফর্মের নিজের সময় (দিনে সর্বোচ্চ ৪টা), একই পণ্য ৪৫ দিনে আবার না, স্টক শেষ হলে বাদ, সপ্তাহের একেক দিন একেক ক্যাটাগরি — তাই কখনো স্প্যাম মনে হয় না, অ্যাকাউন্টের কোনো ঝুঁকি নেই (সবই প্ল্যাটফর্মের অফিসিয়াল উপায়ে)।</li>
      <li><b>ফলাফল মাপা:</b> প্রতিটা লিংকে কোন প্ল্যাটফর্ম থেকে এলো তার চিহ্ন থাকে — নিচের "🎯 আসল ফলাফল" টেবিলে দেখবেন কোথা থেকে কতজন এলো আর কতটা অর্ডার হলো। যেটা থেকে অর্ডার বেশি, সেখানে সময় বাড়ান।</li>
    </ol>)}
    <section className="panel"><h2>প্ল্যাটফর্মগুলো</h2>
      <div className="table-wrap"><table className="table compact"><thead><tr><th>প্ল্যাটফর্ম</th><th>অবস্থা</th><th>অ্যাকাউন্ট</th><th>সময়</th><th>৭ দিনে পোস্ট</th><th></th></tr></thead><tbody>
        {jsxList(cards.map((c) => <tr>
          <td className="nowrap"><b>{c.icon} {c.name}</b></td>
          <td>{ui.pill(STATE[c.state][0], STATE[c.state][1])}</td>
          <td className="small"><Val v={c.account || '—'} /></td>
          <td className="small"><Val v={c.note} /></td>
          <td>{bn((counts[c.key] && counts[c.key].week) || 0)}{counts[c.key] && counts[c.key].failed ? <span className="small" style={styleOf("color:#c0392b")}> · ❌ {bn(counts[c.key].failed)}</span> : null}</td>
          <td><a className="btn btn-sm btn-ghost" href={attrValue(c.href)}>সেটিংস →</a></td>
        </tr>))}
      </tbody></table></div>
    </section>
    <section className="panel"><h2>🎯 আসল ফলাফল — গত ৩০ দিন</h2>
      <p className="small muted">পোস্টের লিংক থেকে কতজন দোকানে এলো আর তাদের কতজন অর্ডার করলো। (অর্ডার = সেই ভিজিটে অর্ডার সম্পন্ন হয়েছে।)</p>
      <div className="table-wrap"><table className="table compact"><thead><tr><th>প্ল্যাটফর্ম</th><th>ভিজিটর</th><th>অর্ডার</th><th>কত জনে ১টা অর্ডার</th></tr></thead><tbody>
        {jsxList(cards.map((c) => { const r = results[c.source] || { visits: 0, orders: 0 }; return <tr><td>{c.icon} {c.name}</td><td>{bn(r.visits)}</td><td><b>{bn(r.orders)}</b></td><td className="small">{r.orders ? `${bn(Math.round(r.visits / r.orders))} জনে ১টা` : '—'}</td></tr>; }))}
      </tbody></table></div>
    </section>
    <section className="panel" id="instagram"><h2>📸 Instagram {s.autopost_ig_name ? <small>✅ @<Val v={s.autopost_ig_name} /></small> : null}</h2>
      {s.autopost_ig_id
        ? <p className="small">Instagram যুক্ত আছে। Facebook পেজে যা পোস্ট হয় (পণ্য, টিপস, কুইজ, প্রজেক্ট গাইড — ছবিসহ সব), একই সময়ে Instagram-এও যায়। চালু/বন্ধ: <a href={`${AUTO}#connect`}>অটো মার্কেটিং → "Instagram-এ"</a> সুইচ{s.autopost_ig === '1' ? ' (এখন ✅ চালু)' : ' (এখন ⏸ বন্ধ — চালু করে সেভ করুন)'}।</p>
        : <><p className="small">Instagram বিজনেস অ্যাকাউন্ট Facebook পেজের সাথে জোড়া থাকলেও, দোকানের Facebook সংযোগ এখন Instagram দেখতে পাচ্ছে না (টোকেনে Instagram-এর অনুমতি নেই) — তাই পোস্ট Instagram-এ যাচ্ছে না। একবার এটা করলেই হবে (৩ মিনিট):</p>
          <ol className="steps"><li><a href="https://developers.facebook.com/tools/explorer/" target="_blank" rel="noopener">Graph API Explorer</a> খুলুন → ডানে আগের অ্যাপটাই ("Shobmilbe Poster") বেছে নিন।</li>
            <li>Permissions-এ আগেরগুলোর সাথে এই দুটো যোগ করুন: <code>instagram_basic</code>, <code>instagram_content_publish</code>।</li>
            <li><b>Generate Access Token</b> → যে পেজ আর <b>Instagram অ্যাকাউন্ট</b> দেখাবে, দুটোতেই টিক দিয়ে অনুমতি দিন → টোকেন কপি করুন।</li>
            <li><a href={`${AUTO}#connect`}>অটো মার্কেটিং</a> পাতায় "টোকেন" ঘরে দিয়ে "আবার যুক্ত করুন" চাপুন — সবুজ লেখায় "+ Instagram @…" দেখলে হয়ে গেল। তারপর "Instagram-এ" সুইচ চালু করে সেভ করুন।</li></ol></>}
    </section>
    {jsxList(social.CHANNELS.map((ch) => channelSection(ch)))}
    <section className="panel"><h2>🔗 এই লিংকটা প্রতিটা অ্যাপে "Redirect URI" হিসেবে দিতে হয়</h2><p><code>{redirect}</code></p></section>
    <section className="panel table-wrap"><h2>আগের পোস্টগুলো (সব প্ল্যাটফর্ম)</h2>
      {recent.length ? <table className="table compact"><thead><tr><th>সময়</th><th>কোথায়</th><th>পণ্য</th><th>ফল</th></tr></thead><tbody>
        {jsxList(recent.map((r) => { const url = social.postUrl(s, r.channel, r.post_id); return <tr>
          <td className="small nowrap">{fmtDate(r.created_at)}</td>
          <td className="nowrap"><Val v={CH_NAME[r.channel] || r.channel} /></td>
          <td>{r.slug ? <a href={`/p/${attrValue(r.slug)}`} target="_blank" rel="noopener"><Val v={r.product_name} /></a> : <Val v={r.product_name || (r.kind !== 'product' ? r.kind : '—')} />}</td>
          <td>{r.ok ? (url ? <a href={attrValue(url)} target="_blank" rel="noopener">✅ দেখুন</a> : <>✅{r.message ? <span className="small"> <Val v={r.message} /></span> : null}</>) : <span className="small" style={styleOf("color:#c0392b")}>❌ <Val v={r.message} /></span>}</td>
        </tr>; }))}
      </tbody></table> : <p className="muted">এখনো কোনো পোস্ট হয়নি।</p>}
    </section>
  </>;
  return ctx.page('সোশ্যাল অটো পোস্ট', body, 'channels');
}

export const routes = [
  { method: 'GET', path: `${BASE}/callback`, perm: 'marketing', handler: callback },
  { method: '*', path: BASE, perm: 'marketing', handler: handle },
];
