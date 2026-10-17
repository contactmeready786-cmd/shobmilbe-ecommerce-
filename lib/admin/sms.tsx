// Admin → মার্কেটিং → কাস্টমারকে SMS: the SMS company and key, automatic order messages (each with a switch
// and its own text), a test message, a message to many customers at once, and the list of everything sent.
import { Val, attrValue, jsxList } from '../react/html';
import { bn, int, str, fmtDate, normalizePhone, validPhone } from '../util';
import * as db from '../db';
import * as ui from './ui';
import * as SMS from '../services/sms';
import { SEGMENTS } from '../models/customers';
import * as $models_catalog from '../models/catalog';
import * as $models_orders from '../models/orders';
import type { AdminCtx, Body, Loose } from '../types';

const BASE = '/admin/marketing/sms';
const BATCH = 200; // customers per click (a click takes well under a minute)

async function audience(b: Body) {
  // customers who said "no offer SMS" (at checkout, or the owner noted it here) never get a bulk message
  const w = ["c.phone ~ '^01[3-9][0-9]{8}$'", "NOT EXISTS (SELECT 1 FROM blocklist bl WHERE bl.value=c.phone)", 'c.promo_sms'];
  const params: Loose[] = [];
  if (b.aud === 'group' && str(b.grp, 60)) { params.push(str(b.grp, 60)); w.push(`c.grp=$${params.length}`); }
  if (b.aud === 'tag' && str(b.tag, 40)) { params.push(`%${str(b.tag, 40)}%`); w.push(`c.tags ILIKE $${params.length}`); }
  if (b.aud === 'recent') { params.push(Math.max(1, Math.min(3650, int(b.days, 90)))); w.push(`EXISTS (SELECT 1 FROM orders o WHERE o.phone=c.phone AND o.status='delivered' AND o.created_at > now() - make_interval(days => $${params.length}))`); }
  if (b.aud === 'buyers') w.push(`EXISTS (SELECT 1 FROM orders o WHERE o.phone=c.phone AND o.status='delivered')`);
  // "অনেক দিন কেনেননি": bought before, but nothing in the last N days (e.g. 90 = তিন মাস)
  if (b.aud === 'inactive') {
    params.push(Math.max(1, Math.min(3650, int(b.days, 90))));
    w.push(`EXISTS (SELECT 1 FROM orders o WHERE o.phone=c.phone AND o.status='delivered')`);
    w.push(`NOT EXISTS (SELECT 1 FROM orders o WHERE o.phone=c.phone AND o.status<>'cancelled' AND o.created_at > now() - make_interval(days => $${params.length}))`);
  }
  // ready-made groups (same as the customer list): new, repeat, VIP, risky…
  if (b.aud === 'segment' && SEGMENTS[b.segment]) {
    let cond = SEGMENTS[b.segment][1];
    if (cond.includes('$VIP')) { params.push(Math.max(0, int(b.min_spent, 5000))); cond = cond.replace('$VIP', `$${params.length}`); }
    w.push(`c.id IN (SELECT c2.id FROM customers c2 LEFT JOIN orders o ON o.phone=c2.phone GROUP BY c2.id HAVING ${cond})`);
  }
  if (b.aud === 'spent') {
    params.push(Math.max(0, int(b.min_spent, 5000)));
    w.push(`(SELECT coalesce(sum(o.total),0) FROM orders o WHERE o.phone=c.phone AND o.status='delivered') >= $${params.length}`);
  }
  if (b.aud === 'district' && str(b.district, 60)) {
    params.push(str(b.district, 60));
    w.push(`(c.district=$${params.length} OR EXISTS (SELECT 1 FROM orders o WHERE o.phone=c.phone AND o.district=$${params.length}))`);
  }
  // bought something from a category (or its sub-categories)
  if (b.aud === 'category' && int(b.category)) {
    params.push(int(b.category));
    w.push(`EXISTS (SELECT 1 FROM orders o JOIN order_items i ON i.order_id=o.id JOIN products p ON p.id=i.product_id WHERE o.phone=c.phone AND o.status='delivered'
      AND p.category_id IN (WITH RECURSIVE t AS (SELECT id FROM categories WHERE id=$${params.length} UNION SELECT k.id FROM categories k JOIN t ON k.parent_id=t.id) SELECT id FROM t))`);
  }
  if (b.aud === 'accounts') w.push('c.last_login IS NOT NULL');
  return { where: w.join(' AND '), params };
}
const AUD = [['buyers', 'যারা অন্তত একবার পণ্য পেয়েছেন'], ['inactive', '😴 অনেক দিন কেনেননি (নিচের "দিন" দেখে)'], ['recent', 'গত কিছু দিনে যারা কিনেছেন'],
  ['segment', 'তৈরি গ্রুপ (নতুন / আবার কিনেছেন / VIP / ঝুঁকিপূর্ণ…)'], ['spent', 'মোট এর বেশি টাকার কেনাকাটা করেছেন'], ['category', 'একটা ক্যাটাগরি থেকে কিনেছেন'],
  ['district', 'একটা জেলার কাস্টমার'], ['accounts', 'যারা অ্যাকাউন্টে লগইন করেছেন'], ['group', 'একটা গ্রুপ (হাতে দেওয়া)'], ['tag', 'একটা ট্যাগ'], ['all', 'সব কাস্টমার']];
