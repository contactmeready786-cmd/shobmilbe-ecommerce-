// Admin → Marketing → Social auto post → 📣 Group posts and 🏷️ Marketplace helper (owner, 2026-11-21: "visitors
// stopped coming; groups block my links; Facebook can't post on Marketplace for me — make it as easy as possible").
// The posts and listings are made by lib/services/groupposts.ts; here the owner copies them, downloads the pictures
// and ticks what was posted. The post texts sit in read-only text boxes, so they stay Bangla in the English admin
// (lib/next/admin-en.ts never changes a <textarea>) and the Copy button takes them whole.
import { Val, attrValue } from '../react/html';
import { int, fmtDate } from '../util';
import * as ui from './ui';
import * as G from '../services/groupposts';
import type { AdminCtx } from '../types';

const GROUPS = '/admin/marketing/group-posts';
const MARKET = '/admin/marketing/marketplace';

const KIND_LABEL: Record<string, string> = { tip: 'Tip', kit: 'Project idea', question: 'Question' };
const DAY = ['Fri', 'Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu'];

async function groupsHandle(ctx: AdminCtx) {
  if (ctx.method !== 'POST') return groupsPage(ctx);
  const b = await ctx.body();
  if (b.action === 'posted' || b.action === 'unposted') {
    await G.markPosted(int(b.id), b.action === 'posted');
    return ctx.back(`${GROUPS}#post-${int(b.id)}`);
  }
  if (b.action === 'fresh') {
    await G.week({ fresh: true });
    await ctx.log('update', 'marketing', null, 'Group posts: new posts made for the ones not posted yet');
    return ctx.back(GROUPS, 'saved');
  }
  return ctx.back(GROUPS);
}

async function groupsPage(ctx: AdminCtx) {
  const posts = await G.week();
  const done = posts.filter((p) => p.posted_at).length;
  const body = <>
    <div className="title-row"><h1>📣 Group posts</h1><div className="row-actions"><a className="btn btn-ghost btn-sm" href={attrValue(GROUPS)}>🔄 Refresh</a></div></div>
    {ui.flash(ctx.flash)}
    <div className="kpis kpis-tight">
      {ui.kpi('This week', String(posts.length), `Week from ${G.weekOf()}`)}{' '}
      {ui.kpi('Posted', String(done), 'Ticked by you', 'kpi-blue')}{' '}
      {ui.kpi('Left', String(posts.length - done), 'One a day is enough')}{' '}
      {ui.kpi('Next batch', 'Friday', 'New posts come by themselves')}
    </div>
    <section className="panel">
      <p className="small muted">Copy one post a day and paste it in 2–3 Facebook groups. The posts have no link and no price list on purpose: groups remove those. When people comment or message, send them the product link there.</p>
      <form method="post" action={attrValue(GROUPS)} data-confirm="Replace the posts you haven't posted yet with new ones?">
        <input type="hidden" name="action" defaultValue="fresh" />
        <button className="btn btn-sm btn-ghost">♻️ Make new posts (keeps the posted ones)</button>
      </form>
    </section>
    {posts.length ? <div className="gp-grid">{posts.map((p) => <section className="panel gp-card" id={`post-${p.id}`} key={p.id}>
      <div className="gp-head">
        <span className="pill">{KIND_LABEL[p.kind] || p.kind} · {DAY[(p.place - 1) % 7]}</span>
        {p.posted_at ? <span className="small" style={{ color: 'var(--ok, #1a7f37)' }}>✔ Posted {fmtDate(p.posted_at, false)}</span> : <span className="small muted">Not posted</span>}
      </div>
      {p.image_id ? <p><img src={`/media/${attrValue(p.image_id)}/t`} alt="" loading="lazy" style={{ maxWidth: 140, borderRadius: 8 }} /></p> : null}
      <textarea id={`gp-text-${p.id}`} className="gp-text" readOnly rows={8} defaultValue={p.body} />
      <p className="small muted">Suggested groups: <Val v={p.groups} /></p>
      <div className="row-actions">
        <button type="button" className="btn btn-sm" data-copy-from={`gp-text-${p.id}`}>📋 Copy text</button>
        {p.image_id ? <a className="btn btn-sm btn-ghost" href={`/media/${attrValue(p.image_id)}/w`} download={`post-${p.id}.jpg`}>⬇️ Image</a> : null}
        <form method="post" action={attrValue(GROUPS)} className="inline">
          <input type="hidden" name="action" defaultValue={p.posted_at ? 'unposted' : 'posted'} />
          <input type="hidden" name="id" defaultValue={String(p.id)} />
          <button className="btn btn-sm btn-ghost">{p.posted_at ? '↩️ Not posted' : '✔ Mark posted'}</button>
        </form>
      </div>
    </section>)}</div> : <section className="panel"><p className="muted">No posts could be made — the shop needs products in stock with pictures.</p></section>}
  </>;
  return ctx.page('Group posts', body, 'group-posts');
}

