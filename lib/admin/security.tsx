// Admin: security status page (owner only) — what protects the site, what still needs a step, and recent blocked attempts.
import { toHtml, Val, attrValue, htmlValue, attrProps, styleOf, jsxList } from '../react/html';
import { cspNonce } from '../security';
import * as crypto from 'node:crypto';
import { html, raw, fmtDate } from '../util';
import * as db from '../db';
import * as ui from './ui';
import * as security from '../security';
import * as lock from '../models/loginlock';
import * as $services_geolock from '../services/geolock';
import * as $recovery from './recovery';
import * as $services_dbmove from '../services/dbmove';
import * as $services_imagekit from '../services/imagekit';
import * as $pg from '../pg';
import * as $services_notify from '../services/notify';
import * as delcode from '../services/delcode';
import type { AdminCtx, Body, Loose } from '../types';

function row(ok?: Loose, title?: Loose, desc?: Loose) {
  return toHtml(<li className={`sec-row ${ok === true ? 'ok' : ok === false ? 'todo' : 'info'}`}><span className="sec-ic" aria-hidden="true">{(ok === true ? "✅" : (ok === false ? "⚠️" : "ℹ️"))}</span>{' '}<span><b><Val v={title} /></b><br /><span className="small muted"><Val v={desc} /></span></span></li>);
}

// what each saved secret is, and where the owner types it again
const SECRET_NAMES: Record<string, Loose> = {
  gmail_app_password: ['Gmail-এর Google কোড (ইমেইল নোটিফিকেশন)', '/admin/notify'],
  acct_gmail_password: ['কাস্টমারের কোড পাঠানোর Gmail-এর Google কোড', '/admin/customer-accounts'],
  callmebot_key: ['CallMeBot WhatsApp কোড', '/admin/notify'],
  reset_mail_token: ['পাসওয়ার্ড রিসেট মেইলের পুরোনো টোকেন', ''],
  fb_capi_token: ['Facebook Conversions API টোকেন', '/admin/marketing/tracking'],
  tiktok_events_token: ['TikTok Events টোকেন', '/admin/marketing/tracking'],
  bkash_app_secret: ['বিকাশ App Secret', '/admin/integrations/payments'], bkash_app_key: ['বিকাশ App Key', '/admin/integrations/payments'], bkash_password: ['বিকাশ পাসওয়ার্ড', '/admin/integrations/payments'],
  ssl_store_password: ['SSLCommerz Store Password', '/admin/integrations/payments'],
  steadfast_secret_key: ['Steadfast Secret Key', '/admin/integrations/courier'], steadfast_api_key: ['Steadfast API Key', '/admin/integrations/courier'], steadfast_webhook_token: ['Steadfast Webhook টোকেন', '/admin/integrations/courier'],
  pathao_client_secret: ['Pathao Client Secret', '/admin/integrations/courier'], pathao_password: ['Pathao পাসওয়ার্ড', '/admin/integrations/courier'], pathao_token: ['Pathao টোকেন (নিজে থেকে আবার নেয়)', ''], pathao_webhook_secret: ['Pathao Webhook Secret', '/admin/integrations/courier'],
  redx_token: ['RedX টোকেন', '/admin/integrations/courier'], vercel_token: ['Vercel টোকেন (ডোমেইন সেটআপ)', '/admin/integrations/domain'],
  push_vapid_private: ['ফোন নোটিফিকেশনের পুরোনো চাবি', ''], i18n_google_key: ['Google অনুবাদ API কী', '/admin/design/language'],
  sms_api_key: ['SMS API কী', '/admin/marketing/sms'], cf_api_token: ['Cloudflare টোকেন', '/admin/integrations/dns'], autocall_api_key: ['অটো কল API কী', '/admin/autocall'], fraudbd_api_key: ['FraudBD API কী', '/admin/fraud'],
  admin_password: ['পুরোনো অ্যাডমিন পাসওয়ার্ড (এখন আর লাগে না)', ''],
};

async function forgetLocked(ctx: AdminCtx) {
  const b = await ctx.body();
  const k = String(b.key || '');
  // only a value that really can't be read any more may be removed here
  const row = await db.one('SELECT value FROM settings WHERE key=$1', [k]);
  if (!row || !security.isEncrypted(row.value) || security.decrypt(row.value)) return ctx.fail('/admin/security', 'এটা মুছা যাবে না।');
  await db.q('DELETE FROM settings WHERE key=$1', [k]);
  await ctx.reloadSettings();
  await ctx.log('settings', 'settings', null, `পড়া-যায়-না এমন পুরোনো গোপন তথ্য মুছে দেওয়া হলো: ${k}`);
  return ctx.back('/admin/security', 'deleted');
}

