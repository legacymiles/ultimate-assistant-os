# Prompt Architect — Design Spec

**Date:** 2026-08-13
**Status:** Approved design → ready for implementation planning
**One-liner:** A prompt-engineer that turns a vague idea into an *amazing*, build-ready prompt through an adaptive interview, then hands off to `gauntlet-loop` — delivered as three surfaces sharing one methodology.

---

## 1. Goal & core principle

Take a broad, vague description of a website or app and, by asking sharp clarifying questions, produce a prompt so good that a coding agent builds something amazing from it. The output then flows into the `gauntlet-loop` skill for adversarial refinement.

**Core product principle — the app is a prompt *factory*, not a builder.** The deliverable is a killer prompt plus a one-click handoff to Claude Code, never an in-app build. Rationale:

- The best builder already exists: Claude Code + the user's own design skills (`interactive-web-studio`, `exploded-showcase`, `webgl-trail-reveal`, `capcut-design`) + `gauntlet-loop`. A web app can fire an API call or two; it cannot run those skills or an agentic loop. In-app "generation" would be a strictly worse Claude Code.
- The gauntlet's "govern the build" pass requires a skill-running agent iterating on real files — impossible inside a web app.
- A prompt is portable, reviewable, editable, and reusable across any agent. Locking the build into the app throws that leverage away.

The **only** exception is a public-demo "instant preview" on the portfolio surface (see §7, Phase 2), explicitly framed as a lightweight taste with the real CTA being "take this prompt to Claude Code."

---

## 2. The three surfaces (build order)

All three implement the **same methodology** (§3). They cannot literally share code — a skill is markdown Claude executes; the apps are TypeScript — so the methodology in §3 is the single source of truth each surface implements.

1. **Phase 1 — `prompt-architect` skill** (this repo, `~/.claude/skills` or plugin). The conversational brain. Interviews the user, produces the prompt, invokes `gauntlet-loop`. Built first because it *defines and proves* the methodology and delivers immediate personal value.
2. **Phase 2 — Blueprint upgrade** (this Assistant OS repo, Next.js). The existing `/apps/blueprint` app upgraded to the same adaptive interviewer + new spec fields + gauntlet handoff.
3. **Phase 3 — Portfolio app** (separate `pod-play-connect` repo, Vite + Supabase edge functions, following the existing Website Redesigner pattern). Public-facing. Needs the repo path at implementation time. Optional instant-preview demo.

**Naming:** skill = `prompt-architect` (descriptive → auto-triggers on "write me a prompt to build X"); app brand stays **Blueprint** in Assistant OS; portfolio app public name TBD (minor open question). Easily changed.

---

## 3. The shared methodology (the crux)

### 3.1 Interview — adaptive rounds

- **Round 1:** read the vague idea, classify kind (website / webapp / workflow), detect vibe. Ask **~3 highest-leverage questions** — the ones whose answers most change what gets built (purpose, primary audience, the one core experience). No yes/no, no filler.
- **Round 2:** read the answers, ask **~2–3 follow-ups** that close the *specific* gaps the answers revealed, **and propose the named quality bar** for confirmation ("I'd hold this to linear.app's polish + igloo.inc's interactivity — right target?"). Also surface the recommended design skill(s) for a quick confirm.

Two rounds is the default ceiling; stop once the picture is sharp enough to write an excellent spec.

### 3.2 Spec structure (extends Blueprint's current `Overview`)

Existing fields kept: `one_liner`, `purpose`, `core_features[]`, `supporting_features[]`, `stack[]`, `open_questions[]`.

**New fields:**
- `quality_bar: string` — the real, named reference(s) the gauntlet will fight to beat (e.g. "linear.app for polish; igloo.inc for interactivity").
- `design_direction: string` — the aesthetic/experience target in one sentence.
- `recommended_skills: { skill: string; why: string }[]` — chosen by the skill-router (§3.3).

### 3.3 Skill-router (vibe → the user's own skills)

Keyword/vibe → recommended skill(s). Lives inline in the skill's markdown and as a shared `skill-router.ts` in the apps.

| Signal in the idea | Recommended skill |
|---|---|
| premium / cinematic / immersive / 3D / "wow" / interactive / playful / game-like / experimental | `interactive-web-studio` |
| product / device / vehicle / gadget teardown, "exploded", inspect parts, labeled callouts | `exploded-showcase` (with `interactive-web-studio`) |
| image reveal / hover-to-reveal / before-after / scanning effect | `webgl-trail-reveal` (with `interactive-web-studio`) |
| editor / timeline / media-tool UI, "CapCut-like" | `capcut-design` |
| redesign an existing URL | `website-redesigner` |
| *always, at the end* | `gauntlet-loop` (quality bar) |

### 3.4 Final build-prompt template

Extends today's `prompt-template.ts`. Sections, in order:

