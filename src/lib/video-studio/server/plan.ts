import "server-only";
import { DEFAULT_MODEL, aiConfigured, aiFetch } from "@/lib/ai/provider";
import { briefBlock } from "../brief";
import { DIRECTOR_ID, methodById, visibleMethods } from "../registry";
import { heuristicPlan, routeScene, sceneCountFor, tidyPlan } from "../plan";
import type { PlanScene, ProductionPlan, VideoBrief } from "../types";

// ---------------------------------------------------------------------------
// Turning a brief into a plan, and a plan into engine-specific instructions.
//
// Two separate model calls, deliberately:
//
//   1. PLAN     — engine-agnostic. What the video shows, scene by scene. This
//                 is what the user reads and approves, so it must be in their
//                 language, not Remotion's or H3's.
//   2. OPTIMISE — engine-specific. Each scene's description rewritten in the
//                 chosen engine's terms, using that method's own optimiser
//                 prompt. This is the step that means the user never has to
//                 know how any of these tools work.
//
// Both degrade: no key, a bad answer or a timeout falls back to the offline
// planner and to the scene description as its own directive. A missing key
// must degrade visibly, never 500.
// ---------------------------------------------------------------------------

/** Pull the first JSON object out of a model answer, fenced or not. */
export function readJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : trimmed;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    return null;
  }
}

function model(): string {
  return process.env.VIDEO_STUDIO_MODEL || process.env.AI_MODEL || DEFAULT_MODEL;
}

