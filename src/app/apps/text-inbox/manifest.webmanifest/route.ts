// The Home Screen manifest for Text Inbox: it opens straight into the inbox,
// standalone, so iOS will deliver its push notifications ("Reply ready — tap
// to send"). Safari only delivers web push to an app added to the Home Screen.

export function GET() {
  return Response.json(
    {
      name: "Jarvis — Text Inbox",
      short_name: "Texts",
      start_url: "/apps/text-inbox",
      scope: "/apps/text-inbox",
      display: "standalone",
      background_color: "#05060a",
      theme_color: "#05060a",
      icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
    },
    { headers: { "Content-Type": "application/manifest+json" } },
  );
}
