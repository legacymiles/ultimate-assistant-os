import "server-only";
import { cached } from "./cache";
import { rangeBearing } from "./geo";

// ---------------------------------------------------------------------------
// The radio scanner: real audio you can listen to around wherever the globe
// is looking.
//
//   WEATHER  NOAA Weather Radio transmitters, streamed over SSL by WXRadio.org
//            (a service of noaaweatherradio.org). Callsign, frequency and
//            transmitter position come from the NWS station list.
//   SCANNER  Police / fire / EMS / ATC / weather feeds tagged as such in the
//            community Radio Browser directory.
//   LOCAL    Ordinary broadcast stations near the view, from Radio Browser.
//
// Only https streams are returned: the hub is served over https and browsers
// block plain-http audio on it.
// ---------------------------------------------------------------------------

const UA = "ultimate-assistant-os/gods-eye-view (+https://ultimate-assistant-os.vercel.app)";
const RB_HOSTS = ["de1.api.radio-browser.info", "de2.api.radio-browser.info", "fi1.api.radio-browser.info"];

export type RadioKind = "weather" | "scanner" | "local";

export interface RadioStation {
  id: string;
  kind: RadioKind;
  name: string;
  /** e.g. "162.550 MHz" when the station has one. */
  freq?: string;
  place: string;
  lat: number;
  lon: number;
  distanceKm: number;
  url: string;
  codec?: string;
  bitrate?: number;
  homepage?: string;
  /** Whether the stream host sends CORS headers, so the level meter can read it. */
  cors?: boolean;
}

export interface RadioFeed {
  time: number;
  stations: RadioStation[];
  note: string;
}

async function getText(url: string, timeoutMs = 25_000): Promise<string> {
  const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
  if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}`);
  return res.text();
}

// ----- NOAA Weather Radio ------------------------------------------------------

interface NwrSite {
  callsign: string;
  freq: string;
  name: string;
  state: string;
  lat: number;
  lon: number;
}

/** The NWS transmitter list is a JS file of parallel arrays: `CALLSIGN[12] = "WNG527";`. */
async function nwrSites(): Promise<Map<string, NwrSite>> {
  return cached("radio:nwr-sites", 24 * 60 * 60_000, async () => {
    const js = await getText("https://www.weather.gov/source/nwr/JS/CCL.js", 40_000);
    const cols: Record<string, Map<number, string>> = {};
    for (const m of js.matchAll(/^(CALLSIGN|FREQ|LAT|LON|SITENAME|SITESTATE)\[(\d+)\]\s*=\s*"([^"]*)";/gm)) {
      (cols[m[1]] ??= new Map()).set(Number(m[2]), m[3]);
    }
    const out = new Map<string, NwrSite>();
    for (const [i, callsign] of cols.CALLSIGN ?? []) {
      const lat = Number(cols.LAT?.get(i));
      const lon = Number(cols.LON?.get(i));
      if (!callsign || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      out.set(callsign.toUpperCase(), {
        callsign: callsign.toUpperCase(),
        freq: cols.FREQ?.get(i) ?? "",
        name: cols.SITENAME?.get(i) ?? "",
        state: cols.SITESTATE?.get(i) ?? "",
        lat,
        lon,
      });
    }
    return out;
  }) as Promise<Map<string, NwrSite>>;
}

interface WxMount {
  mount: string;
  callsign: string;
  title: string;
}

async function wxMounts(): Promise<WxMount[]> {
  return cached("radio:wx-mounts", 20 * 60_000, async () => {
    // Icecast writes `"title": -,` for silent mounts, which isn't JSON.
    const raw = (await getText("https://wxradio.org/status-json.xsl")).replace(/:\s*-\s*,/g, ": null,");
    const data = JSON.parse(raw) as { icestats?: { source?: { listenurl?: string; server_name?: string; server_description?: string }[] | object } };
    const sources = ([] as { listenurl?: string; server_name?: string; server_description?: string }[]).concat(
      (data.icestats?.source as never) ?? [],
    );
    return sources.flatMap((s): WxMount[] => {
      const mount = s.listenurl?.split("/").pop();
      if (!mount) return [];
      const callsign = mount.split("-").pop()!.toUpperCase();
      const desc = [s.server_description, s.server_name].find((x) => x && !/^unspecified/i.test(x));
      return [{ mount, callsign, title: desc ?? mount.replace(/-/g, " ") }];
    });
  });
}

async function weatherStations(lat: number, lon: number): Promise<RadioStation[]> {
  const [mounts, sites] = await Promise.all([wxMounts(), nwrSites().catch(() => new Map<string, NwrSite>())]);
  const out: RadioStation[] = [];
  for (const m of mounts) {
    const site = sites.get(m.callsign);
    if (!site) continue; // no transmitter position (e.g. Environment Canada mounts): can't place it on the globe
    const { km } = rangeBearing(lat, lon, site.lat, site.lon);
    out.push({
      id: `nwr:${m.mount}`,
      kind: "weather",
      name: `NOAA WEATHER RADIO ${site.callsign}`,
      freq: site.freq ? `${site.freq} MHz` : undefined,
      place: `${site.name}, ${site.state}`,
      lat: site.lat,
      lon: site.lon,
      distanceKm: km,
      url: `https://wxradio.org/${m.mount}`,
      codec: "MP3",
      homepage: `https://www.weather.gov/nwr/sites?site=${site.callsign}`,
      cors: true,
    });
  }
  return out.sort((a, b) => a.distanceKm - b.distanceKm).slice(0, 12);
}

