// SMS to customers (Admin → মার্কেটিং → কাস্টমারকে SMS). Works with the common Bangladeshi SMS companies
// (you buy SMS credit from them and paste the API key here), or any company that gives a "link" API.
// Sent: when an order comes in, is confirmed, handed to the courier, delivered (each with its own switch and text).
// Every SMS is written to sms_log (success or the company's error), so the owner can see what happened.
import * as db from '../db';
import { safeFetch } from './safefetch';
import { normalizePhone, validPhone, str, bn } from '../util';
import type { Id, Settings } from '../types';

/** One SMS company the shop can use. */
type Provider = { label: string; site: string; needsSender: boolean };
/** Is SMS ready to go out, and through which company (or why not)? */
export type SmsReady = { ok: true; p: string; why?: undefined } | { ok: false; why: string; p?: undefined };
/** What came of one SMS (always written to sms_log): sent or not, the company's message, its id (own-SIM apps). */
export type SmsResult = { ok: boolean; msg: string; id?: string };
/** What kind of SMS it is (for the log and the offer-SMS allowance), and which order / staff member it belongs to. */
export type SmsMeta = { kind?: string; orderId?: Id; staffId?: Id };
/** What an order SMS reads of the order. */
type SmsOrder = { id?: number; code?: string; phone?: string; total?: number | string; customer_name?: string; name?: string; tracking_code?: string | null; points_earned?: number | null };

const PROVIDERS: Record<string, Provider> = {
  // 📱 the owner's own phone + SIM (e.g. Grameenphone) sends the SMS through the free "SMS Gateway for Android" app
  // (sms-gate.app, cloud mode). Username → Sender ID box, Password → API Key box. Each SMS costs the SIM's normal rate.
  android: { label: '📱 নিজের ফোনের SIM দিয়ে (SMS Gateway অ্যাপ, ফ্রি)', site: 'https://sms-gate.app', needsSender: true },
  // 📱 textbee.dev (owner, 2026-10): the same idea — an Android phone with a SIM sends the SMS — but steadier.
  // Free plan: 1 phone, about 50 SMS a day / 300 a month. API Key box = textbee API key; Sender ID box = Device ID (optional).
  textbee: { label: '📱 নিজের ফোনের SIM দিয়ে (textbee.dev, ফ্রি)', site: 'https://textbee.dev', needsSender: false },
  bulksmsbd: { label: 'BulkSMSBD (bulksmsbd.net)', site: 'https://bulksmsbd.net', needsSender: true },
  smsnetbd: { label: 'Alpha SMS (sms.net.bd)', site: 'https://sms.net.bd', needsSender: false },
  greenweb: { label: 'Greenweb (greenweb.com.bd)', site: 'https://greenweb.com.bd', needsSender: false },
  custom: { label: 'অন্য কোম্পানি (নিজের লিংক)', site: '', needsSender: false },
};

function ready(settings: Settings): SmsReady {
  const p: string = PROVIDERS[settings.sms_provider as string] ? settings.sms_provider as string : 'bulksmsbd';
  if (settings.sms_on !== '1') return { ok: false, why: 'SMS বন্ধ আছে' };
  if (p === 'custom') return /^https:\/\//i.test(settings.sms_custom_url || '') ? { ok: true, p } : { ok: false, why: 'কোম্পানির লিংক (https://…) দিন' };
  if (!settings.sms_api_key) return { ok: false, why: 'API key দেওয়া নেই' };
  if (PROVIDERS[p].needsSender && !settings.sms_sender_id) return { ok: false, why: 'Sender ID দেওয়া নেই' };
  return { ok: true, p };
}
// 01712345678 → 8801712345678
const intl = (phone: unknown) => '88' + normalizePhone(phone);
// SMS length: Bangla text = 70 characters per SMS part (67 when it is long), English = 160 (153).
function parts(text: unknown): number {
  const t = String(text || '');
  const uni = /[^\x00-\x7F]/.test(t);
  const one = uni ? 70 : 160; const multi = uni ? 67 : 153;
  return t.length <= one ? 1 : Math.ceil(t.length / multi);
}

