// ---------------------------------------------------------------------------
// Voice / typed commands for God's Eye View.
//
// The original drives the globe with OpenAI's Realtime API. This port parses
// commands locally instead — no key, no per-second audio bill, and it works the
// same typed or spoken (browser speech recognition feeds the same parser).
// ---------------------------------------------------------------------------

import type { StyleId } from "./shaders";
import type { LayerId } from "./globe";

export type HudMode = "tactical" | "minimal" | "clean";
export type DetectMode = "off" | "sparse" | "dense";

export interface LocationPreset {
  id: string;
  label: string;
  lon: number;
  lat: number;
  /** Camera distance from the target, metres. */
  range: number;
  heading: number;
  pitch: number;
}

export const LOCATIONS: LocationPreset[] = [
  { id: "austin", label: "AUSTIN", lon: -97.7431, lat: 30.2672, range: 9_000, heading: 20, pitch: -38 },
  { id: "san-francisco", label: "SAN FRANCISCO", lon: -122.4194, lat: 37.7749, range: 16_000, heading: -30, pitch: -35 },
  { id: "new-york", label: "NEW YORK", lon: -73.9855, lat: 40.758, range: 10_000, heading: 30, pitch: -38 },
  { id: "london", label: "LONDON", lon: -0.1276, lat: 51.5072, range: 14_000, heading: 0, pitch: -40 },
  { id: "tokyo", label: "TOKYO", lon: 139.7671, lat: 35.6812, range: 14_000, heading: -20, pitch: -38 },
  { id: "dubai", label: "DUBAI", lon: 55.2744, lat: 25.1972, range: 8_000, heading: 40, pitch: -35 },
  { id: "paris", label: "PARIS", lon: 2.2945, lat: 48.8584, range: 7_000, heading: -60, pitch: -35 },
  { id: "sydney", label: "SYDNEY", lon: 151.2153, lat: -33.8568, range: 9_000, heading: 150, pitch: -35 },
];

export type Command =
  | { type: "style"; style: StyleId }
  | { type: "layer"; layer: LayerId; on: boolean }
  | { type: "reset" }
  | { type: "hud"; mode: HudMode }
  | { type: "detect"; mode: DetectMode }
  | { type: "track"; query: string }
  | { type: "untrack" }
  | { type: "fly"; place: string }
  | { type: "cockpit"; on: boolean }
  | { type: "celestial"; on: boolean };

const STYLE_WORDS: [RegExp, StyleId][] = [
  [/\b(night ?vision|nvg|green mode)\b/, "nvg"],
  [/\b(thermal|flir|infra ?red|heat ?vision|predator)\b/, "flir"],
  [/\b(crt|retro|old tv|scan ?lines?)\b/, "crt"],
  [/\b(anime|cartoon|cel ?shad\w*)\b/, "anime"],
  [/\b(noir|black and white|monochrome)\b/, "noir"],
  [/\b(snow|winter)\b/, "snow"],
  [/\b(normal|regular|true ?colou?r|no filter|clear filter)\b/, "normal"],
];

const LAYER_WORDS: [RegExp, LayerId][] = [
  [/\bmilitary(?: flights?| aircraft| planes?| jets?| traffic)?\b/, "military"],
  [/\b(flights?|planes?|aircraft|air traffic|airplanes?|jets?)\b/, "flights"],
  [/\b(satellites?|sats|starlink|orbits?)\b/, "satellites"],
  [/\b(earthquakes?|quakes?|seismic)\b/, "quakes"],
  [/\b(cctv|cameras?|webcams?|jam ?cams?|traffic cams?)\b/, "cctv"],
  [/\b(cables?|submarine|undersea|subsea)\b/, "cables"],
  [/\b(vessels?|ships?|boats?|ais|maritime|shipping)\b/, "vessels"],
  [/\b(wild ?fires?|fires?|firms|hot ?spots?)\b/, "fires"],
  [/\b(space missions?|launch(es)?|rockets?)\b/, "launches"],
  [/\b(data ?cent(er|re)s?)\b/, "datacenters"],
  [/\bdams?\b/, "dams"],
  // Last, so "air traffic" and "traffic cams" have already been claimed above.
  [/\b(street traffic|road traffic|traffic mode|traffic)\b/, "traffic"],
];

const OFF = /\b(turn off|switch off|hide|disable|remove|kill|stop showing|no more|get rid of)\b|\boff\b/;

