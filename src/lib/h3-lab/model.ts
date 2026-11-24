// ---------------------------------------------------------------------------
// H3 Prompt Lab — the data contract.
//
// Every other file in the lab (engine, server store, API routes, the PC
// worker's payloads and the UI) is written against these types. Pure: no
// imports, safe in the browser, the server and tests.
//
// The one idea that shapes everything: an experiment is NOT a rival guide. It
// is a set of technique settings (knob = value) layered on the master guide's
// strategy for a genre, so results can be credited to individual techniques
// and the winners combined — never "experiment C beat B, ship C".
// ---------------------------------------------------------------------------

// ----- knobs and techniques ------------------------------------------------

/** What the compiler can vary. Each knob has a closed set of values. */
export interface Strategy {
  /** Which block leads the prompt. */
  order: "character-first" | "environment-first" | "cinematography-first" | "action-first";
  /** How the camera move is written. */
  camera: "official-prose" | "plain-big" | "token";
  /** How identity is carried across shots. */
  identity: "define-once" | "repeat-every-shot" | "anchor-clause";
  /** Prompt length budget. */
  length: "tight" | "standard" | "rich";
  /** How a generation is split into shots. */
  structure: "single-shot" | "timed-cuts" | "scene-by-scene";
  /** How the set is described. */
  environment: "layout-explicit" | "mood-only";
  /** How action is written. */
  action: "verb-led-midstate" | "choreography-beats";
  /** How dialogue is written. */
  dialogue: "official-tags" | "plain";
  /** The closing consistency clause. */
  closing: "consistency-clause" | "none";
}

export type Knob = keyof Strategy;

/** A technique is one knob set to one value, e.g. "camera=plain-big". */
export type TechniqueId = `${Knob}=${string}`;

// ----- dimensions & genres --------------------------------------------------

export type Dimension =
  | "character"
  | "environment"
  | "continuity"
  | "camera"
  | "action"
  | "movement"
  | "cinematography"
  | "dialogue"
  | "genre"
  | "visual"
  | "adherence";

export type GenreFamily = "narrative" | "cinematic" | "action" | "gaming" | "commercial";

export type GenreId = string;

export interface GenreModule {
  id: GenreId;
  name: string;
  family: GenreFamily;
  /** One line: what this genre needs that others don't. */
  essence: string;
  /** Knob values this genre's prompts should use (over the guide's base). */
  strategy: Partial<Strategy>;
  /** 0..1 weight per dimension. Missing = 0.5. */
  weights: Partial<Record<Dimension, number>>;
  /** Concrete prompting rules for this genre. */
  rules: string[];
  /** Typical pacing / shot length guidance. */
  pacing: string;
  /** Camera language this genre leans on. */
  camera: string[];
  /** What continuity must hold across shots in this genre. */
  continuity: string[];
}

// ----- bibles ---------------------------------------------------------------

export interface Character {
  id: string;
  name: string;
  /** Who they are in one or two sentences (role, age band, presence). */
  identity: string;
  face: string;
  hair: string;
  wardrobe: string;
  body: string;
  accessories: string;
  relationships: string;
  /** Data URLs (small JPEG) or Storage keys of reference photos. */
  referenceImages: string[];
  /** Explicit rules ("scar over LEFT eyebrow, never the right"). */
  continuityRules: string[];
  createdAt: string;
  updatedAt: string;
}

export interface Environment {
  id: string;
  name: string;
  description: string;
  architecture: string;
  furniture: string;
  doorsWindows: string;
  lighting: string;
  objects: string;
  cameraPerspectives: string;
  spatial: string;
  referenceImages: string[];
  continuityRules: string[];
  createdAt: string;
  updatedAt: string;
}

export type CameraMove =
  | "static"
  | "handheld"
  | "push-in"
  | "pull-out"
  | "dolly-in"
  | "track"
  | "pan-left"
  | "pan-right"
  | "tilt-up"
  | "tilt-down"
  | "crane-up"
  | "crane-down"
  | "arc"
  | "orbit"
  | "zoom-in"
  | "zoom-out"
  | "pov"
  | "shake";

