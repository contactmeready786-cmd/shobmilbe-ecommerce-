// Admin → পণ্য → 🧰 প্রজেক্ট কিট: make a kit for a project ("ব্লুটুথ স্পিকার বানান"), list its parts (how many of each,
// which are optional), and switch it on. Customers see it at /kits and add the parts to the cart together.
import { toHtml, Val, attrValue, attrProps, jsxList } from '../react/html';
import { html, raw, bn, money, int } from '../util';
import * as ui from './ui';
import * as K from '../models/kits';
import * as $db from '../db';
import type { AdminCtx, Loose } from '../types';

const BASE = '/admin/kits';

async function listPage(ctx: AdminCtx) {
  const s = ctx.settings;
  if (ctx.method === 'POST') {
    const b = await ctx.body();
    // 📚 a ready-made guide → a kit (parts matched from the shop's own products)
    if (b.action === 'guide') {
      try {
        const r = await K.fromGuide(String(b.key || ''));
        if (r.existed) return ctx.back(`${BASE}/${r.id}?info=${encodeURIComponent('এই গাইড থেকে কিট আগেই বানানো আছে।')}`);
        await ctx.log('kit_save', 'kit', r.id, `তৈরি গাইড থেকে কিট: ${b.key}`);
        const msg = r.active ? '✅ কিট তৈরি হয়ে দোকানে চালু হয়েছে। পার্টসগুলো একবার মিলিয়ে দেখুন।'
          : `⚠️ কিট তৈরি হয়েছে কিন্তু বন্ধ রাখা হলো — দোকানে এই পার্টস নেই: ${r.missing.map((x: Loose) => x.note || x.find[0]).join(', ')}। পার্টস তুলে কিটে যোগ করে "দোকানে দেখাও" চালু করুন।`;
        return ctx.back(`${BASE}/${r.id}?${r.active ? 'info' : 'err'}=${encodeURIComponent(msg)}`);
      } catch (e) {
        if (!(e instanceof K.KitError)) throw e;
        return ctx.fail(BASE, e.message);
      }
    }
    if (!ctx.can('settings')) return ctx.back(BASE, 'noperm');
    await $db.setMany({ kits_on: b.kits_on ? '1' : '0' });
    return ctx.back(BASE, 'saved');
  }
  const [kits, guides] = await Promise.all([K.list(), K.guideStatus().catch(() => [])]);
  const body = toHtml(<><div className="title-row"><h1>🧰 প্রজেক্ট কিট</h1><div className="row-actions"><a className="btn" href={`${attrValue(BASE)}/new`}>+ নতুন কিট</a><a className="btn btn-ghost btn-sm" href="/kits" target="_blank" rel="noopener">দোকানে দেখুন ↗</a></div></div><Val v={ui.flash(ctx.flash)} />{' '}<Val v={ui.helpBox('কিট কী, কীভাবে কাজে লাগাবেন', toHtml(<ol className="steps"><li>একটা প্রজেক্টের জন্য যা যা পার্টস লাগে সেগুলো এক জায়গায় রাখুন — যেমন "ব্লুটুথ স্পিকার বানান": মডিউল, অ্যামপ্লিফায়ার, স্পিকার, ব্যাটারি, তার।</li><li>কাস্টমার কিটের পেজে দেখেন কী কী লাগবে আর মোট কত টাকা। যেটা তার কাছে আছে সেটার টিক তুলে দেন, পরিমাণ বদলান, তারপর এক চাপে সব কার্টে।</li><li>প্রতিটা পার্টস আলাদা পণ্য হিসেবেই বিক্রি হয় — স্টক, দাম, SKU সব নিজের। (বান্ডেল থেকে পার্থক্য: বান্ডেল এক দামে একসাথে বিক্রি হয়।)</li><li>"ঐচ্ছিক" দিলে কাস্টমারের কাছে টিক ছাড়া থাকে — যেমন বাড়তি ব্যাটারি বা বক্স।</li></ol>))} /><section className="panel table-wrap">{(kits.length ? <table className="table"><thead><tr><th></th><th>কিট</th><th className="num">পার্টস</th><th className="num">দরকারি পার্টসের দাম</th><th>অবস্থা</th><th></th></tr></thead><tbody>{jsxList(kits.map((k) => <tr><td className="thumb">{(k.image_id ? <img src={`/media/${attrValue(k.image_id)}/t`} alt="" /> : <span><Val v={k.emoji} /></span>)}</td><td><a href={`${attrValue(BASE)}/${attrValue(k.id)}`}><b><Val v={k.title} /></b></a><br /><a className="small muted" href={`/kit/${attrValue(k.slug)}`} target="_blank" rel="noopener">/kit/<Val v={k.slug} /></a></td><td className="num"><Val v={bn(k.parts)} /></td><td className="num"><Val v={money(k.base_total)} /></td><td>{(k.active ? <Val v={ui.pill('চালু', 'pill-ok')} /> : <Val v={ui.pill('বন্ধ', 'pill-grey')} />)}</td><td><a className="btn btn-sm" href={`${attrValue(BASE)}/${attrValue(k.id)}`}>✏️ এডিট</a></td></tr>))}</tbody></table> : <p className="muted">এখনো কোনো কিট নেই। "+ নতুন কিট" চেপে প্রথমটা বানান।</p>)}</section><section className="panel" id="guides"><h2>📚 তৈরি প্রজেক্ট গাইড — এক চাপে কিট</h2><p className="small">প্রতিটা গাইডে বানানোর ধাপ লেখা আছে। "কিট বানান" চাপলে দোকানের পণ্য থেকে পার্টস নিজে খুঁজে নিয়ে কিট তৈরি হয়। সব দরকারি পার্টস পাওয়া গেলে সাথে সাথে চালু হয়; না পেলে বন্ধ থাকে আর কোন পার্টস নেই বলে দেয় (সেগুলো তুললেই চালু করা যাবে)। মানুষ Google-এ "ব্লুটুথ স্পিকার কিভাবে বানাবো" এভাবে খোঁজে — এই পেজগুলো ঠিক সেই উত্তর দেয় আর পার্টস বিক্রি করে।</p>{(guides.length ? <div className="table-wrap"><table className="table compact"><thead><tr><th>গাইড</th><th>দোকানে পার্টস</th><th></th></tr></thead><tbody>{jsxList(guides.map((g) => { const need = g.parts.filter((x: Loose) => !x.optional).length; const have = need - g.missing.length; return <tr><td><Val v={g.emoji} />{' '}<b><Val v={g.title} /></b><br /><span className="small muted"><Val v={g.level} />{' '}·{' '}<Val v={g.time} />{' '}·{' '}<Val v={bn(g.steps.length)} />টা ধাপ</span></td><td className="small">{(g.missing.length ? <><span className="warn"><Val v={bn(have)} />/<Val v={bn(need)} />টা পাওয়া গেছে</span><br /><span className="muted">নেই:{' '}<Val v={g.missing.map((x: Loose) => x.note || x.find[0]).join(', ')} /></span></> : <span className="ok">✅ সব{' '}<Val v={bn(need)} />টা আছে</span>)}</td><td>{(g.kit ? <a className="btn btn-sm btn-ghost" href={`${attrValue(BASE)}/${attrValue(g.kit.id)}`}>✏️ কিট দেখুন{(g.kit.active ? null : " (বন্ধ)")}</a> : <form method="post" action={attrValue(BASE)}><input type="hidden" name="action" defaultValue="guide" /><input type="hidden" name="key" defaultValue={attrValue(g.key)} /><button className="btn btn-sm">➕ কিট বানান</button></form>)}</td></tr>; }))}</tbody></table></div> : null)}</section>{(ctx.can('settings') ? <section className="panel"><form method="post" action={attrValue(BASE)} className="form"><Val v={ui.switchRow('kits_on', s.kits_on !== '0', 'দোকানে "🧰 প্রজেক্ট কিট" চালু', 'বন্ধ করলে /kits পেজ আর পণ্যের পেজে কিটের লিংক থাকবে না।')} />{' '}<button className="btn">সেভ করুন</button></form></section> : null)}</>);
  return ctx.page('প্রজেক্ট কিট', body, 'kits');
}

