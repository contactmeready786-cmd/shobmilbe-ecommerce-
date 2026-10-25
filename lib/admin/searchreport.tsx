// Admin → রিপোর্ট → 🔎 কাস্টমার কী খুঁজছে: the words customers typed in the shop's search box and how many products came up.
// "পাওয়া যায়নি" = people want it but the shop doesn't have it (or names it differently) — a list of what to buy / rename.
import { Val, attrValue, jsxList } from '../react/html';
import { bn, fmtDate, int } from '../util';
import * as db from '../db';
import * as ui from './ui';
import type { AdminCtx } from '../types';
import type { SearchLogRow } from '../data/rows';

const BASE = '/admin/reports/search';

async function page(ctx: AdminCtx) {
  const days = [7, 30, 90].includes(int(ctx.query.get('days'))) ? int(ctx.query.get('days')) : 30;
  const [stats, zero, top, recent] = await Promise.all([
    db.one<{ n: number; zero: number; words: number }>(`SELECT count(*)::int AS n, count(*) FILTER (WHERE found = 0)::int AS zero, count(DISTINCT q)::int AS words
      FROM search_log WHERE created_at > now() - make_interval(days => $1)`, [days]),
    db.q<{ q: string; n: number; last: Date | null }>(`SELECT q, count(*)::int AS n, max(created_at) AS last FROM search_log WHERE found = 0 AND created_at > now() - make_interval(days => $1)
      GROUP BY q ORDER BY count(*) DESC, max(created_at) DESC LIMIT 60`, [days]),
    db.q<{ q: string; n: number; found: number }>(`SELECT q, count(*)::int AS n, round(avg(found))::int AS found FROM search_log WHERE found > 0 AND created_at > now() - make_interval(days => $1)
      GROUP BY q ORDER BY count(*) DESC LIMIT 40`, [days]),
    db.q<Pick<SearchLogRow, 'q' | 'found' | 'created_at'>>(`SELECT q, found, created_at FROM search_log ORDER BY id DESC LIMIT 25`),
  ]);
  // 🙋 people who left their phone after a search found nothing (POST /api/want)
  const wants = await db.q<{ id: number; q: string; name: string; phone: string; note: string; status: string; created_at: Date }>(
    `SELECT * FROM product_wants WHERE created_at > now() - interval '120 days' ORDER BY (status = 'new') DESC, id DESC LIMIT 200`).catch(() => []);
  const waTo = (p: string) => `https://wa.me/88${p.replace(/^\+?88/, '')}`;
  const wantPanel = <section className="panel" id="wants"><h2>🙋 পণ্য চেয়েছে — ফোন নম্বরসহ <small>{bn(wants.filter((w) => w.status === 'new').length)}টি নতুন</small></h2>
    <p className="small muted">কেউ খুঁজে কিছু না পেলে "খুঁজে দেব?" বক্সে নম্বর রেখে যায়। পণ্যটা এনে তুললে ফোন বা WhatsApp করুন, তারপর "✅ জানানো হয়েছে" চাপুন। নতুন অনুরোধ এলে ইমেইলেও জানানো হয়।</p>
    {(wants.length ? <div className="table-wrap"><table className="table compact"><thead><tr><th>যা চেয়েছে</th><th>কে</th><th>কবে</th><th></th></tr></thead><tbody>{jsxList(wants.map((w) => <tr className={w.status === 'new' ? '' : 'row-off'}><td><b><Val v={w.q} /></b>{(w.note ? <><br /><span className="small muted"><Val v={w.note} /></span></> : null)}</td><td><Val v={w.name || '—'} /><br /><a href={`tel:${attrValue(w.phone)}`}><Val v={w.phone} /></a>{' '}·{' '}<a href={attrValue(waTo(w.phone))} target="_blank" rel="noopener">WhatsApp</a></td><td className="small nowrap">{fmtDate(w.created_at)}</td><td>{(w.status === 'new' ? <form method="post" action={`${attrValue(BASE)}/want`}><input type="hidden" name="id" defaultValue={attrValue(w.id)} /><button className="btn btn-sm btn-ghost">✅ জানানো হয়েছে</button></form> : <span className="small">✅ জানানো হয়েছে</span>)}</td></tr>))}</tbody></table></div> : <p className="muted small">এখনো কেউ নম্বর রেখে যায়নি।</p>)}
  </section>;
  const body = <><h1>🔎 কাস্টমার কী খুঁজছে</h1>{wantPanel}<div className="toolbar"><span className="muted small">সময়:</span>{jsxList([7, 30, 90].map((d) => <>{' '}<a className={`chip ${d === days ? 'on' : ''}`} href={`${attrValue(BASE)}?days=${attrValue(d)}`}>গত{' '}{bn(d)}{' '}দিন</a></>))}{' '}<a className="btn btn-sm btn-ghost" href={`${attrValue(BASE)}?days=${attrValue(days)}`}>🔄 রিফ্রেশ</a></div><div className="kpis kpis-tight">{ui.kpi('মোট সার্চ', bn(stats!.n), `${bn(stats!.words)}টি আলাদা শব্দ`)}{' '}{ui.kpi('কিছু পাওয়া যায়নি', bn(stats!.zero), stats!.n ? `${bn(Math.round((stats!.zero * 100) / stats!.n))}% সার্চ খালি গেছে` : '', stats!.zero ? 'kpi-amber' : '')}</div>{ui.helpBox('এই পেজ কীভাবে কাজে লাগাবেন', <ol className="steps"><li><b>"পাওয়া যায়নি"</b>{' '}তালিকা = কাস্টমার এটা চাইছে কিন্তু দোকানে নেই। যেটা বারবার আসছে, সেটা কিনে এনে আপলোড করুন — এটাই সবচেয়ে নিশ্চিত বিক্রি।</li><li>পণ্য আছে অথচ এখানে দেখাচ্ছে? তাহলে কাস্টমার অন্য নামে খুঁজছে — পণ্যের SEO কিওয়ার্ড ঘরে ঐ শব্দটা লিখে দিন, পরের বার পাবে।</li><li>সার্চ বানান ভুল ("capasitor") আর বাংলা ("ক্যাপাসিটর", "সিঙ্গার রিমোট") নিজেই বুঝে নেয়।</li></ol>)}<div className="grid-2"><section className="panel table-wrap"><h2>❌ পাওয়া যায়নি (বেশি চাওয়া আগে)</h2>{(zero.length ? <table className="table compact"><thead><tr><th>যা লিখেছে</th><th className="num">কতবার</th><th>শেষবার</th></tr></thead><tbody>{jsxList(zero.map((r) => <tr><td><a href={`/products?q=${attrValue(encodeURIComponent(r.q))}`} target="_blank" rel="noopener"><b><Val v={r.q} /></b></a></td><td className="num">{bn(r.n)}</td><td className="small">{fmtDate(r.last)}</td></tr>))}</tbody></table> : <p className="muted">এই সময়ে এমন কোনো সার্চ নেই। 👍</p>)}</section><section className="panel table-wrap"><h2>🔥 সবচেয়ে বেশি খোঁজা</h2>{(top.length ? <table className="table compact"><thead><tr><th>যা লিখেছে</th><th className="num">কতবার</th><th className="num">পণ্য পেয়েছে</th></tr></thead><tbody>{jsxList(top.map((r) => <tr><td><a href={`/products?q=${attrValue(encodeURIComponent(r.q))}`} target="_blank" rel="noopener"><Val v={r.q} /></a></td><td className="num">{bn(r.n)}</td><td className="num">{bn(r.found)}</td></tr>))}</tbody></table> : <p className="muted">এখনো কোনো সার্চ হয়নি।</p>)}</section></div><section className="panel table-wrap"><h2>🕒 এইমাত্র যা খোঁজা হয়েছে</h2>{(recent.length ? <table className="table compact"><thead><tr><th>যা লিখেছে</th><th className="num">পণ্য পেয়েছে</th><th>সময়</th></tr></thead><tbody>{jsxList(recent.map((r) => <tr><td><Val v={r.q} /></td><td className="num">{(r.found ? bn(r.found) : <span className="pill pill-warn">০</span>)}</td><td className="small">{fmtDate(r.created_at)}</td></tr>))}</tbody></table> : <p className="muted">এখনো কোনো সার্চ হয়নি।</p>)}</section></>;
  return ctx.page('কাস্টমার কী খুঁজছে', body, 'search-report');
}

async function wantDone(ctx: AdminCtx) {
  const b = await ctx.body();
  await db.q(`UPDATE product_wants SET status='done' WHERE id=$1`, [int(b.id)]);
  return ctx.redirect(`${BASE}#wants`);
}

export const routes = [{ method: 'GET', path: BASE, perm: 'reports', handler: page }, { method: 'POST', path: `${BASE}/want`, perm: 'reports', handler: wantDone }];
