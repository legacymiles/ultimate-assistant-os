import "server-only";
import { aiEndpoint, aiFetch } from "@/lib/ai/provider";
import { FEEDS } from "./feeds";
import { rangeBearing } from "./geo";
import type { Place } from "./types";

// ---------------------------------------------------------------------------
// The God's Eye View voice agent.
//
// The original drives the globe with OpenAI's Realtime API. Here the browser
// does speech-to-text and text-to-speech itself, and each utterance goes to a
// tool-calling Claude model through the hub's AI provider. Tools that need the
// server (geocoding, routing, "where am I") run here inside the loop; tools
// that move the globe come back as `actions` for the browser to apply, in order.
// ---------------------------------------------------------------------------

export const AGENT_MODELS = {
  std: "anthropic/claude-sonnet-5",
  mini: "anthropic/claude-haiku-4.5",
} as const;
export type AgentModel = keyof typeof AGENT_MODELS;

export const AGENT_LAYERS = [
  "flights", "military", "satellites", "quakes", "cctv", "cables", "launches", "vessels", "traffic", "fires", "datacenters", "dams",
] as const;
export const AGENT_STYLES = ["normal", "crt", "nvg", "flir", "anime", "noir", "snow"] as const;

export interface AgentContext {
  view: { lat: number; lon: number; alt: number; heading: number; pitch: number };
  center?: { lat: number; lon: number };
  selection?: { layer: string; title: string; subtitle: string; fields: [string, string][] } | null;
  layers: string[];
  style: string;
  hud: string;
  cockpit?: string | null;
  nearby?: string[];
  radio?: string | null;
  marks?: string[];
  hasRoute?: boolean;
}

export type AgentAction =
  | { type: "fly"; lat: number; lon: number; range: number; heading: number; pitch: number; label: string }
  | { type: "layers"; set: Record<string, boolean> }
  | { type: "style"; style: string }
  | { type: "hud"; mode: "tactical" | "minimal" | "clean" }
  | { type: "detect"; mode: "off" | "sparse" | "dense" }
  | { type: "track"; query: string }
  | { type: "untrack" }
  | { type: "cockpit"; on: boolean }
  | { type: "reset" }
  | { type: "celestial"; on: boolean }
  | { type: "mark"; label: string; lat: number; lon: number }
  | { type: "orbit"; on: boolean; lat?: number; lon?: number; range?: number }
  | { type: "route"; label: string; coords: [number, number][]; distanceKm: number; durationMin: number; profile: string }
  | { type: "flyRoute" }
  | { type: "clear" }
  | { type: "radio"; action: "play" | "stop" | "next" | "prev" | "pause" | "resume"; kind?: "weather" | "scanner" | "local" };

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

type Json = Record<string, unknown>;
const fn = (name: string, description: string, properties: Json, required: string[] = []) => ({
  type: "function",
  function: { name, description, parameters: { type: "object", properties, required, additionalProperties: false } },
});

