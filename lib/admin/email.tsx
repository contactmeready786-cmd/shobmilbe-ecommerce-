// Admin → মার্কেটিং → মেসেজ → 📧 ইমেইল: e-mail marketing (owner, 2026-10-16).
//  - set-up ONCE: Brevo (free ~300/day, made for bulk mail) — or the shop's Gmail for a small list (capped, so Google
//    never locks the Gmail that carries order mails and codes; that Gmail is the one in আমার নোটিফিকেশন, never entered here)
//  - automatic mails: welcome, weekly new products, review request, "we miss you"
//  - campaigns: subject + text + products + a button, to everyone / buyers / not-yet-buyers; sent in parts within the
//    day's allowance by the hourly job, with sent / opened / clicked
//  - the list: added from the footer box, the checkout tick, or pasted by the owner; one-click leave in every mail
import type { EmailLogRow, EmailSubsRow, ProductsRow, EmailCampaignsRow } from '../data/rows';
import { Val, attrValue, jsxList } from '../react/html';
import { bn, int, str, fmtDate, ifKey } from '../util';
import * as db from '../db';
import * as ui from './ui';
import * as M from '../services/mailer';
import * as notify from '../services/notify';
import { secretInput } from './marketing';
import * as $security from '../security';
import type { AdminCtx } from '../types';

const BASE = '/admin/marketing/email';
const DAYS = [['6', 'শনিবার'], ['0', 'রবিবার'], ['1', 'সোমবার'], ['2', 'মঙ্গলবার'], ['3', 'বুধবার'], ['4', 'বৃহস্পতিবার'], ['5', 'শুক্রবার']];
const pct = (a: number, b: number) => (b ? `${bn(Math.round((a * 100) / b))}%` : '—');

