// Shared by crawl.mjs and scenarios.mjs.
// Anything that changes per request (random tokens, times, nonces) is blanked so only real differences remain.
export function normalise(body) {
  return canonicalHtml(body)
    .replace(/\bSM[A-Z0-9]{6}\b/g, '<order-code>')
    .replace(/(https?:)?(\/\/)?(127\.0\.0\.1|localhost):\d+/g, '<host>')
    .replace(/nonce="[^"]*"/g, 'nonce=""')
    .replace(/name="(csrf|_csrf|token|_t)" value="[^"]*"/g, 'name="$1" value=""')
    .replace(/\b[0-9a-f]{32,}\b/g, '<hex>')
    .replace(/(?<![\w/.-])[A-Za-z0-9_-]{40,}(?![\w/.-])/g, '<b64>')
    .replace(/এইমাত্র|[০-৯]+ (সেকেন্ড|মিনিট) আগে/g, '<ago>')
    .replace(/\b\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d(\.\d+)?)?Z?\b/g, '<iso>')
    .replace(/\b1[6-9]\d{11}\b/g, '<ms>')
    .replace(/[০-৯]{1,2}:[০-৯]{2}/g, '<hhmm>')
    .replace(/\b\d{1,2}:\d{2}(:\d{2})?\b/g, '<hhmm>')
    .replace(/\?v=[\w.-]+/g, '?v=<v>')
    // live matches come from the internet and change between two crawls: rows with a match are blanked whole
    .replace(/<tr[^>]*>(?:(?!<\/tr>)[\s\S])*?  vs  [\s\S]*?<\/tr>/g, '<tr><match></tr>')
    .replace(/<li[^>]*>(?:(?!<\/li>)[\s\S])*?  vs  [\s\S]*?<\/li>/g, '<li><match></li>')
    .replace(/(<tr><match><\/tr>\s*)+/g, '<tr><match></tr>').replace(/(<li><match><\/li>\s*)+/g, '<li><match></li>')
    // live match minutes and scores come from the internet and change between two crawls
    .replace(/>\d{1,3}(\+\d+)?&#39;</g, '><min>&#39;<').replace(/ \d{1,2}  vs  /g, ' <n>  vs  ').replace(/(  vs  [^<]*?) \d{1,2}</g, '$1 <n><')
    // secrets the app makes up the first time a page is opened, and the random tip of the day
    .replace(/data-reveal="[\w-]+"/g, 'data-reveal="<secret>"')
    .replace(/\/webhook\/autocall\/[\w-]+/g, '/webhook/autocall/<secret>')
    .replace(/(💡 ইলেকট্রনিক্স টিপস\n\n)[^<]*/g, '$1<tip>');
}

// ⚛️ Pages moved to React write the same page with tiny spelling differences that a browser treats as identical:
// &#x27; instead of &#39;, <br/> instead of <br>, required="" instead of required, no line breaks + indentation between tags,
// style="a:b;c:d" instead of style="a: b; c: d". These are made the same on both sides, so only real differences remain.
const BOOL_ATTRS = 'checked|selected|disabled|required|readonly|multiple|hidden|open|defer|async|autofocus|novalidate|download|reversed|playsinline|muted|controls|loop|autoplay|nomodule|inert|default|formnovalidate|allowfullscreen|itemscope';
export function canonicalHtml(body) {
  return String(body)
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&#x2F;/gi, '/')
    .replace(/\s*\/>/g, '>')
    .replace(new RegExp(`\\s(${BOOL_ATTRS})=""`, 'g'), ' $1')
    .replace(/\sstyle="([^"]*)"/g, (_, s) => ` style="${s.replace(/\s*([:;])\s*/g, '$1').replace(/;$/, '').trim()}"`)
    .replace(/\sclass="([^"]*)"/g, (_, c) => ` class="${c.trim().replace(/\s+/g, ' ')}"`)
    .replace(/\sclass=""/g, '')
    // attribute order, the case of attribute names and x="" vs a bare x don't matter to a browser
    // (React writes a form's action last, and data-flags / true-false attributes as x="")
    .replace(/<([a-zA-Z][\w-]*)((?:\s+[^\s=>\/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)+)\s*(\/?)>/g, (_, tag, attrs, slash) => {
      const list = [...attrs.matchAll(/\s+([^\s=>\/]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s>]+))?/g)].map((m) => (m[2] === undefined || m[2] === '""' || m[2] === "''" ? m[1].toLowerCase() : `${m[1].toLowerCase()}=${m[2]}`));
      return `<${tag} ${list.sort().join(' ')}${slash}>`;
    })
    // line breaks + indentation next to a tag are only source formatting (JSX drops them too);
    // a plain space between two tags on one line is real (it shows as a gap) and is kept
    .replace(/>[ \t]*\r?\n\s*/g, '>')
    .replace(/\s*\r?\n[ \t]*</g, '<')
    .replace(/\s+/g, ' ')
    .replace(/ >/g, '>');
}
