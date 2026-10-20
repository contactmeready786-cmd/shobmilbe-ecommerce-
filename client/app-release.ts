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

export type InviteKind = 'update' | 'android' | 'computer';

/** Which card this visitor gets, or null. */
export function inviteKind(ua: string, touchPoints: number): InviteKind | null {
  const inApp = appVersionOf(ua);
  if (inApp) return olderVersion(inApp, APP_VERSION) ? 'update' : null;
  if (/iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && touchPoints > 1)) return null; // iPhone / iPad: no app yet
  if (/Android/i.test(ua)) return /Mobile/i.test(ua) ? 'android' : null; // Android tablets: skip
  if (/Windows|Macintosh|CrOS/.test(ua)) return 'computer'; // (touch-screen laptops too)
  // Chrome's "desktop site" on an Android phone says "Linux x86_64" — but it has a touch screen
  if (/Linux/.test(ua) && !/CrOS/.test(ua) && touchPoints > 0) return 'android';
  if (touchPoints > 0) return null; // some other touch device
  return 'computer';
}
