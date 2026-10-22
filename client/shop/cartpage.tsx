// The cart page (/cart) and "these go with it", plus loading the cart's products and real prices for checkout.
import { h, Fragment, paint } from '../jsx.js';
import { $, bn, getJson, hit, money, postJson } from '../dom.js';
import type { QuoteAnswer } from '../api-types.js';
import { PRICES, limitText, minNote, minShort, minText, packText, readCart, rememberPacks, rule, say, toPacks, writeCart, type Cart } from './cart.js';

void Fragment;
export type Product = { id: number | string; slug: string; name: string; price: number; stock: number; image?: string; emoji?: string; preorder?: boolean; preorder_days?: number; weight?: number; packs?: number[];
  /** 🎨 a colour/size line: all colours/sizes of its product (lib/api/shop-read.ts cart) */
  vtitle?: string; variants?: VarOpt[] };
export type VarOpt = { id: number; label: string; price: number; stock: number };
export type Tier = { min_qty: number; price: number };
export type Line = { product: Product; qty: number; price: number; kind?: string; note?: string; base?: number; tiers?: Tier[] };
export type Gift = { name: string; note: string; qty: number; price: number; image?: string | null; emoji?: string | null };
export type Loaded = { cart: Cart; lines: Line[]; gifts: Gift[] };

export async function loadCart(): Promise<Loaded> {
  const cart = readCart();
  const ids = Object.keys(cart);
  if (!ids.length) return { cart, lines: [], gifts: [] };
  const data = await getJson<{ products: Product[] }>(`/api/cart?ids=${ids.join(',')}`);
  const known = new Set<string>();
  let changed = false;
  const lines: Line[] = data.products.map((p) => {
    const id = String(p.id);
    known.add(id);
    PRICES[id] = p.price;
    if (p.packs) rememberPacks(id, p.packs);
    const r = rule(p.price, id);
    const fixed = r.step > 1 ? toPacks(cart[id], r) : Math.min(Math.max(cart[id], r.min), r.max);
    if (fixed !== cart[id]) { cart[id] = fixed; changed = true; }
    return { product: p, qty: cart[id], price: p.price };
  });
  for (const id of ids) if (!known.has(id)) { delete cart[id]; changed = true; }
  if (changed) writeCart(cart);
  if (!lines.length) return { cart, lines, gifts: [] };
  // the server works out the real price of each line: flash sale, cheaper price for more pieces, free gifts
  try {
    const { j: qt } = await postJson<QuoteAnswer>('/api/quote', { items: lines.map((l) => ({ id: l.product.id, qty: l.qty })) });
    const byId = new Map((qt.lines || []).map((x) => [String(x.id), x]));
    for (const l of lines) {
      const x = byId.get(String(l.product.id));
      if (!x) continue;
      l.price = Number(x.price);
      l.kind = x.kind || '';
      l.note = x.note || '';
      l.base = Number(x.base);
      l.tiers = x.tiers || [];
    }
    return { cart, lines, gifts: qt.gifts || [] };
  } catch {
    return { cart, lines, gifts: [] };
  }
}

/** "10+ pieces ৳4 each" — the next cheaper step for this line, if any */
function nextTier(l: Line): string {
  const max = rule(l.product.price, String(l.product.id)).max;
  const t = (l.tiers || []).find((x) => x.min_qty > l.qty && x.min_qty <= max && x.price < l.price);
  return t ? `আরও ${bn(t.min_qty - l.qty)}টি নিলে প্রতিটা ${money(t.price)} করে পড়বে` : '';
}
export const giftTotal = (gifts: Gift[] = []): number => gifts.reduce((s, g) => s + g.price * g.qty, 0);
export const Thumb = ({ p }: { p: { image?: string | null; emoji?: string | null } }) =>
  <span className="cart-thumb">{p.image ? <img src={p.image} alt="" /> : (p.emoji || '📦')}</span>;

export function giftRows(gifts: Gift[], tag: 'li' | 'div'): Node[] {
  return (gifts || []).map((g) => h(tag, { className: 'cart-line gift-line' },
    <Thumb p={g} />,
    <div><b>{g.name}</b><br /><span className="small good">{g.note}</span><br />
      <span className="muted small">{bn(g.qty)}টি{g.price > 0 ? ` × ${money(g.price)}` : ''}</span></div>,
    <div className="line-total">{g.price > 0 ? money(g.price * g.qty) : <span className="good">ফ্রি</span>}</div>));
}

