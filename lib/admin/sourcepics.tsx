// Admin → পণ্য → ওয়াটারমার্ক ও ডুপ্লিকেট → 🚩 অন্য দোকানের ছবি (owner, 2026-10-14).
// Products copied from another shop (TechShop BD …) often still carry that shop's watermark on their pictures.
// Here every product copied from one shop is shown with ALL its pictures; the owner taps "🚩 ওয়াটারমার্ক আছে" or
// "✅ পরিষ্কার" on each (saved at once, no page reload), then downloads an Excel list of the flagged SKUs to fix them.
// Which shop a product came from is known from its import reference ("techshopbd.com#…", set by পণ্য আমদানি).
import { Val, attrValue, jsxList } from '../react/html';
import { bn, fmtDate, int, str, ifKey, ymd } from '../util';
import * as db from '../db';
import * as ui from './ui';
import * as $services_xlsx from '../services/xlsx';
import type { AdminCtx } from '../types';
import type { ProductsRow } from '../data/rows';

const BASE = '/admin/products/source-pics';
const PER_PAGE = 40;
const HOST = "split_part(p.import_ref, '#', 1)";
// '*' = every product in the shop (owner, 2026-10-14): many pictures with another shop's mark belong to products that
// were added by hand or from a file, so they have no import reference and never showed up under a shop's name.
const ALL = '*';
const ALL_LABEL = 'দোকানের সব পণ্য (হাতে/ফাইলে যোগ করাসহ)';
const hostCond = (host: string) => (host === ALL ? 'TRUE' : `${HOST}=$1`);
const hostArgs = (host: string) => (host === ALL ? [] : [host]);
const FILTERS: Record<string, string> = { todo: 'এখনো দেখা হয়নি', flag: '🚩 ওয়াটারমার্ক আছে', clean: '✅ পরিষ্কার', all: 'সব' };

async function hosts() {
  const [shops, all] = await Promise.all([db.q<{ host: string; n: number; flagged: number; checked: number; live: number; first_at: Date | null; last_at: Date | null }>(`SELECT ${HOST} AS host, count(*)::int AS n, count(*) FILTER (WHERE p.src_wm)::int AS flagged,
      count(*) FILTER (WHERE p.src_wm_checked)::int AS checked, count(*) FILTER (WHERE p.active)::int AS live, min(p.created_at) AS first_at, max(p.created_at) AS last_at
    FROM products p WHERE p.import_ref <> '' AND p.parent_id IS NULL AND ${HOST} NOT IN ('', 'file')
    GROUP BY 1 ORDER BY count(*) DESC`),
  db.one<{ n: number; flagged: number; checked: number; first_at: Date | null; last_at: Date | null }>(`SELECT count(*)::int AS n, count(*) FILTER (WHERE p.src_wm)::int AS flagged, count(*) FILTER (WHERE p.src_wm_checked)::int AS checked,
      min(p.created_at) AS first_at, max(p.created_at) AS last_at FROM products p WHERE p.parent_id IS NULL`)]);
  return all && all.n ? [...shops, { host: ALL, ...all }] : shops;
}
const hostLabel = (h: string) => (h === ALL ? ALL_LABEL : h);
function pickHost(list: { host: string }[], wanted?: unknown) {
  const hit = list.find((h) => h.host === wanted);
  if (wanted && hit) return hit.host;
  const ts = list.find((h) => /techshop/i.test(h.host));
  return ts ? ts.host : list[0] ? list[0].host : '';
}
function where(f: string) {
  return f === 'flag' ? 'AND p.src_wm' : f === 'clean' ? 'AND p.src_wm_checked AND NOT p.src_wm' : f === 'todo' ? 'AND NOT p.src_wm_checked' : '';
}
const srcLink = (h: string, ref?: unknown) => {
  if (h !== ALL) return shopLink(h, ref);
  const shop = String(ref || '').split('#')[0];
  return shop && shop !== 'file' ? shopLink(shop, ref) : 'নিজে / ফাইল থেকে যোগ করা';
};
const shopLink = (h: string, ref?: unknown) => {
  const key = String(ref || '').split('#').slice(1).join('#');
  return key.startsWith('/') ? `https://${h}${key}` : `https://${h}`;
};

