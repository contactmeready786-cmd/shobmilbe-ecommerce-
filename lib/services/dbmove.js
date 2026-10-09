'use strict';
// One-time move: copy everything from the old Neon database into the new Supabase one.
//  - Runs only when the site is on Supabase AND an old Neon address is still set in Vercel.
//  - Works in small steps (each request ~9 s, Vercel cuts a request at 15 s); progress is kept
//    in its own table, so a cut or a reload just carries on where it stopped.
//  - When it finishes it never runs again.
const pg = require('../pg');
const db = require('../db');

const qi = (n) => '"' + String(n).replace(/"/g, '""') + '"';
const NEVER = new Set(['admin_sessions', 'login_lock_codes', '_db_move', '_db_move_lease']); // live logins are never copied
// Visitor tracking (who came, what they clicked) starts again from zero — the owner asked for that;
// everything else in the admin (products, orders, customers, settings, research, translations…) comes over.
const SKIP = new Set(['visitors', 'visit_sessions', 'page_views', 'visit_events', 'live_clicks', 'rate_limits', 'security_events']);
const imagekit = require('./imagekit');
const STEP_MS = Number(process.env.DBMOVE_STEP_MS) || 20000; // the move route may run 60 s (vercel.json)

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

// Every Neon address Vercel gave us (pooled and direct); the first one that answers is used.
function neonUrls() {
  const env = process.env;
  return [...new Set(Object.keys(env).filter((n) => /^postgres(ql)?:\/\//i.test(String(env[n] || '')) && /neon\.tech/.test(env[n]))
    .sort((a, b) => (/pooler/.test(env[b]) - /pooler/.test(env[a])) || a.localeCompare(b)).map((n) => env[n]))];
}
async function connectOld() {
  const errs = [];
  for (const u of neonUrls()) {
    const c = new pg.Connection(pg.parseConnectionString(u));
    try { await c.connect(); return c; } catch (e) {
      try { c.end(); } catch (_) {}
      errs.push(`${/pooler/.test(u) ? 'pooled' : 'direct'}: ${e.message}`);
    }
  }
  throw new Error('পুরনো ডাটাবেস (Neon) সাড়া দিচ্ছে না — ' + errs.join(' | '));
}

async function mapLimit(items, n, fn) {
  const out = new Array(items.length); let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
  }));
  return out;
}

async function cols(conn, t) {
  return (await conn.query(`SELECT column_name AS name, data_type AS type FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`, [t])).rows;
}

// Do one step of the move. Returns the progress for the waiting page.
async function step() {
  if (!(await pending())) return { done: true };
  // Only one step at a time (two open tabs must not copy the same rows twice).
  // A lease row instead of a session lock: if a step is cut off mid-way, the lease simply runs out after 90 s.
  await state();
  await db.q(`CREATE TABLE IF NOT EXISTS _db_move_lease (id int PRIMARY KEY, until timestamptz NOT NULL)`);
  const got = await db.one(`INSERT INTO _db_move_lease(id, until) VALUES(1, now() + interval '90 seconds')
    ON CONFLICT (id) DO UPDATE SET until = now() + interval '90 seconds' WHERE _db_move_lease.until < now() RETURNING id`);
  if (!got) { const b = await state(); return { done: false, busy: true, copied: b ? b.copied : 0, total: b ? b.total : 0 }; }
  try { return await stepLocked(); } finally { await db.q(`UPDATE _db_move_lease SET until = now() - interval '1 second' WHERE id=1`).catch(() => {}); }
}

