// Small page actions without inline click handlers in the HTML (the admin's script rule forbids them — lib/security.ts):
//   <button data-print>        → print the page
//   <select data-autosubmit>   → send its form when changed
//   <a data-back href="…">     → go back (the href is used when there is no history)
// Loaded on every admin page and on the stand-alone print pages (memo, VAT invoice, labels).
(function () {
  if (window.__smPageActions) return;
  window.__smPageActions = true;
  document.addEventListener('click', function (e) {
    var t = e.target && e.target.closest ? e.target : null;
    if (!t) return;
    if (t.closest('[data-print]')) { e.preventDefault(); window.print(); return; }
    var back = t.closest('a[data-back]');
    if (back && window.history.length > 1) { e.preventDefault(); window.history.back(); }
  });
  document.addEventListener('change', function (e) {
    var s = e.target;
    if (s && s.matches && s.matches('[data-autosubmit]') && s.form) s.form.submit();
  });
})();
