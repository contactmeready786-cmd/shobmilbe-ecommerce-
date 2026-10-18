// 📈 SEO score of every product (Admin → মার্কেটিং → SEO, and the daily অটো SEO score): what Google needs to rank a
// product page and how much each part is worth. Kept apart from the admin pages so the shop's services can use it.
import * as db from '../db';
import * as $services_seo from './seo';
import type { Loose } from '../types';

const SEO_WEIGHTS = { image: 20, text: 20, textLong: 10, model: 12, specs: 10, category: 10, gallery: 6, brand: 4, title: 4, reviews: 4 };
function seoScore(p: db.pg.DbRow, seo: typeof $services_seo) {
  const textLen = String(p.description || '').trim().length + String(p.short_description || '').trim().length;
  const W = SEO_WEIGHTS;
  let n = 0;
  if (p.image_id) n += W.image;
  if (p.pics > 1) n += W.gallery;
  if (textLen > 0 || p.auto_desc) n += W.text; // 🤖 the auto description counts as text (the long-text bonus needs the owner's own)
  if (textLen >= 200) n += W.textLong;
  if (String(p.model || '').trim()) n += W.model;
  if (Array.isArray(p.specs) && p.specs.filter((r: Loose) => Array.isArray(r) && r[0] && r[1]).length >= 2) n += W.specs;
  if (p.category_id) n += W.category;
  if (String(p.brand || '').trim()) n += W.brand;
  const t = seo.productTitle(p);
  if (t.length >= 15 && (!p.seo_title || p.seo_title.length <= 65) && !seo.needsNameFix(p.name)) n += W.title;
  if (p.rating_count > 0) n += W.reviews;
  return Math.min(100, n);
}
async function seoProblems() {
  const rows = await db.q(`SELECT p.id, p.name, p.sku, p.seo_title, p.seo_description, p.short_description, p.description, p.image_id, p.category_id, p.noindex,
      p.model, p.specs, p.brand, p.rating_count,
      (SELECT count(*) FROM media m WHERE m.owner_type='product' AND m.owner_id=p.id)::int AS pics,
      (SELECT count(*) FROM products x WHERE x.active AND lower(x.name)=lower(p.name) AND x.id<>p.id)::int AS same_name
    FROM products p WHERE p.active AND p.parent_id IS NULL ORDER BY p.id`);
  const out: Loose[] = [];
  const seo = $services_seo;
  const autoOn = (await db.getSettings()).autoseo_desc !== '0';
  let sum = 0;
  for (const p of rows) {
    const why: Loose[] = [];
    p.auto_desc = autoOn;
    const title = seo.productTitle(p);
    p.score = seoScore(p, seo);
    sum += p.score;
    if (!p.image_id) why.push(['bad', 'ছবি নেই']);
    if (!String(p.description || '').trim() && !String(p.short_description || '').trim()) why.push(autoOn ? ['info', 'নিজের লেখা বিবরণ নেই — 🤖 অটো বিবরণ দেখানো হচ্ছে (নিজে লিখলে আরও ভালো)'] : ['bad', 'কোনো বিবরণ নেই']);
    if (seo.needsNameFix(p.name)) why.push(['warn', 'নামের শুরুতে অন্য সাইটের লেখা ("Product details of …") — উপরের বাটনে একসাথে ঠিক করুন']);
    if (/\s[A-Za-z]{1,4}$/.test(p.name) && p.name.length >= 100) why.push(['warn', 'নাম মাঝপথে কেটে গেছে মনে হচ্ছে — শেষটা ঠিক করে লিখুন']);
    if (p.seo_title && p.seo_title.length > 65) why.push(['warn', `নিজের দেওয়া SEO টাইটেল লম্বা (${p.seo_title.length} অক্ষর) — গুগলে কেটে যাবে`]);
    if (title.length < 15) why.push(['warn', 'টাইটেল খুব ছোট']);
    const textLen = String(p.description || '').trim().length + String(p.short_description || '').trim().length;
    if (textLen > 0 && textLen < 80) why.push(autoOn ? ['info', 'নিজের বিবরণ ছোট — সাথে 🤖 অটো বিবরণ দেখানো হচ্ছে'] : ['warn', 'বিবরণ খুব ছোট — কয়েক লাইন নিজের ভাষায় লিখুন (কী কাজে লাগে, স্পেসিফিকেশন)']);
    else if (textLen >= 80 && textLen < 200) why.push(['info', 'বিবরণ আরেকটু বড় করলে ভালো (২০০+ অক্ষর) — কী কাজে লাগে, কীভাবে লাগাবেন']);
    if (!String(p.model || '').trim()) why.push(['warn', 'মডেল / পার্ট নম্বর নেই — মানুষ "PAM8403", "SG90" এভাবেই খোঁজে']);
    if (!(Array.isArray(p.specs) && p.specs.filter((r) => Array.isArray(r) && r[0] && r[1]).length >= 2)) why.push(['info', 'স্পেসিফিকেশন (ভোল্টেজ, কারেন্ট, সাইজ…) অন্তত ২টা সারি দিন']);
    if (p.image_id && p.pics < 2) why.push(['info', 'মাত্র ১টা ছবি — পেছন/পাশ থেকে আরেকটা দিলে ভালো']);
    if (!p.category_id) why.push(['warn', 'ক্যাটাগরি নেই']);
    if (p.same_name) why.push(['warn', 'একই নামের আরেকটা পণ্য আছে']);
    if (p.noindex) why.push(['info', 'noindex — গুগলে দেখাবে না']);
    if (why.length) out.push({ ...p, why });
  }
  return { total: rows.length, list: out, avg: rows.length ? Math.round(sum / rows.length) : 0, perfect: rows.filter((p) => p.score >= 90).length };
}

export { seoProblems, seoScore, SEO_WEIGHTS };
