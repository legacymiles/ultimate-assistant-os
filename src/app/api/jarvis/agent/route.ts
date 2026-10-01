import { NextResponse } from "next/server";
import { runAgent } from "@/lib/jarvis/server/agent";
import { connector } from "@/lib/jarvis/server/connectors";

// ---------------------------------------------------------------------------
// The Chat tab's agent.
//
// Deliberately NOT the Studio route next door. That one carries a film's worth
// of context — workflows, the camera deck, the cast, a measured track — because
// it is planning a shot. This one carries a question and, sometimes, a picture.
// Everything a general agent needs is already in the loop: memory, the owner's
// folders and lists, and whatever apps they have connected.
//
// No model is pinned here any more. It used to name DeepSeek outright, on the
// reasoning that this surface WAS the DeepSeek agent rather than "a chat that
// happens to use a model" — and the cost of that was a tab that could never
// reach the free rung, on the owner's own instruction that free should answer
// anything it can. The router decides now (src/lib/ai/router.ts), which for an
// ordinary question means the free model, and escalates on what the request
// actually carries.
//
// Safe to free precisely because this is the acting agent: a weaker model that
// picks the wrong tool does not act on it. Writes stop the loop and come back as
// a pending action for the owner to confirm (src/lib/jarvis/tools.ts is
// deliberately pessimistic), so the failure mode is a confirm card that looks
// wrong, not something that left without permission.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
// Tool rounds are sequential; ten of them against a slow connector adds up.
export const maxDuration = 120;

interface Body {
  messages?: { role?: string; content?: string; images?: unknown }[];
  ownerName?: string;
  timezone?: string;
  extraContext?: string;
  profileId?: string;
}

/** Pictures sent to the model per request, across the whole conversation. */
const MAX_IMAGES = 6;
const IMAGE_URL = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/;

function cleanImages(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  // ~1.5 MB of base64 each; the client downsizes far below that.
  return v.filter((u): u is string => typeof u === "string" && u.length < 2_000_000 && IMAGE_URL.test(u));
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const messages = (body.messages ?? [])
    .map((m) => ({
      role: m.role === "assistant" ? ("assistant" as const) : ("user" as const),
      content: typeof m.content === "string" ? m.content.slice(0, 12000) : "",
      images: m.role === "assistant" ? [] : cleanImages(m.images),
    }))
    .filter((m) => m.content.trim() || m.images.length)
    .slice(-24);

  // Newest pictures win when a long conversation carries more than the cap.
  let budget = MAX_IMAGES;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const keep = messages[i].images.slice(0, Math.max(0, budget));
    budget -= keep.length;
    messages[i].images = keep;
  }

  if (!messages.length) return NextResponse.json({ error: "Nothing to answer." }, { status: 400 });

  // The apps the owner has connected become tools the agent can use. Reads run
  // inside the loop; writes stop it and come back as a pending action.
  const c = connector();
  let connectorTools: Awaited<ReturnType<typeof c.listTools>> = [];
  if (c.available) {
    try {
      const apps = (await c.listApps()).filter((a) => a.connected).map((a) => a.slug);
      if (apps.length) connectorTools = await c.listTools(apps);
    } catch {
      // A connector that cannot be reached simply gives the agent fewer tools;
      // it says what it cannot do rather than failing the whole answer.
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
      agent: true,
      task: { app: "Jarvis chat" },
    });
    // The answering model is deliberately not reported back: it varies per
    // request now, nothing on this tab reads it, and Toolbox › Router already
    // lists every call with the model that took it and what it cost.
    return NextResponse.json(result);
  } catch (e) {
    // A failure here must read as a failure, never as an answer.
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "I couldn't reach the model, and it gave no reason." },
      { status: 502 },
    );
  }
}
