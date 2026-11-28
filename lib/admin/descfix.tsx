// Admin → পণ্য → 📋 বিবরণ যাচাই (AI) — owner, 2026-11-28 (lib/services/descfix.ts does the work).
import { Val, attrValue, jsxList } from '../react/html';
import { bn, int, fmtDate, ifKey } from '../util';
import * as db from '../db';
import * as ui from './ui';
import * as df from '../services/descfix';
import type { AdminCtx } from '../types';

const BASE = '/admin/products/desc-fix';
const TABS: Record<string, string> = { applied: '✅ ঠিক করা হয়েছে', review: '👀 আপনার দেখার জন্য', ok: '👍 আগেই ঠিক ছিল', undone: '↩️ ফেরত আনা', error: '⚠️ হয়নি' };
const PER = 30;

type Row = { product_id: number; status: string; old: string | null; proposal: df.DescProposal | null; why: string; created_at: Date; name: string; description: string; image_id: number | null };

async function handle(ctx: AdminCtx) {
  if (ctx.method === 'POST') {
    const b = await ctx.body<'action' | 'id' | 'tab'>();
    const tab = ifKey(TABS, b.tab, 'applied');
    const id = int(b.id);
    let info = '';
    if (b.action === 'settings') { await db.setMany({ descfix_on: b.descfix_on ? '1' : '0', descfix_auto: b.descfix_auto ? '1' : '0' }); info = 'সেটিং সেভ হয়েছে।'; }
    else if (b.action === 'undo' && id) { info = (await df.undo(id)) ? '↩️ আগের বিবরণ ফেরত এসেছে।' : 'আগেই ফেরত আনা হয়েছে।'; await ctx.log('product_edit', 'product', id, 'AI বিবরণ যাচাই ফেরত'); }
    else if (b.action === 'approve' && id) { info = (await df.approve(id)) ? '✅ নতুন বিবরণ বসানো হয়েছে।' : 'পাওয়া যায়নি।'; await ctx.log('product_edit', 'product', id, 'AI বিবরণ — মালিক অনুমোদন দিলেন'); }
    else if (b.action === 'skip' && id) { await df.skip(id); info = 'বাদ দেওয়া হয়েছে — বিবরণ যেমন ছিল তেমনই থাকল।'; }
    else if (b.action === 'retry' && id) { await db.q('DELETE FROM desc_fix WHERE product_id=$1', [id]); info = 'আবার দেখা হবে।'; }
    else if (b.action === 'run') {
      const r = await df.tick({ ...ctx.settings, descfix_on: '1', descfix_per_tick: '3', descfix_pause_until: '0', titlefix_pause_until: '0' });
      info = r.status === 'off' ? 'Gemini চাবি নেই।' : r.status === 'busy' ? 'Google এখন ব্যস্ত — পরে নিজে থেকে চলবে।' : `${bn(r.done)}টি পণ্য দেখা হলো।`;
    }
    return ctx.redirect(`${BASE}?tab=${tab}&info=${encodeURIComponent(info)}`);
  }
  const tab = ifKey(TABS, ctx.query.get('tab'), 'applied');
  const pg = Math.max(1, int(ctx.query.get('page'), 1));
  const c = await df.counts();
  const n = (k: string) => Number(c[k] || 0);
  const rows = await db.q<Row>(`SELECT f.product_id, f.status, f.old, f.proposal, f.why, f.created_at, p.name, coalesce(p.description, '') AS description, p.image_id
    FROM desc_fix f JOIN products p ON p.id=f.product_id WHERE f.status=$1 ORDER BY f.created_at DESC LIMIT $2 OFFSET $3`, [tab, PER, (pg - 1) * PER]);
  const s = ctx.settings;
  const info = ctx.query.get('info');
  const hidden = (id: number, action: string) => <><input type="hidden" name="id" defaultValue={attrValue(id)} /><input type="hidden" name="action" defaultValue={attrValue(action)} /><input type="hidden" name="tab" defaultValue={attrValue(tab)} /></>;
  const card = (r: Row) => {
    const pr = r.proposal;
    const before = r.status === 'applied' ? r.old || '' : r.description;
    const after = r.status === 'applied' ? r.description : pr?.description || '';
    return <article className="panel tfx-item" id={`p${attrValue(r.product_id)}`}>
      {(r.image_id ? <img className="tfx-pic" src={`/media/${attrValue(r.image_id)}/t`} alt="" loading="lazy" /> : <span className="tfx-pic tfx-nopic">📦</span>)}
      <div className="tfx-body" translate="no">
        <p className="tfx-new"><a href={`/admin/products/${attrValue(r.product_id)}`} target="_blank" rel="noopener"><b><Val v={r.name} /></b></a></p>
        {(pr?.wrong?.length ? <ul className="small tfx-why">{jsxList(pr.wrong.map((w) => <li><Val v={w} /></li>))}</ul> : null)}
        {(r.why ? <p className="small tfx-why">⚠️ <Val v={r.why} /></p> : null)}
        {(after ? <details className="small"><summary>নতুন বিবরণ</summary><pre className="tfx-pre"><Val v={after} /></pre></details> : null)}
        {(before && r.status !== 'ok' ? <details className="small muted"><summary>আগের বিবরণ</summary><pre className="tfx-pre"><Val v={before.slice(0, 2500)} /></pre></details> : null)}
      </div>
      <div className="tfx-act">
        {(r.status === 'applied' ? <form method="post" action={attrValue(BASE)}>{hidden(r.product_id, 'undo')}<button className="btn btn-sm btn-ghost">↩️ ফেরত</button></form> : null)}
        {(r.status === 'review' && pr?.description ? <form method="post" action={attrValue(BASE)}>{hidden(r.product_id, 'approve')}<button className="btn btn-sm">✅ বসান</button></form> : null)}
        {(r.status === 'review' ? <form method="post" action={attrValue(BASE)}>{hidden(r.product_id, 'skip')}<button className="btn btn-sm btn-ghost">❌ বাদ</button></form> : null)}
        {(r.status === 'error' || r.status === 'undone' ? <form method="post" action={attrValue(BASE)}>{hidden(r.product_id, 'retry')}<button className="btn btn-sm btn-ghost">🔄 আবার দেখুন</button></form> : null)}
        <span className="small muted">{fmtDate(r.created_at)}</span>
      </div>
    </article>;
  };
  const pages = Math.max(1, Math.ceil(n(tab) / PER));
  const body = <><div className="title-row"><h1>📋 বিবরণ যাচাই (AI)</h1>{ui.helpBox('এটা কী করে?', <ol className="steps"><li>যেসব পণ্যের নামে মডেল নম্বর আছে (ট্রানজিস্টর, আইসি, মডিউল…), Gemini তাদের বিবরণ ওই পার্টের আসল ডেটাশিটের সাথে মেলায়।</li><li>অন্য পার্টের মাপ বা ভুল মাপ পেলে নতুন সঠিক বিবরণ লেখে। Gemini নিশ্চিত হলে আর মডেল নম্বর মিললে নিজে বসায়; না হলে এখানে আপনার জন্য অপেক্ষা করে।</li><li>প্রতিটার পাশে "↩️ ফেরত" — আগের বিবরণ ফিরে আসে।</li></ol>)}</div>
    {ui.flash(ctx.flash)}{(info ? <p className="flash"><Val v={info} /></p> : null)}
    <form method="post" action={attrValue(BASE)} className="panel tfx-set"><input type="hidden" name="action" defaultValue="settings" /><input type="hidden" name="tab" defaultValue={attrValue(tab)} />{ui.switchRow('descfix_on', s.descfix_on !== '0', 'নিজে থেকে চলবে', 'নাম ঠিক করার পরে, Gemini-র ফ্রি সীমার মধ্যে')}{ui.switchRow('descfix_auto', s.descfix_auto !== '0', 'নিশ্চিতগুলো নিজে বসাবে', 'বন্ধ করলে সব আপনার ✅-এর অপেক্ষায়')}<button className="btn btn-sm">সেভ</button></form>
    <form method="post" action={attrValue(BASE)} className="inline"><input type="hidden" name="action" defaultValue="run" /><input type="hidden" name="tab" defaultValue={attrValue(tab)} /><button className="btn btn-sm btn-ghost">▶️ এখনই ৩টা দেখুন</button></form>
    <nav className="chips">{jsxList(Object.entries(TABS).map(([k, v]) => <a className={`chip ${k === tab ? 'on' : ''}`} href={`${BASE}?tab=${k}`}><Val v={v} /> <b>{bn(n(k))}</b></a>))}</nav>
    {(rows.length ? <div className="tfx-list">{jsxList(rows.map(card))}</div> : <p className="muted">এখানে এখনো কিছু নেই।</p>)}
    {(pages > 1 ? <nav className="pager">{(pg > 1 ? <a className="btn btn-sm btn-ghost" href={`${BASE}?tab=${tab}&page=${pg - 1}`}>← আগের</a> : null)}{' '}<span className="small">পেজ {bn(pg)} / {bn(pages)}</span>{' '}{(pg < pages ? <a className="btn btn-sm" href={`${BASE}?tab=${tab}&page=${pg + 1}`}>পরের →</a> : null)}</nav> : null)}
  </>;
  return ctx.page('বিবরণ যাচাই (AI)', body, 'desc-fix');
}

export const routes = [
  { method: 'GET', path: BASE, perm: 'products', handler: handle },
  { method: 'POST', path: BASE, perm: 'products', handler: handle },
];
