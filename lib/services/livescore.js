'use strict';
// Live cricket and football scores from ESPN's public score feeds (the same data ESPN's own site uses).
// Results are kept in memory for a few seconds and the API route is cached at Vercel's edge,
// so thousands of visitors still cause only a handful of requests to ESPN.
const { fetchJson } = require('../util');

const CRICKET_URL = 'https://site.web.api.espn.com/apis/site/v2/sports/cricket/scorepanel';
const FOOTBALL_URL = (league) => `https://site.api.espn.com/apis/site/v2/sports/soccer/${league}/scoreboard`;

// Football competitions the admin can switch on. [ESPN code, Bangla name]
const FOOTBALL_LEAGUES = [
  ['fifa.world', 'ফিফা বিশ্বকাপ'],
  ['fifa.worldq.afc', 'বিশ্বকাপ বাছাই (এশিয়া)'],
  ['fifa.friendly', 'আন্তর্জাতিক প্রীতি ম্যাচ'],
  ['afc.asian.cup', 'এএফসি এশিয়ান কাপ'],
  ['afc.cupq', 'এশিয়ান কাপ বাছাই'],
  ['uefa.champions', 'উয়েফা চ্যাম্পিয়ন্স লিগ'],
  ['uefa.europa', 'উয়েফা ইউরোপা লিগ'],
  ['uefa.nations', 'উয়েফা নেশনস লিগ'],
  ['uefa.euro', 'ইউরো চ্যাম্পিয়নশিপ'],
  ['conmebol.america', 'কোপা আমেরিকা'],
  ['eng.1', 'ইংলিশ প্রিমিয়ার লিগ'],
  ['esp.1', 'লা লিগা (স্পেন)'],
  ['ita.1', 'সিরি আ (ইতালি)'],
  ['ger.1', 'বুন্দেসলিগা (জার্মানি)'],
  ['fra.1', 'লিগ ওয়ান (ফ্রান্স)'],
  ['por.1', 'প্রিমেইরা লিগা (পর্তুগাল)'],
  ['ned.1', 'এরেডিভিসি (নেদারল্যান্ডস)'],
  ['sau.1', 'সৌদি প্রো লিগ'],
  ['usa.1', 'এমএলএস (আমেরিকা)'],
  ['ind.1', 'ইন্ডিয়ান সুপার লিগ'],
  ['bra.1', 'ব্রাজিল সিরি আ'],
  ['arg.1', 'আর্জেন্টিনা লিগ'],
  ['eng.fa', 'এফএ কাপ'],
];
const DEFAULT_FOOTBALL = ['fifa.world', 'fifa.worldq.afc', 'fifa.friendly', 'uefa.champions', 'eng.1', 'esp.1', 'ita.1', 'ger.1', 'fra.1'];
const LEAGUE_BN = Object.fromEntries(FOOTBALL_LEAGUES);

