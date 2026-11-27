// 🧑‍🏫 The AI teacher's words (lib/api/learn.ts): who it is, and how its answer is split into the text shown and the
// part names it suggests (looked up among the shop's products). Pure — no database, so it is easy to test.

export const TEACHER = 'তুমি "সবমিলবে ফ্রি ইলেকট্রনিক্স ক্লাস"-এর একজন ধৈর্যশীল, আন্তরিক শিক্ষক। শিক্ষার্থীরা বাংলাদেশের স্কুল-কলেজ-ভার্সিটির ছাত্রছাত্রী আর ইলেকট্রনিক্সে আগ্রহী নতুনরা। ' +
  'নিয়ম: (১) সহজ বাংলায়, ছোট ছোট বাক্যে, দরকার হলে ধাপে ধাপে উত্তর দাও — ১৮০ শব্দের মধ্যে। হিসাব থাকলে সূত্র আর সংখ্যা দেখিয়ে দাও। ' +
  '(২) শুধু ইলেকট্রনিক্স, বিদ্যুৎ, সার্কিট, আরডুইনো/মাইক্রোকন্ট্রোলার, সেন্সর, রোবটিক্স, সোল্ডারিং আর মেরামতের প্রশ্নের উত্তর দাও। অন্য বিষয় হলে ভদ্রভাবে বলো এই ক্লাসে শুধু ইলেকট্রনিক্স নিয়ে প্রশ্ন নেওয়া হয়। ' +
  '(৩) নিরাপত্তা সবার আগে: বাসার ২২০V লাইন, মাইক্রোওভেন, টিভি/মনিটরের ভেতরের হাই-ভোল্টেজ, বড় ক্যাপাসিটর বা লিথিয়াম ব্যাটারি খোলা-কাটা — এসব হাতে-কলমে করার নির্দেশনা দেবে না; বিপদটা বুঝিয়ে অভিজ্ঞ টেকনিশিয়ানের কাছে যেতে বলো। ' +
  'অস্ত্র, বিস্ফোরক, কারো ক্ষতি, চুরি বা বেআইনি কাজের প্রশ্নে কোনো সাহায্য করবে না। ' +
  '(৪) নিশ্চিত না হলে বানিয়ে বলবে না — বলবে "এটা নিশ্চিত না, ডেটাশিট দেখে নিন"। কোনো দোকানের নাম বা দাম বলবে না। ' +
  '(৫) Markdown চিহ্ন (#, **, টেবিল) ব্যবহার করবে না — সাধারণ লেখা আর "১. ২. ৩." ধরনের তালিকা। কোড লাগলে ছোট কোড দিতে পারো। ' +
  '(৬) উত্তরের একদম শেষ লাইনে, উত্তরে দরকারি ইলেকট্রনিক পার্টস থাকলে, ইংরেজিতে সর্বোচ্চ ৩টা পার্টসের সাধারণ নাম এভাবে লেখো: PARTS: arduino uno, 220 ohm resistor, 5mm red led — যতটা সম্ভব নির্দিষ্ট নাম। পার্টস না লাগলে এই লাইন লিখবে না।';

export type Answer = { answer: string; parts: string[] };
/** the same question typed a little differently: one memory key */
export const norm = (q: string) => q.toLowerCase().replace(/[?？।!.,\s]+/g, ' ').trim();

/** the model's text → the answer shown and the part names (the "PARTS:" line taken off) */
export function splitParts(text: string): Answer {
  const lines = text.replace(/\r/g, '').split('\n');
  let parts: string[] = [];
  const kept = lines.filter((line) => {
    const m = /^\s*\**\s*PARTS\s*:\s*(.*)$/i.exec(line);
    if (!m) return true;
    parts = m[1].split(/[,،]/).map((x) => x.replace(/[*_`]/g, '').trim().toLowerCase()).filter((x) => x.length >= 2 && x.length <= 40).slice(0, 3);
    return false;
  });
  // the model sometimes still writes Markdown: bold/heading marks are taken off, the words stay
  const answer = kept.join('\n').replace(/\*\*(.+?)\*\*/g, '$1').replace(/^#{1,6}\s*/gm, '').replace(/\n{3,}/g, '\n\n').trim();
  return { answer, parts };
}

/** Does a shop product's name really fit a part the teacher named? Every word with letters must be in the name
 * ("red led" never matches a lamp holder that only says "LED"); numbers like "220" or "5mm" help but aren't needed,
 * because shops write them differently. */
const ACCESSORY = ['case', 'shell', 'enclosure', 'cover', 'holder', 'bracket', 'mount', 'stand'];
export function nameFits(term: string, name: string): boolean {
  const have = ' ' + name.replace(/[ΩΩω]/g, ' ohm ').toLowerCase().replace(/[^a-z0-9.]+/g, ' ') + ' ';
  const need = term.replace(/[ΩΩω]/g, ' ohm ').toLowerCase().split(/[^a-z0-9.]+/).filter((w) => w.length >= 2 && !/\d/.test(w));
  if (!need.length || !need.every((w) => have.includes(' ' + w + ' ') || have.includes(' ' + w + 's '))) return false;
  // a case, cover or holder FOR the part is not the part itself (unless the teacher named one)
  return !ACCESSORY.some((w) => have.includes(' ' + w + ' ') && !need.includes(w));
}
