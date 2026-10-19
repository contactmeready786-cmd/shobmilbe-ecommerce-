// /blog — all articles.
import type { Metadata, Viewport } from 'next';
import { BlogList } from '@/components/shop/Pages';
import * as content from '@/lib/models/content';
import { getSettings } from '@/lib/next/shop-data';
import { shopMetadata, shopViewport } from '@/lib/next/meta';

export async function generateMetadata(): Promise<Metadata> {
  return shopMetadata(await getSettings(), { title: 'ব্লগ', canonical: '/blog' });
}
export async function generateViewport(): Promise<Viewport> { return shopViewport(await getSettings()); }

export default async function Blog() {
  await getSettings();
  const [cats, posts] = await Promise.all([content.listBlogCategories(), content.listPosts({ published: true, limit: 60 })]);
  return <BlogList posts={posts} categories={cats} category={null} />;
}
