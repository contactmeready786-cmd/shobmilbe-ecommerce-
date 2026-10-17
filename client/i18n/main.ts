/* সবমিলবে — বাংলা ⇄ English switch (no page reload).
 *
 * How it works
 *  - The page always arrives in Bangla. In English mode every piece of visible text is swapped for its English
 *    version right in the page; switching back puts the exact original Bangla back.
 *  - The shop's own words (buttons, headings, messages) are translated by hand (words.ts).
 *  - What the owner writes (product names, descriptions, categories, banners, blog…) comes from the server,
 *    translated once and kept; it is also remembered in this browser, so the next visit is instant.
 *  - Lines the owner corrected in Admin → স্টোর ডিজাইন → ভাষা always win.
 *  - Anything marked translate="no" (logo, customer's name/phone/address) is never touched or sent anywhere.
 */
import { whenReady, type Loose } from '../dom.js';
import { WORDMAP, WORDS } from './words.js';

declare global { interface Window { SMLang?: { set(l: string): void; get(): string; t(s: string): string } } }

type Template = { re: RegExp; en: string; kinds: string[]; cls: string; weight: number };
type Dict = Record<string, string>;

const BN = /[ঀ-৥ৰ-৲৴-৿]/; // Bangla letters (not digits or ৳)
const DIG = '০১২৩৪৫৬৭৮৯';
const NUM = '([0-9০-৯]+(?:[.,][0-9০-৯]+)*)';
const lat = (s: string) => String(s).replace(/[০-৯]/g, (d) => String(DIG.indexOf(d)));
const norm = (s: string) => String(s).replace(/\s+/g, ' ').trim();
const reEsc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ------------------------------------------------------------------ dictionary
const EXACT: Dict = Object.create(null);
const CTX: Dict = Object.create(null);
const TPL: Template[] = [];
for (const [raw, en] of Object.entries(WORDS)) {
  let key = raw;
  let cls = '';
  const bar = raw.indexOf('|');
  if (bar > 0 && /^[a-z-]+$/.test(raw.slice(0, bar))) { cls = raw.slice(0, bar); key = raw.slice(bar + 1); }
  key = norm(key);
  if (!/\{[ntkc]\}/.test(key)) {
    if (cls) CTX[`${cls}|${key}`] = en; else EXACT[key] = en;
    continue;
  }
  const kinds: string[] = [];
  const re = key.split(/(\{[ntkc]\})/).map((p) => {
    const m = /^\{([ntkc])\}$/.exec(p);
    if (!m) return reEsc(p);
    kinds.push(m[1]);
    return m[1] === 'n' ? NUM : m[1] === 'c' ? '([A-Za-z0-9][A-Za-z0-9-]*)' : '(.+?)';
  }).join('');
  TPL.push({ re: new RegExp(`^${re}$`), en, kinds, cls, weight: key.replace(/\{[ntkc]\}/g, '').length });
}
TPL.sort((a, b) => b.weight - a.weight);

