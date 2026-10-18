/* JigSwap service worker — Web Push receiver.
 *
 * Served at /sw.js (scope "/") so it controls the whole origin. It does NOT cache or intercept
 * fetches; its only job is to show notifications pushed by the backend (notifications/sendWebPush)
 * and route a click to the right in-app page. The push payload is the JSON produced by
 * toWebPushPayload: { title, body, type, url, relatedId, tag }.
 */

self.addEventListener("install", () => {
  // Activate immediately on first install so the very first subscribe can receive pushes.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  // Take control of open tabs without requiring a reload.
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (_e) {
    data = {};
  }
  const title = data.title || "JigSwap";
  const options = {
    body: data.body || "",
    // Coalesce repeats (one per message thread, else one per type) instead of stacking. Payloads
    // sent before `tag` existed fall back to the type.
    tag: data.tag || data.type || undefined,
    renotify: Boolean(data.tag || data.type),
    data: { url: data.url || "/notifications" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url =
    (event.notification.data && event.notification.data.url) ||
    "/notifications";
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      // Focus an already-open tab (navigating it to the target), else open a new one.
      for (const client of all) {
        if ("focus" in client) {
          await client.focus();
          if ("navigate" in client) {
            try {
              await client.navigate(url);
            } catch (_e) {
              /* cross-origin or detached; ignore */
            }
          }
          return;
        }
      }
      if (self.clients.openWindow) await self.clients.openWindow(url);
    })(),
  );
});
