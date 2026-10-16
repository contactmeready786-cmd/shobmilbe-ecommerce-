#!/usr/bin/env node
// One-time conversion of lib/ from CommonJS JavaScript to ES-module TypeScript, without changing behaviour.
//   node tools/migrate/to-esm-ts.mjs [--dry] <file.js ...>
// Uses acorn (a JavaScript parser) so only real require()/module.exports code is touched, never strings or comments.
//   const x = require('m')            -> import * as x from 'm'
//   const { a, b: c } = require('m')  -> import { a, b as c } from 'm'
//   const x = require('m').y          -> import { y as x } from 'm'
//   require('m') anywhere else        -> a namespace imported at the top (ES modules load lazily-safe: values are
//                                        read when the code runs, like the old inline require)
//   module.exports = { a, b: c, d: expr } -> export { a, c as b }; export const d = expr
// The file is renamed to .ts and starts with // @ts-nocheck until it gets real types.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const acornPath = ['/opt/npm-tools/node_modules/acorn', '/opt/node-tools/node_modules/acorn'].find((p) => fs.existsSync(p));
const acorn = createRequire(import.meta.url)(acornPath || 'acorn');
const walk = (node, fn, parent = null) => {
  if (!node || typeof node.type !== 'string') return;
  if (fn(node, parent) === false) return;
  for (const k of Object.keys(node)) {
    const v = node[k];
    if (Array.isArray(v)) v.forEach((c) => c && typeof c.type === 'string' && walk(c, fn, node));
    else if (v && typeof v.type === 'string') walk(v, fn, node);
  }
};

const BUILTINS = new Set(['crypto', 'zlib', 'fs', 'path', 'tls', 'net', 'http', 'https', 'dns', 'querystring', 'async_hooks', 'os', 'url', 'util', 'stream', 'child_process', 'events', 'buffer']);
const spec = (s) => (BUILTINS.has(s) ? 'node:' + s : s);
const isReq = (n) => n && n.type === 'CallExpression' && n.callee.type === 'Identifier' && n.callee.name === 'require'
  && n.arguments.length === 1 && n.arguments[0].type === 'Literal' && typeof n.arguments[0].value === 'string';