1. `# {one_liner}`
2. `## Objective` — `purpose`
3. `## Design direction & quality bar` **(new)** — `design_direction`; "Hold this to {quality_bar}. Beat it specifically on {axes}."
4. `## Recommended approach` **(new, stripped in portable mode)** — which of the user's skills to use where, with why.
5. `## Context` — type, audience, interview answers.
6. `## Main features` — numbered, each with a `_Done when:_` acceptance line.
7. `## Supporting features` — secondary.
8. `## Tech & constraints` — `stack` + responsive/accessible defaults.
9. `## Open questions to resolve first` — `open_questions`.
10. `## How to work` — restate understanding, ask about ambiguity first, main features first, verify it runs.
11. `## Quality gate` **(new)** — "After a working build, run `gauntlet-loop` against {quality_bar} until it wins."

### 3.5 Portable toggle

Default = ecosystem-aware (names the user's skills). Portable mode strips personal references so the prompt is shareable:
- §4 "Recommended approach" → technique *descriptions* instead of skill names ("build the hero as an immersive WebGL scene…" rather than "use `interactive-web-studio`").
- §11 "Quality gate" `gauntlet-loop` reference → generic "iterate against {quality_bar} until it beats it."

### 3.6 Gauntlet handoff ("both, in sequence")

- **Prompt pass:** after drafting, run `gauntlet-loop` on the *prompt text* against a prompt-quality bar → the final, sharpened prompt.
- **Build pass:** the final prompt carries the §11 Quality gate clause, so the agent runs `gauntlet-loop` on the *built site* against `quality_bar`.
- **Skill:** invokes `gauntlet-loop` directly for the prompt pass; embeds the build pass in the output. One handoff, both passes covered.
- **Apps:** cannot invoke a skill, so they export a **paste-ready** handoff — the final prompt prefixed with a runnable `/gauntlet-loop` line ("Copy for Gauntlet" button). A server-side auto-sharpen pass is possible later but out of v1 scope.

---

## 4. Phase 1 — `prompt-architect` skill (detailed)

A flexible process skill with a fixed checklist. Flow:

1. **Trigger** — user asks to write/engineer a prompt to build a site or app, or invokes the skill by name.
2. **Intake** — read the vague idea; classify kind; detect vibe via the skill-router (§3.3).
3. **Round 1** — ask ~3 highest-leverage questions (§3.1).
4. **Round 2** — ask ~2–3 gap-closing follow-ups; propose and confirm the `quality_bar`; surface recommended skill(s).
5. **Synthesize** — build the spec (§3.2); show a compact summary for a sanity check.
6. **Assemble** — render the final build prompt from the template (§3.4), ecosystem-aware unless the user asked for portable (§3.5).
7. **Gauntlet handoff** — invoke `gauntlet-loop` for the prompt pass (§3.6); present the sharpened final prompt, with the build-pass Quality gate embedded.
8. **Portable on request** — if the user says "make it shareable/portable," re-render stripped.

Skill files: `SKILL.md` (the flow + embedded methodology, incl. the skill-router table and prompt template), optional `references/` for the full template and examples. Description tuned to trigger on "write a prompt to build…", "prompt engineer this idea", "turn my idea into a Claude Code prompt", etc.

---

## 5. Phase 2 — Blueprint upgrade (concrete changes)

- `src/lib/blueprint/types.ts` — add `quality_bar`, `design_direction`, `recommended_skills` to `Overview`; add a `portable` flag to the request/`Brief`.
- `src/app/api/blueprint/route.ts` — add a **round-2 clarify** stage (takes brief + round-1 answers → gap-closing questions + proposed quality bar); extend `synthesize` to fill the new fields; extend `prompt` to inject the new sections, honor `portable`, and append the gauntlet clause.
- `src/lib/blueprint/skill-router.ts` — **new**; the §3.3 mapping as shared logic.
- `src/lib/blueprint/prompt-template.ts` — add §3.4 sections 3, 4, 11; portable stripping (§3.5); gauntlet clause.
- `src/lib/blueprint/heuristics.ts` — offline versions of round-2 questions, a quality-bar guess, and keyword-based skill routing.
- `src/app/apps/blueprint/page.tsx` — round-2 UI; editable quality bar; recommended-skill chips; portable toggle; **"Copy for Gauntlet"** button.

Existing 3-stage AI-with-heuristic-fallback architecture is preserved.

---

## 6. Phase 3 — Portfolio app (pod-play-connect)

Public app mirroring the existing Website Redesigner pattern (Vite SPA + Supabase edge function calling the AI Gateway). Implements the same methodology (§3). Needs the `pod-play-connect` repo path at implementation time. Public name TBD.

---

## 7. Non-goals / YAGNI

- **In-app site building** — out of scope by principle (§1).
- **Instant-preview demo** — portfolio surface only, Phase 2 flourish, explicitly a lightweight taste; not part of the core.
- **Server-side prompt auto-sharpen** in the apps — deferred; the paste-ready `/gauntlet-loop` handoff covers it.
- Deep three-way sync tooling — the methodology doc is the source of truth; surfaces are implemented to match, not code-shared.

---

## 8. Open questions

1. Portfolio app public name (and whether the Assistant OS app rebrands from "Blueprint" to match).
2. Exact prompt-quality bar the skill uses for the gauntlet *prompt pass* (e.g. "a senior prompt engineer's brief").
3. Whether Round 2 should ever expand to a Round 3 for very large/ambiguous ideas, or hard-stop at two.
