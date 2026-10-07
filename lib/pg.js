'use strict';
// A small, dependency-free PostgreSQL client (wire protocol v3).
// Supports TLS, SCRAM-SHA-256 / MD5 / cleartext auth, parameterised queries
// and transactions. Works with Neon (Vercel Postgres) and plain Postgres.

const net = require('net');
const tls = require('tls');
const crypto = require('crypto');

const TYPE_PARSERS = {
  16: (v) => v === 't',          // bool
  20: (v) => Number(v),          // int8
  21: (v) => Number(v),          // int2
  23: (v) => Number(v),          // int4
  700: (v) => Number(v),         // float4
  701: (v) => Number(v),         // float8
  1700: (v) => Number(v),        // numeric
  114: (v) => JSON.parse(v),     // json
  3802: (v) => JSON.parse(v),    // jsonb
  1114: (v) => new Date(v.replace(' ', 'T') + 'Z'), // timestamp
  1184: (v) => new Date(v.replace(' ', 'T').replace(/([+-]\d\d)$/, '$1:00')), // timestamptz
};

class PgError extends Error {
  constructor(fields) {
    super(fields.M || 'Database error');
    this.code = fields.C;
    this.detail = fields.D;
    this.severity = fields.S;
  }
}

function parseConnectionString(str) {
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

class Connection {
  constructor(config) {
    this.config = config;
    this.socket = null;
    this.buffer = Buffer.alloc(0);
    this.waiter = null; // function(msg) handling incoming messages
    this.closed = false;
    this.queue = Promise.resolve();
  }

  // ---------- low level ----------
  _send(type, payload) {
    const len = Buffer.alloc(4);
    len.writeInt32BE(payload.length + 4);
    const parts = type ? [Buffer.from(type), len, payload] : [len, payload];
    this.socket.write(Buffer.concat(parts));
  }

  _onData(chunk) {
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk;
    while (this.buffer.length >= 5) {
      const type = String.fromCharCode(this.buffer[0]);
      const len = this.buffer.readInt32BE(1);
      if (this.buffer.length < len + 1) break;
      const body = this.buffer.subarray(5, len + 1);
      this.buffer = this.buffer.subarray(len + 1);
      if (this.waiter) this.waiter({ type, body });
    }
  }

  _fail(err) {
    this.closed = true;
    if (this.waiter) {
      const w = this.waiter;
      this.waiter = null;
      w({ type: '!', error: err });
    }
  }

  _attach(socket) {
    this.socket = socket;
    socket.setNoDelay(true);
    socket.on('data', (c) => this._onData(c));
    socket.on('error', (e) => this._fail(e));
    socket.on('close', () => this._fail(new Error('Database connection closed')));
  }

  // Wait for messages until handler returns a value !== undefined
  _collect(handler) {
    return new Promise((resolve, reject) => {
      if (this.closed) return reject(new Error('Database connection closed'));
      let error = null;
      this.waiter = (msg) => {
        if (msg.type === '!') return reject(error || msg.error);
        if (msg.type === 'E') { error = new PgError(parseFields(msg.body)); return; }
        if (msg.type === 'N' || msg.type === 'S' || msg.type === 'K' || msg.type === 'A') {
          if (msg.type === 'S' || msg.type === 'K') handler(msg);
          return;
        }
        if (msg.type === 'Z') {
          this.waiter = null;
          if (error) return reject(error);
        }
        try {
          const result = handler(msg);
          if (result !== undefined) { this.waiter = null; resolve(result); }
        } catch (e) { this.waiter = null; reject(e); }
      };
    });
  }

  // ---------- connect & auth ----------
  async connect() {
    const { host, port, ssl } = this.config;
    let socket = await new Promise((resolve, reject) => {
      const s = net.connect({ host, port });
      s.once('connect', () => resolve(s));
      s.once('error', reject);
    });
    socket.setTimeout(15000, () => socket.destroy(new Error('Database connection timed out')));

    if (ssl) {
      const req = Buffer.alloc(8);
      req.writeInt32BE(8, 0);
      req.writeInt32BE(80877103, 4);
      socket.write(req);
      const answer = await new Promise((resolve, reject) => {
        socket.once('data', (d) => resolve(String.fromCharCode(d[0])));
        socket.once('error', reject);
      });
      if (answer !== 'S') throw new Error('Database server does not support SSL');
      socket = await new Promise((resolve, reject) => {
        const t = tls.connect({ socket, servername: host });
        t.once('secureConnect', () => resolve(t));
        t.once('error', reject);
      });
    }
    socket.setTimeout(0);
    this._attach(socket);
    await this._startup();
  }

  async _startup() {
    const { user, database, password } = this.config;
    const params = Buffer.from(`user\0${user}\0database\0${database}\0client_encoding\0UTF8\0\0`);
    const head = Buffer.alloc(4);
    head.writeInt32BE(196608);
    this._send(null, Buffer.concat([head, params]));

    let scram = null;
    await this._collect((msg) => {
      if (msg.type === 'R') {
        const code = msg.body.readInt32BE(0);
        if (code === 0) return undefined; // AuthenticationOk
        if (code === 3) { this._send('p', cstr(password)); return undefined; }
        if (code === 5) {
          const salt = msg.body.subarray(4, 8);
          const inner = md5(password + user);
          const outer = 'md5' + md5(Buffer.concat([Buffer.from(inner), salt]));
          this._send('p', cstr(outer));
          return undefined;
        }
        if (code === 10) {
          const mechs = msg.body.subarray(4).toString().split('\0');
          if (!mechs.includes('SCRAM-SHA-256')) throw new Error('Unsupported SASL mechanism');
          const nonce = crypto.randomBytes(18).toString('base64');
          scram = { nonce, clientFirstBare: `n=*,r=${nonce}` };
          const data = Buffer.from('n,,' + scram.clientFirstBare);
          const len = Buffer.alloc(4); len.writeInt32BE(data.length);
          this._send('p', Buffer.concat([cstr('SCRAM-SHA-256'), len, data]));
          return undefined;
        }
        if (code === 11) {
          const serverFirst = msg.body.subarray(4).toString();
          const attrs = Object.fromEntries(serverFirst.split(',').map((p) => [p[0], p.slice(2)]));
          if (!attrs.r.startsWith(scram.nonce)) throw new Error('SCRAM nonce mismatch');
          const salted = crypto.pbkdf2Sync(password, Buffer.from(attrs.s, 'base64'), Number(attrs.i), 32, 'sha256');
          const clientKey = hmac(salted, 'Client Key');
          const storedKey = crypto.createHash('sha256').update(clientKey).digest();
          const finalNoProof = `c=biws,r=${attrs.r}`;
          const authMessage = `${scram.clientFirstBare},${serverFirst},${finalNoProof}`;
          const sig = hmac(storedKey, authMessage);
          const proof = Buffer.alloc(clientKey.length);
          for (let i = 0; i < proof.length; i++) proof[i] = clientKey[i] ^ sig[i];
          scram.serverSignature = hmac(hmac(salted, 'Server Key'), authMessage).toString('base64');
          this._send('p', Buffer.from(`${finalNoProof},p=${proof.toString('base64')}`));
          return undefined;
        }
        if (code === 12) {
          const v = msg.body.subarray(4).toString().split(',').find((p) => p.startsWith('v='));
          if (!v || v.slice(2) !== scram.serverSignature) throw new Error('SCRAM server signature mismatch');
          return undefined;
        }
        throw new Error('Unsupported authentication method: ' + code);
      }
      if (msg.type === 'Z') return true;
      return undefined;
    });
  }

  // ---------- queries ----------
  _run(fn) {
    const p = this.queue.then(fn, fn);
    this.queue = p.catch(() => {});
    return p;
  }

  // Simple query protocol: allows multiple statements, no parameters.
  exec(sql) {
    return this._run(() => {
      this._send('Q', cstr(sql));
      return this._collect((msg) => (msg.type === 'Z' ? true : undefined));
    });
  }

  query(sql, params = []) {
    return this._run(() => this._query(sql, params));
  }

  _query(sql, params) {
    const values = params.map(serialize);
    // Parse
    this._send('P', Buffer.concat([cstr(''), cstr(sql), int16(0)]));
    // Bind
    const parts = [cstr(''), cstr(''), int16(0), int16(values.length)];
    for (const v of values) {
      if (v === null) { const n = Buffer.alloc(4); n.writeInt32BE(-1); parts.push(n); }
      else { const b = Buffer.from(v, 'utf8'); const n = Buffer.alloc(4); n.writeInt32BE(b.length); parts.push(n, b); }
    }
    parts.push(int16(0));
    this._send('B', Buffer.concat(parts));
    this._send('D', Buffer.concat([Buffer.from('P'), cstr('')]));
    const exec = Buffer.alloc(4); exec.writeInt32BE(0);
    this._send('E', Buffer.concat([cstr(''), exec]));
    this._send('S', Buffer.alloc(0));

    let fields = [];
    const rows = [];
    let command = '';
    return this._collect((msg) => {
      switch (msg.type) {
        case 'T': fields = parseRowDescription(msg.body); break;
        case 'D': rows.push(parseDataRow(msg.body, fields)); break;
        case 'C': command = msg.body.subarray(0, msg.body.length - 1).toString(); break;
        case 'Z': return { rows, rowCount: rows.length || Number(command.split(' ').pop()) || 0, command };
        default: break;
      }
      return undefined;
    });
  }

  // Run fn(tx) inside BEGIN/COMMIT with exclusive use of this connection.
  transaction(fn) {
    return this._run(async () => {
      const tx = { query: (sql, params = []) => this._query(sql, params) };
      await this._query('BEGIN', []);
      try {
        const result = await fn(tx);
        await this._query('COMMIT', []);
        return result;
      } catch (e) {
        try { await this._query('ROLLBACK', []); } catch (_) { /* ignore */ }
        throw e;
      }
    });
  }

  end() {
    if (this.socket && !this.closed) {
      try { this._send('X', Buffer.alloc(0)); } catch (_) { /* ignore */ }
      this.socket.end();
    }
    this.closed = true;
  }
}

// ---------- helpers ----------
function cstr(s) { return Buffer.from(s + '\0', 'utf8'); }
function int16(n) { const b = Buffer.alloc(2); b.writeInt16BE(n); return b; }
function md5(x) { return crypto.createHash('md5').update(x).digest('hex'); }
function hmac(key, data) { return crypto.createHmac('sha256', key).update(data).digest(); }

function serialize(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'boolean') return v ? 't' : 'f';
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function parseFields(body) {
  const fields = {};
  let i = 0;
  while (i < body.length && body[i] !== 0) {
    const code = String.fromCharCode(body[i]);
    const end = body.indexOf(0, i + 1);
    fields[code] = body.subarray(i + 1, end).toString();
    i = end + 1;
  }
  return fields;
}

function parseRowDescription(body) {
  const n = body.readInt16BE(0);
  const fields = [];
  let i = 2;
  for (let k = 0; k < n; k++) {
    const end = body.indexOf(0, i);
    const name = body.subarray(i, end).toString();
    i = end + 1;
    const typeOid = body.readInt32BE(i + 6);
    i += 18;
    fields.push({ name, typeOid });
  }
  return fields;
}

function parseDataRow(body, fields) {
  const n = body.readInt16BE(0);
  const row = {};
  let i = 2;
  for (let k = 0; k < n; k++) {
    const len = body.readInt32BE(i);
    i += 4;
    let value = null;
    if (len >= 0) {
      const raw = body.subarray(i, i + len).toString('utf8');
      i += len;
      const parser = TYPE_PARSERS[fields[k].typeOid];
      value = parser ? parser(raw) : raw;
    }
    row[fields[k].name] = value;
  }
  return row;
}

// ---------- shared connection for the serverless function ----------
let shared = null;
let sharedPromise = null;

async function getConnection() {
  if (shared && !shared.closed) return shared;
  if (!sharedPromise) {
    const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
    if (!url) throw new Error('DATABASE_URL is not set');
    const conn = new Connection(parseConnectionString(url));
    sharedPromise = conn.connect().then(() => { shared = conn; sharedPromise = null; return conn; },
      (e) => { sharedPromise = null; throw e; });
  }
  return sharedPromise;
}

function isConnectionError(e) {
  return !(e instanceof PgError);
}

// Retry once on a dropped connection (e.g. the server closed an idle socket).
async function withConnection(fn) {
  try {
    return await fn(await getConnection());
  } catch (e) {
    if (!isConnectionError(e)) throw e;
    if (shared) { shared.end(); shared = null; }
    return fn(await getConnection());
  }
}

module.exports = {
  query: (sql, params) => withConnection((c) => c.query(sql, params)),
  exec: (sql) => withConnection((c) => c.exec(sql)),
  transaction: (fn) => withConnection((c) => c.transaction(fn)),
  PgError,
  Connection,
  parseConnectionString,
};
