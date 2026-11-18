// 🙋 The help button's answers (owner, 2026-11-18): a customer types a question, and the owner's ready answers
// (Admin → Social links & live chat → Help bot) whose words match it are shown — no AI, no outside service, free.
// Pure functions, shared by the browser (client/shop/help.tsx) and the tests (tests/helpbot.test.ts).

/** one ready answer as the page gets it: question, answer, extra words that should find it */
export type HelpItem = { q: string; a: string; k: string };

/** what the shop page hands the help button (window.SM.help; lib/models/helpbot.ts helpConfig) */
export type HelpConfig = {
  items: HelpItem[];
  /** WhatsApp digits, Messenger page name, Tawk live chat on the page, phone number to call */
  wa: string; ms: string; tawk: boolean; phone: string;
  /** show the order-track box */
  track: boolean;
};

const BN_DIGITS = '০১২৩৪৫৬৭৮৯';

/** lower case, Bangla digits as 0-9, punctuation out, spaces tidied */
export function normalise(text: string): string {
  return String(text || '')
    .toLowerCase()
    .replace(/[০-৯]/g, (d) => String(BN_DIGITS.indexOf(d)))
    .replace(/[^\p{L}\p{M}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// small words that say nothing about what is asked
const STOP = new Set(['কি', 'কী', 'কত', 'কেন', 'কোন', 'কিভাবে', 'কীভাবে', 'আমি', 'আমার', 'আপনার', 'আপনাদের', 'করব', 'করবো', 'করে', 'হবে', 'আছে', 'না', 'এর', 'ও', 'আর', 'কে', 'তে', 'যে',
  'the', 'a', 'an', 'is', 'are', 'i', 'my', 'how', 'what', 'do', 'to', 'of', 'in', 'can', 'you']);

/** the words of a text that are worth matching (2 letters or more, not a small filler word) */
export function words(text: string): string[] {
  return normalise(text).split(' ').filter((w) => w.length >= 2 && !STOP.has(w));
}

/** how well one ready answer fits what was typed (0 = not at all) */
export function score(item: HelpItem, typed: string): number {
  const asked = words(typed);
  if (!asked.length) return 0;
  const keys = new Set([...words(item.k), ...words(item.q)]);
  const extra = new Set(words(item.k));
  let total = 0;
  for (const w of asked) {
    for (const k of keys) {
      // a word matches when one starts with the other ("ডেলিভারি" ~ "ডেলিভারির", "charge" ~ "charges")
      if (k === w || (Math.min(k.length, w.length) >= 3 && (k.startsWith(w) || w.startsWith(k)))) {
        total += extra.has(k) ? 2 : 1; // the owner's extra words count more than the question's own words
        break;
      }
    }
  }
  return total;
}

/** the best fitting answers for what was typed, best first (at most `max`) */
export function bestMatches(items: HelpItem[], typed: string, max = 3): HelpItem[] {
  return items
    .map((it, i) => ({ it, i, s: score(it, typed) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .slice(0, max)
    .map((x) => x.it);
}
