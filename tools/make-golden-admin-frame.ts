// Records tests/golden/admin-frame-*.html from the current admin frame (lib/admin/layout.tsx). Run it only after a
// change that is MEANT to change the frame (e.g. the menu was regrouped), then check `git diff tests/golden` shows
// exactly that change:   npx tsx tools/make-golden-admin-frame.ts
import fs from 'node:fs';
import { adminLayout } from '../lib/admin/layout';
import { frames } from '../tests/fixtures/admin-frame';
import { loadRenderer } from '../lib/react/render';

loadRenderer().then(() => {
  for (const [name, props] of frames) {
    fs.writeFileSync(`tests/golden/admin-frame-${name}.html`, String(adminLayout(props)));
    console.log('recorded', name);
  }
});
