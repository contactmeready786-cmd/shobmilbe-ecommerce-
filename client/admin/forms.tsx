// সবমিলবে admin — product form (profit, cheap-part rule, YouTube, duplicate check), the product search picker,
// and the forms built on it: orders, bundles / kits, purchases; plus the courier send form.
import { h, Fragment, paint, serverHtml } from '../jsx.js';
import { $, $all, bn, hit } from '../dom.js';
import { fillGeo } from '../shop/geo.js';
import { getJSON, markChanged, money, toast } from './core.js';

void Fragment;
type Found = { id: number; name: string; sku?: string; price: number; stock: number; cost?: number; type?: string; image?: string; emoji?: string };
const field = (f: HTMLFormElement, n: string) => f.elements.namedItem(n) as HTMLInputElement | null;
const num = (el: Element | null | undefined) => Number((el as HTMLInputElement | null)?.value) || 0;
const Pic = ({ p, cls = 'pe' }: { p: { image?: string; emoji?: string }; cls?: string }) => (p.image ? <img src={p.image} alt="" /> : <span className={cls}>{p.emoji || '📦'}</span>);

// ---------- duplicate product check (live, while the form is filled) ----------
function dupCheck(): void {
  const dupBox = $('[data-dup-box]');
  const form = $<HTMLFormElement>('[data-product-form]');
  if (!dupBox || !form) return;
  const out = $('[data-dup-result]', dupBox)!;
  const allowRow = $('[data-dup-allow]', dupBox);
  const noperm = $('[data-dup-noperm]', dupBox);
  const allowInput = allowRow ? $<HTMLInputElement>('input[name="allow_duplicate"]', allowRow) : null;
  const val = (n: string) => field(form, n)?.value || '';
  let seq = 0;
  let timer = 0;
  let lastKey = '';
  const check = async () => {
    const data = {
      id: dupBox.getAttribute('data-dup-id') || '', name: val('name').trim(), description: val('description'),
      images: val('images').split(',').filter(Boolean), product_type: val('product_type'), youtube_url: val('youtube_url'),
    };
    if (!data.name && !data.images.length) return;
    const key = JSON.stringify([data.name, data.images, data.description.length, data.youtube_url]);
    if (key === lastKey) return;
    lastKey = key;
    const my = ++seq;
    dupBox.classList.add('checking');
    paint(out, <p className="muted small">🔍 যাচাই হচ্ছে — দোকানে একই পণ্য আছে কি না দেখা হচ্ছে…</p>);
    try {
      const r = await fetch('/admin/api/products/dup-check', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
      // lib/admin/products.tsx dupCheckApi: html = the look-alikes, drawn by the server (there whenever matches are)
      const j = (await r.json()) as { error?: string; imagesWaiting?: number; blocked?: boolean; matches?: unknown[]; html?: string };
      if (my !== seq) return;
      dupBox.classList.remove('checking', 'is-block', 'is-warn');
      if (j.error) { paint(out, <p className="warn small">{j.error}</p>); return; }
      const waiting = j.imagesWaiting ? <p className="small muted">{bn(j.imagesWaiting)}টি ছবির ছাপ এখনো তৈরি হয়নি, তাই শুধু হুবহু একই ফাইল ধরা যাবে।</p> : null;
      if (!j.matches?.length) {
        paint(out, <p className="good small">✅ একই রকম কোনো পণ্য পাওয়া যায়নি{data.images.length ? ` (নাম আর ${bn(data.images.length)}টি ছবি মিলিয়ে দেখা হয়েছে)` : ' (নাম মিলিয়ে দেখা হয়েছে — ছবি দিলে ছবিও মেলানো হবে)'}।</p>, waiting);
      } else {
        // the list of look-alikes is drawn by the server (React) and sent as ready-made HTML
        dupBox.classList.add(j.blocked ? 'is-block' : 'is-warn');
        const list = <div />;
        serverHtml(list, j.html!);
        paint(out, <p className="dup-head">{j.blocked ? '⛔ এই পণ্যটি দোকানে আগে থেকেই আছে বলে মনে হচ্ছে। এভাবে সেভ দিলে আটকে যাবে:' : '⚠️ কাছাকাছি কিছু পণ্য আছে। একবার দেখে নিন (সেভ আটকাবে না):'}</p>, ...Array.from(list.childNodes), waiting);
      }
      if (allowRow) allowRow.hidden = !(j.blocked || allowInput?.checked);
      if (noperm) noperm.hidden = !j.blocked;
      const cancel = $('[data-dup-cancel]', dupBox);
      if (cancel) cancel.hidden = !j.blocked;
    } catch {
      if (my !== seq) return;
      dupBox.classList.remove('checking');
      lastKey = '';
      paint(out, <p className="muted small">এখন যাচাই করা গেল না (ইন্টারনেট?) — সেভ দেওয়ার সময় আবার যাচাই হবে।</p>);
    }
  };
  const later = (ms: number) => { clearTimeout(timer); timer = window.setTimeout(check, ms); };
  field(form, 'name')?.addEventListener('input', () => later(900));
  field(form, 'name')?.addEventListener('blur', () => later(50));
  field(form, 'description')?.addEventListener('change', () => later(50));
  field(form, 'youtube_url')?.addEventListener('change', () => later(50));
  document.addEventListener('sm:images', () => later(200));
  // "বন্ধ করুন / চালু করুন" and "মুছুন" beside a product found as a duplicate
  dupBox.addEventListener('click', async (e) => {
    const b = hit(e, '[data-dup-act]');
    const box = b?.closest('[data-dup-acts]');
    if (!b || !box) return;
    const id = box.getAttribute('data-id') || '';
    const name = box.getAttribute('data-name') || '';
    const item = box.closest('.dup-item');
    const act = b.getAttribute('data-dup-act');
    const body = new URLSearchParams();
    const url = `/admin/products/${id}${act === 'delete' ? '/delete' : '/active'}`;
    if (act === 'delete') {
      if (!confirm(`"${name}" পণ্যটি মুছবেন? দোকান থেকে সরে যাবে, রিসাইকেল বিনে থাকবে। শুধু লুকাতে চাইলে "বন্ধ করুন" চাপুন।`)) return;
      body.set('back', '/admin/products');
    } else if (!b.getAttribute('data-on')) body.set('active', '1');
    const buttons = $all<HTMLButtonElement>('button', box);
    for (const x of buttons) x.disabled = true;
    try {
      const r = await fetch(url, { method: 'POST', credentials: 'same-origin', headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() });
      if (!r.ok) throw new Error('সেভ হয়নি, আবার চেষ্টা করুন');
      if (act === 'delete') {
        if (id === dupBox.getAttribute('data-dup-id')) { location.href = '/admin/products?msg=deleted'; return; }
        item?.classList.add('dup-gone');
        paint(box, <span className="small">🗑️ মুছে ফেলা হয়েছে (রিসাইকেল বিনে)</span>);
        toast('পণ্যটি মুছে ফেলা হয়েছে');
        lastKey = '';
        later(300); // check again: the block may be gone now
        return;
      }
      const on = !b.getAttribute('data-on');
      b.setAttribute('data-on', on ? '1' : '');
      b.textContent = on ? '🚫 বন্ধ করুন' : '✅ চালু করুন';
      item?.classList.toggle('dup-off', !on);
      toast(on ? 'পণ্যটি দোকানে আবার দেখাচ্ছে' : 'পণ্যটি দোকান থেকে লুকানো হয়েছে');
    } catch (err) { toast((err as Error).message); }
    for (const x of buttons) x.disabled = false;
  });
  // editing an existing product: check once when the page opens (unless the page already shows a result)
  if (!$('.dup-list', dupBox) && dupBox.getAttribute('data-dup-id')) later(400);
}

// ---------- product form helpers ----------
function productForm(): void {
  const pform = $('[data-product-form]');
  if (!pform) return;
  const price = $<HTMLInputElement>('[data-price]', pform);
  const cost = $<HTMLInputElement>('[data-cost]', pform);
  const marginBox = $('[data-margin]', pform);
  const calc = () => {
    if (!marginBox) return;
    const p = num(price);
    const c = num(cost);
    if (!p || !c) { marginBox.textContent = ''; return; }
    const m = p - c;
    paint(marginBox, 'প্রতি পিসে লাভ: ', <b className={m < 0 ? 'warn' : 'good'}>{money(m)}</b>, ` (${bn(((m / p) * 100).toFixed(1))}%)`);
  };
  price?.addEventListener('input', calc);
  // cheap parts: show how many a customer must buy at this price (Admin → সেটিংস → কম দামের পণ্যের নিয়ম)
  const ruleBox = $('[data-small-rule]', pform);
  if (ruleBox && price) {
    // written by lib/admin/products.tsx (the shop's small-item rule); {} if missing
    let R: { on?: false } | { on: true; cap: number; minVal: number; maxVal: number; maxQty: number } = {};
    try { R = JSON.parse(ruleBox.getAttribute('data-small-rule') || '{}'); } catch { R = {}; }
    const showRule = () => {
      const p = num(price);
      if (!R.on || p <= 0 || p > R.cap + 1e-9) { ruleBox.hidden = true; return; }
      const min = Math.max(1, Math.ceil(R.minVal / p - 1e-9));
      const max = Math.max(R.maxQty, min, Math.floor(R.maxVal / p + 1e-9));
      ruleBox.hidden = false;
      paint(ruleBox, '🔩 কম দামের পণ্য: দোকানে দাম দেখাবে ', <b>{money(p)} / পিস</b>, ', কিন্তু কাস্টমারকে কমপক্ষে ', <b>{bn(min)}টি</b>,
        ` (${money(min * p)}) নিতে হবে। সর্বোচ্চ ${bn(max)}টি। `, <a href="/admin/settings#small-items">নিয়ম বদলান</a>);
    };
    price.addEventListener('input', showRule);
    showRule();
  }
  cost?.addEventListener('input', calc);
  calc();
  const yt = $<HTMLInputElement>('[data-yt]', pform);
  yt?.addEventListener('input', () => {
    const m = /youtu\.?be|youtube/i.test(yt.value) ? yt.value.match(/(?:[?&;]v=|youtu\.be\/|\/(?:embed|shorts|live|v|e)\/)([A-Za-z0-9_-]{11})(?![A-Za-z0-9_-])/i) : null;
    paint($('[data-yt-preview]'), m ? <img src={`https://i.ytimg.com/vi/${m[1]}/hqdefault.jpg`} alt="" /> : null);
  });
}

// ---------- product search picker (order items, bundle parts, purchases) ----------
function picker(input: HTMLInputElement | null, results: HTMLElement | null, onPick: (p: Found) => void, opts: { all?: boolean; type?: string } = {}): void {
  if (!input || !results) return;
  let timer = 0;
  let list: Found[] = [];
  const run = async () => {
    const q = input.value.trim();
    try {
      const j = await getJSON<{ products: Found[] }>(`/admin/api/products/search?q=${encodeURIComponent(q)}${opts.all ? '&all=1' : ''}${opts.type ? `&type=${opts.type}` : ''}`);
      list = j.products;
      paint(results, list.length ? list.map((p, i) =>
        <li><button type="button" data-i={String(i)}><Pic p={p} /><span><b>{p.name}</b><small>{p.sku ? `${p.sku} · ` : ''}{money(p.price)} · স্টক {bn(p.stock)}</small></span></button></li>)
        : <li className="muted small">কিছু পাওয়া যায়নি</li>);
    } catch (e) { paint(results, <li className="warn small">{(e as Error).message}</li>); }
    results.hidden = false;
  };
  results.addEventListener('click', (e) => {
    const b = hit(e, '[data-i]');
    if (!b) return;
    onPick(list[Number(b.getAttribute('data-i'))]);
    results.hidden = true;
    input.value = '';
    input.focus();
  });
  input.addEventListener('input', () => { clearTimeout(timer); timer = window.setTimeout(run, 250); });
  input.addEventListener('focus', () => void run());
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('[data-i]', results)?.click(); } });
  document.addEventListener('click', (e) => { if (!hit(e, '.item-picker')) results.hidden = true; });
}

