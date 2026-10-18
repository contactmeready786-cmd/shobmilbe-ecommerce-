// 📝 One blog article (/blog/<slug>) as data: its title, its React body and its page settings. Used by the Next.js page
// (app/(shop)/blog/[slug]) and by the original router (lib/site.ts), so both always show the same page.
// A line "/p/<product link>" inside the article shows that product's card (at most 10 per article).
import * as catalog from '../models/catalog';
import * as content from '../models/content';
import * as md from '../views/md';
import * as shop from '../views/shop';
import { BlogPost } from '../../components/shop/Pages';
import { RawHtml } from '../react/html';
import type { PageOpts } from './router';
import type { Loose, Settings } from '../types';

/** The article if it is published (and its time has come), else null. */
export async function publishedPost(slug: string): Promise<content.Post | null> {
  const post = (await content.getPost({ slug }));
  return post && post.status === 'published' && new Date(post.published_at!) <= new Date() ? post : null;
}

export async function blogPostPage(slug: string, settings: Settings) {
  const post = await publishedPost(slug);
  if (!post) return null;
  const parts = md.render(post.content, { productCard: true }).split(/<!--product:([^>]+)-->/);
  // the first 10 product lines become cards (any later ones show nothing)
  const slugs = [...new Set(parts.filter((_, i) => i % 2 && i < 20))];
  const cards: Record<string, unknown> = {};
  for (const s of slugs) {
    const p = (await catalog.getProduct({ slug: s, public: true }));
    if (p && p.active) cards[s] = p;
  }
  const body = (
    <>{parts.map((x, i) => (i % 2
      ? (i < 20 && cards[x] ? <div key={i} className="grid grid-inline">{shop.productCard(cards[x], settings)}</div> : null)
      : <RawHtml key={i} html={x} />))}</>
  );
  const related = ((await content.listPosts({ published: true, categorySlug: post.category_slug, limit: 4 })) as Loose[]).filter((p) => p.id !== post.id).slice(0, 3);
  const opts: PageOpts = {
    active: 'blog', canonical: `/blog/${post.slug}`, description: post.seo_description || post.excerpt || md.plain(post.content),
    image: post.cover_id ? `/media/${post.cover_id}` : '', type: 'article',
    jsonLd: { '@context': 'https://schema.org', '@type': 'BlogPosting', headline: post.title, datePublished: post.published_at, author: post.author_name ? { '@type': 'Person', name: post.author_name } : undefined },
  };
  return { post, title: String(post.seo_title || post.title), body: <BlogPost post={post} content={body} related={related} />, opts };
}
