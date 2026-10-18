// Admin → মার্কেটিং → ভিজিটর অ্যানালিটিক্স
// Overview (how many, from where, what they look at), live visitors, every visit with its full journey, and settings.
import { Val, RawHtml, attrValue, styleOf, jsxList } from '../react/html';
import { bn, money, fmtDate, str, dateRange, pageNum, pct } from '../util';
import * as db from '../db';
import * as V from '../services/visitors';
import * as ui from './ui';
import * as charts from './charts';
import * as $services_geolock from '../services/geolock';
import type { AdminCtx, Loose, Settings } from '../types';

const BASE = '/admin/marketing/visitors';
const PER_PAGE = 50;
const COUNTRY_PATH = `${BASE}/countries`;
const DEVICES: Record<string, Loose> = { mobile: ['📱', 'মোবাইল'], desktop: ['💻', 'কম্পিউটার'], tablet: ['📲', 'ট্যাবলেট'] };
const EVENT_LABELS: Record<string, Loose> = {
  add_to_cart: ['🛒', 'কার্টে যোগ করেছে'], begin_checkout: ['🧾', 'চেকআউট শুরু করেছে'], purchase: ['✅', 'অর্ডার করেছে'],
  search: ['🔎', 'খুঁজেছে'], contact: ['📞', 'যোগাযোগ বাটনে চাপ দিয়েছে'],
};

// ---------------------------------------------------------------- small helpers
function dur(sec?: Loose) {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  if (s < 60) return bn(s) + ' সে';
  if (s < 3600) return bn(Math.floor(s / 60)) + ' মি' + (s % 60 ? ' ' + bn(s % 60) + ' সে' : '');
  return bn(Math.floor(s / 3600)) + ' ঘ ' + bn(Math.floor((s % 3600) / 60)) + ' মি';
}
function ago(d?: Loose) {
  const s = Math.max(0, Math.round((Date.now() - new Date(d).getTime()) / 1000));
  if (s < 60) return 'এইমাত্র';
  if (s < 3600) return bn(Math.floor(s / 60)) + ' মিনিট আগে';
  if (s < 86400) return bn(Math.floor(s / 3600)) + ' ঘণ্টা আগে';
  return fmtDate(d);
}
function device(d?: Loose) { const x = DEVICES[d] || ['🖥️', d || 'অজানা']; return <span title={attrValue(x[1])}><Val v={x[0]} />{' '}<Val v={x[1]} /></span>; }
function where(row?: Loose) {
  const p = V.place(row);
  return <><span className="va-place" title={attrValue(p.country)}>{ui.flag(row.country)}{' '}<Val v={p.text} /></span>{netBadge(row)}{(row.suspicious ? <>{' '}<a className="pill pill-red va-alert" href={`/admin/security/threats?ip=${attrValue(encodeURIComponent(row.ip))}`} title="এই IP থেকে সাইটের ক্ষতি করার চেষ্টা হয়েছে — দেখুন">🚨 সন্দেহজনক</a></> : null)}</>;
}
// 🛡️ = foreign IP but the phone's clock is set to Bangladesh (VPN/proxy); 🌍 = really abroad
const NET: Record<string, Loose> = {
  vpn: ['🛡️', 'VPN / প্রক্সি', 'IP বিদেশের, কিন্তু ফোন/কম্পিউটারের ঘড়ি বাংলাদেশের সময়ে — সম্ভবত বাংলাদেশ থেকেই VPN বা প্রক্সি দিয়ে এসেছে', 'pill-amber'],
  abroad: ['🌍', 'বিদেশ থেকে', 'IP আর ঘড়ি দুটোই বিদেশের — দেশের বাইরে থেকে এসেছে', 'pill-blue'],
};
function netBadge(row?: Loose) {
  const n = NET[row.net];
  return n ? <>{' '}<span className={`pill ${attrValue(n[3])}`} title={attrValue(n[2])}><Val v={n[0]} />{' '}<Val v={n[1]} /></span></> : '';
}
// the delivery address the visitor gave when ordering (this visit or an earlier one)
function orderAddr(row?: Loose, long?: Loose) {
  const parts = [row.o_thana, row.o_district].filter(Boolean).join(', ');
  const addr = String(row.o_address || '');
  if (!parts && !addr) return '';
  const text = long ? [addr, parts].filter(Boolean).join(', ') : parts || (addr.length > 40 ? addr.slice(0, 40) + '…' : addr);
  return <><br /><small className="va-addr" title={attrValue(addr)} translate="no">🏠{' '}<Val v={text} /></small></>;
}
function phoneName(row?: Loose) {
  const brand = row.brand || '';
  const model = row.model || '';
  // "Apple" + "iPhone 13" → "iPhone 13"; "Samsung" + "SM-A536E" → "Samsung SM-A536E"; "Xiaomi" + "Redmi Note 12" → as is
  if (brand === 'Apple' && /^(iPhone|iPad|Mac)/.test(model)) return model;
  if (brand && model.toLowerCase().startsWith(brand.toLowerCase())) return model;
  return [brand, model].filter(Boolean).join(' ');
}
function deviceCell(row?: Loose, extra?: Loose) {
  const name = phoneName(row);
  return <>{device(row.device)}{(name ? <><br /><b className="small" translate="no"><Val v={name} /></b></> : null)}<br /><small className="muted"><Val v={row.browser} />{(extra ? (' · ' + row.os) : null)}</small></>;
}
function pageName(path: Loose, title: Loose, settings: Settings) {
  const store = settings.store_name || '';
  let t = String(title || '').replace(new RegExp('\\s*\\|\\s*' + store.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '.*$'), '').trim();
  const p = String(path || '');
  if (p === '/') t = 'হোমপেজ';
  else if (p === '/cart') t = 'কার্ট';
  else if (p.startsWith('/checkout')) t = 'চেকআউট';
  else if (p.startsWith('/order/')) t = 'অর্ডার সম্পন্ন (ধন্যবাদ পেজ)';
  else if (p.startsWith('/track')) t = 'অর্ডার ট্র্যাক';
  return t || p;
}
function pageCell(path: Loose, title: Loose, settings: Settings) {
  return <a href={attrValue(path)} target="_blank" rel="noopener" className="va-page"><b><Val v={pageName(path, title, settings)} /></b><small><Val v={decodeSafe(path)} /></small></a>;
}
function decodeSafe(p?: Loose) { try { return decodeURI(p); } catch (_) { return p; } }
function sourcePill(row?: Loose) {
  const cls = (({ social: 'pill-blue', organic: 'pill-green', cpc: 'pill-amber', paid: 'pill-amber', referral: '', direct: 'pill-grey' } as Record<string, string>))[row.medium] || '';
  return <span className={`pill ${attrValue(cls)}`} title={`${attrValue(row.medium || '')}${row.campaign ? ' · ' + row.campaign : ''}`}><Val v={row.source || 'অজানা'} /></span>;
}
function who(row?: Loose) {
  if (row.visitor_name || row.visitor_phone) return <span className="va-who">👤{' '}<b><Val v={row.visitor_name || ''} /></b>{' '}{(row.visitor_phone ? <small><Val v={row.visitor_phone} /></small> : null)}</span>;
  return <span className="muted small">{(row.total_visits > 1 ? `পুরনো ভিজিটর · ${bn(row.total_visits)}বার এসেছে` : (row.is_new ? "নতুন ভিজিটর" : "পুরনো ভিজিটর"))}</span>;
}
function rate(a: Loose, b: Loose) { return b ? pct((100 * a) / b) : '—'; }

