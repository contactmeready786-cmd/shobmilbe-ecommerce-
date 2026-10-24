// 🤖 AI স্টাফ (owner, 2026-10-24): a staff member who never sleeps. Every day (and whenever the owner asks) it goes
// through the whole shop the way a careful employee would — orders waiting, stock running out, products sold at a
// loss, product pages missing a picture / description / SEO, duplicates, hacking attempts, things that broke
// (courier, SMS, e-mail, site errors), what people search for but the shop doesn't have, what sells in other
// Bangladeshi shops and at what price, and which products to post on Facebook / Instagram today with a ready caption.
// It writes it all down as a report (Admin → সিস্টেম → 🤖 AI স্টাফ) and e-mails it to the owner through the shop's
// one Gmail (আমার নোটিফিকেশন — services/notify.ts sendEmail). With a free Google Gemini key (the one place for it is
// the AI স্টাফ page) it also writes like a person: a short, warm summary of what matters most and answers the
// owner's own questions about the shop. Without the key everything still works, in plain words.
// It only LOOKS and reports: it never changes a product, an order or a setting by itself.
import * as db from '../db';
import { bn, money } from '../util';
import * as notify from './notify';
import * as guard from './guard';
import * as seoscore from './seoscore';
import * as research from './research';
import * as dupes from '../models/duplicates';
import type { Settings } from '../types';

export type Level = 'bad' | 'warn' | 'good' | 'info';
export type Item = { level: Level; text: string; link?: string };
export type Section = { key: string; title: string; items: Item[] };
export type Report = { at: string; sections: Section[]; counts: Record<Level, number>; summary: string; ai: boolean };

const BASE = (s: Settings) => String(s.site_url || 'https://shobmilbe.com').replace(/\/+$/, '');
const n = (x: unknown) => Number(x) || 0;
const safe = async <T>(f: () => Promise<T>, fallback: T): Promise<T> => { try { return await f(); } catch (e) { console.error('aistaff', (e as Error).message); return fallback; } };

// ---------------------------------------------------------------- the checks (each one fails alone, never the report)
async function orders(): Promise<Section> {
  const items: Item[] = [];
  const y = await db.one<{ n: number; total: number }>(`SELECT count(*)::int AS n, coalesce(sum(total), 0)::float AS total FROM orders
    WHERE created_at >= date_trunc('day', now() AT TIME ZONE 'Asia/Dhaka') AT TIME ZONE 'Asia/Dhaka' - interval '1 day'
      AND created_at < date_trunc('day', now() AT TIME ZONE 'Asia/Dhaka') AT TIME ZONE 'Asia/Dhaka' AND status <> 'cancelled'`);
  items.push({ level: 'info', text: `গতকাল ${bn(n(y?.n))}টি অর্ডার, মোট ${money(n(y?.total))}` });
  const waiting = await db.one<{ n: number; oldest: Date | null }>(`SELECT count(*)::int AS n, min(created_at) AS oldest FROM orders WHERE status='pending' AND created_at < now() - interval '2 hours'`);
  if (n(waiting?.n)) items.push({ level: 'bad', text: `${bn(n(waiting!.n))}টি নতুন অর্ডার ২ ঘণ্টার বেশি কেউ দেখেনি — কাস্টমারকে ফোন করে কনফার্ম করুন`, link: '/admin/orders?status=pending' });
  const stuck = await db.one<{ n: number }>(`SELECT count(*)::int AS n FROM orders WHERE status IN ('confirmed','processing') AND updated_at < now() - interval '2 days'`);
  if (n(stuck?.n)) items.push({ level: 'warn', text: `${bn(n(stuck!.n))}টি অর্ডার কনফার্ম/প্যাকিং-এ ২ দিনের বেশি আটকে আছে — কুরিয়ারে দেওয়া হয়নি`, link: '/admin/orders?status=confirmed' });
  const hold = await db.one<{ n: number }>(`SELECT count(*)::int AS n FROM orders WHERE status='hold'`);
  if (n(hold?.n)) items.push({ level: 'warn', text: `${bn(n(hold!.n))}টি অর্ডার হোল্ডে আছে`, link: '/admin/orders?status=hold' });
  const ret = await db.one<{ n: number; all: number }>(`SELECT count(*) FILTER (WHERE status IN ('returned','cancelled'))::int AS n, count(*)::int AS all FROM orders WHERE created_at > now() - interval '7 days'`);
  if (n(ret?.all) >= 5 && n(ret!.n) / n(ret!.all) > 0.2) items.push({ level: 'warn', text: `গত ৭ দিনে ${bn(n(ret!.all))}টির মধ্যে ${bn(n(ret!.n))}টি বাতিল/ফেরত (${bn(Math.round((n(ret!.n) * 100) / n(ret!.all)))}%) — ফ্রড চেক ও OTP চালু আছে কি না দেখুন`, link: '/admin/fraud' });
  return { key: 'orders', title: '🛒 অর্ডার', items };
}

