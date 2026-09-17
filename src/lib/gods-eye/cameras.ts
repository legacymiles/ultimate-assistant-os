import "server-only";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Camera } from "./types";

// ---------------------------------------------------------------------------
// Public traffic-camera networks for the CCTV layer.
//
// Every source here is an official, keyless open-data feed published by a
// transport agency for exactly this use (traffic stills on a map). Each network
// is loaded and cached on its own, so one slow or broken agency never blanks
// the rest — the layer shows whatever answered, and the last good list per
// network is kept in memory and in tmpdir so a cold start doesn't refetch
// ~20 000 cameras page by page.
// ---------------------------------------------------------------------------

const UA = "ultimate-assistant-os/gods-eye-view (+https://ultimate-assistant-os.vercel.app)";
const LIST_TTL_MS = 6 * 60 * 60_000; // camera locations change rarely; the stills themselves are live
// Bump the folder when the Camera shape changes, so no instance serves an old-shape list.
const DISK_DIR = join(tmpdir(), "gods-eye-view", "cameras-v2");

export interface CameraNetwork {
  id: string;
  label: string;
  load: () => Promise<Camera[]>;
}

async function get(url: string, timeoutMs = 30_000): Promise<Response> {
  const res = await fetch(url, {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(timeoutMs),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}`);
  return res;
}

const json = async <T>(url: string, timeoutMs?: number) => (await (await get(url, timeoutMs)).json()) as T;
const text = async (url: string, timeoutMs?: number) => (await get(url, timeoutMs)).text();

const validPos = (lat: number, lon: number) =>
  Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0);

/** Run `fn` over `items` with at most `limit` in flight. */
async function pool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

/** First `<tag>` value inside an XML fragment, entity-decoded. */
function xmlTag(xml: string, tag: string): string {
  const m = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  return (m?.[1] ?? "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .trim();
}

// ----- TfL JamCams (London) -------------------------------------------------

async function tfl(): Promise<Camera[]> {
  const data = await json<
    { id: string; commonName: string; lat: number; lon: number; additionalProperties: { key: string; value: string }[] }[]
  >("https://api.tfl.gov.uk/Place/Type/JamCam");
  const out: Camera[] = [];
  for (const c of data) {
    const props = Object.fromEntries(c.additionalProperties.map((p) => [p.key, p.value]));
    if (props.available === "false" || !props.imageUrl || !validPos(c.lat, c.lon)) continue;
    out.push({
      id: c.id.replace("JamCams_", "LDN-"),
      name: c.commonName,
      lon: c.lon,
      lat: c.lat,
      image: props.imageUrl,
      video: props.videoUrl,
      view: props.view,
      source: "TfL JamCams · London",
    });
  }
  return out;
}

// ----- "511" traveller-information sites -------------------------------------
// Many US state DOTs and Canadian provinces run the same 511 platform, which
// exposes its camera list as a paged DataTables endpoint (100 rows a page).

const FIVE_ONE_ONE: { id: string; host: string; label: string }[] = [
  { id: "FL", host: "www.fl511.com", label: "FL511 · Florida" },
  { id: "GA", host: "511ga.org", label: "511GA · Georgia" },
  { id: "NY", host: "511ny.org", label: "511NY · New York" },
  { id: "UT", host: "udottraffic.utah.gov", label: "UDOT Traffic · Utah" },
  { id: "PA", host: "www.511pa.com", label: "511PA · Pennsylvania" },
  { id: "ON", host: "511on.ca", label: "Ontario 511" },
  { id: "AZ", host: "www.az511.com", label: "AZ511 · Arizona" },
  { id: "NV", host: "www.nvroads.com", label: "NVRoads · Nevada" },
  { id: "WI", host: "511wi.gov", label: "511WI · Wisconsin" },
  { id: "ID", host: "511.idaho.gov", label: "Idaho 511" },
  { id: "NE", host: "newengland511.org", label: "New England 511" },
  { id: "CT", host: "ctroads.org", label: "CTroads · Connecticut" },
  { id: "AB", host: "511.alberta.ca", label: "511 Alberta" },
  { id: "LA", host: "www.511la.org", label: "511LA · Louisiana" },
  { id: "AK", host: "511.alaska.gov", label: "Alaska 511" },
];

interface FiveOneOneRow {
  id: number;
  location?: string;
  roadway?: string;
  direction?: string;
  latLng?: { geography?: { wellKnownText?: string } };
  images?: {
    imageUrl?: string;
    description?: string;
    disabled?: boolean;
    blocked?: boolean;
    videoUrl?: string;
    videoType?: string;
    videoDisabled?: boolean;
    isVideoAuthRequired?: boolean;
  }[];
}

function fiveOneOne(site: (typeof FIVE_ONE_ONE)[number]) {
  return async (): Promise<Camera[]> => {
    const page = (start: number) => {
      const query = JSON.stringify({ columns: [], order: [], start, length: 100, search: { value: "" } });
      return json<{ recordsTotal: number; data: FiveOneOneRow[] }>(
        `https://${site.host}/List/GetData/Cameras?query=${encodeURIComponent(query)}&lang=en`,
      );
    };
    const first = await page(0);
    const starts: number[] = [];
    for (let s = 100; s < Math.min(first.recordsTotal, 20_000); s += 100) starts.push(s);
    const rest = await pool(starts, 4, (s) => page(s).then((p) => p.data).catch(() => [] as FiveOneOneRow[]));

    const byId = new Map<number, Camera>();
    for (const row of [first.data, ...rest].flat()) {
      const m = row.latLng?.geography?.wellKnownText?.match(/POINT\s*\(\s*(-?[\d.]+)\s+(-?[\d.]+)/);
      const img = row.images?.find((i) => i.imageUrl && !i.disabled && !i.blocked);
      if (!m || !img || byId.has(row.id)) continue;
      const lon = Number(m[1]);
      const lat = Number(m[2]);
      if (!validPos(lat, lon)) continue;
      const dir = row.direction && row.direction !== "Unknown" ? row.direction : "";
      byId.set(row.id, {
        id: `${site.id}-${row.id}`,
        name: row.location || img.description || row.roadway || `Camera ${row.id}`,
        lon,
        lat,
        image: `https://${site.host}${img.imageUrl}`,
        // Some DOTs (NY, NV, WI, LA) publish open HLS; others gate video behind a login.
        hls:
          img.videoUrl?.startsWith("https://") && !img.isVideoAuthRequired && !img.videoDisabled && /mpegurl|m3u8/i.test(`${img.videoType} ${img.videoUrl}`)
            ? img.videoUrl
            : undefined,
        view:
          [row.roadway && row.roadway !== "Unknown" && row.roadway !== row.location ? row.roadway : "", dir]
            .filter(Boolean)
            .join(" · ") || undefined,
        source: site.label,
      });
    }
    return [...byId.values()];
  };
}

