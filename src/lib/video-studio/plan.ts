// ---------------------------------------------------------------------------
// The production plan: structure, the offline planner, and the scene→method
// routing that AI Director mode uses.
//
// Isomorphic on purpose. The AI planner lives on the server (server/plan.ts)
// and calls into this file for the shape and for the fallback, so a hub with
// no AI key still reaches a real, editable plan rather than an error page.
// ---------------------------------------------------------------------------

import { DIRECTOR_ID, methodById, visibleMethods } from "./registry";
import type { PlanScene, ProductionPlan, VideoBrief } from "./types";
import { titleFromBrief } from "./brief";

/** How many scenes a video of this length wants. */
export function sceneCountFor(durationSec: number): number {
  if (durationSec <= 8) return 2;
  if (durationSec <= 15) return 3;
  if (durationSec <= 30) return 4;
  if (durationSec <= 60) return 6;
  if (durationSec <= 120) return 8;
  return 10;
}

/** Even scene boundaries over the duration, rounded to whole seconds. */
export function sceneBounds(durationSec: number, count: number): { startSec: number; endSec: number }[] {
  const out: { startSec: number; endSec: number }[] = [];
  for (let i = 0; i < count; i += 1) {
    out.push({
      startSec: Math.round((durationSec * i) / count),
      endSec: Math.round((durationSec * (i + 1)) / count),
    });
  }
  return out;
}

export function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function sceneRange(scene: PlanScene): string {
  return `${formatTime(scene.startSec)}–${formatTime(scene.endSec)}`;
}

// ----- AI Director routing ---------------------------------------------------

/**
 * Which engine a scene wants, judged from what the scene says it shows.
 *
 * This is the heuristic used offline and as the floor under the model's own
 * routing: a model that returns an unknown method id falls back to here rather
 * than to a crash. It is deliberately simple and readable — the point is that
 * the user can see WHY scene 3 went to Remotion.
 */
const ROUTING: { methodId: string; weight: number; patterns: RegExp }[] = [
  {
    methodId: "remotion",
    weight: 3,
    patterns:
      /\b(chart|graph|plot|data|number|percent|statistic|diagram|timeline|equation|formula|compare|breakdown|bullet|list|ui|interface|dashboard|caption|subtitle|title card|typography|text)\b/i,
  },
  {
    methodId: "hyperframes",
    weight: 2,
    patterns:
      /\b(transition|glitch|kinetic|montage|logo|sting|lockup|lower.?third|overlay|grain|scanline|collage|poster|graphic|motion design|slide)\b/i,
  },
  {
    methodId: "unreal",
    weight: 3,
    patterns:
      /\b(city|building|interior|environment|character walk|robot|vehicle|spaceship|architecture|set|level|crowd|virtual production|fly.?through|3d scene)\b/i,
  },
  {
    methodId: "blender",
    weight: 3,
    patterns:
      /\b(turntable|exploded|product shot|model|mesh|material|simulation|physics|fluid|cloth|procedural|render pass|orbit|close.?up of the (product|device|object))\b/i,
  },
  {
    methodId: "h3",
    weight: 3,
    patterns:
      /\b(cinematic|photoreal|realistic|footage|drone|landscape|sunset|atmospher|dramatic|film|live.?action|crowd of people|portrait|b.?roll)\b/i,
  },
];

/** The best engine for one scene description, with the reason. */
export function routeScene(text: string, allowed: string[] = visibleMethods().map((m) => m.meta.id)): {
  methodId: string;
  reason: string;
} {
  let best: { methodId: string; score: number; hit: string } | null = null;
  for (const rule of ROUTING) {
    if (!allowed.includes(rule.methodId)) continue;
    const match = text.match(rule.patterns);
    if (!match) continue;
    const score = rule.weight;
    if (!best || score > best.score) best = { methodId: rule.methodId, score, hit: match[0] };
  }
  if (best) {
    return { methodId: best.methodId, reason: `mentions “${best.hit}”` };
  }
  // Nothing matched: motion graphics is the safest default because it can
  // render any idea legibly, even when it cannot render it beautifully.
  const fallback = allowed.includes("remotion") ? "remotion" : allowed[0];
  return { methodId: fallback, reason: "no engine-specific signal — defaulting" };
}

