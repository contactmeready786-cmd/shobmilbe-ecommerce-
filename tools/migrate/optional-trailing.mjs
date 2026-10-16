#!/usr/bin/env node
// In JavaScript every parameter could be left out; TypeScript wants them all unless marked optional.
// For each function, the parameters at the end typed Loose / Id (the ones given a type automatically) become optional
// (x?: Loose), so calls that leave them out — as the old code did — still type-check. Uses the TypeScript compiler.
//   node tools/migrate/optional-trailing.mjs <file.ts ...>
import fs from 'node:fs';
import { createRequire } from 'node:module';
const ts = createRequire(import.meta.url)('typescript');

for (const file of process.argv.slice(2)) {
  const src = fs.readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const at = [];
  const visit = (n) => {
    if (ts.isFunctionLike(n) && n.parameters) {
      for (let i = n.parameters.length - 1; i >= 0; i--) {
        const p = n.parameters[i];
        if (p.dotDotDotToken) continue;
        if (p.questionToken || p.initializer) continue; // already optional
        if (!p.type || !['Loose', 'Id'].includes(p.type.getText(sf)) || !ts.isIdentifier(p.name)) break;
        at.push(p.name.end);
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  let out = src;
  for (const pos of at.sort((a, b) => b - a)) out = out.slice(0, pos) + '?' + out.slice(pos);
  if (at.length) fs.writeFileSync(file, out);
  console.log(`${file}: ${at.length} made optional`);
}
