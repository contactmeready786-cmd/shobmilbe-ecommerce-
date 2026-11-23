// 🛒 Cart reminders (owner, 2026-11-24: "like Daraz — remind people who left products in the cart").
// Standard e-commerce flow (Shopify / Klaviyo / OneSignal practice): at most 3 reminders about one cart —
// 1 hour, 24 hours and 72 hours after the shopper last touched the cart — then it stops.
//  • Who gets them: phones/computers that said "yes" to the shop's 🔔 notifications (free Web Push), and customers
//    with an account whose e-mail is on the offer-mail list (free, same mailer as the other shop mails, its daily cap).
//    Nobody else: no SMS (costs money), no mail to people who never asked for mail.
//  • Stops by itself: the cart is ordered or emptied, every product in it is stock-out / switched off, or 3 were sent.
//  • Never at night (10 pm – 9 am Dhaka time: waits for the morning), at least 12 hours between two reminders,
//    never more than 3 in 7 days to one device. A cart only starts again when a NEW product is added.
//  • Honest words only: "only N left" appears only when the stock really is that low, "price dropped" only when the
//    shop's price really is lower than when it was put in the cart.
// Admin → মার্কেটিং → 🔔 ফোনে অফারের নোটিফিকেশন → 🛒 কার্ট রিমাইন্ডার: switch, the 3 messages, the results.
import * as crypto from 'node:crypto';
import * as db from '../db';
import * as push from './push';
import * as mailer from './mailer';
import { dhakaHour } from './drafts';
import { int, str, bn, fields } from '../util';
import type { Body, Settings } from '../types';

/** minutes after the last cart change for reminder 1, 2, 3 */
export const STEP_AFTER = [60, 24 * 60, 72 * 60];
export const MAX_STEPS = STEP_AFTER.length;
const TOKEN_RE = /^[a-f0-9]{24}$/;

export const DEFAULT_TEXT: Record<string, string> = {
  cart_remind_t1: '🛒 আপনার কার্টে পণ্য অপেক্ষা করছে',
  cart_remind_b1: '{product}{more} আপনার কার্টে রাখা আছে। এক চাপে অর্ডার শেষ করুন।',
  cart_remind_t2: '⭐ {product} এখনো আপনার কার্টে',
  cart_remind_b2: 'ক্যাশ অন ডেলিভারি — পণ্য হাতে পেয়ে তারপর টাকা দিন। এখনই অর্ডার করে ফেলুন।',
  cart_remind_t3: '⏰ শেষবার মনে করিয়ে দিচ্ছি',
  cart_remind_b3: 'আপনার পছন্দের {product}{more} এখনো কার্টে আছে। দেরি না করে অর্ডার করে ফেলুন।',
};
export const text = (s: Settings, key: string): string => String(s[key] || '').trim() || DEFAULT_TEXT[key] || '';

type Item = { id: number; qty: number; price: number };
type Row = {
  id: number; key: string; endpoint: string; customer_id: number | null; token: string; items: Item[] | null;
  cart_at: Date; step: number; last_sent_at: Date | null; status: string;
};

function cleanItems(raw: unknown): { id: number; qty: number }[] {
  const seen = new Set<number>();
  return (Array.isArray(raw) ? raw : []).slice(0, 30).map((x) => {
    const i = fields(x);
    return { id: int(i && i.id), qty: Math.min(999, Math.max(1, int(i && i.qty, 1))) };
  }).filter((i) => i.id > 0 && !seen.has(i.id) && (seen.add(i.id), true));
}

/**
 * The browser's cart changed (or an order was just placed). Kept only for a device that takes notifications
 * (its push address is on shop_push_subs) or a signed-in customer. Returns whether this browser is followed.
 */
