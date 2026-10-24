// 🎨 রং / সাইজ in the product form (lib/admin/products.tsx variantBuilder): the owner types the colours and the sizes
// (or taps the ready-made chips), presses "📋 দামের টেবিল তৈরি করুন" → one row per colour × size, made from the page's
// own <template> row. Rows already there keep what was typed; a combination taken away is switched "বন্ধ" (a saved
// one) or removed (a new one). Rows are copied from a hidden blank row (not a <template> — React must be able
// to take the page over). Picking a photo for one row puts it on the other rows of the same colour.

const split = (v: string) => [...new Set(v.split(/[,،\n]+/).map((x) => x.replace(/\//g, '-').replace(/\s+/g, ' ').trim().slice(0, 28)).filter(Boolean))];
const key = (b: string, c: string, s: string) => `${b.toLowerCase()}|${c.toLowerCase()}|${s.toLowerCase()}`;

export function startVariantBuilder(): void {
  const box = document.querySelector<HTMLElement>('[data-vb]');
  if (!box) return;
  const ci = box.querySelector<HTMLInputElement>('[data-vb-colors]');
  const si = box.querySelector<HTMLInputElement>('[data-vb-sizes]');
  const bi = box.querySelector<HTMLInputElement>('[data-vb-brands]'); // 🏷️ ব্র্যান্ড (Daraz / Cartup / নন-ব্র্যান্ড …)
  const body = box.querySelector<HTMLElement>('[data-vb-body]');
  const tpl = box.querySelector<HTMLTableRowElement>('[data-vb-template] tr[data-vb-row]');
  const empty = box.querySelector<HTMLElement>('[data-vb-empty]');
  if (!ci || !si || !body || !tpl) return;
  // (rows the owner deleted stay hidden in the form until it is saved — they are not part of the table any more)
  const rows = () => [...body.querySelectorAll<HTMLTableRowElement>('tr[data-vb-row]')].filter((r) => !r.dataset.deleted);
  const field = (r: Element, name: string) => r.querySelector<HTMLInputElement | HTMLSelectElement>(`[name="${name}"]`);
  const mainPrice = document.querySelector<HTMLInputElement>('input[name="price"]');
  const mainCost = document.querySelector<HTMLInputElement>('input[name="cost_price"]');

  const sync = () => {
    const n = rows().length;
    if (empty) empty.hidden = n > 0;
    // with colours / sizes the main price is filled in from the cheapest one when it is left empty
    if (mainPrice) mainPrice.required = n === 0;
  };

  // ✏️ a brand / colour / size renamed: the same rows keep their stock, prices and sales — only the name changes
  // (owner, 2026-10-24: "আলট্রা বক্স" should have been "আলট্রা মিনি বক্স"). Saved with the product (the label follows).
  const DIMS = [['b', 'vb_brand', '[data-vb-btext]'], ['c', 'vb_color', '[data-vb-ctext]'], ['s', 'vb_size', '[data-vb-stext]']] as const;
  const rename = (dim: 0 | 1 | 2, from: string, to: string) => {
    const [d, fname, tsel] = DIMS[dim];
    for (const r of rows()) {
      if ((r.dataset[d] || '').toLowerCase() !== from.toLowerCase()) continue;
      r.dataset[d] = to;
      const f = field(r, fname); if (f) f.value = to;
      const t = r.querySelector(tsel); if (t) t.textContent = to || '—';
    }
  };
  const listOf = (dim: 0 | 1 | 2) => (dim === 0 ? bi : dim === 1 ? ci : si);
  /** names that left a list and the same number that came in, in the same places: renames, not new rows */
  const renamesIn = (dim: 0 | 1 | 2, wanted: string[]) => {
    const d = DIMS[dim][0];
    const had = [...new Set(rows().map((r) => r.dataset[d] || '').filter(Boolean))];
    const low = (a: string[]) => a.map((x) => x.toLowerCase());
    const gone = had.filter((x) => !low(wanted).includes(x.toLowerCase()));
    const came = wanted.filter((x) => !low(had).includes(x.toLowerCase()));
    if (!gone.length || gone.length !== came.length) return;
    gone.forEach((g, i) => rename(dim, g, came[i]));
  };

  const make = () => {
    const B = bi ? split(bi.value) : [];
    const C = split(ci.value);
    const S = split(si.value);
    if (bi) bi.value = B.join(', ');
    ci.value = C.join(', ');
    si.value = S.join(', ');
    if (bi) renamesIn(0, B);
    renamesIn(1, C);
    renamesIn(2, S);
    // every brand × colour × size that was given (a list left empty is simply left out)
    let combos: [string, string, string][] = [['', '', '']];
    ([B, C, S] as string[][]).forEach((list, i) => {
      if (!list.length) return;
      combos = combos.flatMap((x) => list.map((v): [string, string, string] => { const y = [...x] as [string, string, string]; y[i] = v; return y; }));
    });
    if (!B.length && !C.length && !S.length) combos = [];
    const have = new Map(rows().map((r) => [key(r.dataset.b || '', r.dataset.c || '', r.dataset.s || ''), r]));
    const want = new Set<string>();
    for (const [b, c, s] of combos) {
      const k = key(b, c, s);
      want.add(k);
      let r = have.get(k);
      if (!r) {
        r = tpl.cloneNode(true) as HTMLTableRowElement;
        // the hidden blank row's fields are switched off (so they are never sent); the copy's are on
        for (const el of r.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select')) el.disabled = false;
        r.dataset.b = b;
        r.dataset.c = c;
        r.dataset.s = s;
        const fb = field(r, 'vb_brand'); if (fb) fb.value = b;
        const tb = r.querySelector('[data-vb-btext]'); if (tb) tb.textContent = b || '—';
        const fc = field(r, 'vb_color'); if (fc) fc.value = c;
        const fs = field(r, 'vb_size'); if (fs) fs.value = s;
        const tc = r.querySelector('[data-vb-ctext]'); if (tc) tc.textContent = c || '—';
        const ts = r.querySelector('[data-vb-stext]'); if (ts) ts.textContent = s || '—';
        const fp = field(r, 'vb_price'); if (fp && mainPrice) fp.value = mainPrice.value;
        const fk = field(r, 'vb_cost'); if (fk && mainCost) fk.value = mainCost.value;
        // the same brand + colour's photo, if another row already has one
        const twin = rows().find((x) => (b || c) && (x.dataset.b || '') === b && (x.dataset.c || '') === c && field(x, 'vb_img')?.value);
        const fi = field(r, 'vb_img'); if (fi && twin) fi.value = field(twin, 'vb_img')!.value;
      } else if (r.dataset.autoOff) {
        const on = field(r, 'vb_on'); if (on) on.value = '1';
        r.classList.remove('row-off');
        delete r.dataset.autoOff;
      }
      body.appendChild(r); // (in the order of the lists)
    }
    for (const r of rows()) {
      if (want.has(key(r.dataset.b || '', r.dataset.c || '', r.dataset.s || ''))) continue;
      if (!field(r, 'vb_id')?.value) { r.remove(); continue; }
      const on = field(r, 'vb_on'); if (on) on.value = '0';
      r.classList.add('row-off');
      r.dataset.autoOff = '1';
    }
    sync();
  };

  box.addEventListener('click', (e) => {
    // ✏️ beside a row's colour / size: rename it (every row with that name, and the list above)
    const ed = (e.target as Element | null)?.closest<HTMLElement>('[data-vb-rename]');
    if (ed) {
      e.preventDefault();
      const dim = Number(ed.dataset.vbRename) as 0 | 1 | 2;
      const r = ed.closest<HTMLTableRowElement>('tr[data-vb-row]');
      const cur = r?.dataset[DIMS[dim][0]] || '';
      if (!cur) return;
      const to = split(prompt(`"${cur}" এর নতুন নাম লিখুন (স্টক, দাম, বিক্রির হিসাব একই থাকবে):`, cur) || '')[0];
      if (!to || to === cur) return;
      rename(dim, cur, to);
      const L = listOf(dim);
      if (L) L.value = split(L.value).map((x) => (x.toLowerCase() === cur.toLowerCase() ? to : x)).join(', ');
      const note = box.querySelector<HTMLElement>('[data-vb-renamed]'); if (note) note.hidden = false;
      return;
    }
    const t = e.target as Element | null;
    if (t?.closest('[data-vb-make]')) { e.preventDefault(); make(); return; }
    // 🗑️ a new row just goes; a saved one is marked and hidden — it goes to the recycle bin when the product is saved
    const del = t?.closest('[data-vb-del]');
    if (del) {
      e.preventDefault();
      const r = del.closest<HTMLTableRowElement>('tr[data-vb-row]');
      if (!r) return;
      if (!field(r, 'vb_id')?.value) r.remove();
      else {
        const d = field(r, 'vb_del'); if (d) d.value = '1';
        r.dataset.deleted = '1';
        r.hidden = true;
        const note = box.querySelector<HTMLElement>('[data-vb-delnote]'); if (note) note.hidden = false;
      }
      sync();
      return;
    }
    // ✍️ a value typed by hand ("৩ নং বক্স") → added to its list
    const own = t?.closest<HTMLElement>('[data-vb-ownadd]');
    if (own) { e.preventDefault(); addOwn(own.dataset.vbOwnadd || ''); return; }
    const chip = t?.closest<HTMLElement>('[data-vb-chip]');
    if (chip) {
      e.preventDefault();
      const input = chip.dataset.vbChip === 'size' ? si : chip.dataset.vbChip === 'brand' && bi ? bi : ci;
      const v = chip.dataset.v || '';
      const now = split(input.value);
      input.value = (now.some((x) => x.toLowerCase() === v.toLowerCase()) ? now : [...now, v]).join(', ');
    }
  });
  // 📐 the unit shown next to every row's measure follows the unit box
  box.addEventListener('change', (e) => {
    const u = (e.target as Element | null)?.closest<HTMLSelectElement>('[data-vb-unit]');
    if (!u) return;
    for (const t of box.querySelectorAll('[data-vb-unit-tag]')) t.textContent = u.value;
  });
  // a photo picked on one row → the other rows of the same colour that have none
  body.addEventListener('change', (e) => {
    const sel = e.target as HTMLSelectElement | null;
    if (!sel || sel.name !== 'vb_img') return;
    const r = sel.closest<HTMLElement>('tr[data-vb-row]');
    const b = r?.dataset.b || '';
    const c = r?.dataset.c || '';
    if (!b && !c) return;
    for (const x of rows()) {
      const f = field(x, 'vb_img');
      if (x !== r && (x.dataset.b || '') === b && (x.dataset.c || '') === c && f && !f.value) f.value = sel.value;
    }
  });
  function addOwn(kind: string) {
    const src = box!.querySelector<HTMLInputElement>(`[data-vb-own="${kind}"]`);
    const input = kind === 'size' ? si! : kind === 'brand' && bi ? bi : ci!;
    const v = (src?.value || '').replace(/[,/]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 28);
    if (!src || !v) { src?.focus(); return; }
    const now = split(input.value);
    input.value = (now.some((x) => x.toLowerCase() === v.toLowerCase()) ? now : [...now, v]).join(', ');
    src.value = '';
    src.focus();
  }
  for (const own of box.querySelectorAll<HTMLInputElement>('[data-vb-own]')) {
    own.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addOwn(own.dataset.vbOwn || ''); } });
  }
  // Enter in the colour / size boxes makes the table instead of saving the whole product
  for (const inp of [ci, si, ...(bi ? [bi] : [])]) inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); make(); } });
  sync();
}

