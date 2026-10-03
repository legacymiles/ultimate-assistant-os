# Financial Bible — Build Plans Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `/apps/financial-bible` — a Jarvis plugin whose Build Plans room keeps the owner's business ideas as cards, each card holding an agent-written, costed, sourced build plan that a chat beside it edits by diff.

**Architecture:** A client shell (`?studio=` → one of four rooms, three of them honest "not built yet" panels) over a localStorage-plus-Supabase store, and four thin Next route handlers that call `aiFetch` and hand back JSON. Every rule that matters — what a total is, what an accepted edit preserves, what a verify pass may overwrite, what the app refuses to discuss — lives in a pure, tested module in `src/lib/bible/`, never in a component and never in a prompt alone.

**Tech Stack:** Next 15 App Router, TypeScript, Tailwind v4 + one app CSS file, vitest (node environment — pure reducers are tested, localStorage IO is not), `src/lib/ai/provider.ts` (`aiFetch`, OpenRouter first), `perplexity/sonar` for the verify pass, `src/lib/sync/appState.ts` for cross-device state.

**Spec:** `docs/superpowers/specs/2026-10-02-financial-bible-build-plans-design.md`

---

## Read this before Task 1

Five facts about this codebase that the tasks below assume. Ten minutes here saves an afternoon.

1. **`src/lib/finance/*` is NOT this app.** It is the bank-reconciliation code behind Jarvis's Personal Finance folder. This app's namespace is `src/lib/bible/`. Never add a file to `src/lib/finance/`.
2. **vitest runs in the `node` environment** (`vitest.config.ts`). There is no `localStorage` and no DOM. So every function with logic in it takes a store or a plan and returns a new one; the two functions that touch `localStorage` (`loadRaw`, `saveStore`) have no logic and no tests. `src/lib/ea-world/favorites.test.ts` is the pattern.
3. **`aiFetch` never throws and never leaks a key.** It returns a `Response` — a 503 JSON body when no provider is configured. Routes check `aiKey()` first and return their offline answer rather than an error, because the rule in `CLAUDE.md` is that a missing key degrades visibly and never 500s. `src/app/api/ai-rankings/classify/route.ts` is the reference route; copy its shape.
4. **The hub catalog is the single source of truth.** An app exists because there is one object in `src/lib/catalog.ts`. Jarvis shows it because its slug is in `PLUGIN_SLUGS` (`src/lib/studio/plugins.ts`); `hubProjects()` is then the catalog minus the Jarvis apps, so the two places can never show it twice.
5. **Never run two dev servers on one `.next` dir.** Preview servers use `scripts/dev-preview.mjs` with their own `NEXT_DIST_DIR`. The entry for this app is Task 14.

Run the whole suite at any point with `npx vitest run src/lib/bible/`.

---

## File structure

| File | Responsibility |
|---|---|
| `src/lib/bible/types.ts` | Every shape. No logic. |
| `src/lib/bible/ids.ts` | `uid()`, in one place. Both the server and the store need it. |
| `src/lib/bible/rooms.ts` | The four rooms and `?studio=` validation. |
| `src/lib/bible/totals.ts` | Money, cost totals, progress, timeline, verified share. |
| `src/lib/bible/ops.ts` | Applying an agent's edit to a plan, and what it may not touch. |
| `src/lib/bible/clean.ts` | Trust boundary: model JSON → a usable `Plan` / `Op[]`. |
| `src/lib/bible/verify.ts` | Merging supplier findings without destroying owner data. |
| `src/lib/bible/store.ts` | The store: pure reducers + two IO functions. |
| `src/lib/bible/seed.ts` | The worked picture-frames plan. |
| `src/lib/bible/prompts.ts` | The four system prompts, including the refusal. |
| `src/app/api/bible/{plan,chat,verify,extra}/route.ts` | One AI call each. |
| `src/app/apps/financial-bible/page.tsx` | Server component; validates `?studio=`. |
| `src/components/bible/Bible.tsx` | Shell: which room is mounted, home-base strip. |
| `src/components/bible/rooms/EmptyRoom.tsx` | Scout / Plays / Funding. |
| `src/components/bible/plans/IdeaTable.tsx` | The vault table + new-idea brief. |
| `src/components/bible/plans/PlanSheet.tsx` | Phases, steps, pinned total, timeline. |
| `src/components/bible/plans/StepRow.tsx` | One step: cost, materials, suppliers, legal, check. |
| `src/components/bible/plans/Agent.tsx` | Chat + the Accept/Discard diff gate. |
| `src/components/bible/plans/Beyond.tsx` | The nine buttons and what they return. |
| `src/components/bible/bible.css` | The app's own CSS. |

---

## Task 1: Shapes and rooms

**Files:**
- Create: `src/lib/bible/types.ts`
- Create: `src/lib/bible/ids.ts`
- Create: `src/lib/bible/rooms.ts`
- Test: `src/lib/bible/rooms.test.ts`

- [ ] **Step 1: Write `src/lib/bible/types.ts`**

```ts
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
```

- [ ] **Step 2: Write `src/lib/bible/ids.ts`**

One module, because two would drift. The route handlers mint ids while cleaning a
model's answer, and the store mints them for the owner's own ideas; a second
`uid()` in `store.ts` is how two id schemes end up in one database.

```ts
// ---------------------------------------------------------------------------
// Ids, in one place.
//
// A counter rides along with the clock because a single generation mints dozens
// of ids inside one millisecond, and two steps sharing an id is a bug whose
// symptom is an edit landing on the wrong step — the hardest kind to see.
// ---------------------------------------------------------------------------

let counter = 0;

export function uid(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter.toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}
```

- [ ] **Step 3: Write the failing test `src/lib/bible/rooms.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { DEFAULT_ROOM, ROOMS, isRoom, roomDef } from "./rooms";

describe("rooms", () => {
  it("accepts the four room ids and nothing else", () => {
    expect(isRoom("plans")).toBe(true);
    expect(isRoom("scout")).toBe(true);
    expect(isRoom("plays")).toBe(true);
    expect(isRoom("funding")).toBe(true);
    expect(isRoom("nonsense")).toBe(false);
    expect(isRoom(undefined)).toBe(false);
    expect(isRoom(null)).toBe(false);
  });

  it("lands in Build Plans by default", () => {
    expect(DEFAULT_ROOM).toBe("plans");
  });

  // The rail must be honest about what is not built. A room with `built: false`
  // renders a panel saying so; a dead link would be worse than no link.
  it("has exactly one built room, and the rest say what they will hold", () => {
    expect(ROOMS.filter((r) => r.built).map((r) => r.id)).toEqual(["plans"]);
    for (const room of ROOMS.filter((r) => !r.built)) {
      expect(room.blurb.length).toBeGreaterThan(40);
    }
  });

  it("falls back to the first room rather than returning undefined", () => {
    expect(roomDef("plans").id).toBe("plans");
    // @ts-expect-error deliberately wrong, because a URL can say anything
    expect(roomDef("nope").id).toBe(ROOMS[0].id);
  });
});
```

- [ ] **Step 4: Run it and watch it fail**

Run: `npx vitest run src/lib/bible/rooms.test.ts`
Expected: FAIL — `Failed to resolve import "./rooms"`.

- [ ] **Step 5: Write `src/lib/bible/rooms.ts`**

```ts
// ---------------------------------------------------------------------------
// The Bible's rooms, named once.
//
// This app is several applications behind one front door, the way EA World and
// Jarvis Audio Studio are (src/lib/ea-world/studios.ts). Build Plans is built;
// the other three are declared here with `built: false` and render a panel
// saying what they will hold. That is deliberate: the owner is filling a
// building, and he should be able to see its shape.
//
// Deliberately not inside the shell component. The page is a server component
// and validates `?studio=` before rendering anything, and a "use client"
// module's plain functions cannot be called from the server.
// ---------------------------------------------------------------------------

export type RoomId = "plans" | "scout" | "plays" | "funding";

export interface RoomDef {
  id: RoomId;
  label: string;
  /** What this room is for, shown beside the label where there is room. */
  hint: string;
  blurb: string;
  /** False renders the not-built panel instead of mounting anything. */
  built: boolean;
  /** Accent hue 0-360. The shell's ambient light shifts to it. */
  hue: number;
}

export const ROOMS: RoomDef[] = [
  {
    id: "plans",
    label: "Build Plans",
    hint: "how do I make this?",
    blurb:
      "Every idea you have had, each one holding the ordered, costed, sourced list of what you "
      + "actually do to make it exist and sell the first one. Talk to it to make it cheaper, swap a "
      + "material, or ask whether a step is even allowed where you live.",
    built: true,
    hue: 36,
  },
  {
    id: "scout",
    label: "Deal Scout",
    hint: "what is underpriced near me?",
    blurb:
      "Marketplace, OfferUp and Craigslist watched for things worth buying to resell — ranked by "
      + "profit per day of capital, after fees and shipping, with the sold prices it was priced "
      + "against shown on every row. Specced, not built.",
    built: false,
    hue: 168,
  },
  {
    id: "plays",
    label: "Money Plays",
    hint: "what could I run?",
    blurb:
      "Ways to make money filed and rated — what each one needs up front, what it pays, and how "
      + "quickly you would know it was working. Not built yet.",
    built: false,
    hue: 268,
  },
  {
    id: "funding",
    label: "Funding",
    hint: "where does the money come from?",
    blurb:
      "Grants, loans and the other places starting capital actually comes from, with what each one "
      + "demands of you before it hands anything over. Not built yet.",
    built: false,
    hue: 320,
  },
];

export const DEFAULT_ROOM: RoomId = "plans";

export function isRoom(value: unknown): value is RoomId {
  return ROOMS.some((r) => r.id === value);
}

export function roomDef(id: RoomId): RoomDef {
  return ROOMS.find((r) => r.id === id) ?? ROOMS[0];
}
```

- [ ] **Step 6: Run the test and watch it pass**

Run: `npx vitest run src/lib/bible/rooms.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 7: Commit**

```bash
git add src/lib/bible/types.ts src/lib/bible/ids.ts src/lib/bible/rooms.ts src/lib/bible/rooms.test.ts
git commit -m "Financial Bible: the shapes, and a rail that admits what is not built"
```

---

## Task 2: Totals — the numbers the sheet lives on

**Files:**
- Create: `src/lib/bible/totals.ts`
- Test: `src/lib/bible/totals.test.ts`

The one rule: **a step's `cost` includes its materials; materials are summed only when the step has no `cost`.** Double-counting a $6 length of moulding is how a plan quietly becomes untrustworthy.

- [ ] **Step 1: Write the failing test `src/lib/bible/totals.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { fmtMoney, progress, stepCost, timeline, totals, verifiedShare } from "./totals";
import type { Material, Phase, Plan, Step } from "./types";

function material(over: Partial<Material> = {}): Material {
  return {
    id: "m1",
    name: "pine moulding",
    qty: 2,
    unit: "ft",
    unitCost: { low: 3, high: 4, currency: "USD" },
    provenance: "estimate",
    supplierIds: [],
    ...over,
  };
}

function step(over: Partial<Step> = {}): Step {
  return {
    id: "s1",
    title: "Cut the moulding",
    detail: "",
    provenance: "estimate",
    materials: [],
    suppliers: [],
    done: false,
    skipped: false,
    ...over,
  };
}

function plan(phases: Phase[]): Plan {
  return {
    version: 1,
    createdAt: "2026-10-02T00:00:00.000Z",
    model: "test",
    summary: "",
    assumptions: [],
    openQuestions: [],
    phases,
    extras: [],
  };
}

const phase = (steps: Step[], over: Partial<Phase> = {}): Phase => ({
  id: "p1",
  title: "Phase",
  goal: "",
  steps,
  ...over,
});

describe("stepCost", () => {
  it("uses the step's own cost and does NOT add its materials on top", () => {
    const s = step({
      cost: { low: 20, high: 25, currency: "USD" },
      materials: [material()],
    });
    expect(stepCost(s)).toEqual({ low: 20, high: 25, currency: "USD" });
  });

  it("sums materials when the step has no cost of its own", () => {
    const s = step({ materials: [material({ qty: 2 })] });
    expect(stepCost(s)).toEqual({ low: 6, high: 8, currency: "USD" });
  });

  it("costs nothing for a skipped step, whatever it carries", () => {
    expect(stepCost(step({ skipped: true, cost: { low: 99, high: 99, currency: "USD" } }))).toBeNull();
  });

  it("is null for a step nobody has costed", () => {
    expect(stepCost(step())).toBeNull();
  });
});

describe("totals", () => {
  it("adds every costed step across every phase", () => {
    const p = plan([
      phase([step({ cost: { low: 10, high: 20, currency: "USD" } })]),
      phase([step({ id: "s2", materials: [material({ qty: 1 })] })], { id: "p2" }),
    ]);
    expect(totals(p).cost).toEqual({ low: 13, high: 24, currency: "USD" });
    expect(totals(p).mixed).toBe(false);
  });

  it("refuses to sum two currencies rather than inventing an exchange rate", () => {
    const p = plan([
      phase([
        step({ cost: { low: 10, high: 10, currency: "USD" } }),
        step({ id: "s2", cost: { low: 10, high: 10, currency: "EUR" } }),
      ]),
    ]);
    expect(totals(p).mixed).toBe(true);
    expect(totals(p).cost).toBeNull();
  });

  it("counts how much of the plan is not costed, so the sheet can say so", () => {
    const p = plan([
      phase([step({ cost: { low: 5, high: 5, currency: "USD" } }), step({ id: "s2" })]),
    ]);
    expect(totals(p).costedSteps).toBe(1);
    expect(totals(p).uncostedSteps).toBe(1);
  });

  it("is null, not zero, for a plan with nothing costed", () => {
    expect(totals(plan([phase([step()])])).cost).toBeNull();
  });
});

describe("progress", () => {
  it("counts done over total, ignoring skipped steps entirely", () => {
    const p = plan([
      phase([
        step({ done: true }),
        step({ id: "s2" }),
        step({ id: "s3", skipped: true }),
      ]),
    ]);
    expect(progress(p)).toEqual({ done: 1, total: 2 });
  });
});

describe("timeline", () => {
  it("adds phase days and the hands-on hours of unskipped steps", () => {
    const p = plan([
      phase([step({ hours: 2 }), step({ id: "s2", hours: 5, skipped: true })], { days: 3 }),
      phase([step({ id: "s3", hours: 1 })], { id: "p2", days: 4 }),
    ]);
    expect(timeline(p)).toEqual({ days: 7, hours: 3 });
  });
});

describe("verifiedShare", () => {
  it("is the share of COSTED steps whose price was actually checked", () => {
    const p = plan([
      phase([
        step({ cost: { low: 1, high: 1, currency: "USD" }, provenance: "verified" }),
        step({ id: "s2", cost: { low: 1, high: 1, currency: "USD" }, provenance: "estimate" }),
        step({ id: "s3" }), // uncosted: not part of the question
      ]),
    ]);
    expect(verifiedShare(p)).toBe(0.5);
  });

  it("is 0 when nothing is costed, and never NaN", () => {
    expect(verifiedShare(plan([phase([step()])]))).toBe(0);
  });
});