export type Amount = "small" | "medium" | "large";
export type Speed = "slow" | "medium" | "fast";

/** A change between shots (or within one) that is SUPPOSED to happen. */
export type IntentChange = "position" | "lighting" | "wardrobe" | "environment" | "framing" | "props" | "time";

export interface DialogueLine {
  /** Character id, or "" for an unnamed voice. */
  speaker: string;
  line: string;
  delivery: string;
  voiceover?: boolean;
}

/** What one shot (or one generation) is meant to be. */
export interface ShotSpec {
  genre: GenreId;
  title: string;
  durationSec: number;
  aspect: "16:9" | "9:16" | "1:1";
  framing: string;
  camera: { move: CameraMove; amount: Amount; speed: Speed; focus?: string };
  /** What happens: the change, written as it should be seen. */
  action: string;
  /** Ordered beats for choreography / timed cuts. */
  beats: string[];
  characterIds: string[];
  environmentId: string | null;
  dialogue: DialogueLine[];
  mood: string;
  lighting: string;
  style: string;
  sound: string;
  music: string;
  intentionalChanges: IntentChange[];
}

export interface ProductionScene {
  id: string;
  order: number;
  spec: ShotSpec;
  generationIds: string[];
  /** Prompt frozen at the time it was compiled (with guide version). */
  compiled?: { prompt: string; guideVersion: number; at: string };
}

export interface Production {
  id: string;
  title: string;
  genre: GenreId;
  logline: string;
  style: string;
  story: string;
  characterIds: string[];
  environmentIds: string[];
  cameraLanguage: string;
  continuityRules: string[];
  scenes: ProductionScene[];
  blueprintId: string | null;
  createdAt: string;
  updatedAt: string;
}

// ----- reverse engineering --------------------------------------------------

export interface BlueprintShot {
  index: number;
  start: number;
  end: number;
  /** Small JPEG data URLs: first / middle / last of the shot. */
  keyframes: string[];
  /** Labels like "Person A" — mapped to new characters at recreation. */
  characters: string[];
  positions: string;
  actions: string;
  dialogue: string;
  emotion: string;
  camera: { angle: string; move: CameraMove; amount: Amount; speed: Speed };
  lighting: string;
  environment: string;
  props: string;
  transitionIn: string;
  /** Measured, not judged: how different this shot's first frame is from the previous shot's last (0..1). */
  cutStrength: number;
}

export interface Blueprint {
  id: string;
  sourceName: string;
  durationSec: number;
  width: number;
  height: number;
  createdAt: string;
  /** How the shots were found. */
  detection: "browser-histogram" | "ffmpeg-scdet";
  /** Who wrote the descriptions. */
  engine: "ai" | "offline";
  genre: GenreId;
  style: string;
  editingRhythm: string;
  sound: string;
  characters: { label: string; description: string }[];
  environments: { label: string; description: string }[];
  shots: BlueprintShot[];
  notice?: string;
}

export interface BlueprintMeta {
  id: string;
  sourceName: string;
  durationSec: number;
  shotCount: number;
  genre: GenreId;
  style: string;
  createdAt: string;
  /** One small thumbnail. */
  cover: string | null;
}

// ----- guide ----------------------------------------------------------------

export interface GuideSection {
  id: string;
  title: string;
  /** Markdown. */
  body: string;
  /** Set for genre-module sections. */
  genre?: GenreId;
}

export interface Evidence {
  /** "camera=plain-big improved camera by +1.4 (90% interval +0.3..+2.5, n=6)" */
  text: string;
  technique?: TechniqueId;
  dimension?: Dimension;
  delta?: number;
  ciLo?: number;
  ciHi?: number;
  n?: number;
  generationIds?: string[];
}

