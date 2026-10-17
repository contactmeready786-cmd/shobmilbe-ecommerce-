// /page/<slug> — the owner's own pages (About us, Return policy, Privacy …), written in Markdown in the admin.
import type { Metadata, Viewport } from 'next';
import { notFound } from 'next/navigation';
import { StaticPage } from '@/components/shop/Pages';
import { ownerPage } from '@/lib/next/loaders';
import * as md from '@/lib/views/md';
import { getSettings } from '@/lib/next/shop-data';
import { shopMetadata, shopViewport } from '@/lib/next/meta';

type Props = { params: Promise<{ slug: string }> };
const load = (slug: string) => ownerPage(decodeURIComponent(slug));

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const p = await load((await params).slug);
  const s = await getSettings();
  return p ? shopMetadata(s, { title: p.title, canonical: `/page/${p.slug}`, description: md.plain(p.content) }) : shopMetadata(s, { title: 'পাওয়া যায়নি', noindex: true });
}
export async function generateViewport(): Promise<Viewport> { return shopViewport(await getSettings()); }

export default async function OwnerPage({ params }: Props) {
  const p = await load((await params).slug);
  if (!p) notFound();
  return <StaticPage page={p} />;
}
