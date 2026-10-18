// Admin → স্টোর ডিজাইন → দোকানে কী দেখাবে: one page with an on/off switch for every part of the shop
// (with a line on what it does) and small boxes for the texts on those parts. Switches save at once.
import { Val, attrValue, jsxList } from '../react/html';
import { str } from '../util';
import * as db from '../db';
import * as ui from './ui';
import * as U from '../services/uiswitch';
import * as $homerows from './homerows';
import type { AdminCtx, Loose, RouteMatch, Settings } from '../types';

const BASE = '/admin/design/switches';
const HOME_LABELS: Record<string, Loose> = {
  slider: 'বড় ব্যানার স্লাইডার', trust: 'ভরসার বার (ডেলিভারি, ক্যাশ অন ডেলিভারি, রিটার্ন)', categories: 'ক্যাটাগরি বক্স', flash: '⚡ ফ্ল্যাশ সেল',
  new: 'নতুন এসেছে', offers: 'অফারে আছে', bestsellers: 'সবচেয়ে বেশি বিক্রি', popular: 'সবাই দেখছে', promo: 'মাঝের ছোট ব্যানার',
  cat_rows: 'ক্যাটাগরি অনুযায়ী পণ্যের সারি', budget: '৳১০০ এর মধ্যে', featured: 'আমাদের বাছাই', blog: 'ব্লগ পোস্ট',
};

function switchForm(action?: Loose, on?: Loose, label?: Loose) {
  return <form method="post" action={attrValue(action)} className="prod-toggle" data-on={`${attrValue(label)}: চালু — দোকানে দেখাচ্ছে`} data-off={`${attrValue(label)}: বন্ধ — দোকানে লুকানো`}><label className="switch" title={attrValue(label)}><input type="checkbox" name="active" defaultValue="1" defaultChecked={!!(on)} data-prod-toggle="" aria-label={attrValue(label)} /><span className="switch-ui" aria-hidden="true"></span></label>{' '}<span className="small prod-toggle-text" data-prod-toggle-text="">{(on ? "চালু" : "বন্ধ")}</span><noscript><button className="btn btn-sm btn-ghost">সেভ</button></noscript></form>;
}
function textForm(s: Settings, key?: Loose, t?: Loose) {
  const cur = typeof s[key] === 'string' ? s[key] : '';
  return <form method="post" action={`${attrValue(BASE)}/text`} className="ui-text" data-ui-text=""><input type="hidden" name="key" defaultValue={attrValue(key)} />{' '}<label className="small muted"><Val v={t.label} /></label>{' '}<span className="ui-text-row"><input name="value" defaultValue={attrValue(cur)} placeholder={attrValue(t.ph || t.def || '')} maxlength={attrValue(t.max || 120)} />{' '}<button className="btn btn-sm btn-ghost">সেভ</button></span>{' '}{(t.def ? <span className="small muted">খালি রাখলে: "<Val v={t.def} />"</span> : null)}</form>;
}

async function page(ctx: AdminCtx) {
  const s = ctx.settings;
  const home = db.jsonSetting(s, 'home_sections', []);
  const row = (it?: Loose) => <li className={`ui-row ${it.key && !U.on(s, it.key) ? 'row-off' : ''}`}><div className="ui-row-main"><div className="ui-row-text"><b><Val v={it.label} /></b><span className="small muted"><Val v={it.desc} /></span></div>{(it.link ? <a className="btn btn-sm btn-ghost" href={attrValue(it.link)}>ওখানে যান →</a> : switchForm(`${BASE}/toggle/${it.key}`, U.on(s, it.key), it.label))}</div>{(it.text ? textForm(s, it.text.key, it.text) : null)}</li>;
  const LBL: Record<string, Loose> = { ...HOME_LABELS, ...(await $homerows.allLabels()).labels };
  for (const k of Object.keys(HOME_LABELS)) LBL[k] = HOME_LABELS[k];
  const allHome = [...home, ...Object.keys(LBL).filter((k) => !home.includes(k))].filter((k) => LBL[k]);
  const body = <><h1>👁️ দোকানে কী দেখাবে</h1>{ui.flash(ctx.flash)}<p className="muted">দোকানের প্রতিটা অংশ এখান থেকে চালু/বন্ধ করুন — সুইচ টিপলেই সাথে সাথে সেভ হয়, দোকানে কয়েক সেকেন্ডের মধ্যে বদলে যায়। লেখা বদলাতে ঘরে লিখে "সেভ" চাপুন। দাম, "কার্টে যোগ করুন", ঠিকানা আর অর্ডার কনফার্মের বাটন সবসময় চালু থাকে, যাতে ভুল করে অর্ডার বন্ধ না হয়ে যায়।</p><nav className="chips ui-jump">{jsxList(U.GROUPS.filter((g) => !g.hidden).map((g) => <a className="chip" href={`#g-${attrValue(g.id)}`}><Val v={g.title} /></a>))}<a className="chip" href="#g-home">🏠 হোমপেজ</a></nav><div className="ui-groups">{jsxList(U.GROUPS.filter((g) => !g.hidden).slice(0, 1).map((g) => <section className="panel ui-group" id={`g-${attrValue(g.id)}`}><h2><Val v={g.title} /></h2><ul className="ui-list"><Val v={g.items.filter((i: Loose) => !i.hidden).map(row)} /></ul></section>))}<section className="panel ui-group" id="g-home"><h2>🏠 হোমপেজের সারি</h2><p className="small muted">সারিগুলোর ক্রম (কোনটা আগে) বদলাতে{' '}<a href="/admin/design">লোগো, রং ও হোমপেজ</a>{' '}পেজে যান।</p><ul className="ui-list">{jsxList(allHome.map((k) => <li className={`ui-row ${home.includes(k) ? '' : 'row-off'}`}><div className="ui-row-main"><div className="ui-row-text"><b><Val v={LBL[k]} /></b>{(/^x\d+$/.test(k) ? <>{' '}<a className="small" href={`/admin/design/rows/${attrValue(k.slice(1))}`}>✏️ এডিট</a></> : null)}{(k === 'flash' ? <span className="small muted">কোনো ফ্ল্যাশ সেল চলার সময়ই শুধু দেখায়; নাম আসে সেলের নাম থেকে।</span> : null)}</div>{switchForm(`${BASE}/home/${k}`, home.includes(k), LBL[k])}</div>{(U.HOME_TEXTS[k] && U.HOME_TEXTS[k].title ? textForm(s, `uit_home_${k}`, U.TEXTS.get(`uit_home_${k}`)) : null)}{' '}{(U.HOME_TEXTS[k] && U.HOME_TEXTS[k].sub && k !== 'flash' ? textForm(s, `uit_home_${k}_sub`, U.TEXTS.get(`uit_home_${k}_sub`)) : null)}</li>))}</ul></section>{jsxList(U.GROUPS.filter((g) => !g.hidden).slice(1).map((g) => <section className="panel ui-group" id={`g-${attrValue(g.id)}`}><h2><Val v={g.title} /></h2><ul className="ui-list"><Val v={g.items.filter((i: Loose) => !i.hidden).map(row)} /></ul></section>))}</div></>;
  return ctx.page('দোকানে কী দেখাবে', body, 'ui-switches');
}

