// ---------------------------------------------------------------------------
// Financial Bible — the shapes.
//
// A build plan is DATA, not prose, and this file is the reason. Everything the
// sheet shows — the total, the timeline, the progress bar, whether a number has
// been checked against the world — is computed from these fields, so the agent
// has to commit to numbers rather than describing them. A plan written as
// markdown cannot be totalled, cannot be diffed, and cannot tell you which of
// its prices somebody actually verified.
//
// Two fields carry most of the app's honesty. `Provenance` says where a number
// came from, and `user` outranks everything: nothing the owner typed is ever
// overwritten by a generation or a verify pass. `legal` holds a QUESTION and
// who to ask, never an answer — this app does not tell anybody what is legal
// where they live.
// ---------------------------------------------------------------------------

/** Where the owner is building, which decides suppliers and currency. */
export interface HomeBase {
  city: string;
  region: string;
  country: string;
  /** ISO 4217, e.g. "USD". */
  currency: string;
}

/** A cost is always a range. A single invented number reads as a fact. */
export interface Money {
  low: number;
  high: number;
  currency: string;
}

/**
 * Where a number came from.
 *   estimate — the model's knowledge. Honest default, labelled as such.
 *   verified — a verify pass read it off a real page, and `source` says where.
 *   user     — the owner typed it. Sacred: never overwritten, never dropped.
 */
export type Provenance = "estimate" | "verified" | "user";

export interface Material {
  id: string;
  /** "primed pine moulding, 1.5in" — specific enough to buy. */
  name: string;
  qty: number;
  /** "ft", "sheet", "each". */
  unit: string;
  unitCost?: Money;
  provenance: Provenance;
  /** Ids of suppliers on the same step that can supply this. */
  supplierIds: string[];
}

export interface Supplier {
  id: string;
  name: string;
  /** What you buy here. */
  what: string;
  /** A street address, or "ships nationwide". */
  where?: string;
  phone?: string;
  url?: string;
  price?: Money;
  /** Set only by the verify pass: the page this was read from. */
  source?: string;
  /** ISO date. A price with no date is a rumour. */
  foundAt?: string;
}

export interface Step {
  id: string;
  /** Imperative. "Cut the moulding to length". */
  title: string;
  /** One to three sentences of how, pitched at the brief's skill level. */
  detail: string;
  /**
   * The whole cost of this step INCLUDING its materials. When absent, the
   * materials are summed instead. See totals.ts — this one rule is what stops
   * the sheet double-counting.
   */
  cost?: Money;
  /** "rental, per day" / "one-off, reusable". */
  costNote?: string;
  provenance: Provenance;
  /** Hands-on effort, not elapsed time. */
  hours?: number;
  materials: Material[];
  suppliers: Supplier[];
  /** How you know this step came out right. */
  check?: string;
  /** A thing to check with somebody. Never an answer. */
  legal?: { question: string; whoToAsk: string };
  done: boolean;
  skipped: boolean;
  /** The owner's own note. The agent may never write or clear this. */
  note?: string;
}

export interface Phase {
  id: string;
  /** "Buy the stock" / "Make the first frame". */
  title: string;
  /** What is true when this phase is finished. */
  goal: string;
  /** Elapsed days, including waiting for deliveries. */
  days?: number;
  steps: Step[];
}

/** The nine things a build plan does NOT cover unless the owner asks. */
export type ExtraTopic =
  | "legal-structure"
  | "insurance"
  | "banking"
  | "taxes"
  | "branding"
  | "marketing"
  | "selling-online"
  | "hiring"
  | "scaling";

export interface Extra {
  id: string;
  topic: ExtraTopic;
  /** Markdown. */
  body: string;
  createdAt: string;
}

export interface Plan {
  /** 1, 2, 3 … every accepted patch bumps it. */
  version: number;
  createdAt: string;
  /** Which model wrote it, for when one starts writing worse. */
  model: string;
  summary: string;
  /** What the agent assumed, written out loud so a wrong one is correctable. */
  assumptions: string[];
  /** What it needs from the owner to get sharper. */
  openQuestions: string[];
  phases: Phase[];
  /** First-unit economics, when they can be established honestly. */
  unit?: { cost: Money; sellsFor?: Money; note?: string };
  /** The Beyond-the-build shelf. EMPTY unless the owner pressed a button. */
  extras: Extra[];
}

export type Scale = "one-off" | "a-few" | "side-income" | "product-line";
export type Skill = "none" | "handy" | "pro";

/** The answers from the new-idea form. Only `what` is required. */
export interface Brief {
  what: string;
  scale: Scale;
  skill: Skill;
  budgetCeiling?: Money;
  /** "mitre saw, drill, a one-car garage". */
  toolsOwned?: string;
  /** For an idea being built somewhere other than home. */
  locationOverride?: HomeBase;
}

export type IdeaStatus = "idea" | "planning" | "building" | "built" | "parked";

export interface Message {
  id: string;
  role: "owner" | "agent";
  text: string;
  /** ISO date. */
  at: string;
  /** What this answer proposed, and what the owner did with it. */
  proposed?: unknown[];
  outcome?: "accepted" | "discarded" | "pending";
  /** The plan version this answer was written against. */
  againstVersion: number;
}

export interface Idea {
  id: string;
  title: string;
  oneLiner: string;
  brief: Brief;
  status: IdeaStatus;
  tags: string[];
  pinned: boolean;
  /** Oldest first. The LAST entry is the current plan. */
  plans: Plan[];
  chat: Message[];
  createdAt: string;
  updatedAt: string;
}

/** What one device holds, before seeds are folded in. */
export interface BibleStore {
  homeBase: HomeBase | null;
  ideas: Idea[];
  /** Seeded ideas the owner deleted, so they cannot come back on reload. */
  hiddenSeeds: string[];
  lastRoom: string | null;
}

export function emptyStore(): BibleStore {
  return { homeBase: null, ideas: [], hiddenSeeds: [], lastRoom: null };
}

export function emptyBrief(): Brief {
  return { what: "", scale: "a-few", skill: "handy" };
}
