# Financial Bible — Build Plans

**Date:** 2026-10-02
**Status:** approved design, ready for an implementation plan
**Slug:** `financial-bible` · code in `src/lib/bible/`, `src/components/bible/`, routes in `src/app/api/bible/`
**Where it appears:** a card on Jarvis › App plugins (`PLUGIN_SLUGS` in `src/lib/studio/plugins.ts`)

---

## 1. What this is

A vault of the owner's business ideas where each idea keeps a **build plan**: the
ordered, costed, sourced list of what you actually do to make the thing exist and
sell the first one. Not a business plan. The difference is the whole point of the
app, and it is enforced in section 7.

"I want to build picture frames" becomes: the moulding you buy and where, the saw
you need and whether renting beats owning, the first ten cuts, what the first
frame costs you, what it sells for, and how long before you have one in your
hands. LLC, insurance, branding and marketing appear only if you ask for them.

The plan is the artifact and it persists. The chat exists to change the plan.

## 2. Why it is a Bible and not one app

The owner will add more money rooms to this: a **Deal Scout** (marketplace ROI
finder — its own spec, `2026-10-02-financial-bible-deal-scout-design.md`),
**Money Plays** (income ideas filed and rated), **Funding** (grants, loans, where
capital actually comes from).

So `financial-bible` is a shell with a rail of rooms, exactly as EA World holds
several studios behind one front door (`src/lib/ea-world/studios.ts`). `?studio=`
selects a room so Jarvis can deep-link one; no parameter resumes the last one
opened. Build Plans is built. The other three ship as **named empty rooms** — a
panel saying what that room will hold and that it is not built yet — because a
rail with a dead link in it is worse than a rail that is honest, and because the
owner should be able to see the shape of the thing he is filling.

Namespace note: `src/lib/finance/*` is already the bank-reconciliation code
behind Jarvis's Personal Finance folder. Nothing in this app may be added there.
`src/lib/bible/` is the home.

## 3. The shell

```
/apps/financial-bible                 → last room, or Build Plans on first run
/apps/financial-bible?studio=plans    → Build Plans
/apps/financial-bible?studio=scout    → Deal Scout (empty room)
/apps/financial-bible?studio=plays    → Money Plays (empty room)
/apps/financial-bible?studio=funding  → Funding (empty room)
```

**Home base.** Addresses and quotes need a place and a currency. The Bible keeps
one `homeBase { city, region, country, currency }`, asked for once the first time
the app is opened (a strip, not a modal that blocks reading), editable from the
shell header, and used by every room. Any single idea may override it — an idea
being built somewhere else is an ordinary case, not an edge case.

A plan generated with no home base set is still allowed; it comes back with
online-only suppliers and says so in its assumptions.

## 4. The card

Build Plans opens on a dense table of ideas — the owner's stated preference over
a card grid. One row per idea:

| Idea | Status | Plan | Cost | Progress | Touched |
|---|---|---|---|---|---|
| Picture frames | building | v3 | $380–$520 | 7/24 | 2d ago |

Status is `idea · planning · building · built · parked`, set by hand. `Plan`
shows the current version or `—` when none has been generated. `Cost` is the
derived total range. `Progress` is checked steps over total steps, excluding
skipped ones. Sort and filter by any column; a search box over title, one-liner
and tags. Pinned ideas sort first.

**Creating an idea** takes a title, a one-liner, and a short brief:

- **What you're building** — free text, the one required field.
- **Scale** — `one for myself` · `a few to sell` · `a steady side income` ·
  `a real product line`. This single field is what stops the agent writing a
  factory plan for a garage.
- **Budget ceiling** — optional. When set, it is a hard constraint in the prompt
  and a plan that cannot fit under it must say so in `openQuestions` rather than
  quietly producing a plan the owner cannot afford.
- **Skill level** — `never done anything like this` · `handy` · `trained/pro`.
  Decides whether a step is "cut a 45° mitre" or "set the mitre saw to 45° and
  cut, holding the stock against the fence — the cut face is the show face".
- **Tools and space you already own** — free text. A plan that tells you to buy
  a saw you own is a plan you stop trusting.
- **Location override** — optional, defaults to home base.

The brief stays editable on the idea, and editing it is what makes Regenerate
meaningful.

