import "server-only";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { CAMERA_NETWORKS, loadNetwork, windyKey, windyNearby } from "./cameras";
import type {
  AircraftRow,
  CablesFeed,
  CamerasFeed,
  FlightsFeed,
  Place,
  QuakesFeed,
  SatellitesFeed,
  SearchFeed,
  TleRow,
} from "./types";

// ---------------------------------------------------------------------------
// Keyless public feeds for God's Eye View, normalised and cached in memory.
//
// Cache lifetimes follow what each provider asks for: CelesTrak wants TLEs
// fetched no more than every couple of hours, OpenSky's anonymous quota is a
// few hundred credits a day, and USGS regenerates its summary every minute.
// On an upstream failure the last good copy is served, flagged `stale`.
// ---------------------------------------------------------------------------

const UA = "ultimate-assistant-os/gods-eye-view (+https://ultimate-assistant-os.vercel.app)";
const FT = 0.3048;
const KT = 0.514444;

type Entry = { at: number; value: unknown; pending?: Promise<unknown> };
const cache = new Map<string, Entry>();

/** Serve `key` from cache for `ttlMs`, coalescing concurrent refreshes; fall back to stale data on error. */
async function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T & { stale?: boolean }> {
  type Out = T & { stale?: boolean };
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value as Out;
  if (hit?.pending) return hit.pending as Promise<Out>;

  const pending: Promise<Out> = load()
    .then((value) => {
      cache.set(key, { at: Date.now(), value });
      return value as Out;
    })
    .catch((err) => {
      if (hit?.value !== undefined) {
        cache.set(key, { at: hit.at, value: hit.value });
        return { ...(hit.value as T), stale: true } as Out;
      }
      cache.delete(key);
      throw err;
    });
  cache.set(key, { at: hit?.at ?? 0, value: hit?.value, pending });
  return pending;
}

async function getJson<T>(url: string, timeoutMs = 20_000, headers: Record<string, string> = {}): Promise<T> {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json", ...headers },
    signal: AbortSignal.timeout(timeoutMs),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}`);
  return (await res.json()) as T;
}

// ----- Flights --------------------------------------------------------------

type OpenSkyState = [
  string, string | null, string, number | null, number, number | null, number | null,
  number | null, boolean, number | null, number | null, number | null, unknown, number | null,
  string | null, boolean, number,
];

async function openSky(): Promise<FlightsFeed> {
  const data = await getJson<{ time: number; states: OpenSkyState[] | null }>(
    "https://opensky-network.org/api/states/all",
    25_000,
  );
  if (!data.states?.length) throw new Error("OpenSky returned no states");
  const aircraft: AircraftRow[] = [];
  for (const s of data.states) {
    if (s[5] == null || s[6] == null) continue;
    aircraft.push([
      s[0],
      (s[1] ?? "").trim(),
      s[2] ?? "",
      s[5],
      s[6],
      Math.max(0, s[13] ?? s[7] ?? 0),
      s[8] ? 1 : 0,
      s[9] ?? 0,
      s[10] ?? 0,
      s[11] ?? 0,
      s[14] ?? "",
      "",
    ]);
  }
  return { source: "opensky", time: data.time * 1000, aircraft };
}

interface AdsbAircraft {
  hex: string;
  flight?: string;
  r?: string;
  t?: string;
  lat?: number;
  lon?: number;
  alt_baro?: number | "ground";
  alt_geom?: number;
  gs?: number;
  track?: number;
  true_heading?: number;
  baro_rate?: number;
  geom_rate?: number;
  squawk?: string;
  ownOp?: string;
}

function adsbRows(list: AdsbAircraft[]): AircraftRow[] {
  const rows: AircraftRow[] = [];
  for (const a of list) {
    if (a.lat == null || a.lon == null) continue;
    const ground = a.alt_baro === "ground";
    const altFt = ground ? 0 : (a.alt_geom ?? (typeof a.alt_baro === "number" ? a.alt_baro : 0));
    rows.push([
      a.hex,
      (a.flight ?? a.r ?? "").trim(),
      a.ownOp ?? a.r ?? "",
      a.lon,
      a.lat,
      Math.max(0, altFt * FT),
      ground ? 1 : 0,
      (a.gs ?? 0) * KT,
      a.track ?? a.true_heading ?? 0,
      ((a.geom_rate ?? a.baro_rate ?? 0) * FT) / 60,
      a.squawk ?? "",
      a.t ?? "",
    ]);
  }
  return rows;
}

async function adsbAround(lat: number, lon: number): Promise<FlightsFeed> {
  const data = await getJson<{ ac?: AdsbAircraft[]; now?: number }>(
    `https://api.adsb.lol/v2/lat/${lat.toFixed(2)}/lon/${lon.toFixed(2)}/dist/250`,
  );
  return { source: "adsb.lol", time: data.now ?? Date.now(), aircraft: adsbRows(data.ac ?? []) };
}

