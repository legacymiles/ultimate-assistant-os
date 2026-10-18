import { isToken } from "@/lib/client-review/logic";

// The Home Screen manifest for one review link: it opens straight back into
// that link, standalone, so iOS will deliver its push notifications.

export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  if (!isToken(token)) return new Response("Not found", { status: 404 });
  const start = `/review/${token}`;
  return Response.json(
    {
      name: "Jarvis — Website Review",
      short_name: "Jarvis Review",
      start_url: start,
      scope: "/review/",
      display: "standalone",
      background_color: "#07080c",
      theme_color: "#07080c",
      icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
    },
    { headers: { "Content-Type": "application/manifest+json", "Cache-Control": "no-store" } },
  );
}
