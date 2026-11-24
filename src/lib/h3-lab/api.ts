// ---------------------------------------------------------------------------
// H3 Prompt Lab — the wire contract.
//
// Browser ⇄ hub:  GET/POST /api/h3-lab/lab, POST /api/h3-lab/analyze,
//                 GET /api/h3-lab/{frames,blueprint,clip}
// PC worker ⇄ hub (Bearer worker token, session-exempt by exact path):
//                 POST /api/h3-lab/worker/{claim,progress,upload,result,think}
// Anyone with a tick credential (owner session, worker token, H3LAB_TICK_TOKEN):
//                 POST /api/h3-lab/agent/tick
//
// Pure types only. tools/h3-lab-worker (plain .mjs) mirrors these shapes; its
// README lists them, so change both together.
// ---------------------------------------------------------------------------

import type {
  AgentSettings,
  Character,
  ChangeRecord,
  ClipMetrics,
  Environment,
  Experiment,
  GuidePatch,
  LabState,
  Production,
  RepoRow,
  ShotSpec,
  Strategy,
  ThinkJob,
  WanSettings,
  WorkerStatus,
  AgentMode,
  AgentStepKind,
  DimensionScore,
  Dimension,
  BlueprintShot,
  GenreId,
} from "./model";

// ----- browser ⇄ hub ----------------------------------------------------------

export interface LabResponse {
  state: LabState;
  /** "remote" = Supabase server_docs; "local" = a file on this machine. */
  storage: "remote" | "local";
  /** Whether hub-ai reasoning has a key. */
  aiConfigured: boolean;
  /** Whether a worker token has ever been minted. */
  workerPaired: boolean;
  /** Whether the scheduled tick has a token configured on this deploy. */
  tickConfigured: boolean;
}

export type LabAction =
  | { action: "agent.control"; mode: AgentMode }
  | { action: "agent.settings"; patch: Partial<AgentSettings> }
  | { action: "agent.tick" }
  | {
      action: "experiment.create";
      experiment: Pick<Experiment, "name" | "hypothesis" | "intendedImprovement" | "overrides" | "instructions" | "targets" | "scenarioIds">;
    }
  | { action: "experiment.update"; id: string; patch: Partial<Pick<Experiment, "name" | "hypothesis" | "intendedImprovement" | "overrides" | "instructions" | "targets" | "scenarioIds">> }
  | { action: "experiment.queue"; id: string }
  | { action: "experiment.archive"; id: string }
  | { action: "scenario.save"; scenario: { id?: string; title: string; spec: ShotSpec } }
  | { action: "scenario.delete"; id: string }
  | { action: "generation.rate"; id: string; verdict: "good" | "mixed" | "bad" | null; note?: string; scores?: Partial<Record<Dimension, number>> }
  | { action: "generation.cancel"; id: string }
  | { action: "generation.retry"; id: string }
  | { action: "render.single"; spec: ShotSpec; strategy?: Partial<Strategy>; experimentId?: string; instructions?: string }
  | { action: "change.approve"; id: string; note?: string }
  | { action: "change.reject"; id: string; note?: string }
  | { action: "change.propose"; change: Pick<ChangeRecord, "title" | "why" | "problem" | "experimentIds"> & { patch: GuidePatch } }
  | { action: "guide.rollback"; version: number; why: string }
  | { action: "guide.publish" }
  | { action: "character.save"; character: Partial<Character> & { name: string } }
  | { action: "character.delete"; id: string }
  | { action: "environment.save"; environment: Partial<Environment> & { name: string } }
  | { action: "environment.delete"; id: string }
  | { action: "production.save"; production: Partial<Production> & { title: string } }
  | { action: "production.delete"; id: string }
  | { action: "production.compile"; id: string }
  | { action: "production.render"; id: string; sceneIds?: string[] }
  | { action: "blueprint.recreate"; id: string; title: string; castMap: Record<string, string>; envMap: Record<string, string> }
  | { action: "blueprint.delete"; id: string }
  | { action: "repo.save"; repo: Partial<RepoRow> & { name: string; url: string } }
  | { action: "repo.delete"; id: string }
  | { action: "inspect.run"; generationId: string; previousId?: string | null }
  | { action: "worker.token" };

export interface ActionResponse {
  state: LabState;
  /** Set by worker.token — shown once. */
  token?: string;
  /** Set by agent.tick — what the step did. */
  step?: StepResult;
  /** Set by actions that create something. */
  id?: string;
  notice?: string;
}

export interface StepResult {
  kind: AgentStepKind;
  did: string;
  /** True when the step changed state. */
  changed: boolean;
}

/** POST /api/h3-lab/analyze — the browser found the shots and grabbed frames. */
export interface AnalyzeRequest {
  name: string;
  durationSec: number;
  width: number;
  height: number;
  genre?: GenreId;
  /** What the owner says about it (optional). */
  note?: string;
  shots: { start: number; end: number; cutStrength: number; frames: string[] }[];
  /** Audio summary measured in the browser, if any. */
  audio?: string;
}

export interface AnalyzeResponse {
  blueprintId: string;
  engine: "ai" | "offline";
  notice?: string;
  state: LabState;
}

export type ShotDraft = Omit<BlueprintShot, "keyframes" | "cutStrength" | "index" | "start" | "end">;

// ----- PC worker ⇄ hub ------------------------------------------------------------

/** POST /api/h3-lab/worker/claim body. Also the heartbeat. */
export interface ClaimRequest {
  status: Partial<WorkerStatus>;
  /** The worker can take a render now (WanGP idle). */
  canRender: boolean;
  /** The worker can take a think job now (claude CLI present and a slot free). */
  canThink: boolean;
}

export type ClaimResponse =
  | { kind: "render"; generation: { id: string; prompt: string; settings: WanSettings; seconds: number } }
  | { kind: "think"; job: ThinkJob }
  | { kind: "tick" };

/** POST /api/h3-lab/worker/progress */
export interface ProgressRequest {
  generationId: string;
  status: "rendering" | "measuring" | "uploading";
  detail: string;
}

/** POST /api/h3-lab/worker/upload — a signed Storage PUT for the clip. */
export interface UploadRequest {
  generationId: string;
}

export interface UploadResponse {
  url: string | null;
  key: string | null;
}

/** POST /api/h3-lab/worker/result */
export interface ResultRequest {
  generationId: string;
  ok: boolean;
  error?: string;
  renderSeconds?: number;
  clipKey?: string | null;
  localPath?: string | null;
  bytes?: number;
  metrics?: ClipMetrics;
  /** Small JPEG data URLs at metrics.sampleTimes. */
  frames?: string[];
}

/** POST /api/h3-lab/worker/think */
export interface ThinkResultRequest {
  jobId: string;
  ok: boolean;
  result?: string;
  error?: string;
}

// ----- what a vision judge returns --------------------------------------------------

export interface JudgeOutput {
  scores: Partial<Record<Dimension, Pick<DimensionScore, "value" | "confidence" | "evidence">>>;
  issues: { kind: string; severity: "low" | "medium" | "high"; confidence: number; frame: number; evidence: string; recommendation: string }[];
  summary: string;
}
