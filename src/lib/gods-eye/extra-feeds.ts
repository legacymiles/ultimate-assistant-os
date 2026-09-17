import "server-only";
import { cached } from "./cache";
import type { Poi, PoiFeed } from "./types";

// ---------------------------------------------------------------------------
// The extra live layers from the original's walkthrough: space missions
// (Launch Library, keyless), NASA FIRMS active fires and AISStream vessels
// (both free keys, read server-side so they never reach the browser).
// Datacenters and dams are static snapshots in public/gods-eye/ instead.
// ---------------------------------------------------------------------------

const UA = "ultimate-assistant-os/gods-eye-view (+https://ultimate-assistant-os.vercel.app)";
const env = (name: string) => process.env[name]?.trim() || "";

async function getJson<T>(url: string, timeoutMs = 30_000): Promise<T> {
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
  if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}`);
  return (await res.json()) as T;
}

// ----- Space missions (The Space Devs Launch Library) -------------------------
// Anonymous callers get 15 requests an hour, so the window is cached for an hour.

interface LlLaunch {
  id: string;
  name: string;
  net: string;
  status?: { abbrev?: string; name?: string };
  launch_service_provider?: { name?: string };
  rocket?: { configuration?: { full_name?: string } };
  mission?: { name?: string; type?: string; description?: string; orbit?: { abbrev?: string; name?: string } };
  pad?: { name?: string; latitude?: number | string; longitude?: number | string; location?: { name?: string } };
  image?: { image_url?: string; thumbnail_url?: string } | string | null;
  webcast_live?: boolean;
}

async function launches(): Promise<PoiFeed> {
  return cached("launches", 60 * 60_000, async () => {
    const day = 86_400_000;
    const from = new Date(Date.now() - 30 * day).toISOString();
    const to = new Date(Date.now() + 30 * day).toISOString();
    const data = await getJson<{ results: LlLaunch[] }>(
      `https://ll.thespacedevs.com/2.3.0/launches/?net__gte=${from}&net__lte=${to}&limit=100&ordering=net&mode=normal`,
      40_000,
    );
    const items: Poi[] = [];
    for (const l of data.results) {
      const lat = Number(l.pad?.latitude);
      const lon = Number(l.pad?.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      const when = Date.parse(l.net);
      const upcoming = when > Date.now();
      const img = typeof l.image === "string" ? l.image : l.image?.thumbnail_url || l.image?.image_url;
      items.push({
        id: l.id,
        name: l.name,
        lat,
        lon,
        sub: [l.launch_service_provider?.name, upcoming ? "UPCOMING" : l.status?.abbrev].filter(Boolean).join(" · "),
        when,
        weight: upcoming ? 1 : 0.6,
        image: img || undefined,
        fields: [
          ["STATUS", (l.status?.name ?? "—").toUpperCase()],
          ["T-ZERO", `${l.net.replace("T", " ").slice(0, 16)}Z`],
          ["VEHICLE", (l.rocket?.configuration?.full_name ?? "—").toUpperCase()],
          ["MISSION", (l.mission?.type ?? "—").toUpperCase()],
          ["ORBIT", (l.mission?.orbit?.abbrev ?? "—").toUpperCase()],
          ["PAD", (l.pad?.name ?? "—").toUpperCase()],
          ["SITE", (l.pad?.location?.name ?? "—").toUpperCase()],
        ],
        link: { href: `https://ll.thespacedevs.com/2.3.0/launches/${l.id}/`, label: "Launch Library" },
      });
    }
    return { time: Date.now(), items, note: "Launch Library · ±30 days" };
  });
}

// ----- NASA FIRMS active fires ----------------------------------------------------
// The worldwide VIIRS day is ~100k detections; the hottest few thousand keep the
// response well under Vercel's 4.5 MB cap and are the fires worth seeing anyway.

const FIRE_LIMIT = 6000;