function audienceText(b: Body, cats: Loose = []) {
  const base = (AUD.find(([k]) => k === b.aud) || AUD[0])[1].replace(/\s*\(.*\)$/, '');
  const extra = b.aud === 'inactive' || b.aud === 'recent' ? ` — ${int(b.days, 90)} দিন` : b.aud === 'segment' && SEGMENTS[b.segment] ? ` — ${SEGMENTS[b.segment][0]}`
    : b.aud === 'spent' ? ` — ৳${int(b.min_spent, 5000)}+` : b.aud === 'category' ? ` — ${(cats.find((c?: Loose) => c.id === int(b.category)) || {}).name || ''}`
      : b.aud === 'district' ? ` — ${str(b.district, 60)}` : b.aud === 'group' ? ` — ${str(b.grp, 60)}` : b.aud === 'tag' ? ` — ${str(b.tag, 40)}` : '';
  return (base + extra).slice(0, 200);
}

async function page(ctx: AdminCtx, note: Loose = null) {
  const s = ctx.settings;
  const canSetup = ctx.can('settings');
  const r = SMS.ready(s);
  const [log, groups, stats, cats, camps] = await Promise.all([
    db.q('SELECT l.*, o.code FROM sms_log l LEFT JOIN orders o ON o.id=l.order_id ORDER BY l.created_at DESC LIMIT 40'),
    db.q("SELECT grp, count(*)::int AS n FROM customers WHERE grp<>'' GROUP BY grp ORDER BY grp"),
    db.one(`SELECT count(*) FILTER (WHERE ok AND created_at > now() - interval '30 days')::int AS ok30,
      count(*) FILTER (WHERE NOT ok AND created_at > now() - interval '30 days')::int AS bad30 FROM sms_log`),
    $models_catalog.listCategories({ includeInactive: false }),
    db.q('SELECT c.*, s.name AS staff_name FROM sms_campaigns c LEFT JOIN staff s ON s.id=c.staff_id ORDER BY c.updated_at DESC LIMIT 15'),
  ]);
  const [quota, optedOut] = await Promise.all([SMS.mktLeft(s), db.one('SELECT count(*)::int AS n FROM customers WHERE NOT promo_sms').catch(() => ({ n: 0 }))]);
  const lim = (n?: Loose) => (n === Infinity ? 'সীমা নেই' : bn(n));
  const prov: string = SMS.PROVIDERS[s.sms_provider as string] ? s.sms_provider as string : 'bulksmsbd';
  const tplBox = (ev?: Loose, label?: Loose) => <div className="sms-row">{ui.check(`sms_on_${ev}`, s[`sms_on_${ev}`] === '1', `${label} SMS পাঠাও`)}{' '}<textarea name={`sms_tpl_${attrValue(ev)}`} rows={2} maxLength={480} aria-label={`${attrValue(label)} SMS এর লেখা`} defaultValue={attrValue(s[`sms_tpl_${ev}`] || '')} /><p className="small muted">{bn(String(s[`sms_tpl_${ev}`] || '').length)}{' '}অক্ষর ≈{' '}{bn(SMS.parts(SMS.fill(s[`sms_tpl_${ev}`], { code: 'SM123456', total: 1250, customer_name: 'রহিম', points_earned: 0 }, s, s.site_url || '')))}টি SMS</p></div>;
  const clearOn = s.sms_log_clear_on === '1';
  const body = <><h1>📱 কাস্টমারকে SMS</h1>{ui.flash(ctx.flash)}{(note ? ui.flash(note) : null)}{' '}{(canSetup ? <form method="post" action={attrValue(BASE)} className="panel form sms-clear-switch"><input type="hidden" name="action" defaultValue="clearswitch" />{' '}{ui.switchRow('sms_log_clear_on', clearOn, '🗑️ SMS ইতিহাস মোছার বাটন', 'চালু করলে নিচের "শেষ SMS" তালিকায় মোছার বাটন আসবে। দোকান আসলভাবে চালু করার পর বন্ধ করে দিন, তখন ইতিহাস থেকে যাবে।')}{' '}<button className="btn btn-sm">সেভ করুন</button></form> : null)}<div className="kpis">{ui.kpi('অবস্থা', r.ok ? '✅ চালু' : '⚪ বন্ধ', r.ok ? SMS.PROVIDERS[prov].label : r.why)}{' '}{ui.kpi('গত ৩০ দিনে পাঠানো', bn(stats!.ok30), stats!.bad30 ? `${bn(stats!.bad30)}টি যায়নি` : '', stats!.bad30 ? 'kpi-alert' : '')}{' '}{ui.kpi('অফার SMS আজ বাকি', lim(quota.day), `এই মাসে বাকি: ${lim(quota.month)}`)}{' '}{ui.kpi('অফার SMS চান না', bn(optedOut!.n), 'এদের কাছে একসাথে-পাঠানো SMS যায় না')}</div>{ui.helpBox('SMS কীভাবে চালু করবেন', <ol className="steps"><li>যেকোনো একটা SMS কোম্পানিতে অ্যাকাউন্ট খুলুন (যেমন BulkSMSBD, Alpha SMS বা Greenweb) আর কিছু টাকার SMS কিনুন — সাধারণত প্রতি SMS ২৫-৪০ পয়সা।</li><li>তাদের প্যানেল থেকে{' '}<b>API Key</b>{' '}কপি করুন। BulkSMSBD-তে একটা{' '}<b>Sender ID</b>-ও লাগে (তারা অনুমোদন দেয়)।</li><li>নিচে কোম্পানি বাছুন, Key দিন, "SMS চালু" করে সেভ দিন। তারপর "পরীক্ষা" অংশ থেকে নিজের নম্বরে একটা SMS পাঠিয়ে দেখুন।</li><li>বাংলায় এক SMS-এ ৭০ অক্ষর, ইংরেজিতে ১৬০ — লেখা ছোট রাখলে খরচ কম।</li></ol>)}<div className="two-col"><section className="panel"><h2>⚙️ SMS কোম্পানি</h2>{(canSetup ? <form method="post" action={attrValue(BASE)} className="form"><input type="hidden" name="action" defaultValue="setup" />{' '}{ui.switchRow('sms_on', s.sms_on === '1', 'SMS চালু', 'বন্ধ থাকলে কোনো SMS যাবে না।')}{' '}{ui.field('কোম্পানি', ui.select('sms_provider', Object.entries(SMS.PROVIDERS).map(([k, v]) => [k, v.label]), prov))}{' '}{ui.field('API Key', ui.input('sms_api_key', '', { type: 'password', maxlength: 200, autocomplete: 'off', placeholder: s.sms_api_key ? '•••••••• (সেভ করা আছে — বদলাতে নতুনটা দিন)' : 'কোম্পানির প্যানেল থেকে কপি করুন' }))}{' '}{ui.field('Sender ID (ঐচ্ছিক)', ui.input('sms_sender_id', s.sms_sender_id || '', { maxlength: 60 }), 'BulkSMSBD-তে লাগে; "নিজের ফোনের SIM" বাছলে এখানে অ্যাপের Username')}<details className="help" open={!!(prov === 'android' && !r.ok)}><summary><b>📱 নিজের ফোনের SIM (যেমন Grameenphone) দিয়ে SMS — চালুর ধাপ</b></summary><ol className="small"><li>যে Android ফোনে SIM আছে, তাতে{' '}<a href="https://github.com/capcom6/android-sms-gateway/releases/latest" target="_blank" rel="noopener"><b>SMS Gateway for Android</b>{' '}↗</a>{' '}অ্যাপ ইনস্টল করুন (ফ্রি; Play Store-এ "SMS Gateway for Android" নামে, অথবা লিংক থেকে APK)।</li><li>অ্যাপ খুলে SMS পাঠানোর অনুমতি দিন →{' '}<b>Cloud Server</b>{' '}চালু করুন →{' '}<b>Offline</b>{' '}বোতাম চাপুন,{' '}<b>Online</b>{' '}হয়ে যাবে।</li><li>Cloud Server অংশে{' '}<b>Username</b>{' '}আর{' '}<b>Password</b>{' '}দেখাবে। উপরে কোম্পানি:{' '}<b>নিজের ফোনের SIM</b>{' '}বাছুন →{' '}<b>Sender ID</b>{' '}ঘরে Username,{' '}<b>API Key</b>{' '}ঘরে Password দিন → SMS চালু → সেভ।</li><li>নিচে "পরীক্ষামূলক SMS" পাঠিয়ে দেখুন।</li></ol><p className="small muted">ফোনটা চার্জে, ইন্টারনেটে আর অ্যাপ চালু রাখুন (ব্যাটারি সেভার থেকে অ্যাপটা বাদ দিন)। প্রতিটা SMS-এ SIM থেকে সাধারণ SMS-এর টাকা কাটবে। দোকানের SIM আলাদা হলে ভালো।</p></details><details className="help" open={!!(prov === 'textbee' && !r.ok)}><summary><b>📱 textbee.dev দিয়ে নিজের SIM থেকে SMS (ফ্রি, বেশি স্থির) — চালুর ধাপ</b></summary><ol className="small"><li><a href="https://textbee.dev" target="_blank" rel="noopener"><b>textbee.dev</b>{' '}↗</a>-এ ফ্রি অ্যাকাউন্ট খুলুন।</li><li>যে Android ফোনে SIM আছে, তাতে textbee অ্যাপ ইনস্টল করুন (ড্যাশবোর্ডে লিংক থাকে), SMS-এর অনুমতি দিন, ড্যাশবোর্ডের QR স্ক্যান করে ফোনটা যুক্ত করুন।</li><li>ড্যাশবোর্ড থেকে{' '}<b>API Key</b>{' '}বানিয়ে কপি করুন। উপরে কোম্পানি:{' '}<b>textbee.dev</b>{' '}বাছুন →{' '}<b>API Key</b>{' '}ঘরে Key দিন (Sender ID ঘরে চাইলে ফোনের{' '}<b>Device ID</b>, না দিলেও চলে) → SMS চালু → সেভ।</li><li>নিচে "পরীক্ষামূলক SMS" পাঠিয়ে দেখুন।</li></ol><p className="small muted">ফ্রি প্ল্যানে দিনে ~৫০, মাসে ~৩০০ SMS। চেকআউট কোড আর অর্ডারের SMS যাতে আটকে না যায়, তাই নিচে অফার SMS-এর আলাদা সীমা রাখা আছে।</p></details>{ui.field('নিজের লিংক (শুধু "অন্য কোম্পানি" বাছলে)', ui.input('sms_custom_url', s.sms_custom_url || '', { maxlength: 400, placeholder: 'https://api.example.com/send?key={key}&to={to}&text={message}' }), '{to} = নম্বর (8801…), {message} = লেখা, {key} = API Key, {sender} = Sender ID')}<div className="field-row">{ui.field('অফার SMS — দিনে সর্বোচ্চ', ui.input('sms_mkt_day', s.sms_mkt_day || '0', { type: 'number', min: 0, max: 100000, class: 'w-num' }), '০ = সীমা নেই')}{' '}{ui.field('অফার SMS — মাসে সর্বোচ্চ', ui.input('sms_mkt_month', s.sms_mkt_month || '0', { type: 'number', min: 0, max: 1000000, class: 'w-num' }), 'ফ্রি SIM প্ল্যানে কম রাখুন, যাতে OTP-র জায়গা থাকে')}</div><button className="btn">সেভ করুন</button></form> : <p className="muted">SMS কোম্পানি সেটআপ করার অনুমতি শুধু সেটিংসের অনুমতি থাকলে। মালিককে বলুন।</p>)}<h2>🧪 পরীক্ষা</h2><form method="post" action={attrValue(BASE)} className="form"><input type="hidden" name="action" defaultValue="test" /><div className="field-row">{ui.field('মোবাইল নম্বর', ui.input('phone', '', { required: true, inputmode: 'tel', maxlength: 20, placeholder: '01XXXXXXXXX' }))}{' '}{ui.field('লেখা', ui.input('text', `${s.store_name}: পরীক্ষামূলক SMS`, { required: true, maxlength: 160 }))}</div><button className="btn btn-ghost">পাঠিয়ে দেখুন</button></form></section><section className="panel"><h2>🧾 অর্ডারের SMS (নিজে থেকে যায়)</h2><form method="post" action={attrValue(BASE)} className="form"><input type="hidden" name="action" defaultValue="templates" />{' '}<Val v={Object.entries(SMS.ORDER_EVENTS).map(([ev, label]) => tplBox(ev, label))} /><p className="small muted">লেখার ভেতরে বসানো যায়:{' '}<code>{"{shop}"}</code>{' '}দোকানের নাম,{' '}<code>{"{code}"}</code>{' '}অর্ডার নম্বর,{' '}<code>{"{total}"}</code>{' '}মোট টাকা,{' '}<code>{"{name}"}</code>{' '}কাস্টমারের নাম,{' '}<code>{"{tracking}"}</code>{' '}ট্র্যাকিং,{' '}<code>{"{points}"}</code>{' '}পাওয়া পয়েন্ট,{' '}<code>{"{link}"}</code>{' '}অর্ডারের পেজ (সেখান থেকে রিভিউ দেওয়া যায়)। একই অর্ডারে একই SMS দুইবার যায় না।</p><button className="btn">সেভ করুন</button></form></section></div><section className="panel"><h2>📣 অনেক কাস্টমারকে একসাথে (অফার/নোটিশ)</h2><form method="post" action={attrValue(BASE)} className="form" data-confirm="বাছাই করা কাস্টমারদের SMS পাঠাবেন? এতে SMS-এর খরচ হবে।"><input type="hidden" name="action" defaultValue="bulk" /><div className="field-row">{ui.field('কাদের', ui.select('aud', AUD, 'buyers'))}{' '}{ui.field('দিন', ui.input('days', '90', { type: 'number', min: 1, max: 3650, class: 'w-num' }), '"অনেক দিন কেনেননি" / "গত কিছু দিনে" বাছলে')}{' '}{ui.field('তৈরি গ্রুপ', ui.select('segment', Object.entries(SEGMENTS).map(([k, v]) => [k, v[0]]), 'repeat'))}{' '}{ui.field('কমপক্ষে কত টাকার (৳)', ui.input('min_spent', '5000', { type: 'number', min: 0, class: 'w-num' }), 'VIP / "এর বেশি টাকার" বাছলে')}</div><div className="field-row">{ui.field('ক্যাটাগরি', ui.select('category', [['', '—'], ...ui.catOpts(cats)], ''))}{' '}{ui.field('জেলা', ui.select('district', [['', '—'], ...$models_orders.GEO.districts.map((d) => [d.en, `${d.bn} (${d.en})`])], ''))}{' '}{ui.field('গ্রুপ', ui.select('grp', [['', '—'], ...groups.map((g) => [g.grp, `${g.grp} (${bn(g.n)})`])], ''))}{' '}{ui.field('ট্যাগ', ui.input('tag', '', { maxlength: 40 }))}</div>{ui.field('লেখা', ui.textarea('text', '', { rows: 2, required: true, maxlength: 320, placeholder: `${s.store_name}: শুক্রবার সব পণ্যে ১০% ছাড়! কোড FRI10` }), 'ব্লক লিস্টের নম্বরে যাবে না। একবারে সর্বোচ্চ ২০০ জনকে যায় — বাকিদের পাঠাতে আবার একই লেখা দিয়ে পাঠান, যারা আগে পেয়েছেন তারা আর পাবেন না।')}<div className="row-actions"><button className="btn" name="go" value="1">পাঠান</button><button className="btn btn-ghost" name="go" value="0">আগে কতজন দেখি</button></div></form></section><section className="panel"><h2>🚫 অফার SMS চান না</h2><p className="small muted">কেউ অফার SMS বন্ধ করতে বললে নম্বরটা এখানে দিন। চেকআউটে "অফারের খবর পেতে চাই" টিক তুলে দিলেও নিজে থেকে এই তালিকায় যায়। অর্ডারের SMS আর কোড আগের মতোই যাবে।</p><form method="post" action={attrValue(BASE)} className="form"><input type="hidden" name="action" defaultValue="optout" />{' '}{ui.field('মোবাইল নম্বর (একাধিক হলে কমা বা নতুন লাইনে)', ui.textarea('phones', '', { rows: 2, maxlength: 4000, placeholder: '01712345678' }))}<div className="row-actions"><button className="btn btn-ghost" name="to" value="off">🚫 অফার SMS বন্ধ</button><button className="btn btn-ghost" name="to" value="on">✅ আবার চালু</button></div></form></section>{(camps.length ? <section className="panel table-wrap"><h2>📣 আগের ক্যাম্পেইন</h2><table className="table compact"><thead><tr><th>শেষ পাঠানো</th><th>কাদের</th><th>লেখা</th><th className="num">গেছে</th><th className="num">যায়নি</th></tr></thead><tbody>{jsxList(camps.map((c) => <tr><td className="small nowrap">{fmtDate(c.updated_at)}<br /><span className="muted"><Val v={c.staff_name || ''} /></span></td><td className="small"><Val v={c.audience} /></td><td className="small"><Val v={c.body} /></td><td className="num">{bn(c.sent)}</td><td className="num">{bn(c.failed)}</td></tr>))}</tbody></table></section> : null)}<section className="panel"><h2>🗒️ শেষ ৪০টি SMS</h2>{(clearOn && canSetup && log.length ? <form method="post" action={attrValue(BASE)} data-confirm="সব SMS-এর ইতিহাস আর চেকআউট OTP-র পুরনো কোডের তালিকা মুছে যাবে। আর ফেরত আনা যাবে না। মুছবেন?"><input type="hidden" name="action" defaultValue="clearlog" /><button className="btn btn-sm btn-danger">🗑️ সব SMS ইতিহাস মুছুন</button></form> : null)}{' '}{(log.length ? <div className="table-wrap"><table className="table compact"><thead><tr><th>সময়</th><th>নম্বর</th><th>কী</th><th>লেখা</th><th>ফল</th></tr></thead><tbody>{jsxList(log.map((l) => <tr className={l.ok ? '' : 'row-warn'}><td className="small nowrap">{fmtDate(l.created_at)}</td><td className="small mono"><Val v={l.phone} /></td><td className="small">{(l.kind.startsWith('order_') ? <Val v={SMS.ORDER_EVENTS[l.kind.slice(6)] || l.kind} /> : (l.kind === 'bulk' ? "একসাথে অনেককে" : (l.kind === 'test' ? "পরীক্ষা" : <Val v={l.kind} />)))}{(l.code ? <>{' '}·{' '}<a href={`/admin/orders/${attrValue(l.order_id)}`}><Val v={l.code} /></a></> : null)}</td><td className="small"><Val v={l.body} /></td><td className="small">{(l.ok ? "✅" : "❌")}{' '}<Val v={l.detail} /></td></tr>))}</tbody></table></div> : <p className="muted">এখনো কোনো SMS পাঠানো হয়নি।</p>)}</section></>;
  return ctx.page('কাস্টমারকে SMS', body, 'sms');
}

