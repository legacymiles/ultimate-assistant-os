import { NextResponse } from "next/server";
import { connector, KNOWN_APPS } from "@/lib/jarvis/server/connectors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Which apps are connected, and where to go to connect more. */
export async function GET() {
  const c = connector();
  if (!c.available) {
    return NextResponse.json({
      available: false,
      reason: c.reason,
      connectUrl: c.connectUrl(),
      apps: KNOWN_APPS.map((a) => ({ ...a, connected: false })),
    });
  }
  try {
    return NextResponse.json({
      available: true,
      reason: "",
      connectUrl: c.connectUrl(),
      apps: await c.listApps(),
    });
  } catch (e) {
    return NextResponse.json({
      available: false,
      reason: e instanceof Error ? e.message : "Couldn't reach Composio.",
      connectUrl: c.connectUrl(),
      apps: KNOWN_APPS.map((a) => ({ ...a, connected: false })),
    });
  }
}
