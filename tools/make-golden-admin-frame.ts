// Records the OLD admin page frame (lib/admin/__old_layout.tsx, as it was before the frame became React components)
// for the samples in tests/fixtures/admin-frame.ts → tests/golden/admin-frame-<name>.html. Only for names without a file yet.
import fs from 'node:fs';
import '../lib/react/render';
import * as OLD from '../lib/admin/__old_layout';
import { frames } from '../tests/fixtures/admin-frame';

let n = 0;
for (const [name, props] of frames) {
  const f = `tests/golden/admin-frame-${name}.html`;
  if (fs.existsSync(f)) continue;
  fs.writeFileSync(f, String(OLD.adminLayout(props)));
  n++;
}
console.log(`new golden files: ${n}`);
