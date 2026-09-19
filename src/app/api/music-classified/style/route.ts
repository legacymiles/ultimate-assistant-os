import { NextResponse } from "next/server";
import { aiReady, chatJson } from "@/lib/music-classified/ai";
import {
  STYLE_LIMIT,
  STYLE_SYSTEM,
  charCount,
  checkStyle,
  coercePlan,
  failures,
  fitToLimit,
  normalizePrompt,
  offlineStyle,
  revisePrompt,
  stylePrompt,
  type LibraryRef,
  type StyleBrief,
  type StyleCheck,
  type StylePlan,
  type StyleResponse,
} from "@/lib/music-classified/style";

export const runtime = "nodejs";
// One planning call plus up to two rewrites, each with hidden reasoning.
export const maxDuration = 300;

/** Rewrites the quality gate may ask for before settling on the best draft. */
const MAX_REVISIONS = 2;

/** Fewer failures wins; the length rule outranks everything else. */
function score(checks: StyleCheck[]): number {
  return failures(checks).reduce((n, c) => n + (c.id === "length" ? 100 : 1), 0);
}

function finish(
  prompt: string,
  plan: StylePlan,
  brief: StyleBrief,
  extra: Omit<StyleResponse, "prompt" | "chars" | "plan" | "checks">,
) {
  const fitted = fitToLimit(prompt);
  return {
    prompt: fitted,
    chars: charCount(fitted),
    plan,
    checks: checkStyle(fitted, brief, plan.identity),
    ...extra,
    trimmed: extra.trimmed || fitted !== prompt,
  } satisfies StyleResponse;
}

// POST /api/music-classified/style  { brief, libraryRefs? } → StyleResponse
// The producer: plan every decision, compress into ≤1000 characters, run the
// quality gate, send failing drafts back for a rewrite with the failures named.
export async function POST(req: Request) {
  let body: { brief?: StyleBrief; libraryRefs?: LibraryRef[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const brief = body.brief;
  const filled =
    brief &&
    Object.entries(brief).some(([k, v]) => k !== "useTaste" && k !== "energy" && typeof v === "string" && v.trim());
  if (!brief || !filled) {
    return NextResponse.json({ error: "Describe the song first — even one sentence is enough." }, { status: 400 });
  }
  const refs = Array.isArray(body.libraryRefs) ? body.libraryRefs.slice(0, 8) : [];

  const offline = (warning: string) => {
    const { prompt, plan } = offlineStyle(brief);
    return NextResponse.json(
      finish(prompt, plan, brief, {
        source: "offline",
        revisions: 0,
        trimmed: false,
        warning,
      }),
    );
  };

  if (!aiReady()) {
    return offline(
      "No AI key is set (OPENROUTER_API_KEY), so this is a rule-built draft, not a producer's. Add the key for the real thing.",
    );
  }

  try {
    const raw = await chatJson(STYLE_SYSTEM, stylePrompt(brief, refs), {
      maxTokens: 12_000,
      timeoutMs: 150_000,
      temperature: 0.8,
    });
    const plan = coercePlan(raw.plan);
    let best = normalizePrompt(String(raw.prompt ?? ""));
    if (!best) throw new Error("empty style prompt");
    let bestChecks = checkStyle(best, brief, plan.identity);
    let revisions = 0;

    while (failures(bestChecks).length && revisions < MAX_REVISIONS) {
      revisions++;
      try {
        const fixed = await chatJson(STYLE_SYSTEM, revisePrompt(best, failures(bestChecks), plan), {
          maxTokens: 8000,
          timeoutMs: 70_000,
          temperature: 0.4,
        });
        const candidate = normalizePrompt(String(fixed.prompt ?? ""));
        if (!candidate) continue;
        const checks = checkStyle(candidate, brief, plan.identity);
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

    const over = charCount(best) > STYLE_LIMIT;
    return NextResponse.json(
      finish(best, plan, brief, {
        source: "ai",
        revisions,
        trimmed: false,
        warning: over
          ? `The producer's best draft still ran over ${STYLE_LIMIT} characters after ${revisions} rewrites, so it was ended at the last full clause that fits.`
          : undefined,
      }),
    );
  } catch (err) {
    console.error("music-classified style failed, using the offline builder:", err);
    return offline("The AI didn't answer, so this is a rule-built draft. Hit Generate again to retry.");
  }
}