// ---------------------------------------------------------------- 🔐 অ্যাডমিন কোন দেশ থেকে খুলবে
const ADMIN_COUNTRY_PATH = '/admin/security/admin-country';
function adminCountryPanel(ctx: AdminCtx) {
  const G = $services_geolock;
  const s = ctx.settings;
  const c = G.adminConfig(s);
  const here = G.countryOf(ctx.req);
  const name = (code?: Loose) => G.countryName(code);
  const flag = (code?: Loose) => String.fromCodePoint(...[...code].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65));
  const picked = new Set(c.extra);
  const list = Object.keys(G.COUNTRIES).filter((k) => k !== G.ADMIN_HOME)
    .map((k) => ({ k, bn: name(k), en: G.countryName(k, 'en'), on: picked.has(k) }))
    .sort((a: Loose, b: Loose) => (b.on - a.on) || a.en.localeCompare(b.en));
  const status = c.envOff ? toHtml(<>⚠️{' '}<b>বন্ধ আছে</b>{' '}— Vercel-এ জরুরি চাবি{' '}<code>ADMIN_GEO_LOCK=off</code>{' '}বসানো। দেশে ফিরে সেটা মুছে Redeploy দিন।</>)
    : !c.on ? toHtml(<>⚠️{' '}<b>বন্ধ আছে</b>{' '}— এখন সব দেশ থেকে অ্যাডমিন খোলা যায়।</>)
      : c.extraActive ? toHtml(<>🔒 চালু — খোলা:{' '}<Val v={flag('BD')} />{' '}বাংলাদেশ +{' '}{c.extra.map((k) => `${flag(k)} ${name(k)}`).join(', ')}{' '}(<b><Val v={c.untilText} /></b>{' '}তারিখের রাত ১২টা পর্যন্ত, তারপর নিজে থেকে শুধু বাংলাদেশ)</>)
        : toHtml(<>🔒 চালু — শুধু{' '}<Val v={flag('BD')} />{' '}বাংলাদেশ থেকে অ্যাডমিন খোলা যায়।</>);
  return toHtml(<section className="panel" id="admin-country"><h2>🔐 অ্যাডমিন কোন দেশ থেকে খুলবে</h2><p><Val v={status} /></p><p className="small muted">অন্য দেশ থেকে কেউ অ্যাডমিন (বা অ্যাডমিন অ্যাপ) খুললে শুধু "পেজটি পাওয়া যায়নি" দেখবে — পাসওয়ার্ড জানলেও ঢুকতে পারবে না। আপনি এখন আছেন:{' '}<b>{(here ? `${flag(here)} ${name(here)}` : "জানা যায়নি")}</b>।</p><form method="post" action={attrValue(ADMIN_COUNTRY_PATH)} className="form" data-ac-form=""><label className="switch-row">{' '}<span className="switch-text"><b>অ্যাডমিন দেশ তালা</b><small>চালু থাকলে শুধু বাংলাদেশ (আর নিচে বাছাই করা দেশ, শেষ তারিখ পর্যন্ত) থেকে অ্যাডমিন খুলবে।</small></span>{' '}<span className="switch"><input type="checkbox" name="on" defaultValue="1" {...attrProps(s.admin_geo_on !== '0' ? raw('checked') : '')} /><span className="switch-ui" aria-hidden="true"></span></span>{' '}<span className="switch-state" data-on="চালু" data-off="বন্ধ"></span></label><h3 className="h3">✈️ বিদেশ যাওয়ার আগে: যে দেশে যাচ্ছেন সেটা টিক দিন{' '}<span className="small muted" data-ac-count=""></span></h3><input type="search" placeholder="দেশ খুঁজুন… (যেমন UAE / Saudi / ভারত)" data-ac-search="" style={styleOf("width:100%;margin-bottom:6px")} aria-label="দেশ খুঁজুন" /><div style={styleOf("max-height:260px;overflow:auto;border:1px solid var(--line,#e3e8f0);border-radius:10px;padding:4px 10px")}>{jsxList(list.map((r) => <label className="check" data-ac-row="" data-k={(r.bn + ' ' + r.en + ' ' + r.k).toLowerCase()} style={styleOf("display:flex;gap:8px;align-items:center;padding:5px 0;border-bottom:1px solid var(--line,#eef1f6)")}>{' '}<input type="checkbox" name="c" defaultValue={attrValue(r.k)} {...attrProps(r.on ? raw('checked') : '')} /><span><Val v={flag(r.k)} /></span><span style={styleOf("flex:1")}><b><Val v={r.bn} /></b>{' '}<span className="small muted"><Val v={r.en} /></span></span></label>))}</div><Val v={ui.field('কোন তারিখ পর্যন্ত খোলা থাকবে (ফেরার দিন)', ui.input('until', c.untilText, { type: 'date' }), 'এই তারিখের রাত ১২টার পর বাছাই করা দেশগুলো নিজে থেকেই বন্ধ হয়ে যাবে, আবার শুধু বাংলাদেশ। (সর্বোচ্চ ১ বছর)')} />{' '}<button className="btn">✅ সেভ করুন</button></form><p className="small muted">🆘 বিদেশে গিয়ে খুলতে ভুলে গেলে:{' '}<b>vercel.com</b>{' '}→ প্রজেক্ট → Settings → Environment Variables → Key:{' '}<code>ADMIN_GEO_LOCK</code>, Value:{' '}<code>off</code>{' '}→ Save → Deployments → Redeploy। দেশে ফিরে ভেরিয়েবলটা মুছে আবার Redeploy দিন।</p><script nonce={attrValue(cspNonce())} dangerouslySetInnerHTML={{ __html: htmlValue(raw(`(function(){var f=document.querySelector('[data-ac-form]');if(!f)return;var rows=[].slice.call(f.querySelectorAll('[data-ac-row]')),q=f.querySelector('[data-ac-search]'),cnt=f.querySelector('[data-ac-count]');
function upd(){var n=0,t=(q.value||'').trim().toLowerCase();rows.forEach(function(r){var c=r.querySelector('input').checked;if(c)n++;r.style.display=(!t||c||r.getAttribute('data-k').indexOf(t)>=0)?'':'none';});cnt.textContent=n?'('+n+'টি টিক দেওয়া)':'';}
q.addEventListener('input',upd);f.addEventListener('change',upd);upd();})();`)) }} /></section>);
}

