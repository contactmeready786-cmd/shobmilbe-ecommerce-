'use strict';
// Admin: live cricket & football scores on the storefront (on/off switches, leagues, refresh speed).
const { html, raw, int, list } = require('../util');
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
      'live_cricket_leagues', 'live_cricket_always_bd', 'live_ticker',
      'live_cricket_source', 'live_cricket_embed', 'live_football_source', 'live_football_embed'], b,
    { checkboxes: ['live_cricket', 'live_football', 'live_cricket_always_bd', 'live_ticker'] });
    await ctx.log('settings', 'design', null, 'লাইভ খেলার স্কোর');
    return ctx.back('/admin/design/live', 'saved');
  }
  const chosen = live.footballLeagues(s);
  const chosenCricket = live.cricketLeagues(s);
  const sourceBox = (sport, label) => html`
    ${ui.field('স্কোর কোথা থেকে আসবে', ui.select(`live_${sport}_source`, [['auto', 'অটোমেটিক লাইভ ডাটা (সুপারিশকৃত)'], ['embed', 'নিজের পছন্দের উইজেট কোড']], s[`live_${sport}_source`]))}
    ${ui.field(`${label} উইজেট কোড (শুধু "নিজের পছন্দের উইজেট" বাছলে)`, ui.textarea(`live_${sport}_embed`, s[`live_${sport}_embed`], { rows: 3, class: 'mono', placeholder: '<iframe src="…"></iframe>' }), 'অন্য কোনো স্কোর সাইট উইজেট কোড দিলে সেটা এখানে পেস্ট করুন। খালি থাকলে অটোমেটিক ডাটাই দেখাবে।')}`;
  const body = html`<h1>লাইভ খেলার স্কোর</h1>${ui.flash(ctx.flash)}
${ui.helpBox('এটা কী?', html`ক্রিকেট বা ফুটবল — যেকোনো একটা চালু করলে দোকানের উপরের মেনুতে <b>"${s.live_nav_label || 'লাইভ স্কোর'}"</b> নামে একটা বাটন আসবে। সেখানে চাপলে চালু থাকা খেলার পেজ খুলবে। <b>দুটোই বন্ধ করলে বাটনটা পুরোপুরি চলে যাবে</b>, আর নিচের ভাসমান স্কোরও দেখাবে না।
  খেলা চলার সময় স্কোর নিজে থেকেই কয়েক সেকেন্ড পরপর আপডেট হয় — পেজ রিফ্রেশ করতে হয় না। বাংলাদেশের খেলা সবসময় সবার উপরে দেখাবে।
  স্কোর আসে ESPN এর লাইভ ডাটা থেকে (যেটা ESPNcricinfo-ও ব্যবহার করে)।`)}
${navswitch.box(ctx, { fixed: ['live'], back: '/admin/design/live', note: 'স্কোর চালু রেখেও উপরের মেনু থেকে বাটনটা লুকাতে পারেন (তখন শুধু নিচের ভাসমান স্কোর দেখাবে)।' })}
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
    <h2>ভাসমান স্কোর (সাইটের নিচে)</h2>
    <div class="switch-list">${ui.switchRow('live_ticker', s.live_ticker !== '0', 'সাইটের সব পেজের নিচে স্কোর ভাসিয়ে দেখাও',
      'খেলা চললে দুই দলের নাম, পতাকা/লোগো, রান-উইকেট-ওভার বা গোল, আর খেলার অবস্থা (যেমন "জিততে ৪৫ রান দরকার") নিচে ছোট বারে ভেসে থাকবে। ক্রেতা ✕ চাপলে বন্ধ করতে পারবে। ক্রিকেট ও ফুটবল দুটো চালু থাকলে দুটোরই খেলা দেখাবে।')}</div>
  </section>
  <section class="panel">
    <h2>ক্রিকেটের কোন কোন খেলা দেখাবে</h2>
    <p class="muted small">যেগুলো টিক দেবেন শুধু সেগুলোর খেলা দেখাবে। কোনো টুর্নামেন্ট যখন চলে না (যেমন আইপিএল সাধারণত মার্চ-মে মাসে হয়), তখন সেটার খেলা আসবে না — টুর্নামেন্ট শুরু হলে নিজে থেকেই চলে আসবে।</p>
    <div class="area-checks">${live.CRICKET_LEAGUES.map(([k, l]) => ui.check('cricket_leagues[]', chosenCricket.includes(k), l, k))}</div>
    <div class="switch-list">${ui.switchRow('live_cricket_always_bd', s.live_cricket_always_bd !== '0', 'বাংলাদেশের খেলা সবসময় দেখাও', 'উপরে টিক না থাকলেও বাংলাদেশ দল খেললে সেই ম্যাচ দেখাবে')}</div>
  </section>
  <section class="panel">
    <h2>ফুটবলের কোন কোন লিগ দেখাবে</h2>
    <p class="muted small">সর্বোচ্চ ১৫টি। বেশি লিগ দিলে পেজ একটু ধীরে খুলতে পারে, তাই দরকারি গুলোই রাখুন।</p>
    <div class="area-checks">${live.FOOTBALL_LEAGUES.map(([k, l]) => ui.check('leagues[]', chosen.includes(k), l, k))}</div>
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
