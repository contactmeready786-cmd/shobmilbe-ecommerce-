// The original shop handler (lib/app.ts) inside a Next.js route: it gets the request's details and the body text, and
// what it answers (status, headers, body) becomes a Web Response. No Node streams are involved: the handler only ever
// sets headers and ends its answer once (readBody in lib/util uses the body text given here).
//
// What still comes here: forms sent to the shop and the admin, /admin/api and the admin's files and exports, the shop's
// own 404 page and redirects, and a few small addresses (the country-lock page, verification files). Everything else
// has its own Next.js page or route.
import { handler as shopHandler } from '@/lib/app';
import { flush as flushErrorReports } from '@/lib/services/errors';
import { loadRenderer } from '@/lib/react/render';

type HeaderValue = string | number | readonly string[];

/** Collects what the handler answers (the parts of Node's ServerResponse it uses). */
export class CollectedAnswer {
  statusCode = 200;
  statusMessage = '';
  headersSent = false;
  writableEnded = false;
  private headers = new Map<string, { name: string; value: HeaderValue }>();
  private chunks: Buffer[] = [];
  private finish!: () => void;
  readonly done = new Promise<void>((resolve) => { this.finish = resolve; });

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
  write(chunk: Buffer | string | Uint8Array) {
    this.headersSent = true;
    this.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
    return true;
  }
  end(chunk?: Buffer | string | Uint8Array | null) {
    if (chunk !== undefined && chunk !== null && chunk !== '') this.write(chunk);
    this.headersSent = true;
    this.writableEnded = true;
    this.finish();
    return this;
  }

  toResponse(): Response {
    const h = new Headers();
    for (const { name, value } of this.headers.values()) {
      if (Array.isArray(value)) for (const v of value) h.append(name, String(v));
      else h.set(name, String(value));
    }
    const noBody = this.statusCode === 204 || this.statusCode === 304 || this.statusCode < 200;
    const body = noBody ? null : new Uint8Array(Buffer.concat(this.chunks));
    return new Response(body, { status: this.statusCode, statusText: this.statusMessage || undefined, headers: h });
  }
}

/** Runs the original shop code for one request and collects its answer. */
export async function runLegacy({ method, headers, body, url }: { method: string; headers: Record<string, string>; body: string; url: string }): Promise<CollectedAnswer | null> {
  const req = {
    url, method, headers, httpVersion: '1.1', readableEnded: true, __body: body,
    socket: { remoteAddress: headers['x-real-ip'] || (headers['x-forwarded-for'] || '').split(',')[0].trim() || '127.0.0.1' },
  };
  const res = new CollectedAnswer();
  await loadRenderer(); // the original code's pages are text (lib/react/render.tsx)
  try {
    await (shopHandler as unknown as (q: unknown, r: unknown) => Promise<void>)(req, res);
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
  const body = request.method === 'GET' || request.method === 'HEAD' ? '' : await request.text();
  const headers: Record<string, string> = {};
  request.headers.forEach((v, k) => { headers[k] = v; });
  const res = await runLegacy({ method: request.method, headers, body, url: originalUrl });
  return res ? res.toResponse() : new Response('Server error', { status: 500 });
}
