// 📋 AI description check (lib/services/descfix.ts): a corrected description only goes in by itself when it is
// about the same part. (Pure part of it; the Gemini call is not tested here.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { partCodes, squash } from '../lib/data/titlecheck';

// the same rule as descOk() without importing the database module
function ok(name: string, text: string): boolean {
  if (text.length < 120 || text.length > 2500) return false;
  const codes = partCodes(name);
  if (!codes.length || codes.every((c) => !squash(text).includes(c))) return false;
  const foreign = partCodes(text).filter((c) => !squash(name).includes(c) && !/^(TO|SOT|DIP|DO)\d/.test(c));
  return foreign.length <= 2;
}

test('a corrected TIP122 sheet passes, a TIP31C sheet does not', () => {
  const good = 'TIP122 is an NPN Darlington power transistor in a TO-220 package for switching motors and relays.\nSpecifications:\n- Vceo: 100V\n- Ic: 5A\n- Pd: 65W\nPackage includes: 1 x TIP122';
  assert.equal(ok('TIP122 NPN Power Darlington Transistor 100V 5A TO-220', good), true);
  const other = 'TIP31C is an NPN power transistor in a TO-220 package used in amplifiers and switching circuits.\nSpecifications:\n- Vceo: 100V\n- Ic: 3A\nPackage includes: 1 x TIP31C';
  assert.equal(ok('TIP122 NPN Power Darlington Transistor', other), false);
});
