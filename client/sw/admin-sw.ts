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
  // 🎤 "Share → সবমিলবে Admin" from the phone's Phone app (public/admin.webmanifest share_target): the recording is
  // kept in the cache and Admin → Voice & calls picks it up (client/admin/voice.tsx). Every other request is left alone.
  sw.addEventListener('fetch', (e) => {
    const url = new URL(e.request.url);
    if (e.request.method !== 'POST' || url.pathname !== '/admin/voice/share') return;
    e.respondWith((async () => {
      try {
        const form = await e.request.formData();
        const file = form.get('audio');
        if (file && typeof file !== 'string') {
          const c = await caches.open('sm-share');
          await c.put('/admin/voice/shared-file', new Response(file, { headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name || 'recording') } }));
        }
      } catch { /* the page says nothing arrived */ }
      return Response.redirect('/admin/voice?shared=1#add-call', 303);
    })());
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