async function stock(): Promise<Section> {
  const items: Item[] = [];
  const low = await db.q<{ id: number; name: string; stock: number; sold: number }>(`SELECT p.id, p.name, p.stock,
      coalesce((SELECT sum(i.qty)::int FROM order_items i JOIN orders o ON o.id=i.order_id WHERE i.product_id=p.id AND o.created_at > now() - interval '30 days' AND o.status NOT IN ('cancelled','returned')), 0) AS sold
    FROM products p WHERE p.active AND p.parent_id IS NULL AND p.product_type <> 'bundle' AND p.stock <= greatest(p.low_stock, 0) AND NOT coalesce(p.preorder, false)
    ORDER BY sold DESC, p.stock LIMIT 200`);
  const selling = low.filter((p) => p.sold > 0);
  for (const p of selling.slice(0, 8)) items.push({ level: p.stock <= 0 ? 'bad' : 'warn', text: `${p.name} — স্টক ${bn(p.stock)}টি, গত ৩০ দিনে বিক্রি ${bn(p.sold)}টি — আবার কিনুন`, link: `/admin/products/${p.id}` });
  if (low.length > selling.length) items.push({ level: 'info', text: `আরও ${bn(low.length - selling.length)}টি পণ্যের স্টক কম/শেষ (এগুলো সম্প্রতি বিক্রি হয়নি)`, link: '/admin/inventory' });
  return { key: 'stock', title: '📦 স্টক', items };
}

async function money_(): Promise<Section> {
  const items: Item[] = [];
  const loss = await db.q<{ id: number; name: string; price: number; cost_price: number }>(`SELECT id, name, price, cost_price FROM products
    WHERE active AND parent_id IS NULL AND cost_price > 0 AND price < cost_price ORDER BY (cost_price - price) DESC LIMIT 10`);
  for (const p of loss) items.push({ level: 'bad', text: `${p.name} — বিক্রি ${money(p.price)}, কেনা ${money(p.cost_price)}: প্রতি পিসে লোকসান`, link: `/admin/products/${p.id}` });
  const noCost = await db.one<{ n: number }>(`SELECT count(*)::int AS n FROM products WHERE active AND parent_id IS NULL AND product_type <> 'bundle' AND coalesce(cost_price, 0) = 0`);
  if (n(noCost?.n)) items.push({ level: 'info', text: `${bn(n(noCost!.n))}টি পণ্যে কেনা দাম দেওয়া নেই — লাভ-ক্ষতির হিসাব ঠিক আসবে না`, link: '/admin/products' });
  return { key: 'money', title: '💰 দাম ও লাভ', items };
}

