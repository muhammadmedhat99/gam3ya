/*
 * جمعيتي service worker.
 *
 * Deliberately minimal (AGENTS.md §7):
 *  - caches ONLY the static /offline page;
 *  - page navigations go to the network, and fall back to /offline when it fails;
 *  - nothing else is intercepted: no data, API or Server Action responses are
 *    cached, and no request is queued for later, so there are no offline
 *    financial mutations and no private data stored on the device.
 */

const CACHE = "gam3ya-offline-v1";
const OFFLINE_URL = "/offline";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.add(new Request(OFFLINE_URL, { cache: "reload" })))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;
  event.respondWith(
    fetch(event.request).catch(async () => {
      const cached = await caches.match(OFFLINE_URL);
      return cached ?? new Response("مفيش اتصال بالنت", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
    }),
  );
});