const ident = (s) => /^[A-Za-z_$][\w$]*$/.test(s);
const nsName = (s) => '$' + s.replace(/^node:/, '').replace(/\.json$/, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

export function convert(src, file) {
  const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'script', allowHashBang: true, allowReturnOutsideFunction: false });
  const edits = []; // { start, end, text }
  const imports = [];
  const namespaces = new Map(); // module spec -> local name
  const topNames = new Set();
  for (const st of ast.body) {
    if (st.type === 'VariableDeclaration') for (const d of st.declarations) walk(d.id, (n) => { if (n.type === 'Identifier') topNames.add(n.name); });
    if ((st.type === 'FunctionDeclaration' || st.type === 'ClassDeclaration') && st.id) topNames.add(st.id.name);
  }
  const problems = [];

  // 'use strict' is implied in ES modules
  const first = ast.body[0];
  if (first && first.type === 'ExpressionStatement' && first.directive === 'use strict') edits.push({ start: first.start, end: first.end, text: '' });

  for (const st of ast.body) {
    // ---- top-level requires
    if (st.type === 'VariableDeclaration' && st.declarations.length === 1) {
      const d = st.declarations[0];
      const init = d.init;
      const direct = isReq(init);
      const member = init && init.type === 'MemberExpression' && !init.computed && isReq(init.object);
      if (direct || member) {
        const m = spec((direct ? init : init.object).arguments[0].value);
        const json = m.endsWith('.json');
        let text = null;
        if (member) {
          if (d.id.type === 'Identifier') text = `import { ${init.property.name === d.id.name ? d.id.name : `${init.property.name} as ${d.id.name}`} } from '${m}';`;
        } else if (d.id.type === 'Identifier') {
          text = json ? `import ${d.id.name} from '${m}';` : `import * as ${d.id.name} from '${m}';`;
          if (!json) namespaces.set(m, d.id.name);
        } else if (d.id.type === 'ObjectPattern' && !json) {
          const parts = [];
          for (const p of d.id.properties) {
            if (p.type !== 'Property' || p.computed || p.key.type !== 'Identifier' || p.value.type !== 'Identifier') { parts.length = 0; break; }
            parts.push(p.key.name === p.value.name ? p.key.name : `${p.key.name} as ${p.value.name}`);
          }
          if (parts.length) text = `import { ${parts.join(', ')} } from '${m}';`;
        }
        if (text === null) { problems.push(`${file}:${src.slice(0, st.start).split('\n').length} unsupported require form`); continue; }
        if (st.kind !== 'const') problems.push(`${file}: '${st.kind}' require became an import (now read-only)`);
        imports.push(text);
        edits.push({ start: st.start, end: st.end, text: '' });
        continue;
      }
    }
    // ---- module.exports = { ... }
    if (st.type === 'ExpressionStatement' && st.expression.type === 'AssignmentExpression'
      && st.expression.left.type === 'MemberExpression' && st.expression.left.object.name === 'module' && st.expression.left.property.name === 'exports') {
      const obj = st.expression.right;
      if (obj.type !== 'ObjectExpression') { problems.push(`${file}: module.exports is not an object`); continue; }
      const names = [];
      const decls = [];
      for (const p of obj.properties) {
        if (p.type !== 'Property' || p.computed || p.kind !== 'init') { problems.push(`${file}: unsupported export property`); continue; }
        const key = p.key.type === 'Identifier' ? p.key.name : p.key.value;
        if (!ident(key)) { problems.push(`${file}: export key ${key} is not a name`); continue; }
        if (p.value.type === 'Identifier') { names.push(p.value.name === key ? key : `${p.value.name} as ${key}`); continue; }
        const valueSrc = src.slice(p.value.start, p.value.end);
        if (p.method) {
          const tmp = `$export_${key}`;
          const fn = src.slice(p.start, p.end); // "async name(args) { ... }" / "name(args) { ... }"
          const isAsync = p.value.async, isGen = p.value.generator;
          const rest = fn.replace(/^(async\s+)?\*?\s*/, '').slice(key.length);
          decls.push(`${isAsync ? 'async ' : ''}function${isGen ? '*' : ''} ${tmp}${rest}`);
          names.push(`${tmp} as ${key}`);
        } else if (topNames.has(key)) {
          const tmp = `$export_${key}`;
          decls.push(`const ${tmp} = ${valueSrc};`);
          names.push(`${tmp} as ${key}`);
        } else {
          decls.push(`export const ${key} = ${valueSrc};`);
        }
      }
      edits.push({ start: st.start, end: st.end, text: [...decls, names.length ? `export { ${names.join(', ')} };` : ''].filter(Boolean).join('\n') });
      continue;
    }
  }

  // ---- every remaining require('x') (inside functions, or in expressions): use a namespace imported at the top
  walk(ast, (n) => {
    if (!isReq(n)) return;
    if (edits.some((e) => e.start <= n.start && n.end <= e.end)) return; // already handled above
    const m = spec(n.arguments[0].value);
    if (m.endsWith('.json')) { problems.push(`${file}: inline JSON require`); return; }
    let name = namespaces.get(m);
    if (!name) {
      name = nsName(m);
      while (topNames.has(name) || [...namespaces.values()].includes(name)) name += '_';
      namespaces.set(m, name);
      imports.push(`import * as ${name} from '${m}';`);
    }
    edits.push({ start: n.start, end: n.end, text: name });
  });

  // any other CommonJS left over is a problem for a person to look at
  walk(ast, (n) => {
    if (n.type === 'Identifier' && (n.name === 'require' || n.name === '__dirname' || n.name === '__filename' || n.name === 'exports')
      && !edits.some((e) => e.start <= n.start && n.end <= e.end)) problems.push(`${file}:${src.slice(0, n.start).split('\n').length} leftover ${n.name}`);
    if (n.type === 'MemberExpression' && n.object.type === 'Identifier' && n.object.name === 'module'
      && !edits.some((e) => e.start <= n.start && n.end <= e.end)) problems.push(`${file}:${src.slice(0, n.start).split('\n').length} leftover module.*`);
  });

  edits.sort((a, b) => b.start - a.start);
  let out = src;
  for (const e of edits) {
    let end = e.end;
    if (e.text === '' && out[end] === '\n') end++; // drop the emptied line
    out = out.slice(0, e.start) + e.text + out.slice(end);
  }
  // header comment block (kept at the very top), then imports
  const lead = out.match(/^(#![^\n]*\n)?(\s*(\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*\n))*/)[0];
  out = '// @ts-nocheck — converted from JavaScript; types are added file by file.\n' + lead + imports.join('\n') + (imports.length ? '\n' : '') + out.slice(lead.length);
  // a require() inside a value of module.exports is copied as-is above — flag it for a manual fix
  for (const m of out.matchAll(/\brequire\(/g)) problems.push(`${file}:${out.slice(0, m.index).split('\n').length} require() left inside an exported value`);
  return { out: out.replace(/\n{3,}/g, '\n\n'), problems };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dry = process.argv.includes('--dry');
  const files = process.argv.slice(2).filter((a) => a !== '--dry');
  let bad = 0;
  for (const f of files) {
    const { out, problems } = convert(fs.readFileSync(f, 'utf8'), f);
    for (const p of problems) { console.log('!', p); bad++; }
    if (!dry) { fs.writeFileSync(f.replace(/\.js$/, '.ts'), out); if (f.endsWith('.js')) fs.unlinkSync(f); }
  }
  console.log(`${files.length} files, ${bad} problems`);
}
