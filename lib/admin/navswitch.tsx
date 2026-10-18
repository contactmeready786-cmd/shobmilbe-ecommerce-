// On/off switches for the buttons in the store's top menu (সব পণ্য, অফার, ব্লগ, অর্ডার ট্র্যাক, লাইভ স্কোর, কার্ট).
// The same switch shows up on the admin page each button belongs to (blog switch on the blog page, etc.)
// and all of them together on "হেডার ও ফুটার মেনু".

// Buttons that are not part of the editable link list.
import { Val, attrValue, jsxList } from '../react/html';
import { list, str } from '../util';
import * as db from '../db';
import * as $marketing from './marketing';
import type { AdminCtx, Body, Loose, Settings, MenuLink } from '../types';
const FIXED: Record<string, Loose> = {
  live: { key: 'nav_live', label: 'লাইভ স্কোর', desc: 'ক্রিকেট বা ফুটবল স্কোর চালু থাকলে তবেই এই বাটন দেখা যায়' },
  cart: { key: 'nav_cart', label: 'কার্ট', desc: 'বন্ধ করলে উপরের কার্ট আইকন লুকাবে। "কার্টে যোগ" আর "এখনই কিনুন" বাটন আগের মতোই কাজ করবে' },
};
// Links in the store's footer (bottom of every page). [setting, label, column]
const FOOTER: Record<string, Loose> = {
  products: { key: 'foot_products', label: 'সব পণ্য', where: 'ফুটারের "কেনাকাটা" কলামে' },
  offer: { key: 'foot_offer', label: 'অফার', where: 'ফুটারের "কেনাকাটা" কলামে' },
  track: { key: 'foot_track', label: 'অর্ডার ট্র্যাক করুন', where: 'ফুটারের "কেনাকাটা" কলামে' },
  blog: { key: 'foot_blog', label: 'ব্লগ', where: 'ফুটারের "কেনাকাটা" কলামে' },
  contact: { key: 'foot_contact', label: 'যোগাযোগ (ফোন, WhatsApp, ইমেইল, ঠিকানা)', where: 'ফুটারের ডান পাশের "যোগাযোগ" কলাম' },
};

function menuRows(s: Settings) { return db.jsonSetting<MenuLink[]>(s, 'header_menu', []); }
function isOn(row: { on: boolean; }) { return row.on !== false; }

// Small panel with switches for the given menu links (by url) and fixed buttons ('live', 'cart').
// Every switch saves the moment it is clicked.
function box(ctx: AdminCtx, { urls = [], fixed = [], footer = [], back, note }: Body = {}) {
  if (!ctx.can('design')) return '';
  const s = ctx.settings;
  const rows = menuRows(s).filter((r) => urls.includes(r.url));
  const top = [
    ...rows.map((r: Loose) => ({ id: 'url:' + r.url, on: isOn(r), title: `"${r.label}" বাটন`, desc: `জায়গা: উপরের মেনু, সার্চ বারের পাশে · লিংক: ${r.url}` })),
    ...fixed.map((k: string | number) => ({ id: k, on: s[FIXED[k].key] !== '0', title: `"${FIXED[k].label}" বাটন`, desc: `জায়গা: উপরের মেনু · ${FIXED[k].desc}` })),
  ];
  const bottom = footer.map((k: string) => ({ id: 'foot:' + k, on: s[FOOTER[k].key] !== '0', title: `"${FOOTER[k].label}" লিংক`, desc: `জায়গা: পেজের একদম নিচে, ${FOOTER[k].where}` }));
  const items = [...top, ...bottom];
  if (!items.length) return '';
  // compact: one small chip per button, the long explanation sits in the chip's tooltip
  const chip = (it?: Loose) => <label className="nav-chip" title={attrValue(it.desc)}>{' '}<span className="nav-chip-t"><Val v={it.title} /></span>{' '}<span className="switch switch-sm"><input type="checkbox" name={'on_' + it.id} defaultValue="1" defaultChecked={!!(it.on)} data-autosubmit="" /><span className="switch-ui" aria-hidden="true"></span></span>{' '}</label>;
  const group = (title?: unknown, list?: Loose) => (list.length ? <div className="nav-chip-group"><span className="nav-chip-where"><Val v={title} /></span><Val v={list.map(chip)} /></div> : '');
  return <details className="panel nav-switch-box nav-compact"><summary><span>🧭 দোকানে এর বাটন ও লিংক</span><span className="nav-chip-sum">{jsxList(items.map((it) => <span className={`dot ${it.on ? 'on' : ''}`} title={`${attrValue(it.title)}: ${it.on ? 'চালু' : 'বন্ধ'}`}></span>))}{' '}<Val v={items.filter((i) => i.on).length} />/<Val v={items.length} />{' '}চালু</span></summary><form method="post" action="/admin/design/menus/toggle"><input type="hidden" name="back" defaultValue={attrValue(back)} />{' '}{jsxList(items.map((it) => <input type="hidden" name="keys[]" defaultValue={attrValue(it.id)} />))}{' '}{group('⬆ উপরের মেনু', top)}{' '}{group('⬇ নিচের ফুটার', bottom)}<p className="muted small nav-chip-note"><Val v={note || ''} />{' '}বন্ধ করলে শুধু লিংক লুকায়, পেজ মুছে যায় না। সব একসাথে:{' '}<a href="/admin/design/menus">হেডার ও ফুটার মেনু</a></p></form></details>;
}

async function toggle(ctx: AdminCtx) {
  const b = await ctx.body();
  const keys = list(b.keys);
  const rows = menuRows(ctx.settings);
  let rowsChanged = false;
  const fixedBody: Record<string, string> = {};
  const fixedKeys: unknown[] = [];
  for (const k of keys) {
    const on = !!b['on_' + k];
    if (k.startsWith('url:')) {
      const url = k.slice(4);
      for (const r of rows) if (r.url === url) { r.on = on; rowsChanged = true; }
    } else if (FIXED[k]) {
      fixedKeys.push(FIXED[k].key);
      if (on) fixedBody[FIXED[k].key] = '1';
    } else if (k.startsWith('foot:') && FOOTER[k.slice(5)]) {
      const key = FOOTER[k.slice(5)].key;
      fixedKeys.push(key);
      if (on) fixedBody[key] = '1';
    }
  }
  if (rowsChanged) await db.setSetting('header_menu', JSON.stringify(rows));
  const { saveKeys } = $marketing; // loaded here to avoid a require loop
  if (fixedKeys.length) await saveKeys(ctx, fixedKeys, fixedBody, { checkboxes: fixedKeys });
  else await ctx.reloadSettings();
  await ctx.log('settings', 'design', null, 'মেনু বাটন চালু/বন্ধ');
  const back = str(b.back, 200);
  return ctx.back(back.startsWith('/admin') ? back : '/admin/design/menus', 'saved');
}

export const routes = [{ method: 'POST', path: '/admin/design/menus/toggle', perm: 'design', handler: toggle }];
export { box, FIXED, FOOTER, isOn };
