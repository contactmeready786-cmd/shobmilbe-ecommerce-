// The build id of the browser code and style sheets (public/js/version.json, written by tools/version-client.mjs during
// `npm run build:client`). Pages add it to their <script>/<link> addresses, so after every update visitors get the new
// files at once — even though Cloudflare keeps /js files for hours (owner, 2026-11-14). Empty when not built (tests).
import fs from 'node:fs';
import path from 'node:path';

let id: string | null = null;
export function buildId(): string {
  if (id !== null) return id;
  try { id = String(JSON.parse(fs.readFileSync(path.join(process.cwd(), 'public', 'js', 'version.json'), 'utf8')).v || ''); } catch { id = ''; }
  return id;
}
/** "63" → "63.ab12cd34ef" (or just "63" before a build) */
export const withBuild = (v: string) => (buildId() ? `${v}.${buildId()}` : v);
