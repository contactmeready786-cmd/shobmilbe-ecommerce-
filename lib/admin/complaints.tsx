// Admin → অর্ডার ও কাস্টমার → 📮 অভিযোগ (৭২ ঘণ্টা): every complaint with the hours left to solve it (the law asks for
// 72 hours), late ones in red at the top. Open one to see the details and photos, write inside notes or a reply to the
// customer (also by SMS), give it to a staff member, and mark it solved with what was done — all kept as a record.
import { Val, attrValue, jsxList } from '../react/html';
import { bn, fmtDate, int, str, pageNum, oneOf } from '../util';
import * as db from '../db';
import * as ui from './ui';
import * as C from '../models/complaints';
import type { AdminCtx, Loose, RouteMatch } from '../types';
import type { ComplaintsRow, MediaRow, StaffRow } from '../data/rows';

const BASE = '/admin/complaints';
const PER_PAGE = 40;
const PILL: Record<string, string> = { open: 'pill-new', working: 'pill-processing', solved: 'pill-delivered', closed: 'pill-grey' };

function timePill(c: Pick<ComplaintsRow, 'status' | 'due_at' | 'resolved_at'>) {
  const t = C.timeLeft(c);
  if (!t) return c.resolved_at ? <span className="small muted">{(c.resolved_at <= c.due_at ? "✓ সময়মতো" : "⚠️ দেরিতে")}{' '}শেষ</span> : '';
  return <span className={`pill ${t.late ? 'pill-red' : t.soon ? 'pill-amber' : 'pill-green'}`}>⏱️{' '}<Val v={t.text} /></span>;
}

