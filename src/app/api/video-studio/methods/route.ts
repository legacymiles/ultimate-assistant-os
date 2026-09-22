import { NextResponse } from "next/server";
import { METHODS } from "@/lib/video-studio/registry";
import { capabilities } from "@/lib/video-studio/server/registry";
import { sessionUid } from "@/lib/video-studio/server/http";
import { runnerInfo } from "@/lib/video-studio/server/store";

// GET /api/video-studio/methods
//
// The method cards plus the REAL state of each one's dependencies. Every
// requirement in the answer was checked against this machine a moment ago —
// nothing here is a guess, and a method whose engine is missing says which
// piece is missing and how to get it.

export const runtime = "nodejs";

export async function GET() {
  const uid = await sessionUid();
  const [state, runner] = await Promise.all([capabilities(uid), runnerInfo(uid)]);
  return NextResponse.json({
    methods: METHODS.map(({ meta, skill }) => ({
      ...meta,
      skillTitle: skill.title,
      goodAt: skill.goodAt,
      capability: state[meta.id],
    })),
    runner,
  });
}
