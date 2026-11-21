// Admin → মার্কেট রিসার্চ (owner only). Nothing here is ever shown on the shop.
import { Val, attrValue, jsxList } from '../react/html';
import { raw, bn, money, int, str, fmtDate, ifKey } from '../util';
import * as db from '../db';
import * as R from '../services/research';
import * as G from '../services/gtrends';
import * as ui from './ui';
import type { AdminCtx, Caught } from '../types';
import * as swr from '../services/swr';

const TABS = [['google', '📊 গুগলে চাহিদা'], ['winning', '🏆 উইনিং প্রোডাক্ট'], ['find', '🔍 প্রোডাক্ট খুঁজুন'], ['new', '🆕 বাজারে নতুন'], ['drops', '📉 দাম কমেছে'], ['trends', '📈 গুগলে যা ট্রেন্ড করছে'], ['demand', '🔎 আপনার কাস্টমার যা খুঁজছে'], ['sources', '🏪 যেসব দোকান দেখা হচ্ছে']];

function pic(src?: unknown) { return src ? <img src={attrValue(src)} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <span>📦</span>; }
function ago(d: string | number | Date | null) {
  if (!d) return 'এখনো না';
  const m = Math.round((Date.now() - new Date(d).getTime()) / 60000);
  return m < 1 ? 'এইমাত্র' : m < 60 ? `${bn(m)} মিনিট আগে` : m < 1440 ? `${bn(Math.round(m / 60))} ঘণ্টা আগে` : `${bn(Math.round(m / 1440))} দিন আগে`;
}

function winningCard(g: Awaited<ReturnType<typeof R.winners>>[number], i: number, segment = '') {
  const links = R.sourcingLinks(g.term);
  return <article className="rs-card"><div className="rs-rank">{bn(i + 1)}</div><a className="rs-pic" href={attrValue(g.best.url)} target="_blank" rel="noopener noreferrer">{pic(g.lead.image)}</a><div className="rs-body"><h3><a href={attrValue(g.lead.url)} target="_blank" rel="noopener noreferrer"><Val v={g.lead.title} /></a></h3><p className="rs-why">{jsxList(g.why.slice(0, 4).map((w: unknown) => <span><Val v={w} /></span>))}</p><div className="rs-nums"><div><small>বাজারে দাম</small><b>{(g.min === g.max ? money(g.min) : <>{money(g.min)}{' '}–{' '}{money(g.max)}</>)}</b><small>সবচেয়ে কম:{' '}<Val v={g.best.shop} /></small></div><div><small>আপনি বিক্রি করতে পারেন</small><b className="good">{(g.sell ? money(g.sell) : "—")}</b><small>বাজারের মাঝামাঝি দামের সামান্য কম</small></div><div><small>এর চেয়ে কমে কিনলে লাভ</small><b className="warn">{(g.buyMax ? money(g.buyMax) : "—")}</b><small>কেনা দাম এর মধ্যে রাখুন</small></div><div><small>আপনার দোকানে</small>{oursCell(g.oursAll || [], g.best.url, g.min, g.max, `/admin/research?tab=winning${segment ? `&seg=${segment}` : ''}`)}</div></div><p className="rs-src"><small>কোথা থেকে কিনবেন খুঁজুন:</small>{' '}{jsxList(links.map(([l, u]) => <a href={attrValue(u)} target="_blank" rel="noopener noreferrer"><Val v={l} /></a>))}</p><p className="rs-shops small muted">যে দোকানে আছে:{' '}{jsxList(g.items.slice(0, 5).map((x: { url: unknown; shop: unknown; price: unknown; rank: unknown; }) => <><a href={attrValue(x.url)} target="_blank" rel="noopener noreferrer"><Val v={x.shop} />{' '}({money(x.price)}{(x.rank ? `, #${bn(x.rank)}` : null)})</a>{' '}</>))}</p></div></article>;
}

// "is it in our shop?" — every matching product, with a link; unsure matches say so
// The import page opens in the SAME tab: a new tab on a phone is handed to the customer app
// (it owns shobmilbe.com links), which never opens admin pages.
function impLink(url: string | number | boolean, back: string | number | boolean) { return `/admin/products/import?url=${encodeURIComponent(url)}${back ? `&back=${encodeURIComponent(back)}` : ''}`; }
function oursCell(list: { id: number; name: string; price: number; match: number; active?: boolean; via?: string; cost_price?: number | null }[], url: string, min?: number | null, max?: number | null, back = '/admin/research') {
  if (!list.length) return <><b className="bad">নেই</b><small><a href={attrValue(impLink(url, back))}>➕ তথ্য কপি করে আনুন →</a></small></>;
  const sure = list[0].match >= 0.85;
  const p = list[0];
  const priceNote = min && max ? (Number(p.price) > max ? '⚠️ বাজারের চেয়ে বেশি দাম' : Number(p.price) < min ? 'বাজারের চেয়ে কম দাম' : 'দাম বাজারের মধ্যে') : '';
  return <><b className={sure ? '' : 'warn'}>{(sure ? (list.length > 1 ? `আছে (${bn(list.length)}টি)` : "আছে") : "সম্ভবত আছে")}</b>{' '}{jsxList(list.slice(0, 3).map((x) => <small><a href={`/admin/products/${attrValue(x.id)}`}>{(x.name.length > 46 ? (x.name.slice(0, 44) + '…') : <Val v={x.name} />)}{' '}—{' '}{money(x.price)}</a>{(x.active === false ? " (বন্ধ)" : null)}{(x.via === 'link' ? " · এই দোকান থেকেই আনা" : null)}</small>))}{' '}{(sure ? (priceNote || p.cost_price ? <small><Val v={priceNote} />{(p.cost_price ? ` · কেনা ${money(p.cost_price)}` : null)}</small> : null) : <small>নাম পুরো মেলেনি — মিলিয়ে দেখুন।{' '}<a href={attrValue(impLink(url, back))}>আলাদা হলে আনুন →</a></small>)}</>;
}

