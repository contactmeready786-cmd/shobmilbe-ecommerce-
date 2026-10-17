// 💳 Online payment (bKash, SSLCommerz) and the couriers' / call company's status updates (webhooks). Money and order
// status are only changed after the payment company itself confirms (bkashExecute / sslValidate), never on the
// browser's word. Served by app/pay/[...step] and app/webhook/* (lib/next/api.ts runs the gate first). Moved here
// from lib/site.ts unchanged.
import * as db from '../db';
import * as O from '../models/orders';
import * as payments from '../services/payments';
import * as courier from '../services/courier';
import * as security from '../security';
import * as $services_autocall from '../services/autocall';
import { siteUrl } from '../gate';
import { str } from '../util';
import { json, type ApiCtx } from '../next/api';
import type { Body, Loose } from '../types';

/** "See over there" (303), never kept — the original code's redirect. */
const see = (to: string) => new Response(null, { status: 303, headers: { Location: to, 'Cache-Control': 'no-store' } });
/** The original code's plain answer (never kept, the shop's security headers). */
const text = (status: number, body: string, type: string, extra: Record<string, string> = {}) =>
  new Response(body, { status, headers: { 'Content-Type': type, 'Cache-Control': 'no-store', ...security.BASE_HEADERS, ...extra } });

export async function pay(ctx: ApiCtx) {
  const { path, query, settings } = ctx;
  const method = ctx.request.method;
  const site = siteUrl(ctx.req, settings);
  let m = path.match(/^\/pay\/([A-Z0-9]{4,12})$/i);
  if (m && method === 'GET') {
    const order = await O.getOrder({ code: m[1].toUpperCase() });
    if (!order) return see('/track');
    if (order.payment_status === 'paid' || O.RELEASED.has(order.status)) return see(`/order/${order.code}`);
    let r;
    try {
      r = order.payment === 'bkash' ? await payments.bkashCreate(order, settings, site)
        : order.payment === 'ssl' ? await payments.sslCreate(order, settings, site) : { ok: false };
    } catch (e: Loose) {
      r = { ok: false, message: e.message };
      await db.logIntegration(order.payment, 'create', false, e.message, order.code);
    }
    return r.ok ? see(r.url) : see(`/order/${order.code}?new=1&pay=failed`);
  }
  if (path === '/pay/bkash/callback') {
    const paymentID = str(query.get('paymentID'), 80);
    const status = query.get('status');
    const p = paymentID ? await db.one(`SELECT * FROM payments WHERE gateway_ref=$1 AND method='bkash'`, [paymentID]) : null;
    if (!p) return see('/track');
    const order = await O.getOrder({ id: p.order_id });
    if (status === 'success') {
      try {
        const r = await payments.bkashExecute(paymentID, settings);
        if (r.ok && r.amount >= Number(p.amount) - 1) {
          await payments.recordSuccess(p, { trxID: r.trxID, amount: r.amount, raw: r.raw, label: 'বিকাশ' });
          return see(`/order/${order!.code}?new=1`);
        }
        await db.logIntegration('bkash', 'execute', false, r.message, order!.code);
      } catch (e: Loose) {
        await db.logIntegration('bkash', 'execute', false, e.message, order!.code);
      }
    }
    await db.q(`UPDATE payments SET status=$1, updated_at=now() WHERE id=$2 AND status<>'paid'`, [status === 'cancel' ? 'cancelled' : 'failed', p.id]);
    return see(`/order/${order!.code}?new=1&pay=failed`);
  }
  m = path.match(/^\/pay\/ssl\/(success|fail|cancel|ipn)$/);
  if (m) {
    const b = method === 'POST' ? await ctx.body() : Object.fromEntries(query);
    const tranId = str(b.tran_id, 80);
    const p = tranId ? await db.one(`SELECT * FROM payments WHERE gateway_ref=$1 AND method='ssl'`, [tranId]) : null;
    if (!p) return m[1] === 'ipn' ? text(200, 'ok', 'text/plain') : see('/track');
    const order = await O.getOrder({ id: p.order_id });
    if ((m[1] === 'success' || m[1] === 'ipn') && b.val_id) {
      const v = await payments.sslValidate(str(b.val_id, 120), settings);
      if (v.ok && v.tranId === tranId && v.amount >= p.amount - 1) {
        await payments.recordSuccess(p, { trxID: v.trxID, amount: v.amount, raw: v.raw, label: `কার্ড/মোবাইল (${v.cardType})` });
        return m[1] === 'ipn' ? text(200, 'ok', 'text/plain') : see(`/order/${order!.code}?new=1`);
      }
      await db.logIntegration('sslcommerz', 'validate', false, JSON.stringify(v.raw).slice(0, 300), order!.code);
    }
    if (m[1] !== 'ipn') await db.q(`UPDATE payments SET status=$1, updated_at=now() WHERE id=$2 AND status<>'paid'`, [m[1] === 'cancel' ? 'cancelled' : 'failed', p.id]);
    return m[1] === 'ipn' ? text(200, 'ok', 'text/plain') : see(`/order/${order!.code}?new=1&pay=failed`);
  }
  return see('/');
}

