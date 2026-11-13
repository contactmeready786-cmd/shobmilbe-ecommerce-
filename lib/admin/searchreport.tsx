// Admin → রিপোর্ট → 🔎 কাস্টমার কী খুঁজছে: the words customers typed in the shop's search box (the instant box too), how many
// products came up, and — when the same browser gave a name and number at checkout — who it was, with call / WhatsApp buttons.
// "পাওয়া যায়নি" = people want it but the shop doesn't have it (or names it differently) — a list of what to buy / rename.
// 📞 অনুরোধ: a search that found nothing can leave a number ("এনে দিলে জানাবো?") — call them when the product comes in.
import { Val, attrValue, jsxList } from '../react/html';
import { bn, fmtDate, int } from '../util';
import * as db from '../db';
import * as ui from './ui';
import type { AdminCtx } from '../types';

const BASE = '/admin/reports/search';
type Who = { name: string; phone: string; city: string };
const wa = (phone: string) => `https://wa.me/${String(phone).replace(/^0/, '880')}`;
function whoCell(w: Who | null | undefined) {
  if (!w || !w.phone) return w && w.city ? <span className="small muted">📍{' '}<Val v={w.city} />{' '}· নম্বর জানা নেই</span> : <span className="small muted">অজানা ভিজিটর</span>;
  return <><b><Val v={w.name || 'নাম নেই'} /></b>{' '}<a href={`tel:${attrValue(w.phone)}`}>📞{' '}<Val v={w.phone} /></a>{' '}<a href={attrValue(wa(w.phone))} target="_blank" rel="noopener">WhatsApp</a>{(w.city ? <span className="small muted">{' '}· 📍{' '}<Val v={w.city} /></span> : null)}</>;
}

// who a browser is: the latest name and number it typed at checkout (an order or an unfinished one), and its city
const WHO_SQL = `
  LEFT JOIN LATERAL (SELECT d.name, d.phone FROM checkout_drafts d WHERE d.visitor_id = s.visitor_id AND s.visitor_id <> '' ORDER BY d.updated_at DESC LIMIT 1) d ON true
  LEFT JOIN LATERAL (SELECT v.city, v.region FROM visit_sessions v WHERE v.visitor_id = s.visitor_id AND s.visitor_id <> '' ORDER BY v.started_at DESC LIMIT 1) v ON true`;
const WHO_COLS = `coalesce(d.name, '') AS name, coalesce(d.phone, '') AS phone, coalesce(nullif(v.city, ''), v.region, '') AS city`;

