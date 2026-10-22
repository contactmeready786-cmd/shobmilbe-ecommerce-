// Small page actions without inline click handlers in the HTML (the admin's script rule forbids them — lib/security.ts):
//   <button data-print>        → print the page
//   <select data-autosubmit>   → send its form when changed
//   <a data-back href="…">     → go back (the href is used when there is no history)
//   <input type=file data-file-into="x"> → the chosen file goes into the form's hidden field "x" (base64) and "x_name" (its
//                                name), so a normal form can send an Excel / CSV file (lib/admin/contacts.tsx)
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
    const f = e.target as HTMLInputElement | null;
    const into = f?.matches?.('input[type=file][data-file-into]') ? f.getAttribute('data-file-into') : null;
    if (f && into && f.form) {
      const form = f.form;
      const put = (name: string, v: string) => {
        let el = form.querySelector<HTMLInputElement>(`input[type=hidden][name="${name}"]`);
        if (!el) { el = document.createElement('input'); el.type = 'hidden'; el.name = name; form.appendChild(el); }
        el.value = v;
      };
      const file = f.files && f.files[0];
      put(into, ''); put(`${into}_name`, '');
      if (!file) return;
      const btn = form.querySelector<HTMLButtonElement>('button:not([type=button])');
      if (btn) btn.disabled = true;
      const r = new FileReader();
      r.onload = () => {
        put(into, String(r.result || '').replace(/^data:[^,]*,/, ''));
        put(`${into}_name`, file.name);
        if (btn) btn.disabled = false;
      };
      r.onerror = () => { if (btn) btn.disabled = false; };
      r.readAsDataURL(file);
    }
  });
});