## 5. The plan object

The agent returns data, not prose. Everything the sheet shows — totals, timeline,
progress, verification state — is computed from this.

```ts
/** A cost is always a range. A single invented number reads as a fact. */
export interface Money { low: number; high: number; currency: string }

/**
 * Where a number came from. `user` is sacred: nothing the owner typed is ever
 * overwritten by a generation or a verify pass.
 */
export type Provenance = "estimate" | "verified" | "user";

export interface Material {
  id: string;
  name: string;            // "primed pine moulding, 1.5in"
  qty: number;
  unit: string;            // "ft", "sheet", "each"
  unitCost?: Money;
  provenance: Provenance;
  /** Suppliers on the step that can supply this material. */
  supplierIds: string[];
}

export interface Supplier {
  id: string;
  name: string;
  what: string;            // what you buy here
  where?: string;          // street address, or "ships nationwide"
  phone?: string;
  url?: string;
  price?: Money;
  /** Set only by the verify pass: the page or listing this came from. */
  source?: string;
  foundAt?: string;        // ISO date — a price with no date is a rumour
}

export interface Step {
  id: string;
  title: string;           // imperative. "Cut the moulding to length"
  detail: string;          // 1–3 sentences of how, pitched at the skill level
  cost?: Money;
  costNote?: string;       // "rental, per day" / "one-off, reusable"
  provenance: Provenance;
  hours?: number;          // hands-on effort, not elapsed time
  materials: Material[];
  suppliers: Supplier[];
  /** How you know this step came out right. Optional but strongly prompted. */
  check?: string;
  /**
   * A thing to check with somebody, never an answer. Set when a step touches
   * permits, licensing, resale certificates, food, electrical, or selling
   * somewhere with rules. See section 7.
   */
  legal?: { question: string; whoToAsk: string };
  done: boolean;
  skipped: boolean;
  /** Owner's own note on this step, never touched by the agent. */
  note?: string;
}

export interface Phase {
  id: string;
  title: string;           // "Buy the stock" / "Make the first frame"
  goal: string;            // what is true when this phase is finished
  days?: number;           // elapsed, including waiting for deliveries
  steps: Step[];
}

/** A topic that is NOT part of building the thing, generated only on request. */
export interface Extra {
  id: string;
  topic: "legal-structure" | "insurance" | "banking" | "taxes"
       | "branding" | "marketing" | "selling-online" | "hiring" | "scaling";
  body: string;            // markdown
  createdAt: string;
}

export interface Plan {
  version: number;         // 1, 2, 3 … every accepted patch bumps it
  createdAt: string;
  /** Which model and provider wrote it, for when one starts writing worse. */
  model: string;
  summary: string;         // what is being built, and what "done" means
  /** What the agent assumed. Written out loud so a wrong one is correctable. */
  assumptions: string[];
  /** What it needs from the owner to get sharper. Rendered as asked questions. */
  openQuestions: string[];
  phases: Phase[];
  /** First-unit economics, when the agent can establish them honestly. */
  unit?: { cost: Money; sellsFor?: Money; note?: string };
  /** The Beyond-the-build shelf. EMPTY unless the owner pressed a button. */
  extras: Extra[];
}

/** The answers from section 4. Every field but `what` is optional. */
export interface Brief {
  what: string;
  scale: "one-off" | "a-few" | "side-income" | "product-line";
  budgetCeiling?: Money;
  skill: "none" | "handy" | "pro";
  toolsOwned?: string;
  locationOverride?: HomeBase;
}

export interface Message {
  id: string;
  role: "owner" | "agent";
  text: string;
  at: string;
  /** The ops this answer proposed, and what the owner did with them. */
  proposed?: Op[];
  outcome?: "accepted" | "discarded" | "pending";
  /** The plan version this answer was written against. */
  againstVersion: number;
}

export interface Idea {
  id: string;
  title: string;
  oneLiner: string;
  brief: Brief;
  status: "idea" | "planning" | "building" | "built" | "parked";
  tags: string[];
  pinned: boolean;
  /** Version history, oldest first. The last entry is the current plan. */
  plans: Plan[];
  chat: Message[];
  createdAt: string;
  updatedAt: string;
}
```

