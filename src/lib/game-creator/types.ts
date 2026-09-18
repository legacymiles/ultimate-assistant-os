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

/**
 * A message the owner typed on the game page. The builder hands pending ones to
 * the running Claude session (or starts a follow-up session for a finished
 * game); Claude's answers show up as its narration in the build log.
 */
export interface GameMessage {
  id: string;
  text: string;
  at: string;
  /** pending = not yet handed to Claude; delivered = Claude has it. */
  state: "pending" | "delivered";
  deliveredAt?: string;
}

export type LaunchAction = "play" | "open";

export interface GameLaunch {
  action: LaunchAction;
  at: string;
  /** pending = waiting for the PC; sent = the builder has picked it up. */
  state: "pending" | "sent";
  sentAt?: string;
}

/** A game-building skill the owner's PC offers (from its skills folder). */
export interface BuildSkill {
  name: string;
  description?: string;
}

export interface BuilderSkills {
  skills: BuildSkill[];
  /** Always one of `skills` when the list is not empty. */
  defaultSkill: string | null;
  at: string;
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
  /** The one game-building skill this game is built with. */
  skill?: string;
  /** Claude confirmed loading `skill` (seen in its tool calls). */
  skillUsed?: boolean;
  /** Claude Code session id, so follow-up messages continue the same session. */
  sessionId?: string;
  /** Owner's messages to the agent, oldest first. */
  messages?: GameMessage[];
  /** Queued again because the owner asked for changes to a finished game. */
  followUp?: boolean;
  /**
   * "Play" / "Open in Unreal" pressed on the website. The builder on the PC
   * collects it on its next check-in and opens the game itself, so it works
   * without the browser's custom-link prompt.
   */
  launch?: GameLaunch;
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
  sessionId?: string;
  skillUsed?: boolean;
}

export const MAX_LOG_LINES = 500;
export const MAX_SCREENSHOTS = 24;
export const MAX_PROMPT_CHARS = 4000;
export const MAX_MESSAGE_CHARS = 2000;
export const MAX_MESSAGES = 200;

/** Skill names are folder names: letters, digits, dashes, underscores, colons. */
export function isSkillName(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][\w:.-]{0,79}$/.test(value);
}
