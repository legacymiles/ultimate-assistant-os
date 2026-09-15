// ---------------------------------------------------------------------------
// 3D Studio Video Creator: shared types.
//
// A VideoProject is one prompt's journey: the AI director turns the prompt into
// a plan (interpretation, characters, environments, scenes, and which tool
// handles each piece of motion), the owner approves it, and the studio builder
// on their PC builds, animates and renders it in Blender — pulling Mixamo clips
// and Cascadeur motion where the plan calls for them — then reports back with
// look-dev stills and the finished video.
//
// The website never runs Blender. It keeps this record, shows the storyboard,
// and plays an in-browser animatic of the same plan so there is always
// something to preview and export.
// ---------------------------------------------------------------------------

import type { ToolId } from "./tools/registry";

export type ProjectStatus =
  | "storyboard"
  | "queued"
  | "building"
  | "animating"
  | "rendering"
  | "ready"
  | "failed";

/** Statuses the PC builder is still working through. */
export const ACTIVE_STATUSES: ProjectStatus[] = ["queued", "building", "animating", "rendering"];

export const STATUS_LABEL: Record<ProjectStatus, string> = {
  storyboard: "Storyboard ready",
  queued: "Waiting for your PC",
  building: "Building scenes",
  animating: "Animating",
  rendering: "Rendering",
  ready: "Video ready",
  failed: "Render failed",
};

// ----- the brief -------------------------------------------------------------

export type StyleId = "stylized-3d" | "anime-toon" | "claymation" | "low-poly" | "cinematic" | "paper-craft";

export interface StyleDef {
  id: StyleId;
  label: string;
  blurb: string;
  /** What the Blender stage should aim for. */
  look: string;
  engine: "EEVEE" | "CYCLES";
  /** Animatic palette: sky, ground, accent. */
  palette: [string, string, string];
}

export const STYLES: StyleDef[] = [
  {
    id: "stylized-3d",
    label: "Stylized 3D",
    blurb: "Feature-animation look: soft light, rounded shapes.",
    look: "Soft global illumination, rounded appealing shapes, saturated but gentle colour, subsurface skin, shallow depth of field.",
    engine: "EEVEE",
    palette: ["#8ec5ff", "#e9d8a6", "#ff7a59"],
  },
  {
    id: "anime-toon",
    label: "Anime toon",
    blurb: "Cel shading, ink outlines, bold skies.",
    look: "Shader-to-RGB cel shading with two tone steps, Line Art / Freestyle outlines, painted gradient skies, hard rim light.",
    engine: "EEVEE",
    palette: ["#5fa8ff", "#a7e07a", "#ff4f8b"],
  },
  {
    id: "claymation",
    label: "Claymation",
    blurb: "Hand-made clay, stepped motion.",
    look: "Clay materials with fingerprint bump, warm key light, miniature depth of field, animation on twos (step every other frame).",
    engine: "CYCLES",
    palette: ["#f4d6b0", "#c98d5e", "#e2574c"],
  },
  {
    id: "low-poly",
    label: "Low poly",
    blurb: "Flat-shaded facets, clean pastel world.",
    look: "Flat shading, faceted geometry, pastel gradient world, crisp shadows, no textures.",
    engine: "EEVEE",
    palette: ["#b9e3f5", "#9ed39b", "#f29e4c"],
  },
  {
    id: "cinematic",
    label: "Cinematic",
    blurb: "Realistic light, anamorphic framing.",
    look: "Physically based materials, HDRI lighting, volumetric haze, filmic colour, motion blur, 2.39:1 framing inside the frame.",
    engine: "CYCLES",
    palette: ["#3b4a63", "#5b5146", "#ffb347"],
  },
  {
    id: "paper-craft",
    label: "Paper craft",
    blurb: "Cut-paper layers, storybook feel.",
    look: "Paper textures, layered cut-out shapes, soft contact shadows, gentle parallax, limited palette.",
    engine: "EEVEE",
    palette: ["#fbe7c6", "#b4f8c8", "#ff8c94"],
  },
];

export function styleById(id: string | undefined): StyleDef {
  return STYLES.find((s) => s.id === id) ?? STYLES[0];
}

export type Aspect = "16:9" | "9:16" | "1:1";
export const ASPECTS: Aspect[] = ["16:9", "9:16", "1:1"];
export const LENGTHS = [15, 30, 60, 120] as const;

