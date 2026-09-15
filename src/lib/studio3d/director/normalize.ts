// ---------------------------------------------------------------------------
// Plan normalisation.
//
// Every plan passes through here, whoever wrote it: the AI director (whose JSON
// can be missing fields or break the routing rules), the heuristic director,
// and the owner's edits sent from the browser. The result always has valid
// ids, references that resolve, durations that add up to the requested length,
// and tool choices that respect the hard rules — Mixamo never animates a
// creature or an object, however confidently a model or a click asked for it.
// ---------------------------------------------------------------------------

import {
  CAMERA_MOVES,
  styleById,
  type Action,
  type Brief,
  type CameraMove,
  type Character,
  type DirectorPlan,
  type Environment,
  type MotionTool,
  type Scene,
  type SubjectKind,
} from "../types";
import { mixamoClip, routeMotion, subjectKind } from "./motion";

type Obj = Record<string, unknown>;

const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown, max: number, fallback = ""): string =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : fallback;
const strs = (v: unknown, maxItems: number, maxLen: number): string[] =>
  arr(v)
    .filter((x): x is string => typeof x === "string" && Boolean(x.trim()))
    .slice(0, maxItems)
    .map((s) => s.trim().slice(0, maxLen));
const hex = (v: unknown, fallback: string): string =>
  typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v.trim()) ? v.trim().toLowerCase() : fallback;
const num = (v: unknown, fallback: number): number => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number.parseFloat(v) : Number.NaN;
  return Number.isFinite(n) ? n : fallback;
};

export const CHARACTER_COLORS: [string, string][] = [
  ["#f97316", "#1e293b"],
  ["#38bdf8", "#f8fafc"],
  ["#a78bfa", "#fde68a"],
  ["#34d399", "#7c2d12"],
  ["#f472b6", "#312e81"],
  ["#facc15", "#0f172a"],
];

const TOOLS: MotionTool[] = ["mixamo", "cascadeur", "blender"];
const KINDS: SubjectKind[] = ["humanoid", "creature", "object"];

function slugId(prefix: string, v: unknown, i: number, taken: Set<string>): string {
  let id = typeof v === "string" ? v.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) : "";
  if (!id || taken.has(id)) id = `${prefix}${i + 1}`;
  while (taken.has(id)) id = `${id}-x`;
  taken.add(id);
  return id;
}

/** Round to the nearest half second. */
const half = (n: number) => Math.round(n * 2) / 2;

/** Scale scene durations so they sum to `total`, keeping each at least 2 s. */
export function fitDurations(durations: number[], total: number): number[] {
  if (!durations.length) return [];
  const safeTotal = Math.max(total, durations.length * 2);
  const raw = durations.map((d) => Math.max(0.5, d));
  const sum = raw.reduce((a, b) => a + b, 0);
  const scaled = raw.map((d) => Math.max(2, half((d / sum) * safeTotal)));
  // Put the rounding error on the longest scene so the total is exact.
  const diff = half(safeTotal - scaled.reduce((a, b) => a + b, 0));
  if (diff !== 0) {
    const longest = scaled.indexOf(Math.max(...scaled));
    scaled[longest] = Math.max(2, half(scaled[longest] + diff));
  }
  return scaled;
}

/** Enforce the routing rules on one action. */
export function fixAction(a: Action, kind: SubjectKind): Action {
  const routed = routeMotion(a.description, kind);
  let tool = a.tool;
  let clip = a.clip;
  let reason = a.reason;

  if (!TOOLS.includes(tool)) {
    tool = routed.tool;
    clip = routed.clip;
    reason = routed.reason;
  }
  if (tool === "mixamo" && kind !== "humanoid") {
    tool = routed.tool === "mixamo" ? (kind === "object" ? "blender" : "cascadeur") : routed.tool;
    clip = undefined;
    reason = kind === "object" ? "Not a character — keyframed directly in Blender." : "Creature rig — Mixamo only rigs bipeds, so Cascadeur animates it.";
  }
  if (tool === "mixamo") {
    const known = mixamoClip(clip);
    if (known) clip = known.clip;
    else if (routed.clip) clip = routed.clip;
    else clip = "Idle";
  } else {
    clip = undefined;
  }
  return {
    ...a,
    tool,
    clip,
    reason: reason || routed.reason,
    motion: a.motion || routed.motion,
  };
}

