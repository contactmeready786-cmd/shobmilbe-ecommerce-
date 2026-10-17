// ⚛️ The page frame for the shop pages still answered by lib/app.ts (the ones not yet served by Next.js).
// It draws exactly what the Next.js pages draw: the same React frame (components/shop/chrome) and head pieces; only the
// title/description tags are written here instead of by Next.js's metadata. When the last page has moved to app/(shop),
// this file goes.
import { toHtml, Val } from '../react/render';
import * as $services_seo from '../services/seo';
import { esc } from '../util';
import { ShopBody, Logo, ASSET_V } from '../../components/shop/chrome/Chrome';
import { ShopHeadExtras, JsonLd, colors } from '../../components/shop/chrome/Head';
import type { Body, Id, Loose, Settings } from '../types';

function mediaUrl(id?: Id, thumb?: Loose) { return id ? `/media/${id}${thumb ? '/t' : ''}` : ''; }
function logo(settings: Settings) { return toHtml(<Logo settings={settings} />); }

type HeadProps = { s: Settings; title: string; description?: string; keywords?: string; canonical?: string; image?: string; type?: string; noindex?: boolean };
function HeadTags({ s, title, description, keywords, canonical, image, type = 'website', noindex }: HeadProps) {
  const kw = keywords || s.seo_keywords || '';
  const desc = description || s.seo_description || s.tagline || '';
  const base = (s.site_url || '').replace(/\/+$/, '');
  const ogImage = image || (s.og_image_id ? `/media/${s.og_image_id}` : s.logo_id ? `/media/${s.logo_id}` : '');
  const abs = (u: string) => (u && u.startsWith('/') && base ? base + u : u);
  return (
    <>
      <meta charSet="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>{title}</title>
      <meta name="description" content={desc} />
      {kw ? <meta name="keywords" content={kw} /> : null}
      {noindex ? <meta name="robots" content="noindex" /> : null}
      {canonical && base ? <link rel="canonical" href={`${base}${canonical}`} /> : null}
      <meta name="theme-color" content={colors(s).primary} />
      <meta property="og:type" content={type} /><meta property="og:title" content={title} /><meta property="og:description" content={desc} />
      <meta property="og:site_name" content={s.store_name} />{canonical && base ? <meta property="og:url" content={`${base}${canonical}`} /> : null}
      {ogImage ? <><meta property="og:image" content={abs(ogImage)} /><meta name="twitter:card" content="summary_large_image" /></> : null}
      {s.fb_domain_verification ? <meta name="facebook-domain-verification" content={s.fb_domain_verification} /> : null}
      {s.google_site_verification ? <meta name="google-site-verification" content={s.google_site_verification} /> : null}
      {s.bing_site_verification ? <meta name="msvalidate.01" content={s.bing_site_verification} /> : null}
      {s.tiktok_domain_verification ? <meta name="tiktok-developers-site-verification" content={s.tiktok_domain_verification} /> : null}
      {s.favicon_id ? <link rel="icon" href={`/media/${s.favicon_id}/t`} /> : <><link rel="icon" type="image/png" sizes="32x32" href="/brand/favicon-32.png" /><link rel="icon" type="image/png" sizes="192x192" href="/brand/favicon-192.png" /></>}
      <link rel="apple-touch-icon" href={s.favicon_id ? `/media/${s.favicon_id}` : '/brand/apple-touch-icon.png'} />
    </>
  );
}

function shopLayout({ settings: s, title, description, keywords, body, q, active, canonical, image, jsonLd, jsonLdExtra, type, noindex, categories = [], pages = [], track = null, popup = null }: Body) {
  const full = title ? `${title} | ${s.store_name}` : $services_seo.homeTitle(s);
  const bodyClass = ['shop', s.copy_protect === '1' ? 'protect' : '', s.copy_title === '1' ? 'copy-title' : '', `cols-${s.grid_cols || '4'}`].filter(Boolean).join(' ');
  const head = toHtml(<>
    <HeadTags s={s} title={full} description={description} keywords={keywords} canonical={canonical} image={image} type={type} noindex={noindex} />
    <ShopHeadExtras settings={s} />
    <JsonLd data={[jsonLd, jsonLdExtra]} />
  </>);
  const page = toHtml(<ShopBody settings={s} categories={categories} pages={pages} popup={popup} q={q || ''} active={active || ''} track={track}><Val v={body} /></ShopBody>);
  return `<!doctype html><html lang="bn"><head>${head.s}</head><body class="${esc(bodyClass)}">${page.s}</body></html>`;
}

export { shopLayout, logo, mediaUrl, ASSET_V };
