// Admin → অর্ডার ও কাস্টমার → 🛡️ ফ্রড চেক: check any mobile number's parcel record (this shop + Pathao + FraudBD),
// the FraudBD key, and what happens to new orders from risky numbers (a note, or "হোল্ড").
import { toHtml, Val, attrValue, jsxList } from '../react/render';
import { html, str, bn, fmtDate, normalizePhone, validPhone } from '../util';
import * as db from '../db';
import * as ui from './ui';
import * as fraud from '../services/fraud';
import * as courier from '../services/courier';
import type { AdminCtx, Loose } from '../types';

const BASE = '/admin/fraud';

function resultBox(r?: Loose) {
  if (!r) return '';
  if (!r.ok) return toHtml(<p className="flash flash-error"><Val v={r.message} /></p>);
  return toHtml(<><div className={`risk risk-${attrValue(r.level)}`}><b><Val v={r.label} /></b>{(r.rate !== null ? <>{' '}— সব মিলিয়ে সফল{' '}<b><Val v={bn(r.rate)} />%</b>{' '}(<Val v={bn(r.success)} />/<Val v={bn(r.total)} />)</> : null)}<span><Val v={r.advice} /></span></div><ul className="fraud-list"><li>🏪 এই দোকানে: মোট অর্ডার{' '}<Val v={bn(r.own.orders)} />{' '}· ডেলিভারি{' '}<b><Val v={bn(r.own.delivered)} /></b>{' '}· বাতিল/ফেরত{' '}<b><Val v={bn(r.own.failed)} /></b>{(r.own.last_day > 1 ? <>{' '}· ⚠️ ২৪ ঘণ্টায়{' '}<Val v={bn(r.own.last_day)} />টি অর্ডার</> : null)}</li>{(r.fraudbd && r.fraudbd.ok ? jsxList(r.fraudbd.couriers.map((c?: Loose) => <li>🚚{' '}<Val v={c.name} />:{' '}{(c.type === 'rating' ? <Val v={c.message || c.rating || '—'} /> : <>মোট{' '}<b><Val v={bn(c.total)} /></b>{' '}· সফল{' '}<b><Val v={bn(c.success)} /></b>{' '}· বাতিল{' '}<b><Val v={bn(c.cancel)} /></b></>)}</li>)) : null)}{' '}{(r.fraudbd && !r.fraudbd.ok ? <li className="muted">FraudBD:{' '}<Val v={r.fraudbd.message} /></li> : null)}{' '}{(r.pathao ? <li>{(r.pathao.ok ? <>🚚 Pathao: মোট{' '}<b><Val v={bn(r.pathao.total)} /></b>{' '}· সফল{' '}<b><Val v={bn(r.pathao.success)} /></b>{(r.pathao.rating ? <Val v={` · ${r.pathao.rating}`} /> : null)}</> : <span className="muted">Pathao:{' '}<Val v={r.pathao.message} /></span>)}</li> : null)}</ul><p className="row-actions"><a className="btn btn-sm btn-ghost" href={`/admin/orders?q=${attrValue(r.phone)}`}>এই নম্বরের অর্ডার</a>{' '}<a className="btn btn-sm btn-ghost" href="/admin/blocklist">ব্লক লিস্ট</a></p></>);
}

