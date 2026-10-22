// Suppliers, purchases, money accounts, transactions and financial reports.
import type { AccountsRow, PurchasesRow, ProductsRow, PurchaseItemsRow, StaffRow, SuppliersRow, TransactionsRow } from '../data/rows';
import { q, one, tx } from '../db';
import { int, str, num, randomCode, validYmd, ymd, amount, round2, oneOf } from '../util';
import * as catalog from './catalog';
import * as $packing from './packing';
import type { Body, Id, Settings } from '../types';
import type { DbRow, Param, Tx } from '../pg';

/** A day as YYYY-MM-DD (Dhaka), the way the report pages send it. */
type Day = string;
/** One bought line of a purchase: which product, how many, at what price each. */
export type PurchaseLine = { product_id: number; name: string; qty: number; unit_cost: number };
/** The filters of the transactions list. */
export type TxFilter = { from?: Day; to?: Day; type?: string; accountId?: Id | null; category?: string; limit?: number };

const EXPENSE_CATEGORIES = ['দোকান/অফিস ভাড়া', 'স্টাফ বেতন', 'বিদ্যুৎ ও পানি', 'ইন্টারনেট ও মোবাইল', 'ফেসবুক/গুগল বিজ্ঞাপন',
  'প্যাকেজিং খরচ', 'কুরিয়ার চার্জ', 'যাতায়াত', 'ওয়েবসাইট ও সফটওয়্যার', 'ব্যাংক/পেমেন্ট চার্জ', 'ভ্যাট/ট্যাক্স পরিশোধ', 'অন্যান্য খরচ'];
const INCOME_CATEGORIES = ['অর্ডার পেমেন্ট', 'কুরিয়ার থেকে COD টাকা', 'মালিকের বিনিয়োগ', 'ঋণ গ্রহণ', 'অন্যান্য আয়'];
// Money movements that are not profit or loss (they move cash, not earnings).
const NON_PNL_INCOME = new Set(['অর্ডার পেমেন্ট', 'কুরিয়ার থেকে COD টাকা', 'মালিকের বিনিয়োগ', 'ঋণ গ্রহণ', 'গিফট কার্ড বিক্রি']);
const NON_PNL_EXPENSE = new Set(['সাপ্লায়ার পেমেন্ট', 'মালিকের উত্তোলন', 'ঋণ পরিশোধ', 'ভ্যাট/ট্যাক্স পরিশোধ']);
const ACCOUNT_TYPES: Record<string, string> = { cash: 'ক্যাশ', bank: 'ব্যাংক', mobile: 'মোবাইল ব্যাংকিং' };

/** a supplier with what was bought from them and paid to them */
export type SupplierListed = SuppliersRow & { purchased: number; paid: number; purchase_count: number; last_purchase: string | null };
export type TxListed = TransactionsRow & { account_name: string | null };
export type SupplierFull = SupplierListed & { purchases: PurchaseListed[]; payments: TxListed[];
  products: { product_id: number | null; name: string; qty: number; avg_cost: number | null; last_date: string }[] };
export type PurchaseListed = PurchasesRow & { supplier_name: string | null; lines: number; units: number | null };
export type PurchaseFull = PurchasesRow & { supplier_name: string | null; staff_name: string | null;
  items: (PurchaseItemsRow & { sku: string | null; sale_price: number | null; stock: number | null })[]; payments: TxListed[]; paid: number };
export type AccountListed = AccountsRow & { balance: number };
export type TxFull = TransactionsRow & { account_name: string | null; to_account_name: string | null; supplier_name: string | null; order_code: string | null;
  purchase_code: string | null; staff_name: string | null };
type Amounts = { category: string; amount: number };


// ---------------------------------------------------------------- suppliers
async function listSuppliers({ includeInactive = true }: { includeInactive?: boolean } = {}): Promise<SupplierListed[]> {
  return q<SupplierListed>(`SELECT s.*,
      coalesce((SELECT sum(total) FROM purchases p WHERE p.supplier_id=s.id AND p.status<>'cancelled'),0)::numeric(14,2) AS purchased,
      coalesce((SELECT sum(amount) FROM transactions t WHERE t.supplier_id=s.id AND t.type='expense'),0)::numeric(14,2) AS paid,
      (SELECT count(*) FROM purchases p WHERE p.supplier_id=s.id)::int AS purchase_count,
      (SELECT max(purchase_date) FROM purchases p WHERE p.supplier_id=s.id) AS last_purchase
    FROM suppliers s ${includeInactive ? '' : 'WHERE s.active'} ORDER BY s.active DESC, s.name`);
}
async function getSupplier(id: Id): Promise<SupplierFull | null> {
  const found = (await listSuppliers()).find((x) => x.id === id);
  if (!found) return null;
  const s = found as SupplierFull;
  // (with the pieces and the supplier's name, like the purchases page — they showed 0 and "—" here before)
  s.purchases = await listPurchases({ supplierId: id, limit: 100 });
  s.payments = await q<TxListed>(`SELECT t.*, a.name AS account_name FROM transactions t LEFT JOIN accounts a ON a.id=t.account_id
                        WHERE t.supplier_id=$1 ORDER BY t.tx_date DESC, t.id DESC LIMIT 100`, [id]);
  s.products = await q<SupplierFull['products'][number]>(`SELECT i.product_id, i.name, sum(i.qty)::int AS qty, round(avg(i.unit_cost), 2) AS avg_cost,
                          max(p.purchase_date) AS last_date
                        FROM purchase_items i JOIN purchases p ON p.id=i.purchase_id
                        WHERE p.supplier_id=$1 AND p.status<>'cancelled' GROUP BY i.product_id, i.name ORDER BY last_date DESC`, [id]);
  return s;
}
type SaveSupplierOpts = {
  name?: unknown;
  company?: unknown;
  phone?: unknown;
  email?: unknown;
  address?: unknown;
  note?: unknown;
  opening_due?: unknown;
  active: unknown;
  id?: unknown;
};
async function saveSupplier(data: SaveSupplierOpts) {
  const f = [str(data.name, 100), str(data.company, 120), str(data.phone, 30), str(data.email, 120), str(data.address, 400),
    str(data.note, 1000), num(data.opening_due), data.active !== undefined ? !!data.active : true];
  if (int(data.id)) {
    await q(`UPDATE suppliers SET name=$1, company=$2, phone=$3, email=$4, address=$5, note=$6, opening_due=$7, active=$8 WHERE id=$9`, [...f, int(data.id)]);
    return int(data.id);
  }
  return (await one<{ id: number }>(`INSERT INTO suppliers(name, company, phone, email, address, note, opening_due, active) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`, f))!.id;
}
function supplierDue(s: { opening_due?: number | null; purchased?: number | null; paid?: number | null }): number { return (s.opening_due || 0) + (s.purchased || 0) - (s.paid || 0); }

