// Admin → নোটিফিকেশন (owner only): where new-order and security alerts go (e-mail, phone push, Telegram).
// The e-mail here also receives the "forgot password" reset link, so changing it needs the owner's password.
import { Val, attrValue, jsxList } from '../react/html';
import { verifyPassword, str } from '../util';
import * as crypto from 'node:crypto';
import * as db from '../db';
import * as ui from './ui';
import * as N from '../services/notify';
import * as push from '../services/push';
import * as errors from '../services/errors';
import { fmtDate, int } from '../util';
import * as $layout from './layout';
import type { AdminCtx, RouteMatch, Caught } from '../types';
import type { IntegrationLogsRow, PushSubsRow } from '../data/rows';

const dots = (v: string | undefined) => (v ? '••••••••' : '');

async function page(ctx: AdminCtx) {
  const s = ctx.settings;
  if (ctx.method === 'POST') {
    const b = await ctx.body();
    const email = str(b.notify_email, 120).toLowerCase();
    const oldEmail = N.emailConfig(s).to;
    if (!N.validEmail(email)) return ctx.fail('/admin/notify', 'ইমেইল ঠিকানা ঠিক নেই।');
    const emailChanged = email !== oldEmail.toLowerCase();
    // keep only the letters: pasting on top of the •••• dots, spaces, or invisible characters from a phone copy all still work
    const appPass = String(b.gmail_app_password || '').replace(/[^a-z]/gi, '');
    const passChanged = appPass.length > 0;
    // The reset link goes to this address — so changing where it goes needs the owner's own password.
    if ((emailChanged || passChanged) && !verifyPassword(b.current_password || '', ctx.user.password)) {
      return ctx.fail('/admin/notify', 'ইমেইল বা App Password বদলাতে নিচে আপনার বর্তমান অ্যাডমিন পাসওয়ার্ড দিন।');
    }
    if (passChanged && !/^[a-z]{16}$/i.test(appPass)) return ctx.fail('/admin/notify', 'Gmail App Password ১৬ অক্ষরের হয় (যেমন abcd efgh ijkl mnop)। আবার কপি করে দিন।');
    // a new Google code is tried first: a code Gmail refuses is never saved over one that works
    if (passChanged) {
      try {
        await N.smtpSend({ user: email, pass: appPass, to: email, fromName: s.store_name, subject: `✅ ${s.store_name}: দোকানের Gmail চালু হয়েছে`,
          text: 'অভিনন্দন! এখন থেকে এই Gmail থেকে যাবে: নতুন অর্ডারের খবর, কাস্টমারের সাইন-আপ কোড আর মোছার কোড।' });
        await db.logIntegration('notify-email', 'test', true, 'পাঠানো হয়েছে');
      } catch (caught) { const e = caught as Caught;
        await db.logIntegration('notify-email', 'test', false, e.message);
        return ctx.fail('/admin/notify', `সেভ হয়নি — Gmail নতুন কোডটা নেয়নি: ${String(e.message || e).slice(0, 200)}। ${N.maskEmail(email)} দিয়ে লগইন করে সেই Gmail-এর App Password নিন।`);
      }
    }
    await db.setSetting('notify_email', email);
    if (passChanged) await db.setSetting('gmail_app_password', appPass);
    if (b.clear_gmail) await db.setSetting('gmail_app_password', '');
    if (b.clear_tg) await db.setSetting('tg_owner_chat', '');
    // Sentry (error alerts): the key pasted here is the only place it is set
    const dsn = String(b.sentry_dsn || '').trim();
    const dsnChanged = !!dsn && !/^•+$/.test(dsn);
    if (dsnChanged && !errors.validDsn(dsn)) return ctx.fail('/admin/notify', 'Sentry-র DSN ঠিক নেই। sentry.io → Project Settings → Client Keys (DSN) থেকে পুরো লিংকটা কপি করুন (https://…@….sentry.io/… এর মতো)।');
    if (dsnChanged) await db.setSetting('sentry_dsn', dsn);
    if (b.clear_sentry) await db.setSetting('sentry_dsn', '');
    if (b.more) for (const k of ['notify_order_email', 'notify_order_wa', 'notify_order_push', 'notify_security', 'notify_owner_login', 'notify_low_stock']) await db.setSetting(k, b[k] ? '1' : '0');
    await ctx.reloadSettings();
    // Sentry starts at once on this server; a first test error shows the owner it works (Sentry e-mails new problems)
    errors.ensure(ctx.settings);
    if (dsnChanged && errors.isOn()) errors.report(new Error(`✅ ${ctx.settings.store_name}: Sentry চালু হয়েছে — এটা শুধু পরীক্ষা, কিছু করতে হবে না`), { test: true });
    if (dsnChanged) await errors.flush(3000);
    // a channel that was just set up gets a test message at once, so the owner sees it working
    const tried: [string, () => Promise<unknown>][] = [];
    if (emailChanged && !passChanged && N.emailConfig(ctx.settings).ready) tried.push(['ইমেইল', () => N.sendEmail(ctx.settings, `✅ ${ctx.settings.store_name}: ইমেইল নোটিফিকেশন চালু হয়েছে`, 'অভিনন্দন! এখন থেকে নতুন অর্ডার এলে এই ইমেইলে জানানো হবে।')]);
    const failedCh: unknown[] = [];
    for (const [ch, fn] of tried) {
      try { await fn(); await db.logIntegration('notify-email', 'test', true, 'পাঠানো হয়েছে'); }
      catch (caught) { const e = caught as Caught; failedCh.push(`${ch}: ${e.message}`); await db.logIntegration('notify-email', 'test', false, e.message); }
    }
    await ctx.log('settings', 'settings', null, `নোটিফিকেশন সেটিংস${emailChanged ? ` (ইমেইল বদল: ${N.maskEmail(oldEmail)} → ${N.maskEmail(email)})` : ''}`);
    if (emailChanged) {
      // tell both the old and the new address, so a silent swap can't go unnoticed
      await N.securityAlert(ctx.settings, 'নোটিফিকেশন/রিসেট ইমেইল বদলানো হয়েছে',
        `পুরোনো: ${oldEmail}\nনতুন: ${email}\nযে বদলেছে: ${ctx.user.name} (${ctx.ip})`, { extraEmail: oldEmail });
    }
    if (failedCh.length) return ctx.fail('/admin/notify', 'সেভ হয়েছে, কিন্তু পরীক্ষার মেসেজ যায়নি — ' + failedCh.join(' · '));
    return ctx.back('/admin/notify', tried.length || passChanged ? 'notify_live' : 'saved');
  }

  const e = N.emailConfig(s);
  const w = N.tgConfig(s);
  // the one-time code in the bot link: only the owner sees it, so only the owner's Telegram can link itself
  let tgCode = String(s.tg_owner_code || '');
  if (w.hasBot && !w.ready && !/^[a-z0-9]{12}$/.test(tgCode)) { tgCode = crypto.randomBytes(9).toString('base64url').toLowerCase().replace(/[^a-z0-9]/g, 'x').slice(0, 12); await db.setSetting('tg_owner_code', tgCode); }
  const botName = w.hasBot && !w.ready ? await N.tgBotName(s).catch(() => '') : '';
  const [pubKey, devices] = await Promise.all([
    push.publicKey(),
    db.q<Pick<PushSubsRow, 'id' | 'device' | 'created_at' | 'last_ok' | 'fails'>>("SELECT id, device, created_at, last_ok, fails FROM push_subs WHERE staff_id=$1 ORDER BY id", [ctx.user.id]),
  ]);
  const logs = await db.q<Pick<IntegrationLogsRow, 'service' | 'action' | 'ok' | 'message' | 'created_at'>>(`SELECT service, action, ok, message, created_at FROM integration_logs WHERE service LIKE 'notify-%' ORDER BY id DESC LIMIT 12`).catch(() => []);
  // (owner, 2026-11-23: "huge boxes, huge text on My notifications"): one row of channel status cards on top;
  // the form below as two even columns — channels on the left, what to be told + Save on the right; phone and the
  // test/recent list side by side at the end. Setup steps show only while a channel isn't set up yet.
  const onOff = (on: boolean) => on ? ui.pill('চালু', 'pill-delivered') : ui.pill('বন্ধ', 'pill-pending');
  const sentryOn = !!(s.sentry_dsn || process.env.SENTRY_DSN);
  const body = <><div className="title-row"><h1>🔔 অর্ডারের খবর: ইমেইল, ফোন ও Telegram</h1></div>{ui.flash(ctx.flash)}<div className="kpis kpis-tight nt-kpis">{ui.kpi('📧 ইমেইল', onOff(e.ready), e.ready ? N.maskEmail(e.to) : 'সেটআপ বাকি', '', '#email')}{' '}{ui.kpi('✈️ Telegram', onOff(w.ready), w.ready ? 'যুক্ত আছে' : 'সেটআপ বাকি', '', '#telegram')}{' '}{ui.kpi('📱 ফোনে নোটিফিকেশন', onOff(devices.length > 0), devices.length ? `${ui.bn(devices.length)}টি ডিভাইসে চালু` : 'এখনো চালু হয়নি', '', '#push')}{' '}{ui.kpi('🛠️ সাইটের এরর (Sentry)', onOff(sentryOn), sentryOn ? 'এরর হলে ইমেইল আসবে' : 'সেটআপ বাকি', '', '#sentry')}</div><form method="post" action="/admin/notify" className="form nt-grid"><div className="nt-col"><section className="set-sec" id="email"><div className="set-head"><h2 className="set-title">📧 দোকানের Gmail</h2>{onOff(e.ready)}</div><div className="set-card"><div className="field-row">{ui.field('আপনার Gmail', ui.input('notify_email', e.to, { type: 'email', required: true, maxlength: 120, autocomplete: 'off' }))}{ui.field(e.ready ? 'Google কোড (সেভ করা আছে)' : '② কোডটা এখানে বসান', ui.input('gmail_app_password', dots(s.gmail_app_password), { type: 'password', autocomplete: 'off', placeholder: 'abcd efgh ijkl mnop' }))}</div><p className="small muted nt-note">একটাই Gmail, তিনটা কাজ: নতুন অর্ডারের খবর, কাস্টমারের যাচাই কোড আর মোছার কোড।</p>{(e.ready ? null : <div className="nt-steps"><a className="btn btn-sm" href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener">① Google থেকে কোড নিন ↗</a><span className="small muted">খোলা পেজে নাম লিখুন{' '}<b>Shobmilbe</b>{' '}→{' '}<b>Create</b>{' '}চাপুন → যে ১৬ অক্ষর আসবে সেটা কপি করে উপরে বসান।</span></div>)}{(s.gmail_app_password ? ui.check('clear_gmail', false, 'Google কোড মুছে দিন (ইমেইল বন্ধ)') : null)}</div></section><section className="set-sec" id="telegram"><div className="set-head"><h2 className="set-title">✈️ Telegram-এ অর্ডারের খবর</h2>{onOff(w.ready)}</div><div className="set-card">{(w.ready ? <p className="small nt-note">✅ যুক্ত আছে — নতুন অর্ডার এলে আপনার Telegram-এ মেসেজ যাবে।</p> : !w.hasBot ? <div className="nt-steps"><a className="btn btn-sm" href="/admin/marketing/auto#telegram">Telegram বট যুক্ত করুন →</a><span className="small muted">আগে দোকানের Telegram বট যুক্ত করতে হবে (একবারই)।</span></div> : <div className="nt-steps">{(botName ? <a className="btn btn-sm" href={`https://t.me/${attrValue(botName)}?start=${attrValue(tgCode)}`} target="_blank" rel="noopener">① Telegram-এ বট খুলুন ↗</a> : <span className="small muted">⚠️ বটের নাম পাওয়া যায়নি — অটো মার্কেটিং → Telegram-এ বটের টোকেন ঠিক আছে কিনা দেখুন।</span>)}<button className="btn btn-sm btn-outline" formAction="/admin/notify/telegram" formNoValidate>② Start চেপেছি — যুক্ত করুন</button></div>)}{(w.ready ? ui.check('clear_tg', false, 'Telegram থেকে সরিয়ে দিন (Telegram-এ খবর বন্ধ)') : null)}</div></section><section className="set-sec" id="sentry"><div className="set-head"><h2 className="set-title">🛠️ সাইটের এরর (Sentry)</h2>{onOff(sentryOn)}</div><div className="set-card">{ui.field('Sentry DSN', ui.input('sentry_dsn', dots(s.sentry_dsn), { type: 'password', autocomplete: 'off', placeholder: 'https://…@….ingest.sentry.io/…' }))}{(sentryOn ? null : <p className="small muted nt-note"><a href="https://sentry.io/signup/" target="_blank" rel="noopener">sentry.io</a>-তে ফ্রি অ্যাকাউন্ট খুলুন → নতুন প্রজেক্ট (Next.js) → যে DSN দেখাবে সেটা উপরে বসান।</p>)}{(s.sentry_dsn ? ui.check('clear_sentry', false, 'Sentry বন্ধ করুন (DSN মুছে দিন)') : null)}</div></section></div><div className="nt-col"><section className="set-sec"><div className="set-head"><h2 className="set-title">কী কী জানাবে</h2></div><div className="set-card"><input type="hidden" name="more" defaultValue="1" /><div className="switch-list">{ui.switchRow('notify_order_email', s.notify_order_email !== '0', 'নতুন অর্ডার এলে ইমেইল', 'কাস্টমার, পণ্য, মোট টাকা আর অর্ডার খোলার বাটনসহ।')}{ui.switchRow('notify_order_wa', s.notify_order_wa !== '0', 'নতুন অর্ডার এলে Telegram', 'কাস্টমার, পণ্য, টাকা আর অর্ডারের লিংকসহ।')}{ui.switchRow('notify_low_stock', s.notify_low_stock !== '0', 'স্টক কমে গেলে জানাও', 'একই পণ্যের জন্য দিনে একবার।')}{ui.switchRow('notify_security', s.notify_security !== '0', 'নিরাপত্তা সতর্কতা', 'পাসওয়ার্ড রিসেট, সন্দেহজনক লগইন, এই পেজের ইমেইল বদল।')}{ui.switchRow('notify_owner_login', s.notify_owner_login !== '0', 'মালিকের অ্যাকাউন্টে লগইন হলে জানাও', 'আপনি ছাড়া কেউ ঢুকলে সাথে সাথে টের পাবেন।')}</div><input type="hidden" name="notify_order_push" defaultValue={s.notify_order_push !== '0' ? '1' : ''} /></div></section><section className="set-sec nt-save"><div className="set-card">{ui.field('আপনার অ্যাডমিন পাসওয়ার্ড', ui.input('current_password', '', { type: 'password', autocomplete: 'current-password' }), 'শুধু Gmail বা Google কোড বদলালে লাগে (নিরাপত্তার জন্য)।')}<div className="form-actions-inline"><button className="btn">💾 সেভ করুন</button></div></div></section></div></form><div className="nt-grid"><section className="set-sec push-box" id="push" data-push="" data-key={attrValue(pubKey)}><div className="set-head"><h2 className="set-title">📱 ফোনে নোটিফিকেশন</h2>{(devices.length ? ui.pill(`${ui.bn(devices.length)}টি ডিভাইসে চালু`, 'pill-delivered') : ui.pill('এখনো চালু হয়নি', 'pill-pending'))}</div><div className="set-card"><p className="small muted nt-note">যে ফোনে খবর পেতে চান, সেই ফোনে এই পেজ খুলে বোতাম চাপুন, তারপর "Allow" চাপুন।</p><div className="nt-steps"><button type="button" className="btn btn-sm" data-push-on="">🔔 এই ফোনে নোটিফিকেশন চালু করুন</button>{(devices.length ? <form method="post" action="/admin/notify/push/test"><button className="btn btn-sm btn-ghost">🔔 টেস্ট নোটিফিকেশন পাঠান</button></form> : null)}</div><p className="small" data-push-note="" hidden></p>{(devices.length ? <div className="table-wrap"><table className="table compact"><thead><tr><th>ডিভাইস</th><th>চালু হয়েছে</th><th>শেষ পৌঁছেছে</th><th></th></tr></thead><tbody>{jsxList(devices.map((d) => <tr><td><Val v={d.device || 'ডিভাইস'} />{(d.fails > 2 ? <>{' '}{ui.pill('পৌঁছাচ্ছে না', 'pill-cancelled')}</> : null)}</td><td className="small">{fmtDate(d.created_at)}</td><td className="small">{(d.last_ok ? fmtDate(d.last_ok) : "—")}</td><td><form method="post" action={`/admin/notify/push/${attrValue(d.id)}/delete`} data-confirm="এই ডিভাইসে নোটিফিকেশন বন্ধ করবেন?"><button className="btn btn-sm btn-danger">বন্ধ</button></form></td></tr>))}</tbody></table></div> : null)}</div></section><section className="set-sec"><div className="set-head"><h2 className="set-title">সাম্প্রতিক নোটিফিকেশন</h2><span className="nt-head-actions"><form method="post" action="/admin/notify/test"><input type="hidden" name="ch" defaultValue="email" /><button className="btn btn-sm btn-ghost" disabled={!(e.ready)}>📧 টেস্ট ইমেইল পাঠান</button></form><form method="post" action="/admin/notify/test"><input type="hidden" name="ch" defaultValue="tg" /><button className="btn btn-sm btn-ghost" disabled={!(w.ready)}>✈️ টেস্ট Telegram পাঠান</button></form></span></div><div className="set-card">{(logs.length ? <div className="table-wrap"><table className="table compact"><thead><tr><th>কোথায়</th><th>কী</th><th>ফল</th></tr></thead><tbody>{jsxList(logs.map((l) => <tr><td>{(l.service === 'notify-email' ? "📧 ইমেইল" : l.service === 'notify-push' ? "📱 ফোন" : l.service === 'notify-telegram' ? "✈️ Telegram" : "💬 WhatsApp")}</td><td><Val v={l.action} /></td><td>{(l.ok ? ui.pill('গেছে', 'pill-delivered') : ui.pill('যায়নি', 'pill-cancelled'))}{' '}<span className="small muted">{(l.ok ? null : <Val v={l.message} />)}</span></td></tr>))}</tbody></table></div> : <p className="muted">এখনো কোনো নোটিফিকেশন পাঠানো হয়নি।</p>)}</div></section></div><script type="module" src={`/js/admin/push.js?v=${attrValue($layout.ASSET_V)}`} /></>;
  return ctx.page('নোটিফিকেশন', body, 'notify');
}

async function pushSubscribe(ctx: AdminCtx) {
  const b = await ctx.body();
  try {
    await push.subscribe(ctx.user.id, b.sub, b.device);
  } catch (caught) { const e = caught as Caught; return ctx.json(400, { error: e.message }); }
  await ctx.log('settings', 'settings', null, `ফোনে নোটিফিকেশন চালু: ${str(b.device, 40)}`);
  try {
    await push.sendAll({ title: '✅ নোটিফিকেশন চালু হয়েছে', body: `${ctx.settings.store_name}: নতুন অর্ডার এলে এভাবেই এখানে জানানো হবে।`, url: '/admin/notify', tag: 'test' });
  } catch (caught) { const e = caught as Caught; return ctx.json(200, { ok: true, warn: e.message }); }
  return ctx.json(200, { ok: true });
}
async function pushTest(ctx: AdminCtx) {
  try {
    const n = await push.sendAll({ title: '🔔 টেস্ট নোটিফিকেশন', body: `${ctx.settings.store_name}: সব ঠিক আছে। নতুন অর্ডার এলে এভাবেই জানানো হবে।`, url: '/admin/notify', tag: 'test' });
    await db.logIntegration('notify-push', 'test', !!n, n ? 'পাঠানো হয়েছে' : 'কোনো ডিভাইস নেই');
    return n ? ctx.back('/admin/notify', 'sent_push') : ctx.fail('/admin/notify', 'কোনো ডিভাইসে নোটিফিকেশন চালু নেই।');
  } catch (caught) { const e = caught as Caught;
    await db.logIntegration('notify-push', 'test', false, e.message);
    return ctx.fail('/admin/notify', 'নোটিফিকেশন যায়নি: ' + e.message);
  }
}
async function pushDelete(ctx: AdminCtx, m: RouteMatch) {
  await db.q('DELETE FROM push_subs WHERE id=$1 AND staff_id=$2', [int(m[1]), ctx.user.id]);
  return ctx.back('/admin/notify', 'saved');
}
ui.MESSAGES.sent_push = 'টেস্ট নোটিফিকেশন পাঠানো হয়েছে, ফোনে দেখুন।';
ui.MESSAGES.notify_live = '✅ সেভ হয়েছে আর পরীক্ষার মেসেজ পাঠানো হয়েছে — Gmail/Telegram-এ দেখুন। এখন থেকে নতুন অর্ডারের খবর নিজে থেকে আসবে।';

async function test(ctx: AdminCtx) {
  const b = await ctx.body();
  const s = ctx.settings;
  try {
    if (b.ch === 'tg') await N.sendTelegram(s, `✅ ${s.store_name}: Telegram নোটিফিকেশন ঠিকমতো কাজ করছে। নতুন অর্ডার এলে এখানে মেসেজ আসবে।`);
    else await N.sendEmail(s, `✅ ${s.store_name}: ইমেইল নোটিফিকেশন কাজ করছে`, `অভিনন্দন! ইমেইল নোটিফিকেশন ঠিকমতো কাজ করছে।\n\nনতুন অর্ডার, নিরাপত্তা সতর্কতা আর পাসওয়ার্ড রিসেট লিংক এই ঠিকানায় আসবে।`);
    await db.logIntegration(b.ch === 'tg' ? 'notify-telegram' : 'notify-email', 'test', true, 'পাঠানো হয়েছে');
    return ctx.back('/admin/notify', 'saved');
  } catch (caught) { const e = caught as Caught;
    await db.logIntegration(b.ch === 'tg' ? 'notify-telegram' : 'notify-email', 'test', false, e.message);
    return ctx.fail('/admin/notify', e.message || 'পাঠানো যায়নি');
  }
}

// ✈️ links the owner's Telegram: the bot link carried a one-time code; the "/start <code>" the bot got names the chat
async function tgLink(ctx: AdminCtx) {
  const s = ctx.settings;
  if (!N.tgConfig(s).hasBot) return ctx.fail('/admin/notify', 'আগে অটো মার্কেটিং → Telegram-এ দোকানের বট যুক্ত করুন।');
  let chat: string | null = null;
  try { chat = await N.tgFindStart(s, String(s.tg_owner_code || '')); }
  catch (caught) { const e = caught as Caught; await db.logIntegration('notify-telegram', 'link', false, e.message); return ctx.fail('/admin/notify', e.message); }
  if (!chat) return ctx.fail('/admin/notify', 'বট এখনো আপনার Start পায়নি। "① Telegram-এ বট খুলুন" চেপে Telegram-এ Start চাপুন, তারপর আবার এই বোতাম চাপুন।');
  await db.setSetting('tg_owner_chat', chat);
  await db.setSetting('tg_owner_code', '');
  await ctx.reloadSettings();
  await ctx.log('settings', 'settings', null, 'Telegram-এ অর্ডারের খবর চালু');
  try {
    await N.sendTelegram(ctx.settings, `✅ *${ctx.settings.store_name}*: Telegram নোটিফিকেশন চালু হয়েছে। নতুন অর্ডার এলে এখানে মেসেজ আসবে।`);
    await db.logIntegration('notify-telegram', 'test', true, 'পাঠানো হয়েছে');
  } catch (caught) { const e = caught as Caught; await db.logIntegration('notify-telegram', 'test', false, e.message); return ctx.fail('/admin/notify', 'যুক্ত হয়েছে, কিন্তু পরীক্ষার মেসেজ যায়নি — ' + e.message); }
  return ctx.back('/admin/notify', 'notify_live');
}

export const routes = [
  { method: 'POST', path: '/admin/notify/telegram', perm: 'owner', handler: tgLink },
  { method: '*', path: '/admin/notify', perm: 'owner', handler: page },
  { method: 'POST', path: '/admin/notify/test', perm: 'owner', handler: test },
  { method: 'POST', path: '/admin/notify/push/subscribe', perm: 'owner', handler: pushSubscribe },
  { method: 'POST', path: '/admin/notify/push/test', perm: 'owner', handler: pushTest },
  { method: 'POST', path: /^\/admin\/notify\/push\/(\d+)\/delete$/, perm: 'owner', handler: pushDelete },
];
