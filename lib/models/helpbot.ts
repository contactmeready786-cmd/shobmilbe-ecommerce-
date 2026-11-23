// 🙋 Help bot (owner, 2026-11-18): one "সাহায্য" button on the shop instead of separate WhatsApp / Messenger / Tawk
// bubbles. It opens a small box with the owner's ready answers (tap a question, or type one — words are matched, no
// AI, no outside service), an order-track box, and "উত্তর পাননি?" → WhatsApp, Messenger, live chat (Tawk), call.
// The owner writes the answers on Admin → Social links & live chat → Help bot. Until the owner saves a list, the
// suggested answers below are used, made from the shop's own settings (delivery charges, payment, minimum order…).
import type { Settings } from '../types';
import { contact } from '../util';
import type { HelpItem, HelpConfig } from '../../client/shop/helpmatch';

export type { HelpItem, HelpConfig };
export type HelpRow = HelpItem & { on: boolean };

export const HELP_MAX_ITEMS = 25;
export const HELP_LIMITS = { q: 120, a: 700, k: 200 };

const n = (v: unknown) => Number(v) || 0;
/** "2-4" → "২–৪" (Admin → delivery days) */
const days = (v: unknown) => String(v).trim().replace(/\s*-\s*/g, '–').replace(/\d/g, (d) => '০১২৩৪৫৬৭৮৯'[Number(d)]);
const tk = (v: unknown) => `৳${String(n(v)).replace(/\d/g, (d) => '০১২৩৪৫৬৭৮৯'[Number(d)])}`;

/** answers suggested from the shop's own settings (used until the owner saves a list) */
export function suggestedItems(s: Settings): HelpRow[] {
  const pays = [
    s.pay_cod !== '0' ? 'পণ্য হাতে পেয়ে টাকা দেওয়া (ক্যাশ অন ডেলিভারি)' : '',
    s.pay_bkash === '1' ? 'বিকাশ' : '',
    s.pay_manual === '1' ? 'বিকাশ / নগদ / রকেটে Send Money' : '',
    s.pay_ssl === '1' ? 'কার্ড ও মোবাইল ব্যাংকিং (SSLCommerz)' : '',
  ].filter(Boolean);
  const free = n(s.free_delivery_min) > 0 ? ` ${tk(s.free_delivery_min)} বা তার বেশি টাকার অর্ডারে ডেলিভারি ফ্রি।` : '';
  const rows: (HelpRow | null)[] = [
    { q: 'ডেলিভারি চার্জ কত?', a: `ঢাকার ভেতরে ${tk(s.delivery_dhaka || 60)}, ঢাকার বাইরে ${tk(s.delivery_outside || 110)}।${free}`, k: 'ডেলিভারি চার্জ খরচ শিপিং delivery charge cost shipping ঢাকা বাইরে', on: true },
    { q: 'কতদিনে পণ্য পাবো?', a: `ঢাকার ভেতরে সাধারণত ${days(s.del_days_dhaka || '1-2')} দিন, ঢাকার বাইরে ${days(s.del_days_outside || '2-4')} দিনের মধ্যে পণ্য পৌঁছে যায়।`, k: 'কতদিন সময় দিন কবে পাবো পৌঁছাবে time days when', on: true },
    pays.length ? { q: 'টাকা কিভাবে দেব?', a: `টাকা দিতে পারবেন: ${pays.join(', ')}।`, k: 'টাকা পেমেন্ট বিকাশ নগদ ক্যাশ payment pay bkash nagad cash', on: true } : null,
    { q: 'অর্ডার কিভাবে করব?', a: 'পছন্দের পণ্যে "এখনই কিনুন" চাপুন, তারপর নাম, মোবাইল নম্বর আর ঠিকানা দিয়ে "অর্ডার করুন" চাপুন। একাধিক পণ্য নিতে "কার্টে যোগ করুন" চেপে পরে কার্ট থেকে অর্ডার করুন।', k: 'অর্ডার কিনব কেনা কার্ট order buy cart', on: true },
    n(s.min_order) > 0 ? { q: 'সর্বনিম্ন কত টাকার অর্ডার করতে হয়?', a: `পুরো অর্ডারে পণ্যের মোট দাম কমপক্ষে ${tk(s.min_order)} হতে হবে (ডেলিভারি চার্জ বাদে)। যেকোনো পণ্য মিলিয়ে নিতে পারবেন।`, k: 'সর্বনিম্ন কম মিনিমাম minimum least', on: true } : null,
    { q: 'আমার অর্ডার কোথায় আছে?', a: 'নিচের "অর্ডার ট্র্যাক করুন" ঘরে অর্ডার নম্বর আর মোবাইল নম্বর দিন — অর্ডারের অবস্থা দেখতে পাবেন।', k: 'ট্র্যাক কোথায় অবস্থা স্ট্যাটাস track status where', on: true },
    s.self_service_on !== '0' ? { q: 'অর্ডার বাতিল বা ঠিকানা বদল করব কিভাবে?', a: 'কুরিয়ারে দেওয়ার আগ পর্যন্ত অর্ডারের পেজ থেকে নিজেই "ঠিকানা বদলান" বা "অর্ডার বাতিল করুন" করতে পারবেন। অর্ডার নম্বর দিয়ে ট্র্যাক করলে সেই পেজ খুলবে।', k: 'বাতিল ক্যানসেল ঠিকানা বদল পরিবর্তন cancel change address', on: true } : null,
    s.complaints_on !== '0' ? { q: 'পণ্যে সমস্যা থাকলে কী করব?', a: `পণ্য হাতে পাওয়ার পর সমস্যা থাকলে সাইটের নিচে "অভিযোগ / সমস্যা জানান" পেজে জানান। আমরা ${String(n(s.complaint_hours) || 72).replace(/\d/g, (d) => '০১২৩৪৫৬৭৮৯'[Number(d)])} ঘণ্টার মধ্যে সমাধান করি।`, k: 'সমস্যা নষ্ট ভাঙা রিটার্ন ফেরত অভিযোগ ওয়ারেন্টি problem broken return refund warranty complaint', on: true } : null,
  ];
  return rows.filter((r): r is HelpRow => !!r);
}

