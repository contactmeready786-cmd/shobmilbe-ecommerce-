'use strict';
// ⬜ সাদা ব্যাকগ্রাউন্ড — Admin → পণ্য → সাদা ব্যাকগ্রাউন্ড.
// Every product picture (already uploaded, imported from a link/file/old site, or added by hand) is put on
// a pure white background by itself. Here the owner sees the progress, compares before/after, and can put
// any original back with one click. The work itself: lib/services/whitebg.js.
const { html, raw, bn, int, pageNum } = require('../util');
const db = require('../db');
const security = require('../security');
const imagekit = require('../services/imagekit');
const WB = require('../services/whitebg');
const ui = require('./ui');

const BASE = '/admin/products/white-bg';
const PER = 40;
const TABS = {
  '': ['সব', null],
  check: ['একবার দেখে নিন', `wb_state IN ('done') AND (wb_method = 'ai' OR wb_note <> '')`],
  done: ['সাদা হয়েছে', `wb_state IN ('done','already')`],
  wait: ['বাকি', `(wb_state IS NULL OR wb_state IN ('working','retry','ai_busy'))`],
  need_ai: ['AI-এর অপেক্ষায়', `wb_state = 'need_ai'`],
  fail: ['হয়নি', `wb_state IN ('fail','skip')`],
  kept: ['আসল ছবি রাখা', `wb_state = 'kept'`],
};

