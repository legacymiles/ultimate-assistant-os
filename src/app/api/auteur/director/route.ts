import { NextResponse } from "next/server";
import { composeH3Prompt } from "@/lib/auteur/director/h3prompt";
import { heuristicBreakdown, heuristicDevelop } from "@/lib/auteur/director/heuristic";
import {
  aiKey,
  breakdownWithLLM,
  describeWithLLM,
  developWithLLM,
  polishPromptWithLLM,
  retakeWithLLM,
} from "@/lib/auteur/director/llm";
import { heuristicRetake } from "@/lib/auteur/director/retake";
import { findShot } from "@/lib/auteur/repo";
import type { Project } from "@/lib/auteur/types";

export const runtime = "nodejs";
export const maxDuration = 120;

// POST /api/auteur/director
// Body: { stage, project, shotId?, instruction?, image?, hint? }
//
// Every stage has two implementations: a model-backed one through the Vercel
// AI Gateway when AI_GATEWAY_API_KEY is set, and a heuristic one that needs
// nothing. The heuristic is the fallback on a missing key AND on any model
// failure, so the studio never dead-ends — it just gets a plainer draft.
//
// The project arrives as structure only (no media bytes); the one stage that
// needs pixels, `describe`, receives a single data URL.
export async function POST(req: Request) {
  let body: {
    stage?: string;
    project?: Project;
    shotId?: string;
    instruction?: string;
    image?: string;
    hint?: string;
  };
  try {
    body = await req.json();
  } catch {
    return bad("Invalid request body");
  }

  const hasKey = Boolean(aiKey());
  const project = body.project;

  switch (body.stage) {
    case "develop": {
      if (!project) return bad("project required");
      const fallback = { development: heuristicDevelop(project), engine: "heuristic" as const };
      if (!hasKey) return NextResponse.json(fallback);
      try {
        return NextResponse.json({ development: await developWithLLM(project), engine: "ai" as const });
      } catch (err) {
        console.error("Auteur develop failed, using heuristic:", err);
        return NextResponse.json(fallback);
      }
    }

    case "breakdown": {
      if (!project) return bad("project required");
      const fallback = { scenes: heuristicBreakdown(project), engine: "heuristic" as const };
      if (!hasKey) return NextResponse.json(fallback);
      try {
        return NextResponse.json({ scenes: await breakdownWithLLM(project), engine: "ai" as const });
      } catch (err) {
        console.error("Auteur breakdown failed, using heuristic:", err);
        return NextResponse.json(fallback);
      }
    }

    case "prompt": {
      if (!project || !body.shotId) return bad("project and shotId required");
      const hit = findShot(project, body.shotId);
      if (!hit) return bad("shot not found");
      const composed = composeH3Prompt(project, hit.scene, hit.shot);
      if (!hasKey) return NextResponse.json({ prompt: composed, engine: "heuristic" as const });
      try {
        const text = await polishPromptWithLLM(composed, project, hit.shot);
        return NextResponse.json({ prompt: { ...composed, text }, engine: "ai" as const });
      } catch (err) {
        console.error("Auteur prompt polish failed, using composed:", err);
        return NextResponse.json({ prompt: composed, engine: "heuristic" as const });
      }
    }

    case "retake": {
      if (!project || !body.shotId || !body.instruction?.trim()) return bad("project, shotId and instruction required");
      const hit = findShot(project, body.shotId);
      if (!hit) return bad("shot not found");
      const fallback = { patch: heuristicRetake(body.instruction, hit.shot, project.characters), engine: "heuristic" as const };
      if (!hasKey) return NextResponse.json(fallback);
      try {
        return NextResponse.json({ patch: await retakeWithLLM(body.instruction, hit.shot, project), engine: "ai" as const });
      } catch (err) {
        console.error("Auteur retake failed, using heuristic:", err);
        return NextResponse.json(fallback);
      }
    }

    case "describe": {
      if (!body.image || !/^data:image\//.test(body.image)) return bad("image data URL required");
      if (!hasKey) return NextResponse.json({ described: null, engine: "heuristic" as const });
      try {
        return NextResponse.json({ described: await describeWithLLM(body.image, body.hint ?? ""), engine: "ai" as const });
      } catch (err) {
        console.error("Auteur describe failed:", err);
        return NextResponse.json({ described: null, engine: "heuristic" as const });
      }
    }

    default:
      return bad("unknown stage");
  }
}

function bad(msg: string) {
  return NextResponse.json({ error: msg }, { status: 400 });
}