// ----- NYC DOT ---------------------------------------------------------------

async function nycdot(): Promise<Camera[]> {
  const data = await json<
    { id: string; name: string; latitude: number; longitude: number; area?: string; isOnline: string; imageUrl: string }[]
  >("https://webcams.nyctmc.org/api/cameras");
  return data
    .filter((c) => c.isOnline === "true" && c.imageUrl && validPos(c.latitude, c.longitude))
    .map((c) => ({
      id: `NYC-${c.id.slice(0, 8).toUpperCase()}`,
      name: c.name,
      lat: c.latitude,
      lon: c.longitude,
      image: c.imageUrl,
      view: c.area,
      source: "NYC DOT",
    }));
}

// ----- Caltrans (California, 12 districts) ------------------------------------

async function caltrans(): Promise<Camera[]> {
  const districts = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, "0"));
  const lists = await pool(districts, 4, async (d) => {
    try {
      const data = await json<{
        data: {
          cctv: {
            index: string;
            inService: string;
            location: { locationName: string; nearbyPlace?: string; latitude: string; longitude: string; direction?: string; route?: string };
            imageData?: { streamingVideoURL?: string; static?: { currentImageURL?: string } };
          };
        }[];
      }>(`https://cwwp2.dot.ca.gov/data/d${Number(d)}/cctv/cctvStatusD${d}.json`, 60_000);
      return data.data.flatMap(({ cctv: c }): Camera[] => {
        const lat = Number(c.location.latitude);
        const lon = Number(c.location.longitude);
        const image = c.imageData?.static?.currentImageURL;
        if (c.inService !== "true" || !image || !validPos(lat, lon)) return [];
        return [
          {
            id: `CA${d}-${c.index}`,
            name: [c.location.locationName.replace(/^\S+\s+--\s+/, ""), c.location.nearbyPlace].filter(Boolean).join(" · "),
            lat,
            lon,
            image,
            hls: c.imageData?.streamingVideoURL?.startsWith("https://") ? c.imageData.streamingVideoURL : undefined,
            view: [c.location.route, c.location.direction].filter(Boolean).join(" · ") || undefined,
            source: `Caltrans · District ${Number(d)}`,
          },
        ];
      });
    } catch {
      return [];
    }
  });
  const all = lists.flat();
  if (!all.length) throw new Error("Caltrans returned no cameras");
  return all;
}

