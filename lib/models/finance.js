'use strict';
// Suppliers, purchases, money accounts, transactions and financial reports.
const { q, one, tx } = require('../db');
const { int, str, num, randomCode, validYmd, ymd, amount, round2 } = require('../util');
const catalog = require('./catalog');

const EXPENSE_CATEGORIES = ['দোকান/অফিস ভাড়া', 'স্টাফ বেতন', 'বিদ্যুৎ ও পানি', 'ইন্টারনেট ও মোবাইল', 'ফেসবুক/গুগল বিজ্ঞাপন',
  'প্যাকেজিং খরচ', 'কুরিয়ার চার্জ', 'যাতায়াত', 'ওয়েবসাইট ও সফটওয়্যার', 'ব্যাংক/পেমেন্ট চার্জ', 'ভ্যাট/ট্যাক্স পরিশোধ', 'অন্যান্য খরচ'];
const INCOME_CATEGORIES = ['অর্ডার পেমেন্ট', 'কুরিয়ার থেকে COD টাকা', 'মালিকের বিনিয়োগ', 'ঋণ গ্রহণ', 'অন্যান্য আয়'];
// Money movements that are not profit or loss (they move cash, not earnings).
const NON_PNL_INCOME = new Set(['অর্ডার পেমেন্ট', 'কুরিয়ার থেকে COD টাকা', 'মালিকের বিনিয়োগ', 'ঋণ গ্রহণ']);
const NON_PNL_EXPENSE = new Set(['সাপ্লায়ার পেমেন্ট', 'মালিকের উত্তোলন', 'ঋণ পরিশোধ', 'ভ্যাট/ট্যাক্স পরিশোধ']);
const ACCOUNT_TYPES = { cash: 'ক্যাশ', bank: 'ব্যাংক', mobile: 'মোবাইল ব্যাংকিং' };

// ---------------------------------------------------------------- suppliers
async function listSuppliers({ includeInactive = true } = {}) {
  return q(`SELECT s.*,
      coalesce((SELECT sum(total) FROM purchases p WHERE p.supplier_id=s.id AND p.status<>'cancelled'),0)::numeric(14,2) AS purchased,
      coalesce((SELECT sum(amount) FROM transactions t WHERE t.supplier_id=s.id AND t.type='expense'),0)::numeric(14,2) AS paid,
      (SELECT count(*) FROM purchases p WHERE p.supplier_id=s.id)::int AS purchase_count,
      (SELECT max(purchase_date) FROM purchases p WHERE p.supplier_id=s.id) AS last_purchase
    FROM suppliers s ${includeInactive ? '' : 'WHERE s.active'} ORDER BY s.active DESC, s.name`);
}
async function getSupplier(id) {
  const s = (await listSuppliers()).find((x) => x.id === id);
  if (!s) return null;
  s.purchases = await q(`SELECT * FROM purchases WHERE supplier_id=$1 ORDER BY purchase_date DESC, id DESC LIMIT 100`, [id]);
  s.payments = await q(`SELECT t.*, a.name AS account_name FROM transactions t LEFT JOIN accounts a ON a.id=t.account_id
                        WHERE t.supplier_id=$1 ORDER BY t.tx_date DESC, t.id DESC LIMIT 100`, [id]);
  s.products = await q(`SELECT i.product_id, i.name, sum(i.qty)::int AS qty, round(avg(i.unit_cost), 2) AS avg_cost,
                          max(p.purchase_date) AS last_date
                        FROM purchase_items i JOIN purchases p ON p.id=i.purchase_id
                        WHERE p.supplier_id=$1 AND p.status<>'cancelled' GROUP BY i.product_id, i.name ORDER BY last_date DESC`, [id]);
  return s;
}
async function saveSupplier(data) {
  const f = [str(data.name, 100), str(data.company, 120), str(data.phone, 30), str(data.email, 120), str(data.address, 400),
    str(data.note, 1000), num(data.opening_due), data.active !== undefined ? !!data.active : true];
  if (int(data.id)) {
    await q(`UPDATE suppliers SET name=$1, company=$2, phone=$3, email=$4, address=$5, note=$6, opening_due=$7, active=$8 WHERE id=$9`, [...f, int(data.id)]);
    return int(data.id);
  }
  return (await one(`INSERT INTO suppliers(name, company, phone, email, address, note, opening_due, active) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`, f)).id;
}
function supplierDue(s) { return (s.opening_due || 0) + (s.purchased || 0) - (s.paid || 0); }

