// Admin → মার্কেট রিসার্চ (owner only). Nothing here is ever shown on the shop.
import { Val, attrValue, jsxList } from '../react/html';
import { raw, bn, money, int, str, fmtDate } from '../util';
import * as db from '../db';
import * as R from '../services/research';
import * as ui from './ui';
import type { AdminCtx, Loose } from '../types';

const TABS = [['winning', '🏆 উইনিং প্রোডাক্ট'], ['find', '🔍 প্রোডাক্ট খুঁজুন'], ['new', '🆕 বাজারে নতুন'], ['drops', '📉 দাম কমেছে'], ['demand', '🔎 আপনার কাস্টমার যা খুঁজছে'], ['sources', '🏪 যেসব দোকান দেখা হচ্ছে']];

function pic(src?: Loose) { return src ? <img src={attrValue(src)} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <span>📦</span>; }
function ago(d?: Loose) {
  if (!d) return 'এখনো না';
  const m = Math.round((Date.now() - new Date(d).getTime()) / 60000);
  return m < 1 ? 'এইমাত্র' : m < 60 ? `${bn(m)} মিনিট আগে` : m < 1440 ? `${bn(Math.round(m / 60))} ঘণ্টা আগে` : `${bn(Math.round(m / 1440))} দিন আগে`;
}

function winningCard(g?: Loose, i?: Loose, segment: Loose = '') {
  const links = R.sourcingLinks(g.term);
  return <article className="rs-card"><div className="rs-rank">{bn(i + 1)}</div><a className="rs-pic" href={attrValue(g.best.url)} target="_blank" rel="noopener noreferrer">{pic(g.lead.image)}</a><div className="rs-body"><h3><a href={attrValue(g.lead.url)} target="_blank" rel="noopener noreferrer"><Val v={g.lead.title} /></a></h3><p className="rs-why">{jsxList(g.why.slice(0, 4).map((w) => <span><Val v={w} /></span>))}</p><div className="rs-nums"><div><small>বাজারে দাম</small><b>{(g.min === g.max ? money(g.min) : <>{money(g.min)}{' '}–{' '}{money(g.max)}</>)}</b><small>সবচেয়ে কম:{' '}<Val v={g.best.shop} /></small></div><div><small>আপনি বিক্রি করতে পারেন</small><b className="good">{(g.sell ? money(g.sell) : "—")}</b><small>বাজারের মাঝামাঝি দামের সামান্য কম</small></div><div><small>এর চেয়ে কমে কিনলে লাভ</small><b className="warn">{(g.buyMax ? money(g.buyMax) : "—")}</b><small>কেনা দাম এর মধ্যে রাখুন</small></div><div><small>আপনার দোকানে</small>{oursCell(g.oursAll || [], g.best.url, g.min, g.max, `/admin/research${segment ? `?seg=${segment}` : ''}`)}</div></div><p className="rs-src"><small>কোথা থেকে কিনবেন খুঁজুন:</small>{' '}{jsxList(links.map(([l, u]) => <a href={attrValue(u)} target="_blank" rel="noopener noreferrer"><Val v={l} /></a>))}</p><p className="rs-shops small muted">যে দোকানে আছে:{' '}{jsxList(g.items.slice(0, 5).map((x) => <><a href={attrValue(x.url)} target="_blank" rel="noopener noreferrer"><Val v={x.shop} />{' '}({money(x.price)}{(x.rank ? `, #${bn(x.rank)}` : null)})</a>{' '}</>))}</p></div></article>;
}