async function page(ctx: AdminCtx) {
  const days = [7, 30, 90].includes(int(ctx.query.get('days'))) ? int(ctx.query.get('days')) : 30;
  const [stats, zero, top, known, recent, reqs] = await Promise.all([
    db.one<{ n: number; zero: number; words: number; people: number; known: number }>(`SELECT count(*)::int AS n, count(*) FILTER (WHERE found = 0)::int AS zero, count(DISTINCT q)::int AS words,
      count(DISTINCT nullif(visitor_id, ''))::int AS people,
      count(DISTINCT visitor_id) FILTER (WHERE visitor_id <> '' AND EXISTS (SELECT 1 FROM checkout_drafts d WHERE d.visitor_id = search_log.visitor_id))::int AS known
      FROM search_log WHERE created_at > now() - make_interval(days => $1)`, [days]),
    db.q<{ q: string; n: number; people: number; last: Date | null }>(`SELECT q, count(*)::int AS n, count(DISTINCT nullif(visitor_id, ''))::int AS people, max(created_at) AS last
      FROM search_log WHERE found = 0 AND created_at > now() - make_interval(days => $1) GROUP BY q ORDER BY count(*) DESC, max(created_at) DESC LIMIT 60`, [days]),
    db.q<{ q: string; n: number; found: number }>(`SELECT q, count(*)::int AS n, round(avg(found))::int AS found FROM search_log WHERE found > 0 AND created_at > now() - make_interval(days => $1)
      GROUP BY q ORDER BY count(*) DESC LIMIT 40`, [days]),
    db.q<Who & { q: string; found: number; created_at: Date }>(`SELECT s.q, s.found, s.created_at, ${WHO_COLS} FROM search_log s ${WHO_SQL}
      WHERE s.created_at > now() - make_interval(days => $1) AND d.phone IS NOT NULL ORDER BY s.found ASC, s.id DESC LIMIT 80`, [days]),
    db.q<Who & { q: string; found: number; created_at: Date }>(`SELECT s.q, s.found, s.created_at, ${WHO_COLS} FROM search_log s ${WHO_SQL} ORDER BY s.id DESC LIMIT 40`),
    db.q<{ id: number; q: string; name: string; phone: string; status: string; created_at: Date }>(`SELECT id, q, name, phone, status, created_at FROM search_requests
      ORDER BY (status = 'new') DESC, created_at DESC LIMIT 100`),
  ]);
  const open = reqs.filter((r) => r.status === 'new').length;
  const body = <><h1>🔎 কাস্টমার কী খুঁজছে</h1>{ui.flash(ctx.flash)}<div className="toolbar"><span className="muted small">সময়:</span>{jsxList([7, 30, 90].map((d) => <>{' '}<a className={`chip ${d === days ? 'on' : ''}`} href={`${attrValue(BASE)}?days=${attrValue(d)}`}>গত{' '}{bn(d)}{' '}দিন</a></>))}{' '}<a className="btn btn-sm btn-ghost" href={`${attrValue(BASE)}?days=${attrValue(days)}`}>🔄 রিফ্রেশ</a></div>
    <div className="kpis kpis-tight">{ui.kpi('মোট সার্চ', bn(stats!.n), `${bn(stats!.words)}টি আলাদা শব্দ · ${bn(stats!.people)} জন`)}{' '}{ui.kpi('কিছু পাওয়া যায়নি', bn(stats!.zero), stats!.n ? `${bn(Math.round((stats!.zero * 100) / stats!.n))}% সার্চ খালি গেছে` : '', stats!.zero ? 'kpi-amber' : '')}{' '}{ui.kpi('নম্বর জানা কাস্টমার', bn(stats!.known), 'যারা সার্চ করেছে আর চেকআউটে নম্বর দিয়েছে', 'kpi-blue')}{' '}{ui.kpi('📞 ফোন করার অনুরোধ', bn(open), 'খুঁজে না পেয়ে নম্বর রেখে গেছে', open ? 'kpi-amber' : '', '#requests')}</div>
    {ui.helpBox('এই পেজ কীভাবে কাজে লাগাবেন', <ol className="steps"><li><b>📞 অনুরোধ</b>{' '}= কাস্টমার যা খুঁজেছে তা দোকানে নেই, তাই নম্বর রেখে গেছে। পণ্যটা এনে তাকে ফোন করুন — নিশ্চিত বিক্রি। নতুন অনুরোধ এলে ফোনে/ইমেইলে খবর যায়।</li><li><b>"পাওয়া যায়নি"</b>{' '}তালিকা = যেটা বারবার আসছে, সেটা কিনে এনে আপলোড করুন।</li><li>পণ্য আছে অথচ "পাওয়া যায়নি"-তে দেখাচ্ছে? কাস্টমার অন্য নামে খুঁজছে — পণ্যের SEO কিওয়ার্ড ঘরে ঐ শব্দটা লিখে দিন।</li><li><b>কে খুঁজেছে:</b>{' '}একই ফোন/ব্রাউজার থেকে কেউ কখনো চেকআউটে নাম-নম্বর দিলে (অর্ডার করুক বা না করুক) তার নাম-নম্বর সার্চের পাশে দেখায়। নম্বর না দিলে শুধু এলাকা দেখায়।</li></ol>)}
    <section className="panel table-wrap" id="requests"><h2>📞 ফোন করার অনুরোধ (খুঁজে পায়নি, নম্বর রেখে গেছে)</h2>{(reqs.length ? <table className="table compact"><thead><tr><th>যা খুঁজেছে</th><th>কাস্টমার</th><th>কখন</th><th></th></tr></thead><tbody>{jsxList(reqs.map((r) => <tr className={r.status === 'new' ? '' : 'muted'}><td><b><Val v={r.q} /></b></td><td>{whoCell({ name: r.name, phone: r.phone, city: '' })}</td><td className="small">{fmtDate(r.created_at)}</td><td>{(r.status === 'new' ? <form method="post" action={`${attrValue(BASE)}/done`}><input type="hidden" name="id" defaultValue={attrValue(r.id)} /><button className="btn btn-sm btn-ghost">✓ যোগাযোগ হয়েছে</button></form> : <span className="pill pill-green">✓ হয়েছে</span>)}</td></tr>))}</tbody></table> : <p className="muted">এখনো কেউ নম্বর রেখে যায়নি। কেউ কিছু খুঁজে না পেলে সার্চের নিচে "এনে দিলে জানাবো?" ঘর দেখে — সেখানে নম্বর দিলে এখানে আসবে।</p>)}</section>
    <section className="panel table-wrap"><h2>👤 যাদের নম্বর জানা — কী খুঁজেছে</h2>{(known.length ? <table className="table compact"><thead><tr><th>যা লিখেছে</th><th className="num">পণ্য পেয়েছে</th><th>কাস্টমার</th><th>সময়</th></tr></thead><tbody>{jsxList(known.map((r) => <tr><td><a href={`/products?q=${attrValue(encodeURIComponent(r.q))}`} target="_blank" rel="noopener"><Val v={r.q} /></a></td><td className="num">{(r.found ? bn(r.found) : <span className="pill pill-warn">০</span>)}</td><td>{whoCell(r)}</td><td className="small">{fmtDate(r.created_at)}</td></tr>))}</tbody></table> : <p className="muted">এই সময়ে নম্বর জানা কোনো কাস্টমার সার্চ করেনি।</p>)}</section>
    <div className="grid-2"><section className="panel table-wrap"><h2>❌ পাওয়া যায়নি (বেশি চাওয়া আগে)</h2>{(zero.length ? <table className="table compact"><thead><tr><th>যা লিখেছে</th><th className="num">কতবার</th><th className="num">কতজন</th><th>শেষবার</th></tr></thead><tbody>{jsxList(zero.map((r) => <tr><td><a href={`/products?q=${attrValue(encodeURIComponent(r.q))}`} target="_blank" rel="noopener"><b><Val v={r.q} /></b></a></td><td className="num">{bn(r.n)}</td><td className="num">{bn(r.people)}</td><td className="small">{fmtDate(r.last)}</td></tr>))}</tbody></table> : <p className="muted">এই সময়ে এমন কোনো সার্চ নেই। 👍</p>)}</section><section className="panel table-wrap"><h2>🔥 সবচেয়ে বেশি খোঁজা</h2>{(top.length ? <table className="table compact"><thead><tr><th>যা লিখেছে</th><th className="num">কতবার</th><th className="num">পণ্য পেয়েছে</th></tr></thead><tbody>{jsxList(top.map((r) => <tr><td><a href={`/products?q=${attrValue(encodeURIComponent(r.q))}`} target="_blank" rel="noopener"><Val v={r.q} /></a></td><td className="num">{bn(r.n)}</td><td className="num">{bn(r.found)}</td></tr>))}</tbody></table> : <p className="muted">এখনো কোনো সার্চ হয়নি।</p>)}</section></div>
    <section className="panel table-wrap"><h2>🕒 এইমাত্র যা খোঁজা হয়েছে</h2>{(recent.length ? <table className="table compact"><thead><tr><th>যা লিখেছে</th><th className="num">পণ্য পেয়েছে</th><th>কে</th><th>সময়</th></tr></thead><tbody>{jsxList(recent.map((r) => <tr><td><Val v={r.q} /></td><td className="num">{(r.found ? bn(r.found) : <span className="pill pill-warn">০</span>)}</td><td>{whoCell(r)}</td><td className="small">{fmtDate(r.created_at)}</td></tr>))}</tbody></table> : <p className="muted">এখনো কোনো সার্চ হয়নি।</p>)}</section></>;
  return ctx.page('কাস্টমার কী খুঁজছে', body, 'search-report');
}

async function done(ctx: AdminCtx) {
  const b = await ctx.body();
  await db.q(`UPDATE search_requests SET status='done', done_at=now() WHERE id=$1`, [int(b.id)]);
  return ctx.back(BASE, 'saved');
}

export const routes = [
  { method: 'GET', path: BASE, perm: 'reports', handler: page },
  { method: 'POST', path: `${BASE}/done`, perm: 'reports', handler: done },
];
