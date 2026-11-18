/* Full Speed service worker: offline fallback, static asset cache, Web Push. */
const VERSION = "fs-v1";
const STATIC = `static-${VERSION}`;
const PRECACHE = ["/offline.html", "/icons/icon-192.png", "/icons/badge-96.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(STATIC).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== STATIC).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Hashed build assets never change: cache-first.
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) caches.open(STATIC).then((c) => c.put(req, res.clone()));
            return res;
          }),
      ),
    );
    return;
  }

  // Pages always come from the network (data is live); offline → friendly page.
  if (req.mode === "navigate") {
    event.respondWith(fetch(req).catch(() => caches.match("/offline.html")));
  }
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: event.data ? event.data.text() : "Full Speed" };
  }
  event.waitUntil(
    (async () => {
      // The open, focused app already shows its own toast and plays the sound.
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      if (windows.some((w) => w.focused && w.visibilityState === "visible")) return;
      const big = data.type === "bonus" || data.type === "rate";
      await self.registration.showNotification(data.title || "Full Speed", {
        body: data.body || "",
        icon: "/icons/icon-192.png",
        badge: "/icons/badge-96.png",
        tag: data.tag,
        lang: data.lang,
        dir: data.dir || "auto",
        data: { url: data.url || "/" },
        vibrate: big ? [220, 90, 220, 90, 400] : [120, 60, 120],
        requireInteraction: big,
      });
      if (self.navigator.setAppBadge) self.navigator.setAppBadge().catch(() => {});
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/", self.location.origin).href;
  event.waitUntil(
    (async () => {
      if (self.navigator.clearAppBadge) self.navigator.clearAppBadge().catch(() => {});
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const same = windows.find((w) => new URL(w.url).origin === self.location.origin);
      if (same) {
        await same.focus();
        return same.navigate(target);
      }
      return self.clients.openWindow(target);
    })(),
  );
});