async function excel(ctx: AdminCtx, host: string, f: string) {
  const rows = await db.q<Pick<ProductsRow, 'id' | 'sku' | 'name' | 'slug' | 'active' | 'created_at' | 'import_ref' | 'src_wm' | 'src_wm_checked'> & { pics: number }>(`SELECT p.id, p.sku, p.name, p.slug, p.active, p.created_at, p.import_ref, p.src_wm, p.src_wm_checked,
      (SELECT count(*) FROM media m WHERE m.owner_type='product' AND m.owner_id=p.id)::int AS pics
    FROM products p WHERE p.parent_id IS NULL AND ${hostCond(host)} ${where(f)}
    ORDER BY CASE WHEN p.sku ~ '^[0-9]+$' THEN lpad(p.sku, 12, '0') ELSE p.sku END, p.id`, hostArgs(host));
  const base = String(ctx.settings.site_url || 'https://shobmilbe.com').replace(/\/+$/, '');
  const out: unknown[][] = [['SKU', 'পণ্যের নাম', 'ওয়াটারমার্ক', 'ছবি কয়টা', 'দোকানে', 'কবে কপি হয়েছে', 'অ্যাডমিনে এডিট', 'দোকানের পেজ', 'যে দোকান থেকে কপি']];
  for (const r of rows) {
    out.push([r.sku || '', r.name, r.src_wm ? 'আছে' : r.src_wm_checked ? 'নেই' : 'দেখা হয়নি', r.pics, r.active ? 'চালু' : 'বন্ধ',
      fmtDate(r.created_at), `${base}/admin/products/${r.id}`, `${base}/p/${r.slug}`, srcLink(host, r.import_ref)]);
  }
  const day = ymd();
  const name = `${f === 'flag' ? 'watermark' : 'products'}-${host === ALL ? 'all' : host.replace(/[^a-z0-9.-]/gi, '')}-${day}.xlsx`;
  return $services_xlsx.send(ctx.reply, name, [{ name: f === 'flag' ? 'Watermark' : 'Products', rows: out }]);
}