whenReady(() => {
  const CFG: Loose = window.SM?.i18n;
  if (!CFG || !document.body) return;

  let FIX: Dict = Object.create(null);    // owner's corrections
  let CACHE: Dict = Object.create(null);  // server translations
  let GEO: Dict | null = null;
  let missed = false;                     // set when part of a text is still waiting for the server
  let want: Record<string, 1> = Object.create(null); // texts to ask the server about

  const STORE = 'sm_i18n';
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) || 'null');
    if (saved && saved.r === CFG.rev && saved.m) CACHE = saved.m;
    const savedFix = JSON.parse(localStorage.getItem(`${STORE}_fix`) || 'null');
    if (savedFix && savedFix.r === CFG.rev && savedFix.m) FIX = savedFix.m;
  } catch { /* private mode */ }
  const persist = () => {
    try {
      let s = JSON.stringify({ r: CFG.rev, m: CACHE });
      if (s.length > 1500000) { CACHE = Object.create(null); s = JSON.stringify({ r: CFG.rev, m: {} }); }
      localStorage.setItem(STORE, s);
    } catch { /* full or blocked */ }
  };

  const geo = (key: string): string | undefined => {
    if (!GEO && window.BD_GEO?.districts) {
      const g: Dict = Object.create(null);
      for (const d of window.BD_GEO.districts) {
        g[d.bn] = d.en;
        g[`${d.bn} (${d.en})`] = d.en; // district list at checkout: "ঢাকা (Dhaka)"
        for (const a of d.areas || []) if (a[1]) g[a[1]] = a[0];
      }
      GEO = g;
    }
    return GEO ? GEO[key] : undefined;
  };

  const fill = (t: Template, m: RegExpExecArray): string => {
    const out = t.en.replace(/\{(\d)\}/g, (_, i: string) => {
      const v = m[Number(i) + 1];
      const kind = t.kinds[Number(i)];
      if (kind === 'n') return lat(v);
      if (kind === 'k' || kind === 'c') return v;
      return tr(v, null, true) ?? v;
    });
    // "1 items" → "1 item"
    return out.replace(/(^|[^\d.,])1 (item|product|pc)s\b/g, '$11 $2');
  };

  // Bangla → English, or null when not known (yet).
  function tr(text: string, el: Element | null, inner: boolean): string | null {
    const key = norm(text);
    if (!key) return null;
    if (!BN.test(key)) return /[০-৯]/.test(key) ? lat(key) : null;
    let found: string | null = FIX[key] || null;
    if (!found && el?.classList) {
      for (const c of Array.from(el.classList)) { found = CTX[`${c}|${key}`] || null; if (found) break; }
    }
    found = found || EXACT[key] || CACHE[key] || geo(key) || null;
    if (found) return found;
    if (key.indexOf(' | ') > 0) return joined(key, ' | ', el);
    for (const t of TPL) {
      if (t.cls && !el?.classList?.contains(t.cls)) continue;
      const m = t.re.exec(key);
      if (m) return fill(t, m);
    }
    // a leading emoji / symbol or a trailing arrow around a known text: "📟 ইলেকট্রনিক্স", "সব ইলেকট্রনিক্স →"
    const wrap = /^([^ঀ-৿A-Za-z0-9"'(]+)?(.*?)([\s→↗↓›»:.!।]+)?$/.exec(key);
    if (wrap && (wrap[1] || wrap[3]) && wrap[2] && wrap[2] !== key) {
      const core = tr(wrap[2], el, true);
      if (core != null) {
        let suf = wrap[3] ? lat(wrap[3]).replace(/।/g, '.') : '';
        if (/[.!?:]$/.test(core) && /^[.!?:]/.test(suf)) suf = suf.slice(1); // "Done." + "।" → "Done."
        return (wrap[1] || '') + core + suf;
      }
    }
    // dates and times
    const w = words(key);
    if (w != null) return w;
    // a few parts joined with a separator: "পণ্যের নাম | সবমিলবে"
    for (const sep of [' · ', ' — ', ' / ']) if (key.includes(sep)) return joined(key, sep, el);
    if (inner) { want[key] = 1; missed = true; }
    return null;
  }
  // "পণ্যের নাম | সবমিলবে": each part on its own (a part still unknown stays Bangla until the server answers)
  const joined = (key: string, sep: string, el: Element | null) =>
    key.split(sep).map((piece) => (BN.test(piece) ? tr(piece, el, true) ?? piece : lat(piece))).join(sep);

  const time12 = (part: string, hr: string, mi: string, sec?: string) => {
    const hh = Number(lat(hr));
    const pm = part === 'দুপুর' || part === 'বিকাল' || part === 'সন্ধ্যা' || (part === 'রাত' && hh >= 6 && hh < 12);
    return `${hh}:${lat(mi)}${sec ? `:${lat(sec)}` : ''}${pm ? ' PM' : ' AM'}`;
  };
  const words = (key: string): string | null => {
    let s = key.replace(/(রাত|সকাল|দুপুর|বিকাল|সন্ধ্যা)\s*([0-9০-৯]{1,2}):([0-9০-৯]{2})(?::([0-9০-৯]{2}))?/g,
      (_, part: string, hr: string, mi: string, sec?: string) => time12(part, hr, mi, sec));
    s = s.replace(/[ঀ-৥ৰ-৿]+/g, (w) => WORDMAP[w] || w);
    s = lat(s).replace(/।/g, '.');
    return BN.test(s) ? null : s;
  };

  // ------------------------------------------------------------------ the page
  const NOATTR = 'script,style,noscript,code,pre,svg,[translate="no"],[contenteditable],[data-no-i18n]';
  const SKIP = `${NOATTR},textarea`;
  const ATTRS = ['placeholder', 'title', 'aria-label'];
  const ORIG = new WeakMap<Node, { bn: string; en: string }>();               // text node → {bn, en}
  const AORIG = new WeakMap<Element, Record<string, { bn: string; en: string }>>(); // element → {attr: {bn, en}}
  let waiting: Node[] = [];   // nodes whose text (or part of it) is being asked from the server
  let lang = 'bn';

  const skipped = (el: Element | null) => !el || (el.closest ? !!el.closest(SKIP) : false);
  const noAttr = (el: Element | null) => !el || (el.closest ? !!el.closest(NOATTR) : false);

  function doText(n: Node): void {
    const v = n.nodeValue;
    if (!v || !/[ঀ-৿]/.test(v)) return;
    const rec = ORIG.get(n);
    if (rec && v === rec.en) return;
    const el = n.parentNode as Element | null;
    if (el && el.nodeType === 1 && skipped(el)) return;
    missed = false;
    let en = tr(v, el, false);
    if (en == null) {
      if (BN.test(v)) { if (!missed) want[norm(v)] = 1; waiting.push(n); schedule(); }
      return;
    }
    if (missed) { waiting.push(n); schedule(); }
    let lead = /^\s*/.exec(v)![0];
    const tail = /\s*$/.exec(v)![0];
    if (en.charAt(0) === '^') { en = en.slice(1); lead = ''; }
    en = lead + en + tail;
    ORIG.set(n, { bn: v, en });
    n.nodeValue = en;
  }
  function doAttrs(el: Element): void {
    for (const a of ATTRS) {
      const v = el.getAttribute(a);
      if (!v || !BN.test(v)) continue;
      const recs = AORIG.get(el) || {};
      if (recs[a] && recs[a].en === v) continue;
      missed = false;
      let en = tr(v, el, false);
      if (en == null) { if (!missed) want[norm(v)] = 1; waiting.push(el); schedule(); continue; }
      if (missed) { waiting.push(el); schedule(); }
      en = en.replace(/^\^/, '');
      recs[a] = { bn: v, en };
      AORIG.set(el, recs);
      el.setAttribute(a, en);
    }
  }
  function walk(root: Node | null): void {
    if (!root) return;
    if (root.nodeType === 3) { doText(root); return; }
    if (root.nodeType !== 1) return;
    const r = root as Element;
    if (skipped(r)) { if (r.tagName === 'TEXTAREA' && !noAttr(r)) doAttrs(r); return; }
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        if (n.nodeType !== 1 || !(n as Element).matches(SKIP)) return NodeFilter.FILTER_ACCEPT;
        if ((n as Element).tagName === 'TEXTAREA' && !noAttr(n as Element)) doAttrs(n as Element);
        return NodeFilter.FILTER_REJECT; // skip what is inside
      },
    });
    let n: Node | null = root;
    do {
      if (n.nodeType === 3) doText(n);
      else if (ATTRS.some((a) => (n as Element).hasAttribute?.(a))) doAttrs(n as Element);
    } while ((n = tw.nextNode()));
  }
  function undoAttrs(el: Element): void {
    const recs = AORIG.get(el);
    if (recs) for (const [a, r] of Object.entries(recs)) if (el.getAttribute(a) === r.en) el.setAttribute(a, r.bn);
    AORIG.delete(el);
  }
  function restore(): void {
    const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n: Node | null;
    while ((n = tw.nextNode())) {
      const rec = ORIG.get(n);
      if (rec && n.nodeValue === rec.en) n.nodeValue = rec.bn;
      if (rec) ORIG.delete(n);
    }
    for (const el of Array.from(document.querySelectorAll('[placeholder],[title],[aria-label]'))) undoAttrs(el);
  }

  let titleBn = document.title;
  function doTitle(): void {
    if (lang !== 'en') { if (document.title !== titleBn) document.title = titleBn; return; }
    missed = false;
    const t = tr(titleBn, null, false);
    if (t != null) document.title = t;
    else if (BN.test(titleBn)) { want[norm(titleBn)] = 1; schedule(); }
  }

  // ------------------------------------------------------------------ asking the server
  let timer = 0;
  const asked: Record<string, 1> = Object.create(null);
  function schedule(): void { if (!timer) timer = window.setTimeout(flush, 40); }
  function flush(): void {
    timer = 0;
    const list = Object.keys(want).filter((k) => !asked[k] && k.length <= 3000);
    want = Object.create(null);
    for (let i = 0; i < list.length; i += 50) {
      const batch = list.slice(i, i + 50);
      for (const k of batch) asked[k] = 1;
      fetch('/api/i18n', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ t: batch }) })
        .then((r) => (r.ok ? r.json() : { m: {} }))
        .then((j: { m?: Dict }) => {
          const got = Object.entries(j?.m || {});
          for (const [k, v] of got) CACHE[k] = v;
          if (got.length) { persist(); retry(); }
        })
        .catch(() => { /* offline: the Bangla text stays */ });
    }
  }
  function retry(): void {
    if (lang !== 'en') return;
    const list = waiting;
    waiting = [];
    for (const n of list) {
      if (!n.isConnected) continue;
      if (n.nodeType === 3) {
        const rec = ORIG.get(n);
        if (rec && n.nodeValue === rec.en) { n.nodeValue = rec.bn; ORIG.delete(n); }
        doText(n);
      } else {
        undoAttrs(n as Element);
        doAttrs(n as Element);
      }
    }
    doTitle();
  }

  // ------------------------------------------------------------------ watching the page (cart, messages…)
  const mo = new MutationObserver((list) => {
    for (const m of list) {
      if (m.type === 'childList') {
        for (const a of Array.from(m.addedNodes)) {
          if (a.nodeType === 3) { if (!a.parentNode || !skipped(a.parentNode as Element)) doText(a); } else walk(a);
        }
      } else if (m.type === 'characterData') doText(m.target);
      else if (m.type === 'attributes' && !noAttr(m.target as Element)) doAttrs(m.target as Element);
    }
  });
  const titleEl = document.querySelector('title');
  const to = new MutationObserver(() => {
    if (lang === 'en' && document.title !== titleBn && BN.test(document.title)) { titleBn = document.title; doTitle(); }
  });
  const redo = () => { if (lang === 'en') { restore(); walk(document.body); doTitle(); } };
  // district / thana names: the list arrives a moment after the page (pages with an address form)
  document.addEventListener('sm:geo', () => { GEO = null; redo(); });

  // ------------------------------------------------------------------ switching
  let fixLoaded = false;
  function loadFix(): void {
    if (fixLoaded) return;
    fixLoaded = true;
    fetch(`/api/i18n/fix?v=${encodeURIComponent(CFG.rev)}`).then((r) => (r.ok ? r.json() : null)).then((j: { m?: Dict } | null) => {
      if (!j?.m) return;
      const changed = JSON.stringify(j.m) !== JSON.stringify(FIX);
      FIX = j.m;
      try { localStorage.setItem(`${STORE}_fix`, JSON.stringify({ r: CFG.rev, m: FIX })); } catch { /* ignore */ }
      if (changed) redo();
    }).catch(() => { /* keep what we have */ });
  }

  function paintSwitch(): void {
    for (const b of Array.from(document.querySelectorAll('[data-lang-switch]'))) {
      b.setAttribute('aria-checked', lang === 'en' ? 'true' : 'false');
      b.classList.toggle('is-en', lang === 'en');
    }
  }
  function setLang(want2: string | null, save: boolean): void {
    const l = want2 === 'en' ? 'en' : 'bn';
    if (save) { try { localStorage.setItem('sm_lang', l); } catch { /* ignore */ } }
    const html = document.documentElement;
    html.setAttribute('data-lang', l);
    html.lang = l;
    if (l !== lang) {
      lang = l;
      if (l === 'en') {
        walk(document.body);
        doTitle();
        mo.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
        if (titleEl) to.observe(titleEl, { childList: true, characterData: true, subtree: true });
        loadFix();
      } else {
        mo.disconnect();
        to.disconnect();
        restore();
        doTitle();
      }
    }
    paintSwitch();
    html.classList.remove('i18n-wait');
    document.dispatchEvent(new CustomEvent('sm:lang', { detail: { lang: l } }));
  }

  // tap the switch = flip; tap the word "বাং" or "EN" = that language
  document.addEventListener('click', (e) => {
    const t = e.target as Element | null;
    const sw = t?.closest?.('[data-lang-switch]');
    if (!sw) return;
    e.preventDefault();
    let side = t!.closest('[data-lang]');
    if (side && !sw.contains(side)) side = null; // <html> carries data-lang too
    setLang(side ? side.getAttribute('data-lang') : lang === 'en' ? 'bn' : 'en', true);
  });

  setLang(document.documentElement.getAttribute('data-lang') || CFG.def || 'bn', false);
  window.SMLang = { set: (l) => setLang(l, true), get: () => lang, t: (s) => (lang === 'en' ? tr(s, null, false) || s : s) };
});
