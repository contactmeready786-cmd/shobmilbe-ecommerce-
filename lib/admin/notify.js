'use strict';
// Admin → নোটিফিকেশন (owner only): where new-order and security alerts go (e-mail + WhatsApp).
// The e-mail here also receives the "forgot password" reset link, so changing it needs the owner's password.
const { html, verifyPassword, str } = require('../util');
const db = require('../db');
const ui = require('./ui');
const N = require('../services/notify');
const push = require('../services/push');
const { fmtDate, int } = require('../util');

const dots = (v) => (v ? '••••••••' : '');

async function page(ctx) {
  const s = ctx.settings;
  if (ctx.method === 'POST') {
    const b = await ctx.body();
    const email = str(b.notify_email, 120).toLowerCase();
    const oldEmail = N.emailConfig(s).to;
    if (!N.validEmail(email)) return ctx.fail('/admin/notify', 'ইমেইল ঠিকানা ঠিক নেই।');
    const emailChanged = email !== oldEmail.toLowerCase();
    const passChanged = b.gmail_app_password && !/^•+$/.test(b.gmail_app_password);
    // The reset link goes to this address — so changing where it goes needs the owner's own password.
    if ((emailChanged || passChanged) && !verifyPassword(b.current_password || '', ctx.user.password)) {
      return ctx.fail('/admin/notify', 'ইমেইল বা App Password বদলাতে নিচে আপনার বর্তমান অ্যাডমিন পাসওয়ার্ড দিন।');
    }
    const appPass = String(b.gmail_app_password || '').replace(/\s+/g, '');
    if (passChanged && !/^[a-z]{16}$/i.test(appPass)) return ctx.fail('/admin/notify', 'Gmail App Password ১৬ অক্ষরের হয় (যেমন abcd efgh ijkl mnop)। আবার কপি করে দিন।');
    const key = str(b.callmebot_key, 40);
    if (key && !/^•+$/.test(key) && !/^[A-Za-z0-9-]{4,40}$/.test(key)) return ctx.fail('/admin/notify', 'CallMeBot API key ঠিক নেই (শুধু সংখ্যা/অক্ষর)।');
    const phone = str(b.wa_notify_phone, 20);

    await db.setSetting('notify_email', email);
    if (passChanged) await db.setSetting('gmail_app_password', appPass);
    if (b.clear_gmail) await db.setSetting('gmail_app_password', '');
    await db.setSetting('wa_notify_phone', phone);
    if (key && !/^•+$/.test(key)) await db.setSetting('callmebot_key', key);
    if (b.clear_wa) await db.setSetting('callmebot_key', '');
    if (b.more) for (const k of ['notify_order_email', 'notify_order_wa', 'notify_order_push', 'notify_security', 'notify_owner_login', 'notify_low_stock']) await db.setSetting(k, b[k] ? '1' : '0');
    await ctx.reloadSettings();
    // a channel that was just set up gets a test message at once, so the owner sees it working
    const waKeyChanged = key && !/^•+$/.test(key);
    const tried = [];
    if ((emailChanged || passChanged) && N.emailConfig(ctx.settings).ready) tried.push(['email', () => N.sendEmail(ctx.settings, `✅ ${ctx.settings.store_name}: ইমেইল নোটিফিকেশন চালু হয়েছে`, 'অভিনন্দন! এখন থেকে নতুন অর্ডার এলে এই ইমেইলে জানানো হবে।')]);
    if ((waKeyChanged || phone !== String(s.wa_notify_phone || '')) && N.waConfig(ctx.settings).ready) tried.push(['wa', () => N.sendWhatsApp(ctx.settings, `✅ ${ctx.settings.store_name}: WhatsApp নোটিফিকেশন চালু হয়েছে। নতুন অর্ডার এলে এখানে মেসেজ আসবে।`)]);
    const failedCh = [];
    for (const [ch, fn] of tried) {
      try { await fn(); await db.logIntegration(ch === 'wa' ? 'notify-whatsapp' : 'notify-email', 'test', true, 'পাঠানো হয়েছে'); }
      catch (e) { failedCh.push(ch === 'wa' ? 'WhatsApp: ' + e.message : 'ইমেইল: ' + e.message); await db.logIntegration(ch === 'wa' ? 'notify-whatsapp' : 'notify-email', 'test', false, e.message); }
    }
    await ctx.log('settings', 'settings', null, `নোটিফিকেশন সেটিংস${emailChanged ? ` (ইমেইল বদল: ${N.maskEmail(oldEmail)} → ${N.maskEmail(email)})` : ''}`);
    if (emailChanged) {
      // tell both the old and the new address, so a silent swap can't go unnoticed
      await N.securityAlert(ctx.settings, 'নোটিফিকেশন/রিসেট ইমেইল বদলানো হয়েছে',
        `পুরোনো: ${oldEmail}\nনতুন: ${email}\nযে বদলেছে: ${ctx.user.name} (${ctx.ip})`, { extraEmail: oldEmail });
    }
    if (failedCh.length) return ctx.fail('/admin/notify', 'সেভ হয়েছে, কিন্তু পরীক্ষার মেসেজ যায়নি — ' + failedCh.join(' · '));
    return ctx.back('/admin/notify', tried.length ? 'notify_live' : 'saved');
  }

  const e = N.emailConfig(s);
  const w = N.waConfig(s);
  const [pubKey, devices] = await Promise.all([
    push.publicKey(),
    db.q("SELECT id, device, created_at, last_ok, fails FROM push_subs WHERE staff_id=$1 ORDER BY id", [ctx.user.id]),
  ]);
  const logs = await db.q(`SELECT service, action, ok, message, created_at FROM integration_logs WHERE service LIKE 'notify-%' ORDER BY id DESC LIMIT 12`).catch(() => []);
  const body = html`<h1>🔔 অর্ডারের খবর: ইমেইল ও WhatsApp</h1>${ui.flash(ctx.flash)}
<p class="muted">ওয়েবসাইটে নতুন অর্ডার এলে, আর কেউ পাসওয়ার্ড রিসেট বা সন্দেহজনক কিছু করলে আপনাকে সাথে সাথে জানানো হবে। এই পেজ শুধু মালিক দেখতে পান।</p>

<form method="post" action="/admin/notify" class="form">
<div class="two-col">
  <section class="panel">
    <h2>📧 ইমেইলে অর্ডারের খবর ${e.ready ? ui.pill('✅ চালু', 'pill-delivered') : ui.pill('চালু হয়নি', 'pill-pending')}</h2>
    ${ui.field('আপনার Gmail', ui.input('notify_email', e.to, { type: 'email', required: true, maxlength: 120, autocomplete: 'off' }))}
    ${e.ready ? html`<p class="small good">✅ নতুন অর্ডার এলে এই Gmail-এ নিজে থেকে মেইল যাবে।</p>` : html`
    <p class="small"><b>শুধু প্রথমবার, এক মিনিট:</b> Google নিজের নিয়মে একটা অনুমতির কোড চায় (যাতে অন্য কেউ আপনার নামে মেইল পাঠাতে না পারে)।</p>
    <p><a class="btn" href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener">① Google থেকে কোড নিন ↗</a></p>
    <p class="small muted">খোলা পেজে নাম লিখুন <b>Shobmilbe</b> → <b>Create</b> চাপুন → যে ১৬ অক্ষর আসবে সেটা কপি করে নিচে বসান। (পেজটা না খুললে আগে Gmail-এ 2-Step Verification চালু করুন।)</p>`}
    ${ui.field(e.ready ? 'Google কোড (সেভ করা আছে)' : '② কোডটা এখানে বসান', ui.input('gmail_app_password', dots(s.gmail_app_password), { type: 'password', autocomplete: 'off', placeholder: 'abcd efgh ijkl mnop' }))}
  </section>
  <section class="panel">
    <h2>💬 WhatsApp-এ অর্ডারের খবর ${w.ready ? ui.pill('✅ চালু', 'pill-delivered') : ui.pill('চালু হয়নি', 'pill-pending')}</h2>
    ${ui.field('আপনার WhatsApp নম্বর', ui.input('wa_notify_phone', s.wa_notify_phone || s.whatsapp || '', { inputmode: 'tel', maxlength: 20, placeholder: '01XXXXXXXXX' }))}
    ${w.ready ? html`<p class="small good">✅ নতুন অর্ডার এলে এই নম্বরে নিজে থেকে WhatsApp মেসেজ যাবে।</p>` : html`
    <p class="small"><b>শুধু প্রথমবার, এক মিনিট:</b> WhatsApp-এর নিয়মে আপনার নম্বর থেকে একবার অনুমতি দিতে হয়।</p>
    <p><a class="btn" style="background:#16a34a;border-color:#16a34a" href="https://wa.me/34644910779?text=${encodeURIComponent('I allow callmebot to send me messages')}" target="_blank" rel="noopener">① WhatsApp-এ অনুমতি দিন ↗</a></p>
    <p class="small muted">WhatsApp খুলে মেসেজ লেখা অবস্থায় আসবে, শুধু <b>Send</b> চাপুন। একটু পরে উত্তরে একটা <b>APIKEY</b> নম্বর আসবে, সেটা নিচে বসান। (নম্বরটা কাজ না করলে <a href="https://www.callmebot.com/blog/free-api-whatsapp-messages/" target="_blank" rel="noopener">callmebot.com</a>-এ নতুন নম্বর দেখুন।)</p>`}
    ${ui.field(w.ready ? 'WhatsApp কোড (সেভ করা আছে)' : '② উত্তরে আসা নম্বরটা এখানে বসান', ui.input('callmebot_key', dots(s.callmebot_key), { type: 'password', autocomplete: 'off', placeholder: 'যেমন 123456' }))}
  </section>
</div>
<section class="panel">
  ${ui.field('আপনার অ্যাডমিন পাসওয়ার্ড', ui.input('current_password', '', { type: 'password', autocomplete: 'current-password' }), 'শুধু Gmail বা Google কোড বদলালে লাগে (নিরাপত্তার জন্য)।')}
  <button class="btn btn-block btn-lg">✅ সেভ করুন</button>
  <p class="small muted">সেভ করলেই একটা পরীক্ষার মেসেজ যাবে। ফোনে/মেইলে পেলেই সব ঠিক, এরপর থেকে সব নিজে থেকে আসবে।</p>
</section>
<details class="panel"><summary><b>আরও সেটিংস (ঐচ্ছিক)</b></summary>
  <input type="hidden" name="more" value="1">
  ${ui.switchRow('notify_order_email', s.notify_order_email !== '0', 'নতুন অর্ডার এলে ইমেইল', 'কাস্টমার, পণ্য, মোট টাকা আর অর্ডার খোলার বাটনসহ।')}
  ${ui.switchRow('notify_order_wa', s.notify_order_wa !== '0', 'নতুন অর্ডার এলে WhatsApp', 'কাস্টমার, পণ্য, টাকা আর অর্ডারের লিংকসহ।')}
  ${ui.switchRow('notify_low_stock', s.notify_low_stock !== '0', 'স্টক কমে গেলে জানাও', 'একই পণ্যের জন্য দিনে একবার।')}
  ${ui.switchRow('notify_security', s.notify_security !== '0', 'নিরাপত্তা সতর্কতা', 'পাসওয়ার্ড রিসেট, সন্দেহজনক লগইন, এই পেজের ইমেইল বদল।')}
  ${ui.switchRow('notify_owner_login', s.notify_owner_login !== '0', 'মালিকের অ্যাকাউন্টে লগইন হলে জানাও', 'আপনি ছাড়া কেউ ঢুকলে সাথে সাথে টের পাবেন।')}
  <input type="hidden" name="notify_order_push" value="${s.notify_order_push !== '0' ? '1' : ''}">
  ${s.gmail_app_password ? ui.check('clear_gmail', false, 'Google কোড মুছে দিন (ইমেইল বন্ধ)') : ''}
  ${s.callmebot_key ? ui.check('clear_wa', false, 'WhatsApp কোড মুছে দিন (WhatsApp বন্ধ)') : ''}
</details>
</form>
<section class="panel push-box" id="push" data-push data-key="${pubKey}">
  <h2>📱 ফোনে নোটিফিকেশন ${devices.length ? ui.pill(`${ui.bn(devices.length)}টি ডিভাইসে চালু`, 'pill-delivered') : ui.pill('এখনো চালু হয়নি', 'pill-pending')}</h2>
  <p><b>সবচেয়ে সহজ উপায়, কোনো পাসওয়ার্ড বা অ্যাপ লাগে না।</b> যে ফোনে অর্ডারের খবর পেতে চান, সেই ফোনে এই পেজ খুলে নিচের বোতাম চাপুন, তারপর <b>"Allow" / "অনুমতি দিন"</b> চাপুন। এরপর নতুন অর্ডার এলেই ফোনে অন্য অ্যাপের মতো নোটিফিকেশন আসবে, চাপ দিলে সরাসরি অর্ডারটা খুলবে।</p>
  <button type="button" class="btn btn-lg" data-push-on>🔔 এই ফোনে নোটিফিকেশন চালু করুন</button>
  <p class="small" data-push-note hidden></p>
  ${devices.length ? html`<div class="table-wrap"><table class="table"><thead><tr><th>ডিভাইস</th><th>চালু হয়েছে</th><th>শেষ পৌঁছেছে</th><th></th></tr></thead><tbody>
    ${devices.map((d) => html`<tr><td>${d.device || 'ডিভাইস'}${d.fails > 2 ? html` ${ui.pill('পৌঁছাচ্ছে না', 'pill-cancelled')}` : ''}</td><td class="small">${fmtDate(d.created_at)}</td>
      <td class="small">${d.last_ok ? fmtDate(d.last_ok) : '—'}</td>
      <td><form method="post" action="/admin/notify/push/${d.id}/delete" data-confirm="এই ডিভাইসে নোটিফিকেশন বন্ধ করবেন?"><button class="btn btn-sm btn-danger">বন্ধ</button></form></td></tr>`)}
  </tbody></table></div>
  <form method="post" action="/admin/notify/push/test"><button class="btn btn-ghost">🔔 টেস্ট নোটিফিকেশন পাঠান</button></form>` : ''}
</section>
<script src="/js/push.js?v=${require('./layout').ASSET_V}" defer></script>
<section class="panel">
  <h2>ইমেইল / WhatsApp টেস্ট করুন</h2>
  <div class="row-actions">
    <form method="post" action="/admin/notify/test" style="display:inline"><input type="hidden" name="ch" value="email"><button class="btn btn-outline" ${e.ready ? '' : 'disabled'}>📧 টেস্ট ইমেইল পাঠান</button></form>
    <form method="post" action="/admin/notify/test" style="display:inline"><input type="hidden" name="ch" value="wa"><button class="btn btn-outline" ${w.ready ? '' : 'disabled'}>💬 টেস্ট WhatsApp পাঠান</button></form>
  </div>
  <h3>সাম্প্রতিক নোটিফিকেশন</h3>
  ${logs.length ? html`<div class="table-wrap"><table class="table"><thead><tr><th>কোথায়</th><th>কী</th><th>ফল</th></tr></thead><tbody>
    ${logs.map((l) => html`<tr><td>${l.service === 'notify-email' ? '📧 ইমেইল' : l.service === 'notify-push' ? '📱 ফোন' : '💬 WhatsApp'}</td><td>${l.action}</td>
      <td>${l.ok ? ui.pill('গেছে', 'pill-delivered') : ui.pill('যায়নি', 'pill-cancelled')} <span class="small muted">${l.ok ? '' : l.message}</span></td></tr>`)}</tbody></table></div>`
    : html`<p class="muted">এখনো কোনো নোটিফিকেশন পাঠানো হয়নি।</p>`}
</section>`;
  return ctx.page('নোটিফিকেশন', body, 'notify');
}