async function catalog(settings: Settings): Promise<Section> {
  const items: Item[] = [];
  const seo = await seoscore.seoProblems();
  const tally = new Map<string, number>();
  for (const p of seo.list) for (const [lvl, why] of p.why) if (lvl !== 'info') tally.set(why.split(' — ')[0].split(' (')[0], (tally.get(why.split(' — ')[0].split(' (')[0]) || 0) + 1);
  items.push({ level: seo.avg >= 80 ? 'good' : seo.avg >= 60 ? 'info' : 'warn', text: `পণ্যের পেজের গড় SEO নম্বর ${bn(seo.avg)}/১০০ — ${bn(seo.perfect)} / ${bn(seo.total)}টি পণ্য ৯০+`, link: '/admin/marketing/seo' });
  for (const [why, c] of [...tally].sort((a, b) => b[1] - a[1]).slice(0, 6)) items.push({ level: 'warn', text: `${bn(c)}টি পণ্যে: ${why}`, link: '/admin/marketing/seo' });
  const worst = [...seo.list].sort((a, b) => a.score - b.score).slice(0, 5);
  for (const p of worst) items.push({ level: 'info', text: `সবচেয়ে আগে ঠিক করুন: ${p.name} (SEO ${bn(p.score)}) — ${p.why.slice(0, 2).map((w) => w[1].split(' — ')[0]).join(', ')}`, link: `/admin/products/${p.id}` });
  const groups = await safe(() => dupes.scanCatalog(settings), []);
  const sure = groups.filter((g) => g.level === 'block').length;
  if (groups.length) items.push({ level: sure ? 'warn' : 'info', text: `ডুপ্লিকেট পণ্য: ${bn(sure)}টি প্রায় নিশ্চিত, ${bn(groups.length - sure)}টি সম্ভাব্য দল`, link: '/admin/products/duplicates' });
  const noBn = await db.one<{ n: number }>(`SELECT count(*)::int AS n FROM products WHERE active AND parent_id IS NULL AND coalesce(name_bn, '') = ''`);
  if (n(noBn?.n)) items.push({ level: 'info', text: `${bn(n(noBn!.n))}টি পণ্যের বাংলা নাম নেই`, link: '/admin/products' });
  const w = await db.one<{ n: number; p: number; waiting: number }>(`SELECT count(*) FILTER (WHERE status='applied')::int AS n, count(DISTINCT product_id) FILTER (WHERE status='applied')::int AS p,
      count(DISTINCT product_id) FILTER (WHERE status='proposed')::int AS waiting FROM ai_staff_edits WHERE created_at > now() - interval '24 hours'`).catch(() => null);
  if (w && (w.n || w.waiting)) items.push({ level: 'good', text: `✍️ গত ২৪ ঘণ্টায় আমি ${bn(w.p)}টি পণ্যের ${bn(w.n)}টি লেখা (নাম/SEO/বিবরণ) ইন্টারনেট দেখে নতুন করে লিখে বসিয়েছি${w.waiting ? `; ${bn(w.waiting)}টি পণ্যের লেখা আপনার ✅-এর অপেক্ষায়` : ''}`, link: '/admin/ai-staff#writer' });
  return { key: 'catalog', title: '📝 পণ্যের তথ্য ও SEO', items };
}

async function pictures(): Promise<Section> {
  const items: Item[] = [];
  const rows = await db.q<{ id: number; name: string; pics: number; wm: boolean; white: number; views: number }>(`SELECT p.id, p.name,
      (SELECT count(*)::int FROM media m WHERE m.owner_type='product' AND m.owner_id=p.id) AS pics, coalesce(p.src_wm, false) AS wm,
      (SELECT count(*)::int FROM media m WHERE m.owner_type='product' AND m.owner_id=p.id AND m.wb_from IS NOT NULL) AS white,
      coalesce((SELECT count(*)::int FROM page_views v WHERE v.product_id=p.id AND v.created_at > now() - interval '30 days'), 0) AS views
    FROM products p WHERE p.active AND p.parent_id IS NULL ORDER BY views DESC LIMIT 400`);
  const none = rows.filter((r) => r.pics === 0);
  const foreign = rows.filter((r) => r.wm);
  const single = rows.filter((r) => r.pics === 1 && r.views >= 10);
  for (const r of foreign.slice(0, 5)) items.push({ level: 'warn', text: `${r.name} — ছবিতে অন্য দোকানের লোগো/নম্বর আছে: "ব্যাকগ্রাউন্ড সাদা" দিয়ে পরিষ্কার করুন বা নিজের তোলা ছবি দিন`, link: '/admin/products/whiten' });
  for (const r of none.slice(0, 5)) items.push({ level: 'bad', text: `${r.name} — কোনো ছবি নেই: ছবি ছাড়া পণ্য প্রায় বিক্রি হয় না`, link: `/admin/products/${r.id}` });
  for (const r of single.slice(0, 5)) items.push({ level: 'info', text: `${r.name} — ${bn(r.views)} জন দেখেছে কিন্তু ছবি মাত্র ১টা: পেছন/পাশ/প্যাকেট আর হাতে ধরা একটা ছবি দিলে বিক্রি বাড়ে`, link: `/admin/products/${r.id}` });
  const notWhite = rows.filter((r) => r.pics > 0 && r.white === 0).length;
  if (notWhite) items.push({ level: 'info', text: `${bn(notWhite)}টি দেখা-বেশি পণ্যের ছবি এখনো সাদা ব্যাকগ্রাউন্ড করা হয়নি — এক চাপে অনলাইনে করা যায়`, link: '/admin/products/whiten' });
  return { key: 'pictures', title: '🖼️ ছবির পরামর্শ', items };
}

