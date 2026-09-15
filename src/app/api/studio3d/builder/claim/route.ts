import { NextResponse } from "next/server";
import { builderUid, unauthorized } from "@/lib/studio3d/http";
import { claim } from "@/lib/studio3d/store";
import type { StudioCapabilities } from "@/lib/studio3d/types";

// POST /api/studio3d/builder/claim { capabilities? }
//
// Called by the studio builder on the owner's PC every few seconds. Records
// that it is alive and what it has installed (Blender, Cascadeur, the Mixamo
// library), then hands over the oldest queued project or 204. Token-auth;
// session-exempt in middleware by exact path.

export const runtime = "nodejs";

function capabilities(v: unknown): StudioCapabilities | undefined {
  if (!v || typeof v !== "object") return undefined;
  const c = v as Record<string, any>;
  const clips = Array.isArray(c.mixamo?.clips) ? c.mixamo.clips.filter((x: unknown) => typeof x === "string").slice(0, 400).map((s: string) => s.slice(0, 80)) : [];
  return {
    blender: { found: Boolean(c.blender?.found), version: typeof c.blender?.version === "string" ? c.blender.version.slice(0, 40) : undefined },
    blenderMcp: Boolean(c.blenderMcp),
    cascadeur: { found: Boolean(c.cascadeur?.found) },
    cascadeurMcp: Boolean(c.cascadeurMcp),
    mixamo: { clips, characters: Number.isFinite(c.mixamo?.characters) ? Number(c.mixamo.characters) : 0 },
  };
}

export async function POST(req: Request) {
  const uid = await builderUid(req);
  if (!uid) return unauthorized();
  const body = (await req.json().catch(() => ({}))) as { capabilities?: unknown };
  const project = await claim(uid, capabilities(body.capabilities));
  if (!project) return new NextResponse(null, { status: 204 });
  return NextResponse.json({ project });
}
