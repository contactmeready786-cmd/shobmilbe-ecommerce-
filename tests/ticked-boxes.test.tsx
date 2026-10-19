// ☑️ A box ticked from the start must stay the owner's to untick once React has taken the page over: it is drawn as
// defaultChecked (React holds a `checked` box ticked), and the page's HTML shows checked="" as always.
// (tests/admin-scripts.test.ts stops checked= on an <input> anywhere; the parity run's real browser ticks and unticks
// the boxes on the pages.)
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { isValidElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as ui from '../lib/admin/ui';
import { loadRenderer } from '../lib/react/render';

before(loadRenderer);

// every <input> inside a piece
function inputs(node: unknown, out: ReactElement[] = []): ReactElement[] {
  if (Array.isArray(node)) { node.forEach((n: unknown) => inputs(n, out)); return out; }
  if (!isValidElement(node)) return out;
  if (node.type === 'input') out.push(node);
  inputs((node.props as { children?: unknown }).children, out);
  return out;
}

test('the admin switches and tick boxes are defaultChecked, never checked', () => {
  for (const [what, piece] of [
    ['switchRow on', ui.switchRow('a', true, 'চালু')],
    ['check on', ui.check('b', true, 'হ্যাঁ')],
    ['rowSwitch on', ui.rowSwitch('/admin/x', true, 'দেখান')],
  ] as const) {
    const boxes = inputs(piece).filter((i) => (i.props as { type?: string }).type === 'checkbox');
    assert.ok(boxes.length, what);
    for (const b of boxes) {
      const p = b.props as Record<string, unknown>;
      assert.equal(p.defaultChecked, true, what);
      assert.equal('checked' in p, false, what);
    }
    assert.match(renderToStaticMarkup(piece), /<input[^>]*type="checkbox"[^>]*checked=""/, what);
  }
});

test('a switch that is off has no checked at all', () => {
  const html = renderToStaticMarkup(ui.switchRow('a', false, 'চালু'));
  assert.doesNotMatch(html, /checked/);
});

test('text boxes keep what the owner types (defaultValue, not a held value)', () => {
  for (const piece of [ui.input('name', 'আগের নাম'), ui.textarea('note', 'লেখা'), ui.select('k', [['1', 'এক'], ['2', 'দুই']], '2')]) {
    const p = (piece as ReactElement).props as Record<string, unknown>;
    assert.equal('value' in p, false);
    assert.ok('defaultValue' in p);
  }
  // (React writes the attributes in its own order; the browser reads them the same)
  assert.equal(renderToStaticMarkup(ui.input('name', 'আগের নাম', { maxlength: 80, required: true })), '<input maxLength="80" required="" name="name" value="আগের নাম"/>');
  assert.equal(renderToStaticMarkup(ui.select('k', [['1', 'এক'], ['2', 'দুই']], '2')), '<select name="k"><option value="1">এক</option><option value="2" selected="">দুই</option></select>');
});