/** 📦 a pack product's line: one button per pack (pieces and total) — the customer picks the pack right here */
export function PackChoice({ l }: { l: Line }): HTMLElement | null {
  const id = String(l.product.id);
  const r = rule(l.product.price, id);
  if (r.step <= 1) return null;
  return (
    <div className="pack-choice"><span className="small">📦 প্যাক বাছুন:</span>
      <div className="pack-list">{r.packs.map((n) => {
        const on = n === l.qty;
        return <button type="button" className={`pack-opt ${on ? 'on' : ''}`} data-pack-set={id} data-pack={String(n)} aria-pressed={on ? 'true' : 'false'} disabled={n > r.max}>
          <b>{bn(n)} পিস</b><span>{money(Math.round(n * l.price * 100) / 100)}</span></button>;
      })}</div>
      {r.packs.includes(l.qty) ? null : <p className="small muted">এখন: {packText(l.qty, r)}</p>}
    </div>
  ) as HTMLElement;
}

// 🎨 a colour/size line: the customer switches colour / size right in the cart (and at checkout) — one dropdown per
// option ("রং", "সাইজ") when every label is "সাদা / Small"-like, else one dropdown of all of them
const VARS: Record<string, VarOpt[]> = {};
const partsOf = (s: string) => String(s || '').split('/').map((x) => x.trim());
export function VariantChoice({ l }: { l: Line }): HTMLElement | null {
  const p = l.product;
  const id = String(p.id);
  const list = p.variants || [];
  const cur = list.find((v) => String(v.id) === id);
  if (list.length < 2 || !cur) return null;
  VARS[id] = list;
  const n = partsOf(cur.label).length;
  const grouped = n >= 2 && list.every((v) => partsOf(v.label).length === n);
  const titles = partsOf(p.vtitle || '');
  if (!grouped) {
    return (<div className="var-choice"><label className="small">{p.vtitle || 'অপশন'}:{' '}
      <select data-var-line={id} data-g="all">{list.map((v) => <option value={String(v.id)} selected={String(v.id) === id} disabled={v.stock <= 0 && String(v.id) !== id}>{v.label}{v.stock <= 0 ? ' (স্টকে নেই)' : ''}</option>)}</select></label></div>) as HTMLElement;
  }
  const cp = partsOf(cur.label);
  return (<div className="var-choice">{Array.from({ length: n }, (_, g) => {
    const vals = [...new Set(list.map((v) => partsOf(v.label)[g]))];
    return <label className="small">{titles.length === n ? titles[g] : `অপশন ${bn(g + 1)}`}:{' '}
      <select data-var-line={id} data-g={String(g)}>{vals.map((val) => <option value={val} selected={val === cp[g]}>{val}</option>)}</select></label>;
  })}</div>) as HTMLElement;
}
/** The colour/size a changed dropdown points to (the exact combination, or the first in stock with the new value). */
export function variantTarget(sel: HTMLSelectElement): string | null {
  const id = sel.getAttribute('data-var-line') || '';
  const list = VARS[id];
  if (!list) return null;
  if (sel.getAttribute('data-g') === 'all') return sel.value;
  const box = sel.closest('.var-choice');
  const want = box ? [...box.querySelectorAll<HTMLSelectElement>('select')].map((x) => x.value) : [];
  const g = Number(sel.getAttribute('data-g'));
  const t = list.find((v) => partsOf(v.label).every((x, i) => x === want[i]))
    || list.find((v) => partsOf(v.label)[g] === sel.value && v.stock > 0) || list.find((v) => partsOf(v.label)[g] === sel.value);
  return t ? String(t.id) : null;
}
/** Moves a line to another colour/size (same number of pieces; the packs are checked again when the cart loads). */
export function swapInCart(cart: Cart, from: string, to: string | null): boolean {
  if (!to || to === from || !(from in cart)) return false;
  const q = cart[from];
  delete cart[from];
  cart[to] = (cart[to] || 0) + q;
  return true;
}

