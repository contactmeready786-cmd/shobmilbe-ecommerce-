// Admin → রিপোর্ট → 🔎 কাস্টমার কী খুঁজছে: the words customers typed in the shop's search box and how many products came up.
// "পাওয়া যায়নি" = people want it but the shop doesn't have it (or names it differently) — a list of what to buy / rename.
import { toHtml, Val, A, L } from '../react/render';
import { html, bn, fmtDate, int } from '../util';
import * as db from '../db';
import * as ui from './ui';
import type { AdminCtx, Loose } from '../types';

const BASE = '/admin/reports/search';

async function page(ctx: AdminCtx) {
  const days = [7, 30, 90].includes(int(ctx.query.get('days'))) ? int(ctx.query.get('days')) : 30;
  const [stats, zero, top, recent] = await Promise.all([
    db.one(`SELECT count(*)::int AS n, count(*) FILTER (WHERE found = 0)::int AS zero, count(DISTINCT q)::int AS words
      FROM search_log WHERE created_at > now() - make_interval(days => $1)`, [days]),
    db.q(`SELECT q, count(*)::int AS n, max(created_at) AS last FROM search_log WHERE found = 0 AND created_at > now() - make_interval(days => $1)
      GROUP BY q ORDER BY count(*) DESC, max(created_at) DESC LIMIT 60`, [days]),
    db.q(`SELECT q, count(*)::int AS n, round(avg(found))::int AS found FROM search_log WHERE found > 0 AND created_at > now() - make_interval(days => $1)
      GROUP BY q ORDER BY count(*) DESC LIMIT 40`, [days]),
    db.q(`SELECT q, found, created_at FROM search_log ORDER BY id DESC LIMIT 25`),
  ]);
  const body = toHtml(<><h1>🔎 কাস্টমার কী খুঁজছে</h1><div className="toolbar"><span className="muted small">সময়:</span>{L([7, 30, 90].map((d) => <>{' '}<a className={`chip ${A(d === days ? 'on' : '')}`} href={`${A(BASE)}?days=${A(d)}`}>গত{' '}<Val v={bn(d)} />{' '}দিন</a></>))}{' '}<a className="btn btn-sm btn-ghost" href={`${A(BASE)}?days=${A(days)}`}>🔄 রিফ্রেশ</a></div><div className="kpis kpis-tight"><Val v={ui.kpi('মোট সার্চ', bn(stats!.n), `${bn(stats!.words)}টি আলাদা শব্দ`)} />{' '}<Val v={ui.kpi('কিছু পাওয়া যায়নি', bn(stats!.zero), stats!.n ? `${bn(Math.round((stats!.zero * 100) / stats!.n))}% সার্চ খালি গেছে` : '', stats!.zero ? 'kpi-amber' : '')} /></div><Val v={ui.helpBox('এই পেজ কীভাবে কাজে লাগাবেন', toHtml(<ol className="steps"><li><b>"পাওয়া যায়নি"</b>{' '}তালিকা = কাস্টমার এটা চাইছে কিন্তু দোকানে নেই। যেটা বারবার আসছে, সেটা কিনে এনে আপলোড করুন — এটাই সবচেয়ে নিশ্চিত বিক্রি।</li><li>পণ্য আছে অথচ এখানে দেখাচ্ছে? তাহলে কাস্টমার অন্য নামে খুঁজছে — পণ্যের SEO কিওয়ার্ড ঘরে ঐ শব্দটা লিখে দিন, পরের বার পাবে।</li><li>সার্চ বানান ভুল ("capasitor") আর বাংলা ("ক্যাপাসিটর", "সিঙ্গার রিমোট") নিজেই বুঝে নেয়।</li></ol>))} /><div className="grid-2"><section className="panel table-wrap"><h2>❌ পাওয়া যায়নি (বেশি চাওয়া আগে)</h2>{(zero.length ? <table className="table compact"><thead><tr><th>যা লিখেছে</th><th className="num">কতবার</th><th>শেষবার</th></tr></thead><tbody>{L(zero.map((r) => <tr><td><a href={`/products?q=${A(encodeURIComponent(r.q))}`} target="_blank" rel="noopener"><b><Val v={r.q} /></b></a></td><td className="num"><Val v={bn(r.n)} /></td><td className="small"><Val v={fmtDate(r.last)} /></td></tr>))}</tbody></table> : <p className="muted">এই সময়ে এমন কোনো সার্চ নেই। 👍</p>)}</section><section className="panel table-wrap"><h2>🔥 সবচেয়ে বেশি খোঁজা</h2>{(top.length ? <table className="table compact"><thead><tr><th>যা লিখেছে</th><th className="num">কতবার</th><th className="num">পণ্য পেয়েছে</th></tr></thead><tbody>{L(top.map((r) => <tr><td><a href={`/products?q=${A(encodeURIComponent(r.q))}`} target="_blank" rel="noopener"><Val v={r.q} /></a></td><td className="num"><Val v={bn(r.n)} /></td><td className="num"><Val v={bn(r.found)} /></td></tr>))}</tbody></table> : <p className="muted">এখনো কোনো সার্চ হয়নি।</p>)}</section></div><section className="panel table-wrap"><h2>🕒 এইমাত্র যা খোঁজা হয়েছে</h2>{(recent.length ? <table className="table compact"><thead><tr><th>যা লিখেছে</th><th className="num">পণ্য পেয়েছে</th><th>সময়</th></tr></thead><tbody>{L(recent.map((r) => <tr><td><Val v={r.q} /></td><td className="num">{(r.found ? <Val v={bn(r.found)} /> : <span className="pill pill-warn">০</span>)}</td><td className="small"><Val v={fmtDate(r.created_at)} /></td></tr>))}</tbody></table> : <p className="muted">এখনো কোনো সার্চ হয়নি।</p>)}</section></>);
  return ctx.page('কাস্টমার কী খুঁজছে', body, 'search-report');
}

export const routes = [{ method: 'GET', path: BASE, perm: 'reports', handler: page }];
