// Today's ideas.
//
// The prompt is assembled in a fixed order, and the order is the design:
//
//   1. the character document, verbatim — the style lock,
//   2. the hard limits, which no amount of engagement may override,
//   3. the profile and the posts,
//   4. what the loop has PROVEN, with sample sizes and intervals attached,
//   5. the slot structure, which the model is told not to merge or reorder.
//
// Four is the part that makes this self-improving rather than a daily prompt:
// it is derived from the page's own numbers by pure arithmetic in learn.ts, so
// it is present and correct whether or not an AI key is set. With no key the
// same plan drives the offline wording instead.

import { heuristicIdeas, localDay, normalizeIdeas, personaContext } from "@/lib/social-personas/logic";
import { lessonsPrompt, planBatch } from "@/lib/social-personas/learn";
import { libraryPrompt } from "@/lib/social-personas/formats";
import type { Persona } from "@/lib/social-personas/types";
import { aiReady, askJson } from "@/lib/social-personas/server/ai";

/**
 * One retry, because the failure mode here is a stray quote, not a bad idea.
 *
 * This persona writes quoted speech constantly, so a caption that should read
 * he calls it “the oven’s phone” arrives with raw double quotes in it and the
 * whole batch fails to parse. Handing the parser's own complaint back is
 * enough to fix it, and it beats throwing away six finished posts.
 */
async function askJsonRetrying(system: string, user: string, temperature: number, maxTokens: number, timeoutMs: number) {
  try {
    return await askJson(system, user, temperature, maxTokens, timeoutMs, "low");
  } catch (err) {
    const message = (err as Error).message ?? "";
    if (!/JSON|Unexpected|Expected/i.test(message)) throw err;
    console.warn("[social-personas/ideas] reply was not valid JSON, asking once for a repair:", message);
    return askJson(
      system,
      `${user}

Your previous reply could not be parsed as JSON (${message.slice(0, 200)}). `
        + "Send the same ideas again as strictly valid minified JSON. Escape or replace every straight double quote "
        + "inside a string value with a curly quote. Output nothing but the JSON object.",
      temperature,
      maxTokens,
      timeoutMs,
      "low",
    );
  }
}
import { body, fail, tooMany, viewerUid, withinRate } from "@/lib/social-personas/server/http";

export const runtime = "nodejs";
export const maxDuration = 300;

const SYSTEM =
  "You are the creative producer for one social media character, and you write AS that character's producer — "
  + "never as a brand, never as a marketer. You have the character's own document (follow it exactly), the page's "
  + "real post history, and a measured list of what has and has not worked on THIS page, with sample sizes. "
  + "You pitch specific, postable ideas that fit the character's voice, lean on what the numbers actually support, "
  + "and spend the slots you are given on the experiments you are told to run. No generic advice, no hashtags, "
  + "no call to action stapled on the end. Respond ONLY with minified JSON.";

// POST { persona, day?, count?, direction?, previous?: string[] } → { ideas, by, plan }
export async function POST(req: Request) {
  const b = await body(req);
  const persona = b?.persona as Persona | undefined;
  if (!persona?.name) return fail(400, "Missing persona.");
  if (!Array.isArray(persona.posts)) return fail(400, "That persona is missing its post history.");

  const day = typeof b?.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.day) ? b.day : localDay();
  const count = Math.min(10, Math.max(1, Number(b?.count) || 6));
  const direction = typeof b?.direction === "string" ? b.direction.slice(0, 500) : "";
  const previous: string[] = Array.isArray(b?.previous) ? b.previous.map(String).slice(0, 60) : [];

  // The plan is arithmetic, so it exists either way and is returned either way:
  // the UI shows the slot structure next to the ideas, so the owner can see
  // WHY each one is there rather than taking the list on faith.
  const plan = planBatch(persona, count, day);
  const lessonVersion = persona.lessonLog?.[0]?.version;

  if (!aiReady()) {
    return Response.json({
      ideas: heuristicIdeas(persona, day, count),
      by: "heuristic",
      plan: plan.counts,
      warning: "No AI key is set, so these are written mechanically from the page's own plan. The plan itself is real.",
    });
  }

  const uid = await viewerUid();
  if (!withinRate(`ideas:${uid}`, 20, 60_000)) return tooMany("idea runs");

  try {
    const raw = await askJsonRetrying(
      SYSTEM,
      `${personaContext(persona)}

${persona.posts.length < 3 ? libraryPrompt(persona.nickname) + "\n" : ""}## WHAT THIS PAGE'S OWN NUMBERS SAY
${lessonsPrompt(persona, plan)}

TODAY: ${day} (${new Date(day + "T12:00:00").toLocaleDateString("en-GB", { weekday: "long", month: "long", day: "numeric" })}) — use a timely hook only where it genuinely fits the character.
${direction ? `THE OWNER'S DIRECTION FOR THIS BATCH: ${direction}\n` : ""}${previous.length ? `ALREADY PITCHED — do not repeat these:\n- ${previous.join("\n- ")}\n` : ""}
Pitch exactly ${count} ideas, one per slot, in the slot order given above.

Each idea:
- title: short working title, for the owner's eyes
- hook: the exact first line as it will be read
- caption: the complete post, written in the character's voice, ready to publish. No hashtags. No call to action.
- firstComment: the comment the character posts under its own post twenty minutes later, in voice
- format: the named mechanic from the library
- outline: 3-5 beats — what to make, and what to reply when the corrections arrive
- why: one sentence tying it to the data, naming the lever or the post it builds on
- platform: "facebook" | "tiktok" | "instagram" | "any"
- role: "exploit" | "explore" | "wildcard" — the slot's own role
- leverKeys: ["format:<slug>","hookType:<...>","media:<...>","captionLen:<...>"]
Inside any string value use curly quotes (“ ” ‘ ’), never a raw straight double quote — this character writes a lot of quoted speech, and a stray " breaks the reply.
JSON: {"ideas":[{"title":"","hook":"","caption":"","firstComment":"","format":"","outline":[],"why":"","platform":"","role":"","leverKeys":[]}]}`,
      0.8,
      // Six ideas, each with a full caption, a first comment and an outline,
      // runs well past the 4,000-token default — and an over-run comes back as
      // an EMPTY reply rather than a truncated one, so it reads as the model
      // refusing rather than the budget being too small.
      8_000,
      // It is a once-a-day job writing six finished posts, and it genuinely
      // takes a couple of minutes. The old 120s ceiling turned that into a
      // silent fall back to offline wording, which looked like the agent
      // getting worse rather than a deadline being too short.
      240_000,
    );
    const ideas = normalizeIdeas(raw, {
      avoid: persona.avoid,
      lessonVersion,
      aboutMeVersion: persona.aboutMeVersion,
    });
    if (!ideas.length) throw new Error("No ideas in the reply.");
    const blocked = ideas.filter((i) => i.blockedReason).length;
    return Response.json({
      ideas,
      by: "ai",
      plan: plan.counts,
      ...(blocked
        ? { warning: `${blocked} of these broke a hard limit and are held back with the reason shown — they were not discarded quietly.` }
        : {}),
    });
  } catch (err) {
    console.error("[social-personas/ideas] AI failed:", err);
    return Response.json({
      ideas: heuristicIdeas(persona, day, count),
      by: "heuristic",
      plan: plan.counts,
      warning: "The AI step failed, so these are written from the page's own plan instead. The plan itself is real.",
    });
  }
}
