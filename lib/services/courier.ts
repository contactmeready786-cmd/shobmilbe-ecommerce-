// Courier companies: Steadfast, Pathao, RedX — create parcels, read status, fraud signals.
import * as db from '../db';
import { fetchJson, int, type FetchResult } from '../util';
import type { Id, Settings } from '../types';

/** What a courier booking reads of an order (an Order from lib/models/orders fits). */
export type ParcelOrder = {
  code: string; customer_name: string; phone: string; address: string; total: number; subtotal?: number;
  paid_amount?: number | null; district?: string | null; thana?: string | null; note?: string | null; email?: string | null;
  items?: { name: string; qty: number; price: number }[] | null;
  courier?: string | null; consignment_id?: string | null; tracking_code?: string | null;
};
/** What the owner picked on the booking form: the area (Pathao city / zone / area, RedX area), weight and a note. */
export type ParcelExtra = { areaText?: string; note?: string; weight?: unknown; city_id?: unknown; zone_id?: unknown; area_id?: unknown; area_name?: string };
/** A booking: the courier's parcel number, or why it didn't go through. */
export type ParcelResult = { ok: true; consignment_id: string; tracking_code: string; status: string } | { ok: false; message: string };
/** A parcel's state at the courier. */
export type ParcelStatus = { ok: true; status: string } | { ok: false; message: string };
/** A list from the courier (Pathao cities / zones / areas / stores, RedX areas). */
type CourierList = { ok: true; rows: { id: number | string; name: string }[] } | { ok: false; message: string; rows: never[] };
/** A tracking link is made from these. */
type TrackOrder = Pick<ParcelOrder, 'phone' | 'consignment_id' | 'tracking_code'>;

const PROVIDERS: Record<string, { label: string; track: (o: TrackOrder) => string }> = {
  steadfast: { label: 'Steadfast (স্টেডফাস্ট)', track: (o) => (o.tracking_code ? `https://steadfast.com.bd/t/${o.tracking_code}` : '') },
  pathao: { label: 'Pathao (পাঠাও)', track: (o) => (o.consignment_id ? `https://merchant.pathao.com/tracking?consignment_id=${o.consignment_id}&phone=${o.phone}` : '') },
  redx: { label: 'RedX (রেডএক্স)', track: (o) => (o.tracking_code ? `https://redx.com.bd/track-parcel/?trackingId=${o.tracking_code}` : '') },
};

// Couriers without an API: the tracking number is typed by hand on the order page.
const MANUAL: Record<string, string> = {
  sundarban: 'সুন্দরবন কুরিয়ার', sa_paribahan: 'এসএ পরিবহন', janani: 'জননী এক্সপ্রেস', korotoa: 'করতোয়া কুরিয়ার', ecourier: 'eCourier',
  paperfly: 'Paperfly', delivery_tiger: 'Delivery Tiger', carrybee: 'CarryBee', self: 'নিজেরা হাতে ডেলিভারি', other: 'অন্য কুরিয়ার',
};
function label(name: string | null | undefined): string { return (name && ((PROVIDERS[name] && PROVIDERS[name].label) || MANUAL[name])) || name || ''; }

function configured(settings: Settings, name: string | null | undefined): boolean {
  if (name === 'steadfast') return !!(settings.steadfast_api_key && settings.steadfast_secret_key);
  if (name === 'pathao') return !!(settings.pathao_client_id && settings.pathao_client_secret && settings.pathao_username && settings.pathao_password && settings.pathao_store_id);
  if (name === 'redx') return !!settings.redx_token;
  return false;
}
function available(settings: Settings) { return Object.keys(PROVIDERS).filter((p) => configured(settings, p)); }

// Map a courier's own status words onto ours (only final states matter).
function mapStatus(courier: string, raw: unknown): 'delivered' | 'returned' | null {
  const s = String(raw || '').toLowerCase();
  if (!s) return null;
  if (courier === 'steadfast') {
    if (s === 'delivered' || s === 'partial_delivered') return 'delivered';
    if (s === 'cancelled') return 'returned';
    return null;
  }
  if (courier === 'pathao') {
    if (s === 'delivered' || s === 'partial_delivery' || s === 'partial delivery') return 'delivered';
    if (s === 'return' || s === 'paid_return' || s === 'returned' || s === 'paid return') return 'returned';
    return null;
  }
  if (courier === 'redx') {
    if (s === 'delivered' || s === 'delivery-completed') return 'delivered';
    if (s.includes('return')) return 'returned';
    return null;
  }
  return null;
}

