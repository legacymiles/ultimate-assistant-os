# Blueprint — Idea → Overview → Optimized Claude Code Prompt

**Status:** Approved design (2026-07-11)
**App slug:** `/apps/blueprint`
**Category:** `AI`
**Type:** New app in the Ultimate Assistant OS hub

---

## 1. Purpose

Blueprint helps a user turn a raw, half-formed idea for a website / web app /
workflow into a **clear, structured overview** — a one-liner, a purpose, a set
of **core features** and **supporting features** — and then into a **single
optimized prompt** ready to hand to an agent like Claude Code.

The goal is clarification and completeness: by forcing the idea through an
editable overview *before* anything is generated, every important feature is
captured and nothing is forgotten. The final prompt is the payoff; the
structured overview is the thing that makes the prompt good.

This is the front end of the same concept that powers **Projects Timeline**
(core vs supporting features, an AI analyst that produces a one-liner + overview
+ feature lists). Blueprint reuses that vocabulary and can hand a finished
overview straight into Projects Timeline as a real, living project.

## 2. Decisions (locked)

| Decision | Choice |
| --- | --- |
| Engine | **AI-powered with heuristic fallback** — mirrors the existing `engine: "ai" \| "heuristic"` pattern. No API key ⇒ every stage silently uses its heuristic and the app stays fully usable. |
| Flow shape | **Guided intake → editable overview canvas → one-click prompt.** The user reviews and refines the full feature list before anything is generated. |
| Deliverable | **Prompt + exportable spec + Save to Projects Timeline** (the full loop). |
| Name / placement | **Blueprint**, category **AI**, one new entry in `catalog.ts`. |
| Intake types | Website / Web app / Workflow-automation. |

## 3. User flow — four progressive panels, one screen

1. **Intake.** A large "What do you want to build?" textarea, plus two light
   selectors — *Type* (Website / Web app / Workflow-automation) and *Who's it
   for* (free text or quick presets). Primary action: **Clarify**.
2. **Clarify.** AI returns 3–5 sharp, high-leverage questions (stage
   `clarify`). Each is answerable inline or skippable. Primary action: **Build
   overview**.
3. **Overview canvas** (the heart of the app). AI synthesizes (stage
   `synthesize`) the brief + answers into a fully **editable** structure:
   - one-liner (single line)
   - purpose (short paragraph)
   - **Core features** — the features that define what the thing *is*
   - **Supporting features** — enhancements, polish, quality-of-life
   - optional *Suggested stack* and *Open questions*

   Every feature can be added, edited, deleted, reordered, and moved between
   Core ↔ Supporting. Nothing is generated until the user is satisfied here.
   Primary action: **Generate**.
4. **Deliverable.** Generate (stage `prompt`) produces the optimized Claude
   Code prompt. Three actions:
   - **Copy prompt**
   - **Copy / Download spec** (`.md` of the overview)
   - **Save to Projects Timeline**

Panels are progressive: earlier panels remain visible/collapsible so the user
can step back and edit. State lives in the client for the whole session.

## 4. Data shapes — `src/lib/blueprint/types.ts`

```ts
export type BlueprintKind = "website" | "webapp" | "workflow";

export interface Brief {
  idea: string;
  kind: BlueprintKind;
  audience: string;
  answers: { question: string; answer: string }[];
}

export interface ClarifyingQuestion {
  id: string;
  question: string;
  hint?: string;
}

export interface OverviewFeature {
  title: string;
  description: string;
}

export interface Overview {
  one_liner: string;
  purpose: string;
  core_features: OverviewFeature[];
  supporting_features: OverviewFeature[];
  stack?: string[];
  open_questions?: string[];
}

export interface GeneratedPrompt {
  prompt: string;
  engine: "ai" | "heuristic";
}
```

`Overview` deliberately mirrors `AnalystResult` (`one_liner`, `overview`/
`purpose`, `core_features`, `supporting_features`) so mapping into a Timeline
`Project` is trivial.

## 5. AI stages — `src/app/api/blueprint/route.ts`

A single route dispatches on a `stage` field in the POST body. All three stages
route through one shared gateway helper and each has a heuristic fallback,
matching `regenerate/route.ts`:

- Gateway: `https://ai-gateway.vercel.sh/v1/chat/completions`
- Key: `process.env.AI_GATEWAY_API_KEY` (absent ⇒ heuristic)
- Model: `process.env.AI_MODEL || "anthropic/claude-sonnet-4-6"`
- `response_format: { type: "json_object" }` for `clarify` and `synthesize`
- `AbortSignal.timeout(45_000)`, `export const runtime = "nodejs"`,
  `export const maxDuration = 60`
