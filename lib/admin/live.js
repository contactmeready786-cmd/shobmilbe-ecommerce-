'use strict';
// Admin: live cricket & football scores on the storefront (on/off switches, leagues, refresh speed).
const { html, raw, int, list } = require('../util');
const db = require('../db');
const ui = require('./ui');
const navswitch = require('./navswitch');
const { saveKeys } = require('./marketing');
const live = require('../services/livescore');

async function settingsPage(ctx) {
  const s = ctx.settings;
  if (ctx.method === 'POST') {
    const b = await ctx.body();
    const leagues = list(b.leagues).filter((x) => live.FOOTBALL_LEAGUES.some(([k]) => k === x)).slice(0, 15);
    b.live_football_leagues = JSON.stringify(leagues.length ? leagues : live.DEFAULT_FOOTBALL);
    const cricket = list(b.cricket_leagues).filter((x) => live.CRICKET_LEAGUES.some(([k]) => k === x));
    b.live_cricket_leagues = JSON.stringify(cricket.length ? cricket : live.DEFAULT_CRICKET);
    b.live_refresh = String(Math.min(120, Math.max(10, int(b.live_refresh, 20))));
    b.live_nav_label = String(b.live_nav_label || '').trim() || 'লাইভ স্কোর';
    for (const k of ['live_cricket_source', 'live_football_source']) b[k] = b[k] === 'embed' ? 'embed' : 'auto';
    await saveKeys(ctx, ['live_cricket', 'live_football', 'live_nav_label', 'live_refresh', 'live_football_leagues',
      'live_cricket_leagues', 'live_cricket_always_bd', 'live_mini',
      'live_cricket_source', 'live_cricket_embed', 'live_football_source', 'live_football_embed'], b,
    { checkboxes: ['live_cricket', 'live_football', 'live_cricket_always_bd', 'live_mini'] });
    await ctx.log('settings', 'design', null, 'লাইভ খেলার স্কোর');
    return ctx.back('/admin/design/live', 'saved');
  }
  const chosen = live.footballLeagues(s);
  const chosenCricket = live.cricketLeagues(s);

  // What is running right now (all competitions, ticked or not) + what visitors clicked in the last 7 days.
  const [ov, clickRows] = await Promise.all([
    Promise.race([live.overview(), new Promise((r) => setTimeout(() => r(null), 7000))]).catch(() => null),
    db.q(`SELECT sport, cat, SUM(n)::int AS n FROM live_clicks WHERE day >= (now() AT TIME ZONE 'Asia/Dhaka')::date - 6 GROUP BY sport, cat`).catch(() => []),
  ]);
  const clicks = {};
  for (const r of clickRows || []) clicks[r.sport + ':' + r.cat] = r.n;
  const names = { cricket: Object.fromEntries(live.CRICKET_LEAGUES.map(([k, l]) => [k, l])), football: Object.fromEntries(live.FOOTBALL_LEAGUES) };
  const ticked = { cricket: chosenCricket, football: chosen };
  const stars = (code) => { const n = live.POPULAR[code] || 1; return html`<span class="lv-stars" title="বাংলাদেশে জনপ্রিয়তা ${ui.bn(n)}/৫">${'★'.repeat(n)}<i>${'☆'.repeat(5 - n)}</i></span>`; };
  const info = (sport, code) => (ov && ov[sport] && ov[sport][code]) || { live: [], soon: [] };
  const vs = (m) => m.teams.map((t) => `${t.name}${t.score ? ' ' + t.score : ''}`).join('  vs  ');
  const timeBn = (d) => { // "আজ রাত ৮:৩০" / "আগামীকাল সকাল ১০:০০"
    const dt = new Date(d);
    const dayKey = (x) => x.toLocaleDateString('en-GB', { timeZone: 'Asia/Dhaka' });
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dhaka', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(dt).map((p) => [p.type, p.value]));
    const h = Number(parts.hour);
    const part = h < 4 ? 'রাত' : h < 12 ? 'সকাল' : h < 16 ? 'দুপুর' : h < 18 ? 'বিকাল' : h < 20 ? 'সন্ধ্যা' : 'রাত';
    const day = dayKey(dt) === dayKey(new Date()) ? 'আজ' : 'আগামীকাল';
    return `${day} ${part} ${ui.bn((h % 12) || 12)}:${ui.bn(parts.minute)}`;
  };

  // one checkbox row: tick + name + green light / today + popularity + clicks
  const item = (sport, field, code, label, isOn) => {
    const g = info(sport, code);
    const c = clicks[sport + ':' + code] || 0;
    return html`<label class="lv-item ${g.live.length ? 'is-live' : ''}">
      <input type="checkbox" name="${field}" value="${code}" ${isOn ? raw('checked') : ''}>
      <span class="lv-main"><b>${label}</b>
        <span class="lv-meta">${stars(code)}
          ${g.live.length ? html`<span class="lv-on"><i class="lv-light"></i>${ui.bn(g.live.length)}টি খেলা এখন চলছে</span>`
            : g.soon.length ? html`<span class="lv-soon">⏰ ২৪ ঘণ্টার মধ্যে ${ui.bn(g.soon.length)}টি</span>` : html`<span class="lv-off">এখন খেলা নেই</span>`}
          ${c ? html`<span class="lv-clicks" title="গত ৭ দিনে আপনার সাইটে এই খেলায় কতবার চাপ দেওয়া হয়েছে">👆 ${ui.bn(c)} বার দেখা</span>` : ''}
        </span>
        ${g.live.length ? html`<span class="lv-games">${g.live.slice(0, 3).map((m) => html`<span>${m.bd ? '🇧🇩 ' : ''}${vs(m)}</span>`)}</span>` : ''}
      </span></label>`;
  };
  const sortCodes = (sport, entries) => [...entries].sort((a, b) => (info(sport, b[0]).live.length > 0) - (info(sport, a[0]).live.length > 0)
    || (info(sport, b[0]).soon.length > 0) - (info(sport, a[0]).soon.length > 0) || (live.POPULAR[b[0]] || 1) - (live.POPULAR[a[0]] || 1));

  // "right now" list across both sports
  const nowRows = [];
  const soonRows = [];
  if (ov) {
    for (const sport of ['cricket', 'football']) {
      for (const [code, g] of Object.entries(ov[sport] || {})) {
        for (const m of g.live) nowRows.push({ sport, code, m });
        for (const m of g.soon) soonRows.push({ sport, code, m });
      }
    }
  }
  const rank = (a, b) => (b.m.bd - a.m.bd) || ((live.POPULAR[b.code] || 1) - (live.POPULAR[a.code] || 1));
  nowRows.sort(rank);
  soonRows.sort((a, b) => new Date(a.m.date) - new Date(b.m.date));
  const shownOnSite = (sport, code, m) => s[`live_${sport}`] === '1' && (ticked[sport].includes(code) || (sport === 'cricket' && m.bd && s.live_cricket_always_bd !== '0'));
  const topClicks = Object.entries(clicks).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const nowPanel = html`<section class="panel lv-now">
    <div class="title-row"><h2><i class="lv-light"></i> এই মুহূর্তে যে খেলাগুলো চলছে</h2><a class="btn btn-sm btn-ghost" href="/admin/design/live">↻ আবার দেখুন</a></div>
    ${!ov ? html`<p class="muted">এই মুহূর্তে খেলার তথ্য আনা যাচ্ছে না। একটু পরে "আবার দেখুন" চাপুন।</p>`
      : nowRows.length ? html`<div class="table-wrap"><table class="table lv-table"><thead><tr><th>খেলা</th><th>টুর্নামেন্ট</th><th>জনপ্রিয়তা</th><th>আপনার সাইটে</th></tr></thead><tbody>
        ${nowRows.map(({ sport, code, m }) => html`<tr>
          <td><i class="lv-light"></i> ${sport === 'cricket' ? '🏏' : '⚽'} ${m.bd ? '🇧🇩 ' : ''}<b>${vs(m)}</b>${m.status ? html`<br><span class="small muted">${m.status}</span>` : ''}</td>
          <td class="small">${names[sport][code] || code}<br><span class="muted">${m.league}${m.title ? ' · ' + m.title : ''}</span></td>
          <td>${stars(code)}</td>
          <td>${shownOnSite(sport, code, m) ? html`<span class="pill pill-delivered">✅ দেখাচ্ছে</span>` : html`<span class="pill pill-cancelled">দেখাচ্ছে না</span>`}</td></tr>`)}
        </tbody></table></div>`
      : html`<p class="muted">এই মুহূর্তে কোনো খেলা চলছে না।</p>`}
    ${soonRows.length ? html`<h3>⏰ পরের ২৪ ঘণ্টায় শুরু হবে</h3><ul class="lv-soon-list">${soonRows.slice(0, 8).map(({ sport, code, m }) => html`<li>${sport === 'cricket' ? '🏏' : '⚽'} ${m.bd ? '🇧🇩 ' : ''}<b>${m.teams.map((t) => t.name).join(' vs ')}</b> — ${timeBn(m.date)} <span class="muted small">(${names[sport][code] || code})</span> ${stars(code)}</li>`)}</ul>` : ''}
    <h3>👆 আপনার সাইটে সবচেয়ে বেশি দেখা (গত ৭ দিন)</h3>
    ${topClicks.length ? html`<ol class="lv-top">${topClicks.map(([k, n]) => { const [sp, code] = k.split(':'); return html`<li>${sp === 'cricket' ? '🏏' : '⚽'} ${(names[sp] && names[sp][code]) || code} — <b>${ui.bn(n)} বার</b></li>`; })}</ol>`
      : html`<p class="muted small">এখনো তথ্য জমেনি। ক্রেতারা স্কোর বক্স বা স্কোর পেজে খেলায় চাপ দিলে এখানে হিসাব জমবে।</p>`}
    <p class="muted small">★ = বাংলাদেশে কতটা জনপ্রিয় (৫ এর মধ্যে, সাধারণ ধারণা)। 👆 = আপনার সাইটে ক্রেতারা কতবার চাপ দিয়েছে। <i class="lv-light"></i> সবুজ বাতি = এখন খেলা চলছে।
    <b>সহজ নিয়ম:</b> সবুজ বাতি জ্বলা আর ৪-৫ তারার খেলাগুলোতে টিক দিন।</p>
  </section>`;
  const sourceBox = (sport, label) => html`
    ${ui.field('স্কোর কোথা থেকে আসবে', ui.select(`live_${sport}_source`, [['auto', 'অটোমেটিক লাইভ ডাটা (সুপারিশকৃত)'], ['embed', 'নিজের পছন্দের উইজেট কোড']], s[`live_${sport}_source`]))}
    ${ui.field(`${label} উইজেট কোড (শুধু "নিজের পছন্দের উইজেট" বাছলে)`, ui.textarea(`live_${sport}_embed`, s[`live_${sport}_embed`], { rows: 3, class: 'mono', placeholder: '<iframe src="…"></iframe>' }), 'অন্য কোনো স্কোর সাইট উইজেট কোড দিলে সেটা এখানে পেস্ট করুন। খালি থাকলে অটোমেটিক ডাটাই দেখাবে।')}`;
  const body = html`<h1>লাইভ খেলার স্কোর</h1>${ui.flash(ctx.flash)}
${ui.helpBox('এটা কী?', html`ক্রিকেট বা ফুটবল — যেকোনো একটা চালু করলে দোকানের উপরের মেনুতে <b>"${s.live_nav_label || 'লাইভ স্কোর'}"</b> নামে একটা বাটন আসবে। সেখানে চাপলে চালু থাকা খেলার পেজ খুলবে। <b>দুটোই বন্ধ করলে বাটনটা পুরোপুরি চলে যাবে</b>, সাথে বাটনের নিচের ছোট স্কোর বক্সও।
  খেলা চলার সময় স্কোর নিজে থেকেই কয়েক সেকেন্ড পরপর আপডেট হয় — পেজ রিফ্রেশ করতে হয় না। বাংলাদেশের খেলা সবসময় সবার উপরে দেখাবে।
  স্কোর আসে ESPN এর লাইভ ডাটা থেকে (যেটা ESPNcricinfo-ও ব্যবহার করে)।`)}
${navswitch.box(ctx, { fixed: ['live'], back: '/admin/design/live', note: 'স্কোর চালু রেখেও উপরের মেনু থেকে বাটনটা লুকাতে পারেন (বাটন বন্ধ থাকলে ছোট স্কোর বক্সও দেখাবে না)।' })}
${nowPanel}
<form method="post" action="/admin/design/live" class="form">
  <div class="two-col">
    <section class="panel">
      <h2>🏏 ক্রিকেট</h2>
      <div class="switch-list">${ui.switchRow('live_cricket', s.live_cricket === '1', 'ক্রিকেটের লাইভ স্কোর', 'আন্তর্জাতিক ম্যাচ (টেস্ট, ওয়ানডে, টি-২০), বিপিএল, আইপিএল, বিগ ব্যাশ সহ সব চলমান খেলা')}</div>
      ${sourceBox('cricket', 'ক্রিকেট')}
      ${s.live_cricket === '1' ? html`<p class="small"><a href="/live/cricket" target="_blank">দোকানে ক্রিকেট পেজ দেখুন ↗</a></p>` : ''}
    </section>
    <section class="panel">
      <h2>⚽ ফুটবল</h2>
      <div class="switch-list">${ui.switchRow('live_football', s.live_football === '1', 'ফুটবলের লাইভ স্কোর', 'নিচে যে লিগগুলো টিক দেবেন সেগুলোর খেলা দেখাবে')}</div>
      ${sourceBox('football', 'ফুটবল')}
      ${s.live_football === '1' ? html`<p class="small"><a href="/live/football" target="_blank">দোকানে ফুটবল পেজ দেখুন ↗</a></p>` : ''}
    </section>
  </div>
  <section class="panel">
    <h2>বাটনের নিচে ছোট স্কোর বক্স</h2>
    <div class="switch-list">${ui.switchRow('live_mini', s.live_mini !== '0', 'উপরের "লাইভ স্কোর" বাটনের নিচে চলমান খেলার স্কোর দেখাও',
      'সাইটে ঢুকলেই ক্লিক ছাড়াই বাটনের ঠিক নিচে ছোট বক্সে এখন যে খেলা চলছে তার দুই দলের নাম, স্কোর আর অবস্থা দেখাবে। ক্রিকেট চালু থাকলে আগে ক্রিকেট, ফুটবলও চালু থাকলে তার নিচে ফুটবল। খেলা না চললে বক্সটা নিজে থেকেই লুকিয়ে থাকবে। মোবাইলে এটা উপরের মেনুর ঠিক নিচে দেখাবে।')}</div>
  </section>
  <section class="panel">
    <h2>ক্রিকেটের কোন কোন খেলা দেখাবে</h2>
    <p class="muted small">সবুজ বাতি জ্বলা গুলো এখন চলছে, সেগুলো তালিকার উপরে থাকে। যেগুলো টিক দেবেন শুধু সেগুলোর খেলা দেখাবে। কোনো টুর্নামেন্ট যখন চলে না (যেমন আইপিএল সাধারণত মার্চ-মে মাসে হয়), তখন সেটার খেলা আসবে না — টুর্নামেন্ট শুরু হলে নিজে থেকেই চলে আসবে।</p>
    <div class="lv-list">${sortCodes('cricket', live.CRICKET_LEAGUES).map(([k, l]) => item('cricket', 'cricket_leagues[]', k, l, chosenCricket.includes(k)))}</div>
    <div class="switch-list">${ui.switchRow('live_cricket_always_bd', s.live_cricket_always_bd !== '0', 'বাংলাদেশের খেলা সবসময় দেখাও', 'উপরে টিক না থাকলেও বাংলাদেশ দল খেললে সেই ম্যাচ দেখাবে')}</div>
  </section>
  <section class="panel">
    <h2>ফুটবলের কোন কোন লিগ দেখাবে</h2>
    <p class="muted small">সবুজ বাতি জ্বলা গুলো এখন চলছে, সেগুলো তালিকার উপরে থাকে। সর্বোচ্চ ১৫টি। বেশি লিগ দিলে পেজ একটু ধীরে খুলতে পারে, তাই দরকারি গুলোই রাখুন।</p>
    <div class="lv-list">${sortCodes('football', live.FOOTBALL_LEAGUES).map(([k, l]) => item('football', 'leagues[]', k, l, chosen.includes(k)))}</div>
  </section>
  <section class="panel">
    <h2>অন্যান্য</h2>
    <div class="field-row">
      ${ui.field('মেনুতে বাটনের নাম', ui.input('live_nav_label', s.live_nav_label, { maxlength: 30, placeholder: 'লাইভ স্কোর' }))}
      ${ui.field('কত সেকেন্ড পরপর স্কোর আপডেট হবে', ui.input('live_refresh', s.live_refresh || '20', { type: 'number', min: 10, max: 120 }), '১০ থেকে ১২০ সেকেন্ড। ১৫-২০ সেকেন্ড সবচেয়ে ভালো।')}
    </div>
  </section>
  <div class="form-actions sticky-actions"><button class="btn btn-lg">সেভ করুন</button></div>
</form>`;
  return ctx.page('লাইভ খেলার স্কোর', body, 'live');
}

module.exports = {
  routes: [{ method: '*', path: '/admin/design/live', perm: 'design', handler: settingsPage }],
};
void raw;
