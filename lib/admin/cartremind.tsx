// Admin → মার্কেটিং → 🔔 ফোনে অফারের নোটিফিকেশন → 🛒 কার্ট রিমাইন্ডার (lib/services/cartremind.ts):
// one on/off switch, the 3 messages (customer words stay Bangla), and what came of them in the last 30 days.
import { attrValue, jsxList } from '../react/html';
import { str, bn, money } from '../util';
import * as db from '../db';
import * as ui from './ui';
import * as CR from '../services/cartremind';
import type { Body, Settings } from '../types';

const WHEN = ['১ ঘণ্টা পরে', '২৪ ঘণ্টা পরে', '৭২ ঘণ্টা পরে'];
const HINT = '{product} = কার্টের প্রথম পণ্যের নাম, {more} = "সহ আরও ২টি পণ্য"। স্টক ৫টার কম হলে "স্টকে আর মাত্র …টি আছে" আর দাম কমলে "দাম কমেছে" নিজে থেকে যোগ হয় — শুধু যখন সত্যি।';
const ON_TIP = 'কেউ কার্টে পণ্য রেখে কেনেনি: ১ ঘণ্টা, ২৪ ঘণ্টা আর ৭২ ঘণ্টা পরে মোট ৩ বার মনে করিয়ে দেয়, তারপর থামে। রাত ১০টা থেকে সকাল ৯টা যায় না। অর্ডার করলে, কার্ট খালি করলে বা পণ্য স্টক আউট হলে নিজে থেকে বন্ধ। যারা নোটিফিকেশনে "হ্যাঁ" দিয়েছেন তাদের ফোনে, আর অ্যাকাউন্ট আছে ও অফারের ইমেইল তালিকায় আছেন এমন কাস্টমারের ইমেইলে।';

export async function section(s: Settings, action: string) {
  const st = await CR.stats();
  const on = s.cart_remind_on === '1';
  return <section className="set-sec"><div className="set-head"><h2 className="set-title">🛒 কার্ট রিমাইন্ডার</h2></div>
    <div className="kpis kpis-tight">{ui.kpi('অবস্থা', on ? '✅ চালু' : '⚪ বন্ধ', s.shoppush_on === '1' ? '' : 'নোটিফিকেশন বন্ধ — শুধু ইমেইল')}{' '}{ui.kpi('অপেক্ষায় থাকা কার্ট', bn(st.waiting), '')}{' '}{ui.kpi('রিমাইন্ডার গেছে (৩০ দিন)', bn(st.sends), `১ঘ: ${bn(st.s1)} · ২৪ঘ: ${bn(st.s2)} · ৭২ঘ: ${bn(st.s3)}`, 'kpi-blue')}{' '}{ui.kpi('চেপে দেখেছেন', bn(st.clicks), '')}{' '}{ui.kpi('ফিরে এসে অর্ডার', bn(st.won), money(st.won_total), 'kpi-green')}</div>
    <div className="panel set-card"><form method="post" action={attrValue(action)} className="form"><input type="hidden" name="action" defaultValue="cartremind" />
      {ui.switchRow('cart_remind_on', on, 'কার্ট রিমাইন্ডার চালু', ON_TIP)}
      <table className="table compact"><thead><tr><th>কখন</th><th>শিরোনাম</th><th>লেখা</th></tr></thead><tbody>
        {jsxList([1, 2, 3].map((n) => <tr><td className="small nowrap">{WHEN[n - 1]}</td>
          <td>{ui.input(`cart_remind_t${n}`, CR.text(s, `cart_remind_t${n}`), { maxlength: 60, 'aria-label': `শিরোনাম ${n}` })}</td>
          <td>{ui.input(`cart_remind_b${n}`, CR.text(s, `cart_remind_b${n}`), { maxlength: 160, 'aria-label': `লেখা ${n}` })}</td></tr>))}
      </tbody></table>
      <p className="small muted">{HINT}</p>      <button className="btn btn-sm">সেভ করুন</button></form></div></section>;
}

export async function save(b: Body) {
  const set: Record<string, string> = { cart_remind_on: b.cart_remind_on ? '1' : '0' };
  for (const n of [1, 2, 3]) {
    for (const [k, max] of [[`cart_remind_t${n}`, 60], [`cart_remind_b${n}`, 160]] as [string, number][]) {
      const v = str(b[k], max).trim();
      set[k] = v === CR.DEFAULT_TEXT[k] ? '' : v; // an empty box = the ready-made words
    }
  }
  await db.setMany(set);
}
