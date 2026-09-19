import { heuristicBrain, normalizeBrain, personaContext } from "@/lib/social-personas/logic";
import type { Persona } from "@/lib/social-personas/types";
import { aiReady, askJson } from "@/lib/social-personas/server/ai";
import { body, fail } from "@/lib/social-personas/server/http";

export const runtime = "nodejs";
export const maxDuration = 120;

const SYSTEM =
  "You are a sharp social media strategist building a working memory of one creator's account. " +
  "Base every claim on the posts and stats given; say plainly when there isn't enough data. Respond ONLY with minified JSON.";

// POST { persona } → { brain }
export async function POST(req: Request) {
  const b = await body(req);
  const persona = b?.persona as Persona | undefined;
  if (!persona?.name) return fail(400, "Missing persona.");
  if (!aiReady()) return Response.json({ brain: heuristicBrain(persona) });
  try {
    const raw = await askJson(
      SYSTEM,
      `${personaContext(persona, { maxPosts: 60 })}

Write what you now know about this account:
- summary: 3-5 sentences — what the account is, who it's for, what it's known for
- pillars: 3-6 recurring content pillars
- whatWorks: 3-6 specific patterns behind the best-performing posts (hooks, formats, topics, lengths) — cite the post when you can
- voice: how they talk / present, in one sentence
- gaps: 2-5 untapped angles or things to test next
JSON: {"summary":"","pillars":[],"whatWorks":[],"voice":"","gaps":[]}`,
      0.4,
    );
    return Response.json({ brain: normalizeBrain(raw, persona.posts.length, "ai") });
  } catch (err) {
    console.error("[social-personas/brain] AI failed:", err);
    return Response.json({ brain: heuristicBrain(persona), warning: "The AI step failed, so this is the offline summary." });
  }
}
