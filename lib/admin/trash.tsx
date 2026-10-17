// Admin → স্থায়ীভাবে মুছে ফেলুন (রিসাইকেল বিন) — owner only.
// Everything anyone deleted waits here with full details; the owner restores it or deletes it for good.
import { toHtml, Val, attrValue, attrProps, jsxList } from '../react/html';
import { html, raw, bn, money, int, list, fmtDate } from '../util';
import * as db from '../db';
import * as T from '../models/trash';
import * as ui from './ui';
import * as delcode from '../services/delcode';
import type { AdminCtx, Id, Loose } from '../types';

const PER_PAGE = 100;
// friendly names for the details table
const FIELD: Record<string, Loose> = {
  name: 'নাম', title: 'শিরোনাম', sku: 'SKU', price: 'বিক্রির দাম', old_price: 'আগের দাম', cost_price: 'কেনা দাম', stock: 'স্টক', brand: 'ব্র্যান্ড',
  category_id: 'ক্যাটাগরি', short_description: 'ছোট বিবরণ', description: 'বিস্তারিত বিবরণ', active: 'দোকানে দেখানো', featured: 'জনপ্রিয়', slug: 'লিংক',
  youtube_url: 'YouTube', unit: 'একক', weight_g: 'ওজন (গ্রাম)', sold_count: 'মোট বিক্রি', created_at: 'তৈরি', updated_at: 'শেষ বদল', import_ref: 'যেখান থেকে আমদানি',
  code: 'কোড', type: 'ধরন', value: 'মান', amount: 'টাকা', note: 'নোট', tx_date: 'তারিখ', username: 'ইউজারনেম', phone: 'ফোন', email: 'ইমেইল', role: 'পদ',
  url: 'লিংক', segment: 'ধরন', content: 'লেখা', excerpt: 'সংক্ষেপ', status: 'অবস্থা', link: 'লিংক', placement: 'জায়গা', icon: 'আইকন', parent_id: 'মূল ক্যাটাগরি',
};
const HIDE = new Set(['password', 'permissions', 'image', 'seo_title', 'seo_description', 'seo_keywords', 'emoji', 'image_id', 'cover_id', 'id']);
const ENTITY: Record<string, string> = { product: 'product', category: 'category', blog_post: 'blog', banner: 'banner', page: 'page', coupon: 'coupon', transaction: 'transaction', staff: 'staff', customer: 'customer', order: 'order' };

function who(e?: Loose) { return e.deleted_by_name || (e.deleted_by ? `স্টাফ #${e.deleted_by}` : '—'); }
function where(path?: Loose) {
  const map: [RegExp, string][] = [[/^\/admin\/products\/\d+/, 'পণ্যের এডিট পেজ'], [/^\/admin\/products/, 'সব পণ্য তালিকা'], [/^\/admin\/categories/, 'ক্যাটাগরি পেজ'], [/^\/admin\/blog/, 'ব্লগ'],
    [/^\/admin\/design\/banners/, 'ব্যানার'], [/^\/admin\/design\/pages/, 'পেজ'], [/^\/admin\/marketing\/coupons/, 'কুপন'], [/^\/admin\/accounts/, 'হিসাব'], [/^\/admin\/staff/, 'স্টাফ'],
    [/^\/admin\/research/, 'মার্কেট রিসার্চ'], [/^\/admin\/customers\/\d+/, 'কাস্টমারের পেজ'], [/^\/admin\/customers/, 'সব কাস্টমার তালিকা'], [/^\/admin\/trash/, 'রিসাইকেল বিন']];
  const m = map.find(([re]) => (re as RegExp).test(path || ''));
  return m ? m[1] : (path || '—');
}

