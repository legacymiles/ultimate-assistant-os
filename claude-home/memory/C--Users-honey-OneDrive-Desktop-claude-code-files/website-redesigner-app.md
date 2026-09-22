---
name: website-redesigner-app
description: Native Website Redesigner app in the OS at /apps/website-redesigner (Next.js port of the redesign edge function)
metadata: 
  node_type: memory
  type: project
  originSessionId: bfe65104-6916-4b3a-b678-ae8ceaa53e2f
  modified: 2026-09-19T21:30:00.000Z
---

**Website Redesigner** is now a native app in the [[ultimate-assistant-os-portfolio]] hub at `/apps/website-redesigner` (added 2026-08-14). Paste a URL → server scrapes the real page → 3 redesign directions (restrained/expressive/experimental), each driven by a design skill and named a real site to beat, each with a paste-ready functionality-preserving build prompt. It's the OS app version of [[website-redesigner-skill]].

Files:
- `src/lib/redesigner/engine.ts` — scrape (regex HTML extraction, native `fetch`), heuristic 3-preset fallback, `templatePrompt`, types, `DEFAULT_SKILLS`.
- `src/app/api/redesign/route.ts` — Next.js `nodejs` route; AI Gateway path (`process.env.AI_GATEWAY_API_KEY`, `AI_MODEL`) + heuristic fallback. Ported from pod-play-connect's Deno `redesign` function (dropped the Supabase rate-limit).
- `src/components/redesigner/Redesigner.tsx` + `src/app/apps/website-redesigner/page.tsx` — UI in the OS design system (Icon set + ink/brand/line/panel tokens).

Verified end-to-end on the offline heuristic path (live-scraped linear.app → 3 directions, no console errors). The older pod-play-connect `/redesign` page ([[redesigner-portfolio-app]]) still exists but the OS is now the portfolio home.

**2026-09-19:** roster (src/lib/redesigner/design-skills.json) = all 30 website design skills incl. frontend-design, the full taste-skill pack, ui-ux-pro-max, theme-factory, web-artifacts-builder, web-design-guidelines, clone-site/remix-site/shader-extract. Entries are keyed by FOLDER name (what the Skill tool invokes) — taste-skill frontmatter names like design-taste-frontend caused 7 duplicates once. Picker scrolls (max 60vh). scripts/sync-design-skills.mjs (runs from ~/.claude/settings.json hooks) now pushes the roster to origin/main via a throwaway worktree; before, it committed onto whatever branch was checked out and the push silently failed, so the live site never got new skills. Owner expects EVERY web design skill in this picker.

**2026-09-19 — "Experimental WebGL" reskin (design layer only).** UI rebuilt in the direction's own palette (#050505 / #F5F5F5 / #FF4D2E), scoped under `.rdx` in `src/components/redesigner/redesigner.css` so the hub's indigo tokens are untouched. New files: `FingerprintField.tsx` (raw WebGL fullscreen quad — NOT R3F, keeps the page at 121 kB First Load), `interactions.tsx` (cursor/magnetic/tilt/reveal, all rAF, all no-op on coarse pointer + reduced motion), `lib/redesigner/fingerprint.ts` (+ test). Fonts via `next/font/google` in page.tsx (Archivo Black / Space Grotesk / JetBrains Mono) — first use of next/font in this repo; `next build` confirmed it resolves. Behaviour, state and the POST to `/api/redesign` are byte-for-byte unchanged.

**The gotcha worth remembering:** pointing the Redesigner (or any scraper) at the hub's OWN deployed apps returns the LOGIN PAGE, because of the app-level gate in [[hub-deployment-supabase]]. The scrape comes back as title "Projects Timeline" with `[form] fields: email, password`, `[auth]`, and a false-positive `[cart]`. Any build prompt generated that way describes a login screen, not the app — for the owner's own apps, redesign from the repo source instead and tick "This is my own site".
