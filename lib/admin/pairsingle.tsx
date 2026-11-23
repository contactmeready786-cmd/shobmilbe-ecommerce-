// Admin → Products → 👟 Pairs → one pair (owner, 2026-11-23; lib/models/packsingle.ts, kind 'pair').
// Every product sold as 2, 3 … pairs in one listing, shown with its picture, new name and price per pair before anything
// changes; "Change all" (or one product) makes them one pair; "Undo" puts a change back. Products already changed are
// listed by SKU (copy button) — their pictures may still say "2 Pairs", the owner swaps those pictures.
import { Val, attrValue, jsxList } from '../react/html';
import { int, fmtDate, money } from '../util';
import * as ui from './ui';
import * as ps from '../models/packsingle';
import type { AdminCtx } from '../types';

const BASE = '/admin/products/one-pair';

const thumb = (id: number | null) => <td className="thumb">{(id ? <img src={`/media/${attrValue(id)}/t`} alt="" loading="lazy" /> : <span>👟</span>)}</td>;

async function page(ctx: AdminCtx) {
  const who = { id: ctx.user.id };
  if (ctx.method === 'POST') {
    const b = await ctx.body<'action' | 'id'>();
    try {
      if (b.action === 'undo') {
        await ps.undo(int(b.id), who);
        await ctx.log('update', 'product', null, `Pairs → one pair #${int(b.id)} undone`);
        return ctx.back(`${BASE}?info=${encodeURIComponent('Undone — those products are back to their old pairs and prices.')}`);
      }
      const n = await ps.apply(b.action === 'one' ? [int(b.id)] : null, who, 'pair');
      await ctx.log('update', 'product', b.action === 'one' ? int(b.id) : null, `Pairs → one pair: ${n} product(s)`);
      return ctx.back(`${BASE}?info=${encodeURIComponent(`Done — ${n} product(s) are now sold as one pair.`)}`);
    } catch (e) {
      return ctx.fail(BASE, (e as Error).message || 'Could not change.');
    }
  }
  const [p, hist, done] = await Promise.all([ps.plan('pair'), ps.history('pair'), ps.pairChanged()]);
  if (ctx.query.get('format') === 'json') return ctx.json(200, { ...p, changed: done });
  const skus = done.map((d) => d.sku).join(', ');
  const body = <>
    <div className="title-row"><h1>👟 Pairs → one pair <small>{p.items.length} products sold as 2+ pairs</small></h1>
      {(p.items.length ? <form method="post" action={attrValue(BASE)} data-confirm={`Make all ${p.items.length} products one pair? Names say "(1 Pair)", prices are divided by the pairs, stock counted in pairs. You can undo it below.`}><input type="hidden" name="action" defaultValue="all" /><button className="btn">Change all</button></form> : null)}
    </div>
    {ui.flash(ctx.flash)}
    <section className="panel table-wrap"><h2>Will change <small>price per pair = price ÷ pairs (never below ৳0.50); stock counted in pairs</small></h2>
      {(p.items.length ? <table className="table compact"><thead><tr><th></th><th>SKU</th><th>Now</th><th>New name</th><th className="num">Pairs</th><th className="num">Price</th><th className="num">Stock</th><th></th></tr></thead><tbody>
        {jsxList(p.items.map((i) => <tr>
          {thumb(i.image_id)}
          <td className="mono"><a href={`/admin/products/${attrValue(i.id)}`}><Val v={i.sku} /></a></td>
          <td className="small muted"><Val v={i.name} /></td>
          <td className="small"><b><Val v={i.new_name} /></b><br /><span className="muted"><Val v={i.new_bn} /></span></td>
          <td className="num">{i.pcs}</td>
          <td className="num small">{money(i.price)} → <b>{money(i.unit_price)}</b></td>
          <td className="num small">{i.stock} → {Math.max(0, Number(i.stock) || 0) * i.pcs}</td>
          <td><form method="post" action={attrValue(BASE)}><input type="hidden" name="action" defaultValue="one" /><input type="hidden" name="id" defaultValue={attrValue(i.id)} /><button className="btn btn-sm btn-ghost">Change</button></form></td>
        </tr>))}
      </tbody></table> : <p className="muted">No product is sold as more than one pair.</p>)}
    </section>
    {(done.length ? <section className="panel"><h2>Pictures to change <small>{done.length} products made one pair — their pictures may still say "2 Pairs"</small></h2>
      <textarea id="pair-skus" className="gp-text" readOnly rows={3} defaultValue={skus} aria-label="SKUs" />
      <p className="row-actions"><button type="button" className="btn btn-sm" data-copy-from="pair-skus">📋 Copy SKUs</button><a className="btn btn-sm" href="/admin/products/whiten?host=pairs">⬜ Fix these pictures (white background)</a></p>
      <table className="table compact"><tbody>{jsxList(done.map((d) => <tr>{thumb(d.image_id)}<td className="mono"><a href={`/admin/products/${attrValue(d.id)}`}><Val v={d.sku} /></a></td><td className="small"><Val v={d.name} /></td></tr>))}</tbody></table>
    </section> : null)}
    {(hist.length ? <section className="panel table-wrap"><h2>Changed</h2><table className="table compact"><thead><tr><th className="num">Products</th><th>When</th><th></th></tr></thead><tbody>
      {jsxList(hist.map((h) => <tr><td className="num">{h.n}</td><td className="small">{fmtDate(h.created_at)}</td>
        <td>{(h.undone_at ? <span className="small muted">Undone {fmtDate(h.undone_at)}</span> : <form method="post" action={attrValue(BASE)} data-confirm="Undo this change? These products go back to their old pairs, names and prices."><input type="hidden" name="action" defaultValue="undo" /><input type="hidden" name="id" defaultValue={attrValue(h.id)} /><button className="btn btn-sm btn-ghost">Undo</button></form>)}</td></tr>))}
    </tbody></table></section> : null)}
    {(p.skipped.length ? <section className="panel table-wrap"><h2>Left as they are <small>{p.skipped.length} products</small></h2><table className="table compact"><thead><tr><th>SKU</th><th>Product</th><th>Why</th></tr></thead><tbody>
      {jsxList(p.skipped.slice(0, 300).map((i) => <tr><td className="mono"><Val v={i.sku} /></td><td className="small"><a href={`/admin/products/${attrValue(i.id)}`}><Val v={i.name} /></a></td><td className="small"><Val v={i.reason} /></td></tr>))}
    </tbody></table></section> : null)}
  </>;
  return ctx.page('Pairs → one pair', body, 'one-pair');
}

export const routes = [{ method: '*', path: BASE, perm: 'owner', handler: page }];
