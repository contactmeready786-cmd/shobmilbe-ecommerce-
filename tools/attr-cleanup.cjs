#!/usr/bin/env node
// One-off clean-up of the converter's attribute snippets: {...attrProps(on ? raw('checked') : '')} wrote an attribute as a
// piece of HTML text. Where the snippet is one plain attribute, it becomes an ordinary React prop with the same HTML:
//   {...attrProps(c ? raw('checked') : '')}      → defaultChecked={!!(c)}   (the box stays the visitor's to change)
//   {...attrProps(c ? '' : raw('hidden'))}       → hidden={!(c)}
//   {...attrProps(c ? raw(' aria-current="page"') : '')} → aria-current={c ? 'page' : undefined}
//   {...attrProps(raw('data-wide'))}             → data-wide=""
// Anything else is listed and left alone.
//   node tools/attr-cleanup.cjs [--dry]
const ts = require(process.env.TS_PATH || 'typescript');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const dry = process.argv.includes('--dry');
const cfg = ts.getParsedCommandLineOfConfigFile(path.join(root, 'tsconfig.json'), {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} });
const prog = ts.createProgram(cfg.fileNames, cfg.options);
prog.getTypeChecker(); // (binds the files: parent links)

const ON_OFF = { checked: 'defaultChecked', hidden: 'hidden', open: 'open', disabled: 'disabled', selected: 'selected', required: 'required' };
const NAMES = { tabindex: 'tabIndex', class: 'className' };

// raw('…') / '…' → the snippet's text; anything else → null
function snippet(e) {
  while (ts.isParenthesizedExpression(e)) e = e.expression;
  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return e.text;
  if (ts.isCallExpression(e) && ts.isIdentifier(e.expression) && e.expression.text === 'raw' && e.arguments.length === 1) {
    const a = e.arguments[0];
    if (ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a)) return a.text;
  }
  return null;
}
// "checked" / ' aria-current="page"' / 'data-x' / 'tabindex="-1"' → { name, value } (value null = a true/false attribute)
function oneAttr(text) {
  const m = text.trim().match(/^([a-zA-Z][\w-]*)(?:="([^"]*)")?$/);
  if (!m) return null;
  const n = m[1].toLowerCase();
  if (n === 'class') return null; // would meet the tag's own className
  if (ON_OFF[n] && m[2] === undefined) return { prop: ON_OFF[n], value: null };
  if (/^(data|aria)-/.test(n)) return { prop: n, value: m[2] ?? '' };
  if (NAMES[n]) return { prop: NAMES[n], value: m[2] ?? '' };
  return null;
}

let n = 0; const left = [];
for (const sf of prog.getSourceFiles()) {
  const f = sf.fileName;
  if (!f.startsWith(root + '/') || f.includes('/node_modules/') || /\/tests\/|\/tools\//.test(f) || !/\.tsx$/.test(f)) continue;
  const edits = [];
  (function walk(node) {
    if (ts.isJsxSpreadAttribute(node) && ts.isCallExpression(node.expression) && ts.isIdentifier(node.expression.expression) && node.expression.expression.text === 'attrProps' && node.expression.arguments.length === 1) {
      let a = node.expression.arguments[0];
      while (ts.isParenthesizedExpression(a)) a = a.expression;
      let out = null;
      const whole = snippet(a);
      if (whole !== null) {
        const at = oneAttr(whole);
        if (at) out = at.value === null ? at.prop : `${at.prop}=${JSON.stringify(at.value)}`;
      } else if (ts.isConditionalExpression(a)) {
        const yes = snippet(a.whenTrue); const no = snippet(a.whenFalse);
        const c = a.condition.getText(sf);
        if (yes !== null && no === '' ) {
          const at = oneAttr(yes);
          if (at) out = at.value === null ? `${at.prop}={!!(${c})}` : `${at.prop}={(${c}) ? ${JSON.stringify(at.value)} : undefined}`;
        } else if (no !== null && yes === '') {
          const at = oneAttr(no);
          if (at) out = at.value === null ? `${at.prop}={!(${c})}` : `${at.prop}={(${c}) ? undefined : ${JSON.stringify(at.value)}}`;
        }
      }
      if (out) { edits.push([node.getStart(sf), node.getEnd(), out]); n++; }
      else left.push(`${path.relative(root, f)}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1} ${node.getText(sf).slice(0, 100)}`);
      return;
    }
    ts.forEachChild(node, walk);
  })(sf);
  if (!edits.length) continue;
  let s = fs.readFileSync(f, 'utf8');
  for (const [x, y, t] of edits.sort((p, q) => q[0] - p[0])) s = s.slice(0, x) + t + s.slice(y);
  if (!dry) fs.writeFileSync(f, s);
}
console.log(`${dry ? '(dry) ' : ''}attribute snippets → props: ${n}`);
console.log(`left as they are (${left.length}):\n  ` + left.join('\n  '));