function codAmount(order: Pick<ParcelOrder, 'total' | 'paid_amount'>): number { return Math.max(0, order.total - (order.paid_amount || 0)); }
function itemText(order: ParcelOrder): string { return (order.items || []).map((i) => `${i.name} x${i.qty}`).join(', ').slice(0, 250); }

// What the couriers' APIs answer (only the fields used; any can be missing). An error answer can come from any call.
type CourierError = { errors?: Record<string, unknown> | unknown[]; message?: unknown; error?: unknown };
type SfCreate = CourierError & { consignment?: { consignment_id?: string | number; tracking_code?: string; status?: string } };
type SfStatus = CourierError & { delivery_status?: string };
type SfBalance = CourierError & { current_balance?: number | string };
type PhToken = CourierError & { access_token?: string; expires_in?: number | string };
/** Pathao wraps every answer in { data } (lists: { data: { data: [...] } }) */
type PhAnswer = CourierError & { data?: Record<string, unknown> & {
  consignment_id?: string | number; order_status?: string; order_status_slug?: string; data?: unknown;
  customer?: Record<string, unknown>; customer_rating?: string;
} };
type RxCreate = CourierError & { tracking_id?: string | number };
type RxInfo = CourierError & { parcel?: { status?: string } };
type RxAreas = CourierError & { areas?: { id: number; name: string; post_code?: string | number }[] };

// ---------------------------------------------------------------- Steadfast
function sfHeaders(s: Settings): Record<string, string> { return <Record<string, string>>{ 'Api-Key': s.steadfast_api_key, 'Secret-Key': s.steadfast_secret_key, 'Content-Type': 'application/json', Accept: 'application/json' }; }
function sfBase(s: Settings) { return (s.steadfast_base_url || 'https://portal.packzy.com/api/v1').replace(/\/+$/, ''); }

async function steadfastCreate(order: ParcelOrder, s: Settings, extra: ParcelExtra): Promise<ParcelResult> {
  const body: Record<string, unknown> = {
    invoice: order.code,
    recipient_name: order.customer_name.slice(0, 100),
    recipient_phone: order.phone,
    recipient_address: [order.address, extra.areaText].filter(Boolean).join(', ').slice(0, 250),
    cod_amount: codAmount(order),
    note: (extra.note || order.note || '').slice(0, 250),
    item_description: itemText(order),
  };
  if (order.email) body.recipient_email = order.email;
  const r = await fetchJson<SfCreate>(`${sfBase(s)}/create_order`, { method: 'POST', headers: sfHeaders(s), body: JSON.stringify(body) });
  const c = r.data && r.data.consignment;
  if (r.ok && c && c.consignment_id) {
    return { ok: true, consignment_id: String(c.consignment_id), tracking_code: String(c.tracking_code || ''), status: String(c.status || 'in_review') };
  }
  return { ok: false, message: errorText(r) };
}
async function steadfastStatus(order: ParcelOrder, s: Settings): Promise<ParcelStatus> {
  const path = order.consignment_id ? `status_by_cid/${encodeURIComponent(order.consignment_id)}` : `status_by_invoice/${encodeURIComponent(order.code)}`;
  const r = await fetchJson<SfStatus>(`${sfBase(s)}/${path}`, { headers: sfHeaders(s) });
  if (r.ok && r.data && r.data.delivery_status) return { ok: true, status: String(r.data.delivery_status) };
  return { ok: false, message: errorText(r) };
}
async function steadfastBalance(s: Settings): Promise<{ ok: boolean; message: string }> {
  const r = await fetchJson<SfBalance>(`${sfBase(s)}/get_balance`, { headers: sfHeaders(s) });
  if (r.ok && r.data && r.data.current_balance !== undefined) return { ok: true, message: `সংযোগ ঠিক আছে। Steadfast ব্যালেন্স: ৳${r.data.current_balance}` };
  return { ok: false, message: errorText(r) };
}

