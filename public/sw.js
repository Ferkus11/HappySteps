/*
 * Happy Steps service worker — hand-written, no build step.
 *
 * - /_next/static/* and /icons/*: cache-first (file names are content-hashed, the cache is versioned).
 * - Page navigations: network-first; a successful HTML page is kept so it can be shown again without network
 *   («последние просмотренные данные»); with no network and no saved copy — the precached /offline page.
 * - Everything else (server actions / POST, RSC fetches, /api, Supabase and any other origin) is never touched.
 * - Saved pages are personal: the app deletes the `hs-pages-*` caches on logout and on the login screen.
 *
 * Bump VERSION when the caching rules below change; a new worker waits until the user taps «Обновить».
 */
importScripts("/sw-push.js");

const VERSION = "v1";

/* Pure rules — also loaded by tests/unit/pwa.test.ts. */
const rules = (() => {
  const STATIC_CACHE = `hs-static-${VERSION}`;
  const SHELL_CACHE = `hs-shell-${VERSION}`;
  const PAGES_CACHE = `hs-pages-${VERSION}`;
  const USER_CACHE_PREFIX = "hs-pages-";
  const OFFLINE_URL = "/offline";
  const STATIC_LIMIT = 400;
  const PAGES_LIMIT = 60;
  /** Never stored as a «last viewed» page: auth flows, gates, public forms, API, framework internals. */
  const NO_CACHE_PREFIXES = ["/api", "/login", "/invite", "/auth", "/offline", "/consent", "/blocked", "/no-access", "/apply", "/_next", "/styleguide"];

  const underPrefix = (pathname, p) => pathname === p || pathname.startsWith(p + "/");

  function isStaticAsset(url, origin) {
    return url.origin === origin && (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/"));
  }

  function isCacheablePage(url, origin) {
    if (url.origin !== origin) return false;
    if (NO_CACHE_PREFIXES.some((p) => underPrefix(url.pathname, p))) return false;
    if (/\/export$/.test(url.pathname)) return false; // file downloads
    return true;
  }

  /** One entry per page: no hash, no RSC cache-busting param, stable parameter order. */
  function pageCacheKey(href) {
    const u = new URL(href);
    u.hash = "";
    u.searchParams.delete("_rsc");
    u.searchParams.sort();
    return u.origin + u.pathname + u.search;
  }

  /** Only a real HTML page that the server rendered for this URL (no redirects, no errors). */
  function isCacheablePageResponse(res) {
    if (!res || res.status !== 200 || res.redirected || res.type !== "basic") return false;
    return (res.headers.get("content-type") || "").includes("text/html");
  }

  /** Static files referenced by an HTML page (to precache what the offline page needs). */
  function extractStaticAssets(html) {
    const found = new Set();
    for (const m of html.matchAll(/\/_next\/static\/[^"'\s)\\<>]+/g)) found.add(m[0]);
    return [...found];
  }

  function isOwnCache(name) {
    return name.startsWith("hs-");
  }

  return {
    VERSION,
    STATIC_CACHE,
    SHELL_CACHE,
    PAGES_CACHE,
    USER_CACHE_PREFIX,
    OFFLINE_URL,
    STATIC_LIMIT,
    PAGES_LIMIT,
    isStaticAsset,
    isCacheablePage,
    pageCacheKey,
    isCacheablePageResponse,
    extractStaticAssets,
    isOwnCache,
  };
})();
self.hsSwRules = rules;

const OFFLINE_FALLBACK_HTML =
  '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<title>Happy Steps</title><body style="font-family:system-ui;padding:32px;text-align:center">' +
  "<h1>Нет подключения</h1><p>Байланыс жоқ</p><button onclick=\"location.reload()\" style=\"min-height:44px\">↻</button>";

async function trim(cacheName, max) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const shell = await caches.open(rules.SHELL_CACHE);
      const res = await fetch(rules.OFFLINE_URL, { cache: "reload", credentials: "same-origin" });
      if (!res.ok) throw new Error("offline page unavailable");
      const html = await res.clone().text();
      await shell.put(rules.OFFLINE_URL, res);
      const assets = rules.extractStaticAssets(html).concat(["/icons/icon-192.png"]);
      const stat = await caches.open(rules.STATIC_CACHE);
      await Promise.all(assets.map((a) => stat.add(a).catch(() => undefined)));
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([rules.STATIC_CACHE, rules.SHELL_CACHE, rules.PAGES_CACHE]);
      const names = await caches.keys();
      await Promise.all(names.filter((n) => rules.isOwnCache(n) && !keep.has(n)).map((n) => caches.delete(n)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  const type = event.data && event.data.type;
  if (type === "SKIP_WAITING") self.skipWaiting();
  if (type === "CLEAR_USER_CACHES") {
    event.waitUntil(
      caches.keys().then((names) => Promise.all(names.filter((n) => n.startsWith(rules.USER_CACHE_PREFIX)).map((n) => caches.delete(n)))),
    );
  }
});

async function cacheFirst(event) {
  const cache = await caches.open(rules.STATIC_CACHE);
  const hit = await cache.match(event.request);
  if (hit) return hit;
  const res = await fetch(event.request);
  if (res.ok && res.type === "basic") {
    const copy = res.clone();
    event.waitUntil(cache.put(event.request, copy).then(() => trim(rules.STATIC_CACHE, rules.STATIC_LIMIT)));
  }
  return res;
}

async function offlinePage() {
  const shell = await caches.open(rules.SHELL_CACHE);
  const hit = await shell.match(rules.OFFLINE_URL);
  if (hit) return hit;
  return new Response(OFFLINE_FALLBACK_HTML, { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

async function networkFirstPage(event, url) {
  const cacheable = rules.isCacheablePage(url, self.location.origin);
  const key = rules.pageCacheKey(url.href);
  try {
    const res = await fetch(event.request);
    if (cacheable && rules.isCacheablePageResponse(res)) {
      const copy = res.clone();
      event.waitUntil(
        caches
          .open(rules.PAGES_CACHE)
          .then((c) => c.put(key, copy))
          .then(() => trim(rules.PAGES_CACHE, rules.PAGES_LIMIT)),
      );
    }
    return res;
  } catch (err) {
    if (cacheable) {
      const pages = await caches.open(rules.PAGES_CACHE);
      const hit = await pages.match(key);
      if (hit) return hit;
    }
    return offlinePage();
  }
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return; // server actions and other mutations go straight to the network
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Supabase, storage, anything else: untouched
  if (req.mode === "navigate") {
    event.respondWith(networkFirstPage(event, url));
    return;
  }
  if (rules.isStaticAsset(url, self.location.origin)) event.respondWith(cacheFirst(event));
});
