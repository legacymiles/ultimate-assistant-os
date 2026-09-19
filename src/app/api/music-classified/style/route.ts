import { NextResponse } from "next/server";
import { aiReady, chatJson } from "@/lib/music-classified/ai";
import {
  STYLE_LIMIT,
  STYLE_SYSTEM,
  charCount,
  checkStyle,
  coerceFacts,
  failures,
  fitToLimit,
  normalizePrompt,
  offlineStyle,
  revisePrompt,
  songStylePrompt,
  type StyleCheck,
  type StyleFacts,
  type StyleResponse,
} from "@/lib/music-classified/style";
import type { Song, SongStyle } from "@/lib/music-classified/types";

export const runtime = "nodejs";
// One writing call plus up to two rewrites, each with hidden reasoning.
export const maxDuration = 300;

/** Rewrites the quality gate may ask for before settling on the best draft. */
const MAX_REVISIONS = 2;

/** Fewer failures wins; the length rule outranks everything else. */
function score(checks: StyleCheck[]): number {
  return failures(checks).reduce((n, c) => n + (c.id === "length" ? 100 : 1), 0);
}

function build(text: string, facts: StyleFacts, source: SongStyle["source"], revisions: number): SongStyle {
  const fitted = fitToLimit(text);
  return {
    text: fitted,
    identity: facts.identity,
    vocals: facts.vocals,
    drums: facts.drums,
    source,
    revisions,
    trimmed: fitted !== text,
    at: new Date().toISOString(),
  };
}

// POST /api/music-classified/style  { song } → { style, warning? }
// Writes the song's generator style prompt: as accurate to the recording as
// possible, ≤1,000 characters, run through the quality gate, and sent back
// for a rewrite with the failures named when it misses.
export async function POST(req: Request) {
  let body: { song?: Song };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const song = body.song;
  if (!song?.title || !song.profile) {
    return NextResponse.json({ error: "Which song? File it first." }, { status: 400 });
  }

  const offline = (warning: string) => {
    const { prompt, facts } = offlineStyle(song);
    return NextResponse.json({ style: build(prompt, facts, "offline", 0), warning } satisfies StyleResponse);
  };

  if (!aiReady()) {
    return offline("No AI key is set, so this style prompt was built from the filed profile only.");
  }

  try {
    const raw = await chatJson(STYLE_SYSTEM, songStylePrompt(song), {
      maxTokens: 10_000,
      timeoutMs: 150_000,
      temperature: 0.4,
    });
    const facts = coerceFacts(raw);
    let best = normalizePrompt(String(raw.prompt ?? ""));
    if (!best) throw new Error("empty style prompt");
    let bestChecks = checkStyle(best, song, facts);
    let revisions = 0;

    while (failures(bestChecks).length && revisions < MAX_REVISIONS) {
      revisions++;
      try {
        const fixed = await chatJson(STYLE_SYSTEM, revisePrompt(best, failures(bestChecks), facts), {
          maxTokens: 8000,
          timeoutMs: 70_000,
          temperature: 0.3,
        });
        const candidate = normalizePrompt(String(fixed.prompt ?? ""));
        if (!candidate) continue;
        const checks = checkStyle(candidate, song, facts);
        if (score(checks) <= score(bestChecks)) {
          best = candidate;
          bestChecks = checks;
        }
      } catch (err) {
        // A failed rewrite keeps the best draft so far rather than losing it.
        console.error("music-classified style rewrite failed:", err);
        break;
      }
    }

    return NextResponse.json({
      style: build(best, facts, "ai", revisions),
      warning:
        charCount(best) > STYLE_LIMIT
          ? `The best draft still ran over ${STYLE_LIMIT} characters, so it was ended at the last full clause that fits.`
          : undefined,
    } satisfies StyleResponse);
  } catch (err) {
    console.error("music-classified style failed, using the profile-built draft:", err);
    return offline(
      "The AI didn't answer, so this style prompt was built from the filed profile. Hit Rewrite to retry.",
    );
  }
}
