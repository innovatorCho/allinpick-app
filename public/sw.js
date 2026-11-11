// Service worker for browser push alerts (lib/webPush.ts sends them,
// components/PushSubscribeButton.tsx registers this file). Only shows
// notifications and opens their link; nothing is cached.

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "", {
      body: data.body || "",
      icon: data.icon,
      badge: data.badge,
      image: data.image || undefined,
      tag: data.tag,
      // A replaced alert with the same tag still buzzes the phone again.
      renotify: Boolean(data.tag),
      data: { url: data.url || "/" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/", self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of windows) {
        if (new URL(client.url).origin === self.location.origin && "navigate" in client) {
          await client.focus();
          return client.navigate(url);
        }
      }
      return self.clients.openWindow(url);
    })()
  );
});
