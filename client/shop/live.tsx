// Live scores: the /live pages, the score in the thin top bar, and counting which matches visitors tap.
import { h, Fragment, paint } from '../jsx.js';
import { $, $all, bn, getJson, hit } from '../dom.js';

void Fragment;
type Team = { name: string; short?: string; logo?: string; score?: string; winner?: boolean; batting?: boolean };
type Match = {
  id: string; cat?: string; state: 'pre' | 'in' | 'post'; date: string; league: string; title?: string; fav?: boolean | number;
  summary?: string; description?: string; session?: string; clock?: string; detail?: string; venue?: string;
  goals?: { who: string; min: string }[]; teams: Team[]; sport?: string;
};
type Feed = { matches?: Match[]; updated: string; stale?: boolean };

const fmt = (d: string | Date, o: Intl.DateTimeFormatOptions): string => { try { return new Date(d).toLocaleString('bn-BD', o); } catch { return ''; } };
const DAY_KEY: Intl.DateTimeFormatOptions = { timeZone: 'Asia/Dhaka', year: 'numeric', month: 'numeric', day: 'numeric' };
const sameDay = (a: string | Date, b: Date) => fmt(a, DAY_KEY) === fmt(b, DAY_KEY);

/** Bangladesh-style time: "রাত ৮:৩০", "বিকাল ৪:০০" (empty when the browser can't tell) */
export function bnTime(d: string | Date): string {
  let hr = 0;
  let mi = '00';
  try {
    for (const p of new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dhaka', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(d))) {
      if (p.type === 'hour') hr = Number(p.value);
      if (p.type === 'minute') mi = p.value;
    }
  } catch { return ''; }
  const part = hr < 4 ? 'রাত' : hr < 12 ? 'সকাল' : hr < 16 ? 'দুপুর' : hr < 18 ? 'বিকাল' : hr < 20 ? 'সন্ধ্যা' : 'রাত';
  return `${part} ${bn(hr % 12 || 12)}:${bn(mi)}`;
}

export function startLive(): void {
  livePage();
  clickCounter();
  topBar();
}

