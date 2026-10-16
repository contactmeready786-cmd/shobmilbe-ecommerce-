#!/usr/bin/env node
// Second step of the JavaScript → TypeScript move: reads the type checker's report (tsc output on stdin) and fixes
// the mechanical "implicitly any" errors in place:
//   TS7006 / TS7031  a parameter with no type           → ": Loose"
//   TS7034           a variable whose type can't be told  → ": Loose[]" for "= []", ": Loose" otherwise
//   TS7053           looking up a fixed table with a key  → the table becomes Record<string, …>
//   TS2531 / TS2532 / TS18047 / TS18048  "possibly null/undefined" where the old code relied on the value being there
//                    (e.g. (await one('SELECT count(*) …')).n) → a "!" (same behaviour as before: it never checked)
// Everything else is left for a person. "Loose" marks what still needs an exact type.
//   tsc -p … | node tools/migrate/fix-implicit.mjs
import fs from 'node:fs';
import path from 'node:path';

const input = fs.readFileSync(0, 'utf8');
const byFile = new Map();
for (const m of input.matchAll(/^(.+?\.ts)\((\d+),(\d+)\): error (TS\d+): (.*)$/gm)) {
  const [, file, line, col, code, msg] = m;
  if (!byFile.has(file)) byFile.set(file, []);
  byFile.get(file).push({ line: +line, col: +col, code, msg });
}
let fixed = 0;
for (const [file, errs] of byFile) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const tables = new Set();
  // right-to-left within a line, so earlier columns stay valid
  errs.sort((a, b) => b.line - a.line || b.col - a.col);
  let touched = false;
  for (const e of errs) {
    const L = lines[e.line - 1];
    const i = e.col - 1;
    if (e.code === 'TS7006' || e.code === 'TS7031') {
      const name = (e.msg.match(/'([^']+)'/) || [])[1];
      if (!name || L.slice(i, i + name.length) !== name) continue;
      const end = i + name.length;
      if (/^\s*[:?]/.test(L.slice(end))) continue;
      if (e.code === 'TS7031') continue; // a name inside { … } — the whole pattern needs a type; done by hand
      // x => …  needs brackets
      const bare = /^\s*=>/.test(L.slice(end)) && !/\(\s*$/.test(L.slice(0, i)) && !/,\s*$/.test(L.slice(0, i));
      lines[e.line - 1] = bare ? L.slice(0, i) + '(' + name + ': Loose)' + L.slice(end) : L.slice(0, end) + ': Loose' + L.slice(end);
      touched = true; fixed++;
    } else if (e.code === 'TS7034') {
      const name = (e.msg.match(/'([^']+)'/) || [])[1];
      if (!name || L.slice(i, i + name.length) !== name) continue;
      const end = i + name.length;
      const rest = L.slice(end);
      if (/^\s*:/.test(rest)) continue;
      const t = /^\s*=\s*\[\s*\]/.test(rest) ? 'Loose[]' : 'Loose';
      lines[e.line - 1] = L.slice(0, end) + ': ' + t + rest;
      touched = true; fixed++;
    } else if (['TS2531', 'TS2532', 'TS18047', 'TS18048'].includes(e.code)) {
      const rest = L.slice(i);
      let end = -1;
      const id = rest.match(/^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*/);
      if (rest[0] === '(') {
        let depth = 0, k = i, inStr = null;
        for (; k < L.length; k++) {
          const ch = L[k];
          if (inStr) { if (ch === '\\') { k++; continue; } if (ch === inStr) inStr = null; continue; }
          if (ch === "'" || ch === '"' || ch === '`') { inStr = ch; continue; }
          if (ch === '(') depth++;
          else if (ch === ')') { depth--; if (depth === 0) break; }
        }
        if (depth === 0 && k < L.length) end = k + 1;
      } else if (id) {
        // "'r' is possibly 'null'" → the "!" goes right after r (r!.kind), not after the whole r.kind
        const named = (e.msg.match(/^'([^']+)' is possibly/) || [])[1];
        end = named && id[0].startsWith(named) ? i + named.length : i + id[0].length;
      }
      if (end < 0 || !/^[.[]/.test(L.slice(end)) || L[end - 1] === '!') continue;
      lines[e.line - 1] = L.slice(0, end) + '!' + L.slice(end);
      touched = true; fixed++;
    } else if (e.code === 'TS18046') {
      // "'e' is of type 'unknown'": a caught error whose .message is read → catch (e: Loose)
      const name = (e.msg.match(/^'([^']+)' is of type 'unknown'/) || [])[1];
      if (!name) continue;
      for (let k = e.line - 1; k >= 0 && k >= e.line - 80; k--) {
        const re = new RegExp(`catch \\(${name}\\)`);
        if (re.test(lines[k])) { lines[k] = lines[k].replace(re, `catch (${name}: Loose)`); touched = true; fixed++; break; }
      }
    } else if (e.code === 'TS7053') {
      // the table being indexed: the name just before "[" at the error column
      const before = L.slice(0, i + 200);
      const m = L.slice(i).match(/^([A-Za-z_$][\w$]*)\s*\[/);
      if (m) tables.add(m[1]);
      void before;
    }
  }
  for (const t of tables) {
    const re = new RegExp(`^(\\s*(?:export )?const ${t})( = \\{)`);
    const at = lines.findIndex((l) => re.test(l));
    if (at < 0) continue;
    // a table of plain texts stays a table of texts; anything else is Loose for now
    let j = at, body = '';
    for (; j < lines.length; j++) { body += lines[j] + '\n'; if (/^\s*\};?\s*(\/\/.*)?$/.test(lines[j]) || (j === at && /\};\s*(\/\/.*)?$/.test(lines[j]))) break; }
    const allText = !/[{[(]/.test(body.replace(/^[^{]*\{/, '').replace(/\}\s*;?\s*(\/\/.*)?\s*$/, '')) && !/:\s*[^'"`\s{]/.test(body.replace(/^[^{]*\{/, '').replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`/g, "''").replace(/\/\/.*$/gm, ''));
    lines[at] = lines[at].replace(re, `$1: Record<string, ${allText ? 'string' : 'Loose'}>$2`);
    touched = true; fixed++;
  }
  if (touched) {
    let out = lines.join('\n');
    if (/\bLoose\b/.test(out) && !/import type \{[^}]*\bLoose\b[^}]*\} from '[^']*types'/.test(out)) {
      const rel = path.relative(path.dirname(file), 'lib').replace(/\\/g, '/');
      const spec = (rel.startsWith('.') ? rel : './' + (rel || '.')) + '/types';
      const has = out.match(new RegExp(`import type \\{([^}]*)\\} from '${spec.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}';`));
      if (has) out = out.replace(has[0], `import type {${has[1].replace(/\s*$/, '')}, Loose } from '${spec}';`);
      else {
        const ls = out.split('\n'); let last = -1; ls.forEach((l, k) => { if (/^import /.test(l)) last = k; });
        ls.splice(last + 1, 0, `import type { Loose } from '${spec}';`); out = ls.join('\n');
      }
    }
    fs.writeFileSync(file, out);
  }
}
console.log(`fixed ${fixed}`);
