// Shared by crawl.mjs and scenarios.mjs.
// Anything that changes per request (random tokens, times, nonces) is blanked so only real differences remain.
export function normalise(body) {
  return canonicalHtml(String(body)
    .replace(/\bSM[A-Z0-9]{6}\b/g, '<order-code>')
    .replace(/(https?:)?(\/\/)?(127\.0\.0\.1|localhost):\d+/g, '<host>')
    .replace(/nonce="[^"]*"/g, 'nonce=""')
    .replace(/'nonce-[A-Za-z0-9+/=]+'/g, "'nonce-'") // the admin's script rule: a fresh nonce per page
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
    .replace(/(💡 ইলেকট্রনিক্স টিপস\n\n)[^<]*/g, '$1<tip>'));
}

// ⚛️ Pages moved to React write the same page with tiny spelling differences that a browser treats as identical:
// &#x27; instead of &#39;, <br/> instead of <br>, required="" instead of required, no line breaks + indentation between tags,
// style="a:b;c:d" instead of style="a: b; c: d". These are made the same on both sides, so only real differences remain.
const BLOCK = new Set(('html head body title meta link script style template noscript div p section article aside nav header footer main form fieldset legend '
  + 'h1 h2 h3 h4 h5 h6 ul ol li dl dt dd table thead tbody tfoot tr td th caption colgroup col hr br details summary figure figcaption '
  + 'blockquote dialog address menu option optgroup source track').split(' '));
const BOOL_ATTRS = 'checked|selected|disabled|required|readonly|multiple|hidden|open|defer|async|autofocus|novalidate|download|reversed|playsinline|muted|controls|loop|autoplay|nomodule|inert|default|formnovalidate|allowfullscreen|itemscope';
export function canonicalHtml(body) {
  return String(body)
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&#x2F;/gi, '/')
    .replace(/<\/option>/gi, '') // a closing </option> is optional in HTML (the next option or </select> closes it)
    .replace(/<!--[\s\S]*?-->/g, '') // comments show nothing (React can't write them)
    .replace(/\s*\/>/g, '>')
    .replace(new RegExp(`\\s(${BOOL_ATTRS})=""`, 'g'), ' $1')
    .replace(/\sstyle="([^"]*)"/g, (_, s) => ` style="${s.replace(/\s*([:;])\s*/g, '$1').replace(/;$/, '').trim()}"`)
    .replace(/\sclass="([^"]*)"/g, (_, c) => ` class="${c.trim().replace(/\s+/g, ' ')}"`)
    .replace(/\sclass=""/g, '')
    // attribute order, the case of attribute names and x="" vs a bare x don't matter to a browser
    // (React writes a form's action last, and data-flags / true-false attributes as x="")
    .replace(/<([a-zA-Z][\w-]*)((?:\s+[^\s=>\/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)+)\s*(\/?)>/g, (_, tag, attrs, slash) => {
      const list = [...attrs.matchAll(/\s+([^\s=>\/]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s>]+))?/g)].map((m) => (m[2] === undefined || m[2] === '""' || m[2] === "''" ? m[1].toLowerCase() : `${m[1].toLowerCase()}=${m[2].replace(/&amp;/g, '&')}`));
      return `<${tag} ${list.sort().join(' ')}${slash}>`;
    })
    // whitespace the way a browser shows it: next to a block (div, p, li, tr …) it shows nothing and is dropped;
    // between words or inline pieces (a, b, span, button …) any run — even a line break — shows as one space
    .replace(/(<\/?([a-zA-Z][\w-]*)\b[^>]*>)\s+(?=<\/?([a-zA-Z][\w-]*))/g, (_, tag, a, b) => tag + (BLOCK.has(a.toLowerCase()) || BLOCK.has(b.toLowerCase()) ? '' : ' '))
    .replace(/(<\/?([a-zA-Z][\w-]*)\b[^>]*>)\s+(?=[^<\s])/g, (_, tag, a) => tag + (BLOCK.has(a.toLowerCase()) ? '' : ' '))
    .replace(/([^>\s])\s+(?=<\/?([a-zA-Z][\w-]*))/g, (_, c, b) => c + (BLOCK.has(b.toLowerCase()) ? '' : ' '))
    .replace(/\s+/g, ' ')
    .replace(/ >/g, '>');
}