// ----- DriveBC (British Columbia) ---------------------------------------------

async function drivebc(): Promise<Camera[]> {
  const data = await json<
    {
      id: number;
      name: string;
      caption?: string;
      orientation?: string;
      is_on: boolean;
      should_appear: boolean;
      links: { imageDisplay: string };
      location: { coordinates: [number, number] };
    }[]
  >("https://www.drivebc.ca/api/webcams/", 60_000);
  return data.flatMap((c): Camera[] => {
    const [lon, lat] = c.location?.coordinates ?? [NaN, NaN];
    if (!c.is_on || !c.should_appear || !c.links?.imageDisplay || !validPos(lat, lon)) return [];
    return [
      {
        id: `BC-${c.id}`,
        name: c.name,
        lat,
        lon,
        // Strip DriveBC's own cache-buster; the viewer appends its own.
        image: `https://www.drivebc.ca${c.links.imageDisplay.split("?")[0]}`,
        view: c.orientation ? `Looking ${c.orientation}` : c.caption,
        source: "DriveBC · British Columbia",
      },
    ];
  });
}

// ----- Digitraffic weather cams (Finland) -------------------------------------

async function finland(): Promise<Camera[]> {
  const data = await json<{
    features: {
      id: string;
      geometry: { coordinates: [number, number] };
      properties: { name: string; collectionStatus: string; presets: { id: string; inCollection: boolean }[] };
    }[];
  }>("https://tie.digitraffic.fi/api/weathercam/v1/stations");
  return data.features.flatMap((f): Camera[] => {
    const [lon, lat] = f.geometry.coordinates;
    const preset = f.properties.presets.find((p) => p.inCollection);
    if (f.properties.collectionStatus !== "GATHERING" || !preset || !validPos(lat, lon)) return [];
    return [
      {
        id: `FI-${f.id}`,
        name: f.properties.name.replace(/^[a-z]+\d+_/i, "").replace(/_/g, " "),
        lat,
        lon,
        image: `https://weathercam.digitraffic.fi/${preset.id}.jpg`,
        source: "Fintraffic Digitraffic · Finland",
      },
    ];
  });
}

// ----- NZTA traffic cameras (New Zealand) --------------------------------------

