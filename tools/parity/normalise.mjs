// Shared by crawl.mjs and scenarios.mjs.
// Anything that changes per request (random tokens, times, nonces) is blanked so only real differences remain.
export function normalise(body) {
  return canonicalHtml(nextNeutral(String(body))
    .replace(/\bSM[A-Z0-9]{6}\b/g, '«order-code»')
    .replace(/(https?:)?(\/\/)?(127\.0\.0\.1|localhost):\d+/g, '«host»')
    .replace(/nonce="[^"]*"/g, 'nonce=""')
    .replace(/'nonce-[A-Za-z0-9+/=]+'/g, "'nonce-'") // the admin's script rule: a fresh nonce per page
    .replace(/name="(csrf|_csrf|token|_t)" value="[^"]*"/g, 'name="$1" value=""')
    .replace(/\b[0-9a-f]{32,}\b/g, '«hex»')
    .replace(/(?<![\w/.-])[A-Za-z0-9_-]{40,}(?![\w/.-])/g, '«b64»')
    .replace(/এইমাত্র|[০-৯]+ (সেকেন্ড|মিনিট) আগে/g, '«ago»')
    .replace(/\b\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d(\.\d+)?)?Z?\b/g, '«iso»')
    .replace(/\b1[6-9]\d{11}\b/g, '«ms»')
    .replace(/[০-৯]{1,2}:[০-৯]{2}/g, '«hhmm»')
    .replace(/\b\d{1,2}:\d{2}(:\d{2})?\b/g, '«hhmm»')
    .replace(/\?v=[\w.-]+/g, '?v=«v»')
    .replace(/(খোলা সংযোগ: )[০-৯]+( \/ )/g, '$1«n»$2') // open database connections: a live count
    // live matches come from the internet and change between two crawls: rows with a match are blanked whole
    .replace(/<tr[^>]*>(?:(?!<\/tr>)[\s\S])*?  vs  [\s\S]*?<\/tr>/g, '<tr>«match»</tr>')
    .replace(/<li[^>]*>(?:(?!<\/li>)[\s\S])*?  vs  [\s\S]*?<\/li>/g, '<li>«match»</li>')
    .replace(/(<tr>«match»<\/tr>\s*)+/g, '<tr>«match»</tr>').replace(/(<li>«match»<\/li>\s*)+/g, '<li>«match»</li>')
    // live match minutes and scores come from the internet and change between two crawls
    .replace(/>\d{1,3}(\+\d+)?&#39;</g, '>«min»&#39;<').replace(/ \d{1,2}  vs  /g, ' «n»  vs  ').replace(/(  vs  [^<]*?) \d{1,2}</g, '$1 «n»<')
    // secrets the app makes up the first time a page is opened, and the random tip of the day
    .replace(/data-reveal="[\w-]+"/g, 'data-reveal="«secret»"')
    .replace(/\/webhook\/autocall\/[\w-]+/g, '/webhook/autocall/«secret»')
    .replace(/(💡 ইলেকট্রনিক্স টিপস\n\n)[^<]*/g, '$1«tip»'));
}

// ⚛️ Pages moved to React write the same page with tiny spelling differences that a browser treats as identical:
// &#x27; instead of &#39;, <br/> instead of <br>, required="" instead of required, no line breaks + indentation between tags,
// style="a:b;c:d" instead of style="a: b; c: d". These are made the same on both sides, so only real differences remain.
const BLOCK = new Set(('html head body title meta link script style template noscript div p section article aside nav header footer main form fieldset legend '
  + 'h1 h2 h3 h4 h5 h6 ul ol li dl dt dd table thead tbody tfoot tr td th caption colgroup col hr br details summary figure figcaption '
  + 'blockquote dialog address menu option optgroup source track').split(' '));