async function page(ctx: AdminCtx) {
  if (ctx.method === 'POST') {
    const b = await ctx.body();
    const ids = list(b.id).map((x) => int(x)).filter(Boolean);
    if (b.form === 'restore') {
      if (!ids.length) return ctx.fail('/admin/trash', 'কিছু বাছা হয়নি।');
      let ok = 0;
      const errors: Loose[] = [];
      for (const id of ids) {
        const r = await T.restore(id);
        if (r.ok) { ok++; await ctx.log('restore', ENTITY[r.kind] || r.kind, r.id, 'রিসাইকেল বিন থেকে ফেরত আনা হলো'); } else errors.push(r.error);
      }
      const text = `✅ ${bn(ok)}টি ফেরত আনা হয়েছে।${errors.length ? ' ' + errors.slice(0, 3).join(' ') : ''}`;
      return ctx.redirect('/admin/trash?' + (errors.length && !ok ? 'err=' : 'info=') + encodeURIComponent(text));
    }
    // 🔐 deleting for good needs the code e-mailed to the shop's Gmail (restoring above needs nothing)
    const codeFor = (({ purge: 'trash_purge', empty: 'trash_empty', all_products: 'trash_all_products' } as Record<string, string>))[b.form];
    if (codeFor) {
      const back = ids.length === 1 && b.form === 'purge' && b.from_detail ? `/admin/trash/${ids[0]}` : '/admin/trash';
      if (b.form === 'purge' && !ids.length) return ctx.fail(back, 'কিছু বাছা হয়নি।');
      const bad = await delcode.check(ctx, codeFor, b.del_code);
      if (bad) return ctx.fail(back, '🔐 ' + bad);
    }
    if (b.form === 'purge') {
      if (!ids.length) return ctx.fail('/admin/trash', 'কিছু বাছা হয়নি।');
      const n = await T.purge(ids);
      await ctx.log('purge', 'trash', null, `${n}টি জিনিস স্থায়ীভাবে মুছে ফেলা হলো`);
      return ctx.redirect('/admin/trash?info=' + encodeURIComponent(`${bn(n)}টি জিনিস স্থায়ীভাবে মুছে ফেলা হয়েছে — আর ফেরত আনা যাবে না।`));
    }
    if (b.form === 'empty') {
      if (String(b.confirm || '').trim() !== 'খালি করুন') return ctx.fail('/admin/trash', 'ঘরে ঠিকভাবে "খালি করুন" লিখুন।');
      const n = await T.purgeAll();
      await ctx.log('purge', 'trash', null, `রিসাইকেল বিন খালি করা হলো (${n}টি)`);
      return ctx.redirect('/admin/trash?info=' + encodeURIComponent(`রিসাইকেল বিন খালি — ${bn(n)}টি জিনিস স্থায়ীভাবে মুছে গেছে।`));
    }
    if (b.form === 'all_products') {
      if (String(b.confirm || '').replace(/\s+/g, ' ').trim() !== 'সব মুছুন') return ctx.fail('/admin/trash', 'ঘরে ঠিকভাবে "সব মুছুন" লিখুন।');
      const n = await T.moveAllProducts({ id: ctx.user.id, name: ctx.user.name, path: '/admin/trash', ip: ctx.ip });
      await ctx.log('product_delete', 'product', null, `সব পণ্য (${n}টি) রিসাইকেল বিনে পাঠানো হলো`);
      return ctx.redirect('/admin/trash?kind=product&info=' + encodeURIComponent(`${bn(n)}টি পণ্য দোকান থেকে সরিয়ে রিসাইকেল বিনে রাখা হয়েছে। এখান থেকে "স্থায়ীভাবে মুছুন" দিলে চিরতরে মুছে যাবে, আর তখন SKU আবার ১ থেকে শুরু হবে।`));
    }
    return ctx.back('/admin/trash');
  }
  const kind = T.KINDS[ctx.query.get('kind')] ? ctx.query.get('kind') : '';
  const pageNo = Math.max(1, int(ctx.query.get('page'), 1));
  const [rows, counts] = await Promise.all([T.list({ kind, limit: PER_PAGE, offset: (pageNo - 1) * PER_PAGE }), T.counts()]);
  const total = counts.reduce((a, c) => a + c.n, 0);
  const shown = kind ? (counts.find((c) => c.kind === kind) || { n: 0 }).n : total;
  const productsLive = (await db.one('SELECT count(*)::int AS n FROM products'))!.n;
  const body = toHtml(<><h1>🗑️ স্থায়ীভাবে মুছে ফেলুন{' '}<small>রিসাইকেল বিন — শুধু মালিক দেখতে পান</small></h1><Val v={ui.flash(ctx.flash)} /><p className="note small">🔐 স্থায়ীভাবে মুছতে, বিন খালি করতে বা সব পণ্য একসাথে মুছতে একটা কোড লাগবে, যা{' '}<b><Val v={delcode.masked()} /></b>{' '}ঠিকানায় যায়। ফেরত আনতে কোড লাগে না। নিজে না চেয়ে কোডের ইমেইল পেলে বুঝবেন কেউ চেষ্টা করছে — তখনই পাসওয়ার্ড বদলান।</p><p className="muted">অ্যাডমিন প্যানেলের যেকোনো জায়গা থেকে (আপনি বা কোনো স্টাফ) কিছু মুছলে তা দোকান থেকে সাথে সাথে সরে যায়, কিন্তু পুরোপুরি মোছে না — এখানে এসে জমা থাকে। কে মুছেছে, কখন, কোন পেজ থেকে — সব দেখা যাবে। দরকার হলে{' '}<b>ফেরত আনুন</b>, আর নিশ্চিত হলে{' '}<b>স্থায়ীভাবে মুছুন</b>{' '}— তখনই কেবল চিরতরে মুছে যাবে।</p><div className="chips"><a className={`chip ${!kind ? 'on' : ''}`} href="/admin/trash">সব ({bn(total)})</a>{' '}{jsxList(counts.map((c) => <a className={`chip ${kind === c.kind ? 'on' : ''}`} href={`/admin/trash?kind=${attrValue(c.kind)}`}>{(T.KINDS[c.kind] ? `${T.KINDS[c.kind].icon} ${T.KINDS[c.kind].label}` : <Val v={c.kind} />)}{' '}({bn(c.n)})</a>))}</div>{(rows.length ? <form method="post" action="/admin/trash" className="panel trash-form"><div className="row-actions trash-actions"><label className="check"><input type="checkbox" data-check-all="" />{' '}<span>সব বাছুন</span></label>{' '}<button className="btn btn-sm" name="form" value="restore">↩️ বাছাইগুলো ফেরত আনুন</button>{' '}<button className="btn btn-sm btn-danger" name="form" value="purge" data-delcode="trash_purge" data-delcode-to={attrValue(delcode.masked())} data-delcode-what="বাছাই করা জিনিস" data-confirm-btn="বাছাই করা জিনিসগুলো স্থায়ীভাবে মুছে ফেলবেন? আর কখনো ফেরত আনা যাবে না।">🗑️ বাছাইগুলো স্থায়ীভাবে মুছুন</button></div><div className="table-wrap"><table className="table"><thead><tr><th></th><th></th><th>কী মুছেছে</th><th>কে মুছেছে</th><th>কখন</th><th>কোথা থেকে</th></tr></thead><tbody>{jsxList(rows.map((e) => <tr><td><input type="checkbox" name="id[]" defaultValue={attrValue(e.id)} data-check-row="" aria-label="বাছুন" /></td><td className="thumb">{(e.media && e.media[0] ? <img src={`/media/${attrValue(e.media[0])}/t`} alt="" loading="lazy" /> : <span><Val v={(T.KINDS[e.kind] || {}).icon || '🗑️'} /></span>)}</td><td><a href={`/admin/trash/${attrValue(e.id)}`}><b><Val v={e.name || '(নাম নেই)'} /></b></a><br /><span className="small muted"><Val v={(T.KINDS[e.kind] || {}).label || e.kind} />{(e.sku ? ` · SKU ${e.sku}` : null)}{(e.price ? ` · ${money(e.price)}` : null)}</span></td><td className="small"><Val v={who(e)} /></td><td className="small">{fmtDate(e.deleted_at)}</td><td className="small"><Val v={where(e.from_path)} /></td></tr>))}</tbody></table></div><Val v={ui.pager(shown, pageNo, PER_PAGE, '/admin/trash' + (kind ? `?kind=${kind}` : ''))} /></form> : <Val v={ui.empty('রিসাইকেল বিন খালি। 👍')} />)}<div className="two-col trash-danger"><section className="panel"><h2>📦 সব পণ্য একসাথে মুছে ফেলুন</h2><p className="small">দোকানের{' '}<b>সব{' '}{bn(productsLive)}টি পণ্য</b>{' '}দোকান থেকে সরে এই রিসাইকেল বিনে চলে আসবে (দরকার হলে ফেরত আনা যাবে)। এরপর এখান থেকে "স্থায়ীভাবে মুছুন" দিলে চিরতরে মুছে যাবে — তখন SKU আবার ১ থেকে শুরু হবে। আগের অর্ডার আর ক্যাটাগরি মুছবে না।</p><form method="post" action="/admin/trash" className="form" data-confirm="দোকানের সব পণ্য সরিয়ে রিসাইকেল বিনে রাখবেন?" data-delcode="trash_all_products" data-delcode-to={attrValue(delcode.masked())} data-delcode-what={`সব ${bn(productsLive)}টি পণ্য`}><input type="hidden" name="form" defaultValue="all_products" />{' '}<Val v={ui.field('নিশ্চিত হলে লিখুন: সব মুছুন', ui.input('confirm', '', { required: true, autocomplete: 'off' }))} />{' '}<button className="btn btn-danger" {...attrProps(productsLive ? '' : raw('disabled'))}>সব পণ্য মুছে ফেলুন</button></form></section><section className="panel"><h2>🧹 রিসাইকেল বিন খালি করুন</h2><p className="small">এখানে যা আছে ({bn(total)}টি) সব{' '}<b>চিরতরে</b>{' '}মুছে যাবে, আর কখনো ফেরত আনা যাবে না।</p><form method="post" action="/admin/trash" className="form" data-confirm="রিসাইকেল বিনের সবকিছু চিরতরে মুছে ফেলবেন?" data-delcode="trash_empty" data-delcode-to={attrValue(delcode.masked())} data-delcode-what={`বিনের সব ${bn(total)}টি জিনিস`}><input type="hidden" name="form" defaultValue="empty" />{' '}<Val v={ui.field('নিশ্চিত হলে লিখুন: খালি করুন', ui.input('confirm', '', { required: true, autocomplete: 'off' }))} />{' '}<button className="btn btn-danger" {...attrProps(total ? '' : raw('disabled'))}>সব চিরতরে মুছে ফেলুন</button></form></section></div></>);
  return ctx.page('রিসাইকেল বিন', body, 'trash');
}