function buildRequest(settings: Settings, p: string, to: string, message: string): string {
  const key = settings.sms_api_key || '';
  if (p === 'bulksmsbd') {
    return 'https://bulksmsbd.net/api/smsapi?' + new URLSearchParams({ api_key: key, type: 'text', number: to, senderid: settings.sms_sender_id || '', message });
  }
  if (p === 'smsnetbd') return 'https://api.sms.net.bd/sendsms?' + new URLSearchParams({ api_key: key, msg: message, to });
  if (p === 'greenweb') return 'https://api.greenweb.com.bd/api.php?' + new URLSearchParams({ token: key, to, message });
  // custom: the owner's link with {to}, {message}, {key}, {sender}
  return String(settings.sms_custom_url).replace(/\{(to|message|key|sender)\}/g, (_: string, k: string) => encodeURIComponent(
    ({ to, message, key, sender: settings.sms_sender_id || '' } as Record<string, string>)[k]));
}
// The company's answer → ok / its message
/** an SMS company's JSON answer: the fields the companies above send (someone else's JSON, so every one may be missing) */
type SmsAnswer = { id?: string | number; state?: string; message?: string; error?: string | number; data?: SmsAnswer; success?: boolean; failureCount?: unknown;
  successCount?: unknown; smsBatchId?: string; response_code?: string | number; success_message?: string; error_message?: string; msg?: string };
function readAnswer(p: string, status: number, text: unknown): SmsResult {
  const t = String(text || '').slice(0, 400);
  let j: SmsAnswer | null = null;
  try { j = JSON.parse(t) as SmsAnswer; } catch (_) { /* not JSON */ }
  if (p === 'textbee' && (status === 401 || status === 403)) return { ok: false, msg: 'textbee-র API Key মিলছে না — textbee.dev ড্যাশবোর্ড থেকে নতুন Key কপি করুন' };
  if (p === 'android' && status === 401) return { ok: false, msg: 'অ্যাপের Username/Password মিলছে না — অ্যাপের Cloud Server অংশ থেকে আবার কপি করুন' };
  if (status < 200 || status >= 300) return { ok: false, msg: `HTTP ${status}: ${t.slice(0, 150)}` };
  if (p === 'android') return j && j.id ? { ok: true, id: String(j.id), msg: 'ফোনে পাঠানো হয়েছে (' + (j.state || 'Pending') + ')' } : { ok: false, msg: String((j && (j.message || j.error)) || t.slice(0, 150)) };
  if (p === 'textbee') {
    const d: SmsAnswer = (j && (j.data || j)) || {};
    if (d.success === false || (Number(d.failureCount) > 0 && !Number(d.successCount))) return { ok: false, msg: String(d.message || d.error || t.slice(0, 150)) };
    return { ok: true, id: String(d.smsBatchId || ''), msg: 'ফোনে পাঠানো হয়েছে' };
  }
  if (p === 'bulksmsbd') return j && Number(j.response_code) === 202 ? { ok: true, msg: j.success_message || 'পাঠানো হয়েছে' } : { ok: false, msg: String((j && (j.error_message || j.response_code)) || t.slice(0, 150)) };
  if (p === 'smsnetbd') return j && Number(j.error) === 0 ? { ok: true, msg: j.msg || 'পাঠানো হয়েছে' } : { ok: false, msg: String((j && (j.msg || j.error)) || t.slice(0, 150)) };
  if (p === 'greenweb') return /ok/i.test(t) && !/error/i.test(t) ? { ok: true, msg: t.slice(0, 120) } : { ok: false, msg: t.slice(0, 150) };
  return /error|invalid|fail/i.test(t) ? { ok: false, msg: t.slice(0, 150) } : { ok: true, msg: t.slice(0, 120) || 'পাঠানো হয়েছে' };
}

// Tests only (tests/*.db.test.ts): replace the phone / SMS company with a fake, so a test can read the code that
// "went out" without sending a real SMS. Never set by the shop itself.
type FakeSender = (phone: string, text: string) => Promise<{ ok: boolean; msg: string; id?: string }>;
let fakeSender: FakeSender | null = null;
function setFakeSender(fn: FakeSender | null): void { fakeSender = fn; }

