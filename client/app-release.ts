// 📱 The browser's copy of lib/app-release.ts (the customer app offered for download). Change both together —
// tests/app-release.test.ts checks they match.
export const APP_VERSION = '1.4';

/** The app's version from its browser name ("… ShobmilbeApp/1.4"), or '' outside the app. */
export function appVersionOf(userAgent: string): string {
  const m = /ShobmilbeApp\/(\d+(?:\.\d+)*)/.exec(userAgent || '');
  return m ? m[1] : '';
}

/** Is version a older than version b? */
export function olderVersion(a: string, b: string): boolean {
  const x = a.split('.').map(Number), y = b.split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] || 0) - (y[i] || 0);
    if (d) return d < 0;
  }
  return false;
}
