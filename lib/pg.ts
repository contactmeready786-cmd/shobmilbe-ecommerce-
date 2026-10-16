// Database connection, built on node-postgres ("pg", the standard PostgreSQL driver for Node.js).
//
// What the rest of the shop sees is unchanged from the old hand-written client:
//   query(sql, params) → { rows, rowCount, command }, exec(sql) for several statements, transaction(fn),
//   the same value types back (numbers, booleans, Dates, Buffers, parsed JSON, arrays; other types as text),
//   and PgError with .code / .detail / .severity.
// One shared connection per server instance; queries take turns on it, and a transaction has it to itself.
// Code running inside a transaction may call the plain query() helpers; those calls are routed into the open
// transaction instead of queueing behind it.
import { AsyncLocalStorage } from 'node:async_hooks';
import type { ConnectionOptions } from 'node:tls';
import pg from 'pg';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- a row's columns depend on the query
export type DbRow = Record<string, any>;
export type QueryResult<R = DbRow> = { rows: R[]; rowCount: number; command: string };
export type Param = string | number | bigint | boolean | Date | Buffer | null | undefined | unknown[] | object;
export type Tx = { query: (sql: string, params?: Param[]) => Promise<QueryResult>; exec: (sql: string) => Promise<true> };

const txStore = new AsyncLocalStorage<Tx>();

// ---------- value types (same as the old client) ----------
type Parser = (v: string) => unknown;
const TYPE_PARSERS: Record<number, Parser> = {
  16: (v) => v === 't', // bool
  17: (v) => Buffer.from(v.slice(2), 'hex'), // bytea (hex format)
  1000: (v) => parseArray(v, (x) => x === 't'), // bool[]
  1007: (v) => parseArray(v, Number), // int4[]
  1016: (v) => parseArray(v, Number), // int8[]
  1009: (v) => parseArray(v, (x) => x), // text[]
  20: (v) => Number(v), // int8
  21: (v) => Number(v), // int2
  23: (v) => Number(v), // int4
  700: (v) => Number(v), // float4
  701: (v) => Number(v), // float8
  1700: (v) => Number(v), // numeric
  114: (v) => JSON.parse(v), // json
  3802: (v) => JSON.parse(v), // jsonb
  1114: (v) => new Date(v.replace(' ', 'T') + 'Z'), // timestamp
  1184: (v) => new Date(v.replace(' ', 'T').replace(/([+-]\d\d)$/, '$1:00')), // timestamptz
};
const identity: Parser = (v) => v;
// Only text-format results are used, so every type not listed above stays text (as before).
const types = { getTypeParser: (oid: number) => TYPE_PARSERS[oid] || identity } as unknown as pg.CustomTypesConfig;

