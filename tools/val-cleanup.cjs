#!/usr/bin/env node
// One-off clean-up of the converter's leftovers (tools/html2jsx.ts): where TypeScript PROVES a value is plain text or a
// number, the helper around it adds nothing and is dropped — the page's HTML stays exactly the same:
//   <Val v={E} />          → {E}   when E is always text/number (a literal, `…`, a + b, bn()/money()/fmtDate()/…, a
//                                   string method such as .join() / .slice())
//   attrValue(E)           → E     when E's type is string (attrValue gives back the same text)
//   {attrValue(n)} / ${attrValue(n)} → {n} / ${n}  when n is a number (React and `${}` write it the same way),
//                                   except for true/false attributes (checked, disabled …)
// Values whose type is unknown (any) or ready-made HTML keep their helper.
//   node tools/val-cleanup.cjs [--dry]
const ts = require(process.env.TS_PATH || 'typescript');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const dry = process.argv.includes('--dry');
const cfg = ts.getParsedCommandLineOfConfigFile(path.join(root, 'tsconfig.json'), {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} });
const prog = ts.createProgram(cfg.fileNames, cfg.options);
const ch = prog.getTypeChecker();

// util functions read by hand: each always returns a new text value (String(…) / a template), never ready-made HTML
const TEXT_FUNCS = new Set(['bn', 'money', 'fmtDate', 'pct', 'str', 'roundOffLabel']);
const STRING_METHODS = new Set(['join', 'slice', 'substring', 'repeat', 'toUpperCase', 'toLowerCase', 'trim', 'padStart', 'padEnd', 'replace', 'replaceAll', 'toFixed', 'toLocaleString', 'toString', 'charAt']);
const BOOL_ATTRS = new Set(['checked', 'selected', 'disabled', 'readOnly', 'required', 'multiple', 'hidden', 'open', 'autoFocus', 'defer', 'async', 'noValidate', 'controls', 'loop', 'muted', 'playsInline', 'reversed', 'default']);

const flagsOf = (t) => (t.isUnion() ? t.types.map((x) => x.flags) : [t.flags]);
const isText = (t) => flagsOf(t).every((f) => f & (ts.TypeFlags.StringLike));
const isNumber = (t) => flagsOf(t).every((f) => f & ts.TypeFlags.NumberLike);
const isTextOrNumber = (t) => flagsOf(t).every((f) => f & (ts.TypeFlags.StringLike | ts.TypeFlags.NumberLike));

/** Is this expression's value always a text or number primitive at run time (not only by its declared type)? */
function alwaysPrimitive(e, sf) {
  while (ts.isParenthesizedExpression(e)) e = e.expression;
  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e) || ts.isTemplateExpression(e) || ts.isNumericLiteral(e)) return true;
  if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.PlusToken) return isTextOrNumber(ch.getTypeAtLocation(e));
  if (ts.isConditionalExpression(e)) return alwaysPrimitive(e.whenTrue, sf) && alwaysPrimitive(e.whenFalse, sf);
  if (ts.isCallExpression(e)) {
    const callee = e.expression;
    if (ts.isIdentifier(callee) && TEXT_FUNCS.has(callee.text)) return fromUtil(callee);
    if (ts.isPropertyAccessExpression(callee) && TEXT_FUNCS.has(callee.name.text) && ts.isIdentifier(callee.expression) && /^(U|util|\$util)$/.test(callee.expression.text)) return true;
    if (ts.isIdentifier(callee) && callee.text === 'String') return true;
    if (ts.isPropertyAccessExpression(callee) && STRING_METHODS.has(callee.name.text)) {
      const recv = ch.getTypeAtLocation(callee.expression);
      const arrayJoin = callee.name.text === 'join' && ch.isArrayType(recv);
      return (arrayJoin || isTextOrNumber(recv)) && isTextOrNumber(ch.getTypeAtLocation(e));
    }
  }
  return false;
}
// the identifier is the util.ts function (imported), not a local variable of the same name
function fromUtil(id) {
  let sym = ch.getSymbolAtLocation(id);
  if (sym && sym.flags & ts.SymbolFlags.Alias) sym = ch.getAliasedSymbol(sym);
  const d = sym && sym.valueDeclaration;
  return !!d && ts.isFunctionDeclaration(d) && path.basename(d.getSourceFile().fileName) === 'util.ts';
}

