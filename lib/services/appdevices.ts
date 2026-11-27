// 📱 App users (owner, 2026-11-24): every phone the customer Android app runs on, kept for good (never cleaned up),
// and the personal notifications for that phone.
//
// How a phone is known:
//  - app 1.5 and later make one random install number when first opened ("i:<id>"): the app's own background check
//    sends it (/api/app/offers?dev=…) and the shop pages inside the app carry it as the cookie sm_app;
//  - older apps (1.4) have no install number: their visits are told apart by the visit counter's visitor id ("v:<id>").
//    When such a phone updates the app, its old row is merged into the new one.
// What is kept: first/last open, number of opens, app version, phone make/model, Android version, IP and the
// approximate area the IP points to (city/division — never a home address), and — only after the customer places an
// order from that phone — the name, mobile number and delivery address they wrote on the order themselves.
// Personal notifications (app 1.5+, only phones that have checked in with their install number): the parcel went to
// the courier, it was delivered (+ "please review" with the one-tap review link), a review reminder 3 days later, and
// a message the owner writes for one phone from Admin → App users. Each order event is sent once per phone.
import * as db from '../db';
import { parseCookies, str, reviewPath } from '../util';
import type { AppDevicesRow, AppNoticesRow } from '../data/rows';
import type { Settings, ShopRequest } from '../types';

const INSTALL_RE = /^[A-Za-z0-9-]{16,64}$/;
const VID_RE = /^[A-Za-z0-9_-]{8,64}$/;

/** The owner's own phones (Admin → App users → "This is my phone"): never listed, their app visits never counted. */
export function ownerApp(settings: Settings, idOrInstall: string): boolean {
  if (!idOrInstall) return false;
  const id = idOrInstall.includes(':') ? idOrInstall : 'i:' + idOrInstall;
  return String(settings.app_owner_devices || '').split(',').includes(id);
}

