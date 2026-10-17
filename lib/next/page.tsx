// ⚛️ The Next.js side of lib/shop/router.tsx: the head tags and the page body for the address being visited.
// app/(shop)/page.tsx, products/, brand/[slug]/, p/[slug]/ are each one line that uses these.
import type { Metadata, Viewport } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';
import { JsonLd } from '@/components/shop/chrome/Head';
import { currentShopPage, getSettings } from './shop-data';
import { shopMetadata, shopViewport } from './meta';

export async function currentMetadata(): Promise<Metadata> {
  const [cur, s] = await Promise.all([currentShopPage(), getSettings()]);
  if (cur.kind !== 'page') return shopMetadata(s, { title: 'পাওয়া যায়নি', noindex: true });
  const o = cur.opts;
  return shopMetadata(s, { title: cur.title, description: o.description, keywords: o.keywords, canonical: o.canonical, image: o.image, type: o.type, noindex: o.noindex });
}

export async function currentViewport(): Promise<Viewport> { return shopViewport(await getSettings()); }

export async function CurrentShopPage() {
  const cur = await currentShopPage();
  // proxy.ts already sent missing and moved things to the original code; these two only happen if it changed meanwhile
  if (cur.kind !== 'page') {
    if (cur.kind === 'redirect') permanentRedirect(cur.location);
    notFound();
    return null;
  }
  return (
    <>
      {cur.opts.type === 'product' ? <meta property="og:type" content="product" /> : null}
      {cur.body}
      <JsonLd data={[cur.opts.jsonLd, cur.opts.jsonLdExtra]} />
    </>
  );
}