// another shop seen on Google: paste its link once, every later search includes it
function addShop(term?: unknown) {
  const g = `https://www.google.com/search?q=${encodeURIComponent(term + ' price in Bangladesh')}`;
  return <section className="panel rs-addshop"><h2>আরও দোকানে খুঁজতে চান?</h2><p className="small muted"><a href={attrValue(g)} target="_blank" rel="noopener noreferrer">Google-এ "<Val v={term} />{' '}price in Bangladesh" খুলুন →</a>{' '}যে দোকানে পণ্যটা দেখবেন, তার লিংক নিচে দিন। এরপর থেকে প্রতিটা সার্চে ওই দোকানেও খোঁজা হবে (সারাদিন পড়া হবে না, শুধু আপনি খুঁজলে)।</p><form method="post" action="/admin/research" className="toolbar"><input type="hidden" name="form" defaultValue="add_search" /><input type="hidden" name="q" defaultValue={attrValue(term)} />{' '}<input type="url" name="url" placeholder="https://দোকানের-ঠিকানা.com" required maxLength={300} /><button className="btn btn-sm">➕ সার্চে যোগ করুন</button></form></section>;
}

// 🔍 search every shop by product name
async function findTab(ctx: AdminCtx) {
  const term = str(ctx.query.get('q') || '', 80).trim();
  const form = <><form method="get" action="/admin/research" className="toolbar rs-find" data-rs-find=""><input type="hidden" name="tab" defaultValue="find" />{' '}<input type="search" name="q" defaultValue={attrValue(term)} placeholder="পণ্যের নাম বা নামের অংশ — যেমন TDA2030, 7812, SG90" required minLength={2} maxLength={80} autoFocus />{' '}<button className="btn">🔍 সব দোকানে খুঁজুন</button><span className="small muted" data-rs-find-msg=""></span></form><div className="note-line"><p className="small muted">যেসব দোকান দেখা হচ্ছে আর বাংলাদেশের কম্পোনেন্টের দোকানগুলো — সবগুলোতে এখনই খোঁজা হয় (দোকানের নিজের সার্চ দিয়ে) + আগে পড়া তথ্য। ২০–২৫ সেকেন্ড লাগতে পারে। যেটা পছন্দ "➕ যোগ করুন" চাপুন — পণ্য আমদানির পেজ খুলে তথ্য ও ছবি নিজে থেকে কপি হয়ে আসবে, সেভ করে "← সার্চে ফিরে যান" চাপলে এই তালিকায় ফিরবেন।</p></div></>;
  if (term.length < 2) return form;
  const r = await R.searchMarket(term, { fresh: ctx.query.get('fresh') === '1' });
  const back = `/admin/research?tab=find&q=${encodeURIComponent(term)}`;
  const have = r.items.filter((x) => x.ours.length).length;
  const shopLine = r.again ? <p className="small muted">একটু আগে সব দোকানে খোঁজা হয়েছিল — সেই ফল দেখানো হচ্ছে।{' '}<a href={`/admin/research?tab=find&fresh=1&q=${attrValue(encodeURIComponent(term))}`}>আবার খুঁজুন</a></p> : r.shops.length ? (() => {
    const got = r.shops.filter((x) => x.n), none = r.shops.filter((x) => !x.n && !x.error), bad = r.shops.filter((x) => x.error);
    return <><p className="small muted rs-shopline">🏪{' '}{bn(r.shops.length)}টি দোকানে খোঁজা হলো{(got.length ? <>{' '}— পাওয়া গেছে:{' '}{jsxList(got.map((x) => <><span className="good"><Val v={x.name} />{' '}({bn(x.n)})</span>{' '}</>))}</> : null)}</p>{(none.length || bad.length ? <details className="small muted rs-shopline"><summary>{(none.length ? `${bn(none.length)}টিতে পাওয়া যায়নি` : null)}{(none.length && bad.length ? " · " : null)}{(bad.length ? `${bn(bad.length)}টি খোলা যায়নি` : null)}</summary>{jsxList(none.map((x) => <><span><Val v={x.name} /></span>{' '}</>))}{jsxList(bad.map((x) => <><span className="bad"><Val v={x.name} />:{' '}<Val v={x.error} /></span>{' '}</>))}</details> : null)}</>;
  })() : '';
  if (!r.items.length) return <>{form}{shopLine}{ui.empty(`"${term}" কোনো দোকানে পাওয়া যায়নি। নামটা ছোট করে বা মডেল নম্বর দিয়ে খুঁজুন।`)}<p className="rs-src"><small>অন্য জায়গায় খুঁজুন:</small>{' '}{jsxList(R.sourcingLinks(term).map(([l, u]) => <a href={attrValue(u)} target="_blank" rel="noopener noreferrer"><Val v={l} /></a>))}</p>{addShop(term)}</>;
  const prices = r.items.map((x) => Number(x.price)).filter((x) => x > 0);
  const parts = r.items.filter((x) => !x.made);
  const made = r.items.filter((x) => x.made);
  const rows = (list: typeof r.items) => <div className="table-wrap panel"><table className="table rs-find-table"><thead><tr><th></th><th>পণ্য</th><th>দোকান</th><th className="num">দাম</th><th>আপনার দোকানে</th></tr></thead><tbody>{jsxList(list.map((x) => <tr className={x.ours.length ? 'rs-have' : ''}><td className="thumb">{pic(x.image)}</td><td><a href={attrValue(x.url)} target="_blank" rel="noopener noreferrer"><Val v={x.title} /></a>{(x.category ? <><br /><span className="small muted"><Val v={x.category} /></span></> : null)}</td><td className="small"><Val v={x.shop} />{(x.in_stock === false ? <><br /><span className="bad">স্টক নেই</span></> : null)}</td><td className="num">{(x.price ? <><b>{money(x.price)}</b>{(x.regular_price ? <><br /><s className="small muted">{money(x.regular_price)}</s></> : null)}</> : "—")}</td><td className="rs-ours">{(x.ours.length ? oursCell(x.ours, x.url, 0, 0, back) : <a className="btn btn-sm" href={attrValue(impLink(x.url, back))}>➕ যোগ করুন</a>)}</td></tr>))}</tbody></table></div>;
  return <>{form}{shopLine}<div className="rs-status panel"><span>📦{' '}<b>{bn(r.items.length)}</b>টি পাওয়া গেছে</span><span>🏪{' '}<b>{bn(new Set(r.items.map((x) => x.shop)).size)}</b>টি দোকানে</span>{' '}{(prices.length ? <span>💰 বাজারে দাম{' '}<b>{money(Math.min(...prices))}{' '}–{' '}{money(Math.max(...prices))}</b></span> : null)}{' '}<span>{(have ? <>✅{' '}<b>{bn(have)}</b>টি আপনার দোকানে আছে</> : "❌ আপনার দোকানে একটাও নেই")}</span></div>{(made.length && parts.length ? <h2 className="rs-sec">🔹 শুধু পার্ট / IC{' '}<small>{bn(parts.length)}টি</small></h2> : null)}{' '}{(parts.length ? rows(parts) : null)}{' '}{(made.length ? <><h2 className="rs-sec">🔸 এটা দিয়ে বানানো বোর্ড / মডিউল / কিট{' '}<small>{bn(made.length)}টি — প্রতিটা আলাদা পণ্য</small></h2>{rows(made)}</> : null)}{' '}{addShop(term)}</>;
}