// ---------------------------------------------------------------- Pathao
function phBase(s: Settings) { return s.pathao_sandbox === '1' ? 'https://courier-api-sandbox.pathao.com' : 'https://api-hermes.pathao.com'; }
async function pathaoToken(s: Settings, force = false): Promise<string> {
  if (!force && s.pathao_token && Number(s.pathao_token_expires) > Date.now() + 60e3) return s.pathao_token;
  const r = await fetchJson<PhToken>(`${phBase(s)}/aladdin/api/v1/issue-token`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ client_id: s.pathao_client_id, client_secret: s.pathao_client_secret, username: s.pathao_username, password: s.pathao_password, grant_type: 'password' }),
  });
  if (r.ok && r.data && r.data.access_token) {
    const expires = Date.now() + (int(r.data.expires_in) || 3600) * 1000;
    await db.setMany({ pathao_token: r.data.access_token, pathao_token_expires: String(expires) });
    s.pathao_token = r.data.access_token;
    s.pathao_token_expires = String(expires);
    return r.data.access_token;
  }
  throw new Error('Pathao লগইন হয়নি: ' + errorText(r));
}
async function pathaoFetch(s: Settings, path: string, opts: { method?: string; body?: string; headers?: Record<string, string> } = {}): Promise<FetchResult<PhAnswer>> {
  let token = await pathaoToken(s);
  const go = (t: string) => fetchJson<PhAnswer>(`${phBase(s)}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${t}`, ...(opts.headers || {}) } });
  let r = await go(token);
  if (r.status === 401) { token = await pathaoToken(s, true); r = await go(token); }
  return r;
}
async function pathaoCreate(order: ParcelOrder, s: Settings, extra: ParcelExtra): Promise<ParcelResult> {
  const body: Record<string, unknown> = {
    store_id: int(s.pathao_store_id),
    merchant_order_id: order.code,
    recipient_name: order.customer_name.slice(0, 100),
    recipient_phone: order.phone,
    recipient_address: [order.address, extra.areaText].filter(Boolean).join(', ').slice(0, 220),
    delivery_type: 48,
    item_type: 2,
    special_instruction: (extra.note || order.note || '').slice(0, 250),
    item_quantity: (order.items || []).reduce((n, i) => n + i.qty, 0) || 1,
    item_weight: String(Math.max(0.5, Number(extra.weight) || 0.5)),
    amount_to_collect: codAmount(order),
    item_description: itemText(order),
  };
  if (int(extra.city_id)) body.recipient_city = int(extra.city_id);
  if (int(extra.zone_id)) body.recipient_zone = int(extra.zone_id);
  if (int(extra.area_id)) body.recipient_area = int(extra.area_id);
  const r = await pathaoFetch(s, '/aladdin/api/v1/orders', { method: 'POST', body: JSON.stringify(body) });
  const d = r.data && r.data.data;
  if (r.ok && d && d.consignment_id) return { ok: true, consignment_id: String(d.consignment_id), tracking_code: String(d.consignment_id), status: String(d.order_status || 'Pending') };
  return { ok: false, message: errorText(r) };
}
async function pathaoStatus(order: ParcelOrder, s: Settings): Promise<ParcelStatus> {
  if (!order.consignment_id) return { ok: false, message: 'Consignment ID নেই।' };
  const r = await pathaoFetch(s, `/aladdin/api/v1/orders/${encodeURIComponent(order.consignment_id)}`);
  const d = r.data && r.data.data;
  if (r.ok && d && (d.order_status || d.order_status_slug)) return { ok: true, status: String(d.order_status_slug || d.order_status) };
  return { ok: false, message: errorText(r) };
}
async function pathaoList(s: Settings, kind: string, parentId?: Id): Promise<CourierList> {
  const path = kind === 'cities' ? '/aladdin/api/v1/city-list'
    : kind === 'zones' ? `/aladdin/api/v1/cities/${int(parentId)}/zone-list`
      : kind === 'areas' ? `/aladdin/api/v1/zones/${int(parentId)}/area-list` : '/aladdin/api/v1/stores';
  const r = await pathaoFetch(s, path);
  const d = r.data && r.data.data;
  const rows: unknown = d && (d.data || d);
  if (!r.ok || !Array.isArray(rows)) return { ok: false, message: errorText(r), rows: [] };
  type Place = { city_id?: number; zone_id?: number; area_id?: number; store_id?: number; city_name?: string; zone_name?: string; area_name?: string; store_name?: string };
  return {
    ok: true,
    rows: (rows as Place[]).map((x) => ({ id: (x.city_id || x.zone_id || x.area_id || x.store_id)!, name: (x.city_name || x.zone_name || x.area_name || x.store_name)! })),
  };
}
// Delivery success rate of a phone number across Pathao merchants.
/** a number's delivery record at Pathao */
export type PathaoRecord = { ok: boolean; message?: string; total?: number; success?: number; rating?: string; raw?: unknown };
async function pathaoSuccess(phone: string, s: Settings): Promise<PathaoRecord> {
  const r = await pathaoFetch(s, '/aladdin/api/v1/user/success', { method: 'POST', body: JSON.stringify({ phone }) });
  if (!r.ok || !r.data) return { ok: false, message: errorText(r) };
  const d = (r.data.data || r.data) as NonNullable<PhAnswer['data']>;
  const c = (d.customer || d) as Record<string, unknown>;
  const total = int(c.total_delivery ?? c.total_parcels ?? c.total);
  const success = int(c.successful_delivery ?? c.success_parcels ?? c.delivered);
  return { ok: true, total, success, rating: d.customer_rating || '', raw: d };
}