**Derived, never stored:** `totals(plan)` (low/high sum over unskipped steps plus
materials), `timeline(plan)` (sum of phase days, and total hands-on hours),
`progress(plan)`, `verifiedShare(plan)`. Stored totals drift the moment a step is
edited, and a wrong total is the one error that makes the whole sheet worthless.

## 6. The three routes

All three go through `aiFetch` (`src/lib/ai/provider.ts`), return `null`-shaped
failures rather than throwing, and are `runtime = "nodejs"`.

### `POST /api/bible/plan`

Brief + home base → a whole `Plan`, version 1. JSON-only response, parsed and
cleaned by `cleanPlan()` on the server so a malformed generation degrades to a
readable error instead of a crashed sheet. Model: the hub's general model
(`DEFAULT_MODEL` sentinel, so the owner's front-page pick applies). Every cost
comes back `estimate`. Seconds, not a minute.

### `POST /api/bible/chat`

The owner's message + the current plan (sent as compact JSON, step ids included)
→ `{ reply, ops, why }`.

```ts
export type Op =
  | { op: "set-summary"; summary: string }
  | { op: "replace-step"; stepId: string; step: Step }
  | { op: "add-step"; phaseId: string; afterStepId: string | null; step: Step }
  | { op: "remove-step"; stepId: string }
  | { op: "replace-phase"; phaseId: string; phase: Phase }
  | { op: "add-phase"; afterPhaseId: string | null; phase: Phase }
  | { op: "remove-phase"; phaseId: string }
  | { op: "set-unit"; unit: Plan["unit"] }
  | { op: "set-assumptions"; assumptions: string[] };
```

The UI renders the ops as a diff — *3 steps changed · 1 removed · total
$640–$780 → $330–$410* — with **Accept** and **Discard**. Accept applies the ops
to a clone, bumps `version`, pushes the new plan onto `plans[]`, and leaves every
earlier version readable from a version picker. Discard keeps the reply in the
thread and the plan untouched, so asking "what if I used oak?" costs nothing.

Rules the engine enforces, not the model:

- An op naming an unknown id is **dropped and reported**, never guessed at.
- `done`, `skipped` and `note` survive a `replace-step`: progress and the owner's
  own words are his, not the agent's.
- A material or supplier whose `provenance` is `user` survives too.
- An empty `ops` array is legal — that is an answer, not a failure.

### `POST /api/bible/verify`

The plan's materials and tools + home base → `perplexity/sonar` (a web-reading
model already reachable on the owner's OpenRouter key, the same route
`DANCES_MODEL` uses) → supplier candidates with prices, addresses, phone numbers
and links, each carrying the `source` it was read from.

`mergeVerified()` then: fills empty supplier slots, flips the touched costs to
`verified`, stamps `foundAt`, and **never** overwrites a `user` value or deletes
a supplier the owner added. Anything it could not find stays `estimate` and the
sheet keeps saying ESTIMATE, which is the honest outcome and must not be hidden.

Run per idea from a **Price this for real** button, so a search call is spent
when the owner asks and never on a draft he is still arguing with.

## 7. What this app refuses to do

The scope rule, stated in the system prompt and enforced in the UI:

> A build plan covers making the thing and selling the first one. Materials,
> tools, process, where to buy, what it costs, how long it takes. It does not
> cover company formation, EIN, insurance, business banking, taxes, branding,
> marketing, hiring or scaling.

Those live on a **Beyond the build** shelf at the foot of the plan: nine labelled
buttons, nothing generated until one is pressed, and what comes back lands in
`extras[]` clearly separated from the build itself. The owner asked for this
explicitly, and it is also the difference between a plan he reads and a plan he
closes.

**Legal questions are flagged, not answered.** A step that touches permits,
licensing, resale certificates, food, electrical work or a platform's selling
rules gets `legal: { question, whoToAsk }` and renders as a marked line: what to
check, and who can tell you. The app never asserts what is legal where the owner
lives. This is both the correct engineering boundary and the honest one.

## 8. Storage, offline, failure

`localStorage` is the read path, `saveSynced` pushes to Supabase `app_state`, key
`bible:v1` — the pattern in `src/lib/sync/appState.ts` that every other app here
uses, so the Bible opens instantly, survives offline, and shows up on the phone.
`loadRaw` / `mergeById` / `hiddenSeeds` follow EA World's store exactly, including
remembering a deleted seed so it cannot come back on reload.

