// Admin → পণ্য → ওয়াটারমার্ক ও ডুপ্লিকেট → ⬜ ব্যাকগ্রাউন্ড সাদা (owner, 2026-10-24).
// The pictures of products copied from another shop (or any product) get a pure white background: an AI cuts the
// product out in the owner's own browser (client/admin/whiten.ts — free, no picture leaves for another service),
// the owner sees before / after and keeps only the good ones. The original always stays and can be put back.
// Nothing runs by itself. lib/models/whiten.ts does the swap.
import { Val, attrValue, jsxList } from '../react/html';
import { bn, int, str, ifKey } from '../util';
import * as db from '../db';
import * as ui from './ui';
import * as security from '../security';
import * as W from '../models/whiten';
import * as cloud from '../models/whitencloud';
import { safeFetch } from '../services/safefetch';
import type { AdminCtx, RouteMatch } from '../types';

const BASE = '/admin/products/whiten';
const REPO_NAME = cloud.REPO.split('/')[1] || cloud.REPO;
const PER_PAGE = 12;
const HOST = "split_part(p.import_ref, '#', 1)";
const ALL = '*';
const FILTERS: Record<string, string> = { todo: 'এখনো সাদা করা হয়নি', done: '⬜ সাদা করা হয়েছে', all: 'সব' };

async function hosts() {
  const shops = await db.q<{ host: string; n: number }>(`SELECT ${HOST} AS host, count(*)::int AS n FROM products p
    WHERE p.import_ref <> '' AND p.parent_id IS NULL AND ${HOST} NOT IN ('', 'file') GROUP BY 1 ORDER BY count(*) DESC`);
  return [...shops, { host: ALL, n: 0 }];
}

