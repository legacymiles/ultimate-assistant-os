// Baby No Scroll — the service worker that makes "Install" mean install.
//
// Without a service worker that answers page loads, some versions of Chrome on
// Android turn "Add to Home screen" into a plain bookmark: the icon opens a
// normal tab, with the address bar and "swipe down to exit full screen" — the
// exact thing installing was for. With one, Chrome builds a real app (a WebAPK)
// that opens as the whole screen, as the manifest's display: "fullscreen" asks.
//
// Registered with scope /apps/baby-no-scroll only, so it never touches the rest
// of the hub. It caches nothing: page loads go to the network as they always
// did, and only when the network is gone does it answer, with a short page
// saying so, rather than Chrome's dinosaur.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

const OFFLINE = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Baby No Scroll</title>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#fad541;color:#1a1206;font:16px/1.5 system-ui,sans-serif;text-align:center;padding:24px">
<div><strong>No connection.</strong><br>Baby No Scroll needs the internet to open. Try again when you are back online.</div>`;

self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;
  event.respondWith(
    fetch(event.request).catch(
      () => new Response(OFFLINE, { headers: { "Content-Type": "text/html; charset=utf-8" } }),
    ),
  );
});
