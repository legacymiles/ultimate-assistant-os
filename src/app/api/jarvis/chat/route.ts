import { NextResponse } from "next/server";
import { runAgent } from "@/lib/jarvis/server/agent";
import { connector } from "@/lib/jarvis/server/connectors";
import { resolveMention, studioContext, type Mention } from "@/lib/studio/workflows";
import { cinemaContext, cleanMoves, cleanOutput, cleanSelection, moveById } from "@/lib/studio/cinema";
import { characterContext, cleanCharacters } from "@/lib/studio/characters";
import { loadSkill, loadSkills } from "@/lib/studio/server/skills";
import { cleanTimeline, timelineBrief } from "@/lib/seedance/audio/timeline";
import { scoreRules } from "@/lib/seedance/score";

// Reads the master folder from disk and the memory database per request.
export const runtime = "nodejs";
// A Studio skill can write a long shot table in one answer.
export const maxDuration = 300;

interface Body {
  messages?: { role?: string; content?: string; images?: unknown }[];
  ownerName?: string;
  timezone?: string;
  extraContext?: string;
  profileId?: string;
  skills?: unknown;
  /** Studio workflow tokens ("kids-story", "e-commerce:flat-lay"); briefs come from the catalog, never the client. */
  workflows?: unknown;
  /** The camera deck: rail id -> option id, and the ordered camera-move ids. */
  cinema?: unknown;
  moves?: unknown;
  /** Aspect ratio and clip length, passed to studio_generate verbatim. */
  output?: unknown;
  /**
   * People from the owner's Photos tab that this message @-mentioned, with the
   * character sheet each one carries. Unlike a workflow, this cannot be looked
   * up here: the photo library lives in the browser, so the client sends it and
   * cleanCharacters() is the trust boundary.
   */
  characters?: unknown;
  /**
   * The measured timeline of a track the owner attached, when this is an
   * audio-driven job (Seedance Studio).
   *
   * Sent as structured measurements, not as prose, for the same reason the
   * workflows are sent as tokens: the client may not write the prompt. The
   * numbers are computed in the owner's browser from their own file — the audio
   * itself never leaves their machine — so they arrive here as a claim, are
   * clamped by cleanTimeline, and only then turned into a brief.
   */
  audio?: unknown;
  /** Which kind of piece the audio is being cut into. */
  audioMode?: unknown;
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

function mentioned(v: unknown): Mention[] {
  if (!Array.isArray(v)) return [];
  return v
    .slice(0, 6)
    .map((t) => (typeof t === "string" ? resolveMention(t) : undefined))
    .filter((m): m is Mention => Boolean(m));
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

  // Studio: the picked workflows' full skills, read from the catalog on disk.
  const studio = mentioned(body.workflows);
  const studioBlock = studio.length
    ? studioContext(studio, await loadSkills(studio.map((m) => m.workflow.id)))
    : "";

  // The planning doctrine under every workflow: what lands in which field of
  // the board, what the render gate will refuse, and how sound is decided. It
  // is not a workflow the owner picks — a film planned without it is a film
  // whose settings reached the grade and nothing else — so it loads whenever
  // Studio is running and leads the Studio block it governs.
  const filmPlan = studio.length ? await loadSkill("film-plan") : null;
  const planBlock = filmPlan ? `### HOW A FILM IS PLANNED HERE — read before the skills below\n\n${filmPlan}` : "";

  // The camera deck. Only ids cross the wire; the direction each one stands for
  // is read from the catalog here, so the client can never write the prompt.
  const shotBlock = cinemaContext(
    cleanSelection(body.cinema),
    cleanMoves(body.moves).map((id) => moveById(id)!),
    cleanOutput(body.output),
  );

  // Who the prompt is about, when the owner named someone from their library.
  const castBlock = characterContext(cleanCharacters(body.characters));

  // The track, when there is one. This block leads the context for an
  // audio-driven job: the clock outranks the craft, because every cut's time is
  // measured against it.
  const timeline = cleanTimeline(body.audio);
  const audioBlock = timeline ? [timelineBrief(timeline), scoreRules(timeline, body.audioMode)].join("\n\n") : "";

  try {
    const result = await runAgent({
      connectorTools,
      runTool: (name, args) => c.call(name, args),
      messages,
      ownerName: (body.ownerName || "the owner").slice(0, 60),
      timezone: body.timezone,
      // The audio comes first, then the cast, then the skills: the clock
      // outranks who is in the shot, which outranks how the shot is made, and
      // none of the three may be the block that gets truncated.
      extraContext: [
        audioBlock,
        body.extraContext?.slice(0, 10000),
        castBlock,
        planBlock,
        studioBlock,
        shotBlock,
        skillsBlock(body.skills),
      ]
        .filter(Boolean)
        .join("\n\n"),
      profileId: body.profileId,
      studio: studio.length > 0,
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
