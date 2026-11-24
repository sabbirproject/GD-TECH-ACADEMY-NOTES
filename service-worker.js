/* GD TECH ACADEMY – AI Notes Generator service worker.
 * - Precaches the app shell so the homepage and static pages load offline.
 * - HTML pages: network first, cache fallback, then offline.html.
 * - Static assets (css/js/icons): stale-while-revalidate.
 * - API calls to Apps Script (other origin) are NEVER cached or intercepted, so the app can never
 *   pretend that AI generation or cloud saving works offline.
 * Bump VERSION on every release: users then get an "update available" prompt. */
var VERSION = 'v1.0.0';
var CACHE = 'gd-notes-' + VERSION;
var SHELL = [
  'index.html', 'notes.html', 'reader.html', 'dashboard.html', 'admin.html', 'about.html', 'contact.html', 'legal.html', 'offline.html',
  'css/style.css', 'js/config.js', 'js/api.js', 'js/ui.js', 'js/markdown.js', 'js/notes.js', 'js/reader.js', 'js/dashboard.js', 'js/admin.js',
  'icons/logo.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'manifest.json'
];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) {
    return Promise.all(SHELL.map(function (u) { return c.add(new Request(u, { cache: 'reload' })).catch(function () { /* skip missing */ }); }));
  }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k.indexOf('gd-notes-') === 0 && k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('message', function (e) { if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting(); });

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;          // never touch the API or other sites

  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then(function (res) {
      var copy = res.clone();
      if (res.ok) caches.open(CACHE).then(function (c) { c.put(req, copy); });
      return res;
    }).catch(function () {
      return caches.match(req, { ignoreSearch: true }).then(function (m) { return m || caches.match('offline.html'); });
    }));
    return;
  }

  e.respondWith(caches.match(req).then(function (cached) {
    var net = fetch(req).then(function (res) {
      if (res && res.ok) { var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(req, copy); }); }
      return res;
    }).catch(function () { return cached; });
    return cached || net;
  }));
});
