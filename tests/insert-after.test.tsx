// The switch under a page's heading (lib/admin/testclear.tsx) is put into the React page right after its first
// </h1> — the same place the old text code put it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../lib/react/render';
import { toHtml, Val, insertAfterTag } from '../lib/react/html';
import { raw } from '../lib/util';

const TOP = <form id="top">switch</form>;
const old = (s: string) => { const i = s.indexOf('</h1>'); return i < 0 ? '<form id="top">switch</form>' + s : s.slice(0, i + 5) + '<form id="top">switch</form>' + s.slice(i + 5); };
const made = (body: unknown) => { const r = insertAfterTag(body, 'h1', TOP); return toHtml(<>{r.found ? <Val v={r.node} /> : <>{TOP}<Val v={body} /></>}</>).s; };

test('after the first heading, wherever it sits', () => {
  const pieces: unknown[] = [
    toHtml(<><div className="title-row"><h1>পণ্য</h1><a href="/x">নতুন</a></div><p>list</p><h1>second</h1></>),
    toHtml(<section><Val v={toHtml(<div><h1>ভেতরে</h1></div>)} /><p>after</p></section>),
    raw('<div><h1>text page</h1><p>rest</p></div>'),
    toHtml(<div><Val v={raw('<p>a</p><h1>in html</h1><p>b</p>')} /></div>),
    toHtml(<p>no heading</p>),
  ];
  for (const b of pieces) assert.equal(made(b), old(String(b)));
});
