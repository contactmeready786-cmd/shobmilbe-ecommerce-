'use strict';
// Database backup and restore.
//  - dump(): every table → one gzip'd JSON file (pictures and visitor analytics optional), optionally locked with a password
//    (AES-256-GCM, key from scrypt) — a backup holds customers' names, phones and addresses, so lock it.
//  - restore(): puts a backup back into a database (used by tools/restore.js, best into a fresh Neon branch).
const crypto = require('crypto');
const zlib = require('zlib');

const MAGIC = Buffer.from('SMBK1');
// big and not needed to run the shop — left out unless asked for
const ANALYTICS = new Set(['visitors', 'visit_sessions', 'page_views', 'visit_events', 'research_items', 'research_queue', 'research_hosts', 'rate_limits', 'security_events', 'live_clicks', 'translations']);
const NEVER = new Set(['admin_sessions', 'login_lock_codes']); // live logins are never copied

async function tableList(db) {
  return (await db.q(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name`)).map((r) => r.table_name);
}
async function columnsOf(db, table) {
  return db.q(`SELECT column_name AS name, data_type AS type FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`, [table]);
}
const qi = (n) => '"' + String(n).replace(/"/g, '""') + '"';

// { withImages, withAnalytics } → { buffer (gzip json), tables, rows }
async function dump(db, { withImages = false, withAnalytics = false, password = '' } = {}) {
  const tables = (await tableList(db)).filter((t) => !NEVER.has(t) && (withAnalytics || !ANALYTICS.has(t)) && (withImages || t !== 'media'));
  const schema = await db.one("SELECT value FROM settings WHERE key='schema_version'");
  const out = { app: 'shobmilbe', format: 1, schema_version: schema ? Number(schema.value) : null, created_at: new Date().toISOString(), with_images: !!withImages, tables: {} };
  let rows = 0;
  for (const t of tables) {
    const cols = await columnsOf(db, t);
    const sel = cols.map((c) => (c.type === 'bytea' ? `encode(${qi(c.name)}, 'base64') AS ${qi(c.name)}` : qi(c.name))).join(', ');
    const data = await db.q(`SELECT ${sel} FROM ${qi(t)}`);
    out.tables[t] = { columns: cols.map((c) => c.name), bytea: cols.filter((c) => c.type === 'bytea').map((c) => c.name), rows: data.map((r) => cols.map((c) => r[c.name])) };
    rows += data.length;
  }
  let buffer = zlib.gzipSync(Buffer.from(JSON.stringify(out), 'utf8'), { level: 9 });
  if (password) buffer = lock(buffer, password);
  return { buffer, tables: tables.length, rows, encrypted: !!password };
}

function lock(buf, password) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(String(password), salt, 32, { N: 16384, r: 8, p: 1 });
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([c.update(buf), c.final()]);
  return Buffer.concat([MAGIC, salt, iv, c.getAuthTag(), enc]);
}
function unlock(buf, password) {
  if (!buf.subarray(0, 5).equals(MAGIC)) return buf; // not locked
  if (!password) throw new Error('এই ব্যাকআপ পাসওয়ার্ড দিয়ে তালাবদ্ধ — পাসওয়ার্ড দিন (--password)।');
  const salt = buf.subarray(5, 21); const iv = buf.subarray(21, 33); const tag = buf.subarray(33, 49);
  const key = crypto.scryptSync(String(password), salt, 32, { N: 16384, r: 8, p: 1 });
  const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
  d.setAuthTag(tag);
  try { return Buffer.concat([d.update(buf.subarray(49)), d.final()]); } catch (_) { throw new Error('পাসওয়ার্ড ভুল, অথবা ফাইলটা নষ্ট।'); }
}
function read(buf, password) {
  const data = JSON.parse(zlib.gunzipSync(unlock(buf, password)).toString('utf8'));
  if (data.app !== 'shobmilbe' || !data.tables) throw new Error('এটা এই দোকানের ব্যাকআপ ফাইল না।');
  return data;
}

// Tables in an order where every table comes after the tables it points to.
async function fkOrder(db, tables) {
  const deps = await db.q(`SELECT tc.relname AS child, tp.relname AS parent FROM pg_constraint c
    JOIN pg_class tc ON tc.oid=c.conrelid JOIN pg_class tp ON tp.oid=c.confrelid JOIN pg_namespace n ON n.oid=tc.relnamespace
    WHERE c.contype='f' AND n.nspname='public'`);
  const set = new Set(tables); const done = []; const seen = new Set();
  const visit = (t, stack = new Set()) => {
    if (seen.has(t) || stack.has(t)) return;
    stack.add(t);
    deps.filter((d) => d.child === t && d.parent !== t && set.has(d.parent)).forEach((d) => visit(d.parent, stack));
    seen.add(t); done.push(t);
  };
  tables.forEach((t) => visit(t));
  return done;
}

// Put a backup into the database at db. Every table in the backup is emptied first and refilled.
async function restore(db, data, { log = () => {} } = {}) {
  const existing = new Set(await tableList(db));
  const tables = Object.keys(data.tables).filter((t) => existing.has(t) && !NEVER.has(t));
  const order = await fkOrder(db, tables);
  let total = 0;
  await db.tx(async (t) => {
    await t.query(`TRUNCATE ${order.map(qi).join(', ')} RESTART IDENTITY CASCADE`);
    for (const name of order) {
      const T = data.tables[name];
      const have = new Set((await t.query(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1`, [name])).rows.map((r) => r.column_name));
      const cols = T.columns.filter((c) => have.has(c));
      const idx = cols.map((c) => T.columns.indexOf(c));
      const byteaCols = new Set(T.bytea || []);
      for (let i = 0; i < T.rows.length; i += 500) {
        const chunk = T.rows.slice(i, i + 500).map((r) => {
          const o = {};
          cols.forEach((c, k) => { const v = r[idx[k]]; o[c] = byteaCols.has(c) && v != null ? '\\x' + Buffer.from(v, 'base64').toString('hex') : v; });
          return o;
        });
        await t.query(`INSERT INTO ${qi(name)} (${cols.map(qi).join(', ')}) SELECT ${cols.map(qi).join(', ')} FROM json_populate_recordset(NULL::${qi(name)}, $1::json)`, [JSON.stringify(chunk)]);
      }
      total += T.rows.length;
      log(`${name}: ${T.rows.length}`);
    }
    // id counters continue after the restored rows
    const seqs = (await t.query(`SELECT c.table_name, c.column_name, pg_get_serial_sequence(quote_ident(c.table_name), c.column_name) AS seq
      FROM information_schema.columns c WHERE c.table_schema='public' AND c.column_default LIKE 'nextval(%'`)).rows;
    for (const s of seqs) {
      if (!s.seq || !order.includes(s.table_name)) continue;
      await t.query(`SELECT setval($1, coalesce((SELECT max(${qi(s.column_name)}) FROM ${qi(s.table_name)}), 0) + 1, false)`, [s.seq]);
    }
  });
  return { tables: order.length, rows: total };
}

module.exports = { dump, read, restore, lock, unlock, ANALYTICS };
