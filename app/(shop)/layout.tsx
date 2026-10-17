// ⚛️ The frame of every shop page served by Next.js (the customer side). The security gate already ran in proxy.ts;
// the title/description tags come from each page's generateMetadata (lib/next/meta.ts).
import type { ReactNode } from 'react';
import { ShopBody } from '@/components/shop/chrome/Chrome';
import { ShopHeadExtras } from '@/components/shop/chrome/Head';
import { Hydrated } from '@/components/shop/chrome/Hydrated';
import { getChrome, getShopPath, currentShopPage, activeFor } from '@/lib/next/shop-data';
import { servesShopRouter, servesMore, servesForms } from '@/lib/next/routes';

export const dynamic = 'force-dynamic';

export default async function ShopLayout({ children }: { children: ReactNode }) {
  const [{ settings: s, categories, pages, popup }, path] = await Promise.all([getChrome(), getShopPath()]);
  // the pages drawn by lib/shop/router.tsx and more.tsx tell the frame what to light up, the search word and what to track
  const cur = servesShopRouter(path) || servesMore(path) || servesForms(path) ? await currentShopPage() : null;
  const opts = cur && cur.kind === 'page' ? cur.opts : null;
  const bodyClass = ['shop', s.copy_protect === '1' ? 'protect' : '', s.copy_title === '1' ? 'copy-title' : '', `cols-${s.grid_cols || '4'}`].filter(Boolean).join(' ');
  return (
    // the language and app scripts set attributes on <html> before React takes over
    <html lang="bn" suppressHydrationWarning>
      <head>
        <ShopHeadExtras settings={s} />
      </head>
      <body className={bodyClass} suppressHydrationWarning>
        <ShopBody settings={s} categories={categories} pages={pages} popup={popup} q={opts?.q || ''} active={opts ? opts.active || '' : activeFor(path)} track={opts?.track ?? null}>
          {children}
        </ShopBody>
        <Hydrated />
      </body>
    </html>
  );
}
