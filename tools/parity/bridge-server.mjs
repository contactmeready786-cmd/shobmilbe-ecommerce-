// Local test server for src/legacy/bridge.ts without Next.js: turns each Node request into a Web Request,
// sends it through the bridge, and writes the Web Response back — so the bridge can be checked against
// the old site page by page.   node --experimental-strip-types tools/parity/bridge-server.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { handleWithLegacy } from '../../src/legacy/bridge.ts';

const PUBLIC = path.resolve('public');
http.createServer(async (req, res) => {
  const file = path.join(PUBLIC, decodeURIComponent(req.url.split('?')[0]));
  if (file.startsWith(PUBLIC) && fs.existsSync(file) && fs.statSync(file).isFile()) return fs.createReadStream(file).pipe(res);
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = chunks.length && !['GET', 'HEAD'].includes(req.method) ? Buffer.concat(chunks) : undefined;
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) headers.set(k, Array.isArray(v) ? v.join(', ') : v);
  const request = new Request('http://' + (req.headers.host || 'localhost') + req.url, { method: req.method, headers, body });
  const response = await handleWithLegacy(request, req.url);
  const out = {};
  response.headers.forEach((v, k) => { if (k !== 'set-cookie') out[k] = v; });
  const cookies = response.headers.getSetCookie();
  if (cookies.length) out['set-cookie'] = cookies;
  res.writeHead(response.status, out);
  res.end(Buffer.from(await response.arrayBuffer()));
}).listen(process.env.PORT || 3000);