async function fires(): Promise<PoiFeed> {
  const key = env("NASA_FIRMS_MAP_KEY");
  if (!key) return { time: Date.now(), items: [], needsKey: "NASA_FIRMS_MAP_KEY" };
  return cached("fires", 30 * 60_000, async () => {
    const res = await fetch(`https://firms.modaps.eosdis.nasa.gov/api/area/csv/${key}/VIIRS_NOAA20_NRT/world/1`, {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(50_000),
      cache: "no-store",
    });
    const text = await res.text();
    if (!res.ok || !text.startsWith("latitude")) throw new Error(`FIRMS: ${text.slice(0, 120).trim() || res.status}`);
    const [head, ...lines] = text.trim().split(/\r?\n/);
    const col = Object.fromEntries(head.split(",").map((h, i) => [h, i]));
    const rows = lines.map((l) => l.split(",")).filter((r) => r.length >= head.split(",").length - 1);
    rows.sort((a, b) => Number(b[col.frp]) - Number(a[col.frp]));
    const items: Poi[] = rows.slice(0, FIRE_LIMIT).map((r, i) => {
      const frp = Number(r[col.frp]);
      const date = r[col.acq_date];
      const hhmm = (r[col.acq_time] ?? "").padStart(4, "0");
      const when = Date.parse(`${date}T${hhmm.slice(0, 2)}:${hhmm.slice(2)}:00Z`);
      const conf = r[col.confidence];
      return {
        id: `F${i}`,
        name: `${Math.round(frp)} MW FIRE`,
        lat: Number(r[col.latitude]),
        lon: Number(r[col.longitude]),
        sub: `VIIRS NOAA-20 · ${r[col.daynight] === "N" ? "NIGHT" : "DAY"} PASS`,
        when,
        weight: Math.min(1, Math.log10(Math.max(frp, 1)) / 3),
        fields: [
          ["FRP", `${frp.toFixed(1)} MW`],
          ["CONFIDENCE", conf === "h" ? "HIGH" : conf === "n" ? "NOMINAL" : conf === "l" ? "LOW" : conf || "—"],
          ["BRIGHT T", `${r[col.bright_ti4]} K`],
          ["DETECTED", `${date} ${hhmm.slice(0, 2)}:${hhmm.slice(2)}Z`],
        ],
        link: { href: "https://firms.modaps.eosdis.nasa.gov/map/", label: "FIRMS map" },
      };
    });
    return { time: Date.now(), items, note: `NASA FIRMS · top ${items.length.toLocaleString("en-US")} by FRP · 24 h` };
  });
}

// ----- AISStream vessels -----------------------------------------------------------
// AISStream is a websocket firehose, not a snapshot API. Each request listens to
// the box around the view for a few seconds and merges what it hears into a
// fleet kept in memory, so ships stay on the map between requests.

interface Vessel {
  mmsi: number;
  name: string;
  lat: number;
  lon: number;
  cog?: number;
  sog?: number;
  heading?: number;
  status?: number;
  type?: number;
  destination?: string;
  callsign?: string;
  draught?: number;
  length?: number;
  seen: number;
}

const fleet = new Map<number, Vessel>();
const VESSEL_TTL = 20 * 60_000;
const LISTEN_MS = 7_000;

function shipType(t?: number): string {
  if (!t) return "UNKNOWN";
  if (t === 30) return "FISHING";
  if (t === 31 || t === 32 || t === 52) return "TUG / TOWING";
  if (t === 35) return "MILITARY";
  if (t === 36) return "SAILING";
  if (t === 37) return "PLEASURE CRAFT";
  if (t >= 40 && t < 50) return "HIGH-SPEED CRAFT";
  if (t === 50) return "PILOT";
  if (t === 51) return "SEARCH & RESCUE";
  if (t === 55) return "LAW ENFORCEMENT";
  if (t >= 60 && t < 70) return "PASSENGER";
  if (t >= 70 && t < 80) return "CARGO";
  if (t >= 80 && t < 90) return "TANKER";
  return "OTHER";
}

const NAV_STATUS = [
  "UNDER WAY (ENGINE)", "AT ANCHOR", "NOT UNDER COMMAND", "RESTRICTED MANOEUVRABILITY", "CONSTRAINED BY DRAUGHT",
  "MOORED", "AGROUND", "FISHING", "UNDER WAY (SAILING)",
];

type AisMessage = {
  error?: string;
  MessageType?: string;
  MetaData?: { MMSI: number; ShipName?: string; latitude: number; longitude: number };
  Message?: Record<string, Record<string, unknown>>;
};