const TOOLS = [
  fn(
    "fly_to",
    "Move the camera to a place. Give lat/lon when you know them (landmarks, airports, bases, 'the busiest airport in X'); otherwise give a place name to geocode.",
    {
      place: { type: "string", description: "Name to show and to geocode when lat/lon are omitted" },
      lat: { type: "number" },
      lon: { type: "number" },
      range_m: { type: "number", description: "Camera distance from the target in metres. City ~15000, landmark ~2500, country ~1500000, region ~400000" },
      heading: { type: "number", description: "Degrees clockwise from north, default 0" },
      pitch: { type: "number", description: "Degrees, -90 straight down, default -40" },
    },
    ["place"],
  ),
  fn("describe_view", "Look up what is at the centre of the screen right now (reverse geocode). Use before answering 'what is this / tell me about this place'.", {}),
  fn(
    "set_layers",
    `Turn data layers on or off. Layers: ${AGENT_LAYERS.join(", ")}. flights=live commercial aircraft, cctv=public traffic cameras, launches=space missions, vessels=AIS ships, traffic=street traffic, fires=NASA FIRMS active fires.`,
    { layers: { type: "object", description: "Map of layer id to true/false", additionalProperties: { type: "boolean" } } },
    ["layers"],
  ),
  fn("set_style", `Switch the sensor look: ${AGENT_STYLES.join(", ")} (nvg=night vision, flir=thermal).`, { style: { type: "string", enum: [...AGENT_STYLES] } }, ["style"]),
  fn("set_hud", "Change the HUD: tactical (full), minimal, clean (hidden, for cinematics).", { mode: { type: "string", enum: ["tactical", "minimal", "clean"] } }, ["mode"]),
  fn("set_detection", "Bounding-box labels on contacts: off, sparse or dense.", { mode: { type: "string", enum: ["off", "sparse", "dense"] } }, ["mode"]),
  fn("track", "Lock the camera onto an aircraft callsign (e.g. DAL3146) or satellite (ISS, CSS, HST, a Starlink name).", { query: { type: "string" } }, ["query"]),
  fn("untrack", "Release the camera lock.", {}),
  fn("cockpit", "Enter (on=true) first-person cockpit view of the selected or nearest aircraft, or leave it (on=false).", { on: { type: "boolean" } }, ["on"]),
  fn("reset_globe", "Zoom back out to the whole Earth.", {}),
  fn("celestial", "Show or hide the real sun, moon and day/night lighting.", { on: { type: "boolean" } }, ["on"]),
  fn(
    "mark_place",
    "Drop a labelled 3D marker on the globe.",
    { label: { type: "string" }, lat: { type: "number" }, lon: { type: "number" }, place: { type: "string", description: "Geocoded if lat/lon omitted" } },
    ["label"],
  ),
  fn(
    "orbit",
    "Start a slow camera orbit around a point (defaults to the screen centre), or stop orbiting.",
    { on: { type: "boolean" }, lat: { type: "number" }, lon: { type: "number" }, range_m: { type: "number" } },
    ["on"],
  ),
  fn(
    "draw_route",
    "Plan and draw a real road/foot/bike route between two places. Use 'here' for the screen centre.",
    {
      from: { type: "string" },
      to: { type: "string" },
      from_lat: { type: "number" },
      from_lon: { type: "number" },
      to_lat: { type: "number" },
      to_lon: { type: "number" },
      profile: { type: "string", enum: ["driving", "walking", "cycling"] },
    },
    ["from", "to"],
  ),
  fn("fly_route", "Fly the camera along the route that was last drawn.", {}),
  fn("clear_annotations", "Remove all markers, routes and orbits.", {}),
  fn(
    "radio",
    "Control the radio scanner: play (optionally a kind: weather = NOAA Weather Radio, scanner = police/fire/ATC, local = broadcast stations), next, prev, pause, resume, stop.",
    { action: { type: "string", enum: ["play", "next", "prev", "pause", "resume", "stop"] }, kind: { type: "string", enum: ["weather", "scanner", "local"] } },
    ["action"],
  ),
];