async function newZealand(): Promise<Camera[]> {
  const xml = await text("https://trafficnz.info/service/traffic/rest/4/cameras/all");
  const out: Camera[] = [];
  for (const block of xml.match(/<camera>[\s\S]*?<\/camera>/g) ?? []) {
    // Journey sub-records carry their own <name>/<id> tags.
    const cam = block.replace(/<journey>[\s\S]*?<\/journey>/g, "").replace(/<journeyLeg>[\s\S]*?<\/journeyLeg>/g, "");
    const lat = Number(xmlTag(cam, "latitude"));
    const lon = Number(xmlTag(cam, "longitude"));
    const image = xmlTag(cam, "imageUrl");
    if (xmlTag(cam, "offline") === "true" || !image || !validPos(lat, lon)) continue;
    out.push({
      id: `NZ-${xmlTag(cam, "id")}`,
      name: xmlTag(cam, "name") || xmlTag(cam, "description"),
      lat,
      lon,
      image: image.startsWith("http") ? image : `https://trafficnz.info${image}`,
      view: xmlTag(cam, "description") || undefined,
      source: "NZTA · New Zealand",
    });
  }
  return out;
}

// ----- Transport Department (Hong Kong) ----------------------------------------

async function hongKong(): Promise<Camera[]> {
  const xml = await text("https://static.data.gov.hk/td/traffic-snapshot-images/code/Traffic_Camera_Locations_En.xml");
  const out: Camera[] = [];
  for (const block of xml.match(/<image>[\s\S]*?<\/image>/g) ?? []) {
    const lat = Number(xmlTag(block, "latitude"));
    const lon = Number(xmlTag(block, "longitude"));
    const image = xmlTag(block, "url");
    if (!image || !validPos(lat, lon)) continue;
    out.push({
      id: `HK-${xmlTag(block, "key")}`,
      name: xmlTag(block, "description").replace(/\s*\[[^\]]+\]$/, ""),
      lat,
      lon,
      image,
      view: [xmlTag(block, "district"), xmlTag(block, "region")].filter(Boolean).join(" · ") || undefined,
      source: "Transport Department · Hong Kong",
    });
  }
  return out;
}

// ----- LTA (Singapore) ------------------------------------------------------------

async function singapore(): Promise<Camera[]> {
  const data = await json<{
    items: { cameras: { camera_id: string; image: string; location: { latitude: number; longitude: number } }[] }[];
  }>("https://api.data.gov.sg/v1/transport/traffic-images");
  return (data.items[0]?.cameras ?? [])
    .filter((c) => validPos(c.location.latitude, c.location.longitude))
    .map((c) => ({
      id: `SG-${c.camera_id}`,
      name: `LTA traffic camera ${c.camera_id}`,
      lat: c.location.latitude,
      lon: c.location.longitude,
      image: c.image,
      source: "LTA · Singapore",
    }));
}

export const CAMERA_NETWORKS: CameraNetwork[] = [
  { id: "tfl", label: "TfL · London", load: tfl },
  ...FIVE_ONE_ONE.map((s) => ({ id: `511-${s.id.toLowerCase()}`, label: s.label, load: fiveOneOne(s) })),
  { id: "nycdot", label: "NYC DOT", load: nycdot },
  { id: "caltrans", label: "Caltrans", load: caltrans },
  { id: "drivebc", label: "DriveBC", load: drivebc },
  { id: "finland", label: "Digitraffic · Finland", load: finland },
  { id: "nz", label: "NZTA · New Zealand", load: newZealand },
  { id: "hk", label: "TD · Hong Kong", load: hongKong },
  // LTA stills are signed per-snapshot URLs, so this list must stay fresh.
  { id: "sg", label: "LTA · Singapore", load: singapore },
];

const SHORT_TTL: Record<string, number> = { sg: 60_000, tfl: 10 * 60_000 };

// ----- Per-network caching ---------------------------------------------------------

type Entry = { at: number; cams: Camera[] };
const memory = new Map<string, Entry>();
const inflight = new Map<string, Promise<Entry>>();

async function readDisk(id: string): Promise<Entry | null> {
  try {
    const e = JSON.parse(await readFile(join(DISK_DIR, `${id}.json`), "utf8")) as Entry;
    return e.cams?.length ? e : null;
  } catch {
    return null;
  }
}

