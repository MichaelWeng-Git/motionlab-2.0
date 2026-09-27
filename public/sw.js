const CACHE = "motionlab-shell-v2";
const OFFLINE = "/offline.html";

// The model weights get their OWN cache, and it is the only thing standing
// between an athlete and a 2.2 GB download on every single analysis.
//
// Whoever hosts the weights decides the cache headers, and Hugging Face's do
// not allow browser caching at all: the resolve URL answers `no-store` and
// redirects to a freshly signed CDN address that carries no cache-control and
// is different every time. Measured, not assumed. So the browser would refetch
// gigabytes per analysis rather than per install.
//
// Cache Storage does not care what the upstream headers say. The key is the
// stable resolve URL, not the signed one, so the rotating address is invisible
// here. HF sends access-control-allow-origin: *, so the response is a real
// CORS response — readable and storable, not opaque.
//
// The version lives in the URL path (/models/v1/), so publishing a v2 misses
// this cache naturally and the old entries are swept below.
const MODEL_CACHE = "motionlab-models-v1";
const MODEL_RE = /\/models\/v\d+\/[A-Za-z0-9_.-]+\.(?:onnx|task)$/;
const KEEP = new Set([CACHE, MODEL_CACHE]);

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.add(OFFLINE)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => !KEEP.has(key)).map((key) => caches.delete(key)))));
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  // Weights first, and deliberately BEFORE the same-origin guard: they are
  // cross-origin by design, which is exactly why the old handler skipped them.
  if (MODEL_RE.test(url.pathname)) {
    event.respondWith((async () => {
      try {
        const cache = await caches.open(MODEL_CACHE);
        const hit = await cache.match(url.href);
        if (hit) return hit;
        const response = await fetch(request);
        // A failed put is not a failed load — a gigabyte can exceed the origin's
        // quota, and the athlete should still get their analysis.
        if (response.ok) { try { await cache.put(url.href, response.clone()); } catch { /* quota */ } }
        return response;
      } catch {
        return fetch(request);
      }
    })());
    return;
  }

  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match(OFFLINE)));
    return;
  }
  if (url.pathname.startsWith("/_next/static/") || /\.(?:png|jpg|jpeg|svg|webp|woff2)$/.test(url.pathname)) {
    event.respondWith(caches.match(request).then((hit) => hit || fetch(request).then((response) => {
      if (response.ok) caches.open(CACHE).then((cache) => cache.put(request, response.clone()));
      return response;
    })));
  }
});
