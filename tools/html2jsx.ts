// ⚛️ html`…` → JSX converter for the move to React (2026-10-17).
//
//   npx tsx tools/html2jsx.ts lib/admin/foo.ts [more files…]     → writes lib/admin/foo.tsx, removes foo.ts
//
// Every html`…` template in the file becomes toHtml(<JSX/>) with exactly the same meaning:
//   • a value in the page (text) → <Val v={…}/> (escaped text, or ready-made HTML when it is a Raw) — or real JSX when
//     it is itself html`…`, a ?: of html`…`, a .map() that returns html`…`, or raw(…)
//   • a value inside an attribute → attrValue(…) (React escapes it), style="…" → styleOf(…), attributes written as text
//     (${on ? raw('checked') : ''}) → {...attrProps(…)}
//   • <script>/<style> keep their exact text (dangerouslySetInnerHTML with htmlValue(…))
// A template whose tags don't close inside it (a page built from pieces) is left as html`…` and reported.
// The pages are then checked against the old ones by tools/parity (every page, real data).
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

// ---------------------------------------------------------------- tiny HTML parser (with ${} placeholders)
const P0 = '';
const P1 = '';
const VOID = new Set('area base br col embed hr img input link meta param source track wbr'.split(' '));
const RAWTEXT = new Set(['script', 'style', 'textarea']);
const BLOCK = new Set(('html head body title meta link script style template noscript div p section article aside nav header footer main form fieldset legend '
  + 'h1 h2 h3 h4 h5 h6 ul ol li dl dt dd table thead tbody tfoot tr td th caption colgroup col hr br details summary figure figcaption '
  + 'blockquote dialog address menu option optgroup source track').split(' '));

type Part = string | number; // text, or index of a placeholder
type Attr = { name: string; value: Part[] | null } | { spread: number };
type El = { kind: 'el'; tag: string; attrs: Attr[]; children: Node[] };
type Text = { kind: 'text'; parts: Part[] };
type Node = El | Text;

class Unconvertible extends Error {}

