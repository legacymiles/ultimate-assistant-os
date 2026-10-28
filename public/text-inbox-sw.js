// Text Inbox — push notifications for the user's iPhone.
//
// Registered with scope /apps/text-inbox only, so it never touches the rest of
// the hub. No fetch handler: it caches nothing; it only shows "Text from …" and
// "Reply ready — tap to send", and opens Text Inbox on tap. Opening it with
// ?send=1 makes the page hand the approved replies to the "Jarvis Send"
// Shortcut, which sends them with Messages.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "Jarvis", body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "Jarvis", {
      body: data.body || "Open Text Inbox.",
      tag: data.tag || "text-inbox",
      renotify: true,
      data: { url: data.url || "/apps/text-inbox" },
      icon: "/icon.svg",
      badge: "/icon.svg",
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || "/apps/text-inbox", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if (w.url.startsWith(self.location.origin + "/apps/text-inbox") && "focus" in w) {
          w.navigate(url);
          return w.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
