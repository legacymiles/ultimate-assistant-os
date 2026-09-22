// ---------------------------------------------------------------------------
// Video Studio Arena — the contract every generation method implements.
//
// The studio is an operating system for video engines: a brief goes in, a
// production plan comes out, and ONE of several engines renders it. Remotion,
// HyperFrames, Unreal, Blender and H3 are the five that ship, but nothing in
// the app knows their names — it knows this contract and reads the registry.
//
// A method is split in two on purpose:
//
//   MethodMeta   — isomorphic. Card copy, capabilities, input/output shape.
//                  The browser imports this; it must not touch node APIs.
//   MethodServer — server-only. Real capability detection, prompt
//                  optimisation, and the execution handler.
//
// Adding a method = adding a folder under methods/ and one line in each
// registry. Nothing else in the app changes. See methods/README.md.
// ---------------------------------------------------------------------------

export type AspectRatio = "16:9" | "9:16" | "1:1" | "4:5" | "21:9";

export const ASPECT_RATIOS: { id: AspectRatio; label: string; blurb: string }[] = [
  { id: "16:9", label: "16:9", blurb: "YouTube, landing pages" },
  { id: "9:16", label: "9:16", blurb: "TikTok, Reels, Shorts" },
  { id: "1:1", label: "1:1", blurb: "Feed posts" },
  { id: "4:5", label: "4:5", blurb: "Instagram portrait" },
  { id: "21:9", label: "21:9", blurb: "Cinemascope" },
];

export type Narration = "none" | "ai-voiceover" | "own-voice" | "on-screen-text";

export const NARRATIONS: { id: Narration; label: string }[] = [
  { id: "none", label: "No narration" },
  { id: "ai-voiceover", label: "AI voiceover" },
  { id: "own-voice", label: "I'll record my own" },
  { id: "on-screen-text", label: "On-screen text only" },
];

/** Everything the user said they wanted. The one input to planning. */
export interface VideoBrief {
  /** The free-text request. The only required field. */
  prompt: string;
  subject: string;
  durationSec: number;
  style: string;
  audience: string;
  aspectRatio: AspectRatio;
  narration: Narration;
  voiceNote: string;
  music: string;
  captions: boolean;
  notes: string;
}

// ----- the production plan ---------------------------------------------------

export interface PlanScene {
  id: string;
  /** 1-based, and the order they play in. */
  index: number;
  title: string;
  startSec: number;
  endSec: number;
  /** What is on screen. Written for a human to read and approve. */
  description: string;
  /** The line spoken over it, when the brief asked for narration. */
  narration?: string;
  /**
   * The method that renders THIS scene. Equal to the project's method in
   * manual mode; per-scene in AI Director mode, which is the whole point of
   * that mode existing.
   */
  methodId: string;
  /**
   * The engine-specific instruction the optimiser produced for this scene —
   * a Remotion composition brief, an H3 shot prompt, an Unreal shot sheet.
   * Never the user's raw words.
   */
  directive?: string;
}

export interface ProductionPlan {
  title: string;
  logline: string;
  durationSec: number;
  aspectRatio: AspectRatio;
  scenes: PlanScene[];
  /** The project-level method. In director mode this is "director". */
  methodId: string;
  /** The skill that will execute it, shown on the plan screen. */
  skill: string;
  /** How the plan was written: a model, or the offline structural planner. */
  source: "ai" | "heuristic";
  /** Set when the AI planner was asked for and could not answer. */
  note?: string;
}

// ----- capability detection --------------------------------------------------

/**
 * The real state of a method's dependencies, as reported by the server after
 * actually looking. "ready" means a render started right now would run.
 */
export type CapabilityState =
  | "ready"
  | "connected"
  | "not-connected"
  | "requires-installation"
  | "requires-api-key"
  | "running"
  | "failed";

export const CAPABILITY_LABEL: Record<CapabilityState, string> = {
  ready: "Ready to run",
  connected: "Connected",
  "not-connected": "Not connected",
  "requires-installation": "Requires installation",
  "requires-api-key": "Requires API key",
  running: "Running",
  failed: "Failed",
};

export type RequirementKind = "api-key" | "mcp" | "install" | "gpu" | "service" | "runner";

/** One dependency, and whether this machine actually has it. */
export interface Requirement {
  id: string;
  label: string;
  kind: RequirementKind;
  /** The env var, MCP server name or executable that satisfies it. */
  detail: string;
  met: boolean;
  /** What the owner does about it, in one sentence. */
  howTo: string;
  /** Left unset when the requirement is optional — a nicety, not a blocker. */
  optional?: boolean;
}

export interface Capability {
  state: CapabilityState;
  /** One line for the card and the integrations page. */
  summary: string;
  requirements: Requirement[];
  /** Set when detection itself failed, rather than a dependency being absent. */
  error?: string;
}

// ----- the method itself -----------------------------------------------------

