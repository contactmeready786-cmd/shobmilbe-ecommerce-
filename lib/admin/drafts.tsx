// Admin → অর্ডার ও কাস্টমার → অসম্পূর্ণ অর্ডার
// Shoppers who typed their mobile number at checkout but never pressed "অর্ডার কনফার্ম".
// Call them, turn the cart into an order in one tap, or drop it. The whole feature has an on/off switch at the top.
import { Val, attrValue, jsxList } from '../react/html';
import { bn, money, fmtDate, str, int, pageNum } from '../util';
import * as db from '../db';
import * as D from '../services/drafts';
import * as ui from './ui';
import * as $services_sms from '../services/sms';
import type { AdminCtx, Id, Loose, RouteMatch } from '../types';

const BASE = '/admin/orders/incomplete';
const PER_PAGE = 50;

function ago(d: string | number | Date) {
  const s = Math.max(0, Math.round((Date.now() - new Date(d).getTime()) / 1000));
  if (s < 60) return 'এইমাত্র';
  if (s < 3600) return bn(Math.floor(s / 60)) + ' মিনিট আগে';
  if (s < 86400) return bn(Math.floor(s / 3600)) + ' ঘণ্টা আগে';
  return bn(Math.floor(s / 86400)) + ' দিন আগে';
}
function waLink(phone?: unknown) { return 'https://wa.me/88' + String(phone || '').replace(/\D/g, ''); }

function statusPill(d: db.pg.DbRow) {
  const st = D.STATUSES[d.status] || ['', d.status];
  const cls = (({ open: 'pill-amber', called: 'pill-blue', ordered: 'pill-green', closed: 'pill-grey' } as Record<string, string>))[d.status] || '';
  return <span className={`pill ${attrValue(cls)}`}><Val v={st[0]} />{' '}<Val v={st[1]} /></span>;
}
function actButton(id?: Id, status?: unknown, label?: unknown, cls = 'btn-ghost') {
  return <form method="post" action={`${attrValue(BASE)}/${attrValue(id)}/status`}><input type="hidden" name="status" defaultValue={attrValue(status)} /><button className={`btn btn-sm ${attrValue(cls)}`}><Val v={label} /></button></form>;
}