async function saveAdminCountry(ctx: AdminCtx) {
  const G = $services_geolock;
  const b = await ctx.body();
  const on = !!b.on;
  const picked = [...new Set(([] as Loose[]).concat(b.c || []).map((x) => String(x).toUpperCase()).filter((x) => Object.hasOwn(G.COUNTRIES, x) && x !== G.ADMIN_HOME))];
  let until = String(b.until || '').trim();
  if (until && !/^\d{4}-\d{2}-\d{2}$/.test(until)) return ctx.fail('/admin/security', 'তারিখটা ঠিক নেই।');
  if (picked.length && !until) return ctx.fail('/admin/security', 'বাছাই করা দেশ কোন তারিখ পর্যন্ত খোলা থাকবে, সেটা দিন।');
  if (until) {
    const t = Date.parse(`${until}T23:59:59+06:00`);
    if (!Number.isFinite(t) || t < Date.now()) return ctx.fail('/admin/security', 'শেষ তারিখ আজ বা তার পরের কোনো দিন হতে হবে।');
    if (t > Date.now() + 366 * 864e5) return ctx.fail('/admin/security', 'সর্বোচ্চ ১ বছর পর্যন্ত খোলা রাখা যায়।');
  }
  if (!picked.length) until = '';
  // never lock yourself out while saving: the country you are in now must stay open
  const here = G.countryOf(ctx.req);
  if (on && here && here !== G.ADMIN_HOME && !picked.includes(here)) {
    return ctx.fail('/admin/security', `আপনি এখন ${G.countryName(here)}-এ আছেন। এই দেশে টিক না দিলে সেভ করার সাথে সাথে আপনি নিজেই আটকে যাবেন — আগে এটায় টিক দিন।`);
  }
  await db.setMany({ admin_geo_on: on ? '1' : '0', admin_geo_extra: picked.join(','), admin_geo_until: until });
  await ctx.reloadSettings();
  await ctx.log('settings', 'security', null, `অ্যাডমিন দেশ তালা: ${on ? 'চালু' : 'বন্ধ'} — বাংলাদেশ${picked.length ? ' + ' + picked.join(', ') + ' (' + until + ' পর্যন্ত)' : ''}`);
  return ctx.back('/admin/security', 'saved');
}

