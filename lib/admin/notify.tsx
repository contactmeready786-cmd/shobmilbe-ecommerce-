// Admin → নোটিফিকেশন (owner only): where new-order and security alerts go (e-mail + WhatsApp).
// The e-mail here also receives the "forgot password" reset link, so changing it needs the owner's password.
import { Val, attrValue, styleOf, jsxList } from '../react/html';
import { verifyPassword, str } from '../util';
import * as db from '../db';
import * as ui from './ui';
import * as N from '../services/notify';
import * as push from '../services/push';
import * as errors from '../services/errors';
import { fmtDate, int } from '../util';
import * as $layout from './layout';
import type { AdminCtx, Loose, RouteMatch } from '../types';

const dots = (v?: Loose) => (v ? '••••••••' : '');

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
      } catch (e: Loose) {
        await db.logIntegration('notify-email', 'test', false, e.message);
        return ctx.fail('/admin/notify', `সেভ হয়নি — Gmail নতুন কোডটা নেয়নি: ${String(e.message || e).slice(0, 200)}। ${N.maskEmail(email)} দিয়ে লগইন করে সেই Gmail-এর App Password নিন।`);
      }
    }
    // a freshly typed code decides the service by itself (no need to also pick the right button)
    const fresh = (v?: Loose) => { const x = str(v, 60).trim(); return x && !/^•+$/.test(x) ? x : ''; };
    const gToken = fresh(b.greenapi_token);
    const gId = String(b.greenapi_id || '').replace(/\D/g, '');
    const provider = (gToken || (gId && gId !== String(s.greenapi_id || ''))) && !fresh(b.callmebot_key) ? 'greenapi'
      : fresh(b.callmebot_key) && !gToken ? 'callmebot'
      : ['greenapi', 'callmebot'].includes(b.wa_provider) ? b.wa_provider : (s.wa_provider || 'callmebot');
    if (gId && !/^\d{6,15}$/.test(gId)) return ctx.fail('/admin/notify', 'idInstance শুধু সংখ্যা হয় (যেমন 7103123456)। আবার কপি করে দিন।');
    if (gToken && !/^[A-Za-z0-9]{20,80}$/.test(gToken)) return ctx.fail('/admin/notify', 'apiTokenInstance ঠিক নেই। Green-API কনসোল থেকে পুরোটা কপি করে দিন।');
    const keyField = provider === 'textmebot' ? 'textmebot_key' : 'callmebot_key';
    const key = provider === 'greenapi' ? gToken : str(b[keyField], 60).trim();
    if (provider !== 'greenapi' && key && !/^•+$/.test(key) && !/^[A-Za-z0-9_-]{4,60}$/.test(key)) return ctx.fail('/admin/notify', 'WhatsApp কোড ঠিক নেই (শুধু সংখ্যা/অক্ষর)। আবার কপি করে দিন।');
    const phone = str(b.wa_notify_phone, 20);

    await db.setSetting('notify_email', email);
    if (passChanged) await db.setSetting('gmail_app_password', appPass);
    if (b.clear_gmail) await db.setSetting('gmail_app_password', '');
    await db.setSetting('wa_notify_phone', phone);
    const providerChanged = provider !== (s.wa_provider || 'callmebot');
    await db.setSetting('wa_provider', provider);
    if (gId) await db.setSetting('greenapi_id', gId);
    if (gToken) await db.setSetting('greenapi_token', gToken);
    if (provider !== 'greenapi' && key && !/^•+$/.test(key)) await db.setSetting(keyField, key);
    if (b.clear_wa) for (const k of ['callmebot_key', 'textmebot_key', 'greenapi_id', 'greenapi_token']) await db.setSetting(k, '');
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
    const waKeyChanged = (key && !/^•+$/.test(key)) || !!gId;
    const tried: Loose[] = [];
    if (emailChanged && !passChanged && N.emailConfig(ctx.settings).ready) tried.push(['email', () => N.sendEmail(ctx.settings, `✅ ${ctx.settings.store_name}: ইমেইল নোটিফিকেশন চালু হয়েছে`, 'অভিনন্দন! এখন থেকে নতুন অর্ডার এলে এই ইমেইলে জানানো হবে।')]);
    if ((waKeyChanged || providerChanged || phone !== String(s.wa_notify_phone || '')) && N.waConfig(ctx.settings).ready) tried.push(['wa', () => N.sendWhatsApp(ctx.settings, `✅ ${ctx.settings.store_name}: WhatsApp নোটিফিকেশন চালু হয়েছে। নতুন অর্ডার এলে এখানে মেসেজ আসবে।`)]);
    const failedCh: Loose[] = [];
    for (const [ch, fn] of tried) {
      try { await fn(); await db.logIntegration(ch === 'wa' ? 'notify-whatsapp' : 'notify-email', 'test', true, 'পাঠানো হয়েছে'); }
      catch (e: Loose) { failedCh.push(ch === 'wa' ? 'WhatsApp: ' + e.message : 'ইমেইল: ' + e.message); await db.logIntegration(ch === 'wa' ? 'notify-whatsapp' : 'notify-email', 'test', false, e.message); }
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
  const w = N.waConfig(s);
  const [pubKey, devices] = await Promise.all([
    push.publicKey(),
    db.q("SELECT id, device, created_at, last_ok, fails FROM push_subs WHERE staff_id=$1 ORDER BY id", [ctx.user.id]),
  ]);
  const logs = await db.q(`SELECT service, action, ok, message, created_at FROM integration_logs WHERE service LIKE 'notify-%' ORDER BY id DESC LIMIT 12`).catch(() => []);
  const body = <><h1>🔔 অর্ডারের খবর: ইমেইল ও WhatsApp</h1>{ui.flash(ctx.flash)}<p className="muted">ওয়েবসাইটে নতুন অর্ডার এলে, আর কেউ পাসওয়ার্ড রিসেট বা সন্দেহজনক কিছু করলে আপনাকে সাথে সাথে জানানো হবে। এই পেজ শুধু মালিক দেখতে পান।</p><form method="post" action="/admin/notify" className="form"><div className="two-col"><section className="panel"><h2>📧 দোকানের Gmail{' '}{(e.ready ? ui.pill('✅ চালু', 'pill-delivered') : ui.pill('চালু হয়নি', 'pill-pending'))}</h2><p className="small note">একটাই Gmail, তিনটা কাজ:{' '}<b>①</b>{' '}নতুন অর্ডারের খবর আপনাকে,{' '}<b>②</b>{' '}কাস্টমার অ্যাকাউন্ট খোলার যাচাই কোড,{' '}<b>③</b>{' '}স্থায়ীভাবে মোছার কোড। Google-এর ১৬ অক্ষরের কোড শুধু এখানেই বসাতে হবে।</p>{ui.field('আপনার Gmail', ui.input('notify_email', e.to, { type: 'email', required: true, maxlength: 120, autocomplete: 'off' }))}{' '}{(e.ready ? <p className="small good">✅ নতুন অর্ডার এলে এই Gmail-এ নিজে থেকে মেইল যাবে।</p> : <><p className="small"><b>শুধু প্রথমবার, এক মিনিট:</b>{' '}Google নিজের নিয়মে একটা অনুমতির কোড চায় (যাতে অন্য কেউ আপনার নামে মেইল পাঠাতে না পারে)।</p><p><a className="btn" href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener">① Google থেকে কোড নিন ↗</a></p><p className="small muted">খোলা পেজে নাম লিখুন{' '}<b>Shobmilbe</b>{' '}→{' '}<b>Create</b>{' '}চাপুন → যে ১৬ অক্ষর আসবে সেটা কপি করে নিচে বসান। (পেজটা না খুললে আগে Gmail-এ 2-Step Verification চালু করুন।)</p></>)}{' '}{ui.field(e.ready ? 'Google কোড (সেভ করা আছে)' : '② কোডটা এখানে বসান', ui.input('gmail_app_password', dots(s.gmail_app_password), { type: 'password', autocomplete: 'off', placeholder: 'abcd efgh ijkl mnop' }))}</section><section className="panel"><h2>💬 WhatsApp-এ অর্ডারের খবর{' '}{(w.ready ? ui.pill('✅ চালু', 'pill-delivered') : ui.pill('চালু হয়নি', 'pill-pending'))}</h2>{ui.field('আপনার WhatsApp নম্বর', ui.input('wa_notify_phone', s.wa_notify_phone || s.whatsapp || '', { inputmode: 'tel', maxlength: 20, placeholder: '01XXXXXXXXX' }))}{' '}{(w.ready ? <p className="small good">✅ নতুন অর্ডার এলে এই নম্বরে নিজে থেকে WhatsApp মেসেজ যাবে ({(w.provider === 'greenapi' ? "Green-API" : (w.provider === 'textmebot' ? "TextMeBot" : "CallMeBot"))})।</p> : null)}<p className="small"><b>দুইটা ফ্রি উপায় — যেটা সহজ লাগে:</b></p><label className="check"><input type="radio" name="wa_provider" defaultValue="greenapi" defaultChecked={!!(w.provider === 'greenapi')} />{' '}<b>Green-API</b>{' '}— ফ্রি, কোডের জন্য অপেক্ষা নেই (WhatsApp Web-এর মতো QR স্ক্যান)</label>{' '}<label className="check"><input type="radio" name="wa_provider" defaultValue="callmebot" defaultChecked={!!(w.provider === 'callmebot')} />{' '}<b>CallMeBot</b>{' '}— ফ্রি, কিন্তু অনেক সময় কোড আসে না</label><details className="help" open={!!(!w.ready)}><summary><b>Green-API চালুর ধাপ (ফ্রি)</b></summary><ol className="small"><li><a href="https://console.greenapi.com/" target="_blank" rel="noopener"><b>console.greenapi.com</b>{' '}↗</a>{' '}খুলে Gmail দিয়ে রেজিস্টার/লগইন করুন।</li><li><b>Create an instance</b>{' '}→ ফ্রি{' '}<b>Developer</b>{' '}প্ল্যান বেছে নিন।</li><li>একটা QR কোড আসবে। যে WhatsApp থেকে মেসেজ পাঠাবে সেই ফোনে WhatsApp →{' '}<b>Linked devices</b>{' '}→{' '}<b>Link a device</b>{' '}→ QR স্ক্যান করুন।</li><li>কনসোলে দেখানো{' '}<b>idInstance</b>{' '}আর{' '}<b>apiTokenInstance</b>{' '}কপি করে নিচের দুই ঘরে বসান, সেভ করুন।</li></ol><p className="small muted">টিপ: দোকানের আলাদা WhatsApp নম্বর থাকলে সেটা যুক্ত করুন, আর উপরের ঘরে আপনার ব্যক্তিগত নম্বর দিন — তাহলে মেসেজ এলে ফোন বাজবে। একই নম্বর হলে মেসেজ "নিজের চ্যাটে" আসে, শব্দ নাও হতে পারে।</p></details>{ui.field('Green-API idInstance', ui.input('greenapi_id', s.greenapi_id || '', { inputmode: 'numeric', autocomplete: 'off', placeholder: 'যেমন 7103123456' }))}{' '}{ui.field('Green-API apiTokenInstance', ui.input('greenapi_token', dots(s.greenapi_token), { type: 'password', autocomplete: 'off', placeholder: s.greenapi_token ? 'সেভ করা আছে' : 'লম্বা কোডটা' }))}<details className="help"><summary><b>CallMeBot চালুর ধাপ</b></summary><p><a className="btn btn-sm" style={styleOf("background:#16a34a;border-color:#16a34a")} href={`https://wa.me/34644910779?text=${attrValue(encodeURIComponent('I allow callmebot to send me messages'))}`} target="_blank" rel="noopener">WhatsApp-এ অনুমতি দিন ↗</a></p><p className="small muted">মেসেজ লেখা অবস্থায় খুলবে, Send চাপুন। ২ মিনিটে উত্তর না এলে ২৪ ঘণ্টা পর আবার পাঠাতে হয় (ওদের নিয়ম)।</p></details>{ui.field('CallMeBot কোড', ui.input('callmebot_key', dots(s.callmebot_key), { type: 'password', autocomplete: 'off', placeholder: s.callmebot_key ? 'সেভ করা আছে' : 'যেমন 123456' }))}</section></div><section className="panel"><h2>🛠️ সাইটে কোনো এরর হলে খবর (Sentry){' '}{(s.sentry_dsn || process.env.SENTRY_DSN ? ui.pill('✅ চালু', 'pill-delivered') : ui.pill('চালু হয়নি', 'pill-pending'))}</h2><p className="muted">সাইটের কোনো পেজে সমস্যা (এরর) হলে Sentry আপনাকে ইমেইলে জানাবে — কোন পেজে, কখন। কাস্টমারের ফোন, ঠিকানা বা কুকি সেখানে যায় না। ফ্রি।</p><ol className="small"><li><a href="https://sentry.io/signup/" target="_blank" rel="noopener">sentry.io</a>-তে ফ্রি অ্যাকাউন্ট খুলুন (Google দিয়ে)।</li><li>নতুন প্রজেক্ট: platform{' '}<b>Next.js</b>, নাম{' '}<b>shobmilbe</b>।</li><li>যে{' '}<b>DSN</b>{' '}দেখাবে সেটা কপি করে নিচে বসান (পরে পাবেন Project Settings → Client Keys-এ)।</li></ol>{ui.field('Sentry DSN', ui.input('sentry_dsn', dots(s.sentry_dsn), { type: 'password', autocomplete: 'off', placeholder: 'https://…@….ingest.sentry.io/…' }))}{' '}{(s.sentry_dsn ? ui.check('clear_sentry', false, 'Sentry বন্ধ করুন (DSN মুছে দিন)') : null)}</section><section className="panel">{ui.field('আপনার অ্যাডমিন পাসওয়ার্ড', ui.input('current_password', '', { type: 'password', autocomplete: 'current-password' }), 'শুধু Gmail বা Google কোড বদলালে লাগে (নিরাপত্তার জন্য)।')}{' '}<button className="btn btn-block btn-lg">✅ সেভ করুন</button><p className="small muted">সেভ করলেই একটা পরীক্ষার মেসেজ যাবে। ফোনে/মেইলে পেলেই সব ঠিক, এরপর থেকে সব নিজে থেকে আসবে।</p></section><details className="panel"><summary><b>আরও সেটিংস (ঐচ্ছিক)</b></summary><input type="hidden" name="more" defaultValue="1" />{' '}{ui.switchRow('notify_order_email', s.notify_order_email !== '0', 'নতুন অর্ডার এলে ইমেইল', 'কাস্টমার, পণ্য, মোট টাকা আর অর্ডার খোলার বাটনসহ।')}{' '}{ui.switchRow('notify_order_wa', s.notify_order_wa !== '0', 'নতুন অর্ডার এলে WhatsApp', 'কাস্টমার, পণ্য, টাকা আর অর্ডারের লিংকসহ।')}{' '}{ui.switchRow('notify_low_stock', s.notify_low_stock !== '0', 'স্টক কমে গেলে জানাও', 'একই পণ্যের জন্য দিনে একবার।')}{' '}{ui.switchRow('notify_security', s.notify_security !== '0', 'নিরাপত্তা সতর্কতা', 'পাসওয়ার্ড রিসেট, সন্দেহজনক লগইন, এই পেজের ইমেইল বদল।')}{' '}{ui.switchRow('notify_owner_login', s.notify_owner_login !== '0', 'মালিকের অ্যাকাউন্টে লগইন হলে জানাও', 'আপনি ছাড়া কেউ ঢুকলে সাথে সাথে টের পাবেন।')}{' '}<input type="hidden" name="notify_order_push" defaultValue={s.notify_order_push !== '0' ? '1' : ''} />{' '}{(s.gmail_app_password ? ui.check('clear_gmail', false, 'Google কোড মুছে দিন (ইমেইল বন্ধ)') : null)}{' '}{(s.callmebot_key || s.textmebot_key || s.greenapi_token ? ui.check('clear_wa', false, 'WhatsApp কোড মুছে দিন (WhatsApp বন্ধ)') : null)}</details></form><section className="panel push-box" id="push" data-push="" data-key={attrValue(pubKey)}><h2>📱 ফোনে নোটিফিকেশন{' '}{(devices.length ? ui.pill(`${ui.bn(devices.length)}টি ডিভাইসে চালু`, 'pill-delivered') : ui.pill('এখনো চালু হয়নি', 'pill-pending'))}</h2><p><b>সবচেয়ে সহজ উপায়, কোনো পাসওয়ার্ড বা অ্যাপ লাগে না।</b>{' '}যে ফোনে অর্ডারের খবর পেতে চান, সেই ফোনে এই পেজ খুলে নিচের বোতাম চাপুন, তারপর{' '}<b>"Allow" / "অনুমতি দিন"</b>{' '}চাপুন। এরপর নতুন অর্ডার এলেই ফোনে অন্য অ্যাপের মতো নোটিফিকেশন আসবে, চাপ দিলে সরাসরি অর্ডারটা খুলবে।</p><button type="button" className="btn btn-lg" data-push-on="">🔔 এই ফোনে নোটিফিকেশন চালু করুন</button><p className="small" data-push-note="" hidden></p>{(devices.length ? <><div className="table-wrap"><table className="table"><thead><tr><th>ডিভাইস</th><th>চালু হয়েছে</th><th>শেষ পৌঁছেছে</th><th></th></tr></thead><tbody>{jsxList(devices.map((d) => <tr><td><Val v={d.device || 'ডিভাইস'} />{(d.fails > 2 ? <>{' '}{ui.pill('পৌঁছাচ্ছে না', 'pill-cancelled')}</> : null)}</td><td className="small">{fmtDate(d.created_at)}</td><td className="small">{(d.last_ok ? fmtDate(d.last_ok) : "—")}</td><td><form method="post" action={`/admin/notify/push/${attrValue(d.id)}/delete`} data-confirm="এই ডিভাইসে নোটিফিকেশন বন্ধ করবেন?"><button className="btn btn-sm btn-danger">বন্ধ</button></form></td></tr>))}</tbody></table></div><form method="post" action="/admin/notify/push/test"><button className="btn btn-ghost">🔔 টেস্ট নোটিফিকেশন পাঠান</button></form></> : null)}</section><script type="module" src={`/js/admin/push.js?v=${attrValue($layout.ASSET_V)}`} /><section className="panel"><h2>ইমেইল / WhatsApp টেস্ট করুন</h2><div className="row-actions"><form method="post" action="/admin/notify/test" style={styleOf("display:inline")}><input type="hidden" name="ch" defaultValue="email" /><button className="btn btn-outline" disabled={!(e.ready)}>📧 টেস্ট ইমেইল পাঠান</button></form><form method="post" action="/admin/notify/test" style={styleOf("display:inline")}><input type="hidden" name="ch" defaultValue="wa" /><button className="btn btn-outline" disabled={!(w.ready)}>💬 টেস্ট WhatsApp পাঠান</button></form></div><h3>সাম্প্রতিক নোটিফিকেশন</h3>{(logs.length ? <div className="table-wrap"><table className="table"><thead><tr><th>কোথায়</th><th>কী</th><th>ফল</th></tr></thead><tbody>{jsxList(logs.map((l) => <tr><td>{(l.service === 'notify-email' ? "📧 ইমেইল" : (l.service === 'notify-push' ? "📱 ফোন" : "💬 WhatsApp"))}</td><td><Val v={l.action} /></td><td>{(l.ok ? ui.pill('গেছে', 'pill-delivered') : ui.pill('যায়নি', 'pill-cancelled'))}{' '}<span className="small muted">{(l.ok ? null : <Val v={l.message} />)}</span></td></tr>))}</tbody></table></div> : <p className="muted">এখনো কোনো নোটিফিকেশন পাঠানো হয়নি।</p>)}</section></>;
  return ctx.page('নোটিফিকেশন', body, 'notify');
}

async function pushSubscribe(ctx: AdminCtx) {
  const b = await ctx.body();
  try {
    await push.subscribe(ctx.user.id, b.sub, b.device);
  } catch (e: Loose) { return ctx.json(400, { error: e.message }); }
  await ctx.log('settings', 'settings', null, `ফোনে নোটিফিকেশন চালু: ${str(b.device, 40)}`);
  try {
    await push.sendAll({ title: '✅ নোটিফিকেশন চালু হয়েছে', body: `${ctx.settings.store_name}: নতুন অর্ডার এলে এভাবেই এখানে জানানো হবে।`, url: '/admin/notify', tag: 'test' });
  } catch (e: Loose) { return ctx.json(200, { ok: true, warn: e.message }); }
  return ctx.json(200, { ok: true });
}
async function pushTest(ctx: AdminCtx) {
  try {
    const n = await push.sendAll({ title: '🔔 টেস্ট নোটিফিকেশন', body: `${ctx.settings.store_name}: সব ঠিক আছে। নতুন অর্ডার এলে এভাবেই জানানো হবে।`, url: '/admin/notify', tag: 'test' });
    await db.logIntegration('notify-push', 'test', !!n, n ? 'পাঠানো হয়েছে' : 'কোনো ডিভাইস নেই');
    return n ? ctx.back('/admin/notify', 'sent_push') : ctx.fail('/admin/notify', 'কোনো ডিভাইসে নোটিফিকেশন চালু নেই।');
  } catch (e: Loose) {
    await db.logIntegration('notify-push', 'test', false, e.message);
    return ctx.fail('/admin/notify', 'নোটিফিকেশন যায়নি: ' + e.message);
  }
}
async function pushDelete(ctx: AdminCtx, m: RouteMatch) {
  await db.q('DELETE FROM push_subs WHERE id=$1 AND staff_id=$2', [int(m[1]), ctx.user.id]);
  return ctx.back('/admin/notify', 'saved');
}
ui.MESSAGES.sent_push = 'টেস্ট নোটিফিকেশন পাঠানো হয়েছে, ফোনে দেখুন।';
ui.MESSAGES.notify_live = '✅ সেভ হয়েছে আর পরীক্ষার মেসেজ পাঠানো হয়েছে — Gmail/WhatsApp-এ দেখুন। এখন থেকে নতুন অর্ডারের খবর নিজে থেকে আসবে।';

async function test(ctx: AdminCtx) {
  const b = await ctx.body();
  const s = ctx.settings;
  try {
    if (b.ch === 'wa') await N.sendWhatsApp(s, `✅ ${s.store_name}: WhatsApp নোটিফিকেশন ঠিকমতো কাজ করছে। নতুন অর্ডার এলে এখানে মেসেজ আসবে।`);
    else await N.sendEmail(s, `✅ ${s.store_name}: ইমেইল নোটিফিকেশন কাজ করছে`, `অভিনন্দন! ইমেইল নোটিফিকেশন ঠিকমতো কাজ করছে।\n\nনতুন অর্ডার, নিরাপত্তা সতর্কতা আর পাসওয়ার্ড রিসেট লিংক এই ঠিকানায় আসবে।`);
    await db.logIntegration(b.ch === 'wa' ? 'notify-whatsapp' : 'notify-email', 'test', true, 'পাঠানো হয়েছে');
    return ctx.back('/admin/notify', 'saved');
  } catch (e: Loose) {
    await db.logIntegration(b.ch === 'wa' ? 'notify-whatsapp' : 'notify-email', 'test', false, e.message);
    return ctx.fail('/admin/notify', e.message || 'পাঠানো যায়নি');
  }
}

export const routes = [
  { method: '*', path: '/admin/notify', perm: 'owner', handler: page },
  { method: 'POST', path: '/admin/notify/test', perm: 'owner', handler: test },
  { method: 'POST', path: '/admin/notify/push/subscribe', perm: 'owner', handler: pushSubscribe },
  { method: 'POST', path: '/admin/notify/push/test', perm: 'owner', handler: pushTest },
  { method: 'POST', path: /^\/admin\/notify\/push\/(\d+)\/delete$/, perm: 'owner', handler: pushDelete },
];
