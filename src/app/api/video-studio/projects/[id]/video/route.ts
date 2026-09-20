import { NextResponse } from "next/server";
import { getClip, getProject } from "@/lib/video-studio/server/store";
import { notFound, sessionUid } from "@/lib/video-studio/server/http";

// GET /api/video-studio/projects/:id/video           — the assembled video
// GET /api/video-studio/projects/:id/video?scene=2   — one scene's clip
//
// Owner-only: the key never leaves the server, so a project id alone cannot be
// used to read someone else's render.

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Params) {
  const uid = await sessionUid();
  const { id } = await params;
  const project = await getProject(uid, id);
  if (!project) return notFound();

  const raw = new URL(req.url).searchParams.get("scene");
  const which = raw === null ? ("final" as const) : Number(raw);
  if (which !== "final" && (!Number.isInteger(which) || which < 1)) {
    return NextResponse.json({ error: "Bad scene index." }, { status: 400 });
  }

  const bytes = await getClip(uid, id, which);
  if (!bytes) return notFound();

  const name = `${project.title.replace(/[^\w -]/g, "").trim() || "video"}${which === "final" ? "" : `-scene-${which}`}.mp4`;
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "video/mp4",
      "Content-Length": String(bytes.length),
      "Content-Disposition": `inline; filename="${name}"`,
      "Cache-Control": "private, max-age=60",
    },
  });
}
