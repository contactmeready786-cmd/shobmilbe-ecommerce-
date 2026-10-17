// Admin → অর্ডার ও কাস্টমার → ↩️ রিটার্ন ও রিফান্ড.
// Customers' return requests (and ones the staff record by phone): approve / reject with a reply, take the goods back
// (each item to the shelf, to damaged stock, or nowhere), then refund (also written in the accounts if chosen) or replace.
import { toHtml, Val, attrValue, jsxList } from '../react/html';
import { html, raw, int, str, bn, money, fmtDate, normalizePhone } from '../util';
import * as db from '../db';
import * as ui from './ui';
import * as R from '../models/returns';
import * as O from '../models/orders';
import * as finance from '../models/finance';
import * as $views_account from '../views/account';
import * as $services_sms from '../services/sms';
import type { AdminCtx, Id, Loose } from '../types';

const BASE = '/admin/returns';
const PILL: Record<string, string> = { requested: 'pill-warn', approved: 'pill-blue', received: 'pill-blue', refunded: 'pill-ok', replaced: 'pill-ok', rejected: '', cancelled: '' };
const HOW: Record<string, Loose> = { stock: '✅ স্টকে ফেরত (আবার বিক্রি হবে)', damaged: '⚠️ নষ্ট স্টকে (বিক্রি হবে না)', none: '✖ কোথাও না (ফেলে দেওয়া / কুরিয়ারের কাছে)' };