/**
 * Where the work runs.
 *
 *   "server" — inside a Next.js route. Hosted models live here.
 *   "agent"  — queued for the runner on the owner's PC, which loads the
 *              method's skill in Claude Code and does the work against a real
 *              local install (Unreal, Blender, node, ffmpeg).
 *
 * This is the honest seam: a "server" method can render from a deployed host,
 * an "agent" method cannot and says so.
 */
export type Transport = "server" | "agent";

export type WorkflowType = "hosted-model" | "code-render" | "3d-render" | "engine-render";

export const WORKFLOW_LABEL: Record<WorkflowType, string> = {
  "hosted-model": "Hosted model · minutes",
  "code-render": "Code → render · minutes",
  "3d-render": "3D authoring → render · tens of minutes",
  "engine-render": "Engine authoring → render · tens of minutes",
};

/** What a method needs handed to it, beyond the plan. */
export interface MethodInputs {
  /** Accepts reference images (character, product, style). */
  referenceImages: boolean;
  /** Accepts a first-frame image to continue from. */
  firstFrame: boolean;
  /** Accepts audio (narration bed, music). */
  audio: boolean;
  /** Free-text note shown under the uploader. */
  note: string;
}

export interface MethodOutput {
  /** Container the method delivers. */
  format: "mp4" | "mov" | "webm";
  /** What the method can honestly promise about resolution. */
  resolution: string;
  /** True when a single scene can be re-rendered without redoing the rest. */
  perSceneRerender: boolean;
}

/**
 * The isomorphic half of a method: everything the browser needs to draw the
 * card, the plan screen and the workspace.
 */
export interface MethodMeta {
  id: string;
  name: string;
  /** The one-line "Best for:" on the card. */
  tagline: string;
  description: string;
  strengths: string[];
  workflowType: WorkflowType;
  transport: Transport;
  /** The Claude Code skill that carries the how-to. */
  skill: string;
  /** Sibling skills the main one routes to, shown on the method page. */
  companionSkills: string[];
  inputs: MethodInputs;
  output: MethodOutput;
  /** Two hues, 0–360, for the card's gradient and icon. */
  hue: [number, number];
  docsUrl?: string;
  /** Hidden from the picker but still executable — for retired methods. */
  hidden?: boolean;
}

/** The engine-specific instructions the agent or model is given. */
export interface MethodSkill {
  /** The name shown on the plan screen, e.g. "Remotion Educational Motion Graphics". */
  title: string;
  /** What this engine is for, in the agent's own terms. */
  goodAt: string[];
  /** The system prompt used when optimising a brief into this engine's terms. */
  optimiserSystem: string;
  /** The full instruction block handed to the executing agent. */
  instructions: string;
}

// ----- execution -------------------------------------------------------------

export type RunState = "pending" | "running" | "done" | "failed" | "skipped";

/** One line of the real status list. Never decorative. */
export interface RunStep {
  id: string;
  label: string;
  state: RunState;
  detail?: string;
  /** ISO time the state last changed. */
  at: string;
}

export type ProjectStatus =
  | "draft"
  | "planned"
  | "queued"
  | "optimising"
  | "rendering"
  | "assembling"
  | "ready"
  | "failed";

export const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
  draft: "Draft",
  planned: "Plan ready",
  queued: "Waiting for the runner",
  optimising: "Optimising prompts",
  rendering: "Rendering",
  assembling: "Assembling",
  ready: "Ready",
  failed: "Failed",
};

export const ACTIVE_STATUSES: ProjectStatus[] = ["queued", "optimising", "rendering", "assembling"];

/** A rendered scene, or a scene that tried and failed. */
export interface SceneRun {
  sceneId: string;
  index: number;
  methodId: string;
  state: RunState;
  /** Blob key of this scene's clip, once it exists. */
  clipKey?: string;
  /** Engine task id, for a hosted model that polls. */
  taskId?: string;
  error?: string;
  /** How many times this scene has been rendered. */
  attempts: number;
  at: string;
}

export interface HistoryEntry {
  at: string;
  /** "planned" | "render" | "scene-render" | "repair" | "failed" | "ready" | … */
  kind: string;
  summary: string;
}

export interface Project {
  id: string;
  title: string;
  brief: VideoBrief;
  /** Null until the plan screen has been reached. */
  plan: ProductionPlan | null;
  methodId: string;
  mode: "manual" | "director";
  status: ProjectStatus;
  steps: RunStep[];
  scenes: SceneRun[];
  history: HistoryEntry[];
  /** Blob key of the assembled video, once there is one. */
  videoKey?: string;
  /** Which engine actually produced the current video. */
  renderedBy?: string;
  error?: string;
  /** Set on a duplicate, so the comparison view can group versions. */
  parentId?: string;
  /** The label shown in the comparison strip, e.g. "Version B · HyperFrames". */
  versionLabel?: string;
  createdAt: string;
  updatedAt: string;
}

/** The job the runner on the owner's PC claims. */
export interface RunnerJob {
  projectId: string;
  /** A single scene, or the whole project. */
  sceneIndex: number | null;
  methodId: string;
  skill: string;
  brief: VideoBrief;
  plan: ProductionPlan;
  /** The engine-specific instructions, already optimised. */
  directive: string;
  instructions: string;
}
