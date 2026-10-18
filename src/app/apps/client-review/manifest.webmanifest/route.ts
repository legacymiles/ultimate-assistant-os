// The Home Screen manifest for Client Review: it opens straight into the
// client's websites, standalone, so iOS will deliver their push notifications.

export function GET() {
  return Response.json(
    {
      name: "Jarvis — Client Review",
      short_name: "Client Review",
      start_url: "/apps/client-review",
      scope: "/apps/client-review",
      display: "standalone",
      background_color: "#07080c",
      theme_color: "#07080c",
      icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
    },
    { headers: { "Content-Type": "application/manifest+json" } },
  );
}