async function page(ctx) {
  const s = ctx.settings;
  if (ctx.method === 'POST') {
    const b = await ctx.body();
    if (b.action === 'settings') {
      const was = WB.on(s);
      await db.setMany({ wb_on: b.wb_on ? '1' : '0', wb_ai: b.wb_ai ? '1' : '0' });
      // shown picture changes (white ↔ original) → the watermark copies are drawn again from it
      if (was !== !!b.wb_on) await db.q(`UPDATE media SET wm_ver=NULL WHERE owner_type='product' AND wb_orig_url IS NOT NULL`);
      await ctx.reloadSettings();
      await ctx.log('settings', 'product', null, `সাদা ব্যাকগ্রাউন্ড ${b.wb_on ? 'চালু' : 'বন্ধ'}, AI ${b.wb_ai ? 'চালু' : 'বন্ধ'}`);
      return ctx.back(BASE, 'saved');
    }
    if (b.action === 'retry_ai' || b.action === 'retry_fail') {
      const n = await WB.redoAll(b.action === 'retry_ai' ? ['need_ai'] : ['fail', 'retry']);
      return ctx.back(`${BASE}?info=${encodeURIComponent(`${bn(n)}টি ছবি আবার চেষ্টার তালিকায় গেছে।`)}`);
    }
    return ctx.back(BASE);
  }

  const tab = TABS[ctx.query.get('tab')] ? ctx.query.get('tab') : '';
  const pg = pageNum(ctx.query);
  const where = `m.owner_type = ANY($1::text[])${TABS[tab][1] ? ' AND ' + TABS[tab][1].replace(/wb_/g, 'm.wb_') : ''}`;
  const [st, totalRow, rows] = await Promise.all([
    WB.stats(),
    db.one(`SELECT count(*)::int AS n FROM media m WHERE ${where}`, [WB.OWNERS]),
    db.q(`SELECT m.id, m.wb_state, m.wb_method, m.wb_note, m.wb_orig_url, m.ik_url, m.owner_type,
        coalesce(p.name, k.title, '') AS name, p.sku, coalesce(p.id, 0) AS pid
      FROM media m LEFT JOIN products p ON m.owner_type='product' AND p.id=m.owner_id LEFT JOIN kits k ON m.owner_type='kit' AND k.id=m.owner_id
      WHERE ${where} ORDER BY m.wb_at DESC NULLS LAST, m.id DESC LIMIT ${PER} OFFSET ${(pg - 1) * PER}`, [WB.OWNERS]),
  ]);
  const ikProblem = imagekit.configured() ? '' : imagekit.problem();
  const on = WB.on(s);
  const chip = (k, label, n) => html`<a class="chip ${tab === k ? 'on' : ''}" href="${BASE}${k ? '?tab=' + k : ''}">${label} <b>${bn(n || 0)}</b></a>`;
  const checkCount = (await db.one(`SELECT count(*)::int AS n FROM media WHERE owner_type = ANY($1::text[]) AND wb_state='done' AND (wb_method='ai' OR wb_note <> '')`, [WB.OWNERS])).n;

  const body = html`<p class="crumbs"><a href="/admin/products">← সব পণ্য</a></p>
<h1>⬜ সাদা ব্যাকগ্রাউন্ড</h1>
${ui.flash(ctx.flash)}
${ikProblem ? html`<p class="flash flash-error">ছবি সাদা করার জন্য ImageKit লাগে, কিন্তু এখন সেটা চালু নেই: ${ikProblem}</p>` : ''}
<p class="muted">সাইটের <b>সব পণ্যের ছবি</b> নিজে থেকেই <b>একদম সাদা (#FFFFFF) ব্যাকগ্রাউন্ডে</b> চলে যায় — আগের ছবি, লিংক/ফাইল/পুরনো সাইট থেকে আমদানি করা ছবি, আর হাতে আপলোড করা নতুন ছবি — সবই।
পণ্যের নিজের রং বা আকার একটুও বদলায় না — শুধু পেছনের অংশ সাদা হয়। আসল ছবিটা রেখে দেওয়া হয়, তাই যেকোনো ছবি এক ক্লিকে আগের মতো ফেরত আনা যায়।</p>

<div class="kpis">
  ${ui.kpi('মোট পণ্যের ছবি', bn(st.total))}
  ${ui.kpi('সাদা ব্যাকগ্রাউন্ড', bn(st.white), st.total ? `${bn(Math.round((st.white / st.total) * 100))}%` : '', '')}
  ${ui.kpi('বাকি আছে', bn(st.left), st.left ? 'কাজ চলছে' : '✅ কিছু বাকি নেই')}
  ${ui.kpi('AI-এর অপেক্ষায়', bn(st.need_ai || 0), st.need_ai ? 'নিচে ব্যাখ্যা আছে' : '')}
</div>

<div class="two-col">
  <form method="post" action="${BASE}" class="form panel">
    <input type="hidden" name="action" value="settings">
    ${ui.switchRow('wb_on', on, 'সাদা ব্যাকগ্রাউন্ড চালু', 'চালু থাকলে সব পণ্যের ছবি নিজে থেকে সাদা হয় আর সাইটে সাদা ছবিই দেখায়। বন্ধ করলে সাথে সাথে আসল ছবিগুলো দেখাবে, নতুন ছবিও সাদা হবে না।')}
    ${ui.switchRow('wb_ai', WB.aiOn(s), 'ব্যস্ত ব্যাকগ্রাউন্ডে AI ব্যবহার', 'যে ছবির পেছনে টেবিল, ঘর, হাত বা নকশা আছে, সেখানে ImageKit-এর AI পণ্যটা আলাদা করে। ImageKit-এর ফ্রি প্ল্যানে মাসে প্রায় ৬৫টি এমন ছবি করা যায়; বাকিগুলো পরের মাসে নিজে থেকে হয়।')}
    <button class="btn btn-lg">সেভ করুন</button>
  </form>
  <section class="panel">
    <h2>এখনই সব ছবি সাদা করুন</h2>
    <p class="small muted">Admin প্যানেলের যেকোনো পেজ খোলা থাকলেই ছবিগুলো পেছনে পেছনে সাদা হতে থাকে, আর দোকানে কাস্টমার এলেও একটু একটু করে হয়। একসাথে দ্রুত শেষ করতে নিচের বোতামে চাপ দিয়ে পেজটা খোলা রাখুন।</p>
    <p><button class="btn" type="button" data-wb-run ${!on || ikProblem || !st.left ? raw('disabled') : ''}>▶ এখনই শুরু করুন</button></p>
    <p class="small" data-wb-msg data-left="${st.left}">${!st.left ? '✅ সব ছবি শেষ।' : `${bn(st.left)}টি ছবি বাকি।`}</p>
    ${st.need_ai ? html`<div class="panel"><p class="small"><b>AI-এর অপেক্ষায় ${bn(st.need_ai)}টি ছবি:</b> এগুলোর পেছনে একরঙা ব্যাকগ্রাউন্ড নেই, তাই AI লাগে।
      ImageKit-এর এই মাসের ফ্রি AI শেষ হলে ১২ ঘণ্টা পরপর নিজে থেকে আবার চেষ্টা হয় (পরের মাসে ফ্রি আবার চালু হলে হয়ে যাবে)। চাইলে এই পণ্যগুলোর জন্য সাদা ব্যাকগ্রাউন্ডের নতুন ছবিও দিতে পারেন।</p>
      <form method="post" action="${BASE}"><input type="hidden" name="action" value="retry_ai"><button class="btn btn-sm btn-ghost">🔁 এখনই আবার চেষ্টা করুন</button></form></div>` : ''}
    ${(st.fail || 0) + (st.retry || 0) ? html`<form method="post" action="${BASE}" style="margin-top:8px"><input type="hidden" name="action" value="retry_fail"><button class="btn btn-sm btn-ghost">🔁 যেগুলো হয়নি, আবার চেষ্টা করুন (${bn((st.fail || 0) + (st.retry || 0))})</button></form>` : ''}
  </section>
</div>

<h2>ছবির তালিকা <small>আগে ↔ পরে</small></h2>
<div class="chips status-chips stat-chips">
  ${chip('', 'সব', st.total)}${chip('check', 'একবার দেখে নিন', checkCount)}${chip('done', 'সাদা হয়েছে', st.white)}${chip('wait', 'বাকি', st.left - (st.in_db || 0))}
  ${chip('need_ai', 'AI-এর অপেক্ষায়', st.need_ai)}${chip('fail', 'হয়নি', (st.fail || 0) + (st.skip || 0))}${chip('kept', 'আসল ছবি রাখা', st.kept)}
</div>
${tab === 'check' ? html`<p class="small muted">AI দিয়ে করা ছবি, আর যেগুলোর কিনারা পুরো সাদা হয়নি — একবার চোখ বুলিয়ে নিন। পণ্যের কোনো অংশ কেটে গেলে "আসল ছবি ফেরত" চাপুন।</p>` : ''}
${rows.length ? html`<table class="table wb-table">
  <thead><tr><th>আগে</th><th>পরে</th><th>পণ্য</th><th>অবস্থা</th><th>কাজ</th></tr></thead>
  <tbody>${rows.map((r) => html`<tr>
    <td class="wb-pic"><img src="${r.wb_orig_url ? imagekit.thumbUrl(r.wb_orig_url) : `/media/${r.id}/t`}" alt="" loading="lazy"></td>
    <td class="wb-pic">${r.wb_orig_url ? html`<a href="/media/${r.id}" target="_blank" rel="noopener"><img src="/media/${r.id}/t" alt="" loading="lazy"></a>` : html`<span class="muted small">—</span>`}</td>
    <td>${r.pid ? html`<a href="/admin/products/${r.pid}">${r.name}</a><br><span class="small muted">SKU ${r.sku}</span>` : html`${r.name || '—'}`}</td>
    <td>${ui.pill(r.wb_state ? (WB.STATES[r.wb_state] || r.wb_state) : 'অপেক্ষায়', r.wb_state === 'done' || r.wb_state === 'already' ? 'pill-green' : r.wb_state === 'fail' ? 'pill-red' : '')}
      ${r.wb_method === 'ai' ? html` <span class="small muted">AI</span>` : ''}${r.wb_note ? html`<br><span class="small muted">${r.wb_note}</span>` : ''}</td>
    <td class="prod-actions">
      ${r.wb_state !== 'kept' ? html`<form method="post" action="${BASE}/${r.id}/keep" data-confirm="এই ছবির আসল (আগের) ব্যাকগ্রাউন্ড ফেরত আনবেন? এটা আর সাদা করা হবে না।"><button class="btn btn-sm btn-ghost">↩ আসল ছবি ফেরত</button></form>` : ''}
      <form method="post" action="${BASE}/${r.id}/redo"><button class="btn btn-sm btn-ghost">🔁 আবার করুন</button></form>
      ${WB.aiOn(s) ? html`<form method="post" action="${BASE}/${r.id}/redo"><input type="hidden" name="ai" value="1"><button class="btn btn-sm btn-ghost" title="ImageKit-এর ফ্রি AI থেকে ১টি খরচ হবে">🤖 AI দিয়ে করুন</button></form>` : ''}
    </td></tr>`)}</tbody></table>
  ${ui.pager(totalRow.n, pg, PER, tab ? `${BASE}?tab=${tab}` : BASE)}`
  : ui.empty('এই তালিকায় এখন কোনো ছবি নেই।')}`;
  return ctx.page('সাদা ব্যাকগ্রাউন্ড', body, 'white-bg');
}

