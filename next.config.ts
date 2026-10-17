import type { NextConfig } from 'next';

const config: NextConfig = {
  poweredByHeader: false,
  // Title, description and the other head tags always arrive in <head> (no "streamed" metadata), so every visitor and
  // every crawler — Google, Facebook, WhatsApp previews — gets them the same way.
  htmlLimitedBots: /.*/,
  reactStrictMode: true,
  // The shop decides about trailing slashes itself (it always did); Next.js must not redirect first.
  skipTrailingSlashRedirect: true,
  async rewrites() {
    return {
      beforeFiles: [],
      afterFiles: [],
      // Anything without its own Next.js page (yet) is answered by the original code.
      fallback: [{ source: '/:path*', destination: '/api/legacy/:path*' }],
    };
  },
};

export default config;