async function flights(params: URLSearchParams): Promise<FlightsFeed> {
  try {
    // 90 s keeps anonymous OpenSky use to well under its daily credit budget.
    return await cached("flights:opensky", 90_000, openSky);
  } catch {
    // Regional fallback around the camera, snapped to a 2° cell so nearby views share a cache entry.
    const lat = Math.round(Number(params.get("lat") ?? 30) / 2) * 2;
    const lon = Math.round(Number(params.get("lon") ?? -97) / 2) * 2;
    return cached(`flights:adsb:${lat}:${lon}`, 20_000, () => adsbAround(lat, lon));
  }
}

async function military(): Promise<FlightsFeed> {
  return cached("military", 20_000, async () => {
    const data = await getJson<{ ac?: AdsbAircraft[]; now?: number }>("https://api.adsb.lol/v2/mil");
    return { source: "adsb.lol" as const, time: data.now ?? Date.now(), aircraft: adsbRows(data.ac ?? []) };
  });
}

// ----- Satellites -----------------------------------------------------------

// CelesTrak regenerates element sets every 2 hours and answers 403 to a repeat
// download of a group it has already served this IP since then ("GP data has
// not updated since your last successful download"). So the last good set is
// kept on disk: inside that window it is not stale, it IS the current data, and
// a dev-server restart must not cost the whole catalog. Smaller groups are
// separate files with their own window, so they are the fallback.
const TLE_WINDOW_MS = 2 * 60 * 60_000;
const SAT_CACHE_FILE = join(tmpdir(), "gods-eye-view", "satellites-tle.json");
const FALLBACK_GROUPS = ["stations", "visual", "science", "weather", "gps-ops", "galileo", "geo", "resource", "military", "starlink"];

function parseTle(text: string): TleRow[] {
  const lines = text.split(/\r?\n/);
  const rows: TleRow[] = [];
  for (let i = 0; i + 2 < lines.length; i++) {
    if (lines[i + 1]?.startsWith("1 ") && lines[i + 2]?.startsWith("2 ")) {
      rows.push([lines[i].trim(), lines[i + 1], lines[i + 2]]);
      i += 2;
    }
  }
  return rows;
}

async function fetchTleGroup(group: string): Promise<{ status: number; rows: TleRow[]; body: string }> {
  try {
    const res = await fetch(`https://celestrak.org/NORAD/elements/gp.php?GROUP=${group}&FORMAT=tle`, {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(40_000),
      cache: "no-store",
    });
    const body = await res.text();
    return { status: res.status, rows: res.ok ? parseTle(body) : [], body };
  } catch (err) {
    return { status: 0, rows: [], body: err instanceof Error ? err.message : "network error" };
  }
}

async function readSatDisk(): Promise<SatellitesFeed | null> {
  try {
    const feed = JSON.parse(await readFile(SAT_CACHE_FILE, "utf8")) as SatellitesFeed;
    return feed.sats?.length ? feed : null;
  } catch {
    return null;
  }
}

async function writeSatDisk(feed: SatellitesFeed) {
  try {
    await mkdir(dirname(SAT_CACHE_FILE), { recursive: true });
    await writeFile(SAT_CACHE_FILE, JSON.stringify(feed));
  } catch {
    /* read-only filesystem: the in-memory cache still works */
  }
}

async function satellites(): Promise<SatellitesFeed> {
  return cached("satellites", TLE_WINDOW_MS, async () => {
    const disk = await readSatDisk();
    if (disk && !disk.partial && Date.now() - disk.time < TLE_WINDOW_MS) return disk;

    const active = await fetchTleGroup("active");
    if (active.rows.length) {
      const feed: SatellitesFeed = { time: Date.now(), sats: active.rows, source: "CelesTrak · active" };
      await writeSatDisk(feed);
      return feed;
    }

    const unchanged = active.status === 403 && /not updated/i.test(active.body);
    if (disk) return { ...disk, stale: !unchanged && Date.now() - disk.time > TLE_WINDOW_MS };

    // Nothing on disk and the full catalog refused: stitch together the smaller groups.
    const byNorad = new Map<string, TleRow>();
    for (const group of FALLBACK_GROUPS) {
      const { rows } = await fetchTleGroup(group);
      for (const row of rows) byNorad.set(row[1].slice(2, 7), row);
    }
    if (!byNorad.size) {
      throw new Error(
        active.status === 403 ? `CelesTrak: ${active.body.split("\n")[0].trim()}` : `celestrak.org answered ${active.status || "no response"}`,
      );
    }
    const feed: SatellitesFeed = {
      time: Date.now(),
      sats: [...byNorad.values()],
      source: "CelesTrak · selected groups",
      partial: true,
    };
    await writeSatDisk(feed);
    return feed;
  });
}

// ----- Earthquakes ----------------------------------------------------------