// ---------------------------------------------------------------- courier webhooks
async function applyCourierUpdate(orderRow?: Loose, courierName?: Loose, rawStatus?: Loose) {
  await O.setCourierStatus(orderRow.id, rawStatus);
  const mapped = courier.mapStatus(courierName, rawStatus);
  if (mapped && mapped !== orderRow.status) {
    try {
      const s = await O.setStatus(orderRow.id, mapped, null);
      if (s.changed) await db.logActivity(null, 'order_status', 'order', orderRow.id, `${s.prev} → ${mapped} (${courierName} ওয়েবহুক)`);
    } catch (e: Loose) { await db.logIntegration(courierName, 'webhook', false, e.message, orderRow.code); }
  }
}
export async function steadfast(ctx: ApiCtx) {
  const settings = ctx.settings;
  const auth = String(ctx.req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!settings.steadfast_webhook_token || !security.safeEqual(auth, settings.steadfast_webhook_token)) return json(401, { status: 'error', message: 'Unauthorized' });
  const b = await ctx.body();
  const cid = String(b.consignment_id || '');
  const order = await db.one(`SELECT id, code, status FROM orders WHERE (consignment_id=$1 AND $1<>'') OR code=$2 LIMIT 1`, [cid, String(b.invoice || '')]);
  if (order && b.status) await applyCourierUpdate(order, 'steadfast', String(b.status));
  await db.logIntegration('steadfast', 'webhook', !!order, `${b.notification_type || ''} ${cid} ${b.status || ''}`, order ? order.code : '');
  return json(200, { status: 'success', message: 'Webhook received successfully.' });
}
export async function pathao(ctx: ApiCtx) {
  const settings = ctx.settings;
  const sig = String(ctx.req.headers['x-pathao-signature'] || '');
  const headers = { 'X-Pathao-Merchant-Webhook-Integration-Secret': 'f3992ecc-59da-4cbe-a049-a13da2018d51' };
  if (!settings.pathao_webhook_secret || !security.safeEqual(sig, settings.pathao_webhook_secret)) return text(401, '{"status":"unauthorized"}', 'application/json');
  const b = await ctx.body();
  const cid = String(b.consignment_id || '');
  const order = cid || b.merchant_order_id ? await db.one(`SELECT id, code, status FROM orders WHERE (consignment_id=$1 AND $1<>'') OR code=$2 LIMIT 1`, [cid, String(b.merchant_order_id || '')]) : null;
  const st = b.order_status || b.order_status_slug || (b.event ? String(b.event).replace(/^order\./, '') : '');
  if (order && st) await applyCourierUpdate(order, 'pathao', String(st));
  await db.logIntegration('pathao', 'webhook', true, `${b.event || ''} ${cid} ${st}`, order ? order.code : '');
  return text(202, '{"status":"received"}', 'application/json; charset=utf-8', headers);
}

// 📞 অটো কল: the call company tells us what the customer pressed (JSON, form or ?query)
export async function autocallHook(ctx: ApiCtx) {
  const token = ctx.path.split('/')[3];
  const b: Body = ctx.request.method === 'POST' ? await ctx.body() : {};
  for (const [k, v] of ctx.query) if (!(k in b)) b[k] = v;
  const r = await $services_autocall.hook(ctx.settings, token, b);
  return json(r.status, r.body);
}