// ----- Radio Browser -------------------------------------------------------------

interface RbStation {
  stationuuid: string;
  name: string;
  url_resolved: string;
  homepage?: string;
  tags?: string;
  country?: string;
  state?: string;
  codec?: string;
  bitrate?: number;
  geo_lat?: number | null;
  geo_long?: number | null;
  lastcheckok?: number;
  clickcount?: number;
}

async function rb<T>(path: string): Promise<T> {
  let last: unknown;
  for (const host of RB_HOSTS) {
    try {
      return JSON.parse(await getText(`https://${host}/json/${path}`, 15_000)) as T;
    } catch (err) {
      last = err;
    }
  }
  throw last instanceof Error ? last : new Error("Radio Browser unavailable");
}

const SCANNER_TAGS = ["scanner", "police", "fire", "emergency", "atc", "air traffic control", "weather", "noaa weather radio", "ems"];
const FREQ_IN_NAME = /\b(1[0-9]{2}\.\d{1,3}|[89]\d\.\d)\s*(mhz|fm)?\b/i;

function fromRb(s: RbStation, kind: RadioKind, lat: number, lon: number): RadioStation | null {
  const url = s.url_resolved?.trim();
  if (!url?.startsWith("https://") || s.lastcheckok === 0) return null;
  const sLat = Number(s.geo_lat);
  const sLon = Number(s.geo_long);
  if (!Number.isFinite(sLat) || !Number.isFinite(sLon) || (sLat === 0 && sLon === 0)) return null;
  const freq = s.name.match(FREQ_IN_NAME)?.[1];
  return {
    id: `rb:${s.stationuuid}`,
    kind,
    name: s.name.trim().replace(/\s+/g, " ").slice(0, 60),
    freq: freq ? `${freq} ${Number(freq) >= 108 ? "MHz" : "FM"}` : undefined,
    place: [s.state, s.country].filter(Boolean).join(", "),
    lat: sLat,
    lon: sLon,
    distanceKm: rangeBearing(lat, lon, sLat, sLon).km,
    url,
    codec: s.codec || undefined,
    bitrate: s.bitrate || undefined,
    homepage: s.homepage || undefined,
  };
}

async function scannerDirectory(): Promise<RbStation[]> {
  return cached("radio:scanner-dir", 6 * 60 * 60_000, async () => {
    const lists = await Promise.all(
      SCANNER_TAGS.map((t) => rb<RbStation[]>(`stations/bytagexact/${encodeURIComponent(t)}?hidebroken=true&limit=500`).catch(() => [])),
    );
    const byId = new Map<string, RbStation>();
    for (const s of lists.flat()) byId.set(s.stationuuid, s);
    return [...byId.values()];
  });
}

async function scanners(lat: number, lon: number): Promise<RadioStation[]> {
  const dir = await scannerDirectory();
  return dir
    .map((s) => fromRb(s, "scanner", lat, lon))
    .filter((s): s is RadioStation => !!s)
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, 12);
}

async function localStations(lat: number, lon: number): Promise<RadioStation[]> {
  const cellLat = Math.round(lat * 2) / 2;
  const cellLon = Math.round(lon * 2) / 2;
  return cached(`radio:local:${cellLat}:${cellLon}`, 30 * 60_000, async () => {
    const list = await rb<RbStation[]>(
      `stations/search?geo_lat=${cellLat}&geo_long=${cellLon}&geo_distance=200000&hidebroken=true&order=clickcount&reverse=true&limit=150`,
    );
    return list
      .map((s) => fromRb(s, "local", lat, lon))
      .filter((s): s is RadioStation => !!s)
      .slice(0, 30);
  });
}

export async function radio(params: URLSearchParams): Promise<RadioFeed> {
  const lat = Number(params.get("lat"));
  const lon = Number(params.get("lon"));
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error("radio needs lat and lon");
  const [weather, scanner, local] = await Promise.allSettled([weatherStations(lat, lon), scanners(lat, lon), localStations(lat, lon)]);
  const stations = [weather, scanner, local].flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  if (!stations.length) {
    const why = [weather, scanner, local].find((r): r is PromiseRejectedResult => r.status === "rejected");
    throw new Error(why?.reason instanceof Error ? why.reason.message : "No radio sources answered");
  }
  // Recompute distances for cached local lists that were built around a nearby cell.
  for (const s of stations) s.distanceKm = rangeBearing(lat, lon, s.lat, s.lon).km;
  return { time: Date.now(), stations, note: "WXRadio.org · NWS · Radio Browser" };
}