function listen(key: string, south: number, west: number, north: number, east: number): Promise<string | null> {
  return new Promise((resolve) => {
    let error: string | null = null;
    let heard = 0;
    const ws = new WebSocket("wss://stream.aisstream.io/v0/stream");
    const finish = () => {
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        /* already closed */
      }
      resolve(heard ? null : error);
    };
    const timer = setTimeout(finish, LISTEN_MS);
    ws.onopen = () =>
      ws.send(
        JSON.stringify({
          APIKey: key,
          BoundingBoxes: [[[south, west], [north, east]]],
          FilterMessageTypes: ["PositionReport", "StandardClassBPositionReport", "ShipStaticData"],
        }),
      );
    ws.onerror = () => {
      error ??= "AISStream connection failed";
      finish();
    };
    ws.onclose = () => finish();
    ws.onmessage = async (ev) => {
      let msg: AisMessage;
      try {
        const raw = typeof ev.data === "string" ? ev.data : await new Response(ev.data as Blob).text();
        msg = JSON.parse(raw) as AisMessage;
      } catch {
        return;
      }
      if (msg.error) {
        error = `AISStream: ${msg.error}`;
        return;
      }
      const meta = msg.MetaData;
      if (!meta?.MMSI || !msg.MessageType) return;
      heard++;
      const body = msg.Message?.[msg.MessageType] ?? {};
      const v: Vessel = fleet.get(meta.MMSI) ?? { mmsi: meta.MMSI, name: "", lat: meta.latitude, lon: meta.longitude, seen: 0 };
      v.name = (meta.ShipName ?? v.name).trim();
      v.seen = Date.now();
      if (msg.MessageType === "ShipStaticData") {
        v.type = Number(body.Type) || v.type;
        v.destination = String(body.Destination ?? "").trim() || v.destination;
        v.callsign = String(body.CallSign ?? "").trim() || v.callsign;
        v.draught = Number(body.MaximumStaticDraught) || v.draught;
        const dim = body.Dimension as { A?: number; B?: number } | undefined;
        if (dim?.A || dim?.B) v.length = (dim.A ?? 0) + (dim.B ?? 0);
      } else {
        v.lat = meta.latitude;
        v.lon = meta.longitude;
        v.cog = Number(body.Cog);
        v.sog = Number(body.Sog);
        const th = Number(body.TrueHeading);
        v.heading = th >= 0 && th < 360 ? th : undefined;
        if (body.NavigationalStatus !== undefined) v.status = Number(body.NavigationalStatus);
      }
      fleet.set(meta.MMSI, v);
    };
  });
}

async function vessels(params: URLSearchParams): Promise<PoiFeed> {
  const key = env("AISSTREAM_API_KEY");
  if (!key) return { time: Date.now(), items: [], needsKey: "AISSTREAM_API_KEY" };
  const lat = Math.round(Number(params.get("lat")) || 0);
  const lon = Math.round(Number(params.get("lon")) || 0);
  const south = Math.max(-90, lat - 3);
  const north = Math.min(90, lat + 3);
  const west = Math.max(-180, lon - 4);
  const east = Math.min(180, lon + 4);

  return cached(`vessels:${lat}:${lon}`, 60_000, async () => {
    const error = await listen(key, south, west, north, east);
    const now = Date.now();
    for (const [mmsi, v] of fleet) if (now - v.seen > VESSEL_TTL) fleet.delete(mmsi);
    const items: Poi[] = [];
    for (const v of fleet.values()) {
      if (v.lat < south || v.lat > north || v.lon < west || v.lon > east) continue;
      if (!Number.isFinite(v.lat) || !Number.isFinite(v.lon) || (v.lat === 0 && v.lon === 0)) continue;
      const kind = shipType(v.type);
      items.push({
        id: String(v.mmsi),
        name: v.name || `MMSI ${v.mmsi}`,
        lat: v.lat,
        lon: v.lon,
        sub: `${kind}${v.destination ? ` → ${v.destination.toUpperCase()}` : ""}`,
        heading: v.heading ?? (Number.isFinite(v.cog) && (v.sog ?? 0) > 0.5 ? v.cog : undefined),
        speedKts: v.sog,
        weight: kind === "TANKER" || kind === "CARGO" ? 1 : 0.6,
        when: v.seen,
        fields: [
          ["MMSI", String(v.mmsi)],
          ["TYPE", kind],
          ["SOG", Number.isFinite(v.sog) ? `${v.sog!.toFixed(1)} KTS` : "—"],
          ["COG", Number.isFinite(v.cog) ? `${Math.round(v.cog!).toString().padStart(3, "0")}°` : "—"],
          ["STATUS", v.status !== undefined ? (NAV_STATUS[v.status] ?? "—") : "—"],
          ["DEST", (v.destination ?? "—").toUpperCase()],
          ["DRAUGHT", v.draught ? `${v.draught.toFixed(1)} M` : "—"],
          ["LENGTH", v.length ? `${v.length} M` : "—"],
          ["CALLSIGN", v.callsign || "—"],
        ],
        link: { href: `https://www.marinetraffic.com/en/ais/details/ships/mmsi:${v.mmsi}`, label: "MarineTraffic" },
      });
    }
    if (!items.length && error) throw new Error(error);
    return { time: now, items, note: "AISStream · live AIS around view" };
  });
}

export const LAUNCHES = launches;
export const FIRES = fires;
export const VESSELS = vessels;