async function page(ctx: AdminCtx) {
  const s = ctx.settings;
  if (ctx.method === 'POST') {
    if (!ctx.can('settings')) return ctx.back(BASE, 'noperm');
    const b = await ctx.body();
    const v: Record<string, string> = { fraud_auto: b.fraud_auto ? '1' : '0', fraud_hold: b.fraud_hold ? '1' : '0' };
    if (b.clear_key === '1') v.fraudbd_api_key = '';
    else if (str(b.fraudbd_api_key, 200)) v.fraudbd_api_key = str(b.fraudbd_api_key, 200);
    await db.setMany(v);
    await ctx.log('settings', 'settings', null, `ফ্রড চেক: নতুন অর্ডারে নিজে থেকে ${v.fraud_auto === '1' ? 'চালু' : 'বন্ধ'}${v.fraudbd_api_key ? ', নতুন FraudBD key' : ''}`);
    return ctx.back(BASE, 'saved');
  }
  const phone = normalizePhone(ctx.query.get('phone') || '');
  const result: Loose = phone ? (validPhone(phone) ? await fraud.check(s, phone, { fresh: ctx.query.get('fresh') === '1' }) : { ok: false, message: 'ফোন নম্বর ঠিক নেই।' }) : null;
  const recent = await db.q('SELECT phone, data, checked_at FROM fraud_checks ORDER BY checked_at DESC LIMIT 20');
  const hasKey = !!String(s.fraudbd_api_key || '').trim();
  const body = toHtml(<><h1>🛡️ ফ্রড চেক (কাস্টমারের পার্সেল রেকর্ড)</h1><Val v={ui.flash(ctx.flash)} /><div className="two-col"><section className="panel"><h2>🔍 একটা নম্বর চেক করুন</h2><form method="get" action={attrValue(BASE)} className="coupon-row"><input name="phone" defaultValue={attrValue(phone)} inputMode="tel" placeholder="01XXXXXXXXX" required maxLength={20} /><button className="btn btn-sm">চেক করুন</button></form><div className="mt"><Val v={resultBox(result)} /></div>{(result && result.ok && result.cached_at ? <p className="small muted">২৪ ঘণ্টার ভেতরের আগের চেক।{' '}<a href={`${attrValue(BASE)}?phone=${attrValue(phone)}&fresh=1`}>আবার নতুন করে চেক করুন</a></p> : null)}</section><section className="panel"><h2>⚙️ কোথা থেকে তথ্য আসে</h2><ul className="small"><li>🏪{' '}<b>এই দোকানের অর্ডার</b>{' '}— সবসময়।</li><li>🚚{' '}<b>Pathao</b>{' '}—{' '}{(courier.configured(s, 'pathao') ? "✅ সংযুক্ত (কুরিয়ার সেটিংস)" : <>সংযুক্ত নেই —{' '}<a href="/admin/integrations/courier">কুরিয়ার সেটিংস</a></>)}</li><li>🌐{' '}<b>FraudBD</b>{' '}(fraudbd.com) — Steadfast, Pathao, RedX, Paperfly সব কুরিয়ারে এই নম্বরের পার্সেল কতগুলো সফল/বাতিল।{' '}{(hasKey ? "✅ key দেওয়া আছে" : "key দেওয়া নেই")}</li></ul>{(ctx.can('settings') ? <form method="post" action={attrValue(BASE)} className="form"><Val v={ui.field('FraudBD API key', ui.input('fraudbd_api_key', '', { type: 'password', maxlength: 200, autocomplete: 'off', placeholder: hasKey ? '•••••••• (সেভ করা আছে — বদলাতে নতুনটা দিন)' : 'fraudbd.com এ অ্যাকাউন্ট খুলে API key কপি করুন' }), 'প্রতি চেকে তাদের প্যাকেজ থেকে ক্রেডিট কাটে; একই নম্বর ২৪ ঘণ্টায় একবারই চেক হয়।')} />{' '}{(hasKey ? <Val v={ui.check('clear_key', false, 'key মুছে দিন')} /> : null)}{' '}<Val v={ui.switchRow('fraud_auto', s.fraud_auto === '1', 'নতুন অর্ডার এলে নিজে থেকে চেক', 'ঝুঁকিপূর্ণ নম্বর হলে অর্ডারের ভেতরের নোটে ⛔ লেখা হবে, আর মালিকের ফোনে নোটিফিকেশন যাবে (চালু থাকলে)।')} />{' '}<Val v={ui.switchRow('fraud_hold', s.fraud_hold === '1', 'ঝুঁকিপূর্ণ হলে অর্ডার "হোল্ডে" রাখুন', 'কল করে নিশ্চিত না হওয়া পর্যন্ত কুরিয়ারে যাবে না।')} />{' '}<button className="btn btn-sm">সেভ করুন</button></form> : null)}</section></div><section className="panel table-wrap"><h2>সম্প্রতি চেক করা নম্বর</h2>{(recent.length ? <table className="table compact"><thead><tr><th>নম্বর</th><th>ফল</th><th className="num">সব কুরিয়ারে</th><th>কখন</th></tr></thead><tbody>{jsxList(recent.map((r) => { const j = fraud.judge({ delivered: 0, failed: 0, last_day: 0 }, r.data.pathao, r.data.fraudbd); return <tr><td className="mono"><a href={`${attrValue(BASE)}?phone=${attrValue(r.phone)}`}><Val v={r.phone} /></a></td><td><span className={`risk-dot risk-${attrValue(j.level)}`}><Val v={j.label} /></span></td><td className="num">{(j.total ? <><Val v={bn(j.success)} />/<Val v={bn(j.total)} />{' '}(<Val v={bn(j.rate)} />%)</> : "—")}</td><td className="small"><Val v={fmtDate(r.checked_at)} /></td></tr>; }))}</tbody></table> : <p className="muted">এখনো কিছু নেই।</p>)}</section></>);
  return ctx.page('ফ্রড চেক', body, 'fraud');
}

export const routes = [{ method: '*', path: BASE, perm: (ctx: AdminCtx) => (ctx.method === 'POST' ? 'settings' : 'orders'), handler: page }];