// the expression's text, in brackets when it is not a single simple piece
function wrap(e, sf) {
  const simple = ts.isIdentifier(e) || ts.isPropertyAccessExpression(e) || ts.isCallExpression(e) || ts.isStringLiteral(e) || ts.isTemplateExpression(e)
    || ts.isNoSubstitutionTemplateLiteral(e) || ts.isNumericLiteral(e) || ts.isParenthesizedExpression(e) || ts.isElementAccessExpression(e);
  return simple ? e.getText(sf) : `(${e.getText(sf)})`;
}

// Does this piece end up as a child on the page — through a ? b : c, a && b, ( … ) — inside {…} between tags, or as
// what a .map() inside {…} makes? (Then a text value shows exactly like the <Val/> did.)
function flowsIntoChildren(n) {
  let p = n.parent;
  while (p && (ts.isConditionalExpression(p) || ts.isParenthesizedExpression(p)
    || (ts.isBinaryExpression(p) && [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(p.operatorToken.kind) && p.right === n))) {
    if (ts.isConditionalExpression(p) && p.condition === n) return false;
    n = p; p = p.parent;
  }
  if (!p) return false;
  if (ts.isJsxExpression(p)) return ts.isJsxElement(p.parent) || ts.isJsxFragment(p.parent);
  if (ts.isArrowFunction(p) && p.body === n && ts.isCallExpression(p.parent) && ts.isPropertyAccessExpression(p.parent.expression) && p.parent.expression.name.text === 'map') {
    // the .map(…) is itself shown: {list.map(…)} or {jsxList(list.map(…))}
    let c = p.parent.parent;
    if (c && ts.isCallExpression(c) && ts.isIdentifier(c.expression) && c.expression.text === 'jsxList') c = c.parent;
    return !!c && ts.isJsxExpression(c) && (ts.isJsxElement(c.parent) || ts.isJsxFragment(c.parent));
  }
  return false;
}

let nVal = 0; let nAttr = 0; const touched = new Map();
for (const sf of prog.getSourceFiles()) {
  const f = sf.fileName;
  if (!f.startsWith(root + '/') || f.includes('/node_modules/') || /__old|\/tests\/|\/tools\//.test(f) || !/\.tsx?$/.test(f)) continue;
  const edits = [];
  (function walk(n) {
    // <Val v={E} />
    if (ts.isJsxSelfClosingElement(n) && n.tagName.getText(sf) === 'Val' && n.attributes.properties.length === 1) {
      const a = n.attributes.properties[0];
      if (ts.isJsxAttribute(a) && a.name.getText(sf) === 'v' && a.initializer && ts.isJsxExpression(a.initializer) && a.initializer.expression) {
        const e = a.initializer.expression;
        if (alwaysPrimitive(e, sf)) {
          // a child of a tag: {E}; anywhere else (a ? <Val …/> : null, => <Val …/>): the text itself
          const child = ts.isJsxElement(n.parent) || ts.isJsxFragment(n.parent);
          if (child || flowsIntoChildren(n)) {
            edits.push([n.getStart(sf), n.getEnd(), child ? `{${e.getText(sf)}}` : wrap(e, sf)]);
            nVal++;
            return;
          }
        }
      }
    }
    // attrValue(E)
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'attrValue' && n.arguments.length === 1) {
      const e = n.arguments[0];
      const t = ch.getTypeAtLocation(e);
      const p = n.parent;
      const inAttr = ts.isJsxExpression(p) && ts.isJsxAttribute(p.parent);
      const attrName = inAttr ? p.parent.name.getText(sf) : '';
      const inTemplate = ts.isTemplateSpan(p);
      let ok = false;
      if (isText(t) && alwaysPrimitive(e, sf)) ok = true; // the same text either way
      else if (isNumber(t) && (inTemplate || (inAttr && !BOOL_ATTRS.has(attrName))) && alwaysPrimitive(e, sf)) ok = true;
      if (ok) {
        edits.push([n.getStart(sf), n.getEnd(), inAttr || inTemplate ? e.getText(sf) : wrap(e, sf)]);
        nAttr++;
        return;
      }
    }
    ts.forEachChild(n, walk);
  })(sf);
  if (edits.length) touched.set(f, edits);
}

for (const [f, edits] of touched) {
  let s = fs.readFileSync(f, 'utf8');
  for (const [a, b, t] of edits.sort((x, y) => y[0] - x[0])) s = s.slice(0, a) + t + s.slice(b);
  if (!dry) fs.writeFileSync(f, s);
}
console.log(`${dry ? '(dry) ' : ''}Val → plain: ${nVal}, attrValue → plain: ${nAttr}, files: ${touched.size}`);
