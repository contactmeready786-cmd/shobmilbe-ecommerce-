// ⚛️ The frame of every admin page served by Next.js. proxy.ts already ran the admin's front checks (country lock,
// the customer app) and set the script rule with this visit's nonce; the page's pieces come from lib/next/admin.ts.
import type { ReactNode } from 'react';
import { Hydrated } from '@/components/shop/chrome/Hydrated';
import { adminBodyClass, ASSET_V } from '@/lib/admin/layout';
import { currentAdminPage } from '@/lib/next/admin';
import { getSettings } from '@/lib/next/shop-data';
import { adminLangBoot } from '@/lib/boot-scripts';

export const dynamic = 'force-dynamic';


export default async function AdminRoot({ children }: { children: ReactNode }) {
  const cur = await currentAdminPage();
  // (the page's own fresh settings: what the owner just saved shows at once)
  const s = cur.kind === 'page' ? cur.settings : await getSettings();
  const nonce = cur.kind === 'page' ? cur.nonce : '';
  return (
    // the language and menu scripts set attributes on <html> / <body> before React takes over
    <html lang="bn" suppressHydrationWarning>
      <head>
        <link rel="icon" href={s.favicon_id ? `/media/${s.favicon_id}/t` : '/brand/favicon-32.png'} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+Bengali:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
        <link rel="stylesheet" href={`/css/style.css?v=${ASSET_V}`} />
        <link rel="stylesheet" href={`/css/admin.css?v=${ASSET_V}`} />
        <link rel="manifest" href="/admin.webmanifest" />
        <link rel="apple-touch-icon" href="/icon-192.png" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        {s.admin_i18n_on !== '0' ? <><script nonce={nonce} dangerouslySetInnerHTML={{ __html: adminLangBoot }} /><style dangerouslySetInnerHTML={{ __html: 'html.admin-i18n-wait body{visibility:hidden}' }} /></> : null}
      </head>
      <body className={adminBodyClass(cur.kind === 'page' && cur.bare)} suppressHydrationWarning>
        {children}
        <Hydrated />
      </body>
    </html>
  );
}