async function listPage(ctx: AdminCtx) {
  const s = ctx.settings;
  if (ctx.method === 'POST') {
    const b = await ctx.body();
    if (b.action === 'settings') {
      if (!ctx.can('settings')) return ctx.back(BASE, 'noperm');
      await db.setMany({ returns_on: b.returns_on ? '1' : '0', returns_days: String(Math.max(1, Math.min(365, int(b.returns_days, 7)))) });
      await ctx.log('settings', 'settings', null, `রিটার্ন আবেদন: ${b.returns_on ? 'চালু' : 'বন্ধ'}, ${int(b.returns_days, 7)} দিন`);
      return ctx.back(BASE, 'saved');
    }
    if (b.action === 'new') {
      // the staff records a return a customer asked for by phone / in the shop
      const order = await O.getOrder({ code: str(b.order_code, 20).toUpperCase() });
      if (!order) return ctx.fail(BASE, 'এই নম্বরের অর্ডার পাওয়া যায়নি।');
      return ctx.redirect(ctx.res, `${BASE}/new/${order.id}`);
    }
    return ctx.back(BASE);
  }
  const status = R.STATUSES[ctx.query.get('status')] || ['all', 'open'].includes(ctx.query.get('status')) ? ctx.query.get('status') : 'open';
  const q = str(ctx.query.get('q'), 40);
  const [rows, counts] = await Promise.all([R.list({ status, q, limit: 100 }), R.counts()]);
  const tab = (k?: Loose, l?: Loose, n?: Loose) => toHtml(<a className={`chip ${attrValue(status === k ? 'on' : '')}`} href={`${attrValue(BASE)}?status=${attrValue(k)}`}><Val v={l} />{' '}<b><Val v={bn(n || 0)} /></b></a>);
  const body = toHtml(<><div className="title-row"><h1>↩️ রিটার্ন ও রিফান্ড</h1><div className="row-actions"><a className="btn btn-ghost btn-sm" href={`${attrValue(BASE)}?status=${attrValue(status)}`}>🔄 রিফ্রেশ</a></div></div><Val v={ui.flash(ctx.flash)} /><div className="kpis kpis-tight"><Val v={ui.kpi('কাজ বাকি', bn(counts.open), 'নতুন + অনুমোদিত + পণ্য এসেছে', counts.open ? 'kpi-alert' : 'kpi-green')} />{' '}<Val v={ui.kpi('মোট টাকা ফেরত', money(counts.refunded_total), 'রিটার্ন থেকে')} />{' '}<Val v={ui.kpi('অনলাইন আবেদন', s.returns_on === '1' ? '✅ চালু' : '⚪ বন্ধ', s.returns_on === '1' ? `ডেলিভারির ${bn(s.returns_days || 7)} দিনের মধ্যে` : 'কাস্টমার নিজে আবেদন করতে পারবে না')} /></div><div className="chips"><Val v={tab('open', 'কাজ বাকি', counts.open)} /><Val v={tab('requested', 'নতুন', counts.requested)} /><Val v={tab('approved', 'অনুমোদিত', counts.approved)} /><Val v={tab('received', 'পণ্য এসেছে', counts.received)} />{' '}<Val v={tab('refunded', 'টাকা ফেরত', counts.refunded)} /><Val v={tab('replaced', 'বদলে দেওয়া', counts.replaced)} /><Val v={tab('rejected', 'বাতিল', counts.rejected)} /><Val v={tab('all', 'সব', counts.all)} /></div><form method="get" action={attrValue(BASE)} className="filters"><input type="hidden" name="status" defaultValue={attrValue(status)} /><input type="search" name="q" defaultValue={attrValue(q)} placeholder="রিটার্ন/অর্ডার নম্বর, মোবাইল, নাম" /><button className="btn btn-sm">খুঁজুন</button></form>{(rows.length ? <div className="table-wrap panel"><table className="table"><thead><tr><th>রিটার্ন</th><th>অর্ডার</th><th>কাস্টমার</th><th>পণ্য</th><th>কারণ</th><th>চাই</th><th className="num">টাকা</th><th>অবস্থা</th><th></th></tr></thead><tbody>{jsxList(rows.map((r) => <tr><td><a href={`${attrValue(BASE)}/${attrValue(r.id)}`}><b className="mono"><Val v={r.code} /></b></a><br /><span className="small muted"><Val v={fmtDate(r.created_at)} /></span></td><td><a href={`/admin/orders/${attrValue(r.order_id)}`} className="mono"><Val v={r.order_code} /></a></td><td><Val v={r.customer_name} /><br /><span className="small mono"><Val v={r.phone} /></span></td><td className="small"><Val v={(r.items || []).map((i?: Loose) => `${i.name} ×${bn(i.qty)}`).join(', ')} /></td><td className="small"><Val v={R.REASONS[r.reason] || r.reason} />{(r.photos && r.photos.length ? <>{' '}<span title="ছবি আছে">📷<Val v={bn(r.photos.length)} /></span></> : null)}</td><td className="small"><Val v={R.WANTS[r.want] || r.want} /></td><td className="num"><Val v={money(R.itemsValue(r))} />{(Number(r.refund_amount) ? <><br /><span className="small good">ফেরত{' '}<Val v={money(r.refund_amount)} /></span></> : null)}</td><td><Val v={ui.pill(R.STATUSES[r.status] || r.status, PILL[r.status] || '')} /></td><td><a className="btn btn-sm btn-ghost" href={`${attrValue(BASE)}/${attrValue(r.id)}`}>খুলুন</a></td></tr>))}</tbody></table></div> : <Val v={ui.empty('কোনো রিটার্ন নেই।')} />)}<div className="two-col"><section className="panel"><h2>ফোনে/দোকানে বলা রিটার্ন লিখুন</h2><form method="post" action={attrValue(BASE)} className="form"><input type="hidden" name="action" defaultValue="new" />{' '}<Val v={ui.field('অর্ডার নম্বর', ui.input('order_code', '', { required: true, maxlength: 20, placeholder: 'SM…', autocapitalize: 'characters' }))} />{' '}<button className="btn btn-sm">পরের ধাপ →</button></form></section>{(ctx.can('settings') ? <section className="panel"><h2>⚙️ কাস্টমারের অনলাইন আবেদন</h2><form method="post" action={attrValue(BASE)} className="form"><input type="hidden" name="action" defaultValue="settings" />{' '}<Val v={ui.switchRow('returns_on', s.returns_on === '1', 'অর্ডারের পেজে "রিটার্ন / রিফান্ড আবেদন"', 'ডেলিভারি হওয়া অর্ডারে কাস্টমার পণ্য, কারণ, ছবি আর টাকা নেওয়ার নম্বর দিয়ে আবেদন করতে পারবেন।')} />{' '}<Val v={ui.field('ডেলিভারির কত দিনের মধ্যে', ui.input('returns_days', s.returns_days || 7, { type: 'number', min: 1, max: 365, class: 'w-num' }), 'এর পরে অনলাইনে আবেদন করা যাবে না (আপনি এখান থেকে লিখতে পারবেন)')} />{' '}<button className="btn btn-sm">সেভ করুন</button></form></section> : null)}</div></>);
  return ctx.page('রিটার্ন ও রিফান্ড', body, 'returns');
}