// order create/edit
function orderForm(): void {
  const oform = $<HTMLFormElement>('[data-order-form]');
  if (!oform) return;
  const rows = $('[data-item-rows]', oform)!;
  const none = $('[data-no-items]', oform);
  const deliveryIn = $<HTMLInputElement>('[data-delivery]', oform)!;
  const discountIn = $<HTMLInputElement>('[data-discount]', oform)!;
  const city: string[] = JSON.parse(oform.getAttribute('data-city') || '[]');
  const total = () => {
    let sub = 0;
    for (const r of $all('[data-row]', rows)) {
      const line = num($('[data-price]', r)) * num($('[data-qty]', r));
      const lt = $('[data-line-total]', r);
      if (lt) lt.textContent = money(line);
      sub += line;
    }
    if (none) none.hidden = !!$('[data-row]', rows);
    const g = $('[data-grand]', oform);
    if (g) g.textContent = money(Math.max(0, Math.round(sub - num(discountIn) + num(deliveryIn)))); // whole taka, like the server
  };
  picker($('[data-product-search]', oform), $('[data-product-results]', oform), (p) => {
    const exist = $all<HTMLInputElement>('input[name="item_id[]"]', rows).find((i) => {
      const k = $<HTMLInputElement>('input[name="item_kind[]"]', i.closest('tr'));
      return i.value === String(p.id) && k?.value !== 'gift';
    });
    if (exist) { const q = $<HTMLInputElement>('[data-qty]', exist.closest('tr'))!; q.value = String(Number(q.value) + 1); total(); return; }
    rows.appendChild(
      <tr data-row=""><td>{p.name}{p.sku ? <><br /><span className="small muted">{p.sku}</span></> : null}<br /><span className="small muted">স্টক {bn(p.stock)}</span>
        <input type="hidden" name="item_id[]" value={String(p.id)} /><input type="hidden" name="item_kind[]" value="" /><input type="hidden" name="item_note[]" value="" /></td>
        <td className="num"><input type="number" name="item_price[]" value={String(p.price)} min="0" step="0.01" className="w-num" data-price="" /></td>
        <td className="num"><input type="number" name="item_qty[]" value="1" min="1" className="w-num" data-qty="" /></td>
        <td className="num" data-line-total="" /><td><button type="button" className="link-btn danger" data-remove-row="" aria-label="সরান">✕</button></td></tr>);
    total();
  });
  oform.addEventListener('input', total);
  oform.addEventListener('click', (e) => { const b = hit(e, '[data-remove-row]'); if (b) { b.closest('tr')?.remove(); total(); } });
  void fillGeo(oform, ['থানা বাছুন', 'আগে জেলা']).then((g) => {
    if (!g) return;
    const setFee = () => {
      if (!g.district.value) return;
      const inCity = g.district.value === 'Dhaka' && city.includes(g.thana.value);
      let zones: { fee: unknown; districts?: string[] }[] = [];
      try { zones = JSON.parse(oform.getAttribute('data-zones') || '[]'); } catch { /* none */ }
      const zone = inCity ? null : zones.find((z) => (z.districts || []).includes(g.district.value));
      deliveryIn.value = String(inCity ? oform.getAttribute('data-dhaka') : zone ? zone.fee : oform.getAttribute('data-outside'));
      total();
    };
    g.district.addEventListener('change', setFee);
    g.thana.addEventListener('change', setFee);
  });
  total();
}

