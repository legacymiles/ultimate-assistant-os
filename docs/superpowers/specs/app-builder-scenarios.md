# App Builder: scenarios, plan check and spec deltas

**Status:** draft for the owner · 2026-11-12
**Source of the ideas:** OpenSpec (openspec.dev): requirement + WHEN/THEN scenario format, `validate`, specs vs change deltas. Vitest is already the repo's test runner (`vitest run`), so this spec only uses it, it does not add anything new.
**Touches:** `src/lib/app-builder/` (types, engine, route prompt), `src/components/app-builder/` (feature card), Website Redesigner hand-off (`fromRedesigner.ts`, `redesignBrief.ts`), client edits (`clientEdit.ts`).

---

## The problem, in the code as it is today

A planned feature today is `title` + `detail` + `why` (`types.ts` › `Feature`). Nothing in it says how
anyone would know the feature works. The consequences show up downstream:

1. **Every ticket gets the same acceptance criteria.** `featureTickets()` writes "works end to end on a
   390 px phone and on desktop" plus two checklist lines for *every* feature. A login form and a
   pricing table get identical tests. That is where "the planning is not good" turns into "the build is
   not what I meant".
2. **The judge is app-wide, not feature-wide.** `Understanding.judge` holds 2–5 lines for the whole app.
   A feature can be built badly and still pass every one of them.
3. **The brief asks for proof it never defines.** `masterPrompt()` demands "every accepted feature has a
   test or a recorded click-through", but never says *what* that test must show, so the build agent
   invents it, which means grading its own work.
4. **Nothing checks the plan before Build it.** A feature list with a vague "Make it user-friendly" in
   it hands off the same as a sharp one.
5. **Redesigns and client edits have no "must still work" list.** `RedesignSource.functionality` lists
   what the site does, but it reaches the brief as prose, not as checks that must still pass afterwards.

## The change, in four parts

### 1. Every feature carries scenarios (WHEN / THEN)

```ts
// types.ts
export interface Scenario {
  id: string;            // "f3.s1"
  name: string;          // "Visitor sends a valid enquiry"
  given?: string;        // optional starting state: "a logged-out visitor on /contact"
  when: string;          // "they submit name, email and a message"
  then: string;          // "they see 'Thanks — we'll reply within a day' and the owner gets an email"
  /** How it is proven: a unit test (Vitest), a browser test (Playwright), or a recorded click-through. */
  proof: "unit" | "browser" | "manual";
}

export interface Feature {
  // …existing fields…
  /** At least one per accepted feature. The plan check (part 2) enforces it. */
  scenarios?: Scenario[];
}
```

- **Feature prompt** (`route.ts`, the `features` action): each feature returns 1–3 scenarios. Rules
  for the model: a THEN must be something a person or a test can *see*: text on screen, a row in a
  table, an email sent, a redirect. Never "works well", "is fast", "feels premium".
  Include one failure scenario for any feature that takes input (empty, wrong, too long).
- **Offline templates** (`offlineFeatures`): each `Template` gains a `scenarios` array with `{name}`
  placeholders filled by `fill()`, the same way `detail` and `why` are today.
- **`coerceFeatures`**: keep scenarios whose `when` and `then` are both ≥ 8 characters; drop the rest;
  cap at 3; derive `proof` from wording when missing (sees / clicks / page → `browser`, else `unit`).
- **Chat ops**: `FeatureOp` `edit` accepts `scenarios`; a new `{ op: "scenario", id, scenario }`
  adds one. "Add a test for f3 where the email is wrong" should just work.
- **UI**: the feature card shows scenarios as two short lines (WHEN … / THEN …) under the detail,
  editable in place. Owner-written scenarios get `source: "you"` treatment and are never rewritten.

### 2. The plan check runs before Build it

A pure function in a new `src/lib/app-builder/planCheck.ts`, the App Builder version of
`openspec validate`:

```ts
export interface PlanFinding { featureId?: string; level: "block" | "warn"; text: string; fix?: string }
export function planCheck(p: BuilderProject): PlanFinding[];
```

| Rule | Level | Plain-English message |
|---|---|---|
| Accepted feature has no scenario | block | "f4 Saved searches has no way to tell it works. Add a WHEN/THEN." |
| A THEN uses a vague word (`works`, `properly`, `seamless`, `intuitive`, `fast`, `nice`, `user-friendly`…) | block | "f2's THEN says 'works smoothly', which nobody can check. Say what appears." |
| A feature takes input but has no failure scenario | warn | "f1 has a form but no 'wrong input' case." |
| Two accepted features have the same WHEN | warn | "f3 and f7 describe the same moment. Merge them?" |
| A redesign's `functionality` item has no matching keep-scenario (part 4) | block | "The current site's newsletter signup isn't checked after the redesign." |
| Fewer than 2 judge lines | warn | (existing fallback in `understand()` already pads this; keep it) |