// "1023, 1024", product links (/p/slug) or SKUs → product ids (in the order given)
async function resolveProducts(text?: string) {
  const parts = String(text || '').split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean).slice(0, 12);
  const ids: number[] = [];
  for (const p of parts) {
    const slug = (p.match(/\/p\/([^/?#\s]+)/) || [])[1];
    const row = slug
      ? await db.one<Pick<ProductsRow, 'id'>>('SELECT id FROM products WHERE slug=$1 AND active', [decodeURIComponent(slug)])
      : await db.one<Pick<ProductsRow, 'id'>>('SELECT id FROM products WHERE active AND (sku=$1 OR ($1 ~ \'^[0-9]{1,9}$\' AND id=$1::int)) ORDER BY (sku=$1) DESC LIMIT 1', [p.slice(0, 60)]);
    if (row && !ids.includes(row.id)) ids.push(row.id);
  }
  return ids;
}
async function newest(n = 6) {
  return (await db.q<Pick<ProductsRow, 'id'>>(`SELECT p.id FROM products p WHERE p.active AND p.parent_id IS NULL AND p.stock > 0 AND p.price > 0 AND p.image_id IS NOT NULL
    ORDER BY p.created_at DESC LIMIT $1`, [n])).map((r) => r.id);
}

async function page(ctx: AdminCtx, note: ui.Flash | null = null) {
  const s = ctx.settings;
  const c = M.cfg(s);
  const canSetup = ctx.can('settings');
  const q = str(ctx.query.get('q'), 80);
  const [st, today, camps, subs, log] = await Promise.all([
    M.stats(), M.sentToday(),
    db.q<{ id: number; subject: string; intro: string; product_ids: number[]; button_text: string; button_url: string; audience: string; kind: string; status: string; total: number; sent: number; failed: number; staff_id: number; created_at: Date; updated_at: Date; finished_at: Date; staff_name: string; opened: number; clicked: number }>(`SELECT c.*, st.name AS staff_name,
        (SELECT count(*) FILTER (WHERE opened_at IS NOT NULL)::int FROM email_log l WHERE l.campaign_id=c.id) AS opened,
        (SELECT count(*) FILTER (WHERE clicked_at IS NOT NULL)::int FROM email_log l WHERE l.campaign_id=c.id) AS clicked
      FROM email_campaigns c LEFT JOIN staff st ON st.id=c.staff_id ORDER BY c.id DESC LIMIT 12`),
    q ? db.q<EmailSubsRow>('SELECT * FROM email_subs WHERE email ILIKE $1 OR name ILIKE $1 OR phone ILIKE $1 ORDER BY id DESC LIMIT 50', [`%${q}%`])
      : db.q<EmailSubsRow>('SELECT * FROM email_subs ORDER BY id DESC LIMIT 30'),
    db.q<EmailLogRow>('SELECT * FROM email_log ORDER BY id DESC LIMIT 30'),
  ]);
  // 📥 lists brought from Excel (Admin → মেসেজ → Excel তালিকা) — each can get its own campaign
  const xlGroups = await db.q<{ source: string; n: number }>("SELECT source, count(*) FILTER (WHERE on_list)::int AS n FROM email_subs WHERE source LIKE 'xl:%' GROUP BY source ORDER BY source").catch(() => []);
  const audOptions: [string, string][] = [...Object.entries(M.AUDIENCES), ...xlGroups.filter((g) => M.isXl(g.source)).map((g): [string, string] => [g.source, `📥 Excel তালিকা: ${g.source.slice(3)} (${bn(g.n)} জন)`])];
  const gmailReady = notify.emailConfig(s).ready;
  const status = !c.on ? '⚪ বন্ধ' : c.ready ? '✅ চালু' : '⚠️ সেটআপ বাকি';
  const body = <><h1>📧 ইমেইল মার্কেটিং</h1>{ui.flash(ctx.flash)}{(note ? ui.flash(note) : null)}{' '}{(c.on && !c.ready ? ui.flash({ type: 'error', text: `ইমেইল যাচ্ছে না: ${c.why}` }) : null)}<div className="kpis">{ui.kpi('অবস্থা', status, c.provider === 'brevo' ? 'Brevo দিয়ে' : 'দোকানের Gmail দিয়ে')}{' '}{ui.kpi('তালিকায় আছেন', bn(st!.subs), `গত ৩০ দিনে নতুন ${bn(st!.new30)} · চলে গেছেন ${bn(st!.left_list)}`)}{' '}{ui.kpi('আজ পাঠানো', `${bn(today)} / ${bn(c.perDay)}`, 'দিনের সীমা (বাকিগুলো কাল যায়)')}{' '}{ui.kpi('৩০ দিনে খোলা', pct(st!.opened30, st!.sent30), `${bn(st!.sent30)}টি গেছে · ক্লিক ${pct(st!.clicked30, st!.sent30)}`)}{' '}{(st!.bad30 ? ui.kpi('যায়নি (৩০ দিন)', bn(st!.bad30), 'নিচের তালিকায় কারণ দেখুন', 'kpi-alert') : null)}</div>{ui.helpBox('Brevo দিয়ে চালু করবেন কীভাবে (একবারই, ১০ মিনিট)', <><ol className="steps"><li><a href="https://www.brevo.com" target="_blank" rel="noopener"><b>brevo.com</b>{' '}↗</a>-এ ফ্রি অ্যাকাউন্ট খুলুন (দোকানের Gmail দিয়ে)। ফ্রি প্ল্যানে দিনে ৩০০টা ইমেইল — টাকা লাগে না, কার্ড লাগে না।</li><li>Brevo →{' '}<b>{"Senders, Domains & Dedicated IPs → Domains"}</b>{' '}→{' '}<b>shobmilbe.com</b>{' '}যোগ করুন। Brevo কয়েকটা DNS রেকর্ড (TXT / CNAME) দেখাবে — সেগুলো ডোমেইনের DNS-এ বসান (Admin → সেটিংস → DNS পেজ থাকলে সেখান থেকে, নইলে ডোমেইন কোম্পানির প্যানেলে)। "Authenticate" সবুজ হলে ইমেইল স্প্যামে কম যায়।</li><li><b>Senders</b>-এ একটা ঠিকানা যোগ করুন, যেমন{' '}<code>offer@shobmilbe.com</code>{' '}(ডোমেইন যাচাই হলে এটা আলাদা করে যাচাই লাগে না)।</li><li>Brevo →{' '}<b>{"SMTP & API → API Keys"}</b>{' '}→ "Generate a new API key" → কপি করে নিচের ঘরে দিন, প্রেরকের ঠিকানা দিন, "ইমেইল মার্কেটিং চালু" করে সেভ দিন।</li><li>"পরীক্ষামূলক ইমেইল" পাঠিয়ে নিজের ইনবক্সে দেখুন। তারপর সব নিজে থেকে চলবে — আপনাকে আর কিছু করতে হবে না।</li></ol><p className="small muted">শুধু ইমেইলের আইনসম্মত নিয়ম: যারা নিজে রাজি হয়েছেন শুধু তাদের পাঠানো হয়। প্রতিটা ইমেইলের নিচে "আনসাবস্ক্রাইব" থাকে, আর ৩ বার না-যাওয়া ঠিকানা নিজে থেকে তালিকা থেকে বাদ যায় — এতে দোকানের নাম স্প্যাম তালিকায় ওঠে না।</p></>)}<div className="two-col"><section className="panel"><h2>⚙️ সেটআপ</h2>{(canSetup ? <form method="post" action={attrValue(BASE)} className="form"><input type="hidden" name="action" defaultValue="setup" />{' '}{ui.switchRow('email_mkt_on', s.email_mkt_on === '1', 'ইমেইল মার্কেটিং চালু', 'বন্ধ থাকলে কোনো অফার/অটো ইমেইল যাবে না, ফুটারের বক্সও দেখাবে না। অর্ডারের ইমেইল আর কোড আগের মতোই যাবে।')}{' '}{ui.field('কী দিয়ে পাঠাবে', ui.select('email_mkt_provider', [['brevo', 'Brevo (সুপারিশ — দিনে ৩০০ ফ্রি)'], ['gmail', `দোকানের Gmail (ছোট তালিকা — দিনে সর্বোচ্চ ${M.MAX_GMAIL_DAY})`]], c.provider))}{' '}{ui.field('Brevo API Key', secretInput('brevo_api_key', s.brevo_api_key, { maxlength: 200 }), 'Brevo → SMTP & API → API Keys')}<div className="field-row">{ui.field('প্রেরকের ঠিকানা', ui.input('email_mkt_from', s.email_mkt_from || '', { type: 'email', maxlength: 120, placeholder: 'offer@shobmilbe.com' }), 'Brevo-তে যাচাই করা ঠিকানা')}{' '}{ui.field('প্রেরকের নাম', ui.input('email_mkt_from_name', s.email_mkt_from_name || '', { maxlength: 60, placeholder: s.store_name || 'সবমিলবে' }))}</div>{ui.field('দিনে সর্বোচ্চ কয়টা ইমেইল', ui.input('email_mkt_day', s.email_mkt_day || '280', { type: 'number', min: 1, max: 100000, class: 'w-num' }), 'Brevo ফ্রি = ৩০০; ২৮০ রাখলে পরীক্ষার জন্যও জায়গা থাকে')}{' '}{ui.check('email_sub_box', s.email_sub_box !== '0', 'দোকানের ফুটারে "অফারের খবর পেতে ইমেইল দিন" বক্স দেখাও')}{' '}{ui.check('email_co_box', s.email_co_box !== '0', 'চেকআউটে ইমেইলের ঘর আর "অফারের খবর পেতে চাই" টিক দেখাও')}{' '}{(c.provider === 'gmail' && !gmailReady ? <p className="small">⚠️ দোকানের Gmail এখনো সেটআপ নেই —{' '}<a href="/admin/notify">আমার নোটিফিকেশন</a>{' '}পেজে একবার সেটআপ করুন।</p> : null)}{' '}<button className="btn">সেভ করুন</button></form> : <p className="muted">সেটআপ বদলাতে সেটিংসের অনুমতি লাগে। মালিককে বলুন।</p>)}<h2>🧪 পরীক্ষামূলক ইমেইল</h2><form method="post" action={attrValue(BASE)} className="form"><input type="hidden" name="action" defaultValue="test" />{' '}{ui.field('কোন ঠিকানায়', ui.input('to', notify.emailConfig(s).to, { type: 'email', required: true, maxlength: 120 }))}<div className="row-actions"><button className="btn btn-ghost">পাঠিয়ে দেখুন</button>{' '}<a className="btn btn-ghost" href={`${attrValue(BASE)}/preview`} target="_blank" rel="noopener">👁️ দেখতে কেমন</a></div></form></section><section className="panel"><h2>🤖 নিজে থেকে যাওয়া ইমেইল</h2><form method="post" action={attrValue(BASE)} className="form"><input type="hidden" name="action" defaultValue="auto" />{' '}{ui.switchRow('email_auto_welcome', s.email_auto_welcome !== '0', '👋 স্বাগতম', 'কেউ তালিকায় যোগ দিলে — জনপ্রিয় ৪টা পণ্যসহ।')}{' '}{ui.field('স্বাগতম ইমেইলের লেখা (খালি = তৈরি লেখা)', ui.textarea('email_welcome_text', s.email_welcome_text || '', { rows: 3, maxlength: 2000, placeholder: '{name}, সবমিলবে-তে আপনাকে স্বাগতম!…' }), '{name} = গ্রাহকের নাম। ফাঁকা লাইন দিলে নতুন অনুচ্ছেদ।')}{' '}{ui.switchRow('email_auto_weekly', s.email_auto_weekly !== '0', '🆕 সাপ্তাহিক নতুন পণ্য', 'সপ্তাহে একবার এই সপ্তাহের নতুন পণ্য (নতুন না থাকলে জনপ্রিয় পণ্য) — নিচের দিন আর সময়ে।')}<div className="field-row">{ui.field('কোন দিন', ui.select('email_weekly_day', DAYS, String(s.email_weekly_day ?? '5')))}{' '}{ui.field('কয়টার পর (০–২৩)', ui.input('email_weekly_hour', s.email_weekly_hour || '10', { type: 'number', min: 0, max: 23, class: 'w-num' }), 'বাংলাদেশ সময়')}</div>{ui.switchRow('email_auto_review', s.email_auto_review !== '0', '⭐ রিভিউ চাওয়া', 'ডেলিভারির ২ দিন পর, যিনি চেকআউটে ইমেইল দিয়ে টিক দিয়েছেন তাকে — একবারই।')}{' '}{ui.switchRow('email_auto_winback', s.email_auto_winback !== '0', '😴 আবার আসুন', 'অনেক দিন কেনেননি এমন ক্রেতাকে নতুন পণ্যসহ — ৯০ দিনে একবারের বেশি নয়।')}<div className="field-row">{ui.field('কত দিন না কিনলে', ui.input('email_winback_days', s.email_winback_days || '60', { type: 'number', min: 20, max: 365, class: 'w-num' }))}</div>{ui.field('"আবার আসুন" ইমেইলের লেখা (খালি = তৈরি লেখা)', ui.textarea('email_winback_text', s.email_winback_text || '', { rows: 3, maxlength: 2000 }))}{' '}<button className="btn">সেভ করুন</button></form></section></div><section className="panel"><h2>📣 নতুন ক্যাম্পেইন (অফার / নোটিশ)</h2><form method="post" action={attrValue(BASE)} className="form" data-confirm="বাছাই করা সবার কাছে ইমেইলটা যাবে (দিনের সীমার মধ্যে, বাকিরা পরের দিন)। পাঠাবেন?"><input type="hidden" name="action" defaultValue="campaign" /><div className="field-row">{ui.field('বিষয় (Subject)', ui.input('subject', '', { required: true, maxlength: 150, placeholder: '⚡ শুক্রবার সব মডিউলে ১০% ছাড় — কোড FRI10' }))}{' '}{ui.field('কাদের', ui.select('audience', audOptions, 'all'))}</div>{ui.field('লেখা', ui.textarea('intro', '', { rows: 5, required: true, maxlength: 4000, placeholder: '{name}, এই শুক্রবার দোকানের সব মডিউলে ১০% ছাড়! চেকআউটে FRI10 কোড দিন।\n\nঅফার শুধু শুক্রবার রাত ১২টা পর্যন্ত।' }), '{name} = গ্রাহকের নাম। ফাঁকা লাইন = নতুন অনুচ্ছেদ।')}{' '}{ui.field('পণ্য (SKU, পণ্যের ID বা লিংক — কমা দিয়ে, সর্বোচ্চ ১২টা)', ui.input('products', '', { maxlength: 2000, placeholder: '1023, 1045, https://shobmilbe.com/p/arduino-uno' }), 'খালি রাখলে সবশেষে যোগ করা ৬টা পণ্য বসবে। "কোনো পণ্য নয়" চাইলে লিখুন: 0')}<div className="field-row">{ui.field('বাটনের লেখা', ui.input('button_text', 'এখনই কিনুন', { maxlength: 40 }))}{' '}{ui.field('বাটনের লিংক', ui.input('button_path', '/', { maxlength: 300, placeholder: '/category/modules' }), 'দোকানের ভেতরের যেকোনো পেজ')}</div><div className="row-actions"><button className="btn" name="go" value="1">📨 পাঠান</button><button className="btn btn-ghost" name="go" value="0" formNoValidate>আগে কতজন দেখি</button></div></form></section>{(camps.length ? <section className="panel table-wrap"><h2>📊 ক্যাম্পেইন</h2><table className="table compact"><thead><tr><th>কবে</th><th>বিষয়</th><th>কাদের</th><th className="num">গেছে</th><th className="num">খুলেছে</th><th className="num">ক্লিক</th><th>অবস্থা</th></tr></thead><tbody>{jsxList(camps.map((x) => <tr><td className="small nowrap">{fmtDate(x.created_at)}<br /><span className="muted">{(x.kind === 'weekly' ? "🤖 সাপ্তাহিক" : <Val v={x.staff_name || ''} />)}</span></td><td className="small"><Val v={x.subject} /></td><td className="small"><Val v={M.AUDIENCES[x.audience] || (M.isXl(x.audience) ? `📥 ${x.audience.slice(3)}` : x.audience)} /></td><td className="num">{bn(x.sent)}{(x.total ? <span className="muted small">{' '}/{' '}{bn(x.total)}</span> : null)}{(x.failed ? <><br /><span className="small muted">{bn(x.failed)}টি যায়নি</span></> : null)}</td><td className="num">{bn(x.opened)}{' '}<span className="muted small"><Val v={pct(x.opened, x.sent)} /></span></td><td className="num">{bn(x.clicked)}{' '}<span className="muted small"><Val v={pct(x.clicked, x.sent)} /></span></td><td className="small">{(x.status === 'sending' ? <>⏳ যাচ্ছে<form method="post" action={attrValue(BASE)} data-confirm="এই ক্যাম্পেইনের বাকি ইমেইল আর যাবে না। থামাবেন?"><input type="hidden" name="action" defaultValue="stop" /><input type="hidden" name="id" defaultValue={attrValue(x.id)} /><button className="btn btn-sm btn-ghost">⏹ থামান</button></form></> : (x.status === 'stopped' ? "⏹ থামানো" : "✅ শেষ"))}</td></tr>))}</tbody></table></section> : null)}<section className="panel"><h2>👥 তালিকা ({bn(st!.subs)}{' '}জন)</h2><div className="two-col"><form method="post" action={attrValue(BASE)} className="form"><input type="hidden" name="action" defaultValue="add" />{' '}{ui.field('ইমেইল যোগ করুন (একাধিক হলে কমা বা নতুন লাইনে)', ui.textarea('emails', '', { rows: 3, maxlength: 20000, placeholder: 'rahim@gmail.com\nkarim@yahoo.com' }), 'শুধু যারা অফারের ইমেইল পেতে রাজি হয়েছেন তাদের যোগ করুন। যারা আগে নিজে বাদ গেছেন, তারা আবার যোগ হবেন না।')}{' '}<button className="btn btn-ghost">যোগ করুন</button></form><div><form method="get" action={attrValue(BASE)} className="form">{ui.field('খুঁজুন', ui.input('q', q, { maxlength: 80, placeholder: 'ইমেইল, নাম বা নম্বর' }))}<button className="btn btn-ghost btn-sm">খুঁজুন</button></form><form method="post" action={`${attrValue(BASE)}/subs.csv`}><button className="btn btn-ghost btn-sm">⬇️ পুরো তালিকা (CSV)</button></form></div></div>{(subs.length ? <div className="table-wrap"><table className="table compact"><thead><tr><th>ইমেইল</th><th>নাম / নম্বর</th><th>কোথা থেকে</th><th>কবে</th><th>অবস্থা</th></tr></thead><tbody>{jsxList(subs.map((x) => <tr className={x.on_list ? '' : 'row-muted'}><td className="small mono"><Val v={x.email} /></td><td className="small"><Val v={x.name} />{(x.phone ? <><br /><span className="muted"><Val v={x.phone} /></span></> : null)}</td><td className="small"><Val v={({ footer: 'ফুটার', checkout: 'চেকআউট', admin: 'হাতে যোগ', popup: 'পপআপ' } as Record<string, string>)[x.source] || x.source} /></td><td className="small nowrap">{fmtDate(x.created_at, false)}</td><td className="small"><form method="post" action={attrValue(BASE)}><input type="hidden" name="action" defaultValue="toggle" /><input type="hidden" name="id" defaultValue={attrValue(x.id)} />{' '}{(x.on_list ? <>✅ আছেন{' '}<button className="btn btn-sm btn-ghost">বাদ দিন</button></> : <>🚫{' '}{(x.unsub_at ? "নিজে চলে গেছেন" : "বাদ")}{(x.unsub_at ? null : <>{' '}<button className="btn btn-sm btn-ghost">আবার যোগ</button></>)}</>)}</form></td></tr>))}</tbody></table></div> : <p className="muted">{(q ? "কাউকে পাওয়া যায়নি।" : "এখনো কেউ যোগ দেননি। ইমেইল মার্কেটিং চালু করলে ফুটার আর চেকআউট থেকে নিজে থেকে যোগ হবে।")}</p>)}</section><section className="panel"><h2>🗒️ শেষ ৩০টি ইমেইল</h2>{(log.length ? <div className="table-wrap"><table className="table compact"><thead><tr><th>সময়</th><th>কাকে</th><th>কী</th><th>ফল</th></tr></thead><tbody>{jsxList(log.map((l) => <tr className={l.ok ? '' : 'row-warn'}><td className="small nowrap">{fmtDate(l.created_at)}</td><td className="small mono"><Val v={l.email} /></td><td className="small"><Val v={M.KINDS[l.kind] || l.kind} />{(l.opened_at ? " · 👁️" : null)}{(l.clicked_at ? " · 👆" : null)}</td><td className="small">{(l.ok ? "✅" : "❌")}{' '}<Val v={l.detail} /></td></tr>))}</tbody></table></div> : <p className="muted">এখনো কোনো ইমেইল যায়নি।</p>)}</section></>;
  return ctx.page('ইমেইল মার্কেটিং', body, 'email');
}

async function post(ctx: AdminCtx) {
  const b = await ctx.body();
  const s = ctx.settings;
  if (b.action === 'setup') {
    if (!ctx.can('settings')) return ctx.back(BASE, 'noperm');
    const v: Record<string, unknown> = {
      email_mkt_on: b.email_mkt_on ? '1' : '0', email_mkt_provider: b.email_mkt_provider === 'gmail' ? 'gmail' : 'brevo',
      email_mkt_from: notify.validEmail(str(b.email_mkt_from, 120)) ? str(b.email_mkt_from, 120) : '', email_mkt_from_name: str(b.email_mkt_from_name, 60),
      email_mkt_day: String(Math.max(1, Math.min(100000, int(b.email_mkt_day, 280)))),
      email_sub_box: b.email_sub_box ? '1' : '0', email_co_box: b.email_co_box ? '1' : '0',
    };
    const key = str(b.brevo_api_key, 200);
    if (key && !/^•+$/.test(key)) {
      if (!/^xkeysib-[A-Za-z0-9-]{20,}$/.test(key)) return ctx.fail(BASE, 'এটা Brevo-র API Key মনে হচ্ছে না (শুরু হয় xkeysib- দিয়ে)। SMTP & API → API Keys থেকে কপি করুন — SMTP key নয়।');
      v.brevo_api_key = key;
    }
    if (v.email_mkt_provider === 'brevo' && v.email_mkt_on === '1' && !v.email_mkt_from) return ctx.fail(BASE, 'Brevo-তে যাচাই করা প্রেরকের ঠিকানা দিন (যেমন offer@shobmilbe.com)।');
    await db.setMany(v);
    await ctx.reloadSettings();
    await ctx.log('settings', 'settings', null, `ইমেইল মার্কেটিং: ${v.email_mkt_on === '1' ? 'চালু' : 'বন্ধ'}, ${v.email_mkt_provider}${v.brevo_api_key ? ', নতুন Brevo key' : ''}`);
    return ctx.back(BASE, 'saved');
  }
  if (b.action === 'auto') {
    await db.setMany({
      email_auto_welcome: b.email_auto_welcome ? '1' : '0', email_welcome_text: str(b.email_welcome_text, 2000),
      email_auto_weekly: b.email_auto_weekly ? '1' : '0', email_weekly_day: String(Math.max(0, Math.min(6, int(b.email_weekly_day, 5)))),
      email_weekly_hour: String(Math.max(0, Math.min(23, int(b.email_weekly_hour, 10)))),
      email_auto_review: b.email_auto_review ? '1' : '0', email_auto_winback: b.email_auto_winback ? '1' : '0',
      email_winback_days: String(Math.max(20, Math.min(365, int(b.email_winback_days, 60)))), email_winback_text: str(b.email_winback_text, 2000),
    });
    await ctx.log('settings', 'marketing', null, 'অটো ইমেইলের সুইচ/লেখা বদল');
    return ctx.back(BASE, 'saved');
  }
  if (b.action === 'test') {
    const to = str(b.to, 120);
    if (!notify.validEmail(to)) return ctx.fail(BASE, 'সঠিক ইমেইল ঠিকানা দিন।');
    if (!(await $security.hit(db, 'mailtest:' + ctx.user.id, 10, 3600))) return ctx.fail(BASE, 'এক ঘণ্টায় অনেক পরীক্ষা হয়েছে, একটু পরে চেষ্টা করুন।');
    const sub = (await db.one<M.Subscriber>('SELECT * FROM email_subs WHERE lower(email)=lower($1)', [to])) || { id: null, email: to, name: ctx.user.name || '', token: 'test-link-not-a-real-unsubscribe' };
    const r = await M.sendOne(s, sub, { kind: 'test', subject: `🧪 ${s.store_name || 'সবমিলবে'}: পরীক্ষামূলক ইমেইল`, heading: 'পরীক্ষামূলক ইমেইল',
      intro: '{name}, এটা দোকানের ইমেইল মার্কেটিং-এর পরীক্ষা। এটা ইনবক্সে এলে সব ঠিক আছে। স্প্যাম বা Promotions ফোল্ডারে গেলে Brevo-তে ডোমেইন যাচাই (DNS) সম্পূর্ণ করুন।',
      productIds: await newest(4), button: { text: 'দোকানে যান', path: '/' } });
    return page({ ...ctx, method: 'GET' }, r.ok ? { text: `✅ ${to} ঠিকানায় পাঠানো হয়েছে (${r.msg})। ইনবক্স দেখুন — না পেলে Spam/Promotions ফোল্ডারও দেখুন।` } : { type: 'error', text: `❌ যায়নি: ${r.msg}` });
  }
  if (b.action === 'campaign') {
    const subject = str(b.subject, 150);
    const intro = str(b.intro, 4000);
    const audience = M.isXl(b.audience) ? String(b.audience) : ifKey(M.AUDIENCES, b.audience, 'all');
    const n = await M.audienceCount(audience);
    if (b.go !== '1') return page({ ...ctx, method: 'GET' }, { text: `এই বাছাইয়ে তালিকার ${bn(n)} জন আছেন। আজ আর ${bn(await M.leftToday(s))}টি ইমেইল পাঠানো যাবে — বাকিরা পরের দিনগুলোতে নিজে থেকে পাবেন।` });
    if (!subject || !intro) return ctx.fail(BASE, 'বিষয় আর লেখা দুটোই দিন।');
    const c = M.cfg(s);
    if (!c.on || !c.ready) return ctx.fail(BASE, `ইমেইল মার্কেটিং চালু নেই: ${c.on ? c.why : 'উপরে "ইমেইল মার্কেটিং চালু" করুন'}`);
    if (!n) return ctx.fail(BASE, 'এই বাছাইয়ে তালিকায় কেউ নেই।');
    const raw0 = str(b.products, 2000);
    const productIds = raw0 === '0' ? [] : raw0 ? await resolveProducts(raw0) : await newest(6);
    if (raw0 && raw0 !== '0' && !productIds.length) return ctx.fail(BASE, 'দেওয়া SKU / লিংকের কোনো চালু পণ্য পাওয়া যায়নি।');
    const camp = await M.createCampaign(s, { subject, intro, productIds, buttonText: str(b.button_text, 40), buttonPath: M.safePath(b.button_path, s), audience, staffId: ctx.user.id });
    await ctx.log('settings', 'marketing', null, `ইমেইল ক্যাম্পেইন: "${subject.slice(0, 80)}" — ${n} জন`);
    // the first part goes right now (a minute at most); the rest goes with the hourly job, within the day's allowance
    const sent = await M.runCampaigns(s, Math.min(40, await M.leftToday(s))).catch(() => 0);
    const after = await db.one<Pick<EmailCampaignsRow, 'sent' | 'failed'>>('SELECT sent, failed FROM email_campaigns WHERE id=$1', [camp!.id]);
    if (after!.failed && !after!.sent) {
      const why = await db.one<Pick<EmailLogRow, 'detail'>>('SELECT detail FROM email_log WHERE campaign_id=$1 AND NOT ok ORDER BY id DESC LIMIT 1', [camp!.id]);
      return ctx.fail(BASE, `❌ একটাও যায়নি: ${why ? why.detail : ''}`);
    }
    return ctx.back(`${BASE}?info=${encodeURIComponent(`✅ ক্যাম্পেইন শুরু হয়েছে — এখনই ${bn(after!.sent)} জনকে গেছে${sent < n ? `, বাকি ${bn(Math.max(0, n - after!.sent - after!.failed))} জন দিনের সীমার মধ্যে নিজে থেকে পাবেন` : ''}।`)}`);
  }
  if (b.action === 'stop') {
    await db.q("UPDATE email_campaigns SET status='stopped', finished_at=now(), updated_at=now() WHERE id=$1 AND status='sending'", [int(b.id)]);
    await ctx.log('settings', 'marketing', int(b.id), 'ইমেইল ক্যাম্পেইন থামানো হলো');
    return ctx.back(BASE, 'saved');
  }
  if (b.action === 'add') {
    const list = [...new Set(String(b.emails || '').split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter((e) => notify.validEmail(e)))].slice(0, 2000);
    if (!list.length) return ctx.fail(BASE, 'সঠিক ইমেইল ঠিকানা দিন।');
    let added = 0;
    for (const e of list) { const r = await M.addSub(e, { source: 'admin', explicit: false }); if (r && r.fresh) added++; }
    await ctx.log('settings', 'marketing', null, `ইমেইল তালিকায় হাতে যোগ: ${added} জন`);
    return ctx.back(`${BASE}?info=${encodeURIComponent(`✅ ${bn(added)} জন নতুন যোগ হলেন${list.length - added ? ` (${bn(list.length - added)} জন আগে থেকেই ছিলেন)` : ''}।`)}`);
  }
  if (b.action === 'toggle') {
    // someone who left by themselves is never put back by staff — only they can rejoin (from the footer / their mail)
    await db.q(`UPDATE email_subs SET on_list = CASE WHEN on_list THEN false WHEN unsub_at IS NULL THEN true ELSE false END, fails = 0 WHERE id=$1`, [int(b.id)]);
    await ctx.log('settings', 'marketing', int(b.id), 'ইমেইল তালিকায় একজনের অবস্থা বদল');
    return ctx.back(BASE, 'saved');
  }
  return ctx.redirect(BASE);
}

// what a mail looks like (the newest 4 products), opened in a new tab
async function preview(ctx: AdminCtx) {
  const s = ctx.settings;
  const products: unknown[] = [];
  for (const id of await newest(4)) products.push(id);
  const sub = { email: 'test@example.com', name: ctx.user.name || 'রহিম', token: 'preview' };
  const utm = 'utm_source=email';
  const { layout } = M;
  const cards = await (async () => {
    // reuse the real layout (no open/click counters in a preview)
    const rows = await db.q<{ id: number; name: string; slug: string; price: number; old_price: number | null; image_id: number | null; ik_url: string | null }>(`SELECT p.id, p.name, p.slug, p.price, p.old_price, p.image_id, m.ik_url FROM products p LEFT JOIN media m ON m.id=p.image_id WHERE p.id = ANY($1::int[])`, [products]);
    return rows.map((p) => ({ ...p, img: p.ik_url ? `${p.ik_url}${p.ik_url.includes('?') ? '&' : '?'}tr=f-jpg,w-400` : p.image_id ? `/media/${p.image_id}/t` : '', path: `/p/${encodeURIComponent(p.slug)}` }));
  })();
  const out = await layout(s, { logId: null, sub, heading: 'ইমেইল দেখতে এমন হবে', intro: '{name}, এটা একটা নমুনা। ক্যাম্পেইনে আপনার লেখা এখানে বসবে।\n\nনিচে পণ্যগুলো এভাবে দেখাবে।', products: cards, button: { text: 'এখনই কিনুন', path: '/' }, utm });
  return ctx.send(200, out, 'text/html; charset=utf-8', { 'Content-Security-Policy': "sandbox; default-src 'none'; img-src https: http: data: 'self'; style-src 'unsafe-inline'" });
}

async function subsCsv(ctx: AdminCtx) {
  const rows = await db.q<Pick<EmailSubsRow, 'email' | 'name' | 'phone' | 'source' | 'on_list' | 'created_at' | 'unsub_at'>>('SELECT email, name, phone, source, on_list, created_at, unsub_at FROM email_subs ORDER BY id');
  const esc = (v?: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = 'email,name,phone,source,subscribed,joined,left\n' + rows.map((r) => [r.email, r.name, r.phone, r.source, r.on_list ? 'yes' : 'no',
    r.created_at ? new Date(r.created_at).toISOString().slice(0, 10) : '', r.unsub_at ? new Date(r.unsub_at).toISOString().slice(0, 10) : ''].map(esc).join(',')).join('\n');
  await ctx.log('export', 'marketing', null, `ইমেইল তালিকা ডাউনলোড (${rows.length} জন)`);
  return ctx.reply.answer(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="shobmilbe-email-list.csv"', 'Cache-Control': 'no-store' }, '﻿' + csv);
}

export const routes = [
    { method: 'GET', path: BASE, perm: 'marketing', handler: (ctx: AdminCtx) => page(ctx) },
    { method: 'POST', path: BASE, perm: 'marketing', handler: post },
    { method: 'GET', path: `${BASE}/preview`, perm: 'marketing', handler: preview },
    { method: 'POST', path: `${BASE}/subs.csv`, perm: 'owner', handler: subsCsv },
  ];
export const _ = { resolveProducts };