// Cricket competitions the admin can choose. ESPN sends every running match in one feed, so each
// match is sorted into one of these groups by its tournament name (first match wins).
// [code, Bangla name, test on "tournament + match title"]
const CRICKET_LEAGUES = [
  ['women', 'মহিলা ক্রিকেট (সব)', /women|\bWPL\b/i],
  ['ipl', 'আইপিএল (IPL — ইন্ডিয়ান প্রিমিয়ার লিগ)', /indian premier league|\bIPL\b/i],
  ['bpl', 'বিপিএল (বাংলাদেশ প্রিমিয়ার লিগ)', /bangladesh premier league|\bBPL\b/i],
  ['psl', 'পিএসএল (পাকিস্তান সুপার লিগ)', /pakistan super league|\bPSL\b/i],
  ['bbl', 'বিগ ব্যাশ লিগ (অস্ট্রেলিয়া)', /big bash|\bBBL\b/i],
  ['cpl', 'সিপিএল (ক্যারিবিয়ান প্রিমিয়ার লিগ)', /caribbean premier league|\bCPL\b/i],
  ['sa20', 'এসএ২০ (দক্ষিণ আফ্রিকা)', /\bSA20\b/i],
  ['ilt20', 'আইএলটি২০ (দুবাই)', /international league t20|\bILT20\b/i],
  ['hundred', 'দ্য হান্ড্রেড (ইংল্যান্ড)', /the hundred/i],
  ['lpl', 'লঙ্কা প্রিমিয়ার লিগ', /lanka premier league|\bLPL\b/i],
  ['mlc', 'মেজর লিগ ক্রিকেট (আমেরিকা)', /major league cricket|\bMLC\b/i],
  ['icc', 'আইসিসি টুর্নামেন্ট (বিশ্বকাপ, চ্যাম্পিয়ন্স ট্রফি, এশিয়া কাপ)', /\bICC\b|world cup|champions trophy|asia cup|world test championship/i],
  ['intl', 'আন্তর্জাতিক সিরিজ (টেস্ট, ওয়ানডে, টি-২০)', null], // both teams are countries — checked below
  ['other', 'অন্যান্য সব (ঘরোয়া লিগ, কাউন্টি ইত্যাদি)', null],
];
const DEFAULT_CRICKET = CRICKET_LEAGUES.map(([k]) => k); // everything on by default
const CRICKET_CODES = new Set(DEFAULT_CRICKET);
const CRICKET_BN = Object.fromEntries(CRICKET_LEAGUES.map(([k, l]) => [k, l]));
const COUNTRIES = /^(afghanistan|australia|bangladesh|england|india|ireland|new zealand|pakistan|south africa|sri lanka|west indies|zimbabwe|netherlands|scotland|nepal|oman|namibia|canada|usa|united states( of america)?|united arab emirates|uae|hong kong|papua new guinea|png|kenya|uganda|italy|jersey|germany)( a| xi| u-?19| under-?19s?)?$/i;
function cricketCategory(league, title, teams) {
  const text = `${league} ${title}`;
  for (const [code, , re] of CRICKET_LEAGUES) if (re && re.test(text)) return code;
  if (teams.length >= 2 && teams.every((t) => COUNTRIES.test(String(t.name).trim()))) return 'intl';
  return 'other';
}

// Teams Bangladeshi fans care about most come first.
const FAVOURITE = /bangladesh|বাংলাদেশ|\bBAN\b|argentina|brazil/i;

const cache = new Map(); // key -> { at, data, pending }
const FRESH_MS = 12000;

async function cached(key, loader) {
  const c = cache.get(key);
  if (c && c.data && Date.now() - c.at < FRESH_MS) return c.data;
  if (c && c.pending) return c.pending;
  const pending = loader().then((data) => {
    cache.set(key, { at: Date.now(), data });
    return data;
  }).catch((e) => {
    if (c && c.data) { // keep showing the last good scores, try again a little later
      cache.set(key, { at: Date.now() - FRESH_MS + 5000, data: c.data });
      return { ...c.data, stale: true };
    }
    cache.delete(key);
    throw e;
  });
  cache.set(key, { ...(c || {}), pending });
  return pending;
}

function stateOf(status) {
  const t = (status && status.type) || {};
  const st = t.state === 'in' || t.state === 'post' ? t.state : 'pre';
  return { state: st, completed: !!t.completed || st === 'post', detail: t.shortDetail || t.detail || t.description || '', description: t.description || '' };
}
function bool(v) { return v === true || v === 'true'; }

function sortMatches(list) {
  const rank = { in: 0, pre: 1, post: 2 };
  return list.sort((a, b) => (b.fav - a.fav) || (rank[a.state] - rank[b.state])
    || (a.state === 'post' ? new Date(b.date) - new Date(a.date) : new Date(a.date) - new Date(b.date)));
}

// ---------------------------------------------------------------- cricket
function cricketTeam(c) {
  const t = c.team || {};
  const lines = Array.isArray(c.linescores) ? c.linescores : [];
  const cur = lines.find((l) => Number(l.isCurrent) === 1);
  return {
    name: t.displayName || t.name || '', short: t.abbreviation || t.shortDisplayName || '',
    logo: t.logo || (Array.isArray(t.logos) && t.logos[0] && t.logos[0].href) || (t.id ? `https://a.espncdn.com/i/teamlogos/cricket/500/${t.id}.png` : ''),
    score: String(c.score || ''), batting: !!(cur && cur.isBatting), winner: bool(c.winner), order: Number(c.order) || 0,
  };
}
async function loadCricket() {
  const r = await fetchJson(CRICKET_URL, { headers: { Accept: 'application/json' } }, 8000);
  if (!r.ok || !r.data) throw new Error(`cricket feed ${r.status}`);
  const out = [];
  for (const group of r.data.scores || []) {
    const league = (group.leagues && group.leagues[0] && group.leagues[0].name) || '';
    for (const e of group.events || []) {
      const comp = (e.competitions && e.competitions[0]) || {};
      const status = comp.status || e.status || {};
      const st = stateOf(status);
      const teams = (comp.competitors || []).map(cricketTeam).sort((a, b) => a.order - b.order);
      if (teams.length < 2) continue;
      out.push({
        id: String(e.id), league, title: comp.description || '', date: e.date, ...st,
        cat: cricketCategory(league, comp.description || '', teams),
        session: status.session || '', summary: status.summary || '', teams,
        fav: FAVOURITE.test(teams.map((t) => t.name).join(' ') + ' ' + league) ? 1 : 0,
      });
    }
  }
  return { sport: 'cricket', updated: new Date().toISOString(), matches: sortMatches(out) };
}

