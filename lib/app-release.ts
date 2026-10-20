// 📱 The customer Android app that the shop offers for download (/app). One place for its version and file.
// A new version: build it (android/ → the "android" workflow), sign it with the owner's key, put the signed file in
// public/downloads/, then change these lines AND client/app-release.ts (tests/app-release.test.ts checks they agree with
// android/gradle.properties and that the file is there).
export const APP_RELEASE = {
  version: '1.4',
  file: '/downloads/shobmilbe-v1.4.apk',
  sizeMb: '2.1',
  date: '2026-10-20',
} as const;

/** The app's version from its browser name ("… ShobmilbeApp/1.4"), or '' outside the app. */
export function appVersionOf(userAgent: string | undefined): string {
  const m = /ShobmilbeApp\/(\d+(?:\.\d+)*)/.exec(userAgent || '');
  return m ? m[1] : '';
}

/** Is version a older than version b? ("1.3" < "1.4" < "1.10") */
export function olderVersion(a: string, b: string): boolean {
  const x = a.split('.').map(Number), y = b.split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] || 0) - (y[i] || 0);
    if (d) return d < 0;
  }
  return false;
}
