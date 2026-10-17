// Admin → স্টোর ডিজাইন → হোমপেজের সারি: the owner's own rows on the home page — add, edit, switch on/off,
// move up/down among all rows (built-in ones too) and delete (to the recycle bin).
import { toHtml, Val, A, attrs, L } from '../react/render';
import { cspNonce } from '../security';
import { html, raw, int, bn, list as asList } from '../util';
import * as db from '../db';
import * as ui from './ui';
import * as H from '../models/homerows';
import * as catalog from '../models/catalog';
import * as $design from './design';
import type { AdminCtx, Loose } from '../types';

const BASE = '/admin/design/rows';
// The list of rows lives on "লোগো, রং ও হোমপেজ" — this file only makes / edits / deletes the owner's own rows.
const HOME = '/admin/design';

// Built-in rows (same names as on "লোগো, রং ও হোমপেজ").
function builtIns() { return $design.SECTIONS; }

async function allLabels() {
  const own = await H.list();
  const labels: Record<string, Loose> = { ...builtIns() };
  for (const r of own) labels[H.keyOf(r.id)] = `✨ ${r.title}`;
  return { labels, own };
}

async function page(ctx: AdminCtx) {
  const s = ctx.settings;
  const { labels, own } = await allLabels();
  const enabled = db.jsonSetting(s, 'home_sections', []).filter((k?: Loose) => labels[k]);
  const ordered = [...enabled, ...Object.keys(labels).filter((k) => !enabled.includes(k))];
  const counts = new Map(await Promise.all(own.map(async (r): Promise<[Loose, number]> => [r.id, (await H.productsFor(r, {}).catch(() => [])).length])));
  const body = toHtml(<><h1>🏠 হোমপেজের সারি</h1><Val v={ui.flash(ctx.flash)} /><p className="muted">হোমপেজে কোন কোন সারি দেখাবে, কোনটা আগে-পরে — সব এখানে। আগে থেকে থাকা সারির পাশাপাশি{' '}<b>নিজের নতুন সারি</b>{' '}বানাতে পারবেন (যেমন "শীতের অফার", "৳৫০ এর নিচে রিমোট", "নতুন সোল্ডারিং টুলস")।</p><p><a className="btn" href={`${A(BASE)}/new`}>➕ নতুন সারি বানান</a></p><section className="panel"><h2>সব সারি — ক্রম ও চালু/বন্ধ</h2><p className="small muted">▲▼ দিয়ে ক্রম বদলান, টিক দিয়ে চালু/বন্ধ করুন, তারপর "ক্রম সেভ করুন" চাপুন। ✨ চিহ্ন = আপনার নিজের সারি।</p><form method="post" action={`${A(BASE)}/order`} className="form"><ul className="sortable" data-sortable="">{L(ordered.map((k) => {
    const id = H.idOf(k);
    return <li><input type="hidden" name="section_order[]" defaultValue={A(k)} />{' '}<Val v={ui.check('section_on[]', enabled.includes(k), labels[k], k)} />{' '}{(id ? <><span className="small muted">(<Val v={bn(counts.get(id) || 0)} />টি পণ্য)</span>{' '}<a className="small" href={`${A(BASE)}/${A(id)}`}>✏️ এডিট</a></> : null)}{' '}<span className="sort-btns"><button type="button" data-up="" {...{ "aria-label": "উপরে" }}>▲</button><button type="button" data-down="" {...{ "aria-label": "নিচে" }}>▼</button></span></li>;
  }))}</ul><div className="form-actions"><button className="btn">ক্রম সেভ করুন</button>{' '}<a href="/" target="_blank">দোকান দেখুন ↗</a></div></form></section><section className="panel"><h2>✨ আপনার নিজের সারি (<Val v={bn(own.length)} />টি)</h2>{(own.length ? <table className="table"><thead><tr><th>নাম</th><th>কোন পণ্য</th><th>পণ্য</th><th>অবস্থা</th><th></th><th></th></tr></thead><tbody>{L(own.map((r) => <tr className={A(enabled.includes(H.keyOf(r.id)) ? '' : 'row-off')}><td><b><Val v={r.title} /></b>{(r.sub ? <><br /><span className="small muted"><Val v={r.sub} /></span></> : null)}</td><td className="small"><Val v={H.SOURCES[r.source]} />{(r.ref && r.source !== 'brand' ? <>:{' '}<b><Val v={r.ref} /></b></> : null)}</td><td><Val v={bn(counts.get(r.id) || 0)} />টি</td><td>{(enabled.includes(H.keyOf(r.id)) ? <span className="pill pill-green">চালু</span> : <span className="pill">বন্ধ</span>)}</td><td><a className="btn btn-sm btn-ghost" href={`${A(BASE)}/${A(r.id)}`}>✏️ এডিট</a></td><td><form method="post" action={`${A(BASE)}/${A(r.id)}/delete`} data-confirm={`"${A(r.title)}" সারিটা মুছবেন? (রিসাইকেল বিনে যাবে)`}><button className="btn btn-sm btn-ghost danger-text">🗑️ মুছুন</button></form></td></tr>))}</tbody></table> : <Val v={ui.empty('এখনো নিজের কোনো সারি নেই। উপরের "নতুন সারি বানান" চাপুন।')} />)}</section></>);
  return ctx.page('হোমপেজের সারি', body, 'design');
}