// "is it in our shop?" — every matching product, with a link; unsure matches say so
// The import page opens in the SAME tab: a new tab on a phone is handed to the customer app
// (it owns shobmilbe.com links), which never opens admin pages.
function impLink(url?: Loose, back?: Loose) { return `/admin/products/import?url=${encodeURIComponent(url)}${back ? `&back=${encodeURIComponent(back)}` : ''}`; }
function oursCell(list?: Loose, url?: Loose, min?: Loose, max?: Loose, back: Loose = '/admin/research') {
  if (!list.length) return <><b className="bad">নেই</b><small><a href={attrValue(impLink(url, back))}>➕ তথ্য কপি করে আনুন →</a></small></>;
  const sure = list[0].match >= 0.85;
  const p = list[0];
  const priceNote = min && max ? (Number(p.price) > max ? '⚠️ বাজারের চেয়ে বেশি দাম' : Number(p.price) < min ? 'বাজারের চেয়ে কম দাম' : 'দাম বাজারের মধ্যে') : '';
  return <><b className={sure ? '' : 'warn'}>{(sure ? (list.length > 1 ? `আছে (${bn(list.length)}টি)` : "আছে") : "সম্ভবত আছে")}</b>{' '}{jsxList(list.slice(0, 3).map((x) => <small><a href={`/admin/products/${attrValue(x.id)}`}>{(x.name.length > 46 ? (x.name.slice(0, 44) + '…') : <Val v={x.name} />)}{' '}—{' '}{money(x.price)}</a>{(x.active === false ? " (বন্ধ)" : null)}{(x.via === 'link' ? " · এই দোকান থেকেই আনা" : null)}</small>))}{' '}{(sure ? (priceNote || p.cost_price ? <small><Val v={priceNote} />{(p.cost_price ? ` · কেনা ${money(p.cost_price)}` : null)}</small> : null) : <small>নাম পুরো মেলেনি — মিলিয়ে দেখুন।{' '}<a href={attrValue(impLink(url, back))}>আলাদা হলে আনুন →</a></small>)}</>;
}

// another shop seen on Google: paste its link once, every later search includes it
function addShop(term?: Loose) {
  const g = `https://www.google.com/search?q=${encodeURIComponent(term + ' price in Bangladesh')}`;
  return <section className="panel rs-addshop"><h2>আরও দোকানে খুঁজতে চান?</h2><p className="small muted"><a href={attrValue(g)} target="_blank" rel="noopener noreferrer">Google-এ "<Val v={term} />{' '}price in Bangladesh" খুলুন →</a>{' '}যে দোকানে পণ্যটা দেখবেন, তার লিংক নিচে দিন। এরপর থেকে প্রতিটা সার্চে ওই দোকানেও খোঁজা হবে (সারাদিন পড়া হবে না, শুধু আপনি খুঁজলে)।</p><form method="post" action="/admin/research" className="toolbar"><input type="hidden" name="form" defaultValue="add_search" /><input type="hidden" name="q" defaultValue={attrValue(term)} />{' '}<input type="url" name="url" placeholder="https://দোকানের-ঠিকানা.com" required maxLength={300} /><button className="btn btn-sm">➕ সার্চে যোগ করুন</button></form></section>;
}

// 🔍 search every shop by product name
async function findTab(ctx: AdminCtx) {
  const term = str(ctx.query.get('q') || '', 80).trim();
  const form = <><form method="get" action="/admin/research" className="toolbar rs-find" data-rs-find=""><input type="hidden" name="tab" defaultValue="find" />{' '}<input type="search" name="q" defaultValue={attrValue(term)} placeholder="পণ্যের নাম বা নামের অংশ — যেমন TDA2030, 7812, SG90" required minLength={2} maxLength={80} autoFocus />{' '}<button className="btn">🔍 সব দোকানে খুঁজুন</button><span className="small muted" data-rs-find-msg=""></span></form><p className="small muted">যেসব দোকান দেখা হচ্ছে আর বাংলাদেশের কম্পোনেন্টের দোকানগুলো — সবগুলোতে এখনই খোঁজা হয় (দোকানের নিজের সার্চ দিয়ে) + আগে পড়া তথ্য। ২০–২৫ সেকেন্ড লাগতে পারে। যেটা পছন্দ "➕ যোগ করুন" চাপুন — পণ্য আমদানির পেজ খুলে তথ্য ও ছবি নিজে থেকে কপি হয়ে আসবে, সেভ করে "← সার্চে ফিরে যান" চাপলে এই তালিকায় ফিরবেন।</p></>;
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
  const rows = (list?: Loose) => <div className="table-wrap panel"><table className="table rs-find-table"><thead><tr><th></th><th>পণ্য</th><th>দোকান</th><th className="num">দাম</th><th>আপনার দোকানে</th></tr></thead><tbody>{jsxList(list.map((x) => <tr className={x.ours.length ? 'rs-have' : ''}><td className="thumb">{pic(x.image)}</td><td><a href={attrValue(x.url)} target="_blank" rel="noopener noreferrer"><Val v={x.title} /></a>{(x.category ? <><br /><span className="small muted"><Val v={x.category} /></span></> : null)}</td><td className="small"><Val v={x.shop} />{(x.in_stock === false ? <><br /><span className="bad">স্টক নেই</span></> : null)}</td><td className="num">{(x.price ? <><b>{money(x.price)}</b>{(x.regular_price ? <><br /><s className="small muted">{money(x.regular_price)}</s></> : null)}</> : "—")}</td><td className="rs-ours">{(x.ours.length ? oursCell(x.ours, x.url, 0, 0, back) : <a className="btn btn-sm" href={attrValue(impLink(x.url, back))}>➕ যোগ করুন</a>)}</td></tr>))}</tbody></table></div>;
  return <>{form}{shopLine}<div className="rs-status panel"><span>📦{' '}<b>{bn(r.items.length)}</b>টি পাওয়া গেছে</span><span>🏪{' '}<b>{bn(new Set(r.items.map((x) => x.shop)).size)}</b>টি দোকানে</span>{' '}{(prices.length ? <span>💰 বাজারে দাম{' '}<b>{money(Math.min(...prices))}{' '}–{' '}{money(Math.max(...prices))}</b></span> : null)}{' '}<span>{(have ? <>✅{' '}<b>{bn(have)}</b>টি আপনার দোকানে আছে</> : "❌ আপনার দোকানে একটাও নেই")}</span></div>{(made.length && parts.length ? <h2 className="rs-sec">🔹 শুধু পার্ট / IC{' '}<small>{bn(parts.length)}টি</small></h2> : null)}{' '}{(parts.length ? rows(parts) : null)}{' '}{(made.length ? <><h2 className="rs-sec">🔸 এটা দিয়ে বানানো বোর্ড / মডিউল / কিট{' '}<small>{bn(made.length)}টি — প্রতিটা আলাদা পণ্য</small></h2>{rows(made)}</> : null)}{' '}{addShop(term)}</>;
}