async function keep(ctx, m) {
  await WB.keepOriginal(int(m[1]));
  await ctx.log('update', 'product', null, `ছবি #${int(m[1])}: আসল ব্যাকগ্রাউন্ড ফেরত`);
  return ctx.back(ctx.req.headers.referer && /white-bg/.test(ctx.req.headers.referer) ? new URL(ctx.req.headers.referer).pathname + new URL(ctx.req.headers.referer).search.replace(/[?&]msg=\w+/, '') : BASE);
}
async function redo(ctx, m) {
  const b = await ctx.body();
  await WB.redo(int(m[1]), !!b.ai);
  // do it right away, so the owner sees the result when the page opens again
  await WB.processOne(ctx.settings, int(m[1])).catch(() => null);
  return ctx.back(ctx.req.headers.referer && /white-bg/.test(ctx.req.headers.referer) ? new URL(ctx.req.headers.referer).pathname + new URL(ctx.req.headers.referer).search.replace(/[?&]msg=\w+/, '') : BASE);
}

// Background job (any open admin page): do a few waiting pictures, say how many are left.
async function runApi(ctx) {
  if (!WB.on(ctx.settings) || !imagekit.configured()) return ctx.json(ctx.res, 200, { done: [], left: 0, off: true });
  if (!(await security.hit(db, 'wb:' + ctx.user.id, 3000, 3600))) return ctx.json(ctx.res, 429, { error: 'অনেক বেশি, একটু পরে।' });
  const done = await WB.run(ctx.settings, { ms: 12000, max: 4 });
  const st = await WB.stats();
  return ctx.json(ctx.res, 200, { done: done.map((d) => d.state), left: st.left - (st.in_db || 0), white: st.white, total: st.total });
}

module.exports = {
  routes: [
    { method: '*', path: BASE, perm: 'products', handler: page },
    { method: 'POST', path: /^\/admin\/products\/white-bg\/(\d+)\/keep$/, perm: 'products', handler: keep },
    { method: 'POST', path: /^\/admin\/products\/white-bg\/(\d+)\/redo$/, perm: 'products', handler: redo },
    { method: 'POST', path: '/admin/api/white-bg/run', perm: 'products', handler: runApi },
  ],
};