const decodeEnt = (v) => v.replace(/&quot;/g, '"').replace(/&#0?39;|&#x27;/gi, "'").replace(/&#x2F;/gi, '/').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const TAG = /<([a-zA-Z][\w-]*)((?:\s+[^\s=>\/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>"']+))?)*)\s*(\/?)>/g;

// One start tag, written one way: lower-case attribute names in order, values decoded and double-quoted,
// x="" written as bare x, style and class spacing tidied, React's empty src left out.
function canonicalTag(tag, attrs) {
  const list = [];
  for (const m of attrs.matchAll(/\s+([^\s=>\/]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s>"']+))?/g)) {
    const name = m[1].toLowerCase();
    let v = m[2] === undefined ? '' : decodeEnt(/^["']/.test(m[2]) ? m[2].slice(1, -1) : m[2]);
    if (name === 'style') v = v.replace(/\s*([:;])\s*/g, '$1').replace(/;$/, '').trim();
    if (name === 'class') v = v.trim().replace(/\s+/g, ' ');
    if (name === 'srcdoc') v = canonicalHtml(v); // a whole page inside an attribute (document previews)
    if (v === '' && (name === 'class' || (name === 'src' && /^img$/i.test(tag)))) continue;
    list.push(v === '' ? name : `${name}="${v.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"`);
  }
  return `<${tag.toLowerCase()}${list.length ? ' ' + list.sort().join(' ') : ''}>`;
}

export function canonicalHtml(body) {
  const src = String(body)
    .replace(/<\/option>/gi, '') // a closing </option> is optional in HTML (the next option or </select> closes it)
    .replace(/<\/(path|circle|rect|line|polyline|polygon|ellipse|stop|use)>/g, '') // SVG shapes: <path/> and <path></path> are the same
    .replace(/<!--[\s\S]*?-->/g, ''); // comments show nothing (React can't write them)
  // tags one way; text between tags with one spelling of ' " /
  let out = '';
  let last = 0;
  for (const m of src.matchAll(TAG)) {
    out += decodeText(src.slice(last, m.index));
    out += canonicalTag(m[1], m[2]);
    last = m.index + m[0].length;
  }
  out += decodeText(src.slice(last));
  return out
    // whitespace the way a browser shows it: next to a block (div, p, li, tr …) it shows nothing and is dropped;
    // between words or inline pieces (a, b, span, button …) any run — even a line break — shows as one space
    .replace(/(<\/?([a-zA-Z][\w-]*)\b(?:[^>"]|"[^"]*")*>)\s+(?=<\/?([a-zA-Z][\w-]*))/g, (_, tag, a, b) => tag + (BLOCK.has(a.toLowerCase()) || BLOCK.has(b.toLowerCase()) ? '' : ' '))
    .replace(/(<\/?([a-zA-Z][\w-]*)\b(?:[^>"]|"[^"]*")*>)\s+(?=[^<\s])/g, (_, tag, a) => tag + (BLOCK.has(a.toLowerCase()) ? '' : ' '))
    .replace(/([^>\s])\s+(?=<\/?([a-zA-Z][\w-]*))/g, (_, c, b) => c + (BLOCK.has(b.toLowerCase()) ? '' : ' '))
    .replace(/\s+/g, ' ');
}
// text between tags: ' " / written one way (&lt; &gt; &amp; stay, they matter)
function decodeText(t) { return t.replace(/&#0?39;|&#x27;/gi, "'").replace(/&quot;/g, '"').replace(/&#x2F;/gi, '/'); }

// ⚛️ Pages served by Next.js carry Next's own parts that the old pages didn't: its scripts (/_next/…), the page data
// for React (self.__next_f), a hidden boundary div; ready-made HTML sits in see-through wrappers (data-unwrap); the
// <head> is written by Next.js's metadata in its own order and JSON-LD may sit in the body. None of that changes what
// a visitor or Google sees, so: Next's parts are removed, wrappers unwrapped, the head compared as a sorted set, and
// JSON-LD compared as a set at the end of the page.
export function nextNeutral(body) {
  let s = String(body).replace(/^<!DOCTYPE html>/i, '<!doctype html>');
  if (!/<html[\s>]/i.test(s)) return unwrap(s); // a piece of a page (e.g. tests/golden) — only the wrappers
  s = s
    .replace(/<script\b[^>]*\bsrc="[^"]*\/_next\/[^"]*"[^>]*>\s*<\/script>/g, '')
    .replace(/<script\b[^>]*>(?:(?!<\/script>)[\s\S])*?(?:self\.__next_f|__next_s|\$RC|\$RS|\$RX|requestAnimationFrame\(function\(\)\{\$RT)(?:(?!<\/script>)[\s\S])*<\/script>/g, '')
    .replace(/<link\b[^>]*\bhref="[^"]*\/_next\/[^"]*"[^>]*\/?>/g, '')
    .replace(/<meta name="next-size-adjust"[^>]*>/g, '')
    .replace(/<div hidden(?:="")?>\s*(?:<!--\$-->|<!--\/\$-->|<!--\$\?-->)*\s*<\/div>/g, '')
    .replace(/<!--\/?\$\??-->/g, '');
  s = unwrap(s);
  // JSON-LD: wherever it is, compared as a set at the end
  const ld = [];
  s = s.replace(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g, (_, j) => { ld.push(j); return ''; });
  // the head as a sorted set of its tags
  s = s.replace(/<head>([\s\S]*?)<\/head>/, (_, inner) => `<head>${headSet(inner)}</head>`);
  return ld.length ? s.replace(/<\/body>/, `${ld.sort().map((j) => `<script type="application/ld+json">${j}</script>`).join('')}</body>`) : s;
}
function unwrap(s) {
  for (let guard = 0; guard < 500; guard++) {
    const m = /<div (?:style="display:\s*contents;?" data-unwrap(?:="")?|data-unwrap(?:="")? style="display:\s*contents;?")>/.exec(s);
    if (!m) break;
    let depth = 1; let i = m.index + m[0].length;
    const re = /<div\b|<\/div>/g; re.lastIndex = i;
    let end = -1;
    for (let t; (t = re.exec(s));) { depth += t[0] === '</div>' ? -1 : 1; if (!depth) { end = t.index; break; } }
    if (end < 0) break;
    s = s.slice(0, m.index) + s.slice(i, end) + s.slice(end + 6);
  }
  return s;
}
function headSet(inner) {
  const parts = [];
  const re = /<(script|style|title|noscript)\b[^>]*>[\s\S]*?<\/\1>|<(meta|link|base)\b[^>]*>/g;
  for (let m; (m = re.exec(inner));) parts.push(canonicalHtml(m[0]).trim());
  return parts.sort().join('');
}
