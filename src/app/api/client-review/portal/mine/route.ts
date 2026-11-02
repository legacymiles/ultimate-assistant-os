import { NextResponse } from "next/server";
import { currentVersion, isSentToClient } from "@/lib/client-review/logic";
import { isBeingCreated } from "@/lib/client-review/list";
import { readIndex, readProject } from "@/lib/client-review/store";
import { currentViewer } from "@/lib/client-review/viewer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/client-review/portal/mine — every website the signed-in client has
// opened, so /review works as their home: "my websites".

export async function GET() {
  const viewer = await currentViewer();
  if (viewer === "none") return NextResponse.json({ sites: [], email: null });
  if (!viewer) return NextResponse.json({ error: "Sign in with your Jarvis account.", signIn: true }, { status: 401 });
  const index = await readIndex();
  const mine = index.projects.filter((p) => !p.archived && (viewer.owner ? false : p.clientUserId === viewer.id));
  const sites = (await Promise.all(mine.map((m) => readProject(m.id))))
    // `isSentToClient` as well as the claim: a project the owner has not sent
    // is theirs alone, however it came to exist.
    .filter((p): p is NonNullable<typeof p> => !!p && p.clientUserId === viewer.id && !p.archived && isSentToClient(p))
    .map((p) => ({
      token: p.token,
      name: p.name,
      version: currentVersion(p)?.number ?? null,
      building: p.versions.find((v) => v.status === "building")?.number ?? null,
      // Nothing has ever shipped here, so the client is waiting on a first
      // look rather than reviewing a change.
      beingCreated: isBeingCreated(p),
      pending: p.batches.filter((b) => b.status === "pending").length,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    }));
  return NextResponse.json({ sites, email: viewer.email }, { headers: { "Cache-Control": "no-store" } });
}