// ---------------------------------------------------------------- RedX
function rxBase(s: Settings) { return s.redx_sandbox === '1' ? 'https://sandbox.redx.com.bd/v1.0.0-beta' : 'https://openapi.redx.com.bd/v1.0.0-beta'; }
function rxHeaders(s: Settings): Record<string, string> { return <Record<string, string>>{ 'API-ACCESS-TOKEN': `Bearer ${s.redx_token}`, 'Content-Type': 'application/json', Accept: 'application/json' }; }
async function redxCreate(order: ParcelOrder, s: Settings, extra: ParcelExtra): Promise<ParcelResult> {
  if (!int(extra.area_id)) return { ok: false, message: 'RedX এর জন্য ডেলিভারি এরিয়া বাছাই করুন।' };
  const body: Record<string, unknown> = {
    customer_name: order.customer_name.slice(0, 100),
    customer_phone: order.phone,
    delivery_area: extra.area_name || order.thana || order.district,
    delivery_area_id: int(extra.area_id),
    customer_address: [order.address, extra.areaText].filter(Boolean).join(', ').slice(0, 250),
    merchant_invoice_id: order.code,
    cash_collection_amount: String(codAmount(order)),
    parcel_weight: Math.round(Math.max(0.5, Number(extra.weight) || 0.5) * 1000),
    instruction: (extra.note || order.note || '').slice(0, 250),
    value: order.subtotal,
    parcel_details_json: (order.items || []).map((i) => ({ name: i.name.slice(0, 80), category: 'general', value: i.price * i.qty })),
  };
  if (int(s.redx_pickup_store_id)) body.pickup_store_id = int(s.redx_pickup_store_id);
  const r = await fetchJson<RxCreate>(`${rxBase(s)}/parcel`, { method: 'POST', headers: rxHeaders(s), body: JSON.stringify(body) });
  if (r.ok && r.data && r.data.tracking_id) return { ok: true, consignment_id: String(r.data.tracking_id), tracking_code: String(r.data.tracking_id), status: 'pickup-pending' };
  return { ok: false, message: errorText(r) };
}
async function redxStatus(order: ParcelOrder, s: Settings): Promise<ParcelStatus> {
  const r = await fetchJson<RxInfo>(`${rxBase(s)}/parcel/info/${encodeURIComponent(order.tracking_code || order.consignment_id || '')}`, { headers: rxHeaders(s) });
  const p = r.data && r.data.parcel;
  if (r.ok && p && p.status) return { ok: true, status: String(p.status) };
  return { ok: false, message: errorText(r) };
}
async function redxAreas(s: Settings, district?: string): Promise<CourierList> {
  const r = await fetchJson<RxAreas>(`${rxBase(s)}/areas${district ? `?district_name=${encodeURIComponent(district)}` : ''}`, { headers: rxHeaders(s) });
  const rows = r.data && r.data.areas;
  if (!r.ok || !Array.isArray(rows)) return { ok: false, message: errorText(r), rows: [] };
  return { ok: true, rows: rows.map((a) => ({ id: a.id, name: a.name + (a.post_code ? ` (${a.post_code})` : '') })) };
}