With **no AI key configured**: ideas, briefs, hand-written steps, costs, checkbox
progress, notes, totals and the version history all work unchanged. The three
generate buttons render dark with the reason on them. One seeded idea ships with
a complete worked plan — picture frames, the owner's own example, filled in to the
standard the generator is aiming at — so the sheet is never empty and there is
always a reference for what good looks like.

A generation that returns unparseable JSON, a timeout, or a provider with no
credit all surface as a line in the sheet's header saying which thing failed and
what to try. Nothing 500s and no state is lost: the plan before the failed
attempt is still the plan.

## 9. Testing

Vitest files next to the code (`npx vitest run src/lib/bible/`). The pure logic
is where the trust lives, so it is all pure and all tested:

- `ops.test.ts` — every op applied, bad ids dropped not guessed, `done`/`note`/
  `user` provenance preserved across `replace-step`, empty ops legal, version
  bumped exactly once, earlier version left intact.
- `totals.test.ts` — ranges add, skipped steps excluded, mixed currencies
  refused rather than silently summed, materials counted once.
- `verify.test.ts` — `mergeVerified` never overwrites `user`, never drops an
  owner-added supplier, leaves unfound items `estimate`, stamps `foundAt`.
- `clean.test.ts` — a truncated, extra-keyed or wrongly-typed model response
  produces a usable plan or a clean error, never a half-rendered sheet.
- `store.test.ts` — seed/stored merge by id, hidden seed stays hidden.

## 10. Files

```
src/app/apps/financial-bible/page.tsx        ?studio= → shell
src/app/api/bible/plan/route.ts
src/app/api/bible/chat/route.ts
src/app/api/bible/verify/route.ts
src/components/bible/Bible.tsx               shell + rail + home base strip
src/components/bible/plans/IdeaTable.tsx     the vault
src/components/bible/plans/NewIdea.tsx       the brief
src/components/bible/plans/PlanSheet.tsx     phases, steps, totals, timeline
src/components/bible/plans/StepRow.tsx       cost, materials, suppliers, legal
src/components/bible/plans/Agent.tsx         chat + the diff gate
src/components/bible/plans/Beyond.tsx        the nine buttons
src/components/bible/rooms/EmptyRoom.tsx     scout / plays / funding
src/components/bible/bible.css
src/lib/bible/types.ts
src/lib/bible/store.ts                       localStorage + saveSynced
src/lib/bible/ops.ts         + ops.test.ts
src/lib/bible/totals.ts      + totals.test.ts
src/lib/bible/verify.ts      + verify.test.ts
src/lib/bible/clean.ts       + clean.test.ts
src/lib/bible/prompts.ts                     the three system prompts
src/lib/bible/seed.ts                        the picture-frames worked plan
src/lib/bible/rooms.ts                       the rail
```

Plus: one object in `src/lib/catalog.ts`, one slug in `PLUGIN_SLUGS` with its
`WHY` line, one entry in `.claude/launch.json`.

## 11. UI direction

`interactive-web-studio` drives the look, invoked before any component is
written. Not negotiable per the repo's own rule, and the brief for it is: a dense
instrument, not a card grid. The plan sheet is the hero — a long, numbered,
scannable document with the cost total pinned and live, ESTIMATE/VERIFIED legible
at a glance per line, and the agent docked beside it rather than replacing it.
Checking a step off should feel like crossing something out on paper.

## 12. Done means

1. A new idea can be created, generates a plan in under ~20 seconds, and the plan
   reads as something you could act on tomorrow.
2. "Make it cheaper" comes back with an answer *and* a diff whose total is lower,
   and Accept bumps to v2 with v1 still readable.
3. "Price this for real" fills in named suppliers with addresses or links for the
   owner's home base, each stamped with where it came from.
4. Checking off steps survives a reload, a regeneration and an accepted patch.
5. Nothing about LLCs, insurance or marketing appears anywhere until a Beyond
   button is pressed.
6. With `OPENROUTER_API_KEY` removed, the app still opens, still stores ideas,
   and says plainly why the generate buttons are dark.
7. The card appears on Jarvis › App plugins and opens in its own tab.
