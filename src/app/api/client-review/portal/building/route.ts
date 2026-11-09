import { NextResponse } from "next/server";
import { buildingRows } from "@/lib/client-review/building";
import { isSentToClient } from "@/lib/client-review/logic";
import { readIndex, readProject } from "@/lib/client-review/store";
import { currentViewer } from "@/lib/client-review/viewer";
import type { ClientProject } from "@/lib/client-review/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// GET /api/client-review/portal/building — every build in flight, for whoever
// is asking. The owner sees all of them; a client sees only their own, and
// only on projects that were actually sent to them.
//
// It is one endpoint rather than one for each because the Building screen is
// the same screen for both, and two sources would be two things to keep in
// step. It is also the reason this lives under /portal rather than /admin:
// a client has to be able to call it.
// ---------------------------------------------------------------------------

export async function GET() {
  const viewer = await currentViewer();
  if (viewer === "none") return NextResponse.json({ builds: [] });
  if (!viewer) return NextResponse.json({ error: "Sign in with your Jarvis account.", signIn: true }, { status: 401 });

  const index = await readIndex();
  const mine = index.projects.filter((p) => !p.archived && (viewer.owner || p.clientUserId === viewer.id));
  const loaded = await Promise.all(mine.map((m) => readProject(m.id)));
  const projects = loaded.filter((p): p is ClientProject => {
    if (!p || p.archived || p.token.startsWith("deleted")) return false;
    // The owner sees their own work in progress; a client only ever sees a
    // project that has been sent to them and that they claimed.
    return viewer.owner || (p.clientUserId === viewer.id && isSentToClient(p));
  });

  // `threadId` names the owner's PC and `projectId` is the handle the admin
  // API works in. Neither is any use to a client, so neither is sent to one.
  const builds = buildingRows(projects).map((b) =>
    viewer.owner ? b : { ...b, threadId: undefined, projectId: undefined },
  );
  return NextResponse.json({ builds, owner: viewer.owner }, { headers: { "Cache-Control": "no-store" } });
}
