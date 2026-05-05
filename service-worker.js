// Self-unregistering service worker.
// Replaces the old caching SW from the simulator era. When the browser
// fetches this file (the old SW polls for updates), this kill-switch
// activates: clears all caches, unregisters itself, and claims clients
// so they reload free of the stale cache.
self.addEventListener('install', e => { self.skipWaiting(); });
self.addEventListener('activate', async (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => caches.delete(k)));
    await self.registration.unregister();
    const clients = await self.clients.matchAll({ type: 'window' });
    clients.forEach(c => c.navigate(c.url));
  })());
});
self.addEventListener('fetch', e => { /* pass through, no caching */ });
