// The home-screen manifest for Baby No Scroll.
//
// `display: "fullscreen"` is the point of it. In a browser tab, fullscreen is
// the browser's — Chrome on Android announces "swipe down to exit" and one swipe
// from the top ends it. Installed with this manifest, the app IS the whole
// screen: no address bar, no tabs, no exit message, nothing of the browser left
// to leave. iOS ignores "fullscreen" and falls back to standalone, which on an
// iPhone is still the only way to get Safari's bars off the screen.
//
// Public on purpose (src/lib/hubAccess.ts): Chrome fetches a manifest without
// the login cookie, and a manifest that redirects to /login is no manifest.
// It holds nothing but a name, two colours and an icon.

export function GET() {
  return Response.json(
    {
      id: "/apps/baby-no-scroll",
      name: "Baby No Scroll",
      short_name: "No Scroll",
      description: "Hand over the screen, not the device.",
      start_url: "/apps/baby-no-scroll",
      scope: "/apps/baby-no-scroll",
      display: "fullscreen",
      display_override: ["fullscreen", "standalone"],
      orientation: "any",
      background_color: "#000000",
      theme_color: "#000000",
      icons: [
        { src: "/baby-no-scroll/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
        { src: "/baby-no-scroll/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
        { src: "/baby-no-scroll/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        { src: "/baby-no-scroll/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      ],
    },
    { headers: { "Content-Type": "application/manifest+json" } },
  );
}
