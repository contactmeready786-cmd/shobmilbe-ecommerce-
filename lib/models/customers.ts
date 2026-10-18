// Customers, block list and fraud signals.
import { q, one } from '../db';
import { normalizePhone, str, int } from '../util';
import type { Body } from '../types';
import type { DbRow, Param, Tx } from '../pg';
import type { BlocklistRow, CustomersRow, OrdersRow } from '../data/rows';
import type { Loose } from '../types';

type CustomerContact = { name: unknown; phone: string; email?: unknown; address?: unknown; district?: unknown; thana?: unknown };
async function upsertCustomer(t: Tx, { name, phone, email, address, district, thana }: CustomerContact): Promise<number> {
  const res = await t.query<Pick<CustomersRow, 'id'>>(
    `INSERT INTO customers(name, phone, email, address, district, thana) VALUES($1,$2,$3,$4,$5,$6)
     ON CONFLICT (phone) DO UPDATE SET name=EXCLUDED.name, email=CASE WHEN EXCLUDED.email<>'' THEN EXCLUDED.email ELSE customers.email END,
       address=EXCLUDED.address, district=EXCLUDED.district, thana=EXCLUDED.thana, updated_at=now()
     RETURNING id`, [name, phone, email || '', address || '', district || '', thana || '']);
  return res.rows[0].id;
}

/** what STATS adds to a customer row */
export type CustomerStats = { orders: number; delivered: number; cancelled: number; returned: number; spent: number; last_order: Date | null };
export type CustomerListed = CustomersRow & CustomerStats & { blocked: boolean };
export type CustomerFull = CustomersRow & CustomerStats & { block: BlocklistRow | null };
export type PhoneStats = { orders: number; delivered: number; failed: number; open: number; last_day: number };
const STATS = `count(o.id)::int AS orders,
  count(o.id) FILTER (WHERE o.status='delivered')::int AS delivered,
  count(o.id) FILTER (WHERE o.status='cancelled')::int AS cancelled,
  count(o.id) FILTER (WHERE o.status='returned')::int AS returned,
  coalesce(sum(o.total) FILTER (WHERE o.status='delivered'),0)::numeric(14,2) AS spent,
  max(o.created_at) AS last_order`;