function tabs(active?: Loose, live?: Loose) {
  const items = [['', '📊 সারাংশ'], ['live', `🟢 এখন লাইভ${live !== undefined ? ` (${bn(live)})` : ''}`], ['sessions', '🧭 সব ভিজিট'], ['countries', '🌍 দেশ ব্লক'], ['settings', '⚙️ সেটিংস']];
  return <nav className="tabs va-tabs">{jsxList(items.map(([k, l]) => <a className={`tab ${active === k ? 'on' : ''}`} href={attrValue(k === 'countries' ? COUNTRY_PATH : BASE + (k ? '?tab=' + k : ''))}><Val v={l} /></a>))}</nav>;
}
function rangeChips(from?: Loose, to?: Loose, extra: Loose = '') {
  const presets = [[1, 'আজ'], [7, '৭ দিন'], [30, '৩০ দিন'], [90, '৯০ দিন']];
  return <form className="date-filter" method="get" action={attrValue(BASE)}><RawHtml html={extra} /><div className="chips">{jsxList(presets.map(([d, l]) => <a className="chip" href={`${attrValue(BASE)}?days=${attrValue(d)}`}><Val v={l} /></a>))}</div><label>থেকে{' '}<input type="date" name="from" defaultValue={attrValue(from)} /></label>{' '}<label>পর্যন্ত{' '}<input type="date" name="to" defaultValue={attrValue(to)} /></label>{' '}<button className="btn btn-sm">দেখুন</button></form>;
}
function offNotice(settings: Settings) {
  return settings.visitor_tracking === '0'
    ? <p className="flash flash-error">ভিজিটর ট্র্যাকিং এখন{' '}<b>বন্ধ</b>{' '}আছে, তাই নতুন তথ্য জমা হচ্ছে না।{' '}<a href={`${attrValue(BASE)}?tab=settings`}>সেটিংস থেকে চালু করুন</a>।</p> : '';
}

// ---------------------------------------------------------------- overview
// 🔄 Owner-only: start counting from zero (e.g. after own/test visits). Shown on the main page and in settings.
function resetBox(ctx: AdminCtx) {
  if (ctx.user.role !== 'owner') return '';
  const at = ctx.settings.analytics_reset_at;
  return <form method="post" action={`${attrValue(BASE)}/clear`} className="reset-box" style={styleOf("display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin:0 0 14px")} data-confirm="সব হিসাব শূন্য করবেন? এখন পর্যন্ত সব ভিজিট, পেজ ভিউ, ক্লিক, সার্চ আর লাইভ স্কোরের ক্লিকের হিসাব মুছে যাবে, আর এখন থেকে নতুন করে গোনা শুরু হবে। এটা আর ফেরত আনা যাবে না। (অর্ডার, কাস্টমার, পণ্য, টাকার হিসাব কিছুই মুছবে না।)"><button className="btn btn-danger btn-sm">🔄 সব হিসাব শূন্য করুন</button>{' '}<span className="muted small">{(at ? <>শেষবার শূন্য করা হয়েছে:{' '}{fmtDate(at)}{' '}— হিসাব তখন থেকে।</> : "নিজের বা টেস্টের ভিজিট বাদ দিয়ে নতুন করে গুনতে চাইলে।")}</span></form>;
}

