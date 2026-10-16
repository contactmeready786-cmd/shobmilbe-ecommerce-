// Admin → মার্কেটিং → Google ও Facebook → 🤖 অটো SEO: what the automatic SEO engine (services/autoseo.js) has done,
// the shop's SEO score day by day, its switches, every change with an undo button, and a preview of an auto description.
import { html, raw, bn, fmtDate } from '../util';
import * as db from '../db';
import * as ui from './ui';
import * as charts from './charts';
import * as md from '../views/md';
import * as A from '../services/autoseo';
import * as $status from './status';
import type { AdminCtx, Body, Loose } from '../types';

const BASE = '/admin/marketing/autoseo';

async function handle(ctx: AdminCtx) {
  if (ctx.method === 'POST') return post(ctx);
  return page(ctx);
}

async function post(ctx: AdminCtx) {
  const b = await ctx.body();
  const s = ctx.settings;
  if (b.action === 'save') {
    for (const k of ['autoseo_on', 'autoseo_model', 'autoseo_specs', 'autoseo_desc']) await db.setSetting(k, b[k] ? '1' : '0');
    await ctx.reloadSettings();
    await ctx.log('settings', 'marketing', null, 'অটো SEO সেটিংস');
    return ctx.back(BASE, 'saved');
  }
  if (b.action === 'run') {
    const r = await A.sweep(s, { force: true, max: 150 });
    if (r.off) return ctx.fail(BASE, 'আগে "অটো SEO চালু" সুইচ চালু করুন।');
    await A.snapshot(true).catch(() => null);
    await ctx.log('product_bulk', 'product', null, `অটো SEO: ${r.looked}টি পণ্য দেখা, ${r.changed}টিতে বদল`);
    return ctx.back(`${BASE}?info=${encodeURIComponent(`🤖 ${bn(r.looked)}টি পণ্য দেখা হলো — ${bn(r.models)}টিতে মডেল নম্বর, ${bn(r.specs)}টিতে স্পেসিফিকেশন বসানো হলো।${r.looked === 0 ? ' সব পণ্য আগেই দেখা হয়ে গেছে।' : ''}`)}`);
  }
  if (b.action === 'undo') {
    const ok = await A.undo(b.id);
    if (ok) await ctx.log('product_bulk', 'product', null, `অটো SEO: একটা বদল ফেরত (#${b.id})`);
    return ctx.back(BASE + '#log', ok ? 'saved' : undefined);
  }
  if (b.action === 'undo_all') {
    // switching the filling off first, so the next run doesn't put things straight back
    await db.setMany({ autoseo_model: '0', autoseo_specs: '0' });
    await ctx.reloadSettings();
    const n = await A.undoAll();
    await ctx.log('product_bulk', 'product', null, `অটো SEO: সব বদল ফেরত (${n}টি)`);
    return ctx.back(`${BASE}?info=${encodeURIComponent(`↩️ ${bn(n)}টি অটো বদল ফেরত আনা হলো, আর মডেল/স্পেসিফিকেশন বসানো বন্ধ করা হলো।`)}`);
  }
  return ctx.back(BASE);
}

