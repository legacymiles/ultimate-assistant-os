import { normalizeIdeas, normalizeScript, starterIdeas } from "@/lib/money-agents/logic";
import { aiReady, askJson, fail, readBody } from "@/lib/money-agents/server/ai";

export const runtime = "nodejs";
export const maxDuration = 120;

// POST { action: "ideas", niche, voice?, rules?, count?, previous?: string[], made?: {title, views}[] }
//        → { ideas, by, warning? }
// POST { action: "script", niche, voice?, rules?, minSeconds, maxSeconds, title, hook?, angle? }
//        → { script, by }

const PRODUCER =
  "You run a portfolio of profitable faceless YouTube/TikTok channels. You know retention curves, what earns on Shorts " +
  "versus long-form, and which topics get searched AND shared in a niche. You never pitch a topic you can't make " +
  "with stock-free motion graphics, text and a voiceover. Respond ONLY with minified JSON.";

const WRITER =
  "You write scripts for faceless short-form videos that hold 70%+ retention: a hook that opens a loop in under 2 seconds, " +
  "one idea per beat, concrete numbers and images, a payoff that closes the loop, no filler, no 'in this video'. " +
  "Every beat is speakable in one breath. Respond ONLY with minified JSON.";

export async function POST(req: Request) {
  const b = await readBody(req);
  if (!b) return fail(400, "That request was empty.");
  const niche = String(b.niche ?? "").slice(0, 300);
  const voice = String(b.voice ?? "").slice(0, 300);
  const rules = String(b.rules ?? "").slice(0, 800);

  if (b.action === "ideas") {
    const count = Math.min(10, Math.max(1, Number(b.count) || 6));
    if (!niche.trim()) return fail(400, "Say what the channel is about first (its niche).");
    if (!aiReady()) return Response.json({ ideas: starterIdeas(niche, count), by: "offline" });
    const previous = Array.isArray(b.previous) ? b.previous.map(String).slice(0, 80) : [];
    const made = Array.isArray(b.made)
      ? (b.made as { title?: unknown; views?: unknown }[]).slice(0, 30).map((m) => `${String(m.title)} — ${Number(m.views) || 0} views`)
      : [];
    try {
      const raw = await askJson(
        PRODUCER,
        [
          `Channel niche: ${niche}.`,
          voice ? `Voice: ${voice}.` : "",
          rules ? `Rules: ${rules}` : "",
          made.length ? `Already posted, with views (lean into what worked):\n- ${made.join("\n- ")}` : "",
          previous.length ? `Already pitched — don't repeat:\n- ${previous.join("\n- ")}` : "",
          `Pitch ${count} video ideas: mostly proven formats for this niche, at least one experiment.`,
          `Each: title (the actual video title), hook (first spoken line), angle (the one-line structure), why (why it will get views in this niche).`,
          `JSON: {"ideas":[{"title":"","hook":"","angle":"","why":""}]}`,
        ]
          .filter(Boolean)
          .join("\n"),
        0.9,
      );
      const ideas = normalizeIdeas(raw).slice(0, count);
      if (!ideas.length) throw new Error("No ideas in the reply.");
      return Response.json({ ideas, by: "ai" });
    } catch (err) {
      console.error("[money-agents/faceless] ideas failed:", err);
      return Response.json({ ideas: starterIdeas(niche, count), by: "offline", warning: "The AI step failed, so these are offline ideas." });
    }
  }

  if (b.action === "script") {
    const title = String(b.title ?? "").slice(0, 300);
    if (!title.trim()) return fail(400, "Pick an idea first.");
    const minS = Math.max(10, Number(b.minSeconds) || 30);
    const maxS = Math.max(minS, Number(b.maxSeconds) || 60);
    if (!aiReady()) {
      return Response.json({
        script: normalizeScript({
          hook: String(b.hook ?? title),
          beats: ["Set up the question in one line.", "First surprising fact.", "Second fact that raises the stakes.", "The answer — close the loop."],
          cta: "Follow for part two.",
          visuals: ["Bold title card", "Number animating up", "Simple diagram", "Answer revealed in big type"],
          thumbnail: title.split(" ").slice(0, 3).join(" ").toUpperCase(),
          description: title,
        }),
        by: "offline",
        warning: "No AI key is set, so this is a skeleton to fill in by hand.",
      });
    }
    try {
      const raw = await askJson(
        WRITER,
        [
          `Video: "${title}"${b.hook ? ` — hook idea: ${String(b.hook).slice(0, 300)}` : ""}${b.angle ? ` — structure: ${String(b.angle).slice(0, 300)}` : ""}.`,
          `Niche: ${niche || "general"}. Voice: ${voice || "clear, confident narrator"}.`,
          rules ? `Rules: ${rules}` : "",
          `Length: ${minS}-${maxS} seconds spoken (about ${Math.round(maxS * 2.5)} words at most).`,
          `Return hook (first spoken line), beats (spoken lines in order), visuals (what's on screen for each beat, same count as beats),`,
          `cta (last line), thumbnail (2-4 big words), description (YouTube description, 2-3 sentences + 3 hashtags).`,
          `JSON: {"hook":"","beats":[],"visuals":[],"cta":"","thumbnail":"","description":""}`,
        ]
          .filter(Boolean)
          .join("\n"),
        0.7,
      );
      const script = normalizeScript(raw);
      if (!script.beats.length) throw new Error("No beats in the reply.");
      return Response.json({ script, by: "ai" });
    } catch (err) {
      console.error("[money-agents/faceless] script failed:", err);
      return fail(502, "The script writer didn't answer. Try again in a minute.");
    }
  }

  return fail(400, "Ask for ideas or a script.");
}