// ---------------------------------------------------------------- purchases
const PURCHASE_STATUSES = { ordered: 'অর্ডার দেওয়া (মাল আসেনি)', received: 'মাল বুঝে পেয়েছি', cancelled: 'বাতিল' };

async function listPurchases({ supplierId, limit = 100 } = {}) {
  const params = [];
  let where = '';
  if (supplierId) { params.push(supplierId); where = 'WHERE p.supplier_id=$1'; }
  params.push(limit);
  return q(`SELECT p.*, s.name AS supplier_name, (SELECT count(*) FROM purchase_items i WHERE i.purchase_id=p.id)::int AS lines,
              (SELECT sum(qty) FROM purchase_items i WHERE i.purchase_id=p.id)::int AS units
            FROM purchases p LEFT JOIN suppliers s ON s.id=p.supplier_id ${where}
            ORDER BY p.purchase_date DESC, p.id DESC LIMIT $${params.length}`, params);
}
async function getPurchase(id) {
  const p = await one(`SELECT p.*, s.name AS supplier_name, st.name AS staff_name FROM purchases p
                       LEFT JOIN suppliers s ON s.id=p.supplier_id LEFT JOIN staff st ON st.id=p.created_by WHERE p.id=$1`, [id]);
  if (!p) return null;
  p.items = await q(`SELECT i.*, pr.sku, pr.price AS sale_price, pr.stock FROM purchase_items i LEFT JOIN products pr ON pr.id=i.product_id
                     WHERE i.purchase_id=$1 ORDER BY i.id`, [id]);
  p.payments = await q(`SELECT t.*, a.name AS account_name FROM transactions t LEFT JOIN accounts a ON a.id=t.account_id
                        WHERE t.purchase_id=$1 ORDER BY t.id`, [id]);
  p.paid = p.payments.reduce((s, x) => s + x.amount, 0);
  return p;
}

// Receive goods: stock goes up and the product's cost becomes the weighted average.
async function receiveItems(t, purchaseId, items, staffId, costShare) {
  for (const it of items) {
    if (!it.product_id) continue;
    const p = (await t.query('SELECT stock, cost_price FROM products WHERE id=$1 FOR UPDATE', [it.product_id])).rows[0];
    if (!p) continue;
    const landed = it.unit_cost + (costShare ? costShare * it.unit_cost : 0);
    const oldStock = Math.max(0, p.stock);
    const avg = oldStock + it.qty > 0 ? Math.round((oldStock * (p.cost_price || landed) + it.qty * landed) / (oldStock + it.qty)) : Math.round(landed);
    await t.query('UPDATE products SET cost_price=$1 WHERE id=$2', [avg, it.product_id]);
    await catalog.moveStock(t, it.product_id, it.qty, 'purchase', 'purchase', purchaseId, '', staffId);
  }
}

