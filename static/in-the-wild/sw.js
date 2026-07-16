const BASE = self.location.pathname.replace(/sw\.js$/, '');

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open('itw-v1').then((c) => c.addAll([BASE, BASE + 'favicon.svg']).catch(() => {})));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }
  const title = data.title || "You're nearby!";
  const body = data.body || 'A mutual match is within 100 feet.';
  const url = data.url || BASE;
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag: data.tag || 'itw-proximity',
      data: { url },
      icon: BASE + 'favicon.svg',
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = event.notification.data?.url || BASE;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes(BASE) && 'focus' in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    }),
  );
});
