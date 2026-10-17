// Bridge between Next.js (Web Request / Response) and the shop's existing request handler (Node req / res).
//
// During the move to Next.js every page that has not been rebuilt yet is still answered by the original
// code in lib/. This file lets that code run unchanged inside a Next.js route: it hands the handler a
// Node-style request and collects what the handler writes into a Web Response. Pages move out of lib/ one
// by one; when the last one has moved, this bridge is deleted.
import { Readable, Writable } from 'node:stream';
import { handler as shopHandler } from '@/lib/app';
import { flush as flushErrorReports } from '@/lib/services/errors';
import { loadRenderer } from '@/lib/react/render';

type NodeHandler = (req: unknown, res: unknown) => Promise<void> | void;
const legacyHandler = (): NodeHandler => shopHandler as NodeHandler;

type HeaderValue = string | number | readonly string[];

export class CollectingResponse extends Writable {
  statusCode = 200;
  statusMessage = '';
  headersSent = false;
  private headers = new Map<string, { name: string; value: HeaderValue }>();
  private chunks: Buffer[] = [];
  readonly done: Promise<void>;

  constructor() {
    super();
    this.done = new Promise((resolve, reject) => {
      this.once('finish', () => resolve());
      this.once('error', reject);
    });
  }

  setHeader(name: string, value: HeaderValue) { this.headers.set(name.toLowerCase(), { name, value }); return this; }
  getHeader(name: string) { return this.headers.get(name.toLowerCase())?.value; }
  hasHeader(name: string) { return this.headers.has(name.toLowerCase()); }
  removeHeader(name: string) { this.headers.delete(name.toLowerCase()); }
  getHeaders() { return Object.fromEntries([...this.headers].map(([k, v]) => [k, v.value])); }

  writeHead(status: number, a?: string | Record<string, HeaderValue | undefined>, b?: Record<string, HeaderValue | undefined>) {
    this.statusCode = status;
    const extra = typeof a === 'string' ? (this.statusMessage = a, b) : a;
    for (const [k, v] of Object.entries(extra || {})) if (v !== undefined) this.setHeader(k, v);
    this.headersSent = true;
    return this;
  }

  override _write(chunk: Buffer | string, enc: BufferEncoding, cb: (e?: Error | null) => void) {
    this.headersSent = true;
    this.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, enc));
    cb();
  }

  toResponse(): Response {
    const h = new Headers();
    for (const { name, value } of this.headers.values()) {
      if (Array.isArray(value)) for (const v of value) h.append(name, String(v));
      else h.set(name, String(value));
    }
    const noBody = this.statusCode === 204 || this.statusCode === 304 || this.statusCode < 200;
    const body = noBody ? null : Buffer.concat(this.chunks);
    return new Response(body, { status: this.statusCode, statusText: this.statusMessage || undefined, headers: h });
  }
}

/** Runs the original shop code for one request and collects its answer. */
export async function runLegacy({ method, headers, bytes, url }: { method: string; headers: Record<string, string>; bytes: Buffer; url: string }): Promise<CollectingResponse | null> {
  const req = Object.assign(Readable.from(bytes.length ? [bytes] : []), {
    url,
    method,
    headers,
    httpVersion: '1.1',
    socket: { remoteAddress: headers['x-real-ip'] || (headers['x-forwarded-for'] || '').split(',')[0].trim() || '127.0.0.1' },
  });
  const res = new CollectingResponse();
  await loadRenderer(); // the original code's pages are text (lib/react/render.tsx)
  try {
    await legacyHandler()(req, res);
    await res.done;
  } catch (e) {
    console.error('legacy handler failed', e);
    if (!res.writableEnded) return null;
  } finally {
    await flushErrorReports(); // an error reported to Sentry goes out before the server may be paused
  }
  return res;
}

export async function handleWithLegacy(request: Request, originalUrl: string): Promise<Response> {
  const bytes = request.body ? Buffer.from(await request.arrayBuffer()) : Buffer.alloc(0);
  const headers: Record<string, string> = {};
  request.headers.forEach((v, k) => { headers[k] = v; });
  const res = await runLegacy({ method: request.method, headers, bytes, url: originalUrl });
  return res ? res.toResponse() : new Response('Server error', { status: 500 });
}