async function security(): Promise<Section> {
  const items: Item[] = [];
  const s = await guard.summary(1);
  if (s) {
    if (n(s.hack)) items.push({ level: n(s.hack) > 50 ? 'warn' : 'info', text: `গত ২৪ ঘণ্টায় ${bn(n(s.hack))} বার হ্যাক করার চেষ্টা (${bn(n(s.ips))}টি ঠিকানা থেকে) — সাইট সেগুলো আটকে দিয়েছে`, link: '/admin/security/threats' });
    if (n(s.logins)) items.push({ level: n(s.logins) >= 5 ? 'bad' : 'warn', text: `${bn(n(s.logins))} বার ভুল অ্যাডমিন পাসওয়ার্ড — আপনি না হলে পাসওয়ার্ড বদলান, ২-ধাপের লগইন চালু রাখুন`, link: '/admin/security' });
    if (!n(s.hack) && !n(s.logins)) items.push({ level: 'good', text: 'গত ২৪ ঘণ্টায় কোনো হ্যাকের চেষ্টা বা ভুল লগইন নেই' });
  }
  return { key: 'security', title: '🔐 নিরাপত্তা', items };
}

async function health(): Promise<Section> {
  const items: Item[] = [];
  const errs = await db.one<{ n: number; kinds: number }>(`SELECT coalesce(sum(n), 0)::int AS n, count(*)::int AS kinds FROM error_log WHERE last_at > now() - interval '24 hours'`);
  if (n(errs?.n)) items.push({ level: n(errs!.n) > 20 ? 'bad' : 'warn', text: `গত ২৪ ঘণ্টায় সাইটে ${bn(n(errs!.n))}টি ত্রুটি (${bn(n(errs!.kinds))} রকম)`, link: '/admin/health' });
  const fails = await db.q<{ service: string; n: number; last: string }>(`SELECT service, count(*)::int AS n, (array_agg(message ORDER BY created_at DESC))[1] AS last FROM integration_logs
    WHERE NOT ok AND created_at > now() - interval '24 hours' GROUP BY service ORDER BY n DESC LIMIT 6`);
  for (const f of fails) items.push({ level: 'warn', text: `${f.service}: ${bn(f.n)} বার কাজ হয়নি — শেষবার: ${String(f.last || '').slice(0, 120)}`, link: '/admin/integrations/status' });
  const backup = await db.one<{ at: Date | null }>(`SELECT max(created_at) AS at FROM integration_logs WHERE service='backup' AND ok`).catch(() => null);
  if (backup && backup.at && Date.now() - new Date(backup.at).getTime() > 3 * 864e5) items.push({ level: 'warn', text: 'শেষ ভালো ব্যাকআপ ৩ দিনের বেশি পুরোনো', link: '/admin/backup' });
  if (!items.length) items.push({ level: 'good', text: 'সাইট, কুরিয়ার, SMS, ইমেইল — গত ২৪ ঘণ্টায় কোনো সমস্যা ধরা পড়েনি' });
  return { key: 'health', title: '🩺 সাইটের স্বাস্থ্য', items };
}