export interface Brief {
  style: StyleId;
  lengthSec: number;
  aspect: Aspect;
  mood?: string;
  audience?: string;
}

// ----- the director's plan ---------------------------------------------------

/** Humanoids use Mixamo; creatures need custom motion; objects are keyframed in Blender. */
export type SubjectKind = "humanoid" | "creature" | "object";

export type MotionTool = "mixamo" | "cascadeur" | "blender";

export interface Character {
  id: string;
  name: string;
  kind: SubjectKind;
  description: string;
  /** Hex colours the animatic and the look-dev use. */
  colors: { body: string; accent: string };
}

export interface Environment {
  id: string;
  name: string;
  description: string;
  /** Keywords the animatic uses to dress the set: "trees", "buildings", "stars"… */
  props: string[];
  palette: { sky: string; ground: string; fog: string };
  timeOfDay: "day" | "golden" | "night";
}

export type CameraMove = "static" | "dolly-in" | "dolly-out" | "orbit" | "pan" | "crane-up" | "tracking" | "handheld";
export const CAMERA_MOVES: CameraMove[] = ["static", "dolly-in", "dolly-out", "orbit", "pan", "crane-up", "tracking", "handheld"];

export interface Action {
  id: string;
  characterId: string;
  /** What happens, in plain words. */
  description: string;
  /** Normalised motion verb the animatic can play: walk, run, dance, talk… */
  motion: string;
  tool: MotionTool;
  /** Mixamo clip name when tool is mixamo. */
  clip?: string;
  /** Why this tool — shown to the owner. */
  reason: string;
  /** True when the owner picked the tool instead of the director. */
  override?: boolean;
}

export interface Scene {
  id: string;
  title: string;
  beat: string;
  durationSec: number;
  environmentId: string;
  summary: string;
  narration?: string;
  camera: { move: CameraMove; lens: number; framing: string };
  lighting: string;
  actions: Action[];
  effects: string[];
}

export interface DirectorPlan {
  title: string;
  logline: string;
  interpretation: {
    genre: string;
    tone: string;
    audience: string;
    pacing: string;
    themes: string[];
  };
  style: { id: StyleId; look: string; engine: "EEVEE" | "CYCLES" };
  characters: Character[];
  environments: Environment[];
  scenes: Scene[];
  music: string;
  soundDesign: string;
  totalSec: number;
  /** Which brain wrote it. */
  source: "ai" | "heuristic";
  notes: string[];
}

// ----- production results ------------------------------------------------------

export interface LogLine {
  t: string;
  line: string;
}

export interface Media {
  /** Blob key under the studio3d-media bucket. */
  key: string;
  /** File name on the PC, so a re-sent file is a no-op. */
  file?: string;
  caption?: string;
  sceneId?: string;
  contentType: string;
  bytes: number;
  at: string;
}

export interface ToolReport {
  tool: ToolId;
  used: boolean;
  note: string;
}

export interface RenderReport {
  engine?: string;
  resolution?: string;
  fps?: number;
  frames?: number;
  renderMinutes?: number;
  toolsUsed: ToolReport[];
  cut: { item: string; reason: string }[];
  blendFile?: string;
  outputPath?: string;
}

export interface VideoProject {
  id: string;
  ownerId: string;
  prompt: string;
  brief: Brief;
  plan: DirectorPlan;
  status: ProjectStatus;
  note?: string;
  createdAt: string;
  updatedAt: string;
  log: LogLine[];
  stills: Media[];
  video?: Media;
  report?: RenderReport;
  error?: string;
  queuedAt?: string;
  startedAt?: string;
  finishedAt?: string;
}

/** A progress post from the builder. Every field is optional. */
export interface ProgressUpdate {
  status?: ProjectStatus;
  note?: string;
  lines?: string[];
  report?: RenderReport;
}

/** What the PC builder found installed, posted with every claim. */
export interface StudioCapabilities {
  blender?: { found: boolean; version?: string };
  blenderMcp?: boolean;
  cascadeur?: { found: boolean };
  cascadeurMcp?: boolean;
  mixamo?: { clips: string[]; characters: number };
}

export const MAX_LOG_LINES = 600;
export const MAX_STILLS = 40;
export const MAX_PROMPT_CHARS = 4000;
