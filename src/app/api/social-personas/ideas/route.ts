import { heuristicIdeas, localDay, normalizeIdeas, personaContext } from "@/lib/social-personas/logic";
import type { Persona } from "@/lib/social-personas/types";
import { aiReady, askJson } from "@/lib/social-personas/server/ai";
import { body, fail } from "@/lib/social-personas/server/http";

export const runtime = "nodejs";
export const maxDuration = 120;

const SYSTEM =
  "You are the creative producer for one social media creator. You know their account inside out " +
  "(profile, content pillars, every post and how it performed). You pitch specific, shootable ideas " +
  "that fit THIS creator's niche and voice, lean on what already works for them, and add one fresh angle. " +
  "No generic advice. Respond ONLY with minified JSON.";

// POST { persona, day?, count?, direction?, previous?: string[] } → { ideas, by }
export async function POST(req: Request) {
  const b = await body(req);
  const persona = b?.persona as Persona | undefined;
  if (!persona?.name) return fail(400, "Missing persona.");
  const day = typeof b?.day === "string" ? b.day : localDay();
  const count = Math.min(10, Math.max(1, Number(b?.count) || 5));
  const direction = typeof b?.direction === "string" ? b.direction.slice(0, 500) : "";
  const previous: string[] = Array.isArray(b?.previous) ? b.previous.map(String).slice(0, 60) : [];

  if (!aiReady()) return Response.json({ ideas: heuristicIdeas(persona, day, count), by: "heuristic" });
  try {
    const raw = await askJson(
      SYSTEM,
      `${personaContext(persona)}

TODAY: ${day} (${new Date(day + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}) — use timely hooks (season, holidays, trends) when they fit.
${direction ? `THE CREATOR'S DIRECTION FOR THIS BATCH: ${direction}\n` : ""}${previous.length ? `ALREADY PITCHED — don't repeat these:\n- ${previous.join("\n- ")}\n` : ""}
Pitch ${count} post ideas for today. Mix safe bets (a proven format with a new topic) and at least one experiment.
Each idea:
- title: short working title
- hook: the exact first line / first shot (under 2 seconds)
- format: e.g. "music video snippet", "talking-head explainer", "month 7 montage"
- outline: 3-6 beats, shootable today with what this creator already has
- why: one sentence tying it to their data (name the post or pattern it builds on)
- platform: "tiktok" | "instagram" | "facebook" | "any"
JSON: {"ideas":[{"title":"","hook":"","format":"","outline":[],"why":"","platform":""}]}`,
    );
    const ideas = normalizeIdeas(raw);
    if (!ideas.length) throw new Error("No ideas in the reply.");
    return Response.json({ ideas, by: "ai" });
  } catch (err) {
    console.error("[social-personas/ideas] AI failed:", err);
    return Response.json({ ideas: heuristicIdeas(persona, day, count), by: "heuristic", warning: "The AI step failed, so these are offline ideas." });
  }
}
