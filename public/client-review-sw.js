// Client Review — push notifications for a client's review link.
//
// Registered with scope /review/ only, so it never touches the rest of the
// hub. No fetch handler: it caches nothing and changes no page; it only shows
// the "your new version is ready" notification and opens the link on tap.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "Jarvis", body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "Jarvis";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "There's an update on your website.",
      tag: data.tag || "client-review",
      renotify: true,
      data: { url: data.url || "/" },
      icon: "/icon.svg",
      badge: "/icon.svg",
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if (w.url.split("#")[0] === url && "focus" in w) {
          w.navigate(url);
          return w.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