async function writeDisk(id: string, e: Entry) {
  try {
    await mkdir(DISK_DIR, { recursive: true });
    await writeFile(join(DISK_DIR, `${id}.json`), JSON.stringify(e));
  } catch {
    /* read-only filesystem: memory cache still works */
  }
}

export interface NetworkResult {
  id: string;
  label: string;
  cams: Camera[];
  stale: boolean;
  error?: string;
}

/** Load one network, preferring a fresh cache and falling back to the last good list. */
export async function loadNetwork(net: CameraNetwork): Promise<NetworkResult> {
  const ttl = SHORT_TTL[net.id] ?? LIST_TTL_MS;
  const base = { id: net.id, label: net.label };
  let hit = memory.get(net.id) ?? null;
  if (!hit && ttl >= LIST_TTL_MS) {
    hit = await readDisk(net.id);
    if (hit) memory.set(net.id, hit);
  }
  if (hit && Date.now() - hit.at < ttl) return { ...base, cams: hit.cams, stale: false };

  let p = inflight.get(net.id);
  if (!p) {
    p = net
      .load()
      .then(async (cams) => {
        if (!cams.length) throw new Error("no cameras returned");
        const e = { at: Date.now(), cams };
        memory.set(net.id, e);
        if (ttl >= LIST_TTL_MS) await writeDisk(net.id, e);
        return e;
      })
      .finally(() => inflight.delete(net.id));
    inflight.set(net.id, p);
  }
  try {
    const e = await p;
    return { ...base, cams: e.cams, stale: false };
  } catch (err) {
    const error = err instanceof Error ? err.message : "unavailable";
    return hit ? { ...base, cams: hit.cams, stale: true, error } : { ...base, cams: [], stale: true, error };
  }
}

// ----- Windy webcams (optional, worldwide) ----------------------------------------
// Windy's webcam directory covers most countries the open-data agencies don't,
// but it needs a (free) API key and its image URLs are short-lived tokens, so it
// is queried around the viewer's current position instead of cached globally.

export const windyKey = () => process.env.WINDY_WEBCAMS_API_KEY?.trim() || "";

export async function windyNearby(lat: number, lon: number): Promise<Camera[]> {
  const key = windyKey();
  if (!key) return [];
  type WindyCam = {
    webcamId: number;
    title: string;
    status?: string;
    location?: { latitude: number; longitude: number; city?: string; country?: string };
    images?: { current?: { preview?: string } };
  };
  // 50 per request is Windy's cap; a busy city has hundreds within 250 km, so page a little.
  const page = async (offset: number) => {
    const url =
      `https://api.windy.com/webcams/api/v3/webcams?nearby=${lat.toFixed(2)},${lon.toFixed(2)},250` +
      `&limit=50&offset=${offset}&include=images,location&lang=en`;
    const res = await fetch(url, {
      headers: { "User-Agent": UA, "x-windy-api-key": key },
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`api.windy.com answered ${res.status}`);
    return (await res.json()) as { total?: number; webcams?: WindyCam[] };
  };
  const first = await page(0);
  const offsets = [50, 100, 150].filter((o) => o < (first.total ?? 0));
  const more = await Promise.all(offsets.map((o) => page(o).catch(() => ({ webcams: [] as WindyCam[] }))));
  const data = { webcams: [first, ...more].flatMap((d) => d.webcams ?? []) };
  return (data.webcams ?? []).flatMap((w): Camera[] => {
    const lat = w.location?.latitude ?? NaN;
    const lon = w.location?.longitude ?? NaN;
    const image = w.images?.current?.preview;
    if (w.status === "inactive" || !image || !validPos(lat, lon)) return [];
    return [
      {
        id: `WC-${w.webcamId}`,
        name: w.title,
        lat,
        lon,
        image,
        view: [w.location?.city, w.location?.country].filter(Boolean).join(", ") || undefined,
        source: "Windy Webcams",
      },
    ];
  });
}