async function pushSubscribe(ctx) {
  const b = await ctx.body();
  try {
    await push.subscribe(ctx.user.id, b.sub, b.device);
  } catch (e) { return ctx.json(ctx.res, 400, { error: e.message }); }
  await ctx.log('settings', 'settings', null, `ফোনে নোটিফিকেশন চালু: ${str(b.device, 40)}`);
  try {
    await push.sendAll({ title: '✅ নোটিফিকেশন চালু হয়েছে', body: `${ctx.settings.store_name}: নতুন অর্ডার এলে এভাবেই এখানে জানানো হবে।`, url: '/admin/notify', tag: 'test' });
  } catch (e) { return ctx.json(ctx.res, 200, { ok: true, warn: e.message }); }
  return ctx.json(ctx.res, 200, { ok: true });
}
async function pushTest(ctx) {
  try {
    const n = await push.sendAll({ title: '🔔 টেস্ট নোটিফিকেশন', body: `${ctx.settings.store_name}: সব ঠিক আছে। নতুন অর্ডার এলে এভাবেই জানানো হবে।`, url: '/admin/notify', tag: 'test' });
    await db.logIntegration('notify-push', 'test', !!n, n ? 'পাঠানো হয়েছে' : 'কোনো ডিভাইস নেই');
    return n ? ctx.back('/admin/notify', 'sent_push') : ctx.fail('/admin/notify', 'কোনো ডিভাইসে নোটিফিকেশন চালু নেই।');
  } catch (e) {
    await db.logIntegration('notify-push', 'test', false, e.message);
    return ctx.fail('/admin/notify', 'নোটিফিকেশন যায়নি: ' + e.message);
  }
}
async function pushDelete(ctx, m) {
  await db.q('DELETE FROM push_subs WHERE id=$1 AND staff_id=$2', [int(m[1]), ctx.user.id]);
  return ctx.back('/admin/notify', 'saved');
}
ui.MESSAGES.sent_push = 'টেস্ট নোটিফিকেশন পাঠানো হয়েছে, ফোনে দেখুন।';
ui.MESSAGES.notify_live = '✅ সেভ হয়েছে আর পরীক্ষার মেসেজ পাঠানো হয়েছে — Gmail/WhatsApp-এ দেখুন। এখন থেকে নতুন অর্ডারের খবর নিজে থেকে আসবে।';

