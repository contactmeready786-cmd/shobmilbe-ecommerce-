'use strict';
// Admin → মার্কেটিং → কাস্টমারকে SMS: the SMS company and key, automatic order messages (each with a switch
// and its own text), a test message, a message to many customers at once, and the list of everything sent.
const { html, bn, int, str, fmtDate, normalizePhone, validPhone } = require('../util');
const db = require('../db');
const ui = require('./ui');
const SMS = require('../services/sms');

const BASE = '/admin/marketing/sms';
const BATCH = 200; // customers per click (a click takes well under a minute)

async function audience(b) {
  const w = ["c.phone ~ '^01[3-9][0-9]{8}$'", "NOT EXISTS (SELECT 1 FROM blocklist bl WHERE bl.value=c.phone)"];
  const params = [];
  if (b.aud === 'group' && str(b.grp, 60)) { params.push(str(b.grp, 60)); w.push(`c.grp=$${params.length}`); }
  if (b.aud === 'tag' && str(b.tag, 40)) { params.push(`%${str(b.tag, 40)}%`); w.push(`c.tags ILIKE $${params.length}`); }
  if (b.aud === 'recent') { params.push(Math.max(1, Math.min(3650, int(b.days, 90)))); w.push(`EXISTS (SELECT 1 FROM orders o WHERE o.phone=c.phone AND o.status='delivered' AND o.created_at > now() - make_interval(days => $${params.length}))`); }
  if (b.aud === 'buyers') w.push(`EXISTS (SELECT 1 FROM orders o WHERE o.phone=c.phone AND o.status='delivered')`);
  return { where: w.join(' AND '), params };
}