// ---------------------------------------------------------------- common
function errorText(r: FetchResult<CourierError>): string {
  if (r.status === 0) return 'কুরিয়ার সার্ভারে পৌঁছানো যায়নি: ' + r.text;
  const d = r.data;
  if (d) {
    if (d.errors) {
      const e = d.errors;
      return Object.values(e).flat().join(' ') || JSON.stringify(e).slice(0, 300);
    }
    if (d.message) return String(d.message);
    if (d.error) return String(d.error);
  }
  return `HTTP ${r.status}: ${String(r.text || '').slice(0, 200)}`;
}

async function send(order: ParcelOrder, courier: string, settings: Settings, extra: ParcelExtra = {}): Promise<ParcelResult> {
  if (!PROVIDERS[courier]) return { ok: false, message: 'অজানা কুরিয়ার।' };
  if (!configured(settings, courier)) return { ok: false, message: `${PROVIDERS[courier].label} এর API সেটআপ করা নেই। Admin → কুরিয়ার থেকে সেটআপ করুন।` };
  if (order.consignment_id) return { ok: false, message: `এই অর্ডার আগেই ${order.courier} এ পাঠানো হয়েছে (${order.consignment_id})।` };
  let res: ParcelResult;
  try {
    res = courier === 'steadfast' ? await steadfastCreate(order, settings, extra)
      : courier === 'pathao' ? await pathaoCreate(order, settings, extra)
        : await redxCreate(order, settings, extra);
  } catch (e) {
    res = { ok: false, message: (e as Error).message };
  }
  await db.logIntegration(courier, 'create_parcel', res.ok, res.ok ? `${order.code} → ${res.consignment_id}` : res.message, order.code);
  return res;
}
async function status(order: ParcelOrder, settings: Settings): Promise<ParcelStatus> {
  if (!order.courier || !configured(settings, order.courier)) return { ok: false, message: 'কুরিয়ার সেটআপ নেই।' };
  let res: ParcelStatus;
  try {
    res = order.courier === 'steadfast' ? await steadfastStatus(order, settings)
      : order.courier === 'pathao' ? await pathaoStatus(order, settings) : await redxStatus(order, settings);
  } catch (e) {
    res = { ok: false, message: (e as Error).message };
  }
  if (!res.ok) await db.logIntegration(String(order.courier), 'status', false, res.message, order.code);
  return res;
}
async function test(courier: string, settings: Settings): Promise<{ ok: boolean; message: string }> {
  try {
    if (courier === 'steadfast') return await steadfastBalance(settings);
    if (courier === 'pathao') {
      await pathaoToken(settings, true);
      const st = await pathaoList(settings, 'stores');
      if (!st.ok) return { ok: true, message: 'লগইন ঠিক আছে, কিন্তু স্টোর লিস্ট আনা যায়নি: ' + st.message };
      const found = st.rows.find((x) => String(x.id) === String(settings.pathao_store_id));
      return { ok: true, message: `সংযোগ ঠিক আছে। আপনার স্টোর: ${st.rows.map((x) => `${x.name} (ID ${x.id})`).join(', ')}${found ? '' : ' — সেটিংসে দেওয়া Store ID এই লিস্টে নেই, ঠিক করে নিন।'}` };
    }
    if (courier === 'redx') {
      const a = await redxAreas(settings, 'Dhaka');
      return a.ok ? { ok: true, message: `সংযোগ ঠিক আছে। ঢাকায় ${a.rows.length}টি এরিয়া পাওয়া গেছে।` } : a;
    }
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
  return { ok: false, message: 'অজানা কুরিয়ার।' };
}

export { MANUAL, label, PROVIDERS, configured, available, mapStatus, send, status, test, pathaoList, pathaoSuccess, redxAreas, codAmount };
