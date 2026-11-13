// 📝 অটো বিবরণ from other shops (owner, 2026-11-13): a product with no description of its own gets the real product
// information another Bangladeshi shop wrote for the SAME product — what it is, features, specifications, pinout —
// and nothing of that shop: no shop name, domain, link, phone, price, delivery, warranty, "order now" talk.
// Runs a few products at a time from the round-the-clock wake-up; robots.txt of every shop is respected.
// Kept in products.auto_desc (never in the owner's own description box); the owner's own text always wins.
import { safeFetch } from './safefetch';
import * as research from './research';
import * as db from '../db';
import { cleanName } from './seo';
import type { Settings } from '../types';

const PER_RUN = 2;
const MAX_CHARS = 1800;

// lines that are about the other shop or the sale, not about the product
const NOISE = [
  /https?:\/\/|www\.|\.com\b|\.bd\b|\.net\b|\.org\b|@/i,
  /\+?880|\b01[3-9]\d{2}[-\s]?\d{6}\b|hotline|helpline|whats\s*app|imo\b|call\s*(us|now)|ফোন|কল কর|হটলাইন|যোগাযোগ/i,
  /deliver|shipping|courier|cash on|\bcod\b|ডেলিভারি|কুরিয়ার|হোম ডেলিভারি|ক্যাশ অন|পৌঁছে/i,
  /warrant|guarantee|replacement|return|refund|ওয়ারেন্টি|গ্যারান্টি|রিটার্ন|ফেরত|রিপ্লেস/i,
  /price|৳|\btk\.?\b|taka|টাকা|দাম|মূল্য|discount|offer|ছাড়|অফার/i,
  /\border\b|buy now|add to cart|in stock|out of stock|available|অর্ডার|কিনুন|স্টক|পাওয়া যাচ্ছে|সংগ্রহ করুন/i,
  /\bshop\b|\bstore\b|our (company|website|team)|we (are|have|provide|sell)|শপ|দোকান|আমাদের|আমরা/i,
  /disclaimer|note:|নোট:|বিঃদ্রঃ|বি\.দ্র|picture|image may|ছবি/i,
];

const decode = (s: string) => s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&#0?39;|&#8217;|&rsquo;/g, "'").replace(/&#8211;|&ndash;/g, '–').replace(/&#8212;|&mdash;/g, '—').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));

// HTML → plain lines, keeping list items and headings as their own lines
function toLines(html: string): string[] {
  const t = html.replace(/<(script|style|noscript|iframe|svg|form|button|table)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/?(p|div|br|li|ul|ol|h[1-6]|tr|section)\b[^>]*>/gi, '\n').replace(/<[^>]+>/g, ' ');
  return decode(t).split('\n').map((l) => l.replace(/\s+/g, ' ').replace(/^[\s•●▪◦*\-–]+/, '').trim()).filter((l) => l.length >= 3);
}