function CartLine({ l, over, pre }: { l: Line; over: boolean; pre: boolean }) {
  const p = l.product;
  const r = rule(p.price, String(p.id));
  const hint = nextTier(l);
  const pack = packText(l.qty, r);
  return (
    <li className="cart-line"><Thumb p={p} />
      <div><h3><a href={`/p/${p.slug}`}>{p.name}</a></h3>
        {l.note ? <p className="small good line-note">{l.note}</p> : null}
        <div className="cart-line-controls">
          <div className="qty sm" data-line={String(p.id)}><button type="button" data-d="-1" aria-label="কমান">−</button>
            <input type="number" min={String(r.min)} max={String(r.max)} step={String(r.step)} value={String(l.qty)} aria-label="পরিমাণ" /><button type="button" data-d="1" aria-label="বাড়ান">+</button></div>
          <button className="link-btn danger" data-remove={String(p.id)}>সরান</button>
          <span className="muted small">{l.base && l.price < l.base ? <><s>{money(l.base)}</s>{' '}</> : null}{money(l.price)} করে</span></div>
        {pack ? <p className="small pack-line">{pack} — প্রতি পিস {money(l.price)}</p> : null}
        <VariantChoice l={l} />
        <PackChoice l={l} />
        {hint ? <p className="small tier-hint">💡 {hint}</p> : null}
        {r.small ? <p className="muted small">🔩 কম দামের পণ্য: কমপক্ষে {bn(r.min)}টি ({money(r.min * p.price)})</p> : null}
        {over ? <p className="cart-warn">{p.stock > 0 ? `স্টকে আছে মাত্র ${bn(p.stock)}টি` : 'এখন স্টকে নেই'}</p> : null}
        {pre ? <p className="small preorder-line">⏳ প্রি-অর্ডার: {p.stock > 0 ? `${bn(p.stock)}টি এখনই, বাকি ${bn(l.qty - p.stock)}টি` : 'এই পণ্য'} স্টকে এলেই পাঠানো হবে{p.preorder_days ? ` (আনুমানিক ${bn(p.preorder_days)} দিন)` : ''}।</p> : null}
      </div><div className="line-total">{money(l.price * l.qty)}</div></li>
  );
}

