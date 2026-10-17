// /admin/… — every admin page that shows a page (the files, exports and forms still go to lib/site.ts, see proxy.ts).
// The admin's own code (lib/admin) makes the page's pieces (lib/next/admin.ts); they are drawn here in the React frame.
import type { Metadata, Viewport } from 'next';
import { redirect } from 'next/navigation';
import { AdminBare, AdminBody } from '@/lib/admin/layout';
import { Val } from '@/lib/react/html';
import { currentAdminPage, SITE_MARK } from '@/lib/next/admin';
import { getRequestUrl } from '@/lib/next/shop-data';
import type { Loose } from '@/lib/types';

export async function generateMetadata(): Promise<Metadata> {
  const cur = await currentAdminPage();
  return { title: cur.kind === 'page' ? `${String(cur.title)} | Admin` : 'Admin', robots: { index: false, follow: false } };
}
export function generateViewport(): Viewport { return { themeColor: '#14213D' }; }

export default async function AdminPage() {
  const cur = await currentAdminPage();
  if (cur.kind === 'redirect') redirect(cur.location);
  if (cur.kind !== 'page') {
    // this one is answered by the original code (a file, a form's answer, a page with another status)
    const url = await getRequestUrl();
    url.searchParams.set(SITE_MARK, '1');
    redirect(url.pathname + url.search);
  }
  if (cur.bare) return <AdminBare settings={cur.settings}><Val v={cur.body} /></AdminBare>;
  return (
    <AdminBody settings={cur.settings} user={cur.user as Loose} active={cur.active} readOnly={cur.readOnly} path={cur.path} nonce={cur.nonce}>
      <Val v={cur.body} />
    </AdminBody>
  );
}