export function normalizePlan(raw: unknown, brief: Brief, prompt: string, source: DirectorPlan["source"]): DirectorPlan {
  const p = obj(raw);
  const style = styleById(brief.style);

  // Characters (including moving objects the story needs, like a rocket).
  const charIds = new Set<string>();
  let characters: Character[] = arr(p.characters)
    .slice(0, 6)
    .map((c, i) => {
      const o = obj(c);
      const name = str(o.name, 60, `Character ${i + 1}`);
      const description = str(o.description, 400, name);
      const kind = KINDS.includes(o.kind as SubjectKind) ? (o.kind as SubjectKind) : subjectKind(`${name} ${description}`);
      const colors = obj(o.colors);
      const [body, accent] = CHARACTER_COLORS[i % CHARACTER_COLORS.length];
      return {
        id: slugId("c", o.id, i, charIds),
        name,
        kind,
        description,
        colors: { body: hex(colors.body, body), accent: hex(colors.accent, accent) },
      };
    });
  if (!characters.length) {
    charIds.add("host");
    characters = [
      {
        id: "host",
        name: "Host",
        kind: "humanoid",
        description: "A friendly presenter who guides the viewer through the video.",
        colors: { body: CHARACTER_COLORS[0][0], accent: CHARACTER_COLORS[0][1] },
      },
    ];
  }

  // Environments.
  const envIds = new Set<string>();
  let environments: Environment[] = arr(p.environments)
    .slice(0, 5)
    .map((e, i) => {
      const o = obj(e);
      const pal = obj(o.palette);
      const tod = o.timeOfDay === "golden" || o.timeOfDay === "night" ? o.timeOfDay : "day";
      return {
        id: slugId("e", o.id, i, envIds),
        name: str(o.name, 60, `Set ${i + 1}`),
        description: str(o.description, 400, ""),
        props: strs(o.props, 8, 30).map((s) => s.toLowerCase()),
        palette: {
          sky: hex(pal.sky, style.palette[0]),
          ground: hex(pal.ground, style.palette[1]),
          fog: hex(pal.fog, style.palette[0]),
        },
        timeOfDay: tod,
      };
    });
  if (!environments.length) {
    envIds.add("stage");
    environments = [
      {
        id: "stage",
        name: "Studio stage",
        description: "A clean stylised stage with a soft cyclorama backdrop.",
        props: ["platform"],
        palette: { sky: style.palette[0], ground: style.palette[1], fog: style.palette[0] },
        timeOfDay: "day",
      },
    ];
  }
  const kindOf = new Map(characters.map((c) => [c.id, c.kind]));

  // Scenes.
  const sceneIds = new Set<string>();
  const rawScenes = arr(p.scenes).slice(0, 12);
  let scenes: Scene[] = rawScenes.map((s, i) => {
    const o = obj(s);
    const cam = obj(o.camera);
    const actionIds = new Set<string>();
    const envId = typeof o.environmentId === "string" && envIds.has(o.environmentId) ? o.environmentId : environments[0].id;
    const actions: Action[] = arr(o.actions)
      .slice(0, 6)
      .map((a, j) => {
        const ao = obj(a);
        const characterId =
          typeof ao.characterId === "string" && charIds.has(ao.characterId) ? ao.characterId : characters[0].id;
        const description = str(ao.description, 300, "idles");
        const base: Action = {
          id: slugId("a", ao.id, j, actionIds),
          characterId,
          description,
          motion: str(ao.motion, 30, "").toLowerCase(),
          tool: ao.tool as MotionTool,
          clip: str(ao.clip, 60, "") || undefined,
          reason: str(ao.reason, 300, ""),
          ...(ao.override === true ? { override: true } : {}),
        };
        return fixAction(base, kindOf.get(characterId) ?? "humanoid");
      });
    const move = CAMERA_MOVES.includes(cam.move as CameraMove) ? (cam.move as CameraMove) : "static";
    return {
      id: slugId("s", o.id, i, sceneIds),
      title: str(o.title, 80, `Scene ${i + 1}`),
      beat: str(o.beat, 40, ""),
      durationSec: num(o.durationSec, brief.lengthSec / Math.max(1, rawScenes.length)),
      environmentId: envId,
      summary: str(o.summary, 600, ""),
      narration: str(o.narration, 400, "") || undefined,
      camera: {
        move,
        lens: Math.round(Math.min(135, Math.max(12, num(cam.lens, 35)))),
        framing: str(cam.framing, 60, "medium shot"),
      },
      lighting: str(o.lighting, 200, ""),
      actions,
      effects: strs(o.effects, 6, 60),
    };
  });
  if (!scenes.length) {
    sceneIds.add("s1");
    scenes = [
      {
        id: "s1",
        title: "Scene 1",
        beat: "Opening",
        durationSec: brief.lengthSec,
        environmentId: environments[0].id,
        summary: prompt.slice(0, 600),
        camera: { move: "orbit", lens: 35, framing: "wide shot" },
        lighting: "",
        actions: [fixAction({ id: "a1", characterId: characters[0].id, description: "idles", motion: "idle", tool: "mixamo", reason: "" }, characters[0].kind)],
        effects: [],
      },
    ];
  }
  const fitted = fitDurations(
    scenes.map((s) => s.durationSec),
    brief.lengthSec,
  );
  scenes = scenes.map((s, i) => ({ ...s, durationSec: fitted[i] }));

  const interp = obj(p.interpretation);
  return {
    title: str(p.title, 90, prompt.slice(0, 60) || "Untitled video"),
    logline: str(p.logline, 400, prompt.slice(0, 200)),
    interpretation: {
      genre: str(interp.genre, 60, "Animated short"),
      tone: str(interp.tone, 80, brief.mood || "Warm"),
      audience: str(interp.audience, 80, brief.audience || "General audience"),
      pacing: str(interp.pacing, 120, "Steady"),
      themes: strs(interp.themes, 6, 60),
    },
    style: { id: style.id, look: str(obj(p.style).look, 500, style.look), engine: style.engine },
    characters,
    environments,
    scenes,
    music: str(p.music, 300, "An original score that follows the story's arc."),
    soundDesign: str(p.soundDesign, 300, "Footsteps, ambience and accents matched to each action."),
    totalSec: scenes.reduce((a, s) => a + s.durationSec, 0),
    source,
    notes: strs(p.notes, 10, 300),
  };
}

/** Which tools a plan actually uses, with the scenes each appears in. Blender is always in. */
export function toolUsage(plan: DirectorPlan): { tool: MotionTool; scenes: string[]; actions: number }[] {
  const usage = new Map<MotionTool, { scenes: Set<string>; actions: number }>();
  usage.set("blender", { scenes: new Set(plan.scenes.map((s) => s.id)), actions: 0 });
  for (const s of plan.scenes) {
    for (const a of s.actions) {
      const u = usage.get(a.tool) ?? { scenes: new Set<string>(), actions: 0 };
      u.scenes.add(s.id);
      u.actions += 1;
      usage.set(a.tool, u);
    }
  }
  return (["blender", "mixamo", "cascadeur"] as MotionTool[])
    .filter((t) => usage.has(t))
    .map((t) => ({ tool: t, scenes: [...usage.get(t)!.scenes], actions: usage.get(t)!.actions }));
}

/** Distinct Mixamo clips a plan needs. */
export function mixamoClipsNeeded(plan: DirectorPlan): string[] {
  const set = new Set<string>();
  for (const s of plan.scenes) for (const a of s.actions) if (a.tool === "mixamo" && a.clip) set.add(a.clip);
  return [...set].sort();
}
