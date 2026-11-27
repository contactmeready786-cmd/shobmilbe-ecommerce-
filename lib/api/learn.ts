// 🧑‍🏫 POST /api/learn — the AI teacher on the free electronics class pages (/learn, owner 2026-11-27).
// A student types a question; Gemini (the owner's one free key, Admin → AI staff) answers in simple Bangla like a
// patient teacher, only about electronics, with safety first. At the end the model names up to 3 parts in English
// ("PARTS: …"); those are looked up among the shop's own products and shown under the answer.
// Light on the server: the thinking happens at Google; here only a small request goes out. Limits keep the free
// quota and the server safe: 10 questions an hour per visitor, 400 a day for the whole shop, same questions answered
// from memory.
import * as db from '../db';
import * as security from '../security';
import * as catalog from '../models/catalog';
import * as $services_search from '../services/search';
import { gemini } from '../services/aistaff';
import { lesson, tutorOn } from '../data/lessons';
import { str } from '../util';
import { json, allow, tooMany } from '../next/api';
import { TEACHER, splitParts, norm, nameFits, type Answer } from '../services/tutor';
import type { ApiCtx } from '../next/api';

const memory = new Map<string, Answer>();

export async function ask(ctx: ApiCtx): Promise<Response> {
  const s = ctx.settings;
  if (s.learn_on === '0' || !tutorOn(s)) return json(404, { error: 'এখন শিক্ষক বন্ধ আছে।' });
  const b = await ctx.body();
  if (b.website) return json(200, { answer: '' });
  const q = str(b.q, 500).trim();
  if (q.length < 4) return json(400, { error: 'প্রশ্নটা একটু বিস্তারিত লিখুন।' });
  const l = lesson(str(b.lesson, 80));
  const key = `${l ? l.slug : ''}|${norm(q)}`;
  let a = memory.get(key);
  if (!a) {
    if (!(await allow(ctx, 'tutor:', 10, 3600))) return tooMany(ctx);
    if (!(await security.hit(db, 'tutor-all', 400, 86400))) return json(429, { error: 'আজকের প্রশ্নের সীমা শেষ। আগামীকাল আবার চেষ্টা করুন, বা আমাদের ফেসবুক গ্রুপে প্রশ্ন করুন।' });
    const where = l ? `শিক্ষার্থী এখন এই লেসনটা পড়ছে: "${l.title}"।\n` : '';
    try {
      a = splitParts(await gemini(String(s.ai_gemini_key || '').trim(), `${where}শিক্ষার্থীর প্রশ্ন: ${q}`, 25000, undefined, TEACHER));
    } catch (e) {
      console.error('learn tutor', (e as Error).message);
      return json(503, { error: 'শিক্ষক এখন একটু ব্যস্ত। কিছুক্ষণ পর আবার চেষ্টা করুন।' });
    }
    if (memory.size >= 200) memory.delete(memory.keys().next().value as string);
    memory.set(key, a);
  }
  // the parts the teacher named, from the shop's own shelves (only what is on sale, and only names that really fit)
  const picked: catalog.Product[] = [];
  for (const term of a.parts) {
    const found = ((await $services_search.find(term, { limit: 12 }).catch(() => [])) || []) as number[];
    if (!found.length) continue;
    const rows = await catalog.listProducts({ public: true, ids: found, hideOut: true, limit: 12 }).catch(() => [] as catalog.Product[]);
    const fit = rows.find((p) => nameFits(term, p.name) && !picked.some((x) => x.id === p.id));
    if (fit) picked.push(fit);
  }
  const rows = picked.slice(0, 3);
  return json(200, { answer: a.answer, products: rows.map((p) => ({ name: p.name, slug: p.slug, price: p.price, image: p.image_id ? `/media/${p.image_id}/t` : null, emoji: p.emoji })) });
}
