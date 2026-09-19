import { NextResponse } from "next/server";
import { runAgent } from "@/lib/jarvis/server/agent";

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

  try {
    const result = await runAgent({
      messages,
      ownerName: (body.ownerName || "the owner").slice(0, 60),
      timezone: body.timezone,
      extraContext: body.extraContext?.slice(0, 6000),
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
