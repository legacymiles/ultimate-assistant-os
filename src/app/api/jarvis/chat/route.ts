import { after, NextResponse } from "next/server";
import { runAgent } from "@/lib/jarvis/server/agent";
import { connector } from "@/lib/jarvis/server/connectors";
import { resolveMention, studioContext, type Mention } from "@/lib/studio/workflows";
import { cinemaContext, cleanMoves, cleanOutput, cleanSelection, moveById } from "@/lib/studio/cinema";
import { characterContext, cleanCharacters } from "@/lib/studio/characters";
import { cleanStudioChain } from "@/lib/studio/models";
import { loadSkill, loadSkills } from "@/lib/studio/server/skills";
import { cleanTimeline, timelineBrief } from "@/lib/seedance/audio/timeline";
import { scoreRules } from "@/lib/seedance/score";
import { memoryContext } from "@/lib/jarvis/server/memory";
import { noteSkillUse } from "@/lib/skills/server/usageStore";
import { findingsBlock } from "@/lib/memory-rules/rules";
import { noteLog, readRules } from "@/lib/memory-rules/server/store";

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
  /**
   * The deck's model chain (Film setup > Models), in the owner's order.
   *
   * Cleaned against the known list here rather than trusted: this decides which
   * model a request is sent to, so an arbitrary string from the client would be
   * a way to spend the owner's credit on anything in the catalogue.
   */
  models?: unknown;
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
   * audio-driven job (Music Video Studio).
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
  // Each Studio workflow that runs is a skill call — counted for Skills Library › Usage.
  if (studio.length) {
    const ids = [...new Set(studio.map((m) => m.workflow.id))];
    // Resolved while the request is live (cookies), awaited after the answer.
    const who = memoryContext().catch(() => null);
    after(async () => {
      const ctx = await who;
      if (!ctx) return;
      if (ctx.available) await noteSkillUse(ctx, ids.map((id) => ({ skill: `studio:${id}`, source: "jarvis" as const })));
    });
  }
  const studioBlock = studio.length
    ? studioContext(studio, await loadSkills(studio.map((m) => m.workflow.id)))
    : "";

  // Memory rule 4: every workflow reads what its past runs learned before it
  // runs again, so a miss is never repeated. Best effort — no findings, or no
  // database, just means no block.
  const findings = studio.length
    ? await memoryContext()
        .then(async (ctx) => {
          if (!ctx.available) return "";
          const doc = await readRules(ctx.userId);
          return [...new Set(studio.map((m) => m.workflow.id))].map((id) => findingsBlock(doc, `studio:${id}`)).filter(Boolean).join("\n\n");
        })
        .catch(() => "")
    : "";

  // Memory rule 3: what Jarvis did lands in the owner's daily log. Resolved
  // while the request is live (cookies), written after the answer.
  const logCtx = memoryContext().catch(() => null);

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
        // 18000, up from 10000: the Chat tab now leads this with the Life
        // Record, and 10000 truncated it together with the dashboard digest
        // that used to be the whole of it.
        body.extraContext?.slice(0, 18000),
        castBlock,
        planBlock,
        findings,
        studioBlock,
        shotBlock,
        skillsBlock(body.skills),
      ]
        .filter(Boolean)
        .join("\n\n"),
      profileId: body.profileId,
      studio: studio.length > 0,
      task: {
        app: studio.length ? "Jarvis Studio" : "Jarvis chat",
        models: cleanStudioChain(body.models),
        // The skill this turn runs, so its tokens count toward it in Skills
        // Library › Spend and Jev can pick its model tier.
        ...(studio.length ? { skill: `studio:${studio[0].workflow.id}` } : {}),
      },
    });
    if (result.did?.length) {
      const about = studio.length ? `studio:${studio[0].workflow.id}` : undefined;
      after(async () => {
        const ctx = await logCtx;
        if (ctx?.available) await noteLog(ctx.userId, result.did.map((text) => ({ text, by: "jarvis", about, timeZone: body.timezone })));
      });
    }
    return NextResponse.json(result);
  } catch (e) {
    // A failure here must read as a failure, never as an answer.
    return NextResponse.json(
      // The thrown message is already the diagnosis (describeFailure in
      // runAgent), so it is shown as-is rather than wrapped in a sentence that
      // buries it in parentheses.
      { error: e instanceof Error ? e.message : "I couldn't reach the model, and it gave no reason." },
      { status: 502 },
    );
  }
}
