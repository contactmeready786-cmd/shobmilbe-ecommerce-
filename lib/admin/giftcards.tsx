// Admin → মার্কেটিং → 💳 গিফট কার্ড ও 🎁 রেফারেল.
//   Gift cards: sell / give one here (code goes by SMS), check the shop's online requests (TrxID) and switch them on,
//   see every card's balance and history, switch a card off or change its balance.
//   Referral: switch on, what the new friend gets and what the sharer gets.
import { toHtml, Val, attrValue, jsxList } from '../react/html';
import { html, int, str, bn, money, fmtDate, ymd } from '../util';
import * as db from '../db';
import * as ui from './ui';
import * as G from '../models/giftcards';
import * as finance from '../models/finance';
import type { AdminCtx, Loose } from '../types';

const BASE = '/admin/giftcards';
const PILL: Record<string, string> = { pending: 'pill-warn', active: 'pill-ok', used: '', disabled: '', expired: '' };

async function listPage(ctx: AdminCtx) {
  const s = ctx.settings;
  if (ctx.method === 'POST') {
    const b = await ctx.body();
    if (b.action === 'gift_settings') {
      await db.setMany({ gift_on: b.gift_on ? '1' : '0', gift_sell_online: b.gift_sell_online ? '1' : '0', gift_amounts: String(b.gift_amounts || '').split(/[,\s]+/).map((x) => Math.round(Number(x))).filter((x) => x > 0).slice(0, 8).join(','),
        gift_min: String(Math.max(1, int(b.gift_min, 200))), gift_max: String(Math.max(1, int(b.gift_max, 20000))), gift_valid_days: String(Math.max(0, int(b.gift_valid_days, 365))), gift_sms: str(b.gift_sms, 300) });
      await ctx.log('settings', 'marketing', null, `গিফট কার্ড: ${b.gift_on ? 'চালু' : 'বন্ধ'}`);
      return ctx.back(BASE, 'saved');
    }
    if (b.action === 'ref_settings') {
      await db.setMany({ ref_on: b.ref_on ? '1' : '0', ref_friend_amount: String(Math.max(0, int(b.ref_friend_amount))), ref_friend_min: String(Math.max(0, int(b.ref_friend_min))),
        ref_reward_amount: String(Math.max(0, int(b.ref_reward_amount))), ref_reward_days: String(Math.max(0, int(b.ref_reward_days, 90))) });
      await ctx.log('settings', 'marketing', null, `রেফারেল: ${b.ref_on ? 'চালু' : 'বন্ধ'}, বন্ধু ৳${int(b.ref_friend_amount)}, পুরস্কার ৳${int(b.ref_reward_amount)}`);
      return ctx.back(BASE + '#referral', 'saved');
    }
    if (b.action === 'issue') {
      try {
        const card = await G.issue({ amount: b.amount, status: 'active', source: 'admin', buyerName: b.buyer_name, buyerPhone: b.buyer_phone, recipientName: b.recipient_name,
          recipientPhone: b.recipient_phone, message: b.message, validDays: b.valid_days, price: b.price === '' || b.price === undefined ? null : b.price, note: b.note, staffId: ctx.user.id });
        await ctx.log('giftcard_issue', 'giftcard', card.id, `${G.pretty(card.code)} ৳${card.initial}`);
        // money received for the card → income in the accounts (optional)
        if (int(b.account_id) && Number(card.price) > 0 && ctx.can('accounting')) {
          await finance.addTransaction({ type: 'income', category: 'গিফট কার্ড বিক্রি', amount: card.price, account_id: b.account_id, note: `গিফট কার্ড ${G.pretty(card.code)}` }, ctx.user.id);
        }
        let note = '';
        if (b.sms === '1' && card.recipient_phone) { const r = await G.sendCodeSms(ctx.settings, card); note = r.ok ? ' কোড SMS-এ পাঠানো হয়েছে।' : ` (SMS যায়নি: ${r.msg})`; }
        return ctx.redirect(`${BASE}/${card.id}?info=` + encodeURIComponent(`গিফট কার্ড তৈরি হয়েছে: ${G.pretty(card.code)}.${note}`));
      } catch (e) { if (!(e instanceof G.GiftError)) throw e; return ctx.fail(BASE, e.message); }
    }
    return ctx.back(BASE);
  }
  const status = G.STATUSES[ctx.query.get('status')] ? ctx.query.get('status') : '';
  const q = str(ctx.query.get('q'), 40);
  const [rows, st, accounts] = await Promise.all([G.list({ status, q }), G.stats(), ctx.can('accounting') ? finance.listAccounts() : []]);
  const R = G.refCfg(s);
  const refStats = await db.one(`SELECT count(*) FILTER (WHERE ref_by IS NOT NULL AND status<>'cancelled')::int AS orders, count(*) FILTER (WHERE ref_rewarded)::int AS rewarded,
    coalesce(sum(ref_discount) FILTER (WHERE status<>'cancelled'),0)::numeric(14,2) AS given FROM orders`);
  const body = toHtml(<><div className="title-row"><h1>💳 গিফট কার্ড ও 🎁 রেফারেল</h1><div className="row-actions"><a className="btn btn-ghost btn-sm" href={attrValue(BASE)}>🔄 রিফ্রেশ</a>{(s.gift_on === '1' ? <a className="btn btn-ghost btn-sm" href="/gift-card" target="_blank" rel="noopener">দোকানের পেজ ↗</a> : null)}</div></div><Val v={ui.flash(ctx.flash)} /><div className="kpis kpis-tight"><Val v={ui.kpi('যাচাই বাকি', bn(st!.pending), 'অনলাইনে কেনার অনুরোধ', st!.pending ? 'kpi-alert' : '', `${BASE}?status=pending`)} />{' '}<Val v={ui.kpi('কার্ডে জমা টাকা', money(st!.outstanding), 'কাস্টমার এখনো খরচ করেননি (আপনার দেনা)')} />{' '}<Val v={ui.kpi('মোট বিক্রি', money(st!.sold), `${bn(st!.n)}টি কার্ড`)} />{' '}<Val v={ui.kpi('রেফারেল', `${bn(refStats!.orders)} অর্ডার`, `${bn(refStats!.rewarded)}টি পুরস্কার · ছাড় ${money(refStats!.given)}`)} /></div><div className="two-col"><section className="panel"><h2>➕ নতুন গিফট কার্ড দিন / বিক্রি করুন</h2><form method="post" action={attrValue(BASE)} className="form"><input type="hidden" name="action" defaultValue="issue" /><div className="field-row"><Val v={ui.field('কার্ডে টাকা (৳)', ui.input('amount', '', { type: 'number', min: 1, required: true, class: 'w-num' }))} />{' '}<Val v={ui.field('কাস্টমার কত দিয়েছেন (৳)', ui.input('price', '', { type: 'number', min: 0, class: 'w-num' }), 'খালি = কার্ডের সমান; উপহার দিলে ০')} />{' '}<Val v={ui.field('মেয়াদ (দিন)', ui.input('valid_days', s.gift_valid_days || 365, { type: 'number', min: 0, class: 'w-num' }), '০ = মেয়াদ নেই')} /></div><div className="field-row"><Val v={ui.field('প্রাপকের নাম', ui.input('recipient_name', '', { maxlength: 80 }))} /><Val v={ui.field('প্রাপকের মোবাইল', ui.input('recipient_phone', '', { maxlength: 20, inputmode: 'tel' }), 'কোড এখানে SMS-এ যাবে')} /></div><div className="field-row"><Val v={ui.field('ক্রেতার নাম', ui.input('buyer_name', '', { maxlength: 80 }))} /><Val v={ui.field('ক্রেতার মোবাইল', ui.input('buyer_phone', '', { maxlength: 20, inputmode: 'tel' }))} /></div><Val v={ui.field('শুভেচ্ছা বার্তা (SMS-এ যাবে)', ui.input('message', '', { maxlength: 120 }))} />{' '}{(accounts.length ? <Val v={ui.field('টাকা কোন অ্যাকাউন্টে এসেছে (হিসাবে আয় লেখা হবে)', ui.select('account_id', [['', '— লিখবেন না —'], ...accounts.filter((a) => a.active).map((a) => [a.id, a.name])], ''))} /> : null)}{' '}<Val v={ui.field('ভেতরের নোট', ui.input('note', '', { maxlength: 200 }))} />{' '}<Val v={ui.check('sms', true, 'প্রাপককে কোড SMS করুন')} />{' '}<button className="btn">গিফট কার্ড তৈরি করুন</button></form></section><section className="panel"><h2>⚙️ গিফট কার্ড সেটিংস</h2><form method="post" action={attrValue(BASE)} className="form"><input type="hidden" name="action" defaultValue="gift_settings" />{' '}<Val v={ui.switchRow('gift_on', s.gift_on === '1', 'গিফট কার্ড চালু', 'চেকআউটে "গিফট কার্ড আছে?" ঘর, "আমার অ্যাকাউন্ট" এ গিফট কার্ড, আর ফুটারে লিংক।')} />{' '}<Val v={ui.switchRow('gift_sell_online', s.gift_sell_online !== '0', 'দোকানে অনলাইনে বিক্রি (/gift-card)', 'কাস্টমার Send Money করে TrxID দেন; আপনি এখানে যাচাই করে চালু করেন। (পেমেন্ট সেটিংসে Send Money নম্বর থাকতে হবে)')} />{' '}<Val v={ui.field('বাছাইয়ের পরিমাণ (কমা দিয়ে)', ui.input('gift_amounts', s.gift_amounts || '500,1000,2000,5000', { maxlength: 60 }))} /><div className="field-row"><Val v={ui.field('সর্বনিম্ন ৳', ui.input('gift_min', s.gift_min || 200, { type: 'number', min: 1, class: 'w-num' }))} /><Val v={ui.field('সর্বোচ্চ ৳', ui.input('gift_max', s.gift_max || 20000, { type: 'number', min: 1, class: 'w-num' }))} />{' '}<Val v={ui.field('মেয়াদ (দিন)', ui.input('gift_valid_days', s.gift_valid_days || 365, { type: 'number', min: 0, class: 'w-num' }))} /></div><Val v={ui.field('কোডের SMS', ui.textarea('gift_sms', s.gift_sms || '{shop}: আপনার জন্য {amount} টাকার গিফট কার্ড{from}! কোড: {code}{expiry}। চেকআউটে কোডটা দিন।{message}', { rows: 3, maxlength: 300 }),
    toHtml(<><code>{"{code}"}</code>{' '}কোড (অবশ্যই রাখুন),{' '}<code>{"{amount}"}</code>{' '}টাকা,{' '}<code>{"{from}"}</code>{' '}কে পাঠিয়েছেন,{' '}<code>{"{expiry}"}</code>{' '}মেয়াদ,{' '}<code>{"{message}"}</code>{' '}বার্তা</>))} />{' '}<button className="btn btn-sm">সেভ করুন</button></form></section></div><section className="panel" id="referral"><h2>🎁 রেফারেল প্রোগ্রাম — বন্ধুকে আনলে দুজনেই ছাড়</h2><p className="muted small">প্রতিটা কাস্টমার "আমার অ্যাকাউন্ট" এ নিজের কোড আর লিংক পান। নতুন কেউ সেই কোড (চেকআউটের কুপন ঘরে) বা লিংক দিয়ে প্রথম অর্ডার করলে ছাড় পান; সেই অর্ডার{' '}<b>ডেলিভারি হলে</b>{' '}কোডের মালিক একটা গিফট কার্ড পান (SMS-এ)। নিজের কোড নিজে, বা পুরোনো কাস্টমার ব্যবহার করতে পারেন না। (কাস্টমার অ্যাকাউন্ট চালু থাকলেই কোড দেখা যায়)</p><form method="post" action={attrValue(BASE)} className="form"><input type="hidden" name="action" defaultValue="ref_settings" />{' '}<Val v={ui.switchRow('ref_on', R.on, 'রেফারেল চালু', s.acct_on === '1' ? '' : '⚠️ কাস্টমার অ্যাকাউন্ট বন্ধ — চালু করলে তবেই কাস্টমাররা নিজের কোড দেখবেন।')} /><div className="field-row"><Val v={ui.field('নতুন বন্ধু পাবেন (৳ ছাড়)', ui.input('ref_friend_amount', R.friendGets || 50, { type: 'number', min: 0, class: 'w-num' }))} />{' '}<Val v={ui.field('কমপক্ষে কত টাকার অর্ডারে (৳)', ui.input('ref_friend_min', R.friendMin || 300, { type: 'number', min: 0, class: 'w-num' }))} />{' '}<Val v={ui.field('কোডের মালিক পাবেন (৳ গিফট কার্ড)', ui.input('ref_reward_amount', R.youGet || 50, { type: 'number', min: 0, class: 'w-num' }))} />{' '}<Val v={ui.field('পুরস্কারের মেয়াদ (দিন)', ui.input('ref_reward_days', R.validDays || 90, { type: 'number', min: 0, class: 'w-num' }))} /></div><button className="btn btn-sm">সেভ করুন</button></form></section><section className="panel table-wrap"><h2>সব গিফট কার্ড</h2><div className="chips"><a className={`chip ${!status ? 'on' : ''}`} href={attrValue(BASE)}>সব</a>{jsxList(Object.entries(G.STATUSES).map(([k, l]) => <a className={`chip ${status === k ? 'on' : ''}`} href={`${attrValue(BASE)}?status=${attrValue(k)}`}><Val v={l} /></a>))}</div><form method="get" action={attrValue(BASE)} className="filters"><input type="search" name="q" defaultValue={attrValue(q)} placeholder="কোড, মোবাইল বা নাম" /><button className="btn btn-sm">খুঁজুন</button></form>{(rows.length ? <table className="table compact"><thead><tr><th>কোড</th><th>কার জন্য</th><th className="num">টাকা</th><th className="num">বাকি</th><th>কোথা থেকে</th><th>অবস্থা</th><th>মেয়াদ</th><th></th></tr></thead><tbody>{jsxList(rows.map((c) => <tr><td><a href={`${attrValue(BASE)}/${attrValue(c.id)}`} className="mono"><b><Val v={G.pretty(c.code)} /></b></a><br /><span className="small muted">{fmtDate(c.created_at)}</span></td><td><Val v={c.recipient_name || '—'} /><br /><span className="small mono"><Val v={c.recipient_phone} /></span></td><td className="num">{money(c.initial)}</td><td className="num"><b>{money(c.balance)}</b></td><td className="small">{(c.source === 'shop' ? `অনলাইন (TrxID ${c.trx_id})` : (c.source === 'referral' ? "রেফারেলের পুরস্কার" : `অ্যাডমিন${c.staff_name ? ` — ${c.staff_name}` : ''}`))}</td><td><Val v={ui.pill(G.STATUSES[c.status], PILL[c.status] || '')} /></td><td className="small">{(c.expires_on ? String(c.expires_on).slice(0, 10) : "—")}</td><td><a className="btn btn-sm btn-ghost" href={`${attrValue(BASE)}/${attrValue(c.id)}`}>খুলুন</a></td></tr>))}</tbody></table> : <p className="muted">কোনো গিফট কার্ড নেই।</p>)}</section></>);
  return ctx.page('গিফট কার্ড ও রেফারেল', body, 'giftcards');
}