async function overviewPage(ctx: AdminCtx) {
  const { from, to } = dateRange(ctx.query, 7);
  const d = await V.overview(from, to);
  const k = d.k;
  const s = ctx.settings;
  const f = d.funnel;
  const daily = d.daily.map((r) => ({ label: charts.dayLabel(r.day), bar: r.visitors, line: r.pageviews }));
  const body = <><div className="title-row"><h1>ভিজিটর অ্যানালিটিক্স</h1></div>{tabs('', d.live)}{' '}{ui.flash(ctx.flash)}{offNotice(s)}{' '}{resetBox(ctx)}{' '}{rangeChips(from, to)}<p className="muted small">{fmtDate(from + 'T00:00:00+06:00', false)}{' '}থেকে{' '}{fmtDate(to + 'T00:00:00+06:00', false)}{' '}পর্যন্ত (বাংলাদেশ সময়)</p><div className="kpis kpis-tight">{ui.kpi('এখন সাইটে আছে', <><span className="live-dot"></span>{bn(d.live)}{' '}জন</>, `গত ${bn(V.LIVE_MINUTES)} মিনিটে সক্রিয়`, 'kpi-green', `${BASE}?tab=live`)}{' '}{ui.kpi('ভিজিটর (আলাদা মানুষ)', bn(k!.visitors), `নতুন ${bn(k!.new_visitors)} জন`)}{' '}{ui.kpi('ভিজিট (সেশন)', bn(k!.sessions), `প্রতি ভিজিটে গড়ে ${bn(k!.sessions ? (k!.pageviews / k!.sessions).toFixed(1) : 0)} পেজ`)}{' '}{ui.kpi('পেজ দেখা হয়েছে', bn(k!.pageviews), '')}{' '}{ui.kpi('গড় সময় সাইটে', dur(k!.avg_duration), 'প্রতি ভিজিটে')}{' '}{ui.kpi('বাউন্স রেট', rate(k!.bounces, k!.sessions), 'এক পেজ দেখেই চলে গেছে')}{' '}{ui.kpi('বিদেশ / VPN', <>🌍{' '}{bn(d.net!.abroad)}{' '}· 🛡️{' '}{bn(d.net!.vpn)}</>, `বাংলাদেশ থেকে ${bn(d.net!.bd)}টি ভিজিট`, '', `${BASE}?tab=sessions&net=vpn&from=${from}&to=${to}`)}{' '}{ui.kpi('অর্ডার হয়েছে', bn(k!.orders), `কনভার্সন ${rate(k!.orders, k!.sessions)}`, 'kpi-blue', `${BASE}?tab=sessions&ordered=1&from=${from}&to=${to}`)}</div><div className="va-grid va-grid-2-1"><section className="panel"><h2>প্রতিদিনের ভিজিটর</h2>{charts.combo(daily, { barName: 'ভিজিটর', lineName: 'পেজ ভিউ', lineMoney: false, height: 190 })}</section><section className="panel"><h2>কেনাকাটার ধাপ (ফানেল)</h2><p className="muted small">কতজন কোন ধাপ পর্যন্ত গেছে — কোথায় বেশি মানুষ থেমে যাচ্ছে বুঝতে পারবেন।</p>{funnel([['সাইটে এসেছে', f!.all_sessions], ['পণ্য দেখেছে', f!.viewed], ['কার্টে যোগ করেছে', f!.carted], ['চেকআউটে গেছে', f!.checkout], ['অর্ডার করেছে', f!.ordered]])}</section></div><div className="va-grid va-grid-3"><section className="panel"><h2>কোথা থেকে এসেছে</h2>{charts.donut(d.sources.map((r) => ({ label: r.source, value: r.n })), { centerSub: 'ভিজিট' })}{' '}{(d.sources.some((r) => r.orders) ? <p className="small muted">অর্ডার:{' '}{d.sources.filter((r) => r.orders).map((r) => `${r.source} ${bn(r.orders)}টি`).join(' · ')}</p> : null)}</section><section className="panel"><h2>📍 লোকেশন (শহর / জেলা)</h2>{(d.cities.length && d.cities.some((c) => c.country) ? charts.hbars(d.cities.map((c) => ({ icon: ui.flag(c.country), label: V.place(c).text, value: c.n, sub: `${bn(c.visitors)} জন` })), { color: 2 }) : <p className="muted">লোকেশন এখনো পাওয়া যায়নি। সাইট Vercel-এ চালু থাকলে নিজে থেকেই আসবে (লোকাল কম্পিউটারে লোকেশন দেখায় না)।</p>)}{' '}{(d.regions.length ? <><h3 className="h3">বিভাগ / জেলা অনুযায়ী</h3>{charts.hbars(d.regions.map((r) => ({ label: V.regionName(r.country, r.region) || r.region, value: r.n })), { color: 4 })}</> : null)}{' '}{(d.countries.length > 1 ? <><h3 className="h3">দেশ</h3>{charts.hbars(d.countries.map((c) => ({ icon: ui.flag(c.country), label: V.countryName(c.country), value: c.n })), { color: 5 })}</> : null)}</section><section className="panel"><h2>⏰ কোন সময়ে বেশি আসে</h2>{charts.hours(d.hours, 'টি ভিজিট')}<p className="muted small">ঘর যত গাঢ়, সেই ঘণ্টায় তত বেশি ভিজিটর। বিজ্ঞাপন বা পোস্ট দেওয়ার ভালো সময় বুঝতে কাজে লাগবে।</p><h3 className="h3">ডিভাইস</h3>{charts.donut(d.devices.map((r) => ({ label: (DEVICES[r.device] || ['', r.device])[1], value: r.n })), { centerSub: 'ভিজিট' })}</section></div><div className="va-grid va-grid-2"><section className="panel"><h2>সবচেয়ে বেশি দেখা পেজ</h2>{(d.pages.length ? <div className="table-wrap"><table className="table"><thead><tr><th>পেজ</th><th className="num">দেখা হয়েছে</th><th className="num">ভিজিট</th><th className="num">গড় সময়</th></tr></thead><tbody>{jsxList(d.pages.map((p) => <tr><td>{pageCell(p.path, p.title, s)}</td><td className="num">{bn(p.views)}</td><td className="num">{bn(p.visits)}</td><td className="num"><Val v={dur(p.avg_time)} /></td></tr>))}</tbody></table></div> : <p className="muted">এখনো কোনো ডাটা নেই।</p>)}</section><section className="panel"><h2>কোন পণ্য বেশি দেখছে</h2>{(d.products.length ? <><div className="table-wrap"><table className="table"><thead><tr><th>পণ্য</th><th className="num">দেখা হয়েছে</th><th className="num">কতজন দেখেছে</th><th className="num">গড় সময়</th><th className="num">কার্টে যোগ</th><th className="num">কার্ট রেট</th></tr></thead><tbody>{jsxList(d.products.map((p) => <tr><td><a href={`/admin/products/${attrValue(p.id)}`}><Val v={p.name} /></a></td><td className="num">{bn(p.views)}</td><td className="num">{bn(p.viewers)}</td><td className="num"><Val v={dur(p.avg_time)} /></td><td className="num">{bn(p.carts)}</td><td className="num"><Val v={rate(p.carts, p.viewers)} /></td></tr>))}</tbody></table></div><p className="muted small">অনেকে দেখছে কিন্তু কার্টে কম যোগ করছে? দাম, ছবি বা বিবরণ আরেকবার দেখুন।</p></> : <p className="muted">এখনো কোনো পণ্য দেখা হয়নি।</p>)}</section></div><details className="panel va-more"><summary>📱 মোবাইল, মডেল, ব্রাউজার আর রেফারার — বিস্তারিত দেখুন</summary><div className="va-grid va-grid-2"><section className="panel"><h2>📱 মোবাইলের কোম্পানি</h2>{(d.brands.length ? charts.hbars(d.brands.map((r) => ({ label: r.brand, value: r.n })), { color: 4 }) : <p className="muted">এখনো কোনো ডাটা নেই।</p>)}</section><section className="panel"><h2>📱 কোন মডেল</h2>{(d.models.length ? charts.hbars(d.models.map((r) => ({ label: phoneName(r), value: r.n })), { color: 6 }) : <p className="muted">এখনো কোনো ডাটা নেই।</p>)}<p className="muted small">Android ফোনের মডেল ফোন নিজেই জানায় (যেমন SM-A536E = Samsung Galaxy A53)। iPhone মডেল জানায় না, তাই স্ক্রিনের মাপ দেখে আনুমানিক বলা হয়।</p></section><section className="panel"><h2>ব্রাউজার / অ্যাপ</h2>{charts.hbars(d.browsers.map((r) => ({ label: r.browser, value: r.n })), { color: 3 })}<h3 className="h3">অপারেটিং সিস্টেম</h3>{charts.hbars(d.oses.map((r) => ({ label: r.os, value: r.n })), { color: 6 })}</section><section className="panel"><h2>রেফারার (কোন সাইটের লিংক থেকে)</h2>{charts.hbars(d.referrers.map((r) => ({ label: r.ref_host, value: r.n })), { color: 1 })}<h3 className="h3">ক্যাম্পেইন (UTM)</h3>{(d.campaigns.length ? charts.hbars(d.campaigns.map((r) => ({ label: `${r.campaign} (${r.source})`, value: r.n, sub: r.orders ? `${bn(r.orders)} অর্ডার` : '' })), { color: 7 }) : <p className="muted small">বিজ্ঞাপনের লিংকে{' '}<code>{"?utm_source=facebook&utm_campaign=eid-offer"}</code>{' '}এমন যোগ করলে কোন ক্যাম্পেইন থেকে কত ভিজিটর আর অর্ডার এলো এখানে দেখাবে।</p>)}{' '}{(d.contacts.length ? <><h3 className="h3">যোগাযোগ বাটনে চাপ</h3>{charts.hbars(d.contacts.map((r) => ({ label: r.label, value: r.n })), { color: 2 })}</> : null)}</section></div></details></>;
  return ctx.page('ভিজিটর অ্যানালিটিক্স', body, 'visitors');
}