async function market(): Promise<Section> {
  const items: Item[] = [];
  const d = await research.demand(14);
  const missing = d.searches.filter((s) => s.found === 0 && s.people >= 2).slice(0, 6);
  for (const s of missing) items.push({ level: 'warn', text: `"${s.term}" — ${bn(s.people)} জন খুঁজেছে, কিন্তু দোকানে নেই: এনে তুললে বিক্রি হতে পারে` });
  const hot = d.viewed.filter((p) => p.views >= 10 && p.sold === 0).slice(0, 4);
  for (const p of hot) items.push({ level: 'info', text: `${p.name} — ${bn(p.people)} জন দেখেছে, একটাও বিক্রি নেই: দাম/ছবি/বিবরণ দেখুন`, link: `/admin/products/${p.id}` });
  const win = await safe(() => research.winners({ limit: 30 }), [] as Awaited<ReturnType<typeof research.winners>>);
  const list = Array.isArray(win) ? win : [];
  for (const g of list.filter((x) => !x.ours && x.shops >= 2).slice(0, 5)) {
    items.push({ level: 'info', text: `বাজারে চলছে: ${g.lead.title} — ${bn(g.shops)}টি দোকানে ${money(g.min)}–${money(g.max)}${g.sell ? `; আপনি ${money(g.sell)}-এ বেচলে ভালো${g.buyMax ? ` (কিনুন ${money(g.buyMax)}-এর মধ্যে)` : ''}` : ''}`, link: '/admin/research' });
  }
  for (const g of list.filter((x) => x.ours && x.median && x.ours.price > x.median * 1.15).slice(0, 4)) {
    items.push({ level: 'warn', text: `${g.ours!.name}: আপনার দাম ${money(g.ours!.price)}, বাজারে মাঝামাঝি ${money(g.median!)} — দাম বেশি মনে হচ্ছে`, link: `/admin/products/${g.ours!.id}` });
  }
  const t = await safe(() => research.trends(), { at: 0, items: [] as research.Trend[] });
  if (t.items.length) items.push({ level: 'info', text: `আজ বাংলাদেশে গুগলে ট্রেন্ডিং: ${t.items.slice(0, 6).map((x) => x.title).join(', ')}` });
  return { key: 'market', title: '📈 বাজার ও ট্রেন্ড', items };
}

async function social(settings: Settings): Promise<Section> {
  const items: Item[] = [];
  const picks = await db.q<{ id: number; name: string; slug: string; price: number; old_price: number | null; views: number }>(`SELECT p.id, p.name, p.slug, p.price, p.old_price,
      coalesce((SELECT count(*)::int FROM page_views v WHERE v.product_id=p.id AND v.created_at > now() - interval '14 days'), 0) AS views
    FROM products p WHERE p.active AND p.parent_id IS NULL AND p.stock > 0 AND p.image_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM social_posts s WHERE s.product_id=p.id AND s.created_at > now() - interval '14 days')
    ORDER BY (p.old_price > p.price) DESC NULLS LAST, views DESC, p.created_at DESC LIMIT 3`).catch(() => []);
  for (const p of picks) {
    const off = n(p.old_price) > p.price ? ` (আগে ${money(n(p.old_price))})` : '';
    items.push({ level: 'info', text: `আজ পোস্ট করুন: ${p.name}\nক্যাপশন: ✅ ${p.name}\n💰 দাম মাত্র ${money(p.price)}${off}\n🚚 সারা বাংলাদেশে ক্যাশ অন ডেলিভারি\n🛒 অর্ডার: ${BASE(settings)}/p/${encodeURIComponent(p.slug)}\n#${String(settings.store_name || 'shobmilbe').replace(/\s+/g, '')} #electronics #Bangladesh`, link: `/admin/products/${p.id}` });
  }
  items.push({ level: 'info', text: 'সন্ধ্যা ৮টা–১০টা ফেসবুকে সবচেয়ে বেশি মানুষ থাকে; ছবি সাদা ব্যাকগ্রাউন্ডে, দাম ছবিতেই লেখা থাকলে বেশি সাড়া পায়। "অটো মার্কেটিং" চালু থাকলে প্রতিদিনের পোস্ট নিজে থেকেই যায়।', link: '/admin/marketing/auto' });
  return { key: 'social', title: '📣 আজকের সোশ্যাল মিডিয়া', items };
}