async function listPage(ctx: AdminCtx) {
  const s0 = ctx.settings;
  if (ctx.method === 'POST') {
    const b = await ctx.body();
    if (!ctx.can('settings') && ctx.user.role !== 'owner') return ctx.back(BASE, 'noperm');
    const tpl = str(b.draft_sms_tpl, 300).trim();
    if (b.draft_sms_on === '1' && !tpl.includes('{link}')) return ctx.fail(BASE, 'SMS-এর লেখায় {link} অবশ্যই রাখুন — ওটা চাপলেই কাস্টমার অর্ডার শেষ করতে পারবে।');
    if (b.draft_sms_on === '1' && !$services_sms.ready(s0).ok) return ctx.fail(BASE, `আগে SMS চালু করুন (মার্কেটিং → কাস্টমারকে SMS)। এখন: ${$services_sms.ready(s0).why}।`);
    await db.setMany({
      draft_capture_on: b.draft_capture_on === '1' ? '1' : '0',
      draft_sms_on: b.draft_sms_on === '1' ? '1' : '0',
      draft_sms_after: String([30, 60, 120, 180, 360].includes(int(b.draft_sms_after)) ? int(b.draft_sms_after) : 60),
      ...(tpl ? { draft_sms_tpl: tpl } : {}),
    });
    await ctx.log('settings', 'settings', null, `অসম্পূর্ণ অর্ডার ${b.draft_capture_on === '1' ? 'চালু' : 'বন্ধ'}, অটো SMS ${b.draft_sms_on === '1' ? 'চালু' : 'বন্ধ'}`);
    return ctx.back(BASE, 'saved');
  }
  const page = pageNum(ctx.query);
  const status = D.STATUSES[String(ctx.query.get('status'))] || ctx.query.get('status') === 'all' ? ctx.query.get('status')! : 'open';
  const f = { status: status === 'all' ? '' : status, q: str(ctx.query.get('q'), 80) };
  const [rows, total, c] = await Promise.all([D.list(f, { limit: PER_PAGE, offset: (page - 1) * PER_PAGE }), D.count(f), D.counts()]);
  const s = ctx.settings;
  const on = s.draft_capture_on !== '0';
  const n = (k: string) => (c[k] ? c[k].n : 0);
  const tabs = [['open', `🆕 নতুন (${bn(n('open'))})`], ['called', `📞 কল করা হয়েছে (${bn(n('called'))})`], ['ordered', `✅ অর্ডার হয়েছে (${bn(n('ordered'))})`],
    ['closed', `🚫 বাদ (${bn(n('closed'))})`], ['all', `সব (${bn(c.all)})`]];
  const recovered = n('ordered');
  const base = `${BASE}?status=${status}${f.q ? '&q=' + encodeURIComponent(f.q) : ''}`;
  const body = <><div className="title-row"><h1>📝 অসম্পূর্ণ অর্ডার</h1></div>{ui.flash(ctx.flash)}<form method="post" action={attrValue(BASE)} className="panel form">{ui.switchRow('draft_capture_on', on, 'অসম্পূর্ণ অর্ডার ধরা', 'চালু থাকলে: কেউ চেকআউট পেজে পুরো মোবাইল নম্বর লিখে অর্ডার না দিয়ে চলে গেলে, তার নাম, নম্বর, ঠিকানা আর কার্টের পণ্য এখানে আসবে। ফোন নম্বরের ঘরের নিচে কাস্টমারকে ছোট করে জানানোও থাকবে। বন্ধ করলে নতুন করে আর কিছু জমা হবে না (আগেরগুলো থাকবে)।')}{' '}{ui.switchRow('draft_sms_on', s.draft_sms_on === '1', '📩 অটো SMS: অর্ডার শেষ করার কথা মনে করিয়ে দিন', 'চালু থাকলে: কেউ অর্ডার না করে চলে গেলে নিচের সময় পরে তাকে একটা SMS যায় — লিংকে চাপলেই একই পণ্য কার্টে আর নাম-নম্বর বসানো অবস্থায় চেকআউট খোলে। প্রতি অসম্পূর্ণ অর্ডারে একবারই যায়, একই নম্বরে ৩ দিনে একবারের বেশি না, রাত ১০টা থেকে সকাল ৯টা পর্যন্ত যায় না (সকালে যায়), ব্লক লিস্টের নম্বরে যায় না। আপনি আগে কল করে "📞 কল করেছি" দিলে আর SMS যায় না।')}<div className="field-row">{ui.field('কতক্ষণ পরে SMS যাবে', ui.select('draft_sms_after', [['30', '৩০ মিনিট পরে'], ['60', '১ ঘণ্টা পরে (সাজেস্টেড)'], ['120', '২ ঘণ্টা পরে'], ['180', '৩ ঘণ্টা পরে'], ['360', '৬ ঘণ্টা পরে']], s.draft_sms_after || '60'), 'খুব তাড়াতাড়ি দিলে বিরক্ত লাগতে পারে; খুব দেরিতে দিলে কাস্টমার অন্য দোকান থেকে কিনে ফেলে।')}</div>{ui.field('SMS-এর লেখা', ui.textarea('draft_sms_tpl', s.draft_sms_tpl || '', { rows: 2, maxlength: 300 }), <><code>{"{shop}"}</code>{' '}দোকানের নাম,{' '}<code>{"{name}"}</code>{' '}কাস্টমারের নাম,{' '}<code>{"{total}"}</code>{' '}পণ্যের দাম,{' '}<code>{"{link}"}</code>{' '}অর্ডার শেষ করার লিংক (অবশ্যই রাখুন)। লিংকসহ বাংলা SMS সাধারণত ২টা SMS হয়।</>)}{' '}{(s.draft_sms_on === '1' && !$services_sms.ready(s).ok ? <p className="flash flash-error">⚠️ অটো SMS চালু, কিন্তু SMS কাজ করছে না —{' '}<a href="/admin/marketing/sms">কাস্টমারকে SMS</a>{' '}পেজ দেখুন।</p> : null)}{' '}<button className="btn">সেভ করুন</button></form>{ui.helpBox('এটা কীভাবে কাজে লাগাবেন', <ol><li><b>🆕 নতুন</b>{' '}তালিকায় যারা আছে, তাদের ফোন করুন (📞 বা WhatsApp বাটন চাপলেই হবে)। অনেকে দাম, ডেলিভারি চার্জ বা পেমেন্ট নিয়ে দ্বিধায় পড়ে চলে যায়, একটা কল পেলেই অর্ডার করে।</li><li>কাস্টমার রাজি হলে{' '}<b>🧾 অর্ডার বানান</b>{' '}চাপুন — নাম, নম্বর, ঠিকানা আর পণ্য বসানো অবস্থায় নতুন অর্ডারের ফর্ম খুলবে, শুধু সেভ করবেন।</li><li>কল করেও না হলে{' '}<b>📞 কল করেছি</b>{' '}বা{' '}<b>🚫 বাদ দিন</b>{' '}চাপুন, যাতে তালিকা পরিষ্কার থাকে।</li><li>কাস্টমার নিজে পরে অর্ডার করলে সেটা নিজে থেকেই{' '}<b>✅ অর্ডার হয়েছে</b>-তে চলে যায়।</li><li>“এখনো চেকআউটে আছে” লেখা থাকলে ১০ মিনিট অপেক্ষা করুন — হয়তো এখনই অর্ডার দিচ্ছে।</li></ol>)}<div className="kpis">{ui.kpi('কল করার বাকি', bn(n('open')), c.open ? `কার্টে মোট ${money(c.open.value)}` : '', 'kpi-amber', `${BASE}?status=open`)}{' '}{ui.kpi('কল করা হয়েছে', bn(n('called')), '')}{' '}{ui.kpi('পরে অর্ডার করেছে', bn(recovered), c.all ? `${bn(Math.round((100 * recovered) / c.all))}% ফিরে এসেছে` : '', 'kpi-green')}</div><nav className="tabs">{jsxList(tabs.map(([k, l]) => <a className={`tab ${status === k ? 'on' : ''}`} href={`${attrValue(BASE)}?status=${attrValue(k)}`}><Val v={l} /></a>))}</nav><form className="toolbar" method="get" action={attrValue(BASE)}><input type="hidden" name="status" defaultValue={attrValue(status)} />{' '}<input type="search" name="q" defaultValue={attrValue(f.q)} placeholder="নাম, নম্বর, এলাকা বা পণ্য" aria-label="খুঁজুন" />{' '}<button className="btn btn-sm">খুঁজুন</button></form>{(rows.length ? <><div className="table-wrap"><table className="table draft-table"><thead><tr><th>কখন</th><th>কাস্টমার</th><th>ঠিকানা</th><th>কার্টে যা ছিল</th><th>অবস্থা</th><th>কাজ</th></tr></thead><tbody>{jsxList(rows.map((d) => <tr><td><b><Val v={ago(d.updated_at)} /></b><br /><small className="muted">{fmtDate(d.updated_at)}</small>{(d.still_here ? <><br /><span className="pill pill-blue small">⏳ এখনো চেকআউটে আছে</span></> : null)}</td><td translate="no"><b><Val v={d.name || '(নাম লেখেনি)'} /></b><br /><a href={`tel:${attrValue(d.phone)}`} className="mono">📞{' '}<Val v={d.phone} /></a>{' '}·{' '}<a href={attrValue(waLink(d.phone))} target="_blank" rel="noopener">WhatsApp</a>{' '}{(d.customer_id ? <><br /><a className="small" href={`/admin/customers/${attrValue(d.customer_id)}`}>পুরনো কাস্টমার ·{' '}{bn(d.past_orders)}টি অর্ডার</a></> : <><br /><small className="muted">নতুন কাস্টমার</small></>)}</td><td className="small" translate="no">{[d.address, d.thana, d.district].filter(Boolean).join(', ') || <span className="muted">লেখেনি</span>}{(d.note ? <><br /><i>“<Val v={d.note} />”</i></> : null)}</td><td className="small">{((d.items || []).length ? <>{jsxList(d.items.map((i: { name: unknown; qty: unknown; }) => <div><Val v={i.name} />{' '}<span className="muted">×{' '}{bn(i.qty)}</span></div>))}<b>{money(d.subtotal)}</b></> : <span className="muted">—</span>)}</td><td>{statusPill(d)}{(d.order_code ? <><br /><a className="small" href={`/admin/orders?q=${attrValue(d.order_code)}`}>অর্ডার{' '}<Val v={d.order_code} /></a></> : null)}{' '}{(d.reminded_at ? <><br /><span className={`pill ${d.remind_result === 'sent' ? 'pill-blue' : 'pill-warn'} small`} title={attrValue(d.remind_result === 'sent' ? '' : d.remind_result)}>📩{' '}{(d.remind_result === 'sent' ? "SMS গেছে" : "SMS যায়নি")}{' '}·{' '}{fmtDate(d.reminded_at)}</span></> : null)}{' '}{(d.caller_name && d.called_at ? <><br /><small className="muted"><Val v={d.caller_name} />{' '}·{' '}{fmtDate(d.called_at)}</small></> : null)}{' '}{(d.session_id ? <><br /><a className="small" href={`/admin/marketing/visitors/s/${attrValue(d.session_id)}`}>👀 ভিজিট দেখুন</a></> : null)}</td><td className="draft-acts">{(d.status !== 'ordered' && ctx.can('orders_edit') ? <a className="btn btn-sm btn-primary" href={`/admin/orders/new?draft=${attrValue(d.id)}`}>🧾 অর্ডার বানান</a> : null)}{' '}{(d.status === 'open' ? actButton(d.id, 'called', '📞 কল করেছি') : null)}{' '}{(d.status === 'open' || d.status === 'called' ? actButton(d.id, 'closed', '🚫 বাদ দিন') : null)}{' '}{(d.status === 'closed' || d.status === 'called' ? actButton(d.id, 'open', '↩️ আবার নতুনে') : null)}<form method="post" action={`${attrValue(BASE)}/${attrValue(d.id)}/delete`} data-confirm="এটা একেবারে মুছে ফেলবেন?"><button className="link-btn danger small">🗑️ মুছুন</button></form></td></tr>))}</tbody></table></div>{ui.pager(total, page, PER_PAGE, base)}</> : ui.empty(status === 'open' ? (on ? 'এখন কল করার মতো কেউ নেই। কেউ চেকআউটে নম্বর লিখে চলে গেলে এখানে আসবে।' : 'অসম্পূর্ণ অর্ডার ধরা এখন বন্ধ আছে। উপরের সুইচ চালু করুন।') : 'কিছু পাওয়া যায়নি।'))}</>;
  return ctx.page('অসম্পূর্ণ অর্ডার', body, 'drafts');
}

async function statusAction(ctx: AdminCtx, m: RouteMatch) {
  const b = await ctx.body();
  await D.setStatus(m[1], String(b.status || ''), ctx.user.id);
  await ctx.log('draft_status', 'order', null, `${m[1]} → ${str(b.status, 20)}`);
  return ctx.back(BASE + (b.status === 'open' ? '?status=open' : ''), 'status');
}
async function deleteAction(ctx: AdminCtx, m: RouteMatch) {
  await D.remove(m[1]);
  await ctx.log('draft_delete', 'order', null, m[1]);
  return ctx.back(BASE, 'removed');
}

export const routes = [
    { method: '*', path: BASE, perm: 'orders', handler: listPage },
    { method: 'POST', path: /^\/admin\/orders\/incomplete\/([a-f0-9]{20})\/status$/, perm: 'orders', handler: statusAction },
    { method: 'POST', path: /^\/admin\/orders\/incomplete\/([a-f0-9]{20})\/delete$/, perm: 'orders_edit', handler: deleteAction },
  ];