export function startCartPage(): void {
  const root = $('[data-cart-page]');
  const sug = $('[data-cart-suggest]');
  if (root) {
    const render = async () => {
      try {
        const res = await loadCart();
        if (!res.lines.length) {
          paint(root, <div className="empty"><p>আপনার কার্ট এখন খালি।</p><a className="btn" href="/products">পণ্য দেখুন</a></div>);
          return;
        }
        let subtotal = 0;
        let problem = false;
        const items = res.lines.map((l) => {
          const p = l.product;
          const pre = !!p.preorder && l.qty > Math.max(0, p.stock); // ⏳ pre-order: the missing pieces are sent when they arrive
          const over = l.qty > p.stock && !p.preorder;
          if (over) problem = true;
          subtotal += l.price * l.qty;
          return <CartLine l={l} over={over} pre={pre} />;
        });
        subtotal += giftTotal(res.gifts);
        subtotal = Math.round(subtotal * 100) / 100;
        const freeMin = parseInt(root.getAttribute('data-free-min') || '', 10) || 0;
        paint(root,
          <div className="panel"><ul className="cart-lines">{items}{giftRows(res.gifts, 'li')}</ul>
            <div className="totals"><div className="grand"><span>পণ্যের মোট দাম</span><span>{money(subtotal)}</span></div></div>
            {freeMin > 0 ? <p className="muted small">{subtotal >= freeMin ? '🎉 আপনি ফ্রি ডেলিভারি পাচ্ছেন!' : `আরও ${money(freeMin - subtotal)} কিনলে ডেলিভারি ফ্রি।`}</p> : null}
            <p className="muted small">ডেলিভারি চার্জ পরের ধাপে এলাকা অনুযায়ী যোগ হবে।</p>
            {problem ? <p className="form-error">কিছু পণ্যের পরিমাণ স্টকের চেয়ে বেশি। পরিমাণ কমিয়ে নিন।</p> : null}
            {minShort(subtotal)
              ? <><p className="min-order-note">🔩 {minNote(subtotal)}</p><a className="btn btn-ghost btn-lg btn-block" href="/products">আরও পণ্য যোগ করুন</a></>
              : <a className="btn btn-amber btn-lg btn-block" href="/checkout">অর্ডার করতে এগিয়ে যান</a>}
            <p className="center small"><a href="/products">আরও পণ্য দেখুন</a></p></div>);
      } catch {
        paint(root, <p className="form-error">কার্ট লোড করা যায়নি। ইন্টারনেট সংযোগ দেখে পেজটি রিফ্রেশ করুন।</p>);
      }
    };
    void render();
    root.addEventListener('click', (e) => {
      const cart = readCart();
      const rm = hit(e, '[data-remove]');
      if (rm) { delete cart[rm.getAttribute('data-remove') || '']; writeCart(cart); void render(); return; }
      const pk = hit(e, '[data-pack-set]');
      if (pk) {
        const id = pk.getAttribute('data-pack-set') || '';
        cart[id] = toPacks(Number(pk.getAttribute('data-pack')) || 1, rule(PRICES[id] || 0, id));
        writeCart(cart);
        void render();
        return;
      }
      const step = hit(e, '[data-d]');
      if (!step) return;
      const id = step.parentElement?.getAttribute('data-line') || '';
      const pr = PRICES[id] || 0;
      const r = rule(pr, id);
      const want = (cart[id] || 1) + parseInt(step.getAttribute('data-d') || '0', 10) * r.step;
      if (want > r.max) { say(limitText(r.max)); return; }
      if (want < r.min) { say(r.small ? minText(r, pr) : r.step > 1 ? `কমপক্ষে ${bn(r.min)} পিসের একটা প্যাক থাকতে হবে। না চাইলে "সরান" চাপুন।` : 'কমপক্ষে ১টি থাকতে হবে। না চাইলে "সরান" চাপুন।'); return; }
      cart[id] = want;
      writeCart(cart);
      void render();
    });
    root.addEventListener('change', (e) => {
      const vs = hit<HTMLSelectElement>(e, 'select[data-var-line]');
      if (vs) {
        const cart = readCart();
        if (swapInCart(cart, vs.getAttribute('data-var-line') || '', variantTarget(vs))) { writeCart(cart); void render(); }
        return;
      }
      const box = hit(e, '[data-line]');
      if (!box) return;
      const cart = readCart();
      const id = box.getAttribute('data-line') || '';
      const pr = PRICES[id] || 0;
      const r = rule(pr, id);
      const v = parseInt((e.target as HTMLInputElement).value, 10) || 1;
      if (v > r.max) say(limitText(r.max));
      else if (v < r.min) say(r.step > 1 ? `কমপক্ষে ${bn(r.min)} পিসের একটা প্যাক থাকতে হবে।` : 'কমপক্ষে ১টি থাকতে হবে। না চাইলে "সরান" চাপুন।');
      else if (r.step > 1 && v % r.step) say(`এই পণ্য শুধু প্যাকে বিক্রি হয় — ${bn(r.step)} পিসের গুণিতকে নিতে হবে।`);
      cart[id] = r.step > 1 ? toPacks(v, r) : Math.min(r.max, Math.max(r.min, v));
      writeCart(cart);
      void render();
    });
    if (sug) sug.addEventListener('click', (e) => { if (hit(e, '[data-suggest-add]')) setTimeout(() => { void render(); void loadSuggest(sug); }, 50); });
  }
  if (sug) void loadSuggest(sug);
}

// ---------- cart: "these go with it" ----------
async function loadSuggest(sug: HTMLElement): Promise<void> {
  const ids = Object.keys(readCart());
  if (!ids.length) { sug.hidden = true; return; }
  try {
    const j = await getJson<{ products?: Product[] }>(`/api/suggest?ids=${ids.join(',')}`);
    const inCart = readCart();
    const list = (j.products || []).filter((p) => !inCart[String(p.id)]);
    sug.hidden = !list.length;
    paint($('[data-suggest-list]', sug), list.map((p) =>
      <li><Thumb p={p} /><a href={`/p/${p.slug}`}>{p.name}</a><b>{money(p.price)}</b>
        <button type="button" className="btn btn-sm btn-ghost" data-add={String(p.id)} data-name={p.name} data-price={String(p.price)} data-suggest-add="">+ কার্টে</button></li>));
  } catch { sug.hidden = true; }
}
