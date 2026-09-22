import { mayUseAi } from "@/lib/friends-night-out/aiAccess";
import { findReusableArea } from "@/lib/friends-night-out/areas";
import { buildCatalog, type BuildProgress } from "@/lib/friends-night-out/catalog/build";
import { catalogStore } from "@/lib/friends-night-out/catalog/store";
import { catalogAiAvailable } from "@/lib/friends-night-out/catalog/ai";

export const runtime = "nodejs";
export const maxDuration = 300;

// ---------------------------------------------------------------------------
// POST /api/fno/areas/build   { lat, lon, label, radiusMi }
//
// Returns the shared catalogue area for this spot, building it first when no
// existing area covers it. Streams NDJSON so the "Building your city" screen
// can show each stage:
//   {"type":"progress","stage":"places","message":"…"}
//   {"type":"done","areaId":"…"|null,"reused":bool,"places":[…]?,"stats":{…}?}
//   {"type":"error","message":"…"}
//
// Reusing an area is free for anyone. BUILDING one spends web-search and AI
// credit, so it needs a signed-in account. Without a service key (local dev)
// the catalogue is built and returned in the stream but not saved.
// ---------------------------------------------------------------------------

/** Two builds of the same new city at once: the second waits for the first. */
const STALE_BUILD_MS = 10 * 60_000;

export async function POST(req: Request) {
  let body: { lat?: number; lon?: number; label?: string; radiusMi?: number };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }
  const { lat, lon } = body;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return Response.json({ error: "lat and lon are required" }, { status: 400 });
  }
  const center = { lat: lat!, lon: lon! };
  const label = (body.label ?? "").trim().slice(0, 120) || `${lat!.toFixed(3)}, ${lon!.toFixed(3)}`;
  const radiusMi = Math.max(5, Math.min(50, body.radiusMi ?? 15));

  const store = catalogStore();

  // ----- reuse ------------------------------------------------------------
  if (store) {
    try {
      const areas = await store.listAreas();
      const ready = findReusableArea(areas.filter((a) => a.status === "ready"), center, radiusMi);
      if (ready) {
        await store.touch(ready.id);
        return Response.json({ type: "done", areaId: ready.id, reused: true });
      }
      const building = findReusableArea(
        areas.filter(
          (a) => a.status === "building" && Date.now() - Date.parse(a.createdAt) < STALE_BUILD_MS,
        ),
        center,
        radiusMi,
      );
      if (building) {
        return Response.json({ type: "building", areaId: building.id, message: "This city is being built right now. Try again in a minute." });
      }
    } catch (err) {
      return Response.json({ error: `Couldn't read city catalogues: ${(err as Error).message}` }, { status: 502 });
    }
  }

  // ----- build ------------------------------------------------------------
  if (!(await mayUseAi())) {
    return Response.json(
      { error: "Sign in to be the first to build this city.", needsSignIn: true },
      { status: 401 },
    );
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (o: unknown) => controller.enqueue(encoder.encode(JSON.stringify(o) + "\n"));
      let areaId: string | null = null;
      try {
        // Build the widest area OpenStreetMap search allows so neighbours reuse it.
        if (store) areaId = await store.createArea({ label, lat: center.lat, lon: center.lon, radiusMi: 25 });
        const result = await buildCatalog(
          { center, label, radiusMi: Math.max(radiusMi, 25), useAi: catalogAiAvailable(), rateInline: !store },
          (p: BuildProgress) => send({ type: "progress", ...p }),
        );
        // A city whose map search came back empty is an outage, not a dull
        // city. Saving it would serve that thin list to everyone forever, so
        // fail and let the next visit build it properly.
        if (result.stats.osm === 0) {
          throw new Error("The map service isn't answering right now. Try again in a few minutes.");
        }
        if (store && areaId) {
          await store.savePlaces(areaId, result.places);
          await store.setStatus(areaId, "ready", result.radiusMi);
        }
        send({
          type: "done",
          areaId,
          reused: false,
          stats: result.stats,
          // Saved builds are rated afterwards in rounds: POST /api/fno/areas/:id/rate.
          unrated: store ? result.places.length : 0,
          // Unsaved (local) builds hand the catalogue straight to the client.
          places: store ? undefined : result.places,
        });
      } catch (err) {
        if (store && areaId) await store.setStatus(areaId, "failed").catch(() => {});
        send({ type: "error", message: (err as Error).message || "Build failed" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" },
  });
}