async function page(ctx: AdminCtx) {
  const list = await hosts();
  const wanted = str(ctx.query.get('host'), 120);
  // ElectroX first when nothing is chosen (the shop the owner asked about), else the biggest one
  const host = list.some((h) => h.host === wanted) ? wanted : (list.find((h) => /electrox/i.test(h.host)) || list[0]).host;
  const f = ifKey(FILTERS, ctx.query.get('f'), 'todo');
  const pg = Math.max(1, int(ctx.query.get('page'), 1));
  const cond = host === ALL ? 'TRUE' : `${HOST}=$1`;
  const args = host === ALL ? [] : [host];
  const has = (white: boolean) => `EXISTS (SELECT 1 FROM media m WHERE m.owner_type='product' AND m.owner_id=p.id AND m.wb_from IS ${white ? 'NOT ' : ''}NULL)`;
  const where = `p.parent_id IS NULL AND ${cond}${f === 'todo' ? ` AND ${has(false)}` : f === 'done' ? ` AND ${has(true)}` : ''}`;
  const [rows, count, ids] = await Promise.all([
    db.q<{ id: number; sku: string; name: string; active: boolean; pics: { id: number; white: boolean }[] }>(`SELECT p.id, p.sku, p.name, p.active,
        coalesce((SELECT json_agg(json_build_object('id', m.id, 'white', m.wb_from IS NOT NULL) ORDER BY m.sort, m.id) FROM media m WHERE m.owner_type='product' AND m.owner_id=p.id), '[]') AS pics
      FROM products p WHERE ${where}
      ORDER BY CASE WHEN p.sku ~ '^[0-9]+$' THEN lpad(p.sku, 12, '0') ELSE p.sku END, p.id
      LIMIT ${PER_PAGE} OFFSET ${(pg - 1) * PER_PAGE}`, args),
    db.one<{ n: number }>(`SELECT count(*)::int AS n FROM products p WHERE ${where}`, args).then((r) => r!.n),
    db.q<{ id: number }>(`SELECT p.id FROM products p WHERE p.parent_id IS NULL AND ${cond}`, args).then((r) => r.map((x) => x.id)),
  ]);
  const prog = await W.progress(ids);
  // ☁️ pictures already sent to the cloud AI (waiting or finished, not yet kept)
  const mids = rows.flatMap((p) => p.pics.map((m) => m.id));
  const jobs = new Map((mids.length ? await db.q<{ media_id: number; id: number }>(`SELECT DISTINCT ON (media_id) media_id, id FROM whiten_jobs
    WHERE media_id = ANY($1::int[]) AND status IN ('queued','done','failed') AND created_at > now() - interval '2 days' ORDER BY media_id, id DESC`, [mids]) : []).map((j) => [j.media_id, j.id]));
  const pages = Math.max(1, Math.ceil(count / PER_PAGE));
  const q = (o: Record<string, string>) => `${BASE}?${new URLSearchParams({ host, f, ...o })}`;
  const body = <><div className="title-row"><h1>⬜ ছবির ব্যাকগ্রাউন্ড সাদা</h1></div>{ui.flash(ctx.flash)}
    {ui.helpBox('কীভাবে কাজ করে', <ol className="steps"><li>নিচে দোকান বাছুন। <b>"▶ এই পেজের ছবি সাদা করুন"</b> চাপলে আপনার কম্পিউটারেই একটা AI প্রতিটা ছবি থেকে শুধু পণ্যটা কেটে একদম সাদা (#FFFFFF) ব্যাকগ্রাউন্ডে বসায় — পেছনের লেখা, ফোন নম্বর, রং সব চলে যায়। ফ্রি, কোনো সীমা নেই।</li><li><b>☁️ অনলাইনে (প্রস্তাবিত):</b> ছবিগুলো অনলাইনের শক্তিশালী কম্পিউটারে (GitHub, ফ্রি) সাদা হয় — আপনার ল্যাপটপ বা ফোনে কোনো চাপ পড়ে না, পেজ বন্ধ করলেও কাজ চলতে থাকে। কয়েক মিনিট লাগে; তৈরি হলে এখানেই "পরে"-র ছবি দেখাবে। ছবির কোণের লোগো আর আলাদা লেখাও মুছে দেয়।</li><li>নিজের কম্পিউটারে চালাতে চাইলে দুইটা AI আছে: <b>🧠 সেরা মান</b> (BiRefNet — পণ্যের কিনারা, তার, স্বচ্ছ প্লাস্টিক সবচেয়ে নিখুঁত) আর <b>⚡ দ্রুত</b> (ISNet — ধীর কম্পিউটারে)। প্রথমবার AI-এর ফাইল নামে (প্রায় ২০০ MB, একবারই — পরে কম্পিউটারে রাখা থাকে)। কাজ চলার সময় পেজটা খোলা রাখুন।</li><li><b>✨ উজ্জ্বল ও পরিষ্কার</b> টিক দিলে পণ্যটা একটু উজ্জ্বল হয়, রং একটু ঝকঝকে হয় — পণ্যের আকার বা লেখা কিছুই বদলায় না।</li><li>প্রতিটা ছবির <b>আগে / পরে</b> দেখুন। ভালো হলে টিক থাকুক, খারাপ হলে টিক তুলে দিন — তারপর <b>"💾 টিক দেওয়াগুলো রাখুন"</b>। শুধু টিক দেওয়াগুলোই বদলায়।</li><li>আসল ছবি সবসময় রাখা থাকে: সাদা করা ছবির নিচে <b>"↺ আসল ছবি ফেরত"</b> চাপলে আগের মতো হয়ে যায়।</li><li>পণ্যের নিজের গায়ে কোনো লেখা থাকলে AI সেটা পণ্যের অংশ ভেবে রেখে দেয় — ওগুলো আলাদা করে দেখে নেবেন।</li></ol>)}
    <form method="get" action={attrValue(BASE)} className="toolbar">{ui.select('host', list.map((h) => [h.host, h.host === ALL ? 'দোকানের সব পণ্য' : `${h.host} — ${bn(h.n)}টি পণ্য`]), host)}{' '}<input type="hidden" name="f" defaultValue={attrValue(f)} /><button className="btn btn-sm btn-ghost">দেখুন</button></form>
    <div className="kpis kpis-tight">{ui.kpi('ছবি', bn(prog.pics), `${bn(ids.length)}টি পণ্যে`)}{' '}{ui.kpi('সাদা করা হয়েছে', `${bn(prog.white)} / ${bn(prog.pics)}`, `${bn(prog.pics ? Math.round((prog.white * 100) / prog.pics) : 0)}%`, 'kpi-blue')}</div>
    <nav className="toolbar">{jsxList(Object.entries(FILTERS).map(([k, v]) => <>{' '}<a className={`chip ${k === f ? 'on' : ''}`} href={attrValue(`${BASE}?${new URLSearchParams({ host, f: k })}`)}><Val v={v} /></a></>))}</nav>
    {(rows.length ? <section className="panel wt" data-whiten="" data-wt-fast={ctx.settings.whiten_gh_token ? '1' : undefined}>
      <div className="wt-bar"><button type="button" className="btn" data-wt-run="">▶ এই পেজের ছবি সাদা করুন</button>{' '}<button type="button" className="btn btn-ghost" data-wt-save="" disabled>💾 টিক দেওয়াগুলো রাখুন</button>{' '}<label className="check"><input type="checkbox" data-wt-only-new="" defaultChecked />{' '}<span>আগে সাদা করা ছবি বাদ</span></label>{' '}<select data-wt-model="" aria-label="কোন AI" defaultValue="cloud"><option value="cloud">☁️ অনলাইনে — সেরা মান, কম্পিউটার/ফোনে চাপ নেই</option><option value="best">🧠 এই কম্পিউটারে — সেরা মান (শক্তিশালী গ্রাফিক্স লাগে)</option><option value="fast">⚡ এই কম্পিউটারে — দ্রুত (ISNet)</option></select>{' '}<label className="check" title="পণ্যটা একটু উজ্জ্বল ও পরিষ্কার হয় (আলো আর রং হালকা বাড়ে)। আগে/পরে দেখে তবেই রাখবেন।"><input type="checkbox" data-wt-bright="" />{' '}<span>✨ উজ্জ্বল ও পরিষ্কার</span></label>{' '}<label className="check" title="পণ্য থেকে আলাদা ছোট টুকরো — যেমন পেছনের লেখা বা ফোন নম্বর — মুছে দেয়। পণ্যের আলাদা ছোট অংশ (যেমন চিরুনি) কেটে গেলে এটা তুলে দিয়ে আবার চালান।"><input type="checkbox" data-wt-clean="" defaultChecked />{' '}<span>আলাদা ছোট লেখা/টুকরো মুছুন</span></label>{' '}<span className="small" data-wt-status="" aria-live="polite"></span></div>
      <div className="wt-list">{jsxList(rows.map((p) => <div className="wt-product"><div className="wt-head"><b>SKU <Val v={p.sku || '—'} /></b>{' '}<a href={`/admin/products/${attrValue(p.id)}`} target="_blank" rel="noopener"><Val v={p.name} /></a>{(p.active ? null : <>{' '}<span className="pill pill-grey">বন্ধ</span></>)}</div>
        <div className="wt-pics">{(p.pics.length ? jsxList(p.pics.map((m) => <figure className={`wt-pic ${m.white ? 'is-white' : ''}`} data-wt-media={attrValue(m.id)} data-white={m.white ? '1' : undefined} data-wt-job={jobs.has(m.id) ? String(jobs.get(m.id)) : undefined}>
          <div className="wt-pair"><a href={`/media/${attrValue(m.id)}`} target="_blank" rel="noopener"><img src={`/media/${attrValue(m.id)}/t`} alt="আগে" loading="lazy" /></a><span className="wt-after" data-wt-after="" hidden></span></div>
          <figcaption className="small">{(m.white ? <><span>⬜ সাদা করা</span>{' '}<button type="button" className="link-btn small" data-wt-undo="">↺ আসল ছবি ফেরত</button></> : <><button type="button" className="link-btn small" data-wt-one="">▶ শুধু এটা</button>{' '}<label className="check" data-wt-keep-label="" hidden><input type="checkbox" data-wt-keep="" defaultChecked />{' '}<span>রাখুন</span></label></>)}<span className="wt-msg" data-wt-msg=""></span></figcaption>
        </figure>)) : <span className="muted small">ছবি নেই</span>)}</div></div>))}</div>
    </section> : <p className="muted">{(f === 'todo' ? '🎉 এই দোকানের সব ছবি সাদা করা হয়ে গেছে।' : 'এই তালিকায় কোনো পণ্য নেই।')}</p>)}
    {(ctx.user.role === 'owner' ? <section className="panel" id="fast"><h2>⚡ সাথে সাথে শুরু {(ctx.settings.whiten_gh_token ? <span className="pill pill-green">চালু ✅</span> : <span className="pill pill-grey">বন্ধ</span>)}</h2>
      <p className="small">GitHub নিজের সময়সূচি অনেক সময় ৩০–৬০ মিনিট পিছিয়ে চালায়। একটা GitHub চাবি দিলে ছবি পাঠানোর সাথে সাথে কাজ শুরু হয় — সাধারণত ১–৩ মিনিটে ছবি তৈরি।</p>
      <ol className="steps small"><li>GitHub-এ লগইন করে খুলুন: <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">github.com/settings/personal-access-tokens/new</a></li><li><b>Token name</b>: <code>shobmilbe whiten</code> · <b>Expiration</b>: সবচেয়ে লম্বা (বা No expiration)</li><li><b>Repository access</b> → <b>Only select repositories</b> → <code>{REPO_NAME}</code></li><li><b>Permissions</b> → <b>Actions</b> → <b>Read and write</b> (আর কিছু লাগবে না)</li><li>নিচে <b>Generate token</b> → যে লেখাটা দেখায় (<code>github_pat_…</code>) কপি করে এখানে বসান।</li></ol>
      <form method="post" action="/admin/products/whiten/token" className="toolbar">{ui.input('token', '', { type: 'password', autocomplete: 'off', placeholder: ctx.settings.whiten_gh_token ? 'সেভ করা আছে (বদলাতে নতুন দিন)' : 'github_pat_…', 'aria-label': 'GitHub চাবি' })}{' '}<button className="btn btn-sm">পরীক্ষা করে সেভ করুন</button></form>
      {(ctx.settings.whiten_gh_token ? <form method="post" action="/admin/products/whiten/token" data-confirm="চাবি মুছে ফেলবেন? তখন ছবি GitHub-এর নিজের সময়সূচিতে তৈরি হবে।"><input type="hidden" name="action" defaultValue="clear" /><button className="btn btn-sm btn-ghost">চাবি মুছুন</button></form> : null)}
    </section> : null)}
    {(pages > 1 ? <nav className="pager">{(pg > 1 ? <a className="btn btn-sm btn-ghost" href={attrValue(q({ page: String(pg - 1) }))}>← আগের</a> : null)}{' '}<span className="small">পেজ {bn(pg)} / {bn(pages)} · মোট {bn(count)}টি পণ্য</span>{' '}{(pg < pages ? <a className="btn btn-sm" href={attrValue(q({ page: String(pg + 1) }))}>পরের →</a> : null)}</nav> : null)}
  </>;
  return ctx.page('ব্যাকগ্রাউন্ড সাদা', body, 'whiten');
}

// keep a white copy (the picture comes from the browser as a JPEG)
async function keepApi(ctx: AdminCtx, m: RouteMatch) {
  const b = await ctx.body();
  const mm = String(b.data || '').match(/^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/);
  if (!mm) return ctx.json(400, { error: 'ছবি পড়া যায়নি।' });
  const data = Buffer.from(mm[1], 'base64');
  if (data.length > 3 * 1024 * 1024 || security.imageKind(data) !== 'image/jpeg') return ctx.json(400, { error: 'ছবি ঠিক নেই।' });
  try {
    const id = await W.keep(int(m[1]), data, { width: int(b.width) || undefined, height: int(b.height) || undefined });
    await ctx.log('product_photo', 'media', id, `ব্যাকগ্রাউন্ড সাদা (আসল ছবি #${int(m[1])} রাখা আছে)`);
    return ctx.json(200, { ok: true, id });
  } catch (e) { return ctx.json(e instanceof W.WhitenError ? 409 : 500, { error: (e as Error).message }); }
}
async function undoApi(ctx: AdminCtx, m: RouteMatch) {
  try {
    const id = await W.undo(int(m[1]));
    await ctx.log('product_photo', 'media', id, 'সাদা ব্যাকগ্রাউন্ড বাদ — আসল ছবি ফেরত');
    return ctx.json(200, { ok: true, id });
  } catch (e) { return ctx.json(e instanceof W.WhitenError ? 409 : 500, { error: (e as Error).message }); }
}

// ☁️ send pictures to the cloud AI / see where they are / put a finished one into its product
async function cloudQueue(ctx: AdminCtx) {
  const b = await ctx.body();
  const ids = (Array.isArray(b.ids) ? b.ids : []).map((x: unknown) => int(x));
  const jobs = await cloud.queue(ids, { bright: !!b.bright, clean: b.clean !== false && b.clean !== 0 }, ctx.user.id);
  const k = Object.keys(jobs).length ? await cloud.kick(ctx.settings) : { ok: false, message: 'none' };
  return ctx.json(200, { jobs, fast: k.ok });
}
async function cloudStatus(ctx: AdminCtx) {
  const ids = String(ctx.query.get('ids') || '').split(',').map((x) => int(x)).filter(Boolean);
  return ctx.json(200, { jobs: await cloud.status(ids) });
}
async function cloudKeep(ctx: AdminCtx, m: RouteMatch) {
  try {
    const r = await cloud.keep(int(m[1]));
    await ctx.log('product_photo', 'media', r.id, `ব্যাকগ্রাউন্ড সাদা — অনলাইনে (আসল ছবি #${r.from} রাখা আছে)`);
    return ctx.json(200, { ok: true, id: r.id });
  } catch (e) { return ctx.json(e instanceof cloud.CloudError || e instanceof W.WhitenError ? 409 : 500, { error: (e as Error).message }); }
}

// ⚡ the owner's GitHub key that starts the cloud AI at once (tested before it is saved: a wrong key never replaces a working one)
async function saveToken(ctx: AdminCtx) {
  const b = await ctx.body();
  const back = (msg: string) => ctx.redirect(`${BASE}?info=${encodeURIComponent(msg)}#fast`);
  if (b.action === 'clear') { await db.setSetting('whiten_gh_token', ''); await ctx.reloadSettings(); return back('চাবি মুছে ফেলা হয়েছে। এখন ছবি GitHub-এর নিজের সময়সূচিতে তৈরি হবে।'); }
  const token = str(b.token, 400).trim();
  if (!/^(github_pat_|ghp_)[A-Za-z0-9_]{20,}$/.test(token)) return back('এটা GitHub-এর চাবি মনে হচ্ছে না — "github_pat_" দিয়ে শুরু হওয়া পুরো লেখাটা কপি করে দিন।');
  const t = await cloud.kick({ ...ctx.settings, whiten_gh_token: token }, true);
  if (!t.ok) return back(`চাবিটা কাজ করেনি: ${t.message}। আগের অবস্থা যেমন ছিল তেমনই আছে।`);
  await db.setSetting('whiten_gh_token', token);
  await ctx.reloadSettings();
  await ctx.log('settings', 'setting', 0, 'ব্যাকগ্রাউন্ড সাদা — GitHub চাবি সেভ (পরীক্ষা করে)');
  return back('✅ চাবি কাজ করছে ও সেভ হয়েছে। এখন থেকে ছবি পাঠালেই সাথে সাথে কাজ শুরু হবে (১–৩ মিনিট)।');
}

// ---------------------------------------------------------------- 📤 নিজের ছবি সাদা (owner, 2026-10-24)
// The owner's own pictures (from the computer or the phone, not a product's): the same cloud AI makes them white,
// each one can be downloaded. Nothing goes into the shop. Kept 7 days.
const MINE_BASE = '/admin/products/whiten/mine';
// 🔗 লিংক থেকে ছবি → JPG (owner, 2026-10-25): any picture address (or a product page that has a picture) from any
// website; the shop fetches it (only public internet addresses — services/safefetch.ts) and hands the bytes to this
// admin's browser, which draws it on white and saves it as a JPG. WebP, AVIF, PNG, GIF, BMP, SVG … whatever the browser
// can show. Nothing is kept on the shop.
function pictureKind(buf: Buffer, type: string): string | null {
  const known = security.imageKind(buf);
  if (known) return known;
  const head = buf.subarray(0, 64).toString('latin1');
  if (head.slice(4, 12) === 'ftypavif' || head.slice(4, 12) === 'ftypavis') return 'image/avif';
  if (head.startsWith('BM')) return 'image/bmp';
  if (/^II\*\0|^MM\0\*/.test(head)) return 'image/tiff';
  if (/^\s*(<\?xml[^>]*>\s*)?<svg[\s>]/i.test(buf.subarray(0, 400).toString('utf8'))) return 'image/svg+xml';
  return /^image\//.test(type) ? type.split(';')[0].trim() : null;
}
async function imgFetch(ctx: AdminCtx) {
  const fail = (m: string) => ctx.json(400, { error: m });
  if (!(await security.hit(db, 'imgfetch:' + ctx.user.id, 200, 3600))) return fail('এক ঘণ্টায় অনেক বেশি লিংক — একটু পরে আবার চেষ্টা করুন।');
  let u = str(ctx.query.get('url'), 2000).trim();
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u.replace(/^\/+/, '');
  try {
    let r = await safeFetch(u, { maxBytes: 15 * 1024 * 1024, timeoutMs: 15000, accept: 'image/avif,image/webp,image/*,text/html;q=0.8,*/*;q=0.5' });
    let kind = r.ok ? pictureKind(r.body, r.contentType) : null;
    // a product page instead of a picture: its main picture (og:image)
    if (r.ok && !kind && /html/i.test(r.contentType)) {
      const html = r.body.toString('utf8');
      const m = html.match(/<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/i) || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
      if (m) { r = await safeFetch(new URL(m[1].replace(/&amp;/g, '&'), r.finalUrl).toString(), { maxBytes: 15 * 1024 * 1024, timeoutMs: 15000 }); kind = r.ok ? pictureKind(r.body, r.contentType) : null; }
    }
    if (!r.ok) return fail(`ওয়েবসাইট ছবিটা দিল না (${r.status})।`);
    if (!kind) return fail('এই লিংকে কোনো ছবি পাওয়া যায়নি — ছবির উপর চেপে ধরে "Copy image address" দিয়ে লিংক নিন।');
    const name = (new URL(r.finalUrl).pathname.split('/').pop() || 'picture').replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[^\w\u0980-\u09ff-]+/g, '-').slice(0, 60) || 'picture';
    return ctx.reply.answer(200, { 'Content-Type': kind, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox", 'X-Picture-Name': encodeURIComponent(name) }, r.body);
  } catch (e) { return fail((e as Error).message || 'ছবিটা আনা যায়নি।'); }
}

async function minePage(ctx: AdminCtx) {
  const list = await cloud.listMine(ctx.user.id);
  const fast = !!ctx.settings.whiten_gh_token;
  const body = <><div className="title-row"><h1>📤 নিজের ছবি সাদা</h1></div>{ui.flash(ctx.flash)}
    <section className="panel" data-tojpg=""><h2>🔗 লিংক থেকে ছবি → JPG</h2>
      <p className="small">যেকোনো ওয়েবসাইটের ছবির লিংক (WebP, AVIF, PNG, GIF, BMP, SVG — যেকোনো রকম) বা পণ্যের পেজের লিংক এখানে দিন — ছবিটা নিচে দেখাবে, তারপর <b>⬇️ JPG ডাউনলোড</b> চাপলেই সাদা ব্যাকগ্রাউন্ডে JPG হয়ে নামবে। ছবির লিংক পেতে: ছবির উপর চেপে ধরুন (কম্পিউটারে ডান ক্লিক) → <b>Copy image address / ছবির ঠিকানা কপি</b>। একসাথে কয়েকটা লিংক দিতে চাইলে প্রতিটা আলাদা লাইনে দিন।</p>
      <div className="tojpg-form">{ui.textarea('tojpg_urls', '', { rows: 2, placeholder: 'https://… ছবির লিংক (প্রতি লাইনে একটা)', 'aria-label': 'ছবির লিংক', 'data-tojpg-urls': '' })}<button type="button" className="btn" data-tojpg-go="">🔄 ছবি আনুন ও JPG করুন</button></div>
      <p className="small" data-tojpg-status="" aria-live="polite"></p>
      <div className="mine-grid" data-tojpg-list=""></div>
    </section>
    <section className="panel" data-mine="" data-wt-fast={fast ? '1' : undefined}>
      <p className="small">আপনার কম্পিউটার বা ফোনের যেকোনো ছবি দিন — একটা বা একসাথে অনেকগুলো। "ব্যাকগ্রাউন্ড সাদা"-র একই AI অনলাইনে পণ্যটা কেটে একদম সাদা ব্যাকগ্রাউন্ডে বসায় (লোগো, ফোন নম্বর, আলাদা লেখা মুছে যায়)। তৈরি হলে প্রতিটা আলাদা করে ডাউনলোড করুন। দোকানে কিছু বদলায় না। ছবিগুলো {bn(cloud.MINE_DAYS)} দিন রাখা থাকে, তারপর নিজে থেকে মুছে যায়।</p>
      <div className="wt-bar"><label className="btn">📁 ছবি বাছুন<input type="file" accept="image/*" multiple hidden data-mine-files="" /></label>{' '}<label className="check" title="পণ্যটা একটু উজ্জ্বল ও পরিষ্কার হয়"><input type="checkbox" data-mine-bright="" />{' '}<span>✨ উজ্জ্বল ও পরিষ্কার</span></label>{' '}<label className="check" title="পণ্য থেকে আলাদা লোগো, ফোন নম্বর, লেখা মুছে দেয়"><input type="checkbox" data-mine-clean="" defaultChecked />{' '}<span>লোগো, ফোন নম্বর, ওয়েবসাইট মুছুন</span></label>{' '}<label className="check" title="ছবিতে ক্যামেরার ফ্ল্যাশের সাদা ঝলক থাকলে আশেপাশের রং দিয়ে ভরে দেয় — পণ্যের নিজের সাদা লেখা/বোতাম ঠিক থাকে"><input type="checkbox" data-mine-glare="" defaultChecked />{' '}<span>💡 ফ্ল্যাশের ঝলক কমান</span></label>{' '}<label className="check" title="পণ্যের নিচে সাদা/ধূসর স্ট্যান্ড বা বেস (প্লেট) থাকলে মুছে দেয়। স্বচ্ছ বাক্সে রাখা পণ্যে টিক দেবেন না।"><input type="checkbox" data-mine-base="" />{' '}<span>🧹 নিচের স্ট্যান্ড/বেস মুছুন</span></label>{' '}{(list.some((x) => x.status === 'done') ? <button type="button" className="btn btn-ghost" data-mine-all="">⬇️ তৈরি সবগুলো ডাউনলোড</button> : null)}</div>
      <p className="small" data-mine-status="" aria-live="polite">{(fast ? '' : 'ছবি তৈরি হতে কখনো ৩০ মিনিটও লাগতে পারে — "ব্যাকগ্রাউন্ড সাদা" পেজের নিচে "⚡ সাথে সাথে শুরু" চালু থাকলে ১–৩ মিনিট।')}</p>
      {(list.length ? <div className="mine-grid">{jsxList(list.map((x) => <figure className="mine-pic" data-mine-job={attrValue(x.job)} data-mine-state={attrValue(x.status)}>
        <div className="wt-pair"><a href={`/media/${attrValue(x.media_id)}`} target="_blank" rel="noopener"><img src={`/media/${attrValue(x.media_id)}/t`} alt="আগে" loading="lazy" /></a><span className="wt-after" data-mine-after=""></span></div>
        <figcaption className="small"><span data-mine-msg="">{(x.status === 'failed' ? `⚠️ ${x.error || 'হয়নি'}` : x.status === 'queued' ? '☁️ অনলাইনে তৈরি হচ্ছে…' : '')}</span>{' '}<a className="btn btn-sm" data-mine-dl="" href={`/admin/api/whiten-mine/${attrValue(x.job)}/download`} hidden={x.status !== 'done' && x.status !== 'kept'}>⬇️ ডাউনলোড</a>{' '}<button type="button" className="link-btn small" data-mine-del={attrValue(x.media_id)}>🗑️ মুছুন</button></figcaption>
      </figure>))}</div> : <p className="muted small">এখনো কোনো ছবি দেওয়া হয়নি।</p>)}
    </section></>;
  return ctx.page('নিজের ছবি সাদা', body, 'whiten-mine');
}
async function mineQueue(ctx: AdminCtx) {
  const b = await ctx.body();
  const ids = await cloud.claimMine((Array.isArray(b.ids) ? b.ids : []).map((x: unknown) => int(x)), ctx.user.id);
  const jobs = await cloud.queue(ids, { bright: !!b.bright, clean: b.clean !== false && b.clean !== 0, base: !!b.base, glare: !!b.glare, contact: b.clean !== false && b.clean !== 0 }, ctx.user.id, 'mine');
  const k = Object.keys(jobs).length ? await cloud.kick(ctx.settings) : { ok: false };
  return ctx.json(200, { jobs, fast: k.ok });
}
async function mineDownload(ctx: AdminCtx, m: RouteMatch) {
  try {
    const r = await cloud.resultFile(int(m[1]), ctx.user.id);
    return ctx.reply.answer(200, { 'Content-Type': 'image/jpeg', 'Content-Disposition': `attachment; filename="white-${r.media_id}.jpg"`, 'Content-Length': r.data.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }, r.data);
  } catch (e) { return ctx.send(e instanceof cloud.CloudError ? 409 : 500, (e as Error).message, 'text/plain; charset=utf-8'); }
}
async function mineDelete(ctx: AdminCtx, m: RouteMatch) {
  return ctx.json(200, { ok: await cloud.deleteMine(int(m[1]), ctx.user.id) });
}

export const routes = [
  { method: 'POST', path: '/admin/products/whiten/token', perm: 'owner', handler: saveToken },
  { method: 'POST', path: '/admin/api/whiten-cloud', perm: 'products', handler: cloudQueue },
  { method: 'GET', path: '/admin/api/whiten-cloud', perm: 'products', handler: cloudStatus },
  { method: 'POST', path: /^\/admin\/api\/whiten-cloud\/(\d+)\/keep$/, perm: 'products', handler: cloudKeep },
  { method: 'GET', path: BASE, perm: 'products', handler: page },
  { method: 'POST', path: /^\/admin\/api\/whiten\/(\d+)$/, perm: 'products', handler: keepApi },
  { method: 'POST', path: /^\/admin\/api\/whiten\/(\d+)\/undo$/, perm: 'products', handler: undoApi },
  { method: 'GET', path: MINE_BASE, perm: 'products', handler: minePage },
  { method: 'GET', path: '/admin/api/img-fetch', perm: 'products', handler: imgFetch },
  { method: 'POST', path: '/admin/api/whiten-mine', perm: 'products', handler: mineQueue },
  { method: 'GET', path: /^\/admin\/api\/whiten-mine\/(\d+)\/download$/, perm: 'products', handler: mineDownload },
  { method: 'POST', path: /^\/admin\/api\/whiten-mine\/(\d+)\/delete$/, perm: 'products', handler: mineDelete },
];
