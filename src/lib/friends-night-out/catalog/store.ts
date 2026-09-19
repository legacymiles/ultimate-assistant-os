import "server-only";

// Persistence for shared city catalogues. fno_areas / fno_places are
// world-readable but writable only with the service role (RLS has no write
// policy), so only the server can publish a catalogue. Without the key — local
// dev — this returns null and builds simply aren't saved.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { CatalogPlace } from "./build";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

export interface AreaRow {
  id: string;
  label: string;
  lat: number;
  lon: number;
  builtRadiusMi: number;
  status: "building" | "ready" | "failed";
  lastBuiltAt: string | null;
  createdAt: string;
}

let client: SupabaseClient | null = null;

export interface CatalogStore {
  listAreas(): Promise<AreaRow[]>;
  createArea(a: { label: string; lat: number; lon: number; radiusMi: number }): Promise<string>;
  setStatus(id: string, status: AreaRow["status"], builtRadiusMi?: number): Promise<void>;
  savePlaces(areaId: string, places: CatalogPlace[]): Promise<number>;
  touch(id: string): Promise<void>;
  getArea(id: string): Promise<AreaRow | null>;
  /** Places still on estimated stars, as CatalogPlaces ready to rate. */
  unrated(areaId: string, limit: number): Promise<CatalogPlace[]>;
  countUnrated(areaId: string): Promise<number>;
  /** Write AI ratings back for places that were rated. */
  saveRatings(areaId: string, places: CatalogPlace[]): Promise<void>;
}

export function catalogStore(): CatalogStore | null {
  if (!URL || !KEY) return null;
  client ??= createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const db = client;

  return {
    async listAreas() {
      const { data, error } = await db
        .from("fno_areas")
        .select("id,label,lat,lon,built_radius_mi,status,last_built_at,created_at");
      if (error) throw new Error(error.message);
      return (data ?? []).map((r) => ({
        id: r.id,
        label: r.label,
        lat: r.lat,
        lon: r.lon,
        builtRadiusMi: Number(r.built_radius_mi),
        status: r.status,
        lastBuiltAt: r.last_built_at,
        createdAt: r.created_at,
      }));
    },

    async createArea(a) {
      const { data, error } = await db
        .from("fno_areas")
        .insert({ label: a.label, lat: a.lat, lon: a.lon, built_radius_mi: a.radiusMi, status: "building" })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      return data.id as string;
    },

    async setStatus(id, status, builtRadiusMi) {
      const patch: Record<string, unknown> = { status };
      if (status === "ready") patch.last_built_at = new Date().toISOString();
      if (builtRadiusMi) patch.built_radius_mi = builtRadiusMi;
      const { error } = await db.from("fno_areas").update(patch).eq("id", id);
      if (error) throw new Error(error.message);
    },

    async savePlaces(areaId, places) {
      const rows = places
        .filter((p) => p.osmId)
        .map((p) => ({
          area_id: areaId,
          osm_id: p.osmId,
          name: p.name,
          address: p.address ?? null,
          lat: p.lat,
          lon: p.lon,
          section: p.section,
          ai_stars: p.aiStars,
          ai_reason: p.aiReason ?? null,
          stars_estimated: p.starsEstimated,
          // A web find's one-line "why" is the hook until the AI writes a better one.
          hook: p.hook ?? p.why ?? null,
          price_tier: p.priceTier ?? null,
          sources: p.sources,
        }));
      for (let i = 0; i < rows.length; i += 200) {
        const { error } = await db
          .from("fno_places")
          .upsert(rows.slice(i, i + 200), { onConflict: "area_id,osm_id" });
        if (error) throw new Error(error.message);
      }
      return rows.length;
    },

    async touch(id) {
      await db.from("fno_areas").update({ last_active_at: new Date().toISOString() }).eq("id", id);
    },

    async getArea(id) {
      const { data, error } = await db
        .from("fno_areas")
        .select("id,label,lat,lon,built_radius_mi,status,last_built_at,created_at")
        .eq("id", id)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) return null;
      return {
        id: data.id,
        label: data.label,
        lat: data.lat,
        lon: data.lon,
        builtRadiusMi: Number(data.built_radius_mi),
        status: data.status,
        lastBuiltAt: data.last_built_at,
        createdAt: data.created_at,
      };
    },

    async unrated(areaId, limit) {
      const { data, error } = await db
        .from("fno_places")
        .select("id,osm_id,name,address,lat,lon,section,ai_stars,hook,price_tier,sources")
        .eq("area_id", areaId)
        .eq("stars_estimated", true)
        .order("created_at", { ascending: true })
        .limit(limit);
      if (error) throw new Error(error.message);
      return (data ?? []).map((r) => ({
        key: r.id,
        name: r.name,
        section: r.section,
        aiStars: r.ai_stars ?? 3,
        starsEstimated: true,
        hook: r.hook ?? undefined,
        address: r.address ?? undefined,
        lat: r.lat,
        lon: r.lon,
        distanceMi: 0,
        priceTier: r.price_tier === "free" ? "free" : undefined,
        osmId: r.osm_id ?? undefined,
        sources: r.sources ?? [],
      }));
    },

    async countUnrated(areaId) {
      const { count, error } = await db
        .from("fno_places")
        .select("id", { count: "exact", head: true })
        .eq("area_id", areaId)
        .eq("stars_estimated", true);
      if (error) throw new Error(error.message);
      return count ?? 0;
    },

    async saveRatings(areaId, places) {
      // key is the fno_places row id here (see unrated()).
      await Promise.all(
        places
          .filter((p) => !p.starsEstimated)
          .map((p) =>
            db
              .from("fno_places")
              .update({
                section: p.section,
                ai_stars: p.aiStars,
                ai_reason: p.aiReason ?? null,
                hook: p.hook ?? null,
                stars_estimated: false,
              })
              .eq("id", p.key)
              .eq("area_id", areaId)
              .then(({ error }) => {
                if (error) throw new Error(error.message);
              }),
          ),
      );
    },
  };
}