// Parameters are turned into text exactly as the old client did, so the database receives the same values.
function serialize(v: Param): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'boolean') return v ? 't' : 'f';
  if (v instanceof Date) return v.toISOString();
  if (Buffer.isBuffer(v)) return '\\x' + v.toString('hex');
  if (Array.isArray(v)) return '{' + v.map((x) => (x === null ? 'NULL' : '"' + String(x).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"')).join(',') + '}';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

// Postgres array literal, e.g. {1,2,"a b",NULL}
function parseArray<T>(text: string, conv: (s: string) => T): (T | null)[] {
  const out: (T | null)[] = [];
  let i = 1;
  while (i < text.length - 1) {
    let val: string;
    if (text[i] === '"') {
      let j = i + 1;
      val = '';
      while (text[j] !== '"') {
        if (text[j] === '\\') j++;
        val += text[j++];
      }
      i = j + 1;
      out.push(conv(val));
    } else {
      let j = i;
      while (j < text.length - 1 && text[j] !== ',') j++;
      val = text.slice(i, j);
      i = j;
      out.push(val === 'NULL' ? null : conv(val));
    }
    if (text[i] === ',') i++;
  }
  return out;
}

// ---------- errors ----------
type ErrorFields = { M?: string; C?: string; D?: string; S?: string };
/** An error reported by the database itself (bad SQL, a unique key taken …) — not a connection problem. */
class PgError extends Error {
  code?: string;
  detail?: string;
  severity?: string;
  constructor(fields: ErrorFields) {
    super(fields.M || 'Database error');
    this.code = fields.C;
    this.detail = fields.D;
    this.severity = fields.S;
  }
}
function toPgError(e: unknown): unknown {
  if (e instanceof pg.DatabaseError) return new PgError({ M: e.message, C: e.code, D: e.detail, S: e.severity });
  return e;
}

// ---------- connection settings ----------
type ConnConfig = { host: string; port: number; user: string; password: string; database: string; ssl: boolean };

function parseConnectionString(str: string): ConnConfig {
  const u = new URL(str);
  const host = u.hostname;
  const local = host === 'localhost' || host === '127.0.0.1';
  const sslmode = u.searchParams.get('sslmode');
  return {
    host,
    port: Number(u.port) || 5432,
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: decodeURIComponent(u.pathname.slice(1)) || decodeURIComponent(u.username),
    ssl: sslmode ? sslmode !== 'disable' : !local,
  };
}

// Supabase signs its database certificates with its own root CA, which is not
// in Node's default list. If DATABASE_CA_CERT (the PEM text from Supabase →
// Database → SSL) is set, the certificate is fully checked against it.
// Without it, Supabase connections stay encrypted but the certificate itself
// is not verified.
function tlsTrust(host: string): ConnectionOptions {
  const ca = String(process.env.DATABASE_CA_CERT || '').replace(/\\n/g, '\n').trim();
  if (ca) return { ca };
  if (/supabase\.(com|co)$/.test(host)) return { rejectUnauthorized: false };
  return {};
}

// ---------- one connection ----------
class Connection {
  config: ConnConfig;
  closed = false;
  private client: pg.Client;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(config: ConnConfig) {
    this.config = config;
    this.client = new pg.Client({
      host: config.host, port: config.port, user: config.user, password: config.password, database: config.database,
      ssl: config.ssl ? { servername: config.host, ...tlsTrust(config.host) } : false,
      types,
      connectionTimeoutMillis: 15000, // only the connecting itself may take at most 15 s
      keepAlive: true,
      keepAliveInitialDelayMillis: 10000,
      application_name: 'shobmilbe',
    });
    this.client.on('error', () => { this.closed = true; });
    this.client.on('end', () => { this.closed = true; });
  }

  async connect(): Promise<void> {
    try { await this.client.connect(); } catch (e) { this.closed = true; throw toPgError(e); }
  }

  // Calls take turns; a transaction keeps the connection until it ends.
  private run<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.queue.then(fn, fn);
    this.queue = p.catch(() => {});
    return p;
  }

  private async rawQuery(sql: string, params: Param[]): Promise<QueryResult> {
    try {
      const r = await this.client.query({ text: sql, values: params.map(serialize) });
      const rows = (r.rows || []) as DbRow[];
      return { rows, rowCount: rows.length || r.rowCount || 0, command: r.command || '' };
    } catch (e) { throw toPgError(e); }
  }

  // Simple query protocol: allows several statements, no parameters.
  private async rawExec(sql: string): Promise<true> {
    try { await this.client.query(sql); return true; } catch (e) { throw toPgError(e); }
  }

  query(sql: string, params: Param[] = []): Promise<QueryResult> { return this.run(() => this.rawQuery(sql, params)); }
  exec(sql: string): Promise<true> { return this.run(() => this.rawExec(sql)); }

  // Run fn(tx) inside BEGIN/COMMIT with exclusive use of this connection.
  transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.run(async () => {
      let open = true;
      // After the transaction ends, stray late calls go through the normal queue.
      const tx: Tx = {
        query: (sql, params = []) => (open ? this.rawQuery(sql, params) : this.query(sql, params)),
        exec: (sql) => (open ? this.rawExec(sql) : this.exec(sql)),
      };
      await this.rawQuery('BEGIN', []);
      try {
        const result = await txStore.run(tx, () => fn(tx));
        await this.rawQuery('COMMIT', []);
        open = false;
        return result;
      } catch (e) {
        try { await this.rawQuery('ROLLBACK', []); } catch { /* ignore */ }
        open = false;
        throw e;
      }
    });
  }

  end(): void {
    if (!this.closed) this.client.end().catch(() => {});
    this.closed = true;
  }
}