async function saveOrder(ctx: AdminCtx) {
  const b = await ctx.body();
  const { labels } = await allLabels();
  const order = asList(b.section_order);
  const on = asList(b.section_on);
  await db.setSetting('home_sections', JSON.stringify(order.filter((k) => labels[k] && on.includes(k))));
  await ctx.log('settings', 'design', null, 'হোমপেজের সারির ক্রম');
  return ctx.back(HOME, 'saved');
}

async function form(ctx: AdminCtx, m?: Loose) {
  const id = m ? int(m[1]) : 0;
  const r = id ? await H.get(id) : null;
  if (id && !r) return ctx.fail(HOME, 'সারিটা পাওয়া যায়নি।');
  if (ctx.method === 'POST') {
    const b = await ctx.body();
    const { row, missing } = await H.save(id, b);
    if (!id) {
      // a new row goes on the home page straight away, at the end
      const list = db.jsonSetting(ctx.settings, 'home_sections', []);
      if (!list.includes(H.keyOf(row!.id))) await db.setSetting('home_sections', JSON.stringify([...list, H.keyOf(row!.id)]));
    }
    await ctx.log(id ? 'home_row_edit' : 'home_row_add', 'home_row', row!.id, row!.title);
    if (missing.length) return ctx.fail(`${BASE}/${row!.id}`, `সেভ হয়েছে, কিন্তু এই SKU গুলো পাওয়া যায়নি: ${missing.join(', ')}`);
    return ctx.back(`${BASE}/${row!.id}`, 'saved');
  }
  const v = r || { title: '', sub: '', source: 'category', ref: '', sort: 'popular', lim: 16, badge: '', style: 'rail', in_stock_only: false, product_ids: [] };
  const [cats, brands, skus, preview] = await Promise.all([
    catalog.listCategories({ includeInactive: false }),
    db.q('SELECT id, name FROM brands ORDER BY name').catch(() => []),
    H.skusOf(v.product_ids),
    r ? H.productsFor(r, {}).catch(() => []) : [],
  ]);
  const show = (src?: Loose) => raw(`data-show-when="source=${src}"`);
  const body = toHtml(<><h1>{(r ? "✏️ সারি এডিট" : "➕ নতুন সারি")}</h1><Val v={ui.flash(ctx.flash)} /><p><a href={A(HOME)}>← লোগো, রং ও হোমপেজ (সব সারি)</a></p><form method="post" className="form panel" data-row-form=""><Val v={ui.field('সারির নাম (হোমপেজে বড় করে দেখাবে)', ui.input('title', v.title, { required: true, maxlength: 80, placeholder: 'যেমন: 🔥 শীতের অফার' }))} />{' '}<Val v={ui.field('নামের নিচে ছোট লেখা (ঐচ্ছিক)', ui.input('sub', v.sub, { maxlength: 160, placeholder: 'যেমন: সীমিত সময়ের জন্য' }))} />{' '}<Val v={ui.field('কোন পণ্য দেখাবে', ui.select('source', Object.entries(H.SOURCES), v.source))} /><div {...attrs(show('category'))}><Val v={ui.field('ক্যাটাগরি', ui.select('ref_category', [['', '— বাছুন —'], ...cats.map((c) => [c.slug, `${c.icon || ''} ${c.name}`])], v.source === 'category' ? v.ref : ''))} /></div><div {...attrs(show('brand'))}><Val v={ui.field('ব্র্যান্ড', ui.select('ref_brand', [['', '— বাছুন —'], ...brands.map((x) => [String(x.id), x.name])], v.source === 'brand' ? v.ref : ''))} /></div><div {...attrs(show('search'))}><Val v={ui.field('যে শব্দ নামে/বর্ণনায় আছে', ui.input('ref_search', v.source === 'search' ? v.ref : '', { maxlength: 60, placeholder: 'যেমন: রিমোট' }))} /></div><div {...attrs(show('products'))}><Val v={ui.field('পণ্যের SKU (কমা দিয়ে, যে ক্রমে লিখবেন সেই ক্রমে দেখাবে)', ui.textarea('skus', skus, { rows: 2, placeholder: 'যেমন: 12, 45, 7, 103' }))} /></div><div className="field-row" {...attrs(show('price'))}><Val v={ui.field('সর্বনিম্ন দাম (৳)', ui.input('min_price', v.min_price ?? '', { type: 'number', step: '0.01', min: 0 }))} />{' '}<Val v={ui.field('সর্বোচ্চ দাম (৳)', ui.input('max_price', v.max_price ?? '', { type: 'number', step: '0.01', min: 0 }))} /></div><div className="field-row"><Val v={ui.field('ক্রম', ui.select('sort', Object.entries(H.SORTS), v.sort))} />{' '}<Val v={ui.field('কয়টা পণ্য', ui.input('lim', v.lim, { type: 'number', min: 4, max: 32, class: 'w-num' }))} />{' '}<Val v={ui.field('দেখানোর ধরন', ui.select('style', Object.entries(H.STYLES), v.style))} /></div><Val v={ui.field('কার্ডের কোণে ছোট লেবেল (ঐচ্ছিক)', ui.input('badge', v.badge, { maxlength: 20, placeholder: 'যেমন: হট' }))} />{' '}<Val v={ui.check('in_stock_only', v.in_stock_only, 'শুধু স্টকে থাকা পণ্য দেখাও')} />{' '}<input type="hidden" name="ref" defaultValue={A(v.ref)} data-ref="" /><div className="form-actions sticky-actions"><button className="btn btn-lg">💾 সেভ করুন</button>{' '}{(r ? <a href="/" target="_blank">দোকানে দেখুন ↗</a> : null)}</div></form>{(r ? <section className="panel"><h2>👀 এই সারিতে এখন যা দেখাচ্ছে (<Val v={bn(preview.length)} />টি)</h2>{(preview.length ? <div className="row-preview">{L(preview.map((p) => <a className="rp" href={`/admin/products/${A(p.id)}`}><img src={A(p.image_id ? `/media/${p.image_id}/t` : '')} alt="" loading="lazy" /><span><Val v={p.name} /></span><b><Val v={ui.money(p.price)} /></b></a>))}</div> : <Val v={ui.empty('এই নিয়মে কোনো পণ্য পাওয়া যাচ্ছে না — ক্যাটাগরি/শব্দ/দাম বদলে দেখুন।')} />)}</section> : null)}{' '}{(r ? <form method="post" action={`${A(BASE)}/${A(r.id)}/delete`} data-confirm={`"${A(r.title)}" সারিটা মুছবেন? (রিসাইকেল বিনে যাবে)`}><button className="btn btn-sm btn-danger">🗑️ এই সারি মুছুন</button></form> : null)}<script nonce={A(cspNonce())} dangerouslySetInnerHTML={{ __html: "\n(function () {\n  var f = document.querySelector('[data-row-form]'); if (!f) return;\n  var src = f.querySelector('[name=source]'), ref = f.querySelector('[data-ref]');\n  function sync() {\n    f.querySelectorAll('[data-show-when]').forEach(function (el) { el.hidden = el.getAttribute('data-show-when') !== 'source=' + src.value; });\n  }\n  src.addEventListener('change', sync); sync();\n  f.addEventListener('submit', function () {\n    var pick = { category: 'ref_category', brand: 'ref_brand', search: 'ref_search' }[src.value];\n    ref.value = pick ? (f.querySelector('[name=' + pick + ']').value || '') : '';\n  });\n})();\n" }} /></>);
  return ctx.page(r ? 'সারি এডিট' : 'নতুন সারি', body, 'design');
}

async function remove(ctx: AdminCtx, m?: Loose) {
  const id = int(m[1]);
  await ctx.trash('home_row', id);
  const list = db.jsonSetting(ctx.settings, 'home_sections', []).filter((k?: Loose) => k !== H.keyOf(id));
  await db.setSetting('home_sections', JSON.stringify(list));
  await ctx.log('home_row_delete', 'home_row', id, '');
  return ctx.back(HOME, 'deleted');
}

export const routes = [
    { method: 'GET', path: BASE, perm: 'design', handler: (ctx: AdminCtx) => ctx.back(HOME) },
    { method: 'POST', path: `${BASE}/order`, perm: 'design', handler: saveOrder },
    { method: '*', path: `${BASE}/new`, perm: 'design', handler: (ctx: AdminCtx) => form(ctx, null) },
    { method: '*', path: /^\/admin\/design\/rows\/(\d+)$/, perm: 'design', handler: form },
    { method: 'POST', path: /^\/admin\/design\/rows\/(\d+)\/delete$/, perm: 'design', handler: remove },
  ];
export { allLabels };
