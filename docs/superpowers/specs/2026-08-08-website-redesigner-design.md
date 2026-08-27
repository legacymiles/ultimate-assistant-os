# Website Redesigner — URL → Redesign Options → Functionality-Preserving Build Prompt

**Status:** Superseded by the shipped implementation (2026-08-08). See "Revision" below.
**App slug:** `/apps/website-redesigner`
**Category:** `Websites`
**Type:** New app in the Ultimate Assistant OS hub

> ## Revision (2026-08-08) — pivot to a skill + the live portfolio
>
> After the design below was approved, the direction changed on the same day:
> 1. **Shipped as a skill** — `~/.claude/skills/website-redesigner/` (SKILL.md +
>    references/directions.md) encodes the full methodology for use in Claude Code.
> 2. **Shipped a live public tool in the portfolio** — not the Next.js hub, but
>    **pod-play-connect** (the Vite SPA):
>    - `supabase/functions/redesign/index.ts` — edge function: fetches the URL, extracts
>      content + a functionality inventory, calls the AI Gateway (key stays a Supabase
>      secret), returns an analysis + 3 directions each with a ready build prompt. Heuristic
>      fallback + fail-open IP rate-limit.
>    - `supabase/migrations/…_redesign_usage.sql` — optional rate-limit table.
>    - `src/pages/Redesign.tsx` + public `/redesign` route in `src/App.tsx`.
>    - A "Website Redesigner" card in the "Apps I've Built" section of `src/pages/Landing.tsx`.
>    - `[functions.redesign] verify_jwt = false` in `supabase/config.toml` (public tool).
>
> The "visual concept card" is rendered client-side from the AI's palette/type tokens
> (cheaper + safer for a public endpoint than AI-generated hero HTML). Deploy is manual:
> `supabase functions deploy redesign` + `supabase secrets set AI_GATEWAY_API_KEY=…`.
>
> The sections below are the original hub-app design, kept for reference.

---

## 1. Purpose

Website Redesigner takes any URL and produces **multiple redesign options** for it,
then hands the user a complete, paste-ready **Claude Code build prompt** that rebuilds
the site with a new visual design while **keeping the original functionality the same**.

Each redesign option is shown as a **visual concept card**: a rendered hero mockup built
from the *real* page content, direction notes (palette, typography, layout, motion), a
named reference site "to beat," and the **design skill** that powers it. The user picks
one; the app writes the build prompt for that direction.