async function stepLocked() {
  let s = await state();
  if (s && s.done) return { done: true, verify: s.verify };
  // Pictures go to ImageKit, not into the (small) new database — so ImageKit must be set up first.
  const why = await imagekit.check();
  if (why) return { done: false, needKeys: true, why, copied: s ? s.copied : 0, total: s ? s.total : 0 };
  const src = await connectOld();
  const started = Date.now();
  try {
    if (!s) {
      // First step: which tables to copy (in both databases), empty them here, then copy one by one.
      const here = new Set(await db.q(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'`).then((r) => r.map((x) => x.table_name)));
      const list = (await tables(src)).filter((t) => here.has(t) && !NEVER.has(t) && !SKIP.has(t));
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
      const isMedia = t === 'media';
      const bytea = use.filter((c) => c.type === 'bytea');
      const size = isMedia ? 6 : bytea.length ? 10 : 1000;
      const sel = use.map((c) => (c.type !== 'bytea' ? qi(c.name)
        : isMedia && c.name === 'thumb' ? `CASE WHEN owner_type ~ '^(trash:)?staff$' THEN encode(thumb, 'hex') END AS thumb`
        : `encode(${qi(c.name)}, 'hex') AS ${qi(c.name)}`)).join(', ');
      // Tables with pictures are walked by id (fast at any depth: OFFSET would re-read every earlier picture).
      // Rows already copied are skipped before anything is uploaded.
      const byId = bytea.length && use.some((c) => c.name === 'id');
      let rows; let batch = 0;
      if (byId) {
        const ids = (await src.query(`SELECT id FROM ${qi(t)} WHERE id > $1 ORDER BY id LIMIT ${size}`, [Number(s.lastKey || 0)])).rows.map((r) => r.id);
        batch = ids.length;
        const have = ids.length ? new Set((await db.q(`SELECT id FROM ${qi(t)} WHERE id = ANY($1::int[])`, [ids])).map((r) => r.id)) : new Set();
        const need = ids.filter((id) => !have.has(id));
        rows = need.length ? (await src.query(`SELECT ${sel} FROM ${qi(t)} WHERE id = ANY($1::int[]) ORDER BY id`, [need])).rows : [];
        if (ids.length) s.lastKey = ids[ids.length - 1];
        if (ids.length < size) { s.i += 1; s.offset = 0; s.lastKey = 0; }
        if (!rows.length) { await save(s); continue; }
      } else {
        rows = (await src.query(`SELECT ${sel} FROM ${qi(t)} ORDER BY ctid LIMIT ${size} OFFSET ${Number(s.offset)}`)).rows;
        batch = rows.length;
      }
      if (rows.length) {
        let names = use.map((c) => c.name);
        let out;
        if (isMedia) {
          // Each picture (and its watermarked copy) is uploaded to ImageKit; only the address is kept here.
          // Staff / owner photos are private and stay in the database.
          names = [...new Set([...names, 'ik_url', 'ik_id', 'wm_url', 'wm_ik_id'])];
          out = await mapLimit(rows, 6, async (r) => {
            const o = {};
            for (const c of use) o[c.name] = c.type === 'bytea' && r[c.name] != null ? '\\x' + r[c.name] : r[c.name];
            const priv = /^(trash:)?staff$/.test(String(r.owner_type || ''));
            if (!priv && r.data) {
              const up = await imagekit.upload(Buffer.from(r.data, 'hex'), r.mime, `m${r.id}`);
              o.ik_url = up.url; o.ik_id = up.fileId; o.data = null; o.thumb = null;
              if (r.wm) { const w = await imagekit.upload(Buffer.from(r.wm, 'hex'), 'image/jpeg', `m${r.id}-wm`, 'wm'); o.wm_url = w.url; o.wm_ik_id = w.fileId; o.wm = null; }
            }
            return o;
          });
        } else {
          out = rows.map((r) => {
            const o = {};
            for (const c of use) o[c.name] = c.type === 'bytea' && r[c.name] != null ? '\\x' + r[c.name] : r[c.name];
            return o;
          });
        }
        s.copied += rows.length;
        if (!byId) { s.offset += rows.length; if (batch < size) { s.i += 1; s.offset = 0; } }
        // rows and progress are saved together, so a cut-off step can never copy a row twice
        // (and ON CONFLICT makes even that harmless)
        await db.tx(async (tx) => {
          await tx.query(`INSERT INTO ${qi(t)} (${names.map(qi).join(', ')}) SELECT ${names.map(qi).join(', ')} FROM json_populate_recordset(NULL::${qi(t)}, $1::json) ON CONFLICT DO NOTHING`, [JSON.stringify(out)]);
          await tx.query(`INSERT INTO _db_move(id, data, updated_at) VALUES(1, $1, now()) ON CONFLICT (id) DO UPDATE SET data=$1, updated_at=now()`, [JSON.stringify(s)]);
        });
      } else {
        s.i += 1; s.offset = 0;
        await save(s);
      }
    }
    if (s.i >= s.order.length) {
      // id counters continue after the copied rows
      const seqs = await db.q(`SELECT c.table_name, c.column_name, pg_get_serial_sequence(quote_ident(c.table_name), c.column_name) AS seq
        FROM information_schema.columns c WHERE c.table_schema='public' AND c.column_default LIKE 'nextval(%'`);
      for (const q of seqs) {
        if (!q.seq || !s.order.includes(q.table_name)) continue;
        await db.q(`SELECT setval($1, coalesce((SELECT max(${qi(q.column_name)}) FROM ${qi(q.table_name)}), 0) + 1, false)`, [q.seq]);
      }
      // Check: every table here must hold exactly as many rows as in the old database,
      // and every picture must have an ImageKit address (or, for private photos, its bytes).
      const mismatches = [];
      for (const t of s.order) {
        const here = Number((await db.one(`SELECT count(*)::bigint AS n FROM ${qi(t)}`)).n);
        const there = Number((await src.query(`SELECT count(*)::bigint AS n FROM ${qi(t)}`)).rows[0].n);
        if (here !== there) mismatches.push(`${t}: ${there} → ${here}`);
      }
      if (s.order.includes('media')) {
        const lost = Number((await db.one(`SELECT count(*)::int AS n FROM media WHERE ik_url IS NULL AND data IS NULL`)).n);
        if (lost) mismatches.push(`media: ${lost}টি ছবির ঠিকানা নেই`);
      }
      s.verify = { ok: mismatches.length === 0, mismatches, tables: s.order.length, rows: s.total, checked_at: new Date().toISOString() };
      if (!s.verify.ok) {
        // Something did not match: start the whole copy again from the beginning (safe — the old database is untouched).
        s.tries = (s.tries || 0) + 1;
        if (s.tries < 3) { await save({ ...s, i: 0, offset: 0, lastKey: 0, copied: 0, restart: true }); await db.q(`TRUNCATE ${s.order.map(qi).join(', ')} RESTART IDENTITY CASCADE`); return { done: false, copied: 0, total: s.total, retry: s.tries }; }
      }
      s.done = true; s.finished_at = new Date().toISOString();
      await save(s);
      doneCache = true;
    }
  } finally {
    src.end();
  }
  return { done: !!s.done, copied: s.copied, total: s.total, table: s.order[s.i] || '', verify: s.verify };
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
    var msg = document.getElementById('msg');
    if (d.error) { msg.textContent = 'সমস্যা: ' + d.error + ' — ১০ সেকেন্ড পর আবার চেষ্টা হবে।'; return setTimeout(run, 10000); }
    if (d.needKeys) { msg.innerHTML = '⏸️ ছবিগুলো ImageKit-এ যাবে, কিন্তু Vercel-এ ImageKit-এর চাবি (IMAGEKIT_PRIVATE_KEY ও IMAGEKIT_URL_ENDPOINT) এখনো বসানো হয়নি। চাবি বসিয়ে Redeploy দিলে নিজে থেকেই শুরু হবে।' + (d.why ? '<br><b>কারণ: ' + d.why + '</b>' : ''); return setTimeout(run, 30000); }
    var pc = d.total ? Math.min(100, Math.round(d.copied * 100 / d.total)) : 100;
    document.getElementById('bar').style.width = pc + '%';
    if (d.retry) { msg.textContent = 'যাচাইয়ে অমিল পাওয়া গেছে, তাই আবার প্রথম থেকে নিখুঁতভাবে কপি হচ্ছে (চেষ্টা ' + (d.retry + 1) + ')…'; return run(); }
    if (d.done) {
      var v = d.verify || {};
      msg.innerHTML = v.ok ? '✅ সম্পূর্ণ হয়েছে! ' + (v.tables || '') + 'টি টেবিলের ' + (v.rows || '') + 'টি তথ্য একটা একটা করে মিলিয়ে দেখা হয়েছে — ১০০% মিলেছে। দোকান খুলছে…'
        : '⚠️ কপি শেষ, কিন্তু কিছু অমিল আছে: ' + (v.mismatches || []).join(', ') + '। পুরনো ডাটাবেস মুছবেন না — Claude-কে এই লেখার স্ক্রিনশট দিন।';
      if (v.ok) setTimeout(function () { location.reload(); }, 4000);
      return;
    }
    msg.textContent = pc + '% সম্পন্ন (' + d.copied + ' / ' + d.total + ')';
    run();
  }).catch(function () { setTimeout(run, 5000); });
})();
</script></body></html>`;
}

// For the admin: the result of the move (null if it never ran here).
async function report() {
  try { const r = await db.one('SELECT data FROM _db_move WHERE id=1'); return r ? r.data : null; } catch (_) { return null; }
}

// Progress only (no work done) — lets the owner's helper check from outside.
async function status() {
  const s = await state();
  const why = await imagekit.check();
  if (why) return { done: false, needKeys: true, why, copied: s ? s.copied : 0, total: s ? s.total : 0 };
  return s ? { done: !!s.done, copied: s.copied, total: s.total, table: (s.order || [])[s.i] || '', verify: s.verify, updated: true } : { done: false, started: false };
}

module.exports = { pending, step, page, neonUrl, report, status };
