/* সবমিলবে — the shop's offer notifications (Web Push). Only shows notifications; nothing else is cached here. */
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });
self.addEventListener('push', function (e) {
  var d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { body: e.data ? e.data.text() : '' }; }
  var opts = { body: d.body || '', icon: d.icon || '/icon-192.png', badge: '/icon-192.png', tag: d.tag || undefined, data: { url: d.url || '/' } };
  if (d.image) opts.image = d.image;
  e.waitUntil(self.registration.showNotification(d.title || 'সবমিলবে', opts));
});
self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  var url = new URL((e.notification.data && e.notification.data.url) || '/', self.location.origin);
  if (url.origin !== self.location.origin) url = new URL('/', self.location.origin);
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
    for (var i = 0; i < list.length; i++) {
      if (list[i].url.indexOf('/admin') === -1 && 'navigate' in list[i]) return list[i].navigate(url.href).then(function (c) { return c && c.focus(); });
    }
    return self.clients.openWindow(url.href);
  }));
});
