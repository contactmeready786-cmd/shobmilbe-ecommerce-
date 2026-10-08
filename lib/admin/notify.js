'use strict';
// Admin → নোটিফিকেশন (owner only): where new-order and security alerts go (e-mail + WhatsApp).
// The e-mail here also receives the "forgot password" reset link, so changing it needs the owner's password.
const { html, verifyPassword, str } = require('../util');
const db = require('../db');
const ui = require('./ui');
const N = require('../services/notify');

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
    for (const k of ['notify_order_email', 'notify_order_wa', 'notify_security', 'notify_owner_login']) await db.setSetting(k, b[k] ? '1' : '0');
    await ctx.reloadSettings();
    await ctx.log('settings', 'settings', null, `নোটিফিকেশন সেটিংস${emailChanged ? ` (ইমেইল বদল: ${N.maskEmail(oldEmail)} → ${N.maskEmail(email)})` : ''}`);
    if (emailChanged) {
      // tell both the old and the new address, so a silent swap can't go unnoticed
      await N.securityAlert(ctx.settings, 'নোটিফিকেশন/রিসেট ইমেইল বদলানো হয়েছে',
        `পুরোনো: ${oldEmail}\nনতুন: ${email}\nযে বদলেছে: ${ctx.user.name} (${ctx.ip})`, { extraEmail: oldEmail });
    }
    return ctx.back('/admin/notify', 'saved');
  }

  const e = N.emailConfig(s);
  const w = N.waConfig(s);
  const logs = await db.q(`SELECT service, action, ok, message, created_at FROM integration_logs WHERE service LIKE 'notify-%' ORDER BY id DESC LIMIT 12`).catch(() => []);
  const body = html`<h1>🔔 নোটিফিকেশন (ইমেইল ও WhatsApp)</h1>${ui.flash(ctx.flash)}
<p class="muted">ওয়েবসাইটে নতুন অর্ডার এলে, আর কেউ পাসওয়ার্ড রিসেট বা সন্দেহজনক কিছু করলে আপনাকে সাথে সাথে ইমেইল ও WhatsApp এ জানানো হবে। এই পেজ শুধু মালিক দেখতে পান।</p>
<form method="post" action="/admin/notify" class="form">
<div class="two-col">
  <div>
    <section class="panel">
      <h2>📧 ইমেইল (Gmail) ${e.ready ? ui.pill('চালু', 'pill-delivered') : ui.pill('সেটআপ বাকি', 'pill-pending')}</h2>
      ${ui.field('আপনার Gmail ঠিকানা', ui.input('notify_email', e.to, { type: 'email', required: true, maxlength: 120, autocomplete: 'off' }),
    'নতুন অর্ডার, নিরাপত্তা সতর্কতা আর "পাসওয়ার্ড ভুলে গেছেন" রিসেট লিংক এই ঠিকানায় যাবে। এই Gmail থেকেই মেইল পাঠানো হবে।')}
      ${ui.field('Gmail App Password (১৬ অক্ষর)', ui.input('gmail_app_password', dots(s.gmail_app_password), { type: 'password', autocomplete: 'off', placeholder: s.gmail_app_password ? 'সেভ করা আছে (বদলাতে নতুন দিন)' : 'abcd efgh ijkl mnop' }),
    'সাধারণ Gmail পাসওয়ার্ড না — নিচের ধাপ মেনে বানানো আলাদা ১৬ অক্ষরের পাসওয়ার্ড। এটা এনক্রিপ্ট করে রাখা হয়।')}
      ${s.gmail_app_password ? ui.check('clear_gmail', false, 'App Password মুছে দিন (ইমেইল বন্ধ)') : ''}
      ${ui.switchRow('notify_order_email', s.notify_order_email !== '0', 'নতুন অর্ডার এলে ইমেইল', 'প্রতিটা ওয়েবসাইট অর্ডারে কাস্টমার, পণ্য, মোট টাকা আর অর্ডার খোলার বাটনসহ মেইল।')}
      <details class="help"><summary><b>App Password কীভাবে বানাবেন (৫ মিনিট)</b></summary>
        <ol class="small">
          <li>মোবাইল বা কম্পিউটারে <b>${e.to}</b> দিয়ে Gmail এ লগইন থাকা অবস্থায় <b>myaccount.google.com/security</b> খুলুন।</li>
          <li><b>2-Step Verification</b> চালু না থাকলে আগে চালু করুন (এটা আপনার Gmail কেও হ্যাক থেকে বাঁচাবে)।</li>
          <li>এবার <b>myaccount.google.com/apppasswords</b> খুলুন। নাম দিন <b>Shobmilbe</b> → <b>Create</b>।</li>
          <li>হলুদ বক্সে ১৬ অক্ষরের একটা কোড আসবে (যেমন <code>abcd efgh ijkl mnop</code>)। সেটা কপি করে উপরের ঘরে বসান।</li>
          <li>নিচে বর্তমান অ্যাডমিন পাসওয়ার্ড দিয়ে <b>সেভ করুন</b>, তারপর <b>"টেস্ট ইমেইল পাঠান"</b> চাপুন।</li>
        </ol></details>
    </section>
    <section class="panel">
      <h2>🔐 নিরাপত্তা সতর্কতা</h2>
      ${ui.switchRow('notify_security', s.notify_security !== '0', 'নিরাপত্তা সতর্কতা পাঠাও (ইমেইল + WhatsApp)', 'পাসওয়ার্ড রিসেট হলে, ভুল রিসেট কোড দিলে, অনেকবার ভুল পাসওয়ার্ডে লগইন আটকালে, বা এই পেজের ইমেইল বদলালে।')}
      ${ui.switchRow('notify_owner_login', s.notify_owner_login !== '0', 'মালিকের অ্যাকাউন্টে লগইন হলে জানাও', 'আপনি ছাড়া কেউ ঢুকলে সাথে সাথে টের পাবেন।')}
    </section>
  </div>
  <div>
    <section class="panel">
      <h2>💬 WhatsApp ${w.ready ? ui.pill('চালু', 'pill-delivered') : ui.pill('সেটআপ বাকি', 'pill-pending')}</h2>
      ${ui.field('যে WhatsApp নম্বরে মেসেজ যাবে', ui.input('wa_notify_phone', s.wa_notify_phone || s.whatsapp || '', { inputmode: 'tel', maxlength: 20, placeholder: '01XXXXXXXXX' }), 'আপনার নিজের WhatsApp নম্বর।')}
      ${ui.field('CallMeBot API key', ui.input('callmebot_key', dots(s.callmebot_key), { type: 'password', autocomplete: 'off', placeholder: s.callmebot_key ? 'সেভ করা আছে (বদলাতে নতুন দিন)' : 'যেমন 123456' }), 'এনক্রিপ্ট করে রাখা হয়।')}
      ${s.callmebot_key ? ui.check('clear_wa', false, 'API key মুছে দিন (WhatsApp বন্ধ)') : ''}
      ${ui.switchRow('notify_order_wa', s.notify_order_wa !== '0', 'নতুন অর্ডার এলে WhatsApp মেসেজ', '"আপনার একটা নতুন অর্ডার এসেছে" — সাথে কাস্টমার, পণ্য, টাকা আর অর্ডারের লিংক।')}
      <details class="help"><summary><b>WhatsApp চালুর ধাপ (২ মিনিট, ফ্রি)</b></summary>
        <ol class="small">
          <li>ফোনে <b>callmebot.com</b> এর WhatsApp পেজে যে নম্বরটা দেওয়া আছে (এখন <b>+34 623 91 22 04</b>) সেটা যেকোনো নামে কন্টাক্টে সেভ করুন।</li>
          <li>আপনার WhatsApp থেকে ওই নম্বরে ঠিক এই লেখাটা পাঠান: <code>I allow callmebot to send me messages</code></li>
          <li>কিছুক্ষণের মধ্যে উত্তরে <b>APIKEY</b> নামে একটা সংখ্যা আসবে। সেটা উপরের ঘরে বসিয়ে সেভ করুন।</li>
          <li><b>"টেস্ট WhatsApp পাঠান"</b> চাপুন — আপনার ফোনে মেসেজ আসলেই কাজ শেষ।</li>
        </ol>
        <p class="small muted">২ মিনিটে উত্তর না এলে ২৪ ঘণ্টা পর আবার পাঠান। এটা ব্যক্তিগত নোটিফিকেশনের জন্য ফ্রি সার্ভিস — শুধু আপনার নিজের নম্বরে যায়, কাস্টমারকে না।</p></details>
    </section>
    <section class="panel">
      <h2>সেভ করুন</h2>
      ${ui.field('বর্তমান অ্যাডমিন পাসওয়ার্ড', ui.input('current_password', '', { type: 'password', autocomplete: 'current-password' }), 'শুধু ইমেইল ঠিকানা বা App Password বদলালে লাগবে।')}
      <button class="btn btn-block btn-lg">সেভ করুন</button>
    </section>
  </div>
</div>
</form>
<section class="panel">
  <h2>টেস্ট করুন</h2>
  <div class="row-actions">
    <form method="post" action="/admin/notify/test" style="display:inline"><input type="hidden" name="ch" value="email"><button class="btn btn-outline" ${e.ready ? '' : 'disabled'}>📧 টেস্ট ইমেইল পাঠান</button></form>
    <form method="post" action="/admin/notify/test" style="display:inline"><input type="hidden" name="ch" value="wa"><button class="btn btn-outline" ${w.ready ? '' : 'disabled'}>💬 টেস্ট WhatsApp পাঠান</button></form>
  </div>
  <h3>সাম্প্রতিক নোটিফিকেশন</h3>
  ${logs.length ? html`<div class="table-wrap"><table class="table"><thead><tr><th>কোথায়</th><th>কী</th><th>ফল</th></tr></thead><tbody>
    ${logs.map((l) => html`<tr><td>${l.service === 'notify-email' ? '📧 ইমেইল' : '💬 WhatsApp'}</td><td>${l.action}</td>
      <td>${l.ok ? ui.pill('গেছে', 'pill-delivered') : ui.pill('যায়নি', 'pill-cancelled')} <span class="small muted">${l.ok ? '' : l.message}</span></td></tr>`)}</tbody></table></div>`
    : html`<p class="muted">এখনো কোনো নোটিফিকেশন পাঠানো হয়নি।</p>`}
</section>`;
  return ctx.page('নোটিফিকেশন', body, 'notify');
}

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
] };
