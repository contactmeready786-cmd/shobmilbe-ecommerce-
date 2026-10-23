// 🧹 বিবরণ পরিষ্কার (owner, 2026-10-24): a product description copied from another shop usually ends with that
// shop's own text — "why buy from us", delivery / return rules, a question-and-answer list about the shop, its web
// address, phone numbers. Only the product's own text should stay.
//
// clean(text, source) works on the description as the shop stores it (paragraphs, "## headings", "- " lists):
//   1. from the first heading / line that starts the shop's own part (FAQ, প্রশ্ন-উত্তর, কেন আমাদের থেকে কিনবেন,
//      ডেলিভারি, রিটার্ন, যোগাযোগ, About us …) to the end — removed, if enough product text is before it
//   2. any other paragraph that names the source shop or its address, a phone number, an e-mail, a web link,
//      WhatsApp / Facebook page, or "order now / call now" — removed
//   3. question-and-answer lines (Q: / প্রশ্ন: / উত্তর: / "…?" followed by an answer) — removed
// Nothing is guessed about the product itself: a paragraph that is about the product stays exactly as written.
// lib/admin/descclean.tsx shows before / after and keeps the old text for undo; lib/admin/import.tsx uses it too.

/** words that start the copied shop's own part of a description */
const TAIL_START = new RegExp([
  'faq', 'f\\.a\\.q', 'frequently asked', 'questions? (?:and|&) answers?', 'q ?& ?a\\b', 'common questions', 'people also ask',
  'why (?:buy|choose|shop|order)', 'why us\\b', 'about us', 'about (?:the )?(?:shop|store|company|seller)', 'our (?:shop|store|company|service|policy)',
  'delivery (?:info|information|policy|charge|time|system|process)', 'shipping (?:info|information|policy)', 'return (?:policy|&|and)', 'refund policy', 'warranty policy',
  'how to (?:order|buy|purchase)', 'order (?:process|procedure)', 'payment (?:method|option|system)s?', 'contact (?:us|info|information|details)\\b', 'customer (?:support|care|service)',
  'disclaimer', 'terms (?:and|&) conditions',
  'সাধারণ জিজ্ঞাসা', 'সচরাচর জিজ্ঞাসা', 'প্রায়ই জিজ্ঞাস', 'প্রশ্ন ?(?:ও|এবং|-|–) ?উত্তর', 'প্রশ্নোত্তর', 'জিজ্ঞাসিত প্রশ্ন',
  'কেন (?:আমাদের|আমরা|.{0,30}থেকে (?:কিনবেন|কেনা|নিবেন|নেবেন))', 'আমাদের (?:সম্পর্কে|দোকান|শপ|সেবা|প্রতিষ্ঠান|নীতি)',
  'ডেলিভারি (?:তথ্য|চার্জ|নীতি|সময়|পদ্ধতি|ব্যবস্থা)', 'রিটার্ন (?:নীতি|পলিসি)', 'ফেরত (?:নীতি|দেওয়ার নিয়ম)', 'ওয়ারেন্টি (?:নীতি|পলিসি)',
  'কিভাবে অর্ডার', 'কীভাবে অর্ডার', 'অর্ডার (?:করার নিয়ম|পদ্ধতি|প্রক্রিয়া)', 'পেমেন্ট (?:পদ্ধতি|মাধ্যম|ব্যবস্থা)', 'যোগাযোগ(?:ের ঠিকানা| করুন| নম্বর)', 'গ্রাহক সেবা',
].join('|'), 'iu');
const tailStarts = (p: string) => new RegExp(`^[^\\p{L}\\p{N}]*(?:${TAIL_START.source})`, 'iu').test(p);

// a paragraph about the shop selling, not about the product
const SHOP_TALK = new RegExp([
  '(?:\\+?88)?0 ?1[3-9][\\d -]{8,11}', // Bangladeshi mobile numbers
  '\\b[\\w.+-]+@[\\w-]+\\.[\\w.]+\\b', // e-mail
  'https?://', '\\bwww\\.', '\\b[a-z0-9-]+\\.(?:com|net|org|shop|store|xyz|info|com\\.bd|bd)\\b',
  'whats ?app', 'imo\\b', 'messenger', 'facebook page', 'fb page', 'ফেসবুক পেজ', 'হোয়াটসঅ্যাপ', 'ইমো',
  'order now', 'call now', 'call us', 'buy now from', 'visit (?:our|us)', 'cash on delivery', 'home delivery', 'all over bangladesh',
  'অর্ডার করতে', 'অর্ডার করুন', 'কল করুন', 'ফোন করুন', 'যোগাযোগ করুন', 'ক্যাশ অন ডেলিভারি', 'হোম ডেলিভারি', 'সারা বাংলাদেশে', 'সারাদেশে',
  'আমাদের (?:ওয়েবসাইট|দোকান|শপ|পেজ|শোরুম)', 'আমরা (?:দিচ্ছি|দিয়ে থাকি|ডেলিভারি)',
].join('|'), 'iu');

const QA_LINE = /^\s*(?:[-*•]\s*)?(?:\*\*)?\s*(?:q|a|ques|ans|question|answer|প্রশ্ন|উত্তর|প্র|উ)\s*(?:\d+\s*)?[:.)।-]/iu;

