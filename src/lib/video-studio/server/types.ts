import "server-only";
import type { Capability, PlanScene, Project, VideoBrief } from "../types";

// ---------------------------------------------------------------------------
// The server half of a method.
//
// Only `detect` is required — it is the part that must never lie. Everything
// else has a working default:
//
//   optimise  — the shared AI optimiser, driven by the method's own
//               optimiserSystem prompt (server/optimise.ts).
//   execution — a transport:"agent" method is queued for the runner on the
//               owner's PC; a transport:"server" method implements the two
//               scene hooks below and runs inside the request.
//
// A method that needs neither hook (every agent method) omits both.
// ---------------------------------------------------------------------------

export interface SceneContext {
  uid: string;
  project: Project;
  scene: PlanScene;
  brief: VideoBrief;
  /** The engine-specific instruction produced by the optimiser. */
  directive: string;
  /** The previous scene's last frame, as a data URL, when one exists. */
  previousFrame?: string;
}

export type SceneStart =
  /** Handed to a hosted model; poll it. */
  | { kind: "task"; taskId: string; note?: string }
  /** Finished inside the call. */
  | { kind: "clip"; clip: Buffer; note?: string };

export type ScenePoll =
  | { state: "running"; note?: string }
  | { state: "done"; clip: Buffer }
  | { state: "failed"; error: string };

export interface MethodServer {
  id: string;
  /** Look at the machine and say what is actually there. Never optimistic. */
  detect(uid: string): Promise<Capability>;
  /** Override the shared AI optimiser for this engine. Rarely needed. */
  optimise?(brief: VideoBrief, scenes: PlanScene[]): Promise<Record<string, string>>;
  /** transport:"server" only — kick off one scene. */
  startScene?(ctx: SceneContext): Promise<SceneStart>;
  /** transport:"server" only — poll a scene started above. */
  pollScene?(taskId: string): Promise<ScenePoll>;
}