async function savePurchase(data, staffId) {
  const items = [];
  for (const row of data.items || []) {
    const pid = int(row.product_id);
    const qty = int(row.qty);
    if (!pid || qty <= 0) continue;
    const prod = await one('SELECT id, name FROM products WHERE id=$1', [pid]);
    if (prod) items.push({ product_id: pid, name: prod.name, qty, unit_cost: amount(row.unit_cost) });
  }
  if (!items.length) throw new Error('অন্তত একটি পণ্য আর পরিমাণ দিন।');
  const subtotal = round2(items.reduce((s, i) => s + i.qty * i.unit_cost, 0));
  const discount = amount(data.discount);
  const shipping = amount(data.shipping);
  const other = amount(data.other_cost);
  const vat = amount(data.vat);
  const total = round2(Math.max(0, subtotal - discount + shipping + other + vat));
  const status = PURCHASE_STATUSES[data.status] && data.status !== 'cancelled' ? data.status : 'received';
  const date = validYmd(data.purchase_date) || ymd();
  // Spread shipping/other costs/discount over items so the product cost is the real landed cost.
  const costShare = subtotal > 0 ? (shipping + other - discount) / subtotal : 0;

  return tx(async (t) => {
    const code = 'PO-' + randomCode(5);
    const p = (await t.query(`INSERT INTO purchases(code, supplier_id, purchase_date, status, subtotal, discount, shipping, other_cost, vat, total, note, created_by, received_at)
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
async function setPurchaseStatus(id, status, staffId) {
  return tx(async (t) => {
    const p = (await t.query('SELECT * FROM purchases WHERE id=$1 FOR UPDATE', [id])).rows[0];
    if (!p || p.status === status || !PURCHASE_STATUSES[status]) return;
    const items = (await t.query('SELECT * FROM purchase_items WHERE purchase_id=$1', [id])).rows;
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
async function listAccounts() {
  return q(`SELECT a.*, a.opening_balance
      + coalesce((SELECT sum(amount) FROM transactions t WHERE t.account_id=a.id AND t.type='income'),0)
      - coalesce((SELECT sum(amount) FROM transactions t WHERE t.account_id=a.id AND t.type IN ('expense','transfer')),0)
      + coalesce((SELECT sum(amount) FROM transactions t WHERE t.to_account_id=a.id AND t.type='transfer'),0) AS balance
    FROM accounts a ORDER BY a.active DESC, a.sort, a.id`);
}
async function saveAccount(data) {
  const f = [str(data.name, 80), ACCOUNT_TYPES[data.type] ? data.type : 'cash', str(data.details, 300), num(data.opening_balance), data.active !== undefined ? !!data.active : true];
  if (int(data.id)) {
    await q('UPDATE accounts SET name=$1, type=$2, details=$3, opening_balance=$4, active=$5 WHERE id=$6', [...f, int(data.id)]);
    return int(data.id);
  }
  return (await one('INSERT INTO accounts(name, type, details, opening_balance, active, sort) VALUES($1,$2,$3,$4,$5,(SELECT coalesce(max(sort),0)+1 FROM accounts)) RETURNING id', f)).id;
}
async function addTransaction(data, staffId) {
  const type = ['income', 'expense', 'transfer'].includes(data.type) ? data.type : 'expense';
  const amt = amount(data.amount);
  if (amt <= 0) throw new Error('টাকার পরিমাণ দিন।');
  if (type === 'transfer' && (!int(data.account_id) || !int(data.to_account_id) || int(data.account_id) === int(data.to_account_id))) {
    throw new Error('ট্রান্সফারের জন্য দুটো আলাদা অ্যাকাউন্ট বাছুন।');
  }
  const row = await one(`INSERT INTO transactions(tx_date, type, category, amount, account_id, to_account_id, supplier_id, order_id, purchase_id, vat, note, created_by)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
  [validYmd(data.tx_date) || ymd(), type, type === 'transfer' ? 'ট্রান্সফার' : str(data.category, 60) || 'অন্যান্য', amt,
    int(data.account_id) || null, type === 'transfer' ? int(data.to_account_id) : null, int(data.supplier_id) || null,
    int(data.order_id) || null, int(data.purchase_id) || null, amount(data.vat), str(data.note, 500), staffId || null]);
  return row.id;
}
async function deleteTransaction(id) { await q('DELETE FROM transactions WHERE id=$1', [id]); }
async function listTransactions({ from, to, type, accountId, category, limit = 200 } = {}) {
  const params = [];
  const where = [];
  if (from) { params.push(from); where.push(`t.tx_date >= $${params.length}`); }
  if (to) { params.push(to); where.push(`t.tx_date <= $${params.length}`); }
  if (type) { params.push(type); where.push(`t.type = $${params.length}`); }
  if (category) { params.push(category); where.push(`t.category = $${params.length}`); }
  if (accountId) { params.push(accountId); where.push(`(t.account_id = $${params.length} OR t.to_account_id = $${params.length})`); }
  params.push(limit);
  return q(`SELECT t.*, a.name AS account_name, a2.name AS to_account_name, s.name AS supplier_name, o.code AS order_code,
              p.code AS purchase_code, st.name AS staff_name
            FROM transactions t LEFT JOIN accounts a ON a.id=t.account_id LEFT JOIN accounts a2 ON a2.id=t.to_account_id
            LEFT JOIN suppliers s ON s.id=t.supplier_id LEFT JOIN orders o ON o.id=t.order_id
            LEFT JOIN purchases p ON p.id=t.purchase_id LEFT JOIN staff st ON st.id=t.created_by
            ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY t.tx_date DESC, t.id DESC LIMIT $${params.length}`, params);
}

// ---------------------------------------------------------------- reports
const DHAKA_DAY = `(o.created_at AT TIME ZONE 'Asia/Dhaka')::date`;

// Profit & loss for a date range. Sales are counted on delivered orders (by delivery date).
async function profitLoss(from, to) {
  const sales = await one(`SELECT count(*)::int AS orders, coalesce(sum(subtotal),0)::numeric(14,2) AS goods, coalesce(sum(discount + points_discount),0)::numeric(14,2) AS discount,
      coalesce(sum(delivery),0)::numeric(14,2) AS delivery, coalesce(sum(total),0)::numeric(14,2) AS revenue, coalesce(sum(cost_total),0)::numeric(14,2) AS cogs
    FROM orders o WHERE status='delivered' AND (coalesce(delivered_at, updated_at) AT TIME ZONE 'Asia/Dhaka')::date BETWEEN $1 AND $2`, [from, to]);
  const returns = await one(`SELECT count(*)::int AS n FROM orders o WHERE status='returned' AND (updated_at AT TIME ZONE 'Asia/Dhaka')::date BETWEEN $1 AND $2`, [from, to]);
  const exp = await q(`SELECT category, sum(amount)::numeric(14,2) AS amount FROM transactions WHERE type='expense' AND tx_date BETWEEN $1 AND $2 GROUP BY category ORDER BY amount DESC`, [from, to]);
  const inc = await q(`SELECT category, sum(amount)::numeric(14,2) AS amount FROM transactions WHERE type='income' AND tx_date BETWEEN $1 AND $2 GROUP BY category ORDER BY amount DESC`, [from, to]);
  const expenses = exp.filter((e) => !NON_PNL_EXPENSE.has(e.category));
  const otherIncome = inc.filter((e) => !NON_PNL_INCOME.has(e.category));
  const expenseTotal = expenses.reduce((s, e) => s + Number(e.amount), 0);
  const otherIncomeTotal = otherIncome.reduce((s, e) => s + Number(e.amount), 0);
  const gross = Number(sales.revenue) - Number(sales.cogs);
  return {
    sales, returns: returns.n, expenses, otherIncome, expenseTotal, otherIncomeTotal, gross,
    net: gross + otherIncomeTotal - expenseTotal,
    movements: { income: inc.filter((e) => NON_PNL_INCOME.has(e.category)), expense: exp.filter((e) => NON_PNL_EXPENSE.has(e.category)) },
  };
}

// VAT summary by month. mode: 'inclusive' (prices include VAT), 'exclusive' (VAT on top), 'margin' (VAT on gross margin).
async function vatReport(settings, year) {
  const rate = num(settings.vat_rate, 15);
  const mode = settings.vat_mode || 'none';
  const rows = await q(`SELECT to_char(coalesce(delivered_at, updated_at) AT TIME ZONE 'Asia/Dhaka', 'YYYY-MM') AS month,
      coalesce(sum(subtotal - discount - points_discount),0)::numeric(14,2) AS goods, coalesce(sum(cost_total),0)::numeric(14,2) AS cogs, count(*)::int AS orders
    FROM orders WHERE status='delivered' AND extract(year from coalesce(delivered_at, updated_at) AT TIME ZONE 'Asia/Dhaka') = $1
    GROUP BY 1 ORDER BY 1`, [year]);
  const input = await q(`SELECT to_char(purchase_date, 'YYYY-MM') AS month, coalesce(sum(vat),0)::numeric(14,2) AS vat
    FROM purchases WHERE status='received' AND extract(year from purchase_date) = $1 GROUP BY 1`, [year]);
  const paid = await q(`SELECT to_char(tx_date, 'YYYY-MM') AS month, coalesce(sum(amount),0)::numeric(14,2) AS amount
    FROM transactions WHERE type='expense' AND category='ভ্যাট/ট্যাক্স পরিশোধ' AND extract(year from tx_date) = $1 GROUP BY 1`, [year]);
  const months = [];
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
async function dailySeries(from, to) {
  return q(`SELECT d::date AS day,
      coalesce((SELECT count(*) FROM orders o WHERE ${DHAKA_DAY} = d::date),0)::int AS orders,
      coalesce((SELECT sum(total) FROM orders o WHERE ${DHAKA_DAY} = d::date AND o.status NOT IN ('cancelled')),0)::numeric(14,2) AS sales,
      coalesce((SELECT sum(total - cost_total - delivery) FROM orders o WHERE ${DHAKA_DAY} = d::date AND o.status NOT IN ('cancelled','returned')),0)::int AS profit,
      coalesce((SELECT count(*) FROM orders o WHERE ${DHAKA_DAY} = d::date AND o.status='delivered'),0)::int AS delivered
    FROM generate_series($1::date, $2::date, interval '1 day') d ORDER BY d`, [from, to]);
}
async function monthlySeries(months = 12) {
  return q(`SELECT to_char(m, 'YYYY-MM') AS month,
      coalesce((SELECT sum(total) FROM orders o WHERE date_trunc('month', o.created_at AT TIME ZONE 'Asia/Dhaka') = m AND o.status NOT IN ('cancelled','returned')),0)::numeric(14,2) AS sales,
      coalesce((SELECT sum(total - cost_total - delivery) FROM orders o WHERE date_trunc('month', o.created_at AT TIME ZONE 'Asia/Dhaka') = m AND o.status NOT IN ('cancelled','returned')),0)::numeric(14,2) AS gross,
      coalesce((SELECT sum(amount) FROM transactions t WHERE date_trunc('month', t.tx_date) = m AND t.type='expense'
         AND t.category NOT IN ('সাপ্লায়ার পেমেন্ট','মালিকের উত্তোলন','ঋণ পরিশোধ','ভ্যাট/ট্যাক্স পরিশোধ')),0)::numeric(14,2) AS expenses
    FROM generate_series(date_trunc('month', (now() AT TIME ZONE 'Asia/Dhaka')) - ($1::int - 1) * interval '1 month',
                         date_trunc('month', (now() AT TIME ZONE 'Asia/Dhaka')), interval '1 month') m ORDER BY m`, [months]);
}

async function dashboard(from, to) {
  const k = await one(`SELECT
      count(*)::int AS orders,
      count(*) FILTER (WHERE status='pending')::int AS pending_in_range,
      count(*) FILTER (WHERE status='delivered')::int AS delivered,
      count(*) FILTER (WHERE status IN ('cancelled','returned'))::int AS failed,
      coalesce(sum(total) FILTER (WHERE status NOT IN ('cancelled','returned')),0)::numeric(14,2) AS sales,
      coalesce(sum(total - cost_total - delivery) FILTER (WHERE status NOT IN ('cancelled','returned')),0)::numeric(14,2) AS gross,
      coalesce(avg(total) FILTER (WHERE status NOT IN ('cancelled','returned')),0)::numeric(14,2) AS aov,
      count(DISTINCT phone)::int AS buyers
    FROM orders o WHERE ${DHAKA_DAY} BETWEEN $1 AND $2`, [from, to]);
  const live = await one(`SELECT
      (SELECT count(*) FROM orders WHERE status='pending')::int AS pending,
      (SELECT count(*) FROM orders WHERE status IN ('confirmed','processing'))::int AS to_ship,
      (SELECT count(*) FROM orders WHERE status='shipped')::int AS shipped,
      (SELECT count(*) FROM orders o WHERE ${DHAKA_DAY} = (now() AT TIME ZONE 'Asia/Dhaka')::date)::int AS today_orders,
      (SELECT coalesce(sum(total),0) FROM orders o WHERE ${DHAKA_DAY} = (now() AT TIME ZONE 'Asia/Dhaka')::date AND status<>'cancelled')::numeric(14,2) AS today_sales,
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
  const byStatus = await q(`SELECT status, count(*)::int AS n FROM orders o WHERE ${DHAKA_DAY} BETWEEN $1 AND $2 GROUP BY status`, [from, to]);
  const topProducts = await q(`SELECT i.product_id, i.name, sum(i.qty)::int AS qty, sum(i.qty * i.price)::numeric(14,2) AS revenue,
      sum(i.qty * (i.price - i.cost))::numeric(14,2) AS profit
    FROM order_items i JOIN orders o ON o.id=i.order_id WHERE ${DHAKA_DAY} BETWEEN $1 AND $2 AND o.status NOT IN ('cancelled','returned')
    GROUP BY i.product_id, i.name ORDER BY qty DESC LIMIT 8`, [from, to]);
  const byCategory = await q(`SELECT coalesce(c.name, 'ক্যাটাগরি নেই') AS name, sum(i.qty * i.price)::numeric(14,2) AS revenue
    FROM order_items i JOIN orders o ON o.id=i.order_id LEFT JOIN products p ON p.id=i.product_id LEFT JOIN categories c ON c.id=p.category_id
    WHERE ${DHAKA_DAY} BETWEEN $1 AND $2 AND o.status NOT IN ('cancelled','returned') GROUP BY 1 ORDER BY 2 DESC LIMIT 8`, [from, to]);
  const byZone = await q(`SELECT area, count(*)::int AS n FROM orders o WHERE ${DHAKA_DAY} BETWEEN $1 AND $2 GROUP BY area`, [from, to]);
  const byPayment = await q(`SELECT payment, count(*)::int AS n FROM orders o WHERE ${DHAKA_DAY} BETWEEN $1 AND $2 GROUP BY payment ORDER BY n DESC`, [from, to]);
  const byDistrict = await q(`SELECT coalesce(nullif(district,''),'অজানা') AS district, count(*)::int AS n FROM orders o WHERE ${DHAKA_DAY} BETWEEN $1 AND $2 GROUP BY 1 ORDER BY 2 DESC LIMIT 8`, [from, to]);
  const byHour = await q(`SELECT extract(hour from o.created_at AT TIME ZONE 'Asia/Dhaka')::int AS h, count(*)::int AS n FROM orders o WHERE ${DHAKA_DAY} BETWEEN $1 AND $2 GROUP BY 1`, [from, to]);
  const expenses = await one(`SELECT coalesce(sum(amount),0)::numeric(14,2) AS total FROM transactions WHERE type='expense' AND tx_date BETWEEN $1 AND $2
      AND category NOT IN ('সাপ্লায়ার পেমেন্ট','মালিকের উত্তোলন','ঋণ পরিশোধ','ভ্যাট/ট্যাক্স পরিশোধ')`, [from, to]);
  const inventory = await catalog.inventorySummary();
  const lowStock = await catalog.listProducts({ includeInactive: false, lowStock: true, sort: 'stock_asc', limit: 8, type: 'single' });
  return { k, live, byStatus, topProducts, byCategory, byZone, byPayment, byDistrict, byHour, expenses: Number(expenses.total), inventory, lowStock };
}

async function staffReport(from, to) {
  return q(`SELECT s.id, s.name, s.role, s.active, s.last_login,
      (SELECT count(*) FROM activity_log a WHERE a.staff_id=s.id AND (a.created_at AT TIME ZONE 'Asia/Dhaka')::date BETWEEN $1 AND $2)::int AS actions,
      (SELECT count(*) FROM activity_log a WHERE a.staff_id=s.id AND a.action='order_status' AND a.detail LIKE '%→ confirmed%' AND (a.created_at AT TIME ZONE 'Asia/Dhaka')::date BETWEEN $1 AND $2)::int AS confirmed,
      (SELECT count(*) FROM activity_log a WHERE a.staff_id=s.id AND a.action='order_status' AND a.detail LIKE '%→ cancelled%' AND (a.created_at AT TIME ZONE 'Asia/Dhaka')::date BETWEEN $1 AND $2)::int AS cancelled,
      (SELECT count(*) FROM activity_log a WHERE a.staff_id=s.id AND a.action='order_edit' AND (a.created_at AT TIME ZONE 'Asia/Dhaka')::date BETWEEN $1 AND $2)::int AS edits,
      (SELECT count(*) FROM orders o WHERE o.created_by=s.id AND ${DHAKA_DAY} BETWEEN $1 AND $2)::int AS created,
      (SELECT count(*) FROM activity_log a WHERE a.staff_id=s.id AND a.action='courier_send' AND (a.created_at AT TIME ZONE 'Asia/Dhaka')::date BETWEEN $1 AND $2)::int AS sent,
      (SELECT count(*) FROM activity_log a WHERE a.staff_id=s.id AND a.action='login' AND (a.created_at AT TIME ZONE 'Asia/Dhaka')::date BETWEEN $1 AND $2)::int AS logins
    FROM staff s ORDER BY s.role='owner' DESC, s.name`, [from, to]);
}

module.exports = {
  EXPENSE_CATEGORIES, INCOME_CATEGORIES, ACCOUNT_TYPES, PURCHASE_STATUSES,
  listSuppliers, getSupplier, saveSupplier, supplierDue,
  listPurchases, getPurchase, savePurchase, setPurchaseStatus,
  listAccounts, saveAccount, addTransaction, deleteTransaction, listTransactions,
  profitLoss, vatReport, dailySeries, monthlySeries, dashboard, staffReport,
};
