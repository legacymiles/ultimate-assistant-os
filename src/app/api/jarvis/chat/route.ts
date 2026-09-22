import { NextResponse } from "next/server";
import { runAgent } from "@/lib/jarvis/server/agent";
import { connector } from "@/lib/jarvis/server/connectors";
import { resolveMention, workflowBrief, type Mention } from "@/lib/studio/workflows";

// Reads the master folder from disk and the memory database per request.
export const runtime = "nodejs";
export const maxDuration = 120;

interface Body {
  messages?: { role?: string; content?: string; images?: unknown }[];
  ownerName?: string;
  timezone?: string;
  extraContext?: string;
  profileId?: string;
  skills?: unknown;
  /** Studio workflow tokens ("kids-story", "e-commerce:flat-lay"); briefs come from the catalog, never the client. */
  workflows?: unknown;
}

/** The owner's installed skills as one prompt block, name + what it is for. */
function skillsBlock(v: unknown): string {
  if (!Array.isArray(v) || !v.length) return "";
  const lines = v
    .slice(0, 400)
    .map((s) => {
      const o = (s ?? {}) as { name?: unknown; about?: unknown; from?: unknown };
      const name = typeof o.name === "string" ? o.name.slice(0, 80) : "";
      if (!name) return "";
      const about = typeof o.about === "string" ? o.about.slice(0, 160) : "";
      const from = typeof o.from === "string" && o.from ? ` [${o.from.slice(0, 30)}]` : "";
      return `- ${name}${from}${about ? `: ${about}` : ""}`;
    })
    .filter(Boolean);
  if (!lines.length) return "";
  return `THE OWNER'S CLAUDE CODE SKILLS (${lines.length}, from their Skills tab):\n${lines.join("\n")}`.slice(0, 40000);
}

/** Pictures sent to the model per request, across the whole conversation. */
const MAX_IMAGES = 6;
const IMAGE_URL = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/;

function cleanImages(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  // ~1.5 MB of base64 each; the client downsizes far below that.
  return v.filter((u): u is string => typeof u === "string" && u.length < 2_000_000 && IMAGE_URL.test(u));
}

function studioBlock(v: unknown): string {
  if (!Array.isArray(v)) return "";
  const picked = v
    .slice(0, 6)
    .map((t) => (typeof t === "string" ? resolveMention(t) : undefined))
    .filter((m): m is Mention => Boolean(m));
  return workflowBrief(picked);
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
      extraContext: [body.extraContext?.slice(0, 10000), studioBlock(body.workflows), skillsBlock(body.skills)].filter(Boolean).join("\n\n"),
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