function normaliseTrack(raw: string): string {
  const q = raw.replace(/\b(satellite|please|now|for me)\b/g, "").trim();
  if (/\b(iss|international space station|space station)\b/.test(q) && !/chin/.test(q)) return "ISS";
  if (/\b(tiangong|chinese space station|css)\b/.test(q)) return "CSS";
  if (/\bhubble\b/.test(q)) return "HST";
  return q.toUpperCase();
}

export function parseCommand(input: string): Command[] {
  const text = ` ${input
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^\p{L}\p{N}&\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()} `;
  const out: Command[] = [];
  if (!text.trim()) return out;

  if (/\b(stop|cancel|release) (tracking|following)\b|\buntrack\b|\bunlock\b/.test(text)) {
    out.push({ type: "untrack" });
  }

  if (/\b(cockpit|first person|pilot view|pilots view)\b/.test(text)) {
    out.push({ type: "cockpit", on: !/\b(exit|leave|out of|get out|close|off)\b/.test(text) });
    return out;
  }

  if (/\b(celestial|sun and moon|moon and sun)\b/.test(text)) {
    out.push({ type: "celestial", on: !OFF.test(text) });
    return out;
  }

  const track = text.match(/\b(?:track|follow|lock on(?: to)?|lock onto)\s+(?:the\s+)?(.+?)\s*$/);
  if (track && !out.length) {
    out.push({ type: "track", query: normaliseTrack(track[1]) });
    return out;
  }

  if (/\b(reset|home|whole (earth|world|globe|planet)|full (earth|globe)|zoom (all the way )?out)\b/.test(text)) {
    out.push({ type: "reset" });
  }

  const fly = text.match(
    /\b(?:fly|go|take me|zoom|jump|head|navigate|travel|show me|move)\s+(?:(?:in|back|down|over)\s+)?(?:to|over|into)\s+(?:the\s+)?(.+?)\s*$/,
  );
  if (fly) {
    const place = fly[1].trim();
    const namesStyleOrLayer =
      STYLE_WORDS.some(([re]) => re.test(` ${place} `)) || LAYER_WORDS.some(([re]) => re.test(` ${place} `));
    if (place && !namesStyleOrLayer) {
      out.push({ type: "fly", place });
      return out;
    }
  }

  if (/\b(clean view|hide (the )?hud)\b/.test(text)) out.push({ type: "hud", mode: "clean" });
  else if (/\bminimal( hud)?\b/.test(text)) out.push({ type: "hud", mode: "minimal" });
  else if (/\b(show (the )?hud|tactical( hud)?)\b/.test(text)) out.push({ type: "hud", mode: "tactical" });

  if (/\b(detection|bounding boxes|boxes)\b/.test(text)) {
    const mode: DetectMode = OFF.test(text) ? "off" : /\bsparse\b/.test(text) ? "sparse" : "dense";
    out.push({ type: "detect", mode });
    return out;
  }

  let rest = text;
  const on = !OFF.test(text);
  for (const [re, layer] of LAYER_WORDS) {
    if (re.test(rest)) {
      out.push({ type: "layer", layer, on });
      rest = rest.replace(re, " ");
    }
  }

  for (const [re, style] of STYLE_WORDS) {
    if (re.test(rest)) {
      out.push({ type: "style", style });
      break;
    }
  }

  return out;
}

/** One-line HUD acknowledgement for a parsed command batch. */
export function describeCommands(cmds: Command[]): string {
  return cmds
    .map((c) => {
      switch (c.type) {
        case "style":
          return `STYLE › ${c.style.toUpperCase()}`;
        case "layer":
          return `${c.layer.toUpperCase()} ${c.on ? "ON" : "OFF"}`;
        case "reset":
          return "RESET GLOBE";
        case "hud":
          return `HUD › ${c.mode.toUpperCase()}`;
        case "detect":
          return `DETECT › ${c.mode.toUpperCase()}`;
        case "track":
          return `TRACK › ${c.query}`;
        case "untrack":
          return "TRACK RELEASED";
        case "fly":
          return `FLYING TO ${c.place.toUpperCase()}`;
        case "cockpit":
          return c.on ? "COCKPIT VIEW" : "EXIT COCKPIT";
        case "celestial":
          return `CELESTIAL ${c.on ? "ON" : "OFF"}`;
      }
    })
    .join(" · ");
}
