/* Admin panel: বাংলা ⇄ English switch.
 *
 * The admin is written in Bangla. In English mode this script swaps the admin's own words for their
 * hand-made English (public/js/admin-en.json — every phrase of the admin's code, translated once).
 * Only the dictionary's phrases are changed, so data stays as it is: customers' names, addresses and
 * notes (also marked translate="no") and anything else that isn't admin wording. Nothing is ever sent
 * to a translation service. Bangla digits become 0-9.
 *
 * The choice is kept on this device (localStorage). Switching is instant, no reload.
 */
(function () {
  'use strict';
  var KEY = 'sm_admin_lang';
  var root = document.documentElement;
  var LETTER = /[ঀ-৥ৰ-৲৴-৿]/; // Bangla letters (not digits, not ৳)
  var BN_DIGIT = /[০-৯]/g;
  var HAS_DIGIT = /[০-৯]/;
  var ATTRS = ['placeholder', 'title', 'aria-label', 'data-confirm', 'data-confirm-btn', 'alt'];
  var SKIP = { SCRIPT: 1, STYLE: 1, TEXTAREA: 1, CODE: 1, PRE: 1, NOSCRIPT: 1, TEMPLATE: 1 };
  // word pieces that are never translated on their own (parts of other words)
  // words that mean something else when they stand alone (a label) than inside a sentence
  var WHOLE = { 'থেকে': 'From', 'পর্যন্ত': 'Until', 'আছে': 'Yes', 'নেই': 'No' };
  var NEVER = { 'কো': 1, 'লা': 1, 'হা': 1, 'এ': 1, 'কে': 1, 'সে': 1, 'মি': 1, 'ঘ': 1, 'বাং': 1, 'টি': 1, 'জন': 1 };

  var dict = null;     // bangla → english
  var buckets = null;  // first two characters → keys (longest first)
  var loading = null;
  var lang = 'bn';
  var textOrig = new WeakMap();  // text node → original Bangla
  var attrOrig = new WeakMap();  // element → { attr: original }
  var setByUs = new WeakSet();   // nodes whose current text we wrote ourselves
  var docTitle = document.title;

  try { lang = localStorage.getItem(KEY) === 'en' ? 'en' : 'bn'; } catch (e) { /* private mode */ }

  // ---------------------------------------------------------------- dictionary
  var norm = function (s) { return String(s).replace(/\s+/g, ' ').trim(); };
  var isLetter = function (ch) { return !!ch && LETTER.test(ch); };
  var isAscii = function (ch) { return !!ch && /[A-Za-z0-9]/.test(ch); };
  var lettersIn = function (s) { var n = 0; for (var i = 0; i < s.length; i++) if (LETTER.test(s[i])) n++; return n; };

  function build(raw) {
    dict = Object.create(null);
    buckets = Object.create(null);
    var add = function (k, v) {
      k = norm(k);
      if (!k || k in dict) return;
      dict[k] = v;
      // word pieces are only used when they are the whole text — never inside other text
      if (NEVER[k] || /^[০-৯]+\s?(টি|টা|জন)$/.test(k)) return; // "৪টি" — counts are handled with the number
      var b = k.slice(0, 2);
      (buckets[b] = buckets[b] || []).push(k);
    };
    Object.keys(raw).forEach(function (k) {
      var v = raw[k];
      add(k, v);
      // the same phrase without a leading emoji / sign ("⚠️ …", "✅ …", "← …")
      var m = k.match(/^[^ঀ-৿A-Za-z0-9]+/);
      if (m) {
        var lead = m[0].trim();
        var core = k.slice(m[0].length);
        if (core && v.indexOf(lead) === 0) add(core, v.slice(lead.length).replace(/^\s+/, ''));
      }
    });
    Object.keys(buckets).forEach(function (b) { buckets[b].sort(function (x, y) { return y.length - x.length; }); });
  }

  function load() {
    if (dict) return Promise.resolve();
    if (loading) return loading;
    var v = (document.querySelector('script[data-admin-i18n]') || {}).getAttribute ? document.querySelector('script[data-admin-i18n]').getAttribute('data-v') : '';
    loading = fetch('/js/admin-en.json?v=' + encodeURIComponent(v || '1'), { credentials: 'same-origin' })
      .then(function (r) { if (!r.ok) throw new Error('dictionary ' + r.status); return r.json(); })
      .then(build)
      .catch(function (e) { loading = null; throw e; });
    return loading;
  }

  // ---------------------------------------------------------------- one string
  function tr(src) {
    if (!src || (!LETTER.test(src) && !HAS_DIGIT.test(src))) return src;
    var lead = (src.match(/^\s*/) || [''])[0];
    var trail = (src.match(/\s*$/) || [''])[0];
    var s = norm(src);
    if (s in WHOLE) return lead + WHOLE[s] + trail;
    if (s in dict) return lead + digits(dict[s]) + trail;
    var out = '';
    var i = 0;
    var hits = 0;
    while (i < s.length) {
      var prev = i ? s[i - 1] : '';
      var start = !(isLetter(prev) || (isAscii(prev) && isAscii(s[i])));
      var hit = null;
      if (start) {
        var list = buckets[s.substr(i, 2)];
        if (list) {
          for (var j = 0; j < list.length; j++) {
            var k = list[j];
            if (s.substr(i, k.length) !== k) continue;
            var next = s[i + k.length];
            var last = k[k.length - 1];
            if ((isLetter(last) && isLetter(next)) || (isAscii(last) && isAscii(next))) continue;
            hit = k;
            break;
          }
        }
      }
      if (hit) {
        var v = dict[hit];
        // keep words apart: "৩" + "completely out" → "3 completely out"
        if (v && /[A-Za-z0-9০-৯)\]]$/.test(out) && /^[A-Za-z0-9(]/.test(v)) out += ' ';
        out += v;
        i += hit.length;
        hits++;
        if (v && /[A-Za-z0-9.,:)]$/.test(v) && s[i] && /[A-Za-z0-9\u0980-\u09FF(]/.test(s[i])) out += ' ';
      } else { out += s[i]; i++; }
    }
    // counts and short forms after a number: ৫টি → 5, ১০জন → 10, ৳১হা → ৳1k, ৳২লা → ৳2L, ৳৩কো → ৳3Cr, ৫মি → 5m
    out = out.replace(/([০-৯0-9])\s?(টি|টা|জন)(?![\u0980-\u09E5\u09F0-\u09F2\u09F4-\u09FF])/g, '$1')
      .replace(/([০-৯0-9])(হা|লা|কো|মি|ঘ|সে)(?![\u0980-\u09E5\u09F0-\u09F2\u09F4-\u09FF])/g, function (m, d, u) {
        return d + { 'হা': 'k', 'লা': 'L', 'কো': 'Cr', 'মি': 'm', 'ঘ': 'h', 'সে': 's' }[u];
      });
    if (!hits && out === s) return lead + digits(s) + trail;
    // a sentence only partly known reads worse than the Bangla — keep it as it was
    var before = lettersIn(s);
    if (hits && before >= 12 && lettersIn(out) > before * 0.45) return lead + digits(s) + trail;
    out = out.replace(/\s+([,.;:!?)])/g, '$1').replace(/\s{2,}/g, ' ');
    return lead + digits(out) + trail;
  }
  function digits(s) { return String(s).replace(BN_DIGIT, function (d) { return '০১২৩৪৫৬৭৮৯'.indexOf(d); }).replace(/।/g, '.'); }

  // ---------------------------------------------------------------- the page
  function skipped(el) {
    for (var e = el; e && e !== document.body; e = e.parentElement) {
      if (SKIP[e.tagName] || SKIP[String(e.tagName).toUpperCase()]) return true;
      if (e.getAttribute && (e.getAttribute('translate') === 'no' || e.isContentEditable || e.hasAttribute('data-no-i18n'))) return true;
    }
    return false;
  }
  function doText(node) {
    if (setByUs.has(node)) { setByUs.delete(node); return; }
    var cur = node.nodeValue;
    if (lang === 'en') {
      if (!LETTER.test(cur) && !HAS_DIGIT.test(cur)) return;
      if (skipped(node.parentElement)) return;
      var en = tr(cur);
      if (en !== cur) { textOrig.set(node, cur); setByUs.add(node); node.nodeValue = en; }
    } else if (textOrig.has(node)) {
      node.nodeValue = textOrig.get(node); textOrig.delete(node);
    }
  }
  function doAttrs(el, ownOk) {
    var saved = attrOrig.get(el);
    for (var i = 0; i < ATTRS.length; i++) {
      var a = ATTRS[i];
      if (lang === 'en') {
        var v = el.getAttribute(a);
        if (!v || (!LETTER.test(v) && !HAS_DIGIT.test(v))) continue;
        if (skipped(ownOk ? el.parentElement : el) || (ownOk && el.getAttribute('translate') === 'no')) return;
        var en = tr(v);
        if (en !== v) { saved = saved || {}; if (!(a in saved)) saved[a] = v; attrOrig.set(el, saved); el.setAttribute(a, en); }
      } else if (saved && a in saved) {
        el.setAttribute(a, saved[a]);
      }
    }
    if (lang !== 'en' && saved) attrOrig.delete(el);
    // buttons drawn as <input type=submit value="…">
    if (el.tagName === 'INPUT' && /^(submit|button)$/i.test(el.type)) {
      var s2 = attrOrig.get(el) || {};
      if (lang === 'en' && LETTER.test(el.value)) { if (!('value' in s2)) s2.value = el.value; attrOrig.set(el, s2); el.value = tr(el.value); }
      else if (lang !== 'en' && 'value' in s2) el.value = s2.value;
    }
  }
  function walk(rootNode) {
    if (!rootNode) return;
    if (rootNode.nodeType === 3) { doText(rootNode); return; }
    if (rootNode.nodeType !== 1 || SKIP[rootNode.tagName]) return;
    doAttrs(rootNode);
    var tw = document.createTreeWalker(rootNode, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) { return n.nodeType === 1 && SKIP[n.tagName] ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT; },
    });
    var n;
    var texts = [];
    while ((n = tw.nextNode())) { if (n.nodeType === 3) texts.push(n); else doAttrs(n); }
    texts.forEach(doText);
    // text boxes: their hint (placeholder) is admin wording, what's typed inside is not
    var boxes = rootNode.querySelectorAll ? rootNode.querySelectorAll('textarea[placeholder]') : [];
    for (var i = 0; i < boxes.length; i++) doAttrs(boxes[i], true);
  }
  function applyAll() {
    root.setAttribute('data-admin-lang', lang);
    root.lang = lang === 'en' ? 'en' : 'bn';
    document.title = lang === 'en' ? tr(docTitle) : docTitle;
    walk(document.body);
    paintSwitch();
  }

  // live changes (toasts, search results, checks…)
  var mo = new MutationObserver(function (list) {
    if (lang !== 'en') return;
    for (var i = 0; i < list.length; i++) {
      var m = list[i];
      if (m.type === 'characterData') doText(m.target);
      else for (var j = 0; j < m.addedNodes.length; j++) walk(m.addedNodes[j]);
    }
  });

  // confirm() / alert() messages written in the admin's script
  var nativeConfirm = window.confirm.bind(window);
  var nativeAlert = window.alert.bind(window);
  window.confirm = function (msg) { return nativeConfirm(lang === 'en' && dict ? tr(String(msg)) : msg); };
  window.alert = function (msg) { return nativeAlert(lang === 'en' && dict ? tr(String(msg)) : msg); };

  // ---------------------------------------------------------------- the switch
  function paintSwitch() {
    var sws = document.querySelectorAll('[data-admin-lang-switch]');
    for (var i = 0; i < sws.length; i++) {
      sws[i].classList.toggle('is-en', lang === 'en');
      sws[i].setAttribute('aria-checked', lang === 'en' ? 'true' : 'false');
    }
  }
  function setLang(l) {
    lang = l === 'en' ? 'en' : 'bn';
    try { localStorage.setItem(KEY, lang); } catch (e) { /* ignore */ }
    if (lang === 'en') {
      root.classList.add('admin-i18n-busy');
      load().then(applyAll, function () { lang = 'bn'; paintSwitch(); })
        .then(function () { root.classList.remove('admin-i18n-busy'); });
    } else {
      applyAll();
    }
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-admin-lang-switch]');
    if (!b) return;
    e.preventDefault();
    setLang(lang === 'en' ? 'bn' : 'en');
  });

  function start() {
    paintSwitch();
    mo.observe(document.body, { childList: true, subtree: true, characterData: true });
    if (lang === 'en') {
      load().then(applyAll, function () { lang = 'bn'; paintSwitch(); })
        .then(function () { root.classList.remove('admin-i18n-wait'); });
    } else {
      root.classList.remove('admin-i18n-wait');
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
  // never leave the page hidden
  setTimeout(function () { root.classList.remove('admin-i18n-wait'); }, 2500);
  window.smAdminT = function (s) { return lang === 'en' && dict ? tr(s) : s; };
})();
