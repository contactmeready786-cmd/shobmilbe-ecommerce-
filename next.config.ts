import type { NextConfig } from 'next';

const config: NextConfig = {
  poweredByHeader: false,
  // Title, description and the other head tags always arrive in <head> (no "streamed" metadata), so every visitor and
  // every crawler — Google, Facebook, WhatsApp previews — gets them the same way.
  htmlLimitedBots: /.*/,
  reactStrictMode: true,
  // The shop decides about trailing slashes itself (it always did); Next.js must not redirect first.
  skipTrailingSlashRedirect: true,
  // How long a browser may keep the site's fixed files, so a returning visitor's phone doesn't fetch or even re-check
  // them on every page. The style sheets are always linked with ?v=<version> (ASSET_V), so a new version is a new address:
  // they can be kept for a year. The browser code (/js) imports its parts without a version, so it is only re-checked
  // (a quick "not changed" answer), never kept blindly. Icons and flags change rarely: a week.
  // (Only the icon files in /brand: /brand/<name> is also the address of the shop's brand pages.)
  async headers() {
    return [
      { source: '/css/:path*', headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }] },
      { source: '/brand/:file(favicon-\\d+\\.png|apple-touch-icon\\.png)', headers: [{ key: 'Cache-Control', value: 'public, max-age=604800, stale-while-revalidate=86400' }] },
      { source: '/flags/:path*', headers: [{ key: 'Cache-Control', value: 'public, max-age=604800, stale-while-revalidate=86400' }] },
      { source: '/icon-:size(\\d+).png', headers: [{ key: 'Cache-Control', value: 'public, max-age=604800, stale-while-revalidate=86400' }] },
    ];
  },
  async rewrites() {
    return {
      beforeFiles: [],
      afterFiles: [],
      // Anything without its own Next.js page (yet) is answered by the original code.
      fallback: [{ source: '/:path*', destination: '/api/site/:path*' }],
    };
  },
};

export default config;
