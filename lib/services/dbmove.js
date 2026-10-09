'use strict';
// One-time move: copy everything from the old Neon database into the new Supabase one.
//  - Runs only when the site is on Supabase AND an old Neon address is still set in Vercel.
//  - Works in small steps (each request ~9 s, Vercel cuts a request at 15 s); progress is kept
//    in its own table, so a cut or a reload just carries on where it stopped.
//  - When it finishes it never runs again.
const pg = require('../pg');
const db = require('../db');

const qi = (n) => '"' + String(n).replace(/"/g, '""') + '"';
const NEVER = new Set(['admin_sessions', 'login_lock_codes', '_db_move']); // live logins are never copied
// Visitor counts, research logs and the like: big, not needed to run the shop, and Supabase's free space is small.
const { ANALYTICS } = require('./backup');
const STEP_MS = Number(process.env.DBMOVE_STEP_MS) || 9000;

function neonUrl() {
  const env = process.env;
  const k = Object.keys(env).filter((n) => /^postgres(ql)?:\/\//i.test(String(env[n] || '')) && /neon\.tech/.test(env[n]))
    .sort((a, b) => (a === 'DATABASE_URL' ? -1 : b === 'DATABASE_URL' ? 1 : 0) || (/pooler/.test(env[a]) - /pooler/.test(env[b])) || a.localeCompare(b));
  return k.length ? env[k[0]] : '';
}

let doneCache = false;
async function state() {
  await db.q(`CREATE TABLE IF NOT EXISTS _db_move (id int PRIMARY KEY, data jsonb NOT NULL, updated_at timestamptz DEFAULT now())`);
  const r = await db.one('SELECT data FROM _db_move WHERE id=1');
  return r ? r.data : null;
}
async function save(s) {
  await db.q(`INSERT INTO _db_move(id, data, updated_at) VALUES(1, $1, now()) ON CONFLICT (id) DO UPDATE SET data=$1, updated_at=now()`, [JSON.stringify(s)]);
}

// Is there a move still to do?
async function pending() {
  if (doneCache) return false;
  if (pg.databaseInfo().provider !== 'Supabase' || !neonUrl()) { doneCache = true; return false; }
  const s = await state();
  if (s && s.done) { doneCache = true; return false; }
  return true;
}

async function tables(conn) {
  return (await conn.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name`)).rows.map((r) => r.table_name);
}

// Tables in an order where every table comes after the tables it points to.
async function fkOrder(list) {
  const deps = await db.q(`SELECT tc.relname AS child, tp.relname AS parent FROM pg_constraint c
    JOIN pg_class tc ON tc.oid=c.conrelid JOIN pg_class tp ON tp.oid=c.confrelid JOIN pg_namespace n ON n.oid=tc.relnamespace
    WHERE c.contype='f' AND n.nspname='public'`);
  const set = new Set(list); const done = []; const seen = new Set();
  const visit = (t, stack = new Set()) => {
    if (seen.has(t) || stack.has(t)) return;
    stack.add(t);
    deps.filter((d) => d.child === t && d.parent !== t && set.has(d.parent)).forEach((d) => visit(d.parent, stack));
    seen.add(t); done.push(t);
  };
  list.forEach((t) => visit(t));
  return done;
}

async function cols(conn, t) {
  return (await conn.query(`SELECT column_name AS name, data_type AS type FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`, [t])).rows;
}

// Do one step of the move. Returns the progress for the waiting page.
async function step() {
  if (!(await pending())) return { done: true };
  // Only one step at a time (two open tabs must not copy the same rows twice).
  const got = await db.one('SELECT pg_try_advisory_lock(726202) AS ok');
  if (!got || !got.ok) { const b = await state(); return { done: false, busy: true, copied: b ? b.copied : 0, total: b ? b.total : 0 }; }
  try { return await stepLocked(); } finally { await db.q('SELECT pg_advisory_unlock(726202)').catch(() => {}); }
}

async function stepLocked() {
  let s = await state();
  if (s && s.done) return { done: true };
  const src = new pg.Connection(pg.parseConnectionString(neonUrl()));
  await src.connect();
  const started = Date.now();
  try {
    if (!s) {
      // First step: which tables to copy (in both databases), empty them here, then copy one by one.
      const here = new Set(await db.q(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'`).then((r) => r.map((x) => x.table_name)));
      const list = (await tables(src)).filter((t) => here.has(t) && !NEVER.has(t) && !ANALYTICS.has(t));
      const order = await fkOrder(list);
      const counts = {};
      for (const t of order) counts[t] = Number((await src.query(`SELECT count(*)::bigint AS n FROM ${qi(t)}`)).rows[0].n);
      await db.q(`TRUNCATE ${order.map(qi).join(', ')} RESTART IDENTITY CASCADE`);
      s = { order, counts, i: 0, offset: 0, copied: 0, total: Object.values(counts).reduce((a, b) => a + b, 0), done: false };
      await save(s);
    }
    while (s.i < s.order.length && Date.now() - started < STEP_MS) {
      const t = s.order[s.i];
      const a = await cols(src, t);
      const haveHere = new Set((await db.q(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1`, [t])).map((r) => r.column_name));
      const use = a.filter((c) => haveHere.has(c.name));
      const bytea = use.filter((c) => c.type === 'bytea');
      const size = bytea.length ? 15 : 1000;
      const sel = use.map((c) => (c.type === 'bytea' ? `encode(${qi(c.name)}, 'hex') AS ${qi(c.name)}` : qi(c.name))).join(', ');
      const rows = (await src.query(`SELECT ${sel} FROM ${qi(t)} ORDER BY ctid LIMIT ${size} OFFSET ${Number(s.offset)}`)).rows;
      if (rows.length) {
        const out = rows.map((r) => {
          const o = {};
          for (const c of use) o[c.name] = c.type === 'bytea' && r[c.name] != null ? '\\x' + r[c.name] : r[c.name];
          return o;
        });
        await db.q(`INSERT INTO ${qi(t)} (${use.map((c) => qi(c.name)).join(', ')}) SELECT ${use.map((c) => qi(c.name)).join(', ')} FROM json_populate_recordset(NULL::${qi(t)}, $1::json)`, [JSON.stringify(out)]);
        s.offset += rows.length; s.copied += rows.length;
      }
      if (rows.length < size) { s.i += 1; s.offset = 0; }
      await save(s);
    }
    if (s.i >= s.order.length) {
      // id counters continue after the copied rows
      const seqs = await db.q(`SELECT c.table_name, c.column_name, pg_get_serial_sequence(quote_ident(c.table_name), c.column_name) AS seq
        FROM information_schema.columns c WHERE c.table_schema='public' AND c.column_default LIKE 'nextval(%'`);
      for (const q of seqs) {
        if (!q.seq || !s.order.includes(q.table_name)) continue;
        await db.q(`SELECT setval($1, coalesce((SELECT max(${qi(q.column_name)}) FROM ${qi(q.table_name)}), 0) + 1, false)`, [q.seq]);
      }
      s.done = true; s.finished_at = new Date().toISOString();
      await save(s);
      doneCache = true;
    }
  } finally {
    src.end();
  }
  return { done: !!s.done, copied: s.copied, total: s.total, table: s.order[s.i] || '' };
}

function page() {
  return `<!doctype html><html lang="bn"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>ডেটা সরানো হচ্ছে</title>
<body style="font-family:'Noto Sans Bengali',sans-serif;max-width:520px;margin:60px auto;padding:0 20px;line-height:1.7;color:#14213D;text-align:center">
<h1>পুরনো ডাটাবেস থেকে সব তথ্য নতুনটায় সরানো হচ্ছে</h1>
<p>এটা একবারই হয়। পেজটা খোলা রাখুন, শেষ হলে নিজেই দোকান খুলে যাবে।</p>
<div style="background:#e5e7eb;border-radius:8px;height:18px;overflow:hidden"><div id="bar" style="background:#16a34a;height:100%;width:0%"></div></div>
<p id="msg">শুরু হচ্ছে…</p>
<script>
(function run(){
  fetch('/__dbmove', { method: 'POST' }).then(function (r) { return r.json(); }).then(function (d) {
    if (d.error) { document.getElementById('msg').textContent = 'সমস্যা: ' + d.error + ' — ১০ সেকেন্ড পর আবার চেষ্টা হবে।'; return setTimeout(run, 10000); }
    var pc = d.total ? Math.min(100, Math.round(d.copied * 100 / d.total)) : 100;
    document.getElementById('bar').style.width = pc + '%';
    document.getElementById('msg').textContent = d.done ? 'সম্পূর্ণ হয়েছে! দোকান খুলছে…' : pc + '% সম্পন্ন (' + d.copied + ' / ' + d.total + ')';
    if (d.done) setTimeout(function () { location.reload(); }, 1500); else run();
  }).catch(function () { setTimeout(run, 5000); });
})();
</script></body></html>`;
}

module.exports = { pending, step, page, neonUrl };
