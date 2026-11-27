// Admin → পণ্য → 🏷️ নাম ঠিক করা (AI) — owner, 2026-11-28 (lib/services/titlefix.ts does the work).
// Shows what Gemini changed (old → new name, Bangla name, category, what the photo shows) with ↩️ for each, and the
// ones waiting for the owner (photo didn't clearly match, or a safety check failed) with ✅ / ❌.
import { Val, attrValue, jsxList } from '../react/html';
import { bn, int, fmtDate, ifKey } from '../util';
import * as db from '../db';
import * as ui from './ui';
import * as tf from '../services/titlefix';
import type { AdminCtx } from '../types';

const BASE = '/admin/products/title-fix';
const TABS: Record<string, string> = { applied: '✅ বদলানো হয়েছে', review: '👀 আপনার দেখার জন্য', same: '👍 আগেই ঠিক ছিল', undone: '↩️ ফেরত আনা', error: '⚠️ হয়নি' };
const PER = 40;

type Row = { product_id: number; status: string; old: Record<string, unknown> | null; proposal: (tf.Proposal & { bn_ok?: string | null; cat_ok?: boolean }) | null;
  why: string; created_at: Date; name: string; name_bn: string; category_id: number | null; image_id: number | null; slug: string };

async function handle(ctx: AdminCtx) {
  if (ctx.method === 'POST') {
    const b = await ctx.body<'action' | 'id' | 'tab'>();
    const tab = ifKey(TABS, b.tab, 'applied');
    const id = int(b.id);
    let info = '';
    if (b.action === 'settings') {
      await db.setMany({ titlefix_on: b.titlefix_on ? '1' : '0', titlefix_auto: b.titlefix_auto ? '1' : '0' });
      info = 'সেটিং সেভ হয়েছে।';
    } else if (b.action === 'undo' && id) { info = (await tf.undo(id)) ? '↩️ আগের নাম ফেরত এসেছে।' : 'আগেই ফেরত আনা হয়েছে।'; await ctx.log('product_edit', 'product', id, 'AI নাম ঠিক করা ফেরত'); }
    else if (b.action === 'approve' && id) { info = (await tf.approve(id)) ? '✅ বসানো হয়েছে।' : 'পাওয়া যায়নি।'; await ctx.log('product_edit', 'product', id, 'AI নাম ঠিক করা — মালিক অনুমোদন দিলেন'); }
    else if (b.action === 'skip' && id) { await tf.skip(id); info = 'বাদ দেওয়া হয়েছে — নাম যেমন ছিল তেমনই থাকল।'; }
    else if (b.action === 'retry' && id) { await db.q('DELETE FROM title_fix WHERE product_id=$1', [id]); info = 'আবার দেখা হবে (কয়েক মিনিটের মধ্যে)।'; }
    else if (b.action === 'run') {
      const r = await tf.tick({ ...ctx.settings, titlefix_on: '1', titlefix_per_tick: '3', titlefix_pause_until: '0' });
      info = r.status === 'off' ? 'চালু নেই বা Gemini চাবি নেই।' : r.status === 'busy' ? 'Google এখন ব্যস্ত — আধা ঘণ্টা পরে নিজে থেকে চলবে।' : `${bn(r.done)}টি পণ্য দেখা হলো।`;
    }
    return ctx.redirect(`${BASE}?tab=${tab}&info=${encodeURIComponent(info)}`);
  }
  const tab = ifKey(TABS, ctx.query.get('tab'), 'applied');
  const pg = Math.max(1, int(ctx.query.get('page'), 1));
  const c = await tf.counts();
  const cats = new Map((await db.q<{ id: number; name: string }>('SELECT id, name FROM categories')).map((x) => [x.id, x.name]));
  const rows = await db.q<Row>(`SELECT f.product_id, f.status, f.old, f.proposal, f.why, f.created_at, p.name, p.name_bn, p.category_id, p.image_id, p.slug
    FROM title_fix f JOIN products p ON p.id=f.product_id WHERE f.status=$1 ORDER BY f.created_at DESC LIMIT $2 OFFSET $3`, [tab, PER, (pg - 1) * PER]);
  const info = ctx.query.get('info');
  const s = ctx.settings;
  const hidden = (id: number, action: string) => <><input type="hidden" name="id" defaultValue={attrValue(id)} /><input type="hidden" name="action" defaultValue={attrValue(action)} /><input type="hidden" name="tab" defaultValue={attrValue(tab)} /></>;
  const cat = (id: unknown) => (id ? cats.get(Number(id)) || '—' : '—');
  const card = (r: Row) => {
    const pr = r.proposal;
    const old = r.old as { name?: string; name_bn?: string; category_id?: number } | null;
    const oldName = old?.name || (r.status === 'applied' ? '' : r.name);
    return <article className="panel tfx-item" id={`p${attrValue(r.product_id)}`}>
      {(r.image_id ? <img className="tfx-pic" src={`/media/${attrValue(r.image_id)}/t`} alt="" loading="lazy" /> : <span className="tfx-pic tfx-nopic">📦</span>)}
      <div className="tfx-body">
        {(r.status === 'applied' && oldName ? <p className="tfx-old small"><s><Val v={oldName} /></s></p> : null)}
        <p className="tfx-new"><a href={`/admin/products/${attrValue(r.product_id)}`} target="_blank" rel="noopener"><b><Val v={r.status === 'review' && pr ? pr.title_en : r.name} /></b></a></p>
        {(r.status === 'review' ? <p className="small muted">এখনকার নাম: <Val v={r.name} /></p> : null)}
        <p className="small"><Val v={r.status === 'review' && pr ? (pr.bn_ok || pr.title_bn) : r.name_bn} /></p>
        <p className="small muted">🖼️ ছবিতে: <Val v={pr?.photo_shows || '—'} />{' '}· ক্যাটাগরি:{' '}{(old && old.category_id !== undefined && old.category_id !== r.category_id ? <><s><Val v={cat(old.category_id)} /></s>{' → '}</> : null)}<Val v={r.status === 'review' && pr?.cat_ok ? `${cat(r.category_id)} → ${cat(pr.category_id)}` : cat(r.category_id)} /></p>
        {(r.why ? <p className="small tfx-why">⚠️ <Val v={r.why} /></p> : null)}
        {(pr?.issues?.length ? <p className="small muted">📝 <Val v={pr.issues.join(' · ')} /></p> : null)}
      </div>
      <div className="tfx-act">
        {(r.status === 'applied' ? <form method="post" action={attrValue(BASE)}>{hidden(r.product_id, 'undo')}<button className="btn btn-sm btn-ghost">↩️ ফেরত</button></form> : null)}
        {(r.status === 'review' ? <><form method="post" action={attrValue(BASE)}>{hidden(r.product_id, 'approve')}<button className="btn btn-sm">✅ বসান</button></form><form method="post" action={attrValue(BASE)}>{hidden(r.product_id, 'skip')}<button className="btn btn-sm btn-ghost">❌ বাদ</button></form></> : null)}
        {(r.status === 'error' || r.status === 'undone' || r.status === 'skipped' ? <form method="post" action={attrValue(BASE)}>{hidden(r.product_id, 'retry')}<button className="btn btn-sm btn-ghost">🔄 আবার দেখুন</button></form> : null)}
        <span className="small muted">{fmtDate(r.created_at)}</span>
      </div>
    </article>;
  };
  const n = (k: string) => Number((c as Record<string, number>)[k] || 0);
  const pages = Math.max(1, Math.ceil(n(tab) / PER));
  const body = <><div className="title-row"><h1>🏷️ নাম ঠিক করা (AI)</h1>{ui.helpBox('এটা কী করে?', <ol className="steps"><li>প্রতিটা পণ্যের <b>ছবি</b>, নাম আর বিবরণ Gemini দেখে: ছবিতে কী আছে বলে, তারপর পরিষ্কার ইংরেজি নাম, সঠিক বাংলা নাম আর ঠিক ক্যাটাগরি বাছে।</li><li>মডেল নম্বর বা মাপ একটাও বাদ গেলে, নতুন কোনো সংখ্যা/মডেল ঢুকলে, বা ছবির সাথে নাম না মিললে — কিছুই বদলায় না, "👀 আপনার দেখার জন্য"-তে অপেক্ষা করে।</li><li>বদলানো প্রতিটার পাশে "↩️ ফেরত" — আগের নাম, বাংলা নাম, ক্যাটাগরি আর SEO লেখা ফিরে আসে। পণ্যের লিংক (URL) কখনো বদলায় না।</li><li>প্রতি ৫ মিনিটে কয়েকটা করে নিজে থেকে চলে (Gemini-র ফ্রি সীমার মধ্যে)।</li></ol>)}</div>
    {ui.flash(ctx.flash)}{(info ? <p className="flash"><Val v={info} /></p> : null)}
    <div className="kpis kpis-tight">{ui.kpi('মোট পণ্য', bn(c.total))}{' '}{ui.kpi('বাকি', bn(c.left))}{' '}{ui.kpi('বদলানো', bn(n('applied')), '', 'kpi-green')}{' '}{ui.kpi('আপনার দেখার জন্য', bn(n('review')), '', n('review') ? 'kpi-alert' : '')}{' '}{ui.kpi('আগেই ঠিক', bn(n('same')))}</div>
    <form method="post" action={attrValue(BASE)} className="panel tfx-set"><input type="hidden" name="action" defaultValue="settings" /><input type="hidden" name="tab" defaultValue={attrValue(tab)} />{ui.switchRow('titlefix_on', s.titlefix_on !== '0', 'নিজে থেকে চলবে', 'প্রতি ৫ মিনিটে কয়েকটা পণ্য')}{ui.switchRow('titlefix_auto', s.titlefix_auto !== '0', 'নিরাপদগুলো নিজে বসাবে', 'বন্ধ করলে সব আপনার ✅-এর অপেক্ষায় থাকবে')}<button className="btn btn-sm">সেভ</button></form>
    {(!String(s.ai_gemini_key || '').trim() ? <p className="flash flash-error">Gemini চাবি বসানো নেই — <a href="/admin/ai-staff">AI স্টাফ পেজে</a> বসান (ফ্রি)।</p> : <form method="post" action={attrValue(BASE)} className="inline"><input type="hidden" name="action" defaultValue="run" /><input type="hidden" name="tab" defaultValue={attrValue(tab)} /><button className="btn btn-sm btn-ghost">▶️ এখনই ৩টা দেখুন</button></form>)}
    <nav className="chips">{jsxList(Object.entries(TABS).map(([k, v]) => <a className={`chip ${k === tab ? 'on' : ''}`} href={`${BASE}?tab=${k}`}><Val v={v} /> <b>{bn(n(k))}</b></a>))}</nav>
    {(rows.length ? <div className="tfx-list">{jsxList(rows.map(card))}</div> : <p className="muted">এখানে এখনো কিছু নেই।</p>)}
    {(pages > 1 ? <nav className="pager">{(pg > 1 ? <a className="btn btn-sm btn-ghost" href={`${BASE}?tab=${tab}&page=${pg - 1}`}>← আগের</a> : null)}{' '}<span className="small">পেজ {bn(pg)} / {bn(pages)}</span>{' '}{(pg < pages ? <a className="btn btn-sm" href={`${BASE}?tab=${tab}&page=${pg + 1}`}>পরের →</a> : null)}</nav> : null)}
  </>;
  return ctx.page('নাম ঠিক করা (AI)', body, 'title-fix');
}

export const routes = [
  { method: 'GET', path: BASE, perm: 'products', handler: handle },
  { method: 'POST', path: BASE, perm: 'products', handler: handle },
];
