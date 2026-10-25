import { findMoments, formatTime, normalizeMoments, parseTranscript, type Segment } from "@/lib/money-agents/logic";
import { aiReady, askJson, askVideoJson, fail, readBody } from "@/lib/money-agents/server/ai";
import { youTubeTranscript } from "@/lib/money-agents/server/transcript";

export const runtime = "nodejs";
export const maxDuration = 180;

// POST { url?, transcript?, count?, minSeconds?, maxSeconds?, niche?, voice?, rules? }
//   → { moments, by, title?, warning? }
//
// The ways in, best first:
//   1. a transcript the owner pasted, or the video's own YouTube captions,
//      read by the AI (precise timestamps, cheap) …
//   2. … or, with no AI key, the offline keyword pass over that transcript;
//   3. no transcript at all: the AI watches the video by its link;
//   4. none of those: ask for the transcript, in plain words.

const SYSTEM =
  "You are a senior short-form editor who has cut thousands of viral clips from podcasts, streams and long videos " +
  "for TikTok, Reels and Shorts. You know what makes people stop scrolling (a hook in the first 2 seconds, a bold claim, " +
  "a story with a payoff, a number, conflict, laughter) and what makes them share. You pick self-contained moments that " +
  "make sense with no context, start on a strong line and end on a payoff. Respond ONLY with minified JSON.";

function brief(b: Record<string, unknown>, count: number, minS: number, maxS: number): string {
  const niche = String(b.niche ?? "").slice(0, 200);
  const voice = String(b.voice ?? "").slice(0, 200);
  const rules = String(b.rules ?? "").slice(0, 800);
  return [
    `Find the ${count} best moments to clip. Each clip ${minS}-${maxS} seconds, no overlaps.`,
    niche ? `Channel niche: ${niche}.` : "",
    voice ? `Caption voice: ${voice}.` : "",
    rules ? `Rules every clip must follow: ${rules}` : "",
    `For each moment: start and end in seconds from the start of the video (numbers), hook (the on-screen text for the first 2 s, under 10 words),`,
    `title (working title), why (one sentence: why people will share it), score (0-100 viral potential, be honest), quote (the key line said),`,
    `caption (ready-to-post, 1-2 lines, no hashtags), hashtags (3-6, no #).`,
    `JSON: {"moments":[{"start":0,"end":0,"hook":"","title":"","why":"","score":0,"quote":"","caption":"","hashtags":[]}]}`,
  ]
    .filter(Boolean)
    .join("\n");
}

/** A transcript, shortened to fit a prompt, with times the model can read. */
function transcriptText(segments: Segment[], max = 90_000): string {
  const lines = segments.map((s) => `[${formatTime(s.start)}|${Math.round(s.start)}s] ${s.text}`);
  let out = "";
  for (const l of lines) {
    if (out.length + l.length > max) break;
    out += `${l}\n`;
  }
  return out;
}

export async function POST(req: Request) {
  const b = await readBody(req);
  if (!b) return fail(400, "That request was empty.");
  const url = typeof b.url === "string" ? b.url.trim().slice(0, 600) : "";
  const pasted = typeof b.transcript === "string" ? b.transcript.slice(0, 400_000) : "";
  const count = Math.min(12, Math.max(1, Number(b.count) || 5));
  const minS = Math.min(600, Math.max(5, Number(b.minSeconds) || 20));
  const maxS = Math.min(3600, Math.max(minS, Number(b.maxSeconds) || 60));
  if (!url && !pasted.trim()) return fail(400, "Paste a video link or its transcript.");
  if (url && !/^https?:\/\//i.test(url)) return fail(400, "That link doesn't look right. Paste the full address, starting with https://");

  let segments: Segment[] = pasted.trim() ? parseTranscript(pasted) : [];
  let title = "";
  let duration = 0;
  if (!segments.length && url) {
    const yt = await youTubeTranscript(url);
    if (yt) {
      segments = yt.segments;
      title = yt.title;
      duration = yt.duration;
    }
  }
  const ask = brief(b, count, minS, maxS);

  if (segments.length && aiReady()) {
    try {
      const raw = await askJson(SYSTEM, `${ask}\n\nTRANSCRIPT (each line: [time|seconds] words):\n${transcriptText(segments)}`, 0.5);
      const moments = normalizeMoments(raw, { maxSeconds: maxS, duration: duration || undefined }).slice(0, count);
      if (moments.length) return Response.json({ moments, by: "ai-transcript", title });
    } catch (err) {
      console.error("[money-agents/moments] AI over transcript failed:", err);
    }
    return Response.json({
      moments: findMoments(segments, { count, minSeconds: minS, maxSeconds: maxS }),
      by: "offline",
      title,
      warning: "The AI step didn't answer, so these were picked by the offline finder. They're a good start — check each one.",
    });
  }
  if (segments.length) {
    return Response.json({
      moments: findMoments(segments, { count, minSeconds: minS, maxSeconds: maxS }),
      by: "offline",
      title,
      warning: "Picked by the offline finder (no AI key is set). Add an OpenRouter key in Jarvis › Profile › Connections for sharper picks.",
    });
  }
  if (url && aiReady()) {
    try {
      const raw = await askVideoJson(SYSTEM, `${ask}\n\nWatch the video and use its real timestamps.`, url);
      const moments = normalizeMoments(raw, { maxSeconds: maxS }).slice(0, count);
      if (moments.length) return Response.json({ moments, by: "ai-video", title });
    } catch (err) {
      console.error("[money-agents/moments] AI over video failed:", err);
    }
  }
  return fail(
    422,
    "I couldn't read that video's words. Open it on YouTube, press ⋯ › Show transcript, copy it all, and paste it into the transcript box.",
  );
}
