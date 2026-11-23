// Admin → অর্ডার ও কাস্টমার → 👤 কাস্টমার অ্যাকাউন্ট (OTP লগইন): switch customer login on/off, the SMS text,
// and who logged in lately. Customers open an account with 📧 e-mail (code by the shop's Gmail, free) or
// 📱 mobile (code by SMS) — once; logged in, they order without any more codes.
import { Val, attrValue, jsxList } from '../react/html';
import { str, bn, fmtDate } from '../util';
import * as db from '../db';
import * as ui from './ui';
import * as $services_sms from '../services/sms';
import * as $services_notify from '../services/notify';
import type { AdminCtx } from '../types';

const BASE = '/admin/customer-accounts';

async function page(ctx: AdminCtx) {
  const s = ctx.settings;
  if (ctx.method === 'POST') {
    const b = await ctx.body();
    if (b.mail_form) return ctx.back(BASE); // the separate Gmail form is gone: the shop's one Gmail is set on আমার নোটিফিকেশন
    const SMS = $services_sms;
    const mailOk = $services_notify.acctEmailConfig(s).ready;
    if (b.acct_on && !SMS.ready(s).ok && !mailOk) return ctx.fail(BASE, `আগে অন্তত একটা চালু করুন: ইমেইল (নোটিফিকেশন পেজে Gmail App Password) অথবা SMS (মার্কেটিং → কাস্টমারকে SMS)। এখন SMS: ${SMS.ready(s).why}।`);
    await db.setMany({ acct_on: b.acct_on ? '1' : '0', nav_account: b.nav_account ? '1' : '0', acct_otp_sms: str(b.acct_otp_sms, 200) });
    await ctx.log('settings', 'settings', null, `কাস্টমার অ্যাকাউন্ট: ${b.acct_on ? 'চালু' : 'বন্ধ'}`);
    return ctx.back(BASE, 'saved');
  }
  const [stats, recent] = await Promise.all([
    db.one<{ users: number; active30: number; email_users: number; addresses: number; codes24: number; ecodes24: number }>(`SELECT count(*) FILTER (WHERE last_login IS NOT NULL)::int AS users, count(*) FILTER (WHERE last_login > now() - interval '30 days')::int AS active30,
      count(*) FILTER (WHERE email_verified AND phone IS NULL)::int AS email_users,
      (SELECT count(*)::int FROM customer_addresses) AS addresses, (SELECT count(*)::int FROM customer_otps WHERE created_at > now() - interval '1 day') AS codes24,
      (SELECT count(*)::int FROM customer_email_otps WHERE created_at > now() - interval '1 day') AS ecodes24 FROM customers`),
    db.q<{ id: number; name: string; phone: string | null; email: string; email_verified: boolean; contact_phone: string; last_login: Date | null; orders: number }>(`SELECT id, name, phone, email, email_verified, contact_phone, last_login,
      (SELECT count(*)::int FROM orders o WHERE (o.phone=c.phone AND c.phone IS NOT NULL) OR o.account_id=c.id) AS orders FROM customers c WHERE last_login IS NOT NULL ORDER BY last_login DESC LIMIT 30`),
  ]);
  const smsOk = $services_sms.ready(s).ok;
  const N = $services_notify;
  const mc = N.acctEmailConfig(s);
  const mailOk = mc.ready;
  const def = '{shop}: আপনার লগইন কোড {code}। {min} মিনিট কাজ করবে। কাউকে বলবেন না।';
  // (owner, 2026-11-23: "big boxes, information shown big — make it a tidy, professional page"): numbers in one slim
  // row; settings as one card (how codes are sent → on/off rows → SMS text → Save) beside the recent-logins list.
  const chan = (icon: string, name: string, on: boolean, detail: unknown, link: string, linkText: string) => <div className="chan-row"><span className="chan-ic" aria-hidden="true">{icon}</span><span className="chan-t"><b>{name}</b><small><Val v={detail} /></small></span>{on ? ui.pill('চালু', 'pill-delivered') : ui.pill('বন্ধ', 'pill-pending')}<a className="btn btn-sm btn-ghost" href={link}>{linkText}</a></div>;
  const body = <><div className="title-row"><h1>👤 কাস্টমার অ্যাকাউন্ট (OTP লগইন)</h1></div>{ui.flash(ctx.flash)}<div className="kpis kpis-tight">{ui.kpi('অবস্থা', s.acct_on === '1' ? '✅ চালু' : '⚪ বন্ধ', '')}{' '}{ui.kpi('লগইন করেছেন', bn(stats!.users), `গত ৩০ দিনে ${bn(stats!.active30)} জন`)}{' '}{ui.kpi('সেভ করা ঠিকানা', bn(stats!.addresses), '')}{' '}{ui.kpi('গত ২৪ ঘণ্টায় কোড', bn(stats!.codes24 + stats!.ecodes24), `📱 ${bn(stats!.codes24)} · 📧 ${bn(stats!.ecodes24)}`)}</div><div className="acct-grid acct-v2"><form method="post" action={attrValue(BASE)} className="set-sec"><div className="set-head"><h2 className="set-title">⚙️ সেটিংস</h2></div><div className="set-card"><p className="set-sub">লগইন কোড যেভাবে যায়</p><div className="chan-list">{chan('📧', 'ইমেইল', mailOk, mailOk ? <>দোকানের Gmail{' '}<span translate="no">{N.maskEmail(mc.user)}</span>{' '}থেকে · ফ্রি</> : 'দোকানের Gmail সেটআপ বাকি', '/admin/notify', mailOk ? 'বদলান' : 'সেটআপ')}{chan('📱', 'মোবাইল (SMS)', smsOk, smsOk ? 'SMS কাজ করছে' : 'SMS সেটআপ করলে চালু হবে', '/admin/marketing/sms', smsOk ? 'বদলান' : 'সেটআপ')}</div>{(!smsOk && !mailOk ? <p className="flash flash-error">ইমেইল বা SMS — অন্তত একটা সেটআপ না করলে অ্যাকাউন্ট খোলা যাবে না।</p> : null)}<div className="switch-list">{ui.switchRow('acct_on', s.acct_on === '1', 'কাস্টমার অ্যাকাউন্ট চালু', 'বন্ধ করলে লগইন, "আমার অ্যাকাউন্ট" পেজ আর উপরের 👤 বাটন থাকবে না। আগের সেভ করা ঠিকানা মুছবে না।')}{ui.switchRow('nav_account', s.nav_account !== '0', 'হেডারে 👤 অ্যাকাউন্ট বাটন', 'বন্ধ করলে বাটনটা উপরে দেখাবে না (মোবাইলের মেনু আর ফুটারে লিংক থাকবে)।')}</div>{ui.field('লগইন কোডের SMS', ui.textarea('acct_otp_sms', s.acct_otp_sms || def, { rows: 2, maxlength: 200 }), <><code>{"{shop}"}</code>{' '}দোকানের নাম,{' '}<code>{"{code}"}</code>{' '}কোড (অবশ্যই রাখুন),{' '}<code>{"{min}"}</code>{' '}কত মিনিট কাজ করবে।</>)}<div className="form-actions-inline"><button className="btn btn-sm">💾 সেভ করুন</button></div></div></form><section className="set-sec"><div className="set-head"><h2 className="set-title">সম্প্রতি লগইন করেছেন</h2><span className="sb-chip is-off">{bn(recent.length)} জন</span></div><div className="set-card acct-recent">{(recent.length ? <table className="table compact"><thead><tr><th>কাস্টমার</th><th>মোবাইল</th><th className="num">অর্ডার</th><th>শেষ লগইন</th></tr></thead><tbody>{jsxList(recent.map((c) => <tr><td><a href={`/admin/customers/${attrValue(c.id)}`}><Val v={c.name || '(নাম দেননি)'} /></a>{(c.email_verified && !c.phone ? <><br /><span className="small muted">📧{' '}<Val v={c.email} /></span></> : null)}</td><td className="mono small"><Val v={c.phone || c.contact_phone || '—'} /></td><td className="num">{bn(c.orders)}</td><td className="small">{fmtDate(c.last_login)}</td></tr>))}</tbody></table> : <div className="empty-mini"><span aria-hidden="true">👤</span><p>এখনো কেউ লগইন করেননি।</p></div>)}</div></section></div></>;
  return ctx.page('কাস্টমার অ্যাকাউন্ট', body, 'cust-accounts');
}

export const routes = [{ method: '*', path: BASE, perm: 'settings', handler: page }];