// ---------------------------------------------------------------- the report
export async function inspect(settings: Settings): Promise<Report> {
  const empty = (key: string, title: string): Section => ({ key, title, items: [{ level: 'info', text: 'এই অংশ এবার দেখা যায়নি (পরের বার আবার চেষ্টা করবে)' }] });
  const sections = [
    await safe(orders, empty('orders', '🛒 অর্ডার')),
    await safe(stock, empty('stock', '📦 স্টক')),
    await safe(money_, empty('money', '💰 দাম ও লাভ')),
    await safe(() => catalog(settings), empty('catalog', '📝 পণ্যের তথ্য ও SEO')),
    await safe(pictures, empty('pictures', '🖼️ ছবির পরামর্শ')),
    await safe(security, empty('security', '🔐 নিরাপত্তা')),
    await safe(health, empty('health', '🩺 সাইটের স্বাস্থ্য')),
    await safe(market, empty('market', '📈 বাজার ও ট্রেন্ড')),
    await safe(() => social(settings), empty('social', '📣 আজকের সোশ্যাল মিডিয়া')),
  ].filter((s) => s.items.length);
  const counts: Record<Level, number> = { bad: 0, warn: 0, good: 0, info: 0 };
  for (const s of sections) for (const i of s.items) counts[i.level]++;
  const summary = counts.bad ? `আজ ${bn(counts.bad)}টি জরুরি আর ${bn(counts.warn)}টি দেখার মতো বিষয় আছে।` : counts.warn ? `জরুরি কিছু নেই; ${bn(counts.warn)}টি বিষয় সময় করে দেখবেন।` : 'সব ঠিক আছে। 👍';
  return { at: new Date().toISOString(), sections, counts, summary, ai: false };
}

export function asText(r: Report, settings: Settings): string {
  const mark: Record<Level, string> = { bad: '🔴', warn: '🟡', good: '🟢', info: '•' };
  const lines = [`🤖 আপনার AI স্টাফের রিপোর্ট — ${new Date(r.at).toLocaleString('bn-BD', { timeZone: 'Asia/Dhaka' })}`, '', r.summary, ''];
  for (const s of r.sections) {
    lines.push(s.title);
    for (const i of s.items) lines.push(`${mark[i.level]} ${i.text}${i.link ? `\n   → ${BASE(settings)}${i.link}` : ''}`);
    lines.push('');
  }
  lines.push(`পুরো রিপোর্ট ও প্রশ্ন করতে: ${BASE(settings)}/admin/ai-staff`, '— আপনার AI স্টাফ (শুধু দেখে আর জানায়; নিজে কিছু বদলায় না)');
  return lines.join('\n');
}

// ---------------------------------------------------------------- 🧠 Gemini (optional, the owner's own free key)
const GEMINI = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';
const PERSONA = 'তুমি "সবমিলবে" নামের একটা বাংলাদেশি অনলাইন ইলেকট্রনিক্স দোকানের অভিজ্ঞ, বিশ্বস্ত স্টাফ। মালিকের সাথে আন্তরিক, সম্মান দিয়ে, সহজ বাংলায় কথা বলো — যেমন একজন মানুষ স্টাফ বলে। ' +
  'শুধু দেওয়া তথ্যের উপর ভিত্তি করে কথা বলো; যা জানো না তা বানিয়ে বলবে না, বরং বলবে "এটা আমি দেখতে পাচ্ছি না"। তুমি নিজে দোকানে কিছু বদলাতে পারো না — কী করতে হবে তা ধাপে ধাপে বলো।';
