// Records the OLD page frame (lib/views/__old_layout.ts, copied from git before the frame moved to React) for the
// samples in tests/fixtures/chrome.ts → tests/golden/chrome-<name>.html. Only for names without a file yet.
import fs from 'node:fs';
import * as OLD from '../lib/views/__old_layout';
import { variants } from '../tests/fixtures/chrome';

let n = 0;
for (const [name, props] of variants) {
  const f = `tests/golden/chrome-${name}.html`;
  if (fs.existsSync(f)) continue;
  fs.writeFileSync(f, String(OLD.shopLayout(props)));
  n++;
}
console.log(`new golden files: ${n}`);