async function page(ctx: AdminCtx) {
  const tab = TABS.some((t) => t[0] === ctx.query.get('tab')) ? ctx.query.get('tab') : 'winning';
  const segment = R.SEGMENTS[ctx.query.get('seg')] ? ctx.query.get('seg') : '';
  const margin = Math.min(80, Math.max(5, int(ctx.settings.research_margin, 30)));
  if (ctx.method === 'POST') {
    const b = await ctx.body();
    if (b.form === 'add_search') {
      const back = `/admin/research?tab=find&fresh=1&q=${encodeURIComponent(str(b.q, 80))}`;
      try { await R.addSource(str(b.url, 300), 'electronics', '', true); } catch (e: Loose) { return ctx.fail(back, e.message); }
      return ctx.back(back, 'added');
    }
    if (b.form === 'add') {
      try { await R.addSource(str(b.url, 300), b.segment, str(b.name, 60)); } catch (e: Loose) { return ctx.fail('/admin/research?tab=sources', e.message); }
      return ctx.back('/admin/research?tab=sources', 'added');
    }
    if (b.form === 'toggle' && int(b.id)) await db.q('UPDATE research_sources SET active = NOT active WHERE id=$1', [int(b.id)]);
    if (b.form === 'delete' && int(b.id)) await ctx.trash('research_source', int(b.id));
    if (b.form === 'margin') { await db.setSetting('research_margin', String(Math.min(80, Math.max(5, int(b.margin, 30))))); await ctx.reloadSettings(); }
    return ctx.back(`/admin/research?tab=${b.form === 'margin' ? 'winning' : 'sources'}`, 'saved');
  }
  const st = await R.status();
  const segChips = <div className="chips">{jsxList([['', 'সব'], ...Object.entries(R.SEGMENTS)].map(([k, l]) => <a className={`chip ${segment === k ? 'on' : ''}`} href={`/admin/research?tab=${attrValue(tab)}${k ? `&seg=${k}` : ''}`}><Val v={l} /></a>))}</div>;
  let content: Loose = '';
  if (tab === 'find') {
    content = await findTab(ctx);
  } else if (tab === 'winning') {
    const list = await R.winners({ segment, margin });
    content = <>{segChips}<form method="post" action="/admin/research" className="toolbar rs-margin"><input type="hidden" name="form" defaultValue="margin" />{' '}<label>কত % লাভ রাখতে চান{' '}<input type="number" name="margin" defaultValue={attrValue(margin)} min="5" max="80" className="w-num" /></label><button className="btn btn-sm btn-ghost">হিসাব বদলান</button>{' '}<span className="small muted">"এর চেয়ে কমে কিনলে লাভ" এই হার দিয়ে হিসাব হয়।</span></form>{(list.length ? <div className="rs-list"><Val v={list.map((g, i) => winningCard(g, i, segment))} /></div> : ui.empty('এখনো যথেষ্ট তথ্য জমেনি। কয়েক ঘণ্টা পর আবার দেখুন, বা উপরের "এখনই আপডেট করুন" চাপুন।'))}</>;
  } else if (tab === 'new') {
    const list = await R.newInMarket({ segment, limit: 60 });
    content = <>{segChips}{(list.length ? <div className="table-wrap panel"><table className="table"><thead><tr><th></th><th>পণ্য</th><th>দোকান</th><th className="num">দাম</th><th>কবে এসেছে</th><th>কিনতে খুঁজুন</th></tr></thead><tbody>{jsxList(list.map((x) => <tr><td className="thumb">{pic(x.image)}</td><td><a href={attrValue(x.url)} target="_blank" rel="noopener noreferrer"><Val v={x.title} /></a><br /><span className="small muted"><Val v={x.category} /></span></td><td className="small"><Val v={x.shop} /></td><td className="num">{(x.price ? money(x.price) : "—")}</td><td className="small"><Val v={ago(x.first_seen)} /></td><td className="small">{jsxList(R.sourcingLinks(x.title.split(/\s+/).slice(0, 6).join(' ')).slice(0, 3).map(([l, u]) => <><a href={attrValue(u)} target="_blank" rel="noopener noreferrer"><Val v={l} /></a>{' '}</>))}</td></tr>))}</tbody></table></div> : ui.empty('গত ৭ দিনে নতুন কিছু ধরা পড়েনি (প্রথম দিনের তথ্য "নতুন" ধরা হয় না)।'))}</>;
  } else if (tab === 'drops') {
    const list = await R.priceDrops({ limit: 40 });
    content = list.length ? <div className="table-wrap panel"><table className="table"><thead><tr><th></th><th>পণ্য</th><th>দোকান</th><th className="num">আগে</th><th className="num">এখন</th></tr></thead><tbody>{jsxList(list.map((x) => <tr><td className="thumb">{pic(x.image)}</td><td><a href={attrValue(x.url)} target="_blank" rel="noopener noreferrer"><Val v={x.title} /></a></td><td className="small"><Val v={x.shop} /></td><td className="num"><s>{money(x.prev_price)}</s></td><td className="num good"><b>{money(x.price)}</b></td></tr>))}</tbody></table></div>
      : ui.empty('গত ৭ দিনে কোনো দোকানে দাম কমেনি।');
  } else if (tab === 'demand') {
    const d = await R.demand(30);
    content = <div className="two-col"><section className="panel"><h2>কাস্টমার যা খুঁজেছে{' '}<small>৩০ দিন</small></h2>{(d.searches.length ? <table className="table"><thead><tr><th>খুঁজেছে</th><th className="num">কতবার</th><th className="num">আপনার দোকানে</th></tr></thead><tbody>{jsxList(d.searches.map((s) => <tr className={s.found ? '' : 'rs-miss'}><td><b><Val v={s.term} /></b></td><td className="num">{bn(s.times)}</td><td className="num">{(s.found ? <>{bn(s.found)}টি</> : <><b className="bad">নেই — এনে রাখুন!</b><br />{jsxList(R.sourcingLinks(s.term).slice(0, 3).map(([l, u]) => <><a className="small" href={attrValue(u)} target="_blank" rel="noopener noreferrer"><Val v={l} /></a>{' '}</>))}</>)}</td></tr>))}</tbody></table> : <p className="muted">এখনো কেউ সাইটে কিছু খোঁজেনি।</p>)}</section><section className="panel"><h2>সবচেয়ে বেশি দেখা পণ্য{' '}<small>৩০ দিন</small></h2>{(d.viewed.length ? <><table className="table"><thead><tr><th>পণ্য</th><th className="num">দেখেছে</th><th className="num">বিক্রি</th></tr></thead><tbody>{jsxList(d.viewed.map((p) => <tr><td><a href={`/admin/products/${attrValue(p.id)}`}><Val v={p.name} /></a>{(p.stock <= 0 ? <>{' '}<span className="pill pill-cancelled">স্টক নেই</span></> : null)}</td><td className="num">{bn(p.people)}{' '}জন</td><td className={`num ${p.sold ? 'good' : ''}`}>{bn(p.sold)}</td></tr>))}</tbody></table><p className="small muted">অনেকে দেখছে কিন্তু বিক্রি কম → দাম বা ছবি/বিবরণ দেখুন। স্টক নেই কিন্তু দেখছে → দ্রুত স্টক আনুন।</p></> : <p className="muted">এখনো তথ্য নেই।</p>)}</section></div>;
  } else {
    const sources = await R.listSources();
    content = <><section className="panel"><h2>নতুন দোকান যোগ করুন</h2><form method="post" action="/admin/research?tab=sources" className="form"><input type="hidden" name="form" defaultValue="add" /><div className="field-row">{ui.field('দোকানের লিংক', ui.input('url', '', { required: true, placeholder: 'https://example.com.bd', type: 'url' }))}{' '}{ui.field('ধরন', ui.select('segment', Object.entries(R.SEGMENTS), 'electronics'))}{' '}{ui.field('নাম (ঐচ্ছিক)', ui.input('name', '', { maxlength: 60 }))}</div><button className="btn">যোগ করুন</button><p className="small muted">বাংলাদেশের প্রায় যেকোনো অনলাইন দোকান যোগ করা যায়। WooCommerce / Shopify দোকানের পুরো তালিকা একবারে পড়া হয় (বিক্রির ক্রমসহ)। অন্য দোকান (নিজস্ব ওয়েবসাইট){' '}<b>পেজ ধরে ধরে</b>{' '}পড়া হয়: সাইটম্যাপ আর ক্যাটাগরি পেজ থেকে পণ্যের পেজ, তারপর প্রতিটা পণ্যের দাম ও স্টক। প্রতিবার ~২৫টা পেজ, ঘণ্টায় কয়েকবার। প্রথমবার পুরো দোকান পড়তে কয়েক দিন লাগে, তারপর প্রতিদিন নতুন পণ্য আর জনপ্রিয় পণ্যের দাম আবার দেখা হয়। দোকান যে পেজ রোবটকে পড়তে দেয় না (robots.txt), সেটা পড়া হয় না। Daraz, Facebook পেজ স্বয়ংক্রিয় পড়া বন্ধ রেখেছে।</p></form></section><div className="table-wrap panel"><table className="table"><thead><tr><th>দোকান</th><th>ধরন</th><th className="num">পণ্য (দাম জানা)</th><th>পেজ পড়া</th><th>শেষ পড়া</th><th>অবস্থা</th><th>চালু</th><th>মুছুন</th></tr></thead><tbody>{jsxList(sources.map((s) => <tr className={s.active ? '' : 'row-off'}><td><b><Val v={s.name} /></b><br /><a className="small muted" href={attrValue(s.url)} target="_blank" rel="noopener noreferrer"><Val v={s.url} /></a></td><td className="small">{(s.search_only ? <><b>🔍 শুধু সার্চে</b>{' '}·{' '}</> : null)}<Val v={R.SEGMENTS[s.segment] || s.segment} />{' '}·{' '}{(s.kind === 'woo' ? "WooCommerce (বিক্রির ক্রম সহ)" : (s.kind === 'shopify' ? "Shopify" : (s.kind === 'auto' ? "প্রথম সার্চে চেনা হবে" : "পেজ ধরে ধরে")))}</td><td className="num">{bn(s.live_items)}</td><td className="small">{(s.kind === 'site' ? (s.queued ? <>{bn(s.queued - s.waiting)}{' '}/{' '}{bn(s.queued)}{(s.waiting ? <><br /><span className="muted">{bn(s.waiting)}টি বাকি</span></> : <><br /><span className="good">সব পড়া হয়েছে</span></>)}</> : <span className="muted">শুরু হয়নি</span>) : <span className="muted">একবারে পুরো তালিকা</span>)}</td><td className="small"><Val v={ago(s.last_ok)} /></td><td className="small">{(s.last_error ? <span className="bad">⚠️{' '}<Val v={s.last_error} /></span> : (s.active ? "✅ চালু" : "বন্ধ"))}</td><td>{ui.rowSwitch(`/admin/toggle/research/${s.id}`, s.active, 'বন্ধ করলে এই দোকান আর পড়া হবে না')}</td><td className="prod-actions"><form method="post" action="/admin/research?tab=sources" data-confirm="এই দোকান আর তার সব তথ্য মুছবেন? রিসাইকেল বিনে থাকবে।"><input type="hidden" name="form" defaultValue="delete" /><input type="hidden" name="id" defaultValue={attrValue(s.id)} /><button className="btn btn-sm btn-danger">🗑️ মুছুন</button></form></td></tr>))}</tbody></table></div></>;
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
