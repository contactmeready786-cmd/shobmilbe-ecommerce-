
// Save the given setting keys from a form body. Secret fields left blank keep their old value.
// Boxes where raw code (scripts) can be pasted. A script on the store runs with the same rights as the
// person looking at it, so only the owner may change these — a staff account can't use them to take over.
import type { CouponsRow, IntegrationLogsRow, ProductsRow } from '../data/rows';
import { Val, attrValue, jsxList } from '../react/html';
import { raw, money, bn, fmtDate, int, str, list } from '../util';
import * as db from '../db';
import * as content from '../models/content';
import * as ui from './ui';
import * as $services_seo from '../services/seo';
import * as $status from './status';
import * as $models_catalog from '../models/catalog';
import type { AdminCtx, Body, RouteMatch, Caught, VerificationFile, CustomScript } from '../types';
const OWNER_ONLY_KEYS = new Set(['custom_scripts', 'custom_head', 'custom_body', 'chat_script', 'verification_files', 'live_cricket_embed', 'live_football_embed']);
async function saveKeys(ctx: AdminCtx, keys: string[], body: Body, { secrets = [], checkboxes = [] }: { secrets?: string[]; checkboxes?: string[] } = {}) {
  const owner = ctx.user && ctx.user.role === 'owner';
  for (const k of keys) {
    if (OWNER_ONLY_KEYS.has(k) && !owner) continue;
    if (checkboxes.includes(k)) { await db.setSetting(k, body[k] ? '1' : '0'); continue; }
    if (!(k in body)) continue;
    const v = String(body[k] ?? '').trim();
    if (secrets.includes(k) && (v === '' || /^•+$/.test(v))) continue;
    await db.setSetting(k, v.slice(0, k.startsWith('custom_') || k === 'chat_script' ? 20000 : 2000));
  }
  await ctx.reloadSettings();
}
const secretInput = (name: string, value: string | undefined, attrs = {}) => ui.input(name, value ? '••••••••' : '', { type: 'password', autocomplete: 'off', placeholder: value ? 'সেভ করা আছে (বদলাতে নতুন দিন)' : '', ...attrs });

