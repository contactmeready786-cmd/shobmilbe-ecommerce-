// 🔎 Title, description and the tags Google / Facebook read — written by Next.js from this metadata (the Metadata API).
// Same information the shop always sent: title "<page> | <shop>", description, keywords, canonical link, Open Graph,
// Twitter card, site-verification tags, icons and the theme colour.
import type { Metadata, Viewport } from 'next';
import * as $services_seo from '../services/seo';
import type { Settings } from '../types';
import { colors } from '../../components/shop/chrome/Head';

export type PageMeta = {
  title?: string; description?: string; keywords?: string; canonical?: string; image?: string;
  type?: 'website' | 'article' | 'product'; noindex?: boolean;
};

export function shopMetadata(s: Settings, m: PageMeta = {}): Metadata {
  const title = m.title ? `${m.title} | ${s.store_name}` : $services_seo.homeTitle(s);
  const kw = m.keywords || s.seo_keywords || '';
  const desc = m.description || s.seo_description || s.tagline || '';
  const base = (s.site_url || '').replace(/\/+$/, '');
  const ogImage = m.image || (s.og_image_id ? `/media/${s.og_image_id}` : s.logo_id ? `/media/${s.logo_id}` : '');
  const abs = (u: string) => (u && u.startsWith('/') && base ? base + u : u);
  const url = m.canonical && base ? base + m.canonical : undefined;
  const other: Record<string, string> = {};
  if (s.fb_domain_verification) other['facebook-domain-verification'] = s.fb_domain_verification;
  if (s.bing_site_verification) other['msvalidate.01'] = s.bing_site_verification;
  if (s.tiktok_domain_verification) other['tiktok-developers-site-verification'] = s.tiktok_domain_verification;
  return {
    title: { absolute: title },
    description: desc,
    keywords: kw || undefined,
    robots: m.noindex ? { index: false } : undefined,
    alternates: url ? { canonical: url } : undefined,
    openGraph: {
      type: m.type === 'article' ? 'article' : 'website',
      title, description: desc, siteName: s.store_name, url,
      images: ogImage ? [{ url: abs(ogImage) }] : undefined,
    },
    twitter: ogImage ? { card: 'summary_large_image' } : undefined,
    verification: { google: s.google_site_verification || undefined, other: Object.keys(other).length ? other : undefined },
    icons: s.favicon_id
      ? { icon: `/media/${s.favicon_id}/t`, apple: `/media/${s.favicon_id}` }
      : { icon: [{ url: '/brand/favicon-32.png', type: 'image/png', sizes: '32x32' }, { url: '/brand/favicon-192.png', type: 'image/png', sizes: '192x192' }], apple: '/brand/apple-touch-icon.png' },
  };
}

export function shopViewport(s: Settings): Viewport {
  return { width: 'device-width', initialScale: 1, themeColor: colors(s).primary };
}