// staff records a return on behalf of the customer
async function newPage(ctx: AdminCtx, m?: Loose) {
  const order = await O.getOrder({ id: int(m[1]) });
  if (!order) return ctx.redirect(ctx.res, BASE);
  const V = $views_account;
  if (ctx.method === 'POST') {
    const b = await ctx.body();
    const ids = ([] as Loose[]).concat(b.item || []).map((x) => int(x));
    try {
      const r = await R.create({ order, wanted: ids.map((id) => ({ item_id: id, qty: int(b[`qty_${id}`], 1) })), reason: b.reason, want: b.want, details: b.details,
        photos: [], refundMethod: b.refund_method, refundNumber: b.refund_number, source: 'admin', settings: ctx.settings, staffId: ctx.user.id });
      await ctx.log('return_create', 'order', order.id, `রিটার্ন ${r!.code} লেখা হয়েছে`);
      return ctx.back(`${BASE}/${r!.id}`, 'added');
    } catch (e: Loose) {
      if (!(e instanceof R.ReturnError)) throw e;
      return ctx.fail(`${BASE}/new/${order.id}`, e.message);
    }
  }
  const items = (order.items || []).filter((i?: Loose) => i.product_id);
  const body = toHtml(<><p className="crumbs"><a href={attrValue(BASE)}>← সব রিটার্ন</a></p><h1>নতুন রিটার্ন —{' '}<a href={`/admin/orders/${attrValue(order.id)}`} className="mono"><Val v={order.code} /></a></h1><Val v={ui.flash(ctx.flash)} />{' '}{(order.status !== 'delivered' ? <p className="flash flash-error">এই অর্ডার এখনো "ডেলিভারি সম্পন্ন" না (<Val v={O.STATUSES[order.status]} />)। পুরো অর্ডার কুরিয়ার থেকে ফেরত এলে অর্ডারের পেজে "ফেরত এসেছে" দিন।</p> : <><form method="post" action={`${attrValue(BASE)}/new/${attrValue(order.id)}`} className="form panel"><p><Val v={order.customer_name} />{' '}·{' '}<span className="mono"><Val v={order.phone} /></span></p><table className="table compact"><tbody>{jsxList(items.map((it?: Loose) => <tr><td><label className="check"><input type="checkbox" name="item" defaultValue={attrValue(it.id)} />{' '}<span><Val v={it.name} /></span></label></td><td className="num"><input type="number" name={`qty_${attrValue(it.id)}`} min="1" max={attrValue(it.qty)} defaultValue={attrValue(it.qty)} className="w-num" />{' '}/{' '}<Val v={bn(it.qty)} /></td><td className="num"><Val v={money(it.price)} /></td></tr>))}</tbody></table><div className="field-row"><Val v={ui.field('কারণ', ui.select('reason', V.REASONS, 'broken'))} /><Val v={ui.field('কাস্টমার চান', ui.select('want', V.WANTS, 'refund'))} /></div><Val v={ui.field('বিস্তারিত', ui.textarea('details', '', { rows: 2, maxlength: 1000 }))} /><div className="field-row"><Val v={ui.field('টাকা কোথায় দেবেন', ui.select('refund_method', [['bkash', 'বিকাশ'], ['nagad', 'নগদ'], ['rocket', 'রকেট'], ['bank', 'ব্যাংক'], ['cash', 'নগদ টাকা']], 'bkash'))} />{' '}<Val v={ui.field('নম্বর / অ্যাকাউন্ট', ui.input('refund_number', order.phone, { maxlength: 60 }))} /></div><button className="btn">রিটার্ন সেভ করুন</button></form></>)}</>);
  return ctx.page('নতুন রিটার্ন', body, 'returns');
}