The app fits the hub's core thesis — *turn X into a perfect build prompt* (Blueprint,
Soundprint, Seedance) — applied to redesigning existing sites. The heavy in-app work is
**analysis + design direction + visual proof**; the actual rebuild is delegated to Claude
Code, which is the only thing that can genuinely preserve functionality (especially on the
user's own source).

## 2. The "any URL vs. mine" reality (locked understanding)

| Layer | Any public URL | The user's own sites |
| --- | --- | --- |
| Analyze + redesign direction + build prompt | ✅ Works | ✅ Works, richer |
| Genuinely working redesign, same functionality | Front-end reconstruction + behavior spec (their backend/auth/DB aren't reproducible from a scrape) | ✅ Real — the prompt edits the actual source, keeping all logic/handlers/API calls; only the design layer changes |

The distinction is **encoded in the generated prompt**, not enforced by the app:
- **Own site** → "edit the existing source at `<path>`, preserve all logic; restyle only."
- **Any URL** → "recreate the front-end and these behaviors under the new design."

Because the user's projects already store prompts/overviews (Projects Timeline, Blueprint,
Skills Library), the redesigner can enrich its analysis of *the user's own* sites for a far
more functionality-accurate redesign than it can for a stranger's URL.

## 3. Decisions (locked)

| Decision | Choice |
| --- | --- |
| Output | **Multiple redesign options** (default 3) → pick one → **functionality-preserving build prompt**. |
| Option fidelity | **Visual concept card**: rendered hero mockup (from real content) + direction notes + driving skill. Not a full clickable rebuild (out of scope). |
| Skills source | **Both** — auto-pull the user's synced Skills Library **and** paste/add one-off skills + toggle which are "in play." App auto-picks a fitting skill per option; user can override per card. |
| Engine | **AI-powered (AI Gateway) with a deterministic heuristic fallback** — mirrors the hub's `engine: "ai" \| "heuristic"` pattern. No API key ⇒ fully usable offline. |
| Original-site display | Try iframe embed; on `X-Frame-Options`/CSP block, gracefully fall back to the extracted analysis card + "open original" link. No headless screenshotting in v1. |
| Name / placement | Working title **"Website Redesigner"**, category **Websites**, one new entry in `catalog.ts`. |

## 4. User flow

```
Paste URL ──▶ Analyze ──▶ 3 redesign option cards ──▶ pick one ──▶ Build prompt
 + skills                  (hero mockup + notes           (+ save to
   in play                  + driving skill, each)         Projects Timeline)
```

1. **Intake.** URL input, plus a Skill Picker to toggle which design skills are "in play"
   (defaults to a sensible auto-selection of the user's synced skills). Optional free-text
   "anything specific you want" field. Primary action: **Analyze**.
2. **Analysis.** Server fetches the page and extracts content, structure, current design
   tokens, and a **functionality inventory** (every form, button, search, auth, cart,
   filter, media widget — what the site *does*). Shown in an Analysis panel next to the
   original (iframe or fallback). JS-heavy SPAs that return little HTML are flagged
   low-confidence with an option to paste a short description to enrich it.
3. **Options.** AI generates **3 distinct redesign directions**, each an **OptionCard**:
   rendered hero mockup (sandboxed iframe), palette/type/layout/motion notes, a named
   reference "site to beat," and the driving skill (with an override dropdown that
   re-renders that card). A **Regenerate / more** button produces fresh takes.
4. **Deliverable.** Picking an option generates the paste-ready **build prompt**. Actions:
   **Copy prompt**, **Copy/Download spec** (`.md`), **Save to Projects Timeline**.

## 5. Architecture (follows the hub pattern)

```
src/app/apps/website-redesigner/page.tsx      — app UI (client)
src/app/api/website-redesigner/route.ts       — analyze + generate (AI Gateway + fallback)
src/lib/website-redesigner/
  types.ts            — Analysis, FunctionalityItem, RedesignDirection, InPlaySkill, ...
  client.ts           — front-end calls to the API + localStorage session/history
  analyze.ts          — fetch URL + AI/heuristic extraction (content, tokens, inventory)
  directions.ts       — generate N redesign directions + hero HTML per direction
  prompt-template.ts  — assemble the final functionality-preserving build prompt
  heuristics.ts       — offline fallback (DOM parse + preset palette/type library + templates)
  skills.ts           — source/merge auto (Skills Library) + manually added skills
src/components/redesigner/
  UrlBar.tsx • SkillPicker.tsx • AnalysisPanel.tsx • OptionCard.tsx
  HeroPreview.tsx (sandboxed iframe srcdoc) • PromptOutput.tsx
```

One entry added to `PROJECTS` in `src/lib/catalog.ts`:
`{ slug: "website-redesigner", title: "Website Redesigner", tag: "URL → redesign options",
category: "Websites", status: "live", appUrl: "/apps/website-redesigner", iconStyle + hue }`.

## 6. Data shapes (core)

```ts
type FunctionalityItem = {
  kind: "nav" | "form" | "search" | "auth" | "cart" | "filter" | "media" | "cta" | "other";
  label: string;          // e.g. "Newsletter signup form"
  detail: string;         // fields / target / behavior to preserve
};

type Analysis = {
  url: string;
  title: string;
  summary: string;
  sections: string[];              // page structure, in order
  content: Record<string, string>; // extracted real copy (headline, subhead, ctas, ...)
  currentTokens: { colors: string[]; fonts: string[] };
  functionality: FunctionalityItem[];
  confidence: "high" | "low";      // low ⇒ JS-heavy/blocked; prompt user to enrich
  engine: "ai" | "heuristic";
};

type RedesignDirection = {
  id: string;
  name: string;                    // "Editorial Brutalist", "Calm Minimal", ...
  pitch: string;                   // one-line vibe
  drivingSkillId: string;          // which in-play skill powers it
  palette: string[];
  typography: { heading: string; body: string };
  layout: string;                  // layout notes
  motion: string;                  // motion notes
  referenceBar: string;            // named site to beat (gauntlet-loop style)
  heroHtml: string;                // self-contained HTML/CSS for the hero mockup
};

type InPlaySkill = {
  id: string;
  name: string;
  description: string;
  body: string;                    // the skill prompt
  source: "library" | "manual";
  enabled: boolean;
};
```

## 7. Skills system ("both")

- **Auto**: read the user's synced skills the same way Skills Library does (its
  Supabase/localStorage store and/or `/api/skills/scan`). No re-adding.
- **Add / toggle**: paste a skill's markdown to register a one-off (frontmatter → name +
  description, body → prompt), stored in localStorage (and Supabase if configured). Toggle
  which skills are enabled for this redesign.
- **Auto-pick**: each direction is matched to the best-fitting *enabled* skill; the card's
  dropdown lets the user override, which re-generates that direction with the chosen skill.

## 8. The build prompt (output)

A complete, paste-ready Claude Code prompt containing, in order:
1. Target (URL, and — for the user's own site — the source path).
2. **Functionality inventory to preserve exactly** (rendered from `Analysis.functionality`).
3. The chosen design direction + tokens (palette, type, layout, motion).
4. **Skill invocation** of the driving skill (e.g. "Use the interactive-web-studio skill").
5. A gauntlet-loop-style **"beat this reference site"** clause using `referenceBar`.
6. The mine-vs-any clause (edit real source vs. reconstruct front-end + behaviors).

## 9. AI + offline fallback

- **AI path** (`AI_GATEWAY_API_KEY` set): powers extraction, functionality inventory,
  direction generation, hero HTML, and prompt assembly.
- **Heuristic path** (no key): DOM parse for content/tokens/inventory; directions built
  from a preset palette/typography library keyed off the detected tokens; templated hero
  filled with real content; templated prompt. The app stays fully usable offline, matching
  every other app in the hub.

## 10. Out of scope for v1 (YAGNI)

- Full clickable, multi-page rendered redesigns.
- Live headless screenshotting of arbitrary sites.
- Actually deploying or hosting the redesigned site.

The app produces **direction + visual proof + prompt**; Claude Code performs the real
rebuild.

## 11. Open risks / honest constraints

- **Iframe blocking**: many sites forbid framing; the original panel falls back to the
  analysis card. Accepted for v1.
- **SPA scrape thinness**: JS-rendered sites return little HTML to a server fetch; handled
  via low-confidence flag + optional user-provided description.
- **Hero HTML safety**: generated hero markup renders in a **sandboxed** iframe (`srcdoc`,
  no same-origin) to prevent script/style leakage into the app.