// ----- the offline planner ---------------------------------------------------

/** Beat names used when no model is available to write real ones. */
const BEATS = [
  { title: "Open", description: "Establish the subject and state what the video is about." },
  { title: "Set up", description: "Introduce the first idea and the visual language the video will use." },
  { title: "Develop", description: "Show the mechanism — the part the audience came for." },
  { title: "Complicate", description: "Add the detail or consequence that makes the idea land." },
  { title: "Pay off", description: "Show the result the whole video has been building to." },
  { title: "Reinforce", description: "Restate the point in a second form so it sticks." },
  { title: "Widen", description: "Pull back and place the idea in its larger context." },
  { title: "Close", description: "End on the takeaway, with the call to action if there is one." },
  { title: "Tag", description: "Hold the final card." },
  { title: "Extra", description: "Additional beat for a longer runtime." },
];

/**
 * A structurally correct plan with no model involved.
 *
 * It is honest about what it is: the beats are generic and the note says so.
 * It exists because a missing AI key must degrade visibly rather than 500, and
 * because the user can edit every field on the plan screen anyway.
 */
export function heuristicPlan(brief: VideoBrief, methodId: string, mode: "manual" | "director"): ProductionPlan {
  const count = sceneCountFor(brief.durationSec);
  const bounds = sceneBounds(brief.durationSec, count);
  const subject = brief.subject || titleFromBrief(brief);

  const scenes: PlanScene[] = bounds.map((b, i) => {
    const beat = BEATS[Math.min(i, BEATS.length - 1)];
    const description = `${beat.description} (${subject})`;
    const routed = mode === "director" ? routeScene(`${description} ${brief.prompt}`) : { methodId, reason: "" };
    return {
      id: `s${i + 1}`,
      index: i + 1,
      title: beat.title,
      startSec: b.startSec,
      endSec: b.endSec,
      description,
      narration: brief.narration === "none" ? undefined : "",
      methodId: routed.methodId,
    };
  });

  const method = methodById(methodId);
  return {
    title: titleFromBrief(brief),
    logline: brief.prompt.slice(0, 220),
    durationSec: brief.durationSec,
    aspectRatio: brief.aspectRatio,
    scenes,
    methodId: mode === "director" ? DIRECTOR_ID : methodId,
    skill: mode === "director" ? "AI Director" : (method?.meta.skill ?? methodId),
    source: "heuristic",
    note:
      "Written offline — the beats are a structure, not a script. Set OPENROUTER_API_KEY for a " +
      "plan written for this specific video, or edit the scenes here.",
  };
}

// ----- validation ------------------------------------------------------------

/** Force a plan into a consistent state: ordered, contiguous, in-range. */
export function tidyPlan(plan: ProductionPlan, fallbackMethodId: string): ProductionPlan {
  const scenes = [...plan.scenes]
    .sort((a, b) => a.startSec - b.startSec)
    .map((scene, i) => ({
      ...scene,
      id: scene.id || `s${i + 1}`,
      index: i + 1,
      startSec: Math.max(0, Math.round(scene.startSec)),
      endSec: Math.max(0, Math.round(scene.endSec)),
      methodId: methodById(scene.methodId) ? scene.methodId : fallbackMethodId,
    }));

  // Close gaps and overlaps: each scene starts where the last one ended.
  for (let i = 0; i < scenes.length; i += 1) {
    if (i > 0) scenes[i].startSec = scenes[i - 1].endSec;
    if (scenes[i].endSec <= scenes[i].startSec) scenes[i].endSec = scenes[i].startSec + 1;
  }
  const last = scenes[scenes.length - 1];
  const duration = last ? last.endSec : plan.durationSec;

  return { ...plan, scenes, durationSec: duration };
}
