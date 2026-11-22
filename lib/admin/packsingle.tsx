// Admin → Products → 1️⃣ Packs → single piece (owner, 2026-11-22; lib/models/packsingle.ts).
// Every product copied in as a pack ("50Pcs- …") shown with its new name and price per piece before anything changes;
// "Change all" (or one product) makes them single pieces; "Undo" puts a change back.
import { Val, attrValue, jsxList } from '../react/html';
import { int, fmtDate, money } from '../util';
import * as ui from './ui';
import * as ps from '../models/packsingle';
import * as db from '../db';
import type { AdminCtx } from '../types';

const BASE = '/admin/products/single-piece';

async function page(ctx: AdminCtx) {
  const who = { id: ctx.user.id };
  if (ctx.method === 'POST') {
    const b = await ctx.body<'action' | 'id'>();
    try {
      if (b.action === 'undo') {
        await ps.undo(int(b.id), who);
        await ctx.log('update', 'product', null, `Packs → single piece #${int(b.id)} undone`);
        return ctx.back(`${BASE}?info=${encodeURIComponent('Undone — those products are packs again.')}`);
      }
      const n = await ps.apply(b.action === 'one' ? [int(b.id)] : null, who);
      await ctx.log('update', 'product', b.action === 'one' ? int(b.id) : null, `Packs → single piece: ${n} product(s)`);
      return ctx.back(`${BASE}?info=${encodeURIComponent(`Done — ${n} product(s) are now sold by the piece.`)}`);
    } catch (e) {
      return ctx.fail(BASE, (e as Error).message || 'Could not change.');
    }
  }
  // every product on its own (not a variant, not a set) — the owner's whole list as data, to find more like-for-like groups
  if (ctx.query.get('format') === 'all') {
    return ctx.json(200, await db.q(`SELECT p.id, p.sku, p.name, p.price, p.stock, c.name AS cat FROM products p LEFT JOIN categories c ON c.id=p.category_id
      WHERE p.parent_id IS NULL AND p.variant_count = 0 AND p.product_type = 'single' ORDER BY c.name, p.name`));
  }
  const [p, hist] = await Promise.all([ps.plan(), ps.history()]);
  if (ctx.query.get('format') === 'json') return ctx.json(200, p);
  const body = <>
    <div className="title-row"><h1>1️⃣ Packs → single piece <small>{p.items.length} products sold as packs</small></h1>
      {(p.items.length ? <form method="post" action={attrValue(BASE)} data-confirm={`Make all ${p.items.length} products single pieces? Names lose the "pcs" part, prices are divided by the pieces. You can undo it below.`}><input type="hidden" name="action" defaultValue="all" /><button className="btn">Change all</button></form> : null)}
    </div>
    {ui.flash(ctx.flash)}
    <section className="panel table-wrap"><h2>Will change <small>price per piece = pack price ÷ pieces (never below ৳0.50); stock counted in pieces</small></h2>
      {(p.items.length ? <table className="table compact"><thead><tr><th>SKU</th><th>Now</th><th>New name</th><th className="num">Pieces</th><th className="num">Price</th><th className="num">Stock</th><th></th></tr></thead><tbody>
        {jsxList(p.items.map((i) => <tr>
          <td className="mono"><a href={`/admin/products/${attrValue(i.id)}`}><Val v={i.sku} /></a></td>
          <td className="small muted"><Val v={i.name} /></td>
          <td className="small"><b><Val v={i.new_name} /></b><br /><span className="muted"><Val v={i.new_bn} /></span></td>
          <td className="num">{i.pcs}</td>
          <td className="num small">{money(i.price)} → <b>{money(i.unit_price)}</b></td>
          <td className="num small">{i.stock} → {Math.max(0, Number(i.stock) || 0) * i.pcs}</td>
          <td><form method="post" action={attrValue(BASE)}><input type="hidden" name="action" defaultValue="one" /><input type="hidden" name="id" defaultValue={attrValue(i.id)} /><button className="btn btn-sm btn-ghost">Change</button></form></td>
        </tr>))}
      </tbody></table> : <p className="muted">Every product is sold by the piece already.</p>)}
    </section>
    {(hist.length ? <section className="panel table-wrap"><h2>Changed</h2><table className="table compact"><thead><tr><th className="num">Products</th><th>When</th><th></th></tr></thead><tbody>
      {jsxList(hist.map((h) => <tr><td className="num">{h.n}</td><td className="small">{fmtDate(h.created_at)}</td>
        <td>{(h.undone_at ? <span className="small muted">Undone {fmtDate(h.undone_at)}</span> : <form method="post" action={attrValue(BASE)} data-confirm="Undo this change? These products become packs again with their old names and prices."><input type="hidden" name="action" defaultValue="undo" /><input type="hidden" name="id" defaultValue={attrValue(h.id)} /><button className="btn btn-sm btn-ghost">Undo</button></form>)}</td></tr>))}
    </tbody></table></section> : null)}
    {(p.skipped.length ? <section className="panel table-wrap"><h2>Left as they are <small>{p.skipped.length} products</small></h2><table className="table compact"><thead><tr><th>SKU</th><th>Product</th><th>Why</th></tr></thead><tbody>
      {jsxList(p.skipped.slice(0, 300).map((i) => <tr><td className="mono"><Val v={i.sku} /></td><td className="small"><a href={`/admin/products/${attrValue(i.id)}`}><Val v={i.name} /></a></td><td className="small"><Val v={i.reason} /></td></tr>))}
    </tbody></table></section> : null)}
  </>;
  return ctx.page('Packs → single piece', body, 'single-piece');
}

export const routes = [{ method: '*', path: BASE, perm: 'owner', handler: page }];
