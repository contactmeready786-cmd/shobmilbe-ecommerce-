// Admin → Products → ✍️ Own words (owner, 2026-11-28) — lib/services/ownwords.ts does the work.
// Copied products' descriptions rewritten in the shop's own words (same facts), other shops' names out of names/links.
import { Val, attrValue, jsxList } from '../react/html';
import { bn, int, fmtDate, ifKey } from '../util';
import * as db from '../db';
import * as ui from './ui';
import * as ow from '../services/ownwords';
import type { AdminCtx } from '../types';

const BASE = '/admin/products/own-words';
const TABS: Record<string, string> = { applied: '✅ Rewritten', review: '👀 For you to check', names: '🏷️ Shop names removed', undone: '↩️ Undone', error: '⚠️ Failed' };
const PER = 30;

type Row = { product_id: number; status: string; old: ow.OwnOld | null; proposal: ow.OwnProposal | null; why: string; created_at: Date; name: string; description: string; short_description: string; image_id: number | null };
type NameRow = { product_id: number; old_name: string; old_slug: string; new_name: string; new_slug: string; created_at: Date; image_id: number | null };

async function handle(ctx: AdminCtx) {
  if (ctx.method === 'POST') {
    const b = await ctx.body<'action' | 'id' | 'tab'>();
    const tab = ifKey(TABS, b.tab, 'applied');
    const id = int(b.id);
    let info = '';
    if (b.action === 'settings') { await db.setMany({ ownwords_on: b.ownwords_on ? '1' : '0', ownwords_auto: b.ownwords_auto ? '1' : '0' }); info = 'Settings saved.'; }
    else if (b.action === 'undo' && id) { info = (await ow.undo(id)) ? '↩️ The old description is back.' : 'Already undone.'; await ctx.log('product_edit', 'product', id, 'Own words — undone'); }
    else if (b.action === 'undo-name' && id) { info = (await ow.undoName(id)) ? '↩️ The old name and link are back.' : 'Already undone.'; await ctx.log('product_edit', 'product', id, 'Shop name removal — undone'); }
    else if (b.action === 'approve' && id) { info = (await ow.approve(id)) ? '✅ New description in.' : 'Not found.'; await ctx.log('product_edit', 'product', id, 'Own words — approved by owner'); }
    else if (b.action === 'skip' && id) { await ow.skip(id); info = 'Skipped — the description stays as it was.'; }
    else if (b.action === 'retry' && id) { await db.q('DELETE FROM own_words WHERE product_id=$1', [id]); info = 'It will be written again.'; }
    else if (b.action === 'run') {
      const r = await ow.tick({ ...ctx.settings, ownwords_on: '1', ownwords_per_tick: '3', ownwords_pause_until: '0', descfix_pause_until: '0', titlefix_pause_until: '0' });
      info = r.status === 'nokey' ? 'No Gemini key (Admin → AI staff).' : r.status === 'busy' ? 'Google is busy now — it will go on by itself later.' : `${bn(r.done)} rewritten, ${bn(r.names || 0)} names cleaned.`;
    }
    return ctx.redirect(`${BASE}?tab=${tab}&info=${encodeURIComponent(info)}`);
  }
  const tab = ifKey(TABS, ctx.query.get('tab'), 'applied');
  const pg = Math.max(1, int(ctx.query.get('page'), 1));
  const c = await ow.counts();
  const n = (k: string) => Number(c[k] || 0);
  const s = ctx.settings;
  const info = ctx.query.get('info');
  const hidden = (id: number, action: string) => <><input type="hidden" name="id" defaultValue={attrValue(id)} /><input type="hidden" name="action" defaultValue={attrValue(action)} /><input type="hidden" name="tab" defaultValue={attrValue(tab)} /></>;
  const pic = (id: number | null) => (id ? <img className="tfx-pic" src={`/media/${attrValue(id)}/t`} alt="" loading="lazy" /> : <span className="tfx-pic tfx-nopic">📦</span>);
  let list;
  let total = 0;
  if (tab === 'names') {
    total = n('names');
    const rows = await db.q<NameRow>(`SELECT f.product_id, f.old_name, f.old_slug, f.new_name, f.new_slug, f.created_at, p.image_id FROM shopname_fix f JOIN products p ON p.id=f.product_id
      WHERE NOT f.undone ORDER BY f.created_at DESC LIMIT $1 OFFSET $2`, [PER, (pg - 1) * PER]);
    list = rows.map((r) => <article className="panel tfx-item">{pic(r.image_id)}
      <div className="tfx-body" translate="no">
        <p className="tfx-new"><a href={`/admin/products/${attrValue(r.product_id)}`} target="_blank" rel="noopener"><b><Val v={r.new_name} /></b></a></p>
        <p className="small muted">was: <Val v={r.old_name} /></p>
        {(r.old_slug !== r.new_slug ? <p className="small muted">link: /p/<Val v={r.old_slug} /> → /p/<Val v={r.new_slug} /> (old link still works)</p> : null)}
      </div>
      <div className="tfx-act"><form method="post" action={attrValue(BASE)}>{hidden(r.product_id, 'undo-name')}<button className="btn btn-sm btn-ghost">↩️ Undo</button></form><span className="small muted">{fmtDate(r.created_at)}</span></div>
    </article>);
  } else {
    total = n(tab);
    const rows = await db.q<Row>(`SELECT w.product_id, w.status, w.old, w.proposal, w.why, w.created_at, p.name, coalesce(p.description, '') AS description,
      coalesce(p.short_description, '') AS short_description, p.image_id FROM own_words w JOIN products p ON p.id=w.product_id WHERE w.status=$1 ORDER BY w.created_at DESC LIMIT $2 OFFSET $3`,
    [tab, PER, (pg - 1) * PER]);
    list = rows.map((r) => {
      const before = r.status === 'applied' ? r.old?.description || '' : r.description;
      const after = r.status === 'applied' ? r.description : r.proposal?.description || '';
      return <article className="panel tfx-item">{pic(r.image_id)}
        <div className="tfx-body" translate="no">
          <p className="tfx-new"><a href={`/admin/products/${attrValue(r.product_id)}`} target="_blank" rel="noopener"><b><Val v={r.name} /></b></a></p>
          {(r.why ? <p className="small tfx-why">⚠️ <Val v={r.why} /></p> : null)}
          {(after ? <details className="small"><summary>New description</summary><pre className="tfx-pre"><Val v={after} /></pre></details> : null)}
          {(before ? <details className="small muted"><summary>Old description</summary><pre className="tfx-pre"><Val v={before.slice(0, 3000)} /></pre></details> : null)}
        </div>
        <div className="tfx-act">
          {(r.status === 'applied' ? <form method="post" action={attrValue(BASE)}>{hidden(r.product_id, 'undo')}<button className="btn btn-sm btn-ghost">↩️ Undo</button></form> : null)}
          {(r.status === 'review' && r.proposal?.description ? <form method="post" action={attrValue(BASE)}>{hidden(r.product_id, 'approve')}<button className="btn btn-sm">✅ Use it</button></form> : null)}
          {(r.status === 'review' ? <form method="post" action={attrValue(BASE)}>{hidden(r.product_id, 'skip')}<button className="btn btn-sm btn-ghost">❌ Skip</button></form> : null)}
          {(r.status === 'error' || r.status === 'undone' || r.status === 'review' ? <form method="post" action={attrValue(BASE)}>{hidden(r.product_id, 'retry')}<button className="btn btn-sm btn-ghost">🔄 Write again</button></form> : null)}
          <span className="small muted">{fmtDate(r.created_at)}</span>
        </div>
      </article>;
    });
  }
  const pages = Math.max(1, Math.ceil(total / PER));
  const body = <><div className="title-row"><h1>✍️ Own words</h1><span className="small muted">{bn(n('left'))} copied products still to rewrite</span></div>
    {ui.flash(ctx.flash)}{(info ? <p className="flash"><Val v={info} /></p> : null)}
    <form method="post" action={attrValue(BASE)} className="panel tfx-set"><input type="hidden" name="action" defaultValue="settings" /><input type="hidden" name="tab" defaultValue={attrValue(tab)} />{ui.switchRow('ownwords_on', s.ownwords_on !== '0', 'Runs by itself', 'After the name fix and description check, within Gemini’s free limit')}{ui.switchRow('ownwords_auto', s.ownwords_auto !== '0', 'Safe ones go in by themselves', 'Off: every rewrite waits for your ✅')}<button className="btn btn-sm">Save</button></form>
    <form method="post" action={attrValue(BASE)} className="inline"><input type="hidden" name="action" defaultValue="run" /><input type="hidden" name="tab" defaultValue={attrValue(tab)} /><button className="btn btn-sm btn-ghost">▶️ Rewrite 3 now</button></form>
    <nav className="chips">{jsxList(Object.entries(TABS).map(([k, v]) => <a className={`chip ${k === tab ? 'on' : ''}`} href={`${BASE}?tab=${k}`}><Val v={v} /> <b>{bn(n(k))}</b></a>))}</nav>
    {(list.length ? <div className="tfx-list">{jsxList(list)}</div> : <p className="muted">Nothing here yet.</p>)}
    {(pages > 1 ? <nav className="pager">{(pg > 1 ? <a className="btn btn-sm btn-ghost" href={`${BASE}?tab=${tab}&page=${pg - 1}`}>← Previous</a> : null)}{' '}<span className="small">Page {bn(pg)} / {bn(pages)}</span>{' '}{(pg < pages ? <a className="btn btn-sm" href={`${BASE}?tab=${tab}&page=${pg + 1}`}>Next →</a> : null)}</nav> : null)}
  </>;
  return ctx.page('Own words', body, 'own-words');
}

export const routes = [
  { method: 'GET', path: BASE, perm: 'products', handler: handle },
  { method: 'POST', path: BASE, perm: 'products', handler: handle },
];