// bundle parts (and 🧰 project kits)
function bundleForm(): void {
  const bundle = $('[data-bundle]');
  if (!bundle) return;
  const brows = $('[data-bundle-rows]', bundle)!;
  const kit = bundle.hasAttribute('data-kit');
  const sum = () => {
    let s = 0;
    const rows = $all('[data-row]', brows);
    for (const r of rows) {
      const line = (Number(r.getAttribute('data-price')) || 0) * num($('[data-qty]', r));
      s += line;
      const lc = $('[data-line]', r);
      if (lc) lc.textContent = money(line);
    }
    const empty = $('[data-bundle-empty]', bundle);
    if (empty) empty.hidden = rows.length > 0;
    const p = num($('[data-price]'));
    paint($('[data-bundle-sum]', bundle), s ? <>আলাদা কিনলে মোট দাম: <b>{money(s)}</b>{p ? (p < s ? <> · প্যাকেজে কাস্টমারের সাশ্রয়: <b className="good">{money(s - p)}</b></> : <> · <span className="warn">প্যাকেজের দাম আলাদা দামের চেয়ে বেশি!</span></>) : null}</> : null);
  };
  const changed = () => { const f = bundle.closest('form'); if (f) markChanged(f); };
  picker($('[data-bundle-search]', bundle), $('[data-bundle-results]', bundle), (p) => {
    if (p.type === 'bundle') { toast('বান্ডেলের ভেতরে আরেকটা বান্ডেল রাখা যায় না।'); return; }
    const have = $all<HTMLInputElement>('input[name="bundle_id[]"]', brows).find((i) => i.value === String(p.id));
    if (have) {
      const q = $<HTMLInputElement>('[data-qty]', have.closest('tr'))!;
      q.value = String((Number(q.value) || 0) + 1);
      sum(); changed();
      toast('আগে থেকেই আছে — পরিমাণ ১ বাড়ানো হলো');
      return;
    }
    brows.appendChild(
      <tr data-row="" data-price={String(p.price)}>
        <td className="b-img"><Pic p={p} /></td>
        <td className="b-name"><b>{p.name}</b>{p.sku ? <><br /><span className="small muted">SKU {p.sku}</span></> : null}<input type="hidden" name="bundle_id[]" value={String(p.id)} />
          {/* 🧰 a kit: each part may carry a short note */}
          {kit ? <input name="kit_note[]" value="" maxlength="120" placeholder="ছোট নোট (ঐচ্ছিক)" className="kit-note" /> : null}</td>
        <td className="num">{money(p.price)}</td>
        <td className="num"><span className="qty-step"><button type="button" className="qs-btn" data-bq="-1" aria-label="কমান">−</button><input type="number" name="bundle_qty[]" value="1" min="1" className="w-num" data-qty="" /><button type="button" className="qs-btn" data-bq="1" aria-label="বাড়ান">+</button></span></td>
        <td className="num" data-line="" /><td className="num">{bn(p.stock)}</td>
        {kit ? <td><label className="check"><input type="checkbox" name="kit_opt[]" value={String(p.id)} /> ঐচ্ছিক</label></td> : null}
        <td className="b-act"><a className="btn btn-sm btn-ghost" href={`/admin/products/${p.id}`} target="_blank" rel="noopener">✏️ এডিট</a><button type="button" className="btn btn-sm btn-danger" data-remove-row="">🗑️ মুছুন</button></td></tr>);
    sum(); changed();
  }, { all: true, type: 'single' });
  bundle.addEventListener('input', sum);
  document.addEventListener('input', (e) => { if ((e.target as Element).hasAttribute?.('data-price')) sum(); });
  bundle.addEventListener('click', (e) => {
    const st = hit(e, '[data-bq]');
    if (st) {
      const q = $<HTMLInputElement>('[data-qty]', st.closest('td'))!;
      q.value = String(Math.max(1, (Number(q.value) || 1) + Number(st.getAttribute('data-bq'))));
      sum(); changed();
      return;
    }
    const b = hit(e, '[data-remove-row]');
    if (!b) return;
    const name = $('.b-name b', b.closest('tr'))?.textContent || 'পণ্যটি';
    if (!confirm(`"${name}" বান্ডেল থেকে সরাবেন? (পণ্যটি দোকান থেকে মুছবে না)`)) return;
    b.closest('tr')?.remove();
    sum(); changed();
  });
  sum();
}

