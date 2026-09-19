import { SOCIAL_PLATFORMS } from "@/lib/social-personas/types";
import { aiReady } from "@/lib/social-personas/server/ai";
import { config, isConfigured } from "@/lib/social-personas/server/connectors";

export const runtime = "nodejs";

// GET — which platforms can be connected by login, and whether AI is on.
export async function GET() {
  return Response.json({
    ai: aiReady(),
    platforms: Object.fromEntries(
      SOCIAL_PLATFORMS.map((p) => {
        const c = config(p);
        return [p, { configured: isConfigured(p), env: c.envNames, setupUrl: c.setupUrl }];
      }),
    ),
  });
}
