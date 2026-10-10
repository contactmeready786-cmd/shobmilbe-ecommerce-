'use strict';
// Admin → সেটিংস ও সংযোগ → 🛰️ DNS রেকর্ড (owner only).
// The domain's DNS lives at Cloudflare (free plan): the shop talks to Cloudflare's API with an API token, so the
// owner can see, add, change and remove DNS records (A, AAAA, CNAME, MX, TXT, NS, SRV, CAA) right here —
// e.g. pointing shobmilbe.com at Vercel, or the TXT codes Google Search Console and Facebook ask for.
// The orange-cloud "Proxy" switch is Cloudflare's: on = traffic passes through Cloudflare (hides the server,
// adds DDoS protection and caching); off = "DNS only". The record works either way.
// Also: Cloudflare's own security settings for the domain (security level / "under attack", HTTPS, SSL mode).
const { html, raw, int, str, fmtDate, fetchJson, bn } = require('../util');
const db = require('../db');
const ui = require('./ui');
const { saveKeys, secretInput } = require('./marketing');

const BASE = '/admin/integrations/dns';
const API = 'https://api.cloudflare.com/client/v4';
const TYPES = ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'SRV', 'CAA'];
const TTLS = [[1, 'Auto (স্বয়ংক্রিয়)'], [60, '১ মিনিট'], [300, '৫ মিনিট'], [3600, '১ ঘণ্টা'], [86400, '১ দিন']];
const PROXYABLE = new Set(['A', 'AAAA', 'CNAME']);
const TYPE_HELP = {
  A: 'নাম → একটা IPv4 ঠিকানা (যেমন 76.76.21.21)। সাইটকে কোনো সার্ভারে পাঠাতে।',
  AAAA: 'নাম → একটা IPv6 ঠিকানা।',
  CNAME: 'নাম → আরেকটা নাম (যেমন www → cname.vercel-dns.com)।',
  MX: 'ইমেইল কোন সার্ভারে আসবে (যেমন Google Workspace / Zoho)। Priority ছোট = আগে।',
  TXT: 'লেখা রেকর্ড — Google, Facebook, ইমেইলের SPF/DKIM ভেরিফিকেশন কোড এখানে বসে।',
  NS: 'কোনো সাব-ডোমেইন অন্য DNS সার্ভারে পাঠাতে (সাধারণত লাগে না)।',
  SRV: 'বিশেষ সার্ভিসের ঠিকানা (যেমন _sip._tcp)। Priority, Weight, Port আর Target লাগে।',
  CAA: 'কোন কোম্পানি SSL সার্টিফিকেট দিতে পারবে (যেমন 0 issue "letsencrypt.org")।',
};

