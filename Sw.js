// LUHV+ Service Worker
// Change VERSION every deploy — forces cache refresh for all users
const VERSION = 'v1.0.3';
const CACHE = 'luhv-' + VERSION;

const ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png'
];

// Install — cache core assets
self.addEventListener('install', function(e) {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then(function(cache) {
      return cache.addAll(ASSETS);
    })
  );
});

// Activate — delete old caches immediately
self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(key) { return key !== CACHE; })
            .map(function(key) { return caches.delete(key); })
      );
    }).then(function() { return self.clients.claim(); })
  );
});

// Fetch — network first, cache as fallback
self.addEventListener('fetch', function(e) {
  // Never cache API calls
  if (e.request.url.includes('/api/') ||
      e.request.url.includes('onrender.com') ||
      e.request.url.includes('supabase.co')) {
    return;
  }

  e.respondWith(
    fetch(e.request)
      .then(function(response) {
        if (response && response.status === 200 && e.request.method === 'GET') {
          var clone = response.clone();
          caches.open(CACHE).then(function(cache) { cache.put(e.request, clone); });
        }
        return response;
      })
      .catch(function() {
        return caches.match(e.request).then(function(cached) {
          return cached || caches.match('/index.html');
        });
      })
  );
});

// Push notifications support
self.addEventListener('push', function(e) {
  var data = e.data ? e.data.json() : {};
  e.waitUntil(
    self.registration.showNotification(data.title || 'Luhv+', {
      body: data.body || 'Your coach is waiting.',
      icon: '/icon-192.png',
      badge: '/icon-192.png'
    })
  );
});
