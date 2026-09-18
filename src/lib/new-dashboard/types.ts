// ---------------------------------------------------------------------------
// New Dashboard — a personal AI Operating System dashboard, built on the
// AIS-OS kit (github.com/nateherkai/AIS-OS, MIT, © Nate Herk).
//
// One Profile = one person's AI OS. The owner has one; anyone they onboard
// gets their own, so the same app doubles as an onboarding tool for others.
// The shape mirrors the kit's Four Cs: Context (intake answers), Connections
// (the 7-domain registry), Capabilities (skills/workflows), Cadence (things
// that run without being asked), plus the kit's append-only decisions log.
// ---------------------------------------------------------------------------

export type QuestionId = "q1" | "q2" | "q3" | "q4" | "q5" | "q6" | "q7";

/** How a connection is wired, using the kit's own vocabulary. */
export type Mechanism = "not-connected" | "mcp" | "script" | "export" | "key+ref";

export interface Connection {
  /** One of the kit's 7 Tier-1 domains. */
  domain: string;
  /** Tool(s) the person uses for that domain, e.g. "Gmail". */
  tool: string;
  mechanism: Mechanism;
  /** ISO date the connection was last seen working, or "". */
  lastChecked: string;
}

export interface Capability {
  id: string;
  /** Skill or workflow name, e.g. "/website-redesigner". */
  name: string;
  /** The short phrase that triggers it. */
  trigger: string;
  /** What it produces. */
  output: string;
}

export interface Routine {
  id: string;
  name: string;
  /** Plain-English schedule, e.g. "Weekdays 7am". */
  schedule: string;
  /** ISO date it last actually ran, or "". Evidence, not intention. */
  lastRun: string;
}

export interface Decision {
  id: string;
  date: string;
  title: string;
  decision: string;
  why: string;
}

export interface Intake {
  q1: string;
  /** Two raw voice samples. Pasted, never typed — see the onboarding rule. */
  q2: [string, string];
  q3: [string, string, string];
  q4: string;
  q5: string;
  q6: string;
  q7: string;
}

export interface Profile {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  /** True once the 7-question onboarding has been finished at least once. */
  onboarded: boolean;
  intake: Intake;
  connections: Connection[];
  capabilities: Capability[];
  routines: Routine[];
  decisions: Decision[];
  /** Priority indexes (0-2) the person has marked done this quarter. */
  prioritiesDone: number[];
}

export interface DashboardStore {
  version: 1;
  profiles: Profile[];
  activeId: string | null;
}