// purchase form
function purchaseForm(): void {
  const pur = $<HTMLFormElement>('[data-purchase-form]');
  if (!pur) return;
  const prow = $('[data-item-rows]', pur)!;
  const pnone = $('[data-no-items]', pur);
  const total = () => {
    let sub = 0;
    for (const r of $all('[data-row]', prow)) {
      const line = num($('[data-cost]', r)) * num($('[data-qty]', r));
      const lt = $('[data-line-total]', r);
      if (lt) lt.textContent = money(line);
      sub += line;
    }
    const v = (n: string) => num(field(pur, n));
    if (pnone) pnone.hidden = !!$('[data-row]', prow);
    const g = $('[data-grand]', pur);
    if (g) g.textContent = money(sub - v('discount') + v('shipping') + v('other_cost') + v('vat'));
  };
  const PACK_HINT = 'প্যাকেটের তথ্য দিলে পরিমাণ আর প্রতি পিসের দাম নিজে থেকে বসবে';
  const addRow = (p: Found) => {
    if (p.type === 'bundle') { toast('বান্ডেল কেনা যায় না — ভেতরের পণ্যগুলো আলাদা করে যোগ করুন।'); return; }
    if ($all<HTMLInputElement>('input[name="item_id[]"]', prow).some((i) => i.value === String(p.id))) { toast('এই পণ্য আগেই যোগ করা আছে'); return; }
    prow.appendChild(
      <tr data-row=""><td>{p.name}{p.sku ? <><br /><span className="small muted">SKU {p.sku}</span></> : null}<br /><span className="small muted">এখন স্টক {bn(p.stock)} · বিক্রি দাম {money(p.price)}</span><input type="hidden" name="item_id[]" value={String(p.id)} />
        <div className="pack-box" data-pack-box="" hidden><b className="small">📦 প্যাকেট হিসেবে কিনেছেন</b><div className="pack-grid">
          <label className="small">কয় প্যাকেট<input type="number" min="1" step="1" value="1" data-pk-n="" /></label>
          <label className="small">প্রতি প্যাকেটে পিস<input type="number" min="1" step="1" placeholder="যেমন ১০০০" data-pk-per="" /></label>
          <label className="small">প্রতি প্যাকেটের দাম ৳<input type="number" min="0" step="0.01" placeholder="যেমন ২০০" data-pk-price="" /></label></div>
          <span className="small muted" data-pk-out="">{PACK_HINT}</span></div></td>
        <td className="num"><input type="number" name="item_qty[]" value="1" min="1" className="w-num" data-qty="" required /></td>
        <td className="num"><input type="number" name="item_cost[]" value={String(p.cost || '')} min="0" step="0.01" className="w-num" data-cost="" required /><br /><button type="button" className="link-btn small" data-pack-open="">📦 প্যাকেট দামে</button></td>
        <td className="num" data-line-total="" /><td><button type="button" className="btn btn-sm btn-danger" data-remove-row="">🗑️ মুছুন</button></td></tr>);
    total();
  };
  picker($('[data-product-search]', pur), $('[data-product-results]', pur), (p) => { addRow(p); markChanged(pur); }, { all: true });
  try { (JSON.parse(pur.getAttribute('data-prefill') || '[]') as Found[]).forEach(addRow); } catch { /* nothing to prefill */ }
  // pack maths: 2 packets × 1000 pcs at ৳200 each → 2000 pcs at ৳0.20
  pur.addEventListener('click', (e) => {
    const o = hit(e, '[data-pack-open]');
    const bx = o && $('[data-pack-box]', o.closest('tr'));
    if (!bx) return;
    bx.hidden = !bx.hidden;
    if (!bx.hidden) $('[data-pk-per]', bx)?.focus();
  });
  pur.addEventListener('input', (e) => {
    const tr = hit(e, '[data-pack-box]')?.closest('tr');
    if (!tr) return;
    const n = num($('[data-pk-n]', tr));
    const per = num($('[data-pk-per]', tr));
    const price = num($('[data-pk-price]', tr));
    const out = $('[data-pk-out]', tr)!;
    if (!n || !per) { out.textContent = PACK_HINT; return; }
    const unit = Math.round((price / per) * 100) / 100;
    $<HTMLInputElement>('[data-qty]', tr)!.value = String(n * per);
    if (price) $<HTMLInputElement>('[data-cost]', tr)!.value = String(unit);
    paint(out, '➡ মোট ', <b>{bn(n * per)} পিস</b>, price ? <>, প্রতি পিস <b>{money(unit)}</b>{Math.abs(unit * per - price) > 0.009 ? ' (পয়সা গোল করা)' : ''}</> : null);
    total();
  });
  pur.addEventListener('input', total);
  pur.addEventListener('click', (e) => {
    const b = hit(e, '[data-remove-row]');
    if (b && confirm('এই পণ্যটি পারচেজ থেকে সরাবেন?')) { b.closest('tr')?.remove(); total(); markChanged(pur); }
  });
  total();
}