async function test(ctx) {
  const b = await ctx.body();
  const s = ctx.settings;
  try {
    if (b.ch === 'wa') await N.sendWhatsApp(s, `✅ ${s.store_name}: WhatsApp নোটিফিকেশন ঠিকমতো কাজ করছে। নতুন অর্ডার এলে এখানে মেসেজ আসবে।`);
    else await N.sendEmail(s, `✅ ${s.store_name}: ইমেইল নোটিফিকেশন কাজ করছে`, `অভিনন্দন! ইমেইল নোটিফিকেশন ঠিকমতো কাজ করছে।\n\nনতুন অর্ডার, নিরাপত্তা সতর্কতা আর পাসওয়ার্ড রিসেট লিংক এই ঠিকানায় আসবে।`);
    await db.logIntegration(b.ch === 'wa' ? 'notify-whatsapp' : 'notify-email', 'test', true, 'পাঠানো হয়েছে');
    return ctx.back('/admin/notify', 'saved');
  } catch (e) {
    await db.logIntegration(b.ch === 'wa' ? 'notify-whatsapp' : 'notify-email', 'test', false, e.message);
    return ctx.fail('/admin/notify', e.message || 'পাঠানো যায়নি');
  }
}

module.exports = { routes: [
  { method: '*', path: '/admin/notify', perm: 'owner', handler: page },
  { method: 'POST', path: '/admin/notify/test', perm: 'owner', handler: test },
  { method: 'POST', path: '/admin/notify/push/subscribe', perm: 'owner', handler: pushSubscribe },
  { method: 'POST', path: '/admin/notify/push/test', perm: 'owner', handler: pushTest },
  { method: 'POST', path: /^\/admin\/notify\/push\/(\d+)\/delete$/, perm: 'owner', handler: pushDelete },
] };