export async function save(settings: Settings, b: Body, customerId: number | null): Promise<{ track: boolean }> {
  if (settings.cart_remind_on !== '1') return { track: false };
  const endpoint = str(b.endpoint, 1000);
  let key = '';
  if (endpoint && push.okEndpoint(endpoint) && await db.one('SELECT 1 FROM shop_push_subs WHERE endpoint=$1', [endpoint])) key = 'p:' + crypto.createHash('sha256').update(endpoint).digest('hex').slice(0, 40);
  else if (customerId) key = 'c:' + customerId;
  if (!key) return { track: false };
  const ep = key.startsWith('p:') ? endpoint : '';
  // one cart, one set of reminders: a signed-in customer whose phone also takes notifications is followed by the phone
  if (ep && customerId) await db.q(`UPDATE cart_reminders SET status='merged', updated_at=now() WHERE key=$1 AND status='open'`, ['c:' + customerId]);
  const order = str(b.order, 40);
  const wanted = cleanItems(b.items);
  const old = await db.one<Row>('SELECT * FROM cart_reminders WHERE key=$1', [key]);

  // 🧾 just ordered: this cart is done (and "won back" when a reminder had gone before)
  if (order) {
    const o = await db.one<{ total: number }>(`SELECT total FROM orders WHERE code=$1 AND created_at > now() - interval '3 hours'`, [order]);
    if (old && o && (old.status === 'open' || old.status === 'empty')) {
      await db.q(`UPDATE cart_reminders SET status='ordered', order_code=$2, order_total=$3, items='[]'::jsonb, updated_at=now() WHERE id=$1`, [old.id, order, Math.round(Number(o.total) || 0)]);
    }
    return { track: true };
  }
  if (!wanted.length) {
    if (old && old.status === 'open') await db.q(`UPDATE cart_reminders SET status='empty', items='[]'::jsonb, updated_at=now() WHERE id=$1`, [old.id]);
    return { track: true };
  }
  // today's shop prices (the browser's numbers are never trusted); the price a product had when it was first put in
  // the cart is kept, so "price dropped" is only ever said when it is true
  const prods = await db.q<{ id: number; price: number }>('SELECT id, price FROM products WHERE id = ANY($1::int[])', [wanted.map((i) => i.id)]);
  const before = new Map((old && old.status === 'open' ? old.items || [] : []).map((i) => [i.id, i.price]));
  const items: Item[] = wanted.map((i) => {
    const p = prods.find((x) => x.id === i.id);
    return p ? { id: i.id, qty: i.qty, price: before.get(i.id) ?? Number(p.price) } : null;
  }).filter((x): x is Item => !!x);
  if (!items.length) return { track: true };
  // a NEW product starts the 3 reminders again; changing a quantity or removing something only restarts the clock
  const fresh = !old || old.status !== 'open' || items.some((i) => !before.has(i.id));
  await db.q(`INSERT INTO cart_reminders(key, endpoint, customer_id, token, items, cart_at, step, status)
      VALUES($1,$2,$3,$4,$5::jsonb, now(), 0, 'open')
    ON CONFLICT (key) DO UPDATE SET endpoint = CASE WHEN EXCLUDED.endpoint <> '' THEN EXCLUDED.endpoint ELSE cart_reminders.endpoint END,
      customer_id = coalesce(EXCLUDED.customer_id, cart_reminders.customer_id), items = EXCLUDED.items, cart_at = now(),
      step = CASE WHEN $6 THEN 0 ELSE cart_reminders.step END, status = 'open',
      order_code = CASE WHEN $6 THEN '' ELSE cart_reminders.order_code END, order_total = CASE WHEN $6 THEN 0 ELSE cart_reminders.order_total END,
      token = CASE WHEN $6 THEN EXCLUDED.token ELSE cart_reminders.token END, updated_at = now()`,
  [key, ep, customerId, crypto.randomBytes(12).toString('hex'), JSON.stringify(items), fresh]);
  if (Math.random() < 0.02) db.q(`DELETE FROM cart_reminders WHERE updated_at < now() - interval '60 days'`).catch(() => {});
  return { track: true };
}

/** The link in a reminder (/cart?cr=…): the products, so the cart fills itself again on any device (e-mail on a PC). */
export async function restore(token: unknown): Promise<{ id: number; qty: number }[] | null> {
  if (!TOKEN_RE.test(String(token || ''))) return null;
  const r = await db.one<Pick<Row, 'id' | 'items' | 'status'>>(`SELECT id, items, status FROM cart_reminders WHERE token=$1 AND updated_at > now() - interval '14 days'`, [token]);
  if (!r || r.status === 'ordered') return null;
  await db.q('UPDATE cart_reminders SET clicked_at = coalesce(clicked_at, now()) WHERE id=$1', [r.id]);
  await db.q('UPDATE cart_reminder_sends SET clicked_at = now() WHERE id = (SELECT id FROM cart_reminder_sends WHERE reminder_id=$1 ORDER BY id DESC LIMIT 1) AND clicked_at IS NULL', [r.id]);
  return (r.items || []).map((i) => ({ id: int(i.id), qty: int(i.qty, 1) })).filter((i) => i.id > 0);
}