// ---------------------------------------------------------------- 📊 গুগলে চাহিদা (lib/services/gtrends.ts)
type Keep = <T>(k: string, fn: () => Promise<T>) => Promise<T>;
const GT = '/admin/research?tab=google';
async function gtPost(ctx: AdminCtx, b: Record<string, unknown>) {
  const id = int(b.id);
  if (b.form === 'gt_add') {
    let t: Awaited<ReturnType<typeof G.addTerm>>;
    try { t = await G.addTerm(str(b.term, 60)); } catch (caught) { const e = caught as Caught; return ctx.fail(GT, e.message); }
    await G.refresh(t.id); // read at once (a few seconds), so the owner sees it now
    return ctx.back(`${GT}&q=${encodeURIComponent(t.term)}`, 'added');
  }
  if (b.form === 'gt_read' && id) await G.refresh(id);
  if (b.form === 'gt_hide' && id) await G.setHidden(id, true);
  if (b.form === 'gt_show' && id) await G.setHidden(id, false);
  return ctx.back(`${GT}${b.q ? `&q=${encodeURIComponent(str(b.q, 60))}` : ''}`, 'saved');
}
/** 12 months as a small line (each word's own 0–100) */
function spark(series: G.Week[] | null) {
  const v = (series || []).map((p) => p.v);
  if (v.length < 2) return null;
  const w = 120, h = 30, max = Math.max(1, ...v);
  const pts = v.map((x, i) => `${Math.round((i / (v.length - 1)) * w)},${Math.round(h - 2 - (x / max) * (h - 4))}`).join(' ');
  return <svg className="gt-spark" viewBox={`0 0 ${w} ${h}`} width={w} height={h} aria-hidden="true"><polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.6" /></svg>;
}
function chg(x: number | null) {
  if (x == null) return <span className="muted">—</span>;
  return <b className={x >= 15 ? 'good' : x <= -15 ? 'bad' : ''}>{G.pctText(Math.round(x))}</b>;
}
function oursText(v: G.View) {
  if (!v.ours.n) return <b className="bad">নেই</b>;
  return <>{(v.ours.id ? <a href={`/admin/products/${v.ours.id}`}>{bn(v.ours.n)}টি পণ্য</a> : <>{bn(v.ours.n)}টি পণ্য</>)}<br /><span className={`small ${v.ours.stock ? '' : 'bad'}`}>{(v.ours.stock ? `স্টক ${bn(v.ours.stock)}` : 'স্টক নেই')}</span>{(v.ours.price ? <><br /><span className="small">দাম {money(v.ours.price)}{(v.ours.cost ? ` · কেনা ${money(Math.round(v.ours.cost))}` : '')}</span></> : null)}</>;
}
function srcLinks(term: string) {
  return <span className="gt-src">{jsxList(R.sourcingLinks(term).map(([l, u]) => <a href={attrValue(u)} target="_blank" rel="noopener noreferrer">{l}</a>))}</span>;
}
async function googleTab(ctx: AdminCtx, keep: Keep) {
  const search = str(ctx.query.get('q') || '', 60).trim();
  await G.syncTerms().catch(() => {}); // the word list exists from the first look (then once a day)
  const [list, st] = await Promise.all([keep(`gt|${search}`, () => G.views({ search })), G.status()]);
  const month = new Date(Date.now() + 6 * 3600e3).getUTCMonth();
  const wait = st.wait > Date.now() ? <span className="warn"> · ⏸️ Google একটু বিরতি চেয়েছে — প্রায় {bn(Math.max(1, Math.ceil((st.wait - Date.now()) / 3600e3)))} ঘণ্টা পরে আবার শুরু হবে (আগের তথ্য দেখানো হচ্ছে)</span> : null;
  const head = <div className="note-line"><p className="small muted">বাংলাদেশে মানুষ Google-এ আপনার ধরনের পণ্য কতটা খুঁজছে — প্রতিদিন নিজে থেকে পড়া হয় (একবারে একটা শব্দ, দিনে সব শব্দ একবার)। {bn(st.done)}/{bn(st.all)}টি শব্দের তথ্য আছে, গত ২৪ ঘণ্টায় {bn(st.today)}টি নতুন করে পড়া, শেষবার: {ago(st.last)}.{wait}</p></div>;
  const form = <form method="get" action="/admin/research" className="toolbar gt-find"><input type="hidden" name="tab" defaultValue="google" /><input type="search" name="q" defaultValue={search} placeholder="শব্দ খুঁজুন — যেমন remote, soldering, camera" maxLength={60} /><button className="btn">🔍 খুঁজুন</button>{(search ? <a className="btn btn-ghost" href={GT}>সব দেখুন</a> : null)}</form>;
  const exact = search && list.some((v) => v.term === G.cleanTerm(search));
  const addForm = <form method="post" action="/admin/research?tab=google" className="toolbar gt-add"><input type="hidden" name="form" defaultValue="gt_add" /><input type="text" name="term" defaultValue={exact ? '' : search} placeholder="নতুন শব্দ যোগ করুন — যেমন ac remote, ip camera" required minLength={2} maxLength={60} /><button className="btn btn-sm">➕ গুগলে দেখুন ও তালিকায় রাখুন</button><span className="small muted">যোগ করলে সাথে সাথে পড়া হয় (কয়েক সেকেন্ড), তারপর প্রতিদিন।</span></form>;
  if (!list.length) {
    return <>{head}{form}{addForm}{ui.empty(search ? `"${search}" তালিকায় নেই — উপরে "গুগলে দেখুন" চাপলে এখনই দেখা হবে।` : 'শব্দের তালিকা তৈরি হচ্ছে — কয়েক মিনিটের মধ্যে প্রথম তথ্য আসবে, কয়েক ঘণ্টায় সব।')}</>;
  }
  const advice = search ? [] : G.advise(list, month).slice(0, 8);
  const ready = list.filter((v) => v.ok_at && !v.low && v.change != null);
  const up = [...ready].filter((v) => (v.change ?? 0) > 0).sort((a, b) => (b.change ?? 0) - (a.change ?? 0)).slice(0, 8);
  const down = [...ready].filter((v) => (v.change ?? 0) < 0).sort((a, b) => (a.change ?? 0) - (b.change ?? 0)).slice(0, 6);
  const fresh = list.flatMap((v) => v.fresh.map((f) => ({ ...f, term: v.term }))).sort((a, b) => new Date(b.first_seen).getTime() - new Date(a.first_seen).getTime()).slice(0, 14);
  const kindIcon: Record<G.Advice['kind'], string> = { stock: '📦', push: '📣', season: '📅', slow: '🐢', new: '🆕', price: '🏷️' };
  const adviceBox = advice.length ? <section className="panel gt-advice"><h2>🧭 স্যার, আজ এগুলো করুন</h2><ol>{jsxList(advice.map((a) => <li><b>{kindIcon[a.kind]} {a.title}</b>{(a.why ? <><br /><span className="small muted">{a.why}</span></> : null)}<br /><span className="small">👉 {a.todo}{(a.link ? <> <a href={attrValue(a.link)}>দেখুন →</a></> : null)}</span>{(a.source ? <><br /><span className="small muted">কোথা থেকে কিনবেন: </span>{srcLinks(a.source)}</> : null)}</li>))}</ol></section>
    : (search ? null : <section className="panel gt-advice"><h2>🧭 আজকের পরামর্শ</h2><p className="muted">এখনো বিশেষ কিছু চোখে পড়েনি — সব শব্দ পড়া হলে (প্রথম দিন কয়েক ঘণ্টা) এখানে পরামর্শ আসবে।</p></section>);
  const mini = (title: string, rows: G.View[], empty: string) => <section className="panel"><h2>{title}</h2>{(rows.length ? <ul className="gt-mini">{jsxList(rows.map((v) => <li><a href={`${GT}&q=${attrValue(encodeURIComponent(v.term))}`}>{v.term}</a> {chg(v.change)}</li>))}</ul> : <p className="muted small">{empty}</p>)}</section>;
  const quick = search ? null : <div className="gt-quick">{mini('📈 এই মাসে বেড়েছে', up, 'এখনো কিছু নেই।')}{mini('📉 এই মাসে কমেছে', down, 'এখনো কিছু নেই।')}<section className="panel"><h2>🆕 নতুন যা খোঁজা শুরু হয়েছে</h2>{(fresh.length ? <ul className="gt-mini">{jsxList(fresh.map((f) => <li><a href={`/admin/research?tab=find&q=${attrValue(encodeURIComponent(f.query))}`}>{f.query}</a> <span className="small muted">({f.term} · {f.value === 'Breakout' ? 'হঠাৎ অনেক বেড়েছে' : f.value} · {ago(f.first_seen)})</span></li>))}</ul> : <p className="muted small">এখনো কিছু নেই।</p>)}</section></div>;
  const rows = list.map((v) => {
    const peaks = v.peakList.map((m) => G.BN_MONTHS[m]).join(', ');
    const rel = [...(v.top || []).slice(0, 4), ...(v.rising || []).slice(0, 3)].map((x) => x.query).filter((x, i, a) => a.indexOf(x) === i).slice(0, 6);
    return <tr className={v.low ? 'row-off' : ''}><td><b>{v.term}</b>{(v.origin === 'owner' ? <span className="small muted"> (আপনার)</span> : null)}<br />{spark(v.series)}{(v.error && !v.ok_at ? <><br /><span className="small bad">⚠️ {v.error}</span></> : null)}{(v.low ? <><br /><span className="small muted">খুব কম খোঁজা হয় — হিসাব অনিশ্চিত</span></> : null)}</td>
      <td className="num">{(v.ok_at ? chg(v.change) : <span className="muted small">পড়া বাকি</span>)}</td><td className="num">{chg(v.vs_year)}</td>
      <td className="small">{(!v.ok_at ? <span className="muted">—</span> : peaks ? <>{peaks}{(v.peakList.includes((month + 1) % 12) ? <><br /><b className="warn">আগামী মাসে!</b></> : null)}</> : <span className="muted">সারা বছর প্রায় সমান</span>)}</td>
      <td className="small">{(rel.length ? jsxList(rel.map((x) => <><a href={`/admin/research?tab=find&q=${attrValue(encodeURIComponent(x))}`}>{x}</a>{' · '}</>)) : <span className="muted">—</span>)}</td>
      <td className="small">{oursText(v)}</td>
      <td className="small">{(v.market.shops ? <>{bn(v.market.shops)}টি দোকানে বিক্রি হচ্ছে<br />সবচেয়ে কম {money(v.market.min)}{(v.market.median ? <><br />মাঝামাঝি {money(Math.round(v.market.median))}</> : null)}</> : <a href={`/admin/research?tab=find&q=${attrValue(encodeURIComponent(v.term))}`}>বাজারে খুঁজুন</a>)}</td>
      <td className="prod-actions"><form method="post" action="/admin/research?tab=google"><input type="hidden" name="form" defaultValue="gt_read" /><input type="hidden" name="id" defaultValue={attrValue(v.id)} /><input type="hidden" name="q" defaultValue={search} /><button className="btn btn-sm btn-ghost" title="এখনই আবার পড়ুন">🔄</button></form><form method="post" action="/admin/research?tab=google"><input type="hidden" name="form" defaultValue="gt_hide" /><input type="hidden" name="id" defaultValue={attrValue(v.id)} /><input type="hidden" name="q" defaultValue={search} /><button className="btn btn-sm btn-ghost" title="তালিকা থেকে সরান (আর নিজে থেকে ফিরবে না)">✖</button></form></td></tr>;
  });
  const table = <div className="table-wrap panel"><table className="table gt-table"><thead><tr><th>শব্দ (১২ মাস)</th><th className="num">এই মাস / গত মাস</th><th className="num">বছরের গড়ের তুলনায়</th><th>বেশি খোঁজা হয়</th><th>সাথে যা খোঁজে</th><th>আপনার দোকানে</th><th>অন্য দোকানে দাম</th><th></th></tr></thead><tbody>{jsxList(rows)}</tbody></table></div>;
  const hidden = search ? [] : await G.views({ hidden: true });
  const hiddenBox = hidden.length ? <details className="panel small"><summary>সরিয়ে রাখা শব্দ ({bn(hidden.length)}টি)</summary>{jsxList(hidden.map((v) => <form method="post" action="/admin/research?tab=google" className="gt-hidden"><input type="hidden" name="form" defaultValue="gt_show" /><input type="hidden" name="id" defaultValue={attrValue(v.id)} /><span>{v.term}</span> <button className="btn btn-sm btn-ghost">ফিরিয়ে আনুন</button></form>))}</details> : null;
  const note = <div className="note-line"><p className="small muted">Google আসল সংখ্যা দেয় না — প্রতিটা শব্দের নিজের ১২ মাসের মধ্যে ০–১০০। তাই এখানে দেখানো হয় চাহিদা <b>বাড়ছে না কমছে</b> (গত ৪ সপ্তাহ বনাম তার আগের ৪ সপ্তাহ, আর বছরের গড়ের সাথে), আর বছরের কোন মাসে সবচেয়ে বেশি খোঁজা হয় (গত বছরের হিসাবে)। দুটো আলাদা শব্দের সংখ্যা একে অপরের সাথে মেলানো যায় না। "সাথে যা খোঁজে" চাপলে সব দোকানে সেটা খোঁজা হয়। শব্দের তালিকা নিজে থেকে তৈরি হয় আপনার পণ্যের ধরন আর কাস্টমারের সার্চ থেকে; ✖ চাপলে সরে যায়, আর ফেরে না।</p></div>;
  return <>{head}{adviceBox}{quick}{form}{addForm}{table}{hiddenBox}{note}</>;
}

