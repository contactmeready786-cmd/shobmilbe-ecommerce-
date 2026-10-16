import type { NextConfig } from 'next';

const config: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // The shop decides about trailing slashes itself (it always did); Next.js must not redirect first.
  skipTrailingSlashRedirect: true,
  // The original shop code is loaded at run time from lib/ — make sure Vercel ships those files.
  outputFileTracingIncludes: {
    '/legacy/[[...path]]': ['./lib/**/*', './public/**/*'],
  },
  async rewrites() {
    return {
      beforeFiles: [],
      afterFiles: [],
      // Anything without its own Next.js page (yet) is answered by the original code.
      fallback: [{ source: '/:path*', destination: '/legacy/:path*' }],
    };
  },
};

export default config;