// Send one SMS. Never throws — returns { ok, msg } and writes the log.
async function send(settings: Settings, phone: unknown, text: unknown, { kind = 'manual', orderId = null, staffId = null }: SmsMeta = {}): Promise<SmsResult> {
  const r = ready(settings);
  const ph = normalizePhone(phone);
  const message = str(text, 640);
  let result: SmsResult;
  if (!r.ok) result = { ok: false, msg: r.why };
  else if (!validPhone(ph)) result = { ok: false, msg: 'মোবাইল নম্বর ঠিক নেই' };
  else if (!message) result = { ok: false, msg: 'লেখা খালি' };
  else if (fakeSender) {
    try { result = await fakeSender(ph, message); } catch (e) { result = { ok: false, msg: 'সংযোগ হয়নি: ' + String((e as Error)?.message || e).slice(0, 120) }; }
  } else {
    try {
      const res = r.p === 'textbee'
        ? await safeFetch('https://api.textbee.dev/api/v1/gateway/send-sms', {
          method: 'POST', maxBytes: 64 * 1024, timeoutMs: 10000, maxRedirects: 0,
          headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'x-api-key': String(settings.sms_api_key || '').trim() },
          body: JSON.stringify({ recipients: ['+' + intl(ph)], message, ...(/^[A-Za-z0-9_-]{6,60}$/.test(String(settings.sms_sender_id || '').trim()) ? { deviceId: String(settings.sms_sender_id).trim() } : {}) }),
        })
        : r.p === 'android'
        ? await safeFetch('https://api.sms-gate.app/3rdparty/v1/messages', {
          method: 'POST', maxBytes: 64 * 1024, timeoutMs: 10000, maxRedirects: 0,
          headers: { 'Content-Type': 'application/json', Accept: 'application/json',
            Authorization: 'Basic ' + Buffer.from(`${String(settings.sms_sender_id || '').trim()}:${String(settings.sms_api_key || '').trim()}`).toString('base64') },
          body: JSON.stringify({ textMessage: { text: message }, phoneNumbers: ['+' + intl(ph)] }),
        })
        : await safeFetch(buildRequest(settings, r.p, intl(ph), message), { maxBytes: 64 * 1024, timeoutMs: 10000, maxRedirects: 2 });
      result = readAnswer(r.p, res.status, res.body.toString('utf8'));
    } catch (e) {
      result = { ok: false, msg: 'সংযোগ হয়নি: ' + String((e as Error)?.message || e).slice(0, 120) };
    }
  }
  await db.q('INSERT INTO sms_log(phone, body, kind, ok, detail, order_id, staff_id) VALUES($1,$2,$3,$4,$5,$6,$7)',
    [ph || String(phone || '').slice(0, 20), message, kind, result.ok, str(result.msg, 300), orderId, staffId]).catch(() => {});
  return result;
}

// 📣 Offer SMS have their own small allowance, so a free own-SIM plan (e.g. textbee: ~50 a day, 300 a month) is never
// used up by offers — checkout codes and order SMS always have room. 0 = no limit (for a paid SMS company).
const MKT_KINDS = ['bulk'];
async function mktLeft(settings: Settings) {
  const perDay = Math.max(0, Number(settings.sms_mkt_day) || 0);
  const perMonth = Math.max(0, Number(settings.sms_mkt_month) || 0);
  const r = await db.one<{ d: number; m: number }>(`SELECT count(*) FILTER (WHERE created_at >= date_trunc('day', now() AT TIME ZONE 'Asia/Dhaka') AT TIME ZONE 'Asia/Dhaka')::int AS d,
      count(*) FILTER (WHERE created_at >= date_trunc('month', now() AT TIME ZONE 'Asia/Dhaka') AT TIME ZONE 'Asia/Dhaka')::int AS m
    FROM sms_log WHERE ok AND kind = ANY($1::text[])`, [MKT_KINDS]).catch(() => ({ d: 0, m: 0 }));
  const day = perDay ? Math.max(0, perDay - r!.d) : Infinity;
  const month = perMonth ? Math.max(0, perMonth - r!.m) : Infinity;
  return { left: Math.min(day, month), day, month, usedDay: r!.d, usedMonth: r!.m, perDay, perMonth };
}