async function detail(ctx: AdminCtx, m?: Loose) {
  const id = int(m[1]);
  const back = `${BASE}/${id}`;
  if (ctx.method === 'POST') {
    const b = await ctx.body();
    try {
      if (b.action === 'activate' || b.action === 'disable' || b.action === 'enable') {
        const c = await G.setStatus(id, b.action === 'disable' ? 'disabled' : 'active', ctx.user.id, b.action === 'activate' ? 'পেমেন্ট যাচাই করে চালু' : '');
        await ctx.log('giftcard_status', 'giftcard', id, `${G.pretty(c!.code)}: ${G.STATUSES[c!.status]}`);
        let note = '';
        if (b.action === 'activate') {
          if (int(b.account_id) && ctx.can('accounting') && Number(c!.price) > 0) {
            await finance.addTransaction({ type: 'income', category: 'গিফট কার্ড বিক্রি', amount: c!.price, account_id: b.account_id, note: `গিফট কার্ড ${G.pretty(c!.code)} (TrxID ${c!.trx_id})` }, ctx.user.id);
          }
          const r = await G.sendCodeSms(ctx.settings, c);
          note = r.ok ? ' কোড প্রাপককে SMS-এ পাঠানো হয়েছে।' : ` (SMS যায়নি: ${r.msg} — কোডটা নিজে জানিয়ে দিন)`;
        }
        return ctx.redirect(`${back}?info=` + encodeURIComponent('সেভ হয়েছে।' + note));
      }
      if (b.action === 'adjust') {
        const bal = await G.adjust(id, Number(b.change), b.note, ctx.user.id);
        await ctx.log('giftcard_adjust', 'giftcard', id, `ব্যালেন্স বদল ${b.change} → ${bal}`);
        return ctx.back(back, 'saved');
      }
      if (b.action === 'sms') {
        const c = await G.get(id);
        const r = await G.sendCodeSms(ctx.settings, c);
        return ctx.redirect(`${back}?info=` + encodeURIComponent(r.ok ? 'SMS পাঠানো হয়েছে।' : `SMS যায়নি: ${r.msg}`));
      }
      if (b.action === 'expiry') {
        await db.q('UPDATE gift_cards SET expires_on=$1 WHERE id=$2', [/^\d{4}-\d{2}-\d{2}$/.test(b.expires_on || '') ? b.expires_on : null, id]);
        return ctx.back(back, 'saved');
      }
    } catch (e) { if (!(e instanceof G.GiftError)) throw e; return ctx.fail(back, e.message); }
    return ctx.back(back);
  }
  const c = await G.get(id);
  if (!c) return ctx.redirect(BASE);
  const [led, accounts] = await Promise.all([G.ledger(id), ctx.can('accounting') ? finance.listAccounts() : []]);
  const expired = c.expires_on && String(c.expires_on).slice(0, 10) < ymd();
  const body = toHtml(<><p className="crumbs"><a href={attrValue(BASE)}>← সব গিফট কার্ড</a></p><div className="title-row"><h1 className="mono"><Val v={G.pretty(c.code)} />{' '}<Val v={ui.pill(expired ? 'মেয়াদ শেষ' : G.STATUSES[c.status], PILL[c.status] || '')} /></h1></div><Val v={ui.flash(ctx.flash)} /><div className="kpis kpis-tight"><Val v={ui.kpi('বাকি', money(c.balance), `শুরুতে ${money(c.initial)}`, 'kpi-blue')} /><Val v={ui.kpi('মেয়াদ', c.expires_on ? String(c.expires_on).slice(0, 10) : 'নেই', '')} /><Val v={ui.kpi('দাম পেয়েছেন', money(c.price), c.pay_method ? `${c.pay_method} · ${c.pay_number}` : '')} /></div><div className="two-col"><section className="panel"><h2>তথ্য</h2><p><b>প্রাপক:</b>{' '}<Val v={c.recipient_name || '—'} />{' '}<span className="mono"><Val v={c.recipient_phone} /></span><br /><b>ক্রেতা:</b>{' '}<Val v={c.buyer_name || '—'} />{' '}<span className="mono"><Val v={c.buyer_phone} /></span>{' '}{(c.message ? <><br /><b>বার্তা:</b>{' '}<Val v={c.message} /></> : null)}{(c.trx_id ? <><br /><b>TrxID:</b>{' '}<span className="mono"><Val v={c.trx_id} /></span></> : null)}{(c.note ? <><br /><b>নোট:</b>{' '}<Val v={c.note} /></> : null)}</p>{(c.status === 'pending' ? <form method="post" action={attrValue(back)} className="form panel-inner"><input type="hidden" name="action" defaultValue="activate" /><p className="note">বিকাশ/নগদে{' '}<b>{money(c.price)}</b>{' '}এসেছে কিনা দেখুন (TrxID{' '}<b className="mono"><Val v={c.trx_id} /></b>, নম্বর{' '}<Val v={c.pay_number} />)। মিললে চালু করুন — প্রাপক SMS-এ কোড পাবেন।</p>{(accounts.length ? <Val v={ui.field('টাকা কোন অ্যাকাউন্টে এসেছে', ui.select('account_id', [['', '— হিসাবে লিখবেন না —'], ...accounts.filter((a) => a.active).map((a) => [a.id, a.name])], ''))} /> : null)}{' '}<button className="btn">✅ টাকা পেয়েছি — চালু করুন</button></form> : null)}<div className="row-actions mt">{(c.status === 'active' ? <form method="post" action={attrValue(back)} data-confirm="কার্ডটা বন্ধ করবেন? আর ব্যবহার করা যাবে না।"><input type="hidden" name="action" defaultValue="disable" /><button className="btn btn-sm btn-danger">⛔ বন্ধ করুন</button></form> : null)}{' '}{(c.status === 'disabled' ? <form method="post" action={attrValue(back)}><input type="hidden" name="action" defaultValue="enable" /><button className="btn btn-sm">আবার চালু</button></form> : null)}{' '}{(c.recipient_phone && c.status === 'active' ? <form method="post" action={attrValue(back)}><input type="hidden" name="action" defaultValue="sms" /><button className="btn btn-sm btn-ghost">📨 কোড আবার SMS করুন</button></form> : null)}</div><form method="post" action={attrValue(back)} className="form mt"><input type="hidden" name="action" defaultValue="adjust" /><div className="field-row"><Val v={ui.field('ব্যালেন্স বাড়ান/কমান (৳, কমাতে − দিন)', ui.input('change', '', { type: 'number', step: '0.01', required: true, class: 'w-num' }))} /><Val v={ui.field('কারণ', ui.input('note', '', { maxlength: 200 }))} /></div><button className="btn btn-sm btn-ghost">সেভ করুন</button></form><form method="post" action={attrValue(back)} className="form mt"><input type="hidden" name="action" defaultValue="expiry" />{' '}<Val v={ui.field('মেয়াদ বদলান', ui.input('expires_on', c.expires_on ? String(c.expires_on).slice(0, 10) : '', { type: 'date' }), 'খালি = মেয়াদ নেই')} /><button className="btn btn-sm btn-ghost">সেভ করুন</button></form></section><section className="panel table-wrap"><h2>হিসাব (কোথায় কত খরচ)</h2><table className="table compact"><thead><tr><th>সময়</th><th>কী</th><th className="num">টাকা</th><th className="num">বাকি</th></tr></thead><tbody>{jsxList(led.map((l) => <tr><td className="small nowrap">{fmtDate(l.created_at)}</td><td className="small"><Val v={l.note} />{(l.order_code ? <>{' '}·{' '}<a href={`/admin/orders/${attrValue(l.order_id)}`}><Val v={l.order_code} /></a></> : null)}{(l.staff_name ? ` · ${l.staff_name}` : null)}</td><td className={`num ${Number(l.amount) < 0 ? 'warn' : 'good'}`}>{(Number(l.amount) ? money(l.amount) : "—")}</td><td className="num">{money(l.balance)}</td></tr>))}</tbody></table></section></div></>);
  return ctx.page(`গিফট কার্ড ${G.pretty(c.code)}`, body, 'giftcards');
}

export const routes = [
    { method: '*', path: BASE, perm: 'marketing', handler: listPage },
    { method: '*', path: /^\/admin\/giftcards\/(\d+)$/, perm: 'marketing', handler: detail },
  ];