// ---------- which database to use ----------
// Supabase (connected through the Vercel integration) wins over an old
// DATABASE_URL that may still be left over from Neon.
function findDatabase(): { url: string; name: string; provider: string } {
  const env = process.env;
  const isPg = (v: unknown) => /^postgres(ql)?:\/\//i.test(String(v || ''));
  // Any variable holding a Supabase address counts, whatever prefix Vercel gave it.
  const has = (re: RegExp, s: string | undefined) => Number(re.test(s || ''));
  const supa = Object.keys(env).filter((k) => isPg(env[k]) && /supabase\.(com|co)/.test(env[k] || ''))
    // Prefer the pooler address (reachable from Vercel) over the direct one.
    .sort((a, b) => (has(/pooler/, env[b]) - has(/pooler/, env[a])) || (has(/NON_POOLING/, a) - has(/NON_POOLING/, b)) || a.localeCompare(b));
  if (supa.length) {
    let url = env[supa[0]] || '';
    try {
      const u = new URL(url);
      // Transaction mode (6543) lets many serverless copies share the database; session mode (5432)
      // runs out of connections quickly. Nothing in the shop needs session mode any more.
      if (/pooler\.supabase\.com$/.test(u.hostname) && u.port === '5432') u.port = '6543';
      url = u.toString();
    } catch { /* keep as given */ }
    return { url, name: supa[0], provider: 'Supabase' };
  }
  const name = env.DATABASE_URL ? 'DATABASE_URL' : env.POSTGRES_URL ? 'POSTGRES_URL' : '';
  const url = name ? env[name] || '' : '';
  return { url, name, provider: /neon\.tech/.test(url) ? 'Neon' : url ? 'Postgres' : '' };
}
function pickDatabaseUrl(): string { return findDatabase().url; }
function databaseInfo(): { provider: string; variable: string; host: string } {
  const d = findDatabase();
  let host = '';
  try { host = new URL(d.url).hostname; } catch { /* no address */ }
  return { provider: d.provider, variable: d.name, host };
}

// ---------- shared connection for the serverless function ----------
let shared: Connection | null = null;
let sharedPromise: Promise<Connection> | null = null;

async function getConnection(): Promise<Connection> {
  if (shared && !shared.closed) return shared;
  if (!sharedPromise) {
    const url = pickDatabaseUrl();
    if (!url) throw new Error('DATABASE_URL is not set');
    const conn = new Connection(parseConnectionString(url));
    sharedPromise = conn.connect().then(() => { shared = conn; sharedPromise = null; return conn; },
      (e) => { sharedPromise = null; throw e; });
  }
  return sharedPromise;
}

function isConnectionError(e: unknown): boolean {
  return !(e instanceof PgError);
}

// Retry once on a dropped connection (e.g. the server closed an idle socket).
async function withConnection<T>(fn: (c: Connection) => Promise<T>): Promise<T> {
  try {
    return await fn(await getConnection());
  } catch (e) {
    if (!isConnectionError(e)) throw e;
    if (shared) { shared.end(); shared = null; }
    return fn(await getConnection());
  }
}

export const query = (sql: string, params?: Param[]): Promise<QueryResult> => {
  const t = txStore.getStore();
  return t ? t.query(sql, params || []) : withConnection((c) => c.query(sql, params));
};
export const exec = (sql: string): Promise<true> => {
  const t = txStore.getStore();
  return t ? t.exec(sql) : withConnection((c) => c.exec(sql));
};
export const transaction = <T>(fn: (tx: Tx) => Promise<T>): Promise<T> => {
  const t = txStore.getStore();
  // Already inside a transaction: just run as part of it.
  return t ? fn(t) : withConnection((c) => c.transaction(fn));
};
export { PgError, Connection, parseConnectionString, pickDatabaseUrl, databaseInfo };