// ---------------------------------------------------------------- Cloudflare API
async function cf(s, path, { method = 'GET', body } = {}) {
  if (!s.cf_api_token) return { ok: false, error: 'Cloudflare API Token দেওয়া নেই।' };
  const r = await fetchJson(API + path, {
    method,
    headers: { Authorization: `Bearer ${s.cf_api_token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  }, 15000);
  const d = r.data || {};
  if (r.ok && d.success !== false) return { ok: true, result: d.result, info: d.result_info };
  const msg = (d.errors || []).map((e) => `${e.message}${e.error_chain ? ' — ' + e.error_chain.map((c) => c.message).join(', ') : ''}`).join('; ') || r.text || `HTTP ${r.status}`;
  return { ok: false, error: explain(msg, r.status) };
}
// Cloudflare's English errors → what to do, in Bangla
function explain(msg, status) {
  const m = String(msg || '');
  if (status === 401 || status === 403 || /Authentication error|Invalid API Token|Unauthorized/i.test(m)) return `টোকেন কাজ করছে না বা অনুমতি কম (${m})। Cloudflare-এ টোকেনটার অনুমতিতে Zone → DNS → Edit আছে কি না দেখুন।`;
  if (/already exists|identical record/i.test(m)) return `একই রকম রেকর্ড আগে থেকেই আছে (${m})।`;
  if (/CNAME.*(conflict|exists)|An A, AAAA, or CNAME record with that host already exists/i.test(m)) return `এই নামে আগে থেকেই A/AAAA/CNAME আছে — একই নামে CNAME আর অন্য রেকর্ড একসাথে থাকতে পারে না (${m})।`;
  if (/Content for A record is invalid/i.test(m)) return 'A রেকর্ডে শুধু IPv4 ঠিকানা দিন, যেমন 76.76.21.21';
  if (/timed out/i.test(m)) return 'Cloudflare সময়মতো উত্তর দেয়নি — একটু পরে আবার চেষ্টা করুন।';
  return m;
}

async function zone(s) {
  const domain = String(s.custom_domain || '').trim();
  if (s.cf_zone_id) {
    const r = await cf(s, `/zones/${encodeURIComponent(s.cf_zone_id)}`);
    if (r.ok) return { ok: true, zone: r.result };
  }
  if (!domain) return { ok: false, error: 'আগে "ডোমেইন সেটআপ" পেজে ডোমেইনের নাম দিন (যেমন shobmilbe.com)।' };
  const r = await cf(s, `/zones?name=${encodeURIComponent(domain)}`);
  if (!r.ok) return r;
  if (!r.result || !r.result.length) return { ok: false, error: `Cloudflare অ্যাকাউন্টে ${domain} পাওয়া যায়নি — আগে Cloudflare-এ "Add a site" দিয়ে ডোমেইনটা যোগ করুন (নিচের ধাপ ১-২)।` };
  await db.setSetting('cf_zone_id', r.result[0].id);
  return { ok: true, zone: r.result[0] };
}

// ---------------------------------------------------------------- form → Cloudflare record
function recordFrom(b, zoneName) {
  const type = TYPES.includes(String(b.type).toUpperCase()) ? String(b.type).toUpperCase() : null;
  if (!type) return { error: 'রেকর্ডের ধরন (Type) বাছুন।' };
  let name = str(b.name, 200).trim().toLowerCase().replace(/\.$/, '');
  if (!name || name === '@') name = zoneName;
  else if (zoneName && name !== zoneName && !name.endsWith('.' + zoneName)) name = `${name}.${zoneName}`;
  if (!/^[a-z0-9_*.-]+$/.test(name)) return { error: 'Name-এ শুধু ইংরেজি অক্ষর, সংখ্যা, - আর . দিন (মূল ডোমেইনের জন্য @)।' };
  const ttl = TTLS.some(([v]) => v === int(b.ttl)) ? int(b.ttl) : 1;
  const comment = str(b.comment, 100);
  const rec = { type, name, ttl, comment: comment || undefined };
  let content = String(b.content || '').trim();
  if (type === 'SRV') {
    const target = str(b.target, 200).trim().replace(/\.$/, '');
    const port = int(b.port); const weight = int(b.weight, 0); const priority = int(b.priority, 0);
    if (!/^_[a-z0-9-]+\._(tcp|udp|tls)\./.test(name)) return { error: 'SRV রেকর্ডের Name হবে এমন: _sip._tcp (তারপর নিজে থেকে ডোমেইন বসবে)।' };
    if (!target || !port) return { error: 'SRV রেকর্ডে Target আর Port দিন।' };
    rec.data = { priority, weight, port, target };
    return { rec };
  }
  if (type === 'CAA') {
    const m = content.match(/^(\d+)\s+(issue|issuewild|iodef)\s+"?([^"]+)"?$/i);
    if (!m) return { error: 'CAA লিখুন এভাবে: 0 issue "letsencrypt.org"' };
    rec.data = { flags: int(m[1]), tag: m[2].toLowerCase(), value: m[3] };
    return { rec };
  }
  if (!content) return { error: 'Content / মান দিন।' };
  if (type === 'A' && !/^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/.test(content)) return { error: 'A রেকর্ডে IPv4 ঠিকানা দিন, যেমন 76.76.21.21' };
  if (type === 'AAAA' && !/^[0-9a-f:]+$/i.test(content)) return { error: 'AAAA রেকর্ডে IPv6 ঠিকানা দিন।' };
  if (['CNAME', 'MX', 'NS'].includes(type)) {
    content = content.replace(/^https?:\/\//i, '').replace(/\/.*$/, '').replace(/\.$/, '').toLowerCase();
    if (!/^[a-z0-9_.-]+\.[a-z0-9-]+$/.test(content)) return { error: `${type} রেকর্ডে একটা ডোমেইন নাম দিন (যেমন cname.vercel-dns.com), লিংক নয়।` };
  }
  if (type === 'TXT' && content.length > 2048) return { error: 'TXT লেখা খুব বড়।' };
  rec.content = content;
  if (type === 'MX') rec.priority = int(b.priority, 10);
  if (PROXYABLE.has(type)) rec.proxied = !!b.proxied;
  return { rec };
}
const shortName = (name, zoneName) => (name === zoneName ? '@' : name.endsWith('.' + zoneName) ? name.slice(0, -(zoneName.length + 1)) : name);
function contentOf(r) {
  if (r.type === 'SRV' && r.data) return `${r.data.priority} ${r.data.weight} ${r.data.port} ${r.data.target}`;
  if (r.type === 'CAA' && r.data) return `${r.data.flags} ${r.data.tag} "${r.data.value}"`;
  return r.content;
}
// what a record is for, in plain words (shown under the record)
function purpose(r, s) {
  const c = String(r.content || '');
  if (/^google-site-verification=/i.test(c)) return '🔎 Google Search Console ভেরিফিকেশন';
  if (/^facebook-domain-verification=/i.test(c)) return '📘 Facebook ডোমেইন ভেরিফিকেশন';
  if (/^v=spf1/i.test(c)) return '✉️ ইমেইল SPF (আপনার নামে ভুয়া মেইল আটকায়)';
  if (/^v=DMARC1/i.test(c)) return '✉️ ইমেইল DMARC';
  if (/domainkey/i.test(r.name)) return '✉️ ইমেইল DKIM';
  if (/vercel/i.test(c) || c === '76.76.21.21' || /^216\.198\.79\./.test(c)) return '▲ ওয়েবসাইট (Vercel)';
  if (r.type === 'MX') return '✉️ ইমেইল কোথায় আসবে';
  if (/tiktok/i.test(c)) return '🎵 TikTok ভেরিফিকেশন';
  void s;
  return '';
}

// ---------------------------------------------------------------- page
async function page(ctx) {
  const s = ctx.settings;
  if (ctx.method === 'POST') {
    const b = await ctx.body();
    if (b.form === 'token') {
      const before = s.cf_api_token;
      await saveKeys(ctx, ['cf_api_token'], b, { secrets: ['cf_api_token'] });
      if (ctx.settings.cf_api_token !== before) await db.setSetting('cf_zone_id', '');
      await ctx.reloadSettings();
      const v = await cf(ctx.settings, '/user/tokens/verify');
      await ctx.log('settings', 'dns', null, 'Cloudflare টোকেন');
      if (!v.ok) return ctx.fail(BASE, 'টোকেন সেভ হয়েছে, কিন্তু Cloudflare বলছে: ' + v.error);
      return ctx.back(BASE, 'saved');
    }
    if (b.form === 'disconnect') {
      await db.setMany({ cf_api_token: '', cf_zone_id: '' });
      await ctx.reloadSettings();
      await ctx.log('settings', 'dns', null, 'Cloudflare সংযোগ বাদ');
      return ctx.back(BASE, 'saved');
    }
    return ctx.back(BASE);
  }

  const connected = !!s.cf_api_token;
  let z = null; let records = []; let err = null; let sec = null;
  if (connected) {
    const zr = await zone(s);
    if (!zr.ok) err = zr.error;
    else {
      z = zr.zone;
      const rr = await cf(s, `/zones/${z.id}/dns_records?per_page=200&order=type`);
      if (rr.ok) records = rr.result || []; else err = rr.error;
      const [lvl, https, ssl] = await Promise.all(['security_level', 'always_use_https', 'ssl'].map((k) => cf(s, `/zones/${z.id}/settings/${k}`)));
      sec = { level: lvl.ok ? lvl.result.value : null, https: https.ok ? https.result.value : null, ssl: ssl.ok ? ssl.result.value : null, err: lvl.ok ? null : lvl.error };
    }
  }
  const zoneName = z ? z.name : (s.custom_domain || 'shobmilbe.com');
  const deleted = db.jsonSetting(s, 'dns_deleted', []);
  const editId = str(ctx.query.get('edit'), 40);
  const editing = editId ? records.find((r) => r.id === editId) : null;
  const pre = presetFrom(ctx.query.get('preset'), s, zoneName);
  const verifyGoogle = s.google_site_verification && !records.some((r) => r.type === 'TXT' && r.content.includes(s.google_site_verification));
  const verifyFb = s.fb_domain_verification && !records.some((r) => r.type === 'TXT' && r.content.includes(s.fb_domain_verification));

  const body = html`<div class="title-row"><h1>🛰️ DNS রেকর্ড ও Cloudflare</h1></div>
${ui.flash(ctx.flash)}
${ui.helpBox('DNS কী, আর এটা কেন দরকার? (সহজ কথায়)', html`<ul>
  <li><b>DNS</b> হলো ইন্টারনেটের ফোনবুক। কেউ <b>${zoneName}</b> লিখলে DNS বলে দেয় সাইটটা কোন সার্ভারে আছে, ইমেইল কোথায় যাবে, আর Google/Facebook-এর ভেরিফিকেশন কোড কী।</li>
  <li>আপনার ডোমেইন কেনা <b>Namecheap</b>-এ। DNS যদি <b>Cloudflare</b>-এ (ফ্রি) রাখেন, তাহলে এই পেজ থেকেই সব রেকর্ড দেখা, যোগ করা, বদলানো আর মোছা যায় — Namecheap-এ বারবার ঢুকতে হয় না।</li>
  <li>Cloudflare বিনা খরচে বাড়তি <b>নিরাপত্তা</b> দেয়: হ্যাকারদের আক্রমণ (DDoS) আটকায়, সন্দেহজনক ভিজিটর ঠেকায়, "Under Attack" মোড আছে।</li>
  <li><b>🟠 Proxy সুইচ</b>: চালু থাকলে ভিজিটর আগে Cloudflare-এর ভেতর দিয়ে আসে (সার্ভার লুকানো থাকে, আক্রমণ আটকায়)। বন্ধ থাকলে "শুধু DNS" — রেকর্ড তখনও ঠিকই কাজ করে। তাই রেফারেন্স সাইটে সুইচ বন্ধ থাকলেও লিংক কাজ করছিল।</li>
  <li>⚠️ আপনার সাইট Vercel-এ চলে। Vercel বলে তাদের রেকর্ডে <b>Proxy বন্ধ</b> (শুধু DNS) রাখতে — Vercel নিজেই আক্রমণ আটকায় আর SSL দেয়। তাই সাইটের রেকর্ডে Proxy বন্ধ রাখাই নিরাপদ।</li>
</ul>`)}

${!connected ? html`<div class="two-col">
  <section class="panel">
    <h2>ধাপে ধাপে Cloudflare চালু করুন (একবারই করতে হবে)</h2>
    <ol class="steps-list">
      <li><a href="https://dash.cloudflare.com/sign-up" target="_blank" rel="noopener">dash.cloudflare.com</a>-এ ফ্রি অ্যাকাউন্ট খুলুন (দোকানের ইমেইল দিয়ে)।</li>
      <li><b>Add a domain</b> → <code>${zoneName}</code> লিখুন → <b>Free</b> প্ল্যান বাছুন। Cloudflare আপনার আগের রেকর্ডগুলো নিজে থেকে পড়ে নেবে — মিলিয়ে দেখুন।</li>
      <li>Cloudflare দুইটা <b>Nameserver</b> দেবে (যেমন <code>ada.ns.cloudflare.com</code>)। Namecheap → Domain List → Manage → <b>Nameservers → Custom DNS</b> বাছুন → দুইটা বসিয়ে ✔ চাপুন।</li>
      <li>৫ মিনিট থেকে কয়েক ঘণ্টার মধ্যে Cloudflare ইমেইল দিয়ে জানাবে ডোমেইন "Active" হয়েছে।</li>
      <li>Cloudflare → ডান উপরে প্রোফাইল → <b>My Profile → API Tokens → Create Token</b> → <b>"Edit zone DNS"</b> টেমপ্লেট → Zone Resources-এ <code>${zoneName}</code> বাছুন। নিরাপত্তা সেটিং এখান থেকে বদলাতে চাইলে "Add more" দিয়ে <b>Zone → Zone Settings → Edit</b>-ও যোগ করুন → Continue → Create Token।</li>
      <li>যে টোকেনটা দেখাবে সেটা কপি করে পাশের ঘরে দিন। (টোকেন শুধু একবার দেখায়, তাই সাথে সাথে বসান।)</li>
    </ol>
  </section>
  <section class="panel">
    <h2>Cloudflare সংযোগ করুন</h2>
    <form method="post" action="${BASE}" class="form">
      <input type="hidden" name="form" value="token">
      ${ui.field('Cloudflare API Token', secretInput('cf_api_token', s.cf_api_token), 'টোকেন এনক্রিপ্ট করে রাখা হয়, শুধু মালিক বদলাতে পারেন।')}
      <button class="btn">💾 সেভ করে সংযোগ পরীক্ষা করুন</button>
    </form>
    <h3 class="h3">Cloudflare ছাড়া (শুধু Namecheap)</h3>
    <p class="small muted">Namecheap-এর নিজের API চালু করতে তাদের অ্যাকাউন্টে টাকা জমা আর আলাদা অনুমতি লাগে, তাই সেখান থেকে সরাসরি বদলানো যায় না। Cloudflare ছাড়া চাইলে নিচের রেকর্ডগুলো হাতে Namecheap → Advanced DNS-এ বসান:</p>
    ${manualTable(s, zoneName)}
  </section>
</div>` : html`
${err ? html`<p class="flash flash-error">⚠️ ${err}</p>` : ''}
${z ? html`<section class="panel dns-zone">
  <div class="dns-zone-row">
    <div><b>${z.name}</b> ${z.status === 'active' ? ui.pill('✅ Cloudflare-এ সক্রিয়', 'pill-delivered') : ui.pill('⏳ ' + (z.status === 'pending' ? 'Nameserver বদলের অপেক্ষায়' : z.status), 'pill-pending')}
      <span class="small muted">প্ল্যান: ${z.plan ? z.plan.name : '—'} · ${bn(records.length)}টি রেকর্ড</span></div>
    <form method="post" action="${BASE}" data-confirm="Cloudflare সংযোগ বাদ দেবেন? DNS রেকর্ড Cloudflare-এ যেমন আছে তেমনই থাকবে, শুধু এখান থেকে দেখা/বদলানো যাবে না।"><input type="hidden" name="form" value="disconnect"><button class="btn btn-sm btn-ghost">সংযোগ বাদ দিন</button></form>
  </div>
  ${z.status !== 'active' ? html`<p class="small">Namecheap → Domain List → Manage → Nameservers → <b>Custom DNS</b>-এ এই দুইটা বসান: ${(z.name_servers || []).map((n) => html`<code class="copy">${n}</code> `)}</p>` : ''}
</section>
${verifyGoogle || verifyFb ? html`<section class="panel dns-suggest">
  <h2>✨ এক চাপে বসান <small>পিক্সেল ও ট্র্যাকিং পেজে কোড দেওয়া আছে, কিন্তু DNS-এ এখনো নেই</small></h2>
  <div class="dns-preset-row">
    ${verifyGoogle ? presetForm('google', '🔎 Google Search Console ভেরিফিকেশন (TXT)', { type: 'TXT', name: '@', content: `google-site-verification=${s.google_site_verification}`, ttl: 1, comment: 'Google Search Console' }) : ''}
    ${verifyFb ? presetForm('fb', '📘 Facebook ডোমেইন ভেরিফিকেশন (TXT)', { type: 'TXT', name: '@', content: `facebook-domain-verification=${s.fb_domain_verification}`, ttl: 1, comment: 'Facebook domain verification' }) : ''}
  </div>
</section>` : ''}

<div class="two-col dns-cols">
  <section class="panel table-wrap">
    <h2>সব DNS রেকর্ড</h2>
    ${records.length ? html`<table class="table compact dns-table"><thead><tr><th>Type</th><th>Name</th><th>Content</th><th>TTL</th><th>Proxy</th><th>কাজ</th></tr></thead>
    <tbody>${records.map((r) => html`<tr class="${editing && editing.id === r.id ? 'row-edit' : ''}">
      <td><span class="dns-type t-${r.type}">${r.type}</span></td>
      <td class="dns-name"><b>${shortName(r.name, z.name)}</b>${purpose(r, s) ? html`<br><span class="small muted">${purpose(r, s)}</span>` : ''}${r.comment ? html`<br><span class="small muted">📝 ${r.comment}</span>` : ''}</td>
      <td class="dns-content"><code class="copy" title="কপি করতে চাপুন">${contentOf(r)}</code>${r.type === 'MX' ? html`<br><span class="small muted">Priority ${r.priority}</span>` : ''}</td>
      <td class="small">${(TTLS.find(([v]) => v === r.ttl) || [0, r.ttl + ' সে'])[1]}</td>
      <td>${r.proxiable ? html`<form method="post" action="${BASE}/proxy" class="dns-proxy" data-no-dirty>
          <input type="hidden" name="id" value="${r.id}"><input type="hidden" name="proxied" value="${r.proxied ? '' : '1'}">
          <button class="proxy-btn ${r.proxied ? 'on' : ''}" title="${r.proxied ? 'Proxy চালু (Cloudflare-এর ভেতর দিয়ে) — চাপলে বন্ধ হবে' : 'শুধু DNS — চাপলে Proxy চালু হবে'}" data-confirm-btn="${r.proxied ? 'Proxy বন্ধ করবেন? রেকর্ড কাজ করবে, শুধু Cloudflare-এর সুরক্ষা এই নামে থাকবে না।' : 'Proxy চালু করবেন? Vercel-এর রেকর্ড হলে Vercel এটা বন্ধ রাখতে বলে।'}">${r.proxied ? '🟠 চালু' : '⚪ বন্ধ'}</button></form>` : html`<span class="small muted">—</span>`}</td>
      <td class="prod-actions"><a class="icon-btn" href="${BASE}?edit=${r.id}#dns-form" title="এডিট">✏️</a>
        <form method="post" action="${BASE}/delete" data-confirm="${r.type} রেকর্ড '${shortName(r.name, z.name)}' মুছবেন? মোছার পর এই পেজের নিচে 'সম্প্রতি মোছা' তালিকায় থাকবে, সেখান থেকে আবার যোগ করা যাবে।"><input type="hidden" name="id" value="${r.id}"><button class="icon-btn icon-danger" title="মুছুন">🗑️</button></form></td>
    </tr>`)}</tbody></table>` : html`<p class="muted">কোনো রেকর্ড নেই।</p>`}
  </section>
  <section class="panel" id="dns-form">${recordForm(editing, pre, z.name)}</section>
</div>

${sec ? html`<section class="panel">
  <h2>🛡️ Cloudflare নিরাপত্তা</h2>
  ${sec.err ? html`<p class="small warn">নিরাপত্তা সেটিং পড়া যায়নি — টোকেনে "Zone Settings → Edit/Read" অনুমতি নেই। (DNS ঠিকই কাজ করবে।)</p>` : html`
  <form method="post" action="${BASE}/security" class="form dns-sec">
    ${ui.field('সুরক্ষার মাত্রা', ui.select('security_level', [['essentially_off', 'প্রায় বন্ধ'], ['low', 'কম'], ['medium', 'মাঝারি (প্রস্তাবিত)'], ['high', 'বেশি'], ['under_attack', '🚨 Under Attack — আক্রমণ চলছে']], sec.level),
    '"Under Attack" দিলে প্রতিটা ভিজিটরকে কয়েক সেকেন্ড পরীক্ষা করে ঢোকানো হয় — শুধু আক্রমণের সময় চালু করুন। (Proxy চালু রেকর্ডে কাজ করে।)')}
    ${ui.field('সবসময় https ব্যবহার', ui.select('always_use_https', [['on', 'চালু (প্রস্তাবিত)'], ['off', 'বন্ধ']], sec.https))}
    ${ui.field('SSL মোড', ui.select('ssl', [['strict', 'Full (strict) — প্রস্তাবিত'], ['full', 'Full'], ['flexible', 'Flexible (ভুল হতে পারে)'], ['off', 'বন্ধ']], sec.ssl), 'Vercel-এর সাথে Full (strict) রাখুন — Flexible দিলে সাইট বারবার ঘুরতে পারে (redirect loop)।')}
    <button class="btn">💾 সেভ করুন</button>
  </form>`}
</section>` : ''}

${deleted.length ? html`<section class="panel">
  <h2>🗑️ সম্প্রতি মোছা রেকর্ড <small>ভুল করে মুছলে "আবার যোগ করুন" চাপুন</small></h2>
  <div class="table-wrap"><table class="table compact"><thead><tr><th>Type</th><th>Name</th><th>Content</th><th>কখন, কে</th><th></th></tr></thead>
  <tbody>${deleted.map((d, i) => html`<tr><td>${d.rec.type}</td><td>${shortName(d.rec.name, z.name)}</td><td><code>${contentOf(d.rec)}</code></td><td class="small">${fmtDate(d.at)} · ${d.by || ''}</td>
    <td><form method="post" action="${BASE}/restore"><input type="hidden" name="i" value="${i}"><button class="btn btn-sm btn-ghost">↩️ আবার যোগ করুন</button></form></td></tr>`)}</tbody></table></div>
</section>` : ''}
` : ''}
`}`;
  return ctx.page('DNS রেকর্ড', body, 'dns');
}

function presetFrom(key, s, zoneName) {
  void zoneName;
  if (key === 'vercel-a') return { type: 'A', name: '@', content: '76.76.21.21', ttl: 1, comment: 'Website (Vercel)' };
  if (key === 'vercel-www') return { type: 'CNAME', name: 'www', content: 'cname.vercel-dns.com', ttl: 1, comment: 'Website www (Vercel)' };
  if (key === 'google') return { type: 'TXT', name: '@', content: `google-site-verification=${s.google_site_verification || ''}`, ttl: 1, comment: 'Google Search Console' };
  if (key === 'fb') return { type: 'TXT', name: '@', content: `facebook-domain-verification=${s.fb_domain_verification || ''}`, ttl: 1, comment: 'Facebook domain verification' };
  return null;
}
function presetForm(key, label, rec) {
  return html`<form method="post" action="${BASE}/save" class="dns-preset" data-no-dirty>
    ${Object.entries(rec).map(([k, v]) => html`<input type="hidden" name="${k}" value="${v}">`)}
    <button class="btn btn-sm" data-preset="${key}">➕ ${label}</button></form>`;
}
function recordForm(r, pre, zoneName) {
  const v = r ? { id: r.id, type: r.type, name: shortName(r.name, zoneName), content: r.content || '', ttl: r.ttl, proxied: r.proxied, priority: r.priority ?? (r.data && r.data.priority) ?? 10, comment: r.comment || '',
    weight: r.data && r.data.weight, port: r.data && r.data.port, target: r.data && r.data.target, caa: r.type === 'CAA' ? contentOf(r) : '' } : (pre || { type: 'A', name: '@', ttl: 1, priority: 10 });
  const type = v.type || 'A';
  return html`<h2>${r ? '✏️ রেকর্ড এডিট' : '➕ নতুন রেকর্ড যোগ করুন'}</h2>
  <form method="post" action="${BASE}/save" class="form dns-form" data-dns-form data-help="${JSON.stringify(TYPE_HELP)}">
    ${r ? html`<input type="hidden" name="id" value="${r.id}">` : ''}
    <div class="field-row">
      ${ui.field('Type', ui.select('type', TYPES.map((t) => [t, t]), type, { 'data-dns-type': true }))}
      ${ui.field('TTL', ui.select('ttl', TTLS, v.ttl || 1))}
    </div>
    <p class="small muted dns-type-help" data-dns-help>${TYPE_HELP[type]}</p>
    ${ui.field('Name', ui.input('name', v.name || '@', { maxlength: 200, placeholder: '@ বা www বা shop', required: true }), raw(`মূল ডোমেইনের জন্য <b>@</b>; সাব-ডোমেইনের জন্য শুধু নামটা (যেমন <b>www</b>, <b>blog</b>) — শেষে .${zoneName} নিজে থেকে বসবে।`))}
    <div data-dns-show="A AAAA CNAME MX TXT NS CAA">${ui.field('Content / মান', ui.textarea('content', type === 'CAA' ? v.caa : v.content, { rows: 2, maxlength: 2048, placeholder: 'IP ঠিকানা, ডোমেইন বা লেখা', class: 'mono' }), 'A = IP ঠিকানা · CNAME/MX/NS = ডোমেইন নাম · TXT = যে কোড দিয়েছে হুবহু')}</div>
    <div class="field-row" data-dns-show="MX SRV">
      ${ui.field('Priority', ui.input('priority', v.priority ?? 10, { type: 'number', min: 0, max: 65535 }), 'ছোট সংখ্যা = আগে')}
      <span data-dns-show="SRV">${ui.field('Weight', ui.input('weight', v.weight ?? 5, { type: 'number', min: 0, max: 65535 }))}</span>
    </div>
    <div class="field-row" data-dns-show="SRV">
      ${ui.field('Port', ui.input('port', v.port || '', { type: 'number', min: 1, max: 65535 }))}
      ${ui.field('Target', ui.input('target', v.target || '', { placeholder: 'sip.example.com' }))}
    </div>
    <label class="check" data-dns-show="A AAAA CNAME"><input type="checkbox" name="proxied" value="1" ${v.proxied ? raw('checked') : ''}> <span>🟠 Proxy চালু (Cloudflare-এর ভেতর দিয়ে) — Vercel-এর রেকর্ডে বন্ধ রাখুন</span></label>
    ${ui.field('নোট (ঐচ্ছিক)', ui.input('comment', v.comment || '', { maxlength: 100, placeholder: 'যেমন: Google Search Console' }))}
    <div class="row-actions"><button class="btn">💾 ${r ? 'বদল সেভ করুন' : 'রেকর্ড সেভ করুন'}</button>${r || pre ? html`<a class="btn btn-ghost" href="${BASE}">বাতিল</a>` : ''}</div>
  </form>
  ${r ? '' : html`<p class="small muted mt">দ্রুত শুরু: <a href="${BASE}?preset=vercel-a#dns-form">ওয়েবসাইট (Vercel) A @</a> · <a href="${BASE}?preset=vercel-www#dns-form">www CNAME</a> · <a href="${BASE}?preset=google#dns-form">Google TXT</a> · <a href="${BASE}?preset=fb#dns-form">Facebook TXT</a></p>`}`;
}
function manualTable(s, zoneName) {
  const rows = [['A Record', '@', '76.76.21.21', 'ওয়েবসাইট'], ['CNAME Record', 'www', 'cname.vercel-dns.com', 'www ঠিকানা']];
  if (s.google_site_verification) rows.push(['TXT Record', '@', `google-site-verification=${s.google_site_verification}`, 'Google']);
  if (s.fb_domain_verification) rows.push(['TXT Record', '@', `facebook-domain-verification=${s.fb_domain_verification}`, 'Facebook']);
  void zoneName;
  return html`<div class="table-wrap"><table class="table compact dns"><thead><tr><th>Type</th><th>Host</th><th>Value</th><th>কেন</th></tr></thead><tbody>
    ${rows.map(([t, h, val, why]) => html`<tr><td>${t}</td><td><code>${h}</code></td><td><code class="copy">${val}</code></td><td class="small">${why}</td></tr>`)}</tbody></table></div>`;
}

// ---------------------------------------------------------------- actions
async function needZone(ctx) {
  const zr = await zone(ctx.settings);
  if (!zr.ok) throw new Error(zr.error);
  return zr.zone;
}
async function save(ctx) {
  const b = await ctx.body();
  try {
    const z = await needZone(ctx);
    const { rec, error } = recordFrom(b, z.name);
    if (error) return ctx.fail(BASE + (b.id ? `?edit=${encodeURIComponent(b.id)}` : ''), error);
    const id = str(b.id, 40);
    const r = id ? await cf(ctx.settings, `/zones/${z.id}/dns_records/${encodeURIComponent(id)}`, { method: 'PUT', body: rec })
      : await cf(ctx.settings, `/zones/${z.id}/dns_records`, { method: 'POST', body: rec });
    if (!r.ok) return ctx.fail(BASE + (id ? `?edit=${encodeURIComponent(id)}` : ''), r.error);
    await ctx.log('settings', 'dns', null, `${id ? 'বদল' : 'যোগ'}: ${rec.type} ${rec.name} → ${rec.content || JSON.stringify(rec.data)}`);
    return ctx.back(BASE, id ? 'saved' : 'added');
  } catch (e) { return ctx.fail(BASE, e.message); }
}
async function proxy(ctx) {
  const b = await ctx.body();
  try {
    const z = await needZone(ctx);
    const r = await cf(ctx.settings, `/zones/${z.id}/dns_records/${encodeURIComponent(str(b.id, 40))}`, { method: 'PATCH', body: { proxied: !!b.proxied } });
    if (!r.ok) return ctx.fail(BASE, r.error);
    await ctx.log('settings', 'dns', null, `Proxy ${b.proxied ? 'চালু' : 'বন্ধ'}: ${r.result.type} ${r.result.name}`);
    return ctx.back(BASE, 'saved');
  } catch (e) { return ctx.fail(BASE, e.message); }
}
async function remove(ctx) {
  const b = await ctx.body();
  try {
    const z = await needZone(ctx);
    const id = str(b.id, 40);
    const got = await cf(ctx.settings, `/zones/${z.id}/dns_records/${encodeURIComponent(id)}`);
    if (!got.ok) return ctx.fail(BASE, got.error);
    const r = await cf(ctx.settings, `/zones/${z.id}/dns_records/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!r.ok) return ctx.fail(BASE, r.error);
    const x = got.result;
    const rec = { type: x.type, name: x.name, ttl: x.ttl, comment: x.comment || undefined };
    if (x.data && (x.type === 'SRV' || x.type === 'CAA')) rec.data = x.data; else rec.content = x.content;
    if (x.type === 'MX') rec.priority = x.priority;
    if (PROXYABLE.has(x.type)) rec.proxied = !!x.proxied;
    const list = [{ rec, at: new Date().toISOString(), by: ctx.user.name }, ...db.jsonSetting(ctx.settings, 'dns_deleted', [])].slice(0, 20);
    await db.setSetting('dns_deleted', JSON.stringify(list));
    await ctx.reloadSettings();
    await ctx.log('settings', 'dns', null, `মোছা: ${x.type} ${x.name} → ${contentOf(x)}`);
    return ctx.back(BASE, 'removed');
  } catch (e) { return ctx.fail(BASE, e.message); }
}
async function restore(ctx) {
  const b = await ctx.body();
  const list = db.jsonSetting(ctx.settings, 'dns_deleted', []);
  const i = int(b.i, -1);
  if (!list[i]) return ctx.back(BASE);
  try {
    const z = await needZone(ctx);
    const r = await cf(ctx.settings, `/zones/${z.id}/dns_records`, { method: 'POST', body: list[i].rec });
    if (!r.ok) return ctx.fail(BASE, r.error);
    list.splice(i, 1);
    await db.setSetting('dns_deleted', JSON.stringify(list));
    await ctx.reloadSettings();
    await ctx.log('settings', 'dns', null, `ফেরত আনা: ${r.result.type} ${r.result.name}`);
    return ctx.back(BASE, 'added');
  } catch (e) { return ctx.fail(BASE, e.message); }
}
async function security(ctx) {
  const b = await ctx.body();
  try {
    const z = await needZone(ctx);
    const want = {
      security_level: ['essentially_off', 'low', 'medium', 'high', 'under_attack'].includes(b.security_level) ? b.security_level : null,
      always_use_https: ['on', 'off'].includes(b.always_use_https) ? b.always_use_https : null,
      ssl: ['strict', 'full', 'flexible', 'off'].includes(b.ssl) ? b.ssl : null,
    };
    const errs = [];
    for (const [k, v] of Object.entries(want)) {
      if (!v) continue;
      const r = await cf(ctx.settings, `/zones/${z.id}/settings/${k}`, { method: 'PATCH', body: { value: v } });
      if (!r.ok) errs.push(`${k}: ${r.error}`);
    }
    await ctx.log('settings', 'dns', null, `Cloudflare নিরাপত্তা: ${Object.entries(want).map(([k, v]) => `${k}=${v}`).join(', ')}`);
    if (errs.length) return ctx.fail(BASE, errs.join(' · '));
    return ctx.back(BASE, 'saved');
  } catch (e) { return ctx.fail(BASE, e.message); }
}

module.exports = {
  routes: [
    { method: '*', path: BASE, perm: 'owner', handler: page },
    { method: 'POST', path: BASE + '/save', perm: 'owner', handler: save },
    { method: 'POST', path: BASE + '/proxy', perm: 'owner', handler: proxy },
    { method: 'POST', path: BASE + '/delete', perm: 'owner', handler: remove },
    { method: 'POST', path: BASE + '/restore', perm: 'owner', handler: restore },
    { method: 'POST', path: BASE + '/security', perm: 'owner', handler: security },
  ],
  recordFrom,
};