async function marketHandle(ctx: AdminCtx) {
  if (ctx.method !== 'POST') return marketPage(ctx);
  const b = await ctx.body();
  if (b.action === 'listed') {
    const id = int(b.id);
    if (id) await G.markListed(id);
    return ctx.back(MARKET, 'saved');
  }
  return ctx.back(MARKET);
}

async function marketPage(ctx: AdminCtx) {
  const s = ctx.settings;
  const { items, listed, due } = await G.picks(10);
  const body = <>
    <div className="title-row"><h1>🏷️ Marketplace helper</h1><div className="row-actions"><a className="btn btn-ghost btn-sm" href={attrValue(MARKET)}>🔄 Refresh</a></div></div>
    {ui.flash(ctx.flash)}
    <div className="kpis kpis-tight">
      {ui.kpi('Listed so far', String(listed), 'Products you posted')}{' '}
      {ui.kpi('Renew now', String(due), `Older than ${G.RENEW_DAYS} days`, due ? 'kpi-blue' : '')}{' '}
      {ui.kpi('Today\'s list', String(items.length), 'Renewals first, then best sellers')}
    </div>
    <section className="panel">
      <p className="small muted">On your phone: Facebook → Marketplace → Create listing. Copy the title and the description, download the pictures, set the price, post. Then tick "Listed". When someone messages, copy "Reply" and send it — it has the product link, so they come to the website.</p>
    </section>
    {items.length ? items.map((p) => <section className="panel mp-item" key={p.id}>
      <div className="mp-head">
        {p.image_id ? <img src={`/media/${attrValue(p.image_id)}/t`} alt="" loading="lazy" style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 8 }} /> : null}
        <div>
          <b translate="no"><Val v={G.listingTitle(p)} /></b>
          <div className="small muted">৳{p.price} · Stock {p.stock} · Sold {p.sold} · {p.posted_at ? <span style={p.due ? { color: '#b26a00' } : undefined}>Listed {fmtDate(p.posted_at, false)}{p.due ? ' — renew' : ''}</span> : 'Never listed'}</div>
        </div>
      </div>
      <div className="two-col">
        <div>
          <label className="small muted" htmlFor={`mp-title-${p.id}`}>Title</label>
          <textarea id={`mp-title-${p.id}`} className="gp-text" readOnly rows={2} defaultValue={G.listingTitle(p)} />
          <button type="button" className="btn btn-sm" data-copy-from={`mp-title-${p.id}`}>📋 Copy title</button>
        </div>
        <div>
          <label className="small muted" htmlFor={`mp-reply-${p.id}`}>Reply (send when someone messages)</label>
          <textarea id={`mp-reply-${p.id}`} className="gp-text" readOnly rows={2} defaultValue={G.replyText(p, s)} />
          <button type="button" className="btn btn-sm btn-ghost" data-copy-from={`mp-reply-${p.id}`}>📋 Copy reply</button>
        </div>
      </div>
      <label className="small muted" htmlFor={`mp-text-${p.id}`}>Description</label>
      <textarea id={`mp-text-${p.id}`} className="gp-text" readOnly rows={7} defaultValue={G.listingText(p, s)} />
      <div className="row-actions">
        <button type="button" className="btn btn-sm" data-copy-from={`mp-text-${p.id}`}>📋 Copy description</button>
        {p.images.map((m, i) => <a key={m} className="btn btn-sm btn-ghost" href={`/media/${attrValue(m)}/w`} download={`listing-${p.id}-${i + 1}.jpg`}>⬇️ Picture {i + 1}</a>)}
        <form method="post" action={attrValue(MARKET)} className="inline">
          <input type="hidden" name="action" defaultValue="listed" />
          <input type="hidden" name="id" defaultValue={String(p.id)} />
          <button className="btn btn-sm btn-ghost">✔ {p.posted_at ? 'Renewed' : 'Listed'}</button>
        </form>
      </div>
    </section>) : <section className="panel"><p className="muted">Nothing to list — the shop needs products in stock with pictures.</p></section>}
  </>;
  return ctx.page('Marketplace helper', body, 'marketplace');
}

export const routes = [
  { method: '*', path: GROUPS, perm: 'marketing', handler: groupsHandle },
  { method: '*', path: MARKET, perm: 'marketing', handler: marketHandle },
];