export async function gemini(key: string, prompt: string, timeoutMs = 25000): Promise<string> {
  const r = await fetch(GEMINI, {
    method: 'POST', signal: AbortSignal.timeout(timeoutMs),
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({ systemInstruction: { parts: [{ text: PERSONA }] }, contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: 0.5, maxOutputTokens: 2048 } }),
  });
  const j = (await r.json().catch(() => ({}))) as { candidates?: { content?: { parts?: { text?: string }[] } }[]; error?: { message?: string } };
  if (!r.ok) throw new Error(j.error?.message || `Gemini ${r.status}`);
  const text = (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('').trim();
  if (!text) throw new Error('Gemini কিছু লেখেনি');
  return text;
}
const facts = (r: Report) => r.sections.map((s) => `${s.title}\n${s.items.map((i) => `- [${i.level}] ${i.text.replace(/\n/g, ' | ')}`).join('\n')}`).join('\n\n');
async function humanSummary(r: Report, key: string): Promise<string> {
  return gemini(key, `আজকের দোকানের পরীক্ষার ফলাফল নিচে। মালিককে ছোট একটা চিঠি লেখো (১২০–২০০ শব্দ): শুরুতে সবচেয়ে জরুরি ৩টি কাজ ক্রমানুসারে, তারপর একটা ভালো খবর, শেষে আজকের জন্য একটা বিক্রি বাড়ানোর পরামর্শ। তালিকা পুনরাবৃত্তি করবে না।\n\n${facts(r)}`);
}
export async function ask(settings: Settings, question: string): Promise<string> {
  const key = String(settings.ai_gemini_key || '').trim();
  if (!key) throw new Error('প্রশ্নের উত্তর দিতে Gemini চাবি লাগবে (এই পেজের নিচে বসান — ফ্রি)।');
  const last = await latest();
  return gemini(key, `দোকানের সর্বশেষ অবস্থা:\n${last ? facts(last) : '(এখনো রিপোর্ট হয়নি)'}\n\nমালিকের প্রশ্ন: ${question.slice(0, 1500)}\n\nবাংলায়, পরিষ্কার ধাপে উত্তর দাও। দাম, সোশ্যাল মিডিয়া, SEO, বিক্রি বাড়ানো নিয়ে প্রশ্ন হলে বাংলাদেশের বাজার মাথায় রেখে বাস্তব পরামর্শ দাও।`, 40000);
}

// ---------------------------------------------------------------- run, keep, send
export async function latest(): Promise<Report | null> {
  const row = await db.one<{ report: Report }>('SELECT report FROM ai_staff_reports ORDER BY id DESC LIMIT 1');
  return row ? row.report : null;
}
export async function history(limit = 14): Promise<{ id: number; created_at: Date; summary: string }[]> {
  return db.q(`SELECT id, created_at, report->>'summary' AS summary FROM ai_staff_reports ORDER BY id DESC LIMIT $1`, [limit]);
}
export async function run(settings: Settings, { send = true }: { send?: boolean } = {}): Promise<Report> {
  const r = await inspect(settings);
  const key = String(settings.ai_gemini_key || '').trim();
  if (key) { try { r.summary = await humanSummary(r, key); r.ai = true; } catch (e) { console.error('aistaff gemini', (e as Error).message); } }
  await db.q('INSERT INTO ai_staff_reports(report) VALUES($1)', [JSON.stringify(r)]);
  await db.q(`DELETE FROM ai_staff_reports WHERE created_at < now() - interval '60 days'`);
  if (send && settings.ai_staff_email !== '0') {
    try {
      await notify.sendEmail(settings, `🤖 AI স্টাফ: ${r.counts.bad ? `${bn(r.counts.bad)}টি জরুরি` : 'দোকানের আজকের অবস্থা'}`, asText(r, settings));
      await db.logIntegration('aistaff', 'report', true, r.summary.slice(0, 200));
    } catch (e) { await db.logIntegration('aistaff', 'report', false, (e as Error).message); }
  }
  return r;
}
/** once a day at the owner's hour (Dhaka time), called from the hourly scheduled job (lib/api/files.ts researchTick) */
export async function tick(settings: Settings): Promise<void> {
  if (settings.ai_staff_on === '0') return;
  const hour = Math.min(23, Math.max(0, Number(settings.ai_staff_hour ?? 9) || 0));
  const now = new Date(Date.now() + 6 * 3600e3); // Dhaka
  if (now.getUTCHours() < hour) return;
  const done = await db.one('SELECT 1 FROM ai_staff_reports WHERE created_at > $1', [new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - 6 * 3600e3)]);
  if (done) return;
  await run(settings);
}
