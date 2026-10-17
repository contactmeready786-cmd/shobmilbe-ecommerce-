#!/usr/bin/env node
// One-off clean-up: toHtml(<…/>) kept a React piece inside an "HTML text" wrapper for the old text templates. The pieces
// now stay React all the way (lib/site.ts turns a whole page into text with renderHtml at the very end), so the
// wrapper around a JSX piece is dropped: toHtml(<div>…</div>) → <div>…</div>. Calls on anything else are listed.
//   node tools/unwrap-tohtml.cjs [--dry]
const ts = require(process.env.TS_PATH || 'typescript');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const dry = process.argv.includes('--dry');
const cfg = ts.getParsedCommandLineOfConfigFile(path.join(root, 'tsconfig.json'), {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} });
const prog = ts.createProgram(cfg.fileNames, cfg.options);
prog.getTypeChecker(); // (binds the files: parent links)

let n = 0; const other = [];
for (const sf of prog.getSourceFiles()) {
  const f = sf.fileName;
  if (!f.startsWith(root + '/') || f.includes('/node_modules/') || /__old|\/tests\/|\/tools\//.test(f) || !/\.tsx?$/.test(f)) continue;
  const edits = [];
  (function walk(node) {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'toHtml' && node.arguments.length === 1) {
      let a = node.arguments[0];
      while (ts.isParenthesizedExpression(a)) a = a.expression;
      const used = node.parent;
      const asText = ts.isPropertyAccessExpression(used) && used.name.text === 's'; // toHtml(x).s: a text boundary, kept
      if (!asText && (ts.isJsxElement(a) || ts.isJsxSelfClosingElement(a) || ts.isJsxFragment(a))) {
        // nested toHtml calls inside are handled by their own edit: replace only the outer call's head and tail
        edits.push([node.getStart(sf), a.getStart(sf), '']);
        edits.push([a.getEnd(), node.getEnd(), '']);
        n++;
      } else other.push(`${path.relative(root, f)}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1} ${node.getText(sf).slice(0, 90)}`);
    }
    ts.forEachChild(node, walk);
  })(sf);
  if (!edits.length) continue;
  let s = fs.readFileSync(f, 'utf8');
  for (const [a, b, t] of edits.sort((x, y) => y[0] - x[0])) s = s.slice(0, a) + t + s.slice(b);
  if (!dry) fs.writeFileSync(f, s);
}
console.log(`${dry ? '(dry) ' : ''}toHtml(<…/>) unwrapped: ${n}`);
console.log(`other toHtml calls (${other.length}):\n  ` + other.join('\n  '));