// Order messages: {shop} {code} {total} {name} {tracking} {points} {link} (the order's page — reviews are given there)
const ORDER_EVENTS: Record<string, string> = { placed: 'অর্ডার এলে', confirmed: 'কনফার্ম হলে', shipped: 'কুরিয়ারে দিলে', delivered: 'ডেলিভারি হলে' };
function fill(tpl: unknown, o: SmsOrder, settings: Settings, site = ''): string {
  const track = o.tracking_code ? `ট্র্যাকিং: ${o.tracking_code}` : site ? `ট্র্যাক করুন: ${site.replace(/\/+$/, '')}/order/${o.code}` : '';
  const pts = (o.points_earned || 0) > 0 ? ` আপনি ${o.points_earned} পয়েন্ট পেয়েছেন।` : '';
  return String(tpl || '').replace(/\{(shop|code|total|name|tracking|points|link)\}/g, (_, k: string) => ((<Record<string, string>>{
    shop: settings.store_name || '', code: o.code || '', total: `৳${Math.round(Number(o.total || 0))}`, name: String(o.customer_name || o.name || '').split(' ')[0],
    tracking: track, points: pts, link: site ? `${site.replace(/\/+$/, '')}/order/${o.code}` : '',
  })[k])).replace(/\s+/g, ' ').trim();
}
// Called after an order is placed or its status changes. Quietly does nothing when that SMS is switched off.
async function orderEvent(settings: Settings, event: string, order: (SmsOrder & { id: number }) | null | undefined, site = ''): Promise<SmsResult | null> {
  if (!ORDER_EVENTS[event] || settings[`sms_on_${event}`] !== '1' || !ready(settings).ok || !order) return null;
  // the same order never gets the same message twice (e.g. status set to "confirmed" again)
  const dup = await db.one<{ "?column?": number | null }>('SELECT 1 FROM sms_log WHERE order_id=$1 AND kind=$2 AND ok', [order.id, 'order_' + event]).catch(() => null);
  if (dup) return null;
  return send(settings, order.phone, fill(settings[`sms_tpl_${event}`], order, settings, site), { kind: 'order_' + event, orderId: order.id });
}

// 📱 own-SIM app: what happened to a message the website handed to the phone?
//   Pending = the phone hasn't picked it up (app stopped / no internet), Processed = the phone has it,
//   Sent / Delivered = it left the SIM, Failed = the phone tried and couldn't (error says why).
async function androidState(settings: Settings, id?: Id) {
  if (!id) return null;
  const res = await safeFetch(`https://api.sms-gate.app/3rdparty/v1/messages/${encodeURIComponent(id)}`, {
    maxBytes: 64 * 1024, timeoutMs: 8000, maxRedirects: 0,
    headers: { Accept: 'application/json', Authorization: 'Basic ' + Buffer.from(`${String(settings.sms_sender_id || '').trim()}:${String(settings.sms_api_key || '').trim()}`).toString('base64') },
  });
  if (res.status < 200 || res.status >= 300) return null;
  let j: { state?: string; recipients?: { error?: string }[] } | null = null;
  try { j = JSON.parse(res.body.toString('utf8')); } catch (_) { return null; }
  const rc: { error?: string } = (j && Array.isArray(j.recipients) && j.recipients[0]) || {};
  return { state: String((j && j.state) || ''), error: rc.error ? String(rc.error).slice(0, 150) : '' };
}

