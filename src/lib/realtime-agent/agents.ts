// ---------------------------------------------------------------------------
// The three agents this app switches between.
//
// Nothing here is new machinery. Each one is an existing surface in the hub:
//   3d          — the Three.js avatar (src/components/new-jarvis/avatar)
//   local-face  — LiveTalking on the owner's PC, port 8010, free
//   pod-face    — the same LiveTalking + MuseTalk on a RunPod GPU, BILLED
//
// The only agent that can cost money is `pod-face`, and that is the one fact
// the whole app is organised around: `billed` drives the confirm gate, the
// running banner and the idle auto-stop.
// ---------------------------------------------------------------------------

export type AgentId = "3d" | "local-face" | "pod-face";

/** How the agent's face is drawn. */
export type Surface = "three" | "livetalking";

export interface AgentDef {
  id: AgentId;
  name: string;
  /** One line, shown under the name on the picker. */
  tag: string;
  surface: Surface;
  /** True when selecting this agent can spend the owner's money. */
  billed: boolean;
  /** What it needs before it can answer, in plain English (R4). */
  needs: string;
}

export const AGENTS: readonly AgentDef[] = [
  {
    id: "3d",
    name: "3D agent",
    tag: "The Three.js face. Always here, costs nothing, never waits for a GPU.",
    surface: "three",
    billed: false,
    needs: "Nothing — it runs in this tab.",
  },
  {
    id: "local-face",
    name: "Local agent",
    tag: "Photoreal LiveTalking on this PC. Free, and about 25 fps on a 3050.",
    surface: "livetalking",
    billed: false,
    needs: "LiveTalking running on this PC at port 8010.",
  },
  {
    id: "pod-face",
    name: "RunPod agent",
    tag: "LiveTalking + MuseTalk on a rented GPU. Sharper, and billed by the hour.",
    surface: "livetalking",
    billed: true,
    needs: "RUNPOD_API_KEY and a pod id, and the pod has to be started.",
  },
] as const;

export function agentById(id: string): AgentDef | undefined {
  return AGENTS.find((a) => a.id === id);
}

/** Is this agent one we must ask about before touching? Money only. */
export function needsConfirm(id: string): boolean {
  return agentById(id)?.billed === true;
}

/**
 * What the picker shows for each agent.
 *
 *   ready      — answering now
 *   offline    — reachable in principle, not running
 *   starting   — asked to start, not up yet
 *   billing    — up AND costing money
 *   unset      — missing a key or an id; the app says which
 */
export type AgentHealth = "ready" | "offline" | "starting" | "billing" | "unset";

export const HEALTH_LABEL: Record<AgentHealth, string> = {
  ready: "Ready",
  offline: "Not running",
  starting: "Starting",
  billing: "Running — billing",
  unset: "Not set up",
};

/** Can the owner talk to it right now? */
export function isTalkable(health: AgentHealth): boolean {
  return health === "ready" || health === "billing";
}