function splitParts(s: string): Part[] {
  const out: Part[] = [];
  const re = new RegExp(`${P0}(\\d+)${P1}`, 'g');
  let last = 0;
  for (const m of s.matchAll(re)) {
    if (m.index! > last) out.push(s.slice(last, m.index));
    out.push(Number(m[1]));
    last = m.index! + m[0].length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}

function parse(src: string): Node[] {
  const root: El = { kind: 'el', tag: '#root', attrs: [], children: [] };
  const stack: El[] = [root];
  let i = 0;
  const top = () => stack[stack.length - 1];
  const pushText = (t: string) => { if (t) top().children.push({ kind: 'text', parts: splitParts(t) }); };
  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt < 0) { pushText(src.slice(i)); break; }
    pushText(src.slice(i, lt));
    if (src.startsWith('<!--', lt)) {
      const end = src.indexOf('-->', lt + 4);
      if (end < 0) throw new Unconvertible('open comment');
      i = end + 3;
      continue;
    }
    if (/^<!doctype/i.test(src.slice(lt, lt + 9))) throw new Unconvertible('doctype');
    if (/^<(html|head)[\s>]/i.test(src.slice(lt, lt + 6))) throw new Unconvertible('document shell (<html>/<head> stay as written, so React does not reorder the head)');
    const close = /^<\/([a-zA-Z][\w-]*)\s*>/.exec(src.slice(lt));
    if (close) {
      const name = close[1].toLowerCase();
      // HTML lets </option> be left out: the list's end closes it
      while (top().tag.toLowerCase() === 'option' && name !== 'option') stack.pop();
      if (top().tag.toLowerCase() !== name) throw new Unconvertible(`</${name}> closes <${top().tag}>`);
      stack.pop();
      i = lt + close[0].length;
      continue;
    }
    const open = /^<([a-zA-Z][\w-]*)/.exec(src.slice(lt));
    if (!open) { pushText('<'); i = lt + 1; continue; } // a lone "<" in text
    const tag = open[1];
    const el: El = { kind: 'el', tag, attrs: [], children: [] };
    let j = lt + open[0].length;
    let selfClose = false;
    for (;;) {
      while (j < src.length && /\s/.test(src[j])) j++;
      if (j >= src.length) throw new Unconvertible('open tag');
      if (src[j] === '>') { j++; break; }
      if (src.startsWith('/>', j)) { j += 2; selfClose = true; break; }
      if (src[j] === P0) {
        const end = src.indexOf(P1, j);
        el.attrs.push({ spread: Number(src.slice(j + 1, end)) });
        j = end + 1;
        continue;
      }
      const nm = /^[^\s=>/]+/.exec(src.slice(j));
      if (!nm) throw new Unconvertible('attribute name');
      const name = nm[0];
      if (name.includes(P0)) throw new Unconvertible('placeholder in attribute name');
      j += name.length;
      while (j < src.length && /\s/.test(src[j])) j++;
      if (src[j] !== '=') { el.attrs.push({ name, value: null }); continue; }
      j++;
      while (j < src.length && /\s/.test(src[j])) j++;
      let raw: string;
      if (src[j] === '"' || src[j] === "'") {
        const q = src[j];
        const end = src.indexOf(q, j + 1);
        if (end < 0) throw new Unconvertible('open attribute value');
        raw = src.slice(j + 1, end);
        j = end + 1;
      } else {
        const m = /^[^\s>]+/.exec(src.slice(j));
        raw = m ? m[0] : '';
        j += raw.length;
      }
      el.attrs.push({ name, value: splitParts(raw) });
    }
    const lname = tag.toLowerCase();
    if ((lname === 'option' || lname === 'optgroup') && top().tag.toLowerCase() === 'option') stack.pop(); // the next <option> closes the last one
    top().children.push(el);
    if (VOID.has(lname) || selfClose) { i = j; continue; }
    if (RAWTEXT.has(lname)) {
      const end = src.toLowerCase().indexOf(`</${lname}`, j);
      if (end < 0) throw new Unconvertible(`open <${lname}>`);
      const inner = src.slice(j, end);
      if (inner) el.children.push({ kind: 'text', parts: splitParts(inner) });
      const gt = src.indexOf('>', end);
      i = gt + 1;
      continue;
    }
    stack.push(el);
    i = j;
  }
  while (stack.length > 1 && top().tag.toLowerCase() === 'option') stack.pop();
  if (stack.length !== 1) throw new Unconvertible(`<${top().tag}> not closed`);
  return root.children;
}

// ---------------------------------------------------------------- entities
const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', times: '×', hellip: '…', mdash: '—', ndash: '–', rarr: '→', larr: '←', uarr: '↑', darr: '↓', copy: '©', reg: '®', middot: '·', bull: '•', laquo: '«', raquo: '»', deg: '°', plusmn: '±', check: '✓', trade: '™', euro: '€', pound: '£', zwj: '‍', zwnj: '‌', shy: '­', thinsp: ' ', ensp: ' ', emsp: ' ' };
function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    const v = NAMED[e.toLowerCase()];
    if (v === undefined) throw new Unconvertible(`unknown entity ${m}`);
    return v;
  });
}