function livePage(): void {
  const box = $('[data-live]');
  if (!box) return;
  const sport = box.getAttribute('data-live') || '';
  const every = Math.max(10, Number(box.getAttribute('data-refresh')) || 20) * 1000;
  let filter = 'all';
  let last: Feed | null = null;
  let timer = 0;
  const when = (d: string) => {
    const now = new Date();
    const day = sameDay(d, now) ? 'আজ' : sameDay(d, new Date(now.getTime() + 864e5)) ? 'আগামীকাল' : fmt(d, { timeZone: 'Asia/Dhaka', weekday: 'short', day: 'numeric', month: 'short' });
    return `${day}, ${bnTime(d) || fmt(d, { timeZone: 'Asia/Dhaka', hour: 'numeric', minute: '2-digit' })}`;
  };
  const Badge = ({ m }: { m: Match }) => m.state === 'in' ? <span className="badge-live">লাইভ</span>
    : m.state === 'pre' ? <span className="badge-pre">{when(m.date)}</span> : <span className="badge-post">শেষ</span>;
  const TeamRow = ({ t }: { t: Team }) => {
    const ph = <span className="ph" />;
    const logo = t.logo ? <img src={t.logo} alt="" loading="lazy" onError={(e: Event) => (e.target as Element).replaceWith(<span className="ph" />)} /> : ph;
    return <div className={`team-row${t.winner ? ' win' : ''}${t.batting ? ' bat' : ''}`}>{logo}<span className="tn" title={t.name}>{t.name}</span><span className="sc">{t.score ?? ''}</span></div>;
  };
  const Card = ({ m, inFav }: { m: Match; inFav: boolean }) => {
    let foot: Node[] = [];
    if (sport === 'cricket') {
      const line = m.summary || (m.state === 'pre' ? '' : m.description);
      if (line) foot = [<div className="match-foot">{line}{m.session && m.state === 'in' ? ` · ${m.session}` : ''}</div>];
    } else {
      const bits: (Node | string)[] = [];
      if (m.state === 'in' && m.clock) bits.push(<span className="clock">{m.clock}</span>);
      if (m.state === 'in' && /half/i.test(`${m.description} ${m.detail}`)) bits.push('বিরতি');
      if (m.venue) bits.push(m.venue);
      if (bits.length) foot.push(<div className="match-foot">{bits.flatMap((b, i) => (i ? [' · ', b] : [b]))}</div>);
      if (m.goals?.length) foot.push(<div className="goals">⚽ {m.goals.map((g) => `${g.who} ${g.min}`).join(', ')}</div>);
    }
    const teams = m.teams.map((t) => (sport === 'cricket' ? t : { name: t.name, logo: t.logo, winner: t.winner, score: m.state === 'pre' ? '' : t.score }));
    const title = sport === 'cricket' ? (inFav ? m.league + (m.title ? ` · ${m.title}` : '') : m.title) : (inFav ? m.league : '');
    return (
      <article className={`match ${sport} is-${m.state}${m.fav ? ' is-fav' : ''}`} data-live-click={`${sport}|${m.cat || ''}|${m.id}`}>
        <div className="match-top"><span className="title">{title || ''}</span><Badge m={m} /></div>
        {teams.map((t) => <TeamRow t={t} />)}{foot}
      </article>
    );
  };
  const render = () => {
    if (!last) return;
    const all = last.matches || [];
    const list = all.filter((m) => filter === 'all' || m.state === filter);
    const liveN = all.filter((m) => m.state === 'in').length;
    const cnt = $('[data-live-count]');
    if (cnt) cnt.textContent = liveN ? `(${bn(liveN)})` : '';
    if (!list.length) {
      paint(box, <p className="live-empty muted">{filter === 'in' ? 'এই মুহূর্তে কোনো খেলা চলছে না।' : 'এখন দেখানোর মতো কোনো খেলা নেই। একটু পরে আবার দেখুন।'}</p>);
    } else {
      // Bangladesh / favourite matches first, then group the rest by tournament
      const groups = new Map<string, { fav: boolean; items: Match[] }>();
      for (const m of list) {
        const g = m.fav ? '⭐ বাংলাদেশ ও প্রিয় দল' : m.league;
        if (!groups.has(g)) groups.set(g, { fav: !!m.fav, items: [] });
        groups.get(g)!.items.push(m);
      }
      paint(box, [...groups].map(([name, g]) =>
        <section className="live-group"><h2>{name}</h2><div className="live-cards">{g.items.map((m) => <Card m={m} inFav={g.fav} />)}</div></section>));
    }
    const up = $('[data-live-updated]');
    if (up) up.textContent = `সর্বশেষ আপডেট: ${bnTime(last.updated)}:${bn(String(new Date(last.updated).getSeconds()).padStart(2, '0'))}${last.stale ? ' (পুরনো)' : ''}`;
  };
  const load = async () => {
    clearTimeout(timer);
    try { last = await getJson<Feed>(`/api/live/${sport}`); render(); } catch {
      if (!last) paint(box, <p className="live-empty muted">স্কোর আনা যাচ্ছে না। ইন্টারনেট সংযোগ দেখুন, কিছুক্ষণ পর নিজে থেকেই আবার চেষ্টা করবে।</p>);
    }
    if (!document.hidden) timer = window.setTimeout(load, every);
  };
  for (const b of $all('[data-live-filter]')) {
    b.addEventListener('click', () => {
      filter = b.getAttribute('data-live-filter') || 'all';
      for (const x of $all('[data-live-filter]')) x.classList.toggle('on', x === b);
      render();
    });
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void load(); else clearTimeout(timer); });
  try { last = JSON.parse($('[data-live-initial]')?.textContent || 'null'); } catch { last = null; }
  if (last) { render(); timer = window.setTimeout(load, every); } else void load();
}

