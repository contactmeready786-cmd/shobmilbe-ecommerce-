// সবমিলবে admin — menus, image uploads, product pickers, order forms, barcode scanning, import.
// Starts once React has taken over the page (see whenReady), so React never finds something already changed.
import { whenReady } from '../dom.js';
import { startCore } from './core.js';
import { startForms } from './forms.js';
import { startHandover } from './handover.js';
import { startImages } from './images.js';
import { startImporter } from './importer.js';
import { startPages } from './pages.js';
import { startVariantBuilder } from './vbuilder.js';
import { startWhiten } from './whiten.js';
import { startRecognize } from './recognize.js';
import { startCards } from './cards.js';
import { startWhitenMine, startToJpg } from './whitenmine.js';

// 📖 Everything open (owner, 2026-11-17: "the template would never keep these closed"): every folded box on an
// admin page — help (ⓘ), settings boxes, tool panels — starts open, laid out as cards like the Veylix template.
// A box the owner folds stays folded on that page (remembered on this device) until they open it again —
// saving a form, refreshing or coming back doesn't open it again (owner, 2026-11-17).
const FOLD_KEY = 'sm_folded';
function openAllFolds(): void {
  // (row actions — edit a payment, a category's extra settings, block / refund buttons — stay buttons that open on press)
  const ACTIONS = ':not([data-keep-closed]):not(.cat-more):not(.cat-seo):not(.pay-edit):not(.mt):not(.ll-more)';
  let folded: Record<string, 1> = {};
  try { folded = JSON.parse(localStorage.getItem(FOLD_KEY) || '{}') || {}; } catch { folded = {}; }
  const page = location.pathname;
  const boxes = Array.from(document.querySelectorAll<HTMLDetailsElement>(`#main details${ACTIONS}`));
  boxes.forEach((d, i) => {
    const key = `${page}#${d.id || i}`;
    d.open = !folded[key];
    d.addEventListener('toggle', () => {
      if (d.open) delete folded[key]; else folded[key] = 1;
      try { localStorage.setItem(FOLD_KEY, JSON.stringify(folded)); } catch { /* private mode */ }
    });
  });
}

whenReady(() => {
  openAllFolds();
  window.__smAdminReady = true; // (tools/parity/browser.mts checks the admin's script started)
  startCore();
  startHandover();
  startImages();
  startForms();
  startImporter();
  startPages();
  startVariantBuilder();
  startWhiten();
  startRecognize();
  startCards();
  startWhitenMine();
  startToJpg();
});