function systemPrompt(ctx: AgentContext): string {
  const v = ctx.view;
  const lines = [
    "You are the voice agent inside God's Eye View, a spy-satellite style 3D globe with live public data (aircraft, satellites, earthquakes, traffic cameras, ships, fires, launches, submarine cables).",
    "The user talks to you by voice. Your text reply is read aloud, so: plain spoken English, no markdown, no lists, no emoji, usually one or two short sentences. Sound like calm mission control.",
    "Do what they ask with tools, chaining several when needed (for example: turn on a layer, fly somewhere, then mark it). You may answer questions from your own knowledge; when asked about 'this' place, call describe_view first.",
    "When you know a place's coordinates well (airports, military bases, landmarks, cities), pass lat and lon to fly_to instead of relying on geocoding. Pick a sensible range_m.",
    "Never invent live data (callsigns, counts) that isn't in the context below.",
    "",
    "CURRENT STATE",
    `Camera: ${v.lat.toFixed(4)}, ${v.lon.toFixed(4)} at ${Math.round(v.alt).toLocaleString("en-US")} m altitude, heading ${Math.round(v.heading)}°, pitch ${Math.round(v.pitch)}°.`,
  ];
  if (ctx.center) lines.push(`Screen centre on the ground: ${ctx.center.lat.toFixed(4)}, ${ctx.center.lon.toFixed(4)}.`);
  lines.push(`Layers on: ${ctx.layers.join(", ") || "none"}. Style: ${ctx.style}. HUD: ${ctx.hud}.`);
  if (ctx.cockpit) lines.push(`In cockpit view of ${ctx.cockpit}.`);
  if (ctx.selection) {
    lines.push(
      `Selected: ${ctx.selection.title} (${ctx.selection.layer}; ${ctx.selection.subtitle}). ${ctx.selection.fields.map(([k, val]) => `${k} ${val}`).join("; ")}`,
    );
  }
  if (ctx.nearby?.length) lines.push(`Nearby contacts: ${ctx.nearby.slice(0, 15).join("; ")}.`);
  if (ctx.radio) lines.push(`Radio: ${ctx.radio}.`);
  if (ctx.marks?.length) lines.push(`Markers: ${ctx.marks.join("; ")}.`);
  if (ctx.hasRoute) lines.push("A route is drawn and can be flown.");
  lines.push(`Current UTC time: ${new Date().toISOString().slice(0, 16)}Z.`);
  return lines.join("\n");
}

// ----- Server-side tool helpers ---------------------------------------------------

async function geocode(q: string): Promise<Place | null> {
  const feed = await FEEDS.search(new URLSearchParams({ q }));
  return feed.places[0] ?? null;
}

function rangeForPlace(p: Place): number {
  if (!p.extent) return 8_000;
  const [w, s, e, n] = p.extent;
  const spanKm = Math.max(Math.abs(e - w) * 111 * Math.cos((p.lat * Math.PI) / 180), Math.abs(n - s) * 111);
  return Math.min(4_000_000, Math.max(2_500, spanKm * 1_400));
}

async function reverseGeocode(lat: number, lon: number): Promise<string> {
  const res = await fetch(`https://photon.komoot.io/reverse?lat=${lat}&lon=${lon}&lang=en&limit=3&radius=5`, {
    headers: { "User-Agent": "ultimate-assistant-os/gods-eye-view" },
    signal: AbortSignal.timeout(12_000),
    cache: "no-store",
  });
  if (!res.ok) return `No reverse-geocode result (${res.status}).`;
  const data = (await res.json()) as { features?: { properties: Record<string, string> }[] };
  const feats = data.features ?? [];
  if (!feats.length) return "Nothing named here — probably open water or wilderness.";
  return feats
    .map((f) => {
      const p = f.properties;
      return [p.name, p.osm_value && `(${p.osm_key}=${p.osm_value})`, p.street, p.city, p.county, p.state, p.country].filter(Boolean).join(", ");
    })
    .join(" | ");
}

/** Keep a route light enough to draw and send: at most ~500 points. */
function thin(coords: [number, number][], max = 500): [number, number][] {
  if (coords.length <= max) return coords;
  const step = coords.length / max;
  const out: [number, number][] = [];
  for (let i = 0; i < coords.length; i += step) out.push(coords[Math.floor(i)]);
  out.push(coords[coords.length - 1]);
  return out;
}