function valueOf(k?: Loose, v?: Loose, cats?: Loose) {
  if (v === null || v === undefined || v === '') return toHtml(<span className="muted">—</span>);
  if (typeof v === 'boolean') return v ? 'হ্যাঁ' : 'না';
  if (['price', 'old_price', 'cost_price', 'amount'].includes(k)) return money(v);
  if (/_at$|_date$/.test(k)) return fmtDate(v);
  if ((k === 'category_id' || k === 'parent_id') && cats.has(Number(v))) return cats.get(Number(v));
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return s.length > 400 ? toHtml(<details><summary>{s.slice(0, 160)}…</summary><div className="trash-long"><Val v={s} /></div></details>) : s;
}

async function detail(ctx: AdminCtx, m?: Loose) {
  const e = await T.get(m[1]);
  if (!e) return ctx.redirect('/admin/trash');
  const K = T.KINDS[e.kind] || { label: e.kind, icon: '🗑️' };
  const row = e.data.row || {};
  const cats = new Map((await db.q('SELECT id, name FROM categories')).map((c) => [c.id, c.name]));
  const history = ENTITY[e.kind] ? await db.q(`SELECT a.*, s.name AS staff_name FROM activity_log a LEFT JOIN staff s ON s.id=a.staff_id
    WHERE a.entity=$1 AND a.entity_id=$2 ORDER BY a.created_at DESC LIMIT 60`, [ENTITY[e.kind], e.ref_id]) : [];
  const fields = Object.keys(row).filter((k) => !HIDE.has(k));
  const parts = Object.entries(e.data.children || {}).reduce((a, [, v]: Loose) => a + v.length, 0);
  const body = toHtml(<><p className="crumbs"><a href="/admin/trash">← রিসাইকেল বিন</a></p><h1><Val v={K.icon} />{' '}<Val v={e.name || '(নাম নেই)'} />{' '}<small><Val v={K.label} />{' '}· মুছে ফেলা হয়েছে</small></h1><div className="two-col"><section className="panel"><h2>কে, কখন, কোথা থেকে মুছেছে</h2><table className="table kv"><tbody><tr><th>কে মুছেছে</th><td><b><Val v={who(e)} /></b></td></tr><tr><th>কখন</th><td>{fmtDate(e.deleted_at)}</td></tr><tr><th>কোন পেজ থেকে</th><td><Val v={where(e.from_path)} />{' '}<span className="small muted"><Val v={e.from_path} /></span></td></tr><tr><th>কোন নেটওয়ার্ক থেকে (IP)</th><td className="small"><Val v={e.ip || '—'} /></td></tr><tr><th>আগের আইডি</th><td>#<Val v={e.ref_id} /></td></tr>{(parts ? <tr><th>সাথে যা ছিল</th><td>{bn(parts)}টি সংযুক্ত অংশ (যেমন বান্ডেলের পণ্য) — ফেরত আনলে এগুলোও ফিরবে</td></tr> : null)}</tbody></table><form method="post" action="/admin/trash" className="row-actions trash-one"><input type="hidden" name="id" defaultValue={attrValue(e.id)} />{' '}<button className="btn" name="form" value="restore">↩️ ফেরত আনুন</button>{' '}<input type="hidden" name="from_detail" defaultValue="1" />{' '}<button className="btn btn-danger" name="form" value="purge" data-delcode="trash_purge" data-delcode-to={attrValue(delcode.masked())} data-delcode-what={attrValue(e.name || 'এই জিনিস')} data-confirm-btn="এটা স্থায়ীভাবে মুছে ফেলবেন? আর কখনো ফেরত আনা যাবে না।">🗑️ স্থায়ীভাবে মুছুন</button></form>{(e.media && e.media.length ? <><h2>ছবি</h2><div className="trash-pics">{jsxList(e.media.map((id?: Loose) => <a href={`/media/${attrValue(id)}`} target="_blank" rel="noopener"><img src={`/media/${attrValue(id)}/t`} alt="" loading="lazy" /></a>))}</div></> : null)}</section><section className="panel"><h2>এর ইতিহাস{' '}<small>কে কখন কী করেছে</small></h2>{(history.length ? <ul className="timeline">{jsxList(history.map((a) => <li><b><Val v={a.staff_name || 'সিস্টেম'} /></b>{' '}·{' '}<Val v={a.action} />{(a.detail ? ` · ${a.detail}` : null)}<br /><span className="small muted">{fmtDate(a.created_at)}</span></li>))}</ul> : <p className="muted">কোনো ইতিহাস লেখা নেই।</p>)}</section></div><section className="panel"><h2>মোছার আগে যা ছিল (সব তথ্য)</h2><table className="table kv"><tbody>{jsxList(fields.map((k) => <tr><th><Val v={FIELD[k] || k} /></th><td><Val v={valueOf(k, row[k], cats)} /></td></tr>))}</tbody></table></section></>);
  return ctx.page('রিসাইকেল বিন', body, 'trash');
}

export const routes = [
    { method: '*', path: '/admin/trash', perm: 'owner', handler: page },
    { method: 'GET', path: /^\/admin\/trash\/(\d+)$/, perm: 'owner', handler: detail },
    // 🔐 "কোড পাঠান" (who may ask is checked inside: the owner, or for test history whoever may change settings)
    { method: 'POST', path: '/admin/api/delete-code', handler: delcode.sendRoute },
  ];
