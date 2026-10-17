// /track — order tracking form. (With both an order number and a phone number the address is answered by the
// original code — it checks the order, remembers it in this browser and opens it: proxy.ts sends it there.)
import type { Metadata, Viewport } from 'next';
import { TrackPage } from '@/components/shop/Pages';
import { getSettings, getRequestUrl } from '@/lib/next/shop-data';
import { shopMetadata, shopViewport } from '@/lib/next/meta';
import { str } from '@/lib/util';

export async function generateMetadata(): Promise<Metadata> {
  return shopMetadata(await getSettings(), { title: 'অর্ডার ট্র্যাক' });
}
export async function generateViewport(): Promise<Viewport> { return shopViewport(await getSettings()); }

export default async function Track() {
  const url = await getRequestUrl();
  const code = str(url.searchParams.get('code'), 20).toUpperCase().replace(/[^A-Z0-9]/g, '');
  return <TrackPage code={code} />;
}