// ---------- count which matches visitors tap (admin sees the most-watched competitions) ----------
function clickCounter(): void {
  const clicked = new Set<string>();
  document.addEventListener('click', (e) => {
    const el = hit(e, '[data-live-click]');
    if (!el || hit(e, '[data-mini-close]')) return;
    const parts = (el.getAttribute('data-live-click') || '').split('|');
    const once = parts.join('|');
    if (!parts[1] || clicked.has(once)) return; // one count per match per page visit
    clicked.add(once);
    const body = JSON.stringify({ sport: parts[0], cat: parts[1] });
    try {
      if (navigator.sendBeacon) navigator.sendBeacon('/api/live/click', new Blob([body], { type: 'application/json' }));
      else void fetch('/api/live/click', { method: 'POST', body, keepalive: true, headers: { 'Content-Type': 'application/json' } });
    } catch { /* never block the visitor */ }
  });
}

// ---------- live score in the thin top bar (next to the notice text) ----------
function topBar(): void {
  const tick = $<HTMLAnchorElement>('[data-live-mini]');
  if (!tick) return;
  const sports = (tick.getAttribute('data-live-mini') || '').split(',').filter(Boolean);
  const every = Math.max(10, Number(tick.getAttribute('data-refresh')) || 20) * 1000;
  const bar = tick.closest('[data-notice]');
  let timer = 0;
  let index = 0;
  let items: Match[] = [];
  // running matches first (Bangladesh first); if none, one that just ended or starts within 3 hours
  const pick = (sp: string, list: Match[]) => {
    const now = Date.now();
    let on = list.filter((m) => m.state === 'in');
    if (!on.length) on = list.filter((m) => Math.abs(new Date(m.date).getTime() - now) < 108e5).slice(0, 1);
    on.sort((a, b) => Number(b.fav || 0) - Number(a.fav || 0));
    return on.slice(0, 6).map((m) => ({ ...m, sport: sp }));
  };
  const TeamName = ({ t, score }: { t: Team; score: boolean }) =>
    <><b className={`lt-team${t.winner ? ' win' : ''}`} title={t.name}>{t.short || t.name || ''}{t.batting ? '*' : ''}</b>{score && t.score ? <>{' '}<span className="lt-sc">{t.score}</span></> : null}</>;
  const draw = () => {
    if (!items.length) { tick.hidden = true; bar?.classList.remove('has-live'); return; }
    const m = items[index % items.length];
    const sp = m.sport || '';
    const tag = m.state === 'in' ? <span className="lt-live">● লাইভ</span> : <span className="lt-tag">{m.state === 'pre' ? bnTime(m.date) : 'শেষ'}</span>;
    const status = sp === 'cricket' ? (m.summary || (m.state === 'in' ? m.session : '') || '')
      : m.state === 'in' ? (m.clock || m.detail || '') : m.state === 'post' ? m.detail || '' : '';
    const score = m.state !== 'pre' || sp === 'cricket';
    const t = m.teams || [];
    tick.href = `/live/${sp}`;
    tick.setAttribute('data-live-click', `${sp}|${m.cat || ''}`);
    paint(tick, tag, ' ', <span className="lt-ic">{sp === 'cricket' ? '🏏' : '⚽'}</span>, ' ',
      t[0] ? <TeamName t={t[0]} score={score} /> : null, ' ', <span className="lt-vs">vs</span>, ' ', t[1] ? <TeamName t={t[1]} score={score} /> : null,
      status ? <>{' '}<span className="lt-st">· {status}</span></> : null,
      items.length > 1 ? <>{' '}<span className="lt-n">{bn((index % items.length) + 1)}/{bn(items.length)}</span></> : null);
    tick.hidden = false;
    bar?.classList.add('has-live');
  };
  const load = async () => {
    clearTimeout(timer);
    const got = await Promise.all(sports.map((sp) => getJson<Feed>(`/api/live/${sp}`).then((d) => pick(sp, d.matches || [])).catch(() => [] as Match[])));
    items = got.flat();
    draw();
    if (!document.hidden) timer = window.setTimeout(load, every);
  };
  // several matches: one after another every 6 seconds
  setInterval(() => { if (!document.hidden && items.length > 1) { index++; draw(); } }, 6000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void load(); else clearTimeout(timer); });
  void load();
}
