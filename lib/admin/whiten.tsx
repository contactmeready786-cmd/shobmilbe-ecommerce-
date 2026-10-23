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
import type { AdminCtx, RouteMatch } from '../types';

const BASE = '/admin/products/whiten';
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
  const pages = Math.max(1, Math.ceil(count / PER_PAGE));
  const q = (o: Record<string, string>) => `${BASE}?${new URLSearchParams({ host, f, ...o })}`;
  const body = <><div className="title-row"><h1>⬜ ছবির ব্যাকগ্রাউন্ড সাদা</h1></div>{ui.flash(ctx.flash)}
    {ui.helpBox('কীভাবে কাজ করে', <ol className="steps"><li>নিচে দোকান বাছুন। <b>"▶ এই পেজের ছবি সাদা করুন"</b> চাপলে আপনার কম্পিউটারেই একটা AI প্রতিটা ছবি থেকে শুধু পণ্যটা কেটে একদম সাদা (#FFFFFF) ব্যাকগ্রাউন্ডে বসায় — পেছনের লেখা, ফোন নম্বর, রং সব চলে যায়। ফ্রি, কোনো সীমা নেই।</li><li>প্রথমবার AI-এর ফাইল নামে (প্রায় ১৮০ MB, একবারই — পরে কম্পিউটারে রাখা থাকে)। প্রতিটা ছবিতে কয়েক সেকেন্ড লাগে। কাজ চলার সময় পেজটা খোলা রাখুন।</li><li>প্রতিটা ছবির <b>আগে / পরে</b> দেখুন। ভালো হলে টিক থাকুক, খারাপ হলে টিক তুলে দিন — তারপর <b>"💾 টিক দেওয়াগুলো রাখুন"</b>। শুধু টিক দেওয়াগুলোই বদলায়।</li><li>আসল ছবি সবসময় রাখা থাকে: সাদা করা ছবির নিচে <b>"↺ আসল ছবি ফেরত"</b> চাপলে আগের মতো হয়ে যায়।</li><li>পণ্যের নিজের গায়ে কোনো লেখা থাকলে AI সেটা পণ্যের অংশ ভেবে রেখে দেয় — ওগুলো আলাদা করে দেখে নেবেন।</li></ol>)}
    <form method="get" action={attrValue(BASE)} className="toolbar">{ui.select('host', list.map((h) => [h.host, h.host === ALL ? 'দোকানের সব পণ্য' : `${h.host} — ${bn(h.n)}টি পণ্য`]), host)}{' '}<input type="hidden" name="f" defaultValue={attrValue(f)} /><button className="btn btn-sm btn-ghost">দেখুন</button></form>
    <div className="kpis kpis-tight">{ui.kpi('ছবি', bn(prog.pics), `${bn(ids.length)}টি পণ্যে`)}{' '}{ui.kpi('সাদা করা হয়েছে', `${bn(prog.white)} / ${bn(prog.pics)}`, `${bn(prog.pics ? Math.round((prog.white * 100) / prog.pics) : 0)}%`, 'kpi-blue')}</div>
    <nav className="toolbar">{jsxList(Object.entries(FILTERS).map(([k, v]) => <>{' '}<a className={`chip ${k === f ? 'on' : ''}`} href={attrValue(`${BASE}?${new URLSearchParams({ host, f: k })}`)}><Val v={v} /></a></>))}</nav>
    {(rows.length ? <section className="panel wt" data-whiten="">
      <div className="wt-bar"><button type="button" className="btn" data-wt-run="">▶ এই পেজের ছবি সাদা করুন</button>{' '}<button type="button" className="btn btn-ghost" data-wt-save="" disabled>💾 টিক দেওয়াগুলো রাখুন</button>{' '}<label className="check"><input type="checkbox" data-wt-only-new="" defaultChecked />{' '}<span>আগে সাদা করা ছবি বাদ</span></label>{' '}<label className="check" title="পণ্য থেকে আলাদা ছোট টুকরো — যেমন পেছনের লেখা বা ফোন নম্বর — মুছে দেয়। পণ্যের আলাদা ছোট অংশ (যেমন চিরুনি) কেটে গেলে এটা তুলে দিয়ে আবার চালান।"><input type="checkbox" data-wt-clean="" defaultChecked />{' '}<span>আলাদা ছোট লেখা/টুকরো মুছুন</span></label>{' '}<span className="small" data-wt-status="" aria-live="polite"></span></div>
      <div className="wt-list">{jsxList(rows.map((p) => <div className="wt-product"><div className="wt-head"><b>SKU <Val v={p.sku || '—'} /></b>{' '}<a href={`/admin/products/${attrValue(p.id)}`} target="_blank" rel="noopener"><Val v={p.name} /></a>{(p.active ? null : <>{' '}<span className="pill pill-grey">বন্ধ</span></>)}</div>
        <div className="wt-pics">{(p.pics.length ? jsxList(p.pics.map((m) => <figure className={`wt-pic ${m.white ? 'is-white' : ''}`} data-wt-media={attrValue(m.id)} data-white={m.white ? '1' : undefined}>
          <div className="wt-pair"><a href={`/media/${attrValue(m.id)}`} target="_blank" rel="noopener"><img src={`/media/${attrValue(m.id)}/t`} alt="আগে" loading="lazy" /></a><span className="wt-after" data-wt-after="" hidden></span></div>
          <figcaption className="small">{(m.white ? <><span>⬜ সাদা করা</span>{' '}<button type="button" className="link-btn small" data-wt-undo="">↺ আসল ছবি ফেরত</button></> : <><button type="button" className="link-btn small" data-wt-one="">▶ শুধু এটা</button>{' '}<label className="check" data-wt-keep-label="" hidden><input type="checkbox" data-wt-keep="" defaultChecked />{' '}<span>রাখুন</span></label></>)}<span className="wt-msg" data-wt-msg=""></span></figcaption>
        </figure>)) : <span className="muted small">ছবি নেই</span>)}</div></div>))}</div>
    </section> : <p className="muted">{(f === 'todo' ? '🎉 এই দোকানের সব ছবি সাদা করা হয়ে গেছে।' : 'এই তালিকায় কোনো পণ্য নেই।')}</p>)}
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

export const routes = [
  { method: 'GET', path: BASE, perm: 'products', handler: page },
  { method: 'POST', path: /^\/admin\/api\/whiten\/(\d+)$/, perm: 'products', handler: keepApi },
  { method: 'POST', path: /^\/admin\/api\/whiten\/(\d+)\/undo$/, perm: 'products', handler: undoApi },
];