async function detail(ctx: AdminCtx, m?: Loose) {
  const id = int(m[1]);
  const r = await R.get(id);
  if (!r) return ctx.redirect(ctx.res, BASE);
  const back = `${BASE}/${id}`;
  if (ctx.method === 'POST') {
    const b = await ctx.body();
    try {
      if (['approved', 'rejected', 'replaced', 'cancelled'].includes(b.action)) {
        const x = await R.decide(id, b.action, { reply: b.reply, note: b.note }, ctx.user.id);
        await ctx.log('return_' + b.action, 'order', r.order_id, `${r.code}: ${R.STATUSES[b.action]}${b.reply ? ' — ' + str(b.reply, 80) : ''}`);
        // tell the customer by SMS (when SMS is on)
        if (b.sms === '1' && x.phone) {
          const SMS = $services_sms;
          if (SMS.ready(ctx.settings).ok) {
            const word = (({ approved: 'অনুমোদন করা হয়েছে', rejected: 'গ্রহণ করা যায়নি', replaced: 'বদলে দেওয়া হচ্ছে', cancelled: 'বাতিল হয়েছে' } as Record<string, string>))[b.action];
            await SMS.send(ctx.settings, x.phone, `${ctx.settings.store_name}: আপনার রিটার্ন আবেদন ${x.code} ${word}।${b.reply ? ' ' + str(b.reply, 120) : ''}`, { kind: 'return', orderId: r.order_id, staffId: ctx.user.id });
          }
        }
        return ctx.back(back, 'status');
      }
      if (b.action === 'receive') {
        const acts: Record<string, string> = {};
        (r.items || []).forEach((it?: Loose) => { acts[it.item_id] = b[`how_${it.item_id}`]; });
        const done = await R.receive(id, acts, ctx.user.id);
        await ctx.log('return_receive', 'order', r.order_id, `${r.code}: পণ্য ফেরত — ${done.map((d) => HOW[d.how].split(' ')[0]).join(' ')}`);
        return ctx.back(back, 'saved');
      }
      if (b.action === 'refund') {
        const x = await R.refund(id, { amount: b.amount, method: b.method, reference: b.reference, note: b.note }, ctx.user.id);
        if (int(b.account_id) && ctx.can('accounting')) {
          await finance.addTransaction({ type: 'expense', category: 'রিফান্ড', amount: x.amount, account_id: b.account_id, order_id: r.order_id, note: `${r.order_code} রিটার্ন ${r.code} ${str(b.reference, 60)}` }, ctx.user.id);
        }
        await ctx.log('order_refund', 'order', r.order_id, `রিটার্ন ${r.code}: ৳${x.amount} ফেরত`);
        if (b.sms === '1') {
          const SMS = $services_sms;
          if (SMS.ready(ctx.settings).ok) await SMS.send(ctx.settings, r.phone, `${ctx.settings.store_name}: রিটার্ন ${r.code} এর ৳${x.amount} ফেরত পাঠানো হয়েছে${b.method ? ` (${b.method})` : ''}${b.reference ? `, রেফারেন্স ${str(b.reference, 30)}` : ''}।`, { kind: 'return', orderId: r.order_id, staffId: ctx.user.id });
        }
        return ctx.back(back, 'paid');
      }
      if (b.action === 'note') {
        await db.q('UPDATE return_requests SET admin_note=$1, updated_at=now() WHERE id=$2', [str(b.note, 1000), id]);
        return ctx.back(back, 'saved');
      }
    } catch (e: Loose) {
      if (!(e instanceof R.ReturnError) && !/টাকা|অ্যাকাউন্ট/.test(e.message)) throw e;
      return ctx.fail(back, e.message);
    }
    return ctx.back(back);
  }
  const [accounts, order] = await Promise.all([ctx.can('accounting') ? finance.listAccounts() : [], O.getOrder({ id: r.order_id })]);
  const value = R.itemsValue(r);
  const open = R.OPEN.includes(r.status);
  const canRefund = !['rejected', 'cancelled'].includes(r.status) && Number(order!.paid_amount) > 0;
  const body = toHtml(<><p className="crumbs"><a href={attrValue(BASE)}>← সব রিটার্ন</a></p><div className="title-row"><h1>রিটার্ন{' '}<span className="mono"><Val v={r.code} /></span>{' '}<Val v={ui.pill(R.STATUSES[r.status], PILL[r.status] || '')} /></h1><div className="row-actions"><a className="btn btn-ghost btn-sm" href={`/admin/orders/${attrValue(r.order_id)}`}>🧾 অর্ডার{' '}<Val v={r.order_code} /></a></div></div><Val v={ui.flash(ctx.flash)} /><div className="two-col"><div><section className="panel"><h2>কী ফেরত দিতে চান</h2><p><Val v={r.customer_name} />{' '}·{' '}<a href={`tel:${attrValue(r.phone)}`} className="mono"><Val v={r.phone} /></a>{' '}·{' '}<Val v={fmtDate(r.created_at)} />{' '}·{' '}{(r.source === 'admin' ? "স্টাফ লিখেছেন" : "কাস্টমার অনলাইনে")}</p><table className="table compact"><thead><tr><th>পণ্য</th><th className="num">পরিমাণ</th><th className="num">দাম</th>{(r.restock ? <th>কোথায় গেছে</th> : null)}</tr></thead><tbody>{jsxList((r.items || []).map((it?: Loose) => <tr><td><Val v={it.name} /></td><td className="num"><Val v={bn(it.qty)} />{(it.ordered && it.ordered !== it.qty ? <>{' '}<span className="small muted">/{' '}<Val v={bn(it.ordered)} /></span></> : null)}</td><td className="num"><Val v={money(it.price * it.qty)} /></td>{(r.restock ? <td className="small"><Val v={HOW[((r.restock || []).find((d?: Loose) => d.item_id === it.item_id) || {}).how] || ''} /></td> : null)}</tr>))}</tbody><tfoot><tr><td>মোট</td><td></td><td className="num"><b><Val v={money(value)} /></b></td></tr></tfoot></table><p><b>কারণ:</b>{' '}<Val v={R.REASONS[r.reason] || r.reason} />{' '}·{' '}<b>চান:</b>{' '}<Val v={R.WANTS[r.want] || r.want} /></p>{(r.details ? <p className="note"><Val v={r.details} /></p> : null)}{' '}{(r.refund_number ? <p><b>টাকা নেবেন:</b>{' '}<Val v={r.refund_method} />{' '}—{' '}<span className="mono"><Val v={r.refund_number} /></span></p> : null)}{' '}{(r.photos && r.photos.length ? <div className="ret-photos">{jsxList(r.photos.map((pid?: Loose) => <a href={`${attrValue(BASE)}/photo/${attrValue(pid)}`} target="_blank" rel="noopener"><img src={`${attrValue(BASE)}/photo/${attrValue(pid)}`} alt="রিটার্নের ছবি" loading="lazy" /></a>))}</div> : null)}</section><section className="panel"><h2>ভেতরের নোট</h2><form method="post" action={attrValue(back)} className="form"><input type="hidden" name="action" defaultValue="note" />{' '}<Val v={ui.textarea('note', r.admin_note, { rows: 2, maxlength: 1000, placeholder: 'শুধু অ্যাডমিনে দেখা যায়' })} /><button className="btn btn-sm btn-ghost">সেভ করুন</button></form>{(r.staff_name ? <p className="small muted">শেষ কাজ:{' '}<Val v={r.staff_name} />{' '}·{' '}<Val v={fmtDate(r.updated_at)} /></p> : null)}</section></div><div>{(open ? <section className="panel"><h2>১) সিদ্ধান্ত</h2><form method="post" action={attrValue(back)} className="form"><Val v={ui.field('কাস্টমারকে বার্তা (অর্ডারের পেজে দেখাবে)', ui.textarea('reply', r.reply, { rows: 2, maxlength: 500, placeholder: 'যেমন: পণ্যটা কুরিয়ারে ফেরত পাঠান, আমরা পেয়ে টাকা ফেরত দেব।' }))} />{' '}<Val v={ui.check('sms', true, 'কাস্টমারকে SMS-এও জানাও (SMS চালু থাকলে)')} /><div className="row-actions">{(r.status === 'requested' ? <button className="btn btn-sm" name="action" value="approved">✅ অনুমোদন করুন</button> : null)}{' '}<button className="btn btn-sm btn-ghost" name="action" value="replaced">🔄 বদলে দেওয়া হয়েছে</button>{' '}<button className="btn btn-sm btn-danger" name="action" value="rejected" data-confirm-btn="আবেদন বাতিল করবেন?">✖ বাতিল</button></div></form></section> : null)}{' '}{(['requested', 'approved'].includes(r.status) && !r.received_at ? <section className="panel"><h2>২) পণ্য ফেরত পেয়েছি</h2><form method="post" action={attrValue(back)} className="form" data-confirm="পণ্য ফেরত নেওয়া হয়েছে লিখবেন? স্টক বদলে যাবে।"><input type="hidden" name="action" defaultValue="receive" />{' '}<Val v={(r.items || []).map((it?: Loose) => ui.field(`${it.name} ×${bn(it.qty)}`, ui.select(`how_${it.item_id}`, Object.entries(HOW), 'stock')))} />{' '}<button className="btn btn-sm">📦 পণ্য ফেরত নেওয়া হয়েছে</button></form></section> : null)}{' '}{(canRefund ? <section className="panel"><h2>৩) টাকা ফেরত</h2><p className="small muted">এই অর্ডারে পরিশোধ হয়েছে{' '}<Val v={money(order!.paid_amount)} />{(Number(r.refund_amount) ? <Val v={` · এই রিটার্নে আগে ফেরত ${money(r.refund_amount)}`} /> : null)}। কুরিয়ার/ডেলিভারি চার্জ কাটবেন কি না আপনার সিদ্ধান্ত।</p><form method="post" action={attrValue(back)} className="form" data-confirm="টাকা ফেরত দেওয়া রেকর্ড করবেন?"><input type="hidden" name="action" defaultValue="refund" /><div className="field-row"><Val v={ui.field('কত টাকা', ui.input('amount', Math.min(value, Number(order!.paid_amount)) - Number(r.refund_amount || 0) > 0 ? Math.min(value, Number(order!.paid_amount)) - Number(r.refund_amount || 0) : '', { type: 'number', min: 0.01, step: '0.01', required: true }))} />{' '}<Val v={ui.field('কীভাবে', ui.select('method', [['bkash', 'বিকাশ'], ['nagad', 'নগদ'], ['rocket', 'রকেট'], ['bank', 'ব্যাংক'], ['cash', 'নগদ টাকা']], r.refund_method || 'bkash'))} /></div><Val v={ui.field('ট্রানজেকশন / রেফারেন্স', ui.input('reference', '', { maxlength: 80 }))} />{' '}{(accounts.length ? <Val v={ui.field('কোন অ্যাকাউন্ট থেকে গেছে (হিসাবে খরচ হিসেবে লেখা হবে)', ui.select('account_id', [['', '— হিসাবে লিখবেন না —'], ...accounts.filter((a) => a.active).map((a) => [a.id, `${a.name} (${money(a.balance)})`])], ''))} /> : null)}{' '}<Val v={ui.check('sms', true, 'কাস্টমারকে SMS-এ জানাও')} />{' '}<button className="btn btn-sm">💵 টাকা ফেরত রেকর্ড করুন</button></form></section> : null)}</div></div></>);
  return ctx.page(`রিটার্ন ${r.code}`, body, 'returns');
}

// a return's photo (private: only logged-in staff)
async function photo(ctx: AdminCtx, m?: Loose) {
  const p = await db.one(`SELECT mime, data FROM media WHERE id=$1 AND owner_type='return'`, [int(m[1])]);
  if (!p || !p.data) return ctx.send(ctx.res, 404, 'Not found', 'text/plain');
  ctx.res.writeHead(200, { 'Content-Type': /^image\/(jpeg|png|webp)$/.test(p.mime) ? p.mime : 'application/octet-stream', 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox" });
  return ctx.res.end(p.data);
}

void raw; void normalizePhone;
export const routes = [
    { method: '*', path: BASE, perm: 'orders', handler: listPage },
    { method: '*', path: /^\/admin\/returns\/new\/(\d+)$/, perm: 'orders_edit', handler: newPage },
    { method: 'GET', path: /^\/admin\/returns\/photo\/(\d+)$/, perm: 'orders', handler: photo },
    { method: '*', path: /^\/admin\/returns\/(\d+)$/, perm: (ctx: AdminCtx) => (ctx.method === 'GET' ? 'orders' : 'orders_edit'), handler: detail },
  ];
