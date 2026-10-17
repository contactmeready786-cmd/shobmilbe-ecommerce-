// Every address that has no Next.js page of its own yet arrives here (see the fallback rewrite in next.config.ts)
// and is answered by the original shop code, so the site behaves exactly as before.
//
// Why a Pages-Router API route and not an App-Router route (moved 2026-10-17): pages are being moved to React and are
// rendered with react-dom/server inside the original code; Next.js forbids react-dom/server in App-Router routes, but
// allows it here. Everything else is the same bridge as before (src/legacy/bridge.ts).
import type { IncomingMessage, ServerResponse } from 'node:http';
import { runLegacy } from '@/src/legacy/bridge';

export const config = {
  api: { bodyParser: false, responseLimit: false, externalResolver: true },
  maxDuration: 60,
};

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  // proxy.ts records the address the visitor really asked for, before Next.js rewrote it to /api/legacy/...
  const original = req.headers['x-shop-url'];
  if (typeof original !== 'string' || !original) { res.statusCode = 404; res.end('Not found'); return; } // opened directly
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers)) if (v !== undefined) headers[k] = Array.isArray(v) ? v.join(', ') : v;
  const out = await runLegacy({ method: req.method || 'GET', headers, bytes: Buffer.concat(chunks), url: original });
  if (!out) { res.statusCode = 500; res.end('Server error'); return; }
  const r = out.parts();
  res.statusCode = r.status;
  if (r.statusText) res.statusMessage = r.statusText;
  for (const [name, value] of r.headers) res.setHeader(name, Array.isArray(value) ? value.map(String) : String(value));
  res.end(r.body ?? undefined);
}
