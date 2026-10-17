/* সবমিলবে Admin — phone notifications (new orders, security alerts). */
// A plain script (service workers can't be modules everywhere); the block keeps its names to itself.
{
  const sw = self as unknown as ServiceWorkerGlobalScope;
  type Push = { title?: string; body?: string; tag?: string; url?: string };
  const read = (e: PushEvent): Push => {
    try { return e.data ? (e.data.json() as Push) : {}; } catch { return { body: e.data ? e.data.text() : '' }; }
  };

  sw.addEventListener('install', () => { void sw.skipWaiting(); });
  sw.addEventListener('activate', (e) => e.waitUntil(sw.clients.claim()));
  sw.addEventListener('push', (e) => {
    const d = read(e);
    const opts: NotificationOptions & { renotify?: boolean; vibrate?: number[] } = {
      body: d.body || '',
      tag: d.tag || undefined,
      renotify: !!d.tag,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      vibrate: [200, 100, 200, 100, 300],
      data: { url: d.url || '/admin' },
    };
    e.waitUntil(sw.registration.showNotification(d.title || 'সবমিলবে', opts));
  });
  sw.addEventListener('notificationclick', (e) => {
    e.notification.close();
    const url = new URL(e.notification.data?.url || '/admin', sw.location.origin).href;
    e.waitUntil((async () => {
      const list = await sw.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const tab = list.find((c) => c.url.includes('/admin') && 'navigate' in c);
      if (tab) { const c = await tab.navigate(url); await c?.focus(); return; }
      await sw.clients.openWindow(url);
    })());
  });
}