async function editPage(ctx: AdminCtx, m?: Loose) {
  const isNew = m[1] === 'new';
  const back = isNew ? `${BASE}/new` : `${BASE}/${int(m[1])}`;
  if (ctx.method === 'POST') {
    const b = await ctx.body();
    try {
      if (b.action === 'delete' && !isNew) { await K.remove(m[1]); await ctx.log('kit_delete', 'kit', int(m[1]), 'কিট মুছেছে'); return ctx.back(BASE, 'deleted'); }
      const id = await K.save({ ...b, id: isNew ? 0 : int(m[1]) });
      await ctx.log('kit_save', 'kit', id, String(b.title || '').slice(0, 80));
      return ctx.back(`${BASE}/${id}`, 'saved');
    } catch (e) {
      if (!(e instanceof K.KitError)) throw e;
      return ctx.fail(back, e.message);
    }
  }
  const k = isNew ? { title: '', description: '', emoji: '🧰', active: true, sort: 0, items: [], steps: '', level: '', duration: '' } : await K.get({ id: m[1] });
  if (!k) return ctx.redirect(ctx.res, BASE);
  const body = toHtml(<><p className="crumbs"><a href={attrValue(BASE)}>← সব কিট</a></p><div className="title-row"><h1>{(isNew ? "নতুন প্রজেক্ট কিট" : <Val v={k.title} />)}</h1>{(isNew ? null : <div className="row-actions"><a className="btn btn-ghost btn-sm" href={`/kit/${attrValue(k.slug)}`} target="_blank" rel="noopener">দোকানে দেখুন ↗</a></div>)}</div><Val v={ui.flash(ctx.flash)} /><form method="post" action={attrValue(back)} className="form"><div className="two-col"><section className="panel"><Val v={ui.field('কিটের নাম', ui.input('title', k.title, { maxlength: 120, required: true, placeholder: 'যেমন: ব্লুটুথ স্পিকার বানানোর কিট' }))} />{' '}<Val v={ui.field('বিবরণ (কী বানানো যাবে, কীভাবে)', ui.textarea('description', k.description, { rows: 6, maxlength: 5000 }), 'লাইনের শুরুতে "- " দিলে তালিকা, "1. " দিলে ধাপে ধাপে, YouTube লিংক দিলে ভিডিও দেখাবে।')} />{' '}<Val v={ui.field('কীভাবে বানাবেন — ধাপগুলো (প্রতি লাইনে একটা ধাপ)', ui.textarea('steps', k.steps, { rows: 8, maxlength: 12000, placeholder: 'মডিউলের 5V আর GND সাপ্লাইয়ে জুড়ুন\nঅডিও আউটপুট অ্যাম্পের ইনপুটে দিন\n…' }), 'দোকানে নম্বর দিয়ে ধাপে ধাপে দেখাবে, আর Google এটাকে "কীভাবে বানাবেন" (HowTo) পেজ হিসেবে পড়বে।')} /><div className="field-row"><Val v={ui.field('কঠিনতা', ui.input('level', k.level, { maxlength: 60, placeholder: 'সহজ / মাঝারি' }))} /><Val v={ui.field('কত সময় লাগে', ui.input('duration', k.duration, { maxlength: 60, placeholder: '১-২ ঘণ্টা' }))} /></div><div className="field-row"><Val v={ui.field('ইমোজি', ui.input('emoji', k.emoji, { maxlength: 8, class: 'w-num' }))} /><Val v={ui.field('ক্রম', ui.input('sort', k.sort, { type: 'number', class: 'w-num' }))} /></div><Val v={ui.imagePicker('image_id', k.image_id, { label: 'ছবি (ঐচ্ছিক)' })} />{' '}<Val v={ui.switchRow('active', !!k.active, 'দোকানে দেখাও', '')} /></section><section className="panel" data-bundle="" data-kit=""><h2>কী কী পার্টস লাগবে</h2><div className="item-picker"><input type="search" placeholder="পণ্য খুঁজে যোগ করুন…" data-bundle-search="" autoComplete="off" /><ul className="picker-results" data-bundle-results="" hidden></ul></div><div className="table-wrap"><table className="table item-rows bundle-rows"><thead><tr><th>ছবি</th><th>পণ্য</th><th className="num">দাম</th><th className="num">পরিমাণ</th><th className="num">মোট</th><th className="num">স্টক</th><th>ঐচ্ছিক</th><th>কাজ</th></tr></thead><tbody data-bundle-rows="">{jsxList(k.items.map((i?: Loose) => <tr data-row="" data-price={attrValue(i.price)}><td className="b-img">{(i.image_id ? <img src={`/media/${attrValue(i.image_id)}/t`} alt="" loading="lazy" /> : <span className="pe"><Val v={i.emoji || '📦'} /></span>)}</td><td className="b-name"><b><Val v={i.name} /></b>{(i.sku ? <><br /><span className="small muted">SKU{' '}<Val v={i.sku} /></span></> : null)}<input type="hidden" name="bundle_id[]" defaultValue={attrValue(i.product_id)} />{' '}<input name="kit_note[]" defaultValue={attrValue(i.note)} maxLength={120} placeholder="ছোট নোট (ঐচ্ছিক)" className="kit-note" /></td><td className="num"><Val v={money(i.price)} /></td><td className="num"><span className="qty-step"><button type="button" className="qs-btn" data-bq="-1" {...({ "aria-label": "কমান" } as Record<string, string>)}>−</button><input type="number" name="bundle_qty[]" defaultValue={attrValue(i.qty)} min="1" className="w-num" data-qty="" /><button type="button" className="qs-btn" data-bq="1" {...({ "aria-label": "বাড়ান" } as Record<string, string>)}>+</button></span></td><td className="num" data-line=""><Val v={money(i.price * i.qty)} /></td><td className="num"><Val v={bn(i.stock)} /></td><td><label className="check"><input type="checkbox" name="kit_opt[]" defaultValue={attrValue(i.product_id)} {...attrProps(i.optional ? raw('checked') : '')} />{' '}ঐচ্ছিক</label></td><td className="b-act"><button type="button" className="btn btn-sm btn-danger" data-remove-row="">🗑️ মুছুন</button></td></tr>))}</tbody></table></div><p className="muted small" data-bundle-empty="" {...attrProps(k.items.length ? raw('hidden') : '')}>এখনো কোনো পার্টস যোগ হয়নি — উপরে খুঁজে যোগ করুন।</p><p className="muted small" data-bundle-sum=""></p></section></div><p className="row-actions"><button className="btn">সেভ করুন</button>{(isNew ? null : <>{' '}<button className="btn btn-danger btn-sm" name="action" value="delete" data-confirm-btn="এই কিটটা মুছবেন? পণ্যগুলো মুছবে না।">🗑️ কিট মুছুন</button></>)}</p></form></>);
  return ctx.page(isNew ? 'নতুন কিট' : k.title, body, 'kits');
}

export const routes = [
    { method: '*', path: BASE, perm: 'products', handler: listPage },
    { method: '*', path: /^\/admin\/kits\/(new|\d+)$/, perm: 'products', handler: editPage },
  ];
