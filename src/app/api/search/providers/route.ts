// GET  /api/search/providers — provider status, free, from what the last real
//                              searches learned.
// POST /api/search/providers — probe them for real. One live search per
//                              SearXNG instance, and one Tavily credit if
//                              `includeTavily` is true. The dashboard's
//                              "Check now".
//
// This is also the endpoint an external monitor can poll: it says which
// instance is serving, which is tripped, and what the reason was, in the same
// words the dashboard shows.
import { NextResponse } from "next/server";
import { resolveCaller } from "@/lib/search/auth";
import { ENV_GUIDE, anyProviderConfigured, chainFor } from "@/lib/search/config";
import { providerStatuses } from "@/lib/search/health";
import { errorResponse } from "@/lib/search/route";
import { storageMode } from "@/lib/search/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function report(probe: boolean, probeTavily: boolean) {
  const providers = await providerStatuses({ probe, probeTavily });
  const chain = chainFor("web");
  const storage = storageMode();
  return {
    probed: probe,
    configured: anyProviderConfigured(),
    /** The order a search would actually try, as labels. */
    chain: chain.map((endpoint) => ({
      provider: endpoint.provider,
      endpoint: endpoint.url,
      location: endpoint.location,
      label: endpoint.label,
    })),
    providers,
    storage,
    /** Which env vars are missing, and what setting each one buys. */
    env: ENV_GUIDE.map((entry) => {
      const present = Boolean((process.env[entry.name] ?? "").trim());
      // The service-role key on its own does nothing: shared storage needs
      // NEXT_PUBLIC_SUPABASE_URL as well. Reporting it as "set" while the same
      // page says storage is in-memory only is a contradiction the owner would
      // have to debug, so this row reports whether the storage actually works.
      if (entry.name === "SUPABASE_SERVICE_ROLE_KEY") {
        return {
          ...entry,
          set: storage.shared,
          unlocks:
            present && !storage.shared
              ? `${entry.unlocks} It is set here, but NEXT_PUBLIC_SUPABASE_URL isn't — shared storage needs both.`
              : entry.unlocks,
        };
      }
      return { ...entry, set: present };
    }),
    checkedAt: new Date().toISOString(),
  };
}

export async function GET(request: Request) {
  try {
    await resolveCaller(request);
    return NextResponse.json(await report(false, false), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    await resolveCaller(request);
    // Tavily's probe costs a credit, so it is opt-in even here.
    let probeTavily = false;
    try {
      const body = (await request.json()) as { probeTavily?: boolean; includeTavily?: boolean };
      probeTavily = body?.probeTavily === true || body?.includeTavily === true;
    } catch {
      /* No body is fine — probe the free ones. */
    }
    return NextResponse.json(await report(true, probeTavily), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