// the product's own description on the other shop's page
function descriptionOf(html: string): string[] {
  // 1. WooCommerce / common themes: the description tab
  const tab = html.match(/<div[^>]+(?:id="tab-description"|class="[^"]*(?:woocommerce-Tabs-panel--description|product-description|product__description|description-content|tab-content-description)[^"]*")[^>]*>([\s\S]{40,60000}?)<\/div>\s*(?:<div[^>]+(?:id="tab-|class="[^"]*woocommerce-Tabs-panel)|<\/div>\s*<\/div>)/i);
  if (tab) { const l = toLines(tab[1]); if (l.join(' ').length > 80) return l; }
  // 2. the product data shops publish for Google (JSON-LD)
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const j = JSON.parse(m[1]);
      const all = ([] as unknown[]).concat(j, (j && j['@graph']) || []);
      for (const x of all) {
        const o = x as { '@type'?: unknown; description?: unknown };
        if (o && /product/i.test(String(o['@type'])) && typeof o.description === 'string' && o.description.length > 80) return toLines(o.description.replace(/\\n/g, '\n').replace(/\n/g, '<br>'));
      }
    } catch (_) { /* someone else's JSON */ }
  }
  return [];
}

// keep only the lines about the product itself
function clean(lines: string[], shopNames: string[]): string {
  const names = shopNames.map((n) => n.toLowerCase()).filter((n) => n.length >= 3);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const l0 of lines) {
    const l = l0.slice(0, 400);
    const low = l.toLowerCase();
    if (NOISE.some((r) => r.test(l))) continue;
    if (names.some((n) => low.includes(n))) continue;
    if (/^(description|product description|বিবরণ|details|specification|specifications|features)\s*:?$/i.test(l)) { if (out.length) out.push(''); out.push(`### ${l.replace(/:$/, '')}`); continue; }
    const key = low.replace(/\W+/g, '');
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(/^[^.!?।]{2,60}:\s*\S/.test(l) || l.length < 90 ? `- ${l}` : l);
    if (out.join('\n').length > MAX_CHARS) break;
  }
  const text = out.join('\n').replace(/(^|\n)### [^\n]*\n(?=### |\s*$)/g, '$1').trim();
  return text.replace(/\n{3,}/g, '\n\n').slice(0, MAX_CHARS + 200);
}

// One product: find the same product in other shops, read its page, keep the clean information.
async function forProduct(p: { id: number; name: string }): Promise<{ text: string; from: string } | null> {
  const name = cleanName(p.name);
  const mine = research.prepFull(name);
  // what the shops' sitemaps already told us first; only if nothing fits, ask the shops live
  let found = await research.searchMarket(name, { live: false }).catch(() => null);
  const fits = (f: typeof found) => !!f && f.items.some((it) => research.sameProduct(mine, research.prepFull(it.title)) >= 0.8);
  if (!fits(found)) found = await research.searchMarket(name, { live: true, budgetMs: 12000 }).catch(() => null);
  if (!found) return null;
  const sources = await db.q<{ name: string }>(`SELECT name FROM research_sources`).catch(() => [] as { name: string }[]);
  const shops = [...found.shops.map((s) => s.name), ...sources.map((s) => s.name)];
  const cands = found.items
    .map((it) => ({ it, same: research.sameProduct(mine, research.prepFull(it.title)) }))
    .filter((c) => c.same >= 0.8 && /^https?:\/\//.test(c.it.url))
    .sort((a, b) => b.same - a.same)
    .slice(0, 4);
  for (const { it } of cands) {
    try {
      if (!(await research.allowed(it.url))) continue;
      const r = await safeFetch(it.url, { maxBytes: 3 * 1024 * 1024, timeoutMs: 12000, accept: 'text/html' });
      if (!r.ok) continue;
      const host = new URL(it.url).hostname.replace(/^www\./, '');
      const text = clean(descriptionOf(r.body.toString('utf8')), [...shops, host, host.split('.')[0], it.shop || '']);
      if (text.replace(/[#\-\s]/g, '').length >= 120) return { text, from: host };
    } catch (_) { /* next shop */ }
  }
  return null;
}

// The wake-up: a few products with no own text and no auto text yet (or one older than 60 days), newest first.
async function sweep(settings: Settings, max = PER_RUN) {
  if (settings.autoseo_desc === '0' || settings.autoseo_fetch === '0') return { done: 0 };
  const rows = await db.q<{ id: number; name: string }>(`SELECT id, name FROM products
    WHERE active AND parent_id IS NULL AND length(coalesce(description,'') || coalesce(short_description,'')) < 150
      AND (auto_desc_at IS NULL OR auto_desc_at < now() - interval '60 days')
    ORDER BY auto_desc_at NULLS FIRST, id DESC LIMIT $1`, [max]);
  let done = 0;
  for (const p of rows) {
    const r = await forProduct(p).catch(() => null);
    await db.q(`UPDATE products SET auto_desc=$2, auto_desc_src=$3, auto_desc_at=now() WHERE id=$1`, [p.id, r ? r.text : '', r ? r.from : '']);
    if (r) done++;
  }
  return { done, tried: rows.length };
}

export { sweep, forProduct, clean, descriptionOf, toLines };
