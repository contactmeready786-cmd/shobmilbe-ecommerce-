// 🤖 AI স্টাফ (owner, 2026-10-24) — Admin → সিস্টেম → AI স্টাফ: the latest report of the shop's AI staff member
// (lib/services/aistaff.ts), "check now", when it reports and to whom, the free Gemini key that lets it write and answer
// like a person (tested before it is saved), and a box to ask it anything about the shop. Owner only.
import { Val, attrValue, jsxList } from '../react/html';
import { bn, str, int, fmtDate } from '../util';
import * as db from '../db';
import * as ui from './ui';
import * as staff from '../services/aistaff';
import * as writer from '../services/aiwriter';
import type { AdminCtx } from '../types';

const BASE = '/admin/ai-staff';
const MARK: Record<staff.Level, string> = { bad: '🔴', warn: '🟡', good: '🟢', info: '•' };

function ReportView({ r }: { r: staff.Report }) {
  return <>
    <section className="panel"><h2>{(r.ai ? '🧠 ' : '')}আজকের কথা <small className="muted">{fmtDate(r.at)}</small></h2>
      <p className="ai-say"><Val v={r.summary} /></p>
      <p className="small muted">🔴 জরুরি {bn(r.counts.bad)} · 🟡 দেখার মতো {bn(r.counts.warn)} · 🟢 ঠিক আছে {bn(r.counts.good)}</p></section>
    {jsxList(r.sections.map((s) => <section className="panel"><h2><Val v={s.title} /></h2><ul className="ai-list">{jsxList(s.items.map((i) => <li className={`ai-${i.level}`}><span aria-hidden="true">{MARK[i.level]}</span>{' '}<span className="ai-text"><Val v={i.text} /></span>{(i.link ? <>{' '}<a className="small" href={attrValue(i.link)}>দেখুন →</a></> : null)}</li>))}</ul></section>))}
  </>;
}