function funnel(steps?: Loose) {
  const top = steps[0][1] || 0;
  return <ol className="funnel">{jsxList(steps.map(([label, n]: Loose[], i?: Loose) => {
    const w = top ? Math.max(3, (100 * n) / top) : 0;
    const prev = i ? steps[i - 1][1] : null;
    return <li><span className="fn-label"><Val v={label} /></span><span className="fn-track"><span className="fn-fill" style={styleOf(`width:${w.toFixed(1)}%`)}></span></span>{' '}<span className="fn-val"><b>{bn(n)}</b>{(i ? <>{' '}<small><Val v={rate(n, prev)} /></small></> : null)}</span></li>;
  }))}</ol>;
}

// ---------------------------------------------------------------- live
async function livePage(ctx: AdminCtx) {
  const rows = await V.liveSessions();
  const s = ctx.settings;
  const body = <><div className="title-row"><h1>ভিজিটর অ্যানালিটিক্স</h1></div>{tabs('live', rows.length)}{offNotice(s)}<p className="muted small">গত{' '}{bn(V.LIVE_MINUTES)}{' '}মিনিটে যারা সাইটে সক্রিয় ছিল। তালিকাটা প্রতি ৫ সেকেন্ডে নিজে থেকে আপডেট হয় — পেজ রিলোড করতে হবে না।</p><div data-live-refresh="5">{(rows.length ? <div className="table-wrap"><table className="table va-table"><thead><tr><th>এখন যে পেজে</th><th>লোকেশন</th><th>ডিভাইস</th><th>কোথা থেকে</th><th className="num">সাইটে আছে</th><th className="num">পেজ</th><th>কে</th><th></th></tr></thead><tbody>{jsxList(rows.map((r) => <tr><td><span className="live-dot"></span>{' '}{pageCell(r.exit_path, r.exit_title, s)}</td><td>{where(r)}{orderAddr(r)}{(r.ip ? <><br /><small className="muted"><Val v={r.ip} /></small></> : null)}</td><td>{deviceCell(r, true)}</td><td>{sourcePill(r)}</td><td className="num"><Val v={dur(r.on_site)} /></td><td className="num">{bn(r.pageviews)}</td><td>{who(r)}{(r.order_code ? <><br /><a className="pill pill-green" href={`/admin/orders?q=${attrValue(r.order_code)}`}>অর্ডার{' '}<Val v={r.order_code} /></a></> : null)}</td><td><a className="btn btn-sm btn-ghost" href={`${attrValue(BASE)}/s/${attrValue(r.id)}`}>বিস্তারিত</a></td></tr>))}</tbody></table></div> : ui.empty('এই মুহূর্তে কেউ সাইটে নেই।'))}</div></>;
  return ctx.page('লাইভ ভিজিটর', body, 'visitors');
}