/** Is this request from inside the customer app? */
export function isApp(ua: unknown): boolean { return /ShobmilbeApp\//.test(String(ua || '')); }

/** The app's install number from the sm_app cookie (app 1.5+), or ''. */
export function installOf(req: Pick<ShopRequest, 'headers'>): string {
  const v = String(parseCookies(req.headers.cookie as string).sm_app || '');
  return INSTALL_RE.test(v) ? v : '';
}

/** The phone's row id: the install number when the app has one, else the visitor id (older apps). */
export function deviceId(install: string, visitorId = ''): string {
  if (INSTALL_RE.test(install)) return 'i:' + install;
  if (VID_RE.test(visitorId)) return 'v:' + visitorId;
  return '';
}

export type SeenInfo = {
  id: string; visitorId?: string; version?: string; brand?: string; model?: string; os?: string; ip?: string;
  country?: string; region?: string; city?: string; poll?: boolean;
};

/** A phone opened the app (a visit) or its background check came in (poll). */
export async function seen(d: SeenInfo): Promise<void> {
  if (!d.id) return;
  const vals = [d.id, str(d.visitorId, 64), str(d.version, 20), str(d.brand, 40), str(d.model, 80), str(d.os, 40), str(d.ip, 64),
    str(d.country, 4), str(d.region, 60), str(d.city, 80), !!d.poll];
  await db.q(`INSERT INTO app_devices(id, visitor_id, app_version, brand, model, os, ip, country, region, city, opens, last_poll, can_notify)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, CASE WHEN $11 THEN 0 ELSE 1 END, CASE WHEN $11 THEN now() END, $11 AND $1 LIKE 'i:%')
    ON CONFLICT (id) DO UPDATE SET
      visitor_id = CASE WHEN $2 <> '' THEN $2 ELSE app_devices.visitor_id END,
      app_version = CASE WHEN $3 <> '' THEN $3 ELSE app_devices.app_version END,
      brand = CASE WHEN $4 <> '' THEN $4 ELSE app_devices.brand END,
      model = CASE WHEN $5 <> '' THEN $5 ELSE app_devices.model END,
      os = CASE WHEN $6 <> '' THEN $6 ELSE app_devices.os END,
      ip = CASE WHEN $7 <> '' THEN $7 ELSE app_devices.ip END,
      country = CASE WHEN $8 <> '' THEN $8 ELSE app_devices.country END,
      region = CASE WHEN $9 <> '' THEN $9 ELSE app_devices.region END,
      city = CASE WHEN $10 <> '' THEN $10 ELSE app_devices.city END,
      opens = app_devices.opens + CASE WHEN $11 THEN 0 ELSE 1 END,
      last_seen = CASE WHEN $11 THEN app_devices.last_seen ELSE now() END,
      last_poll = CASE WHEN $11 THEN now() ELSE app_devices.last_poll END,
      can_notify = app_devices.can_notify OR ($11 AND $1 LIKE 'i:%')`, vals);
  // the same phone was counted by its visitor id before the app got an install number: one row, history kept
  if (d.id.startsWith('i:') && VID_RE.test(String(d.visitorId || ''))) await merge('v:' + d.visitorId, d.id);
}

async function merge(oldId: string, newId: string): Promise<void> {
  const old = await db.one<AppDevicesRow>('SELECT * FROM app_devices WHERE id=$1', [oldId]);
  if (!old) return;
  await db.q(`UPDATE app_devices SET first_seen = least(first_seen, $2), opens = opens + $3, orders = orders + $4,
      customer_id = coalesce(customer_id, $5), name = CASE WHEN name = '' THEN $6 ELSE name END, phone = CASE WHEN phone = '' THEN $7 ELSE phone END,
      address = CASE WHEN address = '' THEN $8 ELSE address END, area = CASE WHEN area = '' THEN $9 ELSE area END,
      last_order_code = CASE WHEN last_order_code = '' THEN $10 ELSE last_order_code END WHERE id = $1`,
  [newId, old.first_seen, old.opens, old.orders, old.customer_id, old.name, old.phone, old.address, old.area, old.last_order_code]);
  await db.q('UPDATE orders SET app_device=$2 WHERE app_device=$1', [oldId, newId]);
  await db.q('UPDATE app_notices SET device_id=$2 WHERE device_id=$1', [oldId, newId]).catch(() => {});
  await db.q('DELETE FROM app_devices WHERE id=$1', [oldId]);
}

export type OrderForApp = { id: number; code: string; customer_name: string; phone: string; address: string; area: string; customer_id?: number | null };

/** An order was placed from this phone: remember the customer on the phone's row (what they wrote on the order). */
export async function linkOrder(id: string, o: OrderForApp): Promise<void> {
  if (!id || !o) return;
  const set = await db.one<{ id: number }>(`UPDATE orders SET app_device=$2 WHERE id=$1 AND app_device='' RETURNING id`, [o.id, id]);
  if (!set) return; // already linked
  await db.q(`INSERT INTO app_devices(id) VALUES($1) ON CONFLICT (id) DO NOTHING`, [id]);
  await db.q(`UPDATE app_devices SET orders = orders + 1, last_order_code = $2, name = $3, phone = $4, address = $5, area = $6,
      customer_id = coalesce($7, customer_id) WHERE id = $1`,
  [id, o.code, str(o.customer_name, 80), str(o.phone, 20), str(o.address, 300), str(o.area, 120), o.customer_id || null]);
}

/** The newest personal notifications for a phone (after the last one it showed), marked as handed over. */
export async function pending(id: string, after: number): Promise<{ id: number; title: string; body: string; url: string }[]> {
  if (!id.startsWith('i:')) return [];
  const rows = await db.q<Pick<AppNoticesRow, 'id' | 'title' | 'body' | 'url'>>(
    `SELECT id, title, body, url FROM app_notices WHERE device_id=$1 AND id > $2 AND created_at > now() - interval '7 days' ORDER BY id LIMIT 5`, [id, Math.max(0, after)]);
  if (rows.length) await db.q(`UPDATE app_notices SET delivered_at = coalesce(delivered_at, now()) WHERE device_id=$1 AND id = ANY($2::bigint[])`, [id, rows.map((r) => r.id)]);
  return rows.map((r) => ({ id: Number(r.id), title: r.title, body: r.body, url: r.url }));
}

/** The highest notice number for a phone (a freshly installed app starts from here, so old notices never pop up). */
export async function latestNotice(id: string): Promise<number> {
  const r = await db.one<{ n: number }>('SELECT coalesce(max(id),0)::int AS n FROM app_notices WHERE device_id=$1', [id]);
  return r ? r.n : 0;
}

const TEXT: Record<string, (code: string) => { title: string; body: string }> = {
  shipped: (c) => ({ title: '📦 আপনার পার্সেল রওনা দিয়েছে', body: `অর্ডার ${c} কুরিয়ারে দেওয়া হয়েছে। অবস্থা দেখতে চাপুন।` }),
  delivered: (c) => ({ title: '⭐ পণ্য কেমন লাগলো?', body: `অর্ডার ${c} ডেলিভারি হয়েছে। এক মিনিটে রিভিউ দিন, অন্য ক্রেতাদের অনেক উপকার হবে।` }),
  review_remind: (c) => ({ title: '⭐ রিভিউ দিতে ভুলবেন না', body: `অর্ডার ${c}-এর পণ্যগুলো কেমন লাগলো? চাপলেই রিভিউ দিতে পারবেন, কোনো পাসওয়ার্ড লাগবে না।` }),
};

/** Phones that should hear about this order: the one it was placed from, and any app phone with the same mobile number. */
async function phonesFor(o: { id: number; app_device?: string; phone?: string }): Promise<string[]> {
  const rows = await db.q<{ id: string }>(`SELECT id FROM app_devices WHERE can_notify AND (id = $1 OR (phone <> '' AND phone = $2))`, [o.app_device || '', o.phone || '']);
  return rows.map((r) => r.id);
}

/** An order event for the app (shipped / delivered / review_remind): one notice per phone, never twice. */
export async function notifyOrder(settings: Settings, orderId: number, kind: 'shipped' | 'delivered' | 'review_remind'): Promise<number> {
  if (settings.app_notify_on === '0') return 0;
  if (kind !== 'shipped' && settings.reviews_on === '0') return 0;
  if (kind !== 'shipped' && settings.app_review_ask === '0') return 0;
  const o = await db.one<{ id: number; code: string; phone: string; app_device: string; source: string }>('SELECT id, code, phone, app_device, source FROM orders WHERE id=$1', [orderId]);
  if (!o || o.source === 'pos') return 0;
  const t = TEXT[kind](o.code);
  const url = reviewPath(o.code, settings.session_secret); // opens the order on the phone (jumps to the review box once delivered)
  let n = 0;
  for (const dev of await phonesFor(o)) {
    const r = await db.one(`INSERT INTO app_notices(device_id, kind, title, body, url, order_id) VALUES($1,$2,$3,$4,$5,$6)
      ON CONFLICT (device_id, kind, order_id) WHERE order_id IS NOT NULL DO NOTHING RETURNING id`, [dev, kind, t.title, t.body, url, o.id]);
    if (r) n++;
  }
  return n;
}

/** 3 days after delivery, still no review: one gentle reminder on the app (scheduled job, every few minutes). */
export async function reviewReminders(settings: Settings): Promise<number> {
  if (settings.app_notify_on === '0' || settings.app_review_ask === '0' || settings.reviews_on === '0') return 0;
  const rows = await db.q<{ id: number }>(`SELECT o.id FROM orders o
    WHERE o.status='delivered' AND o.delivered_at BETWEEN now() - interval '10 days' AND now() - interval '3 days'
      AND NOT EXISTS (SELECT 1 FROM reviews r WHERE r.order_id=o.id)
      AND EXISTS (SELECT 1 FROM app_devices d WHERE d.can_notify AND (d.id = o.app_device OR (d.phone <> '' AND d.phone = o.phone)))
      AND NOT EXISTS (SELECT 1 FROM app_notices n WHERE n.order_id=o.id AND n.kind='review_remind')
    ORDER BY o.delivered_at LIMIT 30`);
  let n = 0;
  for (const r of rows) n += await notifyOrder(settings, r.id, 'review_remind');
  return n;
}

// ------------------------------------------------------------ 🔁 free follow-up flows (owner, 2026-11-27, ideas from StoreX)
// Only to phones with the customer app that allow notifications — free, no SMS. Each order is used at most once per
// flow (app_notices' unique order_id + kind), never at night (the scheduled job waits for the morning).
//  • second_buy: a first-time buyer, 7–14 days after the parcel arrived, who has not ordered again
//  • reorder:    45–60 days after a delivered order with nothing ordered since ("need it again?")
const FLOW_TEXT: Record<'second_buy' | 'reorder', (code: string) => { title: string; body: string; url: string }> = {
  second_buy: () => ({ title: '🎁 আবার আসার জন্য ধন্যবাদ', body: 'প্রথম অর্ডারের পণ্যগুলো কেমন চলছে? নতুন আসা পণ্যগুলো একবার দেখে নিন — ক্যাশ অন ডেলিভারি, সারা দেশে।', url: '/products?sort=new' }),
  reorder: (c) => ({ title: '🔁 আবার দরকার?', body: `অর্ডার ${c}-এর পণ্যগুলো আবার লাগলে এক চাপেই দেখে নিন।`, url: '' }),
};

export async function followUps(settings: Settings, hour = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Asia/Dhaka' }).format(new Date()))): Promise<number> {
  if (settings.app_notify_on === '0') return 0;
  if (hour < 10 || hour >= 21) return 0; // daytime only (Dhaka)
  let n = 0;
  const run = async (kind: 'second_buy' | 'reorder', sql: string) => {
    const rows = await db.q<{ id: number; code: string; phone: string; app_device: string }>(sql);
    for (const o of rows) {
      const t = FLOW_TEXT[kind](o.code);
      const url = t.url || reviewPath(o.code, settings.session_secret);
      for (const dev of await phonesFor(o)) {
        const r = await db.one(`INSERT INTO app_notices(device_id, kind, title, body, url, order_id) VALUES($1,$2,$3,$4,$5,$6)
          ON CONFLICT (device_id, kind, order_id) WHERE order_id IS NOT NULL DO NOTHING RETURNING id`, [dev, kind, t.title, t.body, url, o.id]);
        if (r) n++;
      }
    }
  };
  const hasApp = `EXISTS (SELECT 1 FROM app_devices d WHERE d.can_notify AND (d.id = o.app_device OR (d.phone <> '' AND d.phone = o.phone)))`;
  const notYet = (kind: string) => `NOT EXISTS (SELECT 1 FROM app_notices n WHERE n.order_id=o.id AND n.kind='${kind}')`;
  const noNewer = `NOT EXISTS (SELECT 1 FROM orders o2 WHERE o2.phone = o.phone AND o2.id <> o.id AND o2.created_at > o.created_at)`;
  if (settings.app_flow_second !== '0') {
    await run('second_buy', `SELECT o.id, o.code, o.phone, o.app_device FROM orders o
      WHERE o.status='delivered' AND o.source <> 'pos' AND o.delivered_at BETWEEN now() - interval '14 days' AND now() - interval '7 days'
        AND (SELECT count(*) FROM orders o3 WHERE o3.phone = o.phone AND o3.status = 'delivered') = 1
        AND ${noNewer} AND ${hasApp} AND ${notYet('second_buy')}
      ORDER BY o.delivered_at LIMIT 30`);
  }
  if (settings.app_flow_reorder !== '0') {
    await run('reorder', `SELECT o.id, o.code, o.phone, o.app_device FROM orders o
      WHERE o.status='delivered' AND o.source <> 'pos' AND o.delivered_at BETWEEN now() - interval '60 days' AND now() - interval '45 days'
        AND ${noNewer} AND ${hasApp} AND ${notYet('reorder')}
      ORDER BY o.delivered_at LIMIT 30`);
  }
  return n;
}

/** A message the owner writes for one phone (Admin → App users). */
export async function sendOne(id: string, msg: { title: string; body: string; url: string }, staffId: number | null): Promise<boolean> {
  const d = await db.one<{ can_notify: boolean }>('SELECT can_notify FROM app_devices WHERE id=$1', [id]);
  if (!d || !d.can_notify) return false;
  await db.q('INSERT INTO app_notices(device_id, kind, title, body, url, staff_id) VALUES($1,$2,$3,$4,$5,$6)',
    [id, 'manual', str(msg.title, 60), str(msg.body, 200), str(msg.url, 300), staffId]);
  return true;
}

// ------------------------------------------------------------ the admin page's numbers and list
export async function stats() {
  return (await db.one<Record<'total' | 'active7' | 'active30' | 'new7' | 'customers' | 'notify' | 'orders', number>>(`SELECT count(*)::int AS total,
    count(*) FILTER (WHERE greatest(last_seen, coalesce(last_poll, last_seen)) > now() - interval '7 days')::int AS active7,
    count(*) FILTER (WHERE greatest(last_seen, coalesce(last_poll, last_seen)) > now() - interval '30 days')::int AS active30,
    count(*) FILTER (WHERE first_seen > now() - interval '7 days')::int AS new7,
    count(*) FILTER (WHERE phone <> '')::int AS customers, count(*) FILTER (WHERE can_notify)::int AS notify,
    coalesce(sum(orders),0)::int AS orders FROM app_devices`))!;
}

export type DeviceFilter = { q?: string; only?: string };
export async function list(f: DeviceFilter, limit = 50, offset = 0) {
  const where: string[] = [];
  const p: unknown[] = [];
  if (f.q) { p.push('%' + f.q.toLowerCase() + '%'); where.push(`(lower(name || ' ' || phone || ' ' || model || ' ' || brand || ' ' || city || ' ' || region || ' ' || address || ' ' || ip) LIKE $${p.length})`); }
  if (f.only === 'customers') where.push(`phone <> ''`);
  if (f.only === 'notify') where.push('can_notify');
  if (f.only === 'active') where.push(`greatest(last_seen, coalesce(last_poll, last_seen)) > now() - interval '7 days'`);
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const [rows, total] = await Promise.all([
    db.q<AppDevicesRow>(`SELECT * FROM app_devices ${w} ORDER BY greatest(last_seen, coalesce(last_poll, last_seen)) DESC LIMIT ${Math.max(1, limit)} OFFSET ${Math.max(0, offset)}`, p),
    db.one<{ n: number }>(`SELECT count(*)::int AS n FROM app_devices ${w}`, p),
  ]);
  return { rows, total: total!.n };
}

export async function notices(id: string) {
  return db.q<AppNoticesRow>('SELECT * FROM app_notices WHERE device_id=$1 ORDER BY id DESC LIMIT 20', [id]);
}
