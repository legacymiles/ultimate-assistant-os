import { NextResponse } from "next/server";
import { runAgent } from "@/lib/jarvis/server/agent";
import { connector } from "@/lib/jarvis/server/connectors";

// Reads the master folder from disk and the memory database per request.
export const runtime = "nodejs";
export const maxDuration = 120;

interface Body {
  messages?: { role?: string; content?: string }[];
  ownerName?: string;
  timezone?: string;
  extraContext?: string;
  profileId?: string;
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const messages = (body.messages ?? [])
    .filter((m) => typeof m.content === "string" && m.content.trim())
    .map((m) => ({
      role: m.role === "assistant" ? ("assistant" as const) : ("user" as const),
      content: String(m.content).slice(0, 12000),
    }))
    .slice(-24);

  if (!messages.length) return NextResponse.json({ error: "Nothing to answer." }, { status: 400 });

  // The apps the owner has connected become tools Jarvis can use. Reads run
  // inside the loop; writes stop it and come back as a pending action.
  const c = connector();
  let connectorTools: Awaited<ReturnType<typeof c.listTools>> = [];
  if (c.available) {
    try {
      const apps = (await c.listApps()).filter((a) => a.connected).map((a) => a.slug);
      if (apps.length) connectorTools = await c.listTools(apps);
    } catch {
      // A connector that cannot be reached simply gives Jarvis fewer tools; he
      // says what he cannot do rather than failing the whole answer.
    }
  }

  try {
    const result = await runAgent({
      connectorTools,
      runTool: (name, args) => c.call(name, args),
      messages,
      ownerName: (body.ownerName || "the owner").slice(0, 60),
      timezone: body.timezone,
      extraContext: body.extraContext?.slice(0, 10000),
      profileId: body.profileId,
    });
    return NextResponse.json(result);
  } catch (e) {
    // A failure here must read as a failure, never as an answer.
    return NextResponse.json(
      { error: `I couldn't reach the model (${e instanceof Error ? e.message : "unknown error"}).` },
      { status: 502 },
    );
  }
}
