// ☑️ A box ticked from the start (raw('checked') in the converted pages) must stay the owner's to untick once React has
// taken the page over: it is drawn as defaultChecked (React would hold a `checked` box ticked), with the same HTML.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { attrProps } from '../lib/react/html';
import { raw } from '../lib/util';

test('raw("checked") becomes defaultChecked, never checked', () => {
  const p = attrProps(raw('checked'));
  assert.deepEqual(p, { defaultChecked: true });
  assert.equal('checked' in p, false);
});

test('the page HTML is the same as before: checked=""', () => {
  const on = renderToStaticMarkup(<input type="checkbox" name="on" defaultValue="1" {...attrProps(raw('checked'))} />);
  // exactly what the old `checked` prop gave (React writes checked before value either way)
  assert.equal(on, renderToStaticMarkup(<input type="checkbox" name="on" defaultValue="1" checked readOnly={undefined} onChange={undefined} />));
  assert.equal(on, '<input type="checkbox" name="on" checked="" value="1"/>');
  const off = renderToStaticMarkup(<input type="checkbox" name="on" defaultValue="1" {...attrProps('')} />);
  assert.equal(off, '<input type="checkbox" name="on" value="1"/>');
});

test('other attributes are unchanged', () => {
  assert.deepEqual(attrProps(raw('disabled')), { disabled: true });
  assert.deepEqual(attrProps(raw(' aria-current="page"')), { 'aria-current': 'page' });
  assert.deepEqual(attrProps(raw('selected')), { selected: true });
});
