import { getSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

// ---------------------------------------------------------------------------
// GET /api/fno/areas/:id/places
//
// A built city's catalogue with its community stats (rating count/sum, lists
// it's in), for the Explore places table. Readable by anyone — the catalogue is
// public; RLS on fno_places and the fno_place_stats view already say so.
// ---------------------------------------------------------------------------

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return Response.json({ error: "Bad area id" }, { status: 400 });

  const sb = await getSupabaseServerClient();
  if (!sb) return Response.json({ error: "Shared catalogues need Supabase." }, { status: 404 });

  const [area, places, stats] = await Promise.all([
    sb.from("fno_areas").select("id,label,lat,lon,built_radius_mi,status,last_built_at").eq("id", id).maybeSingle(),
    sb
      .from("fno_places")
      .select("id,name,address,lat,lon,section,ai_stars,ai_reason,stars_estimated,hook,price_tier,photo_url,sources,original_finder_id,created_at")
      .eq("area_id", id)
      .limit(2000),
    sb.from("fno_place_stats").select("place_id,rating_count,rating_sum,list_count"),
  ]);
  if (area.error || places.error) {
    return Response.json({ error: (area.error ?? places.error)!.message }, { status: 502 });
  }
  if (!area.data) return Response.json({ error: "No such city" }, { status: 404 });

  const byPlace = new Map((stats.data ?? []).map((s) => [s.place_id, s]));
  return Response.json({
    area: area.data,
    places: (places.data ?? []).map((p) => {
      const s = byPlace.get(p.id);
      return { ...p, rating_count: s?.rating_count ?? 0, rating_sum: s?.rating_sum ?? 0, list_count: s?.list_count ?? 0 };
    }),
  });
}