// ---------- courier send form ----------
function courierForm(): void {
  const cf = $<HTMLFormElement>('[data-courier-form]');
  if (!cf) return;
  const pick = $<HTMLSelectElement>('[data-courier-pick]', cf)!;
  const loaded = new Set<string>();
  type CourierRows = { rows: { id: number | string; name: string }[] }; // the courier's cities / zones / areas
  const options = (rows: CourierRows['rows'], first: string) => [<option value="">{first}</option>, ...rows.map((r) => <option value={String(r.id)}>{r.name}</option>)];
  const showExtra = () => {
    const c = pick.value;
    for (const x of $all('[data-courier-extra]', cf)) x.hidden = x.getAttribute('data-courier-extra') !== c;
    if (c === 'pathao' && !loaded.has('pathao')) {
      loaded.add('pathao');
      const citySel = $<HTMLSelectElement>('[data-pathao="cities"]', cf)!;
      const zoneSel = $<HTMLSelectElement>('[data-pathao="zones"]', cf)!;
      getJSON<CourierRows>('/admin/api/courier/pathao?kind=cities').then((j) => paint(citySel, options(j.rows, 'অটো (ঠিকানা থেকে)')))
        .catch((e: Error) => toast(`Pathao শহরের লিস্ট আনা যায়নি: ${e.message}`));
      citySel.addEventListener('change', () => {
        paint(zoneSel, <option value="">অটো</option>);
        if (!citySel.value) return;
        getJSON<CourierRows>(`/admin/api/courier/pathao?kind=zones&parent=${citySel.value}`).then((j) => paint(zoneSel, options(j.rows, 'অটো'))).catch(() => {});
      });
    }
    if (c === 'redx' && !loaded.has('redx')) {
      loaded.add('redx');
      const aSel = $<HTMLSelectElement>('[data-redx-area]', cf)!;
      const aName = $<HTMLInputElement>('[data-redx-area-name]', cf)!;
      getJSON<CourierRows>(`/admin/api/courier/redx?district=${encodeURIComponent(cf.getAttribute('data-district') || '')}`).then((j) => paint(aSel, options(j.rows, 'এরিয়া বাছুন')))
        .catch((e: Error) => { paint(aSel, <option value="">লোড হয়নি</option>); toast(e.message); });
      aSel.addEventListener('change', () => { aName.value = aSel.options[aSel.selectedIndex].text; });
    }
  };
  pick.addEventListener('change', showExtra);
  showExtra();
  cf.addEventListener('submit', () => { const b = $<HTMLButtonElement>('button', cf); if (b) { b.disabled = true; b.textContent = 'পাঠানো হচ্ছে…'; } });
}

export function startForms(): void {
  for (const [name, start] of [['duplicate check', dupCheck], ['product form', productForm], ['order form', orderForm], ['bundle form', bundleForm], ['purchase form', purchaseForm], ['courier form', courierForm]] as [string, () => void][]) {
    try { start(); } catch (e) { console.error(`সবমিলবে admin: ${name} could not start`, e); }
  }
}
