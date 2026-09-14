// ---------------------------------------------------------------------------
// Game Creator: shared types.
//
// A Game is one prompt's journey through the builder on the owner's PC:
// queued here, claimed by the builder, built in Unreal Engine by the
// unreal-game-builder skill, and reported back with a manifest and
// screenshots. The website never touches Unreal; it only keeps this record.
// ---------------------------------------------------------------------------

export type GameStatus =
  | "queued"
  | "designing"
  | "building"
  | "testing"
  | "packaging"
  | "ready"
  | "failed";

/** Statuses the builder is still working through. */
export const ACTIVE_STATUSES: GameStatus[] = ["queued", "designing", "building", "testing", "packaging"];

export const STATUS_LABEL: Record<GameStatus, string> = {
  queued: "Waiting for your PC",
  designing: "Designing",
  building: "Building in Unreal",
  testing: "Playtesting",
  packaging: "Packaging",
  ready: "Ready to play",
  failed: "Build failed",
};

export type TemplateId = "Auto" | "FirstPerson" | "ThirdPerson" | "TopDown" | "Vehicle" | "Blank";

export const TEMPLATES: { id: TemplateId; label: string; blurb: string }[] = [
  { id: "Auto", label: "Let it choose", blurb: "The builder picks the template that fits your idea." },
  { id: "FirstPerson", label: "First person", blurb: "Shooters, puzzle rooms, horror, parkour." },
  { id: "ThirdPerson", label: "Third person", blurb: "Platformers, action, collectathons." },
  { id: "TopDown", label: "Top down", blurb: "Twin-stick, dungeon crawlers, strategy-lite." },
  { id: "Vehicle", label: "Vehicle", blurb: "Racing and driving challenges." },
  { id: "Blank", label: "Blank", blurb: "Everything built from scratch." },
];

export function isTemplateId(value: unknown): value is TemplateId {
  return TEMPLATES.some((t) => t.id === value);
}

export interface LogLine {
  /** ISO time the builder saw the line. */
  t: string;
  line: string;
}

export interface GameShot {
  /** Blob key under the game-shots bucket. */
  key: string;
  caption?: string;
  /** The file name on the PC, used to avoid uploading the same shot twice. */
  file?: string;
  at: string;
}

export interface GameCut {
  feature: string;
  reason: string;
}

export interface GamePaths {
  uproject?: string;
  projectDir?: string;
  packagedExe?: string;
}

/** What the skill writes to GameCreator/game.json, as far as the site cares. */
export interface GameManifest {
  title?: string;
  summary?: string;
  genre?: string;
  template?: string;
  controls?: string[];
  features?: string[];
  cut?: GameCut[];
  uproject?: string;
  packagedExe?: string;
}

export interface Game {
  id: string;
  ownerId: string;
  prompt: string;
  template: TemplateId;
  createdAt: string;
  updatedAt: string;
  status: GameStatus;
  /** One line of what the builder is doing right now. */
  note?: string;
  title?: string;
  summary?: string;
  genre?: string;
  controls?: string[];
  features?: string[];
  cut?: GameCut[];
  /** Design.md, markdown. */
  design?: string;
  log: LogLine[];
  screenshots: GameShot[];
  paths?: GamePaths;
  error?: string;
  startedAt?: string;
  finishedAt?: string;
}

/** A progress post from the builder. Every field is optional. */
export interface ProgressUpdate {
  status?: GameStatus;
  note?: string;
  lines?: string[];
  design?: string;
  manifest?: GameManifest;
  paths?: GamePaths;
}

export const MAX_LOG_LINES = 500;
export const MAX_SCREENSHOTS = 24;
export const MAX_PROMPT_CHARS = 4000;