async function listPage(ctx: AdminCtx) {
  const s = ctx.settings;
  if (ctx.method === 'POST') {
    const b = await ctx.body();
    if (!ctx.can('settings')) return ctx.back(BASE, 'noperm');
    await db.setMany({ complaints_on: b.complaints_on ? '1' : '0', complaint_sms_on: b.complaint_sms_on ? '1' : '0',
      complaint_hours: String(Math.max(1, Math.min(72, int(b.complaint_hours, 72)))) });
    await ctx.log('settings', 'settings', null, `অভিযোগ ফর্ম: ${b.complaints_on ? 'চালু' : 'বন্ধ'}`);
    return ctx.back(BASE, 'saved');
  }
  const page = pageNum(ctx.query);
  const want = ctx.query.get('status');
  const status = oneOf(['active', 'late', 'open', 'working', 'solved', 'closed', 'all'], want, 'active');
  const f = { status: status === 'all' ? '' : status, q: str(ctx.query.get('q'), 80) };
  const [rows, total, c] = await Promise.all([C.list(f, { limit: PER_PAGE, offset: (page - 1) * PER_PAGE }), C.count(f), C.counts()]);
  const tabs = [['active', `⏳ চলমান (${bn(c!.active)})`], ['late', `🔴 দেরি (${bn(c!.late)})`], ['solved', `✅ সমাধান (${bn(c!.solved)})`], ['closed', `🚫 বন্ধ (${bn(c!.closed)})`], ['all', `সব (${bn(c!.total)})`]];
  const base = `${BASE}?status=${status}${f.q ? '&q=' + encodeURIComponent(f.q) : ''}`;
  const body = <><div className="title-row"><h1>📮 অভিযোগ ({bn(C.hoursOf(s))}{' '}ঘণ্টায় সমাধান)</h1><div className="row-actions"><a className="btn btn-ghost btn-sm" href={attrValue(base)}>🔄 রিফ্রেশ</a><a className="btn btn-ghost btn-sm" href="/complaint" target="_blank" rel="noopener">কাস্টমারের ফর্ম দেখুন ↗</a></div></div>{ui.flash(ctx.flash)}{' '}{(c!.late ? <p className="flash flash-error"><b>🔴{' '}{bn(c!.late)}টি অভিযোগের সময় পার হয়ে গেছে!</b>{' '}আইন অনুযায়ী ৭২ ঘণ্টার মধ্যে সমাধান করতে হয় — এখনই দেখুন।</p> : null)}<div className="kpis kpis-tight">{ui.kpi('চলমান', bn(c!.active), `নতুন ${bn(c!.open)} · কাজ চলছে ${bn(c!.working)}`, '', `${BASE}?status=active`)}{' '}{ui.kpi('২৪ ঘণ্টার মধ্যে শেষ সময়', bn(c!.soon), 'আগে এগুলো ধরুন', c!.soon ? 'kpi-amber' : '')}{' '}{ui.kpi('সময় পার', bn(c!.late), '', c!.late ? 'kpi-red' : '', `${BASE}?status=late`)}{' '}{ui.kpi('৩০ দিনে সময়মতো সমাধান', c!.done30 ? `${bn(Math.round((c!.ontime30 * 100) / c!.done30))}%` : '—', `${bn(c!.ontime30)} / ${bn(c!.done30)}`)}</div>{ui.helpBox('কীভাবে কাজ করে', <ol className="steps"><li>কাস্টমার দোকানের নিচের{' '}<b>"📮 অভিযোগ জানান"</b>{' '}লিংক (আর অর্ডারের পেজ) থেকে নাম, নম্বর, অর্ডার নম্বর, বিষয়, লেখা আর ছবি দিয়ে অভিযোগ করেন। সাথে সাথে একটা অভিযোগ নম্বর পান (SMS-এও)।</li><li>আপনার ফোনে নোটিফিকেশন আসে (চালু থাকলে ইমেইল/WhatsApp-ও)। এখানে প্রতিটার পাশে কত ঘণ্টা বাকি দেখায় — সবুজ ঠিক আছে, হলুদ ২৪ ঘণ্টার কম বাকি, লাল সময় পার।</li><li>অভিযোগ খুলে{' '}<b>"কাস্টমারকে উত্তর"</b>{' '}লিখলে কাস্টমার SMS পান আর অবস্থার পেজে দেখেন।{' '}<b>"ভেতরের নোট"</b>{' '}শুধু স্টাফরা দেখেন।</li><li>সমাধান হলে{' '}<b>"✅ সমাধান হয়েছে"</b>{' '}দিন, কী করলেন লিখে — কাস্টমার SMS পান। সব রেকর্ড থাকে (আইন অনুযায়ী অন্তত ৬ বছর রাখতে হয়, তাই মুছে ফেলার অপশন নেই)।</li></ol>)}<div className="chips">{jsxList(tabs.map(([k, l]) => <a className={`chip ${status === k ? 'on' : ''}`} href={`${attrValue(BASE)}?status=${attrValue(k)}${f.q ? '&q=' + encodeURIComponent(f.q) : ''}`}><Val v={l} /></a>))}</div><form className="toolbar" method="get" action={attrValue(BASE)}><input type="hidden" name="status" defaultValue={attrValue(status)} />{' '}<input type="search" name="q" defaultValue={attrValue(f.q)} placeholder="অভিযোগ নম্বর, মোবাইল, নাম বা অর্ডার নম্বর" /><button className="btn btn-sm">খুঁজুন</button></form><section className="panel table-wrap">{(rows.length ? <><table className="table"><thead><tr><th>অভিযোগ</th><th>কাস্টমার</th><th>বিষয়</th><th>অবস্থা</th><th>সময়</th><th></th></tr></thead><tbody>{jsxList(rows.map((r) => <tr className={C.timeLeft(r) && C.timeLeft(r)!.late ? 'row-late' : ''}><td><a href={`${attrValue(BASE)}/${attrValue(r.id)}`}><b className="mono"><Val v={r.code} /></b></a><br /><span className="small muted">{fmtDate(r.created_at)}</span></td><td translate="no"><b><Val v={r.name} /></b><br /><a href={`tel:${attrValue(r.phone)}`} className="mono small"><Val v={r.phone} /></a>{(r.order_code ? <><br /><a className="small" href={`/admin/orders?q=${attrValue(r.order_code)}`}>🧾{' '}<Val v={r.order_code} /></a></> : null)}</td><td className="small"><Val v={C.TOPICS[r.topic] || r.topic} />{(r.item_name ? <><br /><b><Val v={r.item_name} /></b></> : null)}{(r.photos && r.photos.length ? <>{' '}<span title="ছবি আছে">📷{bn(r.photos.length)}</span></> : null)}<br /><span className="muted">{String(r.message).slice(0, 80)}{(String(r.message).length > 80 ? "…" : null)}</span></td><td>{ui.pill(C.STATUS[r.status].join(' '), PILL[r.status])}{(r.staff_name ? <><br /><span className="small muted">👤{' '}<Val v={r.staff_name} /></span></> : null)}</td><td>{timePill(r)}</td><td><a className="btn btn-sm" href={`${attrValue(BASE)}/${attrValue(r.id)}`}>খুলুন</a></td></tr>))}</tbody></table>{ui.pager(total, page, PER_PAGE, base)}</> : <p className="muted">{(status === 'active' ? "এখন কোনো চলমান অভিযোগ নেই। 👍" : "এখানে কিছু নেই।")}</p>)}</section>{(ctx.can('settings') ? <section className="panel"><h2>⚙️ সেটিংস</h2><form method="post" action={attrValue(BASE)} className="form">{ui.switchRow('complaints_on', s.complaints_on !== '0', 'কাস্টমারের অভিযোগ ফর্ম চালু', 'দোকানের নিচে (ফুটারে) আর অর্ডারের পেজে "📮 অভিযোগ জানান" লিংক থাকে। আইন অনুযায়ী অভিযোগ জানানোর উপায় রাখা বাধ্যতামূলক — বন্ধ না রাখাই ভালো।')}{' '}{ui.switchRow('complaint_sms_on', s.complaint_sms_on !== '0', 'কাস্টমারকে SMS', 'অভিযোগ জমা হলে অভিযোগ নম্বর, আর সমাধান হলে জানিয়ে SMS যায় (SMS চালু থাকলে)।')}{' '}{ui.field('কত ঘণ্টার মধ্যে সমাধান', ui.input('complaint_hours', s.complaint_hours || '72', { type: 'number', min: 1, max: 72 }), 'আইনে সর্বোচ্চ ৭২ ঘণ্টা। কম দিলে কাস্টমারকেও কম সময়ের কথা বলা হবে। নতুন অভিযোগে কাজ করবে।')}{' '}<button className="btn">সেভ করুন</button></form></section> : null)}</>;
  return ctx.page('অভিযোগ', body, 'complaints');
}