async function quakes(): Promise<QuakesFeed> {
  return cached("quakes", 120_000, async () => {
    const data = await getJson<{
      features: {
        id: string;
        properties: { mag: number; place: string; time: number; url: string };
        geometry: { coordinates: [number, number, number] };
      }[];
    }>("https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson");
    return {
      time: Date.now(),
      quakes: data.features.map((f) => ({
        id: f.id,
        mag: f.properties.mag ?? 0,
        place: f.properties.place ?? "Unknown",
        time: f.properties.time,
        lon: f.geometry.coordinates[0],
        lat: f.geometry.coordinates[1],
        depthKm: f.geometry.coordinates[2],
        url: f.properties.url,
      })),
    };
  });
}

// ----- Public cameras (open-data traffic networks + optional Windy) ----------

async function cameras(): Promise<CamerasFeed> {
  return cached("cameras", 60_000, async () => {
    // A cold network (Florida is ~50 pages) keeps loading in the background and
    // joins on a later poll instead of holding up everything that's ready.
    const results = await Promise.all(
      CAMERA_NETWORKS.map((net) =>
        Promise.race([loadNetwork(net), new Promise<null>((r) => setTimeout(() => r(null), 40_000))]),
      ),
    );
    const seen = new Set<string>();
    const out: CamerasFeed["cameras"] = [];
    const networks: CamerasFeed["networks"] = [];
    for (const [i, res] of results.entries()) {
      const net = CAMERA_NETWORKS[i];
      if (!res) {
        networks.push({ id: net.id, label: net.label, count: 0, state: "loading" });
        continue;
      }
      let count = 0;
      for (const cam of res.cams) {
        // The same physical camera is often republished by a city and its state DOT.
        const at = `${cam.lat.toFixed(4)},${cam.lon.toFixed(4)}`;
        if (seen.has(at)) continue;
        seen.add(at);
        out.push(cam);
        count++;
      }
      networks.push({ id: net.id, label: net.label, count, state: res.error ? (count ? "stale" : "error") : "live", error: res.error });
    }
    if (!out.length) throw new Error("No camera network answered");
    const live = networks.filter((n) => n.count).length;
    return {
      time: Date.now(),
      provider: `${live} open-data networks`,
      cameras: out,
      networks,
      windy: Boolean(windyKey()),
    };
  });
}

async function webcams(params: URLSearchParams): Promise<CamerasFeed> {
  const lat = Number(params.get("lat"));
  const lon = Number(params.get("lon"));
  if (!windyKey() || !Number.isFinite(lat) || !Number.isFinite(lon)) {
    return { time: Date.now(), provider: "Windy Webcams", cameras: [], windy: false };
  }
  // Snap to a 1° cell so small pans share a cache entry (and Windy's quota).
  const cellLat = Math.round(lat);
  const cellLon = Math.round(lon);
  return cached(`webcams:${cellLat}:${cellLon}`, 8 * 60_000, async () => ({
    time: Date.now(),
    provider: "Windy Webcams",
    cameras: await windyNearby(cellLat, cellLon),
    windy: true,
  }));
}

// ----- Submarine cables -----------------------------------------------------

async function cables(): Promise<CablesFeed> {
  return cached("cables", 24 * 60 * 60_000, async () => {
    const data = await getJson<{
      features: {
        properties: { name: string; color: string };
        geometry: { type: string; coordinates: [number, number][] | [number, number][][] };
      }[];
    }>("https://www.submarinecablemap.com/api/v3/cable/cable-geo.json", 30_000);
    return {
      time: Date.now(),
      cables: data.features.map((f) => ({
        name: f.properties.name,
        color: f.properties.color,
        lines:
          f.geometry.type === "LineString"
            ? [f.geometry.coordinates as [number, number][]]
            : (f.geometry.coordinates as [number, number][][]),
      })),
    };
  });
}

// ----- Place search (Photon / OpenStreetMap) ------------------------------

async function search(params: URLSearchParams): Promise<SearchFeed> {
  const q = (params.get("q") ?? "").trim().slice(0, 120);
  if (!q) return { places: [] };
  const data = await getJson<{
    features: {
      properties: { name?: string; city?: string; state?: string; country?: string; extent?: number[] };
      geometry: { coordinates: [number, number] };
    }[];
  }>(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=6&lang=en`);
  const places: Place[] = data.features.map((f) => {
    const p = f.properties;
    const e = p.extent;
    return {
      name: p.name ?? q,
      detail: [p.city, p.state, p.country].filter((x) => x && x !== p.name).join(", "),
      lon: f.geometry.coordinates[0],
      lat: f.geometry.coordinates[1],
      // Photon's extent is [west, north, east, south].
      extent: e && e.length === 4 ? [e[0], e[3], e[2], e[1]] : undefined,
    };
  });
  return { places };
}

export const FEEDS = {
  flights,
  military,
  satellites,
  quakes,
  cameras,
  webcams,
  cables,
  search,
} satisfies Record<string, (params: URLSearchParams) => Promise<unknown>>;

export type FeedName = keyof typeof FEEDS;