async function handle(ctx: AdminCtx) {
  const list = await hosts();
  if (ctx.method === 'POST') {
    const b = await ctx.body<'host'>();
    const id = int(b.id);
    if (!ctx.can('products')) return ctx.json(403, { error: 'অনুমতি নেই' });
    if (b.action === 'mark' && id) {
      const flag = b.flag === '1';
      await db.q('UPDATE products SET src_wm=$2, src_wm_checked=true WHERE id=$1', [id, flag]);
      if (String(ctx.req.headers.accept || '').includes('application/json')) return ctx.json(200, { ok: true, flag });
      return ctx.back(`${BASE}?host=${encodeURIComponent(str(b.host, 120))}&f=${encodeURIComponent(str(b.f, 10))}#p${id}`);
    }
    if (b.action === 'reset' && list.some((h) => h.host === b.host)) {
      await db.q(`UPDATE products p SET src_wm=false, src_wm_checked=false WHERE p.parent_id IS NULL AND ${hostCond(b.host ?? '')}`, hostArgs(b.host ?? ''));
      await ctx.log('product_bulk', 'product', null, `অন্য দোকানের ছবি: ${b.host} — সব চিহ্ন মুছে নতুন করে শুরু`);
      return ctx.back(`${BASE}?host=${encodeURIComponent(b.host ?? '')}`, 'saved');
    }
    // 🔒 every product copied from this shop off (or on) the shop at once (owner, 2026-10-23: 550 products from
    // another shop to be worked on before they go live). Only for one named shop — never "all products".
    if ((b.action === 'shop_off' || b.action === 'shop_on') && b.host && b.host !== ALL && list.some((h) => h.host === b.host)) {
      const on = b.action === 'shop_on';
      const r = await db.q(`UPDATE products p SET active=$2, updated_at=now() WHERE ${HOST}=$1 AND p.parent_id IS NULL AND p.active <> $2 RETURNING p.id`, [b.host, on]);
      await ctx.log('product_bulk', 'product', null, `${b.host} থেকে আনা ${r.length}টি পণ্য: ${on ? 'দোকানে চালু' : 'দোকান থেকে বন্ধ'}`);
      return ctx.redirect(`${BASE}?host=${encodeURIComponent(b.host)}&info=${encodeURIComponent(`${r.length}টি পণ্য ${on ? 'দোকানে চালু' : 'দোকান থেকে বন্ধ'} করা হয়েছে।`)}`);
    }
    return ctx.back(BASE);
  }
  const host = pickHost(list, ctx.query.get('host'));
  const f = ifKey(FILTERS, ctx.query.get('f'), 'todo');
  if (host && ctx.query.get('excel')) return excel(ctx, host, ctx.query.get('excel') === 'all' ? 'all' : 'flag');
  const cur = list.find((h) => h.host === host);
  const page = Math.max(1, int(ctx.query.get('page'), 1));
  const [rows, count] = host ? await Promise.all([
    db.q<Pick<ProductsRow, 'id' | 'sku' | 'name' | 'slug' | 'active' | 'image_id' | 'created_at' | 'import_ref' | 'src_wm' | 'src_wm_checked'> & { pics: number[] }>(`SELECT p.id, p.sku, p.name, p.slug, p.active, p.image_id, p.created_at, p.import_ref, p.src_wm, p.src_wm_checked,
        coalesce((SELECT array_agg(m.id ORDER BY (m.id = p.image_id) DESC, m.sort, m.id) FROM media m WHERE m.owner_type='product' AND m.owner_id=p.id), '{}') AS pics
      FROM products p WHERE p.parent_id IS NULL AND ${hostCond(host)} ${where(f)}
      ORDER BY CASE WHEN p.sku ~ '^[0-9]+$' THEN lpad(p.sku, 12, '0') ELSE p.sku END, p.id
      LIMIT ${PER_PAGE} OFFSET ${(page - 1) * PER_PAGE}`, hostArgs(host)),
    db.one<{ n: number }>(`SELECT count(*)::int AS n FROM products p WHERE p.parent_id IS NULL AND ${hostCond(host)} ${where(f)}`, hostArgs(host)).then((r) => r!.n),
  ]) : [[], 0];
  const pages = Math.max(1, Math.ceil(count / PER_PAGE));
  const q = (o: Record<string, string>) => `${BASE}?${new URLSearchParams({ host, f, ...o })}`;
  const body = <><div className="title-row"><h1>🚩 অন্য দোকানের ছবি</h1>{(host ? <div className="row-actions"><a className="btn btn-sm" href={attrValue(q({ excel: 'flag' }))}>📥 ওয়াটারমার্কের SKU (Excel)</a>{' '}<a className="btn btn-sm btn-ghost" href={attrValue(q({ excel: 'all' }))}>📥 এই দোকানের সব পণ্য (Excel)</a>{(host !== ALL && cur ? <><form method="post" action={attrValue(BASE)} data-confirm={`${host} থেকে আনা সব পণ্য দোকান থেকে বন্ধ করবেন? কাস্টমার আর দেখবে না, অ্যাডমিনে সব থাকবে।`}><input type="hidden" name="action" defaultValue="shop_off" /><input type="hidden" name="host" defaultValue={attrValue(host)} /><button className="btn btn-sm btn-danger">🔒 এই দোকানের সব পণ্য বন্ধ ({bn((cur as { live?: number }).live ?? 0)}টি চালু)</button></form><form method="post" action={attrValue(BASE)} data-confirm={`${host} থেকে আনা সব পণ্য দোকানে চালু করবেন?`}><input type="hidden" name="action" defaultValue="shop_on" /><input type="hidden" name="host" defaultValue={attrValue(host)} /><button className="btn btn-sm btn-ghost">🔓 সব চালু</button></form></> : null)}</div> : null)}</div>{ui.flash(ctx.flash)}{' '}{(!list.length ? <p className="muted">কোনো দোকান থেকে কপি করা পণ্য পাওয়া যায়নি (পণ্য আমদানি দিয়ে আনা পণ্যই এখানে আসে)।</p> : <>{' '}{ui.helpBox('কীভাবে করবেন', <ol className="steps"><li>উপরে দোকান বাছুন (TechShop BD নিজে থেকে বাছা থাকে)। হাতে বা ফাইল দিয়ে যোগ করা পণ্যও দেখতে চাইলে তালিকার শেষে{' '}<b>"<Val v={ALL_LABEL} />"</b>{' '}বাছুন। এই দোকান থেকে কপি করা প্রতিটা পণ্যের{' '}<b>সব ছবি</b>{' '}নিচে দেখাবে — ছবিতে চাপ দিলে বড় হয়ে খোলে।</li><li>অন্য দোকানের নাম/লোগো ছবিতে থাকলে{' '}<b>"🚩 ওয়াটারমার্ক আছে"</b>, না থাকলে{' '}<b>"✅ পরিষ্কার"</b>{' '}চাপুন — সাথে সাথে সেভ হয়, পেজ রিলোড হয় না। দেখা পণ্য "এখনো দেখা হয়নি" তালিকা থেকে সরে যায়।</li><li>শেষে{' '}<b>"📥 ওয়াটারমার্কের SKU (Excel)"</b>{' '}— SKU, নাম, এডিটের লিংকসহ ফাইল। SKU দিয়ে খুঁজে ছবি বদলে নিন।</li></ol>)}<form method="get" action={attrValue(BASE)} className="toolbar">{ui.select('host', list.map((h) => [h.host, `${hostLabel(h.host)} — ${bn(h.n)}টি পণ্য`]), host)}{' '}<input type="hidden" name="f" defaultValue={attrValue(f)} /><button className="btn btn-sm btn-ghost">দেখুন</button></form>{(cur ? <div className="kpis kpis-tight">{ui.kpi(host === ALL ? 'দোকানের সব পণ্য' : 'এই দোকান থেকে কপি', bn(cur.n), `${fmtDate(cur.first_at, false)} — ${fmtDate(cur.last_at, false)}`)}{' '}{ui.kpi('দেখা হয়েছে', `${bn(cur.checked)} / ${bn(cur.n)}`, `${bn(cur.n ? Math.round((cur.checked * 100) / cur.n) : 0)}%`, 'kpi-blue')}{' '}{ui.kpi('🚩 ওয়াটারমার্ক আছে', bn(cur.flagged), 'Excel-এ এগুলোর SKU যাবে', cur.flagged ? 'kpi-red' : '')}</div> : null)}<nav className="toolbar">{jsxList(Object.entries(FILTERS).map(([k, v]) => <>{' '}<a className={`chip ${k === f ? 'on' : ''}`} href={`${attrValue(BASE)}?${attrValue(new URLSearchParams({ host, f: k }))}`}><Val v={v} /></a></>))}</nav>{(rows.length ? <><div className="srcpic-list">{jsxList(rows.map((p) => <section className={`panel srcpic ${p.src_wm ? 'is-flag' : p.src_wm_checked ? 'is-clean' : ''}`} id={`p${attrValue(p.id)}`}><div className="srcpic-head"><b className="srcpic-sku">SKU{' '}<Val v={p.sku || '—'} /></b>{' '}<a href={`/admin/products/${attrValue(p.id)}`} target="_blank" rel="noopener"><Val v={p.name} /></a>{' '}{(p.active ? null : <>{' '}<span className="pill pill-grey">বন্ধ</span></>)}{' '}<span className="small muted">· কপি{' '}{fmtDate(p.created_at, false)}{' '}·{' '}{bn(p.pics.length)}টি ছবি</span></div><div className="srcpic-pics">{(p.pics.length ? jsxList(p.pics.map((m) => <a href={`/media/${attrValue(m)}`} target="_blank" rel="noopener"><img src={`/media/${attrValue(m)}/t`} alt="" loading="lazy" /></a>)) : <span className="muted small">ছবি নেই</span>)}</div><form method="post" action={attrValue(BASE)} className="row-actions" data-srcpic=""><input type="hidden" name="action" defaultValue="mark" /><input type="hidden" name="id" defaultValue={attrValue(p.id)} /><input type="hidden" name="host" defaultValue={attrValue(host)} /><input type="hidden" name="f" defaultValue={attrValue(f)} />{' '}<button className="btn btn-sm btn-danger" name="flag" value="1">🚩 ওয়াটারমার্ক আছে</button>{' '}<button className="btn btn-sm btn-ghost" name="flag" value="0">✅ পরিষ্কার</button>{' '}<span className="small" data-srcpic-state="">{(p.src_wm ? "🚩 চিহ্নিত" : (p.src_wm_checked ? "✅ পরিষ্কার" : null))}</span></form></section>))}</div>{(pages > 1 ? <nav className="pager">{(page > 1 ? <a className="btn btn-sm btn-ghost" href={attrValue(q({ page: String(page - 1) }))}>← আগের</a> : null)}{' '}<span className="small">পেজ{' '}{bn(page)}{' '}/{' '}{bn(pages)}{' '}· মোট{' '}{bn(count)}টি</span>{' '}{(page < pages ? <a className="btn btn-sm" href={attrValue(q({ page: String(page + 1) }))}>পরের →</a> : null)}</nav> : null)}</> : <p className="muted">{(f === 'todo' ? "🎉 এই দোকানের সব পণ্য দেখা হয়ে গেছে।" : "এই তালিকায় কোনো পণ্য নেই।")}</p>)}{' '}{(host ? <form method="post" action={attrValue(BASE)} data-confirm="এই দোকানের সব পণ্যের চিহ্ন মুছে নতুন করে শুরু করবেন?" className="mt"><input type="hidden" name="action" defaultValue="reset" /><input type="hidden" name="host" defaultValue={attrValue(host)} /><button className="btn btn-sm btn-ghost">↺ চিহ্ন মুছে নতুন করে শুরু</button></form> : null)}</>)}</>;
  return ctx.page('অন্য দোকানের ছবি', body, 'source-pics');
}

export const routes = [{ method: '*', path: BASE, perm: 'products', handler: handle }];
