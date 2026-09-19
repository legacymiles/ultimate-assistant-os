import { mayUseAi } from "@/lib/friends-night-out/aiAccess";
import { catalogAiAvailable } from "@/lib/friends-night-out/catalog/ai";
import { ratePlaces } from "@/lib/friends-night-out/catalog/build";
import { catalogStore } from "@/lib/friends-night-out/catalog/store";

export const runtime = "nodejs";
export const maxDuration = 300;

// ---------------------------------------------------------------------------
// POST /api/fno/areas/:id/rate  →  { rated, remaining }
//
// One round of AI star ratings for a saved city: up to ROUND places still on
// estimated stars. The client calls it again while `remaining` > 0 and the
// last round rated something. Rounds keep each request well inside the 300 s
// limit and pace calls so the model's provider doesn't answer 429 — rating a
// whole city in one request did both. Any signed-in visitor's screen can
// continue an unfinished city, so a closed tab never strands it.
// ---------------------------------------------------------------------------

const ROUND = 80;

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return Response.json({ error: "Bad area id" }, { status: 400 });

  const store = catalogStore();
  if (!store) return Response.json({ error: "Shared catalogues aren't configured here." }, { status: 404 });
  if (!catalogAiAvailable()) return Response.json({ rated: 0, remaining: 0, note: "No AI key — stars stay estimated." });
  if (!(await mayUseAi())) return Response.json({ error: "Sign in to rate places.", needsSignIn: true }, { status: 401 });

  try {
    const area = await store.getArea(id);
    if (!area) return Response.json({ error: "No such city" }, { status: 404 });
    const batch = await store.unrated(id, ROUND);
    const rated = batch.length ? await ratePlaces(batch, area.label) : 0;
    if (rated) await store.saveRatings(id, batch);
    const remaining = await store.countUnrated(id);
    return Response.json({ rated, remaining });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 502 });
  }
}