// ---------------------------------------------------------------- all visits
async function sessionsPage(ctx: AdminCtx) {
  const page = pageNum(ctx.query);
  const r = ctx.query.get('from') || ctx.query.get('to') ? dateRange(ctx.query, 30) : { from: '', to: '' };
  const f = {
    from: r.from, to: r.to,
    q: str(ctx.query.get('q'), 80),
    source: str(ctx.query.get('source'), 80),
    device: DEVICES[ctx.query.get('device')] ? ctx.query.get('device') : '',
    ordered: ctx.query.get('ordered') === '1',
    net: ['bd', 'vpn', 'abroad', 'suspicious'].includes(ctx.query.get('net')) ? ctx.query.get('net') : '',
    visitor: /^[a-f0-9]{20}$/.test(ctx.query.get('visitor') || '') ? ctx.query.get('visitor') : '',
  };
  const [rows, total, sources, live] = await Promise.all([
    V.listSessions(f, { limit: PER_PAGE, offset: (page - 1) * PER_PAGE }), V.countSessions(f), V.sourceList(), V.liveSessions(),
  ]);
  const qs = new URLSearchParams({ tab: 'sessions' });
  for (const [key, val] of Object.entries(f)) if (val) qs.set(key, val === true ? '1' : val);
  const s = ctx.settings;
  const body = <><div className="title-row"><h1>ভিজিটর অ্যানালিটিক্স</h1></div>{tabs('sessions', live.length)}{offNotice(s)}<form className="toolbar" method="get" action={attrValue(BASE)}><input type="hidden" name="tab" defaultValue="sessions" />{' '}{(f.visitor ? <input type="hidden" name="visitor" defaultValue={attrValue(f.visitor)} /> : null)}{' '}<input type="search" name="q" defaultValue={attrValue(f.q)} placeholder="শহর, IP, পেজ, পণ্য, নাম বা ফোন" aria-label="খুঁজুন" />{' '}{ui.select('source', [['', 'সব উৎস'], ...sources.map((x) => [x, x])], f.source)}{' '}{ui.select('device', [['', 'সব ডিভাইস'], ...Object.entries(DEVICES).map(([k2, v]) => [k2, v[1]])], f.device)}{' '}{ui.select('net', [['', 'সব দেশ / নেটওয়ার্ক'], ['bd', '🇧🇩 বাংলাদেশ থেকে'], ['vpn', '🛡️ VPN / প্রক্সি'], ['abroad', '🌍 বিদেশ থেকে'], ['suspicious', '🚨 সন্দেহজনক']], f.net)}{' '}<label className="small">থেকে{' '}<input type="date" name="from" defaultValue={attrValue(f.from)} /></label>{' '}<label className="small">পর্যন্ত{' '}<input type="date" name="to" defaultValue={attrValue(f.to)} /></label>{' '}{ui.check('ordered', f.ordered, 'শুধু যারা অর্ডার করেছে')}{' '}<button className="btn btn-sm">খুঁজুন</button>{' '}{([...qs.keys()].length > 1 ? <a className="small" href={`${attrValue(BASE)}?tab=sessions`}>সব দেখুন</a> : null)}</form>{(f.visitor ? <p className="flash">একজন নির্দিষ্ট ভিজিটরের সব ভিজিট দেখাচ্ছে।</p> : null)}{' '}{(rows.length ? <><div className="table-wrap"><table className="table va-table"><thead><tr><th>কখন</th><th>লোকেশন</th><th>ডিভাইস</th><th>কোথা থেকে</th><th>প্রথম পেজ → শেষ পেজ</th><th className="num">পেজ</th><th className="num">সময়</th><th>কে / ফলাফল</th></tr></thead><tbody>{jsxList(rows.map((x) => <tr className="row-link" data-href={`${attrValue(BASE)}/s/${attrValue(x.id)}`}><td><a href={`${attrValue(BASE)}/s/${attrValue(x.id)}`}><b><Val v={ago(x.started_at)} /></b></a><br /><small className="muted">{fmtDate(x.started_at)}</small></td><td>{where(x)}{orderAddr(x)}</td><td>{deviceCell(x)}</td><td>{sourcePill(x)}{(x.campaign ? <><br /><small className="muted"><Val v={x.campaign} /></small></> : null)}</td><td className="small"><Val v={decodeSafe(x.landing)} />{(x.exit_path && x.exit_path !== x.landing ? <>{' '}<span className="muted">→</span>{' '}<Val v={decodeSafe(x.exit_path)} /></> : null)}</td><td className="num">{bn(x.pageviews)}</td><td className="num"><Val v={dur(x.duration)} /></td><td>{who(x)}{' '}{(x.order_code ? <><br /><span className="pill pill-green">✅ অর্ডার{' '}<Val v={x.order_code} /></span></> : (x.carts ? <><br /><span className="pill pill-amber">🛒 কার্টে{' '}{bn(x.carts)}টি, অর্ডার করেনি</span></> : null))}</td></tr>))}</tbody></table></div>{ui.pager(total, page, PER_PAGE, BASE + '?' + qs)}</> : ui.empty('কোনো ভিজিট পাওয়া যায়নি।'))}</>;
  return ctx.page('সব ভিজিট', body, 'visitors');
}

// ---------------------------------------------------------------- one visit
async function sessionPage(ctx: AdminCtx, m?: Loose) {
  const x: Loose = await V.getSession(m[1]);
  if (!x) return ctx.back(`${BASE}?tab=sessions`);
  const s = ctx.settings;
  // one timeline: pages and actions in the order they happened
  const timeline: Loose[] = [
    ...x.views.map((v: Loose) => ({ at: v.created_at, kind: 'page', v })),
    ...x.events.map((e: Loose) => ({ at: e.created_at, kind: 'event', e })),
  ].sort((a: Loose, b: Loose) => +new Date(a.at) - +new Date(b.at) || (a.kind === 'page' ? -1 : 1));
  const p = V.place(x);
  const body = <><p className="crumbs"><a href={`${attrValue(BASE)}?tab=sessions`}>← সব ভিজিট</a></p><div className="title-row"><h1>একটি ভিজিটের বিস্তারিত</h1></div><div className="two-col"><section className="panel"><h2>ভিজিটর কে</h2><dl className="dl">{(x.visitor_name || x.visitor_phone ? <><dt>নাম / ফোন</dt><dd><b><Val v={x.visitor_name} /></b>{' '}<Val v={x.visitor_phone} />{(x.visitor_phone ? <>{' '}·{' '}<a href={`/admin/customers?q=${attrValue(x.visitor_phone)}`}>কাস্টমার দেখুন</a></> : null)}</dd></> : null)}<dt>লোকেশন (IP থেকে)</dt><dd>{ui.flag(x.country)}{' '}<Val v={p.text} />{(x.country ? <>{' '}<span className="muted">(<Val v={p.country} />)</span></> : null)}{netBadge(x)}</dd>{(NET[x.net] ? <><dt></dt><dd className="small muted"><Val v={NET[x.net][2]} /></dd></> : null)}{' '}{(x.o_address || x.o_district ? <><dt>ডেলিভারি ঠিকানা</dt><dd translate="no">🏠{' '}{[x.o_address, x.o_thana, x.o_district].filter(Boolean).join(', ')}</dd></> : null)}{' '}{(x.tz ? <><dt>ডিভাইসের ঘড়ি</dt><dd><Val v={x.tz} /></dd></> : null)}<dt>IP ঠিকানা</dt><dd><Val v={x.ip || '—'} /></dd><dt>ডিভাইস</dt><dd>{device(x.device)}{(phoneName(x) ? <>{' '}·{' '}<b translate="no"><Val v={phoneName(x)} /></b></> : null)}{' '}·{' '}<Val v={x.os} />{' '}·{' '}<Val v={x.browser} />{(x.screen ? <>{' '}· স্ক্রিন{' '}<Val v={x.screen} /></> : null)}</dd><dt>ভাষা</dt><dd><Val v={x.lang || '—'} /></dd><dt>প্রথম এসেছিল</dt><dd>{fmtDate(x.first_seen)}</dd><dt>মোট এসেছে</dt><dd>{bn(x.total_visits)}{' '}বার ·{' '}{bn(x.total_pageviews)}টি পেজ{(x.total_orders ? <>{' '}·{' '}<b className="good">{bn(x.total_orders)}টি অর্ডার</b></> : null)}</dd></dl>{(x.others.length ? <p><a className="btn btn-sm btn-ghost" href={`${attrValue(BASE)}?tab=sessions&visitor=${attrValue(x.visitor_id)}`}>এই ভিজিটরের সব ভিজিট ({bn(x.others.length + 1)})</a></p> : null)}</section><section className="panel"><h2>এই ভিজিট</h2><dl className="dl"><dt>শুরু</dt><dd>{fmtDate(x.started_at)}{' '}<span className="muted">(<Val v={ago(x.started_at)} />)</span></dd><dt>শেষ দেখা</dt><dd>{fmtDate(x.last_seen)}</dd><dt>সাইটে ছিল</dt><dd><b><Val v={dur(x.duration)} /></b>{' '}(সক্রিয় সময়)</dd><dt>পেজ দেখেছে</dt><dd>{bn(x.pageviews)}টি</dd><dt>কোথা থেকে</dt><dd>{sourcePill(x)}{' '}<span className="muted small"><Val v={x.medium} /></span>{(x.campaign ? <>{' '}· ক্যাম্পেইন:{' '}<b><Val v={x.campaign} /></b></> : null)}</dd>{(x.referrer ? <><dt>রেফারার</dt><dd className="small break"><Val v={x.referrer} /></dd></> : null)}<dt>ফলাফল</dt><dd>{(x.order_code ? <a className="pill pill-green" href={`/admin/orders?q=${attrValue(x.order_code)}`}>✅ অর্ডার{' '}<Val v={x.order_code} /></a> : <span className="muted">অর্ডার করেনি</span>)}</dd></dl></section></div><section className="panel"><h2>কী কী করেছে (ধাপে ধাপে)</h2>{(timeline.length ? <ol className="journey">{jsxList(timeline.map((t) => (t.kind === 'page' ? <li className="j-page"><time><Val v={fmtTime(t.at)} /></time><div>{pageCell(t.v.path, t.v.product_name || t.v.title, s)}{' '}<small className="muted">{(t.v.duration ? `${dur(t.v.duration)} ছিল` : "সময় জানা যায়নি")}{(t.v.scroll ? ` · ${bn(t.v.scroll)}% পর্যন্ত স্ক্রল` : null)}</small></div></li> : <li className="j-event"><time><Val v={fmtTime(t.at)} /></time><div><b><Val v={(EVENT_LABELS[t.e.event] || ['•'])[0]} />{' '}<Val v={(EVENT_LABELS[t.e.event] || ['', t.e.event])[1]} /></b>{' '}{(t.e.label ? <>:{' '}<Val v={t.e.label} /></> : null)}{(t.e.value ? <>{' '}<span className="muted">({money(t.e.value)})</span></> : null)}</div></li>)))}</ol> : <p className="muted">কোনো পেজের তথ্য নেই।</p>)}</section>{(x.others.length ? <section className="panel"><h2>এই ভিজিটরের আগের/পরের ভিজিট</h2><div className="table-wrap"><table className="table"><thead><tr><th>কখন</th><th>কোথা থেকে</th><th className="num">পেজ</th><th className="num">সময়</th><th>ফলাফল</th></tr></thead><tbody>{jsxList(x.others.map((o: Loose) => <tr><td><a href={`${attrValue(BASE)}/s/${attrValue(o.id)}`}>{fmtDate(o.started_at)}</a></td><td><Val v={o.source} /></td><td className="num">{bn(o.pageviews)}</td><td className="num"><Val v={dur(o.duration)} /></td><td>{(o.order_code ? <span className="pill pill-green">অর্ডার{' '}<Val v={o.order_code} /></span> : null)}</td></tr>))}</tbody></table></div></section> : null)}</>;
  return ctx.page('ভিজিটের বিস্তারিত', body, 'visitors');
}
function fmtTime(d?: Loose) {
  return bn(new Date(d).toLocaleTimeString('en-GB', { timeZone: 'Asia/Dhaka', hour: '2-digit', minute: '2-digit', second: '2-digit' }));
}