// 🔑 গোপন চাবির কপি (owner, 2026-10-17): ENCRYPTION_KEY lives only in Vercel. If it is ever lost, every saved
// payment / courier / Gmail password becomes unreadable. The owner can see it here — but only with the 6-digit code
// e-mailed to the shop's Gmail (the same guard as permanent deletes), and every look is logged and announced.
async function showKey(ctx: AdminCtx) {
  const b = await ctx.body();
  const bad = await delcode.check(ctx, 'show_key', b.del_code);
  if (bad) return ctx.fail('/admin/security#key-copy', bad);
  const key = String(process.env.ENCRYPTION_KEY || '').trim();
  await ctx.log('settings', 'security', null, 'গোপন চাবি (ENCRYPTION_KEY) দেখা হলো');
  $services_notify.securityAlert(ctx.settings, 'গোপন চাবি দেখা হলো',
    `কেউ Admin → নিরাপত্তা থেকে দোকানের গোপন চাবি (ENCRYPTION_KEY) দেখেছে।\nকে: ${ctx.user.name || ctx.user.username || ''}\nযেখান থেকে: ${ctx.ip || ''}`,
    { extraEmail: delcode.CODE_EMAIL }).catch(() => {});
  ctx.reply.header('Cache-Control', 'no-store');
  const body = toHtml(<><h1>🔑 দোকানের গোপন চাবি</h1><section className="panel">{(key ? <><p>এটা আপনার{' '}<b>ENCRYPTION_KEY</b>। কাগজে হুবহু লিখে (বা প্রিন্ট করে) বাসার নিরাপদ জায়গায় রাখুন। ফোনের গ্যালারি, WhatsApp বা কারো কাছে পাঠাবেন না।</p><p><code className="secret-box copy" style={styleOf("font-size:18px;word-break:break-all")}><Val v={key} /></code></p><p className="small muted">কখন লাগবে: Vercel থেকে চাবিটা কোনোভাবে মুছে গেলে বা নতুন সার্ভারে দোকান সরালে — তখন Vercel → Settings → Environment Variables →{' '}<code>ENCRYPTION_KEY</code>{' '}= এই লেখা → Redeploy। তাহলে সেভ করা সব পাসওয়ার্ড আবার পড়া যাবে।</p><p className="small muted">চাবি পরীক্ষার ছাপ:{' '}<code><Val v={security.keyFingerprint()} /></code>{' '}(লিখে রাখা চাবি ঠিক আছে কিনা Claude এটা দিয়ে মিলিয়ে দেখতে পারে)।</p></> : <p className="flash flash-error">Vercel-এ এখনো ENCRYPTION_KEY বসানো নেই — নিরাপত্তা পেজের "এক ধাপ বাকি" অংশ দেখুন।</p>)}<p><a className="btn btn-ghost" href="/admin/security">← নিরাপত্তায় ফিরুন</a></p></section></>);
  return ctx.page('গোপন চাবি', body, 'security');
}