describe("fmtMoney", () => {
  it("shows a range, collapses an exact figure, and says nothing for null", () => {
    expect(fmtMoney({ low: 380, high: 520, currency: "USD" })).toBe("$380–$520");
    expect(fmtMoney({ low: 90, high: 90, currency: "USD" })).toBe("$90");
    expect(fmtMoney(null)).toBe("—");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/lib/bible/totals.test.ts`
Expected: FAIL — `Failed to resolve import "./totals"`.

- [ ] **Step 3: Write `src/lib/bible/totals.ts`**

```ts
// ---------------------------------------------------------------------------
// Everything the sheet displays about a plan, computed on the spot.
//
// Nothing here is stored. A stored total drifts the moment a step is edited,
// and a wrong total is the single error that makes the whole sheet worthless —
// so the total is a function of the steps and can never disagree with them.
//
// Two decisions worth knowing:
//
//   1. A step's `cost` INCLUDES its materials. Materials are summed only for a
//      step with no cost of its own. Any other rule double-counts.
//   2. Mixed currencies are REFUSED, not converted. Inventing an exchange rate
//      inside a cost total is a way to be confidently wrong, and the owner can
//      see two currencies on the sheet and decide what he wants done about it.
// ---------------------------------------------------------------------------

import type { Money, Plan, Step } from "./types";

export interface Totals {
  /** Null when nothing is costed, or when currencies disagree. */
  cost: Money | null;
  /** True when two currencies were seen; the sheet says so instead of a total. */
  mixed: boolean;
  costedSteps: number;
  uncostedSteps: number;
}

/** What one step costs, or null when it costs nothing countable. */
export function stepCost(step: Step): Money | null {
  if (step.skipped) return null;
  if (step.cost) return step.cost;

  let low = 0;
  let high = 0;
  let currency = "";
  let seen = false;
  for (const m of step.materials) {
    if (!m.unitCost) continue;
    if (currency && m.unitCost.currency !== currency) return null;
    currency = m.unitCost.currency;
    low += m.unitCost.low * m.qty;
    high += m.unitCost.high * m.qty;
    seen = true;
  }
  return seen ? { low, high, currency } : null;
}

function everyStep(plan: Plan): Step[] {
  return plan.phases.flatMap((p) => p.steps);
}

export function totals(plan: Plan): Totals {
  let low = 0;
  let high = 0;
  let currency = "";
  let mixed = false;
  let costedSteps = 0;
  let uncostedSteps = 0;

  for (const step of everyStep(plan)) {
    if (step.skipped) continue;
    const cost = stepCost(step);
    if (!cost) {
      uncostedSteps += 1;
      continue;
    }
    costedSteps += 1;
    if (currency && cost.currency !== currency) {
      mixed = true;
      continue;
    }
    currency = cost.currency;
    low += cost.low;
    high += cost.high;
  }

  return {
    cost: mixed || !costedSteps ? null : { low, high, currency },
    mixed,
    costedSteps,
    uncostedSteps,
  };
}

export function progress(plan: Plan): { done: number; total: number } {
  const live = everyStep(plan).filter((s) => !s.skipped);
  return { done: live.filter((s) => s.done).length, total: live.length };
}

export function timeline(plan: Plan): { days: number; hours: number } {
  const days = plan.phases.reduce((sum, p) => sum + (p.days ?? 0), 0);
  const hours = everyStep(plan)
    .filter((s) => !s.skipped)
    .reduce((sum, s) => sum + (s.hours ?? 0), 0);
  return { days, hours };
}

/** How much of what this plan claims has actually been checked. 0 when nothing is costed. */
export function verifiedShare(plan: Plan): number {
  const costed = everyStep(plan).filter((s) => !s.skipped && stepCost(s));
  if (!costed.length) return 0;
  return costed.filter((s) => s.provenance === "verified").length / costed.length;
}

const SYMBOL: Record<string, string> = { USD: "$", EUR: "€", GBP: "£", CAD: "C$", AUD: "A$" };

function one(amount: number, currency: string): string {
  const symbol = SYMBOL[currency] ?? "";
  const n = Math.round(amount).toLocaleString("en-US");
  return symbol ? `${symbol}${n}` : `${n} ${currency}`;
}

/** A range reads as a range; an exact figure should not pretend to be one. */
export function fmtMoney(money: Money | null): string {
  if (!money) return "—";
  const low = one(money.low, money.currency);
  if (Math.round(money.low) === Math.round(money.high)) return low;
  return `${low}–${one(money.high, money.currency)}`;
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npx vitest run src/lib/bible/totals.test.ts`
Expected: PASS — 13 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/bible/totals.ts src/lib/bible/totals.test.ts
git commit -m "Financial Bible: totals that cannot disagree with their steps"
```

---

## Task 3: The patch engine

**Files:**
- Create: `src/lib/bible/ops.ts`
- Test: `src/lib/bible/ops.test.ts`

This is the task that decides whether the app is trustworthy. The agent proposes operations against step ids; this applies them to a **clone**, preserves the four things that are the owner's (`done`, `skipped`, `note`, and anything with `user` provenance), and **drops** any op naming an id that does not exist rather than guessing which step was meant.

- [ ] **Step 1: Write the failing test `src/lib/bible/ops.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { applyOps, opSummary } from "./ops";
import type { Op } from "./ops";
import type { Material, Plan, Step } from "./types";

function step(over: Partial<Step> = {}): Step {
  return {
    id: "s1",
    title: "Cut the moulding",
    detail: "",
    provenance: "estimate",
    materials: [],
    suppliers: [],
    done: false,
    skipped: false,
    ...over,
  };
}

function base(): Plan {
  return {
    version: 1,
    createdAt: "2026-10-02T00:00:00.000Z",
    model: "test",
    summary: "Picture frames",
    assumptions: ["garage, no van"],
    openQuestions: [],
    phases: [
      { id: "p1", title: "Buy", goal: "", days: 2, steps: [step(), step({ id: "s2", title: "Order glass" })] },
      { id: "p2", title: "Make", goal: "", days: 3, steps: [step({ id: "s3", title: "Assemble" })] },
    ],
    extras: [],
  };
}

describe("applyOps", () => {
  it("replaces a step without touching what the owner did to it", () => {
    const before = base();
    before.phases[0].steps[0] = step({
      done: true,
      skipped: false,
      note: "already have 40ft of this",
    });
    const incoming = step({ title: "Cut the oak to length", done: false, note: undefined });
    const { plan, applied, dropped } = applyOps(before, [
      { op: "replace-step", stepId: "s1", step: incoming },
    ]);

    const after = plan.phases[0].steps[0];
    expect(after.title).toBe("Cut the oak to length");
    // Progress and the owner's own words are HIS. An agent rewriting a step
    // must not quietly un-tick it or delete the note explaining it.
    expect(after.done).toBe(true);
    expect(after.note).toBe("already have 40ft of this");
    expect(applied).toBe(1);
    expect(dropped).toEqual([]);
  });

  it("keeps a price the owner typed, and keeps his material the agent forgot", () => {
    const mine: Material = {
      id: "m-own",
      name: "oak offcuts from the yard",
      qty: 10,
      unit: "ft",
      unitCost: { low: 0, high: 0, currency: "USD" },
      provenance: "user",
      supplierIds: [],
    };
    const theirs: Material = { ...mine, id: "m-new", name: "pine", provenance: "estimate" };
    const before = base();
    before.phases[0].steps[0] = step({ materials: [mine] });

    const { plan } = applyOps(before, [
      { op: "replace-step", stepId: "s1", step: step({ materials: [theirs] }) },
    ]);

    const ids = plan.phases[0].steps[0].materials.map((m) => m.id);
    expect(ids).toContain("m-own");
    expect(ids).toContain("m-new");
  });

  it("keeps the verified supplier and its source when the step is rewritten", () => {
    const before = base();
    before.phases[0].steps[0] = step({
      cost: { low: 38, high: 44, currency: "USD" },
      provenance: "verified",
      suppliers: [
        { id: "sup-found", name: "Capitol City Lumber", what: "moulding", source: "https://example.com", foundAt: "2026-10-01T00:00:00.000Z" },
        { id: "sup-mine", name: "Dave down the road", what: "offcuts" },
      ],
    });

    const { plan } = applyOps(before, [
      { op: "replace-step", stepId: "s1", step: step({ title: "Cut the oak", suppliers: [] }) },
    ]);

    const s = plan.phases[0].steps[0];
    // Losing the source would leave a VERIFIED price with nothing behind it,
    // and losing Dave loses a shop the owner actually knows.
    expect(s.suppliers.map((x) => x.name)).toEqual(["Capitol City Lumber", "Dave down the road"]);
    expect(s.suppliers[0].source).toBe("https://example.com");
  });

  it("keeps a price the owner typed, and keeps it labelled as his", () => {
    const before = base();
    before.phases[0].steps[0] = step({
      cost: { low: 25, high: 25, currency: "USD" },
      provenance: "user",
    });
    const { plan } = applyOps(before, [
      {
        op: "replace-step",
        stepId: "s1",
        step: step({ cost: { low: 70, high: 110, currency: "USD" }, provenance: "estimate" }),
      },
    ]);
    const s = plan.phases[0].steps[0];
    expect(s.cost).toEqual({ low: 25, high: 25, currency: "USD" });
    expect(s.provenance).toBe("user");
  });

  it("drops an op naming a step that does not exist, and says why", () => {
    const before = base();
    const { plan, applied, dropped } = applyOps(before, [
      { op: "replace-step", stepId: "ghost", step: step({ id: "ghost" }) },
    ]);
    expect(applied).toBe(0);
    expect(dropped).toHaveLength(1);
    expect(dropped[0].why).toMatch(/ghost/);
    // Nothing moved, and the version did not move either.
    expect(plan.phases[0].steps.map((s) => s.id)).toEqual(["s1", "s2"]);
    expect(plan.version).toBe(1);
  });

  it("adds a step after the one named, or at the front when told null", () => {
    const after = applyOps(base(), [
      { op: "add-step", phaseId: "p1", afterStepId: "s1", step: step({ id: "new" }) },
    ]).plan;
    expect(after.phases[0].steps.map((s) => s.id)).toEqual(["s1", "new", "s2"]);

    const front = applyOps(base(), [
      { op: "add-step", phaseId: "p1", afterStepId: null, step: step({ id: "new" }) },
    ]).plan;
    expect(front.phases[0].steps.map((s) => s.id)).toEqual(["new", "s1", "s2"]);
  });

  it("removes a step, and removes a phase with everything in it", () => {
    expect(
      applyOps(base(), [{ op: "remove-step", stepId: "s2" }]).plan.phases[0].steps.map((s) => s.id),
    ).toEqual(["s1"]);
    expect(
      applyOps(base(), [{ op: "remove-phase", phaseId: "p2" }]).plan.phases.map((p) => p.id),
    ).toEqual(["p1"]);
  });

  it("bumps the version exactly once however many ops land", () => {
    const { plan } = applyOps(base(), [
      { op: "set-summary", summary: "Oak picture frames" },
      { op: "remove-step", stepId: "s2" },
      { op: "add-step", phaseId: "p2", afterStepId: null, step: step({ id: "s9" }) },
    ]);
    expect(plan.version).toBe(2);
    expect(plan.summary).toBe("Oak picture frames");
  });

  it("treats an empty op list as an answer, not a failure", () => {
    const { plan, applied, dropped } = applyOps(base(), []);
    expect(applied).toBe(0);
    expect(dropped).toEqual([]);
    expect(plan.version).toBe(1);
  });

  it("never mutates the plan it was given", () => {
    const before = base();
    const snapshot = JSON.stringify(before);
    applyOps(before, [{ op: "remove-step", stepId: "s1" }]);
    expect(JSON.stringify(before)).toBe(snapshot);
  });
});

describe("opSummary", () => {
  it("says in one line what an answer wants to do", () => {
    const ops: Op[] = [
      { op: "replace-step", stepId: "s1", step: step() },
      { op: "replace-step", stepId: "s2", step: step({ id: "s2" }) },
      { op: "remove-step", stepId: "s3" },
    ];
    expect(opSummary(ops)).toBe("2 steps changed · 1 removed");
    expect(opSummary([])).toBe("no changes");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/lib/bible/ops.test.ts`
Expected: FAIL — `Failed to resolve import "./ops"`.

- [ ] **Step 3: Write `src/lib/bible/ops.ts`**

```ts
// ---------------------------------------------------------------------------
// Applying the agent's edit to a plan.
//
// The chat does not rewrite the plan; it PROPOSES operations against step and
// phase ids, and this module is the only thing allowed to change a plan. That
// is what makes "make it cheaper" arrive as a diff with a lower total instead
// of a new wall of text, and what makes v1 still readable after v2 exists.
//
// Three rules the engine enforces rather than trusting the model with:
//
//   1. An op naming an unknown id is DROPPED and reported. Guessing which step
//      was meant is how an agent silently deletes the wrong work.
//   2. `done`, `skipped` and `note` are the owner's. A replace carries them
//      over, so being asked for a cheaper material never un-ticks what he has
//      already built or erases the note saying why.
//   3. Anything with `user` provenance survives. If he typed a price, or added
//      a material the model knows nothing about, a rewrite keeps it.
//
// Nothing here mutates its input: the caller keeps the old version in
// `idea.plans[]`, and a reducer that edited in place would corrupt the history
// it is supposed to preserve.
// ---------------------------------------------------------------------------

import type { Material, Phase, Plan, Step, Supplier } from "./types";

export type Op =
  | { op: "set-summary"; summary: string }
  | { op: "set-assumptions"; assumptions: string[] }
  | { op: "set-unit"; unit: Plan["unit"] }
  | { op: "replace-step"; stepId: string; step: Step }
  | { op: "add-step"; phaseId: string; afterStepId: string | null; step: Step }
  | { op: "remove-step"; stepId: string }
  | { op: "replace-phase"; phaseId: string; phase: Phase }
  | { op: "add-phase"; afterPhaseId: string | null; phase: Phase }
  | { op: "remove-phase"; phaseId: string };

export interface Dropped {
  op: Op;
  why: string;
}

export interface ApplyResult {
  plan: Plan;
  applied: number;
  dropped: Dropped[];
}

/** Materials: the agent's list, with anything the owner priced put back. */
function keepOwnMaterials(old: Material[], next: Material[]): Material[] {
  const byId = new Map(next.map((m) => [m.id, m]));
  for (const mine of old) {
    if (mine.provenance === "user") byId.set(mine.id, mine); // his copy wins outright
  }
  return [...byId.values()];
}

/**
 * Suppliers are ADDITIVE and nothing is ever dropped here.
 *
 * Both kinds of existing supplier are hard-won: one the owner typed in is a shop
 * he knows, and one the verify pass found carries the `source` that is the only
 * evidence behind a VERIFIED price. An agent rewriting a step's wording has no
 * business removing either, so the old list is kept whole and genuinely new
 * suppliers are appended. A step that accumulates a few too many shops is a
 * cosmetic problem; losing the lumber yard, or losing the source and leaving the
 * price looking checked, is a correctness one.
 */
function keepSuppliers(old: Supplier[], next: Supplier[]): Supplier[] {
  const seen = new Set(old.map((s) => `${s.name.trim().toLowerCase()}|${s.what.trim().toLowerCase()}`));
  const extra = next.filter((s) => !seen.has(`${s.name.trim().toLowerCase()}|${s.what.trim().toLowerCase()}`));
  return [...old, ...extra];
}

/**
 * The incoming step, with the parts of the old one that were never the agent's
 * to change.
 */
function preserveOwn(old: Step, incoming: Step): Step {
  // A price the owner typed outranks the agent's; so does the provenance that
  // says so. Without this line, asking for a cheaper plan silently relabels his
  // own number as an estimate and the verify pass is then free to overwrite it.
  const ownPrice = old.provenance === "user";
  return {
    ...incoming,
    id: old.id,
    done: old.done,
    skipped: old.skipped,
    note: old.note,
    cost: ownPrice ? old.cost : incoming.cost,
    provenance: ownPrice ? "user" : incoming.provenance,
    materials: keepOwnMaterials(old.materials, incoming.materials),
    suppliers: keepSuppliers(old.suppliers, incoming.suppliers),
  };
}

function findStep(plan: Plan, stepId: string): { phase: Phase; index: number } | null {
  for (const phase of plan.phases) {
    const index = phase.steps.findIndex((s) => s.id === stepId);
    if (index !== -1) return { phase, index };
  }
  return null;
}

export function applyOps(plan: Plan, ops: Op[]): ApplyResult {
  const next: Plan = structuredClone(plan);
  const dropped: Dropped[] = [];
  let applied = 0;

  for (const op of ops) {
    switch (op.op) {
      case "set-summary":
        next.summary = op.summary;
        applied += 1;
        break;

      case "set-assumptions":
        next.assumptions = op.assumptions;
        applied += 1;
        break;

      case "set-unit":
        next.unit = op.unit;
        applied += 1;
        break;

      case "replace-step": {
        const at = findStep(next, op.stepId);
        if (!at) {
          dropped.push({ op, why: `no step "${op.stepId}" in this plan` });
          break;
        }
        at.phase.steps[at.index] = preserveOwn(at.phase.steps[at.index], op.step);
        applied += 1;
        break;
      }

      case "add-step": {
        const phase = next.phases.find((p) => p.id === op.phaseId);
        if (!phase) {
          dropped.push({ op, why: `no phase "${op.phaseId}" in this plan` });
          break;
        }
        if (op.afterStepId === null) phase.steps.unshift(op.step);
        else {
          const index = phase.steps.findIndex((s) => s.id === op.afterStepId);
          if (index === -1) {
            dropped.push({ op, why: `no step "${op.afterStepId}" to add after` });
            break;
          }
          phase.steps.splice(index + 1, 0, op.step);
        }
        applied += 1;
        break;
      }

      case "remove-step": {
        const at = findStep(next, op.stepId);
        if (!at) {
          dropped.push({ op, why: `no step "${op.stepId}" to remove` });
          break;
        }
        at.phase.steps.splice(at.index, 1);
        applied += 1;
        break;
      }

      case "replace-phase": {
        const index = next.phases.findIndex((p) => p.id === op.phaseId);
        if (index === -1) {
          dropped.push({ op, why: `no phase "${op.phaseId}" in this plan` });
          break;
        }
        // Steps the owner has already ticked off keep their state, matched by
        // id, even when the whole phase around them is rewritten.
        const old = next.phases[index];
        next.phases[index] = {
          ...op.phase,
          id: old.id,
          steps: op.phase.steps.map((incoming) => {
            const previous = old.steps.find((s) => s.id === incoming.id);
            return previous ? preserveOwn(previous, incoming) : incoming;
          }),
        };
        applied += 1;
        break;
      }

      case "add-phase": {
        if (op.afterPhaseId === null) next.phases.unshift(op.phase);
        else {
          const index = next.phases.findIndex((p) => p.id === op.afterPhaseId);
          if (index === -1) {
            dropped.push({ op, why: `no phase "${op.afterPhaseId}" to add after` });
            break;
          }
          next.phases.splice(index + 1, 0, op.phase);
        }
        applied += 1;
        break;
      }

      case "remove-phase": {
        const index = next.phases.findIndex((p) => p.id === op.phaseId);
        if (index === -1) {
          dropped.push({ op, why: `no phase "${op.phaseId}" to remove` });
          break;
        }
        next.phases.splice(index, 1);
        applied += 1;
        break;
      }
    }
  }

  // Nothing landed means nothing changed: the answer was an answer, and a
  // version number that moves without the plan moving is a lie.
  if (applied > 0) {
    next.version = plan.version + 1;
    next.createdAt = new Date().toISOString();
  }

  return { plan: next, applied, dropped };
}

/** One line for the diff gate's header. */
export function opSummary(ops: Op[]): string {
  if (!ops.length) return "no changes";
  const changed = ops.filter((o) => o.op === "replace-step" || o.op === "replace-phase").length;
  const added = ops.filter((o) => o.op === "add-step" || o.op === "add-phase").length;
  const removed = ops.filter((o) => o.op === "remove-step" || o.op === "remove-phase").length;
  const other = ops.length - changed - added - removed;

  const parts: string[] = [];
  if (changed) parts.push(`${changed} step${changed === 1 ? "" : "s"} changed`);
  if (added) parts.push(`${added} added`);
  if (removed) parts.push(`${removed} removed`);
  if (other) parts.push(`${other} other edit${other === 1 ? "" : "s"}`);
  return parts.join(" · ");
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npx vitest run src/lib/bible/ops.test.ts`
Expected: PASS — 11 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/bible/ops.ts src/lib/bible/ops.test.ts
git commit -m "Financial Bible: an edit engine that cannot overwrite the owner"
```

---

## Task 4: The trust boundary

**Files:**
- Create: `src/lib/bible/clean.ts`
- Test: `src/lib/bible/clean.test.ts`

Everything a model returns is a claim. `cleanPlan` turns arbitrary JSON into a `Plan` or `null` — and it is where section 7 of the spec is **enforced in code**: a generation that volunteers LLC advice has its `extras` dropped, because the owner asked for that and a prompt alone will not hold.

- [ ] **Step 1: Write the failing test `src/lib/bible/clean.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { cleanOps, cleanPlan } from "./clean";

const ok = {
  summary: "Build and sell a first batch of picture frames",
  assumptions: ["garage workshop", "no van"],
  openQuestions: ["what size frames?"],
  phases: [
    {
      title: "Buy the stock",
      goal: "materials on hand",
      days: 3,
      steps: [
        {
          title: "Buy moulding",
          detail: "8ft lengths, primed pine.",
          cost: { low: 40, high: 60, currency: "USD" },
          hours: 1,
          materials: [{ name: "pine moulding", qty: 32, unit: "ft", unitCost: { low: 1.2, high: 1.8, currency: "USD" } }],
          suppliers: [{ name: "Local lumber yard", what: "moulding" }],
          check: "No warp when you sight down the length.",
        },
      ],
    },
  ],
};

describe("cleanPlan", () => {
  it("gives every phase, step, material and supplier a unique id", () => {
    const plan = cleanPlan(ok, "test-model", "USD")!;
    const ids = [
      ...plan.phases.map((p) => p.id),
      ...plan.phases.flatMap((p) => p.steps.map((s) => s.id)),
      ...plan.phases.flatMap((p) => p.steps.flatMap((s) => s.materials.map((m) => m.id))),
      ...plan.phases.flatMap((p) => p.steps.flatMap((s) => s.suppliers.map((x) => x.id))),
    ];
    expect(ids.every(Boolean)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("starts at version 1, records the model, and nothing is done yet", () => {
    const plan = cleanPlan(ok, "test-model", "USD")!;
    expect(plan.version).toBe(1);
    expect(plan.model).toBe("test-model");
    expect(plan.phases[0].steps[0].done).toBe(false);
    expect(plan.phases[0].steps[0].skipped).toBe(false);
  });

  // Section 7 of the spec, enforced where it cannot be argued with.
  it("throws away business-formation advice the model volunteered", () => {
    const pushy = {
      ...ok,
      extras: [{ topic: "legal-structure", body: "First, form an LLC…" }],
    };
    expect(cleanPlan(pushy, "test-model", "USD")!.extras).toEqual([]);
  });

  it("marks every cost an estimate however the model labelled it", () => {
    const boastful = structuredClone(ok) as Record<string, any>;
    boastful.phases[0].steps[0].provenance = "verified";
    boastful.phases[0].steps[0].suppliers[0].source = "https://invented.example";
    const step = cleanPlan(boastful, "test-model", "USD")!.phases[0].steps[0];
    expect(step.provenance).toBe("estimate");
    // A source is a thing the verify pass earns, not a thing a generation claims.
    expect(step.suppliers[0].source).toBeUndefined();
  });

  it("repairs a backwards range and drops a cost that is not numbers", () => {
    const wonky = structuredClone(ok) as Record<string, any>;
    wonky.phases[0].steps[0].cost = { low: 90, high: 20, currency: "USD" };
    wonky.phases[0].steps[0].materials[0].unitCost = { low: "cheap", high: 4 };
    const step = cleanPlan(wonky, "test-model", "USD")!.phases[0].steps[0];
    expect(step.cost).toEqual({ low: 20, high: 90, currency: "USD" });
    expect(step.materials[0].unitCost).toBeUndefined();
  });

  it("falls back to the home currency when the model forgot one", () => {
    const vague = structuredClone(ok) as Record<string, any>;
    delete vague.phases[0].steps[0].cost.currency;
    expect(cleanPlan(vague, "test-model", "GBP")!.phases[0].steps[0].cost!.currency).toBe("GBP");
  });

  it("keeps a legal flag as a question with somebody to ask, or not at all", () => {
    const flagged = structuredClone(ok) as Record<string, any>;
    flagged.phases[0].steps[0].legal = { question: "Do I need a resale certificate?", whoToAsk: "state revenue office" };
    expect(cleanPlan(flagged, "test-model", "USD")!.phases[0].steps[0].legal).toEqual({
      question: "Do I need a resale certificate?",
      whoToAsk: "state revenue office",
    });

    const half = structuredClone(ok) as Record<string, any>;
    half.phases[0].steps[0].legal = { question: "Is this allowed?" };
    expect(cleanPlan(half, "test-model", "USD")!.phases[0].steps[0].legal).toBeUndefined();
  });

  it("returns null rather than a half-rendered sheet", () => {
    expect(cleanPlan(null, "m", "USD")).toBeNull();
    expect(cleanPlan({}, "m", "USD")).toBeNull();
    expect(cleanPlan({ phases: [{ title: "Empty", steps: [] }] }, "m", "USD")).toBeNull();
    expect(cleanPlan({ phases: [{ steps: [{ detail: "no title" }] }] }, "m", "USD")).toBeNull();
  });
});

describe("cleanOps", () => {
  it("keeps the ops it understands and drops the ones it does not", () => {
    const ops = cleanOps(
      [
        { op: "set-summary", summary: "Oak frames" },
        { op: "delete-everything", stepId: "s1" },
        { op: "remove-step", stepId: "s2" },
        { op: "remove-step" },
      ],
      "USD",
    );
    expect(ops).toEqual([
      { op: "set-summary", summary: "Oak frames" },
      { op: "remove-step", stepId: "s2" },
    ]);
  });

  it("cleans the step inside a replace, keeping the id it names", () => {
    const [op] = cleanOps(
      [{ op: "replace-step", stepId: "s1", step: { title: "Cut oak", detail: "45° mitres." } }],
      "USD",
    );
    expect(op.op).toBe("replace-step");
    if (op.op === "replace-step") {
      expect(op.stepId).toBe("s1");
      expect(op.step.title).toBe("Cut oak");
      expect(op.step.provenance).toBe("estimate");
      expect(op.step.materials).toEqual([]);
    }
  });

  it("is an empty list for nonsense, never a throw", () => {
    expect(cleanOps(null, "USD")).toEqual([]);
    expect(cleanOps("ops", "USD")).toEqual([]);
    expect(cleanOps([1, 2, 3], "USD")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/lib/bible/clean.test.ts`
Expected: FAIL — `Failed to resolve import "./clean"`.

- [ ] **Step 3: Write `src/lib/bible/clean.ts`**

```ts
// ---------------------------------------------------------------------------
// The trust boundary: a model's JSON becomes a Plan here, or becomes null.
//
// Everything that arrives from a generation is a CLAIM. A field can be missing,
// a number can be a sentence, a range can run backwards, an id can be absent or
// duplicated, and the whole body can be truncated mid-array. None of that may
// reach the sheet, because a half-rendered plan is worse than a visible failure:
// the owner would act on it.
//
// Two rules here are policy, not parsing, and they are here rather than in the
// prompt because a prompt is a request and this is a guarantee:
//
//   * `extras` is always emptied. A build plan covers building the thing. The
//     nine business-formation topics exist behind their own buttons and their
//     own route, and a model that volunteers them is overruled.
//   * every cost comes out `estimate`, and a `source` a generation invented is
//     stripped. VERIFIED is a thing the verify pass earns by reading a page.
// ---------------------------------------------------------------------------

import { uid } from "./ids";
import type { Material, Money, Phase, Plan, Step, Supplier } from "./types";
import type { Op } from "./ops";

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function strings(value: unknown, max: number, cap: number): string[] {
  return list(value)
    .map((v) => text(v, max))
    .filter(Boolean)
    .slice(0, cap);
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** A range, repaired: numbers only, low first, a currency it can be shown in. */
function money(value: unknown, fallbackCurrency: string): Money | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const low = num(raw.low);
  const high = num(raw.high);
  if (low === null || high === null) return undefined;
  if (low < 0 || high < 0) return undefined;
  return {
    low: Math.min(low, high),
    high: Math.max(low, high),
    currency: text(raw.currency, 3).toUpperCase() || fallbackCurrency,
  };
}

function material(value: unknown, currency: string): Material | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const name = text(raw.name, 120);
  if (!name) return null;
  return {
    id: uid("m"),
    name,
    qty: num(raw.qty) ?? 1,
    unit: text(raw.unit, 16) || "each",
    unitCost: money(raw.unitCost, currency),
    provenance: "estimate",
    supplierIds: [],
  };
}

function supplier(value: unknown, currency: string): Supplier | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const name = text(raw.name, 120);
  if (!name) return null;
  return {
    id: uid("sup"),
    name,
    what: text(raw.what, 120),
    where: text(raw.where, 200) || undefined,
    phone: text(raw.phone, 40) || undefined,
    url: text(raw.url, 400) || undefined,
    price: money(raw.price, currency),
    // `source` and `foundAt` are deliberately NOT read: only the verify pass
    // may set them, and a generation claiming one would make an estimate look
    // checked.
  };
}

export function cleanStep(value: unknown, currency: string): Step | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const title = text(raw.title, 140);
  if (!title) return null;

  const legalRaw = (raw.legal ?? null) as Record<string, unknown> | null;
  const question = legalRaw ? text(legalRaw.question, 300) : "";
  const whoToAsk = legalRaw ? text(legalRaw.whoToAsk, 160) : "";

  return {
    id: uid("s"),
    title,
    detail: text(raw.detail, 1200),
    cost: money(raw.cost, currency),
    costNote: text(raw.costNote, 120) || undefined,
    provenance: "estimate",
    hours: num(raw.hours) ?? undefined,
    materials: list(raw.materials)
      .slice(0, 40)
      .map((m) => material(m, currency))
      .filter((m): m is Material => m !== null),
    suppliers: list(raw.suppliers)
      .slice(0, 12)
      .map((s) => supplier(s, currency))
      .filter((s): s is Supplier => s !== null),
    check: text(raw.check, 300) || undefined,
    // Half a flag is no flag: a question nobody can be asked is not actionable,
    // and this app's whole position on legality is "go and ask this person".
    legal: question && whoToAsk ? { question, whoToAsk } : undefined,
    done: false,
    skipped: false,
  };
}

export function cleanPhase(value: unknown, currency: string): Phase | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const steps = list(raw.steps)
    .slice(0, 60)
    .map((s) => cleanStep(s, currency))
    .filter((s): s is Step => s !== null);
  if (!steps.length) return null; // a phase with no steps is a heading
  return {
    id: uid("p"),
    title: text(raw.title, 120) || "Phase",
    goal: text(raw.goal, 300),
    days: num(raw.days) ?? undefined,
    steps,
  };
}

export function cleanPlan(value: unknown, model: string, currency: string): Plan | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const phases = list(raw.phases)
    .slice(0, 12)
    .map((p) => cleanPhase(p, currency))
    .filter((p): p is Phase => p !== null);
  if (!phases.length) return null;

  const unitRaw = (raw.unit ?? null) as Record<string, unknown> | null;
  const unitCost = unitRaw ? money(unitRaw.cost, currency) : undefined;

  return {
    version: 1,
    createdAt: new Date().toISOString(),
    model,
    summary: text(raw.summary, 1200),
    assumptions: strings(raw.assumptions, 240, 12),
    openQuestions: strings(raw.openQuestions, 240, 10),
    phases,
    unit: unitCost
      ? {
          cost: unitCost,
          sellsFor: unitRaw ? money(unitRaw.sellsFor, currency) : undefined,
          note: unitRaw ? text(unitRaw.note, 300) || undefined : undefined,
        }
      : undefined,
    // Always empty. See the header.
    extras: [],
  };
}

/** The ops an answer proposed, with everything unrecognised dropped. */
export function cleanOps(value: unknown, currency: string): Op[] {
  const out: Op[] = [];
  for (const entry of list(value).slice(0, 60)) {
    if (!entry || typeof entry !== "object") continue;
    const raw = entry as Record<string, unknown>;
    const kind = text(raw.op, 32);
    const stepId = text(raw.stepId, 64);
    const phaseId = text(raw.phaseId, 64);

    if (kind === "set-summary") {
      const summary = text(raw.summary, 1200);
      if (summary) out.push({ op: "set-summary", summary });
    } else if (kind === "set-assumptions") {
      out.push({ op: "set-assumptions", assumptions: strings(raw.assumptions, 240, 12) });
    } else if (kind === "set-unit") {
      const unitRaw = (raw.unit ?? null) as Record<string, unknown> | null;
      const cost = unitRaw ? money(unitRaw.cost, currency) : undefined;
      if (cost) {
        out.push({
          op: "set-unit",
          unit: {
            cost,
            sellsFor: unitRaw ? money(unitRaw.sellsFor, currency) : undefined,
            note: unitRaw ? text(unitRaw.note, 300) || undefined : undefined,
          },
        });
      }
    } else if (kind === "replace-step") {
      const step = cleanStep(raw.step, currency);
      if (stepId && step) out.push({ op: "replace-step", stepId, step });
    } else if (kind === "add-step") {
      const step = cleanStep(raw.step, currency);
      const after = text(raw.afterStepId, 64);
      if (phaseId && step) {
        out.push({ op: "add-step", phaseId, afterStepId: after || null, step });
      }
    } else if (kind === "remove-step") {
      if (stepId) out.push({ op: "remove-step", stepId });
    } else if (kind === "replace-phase") {
      const phase = cleanPhase(raw.phase, currency);
      if (phaseId && phase) out.push({ op: "replace-phase", phaseId, phase });
    } else if (kind === "add-phase") {
      const phase = cleanPhase(raw.phase, currency);
      const after = text(raw.afterPhaseId, 64);
      if (phase) out.push({ op: "add-phase", afterPhaseId: after || null, phase });
    } else if (kind === "remove-phase") {
      if (phaseId) out.push({ op: "remove-phase", phaseId });
    }
  }
  return out;
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npx vitest run src/lib/bible/clean.test.ts`
Expected: PASS — 11 tests. (`cleanOps` keeps `step.id` generated by `cleanStep`; the `replace-step` op carries the target in `stepId`, and `applyOps`'s `preserveOwn` forces the old id back on, so a fresh id on the incoming step is correct and harmless.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/bible/clean.ts src/lib/bible/clean.test.ts
git commit -m "Financial Bible: the boundary where a model's claim becomes data"
```

---

## Task 5: Merging what the verify pass found

**Files:**
- Create: `src/lib/bible/verify.ts`
- Test: `src/lib/bible/verify.test.ts`

- [ ] **Step 1: Write the failing test `src/lib/bible/verify.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { mergeVerified, type Finding } from "./verify";
import type { Plan, Step, Supplier } from "./types";

const NOW = "2026-10-02T12:00:00.000Z";

function step(over: Partial<Step> = {}): Step {
  return {
    id: "s1",
    title: "Buy moulding",
    detail: "",
    provenance: "estimate",
    materials: [],
    suppliers: [],
    done: false,
    skipped: false,
    ...over,
  };
}

function plan(steps: Step[]): Plan {
  return {
    version: 2,
    createdAt: NOW,
    model: "test",
    summary: "",
    assumptions: [],
    openQuestions: [],
    phases: [{ id: "p1", title: "Buy", goal: "", steps }],
    extras: [],
  };
}

const found: Supplier = {
  id: "sup-found",
  name: "Capitol City Lumber",
  what: "primed pine moulding, 8ft",
  where: "4216 Beryl Rd, Raleigh NC",
  price: { low: 38, high: 44, currency: "USD" },
  source: "https://example.com/listing",
};

const finding = (over: Partial<Finding> = {}): Finding => ({ stepId: "s1", supplier: found, ...over });

describe("mergeVerified", () => {
  it("fills in the supplier, flips the step to verified and stamps the date", () => {
    const after = mergeVerified(plan([step()]), [finding()], NOW);
    const s = after.phases[0].steps[0];
    expect(s.suppliers[0].name).toBe("Capitol City Lumber");
    expect(s.suppliers[0].foundAt).toBe(NOW);
    expect(s.cost).toEqual({ low: 38, high: 44, currency: "USD" });
    expect(s.provenance).toBe("verified");
  });

  it("never overwrites a price the owner typed", () => {
    const mine = step({ cost: { low: 25, high: 25, currency: "USD" }, provenance: "user" });
    const after = mergeVerified(plan([mine]), [finding()], NOW);
    const s = after.phases[0].steps[0];
    expect(s.cost).toEqual({ low: 25, high: 25, currency: "USD" });
    expect(s.provenance).toBe("user");
    // The finding is still worth keeping — it just does not get to win.
    expect(s.suppliers.map((x) => x.name)).toContain("Capitol City Lumber");
  });

  it("keeps a supplier the owner added himself", () => {
    const mine: Supplier = { id: "sup-mine", name: "Dave down the road", what: "offcuts" };
    const after = mergeVerified(plan([step({ suppliers: [mine] })]), [finding()], NOW);
    expect(after.phases[0].steps[0].suppliers.map((s) => s.name)).toEqual([
      "Dave down the road",
      "Capitol City Lumber",
    ]);
  });

  it("does not add the same supplier twice when a scan is run again", () => {
    const once = mergeVerified(plan([step()]), [finding()], NOW);
    const twice = mergeVerified(once, [finding()], NOW);
    expect(twice.phases[0].steps[0].suppliers).toHaveLength(1);
  });

  it("leaves a step nothing was found for as an estimate", () => {
    const after = mergeVerified(plan([step(), step({ id: "s2" })]), [finding()], NOW);
    expect(after.phases[0].steps[1].provenance).toBe("estimate");
    expect(after.phases[0].steps[1].suppliers).toEqual([]);
  });

  it("ignores a finding for a step that is not in this plan", () => {
    const after = mergeVerified(plan([step()]), [finding({ stepId: "ghost" })], NOW);
    expect(after.phases[0].steps[0].suppliers).toEqual([]);
  });

  it("prices a named material rather than the whole step when told which", () => {
    const withMaterial = step({
      materials: [
        {
          id: "m1",
          name: "pine moulding",
          qty: 32,
          unit: "ft",
          unitCost: { low: 1, high: 2, currency: "USD" },
          provenance: "estimate",
          supplierIds: [],
        },
      ],
    });
    const after = mergeVerified(
      plan([withMaterial]),
      [finding({ materialId: "m1", supplier: { ...found, price: { low: 1.4, high: 1.4, currency: "USD" } } })],
      NOW,
    );
    const m = after.phases[0].steps[0].materials[0];
    expect(m.unitCost).toEqual({ low: 1.4, high: 1.4, currency: "USD" });
    expect(m.provenance).toBe("verified");
    expect(m.supplierIds).toContain("sup-found");
    // The step itself was never costed directly, so it stays uncosted.
    expect(after.phases[0].steps[0].cost).toBeUndefined();
  });

  it("never mutates the plan it was given", () => {
    const before = plan([step()]);
    const snapshot = JSON.stringify(before);
    mergeVerified(before, [finding()], NOW);
    expect(JSON.stringify(before)).toBe(snapshot);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/lib/bible/verify.test.ts`
Expected: FAIL — `Failed to resolve import "./verify"`.

- [ ] **Step 3: Write `src/lib/bible/verify.ts`**

```ts
// ---------------------------------------------------------------------------
// Folding real suppliers into a plan.
//
// The verify pass reads the web for what the materials actually cost and who
// actually sells them nearby. Merging that in is where an app of this kind
// usually destroys something: it overwrites the price the owner negotiated, or
// drops the supplier he already has a relationship with, and he stops trusting
// the sheet.
//
// So the rules are narrow. A finding may FILL something empty and may replace
// an ESTIMATE. It may never touch a `user` value and may never remove a
// supplier. What was not found stays an estimate and keeps saying so, because
// the honest outcome of a search is often "I could not price this".
// ---------------------------------------------------------------------------

import type { Plan, Supplier } from "./types";

export interface Finding {
  /** The step this is about. A finding for an unknown step is ignored. */
  stepId: string;
  /** Set when the price is for ONE material rather than the whole step. */
  materialId?: string;
  supplier: Supplier;
}

/** Two suppliers are the same when they are the same shop for the same thing. */
function same(a: Supplier, b: Supplier): boolean {
  return (
    a.name.trim().toLowerCase() === b.name.trim().toLowerCase()
    && a.what.trim().toLowerCase() === b.what.trim().toLowerCase()
  );
}

export function mergeVerified(plan: Plan, findings: Finding[], now = new Date().toISOString()): Plan {
  const next: Plan = structuredClone(plan);

  for (const finding of findings) {
    const step = next.phases.flatMap((p) => p.steps).find((s) => s.id === finding.stepId);
    if (!step) continue;

    const supplier: Supplier = { ...finding.supplier, foundAt: now };
    const existing = step.suppliers.find((s) => same(s, supplier));
    if (existing) {
      // A re-scan refreshes a price it already knows about rather than
      // appending a duplicate — but a supplier the owner typed in has no
      // `source`, and leaving that alone is the whole point.
      if (existing.source) {
        existing.price = supplier.price ?? existing.price;
        existing.where = supplier.where ?? existing.where;
        existing.url = supplier.url ?? existing.url;
        existing.phone = supplier.phone ?? existing.phone;
        existing.source = supplier.source ?? existing.source;
        existing.foundAt = now;
      }
    } else {
      step.suppliers.push(supplier);
    }

    const price = supplier.price;
    if (!price) continue;

    if (finding.materialId) {
      const material = step.materials.find((m) => m.id === finding.materialId);
      if (!material || material.provenance === "user") continue;
      material.unitCost = price;
      material.provenance = "verified";
      if (!material.supplierIds.includes(supplier.id)) material.supplierIds.push(supplier.id);
      continue;
    }

    if (step.provenance === "user") continue;
    step.cost = price;
    step.provenance = "verified";
  }

  return next;
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npx vitest run src/lib/bible/verify.test.ts`
Expected: PASS — 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/bible/verify.ts src/lib/bible/verify.test.ts
git commit -m "Financial Bible: a verify pass that may fill but never overwrite"
```

---

## Task 6: The store

**Files:**
- Create: `src/lib/bible/store.ts`
- Test: `src/lib/bible/store.test.ts`

Pure reducers get tested; the two functions that touch `localStorage` have no logic. `mergeSeeded` is a local 12-line copy of EA World's `mergeById` rather than an import across two apps — a cross-app import for twelve lines would couple two unrelated vaults, and the comment says so.

- [ ] **Step 1: Write the failing test `src/lib/bible/store.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { SEED_IDEAS } from "./seed";
import {
  currentPlan,
  deleteIdea,
  mergeSeeded,
  pushPlan,
  resolve,
  setHomeBase,
  upsertIdea,
} from "./store";
import { emptyBrief, emptyStore, type Idea, type Plan } from "./types";

const seeded = SEED_IDEAS[0];

function idea(over: Partial<Idea> = {}): Idea {
  return {
    id: "own-1",
    title: "Resin coasters",
    oneLiner: "",
    brief: emptyBrief(),
    status: "idea",
    tags: [],
    pinned: false,
    plans: [],
    chat: [],
    createdAt: "2026-10-02T00:00:00.000Z",
    updatedAt: "2026-10-02T00:00:00.000Z",
    ...over,
  };
}

describe("mergeSeeded", () => {
  it("shows the seed until it is edited, then shows the edit", () => {
    expect(mergeSeeded([seeded], [], []).map((i) => i.title)).toEqual([seeded.title]);
    const edited = { ...seeded, title: "Oak picture frames" };
    expect(mergeSeeded([seeded], [edited], []).map((i) => i.title)).toEqual(["Oak picture frames"]);
  });

  it("keeps a deleted seed deleted, even one that had been edited first", () => {
    const edited = { ...seeded, title: "Oak picture frames" };
    expect(mergeSeeded([seeded], [edited], [seeded.id])).toEqual([]);
  });

  it("appends the owner's own ideas after the seeds", () => {
    expect(mergeSeeded([seeded], [idea()], []).map((i) => i.id)).toEqual([seeded.id, "own-1"]);
  });
});

describe("the store's reducers", () => {
  it("adds an idea, then updates it in place rather than twice", () => {
    const added = upsertIdea(emptyStore(), idea());
    expect(added.ideas).toHaveLength(1);
    const renamed = upsertIdea(added, { ...idea(), title: "Resin trays" });
    expect(renamed.ideas).toHaveLength(1);
    expect(renamed.ideas[0].title).toBe("Resin trays");
  });

  it("stamps updatedAt on every write so the table can sort by it", () => {
    const after = upsertIdea(emptyStore(), idea({ updatedAt: "2020-01-01T00:00:00.000Z" }));
    expect(after.ideas[0].updatedAt).not.toBe("2020-01-01T00:00:00.000Z");
  });

  it("deleting a SEED remembers it, deleting an owned idea just removes it", () => {
    const seedGone = deleteIdea(emptyStore(), seeded.id, true);
    expect(seedGone.hiddenSeeds).toEqual([seeded.id]);

    const mineGone = deleteIdea(upsertIdea(emptyStore(), idea()), "own-1", false);
    expect(mineGone.ideas).toEqual([]);
    expect(mineGone.hiddenSeeds).toEqual([]);
  });

  it("holds the home base for every room to read", () => {
    const after = setHomeBase(emptyStore(), {
      city: "Raleigh",
      region: "NC",
      country: "US",
      currency: "USD",
    });
    expect(after.homeBase?.city).toBe("Raleigh");
  });
});

describe("plan history", () => {
  const v1: Plan = {
    version: 1,
    createdAt: "2026-10-02T00:00:00.000Z",
    model: "test",
    summary: "v1",
    assumptions: [],
    openQuestions: [],
    phases: [],
    extras: [],
  };

  it("keeps every version and treats the last as current", () => {
    const withV1 = pushPlan(idea(), v1);
    const withV2 = pushPlan(withV1, { ...v1, version: 2, summary: "v2" });
    expect(withV2.plans.map((p) => p.version)).toEqual([1, 2]);
    expect(currentPlan(withV2)?.summary).toBe("v2");
  });

  it("has no current plan before one is generated", () => {
    expect(currentPlan(idea())).toBeNull();
  });
});

describe("resolve", () => {
  it("hands the UI seeds and edits already reconciled, and says what is the owner's", () => {
    const store = upsertIdea(emptyStore(), idea());
    const view = resolve(store);
    expect(view.ideas.map((i) => i.id)).toEqual([seeded.id, "own-1"]);
    expect(view.isOwn("own-1")).toBe(true);
    expect(view.isOwn(seeded.id)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/lib/bible/store.test.ts`
Expected: FAIL — cannot resolve `./seed` or `./store`.

- [ ] **Step 3: Write `src/lib/bible/seed.ts`**

The worked example. It must be good: it is both the empty state and the standard the generator is aiming at. Keep it to four phases and the steps below — enough to show every field the sheet can draw (a cost range, a material with a unit cost, a supplier, a check, a legal flag, hours, days, unit economics).

```ts
// ---------------------------------------------------------------------------
// One worked plan, shipped in the code.
//
// It is the empty state — a vault with nothing in it teaches nothing — and it
// is the bar the generator is being held to: every field the sheet can draw is
// filled in here, including the two that are easy to skip and most of the value,
// `check` (how you know the step came out right) and `legal` (a question with
// somebody to ask, never an answer).
//
// The owner's own example, picture frames, deliberately. Costs are ESTIMATE,
// because nothing in a seed has been verified against anything.
// ---------------------------------------------------------------------------

import type { Idea, Plan } from "./types";

const USD = (low: number, high: number) => ({ low, high, currency: "USD" });

const PICTURE_FRAMES: Plan = {
  version: 1,
  createdAt: "2026-10-02T00:00:00.000Z",
  model: "seed",
  summary:
    "Make ten 8x10 and 11x14 picture frames from primed pine moulding and sell the first batch at a "
    + "local market, to find out whether the price people pay is worth the hour each frame takes.",
  assumptions: [
    "A garage or a shed, mains power, and somewhere the dust does not matter.",
    "No van: everything either fits in a car or gets delivered.",
    "Selling locally for cash first, so no shipping and no platform fees yet.",
  ],
  openQuestions: [
    "Do you want glass, or acrylic? Acrylic costs more per sheet but nothing breaks on the drive.",
    "Standard sizes only, or custom to order? Custom doubles the time per frame.",
  ],
  unit: {
    cost: USD(11, 17),
    sellsFor: USD(35, 55),
    note: "Materials only. At an hour a frame, that is the whole question: is that hour worth $25?",
  },
  phases: [
    {
      id: "seed-p1",
      title: "Decide what you are making",
      goal: "Two sizes chosen, and one frame drawn full size on paper.",
      days: 1,
      steps: [
        {
          id: "seed-s1",
          title: "Pick two frame sizes and one moulding profile",
          detail:
            "8x10 and 11x14 are the sizes people own prints in, so they sell without a conversation. "
            + "One profile across both sizes means one set of saw settings and one stock order.",
          hours: 1,
          provenance: "estimate",
          materials: [],
          suppliers: [],
          check: "You can say what you are building in one sentence without using the word 'various'.",
          done: false,
          skipped: false,
        },
        {
          id: "seed-s2",
          title: "Draw one frame full size and work out the cut list",
          detail:
            "Outside length per side is the glass dimension plus twice the rabbet depth. Getting this "
            + "wrong on paper costs a sheet of paper; getting it wrong on the saw costs the moulding.",
          hours: 1,
          provenance: "estimate",
          materials: [],
          suppliers: [],
          check: "Your four pieces, laid out, come to the glass size plus the rabbet on both sides.",
          done: false,
          skipped: false,
        },
      ],
    },
    {
      id: "seed-p2",
      title: "Buy the stock",
      goal: "Enough material on hand for ten frames, with a little to waste.",
      days: 3,
      steps: [
        {
          id: "seed-s3",
          title: "Buy primed pine moulding",
          detail:
            "Ten frames in those two sizes is about 50 linear feet of finished length. Buy 65 to "
            + "cover mitre waste and the two lengths that turn out to be bowed.",
          cost: USD(70, 110),
          costNote: "65 linear feet, 8ft lengths",
          provenance: "estimate",
          hours: 1,
          materials: [
            {
              id: "seed-m1",
              name: "primed pine moulding, 1.5in face",
              qty: 65,
              unit: "ft",
              unitCost: USD(1.1, 1.7),
              provenance: "estimate",
              supplierIds: ["seed-sup1"],
            },
          ],
          suppliers: [
            {
              id: "seed-sup1",
              name: "A local lumber yard, not a big-box store",
              what: "moulding by the foot, straighter stock, cut to length if you ask",
            },
          ],
          check: "Sight down each length before it goes in the car. A bowed piece never comes good.",
          done: false,
          skipped: false,
        },
        {
          id: "seed-s4",
          title: "Buy glazing, backing and hardware",
          detail:
            "Acrylic sheet cut to size, 3mm MDF or foam board for backing, plus points, bumpers and "
            + "hanging hardware. Order glazing cut to size: the offcut waste on a full sheet is worse "
            + "than the cutting fee.",
          cost: USD(55, 95),
          provenance: "estimate",
          hours: 1,
          materials: [
            {
              id: "seed-m2",
              name: "acrylic glazing, cut to size",
              qty: 10,
              unit: "each",
              unitCost: USD(3.5, 6),
              provenance: "estimate",
              supplierIds: [],
            },
            {
              id: "seed-m3",
              name: "backing board, 3mm",
              qty: 10,
              unit: "each",
              unitCost: USD(1, 2),
              provenance: "estimate",
              supplierIds: [],
            },
          ],
          suppliers: [],
          check: "Every piece of glazing drops into the rabbet without being forced.",
          done: false,
          skipped: false,
        },
        {
          id: "seed-s5",
          title: "Settle the mitre saw question: rent, borrow or buy",
          detail:
            "A mitre saw with a sharp fine-tooth blade is the one tool that decides whether the "
            + "corners close. Renting for a weekend costs a fraction of buying, and ten frames is a "
            + "weekend — buy one when a second batch exists, not before.",
          cost: USD(45, 220),
          costNote: "weekend rental at the low end, a basic saw at the high end",
          provenance: "estimate",
          hours: 1,
          materials: [],
          suppliers: [],
          check: "A test mitre in scrap closes with no light showing at the join.",
          done: false,
          skipped: false,
        },
      ],
    },
    {
      id: "seed-p3",
      title: "Make the first frame, then nine more",
      goal: "One frame you would pay for, then a batch made the same way.",
      days: 3,
      steps: [
        {
          id: "seed-s6",
          title: "Cut and assemble ONE frame before cutting anything else",
          detail:
            "Cut four mitres, glue and clamp, let it set, then fit glazing and backing. The first "
            + "frame is where you find out the rabbet is shallower than you measured.",
          provenance: "estimate",
          hours: 2,
          materials: [],
          suppliers: [],
          check: "All four corners closed, the frame sits flat on a table, the glazing does not rattle.",
          done: false,
          skipped: false,
        },
        {
          id: "seed-s7",
          title: "Batch the rest: all cuts, then all glue-ups, then all fitting",
          detail:
            "Doing one operation across ten frames is most of the hour-per-frame saving, because the "
            + "saw gets set once and your hands stop relearning the motion.",
          provenance: "estimate",
          hours: 8,
          materials: [],
          suppliers: [],
          check: "Ten frames, and the tenth is as square as the first.",
          done: false,
          skipped: false,
        },
        {
          id: "seed-s8",
          title: "Finish them, and photograph them in daylight",
          detail:
            "Fill the corner pins, sand the face, two thin coats. Then photograph each one against a "
            + "plain wall in daylight — a bad photo is what stops a good frame selling.",
          cost: USD(20, 35),
          provenance: "estimate",
          hours: 4,
          materials: [],
          suppliers: [],
          check: "The corner joint is invisible at arm's length.",
          done: false,
          skipped: false,
        },
      ],
    },
    {
      id: "seed-p4",
      title: "Sell the first batch",
      goal: "Money taken, and a real price you know people will pay.",
      days: 14,
      steps: [
        {
          id: "seed-s9",
          title: "Price them against what is actually on sale locally",
          detail:
            "Look at what a comparable handmade frame sells for near you, not at what a factory frame "
            + "costs. Your floor is materials plus something for the hour; the market decides the rest.",
          provenance: "estimate",
          hours: 2,
          materials: [],
          suppliers: [],
          check: "You can name the price and the three frames you compared it to.",
          done: false,
          skipped: false,
        },
        {
          id: "seed-s10",
          title: "Book a market stall or a craft fair table",
          detail:
            "A table for a day costs less than a month of ads and tells you more. Take all ten, take "
            + "cash and a card reader, and write down every question people ask.",
          cost: USD(25, 80),
          costNote: "one day's table",
          provenance: "estimate",
          hours: 8,
          materials: [],
          suppliers: [],
          check: "You sold at least one at the price you set, without being talked down.",
          legal: {
            question:
              "Does selling here need a temporary vendor permit or a sales-tax number, and does the "
              + "market require either before they will take a booking?",
            whoToAsk: "the market organiser first, then your state or local revenue office",
          },
          done: false,
          skipped: false,
        },
      ],
    },
  ],
  extras: [],
};

export const SEED_IDEAS: Idea[] = [
  {
    id: "seed-picture-frames",
    title: "Picture frames",
    oneLiner: "Ten frames from pine moulding, sold at a local market to find the real price.",
    brief: {
      what: "Handmade wooden picture frames in two standard sizes, sold locally.",
      scale: "a-few",
      skill: "handy",
      toolsOwned: "drill, clamps, a garage — no mitre saw yet",
    },
    status: "idea",
    tags: ["woodwork", "weekend"],
    pinned: false,
    plans: [PICTURE_FRAMES],
    chat: [],
    createdAt: "2026-10-02T00:00:00.000Z",
    updatedAt: "2026-10-02T00:00:00.000Z",
  },
];
```

- [ ] **Step 4: Write `src/lib/bible/store.ts`**

```ts
// ---------------------------------------------------------------------------
// The store.
//
// localStorage is the read path and Supabase is a second home for the same
// bytes (src/lib/sync/appState.ts), exactly as every other app here works: the
// Bible opens instantly, keeps working with no keys configured, and the same
// ideas show up on the phone.
//
// Seeds and the owner's own ideas live together under one rule: SAME ID WINS.
// Edit the seeded plan and the edit is stored under its id, and from then on
// the stored copy IS the idea. Delete it and the id is remembered in
// `hiddenSeeds`, because a deleted seed that comes back on reload is the most
// annoying bug a vault can have.
//
// Everything with logic in it is a pure reducer taking a store and returning a
// new one, so it is testable in vitest's node environment. The two functions
// that touch localStorage have no logic at all.
// ---------------------------------------------------------------------------

import { loadLocal, saveSynced } from "@/lib/sync/appState";
import { SEED_IDEAS } from "./seed";
import { emptyStore, type BibleStore, type HomeBase, type Idea, type Plan } from "./types";

export const BIBLE_KEY = "bible:v1";

/** What is actually on this device, before seeds are folded in. */
export function loadRaw(): BibleStore {
  const raw = loadLocal<Partial<BibleStore>>(BIBLE_KEY, {});
  return {
    homeBase: raw.homeBase ?? null,
    ideas: Array.isArray(raw.ideas) ? raw.ideas : [],
    hiddenSeeds: Array.isArray(raw.hiddenSeeds) ? raw.hiddenSeeds : [],
    lastRoom: typeof raw.lastRoom === "string" ? raw.lastRoom : null,
  };
}

export function saveStore(store: BibleStore): void {
  saveSynced(BIBLE_KEY, store);
}

/**
 * Fold the seeds and the stored ideas into one list, by id.
 *
 * A local twelve lines rather than importing EA World's `mergeById`: the two
 * vaults share a pattern, not a dependency, and coupling two unrelated apps so
 * one of them can skip a loop is a trade nobody wants to debug later.
 */
export function mergeSeeded(seeds: Idea[], stored: Idea[], hidden: string[]): Idea[] {
  const hide = new Set(hidden);
  const overrides = new Map(stored.map((i) => [i.id, i]));
  const out: Idea[] = [];

  for (const seed of seeds) {
    // The override is consumed either way: leaving an edited copy in the map
    // means the loop below appends it, which would resurrect a deleted seed.
    const override = overrides.get(seed.id);
    overrides.delete(seed.id);
    if (hide.has(seed.id)) continue;
    out.push(override ?? seed);
  }
  for (const own of stored) {
    if (overrides.has(own.id)) out.push(own);
  }
  return out;
}

export interface BibleView {
  homeBase: HomeBase | null;
  ideas: Idea[];
  /** True for anything the store holds — the owner's own, or an edited seed. */
  isOwn: (id: string) => boolean;
}

export function resolve(raw: BibleStore): BibleView {
  const own = new Set(raw.ideas.map((i) => i.id));
  return {
    homeBase: raw.homeBase,
    ideas: mergeSeeded(SEED_IDEAS, raw.ideas, raw.hiddenSeeds),
    // A seed the owner has edited is stored, so it reads as his — which is
    // true, and is what lets the table show that it is no longer the shipped one.
    isOwn: (id) => own.has(id),
  };
}

export function load(): BibleView {
  return resolve(loadRaw());
}

// --- reducers --------------------------------------------------------------
// Each returns the new store rather than writing it, so a component holds one
// state and has one save path. A seeded idea edited for the first time arrives
// with no stored copy, so "update" is an upsert.

export function upsertIdea(store: BibleStore, idea: Idea): BibleStore {
  const stamped = { ...idea, updatedAt: new Date().toISOString() };
  const index = store.ideas.findIndex((i) => i.id === idea.id);
  const ideas = index === -1
    ? [...store.ideas, stamped]
    : store.ideas.map((i, at) => (at === index ? stamped : i));
  return { ...store, ideas };
}

export function deleteIdea(store: BibleStore, id: string, isSeed: boolean): BibleStore {
  return {
    ...store,
    ideas: store.ideas.filter((i) => i.id !== id),
    hiddenSeeds: isSeed && !store.hiddenSeeds.includes(id)
      ? [...store.hiddenSeeds, id]
      : store.hiddenSeeds,
  };
}

export function setHomeBase(store: BibleStore, homeBase: HomeBase): BibleStore {
  return { ...store, homeBase };
}

export function setLastRoom(store: BibleStore, lastRoom: string): BibleStore {
  return { ...store, lastRoom };
}

/** The plan on screen: the newest version. Null before one is generated. */
export function currentPlan(idea: Idea): Plan | null {
  return idea.plans.length ? idea.plans[idea.plans.length - 1] : null;
}

/** Keep the old version. "Cheaper" and "the good one" both have to survive. */
export function pushPlan(idea: Idea, plan: Plan): Idea {
  return { ...idea, plans: [...idea.plans, plan] };
}

// `uid` deliberately lives in ./ids and is imported where needed, so the ids the
// server mints while cleaning a generation and the ids the store mints for the
// owner's own ideas come out of one implementation.
```

- [ ] **Step 5: Run the test and watch it pass**

Run: `npx vitest run src/lib/bible/store.test.ts`
Expected: PASS — 10 tests.

- [ ] **Step 6: Run the whole suite so far**

Run: `npx vitest run src/lib/bible/`
Expected: PASS — 6 files, 57 tests.

- [ ] **Step 7: Commit**

```bash
git add src/lib/bible/store.ts src/lib/bible/store.test.ts src/lib/bible/seed.ts
git commit -m "Financial Bible: the store, and one worked plan to be judged against"
```

---

## Task 7: The prompts, and the refusal in them

**Files:**
- Create: `src/lib/bible/prompts.ts`
- Test: `src/lib/bible/prompts.test.ts`

The test here is deliberately about content, not behaviour: it pins the scope refusal and the JSON contract so that a later edit cannot quietly delete the thing the owner specifically asked for.

- [ ] **Step 1: Write the failing test `src/lib/bible/prompts.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { CHAT_SYSTEM, EXTRA_SYSTEM, PLAN_SCHEMA, PLAN_SYSTEM, briefBlock, VERIFY_SYSTEM } from "./prompts";
import { emptyBrief } from "./types";

describe("the plan prompt", () => {
  it("refuses the business-formation topics by name", () => {
    for (const forbidden of ["LLC", "insurance", "branding", "marketing", "hiring"]) {
      expect(PLAN_SYSTEM).toContain(forbidden);
    }
    expect(PLAN_SYSTEM).toMatch(/do not|never/i);
  });

  it("asks for a legal flag as a question with somebody to ask", () => {
    expect(PLAN_SYSTEM).toMatch(/whoToAsk/);
    expect(PLAN_SYSTEM).toMatch(/never state what is legal|not legal advice/i);
  });

  it("names every field the sheet needs, so a plan is never half a sheet", () => {
    for (const field of ["phases", "steps", "cost", "low", "high", "materials", "suppliers", "check", "hours", "assumptions", "openQuestions"]) {
      expect(PLAN_SCHEMA).toContain(field);
    }
  });
});

describe("the chat prompt", () => {
  it("demands ops against ids, and allows an answer that changes nothing", () => {
    expect(CHAT_SYSTEM).toContain("ops");
    expect(CHAT_SYSTEM).toMatch(/stepId/);
    expect(CHAT_SYSTEM).toMatch(/empty/i);
  });

  it("forbids inventing an id", () => {
    expect(CHAT_SYSTEM).toMatch(/only ids that appear|ids that exist/i);
  });
});

describe("the extra prompt", () => {
  it("answers one topic and refuses to wander into the others", () => {
    expect(EXTRA_SYSTEM).toMatch(/only the topic|exactly the topic/i);
  });
});

describe("the verify prompt", () => {
  it("insists on a source for every price", () => {
    expect(VERIFY_SYSTEM).toMatch(/source/i);
    expect(VERIFY_SYSTEM).toMatch(/do not invent|never invent/i);
  });
});

describe("briefBlock", () => {
  it("writes the brief as labelled lines, skipping what was left blank", () => {
    const block = briefBlock(
      { ...emptyBrief(), what: "Picture frames", scale: "a-few", skill: "handy" },
      { city: "Raleigh", region: "NC", country: "US", currency: "USD" },
    );
    expect(block).toContain("Picture frames");
    expect(block).toContain("Raleigh");
    expect(block).toContain("USD");
    expect(block).not.toMatch(/Tools/);
  });

  it("says plainly when there is no home base, so the plan can say so too", () => {
    const block = briefBlock({ ...emptyBrief(), what: "Frames" }, null);
    expect(block).toMatch(/no location|online/i);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/lib/bible/prompts.test.ts`
Expected: FAIL — `Failed to resolve import "./prompts"`.

- [ ] **Step 3: Write `src/lib/bible/prompts.ts`**

```ts
// ---------------------------------------------------------------------------
// What the agent is told.
//
// The scope rule lives here AND in clean.ts, on purpose. A prompt is a request
// — a model can ignore it, and models are enthusiastic about business advice
// nobody asked for — so clean.ts drops `extras` whatever arrives. This file is
// the polite version of the same rule, and prompts.test.ts pins it so a later
// edit cannot quietly remove the thing the owner specifically asked for.
// ---------------------------------------------------------------------------

import type { Brief, HomeBase, Scale, Skill } from "./types";

const SCALE_SAID: Record<Scale, string> = {
  "one-off": "building exactly one, for themselves",
  "a-few": "making a few to sell and find out whether people buy",
  "side-income": "a steady side income, repeatable most weekends",
  "product-line": "a real product line they intend to run properly",
};

const SKILL_SAID: Record<Skill, string> = {
  none: "has never done anything like this: name the tool, the setting and the motion",
  handy: "is handy and has built things before: name the technique, not the basics",
  pro: "is trained in this: skip the tutorial, give them the decisions",
};

export const PLAN_SYSTEM = `You write BUILD plans: the ordered, costed list of what somebody actually does to make a thing exist and sell the first one.

WHAT A BUILD PLAN COVERS
Materials and quantities. Tools, and whether to rent, borrow or buy. The process, in order, in steps small enough to do in one sitting. Where to buy things. What each step costs, as a RANGE. How long it takes. How to tell a step came out right. What the first unit costs you and what it sells for.

WHAT IT DOES NOT COVER
Do not mention forming an LLC or any company structure, an EIN, insurance, business banking, taxes, accounting, branding, logos, marketing, advertising, social media, hiring, or scaling. Not as a step, not as an aside, not as a "you'll also want to". Those are separate topics the person can ask for on their own; putting them here is the single fastest way to make a plan useless to somebody who just wants to build the thing. If the brief itself asks for one of them, still leave it out of the plan.

LEGALITY
When a step touches permits, licensing, resale certificates, selling food, electrical or gas work, or a venue's own rules, set "legal" on that step: a "question" naming exactly what to check, and "whoToAsk" naming who can answer it. Never state what is legal in their area and never give legal advice — you do not know their jurisdiction's current rules, and a confident wrong answer here costs them money. A step with no such issue has no "legal" field.

HOW TO COST
Every cost is a range: low and high. Price what things actually cost, and if you are unsure, widen the range rather than guessing a single number. A step's "cost" is the whole cost of that step including its materials — never put the same money in both places. Leave "cost" off a step that costs nothing.

TONE
Write the way a good tradesperson explains a job to someone capable: short sentences, the real reason a thing matters, no encouragement, no filler. Name the mistake that is actually common at each step.

Return ONLY JSON matching the schema given. No markdown, no commentary.`;

export const PLAN_SCHEMA = `{
  "summary": "what is being built and what done looks like, 2-3 sentences",
  "assumptions": ["what you assumed about their space, tools, time or market"],
  "openQuestions": ["what you need from them to make this sharper"],
  "unit": { "cost": {"low":0,"high":0,"currency":"USD"}, "sellsFor": {"low":0,"high":0,"currency":"USD"}, "note": "" },
  "phases": [{
    "title": "", "goal": "what is true when this phase is done", "days": 0,
    "steps": [{
      "title": "imperative, e.g. Cut the moulding to length",
      "detail": "1-3 sentences of how",
      "cost": {"low":0,"high":0,"currency":"USD"},
      "costNote": "rental, per day / one-off, reusable",
      "hours": 0,
      "materials": [{"name":"","qty":0,"unit":"ft","unitCost":{"low":0,"high":0,"currency":"USD"}}],
      "suppliers": [{"name":"","what":"","where":"","url":""}],
      "check": "how you know this step came out right",
      "legal": {"question":"","whoToAsk":""}
    }]
  }]
}`;

export const CHAT_SYSTEM = `You are looking after one build plan, with the person who is going to build it.

Answer their question in "reply": plainly, in a few sentences, like somebody who has done the job. If they are wrong about something, say so.

Then, if the plan should change as a result, return the change as "ops" — operations against the plan's existing ids. Use ONLY ids that appear in the plan you were given; never invent an id and never guess which step somebody meant. If the answer changes nothing — a question, a what-if, a disagreement — return an empty ops array. That is a normal, good answer, not a failure.

Available ops:
  {"op":"set-summary","summary":""}
  {"op":"set-assumptions","assumptions":[]}
  {"op":"set-unit","unit":{"cost":{...},"sellsFor":{...},"note":""}}
  {"op":"replace-step","stepId":"<existing id>","step":{<a whole step>}}
  {"op":"add-step","phaseId":"<existing id>","afterStepId":"<existing id or null>","step":{<a whole step>}}
  {"op":"remove-step","stepId":"<existing id>"}
  {"op":"replace-phase","phaseId":"<existing id>","phase":{<a whole phase>}}
  {"op":"add-phase","afterPhaseId":"<existing id or null>","phase":{<a whole phase>}}
  {"op":"remove-phase","phaseId":"<existing id>"}

A step inside an op has the same fields as in the plan. When you make something cheaper, change what the step says to do as well as its cost — a lower number with the same instructions is not a cheaper plan.

The same scope rule holds: this plan is about building the thing. Do not add steps about company formation, insurance, banking, taxes, branding, marketing, hiring or scaling, even if asked in passing — tell them in the reply that those live behind the Beyond-the-build buttons.

Return ONLY JSON: {"reply":"","ops":[],"why":"one line on what you changed and why"}`;

export const VERIFY_SYSTEM = `You price a materials list against the real world, for somebody buying it in one place.

For each item you can price, return where it can actually be bought: the shop or site's name, what they sell for this item, a street address for a physical shop or "ships nationwide" for an online one, a phone number if you have one, the URL you read, and the price as a range.

Every price must carry the "source" you read it from. Do not invent a shop, an address, a phone number or a price, and do not fill a gap with a plausible guess — leave the item out entirely. An item you could not price is a useful answer; a made-up price is worse than no price, because they will drive there.

Prefer shops near the location given. Where a local price cannot be found, an online supplier that ships there is fine, said plainly.

Return ONLY JSON: {"findings":[{"stepId":"","materialId":"","supplier":{"name":"","what":"","where":"","phone":"","url":"","price":{"low":0,"high":0,"currency":"USD"},"source":""}}]}`;

export const EXTRA_SYSTEM = `You answer ONE topic about turning a build into a business, and only the topic you are given.

Be concrete and ordered: what to do, in what order, what each thing costs, and what it is for. Where a rule depends on where they live, say what to check and who to ask rather than asserting the rule — you do not know their jurisdiction's current law and this is not legal or tax advice.

Do not drift into the other topics. If something else is genuinely a prerequisite, name it in one sentence and stop.

Return markdown: a short opening line, then numbered steps or short sections. No preamble about what you are about to do.`;

/** The brief as labelled lines. Blank answers are left out, not sent as "". */
export function briefBlock(brief: Brief, homeBase: HomeBase | null): string {
  const lines = [
    `Building: ${brief.what}`,
    `Scale: ${SCALE_SAID[brief.scale]}`,
    `The person ${SKILL_SAID[brief.skill]}`,
  ];
  if (brief.budgetCeiling) {
    lines.push(
      `Hard budget ceiling: ${brief.budgetCeiling.high} ${brief.budgetCeiling.currency}. `
      + `If it cannot be done for that, say so in openQuestions rather than writing a plan they cannot afford.`,
    );
  }
  if (brief.toolsOwned) lines.push(`Tools and space they already have: ${brief.toolsOwned}`);

  const where = brief.locationOverride ?? homeBase;
  if (where) {
    lines.push(
      `Location: ${where.city}, ${where.region}, ${where.country}. Prices and suppliers in ${where.currency}, `
      + `and prefer shops they can drive to.`,
    );
  } else {
    lines.push(
      "No location given: use online suppliers that ship, price in USD, and say in assumptions that "
      + "local suppliers were not considered because no location was set.",
    );
  }
  return lines.join("\n");
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npx vitest run src/lib/bible/prompts.test.ts`
Expected: PASS — 9 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/bible/prompts.ts src/lib/bible/prompts.test.ts
git commit -m "Financial Bible: the prompts, with the refusal pinned by a test"
```

---

## Task 8: `POST /api/bible/plan`

**Files:**
- Create: `src/app/api/bible/plan/route.ts`

Route handlers are not unit-tested in this repo; they are verified by running them (Step 3 below, and Task 15). Copy the shape of `src/app/api/ai-rankings/classify/route.ts` exactly: `aiKey()` first, `response_format: json_object`, a timeout, and a caught failure that returns a readable message rather than a 500.

- [ ] **Step 1: Write the route**

```ts
import { NextResponse } from "next/server";
import { DEFAULT_MODEL, aiFetch, aiKey } from "@/lib/ai/provider";
import { cleanPlan } from "@/lib/bible/clean";
import { PLAN_SCHEMA, PLAN_SYSTEM, briefBlock } from "@/lib/bible/prompts";
import type { Brief, HomeBase } from "@/lib/bible/types";

export const runtime = "nodejs";
// A whole build plan is a long answer; the UI shows a progress line meanwhile.
export const maxDuration = 120;

// POST /api/bible/plan
// Body: { brief: Brief, homeBase: HomeBase | null }
// Returns { plan } or { error } — never a 500. With no key configured the app
// still works by hand, so the honest answer is a sentence saying why not.
export async function POST(req: Request) {
  let body: { brief?: Brief; homeBase?: HomeBase | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const brief = body.brief;
  if (!brief?.what?.trim()) {
    return NextResponse.json({ error: "Say what you want to build first" }, { status: 400 });
  }

  if (!aiKey()) {
    return NextResponse.json(
      { error: "No AI provider is configured, so plans cannot be generated. Set OPENROUTER_API_KEY in .env.local. You can still write steps by hand." },
      { status: 503 },
    );
  }

  const homeBase = body.homeBase ?? null;
  const currency = brief.locationOverride?.currency || homeBase?.currency || "USD";
  const model = process.env.AI_MODEL || DEFAULT_MODEL;

  try {
    const res = await aiFetch({
      method: "POST",
      body: JSON.stringify({
        model,
        temperature: 0.3,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: PLAN_SYSTEM },
          {
            role: "user",
            content: `${briefBlock(brief, homeBase)}\n\nReturn JSON in exactly this shape:\n${PLAN_SCHEMA}`,
          },
        ],
      }),
      signal: AbortSignal.timeout(110_000),
    });
    if (!res.ok) {
      const detail = await res.text();
      console.error("bible/plan provider refused:", res.status, detail.slice(0, 400));
      return NextResponse.json(
        { error: `The AI provider refused this (${res.status}). Try again, or pick another model on the hub's front page.` },
        { status: 502 },
      );
    }

    const json = await res.json();
    const plan = cleanPlan(
      JSON.parse(json?.choices?.[0]?.message?.content ?? "{}"),
      json?.model ?? model,
      currency,
    );
    if (!plan) {
      return NextResponse.json(
        { error: "The answer came back in a shape this app could not read. Try generating again." },
        { status: 502 },
      );
    }
    return NextResponse.json({ plan });
  } catch (err) {
    console.error("bible/plan failed:", err);
    return NextResponse.json(
      { error: "That took too long or the connection dropped. Nothing was changed — try again." },
      { status: 502 },
    );
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors mentioning `src/app/api/bible` or `src/lib/bible`.

- [ ] **Step 3: Prove it answers, with a real request**

Start the preview from Task 14's launch entry if it exists, otherwise `npx next dev -p 3282` in a shell you then stop. Then:

```bash
curl -s -X POST http://localhost:3282/api/bible/plan -H "Content-Type: application/json" -d '{"brief":{"what":"wooden picture frames","scale":"a-few","skill":"handy"},"homeBase":{"city":"Raleigh","region":"NC","country":"US","currency":"USD"}}' | head -c 600
```

Expected: JSON starting `{"plan":{"version":1,...` with at least two phases. With no key set, expected instead: `{"error":"No AI provider is configured...` and HTTP 503 — which is the correct behaviour, not a failure.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/bible/plan/route.ts
git commit -m "Financial Bible: the route that writes a plan"
```

---

## Task 9: `POST /api/bible/chat`

**Files:**
- Create: `src/app/api/bible/chat/route.ts`

- [ ] **Step 1: Write the route**

```ts
import { NextResponse } from "next/server";
import { DEFAULT_MODEL, aiFetch, aiKey } from "@/lib/ai/provider";
import { cleanOps } from "@/lib/bible/clean";
import { CHAT_SYSTEM } from "@/lib/bible/prompts";
import type { HomeBase, Message, Plan } from "@/lib/bible/types";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * The plan as the model sees it: ids included, because every op it may return
 * names one; owner-only fields left out, because `done`, `note` and `skipped`
 * are not the agent's business and `ops.ts` would overrule it anyway.
 */
function planForModel(plan: Plan) {
  return {
    version: plan.version,
    summary: plan.summary,
    assumptions: plan.assumptions,
    unit: plan.unit,
    phases: plan.phases.map((phase) => ({
      id: phase.id,
      title: phase.title,
      goal: phase.goal,
      days: phase.days,
      steps: phase.steps.map((step) => ({
        id: step.id,
        title: step.title,
        detail: step.detail,
        cost: step.cost,
        costNote: step.costNote,
        hours: step.hours,
        materials: step.materials.map((m) => ({
          name: m.name,
          qty: m.qty,
          unit: m.unit,
          unitCost: m.unitCost,
          // So it knows not to argue with a price the owner set himself.
          ownerSet: m.provenance === "user" || undefined,
        })),
        suppliers: step.suppliers.map((s) => ({ name: s.name, what: s.what, where: s.where })),
        check: step.check,
        legal: step.legal,
      })),
    })),
  };
}

// POST /api/bible/chat
// Body: { message, plan, history?: Message[], homeBase?: HomeBase | null }
// Returns { reply, ops, why } — ops may legitimately be empty.
export async function POST(req: Request) {
  let body: { message?: string; plan?: Plan; history?: Message[]; homeBase?: HomeBase | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const message = (body.message ?? "").trim();
  const plan = body.plan;
  if (!message) return NextResponse.json({ error: "Say something first" }, { status: 400 });
  if (!plan?.phases?.length) {
    return NextResponse.json({ error: "Generate a plan before talking about it" }, { status: 400 });
  }

  if (!aiKey()) {
    return NextResponse.json(
      { error: "No AI provider is configured, so the agent cannot answer. Set OPENROUTER_API_KEY in .env.local." },
      { status: 503 },
    );
  }

  const currency = body.homeBase?.currency || "USD";
  const model = process.env.AI_MODEL || DEFAULT_MODEL;

  // The last few turns only. A long argument about materials does not need to
  // be re-read in full to answer "and in oak?", and the plan itself carries the
  // state that matters.
  const history = (Array.isArray(body.history) ? body.history : [])
    .slice(-6)
    .map((m) => ({ role: m.role === "agent" ? "assistant" as const : "user" as const, content: m.text.slice(0, 4000) }));

  try {
    const res = await aiFetch({
      method: "POST",
      body: JSON.stringify({
        model,
        temperature: 0.3,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: CHAT_SYSTEM },
          { role: "user", content: `The plan as it stands:\n${JSON.stringify(planForModel(plan))}` },
          ...history,
          { role: "user", content: message },
        ],
      }),
      signal: AbortSignal.timeout(110_000),
    });
    if (!res.ok) {
      const detail = await res.text();
      console.error("bible/chat provider refused:", res.status, detail.slice(0, 400));
      return NextResponse.json({ error: `The AI provider refused this (${res.status}).` }, { status: 502 });
    }

    const json = await res.json();
    const parsed = JSON.parse(json?.choices?.[0]?.message?.content ?? "{}");
    const reply = typeof parsed?.reply === "string" ? parsed.reply.trim() : "";
    if (!reply) {
      return NextResponse.json(
        { error: "The answer came back empty. Nothing was changed — ask again." },
        { status: 502 },
      );
    }
    return NextResponse.json({
      reply,
      ops: cleanOps(parsed?.ops, currency),
      why: typeof parsed?.why === "string" ? parsed.why.slice(0, 400) : "",
    });
  } catch (err) {
    console.error("bible/chat failed:", err);
    return NextResponse.json(
      { error: "That took too long or the connection dropped. The plan is untouched." },
      { status: 502 },
    );
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/bible/chat/route.ts
git commit -m "Financial Bible: the agent that answers and proposes the edit"
```

---

## Task 10: `POST /api/bible/verify` and `POST /api/bible/extra`

**Files:**
- Create: `src/app/api/bible/verify/route.ts`
- Create: `src/app/api/bible/extra/route.ts`

- [ ] **Step 1: Write the verify route**

`perplexity/sonar` is named directly rather than using the hub's general model, because this call's whole purpose is reading the live web — the owner's front-page model pick is the right default everywhere else and the wrong one here.

```ts
import { NextResponse } from "next/server";
import { aiFetch, aiKey } from "@/lib/ai/provider";
import { uid } from "@/lib/bible/ids";
import { VERIFY_SYSTEM } from "@/lib/bible/prompts";
import type { Finding } from "@/lib/bible/verify";
import type { HomeBase, Plan } from "@/lib/bible/types";

export const runtime = "nodejs";
// A web-reading model is slower than a chat one, and this reads several pages.
export const maxDuration = 180;

/** A search model, not the hub's general model: this call has to read the web. */
const SEARCH_MODEL = process.env.BIBLE_VERIFY_MODEL || "perplexity/sonar";

/** The shopping list: what to price, and which step and material it belongs to. */
function shoppingList(plan: Plan): string {
  const lines: string[] = [];
  for (const phase of plan.phases) {
    for (const step of phase.steps) {
      if (step.skipped) continue;
      for (const material of step.materials) {
        if (material.provenance === "user") continue; // his price stands
        lines.push(
          `stepId=${step.id} materialId=${material.id} — ${material.qty} ${material.unit} of ${material.name}`,
        );
      }
      // A step with a cost but no itemised materials is still worth pricing:
      // a saw rental, a market table, a cutting fee.
      if (!step.materials.length && step.cost && step.provenance !== "user") {
        lines.push(`stepId=${step.id} — ${step.title}: ${step.detail}`.slice(0, 300));
      }
    }
  }
  return lines.slice(0, 40).join("\n");
}

function cleanFindings(value: unknown): Finding[] {
  if (!Array.isArray(value)) return [];
  const out: Finding[] = [];
  for (const entry of value.slice(0, 60)) {
    if (!entry || typeof entry !== "object") continue;
    const raw = entry as Record<string, any>;
    const stepId = typeof raw.stepId === "string" ? raw.stepId : "";
    const s = raw.supplier;
    if (!stepId || !s || typeof s !== "object" || typeof s.name !== "string") continue;
    // A price with no source is exactly what the prompt forbids, so it is
    // dropped here rather than shown to the owner as if it were checked.
    const source = typeof s.source === "string" ? s.source.slice(0, 400) : "";
    if (!source) continue;
    const price = s.price && typeof s.price === "object"
      && typeof s.price.low === "number" && typeof s.price.high === "number"
      ? {
          low: Math.min(s.price.low, s.price.high),
          high: Math.max(s.price.low, s.price.high),
          currency: typeof s.price.currency === "string" ? s.price.currency.toUpperCase().slice(0, 3) : "USD",
        }
      : undefined;
    out.push({
      stepId,
      materialId: typeof raw.materialId === "string" && raw.materialId ? raw.materialId : undefined,
      supplier: {
        id: uid("sup"),
        name: s.name.slice(0, 120),
        what: typeof s.what === "string" ? s.what.slice(0, 120) : "",
        where: typeof s.where === "string" ? s.where.slice(0, 200) : undefined,
        phone: typeof s.phone === "string" ? s.phone.slice(0, 40) : undefined,
        url: typeof s.url === "string" ? s.url.slice(0, 400) : undefined,
        price,
        source,
      },
    });
  }
  return out;
}

// POST /api/bible/verify
// Body: { plan, homeBase }
// Returns { findings } for the client to merge with mergeVerified().
export async function POST(req: Request) {
  let body: { plan?: Plan; homeBase?: HomeBase | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const plan = body.plan;
  if (!plan?.phases?.length) {
    return NextResponse.json({ error: "Nothing to price yet" }, { status: 400 });
  }
  if (!aiKey()) {
    return NextResponse.json(
      { error: "No AI provider is configured, so prices cannot be checked. Set OPENROUTER_API_KEY in .env.local." },
      { status: 503 },
    );
  }

  const list = shoppingList(plan);
  if (!list) {
    return NextResponse.json({ error: "Every price here is already yours or already checked" }, { status: 400 });
  }

  const where = body.homeBase
    ? `${body.homeBase.city}, ${body.homeBase.region}, ${body.homeBase.country} (currency ${body.homeBase.currency})`
    : "no location given — use suppliers that ship, and say so";

  try {
    const res = await aiFetch({
      method: "POST",
      body: JSON.stringify({
        model: SEARCH_MODEL,
        temperature: 0.1,
        messages: [
          { role: "system", content: VERIFY_SYSTEM },
          { role: "user", content: `Buying near: ${where}\n\nPrice these, keeping the stepId and materialId on each answer:\n${list}` },
        ],
      }),
      signal: AbortSignal.timeout(170_000),
    });
    if (!res.ok) {
      const detail = await res.text();
      console.error("bible/verify provider refused:", res.status, detail.slice(0, 400));
      return NextResponse.json({ error: `The search model refused this (${res.status}).` }, { status: 502 });
    }

    const json = await res.json();
    const content = json?.choices?.[0]?.message?.content ?? "{}";
    // A search model answers in prose more often than a chat one, so the JSON
    // is dug out rather than assumed to be the whole body.
    const start = content.indexOf("{");
    const end = content.lastIndexOf("}");
    const parsed = start === -1 || end === -1 ? {} : JSON.parse(content.slice(start, end + 1));
    const findings = cleanFindings(parsed?.findings);
    if (!findings.length) {
      return NextResponse.json(
        { error: "Nothing came back with a source attached, so nothing was changed. The estimates stand." },
        { status: 502 },
      );
    }
    return NextResponse.json({ findings });
  } catch (err) {
    console.error("bible/verify failed:", err);
    return NextResponse.json({ error: "The price check took too long. The estimates stand." }, { status: 502 });
  }
}
```

- [ ] **Step 2: Write the extra route**

```ts
import { NextResponse } from "next/server";
import { DEFAULT_MODEL, aiFetch, aiKey } from "@/lib/ai/provider";
import { EXTRA_SYSTEM } from "@/lib/bible/prompts";
import type { ExtraTopic, HomeBase } from "@/lib/bible/types";

export const runtime = "nodejs";
export const maxDuration = 120;

/** What each button asks for, in words. The ONLY place these are discussed. */
const TOPIC_ASK: Record<ExtraTopic, string> = {
  "legal-structure": "whether to trade as themselves or form a company, and what forming one involves",
  insurance: "what insurance this kind of work actually needs, and what each kind covers",
  banking: "keeping the money separate: accounts, cards, and bookkeeping that takes minutes",
  taxes: "what they will owe, what they can deduct, and what to keep records of from day one",
  branding: "a name, a mark and a look that suits what they are making",
  marketing: "how the first fifty people hear about this, cheaply",
  "selling-online": "where to list it, what each platform takes, and what shipping costs them",
  hiring: "the first person they would pay, and what to hand over first",
  scaling: "what breaks first when demand doubles, and what to fix before it does",
};

// POST /api/bible/extra
// Body: { topic, summary, homeBase? }
// Returns { body } — markdown for one Extra.
export async function POST(req: Request) {
  let body: { topic?: ExtraTopic; summary?: string; homeBase?: HomeBase | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const topic = body.topic;
  if (!topic || !(topic in TOPIC_ASK)) {
    return NextResponse.json({ error: "Unknown topic" }, { status: 400 });
  }
  if (!aiKey()) {
    return NextResponse.json(
      { error: "No AI provider is configured. Set OPENROUTER_API_KEY in .env.local." },
      { status: 503 },
    );
  }

  const where = body.homeBase
    ? `They are in ${body.homeBase.city}, ${body.homeBase.region}, ${body.homeBase.country}.`
    : "No location given.";

  try {
    const res = await aiFetch({
      method: "POST",
      body: JSON.stringify({
        model: process.env.AI_MODEL || DEFAULT_MODEL,
        temperature: 0.3,
        messages: [
          { role: "system", content: EXTRA_SYSTEM },
          {
            role: "user",
            content: `The build: ${(body.summary ?? "").slice(0, 1200)}\n${where}\n\nTopic, and nothing else: ${TOPIC_ASK[topic]}`,
          },
        ],
      }),
      signal: AbortSignal.timeout(110_000),
    });
    if (!res.ok) {
      return NextResponse.json({ error: `The AI provider refused this (${res.status}).` }, { status: 502 });
    }
    const json = await res.json();
    const markdown = (json?.choices?.[0]?.message?.content ?? "").trim();
    if (!markdown) return NextResponse.json({ error: "That came back empty. Try again." }, { status: 502 });
    return NextResponse.json({ body: markdown.slice(0, 20_000) });
  } catch (err) {
    console.error("bible/extra failed:", err);
    return NextResponse.json({ error: "That took too long. Try again." }, { status: 502 });
  }
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/bible/verify/route.ts src/app/api/bible/extra/route.ts
git commit -m "Financial Bible: real prices with sources, and the nine topics behind their own door"
```

---

## Task 11: Register the app

**Files:**
- Modify: `src/lib/catalog.ts` (add to `PROJECTS`, add the slug to `UNPREVIEWABLE`)
- Modify: `src/lib/studio/plugins.ts` (add to `PLUGIN_SLUGS` and `WHY`)
- Modify: `.claude/launch.json`

- [ ] **Step 1: Add the catalog entry**

Add to `PROJECTS` in `src/lib/catalog.ts`, next to the other Utilities apps:

```ts
  {
    slug: "financial-bible",
    title: "Financial Bible",
    tag: "The book of money plays",
    category: "Utilities",
    overview:
      "Several rooms behind one front door, and the first of them answers the question that kills most "
      + "ideas: not whether it is a good one, but what you actually DO on Saturday morning. Every idea "
      + "you have had is a card, and the card holds a build plan — phases, numbered steps, a cost range "
      + "on each one, the materials with quantities, who sells them near you, how long it takes and how "
      + "you know a step came out right. Then you argue with it. Ask for it cheaper, swap pine for oak, "
      + "ask whether a step even needs a permit where you live, and the answer comes back with the EDIT "
      + "attached: these four steps change, the total drops, accept or discard. Accept and it becomes "
      + "v2 with v1 still readable, because 'cheaper' and 'the good version' both have to survive. "
      + "Press Price this for real and a web-reading model goes and finds actual shops with actual "
      + "addresses and prices, and every line it checked starts saying VERIFIED with the page it came "
      + "from; everything it could not find keeps saying ESTIMATE, because that is the honest answer. "
      + "What it will not do is the thing every business-plan tool does: it never mentions an LLC, "
      + "insurance, branding or marketing. Those are nine buttons at the foot of the plan that generate "
      + "nothing until you press one. And anything legal — permits, resale certificates, selling food — "
      + "comes back as a question with somebody to ask, never as an answer, because no app knows the "
      + "rules where you live. The other three rooms (Deal Scout, Money Plays, Funding) say what they "
      + "will hold and admit they are not built yet.",
    status: "live",
    appUrl: "/apps/financial-bible",
    iconStyle: "rings",
    hue: [36, 168],
  },
```

Then add `"financial-bible"` to the `UNPREVIEWABLE` set — it holds the owner's own ideas, and the hub carousel must never frame it.

- [ ] **Step 2: Add it to Jarvis**

In `src/lib/studio/plugins.ts`, add `"financial-bible"` to the end of `PLUGIN_SLUGS`, and this entry to `WHY`:

```ts
  "financial-bible":
    "The plugin that turns an idea into Saturday morning. Everything else here makes something to "
    + "look at; this one costs it, sources it, puts it in order, and then argues with you about it — "
    + "cheaper, different material, is this even allowed here — handing back the edit as a diff with a "
    + "lower total rather than another wall of text. It refuses to talk about LLCs and marketing until "
    + "asked, which is why the plan gets read.",
```

- [ ] **Step 3: Add the preview server**

Add to `configurations` in `.claude/launch.json`:

```json
    {
      "name": "financial-bible",
      "runtimeExecutable": "node",
      "runtimeArgs": ["scripts/dev-preview.mjs", "--no-auth"],
      "port": 3282,
      "autoPort": true
    }
```

- [ ] **Step 4: Confirm the registration is coherent**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `node -e "const{PROJECTS}=require('ts-node')?{}:{};" 2>/dev/null; npx vitest run src/lib/bible/`
Expected: still PASS. (The catalog has no tests; the typecheck is what proves the entry is well-formed.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/catalog.ts src/lib/studio/plugins.ts .claude/launch.json
git commit -m "Financial Bible: one catalog object, one plugin slug, one preview port"
```

---

## Task 12: The shell and the empty rooms

**Files:**
- Create: `src/app/apps/financial-bible/page.tsx`
- Create: `src/components/bible/Bible.tsx`
- Create: `src/components/bible/rooms/EmptyRoom.tsx`
- Create: `src/components/bible/bible.css`

- [ ] **Step 1: Invoke the design skill FIRST**

Invoke `interactive-web-studio` and say so in the response: *"Using `interactive-web-studio` for the UI."* This is the repo's own rule in `CLAUDE.md` and it is not optional. The brief for it:

> A dense instrument, not a card grid. Four rooms behind one front door, each with an accent hue the shell's ambient light shifts to. The plan sheet is the hero: a long numbered document that reads like paper, with the cost total pinned and live while you scroll, ESTIMATE/VERIFIED legible per line at a glance, and the agent docked beside it rather than covering it. Ticking a step off should feel like crossing something out. Typography leads; no effect may make a number harder to read.

Everything below is structure and wiring. The skill decides the look.

- [ ] **Step 2: Write the page**

```tsx
import { Bible } from "@/components/bible/Bible";
import { isRoom } from "@/lib/bible/rooms";

export const metadata = {
  title: "Financial Bible · Ultimate Assistant OS",
  description:
    "Every business idea you have had, each one holding the costed, sourced, ordered plan for actually "
    + "building it — and an agent that will argue with you about it.",
};

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ studio?: string }>;
}) {
  // `?studio=` is how Jarvis, and any link, points at one room. Null — no room,
  // or one that is not a room — means the shell resumes whichever was last open.
  const { studio } = await searchParams;
  return <Bible initialRoom={isRoom(studio) ? studio : null} />;
}
```

- [ ] **Step 3: Write the shell**

```tsx
"use client";

// ---------------------------------------------------------------------------
// Financial Bible — the shell.
//
// It owns exactly two things: which room is mounted, and the home base every
// room needs. It does not know what a plan is. Adding the next room is an
// object in src/lib/bible/rooms.ts plus one line in MOUNTS.
// ---------------------------------------------------------------------------

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import { DEFAULT_ROOM, ROOMS, isRoom, roomDef, type RoomId } from "@/lib/bible/rooms";
import { loadRaw, saveStore, setHomeBase, setLastRoom } from "@/lib/bible/store";
import type { HomeBase } from "@/lib/bible/types";
import { EmptyRoom } from "./rooms/EmptyRoom";
import "./bible.css";

// One room's worth of JavaScript at a time.
const PlansRoom = dynamic(() => import("./plans/IdeaTable").then((m) => m.PlansRoom), {
  ssr: false,
  loading: () => <div className="bible-skeleton" />,
});

export function Bible({ initialRoom }: { initialRoom: RoomId | null }) {
  const [room, setRoom] = useState<RoomId>(initialRoom ?? DEFAULT_ROOM);
  const [homeBase, setBase] = useState<HomeBase | null>(null);
  /** Null until the store has been read, so the strip does not flash. */
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const raw = loadRaw();
    setBase(raw.homeBase);
    setReady(true);
    if (initialRoom) {
      saveStore(setLastRoom(raw, initialRoom));
      return;
    }
    if (isRoom(raw.lastRoom)) setRoom(raw.lastRoom);
  }, [initialRoom]);

  const go = useCallback((next: RoomId) => {
    setRoom(next);
    saveStore(setLastRoom(loadRaw(), next));
    // Name what is on screen without navigating: a room can hold unsaved work,
    // and re-mounting it to change a query string would throw that away.
    const url = new URL(window.location.href);
    url.searchParams.set("studio", next);
    window.history.replaceState(null, "", url);
  }, []);

  const saveBase = useCallback((base: HomeBase) => {
    setBase(base);
    saveStore(setHomeBase(loadRaw(), base));
  }, []);

  const def = roomDef(room);

  return (
    <div className="bible" style={{ ["--bible-accent" as string]: `${def.hue}` }}>
      {/* The rail: every room, built or not. ROOMS is the only list. */}
      <nav className="bible-rail">
        {ROOMS.map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={() => go(r.id)}
            data-active={r.id === room}
            data-built={r.built}
          >
            <span>{r.label}</span>
            <small>{r.hint}</small>
          </button>
        ))}
      </nav>

      {/* Home base: asked for once, then a quiet line in the header. */}
      {ready && <HomeBaseStrip base={homeBase} onSave={saveBase} />}

      <main className="bible-room">
        {def.built ? <PlansRoom homeBase={homeBase} /> : <EmptyRoom room={def} />}
      </main>
    </div>
  );
}
```

`HomeBaseStrip` is a small form in the same file: city, region, country, currency, a Save button; when `base` is null it renders as a one-line prompt explaining why it is being asked (*"Where are you building? Suppliers and prices are looked up against this."*), and when it is set it renders as text with an Edit button. It must never block the room behind it.

- [ ] **Step 4: Write the empty room**

```tsx
import type { RoomDef } from "@/lib/bible/rooms";

/**
 * A room that is specified but not built. It says what it will hold and that it
 * does not hold it yet, which is the honest version of a rail with four entries
 * — and lets the owner see the shape of what he is filling.
 */
export function EmptyRoom({ room }: { room: RoomDef }) {
  return (
    <section className="bible-empty">
      <h2>{room.label}</h2>
      <p className="bible-empty-hint">{room.hint}</p>
      <p>{room.blurb}</p>
      <p className="bible-empty-status">Not built yet.</p>
    </section>
  );
}
```

- [ ] **Step 5: Verify in the browser**

Start the preview (`preview_start` with `financial-bible`), open `/apps/financial-bible`, and check: the rail shows four rooms, Build Plans is selected, the three others render the not-built panel, clicking a room changes the URL's `studio=` without a reload, and the home-base strip asks once and then stays answered after a refresh.

- [ ] **Step 6: Commit**

```bash
git add src/app/apps/financial-bible src/components/bible/Bible.tsx src/components/bible/rooms/EmptyRoom.tsx src/components/bible/bible.css
git commit -m "Financial Bible: the shell, four rooms, and a home base it asks for once"
```

---

## Task 13: The vault table and the brief

**Files:**
- Create: `src/components/bible/plans/IdeaTable.tsx` (exports `PlansRoom`)

- [ ] **Step 1: Build the table**

`PlansRoom({ homeBase })` holds the whole Build Plans room: it owns the `BibleStore` state (`loadRaw()` once on mount, every write through a reducer then `saveStore`), and switches between the table and one open idea.

The table is a real table — `<table>`, one row per idea, columns exactly as the spec's section 4: Idea · Status · Plan · Cost · Progress · Touched. Cost comes from `totals(currentPlan(idea))` and `fmtMoney`; Progress from `progress()`. Sort by clicking a header; filter with one search box over title, one-liner and tags; pinned ideas first. A row click opens the idea.

Rules that matter:
- Deleting an idea calls `deleteIdea(store, id, !view.isOwn(id))` so a seed is remembered as hidden. Confirm first — this is the owner's own data.
- The status cell is an inline `<select>`; changing it writes immediately through `upsertIdea`.
- An idea with no plan shows `—` in Plan and a **Generate the plan** button in the open view, not in the row.

- [ ] **Step 2: Build the brief form**

**New idea** opens a form with exactly the fields from spec section 4: title, one-liner, what you're building (required, a textarea), scale (4 radios, labels from the spec), skill (3 radios), budget ceiling (optional number + the home currency), tools and space you already own (textarea), and a location override that is collapsed by default and defaults to home base.

On submit: build the `Idea` with `uid("idea")` (from `@/lib/bible/ids`), `plans: []`, `chat: []`, `status: "planning"`, write it with `upsertIdea`, open it, and immediately POST `/api/bible/plan` with `{ brief, homeBase }`.

While that call is in flight the open idea shows a progress line naming what is happening ("Writing the plan — materials, costs and suppliers. This takes up to a minute."). On `{ plan }`, `pushPlan` and save. On `{ error }`, show the error text as a line at the top of the sheet with a Retry button, and leave the idea in place — a failed generation must never lose the brief the owner just typed.

- [ ] **Step 3: Verify in the browser**

Create an idea called "Resin coasters". Confirm: it appears in the table; a reload still shows it; the seeded "Picture frames" row shows `v1`, a cost range and `0/10`; deleting the seed and reloading does not bring it back; the search box filters.

- [ ] **Step 4: Commit**

```bash
git add src/components/bible/plans/IdeaTable.tsx
git commit -m "Financial Bible: the vault, and the brief that stops a garage plan reading like a factory"
```

---

## Task 14: The plan sheet

**Files:**
- Create: `src/components/bible/plans/PlanSheet.tsx`
- Create: `src/components/bible/plans/StepRow.tsx`
- Create: `src/components/bible/plans/Beyond.tsx`

- [ ] **Step 1: The sheet**

`PlanSheet({ idea, plan, homeBase, onChange })`. Layout, top to bottom:

- **A pinned header** that stays visible while scrolling: the total from `totals(plan)` through `fmtMoney`, the step progress, the timeline from `timeline(plan)` ("3 weeks · 31 hands-on hours"), the version (`v2`, a picker when `idea.plans.length > 1` — selecting an older version shows it read-only with a "viewing v1" marker), and a **Price this for real** button. When `totals().mixed` is true the total reads "two currencies — totals off" rather than a number. When `uncostedSteps > 0` it says so beside the total.
- **The summary**, then **assumptions** as a short list, then **open questions** rendered as questions the owner can answer into the chat with one click (clicking one puts it in the chat box).
- **The phases**, each with its title, goal, day count, and its steps as `StepRow`s, numbered continuously across the whole plan (1…24, not 1-4 then 1-6 — a plan is one document).
- **Unit economics** when `plan.unit` exists: cost, sells for, and the note.
- **`Beyond`** last.

**Price this for real** POSTs `/api/bible/verify`, then applies `mergeVerified(plan, findings)` and saves as a new version through `pushPlan`. Its button shows a progress line while running ("Reading shop prices near Raleigh — up to three minutes."), and on error shows the error text and changes nothing.

- [ ] **Step 2: The step row**

`StepRow({ step, index, onChange })` renders: the number, a checkbox bound to `step.done`, the title, the detail, and a right-hand cost cell showing `fmtMoney(stepCost(step))` with a provenance tag — ESTIMATE, VERIFIED, or YOURS — plus `costNote` underneath. Expanding a row reveals materials (name, qty, unit, unit cost with its own provenance tag), suppliers (name, what, where, phone, link, and the `source` as "found at <source> on <date>" when present), the `check` line, and the owner's note field.

Three behaviours that carry the design's weight:
- Editing any cost or unit cost sets that item's `provenance` to `"user"`. That is how a typed number becomes untouchable, and the tag changing to YOURS is the feedback that says so.
- `step.legal` renders as a marked block: the question, then "Ask: <whoToAsk>". It must not look like an answer, and it must not be hideable.
- A skipped step renders struck through and is excluded from totals automatically, because `stepCost` already returns null for it.

- [ ] **Step 3: Beyond the build**

`Beyond({ plan, homeBase, onChange })` renders nine buttons from the `ExtraTopic` union with plain labels (Legal structure · Insurance · Banking · Taxes · Branding · Marketing · Selling online · Hiring · Scaling), above one line of text: *"None of this is part of building the thing. Press one and it gets written."* Pressing one POSTs `/api/bible/extra`, appends the result to `plan.extras` with `uid("extra")` and today's date, and renders it as markdown below the buttons. An already-generated topic shows its body with a Regenerate button instead of generating twice.

- [ ] **Step 4: Verify in the browser**

Open the seeded Picture frames idea. Confirm: ten steps numbered 1-10 continuously; the header total reads `$215–$540` or thereabouts and matches what `totals()` computes; ticking step 1 moves progress to 1/10 and survives a reload; expanding step 3 shows the moulding material with its unit cost and the lumber-yard supplier; step 10 shows the permit question with somebody to ask; typing a cost into step 4 flips its tag to YOURS; the Beyond row shows nine buttons and no generated text.

- [ ] **Step 5: Commit**

```bash
git add src/components/bible/plans/PlanSheet.tsx src/components/bible/plans/StepRow.tsx src/components/bible/plans/Beyond.tsx
git commit -m "Financial Bible: the sheet, with the total pinned and every number saying where it came from"
```

---

## Task 15: The agent and the diff gate

**Files:**
- Create: `src/components/bible/plans/Agent.tsx`

- [ ] **Step 1: Build it**

`Agent({ idea, plan, homeBase, onAccept, onChat })`, docked beside the sheet.

The thread renders `idea.chat`. Sending a message: append the owner's `Message` (`role: "owner"`, `againstVersion: plan.version`), POST `/api/bible/chat` with `{ message, plan, history: idea.chat, homeBase }`, then append the agent's `Message` with `proposed: ops` and `outcome: ops.length ? "pending" : undefined`.

**The gate.** When an answer carries ops, render under the reply:

```tsx
const preview = applyOps(plan, ops);              // never saved until Accept
const before = totals(plan);
const after = totals(preview.plan);
```

Show `opSummary(ops)`, then the cost movement — `fmtMoney(before.cost)` → `fmtMoney(after.cost)` — then each op as a line naming the step it touches (title for a replace or remove, the new title for an add), then **Accept** and **Discard**.

- Accept: `onAccept(preview.plan)` → `pushPlan` → save. Set the message's `outcome` to `"accepted"`.
- Discard: set `outcome` to `"discarded"`. The reply stays in the thread. Nothing else changes.
- When `preview.dropped.length`, show those too: *"2 edits ignored — they named steps that are not in this plan."* Never hide a dropped op; it is the signal that the agent and the sheet have drifted apart.

An answer with no ops renders as a plain reply, which is a normal outcome.

- [ ] **Step 2: Verify in the browser, on the owner's real click path**

With a key configured, open Picture frames and ask **"make it cheaper"**. Confirm: a reply arrives; a diff appears naming changed steps; the cost movement shows a lower total; Accept bumps the header to v2; the version picker still shows v1 and selecting it shows the original numbers; a step ticked before accepting is still ticked after.

Then ask **"is it legal to sell these at a farmers market?"** and confirm the reply arrives with no ops and no diff — a question is not an edit.

Then ask **"should I form an LLC?"** and confirm the reply points at the Beyond buttons rather than adding steps.

- [ ] **Step 3: Commit**

```bash
git add src/components/bible/plans/Agent.tsx
git commit -m "Financial Bible: the gate — an answer, the edit it implies, and the total it moves"
```

---

## Task 16: Verify the whole thing and hand it over

- [ ] **Step 1: The suite and the typecheck**

Run: `npx vitest run src/lib/bible/`
Expected: PASS — 7 files, 66 tests.

Run: `npx tsc --noEmit`
Expected: clean.

Run: `npx next build`
Expected: succeeds, and `/apps/financial-bible` appears in the route list. (If a nested app breaks this, check the root `tsconfig.json` `exclude` — see `CLAUDE.md`.)

- [ ] **Step 2: Prove the no-key path**

Temporarily move the key:

```bash
cp .env.local .env.local.bak && sed -i 's/^OPENROUTER_API_KEY=/#OPENROUTER_API_KEY=/' .env.local
```

Restart the preview and confirm: the app opens, the seeded plan renders in full, ticking steps works, hand-typed costs work, and Generate / Price this for real / the Beyond buttons each say plainly that no provider is configured. Nothing 500s.

```bash
mv .env.local.bak .env.local
```

- [ ] **Step 3: Prove it is in Jarvis**

Open `/apps/jarvis` → App plugins. Confirm a Financial Bible card is there with its `WHY` line and that it opens the app in its own tab. Confirm the hub front page does **not** also show it (`hubProjects()` excludes plugins).

- [ ] **Step 4: Screenshot the states worth reviewing**

Capture, with `computer {action:"screenshot"}`: the idea table with two ideas; the plan sheet scrolled so the pinned total is visible; one expanded step showing a supplier with its source; the legal flag; a diff gate mid-decision; the no-key degraded state; the Deal Scout empty room. Failure states included — a state nobody captured is a state nobody reviewed.

- [ ] **Step 5: Commit and report**

```bash
git add -A src/lib/bible src/components/bible src/app/apps/financial-bible src/app/api/bible
git commit -m "Financial Bible: Build Plans, verified end to end"
```

Report to the owner: what works, what each generate button costs per press, and the one thing left open — the five Deal Scout decisions in `docs/superpowers/specs/2026-10-02-financial-bible-deal-scout-design.md` section 11.

Then offer to log the decision in `aios/decisions/log.md`: *the Financial Bible is one plugin with rooms, and a build plan is data with provenance on every number rather than prose.*

---

## Self-review against the spec

| Spec section | Covered by |
|---|---|
| 2 — shell, four rooms, namespace | Task 1 (`rooms.ts`), Task 12 |
| 3 — `?studio=`, home base, no-base fallback | Task 12, `briefBlock` in Task 7 |
| 4 — idea table columns, brief fields | Task 13 |
| 5 — plan object, derived totals, costing rule | Task 1 (`types.ts`), Task 2 |
| 6 — plan / chat / verify / extra routes | Tasks 8, 9, 10 |
| 7 — scope refusal, Beyond shelf, legal as a question | Task 4 (`extras` dropped), Task 7 (prompt + test), Task 14 (`Beyond`, legal block) |
| 8 — localStorage + saveSynced, seeds, hiddenSeeds, no-key path | Task 6, Task 16 Step 2 |
| 9 — the five test files | Tasks 2-6 (plus `prompts.test.ts`, which the spec did not list and which earns its place by pinning the refusal) |
| 10 — file list | Every task's **Files** block; `rooms.ts` and `extra/route.ts` added |
| 11 — design skill drives the UI | Task 12 Step 1, before any component exists |
| 12 — the seven acceptance criteria | Task 12 Step 5, 13 Step 3, 14 Step 4, 15 Step 2, 16 Steps 1-3 |