export interface GuidePatch {
  strategy?: Partial<Strategy>;
  genreStrategy?: { genre: GenreId; set: Partial<Strategy> }[];
  sections?: GuideSection[];
}

export type ChangeStatus = "pending" | "approved" | "rejected";

export interface ChangeRecord {
  id: string;
  kind: "seed" | "technique" | "section" | "rollback" | "combination";
  /** What changed, in one line. */
  title: string;
  why: string;
  problem: string;
  experimentIds: string[];
  evidence: Evidence[];
  patch: GuidePatch;
  status: ChangeStatus;
  proposedBy: "agent" | "owner" | "seed";
  createdAt: string;
  decidedAt?: string;
  decisionNote?: string;
  /** Version this produced once approved. */
  version?: number;
}

export interface GuideVersion {
  version: number;
  createdAt: string;
  strategy: Strategy;
  genreStrategy: Record<GenreId, Partial<Strategy>>;
  sections: GuideSection[];
  /** The change that produced this version. */
  changeId: string;
  /** Short summary for the history rail. */
  summary: string;
}

// ----- experiments, scenarios, generations ----------------------------------

/** The controlled variable: a scene every arm renders. */
export interface Scenario {
  id: string;
  title: string;
  spec: ShotSpec;
  createdAt: string;
  source: "seed" | "agent" | "owner" | "blueprint";
}

export type ExperimentStatus = "draft" | "queued" | "running" | "evaluating" | "concluded" | "archived";

export interface Experiment {
  id: string;
  /** "A", "B" … for the eye. */
  code: string;
  name: string;
  version: number;
  hypothesis: string;
  intendedImprovement: string;
  /** Technique settings over the master's genre strategy. */
  overrides: Partial<Strategy>;
  /** Extra writing instruction the compiler appends to the closing block. */
  instructions: string;
  /** Dimensions this experiment expects to move. */
  targets: Dimension[];
  scenarioIds: string[];
  baseVersion: number;
  status: ExperimentStatus;
  createdBy: "agent" | "owner" | "seed";
  createdAt: string;
  updatedAt: string;
  strengths: string[];
  weaknesses: string[];
  conclusion: string;
}

export type Arm = "master" | "experiment";

export type GenerationStatus = "queued" | "claimed" | "rendering" | "done" | "failed" | "cancelled";

/** The WanGP settings object, forwarded verbatim to wangp_generate. */
export type WanSettings = Record<string, unknown>;

/** What ffmpeg measured on a clip — evidence, not opinion. */
export interface ClipMetrics {
  durationSec: number;
  width: number;
  height: number;
  fps: number;
  frames: number;
  /** Scene-change scores above threshold (unintended cuts inside one shot). */
  cuts: { t: number; score: number }[];
  /** Mean SSIM between consecutive sampled frames. */
  ssimAdjacent: number;
  /** Lowest consecutive SSIM (a jump / morph). */
  ssimMin: number;
  /** Where that lowest SSIM happened. */
  ssimMinAt: number;
  /** SSIM of the first sampled frame vs the last (how much the shot changed overall). */
  ssimFirstLast: number;
  /** Frozen stretches. */
  freezes: { start: number; end: number }[];
  /** Mean luma per sampled frame (0-255) — exposure drift. */
  luma: number[];
  /** Estimated camera motion from vidstabdetect, summed over the clip (pixels / degrees / zoom %). */
  motion: { dx: number; dy: number; rot: number; zoom: number; energy: number } | null;
  /** Camera move the measurement points to. */
  measuredMove: CameraMove | "unknown";
  /** Timestamps of the frames the worker extracted for judging. */
  sampleTimes: number[];
  /** Measurements the worker could not take (an ffmpeg step failed); their fields hold neutral values. */
  unmeasured?: string[];
}

export interface DimensionScore {
  /** 0..10 */
  value: number;
  /** 0..1 */
  confidence: number;
  source: "measured" | "vision" | "owner";
  evidence: string;
}

