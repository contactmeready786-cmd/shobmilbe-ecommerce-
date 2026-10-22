// 🎨 রং / সাইজ in the product form (lib/admin/products.tsx variantBuilder): the owner types the colours and the sizes
// (or taps the ready-made chips), presses "📋 দামের টেবিল তৈরি করুন" → one row per colour × size, made from the page's
// own <template> row. Rows already there keep what was typed; a combination taken away is switched "বন্ধ" (a saved
// one) or removed (a new one). Rows are copied from a hidden blank row (not a <template> — React must be able
// to take the page over). Picking a photo for one row puts it on the other rows of the same colour.

const split = (v: string) => [...new Set(v.split(/[,،\n]+/).map((x) => x.replace(/\//g, '-').replace(/\s+/g, ' ').trim().slice(0, 28)).filter(Boolean))];
const key = (c: string, s: string) => `${c.toLowerCase()}|${s.toLowerCase()}`;

export function startVariantBuilder(): void {
  const box = document.querySelector<HTMLElement>('[data-vb]');
  if (!box) return;
  const ci = box.querySelector<HTMLInputElement>('[data-vb-colors]');
  const si = box.querySelector<HTMLInputElement>('[data-vb-sizes]');
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

  const make = () => {
    const C = split(ci.value);
    const S = split(si.value);
    ci.value = C.join(', ');
    si.value = S.join(', ');
    const combos: [string, string][] = C.length && S.length ? C.flatMap((c) => S.map((s): [string, string] => [c, s]))
      : C.length ? C.map((c): [string, string] => [c, '']) : S.map((s): [string, string] => ['', s]);
    const have = new Map(rows().map((r) => [key(r.dataset.c || '', r.dataset.s || ''), r]));
    const want = new Set<string>();
    for (const [c, s] of combos) {
      const k = key(c, s);
      want.add(k);
      let r = have.get(k);
      if (!r) {
        r = tpl.cloneNode(true) as HTMLTableRowElement;
        // the hidden blank row's fields are switched off (so they are never sent); the copy's are on
        for (const el of r.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select')) el.disabled = false;
        r.dataset.c = c;
        r.dataset.s = s;
        const fc = field(r, 'vb_color'); if (fc) fc.value = c;
        const fs = field(r, 'vb_size'); if (fs) fs.value = s;
        const tc = r.querySelector('[data-vb-ctext]'); if (tc) tc.textContent = c || '—';
        const ts = r.querySelector('[data-vb-stext]'); if (ts) ts.textContent = s || '—';
        const fp = field(r, 'vb_price'); if (fp && mainPrice) fp.value = mainPrice.value;
        const fk = field(r, 'vb_cost'); if (fk && mainCost) fk.value = mainCost.value;
        // the same colour's photo, if another row already has one
        const twin = rows().find((x) => (x.dataset.c || '') === c && c && field(x, 'vb_img')?.value);
        const fi = field(r, 'vb_img'); if (fi && twin) fi.value = field(twin, 'vb_img')!.value;
      } else if (r.dataset.autoOff) {
        const on = field(r, 'vb_on'); if (on) on.value = '1';
        r.classList.remove('row-off');
        delete r.dataset.autoOff;
      }
      body.appendChild(r); // (in the order of the lists)
    }
    for (const r of rows()) {
      if (want.has(key(r.dataset.c || '', r.dataset.s || ''))) continue;
      if (!field(r, 'vb_id')?.value) { r.remove(); continue; }
      const on = field(r, 'vb_on'); if (on) on.value = '0';
      r.classList.add('row-off');
      r.dataset.autoOff = '1';
    }
    sync();
  };

  box.addEventListener('click', (e) => {
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
    const chip = t?.closest<HTMLElement>('[data-vb-chip]');
    if (chip) {
      e.preventDefault();
      const input = chip.dataset.vbChip === 'size' ? si : ci;
      const v = chip.dataset.v || '';
      const now = split(input.value);
      input.value = (now.some((x) => x.toLowerCase() === v.toLowerCase()) ? now : [...now, v]).join(', ');
    }
  });
  // a photo picked on one row → the other rows of the same colour that have none
  body.addEventListener('change', (e) => {
    const sel = e.target as HTMLSelectElement | null;
    if (!sel || sel.name !== 'vb_img') return;
    const r = sel.closest<HTMLElement>('tr[data-vb-row]');
    const c = r?.dataset.c || '';
    if (!c) return;
    for (const x of rows()) {
      const f = field(x, 'vb_img');
      if (x !== r && (x.dataset.c || '') === c && f && !f.value) f.value = sel.value;
    }
  });
  // Enter in the colour / size boxes makes the table instead of saving the whole product
  for (const inp of [ci, si]) inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); make(); } });
  sync();
}

