import "server-only";
import { aiEndpoint, aiFetch, DEFAULT_MODEL } from "@/lib/ai/provider";
import { styleById, type Brief, type DirectorPlan } from "../types";
import { TOOLS } from "../tools/registry";
import { BLENDER_TRIGGERS, CASCADEUR_TRIGGERS, MIXAMO_CLIPS } from "./motion";
import { extractJson } from "./llm-json";
import { normalizePlan } from "./normalize";

// ---------------------------------------------------------------------------
// The AI director. Same output as the heuristic director, written by a model
// with the studio's routing rules and Mixamo clip list in the prompt. Whatever
// comes back is run through normalizePlan, so a model that breaks a rule gets
// corrected rather than trusted. Returns null when no key is configured or the
// call fails, and the caller falls back to the heuristic director.
// ---------------------------------------------------------------------------

const SYSTEM = `You are the director of an AI 3D animation studio. You turn a short prompt into a production plan that a Blender pipeline will build, animate and render. You think like a feature-animation director: clear story beats, appealing characters, motivated camera moves, and every shot achievable.

Production tools:
${TOOLS.filter((t) => t.status !== "planned")
  .filter((t) => t.id !== "animatic")
  .map((t) => `- ${t.id}: ${t.role}`)
  .join("\n")}

Motion routing rules — assign EVERY action a tool:
1. Objects, vehicles, effects (kind "object") → "blender".
2. Creatures / quadrupeds (kind "creature") → "cascadeur". Mixamo only rigs bipeds.
3. Humanoid stunts, falls, fights, acrobatics, climbing, throwing/lifting/contact with props → "cascadeur". Triggers: ${CASCADEUR_TRIGGERS.map((t) => t.motion).join(", ")}.
4. Everyday humanoid motion → "mixamo" with a clip from this exact list: ${MIXAMO_CLIPS.map((c) => c.clip).join(", ")}.
5. Specific humanoid performance no clip covers → "cascadeur".
Blender object motion covers: ${BLENDER_TRIGGERS.map((t) => t.motion).join(", ")}.

Respond ONLY with minified JSON, no prose, matching:
{"title":string,"logline":string,
"interpretation":{"genre":string,"tone":string,"audience":string,"pacing":string,"themes":string[]},
"style":{"look":string},
"characters":[{"id":string,"name":string,"kind":"humanoid"|"creature"|"object","description":string,"colors":{"body":"#rrggbb","accent":"#rrggbb"}}],
"environments":[{"id":string,"name":string,"description":string,"props":string[],"palette":{"sky":"#rrggbb","ground":"#rrggbb","fog":"#rrggbb"},"timeOfDay":"day"|"golden"|"night"}],
"scenes":[{"id":string,"title":string,"beat":string,"durationSec":number,"environmentId":string,"summary":string,"narration":string,
  "camera":{"move":"static"|"dolly-in"|"dolly-out"|"orbit"|"pan"|"crane-up"|"tracking"|"handheld","lens":number,"framing":string},
  "lighting":string,"effects":string[],
  "actions":[{"id":string,"characterId":string,"description":string,"motion":string,"tool":"mixamo"|"cascadeur"|"blender","clip":string,"reason":string}]}],
"music":string,"soundDesign":string,"notes":string[]}

Guidance: 1–4 characters (include moving objects the story needs as kind "object"), 1–3 environments, props as short lowercase nouns (trees, buildings, stars, desks, spotlights, rocks, water, mountains…). Scene count: ~3 for 15 s, 4 for 30 s, 6 for 60 s, 8 for 2 min; durations must sum to the requested length. "motion" is a one-word verb (walk, run, jump, talk, wave, dance, cheer, point, think, look, sit, flip, fall, fight, climb, throw, fly, drive, grow, spin, explode). "reason" is one short sentence the owner will read. Narration is optional voice-over, one sentence. "notes" lists risks or assumptions.`;

export async function directWithAI(
  prompt: string,
  brief: Brief,
  opts: { note?: string; previous?: DirectorPlan } = {},
): Promise<DirectorPlan | null> {
  const endpoint = aiEndpoint();
  if (!endpoint) return null;
  const style = styleById(brief.style);

  const user = [
    `Prompt: """${prompt}"""`,
    `Style: ${style.label} — ${style.look}`,
    `Length: ${brief.lengthSec} seconds. Aspect: ${brief.aspect}.`,
    brief.mood ? `Mood: ${brief.mood}` : "",
    brief.audience ? `Audience: ${brief.audience}` : "",
    opts.previous ? `Previous plan (revise it, keep what works):\n${JSON.stringify(opts.previous).slice(0, 12000)}` : "",
    opts.note ? `Director's note from the owner: ${opts.note}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  try {
    const res = await aiFetch({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.STUDIO3D_MODEL || process.env.AI_MODEL || DEFAULT_MODEL,
        max_tokens: 9000,
        temperature: 0.8,
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: user },
        ],
      }),
      signal: AbortSignal.timeout(150_000),
    });
    if (!res.ok) {
      console.error("[studio3d] director call failed:", res.status, (await res.text()).slice(0, 300));
      return null;
    }
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = data.choices?.[0]?.message?.content ?? "";
    const json = extractJson(content);
    if (!json) return null;
    const plan = normalizePlan(json, brief, prompt, "ai");
    return plan.scenes.length ? plan : null;
  } catch (err) {
    console.error("[studio3d] director call errored:", err);
    return null;
  }
}