async function ask(system: string, user: string, maxTokens: number): Promise<string> {
  const res = await aiFetch({
    method: "POST",
    body: JSON.stringify({
      model: model(),
      temperature: 0.7,
      max_tokens: maxTokens,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
    signal: AbortSignal.timeout(110_000),
  });
  if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 240)}`);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return String(data?.choices?.[0]?.message?.content ?? "");
}

// ----- the plan --------------------------------------------------------------

function plannerSystem(mode: "manual" | "director", methodId: string): string {
  const lines = [
    "You are the production planner for a video studio. You turn a brief into a shot-by-shot",
    "production plan a human reads and approves before anything renders.",
    "",
    "Write the plan in the language of the VIDEO, not of any tool. Each scene says what is on",
    "screen and why it is there. Be specific: name the objects, the numbers, the words that appear.",
    "A scene that says 'engaging visuals' is a failed scene.",
    "",
    "Return JSON only:",
    "{",
    '  "title": "short project title",',
    '  "logline": "one sentence on what the video does",',
    '  "scenes": [',
    '    { "title": "3-word beat name", "startSec": 0, "endSec": 5,',
    '      "description": "what is on screen, 1-2 sentences",',
    '      "narration": "the line spoken over it, or empty"',
    "      }",
    "  ]",
    "}",
    "",
    "Scenes must be contiguous — each starts where the last ended — and the last one must end at",
    "exactly the requested duration. Omit narration when the brief asked for none.",
  ];

  if (mode === "director") {
    const roster = visibleMethods()
      .map((m) => `  - "${m.meta.id}" — ${m.meta.name}: ${m.meta.tagline}`)
      .join("\n");
    lines.push(
      "",
      "This plan runs in AI DIRECTOR mode: each scene is rendered by whichever engine suits it, so",
      'add a "methodId" to every scene, chosen from:',
      roster,
      "",
      "Route on what the scene shows, not on variety for its own sake. A scene of charts goes to",
      "remotion even if the scene before it did; a photoreal establishing shot goes to h3. Do not",
      "use an engine you have no reason to use.",
    );
  } else {
    const method = methodById(methodId);
    lines.push(
      "",
      `Every scene will be rendered with ${method?.meta.name ?? methodId} — ${method?.meta.tagline ?? ""}.`,
      "Plan scenes that engine can actually deliver. Do not plan photoreal footage for a motion-",
      "graphics engine, or hand-drawn typography for a generative video model.",
    );
  }
  return lines.join("\n");
}

interface RawScene {
  title?: unknown;
  startSec?: unknown;
  endSec?: unknown;
  description?: unknown;
  narration?: unknown;
  methodId?: unknown;
}

function num(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? Math.round(n) : fallback;
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

/**
 * Shape a model answer into a plan. Anything missing is filled from the
 * offline planner's structure rather than rejected — a plan the user can edit
 * beats an error.
 */
function normalisePlan(
  raw: unknown,
  brief: VideoBrief,
  methodId: string,
  mode: "manual" | "director",
): ProductionPlan | null {
  const body = raw as { title?: unknown; logline?: unknown; scenes?: unknown };
  const list = Array.isArray(body?.scenes) ? (body.scenes as RawScene[]) : [];
  if (!list.length) return null;

  const allowed = visibleMethods().map((m) => m.meta.id);
  const capped = list.slice(0, Math.max(2, sceneCountFor(brief.durationSec) + 4));

  const scenes: PlanScene[] = capped.map((raw, i) => {
    const description = text(raw.description, `Scene ${i + 1}`);
    const declared = text(raw.methodId);
    const chosen =
      mode === "director"
        ? allowed.includes(declared)
          ? declared
          : routeScene(description).methodId
        : methodId;
    return {
      id: `s${i + 1}`,
      index: i + 1,
      title: text(raw.title, `Scene ${i + 1}`).slice(0, 60),
      startSec: num(raw.startSec, 0),
      endSec: num(raw.endSec, 0),
      description: description.slice(0, 600),
      narration: brief.narration === "none" ? undefined : text(raw.narration).slice(0, 600),
      methodId: chosen,
    };
  });

  const plan: ProductionPlan = {
    title: text(body?.title, brief.subject || "Untitled video").slice(0, 80),
    logline: text(body?.logline, brief.prompt).slice(0, 240),
    durationSec: brief.durationSec,
    aspectRatio: brief.aspectRatio,
    scenes,
    methodId: mode === "director" ? DIRECTOR_ID : methodId,
    skill: mode === "director" ? "AI Director" : (methodById(methodId)?.meta.skill ?? methodId),
    source: "ai",
  };
  return tidyPlan(plan, mode === "director" ? "remotion" : methodId);
}

/** The production plan for a brief. Never throws; falls back to the offline planner. */
export async function buildPlan(
  brief: VideoBrief,
  methodId: string,
  mode: "manual" | "director",
): Promise<ProductionPlan> {
  if (!aiConfigured()) {
    return heuristicPlan(brief, methodId, mode);
  }
  try {
    const answer = await ask(
      plannerSystem(mode, methodId),
      `${briefBlock(brief)}\n\nPlan ${sceneCountFor(brief.durationSec)} scenes, give or take two.`,
      4000,
    );
    const plan = normalisePlan(readJson(answer), brief, methodId, mode);
    if (plan) return plan;
    const fallback = heuristicPlan(brief, methodId, mode);
    fallback.note = "The planner returned something unusable, so this plan was written offline. Edit it below.";
    return fallback;
  } catch (err) {
    console.error("[video-studio] planner failed, using the offline planner:", err);
    const message = err instanceof Error ? err.message : String(err);
    const fallback = heuristicPlan(brief, methodId, mode);
    fallback.note = `The planner model failed (${message.slice(0, 120)}) — this plan was written offline. Edit it below.`;
    return fallback;
  }
}

// ----- optimisation ----------------------------------------------------------

/**
 * Rewrite every scene in the chosen engine's terms.
 *
 * Grouped by method, because in AI Director mode one plan can span five
 * engines and each needs its own optimiser prompt. A group whose model call
 * fails keeps the scene description as its directive — worse output, not a
 * failed render.
 */
export async function optimisePlan(plan: ProductionPlan, brief: VideoBrief): Promise<ProductionPlan> {
  const byMethod = new Map<string, PlanScene[]>();
  for (const scene of plan.scenes) {
    byMethod.set(scene.methodId, [...(byMethod.get(scene.methodId) ?? []), scene]);
  }

  const directives = new Map<string, string>();

  await Promise.all(
    [...byMethod.entries()].map(async ([methodId, scenes]) => {
      const method = methodById(methodId);
      if (!method) return;
      if (!aiConfigured()) {
        for (const scene of scenes) directives.set(scene.id, structuralDirective(scene, brief, method.meta.name));
        return;
      }
      try {
        const user = [
          briefBlock(brief),
          "",
          "SCENES TO WRITE DIRECTIVES FOR:",
          ...scenes.map(
            (s) =>
              `- id ${s.id} · ${s.startSec}s–${s.endSec}s · ${s.title}\n  ${s.description}` +
              (s.narration ? `\n  narration: ${s.narration}` : ""),
          ),
          "",
          'Return JSON: { "directives": { "<scene id>": "<the directive>" } }',
        ].join("\n");
        const answer = await ask(method.skill.optimiserSystem, user, 4000);
        const parsed = readJson(answer) as { directives?: Record<string, unknown> } | null;
        for (const scene of scenes) {
          const value = parsed?.directives?.[scene.id];
          directives.set(
            scene.id,
            typeof value === "string" && value.trim()
              ? value.trim().slice(0, 4000)
              : structuralDirective(scene, brief, method.meta.name),
          );
        }
      } catch (err) {
        console.error(`[video-studio] optimiser failed for ${methodId}:`, err);
        for (const scene of scenes) directives.set(scene.id, structuralDirective(scene, brief, method.meta.name));
      }
    }),
  );

  return {
    ...plan,
    scenes: plan.scenes.map((scene) => ({ ...scene, directive: directives.get(scene.id) ?? scene.description })),
  };
}

/**
 * The directive when no model wrote one: the scene's own facts, arranged.
 *
 * Deliberately not the raw user prompt — even offline, the engine gets the
 * scene's own timing, framing and copy rather than the whole request.
 */
export function structuralDirective(scene: PlanScene, brief: VideoBrief, engine: string): string {
  const lines = [
    `${engine} · ${scene.title} · ${scene.startSec}s–${scene.endSec}s (${scene.endSec - scene.startSec}s) · ${brief.aspectRatio}`,
    "",
    scene.description,
  ];
  if (scene.narration) lines.push("", `Narration: ${scene.narration}`);
  if (brief.style) lines.push("", `Visual style: ${brief.style}`);
  if (brief.audience) lines.push(`Audience: ${brief.audience}`);
  if (brief.captions) lines.push("Burn in captions.");
  if (brief.notes) lines.push("", `Also: ${brief.notes}`);
  lines.push("", "(Written without a model — set OPENROUTER_API_KEY for an engine-tuned directive.)");
  return lines.join("\n");
}