async function page(ctx: AdminCtx) {
  const s = ctx.settings;
  const https = String(ctx.req.headers['x-forwarded-proto'] || '').includes('https');
  const hasKey = security.hasKey();
  const fpStored = s.enc_key_fp || '';
  const keyChanged = hasKey && fpStored && fpStored !== security.keyFingerprint();
  const locked = Number(s.__secrets_locked || 0);
  const lockedNames = String(s.__secrets_locked_keys || '').split(',').filter(Boolean).map((k) => [k, ...(SECRET_NAMES[k] || [k, ''])]);
  const lockOn = lock.isOn(s);
  const recLeft = await $recovery.available();
  const [blocked, staff] = await Promise.all([
    db.q(`SELECT detail, created_at FROM activity_log WHERE action='blocked' ORDER BY id DESC LIMIT 15`).catch(() => []),
    db.q(`SELECT name, username, role, active, last_login FROM staff ORDER BY role='owner' DESC, id`).catch(() => []),
  ]);
  const suggested = crypto.randomBytes(32).toString('base64url');
  const move = await $services_dbmove.report();
  const ikOn = $services_imagekit.configured();
  const dbLeft = await db.one(`SELECT count(*)::int AS n FROM media WHERE ik_url IS NULL AND data IS NOT NULL AND (owner_type IS NULL OR owner_type NOT IN ('staff','trash:staff'))`).catch(() => ({ n: 0 }));

  const body = toHtml(<><h1>🛡️ নিরাপত্তা</h1><Val v={ui.flash(ctx.flash)} />{' '}{(locked && hasKey ? <div className="flash flash-error">⚠️{' '}<Val v={ui.bn(locked)} />টি পুরোনো সেভ করা পাসওয়ার্ড/কোড আগের একটা চাবি দিয়ে তালা দেওয়া ছিল, তাই এখন পড়া যাচ্ছে না। বাকি সব ঠিক আছে।<ul style={styleOf("margin:8px 0 0")}>{jsxList(lockedNames.map(([k, name, where]) => <li style={styleOf("margin:6px 0")}><b><Val v={name} /></b>{(where ? <>{' '}— নতুন করে দিতে:{' '}<a href={attrValue(where)}>এখানে যান</a></> : null)}<form method="post" action="/admin/security/forget-locked" style={styleOf("display:inline;margin-left:8px")} data-confirm={`${attrValue(name)} মুছে দেবেন? দরকার হলে পরে আবার নতুন করে বসাতে পারবেন।`}><input type="hidden" name="key" defaultValue={attrValue(k)} /><button className="btn btn-sm btn-ghost">🗑️ এটা মুছে দিন</button></form></li>))}</ul><p className="small" style={styleOf("margin:8px 0 0")}>এটা ব্যবহার না করলে শুধু "মুছে দিন" চাপুন, সতর্কবার্তা চলে যাবে। ব্যবহার করলে নতুন করে বসান।</p></div> : null)}{' '}{(keyChanged && !locked ? <p className="flash flash-error">⚠️ Vercel-এর{' '}<b>ENCRYPTION_KEY</b>{' '}বদলে গেছে।</p> : null)}{' '}{(locked && !hasKey ? <p className="flash flash-error">⚠️ Vercel থেকে{' '}<b>ENCRYPTION_KEY</b>{' '}মুছে গেছে।{' '}<Val v={ui.bn(locked)} />টি সেভ করা পাসওয়ার্ড/API কী এখন পড়া যাচ্ছে না — আগের কী-টা আবার বসিয়ে Redeploy দিন।</p> : null)}<section className="panel"><h2>সাইট যেভাবে সুরক্ষিত আছে</h2><ul className="sec-list"><Val v={row(https, 'HTTPS (তালা চিহ্ন) — সব তথ্য এনক্রিপ্ট হয়ে যায়', https ? 'ক্রেতার ব্রাউজার থেকে সাইট পর্যন্ত সব তথ্য এনক্রিপ্টেড। মাঝপথে কেউ পড়তে পারবে না। ব্রাউজারকে সবসময় HTTPS ব্যবহার করতে বলা আছে (HSTS)।' : 'এখন HTTPS ছাড়া খোলা হয়েছে। Vercel-এ সাইট নিজে থেকেই HTTPS এ চলে।')} />{' '}<Val v={(() => { const d = $pg.databaseInfo(); return row(true, `ডাটাবেসের সংযোগ এনক্রিপ্টেড — এখন চলছে: ${d.provider || 'অজানা'}`, `সাইট আর ডাটাবেসের মধ্যে সব তথ্য TLS দিয়ে এনক্রিপ্ট হয়ে যায়। এখন ব্যবহার হচ্ছে ${d.provider || '?'} (${d.variable || '?'})।`); })()} />{' '}<Val v={(() => {
      const d = $pg.databaseInfo();
      if (d.provider !== 'Supabase') return '';
      const t = $pg.databaseTls();
      return row(!t.problem, 'ডাটাবেসের সার্টিফিকেট যাচাই (মাঝপথে নকল সার্ভার বসানো বন্ধ)', !t.problem
        ? 'চালু: Supabase-এর আসল সার্টিফিকেট মিলিয়ে তবেই সংযোগ হয় — কিছু সেট করতে হয়নি, চাবিটা কোডের ভেতরেই আছে।'
        : toHtml(<>⚠️ এবার সার্টিফিকেট মেলেনি (<Val v={t.problem} />), তাই দোকান চালু রাখতে আগের মতো শুধু এনক্রিপ্ট করে সংযোগ হয়েছে। সাধারণত Supabase সার্টিফিকেট বদলালে এমন হয় — Claude-কে জানান।{' '}<a href="/admin/health">বিস্তারিত →</a></>));
    })()} />{' '}<Val v={row(ikOn, 'ছবি রাখা হয় ImageKit-এ (ডাটাবেস হালকা থাকে)', ikOn ? toHtml(<>চালু।{' '}{(dbLeft!.n ? <><Val v={ui.bn(dbLeft!.n)} />টি পুরনো ছবি এখনো ডাটাবেসে, প্রতি ঘণ্টায় একটু একটু করে ImageKit-এ সরে যাচ্ছে।</> : "সব ছবি ImageKit-এ।")}</>) : 'বন্ধ: Vercel-এ IMAGEKIT_PRIVATE_KEY ও IMAGEKIT_URL_ENDPOINT বসানো হয়নি, তাই ছবি ডাটাবেসেই থাকছে।')} />{' '}{(move ? <Val v={row(!!(move.done && move.verify && move.verify.ok), 'পুরনো Neon থেকে নতুন ডাটাবেসে তথ্য সরানো', move.done ? (move.verify && move.verify.ok ? toHtml(<>✅ শেষ,{' '}<Val v={ui.bn(move.verify.tables)} />টি টেবিলের{' '}<Val v={ui.bn(move.verify.rows)} />টি তথ্য ১০০% মিলেছে ({fmtDate(move.finished_at)})। এখন Vercel থেকে Neon মুছে ফেলা নিরাপদ।</>) : toHtml(<>⚠️ অমিল:{' '}<Val v={(move.verify && move.verify.mismatches || []).join(', ')} />। Neon মুছবেন না।</>)) : toHtml(<>চলছে:{' '}<Val v={ui.bn(move.copied || 0)} />{' '}/{' '}<Val v={ui.bn(move.total || 0)} /></>))} /> : null)}{' '}<Val v={row(hasKey, 'পেমেন্ট ও কুরিয়ারের পাসওয়ার্ড/API কী এনক্রিপ্ট করে রাখা', hasKey ? 'বিকাশ, SSLCommerz, Pathao, Steadfast ইত্যাদির গোপন তথ্য AES-256 দিয়ে তালাবদ্ধ। কেউ ডাটাবেসের কপি পেলেও এগুলো পড়তে পারবে না।' : 'এখনো চালু হয়নি — নিচের "এক ধাপ বাকি" অংশ দেখুন।')} />{' '}<Val v={row($services_notify.emailConfig(s).ready, 'নিরাপত্তা সতর্কতা ও ইমেইলে পাসওয়ার্ড রিসেট', $services_notify.emailConfig(s).ready ? toHtml(<>কেউ পাসওয়ার্ড রিসেট করলে, বারবার ভুল পাসওয়ার্ড দিলে বা মালিক হিসেবে লগইন করলে আপনাকে ইমেইল/WhatsApp এ জানানো হয়।{' '}<a href="/admin/notify">বদলান →</a></>) : toHtml(<>এখনো বন্ধ। Gmail App Password বসালে চালু হবে, তখন পাসওয়ার্ড ভুলে গেলে ইমেইলেই রিসেট লিংক পাবেন।{' '}<a href="/admin/notify">চালু করুন →</a></>))} />{' '}<Val v={row(recLeft > 0 || String(process.env.ADMIN_RESET_CODE || '').trim().length >= 12, 'জরুরি রিকভারি কোড (ফোন হারালে / ক্যামেরা নষ্ট হলে)', recLeft > 0 ? toHtml(<>কাগজে লেখা{' '}<Val v={ui.bn(recLeft)} />টি কোড বাকি আছে। ফোন হারালেও "পাসওয়ার্ড ভুলে গেছেন?" থেকে এগুলো দিয়ে ঢুকতে পারবেন।{' '}<a href="/admin/security/recovery">দেখুন →</a></>) : toHtml(<>এখনো বানানো হয়নি! ফোন হারালে বা ক্যামেরা নষ্ট হলে আটকে যেতে পারেন।{' '}<a href="/admin/security/recovery">এখনই বানান →</a></>))} />{' '}<Val v={row(lockOn, 'মালিকের লগইনে আঙুলের ছাপ (পাসকি)', lockOn ? toHtml(<>চালু:{' '}<Val v={lock.MODE_NAMES[lock.mode(s)]} />। পাসওয়ার্ড চুরি হলেও আপনার ফোন/আঙুলের ছাপ ছাড়া কেউ মালিক হিসেবে ঢুকতে পারবে না।{' '}<a href="/admin/security/login">বদলান →</a></>) : toHtml(<>এখনো বন্ধ। চালু করলে পাসওয়ার্ডের পরেও আঙুলের ছাপ লাগবে।{' '}<a href="/admin/security/login">চালু করুন →</a></>))} />{' '}<Val v={row(null, 'GitHub-এ কোড প্রাইভেট রাখা', 'দোকানের পুরো কোড GitHub-এ আছে। রিপোজিটরি Public থাকলে যে কেউ কোড পড়ে দুর্বল জায়গা খুঁজতে পারে, আর রাতের ব্যাকআপ ফাইলও (তালাবদ্ধ হলেও) নামাতে পারে। GitHub → রিপো → Settings → একদম নিচে Danger Zone → Change visibility → Private।')} />{' '}<Val v={row(true, 'অ্যাডমিন পাসওয়ার্ড নিরাপদে রাখা', 'পাসওয়ার্ড কোথাও সরাসরি লেখা থাকে না, scrypt দিয়ে এমনভাবে বদলে রাখা হয় যে উল্টো করে বের করা যায় না।')} />{' '}<Val v={row(true, 'পাসওয়ার্ড অনুমান করে ঢোকা বন্ধ', 'একই জায়গা থেকে ৮ বার ভুল পাসওয়ার্ড দিলে ১৫ মিনিট, আর একই ইউজারনেমে ১৫ বার ভুল হলে ১ ঘণ্টা লগইন বন্ধ থাকে।')} />{' '}<Val v={row(true, 'অন্য ওয়েবসাইট থেকে অ্যাডমিনের ফর্ম পাঠানো বন্ধ', 'অ্যাডমিনের যেকোনো সেভ/মুছে ফেলা শুধু এই সাইট থেকেই করা যায়। লগইন কুকি জাভাস্ক্রিপ্ট দিয়ে পড়া যায় না।')} />{' '}<Val v={row(true, 'ভাইরাস বা ভুয়া ফাইল আপলোড বন্ধ', 'আপলোডের সময় ফাইলের ভেতরের আসল গঠন পরীক্ষা হয় — শুধু সত্যিকারের JPG, PNG, WebP, GIF ছবি নেওয়া হয়। নাম বদলানো ভাইরাস বা স্ক্রিপ্ট ঢুকতে পারবে না।')} />{' '}<Val v={row(true, 'ডাটাবেসে বাইরে থেকে কমান্ড ঢোকানো (SQL Injection) বন্ধ', 'ক্রেতা বা কেউ যা-ই লিখুক, সেটা শুধু লেখা হিসেবে সেভ হয় — ডাটাবেসের কমান্ড হিসেবে কখনো চলে না।')} />{' '}<Val v={row(true, 'সাইটে ক্ষতিকর স্ক্রিপ্ট ঢোকানো (XSS) বন্ধ', 'নাম, ঠিকানা, রিভিউ, সার্চ — সব লেখা দেখানোর আগে নিরাপদ করা হয়। মেনু/ব্যানারের লিংকে "javascript:" জাতীয় কৌশল কাজ করে না। অ্যাডমিন প্যানেলে বাইরের কোনো স্ক্রিপ্ট চলতে পারে না।')} />{' '}<Val v={row(true, 'কোড বসানোর ঘর শুধু মালিকের', 'পিক্সেলের বাড়তি কোড, চ্যাট স্ক্রিপ্ট, স্কোর উইজেট — এসব শুধু মালিক বদলাতে পারবেন, কোনো স্টাফ না।')} />{' '}<Val v={row(true, 'ভুয়া অর্ডার আর স্প্যাম আটকানো', 'একই সংযোগ থেকে ঘণ্টায় ১০টার বেশি অর্ডার, ১০ মিনিটে ৩০ বারের বেশি কুপন চেষ্টা বা ৬০টার বেশি অর্ডার পেজ খোলা যায় না।')} />{' '}<Val v={row(true, 'ক্রেতার তথ্য গোপন', 'অর্ডার নম্বর জানলেও অন্য কেউ ক্রেতার ঠিকানা বা পুরো মোবাইল নম্বর দেখতে পারবে না — যে ব্রাউজার থেকে অর্ডার হয়েছে, অথবা মোবাইল নম্বর যাচাই করলে তবেই দেখা যায়।')} />{' '}<Val v={row(true, 'পেমেন্ট জাল করা অসম্ভব', 'বিকাশ/কার্ডের পেমেন্ট সবসময় সরাসরি বিকাশ বা SSLCommerz-এর সার্ভার থেকে যাচাই করা হয়, টাকার পরিমাণও মেলানো হয়।')} />{' '}<Val v={row(true, 'কুরিয়ারের আপডেট যাচাই', 'Pathao/Steadfast থেকে আসা আপডেট গোপন টোকেন মিলিয়ে তবেই নেওয়া হয়।')} />{' '}<Val v={row(null, 'সার্ভার ডাউন করার আক্রমণ (DDoS)', 'সাইট Vercel-এ চলে, যার নিজস্ব DDoS সুরক্ষা সবসময় চালু থাকে। খুব বড় আক্রমণ হলে Vercel-এ এক ক্লিকে "Attack Challenge Mode" চালু করা যায় (নিচে দেখুন)।')} /></ul></section><Val v={adminCountryPanel(ctx)} />{' '}{(hasKey ? <section className="panel" id="key-copy"><h2>🔑 গোপন চাবির কপি নিজের কাছে রাখুন</h2><p className="small">দোকানের সব সেভ করা পাসওয়ার্ড (বিকাশ, কুরিয়ার, Gmail…) একটা চাবি দিয়ে তালা দেওয়া, চাবিটা শুধু Vercel-এ আছে। Vercel থেকে কোনোদিন মুছে গেলে সেগুলো আর পড়া যাবে না — তাই একবার দেখে কাগজে লিখে রাখুন। দেখতে{' '}<b><Val v={delcode.masked()} /></b>-এ আসা কোড লাগবে, আর প্রতিবার দেখা হলে আপনাকে ইমেইলে জানানো হবে।</p><form method="post" action="/admin/security/key" className="form" data-delcode="show_key" data-delcode-to={attrValue(delcode.masked())} data-delcode-title="🔑 চাবি দেখার কোড" data-delcode-intro="গোপন চাবি দেখার আগে একটা কোড লাগবে। কোড যাবে এই ইমেইলে:" data-delcode-go="🔑 চাবি দেখান" data-delcode-what="গোপন চাবির কপি দেখা"><button className="btn">🔑 চাবি দেখুন</button></form><p className="small muted">ব্যাকআপ খোলার পাসওয়ার্ড আলাদা — সেটা{' '}<a href="/admin/backup">ব্যাকআপ পেজে</a>{' '}আছে, সেটাও লিখে রাখুন। আর{' '}<a href="/admin/security/recovery">রিকভারি কোড</a>{' '}প্রিন্ট করে রাখুন।</p></section> : null)}{' '}{(hasKey ? null : <section className="panel sec-step"><h2>⚠️ এক ধাপ বাকি: গোপন তথ্য এনক্রিপশন চালু করুন (৫ মিনিট)</h2><p>এটা আপনাকে নিজে Vercel-এ একবার করতে হবে, কারণ চাবিটা ডাটাবেসের বাইরে রাখতে হয় — তাহলেই ডাটাবেস চুরি হলেও পাসওয়ার্ড পড়া যাবে না।</p><ol><li>নিচের চাবিটা কপি করুন, আর কোথাও নিরাপদে লিখে রাখুন (যেমন খাতায়):<br /><code className="sec-key"><Val v={suggested} /></code></li><li><b>vercel.com</b>{' '}এ ঢুকে আপনার প্রজেক্ট খুলুন →{' '}<b>Settings</b>{' '}→{' '}<b>Environment Variables</b>।</li><li><b>Key</b>{' '}ঘরে লিখুন:{' '}<code>ENCRYPTION_KEY</code>{' '}—{' '}<b>Value</b>{' '}ঘরে কপি করা চাবিটা পেস্ট করুন →{' '}<b>Save</b>।</li><li><b>Deployments</b>{' '}এ গিয়ে সবচেয়ে উপরেরটার পাশে{' '}<b>⋯</b>{' '}→{' '}<b>Redeploy</b>।</li><li>২ মিনিট পর এই পেজটা আবার খুলুন — উপরে সবুজ ✅ দেখাবে, আর আগের সব পাসওয়ার্ড নিজে থেকেই এনক্রিপ্ট হয়ে যাবে।</li></ol><p className="small muted">⚠️ চাবিটা একবার বসানোর পর আর বদলাবেন না বা মুছবেন না। বদলালে সেভ করা পেমেন্ট/কুরিয়ারের পাসওয়ার্ডগুলো আবার দিতে হবে। (প্রতিবার পেজ খুললে নতুন একটা চাবি দেখায় — যেকোনো একটা ব্যবহার করলেই হবে।)</p></section>)}<section className="panel"><h2>আপনার করণীয় (ভালো অভ্যাস)</h2><ul className="sec-list"><Val v={row(null, 'শক্ত পাসওয়ার্ড দিন', 'কমপক্ষে ১২ অক্ষর, অক্ষর-সংখ্যা মিশিয়ে। মোবাইল নম্বর বা নাম দিয়ে পাসওয়ার্ড দেবেন না। প্রতিটা স্টাফের আলাদা অ্যাকাউন্ট দিন, কারো সাথে পাসওয়ার্ড শেয়ার করবেন না।')} />{' '}<Val v={row(null, 'স্টাফকে শুধু দরকারি অনুমতি দিন', 'কেউ চাকরি ছেড়ে দিলে সাথে সাথে "স্টাফ" মেনু থেকে তার অ্যাকাউন্ট বন্ধ করুন।')} />{' '}<Val v={row(null, 'Vercel আর GitHub অ্যাকাউন্টে টু-ফ্যাক্টর (2FA) চালু করুন', 'সাইটের আসল চাবি এই দুই অ্যাকাউন্টে। দুটোর Settings → Security থেকে 2FA চালু রাখলে পাসওয়ার্ড চুরি হলেও কেউ ঢুকতে পারবে না।')} />{' '}<Val v={row(null, 'বড় আক্রমণ হলে: Vercel Attack Challenge Mode', 'Vercel → প্রজেক্ট → Firewall → "Attack Challenge Mode" চালু করলে সন্দেহজনক ভিজিটরদের আগে যাচাই করা হয়। সাধারণ সময়ে বন্ধ রাখুন।')} />{' '}<Val v={row(null, 'ডাটাবেসের ব্যাকআপ', toHtml(<>দোকান প্রতিরাতে নিজে থেকে পুরো ডাটাবেসের তালাবদ্ধ ব্যাকআপ নেয় (শেষ ৩০টা থাকে)। ২ দিনের বেশি ব্যাকআপ না হলে ইমেইলে জানানো হয়।{' '}<a href="/admin/backup">ব্যাকআপ পেজ →</a></>))} /></ul></section><div className="two-col"><section className="panel"><h2>সাম্প্রতিক আটকানো চেষ্টা</h2>{(blocked.length ? <ul className="sec-log">{jsxList(blocked.map((b) => <li><span className="small muted">{fmtDate(b.created_at)}</span><br /><Val v={b.detail} /></li>))}</ul> : <p className="muted">কোনো সন্দেহজনক চেষ্টা ধরা পড়েনি। 👍</p>)}</section><section className="panel"><h2>যারা অ্যাডমিনে ঢুকতে পারে</h2><ul className="sec-log">{jsxList(staff.map((u) => <li><b><Val v={u.name} /></b>{' '}(<Val v={u.username} />){' '}{(u.role === 'owner' ? <Val v={ui.pill('মালিক', 'pill-delivered')} /> : (u.active ? <Val v={ui.pill('স্টাফ', 'pill-confirmed')} /> : <Val v={ui.pill('বন্ধ', 'pill-cancelled')} />))}<br /><span className="small muted">শেষ লগইন:{' '}{(u.last_login ? fmtDate(u.last_login) : "কখনো না")}</span></li>))}</ul><p className="small"><a href="/admin/staff">স্টাফ পরিচালনা →</a></p></section></div></>);
  return ctx.page('নিরাপত্তা', body, 'security');
}

export const routes = [{ method: 'GET', path: '/admin/security', perm: 'owner', handler: page }, { method: 'POST', path: '/admin/security/forget-locked', perm: 'owner', handler: forgetLocked },
  { method: 'POST', path: ADMIN_COUNTRY_PATH, perm: 'owner', handler: saveAdminCountry },
  { method: 'POST', path: '/admin/security/key', perm: 'owner', handler: showKey }];