async function route(from: [number, number], to: [number, number], profile: string) {
  const engine = profile === "walking" ? "foot" : profile === "cycling" ? "bike" : "car";
  const res = await fetch(
    `https://routing.openstreetmap.de/routed-${engine}/route/v1/driving/${from[0]},${from[1]};${to[0]},${to[1]}?overview=full&geometries=geojson`,
    { headers: { "User-Agent": "ultimate-assistant-os/gods-eye-view" }, signal: AbortSignal.timeout(20_000), cache: "no-store" },
  );
  if (!res.ok) throw new Error(`routing answered ${res.status}`);
  const data = (await res.json()) as { routes?: { distance: number; duration: number; geometry: { coordinates: [number, number][] } }[] };
  const r = data.routes?.[0];
  if (!r) throw new Error("no route between those points");
  return { coords: thin(r.geometry.coordinates), distanceKm: r.distance / 1000, durationMin: r.duration / 60 };
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

async function runTool(name: string, args: Json, ctx: AgentContext, actions: AgentAction[]): Promise<string> {
  const center = ctx.center ?? { lat: ctx.view.lat, lon: ctx.view.lon };
  switch (name) {
    case "fly_to": {
      let lat = num(args.lat);
      let lon = num(args.lon);
      let range = num(args.range_m);
      const label = String(args.place ?? "target");
      if (lat === undefined || lon === undefined) {
        const p = await geocode(label);
        if (!p) return `Could not find "${label}".`;
        lat = p.lat;
        lon = p.lon;
        range ??= rangeForPlace(p);
      }
      range ??= 12_000;
      actions.push({ type: "fly", lat, lon, range, heading: num(args.heading) ?? 0, pitch: num(args.pitch) ?? (range > 500_000 ? -80 : -40), label });
      return `Flying to ${label} at ${lat.toFixed(4)}, ${lon.toFixed(4)}.`;
    }
    case "describe_view":
      return `Centre ${center.lat.toFixed(4)}, ${center.lon.toFixed(4)}: ${await reverseGeocode(center.lat, center.lon)}`;
    case "set_layers": {
      const set: Record<string, boolean> = {};
      for (const [k, v] of Object.entries((args.layers as Json) ?? {})) {
        if ((AGENT_LAYERS as readonly string[]).includes(k)) set[k] = Boolean(v);
      }
      if (!Object.keys(set).length) return `No valid layers. Use: ${AGENT_LAYERS.join(", ")}.`;
      actions.push({ type: "layers", set });
      return `Layers updated: ${Object.entries(set).map(([k, v]) => `${k} ${v ? "on" : "off"}`).join(", ")}.`;
    }
    case "set_style":
      if (!(AGENT_STYLES as readonly string[]).includes(String(args.style))) return "Unknown style.";
      actions.push({ type: "style", style: String(args.style) });
      return `Style ${args.style}.`;
    case "set_hud":
      actions.push({ type: "hud", mode: args.mode as "tactical" });
      return "HUD set.";
    case "set_detection":
      actions.push({ type: "detect", mode: args.mode as "dense" });
      return "Detection set.";
    case "track":
      actions.push({ type: "track", query: String(args.query ?? "") });
      return `Tracking ${args.query} if it is on the globe (satellites need the satellites layer, aircraft need flights).`;
    case "untrack":
      actions.push({ type: "untrack" });
      return "Released.";
    case "cockpit":
      actions.push({ type: "cockpit", on: Boolean(args.on) });
      return args.on ? "Entering cockpit view." : "Leaving cockpit view.";
    case "reset_globe":
      actions.push({ type: "reset" });
      return "Resetting to the whole globe.";
    case "celestial":
      actions.push({ type: "celestial", on: Boolean(args.on) });
      return "Celestial updated.";
    case "mark_place": {
      let lat = num(args.lat);
      let lon = num(args.lon);
      const label = String(args.label ?? "MARK");
      if (lat === undefined || lon === undefined) {
        const p = args.place ? await geocode(String(args.place)) : null;
        if (p) {
          lat = p.lat;
          lon = p.lon;
        } else {
          lat = center.lat;
          lon = center.lon;
        }
      }
      actions.push({ type: "mark", label, lat, lon });
      return `Marked ${label} at ${lat.toFixed(4)}, ${lon.toFixed(4)}.`;
    }
    case "orbit":
      actions.push({ type: "orbit", on: Boolean(args.on), lat: num(args.lat), lon: num(args.lon), range: num(args.range_m) });
      return args.on ? "Orbit started." : "Orbit stopped.";
    case "draw_route": {
      const resolve = async (label: string, la?: number, lo?: number): Promise<[number, number] | string> => {
        if (la !== undefined && lo !== undefined) return [lo, la];
        if (/^(here|current|this|my location|screen)/i.test(label.trim())) return [center.lon, center.lat];
        const p = await geocode(label);
        return p ? [p.lon, p.lat] : `Could not find "${label}".`;
      };
      const a = await resolve(String(args.from), num(args.from_lat), num(args.from_lon));
      const b = await resolve(String(args.to), num(args.to_lat), num(args.to_lon));
      if (typeof a === "string") return a;
      if (typeof b === "string") return b;
      const profile = String(args.profile ?? "driving");
      try {
        const r = await route(a, b, profile);
        actions.push({ type: "route", label: `${args.from} → ${args.to}`, profile, ...r });
        return `Route drawn: ${r.distanceKm.toFixed(1)} km, about ${Math.round(r.durationMin)} minutes ${profile}.`;
      } catch (err) {
        const km = rangeBearing(a[1], a[0], b[1], b[0]).km;
        return `Routing failed (${err instanceof Error ? err.message : "error"}); the straight-line distance is ${km.toFixed(0)} km.`;
      }
    }
    case "fly_route":
      actions.push({ type: "flyRoute" });
      return ctx.hasRoute || actions.some((x) => x.type === "route") ? "Flying the route." : "There is no route drawn yet.";
    case "clear_annotations":
      actions.push({ type: "clear" });
      return "Cleared.";
    case "radio":
      actions.push({ type: "radio", action: args.action as "play", kind: args.kind as "weather" | undefined });
      return `Radio ${args.action}${args.kind ? ` ${args.kind}` : ""}.`;
    default:
      return `Unknown tool ${name}.`;
  }
}

// ----- The loop -------------------------------------------------------------------------

interface ToolCall {
  id: string;
  function: { name: string; arguments: string };
}

export async function runAgent(history: ChatTurn[], ctx: AgentContext, model: AgentModel): Promise<{ reply: string; actions: AgentAction[] }> {
  const ep = aiEndpoint();
  if (!ep) throw new Error("No AI provider configured (set OPENROUTER_API_KEY)");
  const messages: Json[] = [{ role: "system", content: systemPrompt(ctx) }, ...history.slice(-12).map((t) => ({ role: t.role, content: t.content.slice(0, 2000) }))];
  const actions: AgentAction[] = [];

  for (let round = 0; round < 6; round++) {
    const res = await aiFetch({
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "HTTP-Referer": "https://ultimate-assistant-os.vercel.app",
        "X-Title": "God's Eye View",
      },
      body: JSON.stringify({
        model: AGENT_MODELS[model],
        messages,
        tools: TOOLS,
        tool_choice: "auto",
        max_tokens: 4000,
        temperature: 0.3,
        // Voice turns should feel immediate; the tools carry the precision.
        reasoning: { effort: "low" },
      }),
      signal: AbortSignal.timeout(45_000),
    });
    const body = (await res.json().catch(() => ({}))) as {
      error?: { message?: string };
      choices?: { message: { content?: string | null; tool_calls?: ToolCall[] } }[];
    };
    if (!res.ok || !body.choices?.length) throw new Error(body.error?.message ?? `AI answered ${res.status}`);
    const msg = body.choices[0].message;
    const calls = msg.tool_calls ?? [];
    if (!calls.length) return { reply: (msg.content ?? "").trim() || "Done.", actions };

    messages.push({ role: "assistant", content: msg.content ?? "", tool_calls: calls });
    for (const call of calls) {
      let args: Json = {};
      try {
        args = JSON.parse(call.function.arguments || "{}") as Json;
      } catch {
        /* model sent bad JSON: run with no args */
      }
      let result: string;
      try {
        result = await runTool(call.function.name, args, ctx, actions);
      } catch (err) {
        result = `Tool failed: ${err instanceof Error ? err.message : "error"}`;
      }
      messages.push({ role: "tool", tool_call_id: call.id, content: result });
    }
  }
  return { reply: "Done.", actions };
}