- On any gateway error: log, return the heuristic result.

**Stage `clarify`** — Body `{ stage: "clarify", brief: Brief }` → returns
`ClarifyingQuestion[]` (3–5). The model is told to ask only the highest-leverage
questions needed to design the thing well.
*Heuristic:* a small fixed question set keyed off `brief.kind`.

**Stage `synthesize`** — Body `{ stage: "synthesize", brief: Brief }` →
returns `Overview` (JSON-mode, normalized/hardened exactly like
`normalizeFeatures` in `regenerate/route.ts`).
*Heuristic:* sentence/keyword extraction that produces a first-draft one-liner,
purpose, and a naive core/supporting split the user then edits.

**Stage `prompt`** — Body `{ stage: "prompt", overview: Overview, brief: Brief }`
→ returns `GeneratedPrompt`. Produces a **structured Claude Code prompt** with:
1. Objective (from the one-liner)
2. Context — what it is, who it's for, why
3. **Main features** — numbered, each with brief acceptance criteria
4. **Supporting features** — clearly marked as secondary / nice-to-have
5. Stack & constraints (from `stack`, or "you choose, and justify")
6. Non-goals / out of scope
7. An explicit instruction to brainstorm/ask before assuming when ambiguous

*Heuristic:* a deterministic template assembler in `prompt-template.ts` that
builds the same structure from the `Overview` with zero AI. This means the
"Generate" button always works offline.

## 6. Save to Projects Timeline

Reuses the existing `Repo` interface directly (no new persistence layer):

```ts
const project = await repo.createProject({
  name: overview.one_liner.slice(0, 60),
  one_liner: overview.one_liner,
  overview: overview.purpose,
});
await repo.setFeatures(project.id, [
  ...overview.core_features.map(f => toFeature(f, project.id, "core")),
  ...overview.supporting_features.map(f => toFeature(f, project.id, "supporting")),
]);
await repo.addKnowledge(project.id, {
  kind: "idea",
  title: "Claude Code build prompt",
  content: generated.prompt,
});
```

The overview becomes a real Timeline project; the generated prompt is preserved
in its Knowledge Inbox. A success state links through to
`/apps/projects-timeline`.

## 7. File layout

```
src/app/apps/blueprint/page.tsx        — client shell + panel state machine
src/app/api/blueprint/route.ts         — stage dispatch + shared gateway helper
src/components/blueprint/
  IntakePanel.tsx
  ClarifyPanel.tsx
  OverviewCanvas.tsx
  FeatureCard.tsx        — editable title/description, delete, move core↔supporting
  DeliverablePanel.tsx
src/lib/blueprint/
  types.ts
  heuristics.ts          — clarify + synthesize fallbacks
  prompt-template.ts     — deterministic prompt assembler (prompt fallback + shape)
  client.ts              — typed fetch wrapper for the three stages
src/lib/catalog.ts       — + one PROJECTS entry (slug "blueprint")
```

## 8. Resilience & UX details

- **No API key:** every stage uses its heuristic; UI shows a subtle
  "offline draft" hint, not an error.
- **Gateway error / timeout:** log to console, fall back to heuristic, continue.
- **Empty / too-short idea:** Clarify button disabled until there's meaningful
  input.
- **Reduced motion:** `prefers-reduced-motion` disables panel-transition motion.
- **Editing after generate:** changing the canvas invalidates the generated
  prompt (prompts the user to re-generate) so the prompt never silently drifts
  from the overview.

## 9. Testing approach

- **Heuristics (pure functions):** unit-test `heuristics.ts` and
  `prompt-template.ts` — given a `Brief`/`Overview`, assert the shape and key
  content of questions / overview / prompt. These run without any API key.
- **Route dispatch:** test that `/api/blueprint` returns heuristic output when
  `AI_GATEWAY_API_KEY` is unset, for each stage.
- **Timeline mapping:** test the `Overview → Project + Feature[] + Knowledge`
  mapping against `LocalRepo` (core/supporting groups preserved, prompt stored).

## 10. Out of scope for v1 (YAGNI)

- Auth / accounts / multi-user.
- Saved draft history *inside* Blueprint (session-scoped canvas; persistence is
  the Save-to-Timeline action).
- Multiple prompt variants (MVP-first vs full-build) — easy fast-follow.
- Streaming responses — a spinner per stage is enough for v1.
