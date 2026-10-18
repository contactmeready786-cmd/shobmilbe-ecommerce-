// Admin → মার্কেটিং → ❓ প্রশ্ন-উত্তর and 🔔 স্টকে এলে জানাও.
//   প্রশ্ন-উত্তর: customers' questions on products — answer, show on the shop, or hide. An SMS tells the asker (if a number was given).
//   স্টকে এলে জানাও: who is waiting for which out-of-stock product (most wanted first) and the SMS that goes out when it is back.

// ---------------------------------------------------------------- questions
import { Val, attrValue, jsxList } from '../react/html';
import { int, str, bn, fmtDate, oneOf } from '../util';
import * as db from '../db';
import * as ui from './ui';
import * as X from '../models/extras';
import * as $uiswitches from './uiswitches';
import * as $services_sms from '../services/sms';
import type { AdminCtx, Loose, RouteMatch, Caught } from '../types';
import type { ProductsRow } from '../data/rows';
async function questionsPage(ctx: AdminCtx) {
  const status = X.Q_STATUSES[String(ctx.query.get('status'))] || ctx.query.get('status') === 'all' ? ctx.query.get('status')! : 'pending';
  const page = Math.max(1, int(ctx.query.get('page'), 1));
  const [rows, counts] = await Promise.all([X.listQuestions({ status, limit: 50, offset: (page - 1) * 50 }), X.questionCounts()]);
  const tab = (k?: Loose, l?: unknown) => <a className={`chip ${status === k ? 'on' : ''}`} href={`/admin/questions?status=${attrValue(k)}`}><Val v={l} />{' '}<b>{bn(counts[k] || 0)}</b></a>;
  const body = <><div className="title-row"><h1>❓ পণ্যে প্রশ্ন-উত্তর</h1><div className="row-actions"><a className="btn btn-ghost btn-sm" href={`/admin/questions?status=${attrValue(status)}`}>🔄 রিফ্রেশ</a></div></div>{ui.flash(ctx.flash)}<p className="muted small">কাস্টমাররা পণ্যের পেজ থেকে প্রশ্ন করেন। উত্তর লিখে "দোকানে দেখান" চাপলে প্রশ্ন আর উত্তর পণ্যের পেজে সবাই দেখবে — কাস্টমার মোবাইল নম্বর দিয়ে থাকলে SMS-এ জানানো হয় (SMS চালু থাকলে)।</p>{$uiswitches.featureRows(ctx, ['ui_qa'])}<div className="chips">{tab('pending', 'উত্তর বাকি')}{tab('published', 'দোকানে দেখাচ্ছে')}{tab('hidden', 'লুকানো')}{tab('all', 'সব')}</div>{(rows.length ? <><div className="qa-admin">{jsxList(rows.map((q) => <section className="panel qa-item"><div className="qa-head"><span className="thumb">{(q.image_id ? <img src={`/media/${attrValue(q.image_id)}/t`} alt="" /> : <span><Val v={q.emoji || '📦'} /></span>)}</span><div><a href={`/p/${attrValue(q.slug)}`} target="_blank" rel="noopener"><b><Val v={q.product_name} /></b></a><br /><span className="small muted"><Val v={q.name || 'নাম দেননি'} />{(q.phone ? <>{' '}·{' '}<a href={`tel:${attrValue(q.phone)}`}><Val v={q.phone} /></a></> : null)}{' '}·{' '}{fmtDate(q.created_at)}</span></div>{ui.pill(X.Q_STATUSES[q.status] || q.status, q.status === 'pending' ? 'pill-warn' : q.status === 'published' ? 'pill-ok' : '')}</div><form method="post" action={`/admin/questions/${attrValue(q.id)}`} className="form">{ui.field('প্রশ্ন (দরকার হলে বানান ঠিক করুন)', ui.textarea('question', q.question, { rows: 2, maxlength: 500 }))}{' '}{ui.field('আপনার উত্তর', ui.textarea('answer', q.answer, { rows: 3, maxlength: 1500, placeholder: 'যেমন: জি, এটা ২২০ ভোল্টে চলে। ১ বছরের ওয়ারেন্টি আছে।' }))}{' '}{(q.answered_by_name ? <p className="small muted">উত্তর দিয়েছেন:{' '}<Val v={q.answered_by_name} />{(q.answered_at ? ` · ${fmtDate(q.answered_at)}` : null)}</p> : null)}<div className="row-actions"><button className="btn btn-sm" name="publish" value="1">✅ সেভ করুন ও দোকানে দেখান</button>{' '}<button className="btn btn-sm btn-ghost" name="publish" value="0">সেভ করুন (লুকানো থাকবে)</button></div></form><form method="post" action={`/admin/questions/${attrValue(q.id)}/delete`} data-confirm="প্রশ্নটা মুছবেন? রিসাইকেল বিনে থাকবে।" className="qa-del"><button className="link-btn danger small">🗑️ মুছুন</button></form></section>))}</div>{ui.pager(counts[status] || counts.all || 0, page, 50, `/admin/questions?status=${status}`)}</> : ui.empty(status === 'pending' ? '🎉 উত্তর বাকি নেই।' : 'কিছু নেই।'))}</>;
  return ctx.page('প্রশ্ন-উত্তর', body, 'questions');
}

