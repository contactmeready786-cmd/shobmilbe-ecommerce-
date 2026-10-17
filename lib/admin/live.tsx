// Admin: live cricket & football scores on the storefront (on/off switches, leagues, refresh speed).
import { Val, attrValue, jsxList } from '../react/html';
import { raw, int, list } from '../util';
import * as db from '../db';
import * as ui from './ui';
import { saveKeys } from './marketing';
import * as live from '../services/livescore';
import type { AdminCtx, Body, Loose } from '../types';

async function settingsPage(ctx: AdminCtx) {
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
  const clicks: Record<string, Loose> = {};
  for (const r of clickRows || []) clicks[r.sport + ':' + r.cat] = r.n;
  const names: Record<string, Loose> = { cricket: Object.fromEntries(live.CRICKET_LEAGUES.map(([k, l]) => [k, l])), football: Object.fromEntries(live.FOOTBALL_LEAGUES) };
  const ticked: Record<string, Loose> = { cricket: chosenCricket, football: chosen };
  const stars = (code?: Loose) => { const n = live.POPULAR[code] || 1; return <span className="lv-stars" title={`বাংলাদেশে জনপ্রিয়তা ${attrValue(ui.bn(n))}/৫`}>{'★'.repeat(n)}<i>{'☆'.repeat(5 - n)}</i></span>; };
  const info = (sport?: Loose, code?: Loose) => (ov && ov[sport] && ov[sport][code]) || { live: [], soon: [] };
  const vs = (m?: Loose) => m.teams.map((t?: Loose) => `${t.name}${t.score ? ' ' + t.score : ''}`).join('  vs  ');
  const timeBn = (d?: Loose) => { // "আজ রাত ৮:৩০" / "আগামীকাল সকাল ১০:০০"
    const dt = new Date(d);
    const dayKey = (x?: Loose) => x.toLocaleDateString('en-GB', { timeZone: 'Asia/Dhaka' });
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dhaka', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(dt).map((p) => [p.type, p.value]));
    const h = Number(parts.hour);
    const part = h < 4 ? 'রাত' : h < 12 ? 'সকাল' : h < 16 ? 'দুপুর' : h < 18 ? 'বিকাল' : h < 20 ? 'সন্ধ্যা' : 'রাত';
    const day = dayKey(dt) === dayKey(new Date()) ? 'আজ' : 'আগামীকাল';
    return `${day} ${part} ${ui.bn((h % 12) || 12)}:${ui.bn(parts.minute)}`;
  };

  // one checkbox row: tick + name + green light / today + popularity + clicks
  const item = (sport?: Loose, field?: Loose, code?: Loose, label?: Loose, isOn?: Loose) => {
    const g = info(sport, code);
    const c = clicks[sport + ':' + code] || 0;
    return <label className={`lv-item ${g.live.length ? 'is-live' : ''}`}>{' '}<input type="checkbox" name={attrValue(field)} defaultValue={attrValue(code)} defaultChecked={!!(isOn)} />{' '}<span className="lv-main"><b><Val v={label} /></b>{' '}<span className="lv-meta">{stars(code)}{' '}{(g.live.length ? <span className="lv-on"><i className="lv-light"></i><Val v={ui.bn(g.live.length)} />টি খেলা এখন চলছে</span> : (g.soon.length ? <span className="lv-soon">⏰ ২৪ ঘণ্টার মধ্যে{' '}<Val v={ui.bn(g.soon.length)} />টি</span> : <span className="lv-off">এখন খেলা নেই</span>))}{' '}{(c ? <span className="lv-clicks" title="গত ৭ দিনে আপনার সাইটে এই খেলায় কতবার চাপ দেওয়া হয়েছে">👆{' '}<Val v={ui.bn(c)} />{' '}বার দেখা</span> : null)}{' '}</span>{' '}{(g.live.length ? <span className="lv-games">{jsxList(g.live.slice(0, 3).map((m?: Loose) => <span>{(m.bd ? "🇧🇩 " : null)}<Val v={vs(m)} /></span>))}</span> : null)}{' '}</span></label>;
  };
  const sortCodes = (sport?: Loose, entries?: Loose) => [...entries].sort((a, b) => Number(info(sport, b[0]).live.length > 0) - Number(info(sport, a[0]).live.length > 0)
    || Number(info(sport, b[0]).soon.length > 0) - Number(info(sport, a[0]).soon.length > 0) || (live.POPULAR[b[0]] || 1) - (live.POPULAR[a[0]] || 1));

  // "right now" list across both sports
  const nowRows: Loose[] = [];
  const soonRows: Loose[] = [];
  if (ov) {
    for (const sport of ['cricket', 'football']) {
      for (const [code, g] of Object.entries<Loose>(ov[sport] || {})) {
        for (const m of g.live) nowRows.push({ sport, code, m });
        for (const m of g.soon) soonRows.push({ sport, code, m });
      }
    }
  }
  const rank = (a: Loose, b: Body) => (b.m.bd - a.m.bd) || ((live.POPULAR[b.code] || 1) - (live.POPULAR[a.code] || 1));
  nowRows.sort(rank);
  soonRows.sort((a, b) => +new Date(a.m.date) - +new Date(b.m.date));
  const shownOnSite = (sport?: Loose, code?: Loose, m?: Loose) => s[`live_${sport}`] === '1' && (ticked[sport].includes(code) || (sport === 'cricket' && m.bd && s.live_cricket_always_bd !== '0'));
  const topClicks = Object.entries(clicks).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const nowPanel = <section className="panel lv-now"><div className="title-row"><h2><i className="lv-light"></i>{' '}এই মুহূর্তে যে খেলাগুলো চলছে</h2><a className="btn btn-sm btn-ghost" href="/admin/design/live">↻ আবার দেখুন</a></div>{(!ov ? <p className="muted">এই মুহূর্তে খেলার তথ্য আনা যাচ্ছে না। একটু পরে "আবার দেখুন" চাপুন।</p> : (nowRows.length ? <div className="table-wrap"><table className="table lv-table"><thead><tr><th>খেলা</th><th>টুর্নামেন্ট</th><th>জনপ্রিয়তা</th><th>আপনার সাইটে</th></tr></thead><tbody>{jsxList(nowRows.map(({ sport, code, m }) => <tr><td><i className="lv-light"></i>{' '}{(sport === 'cricket' ? "🏏" : "⚽")}{' '}{(m.bd ? "🇧🇩 " : null)}<b><Val v={vs(m)} /></b>{(m.status ? <><br /><span className="small muted"><Val v={m.status} /></span></> : null)}</td><td className="small"><Val v={names[sport][code] || code} /><br /><span className="muted"><Val v={m.league} />{(m.title ? (' · ' + m.title) : null)}</span></td><td>{stars(code)}</td><td>{(shownOnSite(sport, code, m) ? <span className="pill pill-delivered">✅ দেখাচ্ছে</span> : <span className="pill pill-cancelled">দেখাচ্ছে না</span>)}</td></tr>))}</tbody></table></div> : <p className="muted">এই মুহূর্তে কোনো খেলা চলছে না।</p>))}{' '}{(soonRows.length ? <><h3>⏰ পরের ২৪ ঘণ্টায় শুরু হবে</h3><ul className="lv-soon-list">{jsxList(soonRows.slice(0, 8).map(({ sport, code, m }) => <li>{(sport === 'cricket' ? "🏏" : "⚽")}{' '}{(m.bd ? "🇧🇩 " : null)}<b><Val v={m.teams.map((t?: Loose) => t.name).join(' vs ')} /></b>{' '}—{' '}<Val v={timeBn(m.date)} />{' '}<span className="muted small">(<Val v={names[sport][code] || code} />)</span>{' '}{stars(code)}</li>))}</ul></> : null)}<h3>👆 আপনার সাইটে সবচেয়ে বেশি দেখা (গত ৭ দিন)</h3>{(topClicks.length ? <ol className="lv-top">{jsxList(topClicks.map(([k, n]) => { const [sp, code] = k.split(':'); return <li>{(sp === 'cricket' ? "🏏" : "⚽")}{' '}<Val v={(names[sp] && names[sp][code]) || code} />{' '}—{' '}<b><Val v={ui.bn(n)} />{' '}বার</b></li>; }))}</ol> : <p className="muted small">এখনো তথ্য জমেনি। ক্রেতারা স্কোর বক্স বা স্কোর পেজে খেলায় চাপ দিলে এখানে হিসাব জমবে।</p>)}<p className="muted small">★ = বাংলাদেশে কতটা জনপ্রিয় (৫ এর মধ্যে, সাধারণ ধারণা)। 👆 = আপনার সাইটে ক্রেতারা কতবার চাপ দিয়েছে।{' '}<i className="lv-light"></i>{' '}সবুজ বাতি = এখন খেলা চলছে।{' '}<b>সহজ নিয়ম:</b>{' '}সবুজ বাতি জ্বলা আর ৪-৫ তারার খেলাগুলোতে টিক দিন।</p></section>;
  const sourceBox = (sport?: Loose, label?: Loose) => <>{' '}{ui.field('স্কোর কোথা থেকে আসবে', ui.select(`live_${sport}_source`, [['auto', 'অটোমেটিক লাইভ ডাটা (সুপারিশকৃত)'], ['embed', 'নিজের পছন্দের উইজেট কোড']], s[`live_${sport}_source`]))}{' '}{ui.field(`${label} উইজেট কোড (শুধু "নিজের পছন্দের উইজেট" বাছলে) — 🔒 শুধু মালিক বদলাতে পারবেন`, ui.textarea(`live_${sport}_embed`, s[`live_${sport}_embed`], { rows: 3, class: 'mono', placeholder: '<iframe src="…"></iframe>' }), 'অন্য কোনো স্কোর সাইট উইজেট কোড দিলে সেটা এখানে পেস্ট করুন। খালি থাকলে অটোমেটিক ডাটাই দেখাবে।')}</>;
  const body = <><h1>লাইভ খেলার স্কোর</h1>{ui.flash(ctx.flash)}{' '}{ui.helpBox('এটা কী?', <>ক্রিকেট বা ফুটবল — যেকোনো একটা চালু করলে দোকানের উপরের মেনুতে{' '}<b>"<Val v={s.live_nav_label || 'লাইভ স্কোর'} />"</b>{' '}নামে একটা বাটন আসবে। সেখানে চাপলে চালু থাকা খেলার পেজ খুলবে।{' '}<b>দুটোই বন্ধ করলে বাটনটা পুরোপুরি চলে যাবে</b>, সাথে বাটনের নিচের ছোট স্কোর বক্সও। খেলা চলার সময় স্কোর নিজে থেকেই কয়েক সেকেন্ড পরপর আপডেট হয় — পেজ রিফ্রেশ করতে হয় না। বাংলাদেশের খেলা সবসময় সবার উপরে দেখাবে। স্কোর আসে ESPN এর লাইভ ডাটা থেকে (যেটা ESPNcricinfo-ও ব্যবহার করে)।</>)}{' '}{nowPanel}<form method="post" action="/admin/design/live" className="form"><div className="two-col"><section className="panel"><h2>🏏 ক্রিকেট</h2><div className="switch-list">{ui.switchRow('live_cricket', s.live_cricket === '1', 'ক্রিকেটের লাইভ স্কোর', 'আন্তর্জাতিক ম্যাচ (টেস্ট, ওয়ানডে, টি-২০), বিপিএল, আইপিএল, বিগ ব্যাশ সহ সব চলমান খেলা')}</div>{sourceBox('cricket', 'ক্রিকেট')}{' '}{(s.live_cricket === '1' ? <p className="small"><a href="/live/cricket" target="_blank">দোকানে ক্রিকেট পেজ দেখুন ↗</a></p> : null)}</section><section className="panel"><h2>⚽ ফুটবল</h2><div className="switch-list">{ui.switchRow('live_football', s.live_football === '1', 'ফুটবলের লাইভ স্কোর', 'নিচে যে লিগগুলো টিক দেবেন সেগুলোর খেলা দেখাবে')}</div>{sourceBox('football', 'ফুটবল')}{' '}{(s.live_football === '1' ? <p className="small"><a href="/live/football" target="_blank">দোকানে ফুটবল পেজ দেখুন ↗</a></p> : null)}</section></div><section className="panel"><h2>উপরের সরু বারে চলমান খেলার স্কোর</h2><div className="switch-list">{ui.switchRow('live_mini', s.live_mini !== '0', 'সাইটের একদম উপরের সরু বারে (নোটিশ লেখার পাশে) চলমান খেলার স্কোর দেখাও',
      'সাইটে ঢুকলেই ক্লিক ছাড়াই উপরের সরু বারে এক লাইনে এখন যে খেলা চলছে তার দুই দলের নাম, স্কোর আর অবস্থা দেখাবে। কয়েকটা খেলা চললে একটার পর একটা ঘুরে ঘুরে দেখাবে। কোনো বন্ধ করার বোতাম নেই, ক্যাটাগরি মেনু ঢাকবে না।')}</div></section><section className="panel"><h2>ক্রিকেটের কোন কোন খেলা দেখাবে</h2><p className="muted small">সবুজ বাতি জ্বলা গুলো এখন চলছে, সেগুলো তালিকার উপরে থাকে। যেগুলো টিক দেবেন শুধু সেগুলোর খেলা দেখাবে। কোনো টুর্নামেন্ট যখন চলে না (যেমন আইপিএল সাধারণত মার্চ-মে মাসে হয়), তখন সেটার খেলা আসবে না — টুর্নামেন্ট শুরু হলে নিজে থেকেই চলে আসবে।</p><div className="lv-list"><Val v={sortCodes('cricket', live.CRICKET_LEAGUES).map(([k, l]) => item('cricket', 'cricket_leagues[]', k, l, chosenCricket.includes(k)))} /></div><div className="switch-list">{ui.switchRow('live_cricket_always_bd', s.live_cricket_always_bd !== '0', 'বাংলাদেশের খেলা সবসময় দেখাও', 'উপরে টিক না থাকলেও বাংলাদেশ দল খেললে সেই ম্যাচ দেখাবে')}</div></section><section className="panel"><h2>ফুটবলের কোন কোন লিগ দেখাবে</h2><p className="muted small">সবুজ বাতি জ্বলা গুলো এখন চলছে, সেগুলো তালিকার উপরে থাকে। সর্বোচ্চ ১৫টি। বেশি লিগ দিলে পেজ একটু ধীরে খুলতে পারে, তাই দরকারি গুলোই রাখুন।</p><div className="lv-list"><Val v={sortCodes('football', live.FOOTBALL_LEAGUES).map(([k, l]) => item('football', 'leagues[]', k, l, chosen.includes(k)))} /></div></section><section className="panel"><h2>অন্যান্য</h2><div className="field-row">{ui.field('মেনুতে বাটনের নাম', ui.input('live_nav_label', s.live_nav_label, { maxlength: 30, placeholder: 'লাইভ স্কোর' }))}{' '}{ui.field('কত সেকেন্ড পরপর স্কোর আপডেট হবে', ui.input('live_refresh', s.live_refresh || '20', { type: 'number', min: 10, max: 120 }), '১০ থেকে ১২০ সেকেন্ড। ১৫-২০ সেকেন্ড সবচেয়ে ভালো।')}</div></section><div className="form-actions sticky-actions"><button className="btn btn-lg">সেভ করুন</button></div></form></>;
  return ctx.page('লাইভ খেলার স্কোর', body, 'live');
}

export const routes = [{ method: '*', path: '/admin/design/live', perm: 'design', handler: settingsPage }];
void raw;
