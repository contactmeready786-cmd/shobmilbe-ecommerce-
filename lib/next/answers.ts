// 📮 What the shop's Next.js route handlers share when they answer a request themselves (lib/next/admin-route.ts for
// the admin's forms and files, lib/site.ts for the shop's own 404 / redirect answers): the request as the shop's code
// reads it, the three ways of answering (with the shop's security headers), and the fixed pages for "the database
// isn't there", "too many tries" and "something broke".
import * as db from '../db';
import * as security from '../security';
import * as guard from '../services/guard';
import { Reply, type HeaderMap, type ReplyBody } from '../reply';
import type { Settings, ShopRequest, VerificationFile } from '../types';

/** The address the visitor asked for: proxy.ts's x-shop-url (always set there, so it can't be faked), else the request's own. */
export function askedFor(request: Request): URL {
  const url = new URL(request.url);
  const original = request.headers.get('x-shop-url');
  return original ? new URL(original, url.origin) : url;
}

/** The shop's path rules: decoded, and no slash at the end. */
export function shopPath(url: URL): string {
  let path = url.pathname;
  try { path = decodeURIComponent(path); } catch { /* keep as sent */ }
  return path.length > 1 ? path.replace(/\/+$/, '') : path;
}

/** The request as the shop's helpers read it (headers, address, method, the connection, the body text read once). */
export async function shopRequest(request: Request, url: URL): Promise<ShopRequest> {
  const method = request.method;
  const headers: Record<string, string> = {};
  request.headers.forEach((v, k) => { headers[k] = v; });
  return {
    url: url.pathname + url.search, method, headers,
    socket: { remoteAddress: headers['x-real-ip'] || (headers['x-forwarded-for'] || '').split(',')[0].trim() || '127.0.0.1' },
    __body: method === 'GET' || method === 'HEAD' ? '' : await request.text(),
  };
}

/** The three ways of answering, bound to one request's reply. */
export function answers(reply: Reply) {
  const send = (status: number, body: ReplyBody, type = 'text/html; charset=utf-8', extra: HeaderMap = {}) =>
    reply.answer(status, { 'Content-Type': type, 'Cache-Control': 'no-store', ...security.BASE_HEADERS, ...extra }, body);
  const json = (status: number, data: unknown, extra: HeaderMap = {}) => send(status, JSON.stringify(data), 'application/json; charset=utf-8', extra);
  const redirect = (to: string, extra: HeaderMap = {}) => reply.answer(303, { Location: to, 'Cache-Control': 'no-store', ...extra });
  return { send, json, redirect };
}

/** Something broke: the shop's "something went wrong" page. */
export const ERROR_PAGE = '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>সমস্যা</title><body style="font-family:sans-serif;padding:40px;text-align:center"><h1>একটা সমস্যা হয়েছে</h1><p>কিছুক্ষণ পর আবার চেষ্টা করুন।</p><p><a href="/">হোমে ফিরে যান</a></p></body>';

/** Too many requests from one visitor: noted for the security watch, a polite message, nothing else happens. */
export function tooMany(req: ShopRequest, reply: Reply): void {
  guard.record({ req, kind: 'flood', path: String(req.url || '').slice(0, 200) }).catch(() => {});
  const text = 'অনেক বেশি চেষ্টা হয়েছে। কিছুক্ষণ পর আবার চেষ্টা করুন।';
  answers(reply).send(429, `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>একটু অপেক্ষা করুন</title><body style="font-family:sans-serif;padding:40px;text-align:center"><h1>একটু অপেক্ষা করুন</h1><p>${text}</p><p><a href="/">হোমে ফিরে যান</a></p></body>`, 'text/html; charset=utf-8', { 'Retry-After': '120' });
}

/** The database can't be reached (or isn't connected to the project yet). */
export function setupErrorPage(e?: unknown): string {
  const missing = /DATABASE_URL/.test(String((e as Error | undefined)?.message || ''));
  return `<!doctype html><html lang="bn"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>সেটআপ বাকি</title>
<body style="font-family:'Noto Sans Bengali',sans-serif;max-width:560px;margin:60px auto;padding:0 20px;line-height:1.7;color:#14213D">
<h1>ওয়েবসাইট ডাটাবেসের সাথে যুক্ত হতে পারছে না</h1>
${missing
    ? '<p>Vercel-এ ডাটাবেস এখনো এই প্রজেক্টের সাথে যুক্ত হয়নি। Vercel → প্রজেক্ট → Storage থেকে ডাটাবেসটি (Supabase) এই প্রজেক্টে Connect করুন, তারপর Deployments থেকে Redeploy দিন।</p>'
    : '<p>ডাটাবেস সাময়িকভাবে সাড়া দিচ্ছে না। কিছুক্ষণ পর পেজটি রিফ্রেশ করুন।</p>'}
</body></html>`;
}

/** The files search engines and other services ask for to check the shop is ours (IndexNow key, verification files);
 * true when this request was one of them and has been answered. */
export function verificationFile(path: string, settings: Settings, reply: Reply): boolean {
  const { send } = answers(reply);
  // ⚡ IndexNow key file (Bing & co. check it belongs to this shop)
  if (/^\/[a-f0-9]{32}\.txt$/.test(path) && settings.indexnow_key && path === `/${settings.indexnow_key}.txt`) {
    send(200, settings.indexnow_key, 'text/plain; charset=utf-8');
    return true;
  }
  const vf = db.jsonSetting<VerificationFile[]>(settings, 'verification_files', []).find((f) => '/' + f.path === path);
  if (!vf) return false;
  send(200, vf.content, vf.path.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/plain; charset=utf-8', { 'Content-Security-Policy': "sandbox; default-src 'none'" });
  return true;
}
