/* সবমিলবে — the shop's offer notifications (Web Push). Only shows notifications; nothing else is cached here. */
// A plain script (service workers can't be modules everywhere); the block keeps its names to itself.
{
  const sw = self as unknown as ServiceWorkerGlobalScope;
  type Push = { title?: string; body?: string; icon?: string; tag?: string; url?: string; image?: string };
  const read = (e: PushEvent): Push => {
    try { return e.data ? (e.data.json() as Push) : {}; } catch { return { body: e.data ? e.data.text() : '' }; }
  };

  sw.addEventListener('install', () => { void sw.skipWaiting(); });
  sw.addEventListener('activate', (e) => e.waitUntil(sw.clients.claim()));
  sw.addEventListener('push', (e) => {
    const d = read(e);
    const opts: NotificationOptions & { image?: string } = { body: d.body || '', icon: d.icon || '/icon-192.png', badge: '/icon-192.png', tag: d.tag || undefined, data: { url: d.url || '/' } };
    if (d.image) opts.image = d.image;
    e.waitUntil(sw.registration.showNotification(d.title || 'সবমিলবে', opts));
  });
  sw.addEventListener('notificationclick', (e) => {
    e.notification.close();
    let url = new URL(e.notification.data?.url || '/', sw.location.origin);
    if (url.origin !== sw.location.origin) url = new URL('/', sw.location.origin);
    e.waitUntil((async () => {
      const list = await sw.clients.matchAll({ type: 'window', includeUncontrolled: true });
      // an open shop tab (not the admin) goes to the offer
      const tab = list.find((c) => !c.url.includes('/admin') && 'navigate' in c);
      if (tab) { const c = await tab.navigate(url.href); await c?.focus(); return; }
      await sw.clients.openWindow(url.href);
    })());
  });
}