// ---------------------------------------------------------------- purchases
const PURCHASE_STATUSES: Record<string, string> = { ordered: 'অর্ডার দেওয়া (মাল আসেনি)', received: 'মাল বুঝে পেয়েছি', cancelled: 'বাতিল' };

async function listPurchases({ supplierId, limit = 100 }: { supplierId?: Id | null; limit?: number } = {}) {
  const params: Param[] = [];
  let where = '';
  if (supplierId) { params.push(supplierId); where = 'WHERE p.supplier_id=$1'; }
  params.push(limit);
  return q<PurchaseListed>(`SELECT p.*, s.name AS supplier_name, (SELECT count(*) FROM purchase_items i WHERE i.purchase_id=p.id)::int AS lines,
              (SELECT sum(qty) FROM purchase_items i WHERE i.purchase_id=p.id)::int AS units
            FROM purchases p LEFT JOIN suppliers s ON s.id=p.supplier_id ${where}
            ORDER BY p.purchase_date DESC, p.id DESC LIMIT $${params.length}`, params);
}
async function getPurchase(id: Id): Promise<PurchaseFull | null> {
  const row = await one<PurchasesRow & { supplier_name: string | null; staff_name: string | null }>(`SELECT p.*, s.name AS supplier_name, st.name AS staff_name FROM purchases p
                       LEFT JOIN suppliers s ON s.id=p.supplier_id LEFT JOIN staff st ON st.id=p.created_by WHERE p.id=$1`, [id]);
  if (!row) return null;
  const p = row as PurchaseFull;
  p.items = await q<PurchaseFull['items'][number]>(`SELECT i.*, pr.sku, pr.price AS sale_price, pr.stock FROM purchase_items i LEFT JOIN products pr ON pr.id=i.product_id
                     WHERE i.purchase_id=$1 ORDER BY i.id`, [id]);
  p.payments = await q<TxListed>(`SELECT t.*, a.name AS account_name FROM transactions t LEFT JOIN accounts a ON a.id=t.account_id
                        WHERE t.purchase_id=$1 ORDER BY t.id`, [id]);
  p.paid = p.payments.reduce((s: number, x) => s + Number(x.amount), 0);
  return p;
}

// Receive goods: stock goes up and the product's cost becomes the weighted average.
async function receiveItems(t: Tx, purchaseId: Id, items: PurchaseLine[], staffId?: Id, costShare = 0): Promise<void> {
  for (const it of items) {
    if (!it.product_id) continue;
    const p = (await t.query<Pick<ProductsRow, 'stock' | 'cost_price'>>('SELECT stock, cost_price FROM products WHERE id=$1 FOR UPDATE', [it.product_id])).rows[0];
    if (!p) continue;
    const landed = round2(Number(it.unit_cost) + (costShare ? costShare * Number(it.unit_cost) : 0));
    const oldStock = Math.max(0, p.stock);
    // paisa are kept: a ৳0.35 IC must not become ৳0 (that made its profit look bigger than it is)
    const avg = oldStock + it.qty > 0 ? round2((oldStock * (Number(p.cost_price) || landed) + it.qty * landed) / (oldStock + it.qty)) : landed;
    await t.query('UPDATE products SET cost_price=$1 WHERE id=$2', [avg, it.product_id]);
    await catalog.moveStock(t, it.product_id, it.qty, 'purchase', 'purchase', purchaseId, '', staffId, false, landed);
  }
}

