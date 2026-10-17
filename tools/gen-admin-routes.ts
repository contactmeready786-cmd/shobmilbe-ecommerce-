// Writes lib/next/admin-routes.ts: the admin addresses that have a page for GET (from the admin modules' route lists,
// lib/admin/*). proxy.ts sends only these to the Next.js admin pages; any other admin address (a form's address
// opened by hand, a mistyped link) goes to the original code, which shows its "not found" page with the right status.
// Run after adding or changing an admin route: npx tsx tools/gen-admin-routes.ts (tests/routes.test.ts checks it).
import fs from 'node:fs';
import { adminGetRoutes } from '../tests/fixtures/admin-routes';

const lines = adminGetRoutes().map((r) => (typeof r === 'string' ? `  ${JSON.stringify(r)},` : `  /${r.source}/${r.flags},`));
fs.writeFileSync('lib/next/admin-routes.ts', `// Made by tools/gen-admin-routes.ts from the admin modules' route lists — don't edit by hand.
// The admin addresses that answer GET with a page (the login and set-up pages first).
export const ADMIN_GET_ROUTES: (string | RegExp)[] = [
${lines.join('\n')}
];
`);
console.log(`admin GET routes: ${lines.length}`);
