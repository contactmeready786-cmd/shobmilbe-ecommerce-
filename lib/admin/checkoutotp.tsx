// Admin → অর্ডার ও কাস্টমার → 🔐 চেকআউট OTP (ফেক অর্ডার বন্ধ): switch it on/off, the SMS text, how long a checked number is
// remembered, what happens when SMS can't go, the daily limit — and what happened lately (codes, orders by how they were checked).
import { toHtml, Val, attrValue, jsxList } from '../react/html';
import { html, raw, str, int, bn, fmtDate } from '../util';
import * as db from '../db';
import * as ui from './ui';
import * as CO from '../models/checkoutotp';
import * as $services_sms from '../services/sms';
import type { AdminCtx, Loose } from '../types';

const BASE = '/admin/checkout-otp';

async function page(ctx: AdminCtx) {
  const s = ctx.settings;
  const SMS = $services_sms;
  if (ctx.method === 'POST') {
    const b = await ctx.body();
    let tpl = str(b.co_otp_sms, 200).trim();
    if (tpl && !tpl.includes('{code}')) return ctx.fail(BASE, 'SMS-এর লেখায় {code} অবশ্যই রাখুন — ওখানেই কোডটা বসে।');
    if (tpl === CO.DEF_SMS) tpl = '';
    await db.setMany({
      co_otp_on: b.co_otp_on ? '1' : '0', co_otp_sms: tpl,
      co_otp_remember_days: String(Math.max(0, Math.min(365, int(b.co_otp_remember_days)))),
      co_otp_daily_cap: String(Math.max(0, Math.min(100000, int(b.co_otp_daily_cap)))),
      co_otp_webotp: b.co_otp_webotp ? '1' : '0',
    });
    await ctx.log('settings', 'settings', null, `চেকআউট OTP: ${b.co_otp_on ? 'চালু' : 'বন্ধ'}`);
    return ctx.back(BASE, 'saved');
  }
  const [st, recent, lastSms, lastGw] = await Promise.all([CO.stats(), CO.recent(30),
    db.one(`SELECT ok, detail, phone, created_at FROM sms_log WHERE kind='checkout_otp' ORDER BY id DESC LIMIT 1`).catch(() => null),
    db.one(`SELECT id, gw_id, gw_state, phone, created_at FROM checkout_otps WHERE gw_id<>'' ORDER BY id DESC LIMIT 1`).catch(() => null)]);
  // 📱 the phone's answer for the newest code (asked live)
  const gw = lastGw ? await CO.phoneState(s, lastGw) : null;
  const gwBad = gw && (gw.state === 'Failed' || gw.state === 'Pending');
  const ready = CO.sendReady(s);
  const smsOk = ready.ok;
  const on = s.co_otp_on === '1';
  const o30 = st!.orders30 || {};
  const checked30 = (o30.otp || 0) + (o30.remembered || 0) + (o30.account || 0);
  const tpl = s.co_otp_sms || CO.DEF_SMS;
  const sample = tpl.replace(/\{shop\}/g, s.store_name || '').replace(/\{code\}/g, '4827').replace(/\{min\}/g, bn(CO.CODE_MIN));
  const body = toHtml(<><h1>🔐 চেকআউট OTP (ফেক অর্ডার বন্ধ)</h1><Val v={ui.flash(ctx.flash)} /><div className="kpis kpis-tight"><Val v={ui.kpi('অবস্থা', on ? '✅ চালু' : '⚪ বন্ধ', on ? 'OTP ছাড়া অর্ডার হচ্ছে না' : 'আগের মতো সরাসরি অর্ডার হচ্ছে')} />{' '}<Val v={ui.kpi('গত ২৪ ঘণ্টায় কোড', bn(st!.sent24), `সঠিক দিয়েছেন ${bn(st!.ok24)} জন${st!.fail24 ? ` · SMS যায়নি ${bn(st!.fail24)}` : ''}`)} />{' '}<Val v={ui.kpi('৩০ দিনে যাচাই হওয়া অর্ডার', bn(checked30), '')} />{' '}<Val v={ui.kpi('কোড নিয়েও অর্ডার করেননি', bn(st!.never30), 'গত ৩০ দিনে — এদের অনেকেই ফেক / অন্যের নম্বর')} /></div><Val v={ui.helpBox('কীভাবে কাজ করে', toHtml(<ol className="steps"><li>চেকআউটে কাস্টমার মোবাইল নম্বর লিখলে নিচে একটা ঘর আর{' '}<b>"OTP পাঠান"</b>{' '}বাটন আসে। চাপলে ঐ নম্বরে SMS-এ ৪ অঙ্কের কোড যায় ({bn(CO.CODE_MIN)}{' '}মিনিট কাজ করে)।</li><li>কোডটা লিখলেই নিজে থেকে যাচাই হয়ে সবুজ{' '}<b>"✅ নম্বর যাচাই হয়েছে"</b>{' '}দেখায়, তারপর অর্ডার কনফার্ম হয়। কোড ছাড়া অর্ডার যায় না — তাই অন্যের নম্বর দিয়ে ফেক অর্ডার করা যায় না।</li><li>কাস্টমার না বুঝে সরাসরি "অর্ডার কনফার্ম করুন" চাপলেও কোড নিজে থেকে চলে যায়; কোড লিখলেই অর্ডার চলে যায় — আবার বাটন চাপতে হয় না।</li><li>একটাই সুইচ:{' '}<b>বন্ধ</b>{' '}থাকলে চেকআউটে OTP-র ঘর আসেই না, আগের মতো অর্ডার হয়।{' '}<b>চালু</b>{' '}থাকলে OTP ছাড়া কোনোভাবেই অর্ডার হয় না — SMS-এ সমস্যা থাকলেও না।</li><li>কাস্টমারের সুবিধা: একবার যাচাই করা নম্বরে ঐ ব্রাউজারে আর কোড লাগে না (নিচে দিন ঠিক করুন), লগইন করা কাস্টমারের নিজের নম্বরে লাগে না, ৬০ সেকেন্ড পর "আবার পাঠান" করা যায়, SMS না এলে আপনার ফোন নম্বর দেখায় যাতে কল করে অর্ডার দিতে পারেন।</li><li>⚠️ চালু থাকা অবস্থায় SMS কোম্পানির সমস্যা হলে, ব্যালান্স শেষ হলে বা দৈনিক সীমা পার হলে কাস্টমার কোড পাবেন না — তখন ওয়েবসাইট থেকে অর্ডারও হবে না। এমন হলে SMS ঠিক না হওয়া পর্যন্ত সুইচটা বন্ধ করে দিন।</li><li>অপব্যবহার রোধ (প্রতিটা কোড = ১টা SMS খরচ): এক নম্বরে ১০ মিনিটে ৩টা ও দিনে ৬টা কোড, এক সংযোগ থেকে ঘণ্টায় ৮টা, একটা কোডে ৫ বারের বেশি ভুল নয়, ব্লক লিস্টের নম্বরে কোড যায় না।</li><li>প্রতিটা অর্ডারে দেখবেন কীভাবে নম্বর যাচাই হয়েছে: ✅ OTP যাচাই / ✅ আগে যাচাই / ✅ লগইন।</li></ol>))} />{' '}{(gw && gw.state ? <p className={`flash ${gwBad ? 'flash-error' : ''}`}>📱 শেষ কোডটা ফোনে:{' '}<b><Val v={CO.STATE_BN[gw.state] || gw.state} /></b>{(gw.error ? ` — ${gw.error}` : null)}{' '}(<Val v={lastGw!.phone} />,{' '}{fmtDate(lastGw!.created_at)}){(gwBad ? <><br /><span className="small">{(gw.state === 'Pending' ? "SMS Gateway অ্যাপ খুলে Online করুন। ফোনে অ্যাপের Battery → Unrestricted আর Autostart চালু রাখুন, যাতে ফোন অ্যাপটা বন্ধ না করে।" : "SIM-এ ব্যালান্স/SMS প্যাক, নেটওয়ার্ক আর অ্যাপের SMS অনুমতি দেখুন।")}{' '}কোড না গেলে আপনাকে নোটিফিকেশন / WhatsApp / ইমেইলে জানানো হয় (যেটা{' '}<a href="/admin/notify">নোটিফিকেশন</a>{' '}পেজে চালু আছে)।</span></> : null)}</p> : null)}{' '}{(lastSms ? <p className={`flash ${lastSms.ok ? '' : 'flash-error'}`}>{(lastSms.ok ? "✅ শেষ কোডের SMS ফোনে পৌঁছে দেওয়া হয়েছে" : "❌ শেষ কোডের SMS যায়নি")}{' '}(<Val v={lastSms.phone} />,{' '}{fmtDate(lastSms.created_at)}) —{' '}<Val v={lastSms.detail} /></p> : null)}<section className="panel"><form method="post" action={attrValue(BASE)} className="form">{(!smsOk ? <p className="flash flash-error">{(on ? <><b>⚠️ জরুরি: OTP চালু, কিন্তু SMS কাজ করছে না (<Val v={ready.why} />) — এই মুহূর্তে কাস্টমাররা ওয়েবসাইট থেকে অর্ডার করতে পারছেন না!</b>{' '}<a href="/admin/marketing/sms">কাস্টমারকে SMS</a>{' '}পেজে SMS ঠিক করুন, অথবা নিচের সুইচ বন্ধ করে সেভ করুন।</> : <>SMS চালু নেই — OTP চালু করার আগে{' '}<a href="/admin/marketing/sms">কাস্টমারকে SMS</a>{' '}পেজে SMS সেটআপ করুন ও টেস্ট SMS পাঠিয়ে দেখুন। না হলে চালু করলে কেউ অর্ডার করতে পারবেন না।</>)}</p> : null)}{' '}<Val v={ui.switchRow('co_otp_on', on, 'চেকআউটে OTP চালু', 'চালু: মোবাইল নম্বর OTP দিয়ে যাচাই না করে ওয়েবসাইট থেকে অর্ডার হবে না (SMS-এ সমস্যা থাকলেও না)। বন্ধ: OTP-র ঘর আসবে না, আগের মতো সরাসরি অর্ডার হবে।')} />{' '}<Val v={ui.field('একবার যাচাই হলে আর কতদিন কোড লাগবে না (ঐ ব্রাউজারে)', ui.select('co_otp_remember_days', [['0', 'প্রতিবার কোড লাগবে'], ['7', '৭ দিন'], ['30', '৩০ দিন (সাজেস্টেড)'], ['90', '৯০ দিন'], ['180', '১৮০ দিন']], s.co_otp_remember_days || '30'),
      'একই কাস্টমার বারবার অর্ডার করলে প্রতিবার SMS খরচ হবে না, কাস্টমারেরও ঝামেলা কম। অন্য ফোন / ব্রাউজার থেকে করলে আবার কোড লাগবে।')} />{' '}<Val v={ui.field('দিনে সর্বোচ্চ কতটা কোড যাবে (পুরো দোকানে)', ui.input('co_otp_daily_cap', s.co_otp_daily_cap || '500', { type: 'number', min: 0, max: 100000 }),
      'কেউ ইচ্ছা করে অনেক নম্বরে কোড চাইলে আপনার SMS ব্যালান্স শেষ হবে না। সীমা পার হলে সেদিন আর কোড যাবে না (কাস্টমারকে কল করতে বলা হবে) — তাই বিক্রি বাড়লে সীমাটা বাড়িয়ে দিন। ০ = কোনো সীমা নেই।')} />{' '}<Val v={ui.field('কোডের SMS', ui.textarea('co_otp_sms', tpl, { rows: 2, maxlength: 200 }),
      toHtml(<><code>{"{shop}"}</code>{' '}দোকানের নাম,{' '}<code>{"{code}"}</code>{' '}কোড (অবশ্যই রাখুন),{' '}<code>{"{min}"}</code>{' '}কত মিনিট কাজ করবে। উদাহরণ: "<Val v={sample} />" —{' '}{bn(sample.length)}{' '}অক্ষর ≈{' '}{bn(SMS.parts(sample))}টি SMS। বাংলা SMS ৭০ অক্ষরে ১টা; ছোট রাখলে খরচ কম।</>))} />{' '}<Val v={ui.switchRow('co_otp_webotp', s.co_otp_webotp === '1', 'অ্যান্ড্রয়েডে কোড নিজে থেকে বসবে', 'SMS-এর শেষে "@আপনার-ডোমেইন #কোড" লাইন যোগ হয় — Android-এর Chrome তখন কোডটা নিজেই ঘরে বসিয়ে দেয়। শুধু আসল ডোমেইনে (shobmilbe.com) কাজ করে; SMS একটু লম্বা হয়ে ২টা SMS হতে পারে।')} />{' '}<button className="btn">সেভ করুন</button></form></section><section className="panel table-wrap"><h2>সর্বশেষ কোড</h2>{(recent.length ? <table className="table compact"><thead><tr><th>মোবাইল</th><th>অবস্থা</th><th className="num">ভুল চেষ্টা</th><th>সময়</th></tr></thead><tbody>{jsxList(recent.map((r) => <tr><td className="mono small"><a href={`/admin/customers?q=${attrValue(r.phone)}`}><Val v={r.phone} /></a></td><td>{(r.verified_at ? <span className="pill pill-ok">✅ সঠিক কোড দিয়েছেন</span> : (!r.sent_ok ? <span className="pill pill-warn">⚠️ SMS যায়নি</span> : <span className="pill">⏳ কোড দেননি</span>))}</td><td className="num">{bn(r.tries)}</td><td className="small">{fmtDate(r.created_at)}</td></tr>))}</tbody></table> : <p className="muted">এখনো কোনো কোড পাঠানো হয়নি।</p>)}<p className="small muted">প্রতিটা SMS-এর বিস্তারিত (কোম্পানির উত্তর) দেখতে:{' '}<a href="/admin/marketing/sms">কাস্টমারকে SMS</a>{' '}→ SMS লগ।</p></section></>);
  return ctx.page('চেকআউট OTP', body, 'checkout-otp');
}

export const routes = [{ method: '*', path: BASE, perm: 'settings', handler: page }];
