// Admin → Products → 🧩 Merge into variants (owner, 2026-11-22; lib/models/vmerge.ts).
// The same part copied in as separate products, one per value (resistors: one product per ohm) → one product with a
// value picker, prices per piece. The page shows exactly what would happen for each group (kind + power) before
// anything changes; "Merge" does one group, "Merge all" every group; "Undo" puts a merge back as it was.
import { Val, attrValue, jsxList } from '../react/html';
import { int, str, fmtDate, money } from '../util';
import * as ui from './ui';
import * as vm from '../models/vmerge';
import type { AdminCtx } from '../types';

const BASE = '/admin/products/merge-variants';

async function page(ctx: AdminCtx) {
  const who = { id: ctx.user.id, name: ctx.user.name, ip: ctx.ip };
  if (ctx.method === 'POST') {
    const b = await ctx.body<'action' | 'key' | 'id'>();
    try {
      if (b.action === 'undo') {
        await vm.undo(int(b.id), who);
        await ctx.log('update', 'product', null, `Variant merge #${int(b.id)} undone`);
        return ctx.back(`${BASE}?info=${encodeURIComponent('Undone — the products are separate again, with their old prices.')}`);
      }
      const keys = b.action === 'merge_all' ? (await vm.plan()).groups.map((g) => g.key) : [str(b.key, 120)];
      const done: string[] = [];
      for (const key of keys) {
        const id = await vm.merge(key, who);
        done.push(String(id));
        await ctx.log('update', 'product', id, `Merged into variants: ${key}`);
      }
      return ctx.back(`${BASE}?info=${encodeURIComponent(`Done — ${done.length} product(s) made with variants. Check them on the shop.`)}`);
    } catch (e) {
      return ctx.fail(BASE, (e as Error).message || 'Could not merge.');
    }
  }
  const [p, hist] = await Promise.all([vm.plan(), vm.history()]);
  // the whole plan as data (owner only, like the page): every product, its old pack price and stock, what it becomes
  if (ctx.query.get('format') === 'json') {
    const row = (i: vm.PlanItem) => ({ id: i.id, sku: i.sku, name: i.name, price: Number(i.price), stock: i.stock, active: i.active, pcs: i.p.pcs, label: i.label, unit_price: i.unit_price, unit_old: i.unit_old, dup_of: i.dup_of ?? null });
    return ctx.json(200, { groups: p.groups.map((g) => ({ key: g.key, en: g.en, bn: g.bn, items: g.items.map(row), dups: g.dups.map(row) })), singles: p.singles.map(row), skipped: p.skipped });
  }
  const values = p.groups.reduce((n, g) => n + g.items.length, 0);
  const body = <>
    <div className="title-row"><h1>🧩 Merge into variants <small>{p.groups.length} groups · {values} products → {p.groups.length} products</small></h1>
      {(p.groups.length > 1 ? <form method="post" action={attrValue(BASE)} data-confirm={`Merge all ${p.groups.length} groups? Each becomes one product with its values; prices become per piece. You can undo each one below.`}><input type="hidden" name="action" defaultValue="merge_all" /><button className="btn">Merge all</button></form> : null)}
    </div>
    {ui.flash(ctx.flash)}
    <section className="panel table-wrap"><h2>Ready to merge <small>same kind + same power = one product; price per piece = pack price ÷ pieces</small></h2>
      {(p.groups.length ? <table className="table compact"><thead><tr><th>New product</th><th className="num">Values</th><th>Price / piece</th><th>Values (price per piece · old SKU)</th><th className="num">Duplicates</th><th></th></tr></thead><tbody>
        {jsxList(p.groups.map((g) => <tr>
          <td><b><Val v={g.en} /></b><br /><span className="small muted"><Val v={g.bn} /></span></td>
          <td className="num">{g.items.length}</td>
          <td className="small">{money(g.min)}{g.max > g.min ? <> – {money(g.max)}</> : null}</td>
          <td className="small">{jsxList(g.items.map((i, n) => <>{n ? ' · ' : ''}<span title={attrValue(i.name)}><b><Val v={i.label} /></b> {money(i.unit_price)} <span className="muted">#{i.sku}{i.p.pcs > 1 ? ` (${i.p.pcs} pcs)` : ''}{i.active ? '' : ' off'}</span></span></>))}</td>
          <td className="num small">{(g.dups.length ? <span title={attrValue(g.dups.map((d) => `${d.label} #${d.sku}`).join(', '))}>{g.dups.length} → recycle bin</span> : '—')}</td>
          <td><form method="post" action={attrValue(BASE)}><input type="hidden" name="action" defaultValue="merge" /><input type="hidden" name="key" defaultValue={attrValue(g.key)} /><button className="btn btn-sm">Merge</button></form></td>
        </tr>))}
      </tbody></table> : <p className="muted">Nothing to merge — no two products of the same kind and power were found.</p>)}
    </section>
    {(hist.length ? <section className="panel table-wrap"><h2>Merged</h2><table className="table compact"><thead><tr><th>Product</th><th className="num">Values</th><th className="num">Duplicates binned</th><th>When</th><th></th></tr></thead><tbody>
      {jsxList(hist.map((h) => <tr>
        <td>{(h.slug && !h.undone_at ? <a href={`/p/${attrValue(h.slug)}`} target="_blank" rel="noopener"><Val v={h.name} /> ↗</a> : <Val v={h.name} />)}</td>
        <td className="num">{h.n}</td><td className="num">{h.dups}</td><td className="small">{fmtDate(h.created_at)}</td>
        <td>{(h.undone_at ? <span className="small muted">Undone {fmtDate(h.undone_at)}</span> : <form method="post" action={attrValue(BASE)} data-confirm="Undo this merge? The values become separate products again with their old pack prices."><input type="hidden" name="action" defaultValue="undo" /><input type="hidden" name="id" defaultValue={attrValue(h.id)} /><button className="btn btn-sm btn-ghost">Undo</button></form>)}</td>
      </tr>))}
    </tbody></table></section> : null)}
    {(p.skipped.length || p.singles.length ? <section className="panel table-wrap"><h2>Left as they are <small>{p.skipped.length + p.singles.length} products</small></h2><table className="table compact"><thead><tr><th>SKU</th><th>Product</th><th>Why</th></tr></thead><tbody>
      {jsxList(p.singles.slice(0, 100).map((i) => <tr><td className="mono"><Val v={i.sku} /></td><td className="small"><a href={`/admin/products/${attrValue(i.id)}`}><Val v={i.name} /></a></td><td className="small">only value of its kind and power</td></tr>))}
      {jsxList(p.skipped.slice(0, 200).map((i) => <tr><td className="mono"><Val v={i.sku} /></td><td className="small"><a href={`/admin/products/${attrValue(i.id)}`}><Val v={i.name} /></a></td><td className="small"><Val v={i.reason} /></td></tr>))}
    </tbody></table></section> : null)}
  </>;
  return ctx.page('Merge into variants', body, 'merge-variants');
}

export const routes = [{ method: '*', path: BASE, perm: 'owner', handler: page }];
