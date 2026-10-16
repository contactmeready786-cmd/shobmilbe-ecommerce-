#!/usr/bin/env node
// Gives every un-annotated function parameter in the given TypeScript files a type, chosen by its name
// (settings → Settings, req → ShopRequest, t → Tx, ctx → AdminCtx, …; anything else → Loose), and removes
// the file's // @ts-nocheck line. A one-time step of the JavaScript → TypeScript move; the type checker then
// shows what is left to fix by hand, and "Loose" marks what still needs an exact type.
//   node tools/migrate/annotate.mjs <file.ts ...>
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const acornPath = ['/opt/npm-tools/node_modules/acorn', '/opt/node-tools/node_modules/acorn'].find((p) => fs.existsSync(p));
const acorn = createRequire(import.meta.url)(acornPath || 'acorn');

const BY_NAME = [
  [/^(settings|s2)$/, 'Settings'], [/^req$/, 'ShopRequest'], [/^res$/, 'ShopResponse'],
  [/^ctx$/, 'AdminCtx'], [/^base$/, 'Base'], [/^query$/, 'URLSearchParams'], [/^user$/, 'StaffUser'],
  [/^(id|[a-z]+Id)$/, 'Id'], [/^(b|data|input|opts|options|f|filter)$/, 'Body'],
  [/^(row|r|o|p|order|product|item|it|c|cat|category|customer|cust|card|x|v|e|rec|sub|msg|post|page|line|l|m)$/, 'Loose'],
];
// t / tx / client is a database transaction only where the function uses it as one (t.query(…)); a token otherwise
const typeFor = (name, bodySrc) => {
  if (/^(t|tx|client|conn)$/.test(name)) return new RegExp(`\\b${name}\\.(query|exec)\\(`).test(bodySrc) ? 'Tx' : 'Loose';
  return (BY_NAME.find(([re]) => re.test(name)) || [null, 'Loose'])[1];
};

function walk(node, fn) {
  if (!node || typeof node.type !== 'string') return;
  fn(node);
  for (const k of Object.keys(node)) {
    const v = node[k];
    if (Array.isArray(v)) v.forEach((c) => c && typeof c.type === 'string' && walk(c, fn));
    else if (v && typeof v.type === 'string') walk(v, fn);
  }
}

// acorn reads JavaScript, not TypeScript: blank out what the file already has as types first (same length, so
// positions stay right). Only the forms this codebase uses are handled; a file acorn can't read is reported.
function stripTypes(src) {
  let s = src.replace(/^import type .*$/gm, (m) => ' '.repeat(m.length));
  s = s.replace(/^(export )?type [A-Za-z_$][\w$]*(<[^>]*>)? = [\s\S]*?;$/gm, (m) => m.replace(/[^\n]/g, ' '));
  return s;
}

export function annotate(src, file) {
  let ast;
  try { ast = acorn.parse(stripTypes(src.replace(/^\/\/ @ts-nocheck.*\n/, (m) => '//' + ' '.repeat(m.length - 3) + '\n')), { ecmaVersion: 'latest', sourceType: 'module' }); } catch (e) {
    return { out: src, skipped: `${file}: can't parse (${e.message}) — has TypeScript syntax already` };
  }
  const used = new Set();
  const inserts = [];
  walk(ast, (n) => {
    if (!/Function/.test(n.type)) return;
    n.params.forEach((p, i) => {
      // a callback given straight to .map/.filter/... gets its types from that call — leave it alone
      let target = p, name = '';
      if (p.type === 'AssignmentPattern') target = p.left;
      if (p.type === 'RestElement') target = p.argument;
      if (target.type === 'Identifier') name = target.name;
      // already annotated? (the character after the name is ':')
      const after = src.slice(target.end, target.end + 2);
      if (/^\s*[:?]/.test(after)) return;
      let type;
      if (target.type === 'Identifier') type = p.type === 'RestElement' ? 'Loose[]' : typeFor(name, src.slice(n.body.start, n.body.end));
      else if (target.type === 'ObjectPattern') type = 'Body';
      else if (target.type === 'ArrayPattern') type = 'Loose[]';
      else return;
      n.__typed = true;
      inserts.push({ at: target.end, text: ': ' + type, contextual: n.type === 'ArrowFunctionExpression' || n.type === 'FunctionExpression' });
      used.add(type.replace('[]', ''));
    });
  });
  // callbacks passed directly as arguments (arr.map((x) => …)) are typed by TypeScript from the call: skip those
  const callbackRanges = [];
  walk(ast, (n) => {
    if (n.type === 'CallExpression' || n.type === 'NewExpression') for (const a of n.arguments) if (/FunctionExpression$/.test(a.type)) callbackRanges.push([a.start, a.params.length ? a.params[a.params.length - 1].end : a.start]);
  });
  const isCallbackParam = (at) => callbackRanges.some(([a, b]) => at > a && at <= b);
  const keep = inserts.filter((x) => !(x.contextual && isCallbackParam(x.at)));
  let out = src;
  for (const x of keep.sort((a, b) => b.at - a.at)) {
    // an arrow function with one bare parameter (x => …) needs brackets for a type
    const before = out.slice(0, x.at);
    const m = before.match(/(^|[^\w$.)])([A-Za-z_$][\w$]*)$/);
    const bare = m && /^\s*=>/.test(out.slice(x.at)) && !/\(\s*$/.test(before.slice(0, before.length - m[2].length));
    if (bare) out = before.slice(0, before.length - m[2].length) + '(' + m[2] + x.text + ')' + out.slice(x.at);
    else out = before + x.text + out.slice(x.at);
  }
  const typesUsed = [...used].filter((t) => ['Settings', 'ShopRequest', 'ShopResponse', 'AdminCtx', 'Base', 'StaffUser', 'Id', 'Body', 'Loose'].includes(t));
  const needTx = used.has('Tx');
  const rel = path.relative(path.dirname(file), 'lib').replace(/\\/g, '/') || '.';
  const imp = [];
  if (typesUsed.length) imp.push(`import type { ${typesUsed.sort().join(', ')} } from '${rel.startsWith('.') ? rel : './' + rel}/types';`);
  if (needTx) imp.push(`import type { Tx } from '${rel.startsWith('.') ? rel : './' + rel}/pg';`);
  out = out.replace(/^\/\/ @ts-nocheck.*\n/, '');
  if (imp.length) {
    const lines = out.split('\n');
    let last = -1; lines.forEach((l, i) => { if (/^import /.test(l)) last = i; });
    lines.splice(last + 1, 0, ...imp);
    out = lines.join('\n');
  }
  return { out, count: keep.length };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const f of process.argv.slice(2)) {
    const r = annotate(fs.readFileSync(f, 'utf8'), f);
    if (r.skipped) { console.log('skip', r.skipped); continue; }
    fs.writeFileSync(f, r.out);
    console.log(`${f}: ${r.count} parameters`);
  }
}
