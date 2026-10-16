// Shared by crawl.mjs and scenarios.mjs.
// Anything that changes per request (random tokens, times, nonces) is blanked so only real differences remain.
export function normalise(body) {
  return body
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
