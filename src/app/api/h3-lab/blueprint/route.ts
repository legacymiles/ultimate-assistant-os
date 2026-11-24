import { NextResponse } from "next/server";
import { loadBlueprint } from "@/lib/h3-lab/server/store";
import { bad, sessionUid } from "@/lib/h3-lab/server/http";

// GET /api/h3-lab/blueprint?id=<id> — one full reverse-engineered blueprint. Owner-only.

export const runtime = "nodejs";

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!/^[\w-]+$/.test(id)) return bad("id is required.");
  const blueprint = await loadBlueprint(await sessionUid(), id);
  if (!blueprint) return bad("No such blueprint.", 404);
  return NextResponse.json({ blueprint });
}