// Ready-made groups worked out from each customer's orders.
const SEGMENTS: Record<string, [string, string]> = {
  new: ['🆕 নতুন (১টি অর্ডার)', 'count(o.id) = 1'],
  repeat: ['🔁 আবার কিনেছেন (২+ ডেলিভারি)', "count(o.id) FILTER (WHERE o.status='delivered') >= 2"],
  vip: ['⭐ VIP (বেশি কেনাকাটা)', "coalesce(sum(o.total) FILTER (WHERE o.status='delivered'),0) >= $VIP"],
  inactive: ['😴 ৯০ দিন কোনো অর্ডার নেই', "max(o.created_at) < now() - interval '90 days'"],
  risky: ['⚠️ ঝুঁকিপূর্ণ (বেশি বাতিল/ফেরত)', "count(o.id) FILTER (WHERE o.status IN ('cancelled','returned')) >= 2 AND count(o.id) FILTER (WHERE o.status IN ('cancelled','returned')) >= count(o.id) FILTER (WHERE o.status='delivered')"],
  none: ['🚫 কোনো অর্ডার নেই', 'count(o.id) = 0'],
};
export type CustomerFilter = { q?: string; blocked?: boolean; segment?: string; grp?: string; tag?: string; vipMin?: unknown; limit?: number; offset?: number; sort?: string };
function customerQuery({ q: search, blocked, segment, grp, tag, vipMin = 5000 }: CustomerFilter, params: Param[]): { where: string; having: string } {
  const where: string[] = [];
  if (search) {
    params.push(`%${search}%`);
    where.push(`(c.name ILIKE $${params.length} OR c.phone ILIKE $${params.length} OR c.address ILIKE $${params.length} OR c.tags ILIKE $${params.length})`);
  }
  if (blocked) where.push(`EXISTS (SELECT 1 FROM blocklist b WHERE b.kind='phone' AND b.value=c.phone)`);
  if (grp) { params.push(grp); where.push(`c.grp=$${params.length}`); }
  if (tag) { params.push(`%${tag}%`); where.push(`c.tags ILIKE $${params.length}`); }
  let having = '';
  if (segment && SEGMENTS[segment]) having = 'HAVING ' + SEGMENTS[segment][1].replace('$VIP', String(Math.max(0, Number(vipMin) || 0)));
  return { where: where.length ? 'WHERE ' + where.join(' AND ') : '', having };
}
async function listCustomers({ limit = 50, offset = 0, sort, ...f }: CustomerFilter = {}): Promise<CustomerListed[]> {
  const params: Param[] = [];
  const { where, having } = customerQuery(f, params);
  const order = ({ spent: 'spent DESC', orders: 'orders DESC', name: 'c.name ASC' } as Record<string, string>)[String(sort)] || 'last_order DESC NULLS LAST, c.id DESC';
  params.push(limit, offset);
  return q<CustomerListed>(`SELECT c.*, ${STATS}, EXISTS (SELECT 1 FROM blocklist b WHERE b.kind='phone' AND b.value=c.phone) AS blocked
            FROM customers c LEFT JOIN orders o ON o.phone=c.phone
            ${where} GROUP BY c.id ${having} ORDER BY ${order} LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
}
async function countCustomers(f: CustomerFilter = {}): Promise<number> {
  const params: Param[] = [];
  const { where, having } = customerQuery(f, params);
  return (await one<{ n: number }>(`SELECT count(*)::int AS n FROM (SELECT c.id FROM customers c LEFT JOIN orders o ON o.phone=c.phone ${where} GROUP BY c.id ${having}) x`, params))!.n;
}
async function segmentCounts(vipMin: unknown): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const k of Object.keys(SEGMENTS)) out[k] = await countCustomers({ segment: k, vipMin });
  return out;
}
// Every different address this customer has ordered to (newest first).
export type UsedAddress = Pick<OrdersRow, 'address' | 'district' | 'thana'> & { last: Date; n: number };
async function addresses(phone: unknown): Promise<UsedAddress[]> {
  return q<UsedAddress>(`SELECT address, district, thana, max(created_at) AS last, count(*)::int AS n FROM orders WHERE phone=$1
    GROUP BY address, district, thana ORDER BY last DESC LIMIT 10`, [normalizePhone(phone)]);
}
async function getCustomer(id: number): Promise<CustomerFull | null> {
  const row = await one<CustomersRow & CustomerStats>(`SELECT c.*, ${STATS} FROM customers c LEFT JOIN orders o ON o.phone=c.phone WHERE c.id=$1 GROUP BY c.id`, [id]);
  if (!row) return null;
  const c = row as CustomerFull;
  c.block = await one<BlocklistRow>(`SELECT * FROM blocklist WHERE kind='phone' AND value=$1`, [c.phone]);
  return c;
}
function cleanTags(v: unknown): string {
  const seen = new Set<string>();
  return String(v || '').split(/[,،]+/).map((t) => t.replace(/\s+/g, ' ').trim().slice(0, 30)).filter((t) => {
    const k = t.toLowerCase(); if (!t || seen.has(k)) return false; seen.add(k); return true;
  }).slice(0, 12).join(', ');
}
type UpdateCustomerOpts = {
  name?: Loose;
  email?: Loose;
  address?: Loose;
  district?: Loose;
  thana?: Loose;
  note?: Loose;
  tags?: Loose;
  grp?: Loose;
};
async function updateCustomer(id: number, data: UpdateCustomerOpts): Promise<void> {
  await q(`UPDATE customers SET name=$1, email=$2, address=$3, district=$4, thana=$5, note=$6, tags=$7, grp=$8, updated_at=now() WHERE id=$9`,
    [str(data.name, 80), str(data.email, 120), str(data.address, 400), str(data.district, 60), str(data.thana, 60), str(data.note, 1000),
      cleanTags(data.tags), str(data.grp, 40), id]);
}
async function allTags(): Promise<[string, number][]> {
  const rows = await q<Pick<CustomersRow, 'tags'>>(`SELECT tags FROM customers WHERE tags <> ''`);
  const n = new Map<string, number>();
  rows.forEach((r) => r.tags.split(',').map((t) => t.trim()).filter(Boolean).forEach((t) => n.set(t, (n.get(t) || 0) + 1)));
  return [...n.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30);
}

// History of a phone number across all orders — used as a fraud signal.
async function phoneStats(phone: unknown): Promise<PhoneStats | null> {
  return one<PhoneStats>(`SELECT count(*)::int AS orders,
      count(*) FILTER (WHERE status='delivered')::int AS delivered,
      count(*) FILTER (WHERE status IN ('cancelled','returned'))::int AS failed,
      count(*) FILTER (WHERE status IN ('pending','confirmed','processing','shipped','hold'))::int AS open,
      count(*) FILTER (WHERE created_at > now() - interval '1 day')::int AS last_day
    FROM orders WHERE phone=$1`, [normalizePhone(phone)]);
}
// A simple risk label from past orders.
function riskOf(stats: Pick<PhoneStats, 'orders' | 'delivered' | 'failed'> | null | undefined): { level: string; label: string; ratio: number | null } {
  if (!stats || !stats.orders) return { level: 'new', label: 'নতুন কাস্টমার', ratio: null };
  const done = stats.delivered + stats.failed;
  const ratio = done ? Math.round((stats.delivered / done) * 100) : null;
  if (done >= 2 && ratio !== null && ratio < 50) return { level: 'high', label: 'ঝুঁকিপূর্ণ', ratio };
  if (stats.failed >= 1 && ratio !== null && ratio < 80) return { level: 'medium', label: 'সতর্ক থাকুন', ratio };
  return { level: 'low', label: 'বিশ্বস্ত', ratio };
}

// ---------------------------------------------------------------- block list
async function isBlocked(phone: unknown, ip: unknown): Promise<Pick<BlocklistRow, 'kind' | 'reason'> | null> {
  const r = await one<Pick<BlocklistRow, 'kind' | 'reason'>>(`SELECT kind, reason FROM blocklist WHERE (kind='phone' AND value=$1) OR (kind='ip' AND value=$2 AND $2<>'') LIMIT 1`,
    [normalizePhone(phone), String(ip || '')]);
  return r;
}
async function block(kind: string, value: unknown, reason: unknown, staffId: number | null | undefined): Promise<boolean> {
  const v = kind === 'phone' ? normalizePhone(value) : str(value, 64);
  if (!v) return false;
  await q(`INSERT INTO blocklist(kind, value, reason, created_by) VALUES($1,$2,$3,$4)
           ON CONFLICT (kind, value) DO UPDATE SET reason=EXCLUDED.reason`, [kind === 'ip' ? 'ip' : 'phone', v, str(reason, 300), staffId || null]);
  return true;
}
async function unblock(id: unknown): Promise<void> { await q('DELETE FROM blocklist WHERE id=$1', [int(id)]); }
async function unblockValue(kind: string, value: string): Promise<void> { await q('DELETE FROM blocklist WHERE kind=$1 AND value=$2', [kind, value]); }
export type Blocked = BlocklistRow & { staff_name: string | null; customer_name: string | null; customer_id: number | null };
async function listBlocked(): Promise<Blocked[]> {
  return q<Blocked>(`SELECT b.*, s.name AS staff_name, c.name AS customer_name, c.id AS customer_id FROM blocklist b
            LEFT JOIN staff s ON s.id=b.created_by LEFT JOIN customers c ON b.kind='phone' AND c.phone=b.value
            ORDER BY b.created_at DESC`);
}

export { SEGMENTS, segmentCounts, addresses, allTags, cleanTags, upsertCustomer, listCustomers, countCustomers, getCustomer, updateCustomer, phoneStats, riskOf, isBlocked, block, unblock, unblockValue, listBlocked };