async function page(ctx: AdminCtx) {
  const s = ctx.settings;
  const [st, log, { avg, total, list }, sample] = await Promise.all([
    A.stats(),
    A.recent(40),
    $status.seoProblems(),
    db.one(`SELECT p.*, c.name AS category_name FROM products p LEFT JOIN categories c ON c.id=p.category_id
      WHERE p.active AND p.parent_id IS NULL AND length(coalesce(p.description,'') || coalesce(p.short_description,'')) < $1
      ORDER BY coalesce(p.sold_count,0) DESC, p.id DESC LIMIT 1`, [A.OWN_TEXT_ENOUGH]).catch(() => null),
  ]);
  const hist = [...st.hist].reverse();
  const first = hist[0];
  const up = first && hist.length > 1 ? avg - first.avg : 0;
  const pctDone = st.total ? Math.round((st.done * 100) / st.total) : 0;
  const on = s.autoseo_on !== '0';
  const label = (f: string) => A.LOG_FIELDS[f] || f;
  const show = (l?: Loose) => {
    if (l.field !== 'specs') return l.new_value;
    try { return JSON.parse(l.new_value).map((r?: Loose) => `${r[0]}: ${r[1]}`).join(' · '); } catch (_) { return l.new_value; }
  };
  const body = html`<div class="title-row"><h1>🤖 অটো SEO</h1><div class="row-actions"><a class="btn btn-ghost btn-sm" href="/admin/marketing/seo?tab=check">🩺 SEO চেকার</a></div></div>
${ui.flash(ctx.flash)}
<div class="kpis kpis-tight">
  ${ui.kpi('দোকানের SEO স্কোর', `${bn(avg)}/১০০`, up > 0 ? `শুরু থেকে +${bn(up)} বেড়েছে` : hist.length ? `${bn(hist.length)} দিনের হিসাব আছে` : 'আজ থেকে প্রতিদিন হিসাব থাকবে', avg >= 80 ? 'kpi-green' : avg >= 60 ? 'kpi-blue' : 'kpi-red')}
  ${ui.kpi('দেখা হয়েছে', `${bn(pctDone)}%`, `${bn(st.done)} / ${bn(st.total)}টি পণ্য`, on ? 'kpi-blue' : '')}
  ${ui.kpi('মডেল নম্বর বসানো', bn(st.models), 'নামের ভেতর থেকে পড়ে')}
  ${ui.kpi('স্পেসিফিকেশন যোগ', bn(st.spec_rows), `${bn(st.specs)}টি পণ্যে`)}
  ${ui.kpi('অটো বিবরণ দেখাচ্ছে', bn(s.autoseo_desc === '0' ? 0 : st.autoDesc), 'যেগুলোর নিজের লেখা নেই/ছোট')}
</div>
${ui.helpBox('এটা কী করে? (আপনাকে কিছু করতে হবে না)', html`<ol class="steps">
  <li><b>🔢 মডেল নম্বর:</b> পণ্যের নাম থেকে পার্ট নম্বর (PAM8403, HC-SR04, 1N4007…) বের করে "মডেল" ঘরে বসায়। মানুষ Google-এ ঠিক এই কোড দিয়েই খোঁজে, আর Google/Facebook ফিডেও যায়।</li>
  <li><b>⚙️ স্পেসিফিকেশন:</b> নাম আর বিবরণ থেকে ভোল্টেজ, কারেন্ট, ওয়াট, mAh, µF, Ω, চ্যানেল, পিন, প্যাকে কয়টা — এগুলো বের করে স্পেসিফিকেশন টেবিলে যোগ করে। পণ্যের পেজে টেবিল দেখায়, Google-ও পড়ে।</li>
  <li><b>📝 অটো বিবরণ:</b> যে পণ্যে আপনার নিজের লেখা নেই বা খুব ছোট (${bn(A.OWN_TEXT_ENOUGH)} অক্ষরের কম), তার পেজে পুরো বাংলা বিবরণ দেখায় — কী জিনিস, কোথায় কাজে লাগে, স্পেসিফিকেশন, কেনার আগে কী জানবেন, আর "দাম কত / কীভাবে অর্ডার করব" প্রশ্ন-উত্তর। দাম আর ডেলিভারি চার্জ সবসময় আজকের। আপনি নিজে ${bn(A.OWN_TEXT_ENOUGH)}+ অক্ষর লিখলে শুধু আপনারটাই দেখায়।</li>
  <li><b>নিরাপদ:</b> শুধু খালি ঘর ভরে — আপনার লেখা কখনো বদলায় না। আপনি কোনো অটো জিনিস মুছে দিলে আর ফেরত বসায় না। প্রতিটা বদল নিচের তালিকায় আছে, এক চাপে ফেরত আনা যায়।</li>
  <li><b>সবসময় চলে:</b> প্রতি ~১০ মিনিটে কয়েক ডজন পণ্য — নতুন তোলা বা এডিট করা পণ্য আগে। প্রতিদিন দোকানের SEO স্কোর লিখে রাখে, যাতে উন্নতি দেখা যায়।</li>
</ol>`)}

<div class="two-col">
<section class="panel"><h2>সুইচ</h2>
  <form method="post" action="${BASE}" class="form"><input type="hidden" name="action" value="save">
    ${ui.switchRow('autoseo_on', on, '🤖 অটো SEO চালু', 'সারাদিন নিজে থেকে পণ্যগুলো দেখে ঠিক করবে')}
    ${ui.switchRow('autoseo_model', s.autoseo_model !== '0', '🔢 নাম থেকে মডেল নম্বর বসাও', 'শুধু যেখানে মডেল ঘর খালি')}
    ${ui.switchRow('autoseo_specs', s.autoseo_specs !== '0', '⚙️ নাম থেকে স্পেসিফিকেশন যোগ করো', 'যা আগে থেকে আছে তা বদলায় না')}
    ${ui.switchRow('autoseo_desc', s.autoseo_desc !== '0', '📝 নিজের বিবরণ না থাকলে অটো বিবরণ দেখাও', 'পণ্যের পেজ, Google-এর বিবরণ আর ফিডে')}
    <button class="btn">সেভ করুন</button>
  </form>
  <form method="post" action="${BASE}" class="mt"><input type="hidden" name="action" value="run"><button class="btn btn-sm btn-ghost" ${on ? '' : 'disabled'}>⚡ এখনই চালান (১৫০টি পণ্য)</button></form>
  ${s.autoseo_last ? html`<p class="small muted">শেষ চলেছে: ${fmtDate(new Date(Number(s.autoseo_last)))}</p>` : ''}
</section>
<section class="panel"><h2>📈 SEO স্কোর দিনে দিনে</h2>
  ${hist.length ? charts.hbars(hist.slice(-14).map((h) => ({ label: fmtDate(new Date(h.day), false), value: h.avg, sub: `${bn(h.perfect)}টি পণ্য ৯০+` })), { color: 2 })
    : html`<p class="muted small">আজ থেকে প্রতিদিন স্কোর লেখা থাকবে।</p>`}
  <p class="small muted">স্কোর বাড়াতে সবচেয়ে কাজের: পরিষ্কার ছবি, নিজের ভাষায় ২০০+ অক্ষরের বিবরণ আর রিভিউ — এগুলো মেশিন দিয়ে বানানো যায় না। <a href="/admin/marketing/seo?tab=check">কোন পণ্যে কী লাগবে দেখুন →</a></p>
</section>
</div>

${sample ? html`<section class="panel"><h2>👀 অটো বিবরণ দেখতে এমন হয়</h2>
  <p class="small muted">উদাহরণ: <a href="/p/${sample.slug}" target="_blank" rel="noopener">${sample.name}</a> (দোকানে ঠিক এভাবে দেখায়)</p>
  <div class="rich" style="max-height:420px;overflow:auto;border:1px solid var(--line,#e3e7ef);border-radius:8px;padding:12px">${raw(md.render(A.describe(sample, s)))}</div>
</section>` : ''}

<section class="panel table-wrap" id="log"><h2>🧾 অটো বদলের তালিকা</h2>
  ${log.length ? html`<table class="table compact"><thead><tr><th>সময়</th><th>পণ্য</th><th>কী বসানো হলো</th><th></th></tr></thead><tbody>
  ${log.map((l) => html`<tr${l.undone ? raw(' class="muted"') : ''}><td class="small nowrap">${fmtDate(l.created_at)}</td>
    <td><a href="/admin/products/${l.product_id}">${l.name}</a></td>
    <td class="small"><b>${label(l.field)}:</b> ${show(l)}</td>
    <td>${l.undone ? html`<span class="small">↩️ ফেরত</span>` : html`<form method="post" action="${BASE}"><input type="hidden" name="action" value="undo"><input type="hidden" name="id" value="${l.id}"><button class="btn btn-sm btn-ghost">↩️ ফেরত</button></form>`}</td></tr>`)}
  </tbody></table>
  <form method="post" action="${BASE}" data-confirm="সব অটো বদল (মডেল নম্বর আর স্পেসিফিকেশন) ফেরত আনবেন? মডেল/স্পেসিফিকেশন বসানোও বন্ধ হয়ে যাবে."><input type="hidden" name="action" value="undo_all"><button class="btn btn-sm btn-danger">↩️ সব অটো বদল ফেরত আনুন</button></form>`
    : html`<p class="muted">এখনো কোনো বদল হয়নি${on ? ' — কয়েক মিনিটের মধ্যে শুরু হবে।' : '।'}</p>`}
</section>
<p class="small muted">মোট ${bn(total)}টি চালু পণ্য · ${bn(list.length)}টিতে এখনো কিছু ঠিক করার আছে (SEO চেকারে দেখুন)।</p>`;
  return ctx.page('অটো SEO', body, 'autoseo');
}

export const routes = [{ method: '*', path: BASE, perm: 'marketing', handler: handle }];