type Prod = { id: number; name: string; name_bn: string; price: number; stock: number; active: boolean; image_id: number | null; ik_url: string | null };
/** The words of one reminder, with {product} / {more} filled in and honest extras (low stock, lower price). */
export function message(settings: Settings, step: number, items: Item[], prods: Prod[]) {
  const live = items.map((i) => ({ i, p: prods.find((p) => p.id === i.id) })).filter((x) => x.p && x.p.active && Number(x.p.stock) > 0);
  const first = live[0];
  const name = first ? str(first.p!.name_bn || first.p!.name, 45) : '';
  const more = live.length > 1 ? ` সহ আরও ${bn(live.length - 1)}টি পণ্য` : '';
  const fill = (t: string) => t.replace(/\{product\}/g, name).replace(/\{more\}/g, more).replace(/\s+/g, ' ').trim();
  let body = fill(text(settings, `cart_remind_b${step}`));
  const cheaper = live.find((x) => Number(x.p!.price) + 0.001 < Number(x.i.price));
  const low = live.find((x) => Number(x.p!.stock) <= 5);
  if (cheaper) body = `🔻 দাম কমেছে: ${str(cheaper.p!.name_bn || cheaper.p!.name, 40)} এখন ৳${bn(Number(cheaper.p!.price))}। ` + body;
  else if (low) body += ` (স্টকে আর মাত্র ${bn(low.p!.stock)}টি আছে)`;
  return { title: fill(text(settings, `cart_remind_t${step}`)), body: str(body, 230), live: live.map((x) => x.p!), name };
}

