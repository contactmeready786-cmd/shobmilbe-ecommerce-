// /blog/category/<slug> — the articles of one blog category.
import type { Metadata, Viewport } from 'next';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { BlogList } from '@/components/shop/Pages';
import * as content from '@/lib/models/content';
import { getSettings } from '@/lib/next/shop-data';
import { shopMetadata, shopViewport } from '@/lib/next/meta';
import type { Loose } from '@/lib/types';

type Props = { params: Promise<{ slug: string }> };
const load = cache(async (slug: string) => {
  await getSettings();
  const cats = (await content.listBlogCategories()) as Loose[];
  return { cats, category: cats.find((c) => c.slug === decodeURIComponent(slug)) || null };
});

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { category } = await load((await params).slug);
  const s = await getSettings();
  return category ? shopMetadata(s, { title: category.name, canonical: `/blog/category/${category.slug}` }) : shopMetadata(s, { title: 'পাওয়া যায়নি', noindex: true });
}
export async function generateViewport(): Promise<Viewport> { return shopViewport(await getSettings()); }

export default async function BlogCategory({ params }: Props) {
  const { cats, category } = await load((await params).slug);
  if (!category) notFound();
  const posts = (await content.listPosts({ published: true, categorySlug: category.slug, limit: 60 })) as Loose[];
  return <BlogList posts={posts} categories={cats} category={category} />;
}