// ---------------------------------------------------------------- attributes → JSX props
const RENAME: Record<string, string> = {
  class: 'className', for: 'htmlFor', maxlength: 'maxLength', minlength: 'minLength', tabindex: 'tabIndex', readonly: 'readOnly',
  autocomplete: 'autoComplete', autofocus: 'autoFocus', inputmode: 'inputMode', colspan: 'colSpan', rowspan: 'rowSpan', novalidate: 'noValidate',
  enctype: 'encType', 'accept-charset': 'acceptCharset', crossorigin: 'crossOrigin', srcset: 'srcSet', allowfullscreen: 'allowFullScreen',
  spellcheck: 'spellCheck', contenteditable: 'contentEditable', 'http-equiv': 'httpEquiv', charset: 'charSet', autocapitalize: 'autoCapitalize',
  referrerpolicy: 'referrerPolicy', fetchpriority: 'fetchPriority', playsinline: 'playsInline', datetime: 'dateTime', formaction: 'formAction',
  formmethod: 'formMethod', formnovalidate: 'formNoValidate', formtarget: 'formTarget', autoplay: 'autoPlay', enterkeyhint: 'enterKeyHint',
  accesskey: 'accessKey', itemprop: 'itemProp', itemscope: 'itemScope', itemtype: 'itemType', frameborder: 'frameBorder', viewbox: 'viewBox',
};
// props whose TypeScript type accepts any string
const STRING_OK = new Set(('id className htmlFor name type href src alt title role rel target method action placeholder min max step pattern accept '
  + 'form list loading lang dir media sizes decoding autoComplete inputMode nonce width height download label srcSet crossOrigin encType acceptCharset '
  + 'referrerPolicy poster preload wrap scope headers accessKey charSet content httpEquiv itemProp itemType dateTime cite formAction formMethod formTarget '
  + 'autoCapitalize enterKeyHint allow sandbox frameBorder viewBox xmlns d fill stroke cx cy r x y x1 x2 y1 y2 points transform '
  + 'color shape coords span abbr summary').split(' '));
const NUMERIC = new Set('maxLength minLength tabIndex rows cols size colSpan rowSpan start'.split(' '));
const BOOL = new Set(('required disabled checked selected multiple hidden open defer async autoFocus noValidate readOnly allowFullScreen playsInline muted '
  + 'controls loop autoPlay reversed formNoValidate itemScope').split(' '));