export type Scores = Partial<Record<Dimension, DimensionScore>>;

export interface Generation {
  id: string;
  /** The scenario rendered. */
  scenarioId: string;
  experimentId: string | null;
  arm: Arm;
  /** Pairs a master render with an experiment render of the same scenario + seed. */
  pairKey: string;
  genre: GenreId;
  prompt: string;
  settings: WanSettings;
  strategy: Strategy;
  guideVersion: number;
  seed: number;
  status: GenerationStatus;
  queuedAt: string;
  startedAt?: string;
  finishedAt?: string;
  /** Seconds WanGP spent. */
  renderSeconds?: number;
  error?: string;
  /** Where the clip is. */
  clip?: { key: string | null; localPath: string | null; bytes: number };
  /** How many judging frames the worker extracted (kept in their own doc; GET /api/h3-lab/frames?gen=). */
  frameCount?: number;
  metrics?: ClipMetrics;
  scores?: Scores;
  /** 0..10, genre-weighted. */
  overall?: number;
  ownerVerdict?: "good" | "mixed" | "bad" | null;
  ownerNote?: string;
  /** Continuity inspection against the spec (and the previous scene). */
  issues?: InspectionIssue[];
  /** When the vision judge (or its offline fallback) last scored this clip. */
  judgedAt?: string;
  /** What judged it: a model id, "claude-code", or "measured-only" when no judge was available. */
  judgedBy?: string;
  /** The judge's one-paragraph read of the clip. */
  judgeSummary?: string;
  /** Production scene this belongs to, when rendered for a production. */
  productionId?: string;
  sceneId?: string;
  /**
   * The shot this was rendered from, kept on the generation itself. A one-off
   * render belongs to no scenario, and a scenario can be deleted later, so
   * without this a finished clip could never be scored or re-inspected.
   */
  spec?: ShotSpec;
}

// ----- continuity inspector --------------------------------------------------

export type IssueKind =
  | "character-morph"
  | "identity-change"
  | "wardrobe-change"
  | "body-change"
  | "position-wrong"
  | "environment-change"
  | "furniture-moved"
  | "object-missing"
  | "lighting-jump"
  | "camera-wrong"
  | "movement-broken"
  | "action-wrong"
  | "unintended-cut"
  | "frozen"
  | "duplicate-subject";

export interface InspectionIssue {
  kind: IssueKind;
  severity: "low" | "medium" | "high";
  /** 0..1 */
  confidence: number;
  /** Seconds into the clip, when known. */
  at: number | null;
  /** What the evidence is (a measurement or what the judge saw). */
  evidence: string;
  /** Measured vs judged. */
  source: "measured" | "vision";
  recommendation: string;
  /** Indices into the generation's frames that show it. */
  frames: number[];
}

// ----- agent -----------------------------------------------------------------

export type AgentMode = "running" | "paused" | "stopped";

export type Brain = "hub-ai" | "claude-code";

export interface AgentSettings {
  mode: AgentMode;
  /** manual = every guide change waits for the owner. auto = promote when evidence clears the bar. */
  promotion: "manual" | "auto";
  /** Minimum paired comparisons before a technique can be promoted. */
  minPairs: number;
  /** Lower bound of the 90% interval that must be above this to promote. */
  minLowerBound: number;
  rendersPerDay: number;
  aiCallsPerDay: number;
  maxConcurrentExperiments: number;
  /** Which brain does the reasoning steps. */
  brain: Brain;
  /** Model id for hub-ai reasoning (vision-capable). */
  model: string;
  /** turbo = 4-step 832x480 (~6 min on the 3050); hi = 20-step two-phase. */
  quality: "turbo" | "hi";
  /** Seconds of video per test render. */
  testSeconds: number;
  /** What the owner wants worked on first. */
  priorities: string[];
}

export interface AgentCounters {
  day: string;
  renders: number;
  aiCalls: number;
}

