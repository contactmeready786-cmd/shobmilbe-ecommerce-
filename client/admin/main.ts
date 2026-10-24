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
import { startWhitenMine } from './whitenmine.js';

whenReady(() => {
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
});
