/* Admin panel: বাংলা ⇄ English switch.
 *
 * The admin is written in Bangla. In English mode this swaps the admin's own words for their
 * hand-made English (public/js/admin-en.json — every phrase of the admin's code, translated once).
 * Only the dictionary's phrases are changed, so data stays as it is: customers' names, addresses and
 * notes (also marked translate="no") and anything else that isn't admin wording. Nothing is ever sent
 * to a translation service. Bangla digits become 0-9.
 *
 * The choice is kept on this device (localStorage). Switching is instant, no reload.
 */
import { whenReady } from '../dom.js';

declare global { interface Window { smAdminT?: (s: string) => string } }

whenReady(() => {
  const KEY = 'sm_admin_lang';
  const root = document.documentElement;
  const LETTER = /[ঀ-৥ৰ-৲৴-৿]/; // Bangla letters (not digits, not ৳)
  const HAS_DIGIT = /[০-৯]/;
  const ATTRS = ['placeholder', 'title', 'aria-label', 'data-confirm', 'data-confirm-btn', 'alt'];
  const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'CODE', 'PRE', 'NOSCRIPT', 'TEMPLATE']);
  // words that mean something else when they stand alone (a label) than inside a sentence
  const WHOLE: Record<string, string> = { 'থেকে': 'From', 'পর্যন্ত': 'Until', 'আছে': 'Yes', 'নেই': 'No' };
  // word pieces that are never translated on their own (parts of other words)
  const NEVER = new Set(['কো', 'লা', 'হা', 'এ', 'কে', 'সে', 'মি', 'ঘ', 'বাং', 'টি', 'জন']);
  const UNITS: Record<string, string> = { 'হা': 'k', 'লা': 'L', 'কো': 'Cr', 'মি': 'm', 'ঘ': 'h', 'সে': 's' };

  let dict: Record<string, string> | null = null; // bangla → english
  let buckets: Record<string, string[]> = Object.create(null); // first two characters → keys (longest first)
  let loading: Promise<void> | null = null;
  let lang: 'bn' | 'en' = 'bn';
  const textOrig = new WeakMap<Node, string>();                     // text node → original Bangla
  const attrOrig = new WeakMap<Element, Record<string, string>>();  // element → { attr: original }
  const setByUs = new WeakSet<Node>();                              // nodes whose current text we wrote ourselves
  const docTitle = document.title;

  try { lang = localStorage.getItem(KEY) === 'en' ? 'en' : 'bn'; } catch { /* private mode */ }

  // ---------------------------------------------------------------- dictionary
  const norm = (s: string) => String(s).replace(/\s+/g, ' ').trim();
  const isLetter = (ch: string | undefined) => !!ch && LETTER.test(ch);
  const isAscii = (ch: string | undefined) => !!ch && /[A-Za-z0-9]/.test(ch);
  const lettersIn = (s: string) => Array.from(s).filter((c) => LETTER.test(c)).length;
  const digits = (s: string) => String(s).replace(/[০-৯]/g, (d) => String('০১২৩৪৫৬৭৮৯'.indexOf(d))).replace(/।/g, '.');

  function build(raw: Record<string, string>): void {
    const d: Record<string, string> = Object.create(null);
    buckets = Object.create(null);
    const add = (key: string, v: string) => {
      const k = norm(key);
      if (!k || k in d) return;
      d[k] = v;
      // word pieces are only used when they are the whole text — never inside other text
      if (NEVER.has(k) || /^[০-৯]+\s?(টি|টা|জন)$/.test(k)) return; // "৪টি" — counts are handled with the number
      (buckets[k.slice(0, 2)] ||= []).push(k);
    };
    for (const [k, v] of Object.entries(raw)) {
      add(k, v);
      // the same phrase without a leading emoji / sign ("⚠️ …", "✅ …", "← …")
      const m = k.match(/^[^ঀ-৿A-Za-z0-9]+/);
      if (m) {
        const lead = m[0].trim();
        const core = k.slice(m[0].length);
        if (core && v.startsWith(lead)) add(core, v.slice(lead.length).replace(/^\s+/, ''));
      }
    }
    for (const list of Object.values(buckets)) list.sort((x, y) => y.length - x.length);
    dict = d;
  }

  function load(): Promise<void> {
    if (dict) return Promise.resolve();
    if (loading) return loading;
    const v = document.querySelector('script[data-admin-i18n]')?.getAttribute('data-v') || '';
    loading = fetch(`/js/admin-en.json?v=${encodeURIComponent(v || '1')}`, { credentials: 'same-origin' })
      .then((r) => { if (!r.ok) throw new Error(`dictionary ${r.status}`); return r.json(); })
      .then(build)
      .catch((e: unknown) => { loading = null; throw e; });
    return loading;
  }

  // ---------------------------------------------------------------- one string
  function tr(src: string): string {
    if (!dict || !src || (!LETTER.test(src) && !HAS_DIGIT.test(src))) return src;
    const lead = (src.match(/^\s*/) || [''])[0];
    const trail = (src.match(/\s*$/) || [''])[0];
    const s = norm(src);
    if (s in WHOLE) return lead + WHOLE[s] + trail;
    if (s in dict) return lead + digits(dict[s]) + trail;
    let out = '';
    let i = 0;
    let hits = 0;
    while (i < s.length) {
      const prev = i ? s[i - 1] : '';
      const start = !(isLetter(prev) || (isAscii(prev) && isAscii(s[i])));
      let found: string | null = null;
      if (start) {
        for (const k of buckets[s.substr(i, 2)] || []) {
          if (s.substr(i, k.length) !== k) continue;
          const next = s[i + k.length];
          const last = k[k.length - 1];
          if ((isLetter(last) && isLetter(next)) || (isAscii(last) && isAscii(next))) continue;
          found = k;
          break;
        }
      }
      if (found) {
        const v = dict[found];
        // keep words apart: "৩" + "completely out" → "3 completely out"
        if (v && /[A-Za-z0-9০-৯)\]]$/.test(out) && /^[A-Za-z0-9(]/.test(v)) out += ' ';
        out += v;
        i += found.length;
        hits++;
        if (v && /[A-Za-z0-9.,:)]$/.test(v) && s[i] && /[A-Za-z0-9ঀ-৿(]/.test(s[i])) out += ' ';
      } else { out += s[i]; i++; }
    }
    // counts and short forms after a number: ৫টি → 5, ১০জন → 10, ৳১হা → ৳1k, ৳২লা → ৳2L, ৳৩কো → ৳3Cr, ৫মি → 5m
    out = out.replace(/([০-৯0-9])\s?(টি|টা|জন)(?![ঀ-৥ৰ-৲৴-৿])/g, '$1')
      .replace(/([০-৯0-9])(হা|লা|কো|মি|ঘ|সে)(?![ঀ-৥ৰ-৲৴-৿])/g, (_, d: string, u: string) => d + UNITS[u]);
    if (!hits && out === s) return lead + digits(s) + trail;
    // a sentence only partly known reads worse than the Bangla — keep it as it was
    const before = lettersIn(s);
    if (hits && before >= 12 && lettersIn(out) > before * 0.45) return lead + digits(s) + trail;
    out = out.replace(/\s+([,.;:!?)])/g, '$1').replace(/\s{2,}/g, ' ');
    return lead + digits(out) + trail;
  }

  // ---------------------------------------------------------------- the page
  function skipped(el: Element | null): boolean {
    for (let e = el; e && e !== document.body; e = e.parentElement) {
      if (SKIP.has(e.tagName.toUpperCase())) return true;
      if (e.getAttribute('translate') === 'no' || (e as HTMLElement).isContentEditable || e.hasAttribute('data-no-i18n')) return true;
    }
    return false;
  }
  function doText(node: Node): void {
    if (setByUs.has(node)) { setByUs.delete(node); return; }
    const cur = node.nodeValue || '';
    if (lang === 'en') {
      if (!LETTER.test(cur) && !HAS_DIGIT.test(cur)) return;
      if (skipped(node.parentElement)) return;
      const en = tr(cur);
      if (en !== cur) { textOrig.set(node, cur); setByUs.add(node); node.nodeValue = en; }
    } else if (textOrig.has(node)) {
      node.nodeValue = textOrig.get(node)!;
      textOrig.delete(node);
    }
  }
  function doAttrs(el: Element, ownOk = false): void {
    let saved = attrOrig.get(el);
    for (const a of ATTRS) {
      if (lang === 'en') {
        const v = el.getAttribute(a);
        if (!v || (!LETTER.test(v) && !HAS_DIGIT.test(v))) continue;
        if (skipped(ownOk ? el.parentElement : el) || (ownOk && el.getAttribute('translate') === 'no')) return;
        const en = tr(v);
        if (en !== v) { saved = saved || {}; if (!(a in saved)) saved[a] = v; attrOrig.set(el, saved); el.setAttribute(a, en); }
      } else if (saved && a in saved) el.setAttribute(a, saved[a]);
    }
    if (lang !== 'en' && saved) attrOrig.delete(el);
    // buttons drawn as <input type=submit value="…">
    if (el instanceof HTMLInputElement && /^(submit|button)$/i.test(el.type)) {
      const s2 = attrOrig.get(el) || {};
      if (lang === 'en' && LETTER.test(el.value)) { if (!('value' in s2)) s2.value = el.value; attrOrig.set(el, s2); el.value = tr(el.value); }
      else if (lang !== 'en' && 'value' in s2) el.value = s2.value;
    }
  }
  function walk(rootNode: Node | null): void {
    if (!rootNode) return;
    if (rootNode.nodeType === 3) { doText(rootNode); return; }
    if (rootNode.nodeType !== 1 || SKIP.has((rootNode as Element).tagName)) return;
    doAttrs(rootNode as Element);
    const tw = document.createTreeWalker(rootNode, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.nodeType === 1 && SKIP.has((n as Element).tagName) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    const texts: Node[] = [];
    let n: Node | null;
    while ((n = tw.nextNode())) { if (n.nodeType === 3) texts.push(n); else doAttrs(n as Element); }
    texts.forEach(doText);
    // text boxes: their hint (placeholder) is admin wording, what's typed inside is not
    for (const box of Array.from((rootNode as Element).querySelectorAll?.('textarea[placeholder]') || [])) doAttrs(box, true);
  }
  function applyAll(): void {
    root.setAttribute('data-admin-lang', lang);
    root.lang = lang;
    document.title = lang === 'en' ? tr(docTitle) : docTitle;
    walk(document.body);
    paintSwitch();
  }

  // live changes (toasts, search results, checks…)
  const mo = new MutationObserver((list) => {
    if (lang !== 'en') return;
    for (const m of list) {
      if (m.type === 'characterData') doText(m.target);
      else for (const a of Array.from(m.addedNodes)) walk(a);
    }
  });

  // confirm() / alert() messages written in the admin's script
  const nativeConfirm = window.confirm.bind(window);
  const nativeAlert = window.alert.bind(window);
  window.confirm = (msg?: string) => nativeConfirm(lang === 'en' && dict ? tr(String(msg)) : msg);
  window.alert = (msg?: unknown) => nativeAlert(lang === 'en' && dict ? tr(String(msg)) : msg);

  // ---------------------------------------------------------------- the switch
  function paintSwitch(): void {
    for (const sw of Array.from(document.querySelectorAll('[data-admin-lang-switch]'))) {
      sw.classList.toggle('is-en', lang === 'en');
      sw.setAttribute('aria-checked', lang === 'en' ? 'true' : 'false');
    }
  }
  const failed = () => { lang = 'bn'; paintSwitch(); };
  function setLang(l: string): void {
    lang = l === 'en' ? 'en' : 'bn';
    try { localStorage.setItem(KEY, lang); } catch { /* ignore */ }
    if (lang === 'en') {
      root.classList.add('admin-i18n-busy');
      load().then(applyAll, failed).then(() => root.classList.remove('admin-i18n-busy'));
    } else applyAll();
  }
  document.addEventListener('click', (e) => {
    const b = (e.target as Element | null)?.closest?.('[data-admin-lang-switch]');
    if (!b) return;
    e.preventDefault();
    setLang(lang === 'en' ? 'bn' : 'en');
  });

  const start = () => {
    paintSwitch();
    mo.observe(document.body, { childList: true, subtree: true, characterData: true });
    if (lang === 'en') load().then(applyAll, failed).then(() => root.classList.remove('admin-i18n-wait'));
    else root.classList.remove('admin-i18n-wait');
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
  // never leave the page hidden
  setTimeout(() => root.classList.remove('admin-i18n-wait'), 2500);
  window.smAdminT = (s) => (lang === 'en' && dict ? tr(s) : s);
});