export type ActivityKind =
  | "analyze-reference"
  | "weakness"
  | "research"
  | "design-experiment"
  | "compile-tests"
  | "queue-render"
  | "render"
  | "measure"
  | "evaluate"
  | "compare"
  | "conclude"
  | "propose"
  | "approve"
  | "reject"
  | "rollback"
  | "publish"
  | "control"
  | "error"
  | "worker";

export interface ActivityEntry {
  id: string;
  at: string;
  actor: "agent" | "worker" | "owner" | "system";
  kind: ActivityKind;
  text: string;
  ref?: { type: "experiment" | "generation" | "change" | "blueprint" | "production" | "repo"; id: string };
}

export interface WorkerStatus {
  lastSeen: string | null;
  machine: string;
  version: string;
  wangp: "ready" | "down" | "busy" | "unknown";
  wangpDetail: string;
  ffmpeg: boolean;
  claude: boolean;
  current: string | null;
  /** Model types WanGP reported as available. */
  models: string[];
  queueDepth: number;
}

/** A reasoning task handed to the PC's Claude Code when brain = claude-code. */
export interface ThinkJob {
  id: string;
  step: AgentStepKind;
  prompt: string;
  /** Images to show (data URLs). */
  images: string[];
  state: "queued" | "claimed" | "done" | "failed";
  createdAt: string;
  claimedAt?: string;
  result?: string;
  error?: string;
  /** What to apply the answer to. */
  context: Record<string, string>;
}

export type AgentStepKind =
  | "evaluate"
  | "conclude"
  | "combine"
  | "queue"
  | "design"
  | "research"
  | "idle";

// ----- repositories ----------------------------------------------------------

export interface RepoRow {
  id: string;
  name: string;
  url: string;
  description: string;
  capabilities: string[];
  license: string;
  compatibility: "good" | "partial" | "poor" | "unknown";
  compatibilityNote: string;
  reusable: string[];
  recommendation: "integrate" | "adapt" | "learn" | "skip" | "review";
  integration: "in-use" | "techniques-learned" | "approval-needed" | "not-integrated" | "rejected";
  reviewedAt: string | null;
  discoveredBy: "owner" | "agent" | "seed";
  notes: string;
}

// ----- the whole lab ------------------------------------------------------------

export interface LabState {
  schema: 1;
  guide: {
    versions: GuideVersion[];
    current: number;
    changes: ChangeRecord[];
    /** Last time the approved guide was written to the h3-prompt skill. */
    publishedVersion: number | null;
    publishedAt: string | null;
  };
  experiments: Experiment[];
  scenarios: Scenario[];
  generations: Generation[];
  characters: Character[];
  environments: Environment[];
  productions: Production[];
  /** Summaries; the full blueprint (with keyframes) is its own doc — GET /api/h3-lab/blueprint?id=. */
  blueprints: BlueprintMeta[];
  repos: RepoRow[];
  agent: AgentSettings;
  counters: AgentCounters;
  /** When the research step last ran. */
  lastResearchAt: string | null;
  activity: ActivityEntry[];
  worker: WorkerStatus;
  think: ThinkJob[];
}

export const DIMENSIONS: readonly Dimension[] = [
  "character",
  "environment",
  "continuity",
  "camera",
  "action",
  "movement",
  "cinematography",
  "dialogue",
  "genre",
  "visual",
  "adherence",
];

export const DIMENSION_LABEL: Record<Dimension, string> = {
  character: "Character consistency",
  environment: "Environment consistency",
  continuity: "Scene continuity",
  camera: "Camera accuracy",
  action: "Action accuracy",
  movement: "Movement quality",
  cinematography: "Cinematography",
  dialogue: "Dialogue quality",
  genre: "Genre accuracy",
  visual: "Visual quality",
  adherence: "Overall adherence",
};

/** Which dimensions ffmpeg evidence can speak to; the rest need eyes. */
export const MEASURED_DIMENSIONS: readonly Dimension[] = ["environment", "continuity", "camera", "movement", "visual"];