async function page(ctx: AdminCtx) {
  const [r, hist, edits] = await Promise.all([staff.latest(), staff.history(10), writer.recent(30)]);
  const s = ctx.settings;
  // the last question and its answer (kept in one setting — an answer is too long for an address)
  const qa = db.jsonSetting<{ q?: string; a?: string }>(s, 'ai_staff_last_qa', {});
  const answer = String(qa.a || ''), q = String(qa.q || '');
  const body = <><div className="title-row"><h1>🤖 AI স্টাফ</h1></div>{ui.flash(ctx.flash)}
    {ui.helpBox('এই স্টাফ কী করে', <ul>
      <li>প্রতিদিন আপনার ঠিক করা সময়ে পুরো দোকান ঘুরে দেখে — নতুন অর্ডার পড়ে আছে কি না, কোন পণ্যের স্টক শেষ হচ্ছে, কোনটা লোকসানে বিক্রি হচ্ছে, কোন পণ্যের ছবি/বিবরণ/SEO কম, ডুপ্লিকেট, হ্যাকের চেষ্টা, কুরিয়ার/SMS/ইমেইল কাজ করছে কি না।</li>
      <li>বাজার দেখে: মানুষ কী খুঁজছে কিন্তু দোকানে নেই, অন্য দোকানে কোন পণ্য কত দামে চলছে, কোন দামে বেচলে ভালো, গুগলে কী ট্রেন্ডিং।</li>
      <li>আজ ফেসবুক/ইনস্টাগ্রামে কোন পণ্য দেবেন — তৈরি ক্যাপশনসহ।</li>
      <li>রিপোর্ট আপনার ইমেইলে পাঠায় (আমার নোটিফিকেশন-এর Gmail দিয়ে)। শুধু দেখে আর জানায় — নিজে কিছু বদলায় না।</li>
      <li>নিচে একটা ফ্রি Google Gemini চাবি দিলে মানুষের মতো গুছিয়ে লেখে আর আপনার যেকোনো প্রশ্নের উত্তর দেয়।</li></ul>)}
    <div className="toolbar"><form method="post" action={`${BASE}/run`}><button className="btn">▶ এখনই পুরো দোকান চেক করুন</button></form>{' '}<span className="small muted">১০–৪০ সেকেন্ড লাগতে পারে; রিপোর্ট ইমেইলেও যাবে।</span></div>
    {(r ? <ReportView r={r} /> : <p className="muted">এখনো কোনো রিপোর্ট হয়নি — উপরের বোতাম চাপুন।</p>)}
    <section className="panel" id="writer"><h2>✍️ পণ্যের লেখা — ইন্টারনেট দেখে নতুন করে</h2>
      <p className="small">প্রতিদিন কাজের সময়ে (বাংলাদেশ সময় {bn(int(s.ai_work_from ?? 9))}টা–{bn(int(s.ai_work_to ?? 18))}টা) স্টাফ সবচেয়ে দুর্বল পণ্যের পেজগুলো একটা একটা করে নেয়, গুগলে পণ্যটা খুঁজে দেখে, তারপর নাম, SEO টাইটেল, মেটা বিবরণ, কিওয়ার্ড, ছোট আর বিস্তারিত বিবরণ নতুন করে লেখে। মডেল/মাপ নম্বর কখনো বাদ যায় না; লিংক, ফোন নম্বর, অন্য দোকানের নাম বসায় না। প্রতিটা বদল লেখা থাকে — "↩️ ফেরত" চাপলে আগের লেখা ফিরে আসে।</p>
      {(s.ai_gemini_key ? null : <p className="small warn">এর জন্য নিচে Gemini চাবি বসাতে হবে (ফ্রি)।</p>)}
      <form method="post" action={`${BASE}/settings`} className="form-grid"><input type="hidden" name="form" defaultValue="writer" />
        {ui.switchRow('ai_write_on', s.ai_write_on !== '0', 'নিজে থেকে পণ্যের লেখা উন্নত করবে', 'কাজের সময়ে, দিনে নিচের সংখ্যা পর্যন্ত')}
        {ui.switchRow('ai_write_auto', s.ai_write_auto !== '0', 'নিজেই বসিয়ে দেবে', 'বন্ধ করলে নতুন লেখা এখানে আপনার ✅-এর অপেক্ষায় থাকবে')}
        {ui.field('দিনে সর্বোচ্চ কয়টা পণ্য', ui.input('ai_write_daily', s.ai_write_daily || '30', { type: 'number', min: 1, max: 100 }))}
        {ui.field('কাজ শুরু (টা)', ui.select('ai_work_from', Array.from({ length: 24 }, (_, h) => [String(h), `${bn(h)}:০০`]), String(s.ai_work_from ?? '9')))}
        {ui.field('কাজ শেষ (টা)', ui.select('ai_work_to', Array.from({ length: 24 }, (_, h) => [String(h + 1), `${bn(h + 1)}:০০`]), String(s.ai_work_to ?? '18')))}
        <button className="btn btn-sm">💾 সেভ করুন</button></form>
      {(s.ai_gemini_key ? <form method="post" action={`${BASE}/write`}><button className="btn btn-sm">▶ এখনই একটা পণ্য নতুন করে লিখুন</button></form> : null)}
      {(edits.length ? <div className="ai-edits">{jsxList(edits.map((e) => <details className={`ai-edit ai-${e.status}`}><summary><b><Val v={e.name} /></b>{' '}<span className="small muted">{fmtDate(e.at)} · {(e.status === 'applied' ? '✅ বসানো হয়েছে' : e.status === 'proposed' ? '⏳ আপনার ✅-এর অপেক্ষায়' : e.status === 'undone' ? '↩️ ফেরত আনা হয়েছে' : '❌ বাদ')}</span></summary>
        {jsxList(e.fields.map((f) => <div className="ai-field"><p className="small"><b><Val v={writer.FIELD_LABEL[f.field] || f.field} /></b></p><p className="small muted ai-old">আগে: <Val v={f.old_value || '(খালি)'} /></p><p className="small ai-new">এখন: <Val v={f.new_value} /></p></div>))}
        <div className="toolbar"><a className="btn btn-sm btn-ghost" href={`/admin/products/${attrValue(e.product_id)}`}>✏️ পণ্য খুলুন</a>{(e.status === 'applied' ? <form method="post" action={`${BASE}/undo`}><input type="hidden" name="id" defaultValue={attrValue(e.product_id)} /><button className="btn btn-sm btn-ghost">↩️ আগের লেখা ফেরত</button></form> : null)}{(e.status === 'proposed' ? <><form method="post" action={`${BASE}/decide`}><input type="hidden" name="id" defaultValue={attrValue(e.product_id)} /><input type="hidden" name="ok" defaultValue="1" /><button className="btn btn-sm">✅ বসান</button></form><form method="post" action={`${BASE}/decide`}><input type="hidden" name="id" defaultValue={attrValue(e.product_id)} /><button className="btn btn-sm btn-ghost">❌ বাদ</button></form></> : null)}</div>
      </details>))}</div> : <p className="small muted">এখনো কোনো পণ্যের লেখা বদলানো হয়নি।</p>)}
    </section>
    <section className="panel" id="ask"><h2>💬 স্টাফকে জিজ্ঞেস করুন</h2>
      {(s.ai_gemini_key ? <form method="post" action={`${BASE}/ask`}>{ui.textarea('question', '', { rows: 3, maxlength: 1500, placeholder: 'যেমন: এই সপ্তাহে কোন পণ্যের দাম কমালে বিক্রি বাড়বে? ফেসবুকে আজ কী পোস্ট দেব?', required: true })}<button className="btn btn-sm">জিজ্ঞেস করুন</button></form> : <p className="small muted">প্রশ্নের উত্তর পেতে নিচে Gemini চাবি বসান (ফ্রি)।</p>)}
      {(answer ? <div className="ai-answer">{(q ? <p className="small muted">প্রশ্ন: <Val v={q} /></p> : null)}<p className="ai-say"><Val v={answer} /></p></div> : null)}
    </section>
    <section className="panel" id="settings"><h2>⚙️ কখন, কাকে</h2>
      <form method="post" action={`${BASE}/settings`} className="form-grid">
        {ui.switchRow('ai_staff_on', s.ai_staff_on !== '0', 'প্রতিদিন নিজে থেকে চেক করবে', 'বন্ধ করলে শুধু "এখনই চেক করুন" চাপলে চলবে')}
        {ui.field('প্রতিদিন কয়টায় (বাংলাদেশ সময়)', ui.select('ai_staff_hour', Array.from({ length: 24 }, (_, h) => [String(h), `${bn(h)}:০০`]), String(s.ai_staff_hour ?? '9')))}
        {ui.switchRow('ai_staff_email', s.ai_staff_email !== '0', 'রিপোর্ট ইমেইলে পাঠাও', 'আমার নোটিফিকেশন-এ দেওয়া Gmail ঠিকানায়')}
        <button className="btn btn-sm">💾 সেভ করুন</button></form>
      {(s.notify_email ? null : <p className="small warn">ইমেইল পাঠাতে আগে <a href="/admin/notify">আমার নোটিফিকেশন</a>-এ Gmail সেট করুন।</p>)}
    </section>
    <section className="panel" id="gemini"><h2>🧠 মানুষের মতো লেখা — Google Gemini চাবি {(s.ai_gemini_key ? <span className="pill pill-green">চালু ✅</span> : <span className="pill pill-grey">বন্ধ</span>)}</h2>
      <ol className="steps small"><li>Google-এ লগইন করে খুলুন: <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com/apikey</a></li><li><b>Create API key</b> চাপুন (প্রজেক্ট চাইলে যেকোনো একটা বাছুন) — ফ্রি, কার্ড লাগে না।</li><li>চাবির পাশের 📋 চিহ্ন চেপে কপি করে এখানে বসান — সেভের আগে পরীক্ষা হয়।</li></ol>
      <form method="post" action={`${BASE}/key`} className="toolbar">{ui.input('key', '', { type: 'password', autocomplete: 'off', placeholder: s.ai_gemini_key ? 'সেভ করা আছে (বদলাতে নতুন দিন)' : 'চাবিটা এখানে পেস্ট করুন', 'aria-label': 'Gemini চাবি' })}{' '}<button className="btn btn-sm">পরীক্ষা করে সেভ করুন</button></form>
      {(s.ai_gemini_key ? <form method="post" action={`${BASE}/key`} data-confirm="Gemini চাবি মুছবেন? স্টাফ তখন সাধারণ ভাষায় রিপোর্ট দেবে, প্রশ্নের উত্তর দেবে না।"><input type="hidden" name="action" defaultValue="clear" /><button className="btn btn-sm btn-ghost">চাবি মুছুন</button></form> : null)}
      <p className="small muted">আপনার দোকানের সারসংক্ষেপ (সংখ্যা ও পণ্যের নাম — কাস্টমারের নাম/ফোন নয়) Google-এর কাছে যায় লেখার জন্য।</p>
    </section>
    {(hist.length ? <section className="panel"><h2>🗂️ আগের রিপোর্ট</h2><ul className="small">{jsxList(hist.map((h) => <li>{fmtDate(h.created_at)} — <Val v={String(h.summary || '').slice(0, 160)} /></li>))}</ul></section> : null)}
  </>;
  return ctx.page('AI স্টাফ', body, 'ai-staff');
}