async function detail(ctx: AdminCtx, m: RouteMatch) {
  const id = int(m[1]);
  const c = await C.get(id);
  if (!c) return ctx.redirect(BASE);
  const back = `${BASE}/${id}`;
  if (ctx.method === 'POST') {
    const b = await ctx.body();
    try {
      if (b.action === 'note' || b.action === 'reply') {
        const r = await C.addNote(id, { staffId: ctx.user.id, body: b.body, toCustomer: b.action === 'reply', settings: ctx.settings });
        await ctx.log('complaint_note', 'complaint', id, `${c.code}: ${b.action === 'reply' ? 'কাস্টমারকে উত্তর' : 'নোট'}`);
        if (b.action === 'reply' && r.smsOk === false) return ctx.fail(back, 'উত্তর সেভ হয়েছে, কিন্তু SMS যায়নি — কাস্টমারকে কল করে জানান।');
        return ctx.back(back, 'saved');
      }
      if (C.STATUS[b.action]) {
        await C.setStatus(id, { status: b.action, resolution: b.resolution, staffId: ctx.user.id, settings: ctx.settings });
        await ctx.log('complaint_status', 'complaint', id, `${c.code}: ${C.STATUS[b.action][1]}`);
        return ctx.back(back, 'status');
      }
      if (b.action === 'assign') {
        await C.assign(id, b.staff_id);
        return ctx.back(back, 'saved');
      }
    } catch (e) {
      if (!(e instanceof C.ComplaintError)) throw e;
      return ctx.fail(back, e.message);
    }
    return ctx.back(back);
  }
  const staff = await db.q('SELECT id, name FROM staff WHERE active ORDER BY name').catch(() => []);
  const open = C.OPEN.includes(c.status);
  const body = <><p className="crumbs"><a href={attrValue(BASE)}>← সব অভিযোগ</a></p><div className="title-row"><h1>অভিযোগ{' '}<span className="mono"><Val v={c.code} /></span>{' '}{ui.pill(C.STATUS[c.status].join(' '), PILL[c.status])}{' '}{timePill(c)}</h1><div className="row-actions">{(c.order_code ? <a className="btn btn-ghost btn-sm" href={`/admin/orders?q=${attrValue(c.order_code)}`}>🧾 অর্ডার{' '}<Val v={c.order_code} /></a> : null)}<a className="btn btn-ghost btn-sm" href={attrValue(back)}>🔄 রিফ্রেশ</a></div></div>{ui.flash(ctx.flash)}<div className="two-col"><div><section className="panel"><h2><Val v={C.TOPICS[c.topic] || c.topic} /></h2><p translate="no"><b><Val v={c.name} /></b>{' '}·{' '}<a href={`tel:${attrValue(c.phone)}`} className="mono">📞{' '}<Val v={c.phone} /></a>{' '}·{' '}<a href={`https://wa.me/88${attrValue(c.phone)}`} target="_blank" rel="noopener">WhatsApp</a>{(c.email ? <>{' '}·{' '}<Val v={c.email} /></> : null)}</p><p className="small muted">জমা:{' '}{fmtDate(c.created_at)}{' '}· শেষ সময়:{' '}<b>{fmtDate(c.due_at)}</b>{(c.first_reply_at ? <>{' '}· প্রথম উত্তর:{' '}{fmtDate(c.first_reply_at)}</> : null)}</p>{(c.topic === 'warranty' || c.item_name ? <p className="flash">🛡️{' '}<b>ওয়ারেন্টি দাবি:</b>{' '}{(c.product_id ? <a href={`/admin/products/${attrValue(c.product_id)}`}><Val v={c.item_name} /></a> : <Val v={c.item_name} />)}{(c.warranty_until ? <>{' '}· ওয়ারেন্টি{' '}{fmtDate(c.warranty_until, false)}{' '}পর্যন্ত (ঠিক আছে)</> : null)}</p> : null)}<p className="pre"><Val v={c.message} /></p>{(c.photos && c.photos.length ? <div className="ret-photos">{jsxList(c.photos.map((pid: unknown) => <a href={`${attrValue(BASE)}/photo/${attrValue(pid)}`} target="_blank" rel="noopener"><img src={`${attrValue(BASE)}/photo/${attrValue(pid)}`} alt="অভিযোগের ছবি" loading="lazy" /></a>))}</div> : null)}{' '}{(c.resolution ? <p className="flash"><b>সমাধান:</b>{' '}<Val v={c.resolution} /></p> : null)}</section><section className="panel"><h2>💬 কথোপকথন ও নোট</h2>{(c.notes.length ? <ul className="timeline">{jsxList(c.notes.map((n: Loose) => <li><b><Val v={n.staff_name || 'সিস্টেম'} /></b>{' '}·{' '}{(n.to_customer ? <span className="pill pill-blue">কাস্টমারকে উত্তর{(n.sms_ok === true ? " · SMS গেছে" : (n.sms_ok === false ? " · SMS যায়নি" : null))}</span> : <span className="pill pill-grey">ভেতরের নোট</span>)}<p className="pre"><Val v={n.body} /></p><span className="small muted">{fmtDate(n.created_at)}</span></li>))}</ul> : <p className="muted">এখনো কিছু লেখা হয়নি।</p>)}{' '}{(ctx.can('orders_edit') ? <form method="post" action={attrValue(back)} className="form">{ui.field('লিখুন', ui.textarea('body', '', { rows: 3, maxlength: 1000, required: true }), 'কাস্টমারকে উত্তর দিলে তিনি SMS পান আর অভিযোগের অবস্থার পেজে দেখেন।')}<div className="row-actions"><button className="btn" name="action" value="reply">📨 কাস্টমারকে উত্তর পাঠান</button><button className="btn btn-ghost" name="action" value="note">📝 ভেতরের নোট (শুধু স্টাফ)</button></div></form> : null)}</section></div><div>{(ctx.can('orders_edit') ? <><section className="panel"><h2>অবস্থা বদলান</h2><form method="post" action={attrValue(back)} className="form">{ui.field('কী সমাধান হলো / কেন বন্ধ (সমাধান বা বন্ধ করতে লিখতেই হবে)', ui.textarea('resolution', '', { rows: 2, maxlength: 1000 }), 'যেমন: "নতুন পণ্য পাঠানো হয়েছে", "৳১৫০ বিকাশে ফেরত দেওয়া হয়েছে"। "সমাধান হয়েছে" দিলে কাস্টমার SMS পান।')}<div className="row-actions">{(c.status !== 'working' && open ? <button className="btn btn-sm btn-ghost" name="action" value="working">🔧 কাজ চলছে</button> : null)}{' '}{(c.status !== 'solved' ? <button className="btn btn-sm" name="action" value="solved">✅ সমাধান হয়েছে</button> : null)}{' '}{(c.status !== 'closed' ? <button className="btn btn-sm btn-ghost" name="action" value="closed">🚫 বন্ধ করুন</button> : null)}{' '}{(!open ? <button className="btn btn-sm btn-ghost" name="action" value="open">↩️ আবার খুলুন</button> : null)}</div></form></section><section className="panel"><h2>দায়িত্বে কে</h2><form method="post" action={attrValue(back)} className="form"><input type="hidden" name="action" defaultValue="assign" />{' '}{ui.select('staff_id', [['', '— কেউ না —'], ...staff.map((x) => [String(x.id), x.name])], c.assigned_to ? String(c.assigned_to) : '')}{' '}<button className="btn btn-sm">সেভ করুন</button></form></section></> : null)}{' '}{(c.history.length ? <section className="panel"><h2>এই নম্বরের আগের অভিযোগ</h2><ul>{jsxList(c.history.map((h: Loose) => <li><a href={`${attrValue(BASE)}/${attrValue(h.id)}`} className="mono"><Val v={h.code} /></a>{' '}·{' '}<Val v={C.STATUS[h.status][1]} />{' '}·{' '}<span className="small muted">{fmtDate(h.created_at)}</span></li>))}</ul></section> : null)}</div></div></>;
  return ctx.page(`অভিযোগ ${c.code}`, body, 'complaints');
}

// a complaint's photo (private: only logged-in staff)
async function photo(ctx: AdminCtx, m: RouteMatch) {
  const p = await db.one<Pick<MediaRow, 'mime' | 'data'>>(`SELECT mime, data FROM media WHERE id=$1 AND owner_type='complaint'`, [int(m[1])]);
  if (!p || !p.data) return ctx.send(404, 'Not found', 'text/plain');
  return ctx.reply.answer(200, { 'Content-Type': /^image\/(jpeg|png|webp)$/.test(p.mime) ? p.mime : 'application/octet-stream', 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox" }, p.data);
}

export const routes = [
    { method: '*', path: BASE, perm: 'orders', handler: listPage },
    { method: 'GET', path: /^\/admin\/complaints\/photo\/(\d+)$/, perm: 'orders', handler: photo },
    { method: '*', path: /^\/admin\/complaints\/(\d+)$/, perm: (ctx: AdminCtx) => (ctx.method === 'GET' ? 'orders' : 'orders_edit'), handler: detail },
  ];
