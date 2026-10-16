import type { ReactNode } from 'react';

// Root layout for pages rebuilt in Next.js. Pages still answered by the original code don't use it.
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="bn">
      <body>{children}</body>
    </html>
  );
}