// The switch (and its text box) for a shop part shown on that part's own admin page (restock, Q&A …).
// It saves the moment it is clicked, the same way as on "দোকানে কী দেখাবে".
function featureRows(ctx: AdminCtx, keys?: Loose) {
  if (!ctx.can('design')) return '';
  const s = ctx.settings;
  const items = keys.map((k: Loose) => U.GROUPS.flatMap((g) => g.items).find((i) => i.key === k)).filter(Boolean);
  return <section className="panel"><ul className="ui-list">{jsxList(items.map((it: Loose) => <li className={`ui-row ${!U.on(s, it.key) ? 'row-off' : ''}`}><div className="ui-row-main"><div className="ui-row-text"><b><Val v={it.label} /></b><span className="small muted"><Val v={it.desc} /></span></div>{switchForm(`${BASE}/toggle/${it.key}`, U.on(s, it.key), it.label)}</div>{(it.text ? textForm(s, it.text.key, it.text) : null)}</li>))}</ul></section>;
}

function done(ctx: AdminCtx, ok: boolean, msg?: Loose) {
  if (String(ctx.req.headers.accept || '').includes('application/json')) return ctx.json(ok ? 200 : 400, ok ? { ok: true } : { error: msg });
  return ok ? ctx.back(BASE, 'saved') : ctx.fail(BASE, msg);
}
async function toggle(ctx: AdminCtx, m: RouteMatch) {
  const key = m[1];
  if (!U.KEYS.has(key)) return done(ctx, false, 'অজানা সুইচ।');
  const b = await ctx.body();
  const on = !!b.active && b.active !== '0';
  await db.setSetting(key, on ? '1' : '0');
  await ctx.log('settings', 'design', null, `দোকানে কী দেখাবে: ${key} ${on ? 'চালু' : 'বন্ধ'}`);
  return done(ctx, true);
}
async function homeToggle(ctx: AdminCtx, m: RouteMatch) {
  const key = m[1];
  const LBL = (await $homerows.allLabels()).labels;
  if (!LBL[key]) return done(ctx, false, 'অজানা সারি।');
  const b = await ctx.body();
  const on = !!b.active && b.active !== '0';
  const list = db.jsonSetting(ctx.settings, 'home_sections', []).filter((k: string) => LBL[k] && k !== key);
  if (on) {
    // back in its usual place: just after the row that comes before it in the default order
    const order = Object.keys(HOME_LABELS);
    let at = list.length;
    for (let i = order.indexOf(key) - 1; i >= 0; i--) { const j = list.indexOf(order[i]); if (j >= 0) { at = j + 1; break; } }
    if (order.indexOf(key) === 0) at = 0;
    list.splice(at, 0, key);
  }
  await db.setSetting('home_sections', JSON.stringify(list));
  await ctx.log('settings', 'design', null, `হোমপেজের সারি "${LBL[key]}" ${on ? 'চালু' : 'বন্ধ'}`);
  return done(ctx, true);
}
async function saveText(ctx: AdminCtx) {
  const b = await ctx.body();
  const key = String(b.key || '');
  const t = U.TEXTS.get(key);
  if (!t) return done(ctx, false, 'অজানা লেখা।');
  const v = str(b.value, t.max || 120);
  await db.setSetting(key, v);
  await ctx.log('settings', 'design', null, `দোকানের লেখা বদল (${key}): ${v || '(আগের মতো)'}`);
  return done(ctx, true);
}

export const routes = [
    { method: 'GET', path: BASE, perm: 'design', handler: page },
    { method: 'POST', path: /^\/admin\/design\/switches\/toggle\/([a-z0-9_]+)$/, perm: 'design', handler: toggle },
    { method: 'POST', path: /^\/admin\/design\/switches\/home\/([a-z0-9_]+)$/, perm: 'design', handler: homeToggle },
    { method: 'POST', path: `${BASE}/text`, perm: 'design', handler: saveText },
  ];
export { featureRows };
