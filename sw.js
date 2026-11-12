// Service worker: makes the app work offline after the first visit.
// - Same-origin files (app, data, model, ONNX runtime): cache first.
//   data/*.json|bin are refreshed in the background when online.
// - The page itself: network first, cache as fallback (so updates arrive).
// - Card images from the public image servers: cached when first shown, so
//   pages already seen keep their images offline. They are the only external
//   requests the app makes, and they are optional.
const APP = "bd-app-v2";
const IMAGES = "bd-card-images-v1";
const IMAGE_HOSTS = ["images.scrydex.com", "images.pokemontcg.io", "assets.tcgdex.net"];
const MAX_IMAGES = 600;

const CORE = [
  "./",
  "./data/cards.json",
  "./data/meta.json",
  "./data/embeddings.bin",
  "./data/pca.bin",
  "./data/world.bin",
  "./models/Xenova/clip-vit-base-patch32/config.json",
  "./models/Xenova/clip-vit-base-patch32/preprocessor_config.json",
  "./models/Xenova/clip-vit-base-patch32/onnx/vision_model_quantized.onnx",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(APP).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (![APP, IMAGES].includes(k)) await caches.delete(k);
    await self.clients.claim();
  })());
});

// The page sends the hashed asset URLs it loaded (JS, CSS, worker, wasm) so they are cached too.
self.addEventListener("message", (e) => {
  if (e.data?.type !== "cache-urls") return;
  e.waitUntil((async () => {
    const c = await caches.open(APP);
    let ok = 0;
    for (const u of e.data.urls) {
      try {
        if (!(await c.match(u))) await c.add(u);
        ok++;
      } catch { /* ignore one failure */ }
    }
    e.source?.postMessage({ type: "cached", ok, total: e.data.urls.length });
  })());
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  if (IMAGE_HOSTS.includes(url.host)) {
    e.respondWith(cacheFirst(IMAGES, req, true));
    return;
  }
  if (url.origin !== self.location.origin) return;

  if (req.mode === "navigate") {
    e.respondWith(fetch(req).then((r) => { const copy = r.clone(); caches.open(APP).then((c) => c.put("./", copy)); return r; })
      .catch(() => caches.match("./")));
    return;
  }
  if (url.pathname.includes("/data/")) {
    e.respondWith(staleWhileRevalidate(req));
    return;
  }
  e.respondWith(cacheFirst(APP, req, false));
});

async function cacheFirst(name, req, trim) {
  const c = await caches.open(name);
  const hit = await c.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok || res.type === "opaque") {
    c.put(req, res.clone());
    if (trim) trimCache(c);
  }
  return res;
}

async function staleWhileRevalidate(req) {
  const c = await caches.open(APP);
  const hit = await c.match(req, { ignoreSearch: true });
  const net = fetch(req).then((r) => { if (r.ok) c.put(req, r.clone()); return r; }).catch(() => hit);
  return hit || net;
}

async function trimCache(c) {
  const keys = await c.keys();
  for (let i = 0; i < keys.length - MAX_IMAGES; i++) await c.delete(keys[i]);
}
