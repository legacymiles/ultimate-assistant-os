import { NextResponse } from "next/server";
import type { ProgressRequest } from "@/lib/h3-lab/api";
import { mutateLab, saveWorker } from "@/lib/h3-lab/server/store";
import { bad, readJson, unauthorized, workerUid } from "@/lib/h3-lab/server/http";

// POST /api/h3-lab/worker/progress — rendering / measuring / uploading while a
// render is under way. Token-authenticated; session-exempt by exact path.

export const runtime = "nodejs";

export async function POST(req: Request) {
  const uid = await workerUid(req);
  if (!uid) return unauthorized();
  const body = await readJson<ProgressRequest>(req);
  if (!body?.generationId) return bad("generationId is required.");
  await saveWorker(uid, {
    current: body.generationId,
    ...(body.status === "rendering" ? { wangp: "busy" as const } : {}),
    wangpDetail: String(body.detail ?? "").slice(0, 300),
  });
  if (body.status === "rendering") {
    await mutateLab(uid, (s) => {
      const g = s.generations.find((x) => x.id === body.generationId);
      if (g && g.status === "claimed") g.status = "rendering";
    });
  }
  return NextResponse.json({ ok: true });
}