// 📱 Is the phone that sends the SMS still alive? (owner, 2026-10-17: checkout codes stop the moment the old phone
// switches off, loses WiFi or runs out of battery — the owner must hear about it before customers do.)
//   textbee: its server keeps the phone's last "heartbeat" (the app checks in about every 30 minutes) and battery.
//   any provider: the SMS log — several failed codes in a row and none sent means something is wrong.
// Never throws; null fields = not known.
type PhoneStatus = {
  provider: string; on: boolean;
  lastSeen: Date | null; minutesAgo: number | null; battery: number | null; charging: boolean | null; model: string;
  phoneLevel: 'ok' | 'warn' | 'bad' | 'off'; phoneWhy: string;
  failed6h: number; sent6h: number; lastOk: Date | null; sendLevel: 'ok' | 'warn' | 'bad';
};
/** Pure rule, so it can be tested: how worrying is a phone last seen `minutes` ago with this battery? */
function phoneLevelFor(minutes: number | null, battery: number | null, charging: boolean | null, enabled = true): { level: 'ok' | 'warn' | 'bad'; why: string } {
  if (!enabled) return { level: 'bad', why: 'textbee-তে ফোনটা বন্ধ (disabled) করা আছে' };
  if (minutes === null) return { level: 'warn', why: 'ফোনটা কখনো textbee-তে সাড়া দেয়নি' };
  if (minutes > 240) return { level: 'bad', why: `ফোনটা ${bn(Math.round(minutes / 60))} ঘণ্টা ধরে সাড়া দিচ্ছে না` };
  if (minutes > 90) return { level: 'warn', why: `ফোনটা ${bn(Math.round(minutes))} মিনিট ধরে সাড়া দিচ্ছে না` };
  if (battery !== null && battery <= 20 && charging === false) return { level: 'warn', why: `ফোনের চার্জ ${bn(battery)}% — চার্জারে লাগান` };
  return { level: 'ok', why: '' };
}
/** Pure rule: failed vs sent codes in the last 6 hours. */
function sendLevelFor(failed: number, sent: number): 'ok' | 'warn' | 'bad' {
  if (failed >= 3 && sent === 0) return 'bad';
  if (failed >= 2 && failed > sent) return 'warn';
  return 'ok';
}
async function phoneStatus(settings: Settings): Promise<PhoneStatus> {
  const p = String(settings.sms_provider || '');
  const out: PhoneStatus = { provider: p, on: settings.sms_on === '1', lastSeen: null, minutesAgo: null, battery: null, charging: null, model: '',
    phoneLevel: 'off', phoneWhy: '', failed6h: 0, sent6h: 0, lastOk: null, sendLevel: 'ok' };
  const log = await db.one<{ f: number; s: number; last_ok: Date | null }>(`SELECT count(*) FILTER (WHERE NOT ok AND created_at > now() - interval '6 hours')::int AS f,
      count(*) FILTER (WHERE ok AND created_at > now() - interval '6 hours')::int AS s, max(created_at) FILTER (WHERE ok) AS last_ok
    FROM sms_log WHERE kind <> 'bulk' AND coalesce(detail, '') NOT IN ('SMS বন্ধ আছে', 'মোবাইল নম্বর ঠিক নেই', 'লেখা খালি') AND created_at > now() - interval '30 days'`).catch(() => null);
  if (log) { out.failed6h = Number(log.f) || 0; out.sent6h = Number(log.s) || 0; out.lastOk = log.last_ok ? new Date(log.last_ok) : null; }
  out.sendLevel = out.on ? sendLevelFor(out.failed6h, out.sent6h) : 'ok';
  if (!out.on || p !== 'textbee' || !settings.sms_api_key) return out;
  try {
    const res = await safeFetch('https://api.textbee.dev/api/v1/gateway/devices', {
      maxBytes: 256 * 1024, timeoutMs: 8000, maxRedirects: 0,
      headers: { Accept: 'application/json', 'x-api-key': String(settings.sms_api_key || '').trim() },
    });
    if (res.status === 401 || res.status === 403) { out.phoneLevel = 'bad'; out.phoneWhy = 'textbee-র API Key মিলছে না'; return out; }
    if (res.status < 200 || res.status >= 300) return out; // textbee itself busy: say nothing rather than a false alarm
    // (textbee's own answer: its fields are read as it sends them)
    type TbDevice = { _id?: string; isDefault?: boolean; enabled?: boolean; brand?: string; model?: string; lastHeartbeat?: string; batteryInfo?: { percentage?: number | null; isCharging?: boolean } };
    const j = JSON.parse(res.body.toString('utf8')) as { data?: unknown } | null;
    const list: TbDevice[] = Array.isArray(j?.data) ? j.data : [];
    const want = String(settings.sms_sender_id || '').trim();
    const d = list.find((x) => want && String(x._id) === want) || list.find((x) => x.isDefault && x.enabled) || list.find((x) => x.enabled) || list[0];
    if (!d) { out.phoneLevel = 'bad'; out.phoneWhy = 'textbee-তে কোনো ফোন যুক্ত নেই'; return out; }
    out.model = [d.brand, d.model].filter(Boolean).join(' ').slice(0, 60);
    out.lastSeen = d.lastHeartbeat ? new Date(d.lastHeartbeat) : null;
    out.minutesAgo = out.lastSeen && !Number.isNaN(out.lastSeen.getTime()) ? Math.max(0, (Date.now() - out.lastSeen.getTime()) / 60e3) : null;
    const b: NonNullable<TbDevice['batteryInfo']> = d.batteryInfo || {};
    out.battery = Number.isFinite(Number(b.percentage)) && b.percentage !== null && b.percentage !== undefined ? Math.round(Number(b.percentage)) : null;
    out.charging = typeof b.isCharging === 'boolean' ? b.isCharging : null;
    const lv = phoneLevelFor(out.minutesAgo, out.battery, out.charging, d.enabled !== false);
    out.phoneLevel = lv.level; out.phoneWhy = lv.why;
  } catch (_) { /* unknown — no alarm */ }
  return out;
}

export type { PhoneStatus };
export { setFakeSender, phoneStatus, phoneLevelFor, sendLevelFor, PROVIDERS, ORDER_EVENTS, ready, send, orderEvent, fill, parts, androidState, mktLeft };
