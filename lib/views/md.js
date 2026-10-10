'use strict';
// A tiny, safe text formatter for descriptions, pages and blog posts.
// Everything is escaped first; only these patterns become HTML:
//   ## Heading / ### Heading, - bullet, 1. numbered, **bold**, *italic*, [text](url),
//   a line that is only an image URL → <img>, a YouTube URL → embedded video,
//   a line "/p/slug" → product card placeholder (filled by the caller),
//   | a | b | rows → a table (first row = heading; a |---| row is skipped) — used for size charts.
const { esc, youtubeId } = require('../util');

function inline(s) {
  return s
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*(?!\s)(.+?)\*(?=[\s).,!?]|$)/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\(((?:https?:\/\/|\/)[^\s)]+)\)/g, (_, t, u) => `<a href="${u}"${u.startsWith('/') ? '' : ' rel="noopener nofollow" target="_blank"'}>${t}</a>`);
}

function render(text, { productCard } = {}) {
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  const out = [];
  let list = null;
  let table = null;
  const closeTable = () => {
    if (!table) return;
    const [head, ...body] = table;
    out.push(`<div class="table-scroll"><table class="md-table"><thead><tr>${head.map((c) => `<th>${inline(esc(c))}</th>`).join('')}</tr></thead>`
      + `<tbody>${body.map((r) => `<tr>${head.map((_, i) => `<td>${inline(esc(r[i] || ''))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
    table = null;
  };
  const close = () => { if (list) { out.push(`</${list}>`); list = null; } };
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (/^\|.*\|$/.test(line) && line.length > 2) {
      close();
      const cells = line.slice(1, -1).split('|').map((c) => c.trim());
      if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue; // |---|---|
      (table = table || []).push(cells.slice(0, 12));
      continue;
    }
    closeTable();
    if (!line) { close(); continue; }
    const e = esc(line);
    let m;
    if ((m = line.match(/^(#{2,3})\s+(.+)$/))) { close(); out.push(`<h${m[1].length}>${inline(esc(m[2]))}</h${m[1].length}>`); continue; }
    if ((m = line.match(/^[-•*]\s+(.+)$/))) { if (list !== 'ul') { close(); out.push('<ul>'); list = 'ul'; } out.push(`<li>${inline(esc(m[1]))}</li>`); continue; }
    if ((m = line.match(/^\d+[.)]\s+(.+)$/))) { if (list !== 'ol') { close(); out.push('<ol>'); list = 'ol'; } out.push(`<li>${inline(esc(m[1]))}</li>`); continue; }
    close();
    if (/^https?:\/\/\S+\.(?:jpe?g|png|webp|gif)(?:\?\S*)?$/i.test(line) || /^\/media\/\d+$/.test(line)) { out.push(`<figure><img src="${e}" alt="" loading="lazy"></figure>`); continue; }
    const yt = /^https?:\/\/\S+$/.test(line) && youtubeId(line);
    if (yt) { out.push(`<div class="video"><iframe src="https://www.youtube-nocookie.com/embed/${yt}" title="YouTube video" loading="lazy" allowfullscreen allow="accelerometer; encrypted-media; gyroscope; picture-in-picture"></iframe></div>`); continue; }
    if ((m = line.match(/^\/p\/([A-Za-z0-9ঀ-৿-]+)$/)) && productCard) { out.push(`<!--product:${esc(m[1])}-->`); continue; }
    out.push(`<p>${inline(e)}</p>`);
  }
  close();
  closeTable();
  return out.join('\n');
}
function plain(text, max = 160) {
  return String(text || '').replace(/[#*_[\]()>-]+/g, ' ').replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
}

module.exports = { render, plain };
