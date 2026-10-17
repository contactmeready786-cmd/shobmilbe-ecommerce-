// Small page actions without inline click handlers in the HTML (the admin's script rule forbids them — lib/security.ts):
//   <button data-print>        → print the page
//   <select data-autosubmit>   → send its form when changed
//   <a data-back href="…">     → go back (the href is used when there is no history)
// Loaded on every admin page and on the stand-alone print pages (memo, VAT invoice, labels).
import { whenReady } from '../dom.js';

declare global { interface Window { __smPageActions?: boolean } }

whenReady(() => {
  if (window.__smPageActions) return;
  window.__smPageActions = true;
  document.addEventListener('click', (e) => {
    const t = e.target as Element | null;
    if (!t?.closest) return;
    if (t.closest('[data-print]')) { e.preventDefault(); window.print(); return; }
    if (t.closest('a[data-back]') && window.history.length > 1) { e.preventDefault(); window.history.back(); }
  });
  // a memo opened with ?print=1 prints by itself once it has loaded
  if (document.body.hasAttribute('data-print-auto')) {
    const go = () => setTimeout(() => window.print(), 300);
    if (document.readyState === 'complete') go(); else window.addEventListener('load', go, { once: true });
  }
  document.addEventListener('change', (e) => {
    const s = e.target as HTMLSelectElement | null;
    if (s?.matches?.('[data-autosubmit]') && s.form) s.form.submit();
  });
});
