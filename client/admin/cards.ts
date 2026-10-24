// 📱 Admin tables on a phone (owner, 2026-10-24): a wide list (orders, products, customers, purchases …) no longer
// needs sideways scrolling — on a narrow screen each row becomes a card, every value under its column's name
// (public/css/admin.css `.as-cards`). Tables where something is typed in a row (purchase lines, variant prices, the
// POS) stay tables; so do small ones. Nothing changes on a computer screen.
import { $all } from '../dom.js';

const EDITABLE = 'input:not([type="checkbox"]):not([type="hidden"]):not([type="radio"]), select, textarea';

function label(th: HTMLTableCellElement): string {
  return (th.getAttribute('aria-label') || th.textContent || '').replace(/\s+/g, ' ').trim();
}

/** Mark one table and give each cell its column's name. */
function asCards(t: HTMLTableElement): void {
  const head = t.tHead?.rows[0];
  if (!head || t.dataset.cards === 'no') return;
  if (!t.classList.contains('as-cards') && (t.classList.contains('no-cards') || t.closest('.no-cards, [data-pos], [data-vb], .chart') || t.querySelector(EDITABLE))) {
    t.dataset.cards = 'no';
    return;
  }
  const names: string[] = [];
  for (const th of Array.from(head.cells)) for (let k = 0; k < (th.colSpan || 1); k++) names.push(k ? '' : label(th as HTMLTableCellElement));
  if (names.length < 4) { t.dataset.cards = 'no'; return; } // two or three columns fit a phone as they are
  for (const body of Array.from(t.tBodies)) {
    for (const tr of Array.from(body.rows)) {
      if (tr.dataset.cardsDone) continue;
      tr.dataset.cardsDone = '1';
      let col = 0;
      for (const td of Array.from(tr.cells)) {
        const n = names[col] || '';
        if (n && !td.hasAttribute('data-label')) td.setAttribute('data-label', n);
        if (!n) td.classList.add('c-plain'); // a picture, a tick box, buttons: no name in front
        col += td.colSpan || 1;
      }
      // the row's first named cell is the card's title
      const first = Array.from(tr.cells).find((c) => c.getAttribute('data-label'));
      first?.classList.add('c-title');
    }
  }
  t.classList.add('as-cards');
}

export function startCards(): void {
  const run = () => { for (const t of $all<HTMLTableElement>('#main table.table, main table.table')) asCards(t); };
  run();
  // rows added later (lists that load more, search results)
  let queued = 0;
  new MutationObserver(() => {
    if (queued) return;
    queued = window.setTimeout(() => { queued = 0; run(); }, 200);
  }).observe(document.body, { childList: true, subtree: true });
}
