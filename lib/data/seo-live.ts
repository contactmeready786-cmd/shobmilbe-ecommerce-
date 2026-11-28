// 🏏⚽ Search words for the live score pages (/live/cricket, /live/football — owner, 2026-11-28: people who search
// Google, Bing or social media for a live score, today's match or a result should find these pages).
// People in Bangladesh type both ways: "live cricket score", "bd vs ind live", "আজকের খেলা", "লাইভ স্কোর".
// So each page gets an English name next to the Bangla one, a short text that says what is on the page, and a few
// questions written the way people ask. Only what is really true of the page is written here.
import type { Faq } from './seo-learn';

export type LiveSeo = { title: string; en: string; description: string; keywords: string; intro: string; faq: Faq[] };

export const LIVE_SEO: Record<'cricket' | 'football', LiveSeo> = {
  cricket: {
    title: 'লাইভ ক্রিকেট স্কোর',
    en: 'Live Cricket Score Today — Bangladesh, BPL, T20, ODI, Test',
    description: 'আজকের খেলার লাইভ ক্রিকেট স্কোর: বাংলাদেশ, বিপিএল, আইপিএল, টি-২০, ওয়ানডে ও টেস্ট — চলমান, আসন্ন আর শেষ হওয়া ম্যাচের ফল, প্রতি কয়েক সেকেন্ডে নিজে থেকে আপডেট। Live cricket score today, ball by ball updates.',
    keywords: 'live cricket score, cricket live score today, bangladesh cricket live score, bd cricket live, bpl live score, ipl live score, t20 live score, odi live score, test match live score, লাইভ ক্রিকেট স্কোর, আজকের খেলা, বাংলাদেশের খেলা, ক্রিকেট খেলার ফলাফল, বিপিএল লাইভ',
    intro: 'এখানে বাংলাদেশসহ আন্তর্জাতিক টেস্ট, ওয়ানডে, টি-২০ আর বড় লিগগুলোর (বিপিএল, আইপিএল, বিগ ব্যাশ, পিএসএল …) লাইভ স্কোর এক পাতায় দেখা যায়। কোন ম্যাচ এখন চলছে, কোনটা আসন্ন আর কোনটা শেষ — ফিল্টার দিয়ে আলাদা করে দেখুন। পাতাটা খোলা রাখলে স্কোর নিজে থেকেই কয়েক সেকেন্ড পরপর আপডেট হয়, রিফ্রেশ করতে হয় না।',
    faq: [
      { q: 'আজকের খেলার লাইভ স্কোর কোথায় দেখব?', a: 'এই পাতাতেই। আজ যেসব ম্যাচ চলছে সেগুলো উপরে "লাইভ" চিহ্ন দিয়ে দেখায়; "আসন্ন" চাপলে পরের ম্যাচ আর "শেষ" চাপলে আজকের ফলাফল দেখা যায়।' },
      { q: 'বাংলাদেশের খেলার স্কোর কি আলাদা করে পাওয়া যায়?', a: 'হ্যাঁ। বাংলাদেশের ম্যাচ সবসময় তালিকার শুরুতে থাকে, তাই খুঁজতে হয় না।' },
      { q: 'স্কোর কত তাড়াতাড়ি আপডেট হয়?', a: 'পাতা খোলা থাকলে কয়েক সেকেন্ড পরপর নিজে থেকে নতুন স্কোর আসে। ধীর ইন্টারনেটেও চলে।' },
      { q: 'দেখতে কি টাকা বা অ্যাপ লাগে?', a: 'না। যেকোনো মোবাইল বা কম্পিউটারের ব্রাউজারে ফ্রি দেখা যায়, কোনো অ্যাকাউন্ট লাগে না।' },
    ],
  },
  football: {
    title: 'লাইভ ফুটবল স্কোর',
    en: 'Live Football Score Today — Premier League, La Liga, Champions League, World Cup',
    description: 'আজকের ফুটবল খেলার লাইভ স্কোর ও ফলাফল: প্রিমিয়ার লিগ, লা লিগা, চ্যাম্পিয়নস লিগ, বিশ্বকাপ বাছাই, বাংলাদেশ — গোল, সময় আর ফল প্রতি কয়েক সেকেন্ডে আপডেট। Live football score today and results.',
    keywords: 'live football score, football live score today, soccer live score, premier league live score, la liga live, champions league live score, world cup live score, bangladesh football live, লাইভ ফুটবল স্কোর, আজকের ফুটবল খেলা, ফুটবল খেলার ফলাফল, বিশ্বকাপ লাইভ',
    intro: 'প্রিমিয়ার লিগ, লা লিগা, সিরি আ, বুন্দেসলিগা, চ্যাম্পিয়নস লিগ, বিশ্বকাপ ও বাছাইপর্ব, বাংলাদেশের ম্যাচ — সব বড় ফুটবল খেলার লাইভ স্কোর, কে কখন গোল করল আর শেষ হওয়া ম্যাচের ফল এক পাতায়। পাতাটা খোলা রাখলে স্কোর নিজে থেকেই আপডেট হয়।',
    faq: [
      { q: 'আজকের ফুটবল খেলার স্কোর কোথায় দেখব?', a: 'এই পাতাতেই। চলমান ম্যাচ "লাইভ" চিহ্ন দিয়ে দেখায়, পাশে খেলার সময় (মিনিট) আর গোলদাতার নাম থাকে।' },
      { q: 'শেষ হওয়া ম্যাচের ফলাফল পাওয়া যাবে?', a: 'হ্যাঁ, "শেষ" চাপলে আজকের সব শেষ হওয়া ম্যাচের ফল দেখা যায়।' },
      { q: 'স্কোর কত তাড়াতাড়ি আপডেট হয়?', a: 'পাতা খোলা থাকলে কয়েক সেকেন্ড পরপর নিজে থেকে নতুন স্কোর আসে, রিফ্রেশ করতে হয় না।' },
      { q: 'দেখতে কি টাকা বা অ্যাপ লাগে?', a: 'না। যেকোনো মোবাইল বা কম্পিউটারের ব্রাউজারে ফ্রি দেখা যায়।' },
    ],
  },
};
