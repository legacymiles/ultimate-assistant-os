import { CONNECTABLE } from "@/lib/social-personas/types";
import { aiReady } from "@/lib/social-personas/server/ai";
import { config, isConfigured } from "@/lib/social-personas/server/connectors";
import { isRemoteConfigured } from "@/lib/server/blobStore";

export const runtime = "nodejs";

// GET — which platforms can be connected by login, and whether AI is on.
export async function GET() {
  return Response.json({
    ai: aiReady(),
    // Whether uploaded videos are kept somewhere the platforms can fetch them.
    storage: isRemoteConfigured(),
    platforms: Object.fromEntries(
      CONNECTABLE.map((p) => {
        const c = config(p);
        return [p, { configured: isConfigured(p), env: c.envNames, setupUrl: c.setupUrl, postSetup: c.postSetup }];
      }),
    ),
  });
}
