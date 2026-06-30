 const CACHE_NAME = 'stock-analysis-v1';
 const ASSETS = [
   '/',
   '/style.css',
   '/script.js',
   '/icon.svg',
   '/icon-192.png',
   '/icon-512.png',
   '/manifest.json'
 ];
 
 // Install: cache app shell
 self.addEventListener('install', (event) => {
   event.waitUntil(
     caches.open(CACHE_NAME).then((cache) => {
       return cache.addAll(ASSETS);
     })
   );
   self.skipWaiting();
 });
 
 // Activate: clean old caches
 self.addEventListener('activate', (event) => {
   event.waitUntil(
     caches.keys().then((names) => {
       return Promise.all(
         names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))
       );
     })
   );
   self.clients.claim();
 });
 
 // Fetch: network-first for API, cache-first for static
 self.addEventListener('fetch', (event) => {
   const url = new URL(event.request.url);
 
   // API requests: network only (no cache for dynamic data)
   if (url.pathname.startsWith('/api/')) {
     event.respondWith(fetch(event.request).catch(() => {
       return new Response(JSON.stringify({ error: '离线' }), {
         headers: { 'Content-Type': 'application/json' }
       });
     }));
     return;
   }
 
   // Static assets: cache-first
   event.respondWith(
     caches.match(event.request).then((cached) => {
       return cached || fetch(event.request).then((response) => {
         return caches.open(CACHE_NAME).then((cache) => {
           cache.put(event.request, response.clone());
           return response;
         });
       });
     })
   );
 });
