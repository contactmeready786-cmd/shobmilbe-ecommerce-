// /blog/category/<slug> — the articles of one blog category.
import type { Metadata, Viewport } from 'next';
import { notFound } from 'next/navigation';
import { BlogList } from '@/components/shop/Pages';
import * as content from '@/lib/models/content';
import { blogCategory } from '@/lib/next/loaders';
import { getSettings } from '@/lib/next/shop-data';
import { shopMetadata, shopViewport } from '@/lib/next/meta';

type Props = { params: Promise<{ slug: string }> };
const load = (slug: string) => blogCategory(decodeURIComponent(slug));

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { category } = await load((await params).slug);
  const s = await getSettings();
  return category ? shopMetadata(s, { title: category.name, canonical: `/blog/category/${category.slug}` }) : shopMetadata(s, { title: 'পাওয়া যায়নি', noindex: true });
}
export async function generateViewport(): Promise<Viewport> { return shopViewport(await getSettings()); }

export default async function BlogCategory({ params }: Props) {
  const { cats, category } = await load((await params).slug);
  if (!category) notFound();
  const posts = await content.listPosts({ published: true, categorySlug: category.slug, limit: 60 });
  return <BlogList posts={posts} categories={cats} category={category} />;
}