// ---------------------------------------------------------------- tracking
const ID_RULES = {
  fb_pixel_id: [/^\d{10,20}$/, 'Facebook Pixel ID শুধু সংখ্যা (১৫-১৬ ডিজিট)।'],
  tiktok_pixel_id: [/^[A-Z0-9]{15,25}$/i, 'TikTok Pixel ID ঠিক নেই (যেমন C4ABCDEF123456789)।'],
  gtm_id: [/^GTM-[A-Z0-9]{4,10}$/i, 'GTM ID দেখতে এমন হয়: GTM-ABC1234'],
  ga4_id: [/^G-[A-Z0-9]{6,12}$/i, 'GA4 Measurement ID দেখতে এমন হয়: G-ABC123XYZ'],
};
async function tracking(ctx: AdminCtx) {
  const s = ctx.settings;
  if (ctx.method === 'POST') {
    const b = await ctx.body();
    for (const [k, [re, msg]] of Object.entries(ID_RULES)) {
      if (b[k] && !(re as RegExp).test(String(b[k]).trim())) return ctx.fail('/admin/marketing/tracking', msg as string);
    }
    if (b.gtm_id) b.gtm_id = String(b.gtm_id).trim().toUpperCase();
    if (b.ga4_id) b.ga4_id = String(b.ga4_id).trim().toUpperCase();
    // Domain verification: accept either the bare code or the whole <meta> tag.
    for (const k of ['fb_domain_verification', 'google_site_verification', 'bing_site_verification', 'tiktok_domain_verification']) {
      const m = String(b[k] || '').match(/content=["']([^"']+)["']/);
      if (m) b[k] = m[1];
    }
    const files: VerificationFile[] = [];
    list(b.vf_path).forEach((p, i) => {
      const path = String(p || '').trim().replace(/^\/+/, '');
      const body = String(list(b.vf_content)[i] || '');
      if (path && /^[A-Za-z0-9._\-/]{3,120}$/.test(path) && !path.includes('..')) files.push({ path, content: body.slice(0, 5000) });
    });
    b.verification_files = JSON.stringify(files);
    // "যেকোনো স্ক্রিপ্ট বসান": named codes, each with its own place and on/off
    const scripts: CustomScript[] = [];
    list(b.sc_name).forEach((n, i) => {
      const code = String(list(b.sc_code)[i] || '').trim();
      const name = String(n || '').trim().slice(0, 60);
      if (!code) return;
      scripts.push({ name: name || `স্ক্রিপ্ট ${scripts.length + 1}`, place: list(b.sc_place)[i] === 'body' ? 'body' : 'head', on: list(b.sc_on)[i] !== '0', code: code.slice(0, 20000) });
    });
    if (ctx.user.role === 'owner') b.custom_scripts = JSON.stringify(scripts.slice(0, 20));
    await saveKeys(ctx, ['fb_pixel_id', 'fb_capi_token', 'fb_test_code', 'fb_domain_verification', 'tiktok_pixel_id', 'tiktok_events_token',
      'tiktok_domain_verification', 'gtm_id', 'ga4_id', 'google_site_verification', 'bing_site_verification', 'verification_files', 'custom_scripts', 'custom_head', 'custom_body'],
    b, { secrets: ['fb_capi_token', 'tiktok_events_token'] });
    await ctx.log('settings', 'marketing', null, 'ট্র্যাকিং');
    return ctx.back('/admin/marketing/tracking', 'saved');
  }
  const files = db.jsonSetting<VerificationFile[]>(s, 'verification_files', []);
  const logs = await db.q<IntegrationLogsRow>(`SELECT * FROM integration_logs WHERE service IN ('facebook','tiktok') ORDER BY created_at DESC LIMIT 10`);
  const scripts = db.jsonSetting<CustomScript[]>(s, 'custom_scripts', []);
  const owner = ctx.user.role === 'owner';
  const st = [
    ['Facebook Pixel', !!s.fb_pixel_id, '#fb'], ['Conversions API', !!s.fb_capi_token, '#fb'], ['FB ডোমেইন ভেরিফিকেশন', !!s.fb_domain_verification, '#fb'],
    ['TikTok Pixel', !!s.tiktok_pixel_id, '#tt'], ['TikTok Events API', !!s.tiktok_events_token, '#tt'],
    ['Google Tag Manager', !!s.gtm_id, '#gg'], ['Google Analytics 4', !!s.ga4_id, '#gg'], ['Search Console', !!s.google_site_verification, '#gg'],
    ['অন্যান্য স্ক্রিপ্ট', scripts.some((x) => x.on) || !!(s.custom_head || s.custom_body), '#scripts'],
  ];
  const body = <><h1>পিক্সেল ও ট্র্যাকিং</h1>{ui.flash(ctx.flash)}<nav className="trk-status" aria-label="কী কী বসানো আছে">{jsxList(st.map(([t, on, a]) => <a href={attrValue(a)} className={`trk-chip ${on ? 'on' : ''}`}>{(on ? "✅" : "⭕")}{' '}<Val v={t} /></a>))}{' '}<a className="trk-chip" href="/admin/integrations/status">🔌 সংযোগ পরীক্ষা →</a></nav>{ui.helpBox('এগুলো দিয়ে কী হয়?', <>বিজ্ঞাপন থেকে কে এলো, কে কিনলো — এসব তথ্য Facebook, TikTok, Google এর কাছে যায়, তাই বিজ্ঞাপন আরও ভালো কাজ করে। সাইট নিজে থেকেই এই ইভেন্টগুলো পাঠায়:{' '}<b>PageView</b>{' '}(পেজ দেখা),{' '}<b>ViewContent</b>{' '}(পণ্য দেখা),{' '}<b>AddToCart</b>{' '}(কার্টে যোগ),{' '}<b>InitiateCheckout</b>{' '}(চেকআউট শুরু),{' '}<b>Purchase</b>{' '}(অর্ডার সম্পন্ন)। শুধু নিচে ID বসিয়ে সেভ করুন।</>)}<form method="post" action="/admin/marketing/tracking" className="form"><section className="panel"><h2 id="fb"><span className="brand-dot fb"></span>{' '}Facebook (Meta)</h2><p className="muted small">ব্রাউজারের Pixel সব ইভেন্ট পাঠায় (PageView, ViewContent, AddToCart, InitiateCheckout, Purchase); Conversions API টোকেন দিলে{' '}<b>Purchase</b>{' '}সার্ভার থেকেও যায় — একই event_id দিয়ে, তাই Facebook একবারই গোনে। ডোমেইন ভেরিফিকেশন কোড দিলে দোকানের প্রতিটা পেজে{' '}<code>{"<meta name=\"facebook-domain-verification\">"}</code>{' '}ট্যাগ নিজে থেকে বসে। চাইলে{' '}<a href="/admin/integrations/dns">DNS-এ TXT</a>{' '}দিয়েও ভেরিফাই করা যায়।</p><div className="field-row">{ui.field('Pixel ID (Dataset ID)', ui.input('fb_pixel_id', s.fb_pixel_id, { inputmode: 'numeric', placeholder: 'যেমন 123456789012345' }), 'Events Manager → Data sources → আপনার Pixel → Settings এ পাবেন')}{' '}{ui.field('Conversions API Access Token (ঐচ্ছিক, সুপারিশকৃত)', secretInput('fb_capi_token', s.fb_capi_token), 'Pixel Settings → Conversions API → Generate access token। iPhone ব্যবহারকারীদের বিক্রিও সঠিকভাবে গুনবে।')}</div><div className="field-row">{ui.field('ডোমেইন ভেরিফিকেশন কোড', ui.input('fb_domain_verification', s.fb_domain_verification, { placeholder: 'meta tag বা শুধু কোড পেস্ট করুন' }), 'Business Settings → Brand safety → Domains → Add → Meta-tag Verification')}{' '}{ui.field('Test Event Code (শুধু টেস্টের সময়)', ui.input('fb_test_code', s.fb_test_code, { placeholder: 'TEST12345' }), 'টেস্ট শেষে খালি করে দিন')}</div></section><section className="panel"><h2 id="tt"><span className="brand-dot tt"></span>{' '}TikTok</h2><div className="field-row">{ui.field('TikTok Pixel ID', ui.input('tiktok_pixel_id', s.tiktok_pixel_id, { placeholder: 'যেমন C4ABCDEFG123456789' }), 'TikTok Ads Manager → Assets → Events → Web Events')}{' '}{ui.field('Events API Access Token (ঐচ্ছিক)', secretInput('tiktok_events_token', s.tiktok_events_token))}</div>{ui.field('ডোমেইন ভেরিফিকেশন (meta tag থাকলে)', ui.input('tiktok_domain_verification', s.tiktok_domain_verification), 'TikTok ফাইল ডাউনলোড করতে বললে নিচের "ভেরিফিকেশন ফাইল" অংশে দিন')}</section><section className="panel"><h2 id="gg"><span className="brand-dot gg"></span>{' '}Google</h2><div className="field-row">{ui.field('Google Tag Manager ID', ui.input('gtm_id', s.gtm_id, { placeholder: 'GTM-XXXXXXX' }), 'tagmanager.google.com → Container ID')}{' '}{ui.field('Google Analytics 4 Measurement ID', ui.input('ga4_id', s.ga4_id, { placeholder: 'G-XXXXXXXXXX' }), 'Analytics → Admin → Data streams → Web। সাইট নিজেই পেজ দেখা, কার্টে যোগ, চেকআউট আর কেনা (purchase) GA4-এ পাঠায়।')}{' '}{(s.gtm_id && s.ga4_id ? <p className="flash flash-error small">⚠️ GTM আর GA4 দুটোই দেওয়া আছে। GTM কন্টেইনারের ভেতরে যদি একই GA4 ট্যাগ বসানো থাকে, তাহলে প্রতিটা ভিজিট আর বিক্রি দুইবার গোনা হবে। যেকোনো একটা পথ রাখুন: হয় এখানে GA4 ID, নয়তো শুধু GTM-এর ভেতরে GA4।</p> : null)}</div><p className="muted small">GTM ব্যবহার করলে GA4 সাধারণত GTM এর ভেতরেই সেট করা হয় — তখন এখানে GA4 খালি রাখুন, নাহলে দুইবার গুনবে। সাইট সব ইভেন্ট{' '}<code>dataLayer</code>{' '}এ (GA4 ই-কমার্স ফরম্যাটে: view_item, add_to_cart, begin_checkout, purchase) পাঠায়।</p><div className="field-row">{ui.field('Google Search Console ভেরিফিকেশন কোড', ui.input('google_site_verification', s.google_site_verification, { placeholder: 'meta tag বা কোড' }))}{' '}{ui.field('Bing ভেরিফিকেশন কোড', ui.input('bing_site_verification', s.bing_site_verification))}</div></section><section className="panel"><h2>ভেরিফিকেশন ফাইল</h2><p className="muted small">কোনো সার্ভিস যদি বলে "এই ফাইলটা আপনার সাইটের রুটে রাখুন" (যেমন{' '}<code>google1234.html</code>{' '}বা{' '}<code>tiktokABC.txt</code>), ফাইলের নাম আর ভেতরের লেখা এখানে দিন।</p><div data-repeat="vf">{jsxList([...files, { path: '', content: '' }].map((f) => <div className="field-row repeat-row">{ui.field('ফাইলের নাম', ui.input('vf_path[]', f.path, { placeholder: 'google1234abcd.html' }))}{' '}{ui.field('ফাইলের ভেতরের লেখা', ui.input('vf_content[]', f.content))}</div>))}</div><button type="button" className="btn btn-sm btn-ghost" data-repeat-add="vf">+ আরেকটা ফাইল</button></section><section className="panel" id="scripts"><h2>🧩 থার্ড-পার্টি ইন্টিগ্রেশন — যেকোনো স্ক্রিপ্ট বসান{' '}{(owner ? null : <small>🔒 শুধু মালিক বদলাতে পারবেন</small>)}</h2><p className="muted small">Microsoft Clarity, Hotjar, Snapchat/Pinterest Pixel, Google Ads কনভার্সন, অন্য কোনো চ্যাট — যে কোম্পানি "এই কোডটা আপনার সাইটে বসান" বলে, তার কোড এখানে নাম দিয়ে বসান। প্রতিটার আলাদা চালু/বন্ধ আছে, তাই কোড না মুছেই বন্ধ রাখা যায়।</p><div data-repeat="sc" className="sc-list">{jsxList([...scripts, { name: '', place: 'head', on: true, code: '' }].map((x) => <div className="repeat-row sc-row"><div className="field-row">{ui.field('নাম', ui.input('sc_name[]', x.name, { placeholder: 'যেমন: Microsoft Clarity', maxlength: 60, disabled: !owner }))}{' '}{ui.field('কোথায় বসবে', ui.select('sc_place[]', [['head', '<head> এর ভেতরে (বেশিরভাগ কোড)'], ['body', '<body> এর শেষে']], x.place, { disabled: !owner }))}{' '}{ui.field('অবস্থা', ui.select('sc_on[]', [['1', '✅ চালু'], ['0', '⏸ বন্ধ']], x.on ? '1' : '0', { disabled: !owner }))}</div>{ui.field('কোড', ui.textarea('sc_code[]', x.code, { rows: 3, class: 'mono', placeholder: '<script>…</script>', disabled: !owner }))}</div>))}</div>{(owner ? <button type="button" className="btn btn-sm btn-ghost" data-repeat-add="sc">+ আরেকটা স্ক্রিপ্ট</button> : null)}<details className="mt"><summary className="small">{"পুরোনো দুই বক্স (<head> ও <body>)"}{' '}{(s.custom_head || s.custom_body ? "— কোড আছে" : null)}</summary>{ui.field('<head> এর ভেতরে কোড — 🔒 শুধু মালিক বদলাতে পারবেন', ui.textarea('custom_head', s.custom_head, { rows: 3, class: 'mono' }))}{' '}{ui.field('<body> এর শেষে কোড — 🔒 শুধু মালিক বদলাতে পারবেন', ui.textarea('custom_body', s.custom_body, { rows: 3, class: 'mono' }))}</details><p className="muted small">⚠️ শুধু বিশ্বস্ত জায়গা থেকে পাওয়া কোড দিন। Facebook Pixel, TikTok, GTM, GA4 এখানে দেবেন না — উপরের ঘরে ID দিলেই হয় (নইলে দুইবার গুনবে)।</p></section><div className="form-actions sticky-actions"><button className="btn btn-lg">সেভ করুন</button></div></form>{(logs.length ? <section className="panel"><h2>সার্ভার ইভেন্টের সাম্প্রতিক সমস্যা</h2><ul className="small">{jsxList(logs.map((l) => <li>{fmtDate(l.created_at)}{' '}·{' '}<Val v={l.service} />{' '}·{' '}<Val v={l.message} /></li>))}</ul></section> : null)}</>;
  return ctx.page('পিক্সেল ও ট্র্যাকিং', body, 'tracking');
}