// ---------------------------------------------------------------- settings
async function settingsPage(ctx: AdminCtx) {
  const s = ctx.settings;
  if (ctx.method === 'POST') {
    const b = await ctx.body();
    const keep = ['30', '60', '90', '180', '365'].includes(String(b.visitor_keep_days)) ? String(b.visitor_keep_days) : '60';
    await db.setMany({ visitor_tracking: b.visitor_tracking ? '1' : '0', visitor_exclude_admin: b.visitor_exclude_admin ? '1' : '0', visitor_keep_days: keep });
    await ctx.reloadSettings();
    await ctx.log('settings', 'marketing', null, 'ভিজিটর অ্যানালিটিক্স সেটিংস');
    return ctx.back(`${BASE}?tab=settings`, 'saved');
  }
  const live = await V.liveSessions();
  const sw = (name?: Loose, on?: Loose, title?: Loose, desc?: Loose) => <label className="switch-row">{' '}<span className="switch-text"><b><Val v={title} /></b><small><Val v={desc} /></small></span>{' '}<span className="switch"><input type="checkbox" name={attrValue(name)} defaultValue="1" defaultChecked={!!(on)} /><span className="switch-ui" aria-hidden="true"></span></span>{' '}<span className="switch-state" data-on="চালু" data-off="বন্ধ"></span></label>;
  const size = await db.one(`SELECT (SELECT count(*) FROM page_views)::int AS views, (SELECT count(*) FROM visit_sessions)::int AS sessions,
    pg_size_pretty(pg_total_relation_size('page_views') + pg_total_relation_size('visit_sessions') + pg_total_relation_size('visit_events') + pg_total_relation_size('visitors')) AS size`);
  const body = <><div className="title-row"><h1>ভিজিটর অ্যানালিটিক্স</h1></div>{tabs('settings', live.length)}{ui.flash(ctx.flash)}<div className="two-col"><form method="post" action={attrValue(BASE)} className="form panel"><h2>সেটিংস</h2><div className="switch-list">{sw('visitor_tracking', s.visitor_tracking !== '0', 'ভিজিটর ট্র্যাকিং চালু', 'বন্ধ করলে নতুন ভিজিটরের তথ্য আর জমা হবে না (আগের তথ্য থেকে যাবে)।')}{' '}{sw('visitor_exclude_admin', s.visitor_exclude_admin !== '0', 'আমার নিজের ভিজিট গুনবে না', 'যে ব্রাউজারে Admin প্যানেলে লগইন করা আছে, সেখান থেকে দোকান দেখলে সেটা হিসাবে ধরবে না — তাহলে আসল কাস্টমারের হিসাব ঠিক থাকবে।')}</div>{ui.field('তথ্য কতদিন রাখবে', ui.select('visitor_keep_days', [['30', '৩০ দিন'], ['60', '৬০ দিন (পরামর্শ)'], ['90', '৯০ দিন'], ['180', '১৮০ দিন'], ['365', '১ বছর']], s.visitor_keep_days || '60'),
    'এর চেয়ে পুরনো ভিজিটের তথ্য নিজে থেকে মুছে যাবে, যাতে ডাটাবেস ভরে না যায়। অর্ডার বা কাস্টমারের তথ্য কখনো মুছবে না।')}{' '}<button className="btn">সেভ করুন</button></form><section className="panel"><h2>কীভাবে কাজ করে</h2><ul className="checklist"><li>✅ কেউ দোকানে ঢুকলে সে কোন পেজ দেখছে, কতক্ষণ থাকছে, কতটা স্ক্রল করছে — সব জমা হয়।</li><li>✅ লোকেশন (দেশ, বিভাগ/জেলা, শহর) IP থেকে Vercel নিজে বের করে দেয়, তাই আলাদা কোনো সার্ভিস লাগে না। এটা আনুমানিক — মোবাইল ডাটায় অনেক সময় কাছের বড় শহর দেখায়।</li><li>✅ Facebook, Google, TikTok, YouTube বা সরাসরি — কোথা থেকে এসেছে তা রেফারার আর বিজ্ঞাপনের লিংক (fbclid, gclid, utm) দেখে বোঝা যায়।</li><li>✅ কেউ অর্ডার করলে তার নাম-ফোন সেই ভিজিটের সাথে জুড়ে যায়, তাই কোন কাস্টমার কোন পথে এসে কিনলো দেখতে পাবেন।</li><li>✅ গুগল/ফেসবুকের রোবট (bot) গোনা হয় না।</li></ul><p className="muted small">এখন জমা আছে:{' '}{bn(size!.sessions)}টি ভিজিট,{' '}{bn(size!.views)}টি পেজ ভিউ (জায়গা লাগছে{' '}<Val v={size!.size} />)।</p>{resetBox(ctx)}</section></div></>;
  return ctx.page('ভিজিটর সেটিংস', body, 'visitors');
}

