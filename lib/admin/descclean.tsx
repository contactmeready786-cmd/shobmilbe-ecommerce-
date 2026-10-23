// Admin → পণ্য → ওয়াটারমার্ক ও ডুপ্লিকেট → 🧹 বিবরণ পরিষ্কার (owner, 2026-10-24).
// Descriptions copied from another shop end with that shop's own text (its FAQ, delivery rules, web address, phone).
// lib/models/descclean.ts finds those parts; here the owner sees exactly what will go (red) for each product, ticks,
// and cleans — one product, the ticked ones, or every product from that shop. The text before each clean-up is kept
// (desc_clean_log) and comes back with one press. Nothing runs by itself here (imports clean new products: import.tsx).
import { Val, attrValue, jsxList } from '../react/html';
import { bn, int, str, ifKey, fmtDate, list as listOf } from '../util';
import * as db from '../db';
import * as ui from './ui';
import { clean } from '../models/descclean';
import type { AdminCtx } from '../types';

const BASE = '/admin/products/clean-desc';
const PER_PAGE = 20;
const HOST = "split_part(p.import_ref, '#', 1)";
const FILTERS: Record<string, string> = { todo: 'পরিষ্কার করার আছে', all: 'সব পণ্য' };

type Row = { id: number; sku: string; name: string; active: boolean; description: string; short_description: string; host: string };

async function hosts() {
  return db.q<{ host: string; n: number }>(`SELECT ${HOST} AS host, count(*)::int AS n FROM products p
    WHERE p.import_ref <> '' AND p.parent_id IS NULL AND ${HOST} NOT IN ('', 'file') GROUP BY 1 ORDER BY count(*) DESC`);
}
async function rowsOf(host: string, ids?: number[]) {
  return db.q<Row>(`SELECT p.id, p.sku, p.name, p.active, coalesce(p.description, '') AS description, coalesce(p.short_description, '') AS short_description, ${HOST} AS host
    FROM products p WHERE p.parent_id IS NULL AND ${HOST}=$1 ${ids ? 'AND p.id = ANY($2::int[])' : ''}
    ORDER BY CASE WHEN p.sku ~ '^[0-9]+$' THEN lpad(p.sku, 12, '0') ELSE p.sku END, p.id`, ids ? [host, ids] : [host]);
}
const cleanRow = (r: Row) => ({ d: clean(r.description, r.host), s: clean(r.short_description, r.host) });

/** Clean these products; returns how many changed. */
async function apply(ctx: AdminCtx, rows: Row[]) {
  let n = 0;
  for (const r of rows) {
    const { d, s } = cleanRow(r);
    if (!d.changed && !s.changed) continue;
    await db.tx(async (t) => {
      // the stored text is the one that comes back on undo: description + short description together, as JSON
      await t.query(`INSERT INTO desc_clean_log(product_id, before, after, removed, by_user) VALUES($1, $2, $3, $4, $5)`,
        [r.id, JSON.stringify({ d: r.description, s: r.short_description }), JSON.stringify({ d: d.text, s: s.text }), d.removed.length + s.removed.length, ctx.user.id]);
      await t.query('UPDATE products SET description=$2, short_description=$3, updated_at=now() WHERE id=$1', [r.id, d.text, s.text]);
    });
    n++;
  }
  if (n) await ctx.log('product_bulk', 'product', null, `বিবরণ পরিষ্কার: ${n}টি পণ্য (${rows[0]?.host || ''})`);
  return n;
}

async function undo(ctx: AdminCtx, logId: number) {
  const l = await db.one<{ product_id: number; before: string; after: string }>('SELECT product_id, before, after FROM desc_clean_log WHERE id=$1 AND NOT undone', [logId]);
  if (!l) return false;
  const before = JSON.parse(l.before) as { d: string; s: string };
  await db.tx(async (t) => {
    await t.query('UPDATE products SET description=$2, short_description=$3, updated_at=now() WHERE id=$1', [l.product_id, before.d, before.s]);
    await t.query('UPDATE desc_clean_log SET undone=true WHERE id=$1', [logId]);
  });
  await ctx.log('product_edit', 'product', l.product_id, 'বিবরণ পরিষ্কার ফেরত — আগের লেখা ফেরত এসেছে');
  return true;
}

const back = (host: string, f: string, extra = '') => `${BASE}?${new URLSearchParams({ host, f })}${extra}`;

