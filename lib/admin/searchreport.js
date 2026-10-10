'use strict';
// Admin → রিপোর্ট → 🔎 কাস্টমার কী খুঁজছে: the words customers typed in the shop's search box and how many products came up.
// "পাওয়া যায়নি" = people want it but the shop doesn't have it (or names it differently) — a list of what to buy / rename.
const { html, bn, fmtDate, int } = require('../util');
const db = require('../db');
const ui = require('./ui');

const BASE = '/admin/reports/search';

async function page(ctx) {
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
  const body = html`<h1>🔎 কাস্টমার কী খুঁজছে</h1>
<div class="toolbar"><span class="muted small">সময়:</span>${[7, 30, 90].map((d) => html` <a class="chip ${d === days ? 'on' : ''}" href="${BASE}?days=${d}">গত ${bn(d)} দিন</a>`)}
  <a class="btn btn-sm btn-ghost" href="${BASE}?days=${days}">🔄 রিফ্রেশ</a></div>
<div class="kpis kpis-tight">
  ${ui.kpi('মোট সার্চ', bn(stats.n), `${bn(stats.words)}টি আলাদা শব্দ`)}
  ${ui.kpi('কিছু পাওয়া যায়নি', bn(stats.zero), stats.n ? `${bn(Math.round((stats.zero * 100) / stats.n))}% সার্চ খালি গেছে` : '', stats.zero ? 'kpi-amber' : '')}
</div>
${ui.helpBox('এই পেজ কীভাবে কাজে লাগাবেন', html`<ol class="steps">
  <li><b>"পাওয়া যায়নি"</b> তালিকা = কাস্টমার এটা চাইছে কিন্তু দোকানে নেই। যেটা বারবার আসছে, সেটা কিনে এনে আপলোড করুন — এটাই সবচেয়ে নিশ্চিত বিক্রি।</li>
  <li>পণ্য আছে অথচ এখানে দেখাচ্ছে? তাহলে কাস্টমার অন্য নামে খুঁজছে — পণ্যের SEO কিওয়ার্ড ঘরে ঐ শব্দটা লিখে দিন, পরের বার পাবে।</li>
  <li>সার্চ বানান ভুল ("capasitor") আর বাংলা ("ক্যাপাসিটর", "সিঙ্গার রিমোট") নিজেই বুঝে নেয়।</li>
</ol>`)}
<div class="grid-2">
  <section class="panel table-wrap"><h2>❌ পাওয়া যায়নি (বেশি চাওয়া আগে)</h2>
    ${zero.length ? html`<table class="table compact"><thead><tr><th>যা লিখেছে</th><th class="num">কতবার</th><th>শেষবার</th></tr></thead><tbody>
    ${zero.map((r) => html`<tr><td><a href="/products?q=${encodeURIComponent(r.q)}" target="_blank" rel="noopener"><b>${r.q}</b></a></td><td class="num">${bn(r.n)}</td><td class="small">${fmtDate(r.last)}</td></tr>`)}
    </tbody></table>` : html`<p class="muted">এই সময়ে এমন কোনো সার্চ নেই। 👍</p>`}
  </section>
  <section class="panel table-wrap"><h2>🔥 সবচেয়ে বেশি খোঁজা</h2>
    ${top.length ? html`<table class="table compact"><thead><tr><th>যা লিখেছে</th><th class="num">কতবার</th><th class="num">পণ্য পেয়েছে</th></tr></thead><tbody>
    ${top.map((r) => html`<tr><td><a href="/products?q=${encodeURIComponent(r.q)}" target="_blank" rel="noopener">${r.q}</a></td><td class="num">${bn(r.n)}</td><td class="num">${bn(r.found)}</td></tr>`)}
    </tbody></table>` : html`<p class="muted">এখনো কোনো সার্চ হয়নি।</p>`}
  </section>
</div>
<section class="panel table-wrap"><h2>🕒 এইমাত্র যা খোঁজা হয়েছে</h2>
  ${recent.length ? html`<table class="table compact"><thead><tr><th>যা লিখেছে</th><th class="num">পণ্য পেয়েছে</th><th>সময়</th></tr></thead><tbody>
  ${recent.map((r) => html`<tr><td>${r.q}</td><td class="num">${r.found ? bn(r.found) : html`<span class="pill pill-warn">০</span>`}</td><td class="small">${fmtDate(r.created_at)}</td></tr>`)}
  </tbody></table>` : html`<p class="muted">এখনো কোনো সার্চ হয়নি।</p>`}
</section>`;
  return ctx.page('কাস্টমার কী খুঁজছে', body, 'search-report');
}

module.exports = { routes: [{ method: 'GET', path: BASE, perm: 'reports', handler: page }] };