// ---------------------------------------------------------------- 🌍 দেশ ব্লক (owner only)
// Tick the countries that may open the shop; everyone else sees "not available in your country" (services/geolock.js).
async function countriesPage(ctx: AdminCtx) {
  const G = $services_geolock;
  const s = ctx.settings;
  const mine = G.countryOf(ctx.req);
  if (ctx.method === 'POST') {
    const b = await ctx.body();
    const picked = [...new Set(([] as Loose[]).concat(b.c || []).map((x) => String(x).toUpperCase()).filter((x) => Object.prototype.hasOwnProperty.call(G.COUNTRIES, x)))];
    const on = !!b.geo_lock_on;
    if (on && !picked.length) return ctx.fail(COUNTRY_PATH, 'চালু করতে অন্তত একটা দেশে টিক দিন (যেমন বাংলাদেশ)।');
    await db.setMany({ geo_lock_on: on ? '1' : '0', geo_allow: picked.join(','), geo_tz_check: b.geo_tz_check ? '1' : '0', geo_vpn_home: b.geo_vpn_home ? '1' : '0' });
    await ctx.reloadSettings();
    await ctx.log('settings', 'marketing', null, `দেশ ব্লক: ${on ? 'চালু' : 'বন্ধ'} — খোলা: ${picked.join(', ') || '—'}`);
    return ctx.back(COUNTRY_PATH, 'saved');
  }
  const cfg = G.config(s);
  const allow = new Set(G.allowedList(s));
  const [visits, blocked, live] = await Promise.all([
    db.q(`SELECT country, count(*)::int AS n FROM visit_sessions WHERE started_at > now() - interval '30 days' AND country <> '' GROUP BY country`).catch(() => []),
    db.q(`SELECT country, why, sum(n)::int AS n FROM geo_blocks WHERE day > (now() AT TIME ZONE 'Asia/Dhaka')::date - 7 GROUP BY country, why ORDER BY 3 DESC`).catch(() => []),
    V.liveSessions(),
  ]);
  const seen = Object.fromEntries(visits.map((r) => [r.country, r.n]));
  const blockedTotal = blocked.reduce((a, r) => a + r.n, 0);
  const tzBlocked = blocked.filter((r) => r.why === 'tz').reduce((a, r) => a + r.n, 0);
  // ticked first, then countries that sent visitors (most first), then the rest by name
  const list = Object.keys(G.COUNTRIES).map((c) => ({ c, bn: V.countryName(c), en: G.countryName(c, 'en'), n: seen[c] || 0, on: allow.has(c) }))
    .sort((a: Loose, b: Loose) => (b.on - a.on) || (b.n - a.n) || a.en.localeCompare(b.en));
  const topVisits = Math.max(1, ...list.map((r) => r.n));
  const sw = (name?: Loose, on?: Loose, title?: Loose, desc?: Loose) => <label className="switch-row">{' '}<span className="switch-text"><b><Val v={title} /></b><small><Val v={desc} /></small></span>{' '}<span className="switch"><input type="checkbox" name={attrValue(name)} defaultValue="1" defaultChecked={!!(on)} /><span className="switch-ui" aria-hidden="true"></span></span>{' '}<span className="switch-state" data-on="চালু" data-off="বন্ধ"></span></label>;
  const body = <><div className="title-row"><h1>ভিজিটর অ্যানালিটিক্স</h1></div>{tabs('countries', live.length)}{ui.flash(ctx.flash)}<div className="kpis kpis-tight">{ui.kpi('অবস্থা', cfg.on ? '🔒 চালু' : '⚪ বন্ধ', cfg.on ? <span className="flag-row">খোলা:{' '}{jsxList(cfg.list.map((c) => ui.flag(c)))}</span> : 'এখন সব দেশ থেকে ঢোকা যায়')}{' '}{ui.kpi('খোলা দেশ', bn(allow.size), '')}{' '}{ui.kpi('গত ৭ দিনে আটকানো', bn(blockedTotal), tzBlocked ? `এর মধ্যে VPN (ঘড়ি মেলেনি) ${bn(tzBlocked)}` : '')}{' '}{ui.kpi('আপনি এখন আছেন', mine ? <span className="flag-big">{ui.flag(mine)}{' '}<Val v={V.countryName(mine)} /></span> : 'জানা যায়নি', mine && cfg.on && !allow.has(mine) ? 'এই দেশে টিক নেই' : '')}</div><form method="post" action={attrValue(COUNTRY_PATH)} className="form" data-geo-form=""><div className="two-col"><section className="panel"><h2>🌍 শুধু টিক দেওয়া দেশ থেকে সাইটে ঢোকা যাবে</h2><div className="switch-list">{sw('geo_lock_on', s.geo_lock_on === '1', 'দেশ ব্লক চালু', 'চালু করলে টিক না দেওয়া দেশের কেউ দোকান খুললে দেখবে "দুঃখিত, আপনার দেশ থেকে খোলা যায় না"।')}{' '}{sw('geo_tz_check', s.geo_tz_check !== '0', 'VPN দিয়ে লুকিয়ে আসা বিদেশি ধরুন', 'বিদেশি কেউ বাংলাদেশের VPN দিয়ে এলেও তার ফোন/কম্পিউটারের ঘড়ি নিজের দেশের সময়ে থাকে। ঘড়ি টিক দেওয়া দেশের না হলে আটকে যাবে।')}{' '}{sw('geo_vpn_home', s.geo_vpn_home === '1', 'VPN চালু রাখা দেশি কাস্টমারকে ঢুকতে দিন', 'বন্ধ থাকলে (পরামর্শ) বাংলাদেশে বসে VPN চালিয়ে এলে বিদেশি হিসেবেই আটকে যাবে — VPN বন্ধ করলেই ঢুকতে পারবে। চালু করলে ঘড়ি বাংলাদেশের সময়ে থাকলে ঢুকতে দেবে।')}</div><h3 className="h3">দেশ বাছাই করুন{' '}<span className="muted small" data-geo-count=""></span></h3><div className="field-row"><div className="field"><input type="search" placeholder="দেশ খুঁজুন… (যেমন India / ভারত)" data-geo-search="" aria-label="দেশ খুঁজুন" /></div><div className="field"><button type="button" className="btn btn-sm btn-ghost" data-geo-only="">শুধু টিক দেওয়াগুলো দেখুন</button>{' '}<button type="button" className="btn btn-sm btn-ghost" data-geo-none="">সব টিক তুলে দিন</button></div></div><div className="geo-list">{jsxList(list.map((r) => <label className={`check geo-row${r.on ? ' is-on' : ''}`} data-geo-row="" data-k={(r.bn + ' ' + r.en + ' ' + r.c).toLowerCase()}>{' '}<input type="checkbox" name="c" defaultValue={attrValue(r.c)} defaultChecked={!!(r.on)} />{' '}{ui.flag(r.c)}{' '}<span className="geo-name"><b><Val v={r.bn} /></b>{' '}<span className="small muted"><Val v={r.en} /></span></span>{' '}{(r.n ? <span className="geo-visits" title="গত ৩০ দিনের ভিজিট"><span className="geo-bar" style={{ width: `${Math.max(6, Math.round(r.n / topVisits * 100))}%` }}></span><b>{bn(r.n)}</b>{' '}ভিজিট</span> : null)}</label>))}</div><p className="small muted">প্রথমে টিক দেওয়া দেশ, তারপর গত ৩০ দিনে যেসব দেশ থেকে ভিজিটর এসেছে (বেশি থেকে কম), তারপর বাকি সব দেশ।</p><button className="btn btn-block btn-lg">✅ সেভ করুন</button></section><section className="panel"><h2>গত ৭ দিনে যাদের আটকানো হয়েছে</h2>{(blocked.length ? <table className="table compact"><thead><tr><th>দেশ</th><th>কারণ</th><th className="num">বার</th></tr></thead><tbody>{jsxList(blocked.slice(0, 30).map((r) => <tr><td>{ui.flag(r.country === '??' ? '' : r.country)}{' '}{(r.country === '??' ? "অজানা" : <Val v={V.countryName(r.country)} />)}</td><td className="small">{(r.why === 'tz' ? "🛡️ VPN (ঘড়ি মেলেনি)" : (r.why === 'admin' ? "🔐 অ্যাডমিনে ঢোকার চেষ্টা" : "🌍 দেশ"))}</td><td className="num">{bn(r.n)}</td></tr>))}</tbody></table> : <p className="muted">{(cfg.on ? "এখনো কাউকে আটকাতে হয়নি।" : "দেশ ব্লক বন্ধ আছে।")}</p>)}<h2>যা কখনো আটকাবে না</h2><ul className="checklist small"><li>🔐 অ্যাডমিন প্যানেলের দেশ আলাদা ঠিক করা হয় (শুধু বাংলাদেশ, বিদেশ যাওয়ার আগে খুলে নিতে হয়):{' '}<a href="/admin/security#admin-country">নিরাপত্তা → অ্যাডমিন কোন দেশ থেকে খুলবে</a>। অ্যাডমিনে লগইন করা ব্রাউজারে দোকানও খুলবে।</li><li>✅ Google, Facebook, Bing-এর রোবট — এরা আমেরিকা/ইউরোপ থেকে আসে। আটকালে দোকান Google সার্চ, Merchant Center আর ফেসবুক পোস্টের ছবি থেকে হারিয়ে যেত।</li><li>✅ বিকাশ/পেমেন্ট, Pathao/Steadfast কুরিয়ারের অটো-আপডেট আর প্রতিদিনের অটো কাজ।</li><li>✅ পণ্যের ছবি আর প্রোডাক্ট ফিড।</li></ul><p className="small muted">দেশ বোঝা হয় ভিজিটরের IP থেকে (Vercel নিজে বলে দেয়)। কোনো কারণে দেশ জানা না গেলে তাকে ঢুকতে দেওয়া হয়, যাতে ভুলে পুরো দোকান বন্ধ না হয়।</p></section></div></form></>;
  return ctx.page('দেশ ব্লক', body, 'visitors');
}

async function clearData(ctx: AdminCtx) {
  await V.clearAll();
  await ctx.reloadSettings();
  await ctx.log('settings', 'marketing', null, 'ভিজিটর অ্যানালিটিক্সের সব হিসাব শূন্য করা হয়েছে');
  return ctx.back(BASE, 'analytics_cleared');
}

async function main(ctx: AdminCtx) {
  const tab = ctx.query.get('tab') || '';
  if (ctx.method === 'POST' || tab === 'settings') return settingsPage(ctx);
  if (tab === 'live') return livePage(ctx);
  if (tab === 'sessions') return sessionsPage(ctx);
  return overviewPage(ctx);
}

export const routes = [
    { method: '*', path: BASE, perm: 'marketing', handler: main },
    { method: 'GET', path: /^\/admin\/marketing\/visitors\/s\/([a-f0-9]{20})$/, perm: 'marketing', handler: sessionPage },
    { method: 'POST', path: '/admin/marketing/visitors/clear', perm: 'owner', handler: clearData },
    { method: '*', path: COUNTRY_PATH, perm: 'owner', handler: countriesPage },
  ];