async function page(ctx, note = null) {
  const s = ctx.settings;
  const canSetup = ctx.can('settings');
  const r = SMS.ready(s);
  const [log, groups, stats] = await Promise.all([
    db.q('SELECT l.*, o.code FROM sms_log l LEFT JOIN orders o ON o.id=l.order_id ORDER BY l.created_at DESC LIMIT 40'),
    db.q("SELECT grp, count(*)::int AS n FROM customers WHERE grp<>'' GROUP BY grp ORDER BY grp"),
    db.one(`SELECT count(*) FILTER (WHERE ok AND created_at > now() - interval '30 days')::int AS ok30,
      count(*) FILTER (WHERE NOT ok AND created_at > now() - interval '30 days')::int AS bad30 FROM sms_log`),
  ]);
  const prov = SMS.PROVIDERS[s.sms_provider] ? s.sms_provider : 'bulksmsbd';
  const tplBox = (ev, label) => html`<div class="sms-row">
    ${ui.check(`sms_on_${ev}`, s[`sms_on_${ev}`] === '1', `${label} SMS পাঠাও`)}
    <textarea name="sms_tpl_${ev}" rows="2" maxlength="480" aria-label="${label} SMS এর লেখা">${s[`sms_tpl_${ev}`] || ''}</textarea>
    <p class="small muted">${bn(String(s[`sms_tpl_${ev}`] || '').length)} অক্ষর ≈ ${bn(SMS.parts(SMS.fill(s[`sms_tpl_${ev}`], { code: 'SM123456', total: 1250, customer_name: 'রহিম', points_earned: 0 }, s, s.site_url || '')))}টি SMS</p>
  </div>`;
  const body = html`<h1>📱 কাস্টমারকে SMS</h1>${ui.flash(ctx.flash)}${note ? ui.flash(note) : ''}
<div class="kpis">
  ${ui.kpi('অবস্থা', r.ok ? '✅ চালু' : '⚪ বন্ধ', r.ok ? SMS.PROVIDERS[prov].label : r.why)}
  ${ui.kpi('গত ৩০ দিনে পাঠানো', bn(stats.ok30), stats.bad30 ? `${bn(stats.bad30)}টি যায়নি` : '', stats.bad30 ? 'kpi-alert' : '')}
</div>
${ui.helpBox('SMS কীভাবে চালু করবেন', html`<ol class="steps">
  <li>যেকোনো একটা SMS কোম্পানিতে অ্যাকাউন্ট খুলুন (যেমন BulkSMSBD, Alpha SMS বা Greenweb) আর কিছু টাকার SMS কিনুন — সাধারণত প্রতি SMS ২৫-৪০ পয়সা।</li>
  <li>তাদের প্যানেল থেকে <b>API Key</b> কপি করুন। BulkSMSBD-তে একটা <b>Sender ID</b>-ও লাগে (তারা অনুমোদন দেয়)।</li>
  <li>নিচে কোম্পানি বাছুন, Key দিন, "SMS চালু" করে সেভ দিন। তারপর "পরীক্ষা" অংশ থেকে নিজের নম্বরে একটা SMS পাঠিয়ে দেখুন।</li>
  <li>বাংলায় এক SMS-এ ৭০ অক্ষর, ইংরেজিতে ১৬০ — লেখা ছোট রাখলে খরচ কম।</li>
</ol>`)}
<div class="two-col">
  <section class="panel">
    <h2>⚙️ SMS কোম্পানি</h2>
    ${canSetup ? html`<form method="post" action="${BASE}" class="form">
      <input type="hidden" name="action" value="setup">
      ${ui.switchRow('sms_on', s.sms_on === '1', 'SMS চালু', 'বন্ধ থাকলে কোনো SMS যাবে না।')}
      ${ui.field('কোম্পানি', ui.select('sms_provider', Object.entries(SMS.PROVIDERS).map(([k, v]) => [k, v.label]), prov))}
      ${ui.field('API Key', ui.input('sms_api_key', '', { type: 'password', maxlength: 200, autocomplete: 'off', placeholder: s.sms_api_key ? '•••••••• (সেভ করা আছে — বদলাতে নতুনটা দিন)' : 'কোম্পানির প্যানেল থেকে কপি করুন' }))}
      ${ui.field('Sender ID (ঐচ্ছিক)', ui.input('sms_sender_id', s.sms_sender_id || '', { maxlength: 20 }), 'BulkSMSBD-তে লাগে; অন্যগুলোতে খালি রাখতে পারেন')}
      ${ui.field('নিজের লিংক (শুধু "অন্য কোম্পানি" বাছলে)', ui.input('sms_custom_url', s.sms_custom_url || '', { maxlength: 400, placeholder: 'https://api.example.com/send?key={key}&to={to}&text={message}' }), '{to} = নম্বর (8801…), {message} = লেখা, {key} = API Key, {sender} = Sender ID')}
      <button class="btn">সেভ করুন</button>
    </form>` : html`<p class="muted">SMS কোম্পানি সেটআপ করার অনুমতি শুধু সেটিংসের অনুমতি থাকলে। মালিককে বলুন।</p>`}
    <h2>🧪 পরীক্ষা</h2>
    <form method="post" action="${BASE}" class="form">
      <input type="hidden" name="action" value="test">
      <div class="field-row">${ui.field('মোবাইল নম্বর', ui.input('phone', '', { required: true, inputmode: 'tel', maxlength: 20, placeholder: '01XXXXXXXXX' }))}
      ${ui.field('লেখা', ui.input('text', `${s.store_name}: পরীক্ষামূলক SMS`, { required: true, maxlength: 160 }))}</div>
      <button class="btn btn-ghost">পাঠিয়ে দেখুন</button>
    </form>
  </section>
  <section class="panel">
    <h2>🧾 অর্ডারের SMS (নিজে থেকে যায়)</h2>
    <form method="post" action="${BASE}" class="form">
      <input type="hidden" name="action" value="templates">
      ${Object.entries(SMS.ORDER_EVENTS).map(([ev, label]) => tplBox(ev, label))}
      <p class="small muted">লেখার ভেতরে বসানো যায়: <code>{shop}</code> দোকানের নাম, <code>{code}</code> অর্ডার নম্বর, <code>{total}</code> মোট টাকা, <code>{name}</code> কাস্টমারের নাম, <code>{tracking}</code> ট্র্যাকিং, <code>{points}</code> পাওয়া পয়েন্ট। একই অর্ডারে একই SMS দুইবার যায় না।</p>
      <button class="btn">সেভ করুন</button>
    </form>
  </section>
</div>
<section class="panel">
  <h2>📣 অনেক কাস্টমারকে একসাথে (অফার/নোটিশ)</h2>
  <form method="post" action="${BASE}" class="form" data-confirm="বাছাই করা কাস্টমারদের SMS পাঠাবেন? এতে SMS-এর খরচ হবে।">
    <input type="hidden" name="action" value="bulk">
    <div class="field-row">
      ${ui.field('কাদের', ui.select('aud', [['buyers', 'যারা অন্তত একবার পণ্য পেয়েছেন'], ['recent', 'গত কিছু দিনে যারা কিনেছেন'], ['group', 'একটা গ্রুপ'], ['tag', 'একটা ট্যাগ'], ['all', 'সব কাস্টমার']], 'buyers'))}
      ${ui.field('দিন (গত কিছু দিন বাছলে)', ui.input('days', '90', { type: 'number', min: 1, max: 3650, class: 'w-num' }))}
      ${ui.field('গ্রুপ', ui.select('grp', [['', '—'], ...groups.map((g) => [g.grp, `${g.grp} (${bn(g.n)})`])], ''))}
      ${ui.field('ট্যাগ', ui.input('tag', '', { maxlength: 40 }))}
    </div>
    ${ui.field('লেখা', ui.textarea('text', '', { rows: 2, required: true, maxlength: 320, placeholder: `${s.store_name}: শুক্রবার সব পণ্যে ১০% ছাড়! কোড FRI10` }), 'ব্লক লিস্টের নম্বরে যাবে না। একবারে সর্বোচ্চ ২০০ জনকে যায় — বাকিদের পাঠাতে আবার একই লেখা দিয়ে পাঠান, যারা আগে পেয়েছেন তারা আর পাবেন না।')}
    <div class="row-actions"><button class="btn" name="go" value="1">পাঠান</button><button class="btn btn-ghost" name="go" value="0">আগে কতজন দেখি</button></div>
  </form>
</section>
<section class="panel">
  <h2>🗒️ শেষ ৪০টি SMS</h2>
  ${log.length ? html`<div class="table-wrap"><table class="table compact"><thead><tr><th>সময়</th><th>নম্বর</th><th>কী</th><th>লেখা</th><th>ফল</th></tr></thead>
  <tbody>${log.map((l) => html`<tr class="${l.ok ? '' : 'row-warn'}"><td class="small nowrap">${fmtDate(l.created_at)}</td><td class="small mono">${l.phone}</td>
    <td class="small">${l.kind.startsWith('order_') ? (SMS.ORDER_EVENTS[l.kind.slice(6)] || l.kind) : l.kind === 'bulk' ? 'একসাথে অনেককে' : l.kind === 'test' ? 'পরীক্ষা' : l.kind}${l.code ? html` · <a href="/admin/orders/${l.order_id}">${l.code}</a>` : ''}</td>
    <td class="small">${l.body}</td><td class="small">${l.ok ? '✅' : '❌'} ${l.detail}</td></tr>`)}</tbody></table></div>`
    : html`<p class="muted">এখনো কোনো SMS পাঠানো হয়নি।</p>`}
</section>`;
  return ctx.page('কাস্টমারকে SMS', body, 'sms');
}