export type Cleaned = { text: string; removed: string[]; changed: boolean };

/** The shop's name parts to look for, from its web address: "www.electrox.com.bd" → ["electrox"]. */
export function sourceNames(source: string): string[] {
  const host = String(source || '').toLowerCase().replace(/^https?:\/\//, '').replace(/[/#?].*$/, '').replace(/^www\./, '');
  if (!host || host === 'file') return [];
  const base = host.split('.')[0];
  const names = new Set<string>([host]);
  if (base && base.length >= 4) {
    names.add(base);
    // "electrox" also written "electro x", "electro-x"
    const m = base.match(/^([a-z]{4,})([a-z]{1,3})$/);
    if (m) names.add(`${m[1]}[ -]?${m[2]}`);
  }
  return [...names];
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Blocks: paragraphs separated by blank lines; a heading starts its own block. Each block remembers the gap
 *  before it, so what stays keeps its exact layout. */
function blocks(text: string): { b: string; gap: string }[] {
  const out: { b: string; gap: string }[] = [];
  let cur: string[] = [];
  let gap = '';
  let blank = 0;
  const flush = () => { if (cur.length) { out.push({ b: cur.join('\n'), gap }); cur = []; } };
  const start = () => { gap = out.length ? '\n'.repeat(blank + 1) : ''; blank = 0; };
  for (const line of String(text).replace(/\r\n?/g, '\n').split('\n')) {
    if (!line.trim()) { flush(); blank++; continue; }
    const head = /^\s*#{1,6}\s/.test(line) || /^\s*\*\*[^*]{2,80}\*\*\s*[:?]?\s*$/.test(line);
    if (head) { flush(); start(); cur.push(line); flush(); continue; }
    if (!cur.length) start();
    cur.push(line);
  }
  flush();
  return out;
}

const plain = (b: string) => b.replace(/^\s*#{1,6}\s*/gm, '').replace(/\*\*/g, '').replace(/^\s*[-*•]\s+/gm, '').trim();
// a heading: "## …", a line that is all bold, or a short line ending with ":" or "?"
const isHeading = (b: string) => /^\s*#{1,6}\s/.test(b) || /^\s*\*\*[^*]{2,80}\*\*\s*[:?]?\s*$/.test(b) || (!b.includes('\n') && plain(b).length <= 70 && /[:：?？]\s*$/.test(plain(b)));

export function clean(text: string, source = ''): Cleaned {
  const original = String(text || '');
  if (!original.trim()) return { text: original, removed: [], changed: false };
  const names = sourceNames(source);
  const nameRe = names.length ? new RegExp(names.map((n) => (n.includes('[') ? n : esc(n))).join('|'), 'i') : null;
  const all = blocks(original);
  const bs = all.map((x) => x.b);
  const removed: string[] = [];
  const keep: string[] = [];
  const gaps: string[] = [];
  const total = plain(original).length;
  let before = 0; // product text seen so far
  let tail = false;
  for (let i = 0; i < bs.length; i++) {
    const b = bs[i];
    const p = plain(b);
    if (tail) { removed.push(b); continue; }
    // 1. the shop's own part starts here (a heading, or a short opening line) — only once real product text came before
    const first = plain(b.split('\n')[0]);
    if ((isHeading(b) || first.length <= 60) && tailStarts(first) && before >= Math.min(150, total * 0.25)) {
      tail = true; removed.push(b); continue;
    }
    // 2. the source shop by name, contact details, selling talk
    if ((nameRe && nameRe.test(p)) || SHOP_TALK.test(p)) {
      // a long paragraph that only mentions a number or a link once in passing: drop just those sentences
      const sentences = p.length > 220 ? b.split(/(?<=[.!?।])\s+/) : [b];
      if (sentences.length > 2) {
        const good = sentences.filter((s) => !((nameRe && nameRe.test(s)) || SHOP_TALK.test(s)));
        const bad = sentences.filter((s) => !good.includes(s));
        if (good.length && good.join(' ').length >= 80) { keep.push(good.join(' ')); gaps.push(all[i].gap); removed.push(bad.join(' ')); before += plain(good.join(' ')).length; continue; }
      }
      removed.push(b); continue;
    }
    // 3. question-and-answer lines: a block of Q / A, or a question heading followed by its answer
    if (QA_LINE.test(b) || (isHeading(b) && /[?？]\s*\**\s*$/.test(p) && before >= 150)) {
      removed.push(b);
      // the answer right after a question heading
      if (!QA_LINE.test(b) && i + 1 < bs.length && !isHeading(bs[i + 1])) { removed.push(bs[++i]); }
      continue;
    }
    keep.push(b); gaps.push(all[i].gap);
    if (!isHeading(b)) before += p.length;
  }
  // a heading left with nothing under it (its part was removed) goes too
  while (keep.length && isHeading(keep[keep.length - 1])) { removed.unshift(keep.pop()!); gaps.pop(); }
  const out = keep.map((b, i) => (i ? (gaps[i] || '\n\n') : '') + b).join('').trim();
  return { text: out, removed: removed.filter((x) => x.trim()), changed: out !== original.trim() };
}