const q = (s: string) => JSON.stringify(s);
// a JSON string literal that can be written as a plain JSX attribute "…" (no escapes, no & that JSX would read as an entity)
const plain = (v: string) => (/^"[^"\\&{}]*"$/.test(v) ? v : `{${v}}`);
function tmpl(parts: Part[], exprs: string[], fn: string, decodeStatic: boolean): string {
  if (parts.length === 1 && typeof parts[0] === 'number') return `${fn}(${exprs[parts[0]]})`;
  if (parts.every((p) => typeof p === 'string')) return q(decodeStatic ? decode(parts.join('')) : parts.join(''));
  return '`' + parts.map((p) => (typeof p === 'number' ? `\${${fn}(${exprs[p]})}` : (decodeStatic ? decode(p) : p).replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${'))).join('') + '`';
}

function propsOf(el: El, exprs: string[]): string {
  const props: string[] = [];
  const loose: string[] = [];
  const lname = el.tag.toLowerCase();
  for (const a of el.attrs) {
    if ('spread' in a) { props.push(`{...attrProps(${exprs[a.spread]})}`); continue; }
    const raw = a.name;
    const low = raw.toLowerCase();
    if (/^on/.test(low)) throw new Unconvertible(`inline handler ${raw}`);
    if (low === 'style') {
      props.push(`style={styleOf(${a.value ? tmpl(a.value, exprs, 'attrValue', true) : '""'})}`);
      continue;
    }
    let name = RENAME[low] || (low.startsWith('data-') || low.startsWith('aria-') ? low : low);
    // React's names for form state
    if (lname === 'input' && name === 'value') name = 'defaultValue';
    if (lname === 'input' && name === 'checked') name = 'defaultChecked';
    if (a.value === null) {
      if (BOOL.has(name) || name === 'defaultChecked') props.push(name);
      else if (name.includes('-')) props.push(`${name}=""`);
      else loose.push(`${q(name)}: ""`);
      continue;
    }
    const isStatic = a.value.every((p) => typeof p === 'string');
    const val = tmpl(a.value, exprs, 'attrValue', true);
    if (BOOL.has(name) || name === 'defaultChecked') {
      if (isStatic) props.push(name);
      else loose.push(`${q(low)}: ${val}`); // a value written into a true/false attribute: keep it as text
      continue;
    }
    if (name.startsWith('aria-')) { loose.push(`${q(name)}: ${val}`); continue; }
    if (name.startsWith('data-')) { props.push(`${name}=${plain(val)}`); continue; }
    if (NUMERIC.has(name)) {
      const s = a.value.join('');
      if (isStatic && /^-?\d+$/.test(s.trim())) props.push(`${name}={${Number(s)}}`);
      else loose.push(`${q(low)}: ${val}`);
      continue;
    }
    if (name === 'defaultValue' || name === 'value' || STRING_OK.has(name)) { props.push(`${name}=${plain(val)}`); continue; }
    loose.push(`${q(low)}: ${val}`);
  }
  // attributes React's types don't know (or know as numbers): passed through as text, exactly as written
  if (loose.length) props.push(`{...({ ${loose.join(', ')} } as Record<string, string>)}`);
  return props.length ? ' ' + props.join(' ') : '';
}

// ---------------------------------------------------------------- JSX emission
type Ctx = { exprs: string[]; child: (i: number) => string };

function isBlockNode(n: Node | undefined, parentBlock: boolean): boolean {
  if (!n) return parentBlock; // edge of the parent
  return n.kind === 'el' && BLOCK.has(n.tag.toLowerCase());
}

function textJsx(t: Text, prev: Node | undefined, next: Node | undefined, parentBlock: boolean, ctx: Ctx): string {
  let out = '';
  t.parts.forEach((p, k) => {
    if (typeof p === 'number') { const c = ctx.child(p); out += /^<[\s\S]*>$/.test(c) && !/^<>/.test(c) && balancedJsx(c) ? c : `{${c}}`; return; }
    const before = k === 0 ? prev : undefined;
    const after = k === t.parts.length - 1 ? next : undefined;
    const lead = /^\s/.test(p); const trail = /\s$/.test(p);
    const body = decode(p.trim().replace(/\s+/g, ' '));
    const leadSp = lead && !(k === 0 && isBlockNode(before, parentBlock));
    const trailSp = trail && !(k === t.parts.length - 1 && isBlockNode(after, parentBlock));
    if (!body) {
      // whitespace only: one space between two inline things
      if (leadSp && trailSp) out += "{' '}";
      return;
    }
    if (leadSp) out += "{' '}";
    out += /[{}<>&]/.test(body) || body.includes(' ') ? `{${q(body)}}` : body;
    if (trailSp) out += "{' '}";
  });
  return out;
}

// "<Val v={x} />" can stand alone in JSX; "(a ? <b/> : null)" needs braces
function balancedJsx(c: string): boolean { return /^<(Val|RawHtml) v=\{|^<RawHtml html=\{/.test(c) && c.endsWith(' />') && !c.slice(1).includes(' />\n'); }

function nodesJsx(nodes: Node[], parentBlock: boolean, ctx: Ctx, inSvg = false): string {
  return nodes.map((n, i) => (n.kind === 'text' ? textJsx(n, nodes[i - 1], nodes[i + 1], parentBlock, ctx) : elJsx(n, ctx, inSvg))).join('');
}

// React 19 moves <link>, <meta>, <title> and async <script> to the top of the page. These are written out exactly as the
// template wrote them (values escaped the html`` way, by H), so they stay where they were.
function hoistable(el: El, inSvg: boolean): boolean {
  const t = el.tag.toLowerCase();
  if (inSvg) return false;
  if (t === 'link' || t === 'meta' || t === 'title' || t === 'base') return true;
  return t === 'script' && el.attrs.some((a) => 'name' in a && a.name.toLowerCase() === 'async');
}
function rawEl(el: El, ctx: Ctx): string {
  const piece = (parts: Part[]) => parts.map((p) => (typeof p === 'number' ? `\${htmlValue(${ctx.exprs[p]})}` : p.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${'))).join('');
  let s = `<${el.tag}`;
  for (const a of el.attrs) {
    if ('spread' in a) s += ` \${htmlValue(${ctx.exprs[a.spread]})}`;
    else s += a.value === null ? ` ${a.name}` : ` ${a.name}="${piece(a.value)}"`;
  }
  s += '>';
  if (!VOID.has(el.tag.toLowerCase())) {
    for (const c of el.children) {
      if (c.kind === 'text') s += piece(c.parts);
      else throw new Unconvertible(`element inside <${el.tag}>`);
    }
    s += `</${el.tag}>`;
  }
  return `<RawHtml html={\`${s}\`} />`;
}

function elJsx(el: El, ctx: Ctx, inSvg = false): string {
  const lname = el.tag.toLowerCase();
  if (hoistable(el, inSvg)) return rawEl(el, ctx);
  const props = propsOf(el, ctx.exprs);
  if (lname === 'script' || lname === 'style') {
    const inner = el.children.length ? (el.children[0] as Text).parts : [];
    if (!inner.length) return `<${el.tag}${props} />`;
    return `<${el.tag}${props} dangerouslySetInnerHTML={{ __html: ${tmpl(inner, ctx.exprs, 'htmlValue', false)} }} />`;
  }
  if (lname === 'title' && !inSvg && el.children.every((c) => c.kind === 'text')) {
    // React wants plain text inside <title>
    const parts = el.children.flatMap((c) => (c as Text).parts);
    return `<title${props}>{${tmpl(parts.map((p) => (typeof p === 'string' ? p.replace(/\s+/g, ' ') : p)), ctx.exprs, 'attrValue', true)}}</title>`;
  }
  if (lname === 'textarea') {
    const inner = el.children.length ? (el.children[0] as Text).parts : [];
    return `<textarea${props}${inner.length ? ` defaultValue={${tmpl(inner, ctx.exprs, 'attrValue', true)}}` : ''} />`;
  }
  if (VOID.has(lname) || !el.children.length) return VOID.has(lname) ? `<${el.tag}${props} />` : `<${el.tag}${props}></${el.tag}>`;
  return `<${el.tag}${props}>${nodesJsx(el.children, BLOCK.has(lname), ctx, inSvg || lname === 'svg')}</${el.tag}>`;
}

// ---------------------------------------------------------------- TypeScript side
function isHtmlTemplate(n: ts.Node): n is ts.TaggedTemplateExpression {
  return ts.isTaggedTemplateExpression(n) && ts.isIdentifier(n.tag) && n.tag.text === 'html';
}

type Stats = { converted: number; kept: string[]; seen: Set<number> };

function makeConverter(sf: ts.SourceFile, stats: Stats) {
  const text = (n: ts.Node) => n.getText(sf);

  // Source text of an expression with every html`…` inside it turned into toHtml(…).
  function rewrite(n: ts.Node): string {
    const edits: { start: number; end: number; s: string }[] = [];
    const visit = (m: ts.Node) => {
      if (isHtmlTemplate(m)) { const r = rewrite(m); edits.push({ start: m.getStart(sf), end: m.getEnd(), s: r }); return; }
      if (ts.isTypeAssertionExpression(m)) {
        edits.push({ start: m.getStart(sf), end: m.getEnd(), s: `(${rewrite(m.expression)} as ${text(m.type)})` });
        return;
      }
      ts.forEachChild(m, visit);
    };
    if (n !== undefined) ts.forEachChild(n, visit);
    if (isHtmlTemplate(n)) { const j = templateJsx(n); if (j) return `toHtml(${j})`; } // otherwise: kept, with its inner pieces converted below
    if (ts.isTypeAssertionExpression(n)) return `(${rewrite(n.expression)} as ${text(n.type)})`;
    let s = text(n);
    const base = n.getStart(sf);
    for (const e of edits.sort((a, b) => b.start - a.start)) s = s.slice(0, e.start - base) + e.s + s.slice(e.end - base);
    return s;
  }

  // A value that sits in the page between tags.
  function child(n: ts.Expression): string {
    if (ts.isParenthesizedExpression(n)) return child(n.expression);
    if (isHtmlTemplate(n)) { const j = templateJsx(n); if (j) return j; return `<Val v={${text(n)}} />`; }
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return n.text === '' ? 'null' : q(n.text);
    if (n.kind === ts.SyntaxKind.NullKeyword || n.kind === ts.SyntaxKind.FalseKeyword || (ts.isIdentifier(n) && n.text === 'undefined')) return 'null';
    if (ts.isConditionalExpression(n)) return `(${rewrite(n.condition)} ? ${child(n.whenTrue)} : ${child(n.whenFalse)})`;
    if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken && isJsxable(n.right)) return `(${rewrite(n.left)} && ${child(n.right)})`;
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'raw' && n.arguments.length === 1) return `<RawHtml html={${rewrite(n.arguments[0])}} />`;
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === 'map' && n.arguments.length >= 1) {
      const cb = n.arguments[0];
      if ((ts.isArrowFunction(cb) || ts.isFunctionExpression(cb)) && returnsJsxOnly(cb)) {
        return `jsxList(${rewrite(n.expression.expression)}.map(${callback(cb)}${n.arguments.length > 1 ? ', ' + n.arguments.slice(1).map(text).join(', ') : ''}))`;
      }
    }
    return `<Val v={${rewrite(n)}} />`;
  }
  // can this expression be written as JSX (so html`` semantics are kept exactly)?
  function isJsxable(n: ts.Expression): boolean {
    if (ts.isParenthesizedExpression(n)) return isJsxable(n.expression);
    if (isHtmlTemplate(n)) return true;
    if (ts.isConditionalExpression(n)) return isJsxable(n.whenTrue) && isJsxable(n.whenFalse);
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return n.text === '';
    return n.kind === ts.SyntaxKind.NullKeyword || n.kind === ts.SyntaxKind.FalseKeyword || (ts.isIdentifier(n) && n.text === 'undefined');
  }
  function returnsJsxOnly(fn: ts.ArrowFunction | ts.FunctionExpression): boolean {
    if (ts.isArrowFunction(fn) && !ts.isBlock(fn.body)) return isJsxable(fn.body as ts.Expression);
    let ok = true; let any = false;
    const visit = (m: ts.Node) => {
      if (ts.isFunctionLike(m) && m !== fn) return;
      if (ts.isReturnStatement(m)) { any = true; if (!m.expression || !isJsxable(m.expression)) ok = false; }
      ts.forEachChild(m, visit);
    };
    ts.forEachChild(fn.body!, visit);
    return ok && any;
  }
  function callback(fn: ts.ArrowFunction | ts.FunctionExpression): string {
    const head = text(fn).slice(0, fn.body!.getStart(sf) - fn.getStart(sf));
    if (ts.isArrowFunction(fn) && !ts.isBlock(fn.body)) return head + child(fn.body as ts.Expression);
    // block body: rewrite each return
    const body = fn.body as ts.Block;
    const edits: { start: number; end: number; s: string }[] = [];
    const visit = (m: ts.Node) => {
      if (ts.isFunctionLike(m)) { if (m !== fn) { const r = rewrite(m); edits.push({ start: m.getStart(sf), end: m.getEnd(), s: r }); } return; }
      if (ts.isReturnStatement(m) && m.expression) { edits.push({ start: m.expression.getStart(sf), end: m.expression.getEnd(), s: child(m.expression) }); return; }
      if (isHtmlTemplate(m)) { const j = templateJsx(m); if (j) edits.push({ start: m.getStart(sf), end: m.getEnd(), s: `toHtml(${j})` }); return; }
      ts.forEachChild(m, visit);
    };
    ts.forEachChild(body, visit);
    let s = text(body);
    const base = body.getStart(sf);
    for (const e of edits.sort((a, b) => b.start - a.start)) s = s.slice(0, e.start - base) + e.s + s.slice(e.end - base);
    return head + s;
  }

  // html`…` → JSX text, or null if it can't be converted safely
  function templateJsx(t: ts.TaggedTemplateExpression): string | null {
    const tpl = t.template;
    const exprNodes: ts.Expression[] = [];
    let src: string;
    // the template's text as the program sees it (escapes such as \` already applied)
    if (ts.isNoSubstitutionTemplateLiteral(tpl)) src = tpl.text;
    else {
      src = tpl.head.text;
      tpl.templateSpans.forEach((sp, i) => { exprNodes.push(sp.expression); src += `${P0}${i}${P1}` + sp.literal.text; });
    }
    try {
      const nodes = parse(src);
      const exprs = exprNodes.map((e) => rewrite(e));
      const ctx: Ctx = { exprs, child: (i) => child(exprNodes[i]) };
      // a template that is only text and values (no tags) stays a fragment
      // (whitespace at the very start or end of a template is kept: the template may sit between words)
      let jsx: string;
      if (nodes.length === 1 && nodes[0].kind === 'el') jsx = elJsx(nodes[0], ctx);
      else jsx = `<>${nodesJsx(nodes, false, ctx)}</>`;
      if (!stats.seen.has(t.getStart(sf))) { stats.seen.add(t.getStart(sf)); stats.converted++; }
      return jsx;
    } catch (e) {
      if (!(e instanceof Unconvertible)) throw e;
      if (!stats.seen.has(-t.getStart(sf) - 1)) { stats.seen.add(-t.getStart(sf) - 1); stats.kept.push(`line ${sf.getLineAndCharacterOfPosition(t.getStart(sf)).line + 1}: ${e.message}`); }
      return null;
    }
  }

  return { rewrite };
}

function convertFile(file: string): Stats {
  const code = fs.readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const stats: Stats = { converted: 0, kept: [], seen: new Set() };
  const conv = makeConverter(sf, stats);
  const edits: { start: number; end: number; s: string }[] = [];
  // outermost html`…` and type assertions anywhere in the file
  const visit = (n: ts.Node) => {
    if (isHtmlTemplate(n) || ts.isTypeAssertionExpression(n)) {
      const s = conv.rewrite(n);
      edits.push({ start: n.getStart(sf), end: n.getEnd(), s });
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  let out = code;
  for (const e of edits.sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + e.s + out.slice(e.end);
  // the helpers the converted code uses
  const rel = path.relative(path.dirname(file), 'lib/react/render').replace(/\\/g, '/');
  const used = ['toHtml', 'Val', 'RawHtml', 'attrValue', 'htmlValue', 'attrProps', 'styleOf', 'jsxList'].filter((h) => new RegExp(`(?:^|[^\\w$.]|\\.\\.\\.)${h}\\(|<${h}[\\s/>]`).test(out));
  if (used.length) {
    const from = rel.startsWith('.') ? rel : './' + rel;
    const existing = new RegExp(`^import \\{([^}]*)\\} from '${from.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}';$`, 'm').exec(out);
    if (existing) {
      const have = existing[1].split(',').map((x) => x.trim()).filter(Boolean);
      const all = [...have, ...used.filter((u) => !have.includes(u))];
      out = out.replace(existing[0], `import { ${all.join(', ')} } from '${from}';`);
    } else {
      const imp = `import { ${used.join(', ')} } from '${from}';\n`;
      const firstImport = out.search(/^import /m);
      out = firstImport >= 0 ? out.slice(0, firstImport) + imp + out.slice(firstImport) : imp + out;
    }
  }
  const target = file.replace(/\.ts$/, '.tsx');
  fs.writeFileSync(target, out);
  if (target !== file) fs.unlinkSync(file);
  return stats;
}

const files = process.argv.slice(2);
let total = 0; let kept = 0;
for (const f of files) {
  const st = convertFile(f);
  total += st.converted; kept += st.kept.length;
  console.log(`${f}: ${st.converted} converted${st.kept.length ? `, ${st.kept.length} kept as html\`\`:\n   ${st.kept.join('\n   ')}` : ''}`);
}
console.log(`\ntotal: ${total} converted, ${kept} kept`);