/** One round (lib/api/files.ts runShopJobs, every 5 minutes): the reminders that are due, a few at a time. */
type TickOpts = { hour?: number; sendPush?: typeof push.shopSendOne };
export async function tick(settings: Settings, { hour, sendPush = push.shopSendOne }: TickOpts = {}): Promise<{ sent: number; night?: boolean; off?: boolean }> {
  if (settings.cart_remind_on !== '1') return { sent: 0, off: true };
  const h = hour ?? dhakaHour();
  if (h < 9 || h >= 22) return { sent: 0, night: true };
  const rows = await db.q<Row>(`SELECT r.* FROM cart_reminders r
    WHERE r.status='open' AND r.step < $1 AND jsonb_array_length(r.items) > 0
      AND r.cart_at < now() - make_interval(mins => (CASE r.step WHEN 0 THEN $2::int WHEN 1 THEN $3::int ELSE $4::int END))
      AND r.cart_at > now() - interval '8 days'
      AND (r.last_sent_at IS NULL OR r.last_sent_at < now() - interval '12 hours')
      AND (SELECT count(*) FROM cart_reminder_sends s WHERE s.reminder_id=r.id AND s.created_at > now() - interval '7 days') < $1
    ORDER BY r.cart_at LIMIT 20`, [MAX_STEPS, ...STEP_AFTER]);
  if (!rows.length) return { sent: 0 };
  const base = String(settings.site_url || 'https://shobmilbe.com').replace(/\/+$/, '');
  const mail = mailer.cfg(settings);
  let mailLeft = mail.on && mail.ready ? Math.min(await mailer.leftToday(settings), 20) : 0;
  let sent = 0;
  for (const r of rows) {
    // claim it first: two rounds never send the same reminder
    const mine = await db.one<{ step: number }>(`UPDATE cart_reminders SET step=step+1, last_sent_at=now() WHERE id=$1 AND step=$2 AND status='open' RETURNING step`, [r.id, r.step]);
    if (!mine) continue;
    const step = mine.step;
    const items = r.items || [];
    const prods = await db.q<Prod>(`SELECT p.id, p.name, p.name_bn, p.price, p.stock, p.active, p.image_id, m.ik_url
      FROM products p LEFT JOIN media m ON m.id=p.image_id WHERE p.id = ANY($1::int[])`, [items.map((i) => i.id)]);
    const m = message(settings, step, items, prods);
    if (!m.live.length) { await db.q(`UPDATE cart_reminders SET status='gone', updated_at=now() WHERE id=$1`, [r.id]); continue; }
    const link = `/cart?cr=${r.token}&utm_source=cart_reminder&utm_campaign=cart-${step}`;
    let pushOk = false;
    let mailOk = false;
    if (r.endpoint) {
      const p = m.live[0];
      const image = p.ik_url ? `${p.ik_url}${p.ik_url.includes('?') ? '&' : '?'}tr=w-720,h-360,c-at_max` : p.image_id ? `${base}/media/${p.image_id}` : undefined;
      const res = await sendPush(r.endpoint, { title: m.title, body: m.body, url: link + '&utm_medium=push', tag: 'cart-' + r.id, image, icon: settings.favicon_id ? `${base}/media/${settings.favicon_id}/t` : undefined }).catch(() => 'fail');
      pushOk = res === 'ok';
      if (res === 'gone') await db.q(`UPDATE cart_reminders SET endpoint='' WHERE id=$1`, [r.id]);
    }
    if (r.customer_id && mailLeft > 0) {
      const sub = await db.one<{ id: number; email: string; name: string; token: string }>(`SELECT s.id, s.email, c.name, s.token FROM customers c
        JOIN email_subs s ON lower(s.email)=lower(c.email) AND s.on_list WHERE c.id=$1 AND c.email_verified`, [r.customer_id]);
      if (sub) {
        mailLeft -= 1;
        const res = await mailer.sendOne(settings, sub, { kind: 'cart', subject: m.title, heading: m.title, intro: m.body,
          productIds: m.live.map((p) => p.id), button: { text: '🛒 অর্ডার শেষ করুন', path: link + '&utm_medium=email' } });
        mailOk = res.ok;
      }
    }
    await db.q('INSERT INTO cart_reminder_sends(reminder_id, step, push_ok, mail_ok) VALUES($1,$2,$3,$4)', [r.id, step, pushOk, mailOk]);
    if (pushOk || mailOk) sent++;
    // nothing can reach this cart any more (notifications turned off, no mail): stop following it
    if (!pushOk && !mailOk && !r.customer_id && !r.endpoint) await db.q(`UPDATE cart_reminders SET status='gone' WHERE id=$1`, [r.id]);
  }
  return { sent };
}

/** The numbers on the admin page (last 30 days). */
export async function stats() {
  const s = await db.one<{ waiting: number; sends: number; clicks: number; won: number; won_total: number; s1: number; s2: number; s3: number }>(`SELECT
      (SELECT count(*)::int FROM cart_reminders WHERE status='open' AND jsonb_array_length(items) > 0 AND step < ${MAX_STEPS}) AS waiting,
      (SELECT count(*)::int FROM cart_reminder_sends WHERE (push_ok OR mail_ok) AND created_at > now() - interval '30 days') AS sends,
      (SELECT count(*)::int FROM cart_reminder_sends WHERE clicked_at IS NOT NULL AND created_at > now() - interval '30 days') AS clicks,
      (SELECT count(*)::int FROM cart_reminders WHERE status='ordered' AND step > 0 AND updated_at > now() - interval '30 days') AS won,
      (SELECT coalesce(sum(order_total),0)::int FROM cart_reminders WHERE status='ordered' AND step > 0 AND updated_at > now() - interval '30 days') AS won_total,
      (SELECT count(*)::int FROM cart_reminder_sends WHERE step=1 AND (push_ok OR mail_ok) AND created_at > now() - interval '30 days') AS s1,
      (SELECT count(*)::int FROM cart_reminder_sends WHERE step=2 AND (push_ok OR mail_ok) AND created_at > now() - interval '30 days') AS s2,
      (SELECT count(*)::int FROM cart_reminder_sends WHERE step=3 AND (push_ok OR mail_ok) AND created_at > now() - interval '30 days') AS s3`);
  return s!;
}
