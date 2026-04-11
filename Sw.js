// ============================================================
// LUHV+ Service Worker — Push + Cache
// ============================================================
const CACHE = 'luhv-v1';

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(['/', '/icon-192.png'])));
});

self.addEventListener('activate', e => e.waitUntil(clients.claim()));

// ── Receive push ─────────────────────────────────────────────
self.addEventListener('push', e => {
  if (!e.data) return;
  let p;
  try { p = e.data.json(); }
  catch { p = { title: 'Luhv+', body: e.data.text(), url: '/' }; }

  e.waitUntil(
    self.registration.showNotification(p.title, {
      body:               p.body,
      icon:               '/icon-192.png',
      badge:              '/icon-192.png',
      tag:                p.tag || 'luhv-nudge',
      renotify:           true,
      requireInteraction: false,
      data:               { url: p.url || '/' },
      actions: [
        { action: 'open',    title: '✅ Go to my tasks' },
        { action: 'dismiss', title: 'Later'             },
      ],
    })
  );
});

// ── Notification click ───────────────────────────────────────
self.addEventListener('notificationclick', e => {
  e.notification.close();
  if (e.action === 'dismiss') return;
  const url = e.notification.data?.url || '/';
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) {
        if (c.url.includes(self.location.origin) && 'focus' in c) return c.focus();
      }
      return clients.openWindow(url);
    })
  );
});
