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
import { startVoice } from './voice.js';

// 📖 Boxes are fixed cards, never folded (owner, 2026-11-19, supersedes 2026-11-17 "a box the owner folds stays
// folded"): every settings box, tool panel and ⓘ note on an admin page is shown open, as a plain card — no arrow,
// nothing to minimise. Row actions (edit a payment, a category's extra settings, block / refund …) stay buttons.
function openAllFolds(): void {
  const ACTIONS = ':not([data-keep-closed]):not(.cat-more):not(.cat-seo):not(.pay-edit):not(.mt):not(.ll-more)';
  try { localStorage.removeItem('sm_folded'); } catch { /* private mode */ }
  for (const d of Array.from(document.querySelectorAll<HTMLDetailsElement>(`#main details${ACTIONS}`))) {
    d.open = true;
    d.classList.add('no-fold');
    const sum = d.querySelector(':scope > summary');
    if (sum) {
      sum.setAttribute('tabindex', '-1');
      sum.addEventListener('click', (e) => e.preventDefault());
    }
    d.addEventListener('toggle', () => { if (!d.open) d.open = true; });
  }
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
  startVoice();
});
