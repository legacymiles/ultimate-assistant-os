import { NextResponse } from "next/server";
import { briefProblem, normaliseBrief } from "@/lib/video-studio/brief";
import { DIRECTOR_ID, isMethodId } from "@/lib/video-studio/registry";
import { buildPlan } from "@/lib/video-studio/server/plan";
import { bad } from "@/lib/video-studio/server/http";

// POST /api/video-studio/plan
// Body: { brief, methodId, mode }
// Returns: { plan }
//
// Engine-agnostic: this is the plan the USER reads and approves. The
// engine-specific rewrite happens later, at render time, so switching methods
// on the plan screen does not need a new plan.
//
// With no AI key the offline planner answers instead and says so in plan.note.

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return bad("Invalid request body");
  }

  const brief = normaliseBrief(body.brief);
  const problem = briefProblem(brief);
  if (problem) return bad(problem);

  const mode = body.mode === "director" ? "director" : "manual";
  const methodId = typeof body.methodId === "string" ? body.methodId : "";
  if (mode === "manual" && !isMethodId(methodId)) return bad("Choose a creation method first.");

  const plan = await buildPlan(brief, mode === "director" ? DIRECTOR_ID : methodId, mode);
  return NextResponse.json({ plan });
}
