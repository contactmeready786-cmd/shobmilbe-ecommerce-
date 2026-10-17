// /blog/<slug> — one article (lib/shop/blog.tsx draws it, the same as the original router).
import type { Metadata, Viewport } from 'next';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { JsonLd } from '@/components/shop/chrome/Head';
import * as db from '@/lib/db';
import { blogPostPage } from '@/lib/shop/blog';
import { getSettings } from '@/lib/next/shop-data';
import { shopMetadata, shopViewport } from '@/lib/next/meta';

type Props = { params: Promise<{ slug: string }> };
const safeDecode = (s: string) => { try { return decodeURIComponent(s); } catch { return s; } };
const load = cache(async (slug: string) => blogPostPage(safeDecode(slug), await getSettings()));

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const [r, s] = await Promise.all([load((await params).slug), getSettings()]);
  if (!r) return shopMetadata(s, { title: 'পাওয়া যায়নি', noindex: true });
  const o = r.opts;
  return shopMetadata(s, { title: r.title, description: o.description, canonical: o.canonical, image: o.image, type: o.type });
}
export async function generateViewport(): Promise<Viewport> { return shopViewport(await getSettings()); }

export default async function BlogArticle({ params }: Props) {
  const r = await load((await params).slug);
  // proxy.ts already sent missing articles to the shop's 404 page; this only happens if one was hidden meanwhile
  if (!r) notFound();
  db.q('UPDATE blog_posts SET views = views + 1 WHERE id=$1', [r.post.id]).catch(() => {});
  return <>{r.body}<JsonLd data={[r.opts.jsonLd]} /></>;
}
