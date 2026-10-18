// ✈️ Telegram চ্যানেল — the shop's daily posts also go to its own Telegram channel, free and with no limits:
// at the same hours as the Facebook auto-post (Admin → অটো মার্কেটিং), one product with its photo, price and
// order link; on the engagement slot a tip, a question or a project guide instead. Telegram channels are where many
// electronics hobbyists in Bangladesh follow shops, and every post there is a free link back to the site.
//
// Setup (once): make a bot with @BotFather (gives a token), add the bot to the channel as an admin who may post,
// paste the token and the channel's @name here. Works even if Facebook is not connected.
import * as db from '../db';
import { fetchJson, str } from '../util';
import * as autopost from './autopost';
import type { Body, Id, Loose, Settings } from '../types';
import type { SocialPostsRow } from '../data/rows';

const API = 'https://api.telegram.org';
const ROTATION = ['tip', 'kit', 'tip', 'question'];

async function call(token: string | undefined, method: string, params?: unknown) {
  if (!/^\d{5,}:[A-Za-z0-9_-]{30,}$/.test(String(token || ''))) throw new Error('বটের টোকেন ঠিক নেই — @BotFather যেটা দিয়েছে পুরোটা কপি করুন (যেমন 123456789:AA…)।');
  const r = await fetchJson(`${API}/bot${token}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params || {}),
  }, 20000);
  if (!r.data || !r.data.ok) {
    const d = (r.data && r.data.description) || r.text || `HTTP ${r.status}`;
    if (/chat not found/i.test(d)) throw new Error('চ্যানেল পাওয়া যায়নি — চ্যানেলের @নাম ঠিক আছে কিনা আর বটকে চ্যানেলে যোগ করা হয়েছে কিনা দেখুন।');
    if (/not enough rights|need administrator|not a member|bot is not a member/i.test(d)) throw new Error('বটকে চ্যানেলের অ্যাডমিন বানিয়ে "Post messages" অনুমতি দিন।');
    if (/unauthorized/i.test(d)) throw new Error('বটের টোকেন ভুল বা বাতিল — @BotFather থেকে নতুন টোকেন নিন।');
    throw new Error(String(d).slice(0, 200));
  }
  return r.data.result;
}

// "@shobmilbe", "t.me/shobmilbe", "https://t.me/shobmilbe" or a numeric id → what the API wants
function chatId(input: Body) {
  const t = String(input || '').trim().replace(/^https?:\/\//i, '').replace(/^t\.me\//i, '').replace(/\/+$/, '');
  if (/^-?\d{5,}$/.test(t)) return t;
  const name = t.replace(/^@/, '');
  if (!/^[A-Za-z][A-Za-z0-9_]{3,31}$/.test(name)) throw new Error('চ্যানেলের @নাম লিখুন, যেমন @shobmilbe (অথবা t.me/shobmilbe)।');
  return '@' + name;
}

// Checks the token and the channel, and sends one test message.
async function connect(token: string, chatInput?: Loose) {
  const me = await call(token, 'getMe');
  const chat = chatId(chatInput);
  const info = await call(token, 'getChat', { chat_id: chat });
  await call(token, 'sendMessage', { chat_id: chat, text: `✅ ${me.first_name || 'বট'} এখন থেকে এই চ্যানেলে দোকানের নতুন পণ্য, অফার আর প্রজেক্ট গাইড পোস্ট করবে।`, disable_notification: true });
  return { chat: info.username ? '@' + info.username : String(info.id), title: info.title || '' };
}

async function send(settings: Settings, { text, product }: Body) {
  const token = settings.telegram_bot_token;
  const chat = settings.telegram_chat;
  if (product && product.image_id) {
    const caption = text.length > 1020 ? text.slice(0, 1015).replace(/\s+\S*$/, '') + '…' : text;
    const r = await call(token, 'sendPhoto', { chat_id: chat, photo: await autopost.imageUrl(product, settings), caption });
    return r.message_id;
  }
  const r = await call(token, 'sendMessage', { chat_id: chat, text: text.slice(0, 4000), disable_web_page_preview: false });
  return r.message_id;
}

async function record(slot?: unknown, productId?: Id, ok?: unknown, postId?: Id, message?: unknown, kind = 'product', ref = '') {
  await db.q(`INSERT INTO social_posts(slot, channel, product_id, ok, post_id, message, kind, ref) VALUES($1,'telegram',$2,$3,$4,$5,$6,$7)
    ON CONFLICT (slot) DO UPDATE SET product_id=EXCLUDED.product_id, ok=EXCLUDED.ok, post_id=EXCLUDED.post_id, message=EXCLUDED.message,
      kind=EXCLUDED.kind, ref=EXCLUDED.ref, created_at=now()`,
  [slot, productId, ok, String(postId || ''), str(message, 500), kind, str(ref, 500)]);
}

// One product post (the same kind of caption as Facebook, with a Telegram link tag)
async function postOne(settings: Settings, { slot }: Body = {}) {
  const p = await autopost.pickProduct(autopost.dhakaNow().weekday);
  if (!p) return { error: 'পোস্ট করার মতো পণ্য পাওয়া যায়নি (স্টকে আছে, ছবি আছে, দোকানে চালু — এমন পণ্য লাগবে)।' };
  const key = `${slot || `manual:${Date.now()}`}:tg`;
  try {
    const id = await send(settings, { text: autopost.caption(p, settings, 'telegram'), product: p });
    await record(key, p.id, true, id, '');
    return { product: p, id };
  } catch (e: Loose) {
    await record(key, p.id, false, '', e.message);
    await db.logIntegration('telegram', 'post', false, e.message, p.name);
    return { error: e.message, product: p };
  }
}

async function postEngagement(settings: Settings, slot: string) {
  const n = (await db.one<{ n: number }>(`SELECT count(*)::int AS n FROM social_posts WHERE channel='telegram' AND ok AND kind <> 'product'`).catch(() => ({ n: 0 })))!.n;
  const kind = ROTATION[n % ROTATION.length];
  const e = await autopost.buildEngagement(settings, kind);
  if (!e) return postOne(settings, { slot });
  const text = e.text.replace(/utm_source=facebook/g, 'utm_source=telegram').replace(/পেজটা ফলো করে রাখুন/g, 'চ্যানেলটা জয়েন করে রাখুন').replace(/পেজ ফলো করে রাখুন/g, 'চ্যানেল জয়েন করে রাখুন');
  const key = `${slot || `manual:${Date.now()}`}:tg`;
  try {
    const id = await send(settings, { text, product: e.product });
    await record(key, e.product ? e.product.id : null, true, id, '', e.kind, e.ref);
    return { engagement: e.kind, id };
  } catch (err: Loose) {
    await record(key, e.product ? e.product.id : null, false, '', err.message, e.kind, e.ref);
    await db.logIntegration('telegram', 'engage', false, err.message, e.kind);
    return { error: err.message };
  }
}

// From the round-the-clock wake-up: at the owner's posting hours, once per slot.
async function tick(settings: Settings) {
  if (settings.telegram_on !== '1' || !settings.telegram_bot_token || !settings.telegram_chat) return { off: true };
  const now = autopost.dhakaNow();
  const due = autopost.hoursOf(settings).filter((h) => h <= now.hour && now.hour - h <= 3);
  if (!due.length) return { idle: true };
  const hour = due[due.length - 1];
  const slot = `tg:${now.day}@${hour}`;
  const claimed = await db.one<Pick<SocialPostsRow, 'id'>>(`INSERT INTO social_posts(slot, channel, ok, message) VALUES($1,'claim',NULL,'') ON CONFLICT (slot) DO NOTHING RETURNING id`, [slot]);
  if (!claimed) return { done: true };
  const engage = settings.autopost_engage !== '0' && autopost.engagementSlot(settings, hour, now.day);
  return engage ? postEngagement(settings, slot) : postOne(settings, { slot });
}

async function recent(limit = 10) {
  return db.q<{ id: number; slot: string; channel: string; product_id: number | null; ok: boolean | null; post_id: string; message: string; created_at: Date; kind: string; ref: string; product_name: string | null }>(`SELECT sp.*, p.name AS product_name FROM social_posts sp LEFT JOIN products p ON p.id=sp.product_id
    WHERE sp.channel='telegram' ORDER BY sp.created_at DESC LIMIT $1`, [limit]).catch(() => []);
}

export { connect, tick, postOne, postEngagement, recent, chatId };