async function handle(ctx: AdminCtx) {
  const list = await hosts();
  if (ctx.method === 'POST') {
    const b = await ctx.body<'host' | 'f'>();
    const host = list.some((h) => h.host === b.host) ? String(b.host) : '';
    const f = ifKey(FILTERS, b.f, 'todo');
    if (b.action === 'undo') {
      const ok = await undo(ctx, int(b.log));
      return ctx.redirect(back(host, f, `&info=${encodeURIComponent(ok ? '↩️ আগের বিবরণ ফেরত এসেছে।' : 'এটা আগেই ফেরত আনা হয়েছে।')}#log`));
    }
    if (!host) return ctx.back(BASE);
    const ids = b.action === 'all' ? undefined : listOf(b.ids).map((x) => int(x)).filter((x) => x > 0).slice(0, 500);
    if (ids && !ids.length) return ctx.redirect(back(host, f, `&info=${encodeURIComponent('কোনো পণ্যে টিক নেই।')}`));
    const n = await apply(ctx, await rowsOf(host, ids));
    return ctx.redirect(back(host, f, `&info=${encodeURIComponent(`🧹 ${bn(n)}টি পণ্যের বিবরণ পরিষ্কার হয়েছে। নিচের তালিকা থেকে যেকোনোটা ফেরত আনা যায়।`)}`));
  }

  const wanted = str(ctx.query.get('host'), 120);
  const host = list.some((h) => h.host === wanted) ? wanted : (list.find((h) => /electrox/i.test(h.host)) || list[0])?.host || '';
  const f = ifKey(FILTERS, ctx.query.get('f'), 'todo');
  const pg = Math.max(1, int(ctx.query.get('page'), 1));
  const all = host ? (await rowsOf(host)).map((r) => ({ r, c: cleanRow(r) })) : [];
  const todo = all.filter((x) => x.c.d.changed || x.c.s.changed);
  const shown = f === 'todo' ? todo : all;
  const pages = Math.max(1, Math.ceil(shown.length / PER_PAGE));
  const slice = shown.slice((pg - 1) * PER_PAGE, pg * PER_PAGE);
  const log = await db.q<{ id: number; product_id: number; name: string; removed: number; created_at: Date; undone: boolean }>(`SELECT l.id, l.product_id, p.name, l.removed, l.created_at, l.undone
    FROM desc_clean_log l JOIN products p ON p.id=l.product_id ORDER BY l.id DESC LIMIT 40`);
  const info = ctx.query.get('info');
  const q = (o: Record<string, string>) => `${BASE}?${new URLSearchParams({ host, f, ...o })}`;
  const gone = (parts: string[]) => jsxList(parts.map((x) => <div className="dc-gone"><Val v={x} /></div>));

  const body = <><div className="title-row"><h1>🧹 বিবরণ পরিষ্কার</h1></div>{ui.flash(ctx.flash)}{(info ? <p className="flash"><Val v={info} /></p> : null)}
    {ui.helpBox('এটা কী করে?', <ol className="steps"><li>অন্য দোকান থেকে কপি করা পণ্যের বিবরণের শেষে সেই দোকানের নিজের কথা থাকে — "কেন আমাদের থেকে কিনবেন", ডেলিভারি/রিটার্নের নিয়ম, প্রশ্ন-উত্তর, ওয়েবসাইটের নাম, ফোন নম্বর। এগুলো খুঁজে বের করে।</li><li>প্রতিটা পণ্যের নিচে <b className="bad">লাল</b> করে দেখায় ঠিক কোন লেখাগুলো মুছবে। পণ্যের নিজের লেখা যেমন আছে তেমনই থাকে — একটা অক্ষরও বদলায় না।</li><li>দেখে টিক দিন, তারপর <b>"🧹 টিক দেওয়াগুলো পরিষ্কার করুন"</b>। আগের লেখা রাখা থাকে — নিচের তালিকা থেকে <b>"↩️ ফেরত"</b> চাপলে আগের মতো হয়ে যায়।</li><li>বিবরণ খুব ছোট হয়ে গেলে দোকানের <b>অটো SEO</b> নিজে থেকে পণ্যের পেজে সুন্দর বাংলা বিবরণ দেখায়। এখন থেকে নতুন আমদানি করা পণ্যের বিবরণ নিজে থেকেই পরিষ্কার হয়ে আসবে।</li></ol>)}
    {(list.length ? <form method="get" action={attrValue(BASE)} className="toolbar">{ui.select('host', list.map((h) => [h.host, `${h.host} — ${bn(h.n)}টি পণ্য`]), host)}{' '}<input type="hidden" name="f" defaultValue={attrValue(f)} /><button className="btn btn-sm btn-ghost">দেখুন</button></form> : <p className="muted">অন্য দোকান থেকে আমদানি করা কোনো পণ্য নেই।</p>)}
    {(host ? <><div className="kpis kpis-tight">{ui.kpi('এই দোকানের পণ্য', bn(all.length))}{' '}{ui.kpi('পরিষ্কার করার আছে', bn(todo.length), 'দোকানের নিজের লেখা পাওয়া গেছে', todo.length ? 'kpi-alert' : 'kpi-green')}</div>
      <nav className="toolbar">{jsxList(Object.entries(FILTERS).map(([k, v]) => <>{' '}<a className={`chip ${k === f ? 'on' : ''}`} href={attrValue(`${BASE}?${new URLSearchParams({ host, f: k })}`)}><Val v={v} /></a></>))}</nav>
      {(todo.length ? <form method="post" action={attrValue(BASE)} className="inline" data-confirm={`${host} থেকে আনা ${todo.length}টি পণ্যের বিবরণ থেকে দোকানের নিজের লেখা মুছবে (পরে ফেরত আনা যাবে)। করবেন?`}><input type="hidden" name="action" defaultValue="all" /><input type="hidden" name="host" defaultValue={attrValue(host)} /><input type="hidden" name="f" defaultValue={attrValue(f)} /><button className="btn">🧹 এই দোকানের সব ({bn(todo.length)}টি) পরিষ্কার করুন</button></form> : null)}
      {(slice.length ? <form method="post" action={attrValue(BASE)} className="dc-form"><input type="hidden" name="action" defaultValue="some" /><input type="hidden" name="host" defaultValue={attrValue(host)} /><input type="hidden" name="f" defaultValue={attrValue(f)} />
        <div className="dc-list">{jsxList(slice.map(({ r, c }) => { const changed = c.d.changed || c.s.changed; return <section className={`panel dc-item ${changed ? '' : 'is-clean'}`} id={`p${attrValue(r.id)}`}>
          <div className="dc-head">{(changed ? <label className="check"><input type="checkbox" name="ids[]" defaultValue={attrValue(r.id)} defaultChecked />{' '}<span>পরিষ্কার করুন</span></label> : <span className="pill pill-green">✅ পরিষ্কার</span>)}{' '}<b>SKU <Val v={r.sku || '—'} /></b>{' '}<a href={`/admin/products/${attrValue(r.id)}`} target="_blank" rel="noopener"><Val v={r.name} /></a>{(r.active ? null : <>{' '}<span className="pill pill-grey">বন্ধ</span></>)}</div>
          {(changed ? <><p className="small muted">যা মুছবে ({bn(c.d.removed.length + c.s.removed.length)}টি অংশ):</p>{gone([...c.s.removed, ...c.d.removed])}<details className="small"><summary>পরিষ্কারের পরে বিবরণ কেমন হবে</summary><pre className="dc-after"><Val v={c.d.text || '(বিবরণ খালি হবে — অটো SEO-র বিবরণ দেখাবে)'} /></pre></details></> : null)}
        </section>; }))}</div>
        {(slice.some((x) => x.c.d.changed || x.c.s.changed) ? <div className="form-actions"><button className="btn">🧹 টিক দেওয়াগুলো পরিষ্কার করুন</button></div> : null)}
      </form> : <p className="muted">{(f === 'todo' ? '🎉 এই দোকানের সব পণ্যের বিবরণ পরিষ্কার।' : 'কোনো পণ্য নেই।')}</p>)}
      {(pages > 1 ? <nav className="pager">{(pg > 1 ? <a className="btn btn-sm btn-ghost" href={attrValue(q({ page: String(pg - 1) }))}>← আগের</a> : null)}{' '}<span className="small">পেজ {bn(pg)} / {bn(pages)}</span>{' '}{(pg < pages ? <a className="btn btn-sm" href={attrValue(q({ page: String(pg + 1) }))}>পরের →</a> : null)}</nav> : null)}</> : null)}
    <section className="panel table-wrap" id="log"><h2>🧾 পরিষ্কারের তালিকা</h2>{(log.length ? <table className="table compact"><thead><tr><th>সময়</th><th>পণ্য</th><th className="num">মোছা অংশ</th><th></th></tr></thead><tbody>{jsxList(log.map((l) => <tr className={l.undone ? 'muted' : undefined}><td className="small nowrap">{fmtDate(l.created_at)}</td><td><a href={`/admin/products/${attrValue(l.product_id)}`}><Val v={l.name} /></a></td><td className="num">{bn(l.removed)}</td><td>{(l.undone ? <span className="small">↩️ ফেরত আনা হয়েছে</span> : <form method="post" action={attrValue(BASE)}><input type="hidden" name="action" defaultValue="undo" /><input type="hidden" name="log" defaultValue={attrValue(l.id)} /><input type="hidden" name="host" defaultValue={attrValue(host)} /><input type="hidden" name="f" defaultValue={attrValue(f)} /><button className="btn btn-sm btn-ghost">↩️ ফেরত</button></form>)}</td></tr>))}</tbody></table> : <p className="muted small">এখনো কিছু পরিষ্কার করা হয়নি।</p>)}</section>
  </>;
  return ctx.page('বিবরণ পরিষ্কার', body, 'clean-desc');
}

export const routes = [
  { method: 'GET', path: BASE, perm: 'products', handler: handle },
  { method: 'POST', path: BASE, perm: 'products', handler: handle },
];