// ---------------------------------------------------------------- football
function footballTeam(c) {
  const t = c.team || {};
  return {
    name: t.shortDisplayName || t.displayName || t.name || '', short: t.abbreviation || '',
    logo: t.logo || (Array.isArray(t.logos) && t.logos[0] && t.logos[0].href) || '',
    score: c.score === undefined || c.score === null ? '' : String(c.score), winner: bool(c.winner), home: c.homeAway === 'home',
  };
}
async function loadLeague(code) {
  const r = await fetchJson(FOOTBALL_URL(code), { headers: { Accept: 'application/json' } }, 8000);
  if (!r.ok || !r.data) return [];
  const leagueName = LEAGUE_BN[code] || (r.data.leagues && r.data.leagues[0] && r.data.leagues[0].name) || code;
  return (r.data.events || []).map((e) => {
    const comp = (e.competitions && e.competitions[0]) || {};
    const status = comp.status || e.status || {};
    const st = stateOf(status);
    const teams = (comp.competitors || []).map(footballTeam).sort((a, b) => (b.home ? 1 : 0) - (a.home ? 1 : 0));
    const goals = (comp.details || []).filter((d) => d && d.scoringPlay && d.clock).slice(-8).map((d) => ({
      min: d.clock.displayValue || '', team: d.team && d.team.id, who: (d.athletesInvolved && d.athletesInvolved[0] && d.athletesInvolved[0].shortName) || '',
    }));
    return {
      id: String(e.id), league: leagueName, date: e.date, ...st, clock: status.displayClock || '',
      venue: (comp.venue && comp.venue.fullName) || '', teams, goals,
      fav: FAVOURITE.test(teams.map((t) => t.name).join(' ')) ? 1 : 0,
    };
  }).filter((m) => m.teams.length === 2);
}
async function loadFootball(leagues) {
  const lists = await Promise.all(leagues.map((l) => loadLeague(l).catch(() => [])));
  const all = lists.flat();
  return { sport: 'football', updated: new Date().toISOString(), matches: sortMatches(all) };
}

function footballLeagues(settings) {
  let list = DEFAULT_FOOTBALL;
  try { const v = JSON.parse(settings.live_football_leagues || 'null'); if (Array.isArray(v) && v.length) list = v; } catch (_) { /* default */ }
  return list.filter((x) => LEAGUE_BN[x]).slice(0, 15);
}

function cricketLeagues(settings) {
  let list = DEFAULT_CRICKET;
  try { const v = JSON.parse(settings.live_cricket_leagues || 'null'); if (Array.isArray(v) && v.length) list = v; } catch (_) { /* default */ }
  return list.filter((x) => CRICKET_CODES.has(x));
}

async function scores(sport, settings) {
  if (sport === 'cricket') {
    const data = await cached('cricket', loadCricket);
    const allow = new Set(cricketLeagues(settings));
    const keepBd = settings.live_cricket_always_bd !== '0';
    // Bangladesh matches always stay (unless the admin turns that off); everything else follows the ticks.
    return { ...data, matches: data.matches.filter((m) => allow.has(m.cat) || (keepBd && /bangladesh/i.test(m.teams.map((t) => t.name).join(' ')))) };
  }
  const leagues = footballLeagues(settings);
  return cached('football:' + leagues.join(','), () => loadFootball(leagues));
}

function enabled(settings) {
  return { cricket: settings.live_cricket === '1', football: settings.live_football === '1' };
}

module.exports = { scores, enabled, footballLeagues, cricketLeagues, FOOTBALL_LEAGUES, DEFAULT_FOOTBALL, CRICKET_LEAGUES, DEFAULT_CRICKET, CRICKET_BN, cricketCategory };