async function answer(ctx: AdminCtx, m: RouteMatch) {
  const id = int(m[1]);
  const b = await ctx.body();
  const back = (ctx.req.headers.referer && new URL(ctx.req.headers.referer).pathname === '/admin/questions') ? new URL(ctx.req.headers.referer).pathname + new URL(ctx.req.headers.referer).search : '/admin/questions';
  let q: Loose;
  try {
    q = await X.answerQuestion(id, { answer: b.answer, publish: b.publish === '1', question: b.question }, ctx.user.id);
  } catch (caught) { const e = caught as Caught; return ctx.fail(back, e.message); }
  await ctx.log('question_answer', 'question', id, `${q.status === 'published' ? 'দোকানে দেখানো' : 'সেভ'}: ${str(q.question, 80)}`);
  // the first answer to a question with a mobile number: tell the customer by SMS
  let note = '';
  if (q.firstAnswer && q.phone && q.status === 'published') {
    const SMS = $services_sms;
    if (SMS.ready(ctx.settings).ok) {
      const p = await db.one<Pick<ProductsRow, 'slug' | 'name'>>('SELECT slug, name FROM products WHERE id=$1', [q.product_id]);
      const base = String(ctx.settings.site_url || '').replace(/\/+$/, '');
      const r = await SMS.send(ctx.settings, q.phone, `${ctx.settings.store_name}: "${String(p ? p.name : '').slice(0, 40)}" নিয়ে আপনার প্রশ্নের উত্তর দেওয়া হয়েছে। ${base ? `দেখুন: ${base}/p/${encodeURIComponent(p ? p.slug : '')}#qa` : ''}`.trim(), { kind: 'question', staffId: ctx.user.id });
      note = r.ok ? ' কাস্টমারকে SMS-এ জানানো হয়েছে।' : ` (SMS যায়নি: ${r.msg})`;
    }
  }
  return ctx.redirect(back + (back.includes('?') ? '&' : '?') + 'info=' + encodeURIComponent('সেভ হয়েছে।' + note));
}
async function removeQuestion(ctx: AdminCtx, m: RouteMatch) {
  const id = int(m[1]);
  await ctx.trash('question', id);
  await ctx.log('question_delete', 'question', id, 'প্রশ্ন মুছে ফেলা');
  return ctx.back('/admin/questions', 'deleted');
}

// ---------------------------------------------------------------- stock alerts
async function restockPage(ctx: AdminCtx) {
  if (ctx.method === 'POST') {
    const b = await ctx.body();
    if (b.action === 'tpl') {
      await db.setMany({ restock_sms: str(b.restock_sms, 300) });
      await ctx.log('settings', 'marketing', null, '"স্টকে এলে জানাও" SMS এর লেখা বদল');
      return ctx.back('/admin/marketing/restock', 'saved');
    }
    if (b.action === 'send') {
      const r = await X.restockSweep(ctx.settings, { limit: 60 });
      return ctx.redirect('/admin/marketing/restock?info=' + encodeURIComponent(r.waiting ? 'SMS চালু নেই — আগে "কাস্টমারকে SMS" পেজে SMS কোম্পানি সেটআপ করুন।' : `${bn(r.sent)} জনকে SMS পাঠানো হয়েছে।`));
    }
    if (b.action === 'delete' && int(b.id)) {
      await db.q('DELETE FROM stock_alerts WHERE id=$1', [int(b.id)]);
      return ctx.back('/admin/marketing/restock', 'removed');
    }
    return ctx.back('/admin/marketing/restock');
  }
  const status = oneOf(['waiting', 'sent', 'all'], ctx.query.get('status'), 'waiting');
  const [top, rows, cnt, ptop, pcnt] = await Promise.all([X.stockAlertTop(15), X.stockAlertList({ status }),
    db.one<{ waiting: number; sent: number; products: number }>(`SELECT count(*) FILTER (WHERE notified_at IS NULL)::int AS waiting, count(*) FILTER (WHERE notified_at IS NOT NULL)::int AS sent,
      count(DISTINCT product_id) FILTER (WHERE notified_at IS NULL)::int AS products FROM stock_alerts`),
    X.priceAlertTop(20), db.one<{ waiting: number; sent: number }>(`SELECT count(*) FILTER (WHERE notified_at IS NULL)::int AS waiting, count(*) FILTER (WHERE notified_at IS NOT NULL)::int AS sent FROM price_alerts`)]);
  const smsOk = $services_sms.ready(ctx.settings).ok;
  const def = '{shop}: আপনি যে পণ্যটার খবর চেয়েছিলেন "{product}" আবার স্টকে এসেছে। এখনই অর্ডার করুন: {link}';
  const body = <><div className="title-row"><h1>🔔 স্টকে এলে জানাও</h1><div className="row-actions"><a className="btn btn-ghost btn-sm" href={`/admin/marketing/restock?status=${attrValue(status)}`}>🔄 রিফ্রেশ</a></div></div>{ui.flash(ctx.flash)}<div className="kpis kpis-tight">{ui.kpi('অপেক্ষায় আছেন', bn(cnt!.waiting), `${bn(cnt!.products)}টি পণ্যের জন্য`, cnt!.waiting ? 'kpi-blue' : '')}{' '}{ui.kpi('SMS পাঠানো হয়েছে', bn(cnt!.sent), 'পণ্য স্টকে আসার পর')}{' '}{ui.kpi('SMS কোম্পানি', smsOk ? '✅ সেটআপ আছে' : '⚠️ সেটআপ হয়নি', smsOk ? 'SMS নিজে থেকেই যাবে' : 'মার্কেটিং → কাস্টমারকে SMS পেজে API Key দিলেই নিজে থেকে চালু হবে; ততদিন তালিকা জমা থাকবে', smsOk ? '' : 'kpi-alert', '/admin/marketing/sms')}</div>{$uiswitches.featureRows(ctx, ['ui_restock_notify', 'price_alert_on'])}<p className="muted small">স্টক শেষ পণ্যের পেজে কাস্টমার মোবাইল নম্বর রেখে যান। পণ্যটা আবার স্টকে এলে (পারচেজ, স্টক বাড়ানো, ভ্যারিয়েন্ট) কিছুক্ষণের মধ্যেই নিজে থেকে SMS চলে যায়। কোন পণ্য সবচেয়ে বেশি মানুষ চাইছে সেটা দেখে আগে কিনুন।</p><div className="two-col"><section className="panel table-wrap"><h2>🏆 সবচেয়ে বেশি চাওয়া পণ্য</h2>{(top.length ? <table className="table compact"><thead><tr><th></th><th>পণ্য</th><th className="num">অপেক্ষায়</th><th className="num">এখন স্টক</th><th></th></tr></thead><tbody>{jsxList(top.map((p) => <tr><td className="thumb">{(p.image_id ? <img src={`/media/${attrValue(p.image_id)}/t`} alt="" /> : <span><Val v={p.emoji || '📦'} /></span>)}</td><td><Val v={p.name} /><br /><span className="small muted">SKU{' '}<Val v={p.sku} /></span></td><td className="num"><b>{bn(p.n)}</b>{' '}জন</td><td className={`num ${p.stock > 0 ? 'good' : 'warn'}`}>{bn(p.stock)}</td><td><a className="btn btn-sm btn-ghost" href={`/admin/purchases/new?add=${attrValue(p.id)}`}>🛒 কিনুন</a></td></tr>))}</tbody></table> : <p className="muted">এখনো কেউ অপেক্ষায় নেই।</p>)}</section><section className="panel"><h2>✉️ SMS এর লেখা</h2><form method="post" action="/admin/marketing/restock" className="form"><input type="hidden" name="action" defaultValue="tpl" />{' '}{ui.field('লেখা', ui.textarea('restock_sms', ctx.settings.restock_sms || def, { rows: 3, maxlength: 300 }), <><code>{"{shop}"}</code>{' '}দোকানের নাম,{' '}<code>{"{product}"}</code>{' '}পণ্যের নাম,{' '}<code>{"{link}"}</code>{' '}পণ্যের লিংক (সেটিংসে সাইটের ঠিকানা দেওয়া থাকলে)।</>)}{' '}<button className="btn btn-sm">সেভ করুন</button></form><form method="post" action="/admin/marketing/restock" className="form mt"><input type="hidden" name="action" defaultValue="send" />{' '}<button className="btn btn-sm btn-ghost">📨 যাদের পণ্য এসেছে তাদের এখনই SMS পাঠান</button><p className="small muted">সাধারণত নিজে থেকেই যায় — এই বাটন শুধু সাথে সাথে পাঠাতে চাইলে।</p></form></section></div><section className="panel table-wrap"><div className="chips"><a className={`chip ${status === 'waiting' ? 'on' : ''}`} href="?status=waiting">অপেক্ষায়</a><a className={`chip ${status === 'sent' ? 'on' : ''}`} href="?status=sent">SMS গেছে</a><a className={`chip ${status === 'all' ? 'on' : ''}`} href="?status=all">সব</a></div>{(rows.length ? <table className="table compact"><thead><tr><th>সময়</th><th>মোবাইল</th><th>পণ্য</th><th className="num">স্টক</th><th>ফল</th><th></th></tr></thead><tbody>{jsxList(rows.map((r) => <tr><td className="small nowrap">{fmtDate(r.created_at)}</td><td className="mono small"><a href={`tel:${attrValue(r.phone)}`}><Val v={r.phone} /></a></td><td><a href={`/admin/products/${attrValue(r.edit_id)}`}><Val v={r.name} /></a></td><td className="num">{bn(r.stock)}</td><td className="small">{(r.notified_at ? <><Val v={r.result} />{' '}<span className="muted">{fmtDate(r.notified_at)}</span></> : "অপেক্ষায়")}</td><td><form method="post" action="/admin/marketing/restock" data-confirm="এই অনুরোধ মুছবেন?"><input type="hidden" name="action" defaultValue="delete" /><input type="hidden" name="id" defaultValue={attrValue(r.id)} /><button className="link-btn danger small">মুছুন</button></form></td></tr>))}</tbody></table> : <p className="muted">কিছু নেই।</p>)}</section><section className="panel table-wrap" id="price"><h2>🔔 দাম কমলে জানাও — কারা অপেক্ষায়</h2><p className="muted small">পণ্যের পেজে "দাম কমলে SMS-এ জানাও" ঘরে কাস্টমার নম্বর রেখে যান। আপনি দাম কমালে বা ফ্ল্যাশ সেলে দিলে কয়েক মিনিটের মধ্যে নিজে থেকে একবার SMS যায়। এখন অপেক্ষায়:{' '}<b>{bn(pcnt!.waiting)}</b>{' '}জন · SMS গেছে:{' '}{bn(pcnt!.sent)}। বেশি মানুষ যেটা চাইছে, সেটায় ছোট অফার দিলেই বিক্রি হয়।</p>{(ptop.length ? <table className="table compact"><thead><tr><th>পণ্য</th><th className="num">অপেক্ষায়</th><th className="num">এখনকার দাম</th><th></th></tr></thead><tbody>{jsxList(ptop.map((p) => <tr><td><Val v={p.name} /><br /><span className="small muted">SKU{' '}<Val v={p.sku} /></span></td><td className="num"><b>{bn(p.n)}</b>{' '}জন</td><td className="num">৳{bn(p.price)}</td><td><a className="btn btn-sm btn-ghost" href={`/admin/products/${attrValue(p.edit_id)}`}>দাম বদলান</a>{' '}<a className="btn btn-sm btn-ghost" href="/admin/marketing/flash">⚡ ফ্ল্যাশ সেল</a></td></tr>))}</tbody></table> : <p className="muted">এখনো কেউ অপেক্ষায় নেই।</p>)}</section></>;
  return ctx.page('স্টকে এলে জানাও', body, 'restock');
}

export const routes = [
    { method: 'GET', path: '/admin/questions', perm: 'reviews', handler: questionsPage },
    { method: 'POST', path: /^\/admin\/questions\/(\d+)$/, perm: 'reviews', handler: answer },
    { method: 'POST', path: /^\/admin\/questions\/(\d+)\/delete$/, perm: 'reviews', handler: removeQuestion },
    { method: '*', path: '/admin/marketing/restock', perm: 'marketing', handler: restockPage },
  ];