async function post(ctx: AdminCtx) {
  const b = await ctx.body();
  if (b.action === 'setup') {
    if (!ctx.can('settings')) return ctx.back(BASE, 'noperm');
    const v: Record<string, Loose> = { sms_on: b.sms_on ? '1' : '0', sms_provider: SMS.PROVIDERS[b.sms_provider] ? b.sms_provider : 'bulksmsbd',
      sms_sender_id: str(b.sms_sender_id, 60),
      sms_mkt_day: String(Math.max(0, Math.min(100000, int(b.sms_mkt_day, 0)))), sms_mkt_month: String(Math.max(0, Math.min(1000000, int(b.sms_mkt_month, 0)))), sms_custom_url: /^https:\/\/[^\s]+$/i.test(str(b.sms_custom_url, 400)) ? str(b.sms_custom_url, 400) : '' };
    if (str(b.sms_api_key, 200)) v.sms_api_key = str(b.sms_api_key, 200);
    await db.setMany(v);
    await ctx.log('settings', 'settings', null, `SMS: ${v.sms_on === '1' ? 'চালু' : 'বন্ধ'}, ${SMS.PROVIDERS[v.sms_provider].label}${v.sms_api_key ? ', নতুন API key' : ''}`);
    return ctx.back(BASE, 'saved');
  }
  if (b.action === 'clearswitch') {
    if (!ctx.can('settings')) return ctx.back(BASE, 'noperm');
    await db.setMany({ sms_log_clear_on: b.sms_log_clear_on ? '1' : '0' });
    await ctx.log('settings', 'settings', null, `SMS ইতিহাস মোছার বাটন: ${b.sms_log_clear_on ? 'চালু' : 'বন্ধ'}`);
    return ctx.back(BASE, 'saved');
  }
  // 🗑️ testing over: wipe the SMS history (and old checkout codes) — only while the switch above is on
  if (b.action === 'clearlog') {
    if (!ctx.can('settings') || ctx.settings.sms_log_clear_on !== '1') return ctx.back(BASE, 'noperm');
    const n = await db.one('WITH d AS (DELETE FROM sms_log RETURNING 1) SELECT count(*)::int AS n FROM d');
    await db.q('DELETE FROM checkout_otps WHERE used OR expires_at < now()');
    await ctx.log('settings', 'marketing', null, `SMS ইতিহাস মোছা হয়েছে (${n!.n}টি)`);
    return ctx.back(BASE, 'saved');
  }
  if (b.action === 'optout') {
    const phones = [...new Set(String(b.phones || '').split(/[\s,;]+/).map(normalizePhone).filter(validPhone))].slice(0, 500);
    if (!phones.length) return ctx.fail(BASE, 'সঠিক মোবাইল নম্বর দিন, যেমন 01712345678।');
    const on = b.to === 'on';
    const r = await db.q('UPDATE customers SET promo_sms=$1 WHERE phone = ANY($2::text[]) RETURNING phone', [on, phones]);
    await ctx.log('settings', 'marketing', null, `অফার SMS ${on ? 'চালু' : 'বন্ধ'}: ${phones.join(', ').slice(0, 300)}`);
    const miss = phones.length - r.length;
    return ctx.back(`${BASE}?info=${encodeURIComponent(`✅ ${bn(r.length)}টি নম্বরে অফার SMS ${on ? 'চালু' : 'বন্ধ'} হলো।${miss ? ` ${bn(miss)}টি নম্বর কাস্টমার তালিকায় নেই।` : ''}`)}`);
  }
  if (b.action === 'templates') {
    const v: Record<string, string> = {};
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
    const quota = await SMS.mktLeft(ctx.settings);
    if (b.go === '1' && quota.left <= 0) return ctx.fail(BASE, `অফার SMS-এর ${quota.day <= 0 ? 'আজকের' : 'এই মাসের'} সীমা শেষ (চেকআউট কোডের জন্য জায়গা রাখা হয়েছে)। সীমা বাড়াতে উপরের "অফার SMS — দিনে/মাসে সর্বোচ্চ" বদলান।`);
    const a = await audience(b);
    const total = (await db.one(`SELECT count(*)::int AS n FROM customers c WHERE ${a.where}`, a.params))!.n;
    // people who already got this exact text are skipped, so pressing again continues with the rest
    a.params.push(text);
    const rows = await db.q(`SELECT c.phone FROM customers c WHERE ${a.where}
      AND NOT EXISTS (SELECT 1 FROM sms_log l WHERE l.phone=c.phone AND l.body=$${a.params.length} AND l.ok) ORDER BY c.id LIMIT ${Math.min(BATCH, quota.left === Infinity ? BATCH : quota.left)}`, a.params);
    if (b.go !== '1') return page({ ...ctx, method: 'GET' }, { text: `এই বাছাইয়ে মোট ${bn(total)} জন — এখন পাঠানো যাবে ${bn(rows.length)} জনকে${quota.left !== Infinity ? ` (অফার SMS-এর সীমা: আজ বাকি ${bn(quota.left)})` : ''}। লেখাটা ≈ ${bn(SMS.parts(text))}টি SMS করে।` });
    let ok = 0; let bad = 0;
    const phones = rows.map((r) => r.phone).filter((p) => validPhone(normalizePhone(p)));
    for (let i = 0; i < phones.length; i += 6) {
      const res = await Promise.all(phones.slice(i, i + 6).map((p) => SMS.send(ctx.settings, p, text, { kind: 'bulk', staffId: ctx.user.id })));
      res.forEach((r) => { if (r.ok) ok++; else bad++; });
      if (bad >= 10 && ok === 0) break; // the company is refusing everything (no credit / wrong key) — stop
    }
    await ctx.log('settings', 'marketing', null, `একসাথে SMS: ${ok}টি গেছে, ${bad}টি যায়নি — "${text.slice(0, 60)}"`);
    // the campaign's record (pressing "পাঠান" again with the same text continues the same campaign)
    const cats = b.aud === 'category' ? await $models_catalog.listCategories() : [];
    const aud = audienceText(b, cats);
    const prev = await db.one('SELECT id FROM sms_campaigns WHERE body=$1 AND audience=$2 AND updated_at > now() - interval \'7 days\' ORDER BY id DESC LIMIT 1', [text, aud]);
    if (prev) await db.q('UPDATE sms_campaigns SET sent=sent+$1, failed=failed+$2, total=$3, updated_at=now() WHERE id=$4', [ok, bad, total, prev.id]);
    else await db.q('INSERT INTO sms_campaigns(audience, body, total, sent, failed, staff_id) VALUES($1,$2,$3,$4,$5,$6)', [aud, text, total, ok, bad, ctx.user.id]);
    const capped = quota.left !== Infinity && rows.length >= quota.left;
    const more = capped ? ' অফার SMS-এর আজকের সীমা পূর্ণ — বাকিদের কাল একই লেখা দিয়ে "পাঠান" চাপুন।' : rows.length >= BATCH ? ' আরও কাস্টমার বাকি আছে — একই লেখা দিয়ে আবার "পাঠান" চাপুন।' : '';
    return page({ ...ctx, method: 'GET' }, bad && !ok ? { type: 'error', text: `❌ একটাও যায়নি (${bad}টি চেষ্টা)। নিচের তালিকায় কোম্পানির উত্তর দেখুন — সাধারণত ব্যালেন্স শেষ বা Key ভুল।` }
      : { text: `✅ ${bn(ok)} জনকে পাঠানো হয়েছে${bad ? `, ${bn(bad)}টি যায়নি` : ''}।${more}` });
  }
  return ctx.redirect(BASE);
}

export const routes = [
    { method: 'GET', path: BASE, perm: 'marketing', handler: (ctx: AdminCtx) => page(ctx) },
    { method: 'POST', path: BASE, perm: 'marketing', handler: post },
  ];