/** the owner's list (Admin), or the suggested one if none was saved */
export function helpRows(s: Settings): HelpRow[] {
  if (!s.help_items) return suggestedItems(s);
  try {
    const list: unknown = JSON.parse(String(s.help_items));
    if (!Array.isArray(list)) return suggestedItems(s);
    return list.map(cleanRow).filter((r): r is HelpRow => !!r).slice(0, HELP_MAX_ITEMS);
  } catch { return suggestedItems(s); }
}

/** a row as typed in the admin form, tidied; null when it has no question or no answer */
export function cleanRow(x: unknown): HelpRow | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  const t = (v: unknown, max: number) => String(v ?? '').replace(/\r/g, '').trim().slice(0, max);
  const q = t(o.q, HELP_LIMITS.q).replace(/\s+/g, ' '), a = t(o.a, HELP_LIMITS.a), k = t(o.k, HELP_LIMITS.k).replace(/\s+/g, ' ');
  if (!q || !a) return null;
  return { q, a, k, on: o.on !== false && o.on !== '0' };
}

/** what the shop page hands to the browser (window.SM.help), or null while the help button is off */
export function helpConfig(s: Settings): HelpConfig | null {
  if (s.help_on !== '1') return null;
  const C = contact(s);
  const wa = C.wa || (C.phone ? C.phone.replace(/\D/g, '').replace(/^0/, '880') : '');
  return {
    items: helpRows(s).filter((r) => r.on).map(({ q, a, k }) => ({ q, a, k })),
    wa: s.chat_whatsapp_button === '1' ? wa : '',
    ms: String(s.chat_messenger_page || ''),
    tawk: !!s.chat_tawk_property,
    phone: C.phone,
    track: s.help_track !== '0',
    voice: s.voice_on !== '0',
  };
}