async function post(ctx) {
  const b = await ctx.body();
  if (b.action === 'setup') {
    if (!ctx.can('settings')) return ctx.back(BASE, 'noperm');
    const v = { sms_on: b.sms_on ? '1' : '0', sms_provider: SMS.PROVIDERS[b.sms_provider] ? b.sms_provider : 'bulksmsbd',
      sms_sender_id: str(b.sms_sender_id, 20), sms_custom_url: /^https:\/\/[^\s]+$/i.test(str(b.sms_custom_url, 400)) ? str(b.sms_custom_url, 400) : '' };
    if (str(b.sms_api_key, 200)) v.sms_api_key = str(b.sms_api_key, 200);
    await db.setMany(v);
    await ctx.log('settings', 'settings', null, `SMS: ${v.sms_on === '1' ? 'চালু' : 'বন্ধ'}, ${SMS.PROVIDERS[v.sms_provider].label}${v.sms_api_key ? ', নতুন API key' : ''}`);
    return ctx.back(BASE, 'saved');
  }
  if (b.action === 'templates') {
    const v = {};
    for (const ev of Object.keys(SMS.ORDER_EVENTS)) { v[`sms_on_${ev}`] = b[`sms_on_${ev}`] ? '1' : '0'; v[`sms_tpl_${ev}`] = str(b[`sms_tpl_${ev}`], 480); }
    await db.setMany(v);
    await ctx.log('settings', 'marketing', null, 'অর্ডারের SMS এর লেখা/সুইচ বদল');
    return ctx.back(BASE, 'saved');
  }
  if (b.action === 'test') {
    const r = await SMS.send(ctx.settings, b.phone, str(b.text, 160), { kind: 'test', staffId: ctx.user.id });
    return page({ ...ctx, method: 'GET' }, r.ok ? { text: `✅ পাঠানো হয়েছে: ${r.msg}` } : { type: 'error', text: `❌ যায়নি: ${r.msg}` });
  }
  if (b.action === 'bulk') {
    const text = str(b.text, 320);
    if (!text) return ctx.fail(BASE, 'লেখা দিন।');
    if (!SMS.ready(ctx.settings).ok) return ctx.fail(BASE, `SMS চালু নেই: ${SMS.ready(ctx.settings).why}`);
    const a = await audience(b);
    const total = (await db.one(`SELECT count(*)::int AS n FROM customers c WHERE ${a.where}`, a.params)).n;
    // people who already got this exact text are skipped, so pressing again continues with the rest
    a.params.push(text);
    const rows = await db.q(`SELECT c.phone FROM customers c WHERE ${a.where}
      AND NOT EXISTS (SELECT 1 FROM sms_log l WHERE l.phone=c.phone AND l.body=$${a.params.length} AND l.ok) ORDER BY c.id LIMIT ${BATCH}`, a.params);
    if (b.go !== '1') return page({ ...ctx, method: 'GET' }, { text: `এই বাছাইয়ে মোট ${bn(total)} জন — এখনো পায়নি ${bn(rows.length >= BATCH ? `${BATCH}+` : rows.length)} জন। লেখাটা ≈ ${bn(SMS.parts(text))}টি SMS করে।` });
    let ok = 0; let bad = 0;
    const phones = rows.map((r) => r.phone).filter((p) => validPhone(normalizePhone(p)));
    for (let i = 0; i < phones.length; i += 6) {
      const res = await Promise.all(phones.slice(i, i + 6).map((p) => SMS.send(ctx.settings, p, text, { kind: 'bulk', staffId: ctx.user.id })));
      res.forEach((r) => { if (r.ok) ok++; else bad++; });
      if (bad >= 10 && ok === 0) break; // the company is refusing everything (no credit / wrong key) — stop
    }
    await ctx.log('settings', 'marketing', null, `একসাথে SMS: ${ok}টি গেছে, ${bad}টি যায়নি — "${text.slice(0, 60)}"`);
    const more = rows.length >= BATCH ? ' আরও কাস্টমার বাকি আছে — একই লেখা দিয়ে আবার "পাঠান" চাপুন।' : '';
    return page({ ...ctx, method: 'GET' }, bad && !ok ? { type: 'error', text: `❌ একটাও যায়নি (${bad}টি চেষ্টা)। নিচের তালিকায় কোম্পানির উত্তর দেখুন — সাধারণত ব্যালেন্স শেষ বা Key ভুল।` }
      : { text: `✅ ${bn(ok)} জনকে পাঠানো হয়েছে${bad ? `, ${bn(bad)}টি যায়নি` : ''}।${more}` });
  }
  return ctx.redirect(ctx.res, BASE);
}

module.exports = {
  routes: [
    { method: 'GET', path: BASE, perm: 'marketing', handler: (ctx) => page(ctx) },
    { method: 'POST', path: BASE, perm: 'marketing', handler: post },
  ],
};
