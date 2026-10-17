// Admin → অর্ডার ও কাস্টমার → 📞 অটো কল (অর্ডার কনফার্ম). Settings, a test call, and the call history.
import { Val, attrValue, jsxList } from '../react/html';
import { raw, bn, fmtDate, int, str } from '../util';
import * as db from '../db';
import * as ui from './ui';
import * as AC from '../services/autocall';
import { saveKeys, secretInput } from './marketing';
import type { AdminCtx, Loose } from '../types';

const BASE = '/admin/autocall';
function site(ctx: AdminCtx) {
  if (ctx.settings.site_url) return ctx.settings.site_url.replace(/\/+$/, '');
  return `${String(ctx.req.headers['x-forwarded-proto'] || 'https').split(',')[0]}://${ctx.req.headers['x-forwarded-host'] || ctx.req.headers.host}`;
}

async function page(ctx: AdminCtx) {
  const s = ctx.settings;
  if (ctx.method === 'POST') {
    const b = await ctx.body();
    if (b.form === 'preset') {
      const p = AC.PRESETS[b.preset];
      if (p) await db.setMany({ autocall_provider: b.preset, autocall_url: p.url, autocall_header: p.header, autocall_body: p.body });
      await ctx.reloadSettings();
      return ctx.back(BASE, 'saved');
    }
    if (b.form === 'test') {
      const phone = AC.localPhone(b.test_phone);
      if (!/^01[3-9]\d{8}$/.test(phone)) return ctx.fail(BASE, 'পরীক্ষার জন্য ঠিক মোবাইল নম্বর দিন (01XXXXXXXXX)।');
      const r = await AC.call(ctx.settings, { id: 0, code: 'TEST', phone, customer_name: ctx.user.name, total: 250, items: [{ name: 'পরীক্ষার পণ্য' }] }, site(ctx), { test: true });
      await ctx.log('settings', 'autocall', null, `পরীক্ষার কল ${phone}: ${r.ok ? 'গেছে' : r.error}`);
      return r.ok ? ctx.redirect(BASE + '?info=' + encodeURIComponent(`✅ কল কোম্পানি কলটা নিয়েছে${r.ref ? ` (Call ID ${r.ref})` : ''} — ${phone} নম্বরে ফোন আসার কথা।`)) : ctx.fail(BASE, 'কল যায়নি: ' + r.error);
    }
    if (b.form === 'token') {
      await db.setSetting('autocall_token', '');
      await ctx.reloadSettings();
      await AC.ensureSecret(ctx.settings);
      await ctx.reloadSettings();
      await ctx.log('settings', 'autocall', null, 'ফিরতি লিংক বদলানো হলো');
      return ctx.back(BASE, 'saved');
    }
    const body = b.autocall_body ? String(b.autocall_body).trim() : '';
    if (body && /^[{[]/.test(body)) { try { JSON.parse(body.replace(/\{\{\s*\w+\s*\}\}/g, 'x')); } catch (_) { return ctx.fail(BASE, 'Request body-র JSON ঠিক নেই — কমা, "উদ্ধৃতি" আর { } মিলিয়ে দেখুন।'); } }
    if (b.autocall_url && !/^https:\/\//i.test(String(b.autocall_url).trim())) return ctx.fail(BASE, 'API ঠিকানা https:// দিয়ে শুরু হতে হবে।');
    await saveKeys(ctx, ['autocall_on', 'autocall_only_cod', 'autocall_notify_wa', 'autocall_notify_email', 'autocall_on_confirm', 'autocall_on_cancel', 'autocall_message',
      'autocall_caller', 'autocall_url', 'autocall_method', 'autocall_header', 'autocall_api_key', 'autocall_body'], b,
    { secrets: ['autocall_api_key'], checkboxes: ['autocall_on', 'autocall_only_cod', 'autocall_notify_wa', 'autocall_notify_email'] });
    await AC.ensureSecret(ctx.settings);
    await ctx.reloadSettings();
    await ctx.log('settings', 'autocall', null, `অটো কল ${b.autocall_on ? 'চালু' : 'বন্ধ'}`);
    return ctx.back(BASE, 'saved');
  }

  const token = await AC.ensureSecret(s);
  const hookUrl = AC.callbackUrl(site(ctx), token);
  const [stats, calls] = await Promise.all([
    db.one(`SELECT count(*)::int AS n, count(*) FILTER (WHERE state='confirmed')::int AS ok, count(*) FILTER (WHERE state='cancelled')::int AS cancel,
      count(*) FILTER (WHERE state IN ('no_answer','no_input'))::int AS miss, count(*) FILTER (WHERE state='failed')::int AS failed
      FROM autocalls WHERE created_at > now() - interval '30 days'`).catch(() => ({ n: 0, ok: 0, cancel: 0, miss: 0, failed: 0 })),
    db.q(`SELECT a.*, o.code, o.customer_name, o.total FROM autocalls a JOIN orders o ON o.id=a.order_id ORDER BY a.id DESC LIMIT 30`).catch(() => []),
  ]);
  const sample = AC.varsFor(s, { code: 'SM1234', phone: '01712345678', customer_name: 'রহিম', total: 450, items: [{ name: 'Arduino Uno' }] }, site(ctx), token);
  const ready = AC.on(s);
  const body = <><div className="title-row"><h1>📞 অটো কল{' '}<small>অর্ডার কনফার্মের স্বয়ংক্রিয় কল</small></h1></div><Val v={ui.flash(ctx.flash)} /><div className="kpis kpis-tight"><Val v={ui.kpi('অবস্থা', ready ? '✅ চালু' : s.autocall_on === '1' ? '⚠️ API বাকি' : '⏸ বন্ধ', ready ? 'নতুন অর্ডারে কল যাচ্ছে' : 'নিচে সেটআপ করুন', ready ? 'kpi-green' : 'kpi-alert')} />{' '}<Val v={ui.kpi('৩০ দিনে কল', bn(stats!.n), `${bn(stats!.failed)}টি যায়নি`)} />{' '}<Val v={ui.kpi('কনফার্ম করেছে', bn(stats!.ok), stats!.n ? `${bn(Math.round((stats!.ok * 100) / stats!.n))}%` : '', 'kpi-green')} />{' '}<Val v={ui.kpi('বাতিল / ধরেনি', `${bn(stats!.cancel)} / ${bn(stats!.miss)}`, 'এদের নিজে একবার ফোন করুন', stats!.cancel + stats!.miss ? 'kpi-alert' : '')} /></div><Val v={ui.helpBox('অটো কল কীভাবে কাজ করে? (সহজ কথায়)', <ol><li>কাস্টমার অর্ডার করলেই একটা কল কোম্পানি নিজে থেকে তাকে ফোন করে আর আপনার লেখা কথা বাংলায় শোনায়: "কনফার্ম করতে ১, বাতিল করতে ২ চাপুন"।</li><li>কাস্টমার যা চাপে, কোম্পানি সেটা সাথে সাথে আপনার সাইটকে জানায়। তখন অর্ডার নিজে থেকে{' '}<b>"কনফার্ম"</b>{' '}হয়, বাতিল চাপলে{' '}<b>"হোল্ড"</b>-এ যায় (বা আপনি চাইলে বাতিল), আর আপনার ফোন/WhatsApp-এ নোটিফিকেশন আসে।</li><li>ফোন না ধরলে অর্ডারের পাতায় লেখা থাকে "ফোন ধরেনি" — সেখান থেকে এক চাপে আবার কল করা যায়।</li><li><b>নিজের সিম থেকে কি কল যাবে?</b>{' '}একটা ওয়েবসাইট সরাসরি মোবাইলের সিম দিয়ে কল করতে পারে না। কলটা যায় কল কোম্পানির নম্বর থেকে (সাধারণত 09xxx বা কোম্পানির দেওয়া নম্বর)। কিছু কোম্পানি আপনার নিজের নম্বর তাদের সিস্টেমে যুক্ত করে দেয় ("Bring your own number") — তখন কাস্টমার আপনার নম্বরই দেখবে। কোম্পানির সাথে কথা বলে নিশ্চিত হয়ে নিচে নম্বরটা দিন।</li><li><b>খরচ:</b>{' '}প্রতি কলে কোম্পানি টাকা কাটে (সাধারণত প্রতি মিনিট/কল হিসেবে, প্যাকেজ অনুযায়ী)। আগে তাদের ফ্রি ট্রায়াল নিয়ে দেখে নিন।</li></ol>)} /><form method="post" action={attrValue(BASE)} className="form"><div className="two-col"><section className="panel"><h2>১ · কখন, কী হবে</h2><div className="switch-list"><Val v={ui.switchRow('autocall_on', s.autocall_on === '1', 'অটো কল চালু', 'নতুন অর্ডার আসলেই কাস্টমারকে কল যাবে')} />{' '}<Val v={ui.switchRow('autocall_only_cod', s.autocall_only_cod !== '0', 'শুধু ক্যাশ অন ডেলিভারি অর্ডারে', 'বিকাশ/কার্ডে আগে টাকা দিলে কল লাগে না')} />{' '}<Val v={ui.switchRow('autocall_notify_wa', s.autocall_notify_wa !== '0', 'ফলাফল WhatsApp-এ জানাবে', 'ফোনের নোটিফিকেশন (অ্যাপ) সবসময় আসে')} />{' '}<Val v={ui.switchRow('autocall_notify_email', s.autocall_notify_email === '1', 'ফলাফল ইমেইলেও জানাবে', '')} /></div><div className="field-row"><Val v={ui.field('কাস্টমার ১ চাপলে', ui.select('autocall_on_confirm', [['confirm', 'অর্ডার নিজে থেকে "কনফার্ম" হবে'], ['note', 'শুধু নোট রাখবে, আমি কনফার্ম করব']], s.autocall_on_confirm || 'confirm'))} />{' '}<Val v={ui.field('কাস্টমার ২ চাপলে', ui.select('autocall_on_cancel', [['hold', '"হোল্ডে" রাখবে — আমি ফোন করে দেখব (প্রস্তাবিত)'], ['cancel', 'অর্ডার নিজে থেকে বাতিল'], ['note', 'শুধু নোট রাখবে']], s.autocall_on_cancel || 'hold'))} /></div><h2 className="mt">২ · কাস্টমার কী শুনবে</h2><Val v={ui.field('কলের কথা (বাংলায়)', ui.textarea('autocall_message', s.autocall_message || AC.MESSAGES[0], { rows: 4, maxlength: 600, 'data-ac-msg': true }),
    raw('<code>{{name}}</code> = কাস্টমারের নাম · <code>{{amount}}</code> = টাকা · <code>{{shop}}</code> = দোকানের নাম · <code>{{order_code}}</code> = অর্ডার নম্বর · <code>{{items}}</code> = পণ্যের নাম'))} /><div className="chips ac-presets">{jsxList(AC.MESSAGES.map((m, i) => <button type="button" className="chip" data-ac-preset={attrValue(m)}>✨ নমুনা{' '}{bn(i + 1)}</button>))}</div><p className="small muted">শুনতে কেমন হবে:{' '}<i>"<Val v={sample.message} />"</i></p><p className="small muted">ছোট আর পরিষ্কার রাখুন (২০-২৫ সেকেন্ড)। কোম্পানি এই লেখা বাংলা কণ্ঠে পড়ে শোনায়; কেউ কেউ রেকর্ড করা অডিওও নেয় — তখন সেটা কোম্পানির প্যানেলে আপলোড করুন।</p></section><section className="panel" id="api"><h2>৩ · কল কোম্পানির সংযোগ</h2><p className="small muted">বাংলাদেশে কয়েকটা কোম্পানি "প্রেস ১ কনফার্ম" অটো কল দেয় (যেমন ePBX, ManyDial, Infosoft)। তাদের সাথে অ্যাকাউন্ট খুলে API Key নিন। নিচে একটা বেছে নিলে ঘরগুলো ভরে যাবে — তারপর কোম্পানির API কাগজের (documentation) সাথে মিলিয়ে ঠিক করুন।</p><div className="chips">{jsxList(Object.entries(AC.PRESETS).map(([k, p]) => <button className={`chip ${s.autocall_provider === k ? 'on' : ''}`} form={`ac-preset-${attrValue(k)}`}><Val v={p.label} /></button>))}</div><Val v={ui.field('API ঠিকানা (URL)', ui.input('autocall_url', s.autocall_url, { placeholder: 'https://…', maxlength: 400 }))} /><div className="field-row"><Val v={ui.field('পদ্ধতি', ui.select('autocall_method', [['POST', 'POST'], ['GET', 'GET']], s.autocall_method || 'POST'))} />{' '}<Val v={ui.field('Key কোন হেডারে যাবে', ui.input('autocall_header', s.autocall_header || 'Authorization', { maxlength: 60 }), 'সাধারণত Authorization বা X-API-Key')} /></div><Val v={ui.field('API Key / Token', secretInput('autocall_api_key', s.autocall_api_key), 'Authorization হলে সামনে "Bearer " লাগে কি না কোম্পানির কাগজে দেখুন। এনক্রিপ্ট করে রাখা হয়।')} />{' '}<Val v={ui.field('যে নম্বর থেকে কল যাবে (কোম্পানি দিলে)', ui.input('autocall_caller', s.autocall_caller, { placeholder: 'যেমন 09610xxxxxx বা আপনার নম্বর', maxlength: 20 }), raw('Body-তে <code>{{caller_id}}</code> লিখলে এটা যাবে'))} />{' '}<Val v={ui.field('Request body (JSON)', ui.textarea('autocall_body', s.autocall_body || AC.PRESETS.custom.body, { rows: 9, class: 'mono', maxlength: 4000 }),
    raw('<code>{{phone}}</code> 01…, <code>{{phone_intl}}</code> 8801…, <code>{{name}}</code>, <code>{{amount}}</code>, <code>{{order_code}}</code>, <code>{{message}}</code>, <code>{{caller_id}}</code>, <code>{{callback_url}}</code>'))} /><h3 className="h3">ফিরতি লিংক (Callback / Webhook URL)</h3><p className="small">কাস্টমার কী চাপল তা জানাতে কোম্পানির প্যানেলে এই লিংকটা দিন (অথবা Body-তে{' '}<code>{"{{callback_url}}"}</code>{' '}রাখুন):</p><p><code className="copy ac-hook"><Val v={hookUrl} /></code></p><p className="small muted">এই লিংকে কোম্পানি{' '}<code>digit=1</code>{' '}/{' '}<code>dtmf=2</code>{' '}/{' '}<code>status=no_answer</code>{' '}আর অর্ডার নম্বর (<code>order_code</code>{' '}বা{' '}<code>reference</code>) পাঠালেই কাজ করবে। লিংকটা গোপন রাখুন।{' '}<button className="link-btn small" form="ac-token" data-confirm-btn="নতুন লিংক বানালে পুরোনোটা আর কাজ করবে না — কোম্পানির প্যানেলেও বদলাতে হবে। বানাবেন?">🔄 নতুন লিংক বানান</button></p></section></div><div className="form-actions sticky-actions"><button className="btn btn-lg">💾 সেভ করুন</button></div></form>{jsxList(Object.keys(AC.PRESETS).map((k) => <form method="post" action={attrValue(BASE)} id={`ac-preset-${attrValue(k)}`} data-confirm={`'${attrValue(AC.PRESETS[k].label)}' এর নমুনা বসাবেন? API ঠিকানা আর Body বদলে যাবে (Key আর কলের কথা থাকবে)।`}><input type="hidden" name="form" defaultValue="preset" /><input type="hidden" name="preset" defaultValue={attrValue(k)} /></form>))}<form method="post" action={attrValue(BASE)} id="ac-token"><input type="hidden" name="form" defaultValue="token" /></form><section className="panel"><h2>🧪 নিজের নম্বরে পরীক্ষা করুন</h2><form method="post" action={attrValue(BASE)} className="ac-test" data-no-dirty=""><input type="hidden" name="form" defaultValue="test" />{' '}<Val v={ui.input('test_phone', s.phone || '', { placeholder: '01XXXXXXXXX', inputmode: 'numeric', maxlength: 14, required: true })} />{' '}<button className="btn">📞 পরীক্ষার কল দিন</button></form><p className="small muted">আগে উপরে সব সেভ করুন। পরীক্ষার কলে কোনো অর্ডার বদলায় না; কোম্পানি এক কলের টাকা কাটতে পারে।</p></section><section className="panel table-wrap"><h2>সাম্প্রতিক কল</h2>{(calls.length ? <table className="table compact"><thead><tr><th>সময়</th><th>অর্ডার</th><th>কাস্টমার</th><th>ফলাফল</th><th className="num">বার</th></tr></thead><tbody>{jsxList(calls.map((c) => <tr><td className="small">{fmtDate(c.updated_at || c.created_at)}</td><td><a href={`/admin/orders/${attrValue(c.order_id)}`}><b><Val v={c.code} /></b></a></td><td><Val v={c.customer_name} /><br /><span className="small muted"><Val v={c.phone} /></span></td><td><Val v={(AC.STATES[c.state] || ['', c.state]).join(' ')} />{(c.state === 'failed' && c.detail ? <><br /><span className="small warn">{str(c.detail, 120)}</span></> : null)}</td><td className="num">{bn(c.attempt)}</td></tr>))}</tbody></table> : <p className="muted">এখনো কোনো কল হয়নি।</p>)}</section></>;
  return ctx.page('অটো কল', body, 'autocall');
}

// "📞 অটো কল করুন" on an order's page
async function callOrder(ctx: AdminCtx, m?: Loose) {
  const id = int(m[1]);
  const o = await db.one('SELECT id, code, phone, customer_name, total, payment FROM orders WHERE id=$1', [id]);
  if (!o) return ctx.back('/admin/orders');
  if (!ctx.settings.autocall_url) return ctx.fail(`/admin/orders/${id}`, 'আগে "অটো কল" পেজে কল কোম্পানির সংযোগ দিন।');
  const items = await db.q('SELECT name FROM order_items WHERE order_id=$1 LIMIT 3', [id]);
  const r = await AC.call(ctx.settings, { ...o, items }, site(ctx));
  await ctx.log('autocall', 'order', id, r.ok ? 'হাতে অটো কল পাঠানো' : `অটো কল যায়নি: ${r.error}`);
  return r.ok ? ctx.redirect(`/admin/orders/${id}?info=` + encodeURIComponent('📞 কল পাঠানো হয়েছে — কাস্টমার চাপ দিলে ফলাফল এখানে আসবে।')) : ctx.fail(`/admin/orders/${id}`, 'কল যায়নি: ' + r.error);
}

// small block for the order page
async function orderBox(ctx: AdminCtx, order?: Loose) {
  const calls = await AC.forOrder(order.id);
  if (!calls.length && !ctx.settings.autocall_url) return '';
  const last = calls[0];
  return <section className="panel ac-box"><h2>📞 অটো কল</h2>{(last ? <p><b><Val v={(AC.STATES[last.state] || ['', last.state]).join(' ')} /></b>{' '}<span className="small muted">·{' '}{fmtDate(last.updated_at || last.created_at)}{' '}·{' '}{bn(last.attempt)}{' '}বার</span></p> : <p className="muted small">এই অর্ডারে এখনো অটো কল হয়নি।</p>)}{' '}{(ctx.can('orders_edit') && ctx.settings.autocall_url ? <form method="post" action={`/admin/orders/${attrValue(order.id)}/autocall`} data-no-dirty=""><button className="btn btn-sm btn-ghost">{(last ? "🔁 আবার অটো কল করুন" : "📞 অটো কল করুন")}</button></form> : null)}</section>;
}

export const routes = [
    { method: '*', path: BASE, perm: 'owner', handler: page },
    { method: 'POST', path: /^\/admin\/orders\/(\d+)\/autocall$/, perm: 'orders_edit', handler: callOrder },
  ];
export { orderBox };