type SavePurchaseOpts = {
  items?: Body[] | null;
  discount?: unknown;
  shipping?: unknown;
  other_cost?: unknown;
  vat?: unknown;
  status?: unknown;
  purchase_date?: unknown;
  supplier_id?: unknown;
  note?: unknown;
  paid_now?: unknown;
  account_id?: unknown;
};
async function savePurchase(data: SavePurchaseOpts, staffId?: Id): Promise<number> {
  const items = await purchaseLines(data.items);
  const subtotal = round2(items.reduce((s, i) => s + i.qty * i.unit_cost, 0));
  const discount = amount(data.discount);
  const shipping = amount(data.shipping);
  const other = amount(data.other_cost);
  const vat = amount(data.vat);
  const total = round2(Math.max(0, subtotal - discount + shipping + other + vat));
  const status = PURCHASE_STATUSES[String(data.status)] && data.status !== 'cancelled' ? String(data.status) : 'received';
  const date = validYmd(data.purchase_date) || ymd();
  // Spread shipping/other costs/discount over items so the product cost is the real landed cost.
  const costShare = subtotal > 0 ? (shipping + other - discount) / subtotal : 0;

  return tx(async (t) => {
    const code = 'PO-' + randomCode(5);
    const p = (await t.query<Pick<PurchasesRow, 'id'>>(`INSERT INTO purchases(code, supplier_id, purchase_date, status, subtotal, discount, shipping, other_cost, vat, total, note, created_by, received_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
    [code, int(data.supplier_id) || null, date, status, subtotal, discount, shipping, other, vat, total, str(data.note, 1000), staffId || null,
      status === 'received' ? new Date() : null])).rows[0];
    for (const it of items) {
      await t.query('INSERT INTO purchase_items(purchase_id, product_id, name, qty, unit_cost) VALUES($1,$2,$3,$4,$5)', [p.id, it.product_id, it.name, it.qty, it.unit_cost]);
    }
    if (status === 'received') await receiveItems(t, p.id, items, staffId, costShare);
    const paidNow = Math.min(total, amount(data.paid_now));
    if (paidNow > 0) {
      await t.query(`INSERT INTO transactions(tx_date, type, category, amount, account_id, supplier_id, purchase_id, vat, note, created_by)
        VALUES($1,'expense','সাপ্লায়ার পেমেন্ট',$2,$3,$4,$5,0,$6,$7)`,
      [date, paidNow, int(data.account_id) || null, int(data.supplier_id) || null, p.id, `${code} এর পেমেন্ট`, staffId || null]);
    }
    return p.id;
  });
}
// ---------------------------------------------------------------- correcting a purchase (owner only, 2026-10-22)
// A purchase saved with a mistake can be corrected: products added or taken out, quantities, prices, the supplier,
// the date, discount / transport / other costs / VAT, the note. For goods already received only the difference goes
// to the stock ("পারচেজ সংশোধন" in the stock history), and the product's buying price is worked out again with the
// corrected price. Stock never goes below zero: pieces of this purchase that are already sold cannot be taken back.
// Every correction is kept in purchase_edits (who, when, before, after).

// A product with colours / sizes is bought colour by colour (each has its own stock and buying price) — the main
// product itself only when it was already in the purchase being corrected (bought before it had colours / sizes).
async function purchaseLines(rows: Body[] | null | undefined, keepIds: Set<number> = new Set()): Promise<PurchaseLine[]> {
  const items: PurchaseLine[] = [];
  for (const row of rows || []) {
    const pid = int(row.product_id);
    const qty = int(row.qty);
    if (!pid || qty <= 0) continue;
    const prod = await one<{ id: number; name: string; variant_count: number }>('SELECT id, name, variant_count FROM products WHERE id=$1', [pid]);
    if (!prod) continue;
    if (prod.variant_count > 0 && !keepIds.has(pid)) throw new Error(`"${prod.name}" এর রং/সাইজ আছে — খুঁজে প্রতিটা রং/সাইজ আলাদা করে যোগ করুন।`);
    const same = items.find((x) => x.product_id === pid);
    if (same) { same.qty += qty; continue; } // the same product twice → one line
    items.push({ product_id: pid, name: prod.name, qty, unit_cost: amount(row.unit_cost) });
  }
  if (!items.length) throw new Error('অন্তত একটি পণ্য আর পরিমাণ দিন।');
  return items;
}

/** What each product got from a purchase: pieces and their landed value (cost spread over the goods). */
function landedByProduct(items: { product_id: number | null; qty: number; unit_cost: number }[], share: number): Map<number, { qty: number; value: number }> {
  const m = new Map<number, { qty: number; value: number }>();
  for (const it of items) {
    if (!it.product_id) continue;
    const landed = round2(Number(it.unit_cost) + (share ? share * Number(it.unit_cost) : 0));
    const x = m.get(it.product_id) || { qty: 0, value: 0 };
    x.qty += Number(it.qty);
    x.value = round2(x.value + Number(it.qty) * landed);
    m.set(it.product_id, x);
  }
  return m;
}

/**
 * The buying price after a purchase is corrected: what the purchase brought in is taken out of the product's
 * average and the corrected purchase put in. When the rest of the stock is gone (sold), the corrected price is used.
 */
function correctedCost(stock: number, cost: number, old: { qty: number; value: number }, now: { qty: number; value: number }): number {
  const S = Math.max(0, stock);
  const restQty = S - old.qty;
  const restVal = round2(cost * S - old.value);
  const newQty = restQty + now.qty;
  if (restQty > 0 && restVal > 0 && newQty > 0) return round2((restVal + now.value) / newQty);
  if (now.qty > 0) return round2(now.value / now.qty);
  if (restQty > 0 && restVal > 0) return round2(restVal / restQty);
  return cost;
}

type PurchaseSnapshot = { supplier_id: number | null; purchase_date: string; discount: number; shipping: number; other_cost: number; vat: number; total: number; note: string; items: { product_id: number | null; name: string; qty: number; unit_cost: number }[] };
const snap = (p: PurchasesRow, items: PurchaseSnapshot['items']): PurchaseSnapshot => ({
  supplier_id: p.supplier_id, purchase_date: String(p.purchase_date), discount: Number(p.discount), shipping: Number(p.shipping),
  other_cost: Number(p.other_cost), vat: Number(p.vat), total: Number(p.total), note: p.note || '',
  items: items.map((i) => ({ product_id: i.product_id, name: i.name, qty: Number(i.qty), unit_cost: Number(i.unit_cost) })),
});

async function editPurchase(id: Id, data: SavePurchaseOpts & { stock_too?: unknown }, staffId?: Id): Promise<void> {
  const before = await q<{ product_id: number | null; name: string; qty: number; unit_cost: number }>('SELECT product_id, name, qty, unit_cost FROM purchase_items WHERE purchase_id=$1 ORDER BY id', [id]);
  const had = new Set(before.map((r) => Number(r.product_id)).filter(Boolean));
  // lines whose product was deleted for good can't be shown in the form — they stay exactly as they were, so the bill
  // (and what the supplier is owed) doesn't change by itself
  const kept = before.filter((r) => !r.product_id).map((r) => ({ product_id: null as unknown as number, name: r.name, qty: Number(r.qty), unit_cost: Number(r.unit_cost) }));
  const items = [...(await purchaseLines(data.items, had)), ...kept];
  // "স্টকেও বদলান" off: only the record is corrected (the stock was already put right by hand, e.g. on the colours / sizes)
  const moveStock = data.stock_too === undefined || data.stock_too === '1' || data.stock_too === true;
  const subtotal = round2(items.reduce((s, i) => s + i.qty * i.unit_cost, 0));
  const discount = amount(data.discount);
  const shipping = amount(data.shipping);
  const other = amount(data.other_cost);
  const vat = amount(data.vat);
  const total = round2(Math.max(0, subtotal - discount + shipping + other + vat));
  const supplierId = int(data.supplier_id) || null;
  await tx(async (t) => {
    const p = (await t.query<PurchasesRow>('SELECT * FROM purchases WHERE id=$1 FOR UPDATE', [id])).rows[0];
    if (!p) throw new Error('পারচেজটি পাওয়া যায়নি।');
    if (p.status === 'cancelled') throw new Error('বাতিল করা পারচেজ এডিট করা যায় না।');
    const oldItems = (await t.query<PurchaseItemsRow>('SELECT * FROM purchase_items WHERE purchase_id=$1 ORDER BY id', [id])).rows;
    const date = validYmd(data.purchase_date) || String(p.purchase_date);
    if (p.status === 'received') {
      const oldShare = Number(p.subtotal) > 0 ? (Number(p.shipping) + Number(p.other_cost) - Number(p.discount)) / Number(p.subtotal) : 0;
      const newShare = subtotal > 0 ? (shipping + other - discount) / subtotal : 0;
      const before = landedByProduct(oldItems, oldShare);
      const after = landedByProduct(items, newShare);
      for (const pid of new Set([...before.keys(), ...after.keys()])) {
        const o = before.get(pid) || { qty: 0, value: 0 };
        const n = after.get(pid) || { qty: 0, value: 0 };
        const prod = (await t.query<Pick<ProductsRow, 'stock' | 'cost_price' | 'name'>>('SELECT stock, cost_price, name FROM products WHERE id=$1 FOR UPDATE', [pid])).rows[0];
        if (!prod) continue;
        const delta = moveStock ? n.qty - o.qty : 0;
        if (prod.stock + delta < 0) {
          const least = o.qty - prod.stock;
          throw new Error(`"${prod.name}" — এই পারচেজের ${o.qty - Math.max(0, prod.stock)} পিস এর মধ্যে বিক্রি/বের হয়ে গেছে (এখন স্টক ${prod.stock})। পরিমাণ ${least} এর কম করা যাবে না।`);
        }
        if (n.qty - o.qty || o.value !== n.value) {
          // (stock not moved: the stock already holds the corrected pieces, not the old ones)
          const cost = moveStock ? correctedCost(prod.stock, Number(prod.cost_price) || 0, o, n)
            : correctedCost(prod.stock - n.qty + o.qty, Number(prod.cost_price) || 0, o, n);
          await t.query('UPDATE products SET cost_price=$1 WHERE id=$2', [cost, pid]);
        }
        if (delta) await catalog.moveStock(t, pid, delta, 'purchase_edit', 'purchase', id, '', staffId, true, n.qty ? round2(n.value / n.qty) : null);
      }
    }
    await t.query(`UPDATE purchases SET supplier_id=$1, purchase_date=$2, subtotal=$3, discount=$4, shipping=$5, other_cost=$6, vat=$7, total=$8, note=$9 WHERE id=$10`,
      [supplierId, date, subtotal, discount, shipping, other, vat, total, str(data.note, 1000), id]);
    await t.query('DELETE FROM purchase_items WHERE purchase_id=$1', [id]);
    for (const it of items) {
      await t.query('INSERT INTO purchase_items(purchase_id, product_id, name, qty, unit_cost) VALUES($1,$2,$3,$4,$5)', [id, it.product_id, it.name, it.qty, it.unit_cost]);
    }
    // the payments made for this purchase follow it to the corrected supplier
    if (supplierId !== p.supplier_id) await t.query('UPDATE transactions SET supplier_id=$1 WHERE purchase_id=$2', [supplierId, id]);
    const now = (await t.query<PurchasesRow>('SELECT * FROM purchases WHERE id=$1', [id])).rows[0];
    await t.query(`INSERT INTO purchase_edits(purchase_id, kind, staff_id, before, after) VALUES($1,'purchase',$2,$3,$4)`,
      [id, staffId || null, JSON.stringify(snap(p, oldItems)), JSON.stringify(snap(now, items))]);
  });
}

/** A supplier payment corrected (amount, date, account, note) — the change is kept. */
async function editSupplierPayment(txId: Id, data: Body, staffId?: Id): Promise<TransactionsRow> {
  const amt = amount(data.amount);
  if (amt <= 0) throw new Error('টাকার পরিমাণ দিন।');
  return tx(async (t) => {
    const r = (await t.query<TransactionsRow>('SELECT * FROM transactions WHERE id=$1 FOR UPDATE', [txId])).rows[0];
    if (!r || !r.supplier_id) throw new Error('পেমেন্টটি পাওয়া যায়নি।');
    const now = (await t.query<TransactionsRow>('UPDATE transactions SET amount=$1, tx_date=$2, account_id=$3, note=$4 WHERE id=$5 RETURNING *',
      [amt, validYmd(data.tx_date) || r.tx_date, int(data.account_id) || null, str(data.note, 500), txId])).rows[0];
    const pick = (x: TransactionsRow) => ({ amount: Number(x.amount), tx_date: String(x.tx_date), account_id: x.account_id, note: x.note || '', supplier_id: x.supplier_id });
    await t.query(`INSERT INTO purchase_edits(purchase_id, tx_id, kind, staff_id, before, after) VALUES($1,$2,'payment',$3,$4,$5)`,
      [r.purchase_id || null, txId, staffId || null, JSON.stringify(pick(r)), JSON.stringify(pick(now))]);
    return now;
  });
}

/** A supplier payment about to go to the recycle bin — the history keeps what it was. */
async function notePaymentDeleted(txId: Id, staffId?: Id): Promise<TransactionsRow | null> {
  const r = await one<TransactionsRow>('SELECT * FROM transactions WHERE id=$1', [txId]);
  if (!r || !r.supplier_id) return null;
  await q(`INSERT INTO purchase_edits(purchase_id, tx_id, kind, staff_id, before, after) VALUES($1,$2,'payment_delete',$3,$4,NULL)`,
    [r.purchase_id || null, txId, staffId || null, JSON.stringify({ amount: Number(r.amount), tx_date: String(r.tx_date), account_id: r.account_id, note: r.note || '', supplier_id: r.supplier_id })]);
  return r;
}

async function purchaseHistory(purchaseId: Id) {
  return q<{ id: number; kind: string; before: unknown; after: unknown; created_at: Date; staff_name: string | null }>(
    `SELECT e.id, e.kind, e.before, e.after, e.created_at, st.name AS staff_name FROM purchase_edits e LEFT JOIN staff st ON st.id=e.staff_id
      WHERE e.purchase_id=$1 ORDER BY e.id DESC LIMIT 50`, [purchaseId]);
}
async function supplierPaymentHistory(supplierId: Id) {
  return q<{ id: number; kind: string; before: unknown; after: unknown; created_at: Date; staff_name: string | null }>(
    `SELECT e.id, e.kind, e.before, e.after, e.created_at, st.name AS staff_name FROM purchase_edits e LEFT JOIN staff st ON st.id=e.staff_id
      WHERE e.kind <> 'purchase' AND (e.before->>'supplier_id')::int = $1
      ORDER BY e.id DESC LIMIT 50`, [supplierId]);
}

async function setPurchaseStatus(id: Id, status: string, staffId?: Id): Promise<void> {
  return tx(async (t) => {
    const p = (await t.query<PurchasesRow>('SELECT * FROM purchases WHERE id=$1 FOR UPDATE', [id])).rows[0];
    if (!p || p.status === status || !PURCHASE_STATUSES[status]) return;
    const items = (await t.query<PurchaseItemsRow>('SELECT * FROM purchase_items WHERE purchase_id=$1', [id])).rows as PurchaseLine[];
    if (status === 'received' && p.status === 'ordered') {
      const costShare = p.subtotal > 0 ? (p.shipping + p.other_cost - p.discount) / p.subtotal : 0;
      await receiveItems(t, id, items, staffId, costShare);
      await t.query(`UPDATE purchases SET status='received', received_at=now() WHERE id=$1`, [id]);
    } else if (status === 'cancelled') {
      if (p.status === 'received') {
        for (const it of items) if (it.product_id) await catalog.moveStock(t, it.product_id, -it.qty, 'purchase_cancel', 'purchase', id, '', staffId);
      }
      await t.query(`UPDATE purchases SET status='cancelled' WHERE id=$1`, [id]);
    }
  });
}

// ---------------------------------------------------------------- accounts & transactions
async function listAccounts(): Promise<AccountListed[]> {
  return q<AccountListed>(`SELECT a.*, a.opening_balance
      + coalesce((SELECT sum(amount) FROM transactions t WHERE t.account_id=a.id AND t.type='income'),0)
      - coalesce((SELECT sum(amount) FROM transactions t WHERE t.account_id=a.id AND t.type IN ('expense','transfer')),0)
      + coalesce((SELECT sum(amount) FROM transactions t WHERE t.to_account_id=a.id AND t.type='transfer'),0) AS balance
    FROM accounts a ORDER BY a.active DESC, a.sort, a.id`);
}
type SaveAccountOpts = {
  name?: unknown;
  type?: unknown;
  details?: unknown;
  opening_balance?: unknown;
  active: unknown;
  id?: unknown;
};
async function saveAccount(data: SaveAccountOpts) {
  const f = [str(data.name, 80), ACCOUNT_TYPES[String(data.type)] ? String(data.type) : 'cash', str(data.details, 300), num(data.opening_balance), data.active !== undefined ? !!data.active : true];
  if (int(data.id)) {
    await q('UPDATE accounts SET name=$1, type=$2, details=$3, opening_balance=$4, active=$5 WHERE id=$6', [...f, int(data.id)]);
    return int(data.id);
  }
  return (await one<{ id: number }>('INSERT INTO accounts(name, type, details, opening_balance, active, sort) VALUES($1,$2,$3,$4,$5,(SELECT coalesce(max(sort),0)+1 FROM accounts)) RETURNING id', f))!.id;
}
async function addTransaction(data: Body, staffId?: Id) {
  const type = oneOf(['income', 'expense', 'transfer'], data.type, 'expense');
  const amt = amount(data.amount);
  if (amt <= 0) throw new Error('টাকার পরিমাণ দিন।');
  if (type === 'transfer' && (!int(data.account_id) || !int(data.to_account_id) || int(data.account_id) === int(data.to_account_id))) {
    throw new Error('ট্রান্সফারের জন্য দুটো আলাদা অ্যাকাউন্ট বাছুন।');
  }
  const row = await one<{ id: number }>(`INSERT INTO transactions(tx_date, type, category, amount, account_id, to_account_id, supplier_id, order_id, purchase_id, vat, note, created_by)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
  [validYmd(data.tx_date) || ymd(), type, type === 'transfer' ? 'ট্রান্সফার' : str(data.category, 60) || 'অন্যান্য', amt,
    int(data.account_id) || null, type === 'transfer' ? int(data.to_account_id) : null, int(data.supplier_id) || null,
    int(data.order_id) || null, int(data.purchase_id) || null, amount(data.vat), str(data.note, 500), staffId || null]);
  return row!.id;
}
async function deleteTransaction(id?: Id) { await q('DELETE FROM transactions WHERE id=$1', [id]); }
async function listTransactions({ from, to, type, accountId, category, limit = 200 }: TxFilter = {}) {
  const params: Param[] = [];
  const where: string[] = [];
  if (from) { params.push(from); where.push(`t.tx_date >= $${params.length}`); }
  if (to) { params.push(to); where.push(`t.tx_date <= $${params.length}`); }
  if (type) { params.push(type); where.push(`t.type = $${params.length}`); }
  if (category) { params.push(category); where.push(`t.category = $${params.length}`); }
  if (accountId) { params.push(accountId); where.push(`(t.account_id = $${params.length} OR t.to_account_id = $${params.length})`); }
  params.push(limit);
  return q<TxFull>(`SELECT t.*, a.name AS account_name, a2.name AS to_account_name, s.name AS supplier_name, o.code AS order_code,
              p.code AS purchase_code, st.name AS staff_name
            FROM transactions t LEFT JOIN accounts a ON a.id=t.account_id LEFT JOIN accounts a2 ON a2.id=t.to_account_id
            LEFT JOIN suppliers s ON s.id=t.supplier_id LEFT JOIN orders o ON o.id=t.order_id
            LEFT JOIN purchases p ON p.id=t.purchase_id LEFT JOIN staff st ON st.id=t.created_by
            ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY t.tx_date DESC, t.id DESC LIMIT $${params.length}`, params);
}

// ---------------------------------------------------------------- reports
const DHAKA_DAY = `(o.created_at AT TIME ZONE 'Asia/Dhaka')::date`;

// Profit & loss for a date range. Sales are counted on delivered orders (by delivery date).
async function profitLoss(from: Day, to: Day) {
  const sales = await one<{ orders: number; goods: number; discount: number; delivery: number; revenue: number; cogs: number }>(`SELECT count(*)::int AS orders, coalesce(sum(subtotal),0)::numeric(14,2) AS goods, coalesce(sum(discount + points_discount),0)::numeric(14,2) AS discount,
      coalesce(sum(delivery),0)::numeric(14,2) AS delivery, coalesce(sum(total),0)::numeric(14,2) AS revenue, coalesce(sum(cost_total),0)::numeric(14,2) AS cogs
    FROM orders o WHERE status='delivered' AND (coalesce(delivered_at, updated_at) AT TIME ZONE 'Asia/Dhaka')::date BETWEEN $1 AND $2`, [from, to]);
  const returns = await one<{ n: number }>(`SELECT count(*)::int AS n FROM orders o WHERE status='returned' AND (updated_at AT TIME ZONE 'Asia/Dhaka')::date BETWEEN $1 AND $2`, [from, to]);
  const exp = await q<Amounts>(`SELECT category, sum(amount)::numeric(14,2) AS amount FROM transactions WHERE type='expense' AND tx_date BETWEEN $1 AND $2 GROUP BY category ORDER BY amount DESC`, [from, to]);
  const inc = await q<Amounts>(`SELECT category, sum(amount)::numeric(14,2) AS amount FROM transactions WHERE type='income' AND tx_date BETWEEN $1 AND $2 GROUP BY category ORDER BY amount DESC`, [from, to]);
  const expenses = exp.filter((e) => !NON_PNL_EXPENSE.has(e.category));
  const otherIncome = inc.filter((e) => !NON_PNL_INCOME.has(e.category));
  const expenseTotal = expenses.reduce((s, e) => s + Number(e.amount), 0);
  const otherIncomeTotal = otherIncome.reduce((s, e) => s + Number(e.amount), 0);
  const gross = Number(sales!.revenue) - Number(sales!.cogs);
  // 📦 what the parcels were packed with (box, tape, sticker …), counted on the day they went out — also for parcels
  // that came back, unless the packing was marked reused (lib/models/packing.ts)
  const packing = await $packing.totalBetween(from, to);
  return {
    sales, returns: returns!.n, expenses, otherIncome, expenseTotal, otherIncomeTotal, gross, packing,
    net: gross + otherIncomeTotal - expenseTotal - packing.cost,
    movements: { income: inc.filter((e) => NON_PNL_INCOME.has(e.category)), expense: exp.filter((e) => NON_PNL_EXPENSE.has(e.category)) },
  };
}

// VAT summary by month. mode: 'inclusive' (prices include VAT), 'exclusive' (VAT on top), 'margin' (VAT on gross margin).
async function vatReport(settings: Settings, year: number | string) {
  const rate = num(settings.vat_rate, 15);
  const mode = settings.vat_mode || 'none';
  const rows = await q<{ month: string; goods: number; cogs: number; orders: number }>(`SELECT to_char(coalesce(delivered_at, updated_at) AT TIME ZONE 'Asia/Dhaka', 'YYYY-MM') AS month,
      coalesce(sum(subtotal - discount - points_discount),0)::numeric(14,2) AS goods, coalesce(sum(cost_total),0)::numeric(14,2) AS cogs, count(*)::int AS orders
    FROM orders WHERE status='delivered' AND extract(year from coalesce(delivered_at, updated_at) AT TIME ZONE 'Asia/Dhaka') = $1
    GROUP BY 1 ORDER BY 1`, [year]);
  const input = await q<{ month: string; vat: number }>(`SELECT to_char(purchase_date, 'YYYY-MM') AS month, coalesce(sum(vat),0)::numeric(14,2) AS vat
    FROM purchases WHERE status='received' AND extract(year from purchase_date) = $1 GROUP BY 1`, [year]);
  const paid = await q<{ month: string; amount: number }>(`SELECT to_char(tx_date, 'YYYY-MM') AS month, coalesce(sum(amount),0)::numeric(14,2) AS amount
    FROM transactions WHERE type='expense' AND category='ভ্যাট/ট্যাক্স পরিশোধ' AND extract(year from tx_date) = $1 GROUP BY 1`, [year]);
  const months: { month: string; orders: number; goods: number; cogs: number; output: number; input: number; payable: number; paid: number }[] = [];
  for (let m = 1; m <= 12; m++) {
    const key = `${year}-${String(m).padStart(2, '0')}`;
    const r = rows.find((x) => x.month === key) || { goods: 0, cogs: 0, orders: 0 };
    const goods = Number(r.goods);
    let output = 0;
    if (mode === 'turnover') output = Math.round((goods * num(settings.vat_turnover_rate, 4)) / 100);
    else if (mode === 'inclusive') output = Math.round((goods * rate) / (100 + rate));
    else if (mode === 'exclusive') output = Math.round((goods * rate) / 100);
    else if (mode === 'margin') output = Math.round((Math.max(0, goods - Number(r.cogs)) * rate) / 100);
    const inVat = mode === 'turnover' ? 0 : Number((input.find((x) => x.month === key) || {}).vat || 0); // turnover tax: no input credit
    const paidVat = Number((paid.find((x) => x.month === key) || {}).amount || 0);
    months.push({ month: key, orders: r.orders, goods, cogs: Number(r.cogs), output, input: inVat, payable: Math.max(0, output - inVat), paid: paidVat });
  }
  return { rate, mode, months };
}

// Daily series for charts.
async function dailySeries(from: Day, to: Day) {
  return q<{ day: string; orders: number; sales: number; profit: number; delivered: number }>(`SELECT d::date AS day,
      coalesce((SELECT count(*) FROM orders o WHERE ${DHAKA_DAY} = d::date),0)::int AS orders,
      coalesce((SELECT sum(total) FROM orders o WHERE ${DHAKA_DAY} = d::date AND o.status NOT IN ('cancelled','returned')),0)::numeric(14,2) AS sales,
      coalesce((SELECT sum(total - cost_total - delivery) FROM orders o WHERE ${DHAKA_DAY} = d::date AND o.status NOT IN ('cancelled','returned')),0)::int AS profit,
      coalesce((SELECT count(*) FROM orders o WHERE ${DHAKA_DAY} = d::date AND o.status='delivered'),0)::int AS delivered
    FROM generate_series($1::date, $2::date, interval '1 day') d ORDER BY d`, [from, to]);
}
async function monthlySeries(months: number | string = 12) {
  return q<{ month: string; sales: number; gross: number; expenses: number }>(`SELECT to_char(m, 'YYYY-MM') AS month,
      coalesce((SELECT sum(total) FROM orders o WHERE date_trunc('month', o.created_at AT TIME ZONE 'Asia/Dhaka') = m AND o.status NOT IN ('cancelled','returned')),0)::numeric(14,2) AS sales,
      coalesce((SELECT sum(total - cost_total - delivery) FROM orders o WHERE date_trunc('month', o.created_at AT TIME ZONE 'Asia/Dhaka') = m AND o.status NOT IN ('cancelled','returned')),0)::numeric(14,2) AS gross,
      coalesce((SELECT sum(amount) FROM transactions t WHERE date_trunc('month', t.tx_date) = m AND t.type='expense'
         AND t.category NOT IN ('সাপ্লায়ার পেমেন্ট','মালিকের উত্তোলন','ঋণ পরিশোধ','ভ্যাট/ট্যাক্স পরিশোধ')),0)::numeric(14,2) AS expenses
    FROM generate_series(date_trunc('month', (now() AT TIME ZONE 'Asia/Dhaka')) - ($1::int - 1) * interval '1 month',
                         date_trunc('month', (now() AT TIME ZONE 'Asia/Dhaka')), interval '1 month') m ORDER BY m`, [months]);
}

async function dashboard(from: Day, to: Day) {
  const k = await one<{ orders: number; pending_in_range: number; delivered: number; failed: number; sales: number; gross: number; aov: number; buyers: number }>(`SELECT
      count(*)::int AS orders,
      count(*) FILTER (WHERE status='pending')::int AS pending_in_range,
      count(*) FILTER (WHERE status='delivered')::int AS delivered,
      count(*) FILTER (WHERE status IN ('cancelled','returned'))::int AS failed,
      coalesce(sum(total) FILTER (WHERE status NOT IN ('cancelled','returned')),0)::numeric(14,2) AS sales,
      coalesce(sum(total - cost_total - delivery) FILTER (WHERE status NOT IN ('cancelled','returned')),0)::numeric(14,2) AS gross,
      coalesce(avg(total) FILTER (WHERE status NOT IN ('cancelled','returned')),0)::numeric(14,2) AS aov,
      count(DISTINCT phone)::int AS buyers
    FROM orders o WHERE ${DHAKA_DAY} BETWEEN $1 AND $2`, [from, to]);
  const live = await one<Record<'pending' | 'to_ship' | 'shipped' | 'today_orders' | 'today_sales' | 'customers' | 'new_customers' | 'products' | 'out_of_stock' | 'low_stock' | 'week_sales' | 'week_orders' | 'month_sales' | 'month_orders' | 'cancel_return_30', number>>(`SELECT
      (SELECT count(*) FROM orders WHERE status='pending')::int AS pending,
      (SELECT count(*) FROM orders WHERE status IN ('confirmed','processing'))::int AS to_ship,
      (SELECT count(*) FROM orders WHERE status='shipped')::int AS shipped,
      (SELECT count(*) FROM orders o WHERE ${DHAKA_DAY} = (now() AT TIME ZONE 'Asia/Dhaka')::date)::int AS today_orders,
      (SELECT coalesce(sum(total),0) FROM orders o WHERE ${DHAKA_DAY} = (now() AT TIME ZONE 'Asia/Dhaka')::date AND status NOT IN ('cancelled','returned'))::numeric(14,2) AS today_sales,
      (SELECT count(*) FROM customers)::int AS customers,
      (SELECT count(*) FROM customers WHERE (created_at AT TIME ZONE 'Asia/Dhaka')::date BETWEEN $1 AND $2)::int AS new_customers,
      (SELECT count(*) FROM products WHERE active)::int AS products,
      (SELECT count(*) FROM products WHERE active AND product_type='single' AND stock <= 0)::int AS out_of_stock,
      (SELECT count(*) FROM products WHERE active AND product_type='single' AND stock > 0 AND stock <= low_stock)::int AS low_stock,
      (SELECT coalesce(sum(total),0) FROM orders o WHERE ${DHAKA_DAY} > (now() AT TIME ZONE 'Asia/Dhaka')::date - 7 AND status NOT IN ('cancelled','returned'))::numeric(14,2) AS week_sales,
      (SELECT count(*) FROM orders o WHERE ${DHAKA_DAY} > (now() AT TIME ZONE 'Asia/Dhaka')::date - 7)::int AS week_orders,
      (SELECT coalesce(sum(total),0) FROM orders o WHERE date_trunc('month', ${DHAKA_DAY}) = date_trunc('month', (now() AT TIME ZONE 'Asia/Dhaka')::date) AND status NOT IN ('cancelled','returned'))::numeric(14,2) AS month_sales,
      (SELECT count(*) FROM orders o WHERE date_trunc('month', ${DHAKA_DAY}) = date_trunc('month', (now() AT TIME ZONE 'Asia/Dhaka')::date))::int AS month_orders,
      (SELECT count(*) FROM orders WHERE status IN ('cancelled','returned') AND updated_at > now() - interval '30 days')::int AS cancel_return_30`, [from, to]);
  const byStatus = await q<{ status: string; n: number }>(`SELECT status, count(*)::int AS n FROM orders o WHERE ${DHAKA_DAY} BETWEEN $1 AND $2 GROUP BY status`, [from, to]);
  const topProducts = await q<{ product_id: number | null; name: string; qty: number; revenue: number; profit: number | null }>(`SELECT i.product_id, i.name, sum(i.qty)::int AS qty, sum(i.qty * i.price)::numeric(14,2) AS revenue,
      sum(i.qty * (i.price - i.cost))::numeric(14,2) AS profit
    FROM order_items i JOIN orders o ON o.id=i.order_id WHERE ${DHAKA_DAY} BETWEEN $1 AND $2 AND o.status NOT IN ('cancelled','returned')
    GROUP BY i.product_id, i.name ORDER BY qty DESC LIMIT 8`, [from, to]);
  const byCategory = await q<{ name: string; revenue: number }>(`SELECT coalesce(c.name, 'ক্যাটাগরি নেই') AS name, sum(i.qty * i.price)::numeric(14,2) AS revenue
    FROM order_items i JOIN orders o ON o.id=i.order_id LEFT JOIN products p ON p.id=i.product_id LEFT JOIN categories c ON c.id=p.category_id
    WHERE ${DHAKA_DAY} BETWEEN $1 AND $2 AND o.status NOT IN ('cancelled','returned') GROUP BY 1 ORDER BY 2 DESC LIMIT 8`, [from, to]);
  const byZone = await q<{ area: string; n: number }>(`SELECT area, count(*)::int AS n FROM orders o WHERE ${DHAKA_DAY} BETWEEN $1 AND $2 GROUP BY area`, [from, to]);
  const byPayment = await q<{ payment: string; n: number }>(`SELECT payment, count(*)::int AS n FROM orders o WHERE ${DHAKA_DAY} BETWEEN $1 AND $2 GROUP BY payment ORDER BY n DESC`, [from, to]);
  const byDistrict = await q<{ district: string; n: number }>(`SELECT coalesce(nullif(district,''),'অজানা') AS district, count(*)::int AS n FROM orders o WHERE ${DHAKA_DAY} BETWEEN $1 AND $2 GROUP BY 1 ORDER BY 2 DESC LIMIT 8`, [from, to]);
  const byHour = await q<{ h: number; n: number }>(`SELECT extract(hour from o.created_at AT TIME ZONE 'Asia/Dhaka')::int AS h, count(*)::int AS n FROM orders o WHERE ${DHAKA_DAY} BETWEEN $1 AND $2 GROUP BY 1`, [from, to]);
  const expenses = await one<{ total: number }>(`SELECT coalesce(sum(amount),0)::numeric(14,2) AS total FROM transactions WHERE type='expense' AND tx_date BETWEEN $1 AND $2
      AND category NOT IN ('সাপ্লায়ার পেমেন্ট','মালিকের উত্তোলন','ঋণ পরিশোধ','ভ্যাট/ট্যাক্স পরিশোধ')`, [from, to]);
  const inventory = await catalog.inventorySummary();
  const lowStock = await catalog.listProducts({ includeInactive: false, lowStock: true, sort: 'stock_asc', limit: 8, type: 'single', items: true });
  return { k, live, byStatus, topProducts, byCategory, byZone, byPayment, byDistrict, byHour, expenses: Number(expenses!.total), inventory, lowStock };
}

async function staffReport(from: Day, to: Day) {
  return q<Pick<StaffRow, 'id' | 'name' | 'role' | 'active' | 'last_login'> & Record<'actions' | 'confirmed' | 'cancelled' | 'edits' | 'created' | 'sent' | 'logins', number>>(`SELECT s.id, s.name, s.role, s.active, s.last_login,
      (SELECT count(*) FROM activity_log a WHERE a.staff_id=s.id AND (a.created_at AT TIME ZONE 'Asia/Dhaka')::date BETWEEN $1 AND $2)::int AS actions,
      (SELECT count(*) FROM activity_log a WHERE a.staff_id=s.id AND a.action='order_status' AND a.detail LIKE '%→ confirmed%' AND (a.created_at AT TIME ZONE 'Asia/Dhaka')::date BETWEEN $1 AND $2)::int AS confirmed,
      (SELECT count(*) FROM activity_log a WHERE a.staff_id=s.id AND a.action='order_status' AND a.detail LIKE '%→ cancelled%' AND (a.created_at AT TIME ZONE 'Asia/Dhaka')::date BETWEEN $1 AND $2)::int AS cancelled,
      (SELECT count(*) FROM activity_log a WHERE a.staff_id=s.id AND a.action='order_edit' AND (a.created_at AT TIME ZONE 'Asia/Dhaka')::date BETWEEN $1 AND $2)::int AS edits,
      (SELECT count(*) FROM orders o WHERE o.created_by=s.id AND ${DHAKA_DAY} BETWEEN $1 AND $2)::int AS created,
      (SELECT count(*) FROM activity_log a WHERE a.staff_id=s.id AND a.action='courier_send' AND (a.created_at AT TIME ZONE 'Asia/Dhaka')::date BETWEEN $1 AND $2)::int AS sent,
      (SELECT count(*) FROM activity_log a WHERE a.staff_id=s.id AND a.action='login' AND (a.created_at AT TIME ZONE 'Asia/Dhaka')::date BETWEEN $1 AND $2)::int AS logins
    FROM staff s ORDER BY s.role='owner' DESC, s.name`, [from, to]);
}

export { EXPENSE_CATEGORIES, INCOME_CATEGORIES, ACCOUNT_TYPES, PURCHASE_STATUSES, listSuppliers, getSupplier, saveSupplier, supplierDue, listPurchases, getPurchase, savePurchase, setPurchaseStatus, editPurchase, editSupplierPayment, notePaymentDeleted, purchaseHistory, supplierPaymentHistory, correctedCost, listAccounts, saveAccount, addTransaction, deleteTransaction, listTransactions, profitLoss, vatReport, dailySeries, monthlySeries, dashboard, staffReport };