async function page(ctx: AdminCtx) {
  const tab = TABS.some((t) => t[0] === ctx.query.get('tab')) ? ctx.query.get('tab') : 'google';
  const segment = ifKey(R.SEGMENTS, ctx.query.get('seg'), '');
  const margin = Math.min(80, Math.max(5, int(ctx.settings.research_margin, 30)));
  if (ctx.method === 'POST') {
    const b = await ctx.body<'segment'>();
    if (String(b.form || '').startsWith('gt_')) return gtPost(ctx, b);
    if (b.form === 'add_search') {
      const back = `/admin/research?tab=find&fresh=1&q=${encodeURIComponent(str(b.q, 80))}`;
      try { await R.addSource(str(b.url, 300), 'electronics', '', true); } catch (caught) { const e = caught as Caught; return ctx.fail(back, e.message); }
      return ctx.back(back, 'added');
    }
    if (b.form === 'add') {
      try { await R.addSource(str(b.url, 300), b.segment ?? '', str(b.name, 60)); } catch (caught) { const e = caught as Caught; return ctx.fail('/admin/research?tab=sources', e.message); }
      return ctx.back('/admin/research?tab=sources', 'added');
    }
    if (b.form === 'toggle' && int(b.id)) await db.q('UPDATE research_sources SET active = NOT active WHERE id=$1', [int(b.id)]);
    if (b.form === 'delete' && int(b.id)) await ctx.trash('research_source', int(b.id));
    if (b.form === 'margin') { await db.setSetting('research_margin', String(Math.min(80, Math.max(5, int(b.margin, 30))))); await ctx.reloadSettings(); }
    return ctx.back(`/admin/research?tab=${b.form === 'margin' ? 'winning' : 'sources'}`, 'saved');
  }
  const RS = '/admin/research';
  const keep = <T,>(k: string, fn: () => Promise<T>) => swr.ready(`research|${k}`, 3 * 60e3, fn, RS);
  const st = await keep('status', () => R.status());
  const segChips = <div className="chips">{jsxList([['', 'সব'], ...Object.entries(R.SEGMENTS)].map(([k, l]) => <a className={`chip ${segment === k ? 'on' : ''}`} href={`/admin/research?tab=${attrValue(tab)}${k ? `&seg=${k}` : ''}`}><Val v={l} /></a>))}</div>;
  let content: unknown = '';
  if (tab === 'google') {
    content = await googleTab(ctx, keep);
  } else if (tab === 'find') {
    content = await findTab(ctx);
  } else if (tab === 'winning') {
    const list = await keep(`win|${segment}|${margin}`, () => R.winners({ segment, margin }));
    content = <>{segChips}<form method="post" action="/admin/research" className="toolbar rs-margin"><input type="hidden" name="form" defaultValue="margin" />{' '}<label>কত % লাভ রাখতে চান{' '}<input type="number" name="margin" defaultValue={attrValue(margin)} min="5" max="80" className="w-num" /></label><button className="btn btn-sm btn-ghost">হিসাব বদলান</button>{' '}<span className="small muted">"এর চেয়ে কমে কিনলে লাভ" এই হার দিয়ে হিসাব হয়।</span></form>{(list.length ? <div className="rs-list"><Val v={list.map((g, i) => winningCard(g, i, segment))} /></div> : ui.empty('এখনো যথেষ্ট তথ্য জমেনি। কয়েক ঘণ্টা পর আবার দেখুন, বা উপরের "এখনই আপডেট করুন" চাপুন।'))}</>;
  } else if (tab === 'new') {
    const list = await keep(`new|${segment}`, () => R.newInMarket({ segment, limit: 60 }));
    content = <>{segChips}{(list.length ? <div className="table-wrap panel"><table className="table"><thead><tr><th></th><th>পণ্য</th><th>দোকান</th><th className="num">দাম</th><th>কবে এসেছে</th><th>কিনতে খুঁজুন</th></tr></thead><tbody>{jsxList(list.map((x) => <tr><td className="thumb">{pic(x.image)}</td><td><a href={attrValue(x.url)} target="_blank" rel="noopener noreferrer"><Val v={x.title} /></a><br /><span className="small muted"><Val v={x.category} /></span></td><td className="small"><Val v={x.shop} /></td><td className="num">{(x.price ? money(x.price) : "—")}</td><td className="small"><Val v={ago(x.first_seen)} /></td><td className="small">{jsxList(R.sourcingLinks(x.title.split(/\s+/).slice(0, 6).join(' ')).slice(0, 3).map(([l, u]) => <><a href={attrValue(u)} target="_blank" rel="noopener noreferrer"><Val v={l} /></a>{' '}</>))}</td></tr>))}</tbody></table></div> : ui.empty('গত ৭ দিনে নতুন কিছু ধরা পড়েনি (প্রথম দিনের তথ্য "নতুন" ধরা হয় না)।'))}</>;
  } else if (tab === 'drops') {
    const list = await keep('drops', () => R.priceDrops({ limit: 40 }));
    content = list.length ? <div className="table-wrap panel"><table className="table"><thead><tr><th></th><th>পণ্য</th><th>দোকান</th><th className="num">আগে</th><th className="num">এখন</th></tr></thead><tbody>{jsxList(list.map((x) => <tr><td className="thumb">{pic(x.image)}</td><td><a href={attrValue(x.url)} target="_blank" rel="noopener noreferrer"><Val v={x.title} /></a></td><td className="small"><Val v={x.shop} /></td><td className="num"><s>{money(x.prev_price)}</s></td><td className="num good"><b>{money(x.price)}</b></td></tr>))}</tbody></table></div>
      : ui.empty('গত ৭ দিনে কোনো দোকানে দাম কমেনি।');
  } else if (tab === 'trends') {
    // 📈 what Bangladesh is searching for on Google right now (Google's public "Trending now" list, read every 3 hours)
    const t = await R.trends({ refresh: ctx.query.get('fresh') === '1' });
    const when = t.at ? ago(t.at) : 'এখনো না';
    const head = <div className="note-line"><p className="small muted">Google-এ বাংলাদেশে এখন যা সবচেয়ে বেশি খোঁজা হচ্ছে — প্রতি ৩ ঘণ্টায় হালনাগাদ (শেষবার:{' '}{when}){(t.error ? <>{' '}· <span className="warn"><Val v={t.error} /></span></> : null)}.{' '}বেশির ভাগই খবর বা খেলা; কোনোটা পণ্য, ব্র্যান্ড, উৎসব বা মৌসুম হলে "বাজারে খুঁজুন" চেপে দেখুন কোন দোকানে কত দামে আছে।{' '}<a href="/admin/research?tab=trends&fresh=1">এখনই হালনাগাদ করুন</a></p></div>;
    content = t.items.length ? <>{head}<div className="table-wrap panel"><table className="table rs-trends"><thead><tr><th>#</th><th>যা খোঁজা হচ্ছে</th><th className="num">কতজন (প্রায়)</th><th>খবর</th><th></th></tr></thead><tbody>{jsxList(t.items.map((x, i) => <tr><td>{bn(i + 1)}</td><td><b><Val v={x.title} /></b><br /><span className="small muted"><Val v={R.SEGMENTS[R.segmentOf(x.title, '', 'other')]} /></span></td><td className="num"><Val v={x.traffic || '—'} /></td><td className="small">{jsxList(x.news.map((n) => <><a href={attrValue(n.url)} target="_blank" rel="noopener noreferrer"><Val v={n.title} /></a>{' '}<span className="muted">(<Val v={n.source} />)</span><br /></>))}</td><td><a className="btn btn-sm btn-ghost" href={`/admin/research?tab=find&q=${attrValue(encodeURIComponent(x.title.slice(0, 80)))}`}>🔍 বাজারে খুঁজুন</a></td></tr>))}</tbody></table></div></>
      : <>{head}{ui.empty('Google-এর ট্রেন্ডের তালিকা এখনো আসেনি — কিছুক্ষণ পর আবার দেখুন।')}</>;
  } else if (tab === 'demand') {
    const d = await keep('demand', () => R.demand(30));
    content = <div className="two-col"><section className="panel"><h2>কাস্টমার যা খুঁজেছে{' '}<small>৩০ দিন</small></h2>{(d.searches.length ? <table className="table"><thead><tr><th>খুঁজেছে</th><th className="num">কতবার</th><th className="num">আপনার দোকানে</th></tr></thead><tbody>{jsxList(d.searches.map((s) => <tr className={s.found ? '' : 'rs-miss'}><td><b><Val v={s.term} /></b></td><td className="num">{bn(s.times)}</td><td className="num">{(s.found ? <>{bn(s.found)}টি</> : <><b className="bad">নেই — এনে রাখুন!</b><br />{jsxList(R.sourcingLinks(s.term).slice(0, 3).map(([l, u]) => <><a className="small" href={attrValue(u)} target="_blank" rel="noopener noreferrer"><Val v={l} /></a>{' '}</>))}</>)}</td></tr>))}</tbody></table> : <p className="muted">এখনো কেউ সাইটে কিছু খোঁজেনি।</p>)}</section><section className="panel"><h2>সবচেয়ে বেশি দেখা পণ্য{' '}<small>৩০ দিন</small></h2>{(d.viewed.length ? <><table className="table"><thead><tr><th>পণ্য</th><th className="num">দেখেছে</th><th className="num">বিক্রি</th></tr></thead><tbody>{jsxList(d.viewed.map((p) => <tr><td><a href={`/admin/products/${attrValue(p.id)}`}><Val v={p.name} /></a>{(p.stock <= 0 ? <>{' '}<span className="pill pill-cancelled">স্টক নেই</span></> : null)}</td><td className="num">{bn(p.people)}{' '}জন</td><td className={`num ${p.sold ? 'good' : ''}`}>{bn(p.sold)}</td></tr>))}</tbody></table><p className="small muted">অনেকে দেখছে কিন্তু বিক্রি কম → দাম বা ছবি/বিবরণ দেখুন। স্টক নেই কিন্তু দেখছে → দ্রুত স্টক আনুন।</p></> : <p className="muted">এখনো তথ্য নেই।</p>)}</section></div>;
  } else {
    const sources = await R.listSources();
    content = <><section className="set-sec"><div className="set-head"><h2 className="set-title">নতুন দোকান যোগ করুন</h2></div><div className="panel set-card"><form method="post" action="/admin/research?tab=sources" className="form"><input type="hidden" name="form" defaultValue="add" /><div className="field-row">{ui.field('দোকানের লিংক', ui.input('url', '', { required: true, placeholder: 'https://example.com.bd', type: 'url' }))}{' '}{ui.field('ধরন', ui.select('segment', Object.entries(R.SEGMENTS), 'electronics'))}{' '}{ui.field('নাম (ঐচ্ছিক)', ui.input('name', '', { maxlength: 60 }))}</div><button className="btn">যোগ করুন</button><div className="note-line"><p className="small muted">বাংলাদেশের প্রায় যেকোনো অনলাইন দোকান যোগ করা যায়। WooCommerce / Shopify দোকানের পুরো তালিকা একবারে পড়া হয় (বিক্রির ক্রমসহ)। অন্য দোকান (নিজস্ব ওয়েবসাইট){' '}<b>পেজ ধরে ধরে</b>{' '}পড়া হয়: সাইটম্যাপ আর ক্যাটাগরি পেজ থেকে পণ্যের পেজ, তারপর প্রতিটা পণ্যের দাম ও স্টক। প্রতিবার ~২৫টা পেজ, ঘণ্টায় কয়েকবার। প্রথমবার পুরো দোকান পড়তে কয়েক দিন লাগে, তারপর প্রতিদিন নতুন পণ্য আর জনপ্রিয় পণ্যের দাম আবার দেখা হয়। দোকান যে পেজ রোবটকে পড়তে দেয় না (robots.txt), সেটা পড়া হয় না। Daraz, Facebook পেজ স্বয়ংক্রিয় পড়া বন্ধ রেখেছে।</p></div></form></div></section><div className="table-wrap panel"><table className="table"><thead><tr><th>দোকান</th><th>ধরন</th><th className="num">পণ্য (দাম জানা)</th><th>পেজ পড়া</th><th>শেষ পড়া</th><th>অবস্থা</th><th>চালু</th><th>মুছুন</th></tr></thead><tbody>{jsxList(sources.map((s) => <tr className={s.active ? '' : 'row-off'}><td><b><Val v={s.name} /></b><br /><a className="small muted" href={attrValue(s.url)} target="_blank" rel="noopener noreferrer"><Val v={s.url} /></a></td><td className="small">{(s.search_only ? <><b>🔍 শুধু সার্চে</b>{' '}·{' '}</> : null)}<Val v={R.SEGMENTS[s.segment] || s.segment} />{' '}·{' '}{(s.kind === 'woo' ? "WooCommerce (বিক্রির ক্রম সহ)" : (s.kind === 'shopify' ? "Shopify" : (s.kind === 'auto' ? "প্রথম সার্চে চেনা হবে" : "পেজ ধরে ধরে")))}</td><td className="num">{bn(s.live_items)}</td><td className="small">{(s.kind === 'site' ? (s.queued ? <>{bn(s.queued - s.waiting)}{' '}/{' '}{bn(s.queued)}{(s.waiting ? <><br /><span className="muted">{bn(s.waiting)}টি বাকি</span></> : <><br /><span className="good">সব পড়া হয়েছে</span></>)}</> : <span className="muted">শুরু হয়নি</span>) : <span className="muted">একবারে পুরো তালিকা</span>)}</td><td className="small"><Val v={ago(s.last_ok)} /></td><td className="small">{(s.last_error ? <span className="bad">⚠️{' '}<Val v={s.last_error} /></span> : (s.active ? "✅ চালু" : "বন্ধ"))}</td><td>{ui.rowSwitch(`/admin/toggle/research/${s.id}`, s.active, 'বন্ধ করলে এই দোকান আর পড়া হবে না')}</td><td className="prod-actions"><form method="post" action="/admin/research?tab=sources" data-confirm="এই দোকান আর তার সব তথ্য মুছবেন? রিসাইকেল বিনে থাকবে।"><input type="hidden" name="form" defaultValue="delete" /><input type="hidden" name="id" defaultValue={attrValue(s.id)} /><button className="btn btn-sm btn-danger">🗑️ মুছুন</button></form></td></tr>))}</tbody></table></div></>;
  }
  const body = <><h1>🔭 মার্কেট রিসার্চ{' '}<small>শুধু আপনি দেখতে পাচ্ছেন — দোকানে কোথাও দেখায় না</small></h1>{ui.flash(ctx.flash)}<div className="rs-status panel"><span>🏪{' '}<b>{bn(st!.sources)}</b>টি দোকান দেখা হচ্ছে</span><span>📦{' '}<b>{bn(st!.items)}</b>টি পণ্যের দাম জানা</span>{' '}<span>🕒 শেষ আপডেট:{' '}<b data-rs-last=""><Val v={ago(st!.last_ok)} /></b></span>{' '}<button type="button" className="btn btn-sm" data-rs-run="">🔄 এখনই আপডেট করুন</button><span className="small muted" data-rs-msg=""></span></div><nav className="tabs rs-tabs">{jsxList(TABS.map(([k, l]) => <a className={`tab ${tab === k ? 'on' : ''}`} href={`/admin/research?tab=${attrValue(k)}${segment ? `&seg=${segment}` : ''}`}><Val v={l} /></a>))}</nav><Val v={content} />{' '}{ui.helpBox('এটা কীভাবে কাজ করে?', <ul><li>প্রতি ঘণ্টায় নিজে থেকে (আপনি ঘুমিয়ে থাকলেও) বাংলাদেশের অন্য অনলাইন দোকানগুলোর পণ্যের তালিকা পড়া হয় — দাম, আগের দাম, স্টক, আর কোন পণ্য সবচেয়ে বেশি বিক্রি হচ্ছে তার ক্রম।</li><li><b>উইনিং স্কোর</b>{' '}বাড়ে যখন: পণ্যটি দোকানের সবচেয়ে বেশি বিক্রির তালিকার উপরে, কয়েকটা দোকানে একসাথে বিক্রি হচ্ছে, সপ্তাহে ক্রম উপরে উঠছে, বারবার স্টক শেষ হচ্ছে, নতুন এসেছে, আর আপনার সাইটে কাস্টমাররা এটা খুঁজছে।</li><li><b>আপনি বিক্রি করতে পারেন</b>{' '}= বাজারের মাঝামাঝি দামের সামান্য কম।{' '}<b>এর চেয়ে কমে কিনলে লাভ</b>{' '}= সেই দাম থেকে আপনার বেছে নেওয়া লাভের হার বাদ দিয়ে।</li><li>পাইকারি কেনা দাম ইন্টারনেটে খোলাভাবে পাওয়া যায় না — তাই 1688 / Alibaba / AliExpress / Daraz এ সরাসরি খোঁজার লিংক দেওয়া আছে। ঢাকার পাইকারি বাজারেও (যেমন পাটুয়াটুলী, নবাবপুর, স্টেডিয়াম মার্কেট) এই লক্ষ্য দামের মধ্যে খুঁজুন।</li><li>আরও দোকান যোগ করলে ফল আরও ভালো হবে — "যেসব দোকান দেখা হচ্ছে" ট্যাবে যোগ করুন।</li></ul>)}</>;
  return ctx.page('মার্কেট রিসার্চ', body, 'research');
}

// "এখনই আপডেট করুন": read one shop per call (the page calls it until all are fresh)
async function runApi(ctx: AdminCtx) {
  const r = await R.tick({ force: true });
  return ctx.json(200, r);
}

export const routes = [
    { method: '*', path: '/admin/research', perm: 'owner', handler: page },
    { method: 'POST', path: '/admin/api/research/run', perm: 'owner', handler: runApi },
  ];
void raw; void fmtDate;