// ---------------------------------------------------------------- SEO
async function seo(ctx: AdminCtx) {
  const s = ctx.settings;
  if (ctx.method === 'POST') {
    const b = await ctx.body();
    // 🧹 one tap: remove "Product details of …" (copied from other shops) from the start of every product name
    if (b.action === 'fix_names') {
      const S = $services_seo;
      const rows = await db.q<Pick<ProductsRow, 'id' | 'name'>>(`SELECT id, name FROM products WHERE name ~* '^\\s*(product\\s+details?\\s+of\\s|product\\s+name\\s*:)'`);
      let n = 0;
      for (const r of rows) {
        const clean = S.cleanName(r.name);
        if (clean && clean !== r.name) { await db.q('UPDATE products SET name=$1, updated_at=now() WHERE id=$2', [clean, r.id]); n++; }
      }
      await ctx.log('product_bulk', 'product', null, `SEO: ${n}টি পণ্যের নাম পরিষ্কার করা হলো`);
      return ctx.back('/admin/marketing/seo?tab=check', 'saved');
    }
    if (b.og_image_id !== undefined) await db.q(`UPDATE media SET owner_type='setting', owner_id=0 WHERE id=$1 AND owner_type IS NULL`, [int(b.og_image_id)]);
    await saveKeys(ctx, ['seo_title', 'seo_description', 'seo_keywords', 'og_image_id', 'site_url'], { ...b, site_url: String(b.site_url || '').trim().replace(/\/+$/, '') });
    await ctx.log('settings', 'marketing', null, 'SEO');
    return ctx.back('/admin/marketing/seo', 'saved');
  }
  const base = s.site_url || '';
  const tabs = <nav className="rs-tabs"><a className={`tab ${ctx.query.get('tab') === 'check' ? '' : 'on'}`} href="/admin/marketing/seo">⚙️ সেটিংস</a><a className={`tab ${ctx.query.get('tab') === 'check' ? 'on' : ''}`} href="/admin/marketing/seo?tab=check">🩺 SEO চেকার</a></nav>;
  if (ctx.query.get('tab') === 'check') {
    const { total, list, avg, perfect } = await $status.seoProblems();
    const bad = list.filter((p) => p.why.some((w: string[]) => w[0] === 'bad')).length;
    const body = <><h1>SEO (গুগল সার্চ)</h1>{tabs}{' '}{(!base ? <p className="flash flash-error">⚠️ ওয়েবসাইটের ঠিকানা দেওয়া নেই — এটা না দিলে গুগল ঠিক লিংক চিনতে পারবে না।{' '}<a href="/admin/marketing/seo">সেটিংসে দিন</a>।</p> : null)}{' '}{ui.flash(ctx.flash)}<p className="flash">✅ প্রতিটা পণ্য আর ক্যাটাগরির গুগল টাইটেল ও বিবরণ এখন নিজে থেকে তৈরি হয় (নাম + দাম + "Price in BD" + ডেলিভারি)। কোনো পণ্যে নিজে লিখে দিলে সেটাই দেখাবে।</p>{(list.some((p) => $services_seo.needsNameFix(p.name)) ? <form method="post" action="/admin/marketing/seo" className="inline" data-confirm="সব পণ্যের নামের শুরু থেকে 'Product details of' সরিয়ে দেবো?"><input type="hidden" name="action" defaultValue="fix_names" /><button className="btn">🧹{' '}{bn(list.filter((p) => $services_seo.needsNameFix(p.name)).length)}টি পণ্যের নাম একসাথে ঠিক করুন</button></form> : null)}<div className="kpis">{ui.kpi('দোকানের SEO স্কোর', `${bn(avg)}/১০০`, avg >= 80 ? 'খুব ভালো' : avg >= 60 ? 'ভালো, আরও বাড়ানো যায়' : 'নিচের তালিকা থেকে ঠিক করুন', avg >= 80 ? 'kpi-green' : avg >= 60 ? 'kpi-blue' : 'kpi-red')}{ui.kpi('দোকানে চালু পণ্য', bn(total), `${bn(perfect)}টির স্কোর ৯০+`)}{ui.kpi('জরুরি সমস্যা', bn(bad), 'ছবি বা বিবরণ নেই', bad ? 'kpi-red' : 'kpi-green')}{ui.kpi('ছোটখাটো', bn(list.length - bad), 'ঠিক করলে স্কোর বাড়বে')}</div>{ui.helpBox('স্কোর কীভাবে হিসাব হয়', <p className="small">প্রতিটা পণ্য ১০০-এর মধ্যে: ছবি ২০ · বিবরণ ২০ (+২০০ অক্ষরের বেশি হলে আরও ১০) · মডেল/পার্ট নম্বর ১২ · স্পেসিফিকেশন ১০ · ক্যাটাগরি ১০ · একাধিক ছবি ৬ · ব্র্যান্ড ৪ · ঠিকঠাক টাইটেল ৪ · রিভিউ ৪। সবচেয়ে কম স্কোরের পণ্য উপরে — ওগুলো আগে ঠিক করলে Google-এ তাড়াতাড়ি উঠবে।</p>)}<section className="panel table-wrap">{(list.length ? <><table className="table compact"><thead><tr><th>পণ্য</th><th>যা ঠিক করতে হবে</th><th></th></tr></thead><tbody>{jsxList(list.sort((a, b) => a.score - b.score || b.id - a.id).slice(0, 300).map((p) => <tr><td><Val v={p.name} />{(p.sku ? <><br /><span className="small muted">SKU{' '}<Val v={p.sku} /></span></> : null)}<br /><b className={p.score >= 80 ? 'ok' : p.score >= 50 ? 'warn' : 'bad'}>স্কোর{' '}{bn(p.score)}/১০০</b></td><td className="small">{jsxList(p.why.map((w: unknown[]) => <><span className={w[0] === 'bad' ? 'bad' : w[0] === 'warn' ? 'warn' : 'muted'}>{(w[0] === 'bad' ? "❌" : (w[0] === 'warn' ? "⚠️" : "ℹ️"))}{' '}<Val v={w[1]} /></span><br /></>))}</td><td><a className="btn btn-sm btn-ghost" href={`/admin/products/${attrValue(p.id)}`}>✏️ ঠিক করুন</a></td></tr>))}</tbody></table>{(list.length > 300 ? <p className="small muted">প্রথম ৩০০টি দেখানো হচ্ছে।</p> : null)}</> : <p>🎉 সব পণ্যের SEO ঠিক আছে।</p>)}</section><p className="small muted">টিপস: টাইটেল ৫০-৬০ অক্ষর (পণ্যের নাম + মূল বৈশিষ্ট্য + "price in BD"), বিবরণ ১২০-১৬০ অক্ষর। প্রতিটা পণ্যে অন্তত একটা পরিষ্কার ছবি আর কয়েক লাইন নিজের লেখা বিবরণ দিন — কপি করা লেখা গুগল কম পছন্দ করে।</p></>;
    return ctx.page('SEO চেকার', body, 'seo');
  }
  const body = <><h1>SEO (গুগল সার্চ)</h1>{tabs}{ui.flash(ctx.flash)}<form method="post" action="/admin/marketing/seo" className="form"><div className="two-col"><section className="panel">{ui.field('ওয়েবসাইটের ঠিকানা', ui.input('site_url', s.site_url, { type: 'url', placeholder: 'https://shobmilbe.com' }), 'ডোমেইন যুক্ত হওয়ার পর এখানে দিন। Sitemap, Facebook শেয়ার আর পেমেন্টের জন্য দরকার।')}{' '}{ui.field('হোমপেজের টাইটেল', ui.input('seo_title', s.seo_title, { maxlength: 70, placeholder: `${s.store_name} | অনলাইন শপ`, 'data-count': 60 }), 'গুগলে নীল লেখায় যা দেখায়। ৫০-৬০ অক্ষরের মধ্যে রাখুন।')}{' '}{ui.field('হোমপেজের বিবরণ', ui.textarea('seo_description', s.seo_description, { rows: 3, maxlength: 300, placeholder: s.tagline, 'data-count': 160 }), 'গুগলে টাইটেলের নিচে যা দেখায়। ১২০-১৬০ অক্ষর।')}{' '}{ui.field('কিওয়ার্ড (কমা দিয়ে)', ui.input('seo_keywords', s.seo_keywords, { maxlength: 300, placeholder: 'electronics shop bangladesh, arduino price in bd' }))}{' '}{ui.imagePicker('og_image_id', s.og_image_id, { label: 'শেয়ার ইমেজ (Facebook/WhatsApp এ লিংক দিলে যে ছবি দেখাবে)', hint: '১২০০×৬৩০ পিক্সেল সবচেয়ে ভালো', wide: true })}{' '}<button className="btn">সেভ করুন</button></section><section className="panel"><h2>গুগলে কেমন দেখাবে</h2><div className="serp"><span className="serp-url">{base.replace(/^https?:\/\//, '') || 'shobmilbe.com'}</span>{' '}<span className="serp-title" data-serp-title=""><Val v={s.seo_title || `${s.store_name} | অনলাইন শপ`} /></span>{' '}<span className="serp-desc" data-serp-desc=""><Val v={s.seo_description || s.tagline} /></span></div><h2>যা নিজে থেকেই করা আছে</h2><ul className="checklist"><li>✅ প্রতিটা পণ্য, ক্যাটাগরি আর ব্লগ পোস্টের আলাদা টাইটেল ও বিবরণ (পণ্য এডিট পেজে বদলানো যায়)</li><li>✅ Sitemap:{' '}<a href="/sitemap.xml" target="_blank">/sitemap.xml</a>{' '}— Search Console এ এটা জমা দিন</li><li>✅{' '}<a href="/robots.txt" target="_blank">/robots.txt</a>{' '}(অ্যাডমিন, কার্ট, চেকআউট গুগল থেকে লুকানো)</li><li>✅ পণ্যের দাম, স্টক, ছবি গুগলকে জানানো হয় (Product schema), তাই সার্চে দাম দেখাতে পারে</li><li>✅ Facebook/WhatsApp শেয়ারে ছবি-টাইটেল (Open Graph)</li><li>✅ মোবাইল-ফ্রেন্ডলি আর দ্রুত লোড</li><li>✅ Canonical লিংক (একই পেজ দুই ঠিকানায় থাকলে গুগল একটাকেই ধরে)</li><li>✅ Breadcrumb আর দোকানের সার্চ বক্স (গুগলের ফলাফলে দেখাতে পারে); sitemap-এ পণ্যের ছবি</li><li>✅ পণ্যের লিংক বদলালে পুরোনো লিংক থেকে নতুনটায় নিয়ে যায় (301)</li><li>✅ কোনো পণ্য/ক্যাটাগরি/ব্র্যান্ড গুগল থেকে লুকাতে চাইলে তার এডিট পেজে "noindex" টিক দিন</li></ul></section></div></form></>;
  return ctx.page('SEO', body, 'seo');
}

// ---------------------------------------------------------------- coupons
async function coupons(ctx: AdminCtx) {
  if (ctx.method === 'POST') {
    const b = await ctx.body();
    try {
      // products typed as SKUs ("12, 15, LM7805") → their ids
      const skus = String(b.product_skus || '').split(/[,\s]+/).map((x) => x.trim()).filter(Boolean).slice(0, 300);
      const found = skus.length ? await db.q<Pick<ProductsRow, 'id' | 'sku'>>('SELECT id, sku FROM products WHERE lower(sku) = ANY($1::text[])', [skus.map((x) => x.toLowerCase())]) : [];
      const missing = skus.filter((x) => !found.some((f) => f.sku.toLowerCase() === x.toLowerCase()));
      if (missing.length) throw new Error(`এই SKU-এর পণ্য পাওয়া যায়নি: ${missing.slice(0, 8).join(', ')}`);
      b.product_ids = found.map((f) => f.id);
      const id = await content.saveCoupon({ ...b, active: b.id ? b.active : true });
      await ctx.log('coupon_save', 'coupon', id, str(b.code, 30));
    } catch (caught) { const e = caught as Caught; return ctx.fail('/admin/marketing/coupons' + (b.id ? `?edit=${int(b.id)}` : ''), e.message); }
    return ctx.back('/admin/marketing/coupons', 'saved');
  }
  const rows = await content.listCoupons();
  const editing = rows.find((r) => r.id === int(ctx.query.get('edit'))) || null;
  const cats = await $models_catalog.listCategories();
  const skuOf = new Map((await db.q<Pick<ProductsRow, 'id' | 'sku'>>('SELECT id, sku FROM products WHERE id = ANY($1::int[])', [[...new Set(rows.flatMap((r) => r.product_ids || []))]])).map((r) => [r.id, r.sku]));
  const catName = new Map(cats.map((x) => [x.id, x.name]));
  const c: Partial<CouponsRow> = editing || { type: 'percent', active: true }; // (a new coupon: an empty form)
  const body = <><h1>কুপন ও অফার</h1>{ui.flash(ctx.flash)}{' '}{ui.helpBox('অফার দেওয়ার উপায়', <><b>১. কুপন কোড:</b>{' '}কাস্টমার চেকআউটে কোড লিখলে ছাড় পাবে (নিচে তৈরি করুন)। ফেসবুক পোস্টে কোড দিয়ে দিন।<br /><b>২. পণ্যে ছাড়:</b>{' '}পণ্যের "আগের দাম" দিলে কেটে দেওয়া দাম আর "% ছাড়" ব্যাজ দেখাবে, আর পণ্যটি "অফার" পেজে চলে আসবে (<a href="/products?sort=offer" target="_blank">/products?sort=offer</a>)।<br /><b>৩. ফ্রি ডেলিভারি:</b>{' '}<a href="/admin/settings">সেটিংস</a>{' '}থেকে "এত টাকার বেশি কিনলে ডেলিভারি ফ্রি" সেট করুন, অথবা ফ্রি ডেলিভারি কুপন বানান।<br /><b>৪. ব্যানার/পপআপ:</b>{' '}<a href="/admin/design/banners">ব্যানার</a>{' '}থেকে অফারের ছবি দিন।</>)}<div className="two-col"><section className="panel table-wrap">{(rows.length ? <table className="table"><thead><tr><th>কোড</th><th>ছাড়</th><th>শর্ত</th><th>মেয়াদ</th><th className="num">ব্যবহার</th><th>চালু</th><th>কাজ</th></tr></thead><tbody>{jsxList(rows.map((r) => <tr className={r.active ? '' : 'row-off'}><td><b className="mono"><Val v={r.code} /></b>{(r.note ? <><br /><span className="small muted"><Val v={r.note} /></span></> : null)}</td><td>{(r.type === 'percent' ? `${bn(r.value)}%` : (r.type === 'fixed' ? money(r.value) : "ফ্রি ডেলিভারি"))}{(r.max_discount ? <><br /><span className="small muted">সর্বোচ্চ{' '}{money(r.max_discount)}</span></> : null)}</td><td className="small">{(r.min_order ? `কমপক্ষে ${money(r.min_order)}` : "—")}{(r.per_phone ? <><br />প্রতি নম্বরে{' '}{bn(r.per_phone)}{' '}বার</> : null)}{(r.first_order ? <><br />🆕 শুধু প্রথম অর্ডারে</> : null)}{' '}{((r.product_ids || []).length ? <><br />🎯 পণ্য:{' '}<Val v={(r.product_ids || []).map((x) => skuOf.get(x) || '#' + x).join(', ')} /></> : null)}{((r.category_ids || []).length ? <><br />🎯 ক্যাটাগরি:{' '}<Val v={(r.category_ids || []).map((x) => catName.get(x) || '#' + x).join(', ')} /></> : null)}</td><td className="small">{(r.starts_on || r.ends_on ? `${r.starts_on || '…'} → ${r.ends_on || '…'}` : "সবসময়")}</td><td className="num">{bn(r.used_count)}{(r.usage_limit ? ` / ${bn(r.usage_limit)}` : null)}</td><td>{ui.rowSwitch(`/admin/toggle/coupon/${r.id}`, r.active, 'বন্ধ করলে এই কুপন আর কাজ করবে না')}</td>{ui.rowActions({ edit: `/admin/marketing/coupons?edit=${r.id}`, del: `/admin/marketing/coupons/${r.id}/delete`, delConfirm: `কুপন ${r.code} মুছবেন? রিসাইকেল বিনে থাকবে।` })}</tr>))}</tbody></table> : <p className="muted">এখনো কোনো কুপন নেই।</p>)}</section><section className="panel"><h2>{(editing ? `কুপন ${c.code} এডিট` : "নতুন কুপন")}</h2><form method="post" action="/admin/marketing/coupons" className="form">{(editing ? <input type="hidden" name="id" defaultValue={attrValue(c.id)} /> : null)}{' '}{ui.field('কোড', ui.input('code', c.code || '', { required: true, maxlength: 30, placeholder: 'EID20', style: 'text-transform:uppercase' }), 'ইংরেজি অক্ষর/সংখ্যা')}<div className="field-row">{ui.field('ছাড়ের ধরন', ui.select('type', Object.entries(content.COUPON_TYPES), c.type))}{' '}{ui.field('পরিমাণ', ui.input('value', c.value ?? '', { type: 'number', min: 0 }), '% বা ৳ (ফ্রি ডেলিভারিতে লাগবে না)')}</div><div className="field-row">{ui.field('কমপক্ষে কত টাকার কেনাকাটায় (৳)', ui.input('min_order', c.min_order || 0, { type: 'number', min: 0 }))}{' '}{ui.field('সর্বোচ্চ ছাড় (৳)', ui.input('max_discount', c.max_discount || 0, { type: 'number', min: 0 }), '০ = কোনো সীমা নেই')}</div><div className="field-row">{ui.field('শুরু', ui.input('starts_on', c.starts_on || '', { type: 'date' }))}{' '}{ui.field('শেষ', ui.input('ends_on', c.ends_on || '', { type: 'date' }))}</div><div className="field-row">{ui.field('মোট কতবার ব্যবহার করা যাবে', ui.input('usage_limit', c.usage_limit || 0, { type: 'number', min: 0 }), '০ = যতবার খুশি')}{' '}{ui.field('এক নম্বর থেকে কতবার', ui.input('per_phone', c.per_phone || 0, { type: 'number', min: 0 }), '০ = যতবার খুশি')}</div><details className="help" open={!!((c.product_ids || []).length || (c.category_ids || []).length || c.first_order)}><summary>🎯 শুধু কিছু পণ্যে / প্রথম অর্ডারে (ঐচ্ছিক)</summary><div>{ui.field('শুধু এই পণ্যগুলোতে (SKU, কমা দিয়ে)', ui.input('product_skus', (c.product_ids || []).map((x) => skuOf.get(x)).filter(Boolean).join(', '), { maxlength: 2000, placeholder: 'যেমন: 12, 15, 101' }), 'খালি = পুরো কার্টে ছাড়। দিলে শুধু এই পণ্যগুলোর দামের উপর ছাড় হিসাব হবে।')}{' '}<label className="field"><span>শুধু এই ক্যাটাগরিগুলোতে (ভেতরের সাব-ক্যাটাগরিসহ)</span>{' '}<select name="category_ids[]" multiple size={6}>{jsxList(ui.catOpts(cats).map(([id, label]) => <option value={attrValue(id)} selected={!!((c.category_ids || []).includes(Number(id)))}><Val v={label} /></option>))}</select>{' '}<small>Ctrl (মোবাইলে চাপ দিয়ে) দিয়ে একাধিক বাছুন। কিছু না বাছলে সব ক্যাটাগরি।</small></label>{' '}{ui.check('first_order', !!c.first_order, 'শুধু নতুন কাস্টমারের প্রথম অর্ডারে (একই মোবাইল নম্বরে আগে কোনো অর্ডার থাকলে চলবে না)')}</div></details>{ui.field('নোট', ui.input('note', c.note || '', { maxlength: 200 }))}{' '}{(editing ? ui.check('active', c.active, 'চালু') : null)}{' '}<button className="btn">{(editing ? "সেভ করুন" : "কুপন তৈরি করুন")}</button>{' '}{(editing ? <>{' '}<a href="/admin/marketing/coupons">বাতিল</a></> : null)}</form></section></div></>;
  return ctx.page('কুপন ও অফার', body, 'coupons');
}
async function deleteCoupon(ctx: AdminCtx, m: RouteMatch) {
  await ctx.trash('coupon', int(m[1]));
  await ctx.log('coupon_delete', 'coupon', int(m[1]), '');
  return ctx.back('/admin/marketing/coupons', 'deleted');
}

// ---------------------------------------------------------------- social & live chat
const SOCIALS = [['social_facebook', 'Facebook পেজ'], ['social_instagram', 'Instagram'], ['social_youtube', 'YouTube'], ['social_tiktok', 'TikTok'],
  ['social_linkedin', 'LinkedIn'], ['social_x', 'X (Twitter)'], ['social_pinterest', 'Pinterest'], ['social_telegram', 'Telegram']];
async function social(ctx: AdminCtx) {
  const s = ctx.settings;
  if (ctx.method === 'POST') {
    const b = await ctx.body();
    for (const [k] of SOCIALS) {
      if (b[k] && !/^https?:\/\//i.test(String(b[k]).trim())) b[k] = 'https://' + String(b[k]).trim();
    }
    if (b.chat_messenger_page) b.chat_messenger_page = String(b.chat_messenger_page).trim().replace(/^https?:\/\/(www\.)?(m\.me|facebook\.com)\//i, '').replace(/\/.*$/, '');
    await saveKeys(ctx, [...SOCIALS.map((x) => x[0]), 'whatsapp', 'chat_messenger_page', 'chat_tawk_property', 'chat_tawk_widget', 'chat_script', 'chat_whatsapp_button'], b, { checkboxes: ['chat_whatsapp_button'] });
    await ctx.log('settings', 'marketing', null, 'সোশ্যাল ও চ্যাট');
    return ctx.back('/admin/marketing/social', 'saved');
  }
  const body = <><h1>সোশ্যাল মিডিয়া ও লাইভ চ্যাট</h1>{ui.flash(ctx.flash)}<form method="post" action="/admin/marketing/social" className="form"><div className="two-col"><section className="panel"><h2>সোশ্যাল মিডিয়া লিংক</h2><p className="muted small">যেগুলো দেবেন সেগুলোর আইকন সাইটের ফুটারে দেখাবে।</p><Val v={SOCIALS.map(([k, l]) => ui.field(l, ui.input(k, s[k], { type: 'url', placeholder: 'https://…' })))} /></section><section className="panel"><h2>লাইভ চ্যাট</h2>{ui.field('WhatsApp নম্বর', ui.input('whatsapp', s.whatsapp, { inputmode: 'tel', placeholder: '01XXXXXXXXX' }))}{' '}{ui.check('chat_whatsapp_button', s.chat_whatsapp_button === '1', 'সাইটের কোণায় সবুজ WhatsApp চ্যাট বাটন দেখাও')}{' '}{ui.field('Messenger (Facebook পেজের ইউজারনেম বা লিংক)', ui.input('chat_messenger_page', s.chat_messenger_page, { placeholder: 'shobmilbe বা https://m.me/shobmilbe' }), 'দিলে WhatsApp বাটনের পাশে Messenger বাটনও আসবে')}<h2>Tawk.to লাইভ চ্যাট (ফ্রি)</h2><p className="muted small">tawk.to তে ফ্রি অ্যাকাউন্ট খুলুন → Administration → Chat Widget → Direct Chat Link থেকে{' '}<code>tawk.to/chat/<b>PROPERTY_ID</b>/<b>WIDGET_ID</b></code>{' '}দুটো অংশ এখানে দিন। এরপর tawk.to অ্যাপ থেকে মোবাইলেই কাস্টমারের সাথে চ্যাট করতে পারবেন।</p><div className="field-row">{ui.field('Property ID', ui.input('chat_tawk_property', s.chat_tawk_property, { placeholder: '64f0a1b2c3d4e5f6a7b8c9d0' }))}{' '}{ui.field('Widget ID', ui.input('chat_tawk_widget', s.chat_tawk_widget || 'default'))}</div><h2>অন্য চ্যাট/থার্ড-পার্টি কোড</h2>{ui.field('স্ক্রিপ্ট (Crisp, Tidio, Zendesk ইত্যাদি) — 🔒 শুধু মালিক বদলাতে পারবেন', ui.textarea('chat_script', s.chat_script, { rows: 4, class: 'mono', placeholder: '<script>…</script>' }))}</section></div><div className="form-actions sticky-actions"><button className="btn btn-lg">সেভ করুন</button></div></form></>;
  return ctx.page('সোশ্যাল ও লাইভ চ্যাট', body, 'social');
}

export const routes = [
    { method: '*', path: '/admin/marketing/tracking', perm: 'marketing', handler: tracking },
    { method: '*', path: '/admin/marketing/seo', perm: 'marketing', handler: seo },
    { method: '*', path: '/admin/marketing/coupons', perm: 'marketing', handler: coupons },
    { method: 'POST', path: /^\/admin\/marketing\/coupons\/(\d+)\/delete$/, perm: 'marketing', handler: deleteCoupon },
    { method: '*', path: '/admin/marketing/social', perm: 'marketing', handler: social },
  ];
export { saveKeys, secretInput };
void raw;