async function runNow(ctx: AdminCtx) {
  try {
    const r = await staff.run(ctx.settings);
    await ctx.log('settings', 'setting', 0, 'AI স্টাফ: এখনই চেক');
    return ctx.redirect(`${BASE}?info=${encodeURIComponent(`✅ চেক শেষ — ${r.summary.slice(0, 120)}`)}`);
  } catch (e) { return ctx.redirect(`${BASE}?info=${encodeURIComponent(`চেক করা যায়নি: ${(e as Error).message}`)}`); }
}
async function askNow(ctx: AdminCtx) {
  const b = await ctx.body();
  const q = str(b.question, 1500).trim();
  if (!q) return ctx.redirect(BASE + '#ask');
  let a: string;
  try { a = await staff.ask(ctx.settings, q); } catch (e) { a = `⚠️ ${(e as Error).message}`; }
  await db.setSetting('ai_staff_last_qa', JSON.stringify({ q, a: a.slice(0, 8000), at: new Date().toISOString() }));
  await ctx.reloadSettings();
  return ctx.redirect(`${BASE}#ask`);
}
async function saveSettings(ctx: AdminCtx) {
  const b = await ctx.body();
  if (b.form === 'writer') {
    await db.setSetting('ai_write_on', b.ai_write_on ? '1' : '0');
    await db.setSetting('ai_write_auto', b.ai_write_auto ? '1' : '0');
    await db.setSetting('ai_write_daily', String(Math.min(100, Math.max(1, int(b.ai_write_daily) || 30))));
    const from = Math.min(23, Math.max(0, int(b.ai_work_from))), to = Math.min(24, Math.max(from + 1, int(b.ai_work_to) || 18));
    await db.setSetting('ai_work_from', String(from));
    await db.setSetting('ai_work_to', String(to));
    await ctx.reloadSettings();
    return ctx.redirect(`${BASE}?msg=saved#writer`);
  }
  await db.setSetting('ai_staff_on', b.ai_staff_on ? '1' : '0');
  await db.setSetting('ai_staff_email', b.ai_staff_email ? '1' : '0');
  await db.setSetting('ai_staff_hour', String(Math.min(23, Math.max(0, int(b.ai_staff_hour)))));
  await ctx.reloadSettings();
  return ctx.back(BASE, 'saved');
}
// the free Gemini key: tested with one tiny question before it is saved (a wrong key never replaces a working one)
async function saveKey(ctx: AdminCtx) {
  const b = await ctx.body();
  const back = (m: string) => ctx.redirect(`${BASE}?info=${encodeURIComponent(m)}#gemini`);
  if (b.action === 'clear') { await db.setSetting('ai_gemini_key', ''); await ctx.reloadSettings(); return back('চাবি মুছে ফেলা হয়েছে।'); }
  // whatever the phone pasted around it (spaces, line breaks, quotes) goes; the real test is asking Gemini itself
  // (Google's newer keys don't all start with "AIza" any more)
  const key = str(b.key, 400).replace(/[\s"'`<>]/g, '');
  if (!/^[0-9A-Za-z._-]{20,300}$/.test(key)) return back('চাবিটা পুরোটা কপি হয়নি মনে হচ্ছে — Google-এর পাতায় চাবির পাশের 📋 চিহ্ন চেপে আবার কপি করে দিন।');
  try { await staff.keyWorks(key); } catch (e) { return back(`চাবিটা কাজ করেনি: ${(e as Error).message}। আগের অবস্থা যেমন ছিল তেমনই আছে।`); }
  await db.setSetting('ai_gemini_key', key);
  await ctx.reloadSettings();
  await ctx.log('settings', 'setting', 0, 'AI স্টাফ — Gemini চাবি সেভ (পরীক্ষা করে)');
  return back('✅ চাবি কাজ করছে — এখন স্টাফ মানুষের মতো লিখবে আর প্রশ্নের উত্তর দেবে।');
}

async function writeNow(ctx: AdminCtx) {
  let msg: string;
  try {
    const r = await writer.improve(ctx.settings, { limit: 1 });
    msg = r.errors.length ? `হয়নি: ${r.errors[0]}` : r.products ? `✅ ${r.fields}টি লেখা নতুন করে ${ctx.settings.ai_write_auto !== '0' ? 'বসানো হয়েছে' : 'তৈরি — নিচে দেখে ✅ দিন'}` : 'এখন নতুন করে লেখার মতো পণ্য পাওয়া যায়নি।';
  } catch (e) { msg = (e as Error).message; }
  return ctx.redirect(`${BASE}?info=${encodeURIComponent(msg)}#writer`);
}
async function undoNow(ctx: AdminCtx) {
  const b = await ctx.body();
  const n = await writer.undo(int(b.id));
  await ctx.log('product_save', 'product', int(b.id), 'AI স্টাফের লেখা ফেরত');
  return ctx.redirect(`${BASE}?info=${encodeURIComponent(`↩️ ${n}টি লেখা আগের মতো করা হয়েছে`)}#writer`);
}
async function decideNow(ctx: AdminCtx) {
  const b = await ctx.body();
  const ok = b.ok === '1';
  await writer.decide(int(b.id), ok);
  if (ok) await ctx.log('product_save', 'product', int(b.id), 'AI স্টাফের লেখা বসানো');
  return ctx.redirect(`${BASE}?info=${encodeURIComponent(ok ? '✅ বসানো হয়েছে' : '❌ বাদ দেওয়া হয়েছে')}#writer`);
}

export const routes = [
  { method: 'POST', path: `${BASE}/write`, perm: 'owner', handler: writeNow },
  { method: 'POST', path: `${BASE}/undo`, perm: 'owner', handler: undoNow },
  { method: 'POST', path: `${BASE}/decide`, perm: 'owner', handler: decideNow },
  { method: 'GET', path: BASE, perm: 'owner', handler: page },
  { method: 'POST', path: `${BASE}/run`, perm: 'owner', handler: runNow },
  { method: 'POST', path: `${BASE}/ask`, perm: 'owner', handler: askNow },
  { method: 'POST', path: `${BASE}/settings`, perm: 'owner', handler: saveSettings },
  { method: 'POST', path: `${BASE}/key`, perm: 'owner', handler: saveKey },
];