- **Build it** stays enabled with only warnings; blocks disable it and show the list with a one-tap
  **Fix with AI** that sends the findings into the chat as a message (the chat route already turns a
  message into ops).
- Rules are data, not regex soup scattered through the UI, so the same list prints in the brief.

### 3. Scenarios flow into the brief, the tickets and the gate

- **`featureTickets()`**: the `## Acceptance Criteria` block becomes the feature's own scenarios
  (`- [ ] WHEN … THEN …`), followed by the checklist lines. The generic "390 px phone" line stays as
  the last item, since it's still true, but it no longer stands in for the scenarios.
- **`masterPrompt()`**: each accepted feature lists its scenarios under it. `<success_criteria>`
  replaces "every accepted feature has a test or a recorded click-through" with:
  *"Every scenario below has a test that names its id (e.g. `it("f3.s1 visitor sends a valid enquiry")`):
  Vitest for `unit`, Playwright for `browser`, a screenshot pair for `manual`. Report the table
  scenario id → test → pass/fail."*
- **`queueText()`**: under the 4,000-character cap, scenarios go in as one line per feature
  (`f3: s1 valid enquiry · s2 wrong email`) and shrink before feature detail does. Feature names
  and scenario names are the plan's skeleton; detail is the flesh.
- **The gate** (`build.ts` › `checkedAndPassed` and the report the build posts back): a build is
  only "checked and passed" when the report's scenario table covers every scenario id. Missing ids
  show on the App Builder panel as "3 of 11 scenarios have no test". That's the honest version of
  "is it done?".

### 4. Specs are the current truth; edits are deltas

This is the OpenSpec idea with the biggest payoff for *websites*, because they get edited for years.

- **The app's spec** is its accepted features + scenarios at the moment it shipped. Saved on the
  project (`BuilderProject.spec`, set when the build reports done) and, for hub apps, written into
  `docs/apps/<slug>.md` under a `## Scenarios` heading so Projects Timeline and every future tool see it.
- **A redesign** (`p.redesign`) starts its feature list with **keep-scenarios**: one per
  `RedesignSource.functionality` item ("WHEN a visitor submits the footer newsletter form THEN they
  are subscribed"), marked `kind: "core"`, accepted, and not deniable without a reason. They are the
  regression suite for "only the look changes".
- **A client edit** (`p.edit`) is written as a delta against the spec, not a free brief:

  ```
  ADDED     f12 Gallery lightbox: s1, s2
  MODIFIED  f3 Contact form: s2 now "THEN a WhatsApp link shows under the form"
  REMOVED   f7 Live chat (reason: client cancelled Intercom)
  ```

  `editMasterPrompt()` (`clientEdit.ts`) sends the delta plus the untouched scenarios as "must still pass". REMOVED needs
  a reason, same as OpenSpec.
- **On merge**, the delta folds into the spec (OpenSpec's "archive"), so the next edit diffs against
  the real current site, not the original plan.

## Out of scope

- Installing the OpenSpec CLI or adding an `openspec/` folder. It would be a second home for plans
  that already live in App Builder, `docs/apps/` and this folder.
- Generating the test code inside App Builder. The build agent writes the tests; App Builder only
  defines what they must prove and checks the report covers them.
- Changing depth rules, the skills pipeline or the mockup bake-off.

## Order of work (each one ships on its own)

1. **Scenarios on features**: type, prompt, `coerceFeatures`, offline templates, card UI, chat ops.
   Tests: coerce keeps/drops scenarios correctly; offline list gives every template ≥ 1 scenario;
   `edit` op updates scenarios; owner-written scenarios survive a regenerate.
2. **Plan check**: `planCheck.ts` + panel + Fix with AI. Tests: one per rule, both levels, and that
   Build it is disabled only on `block`.
3. **Brief, tickets, gate**: the three writers and the coverage count. Tests: tickets list the
   feature's own scenarios; `queueText` stays ≤ `QUEUE_LIMIT` with 16 features × 3 scenarios;
   `checkedAndPassed` is false when an id is missing from the report.
4. **Spec + deltas**: `spec` on the project, keep-scenarios for redesigns, delta format for client
   edits, fold-on-merge, `docs/apps/<slug>.md` section. Tests: redesign with 4 functionality items →
   4 keep-scenarios; delta with REMOVED and no reason is blocked; fold produces the expected spec.

## How we'll know it worked

- Every new App Builder build ships with a scenario-id → test table in its report, and the panel shows
  coverage. Target: 100 % of `block`-level checks pass before hand-off, ≥ 90 % scenario coverage
  in the build report.
- Client edits on a site built after this change name exactly which scenarios they add, change or
  remove, and the untouched ones still pass.
- Fewer "that's not what I meant" round trips per build (count the chat edits after the first
  Client Review version, before vs after).
