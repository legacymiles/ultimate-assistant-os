---
name: redesigner-portfolio-app
description: Website Redesigner public tool added to the pod-play-connect portfolio (Vite + Supabase edge function)
metadata: 
  node_type: memory
  type: project
  originSessionId: 94d9b0e9-9e98-44b4-a1c8-3b5096015019
  modified: 2026-08-14T19:35:34.556Z
---

**NOTE (2026-08-14):** the portfolio home for Website Redesigner is now the OS-native [[website-redesigner-app]] (`/apps/website-redesigner`), since the OS is the portfolio ([[ultimate-assistant-os-portfolio]]). This pod-play-connect `/redesign` page still exists but is the secondary copy.

Website Redesigner is a public page in the [[portfolio-repo]] (pod-play-connect Vite SPA), built 2026-08-08. Visitors type a URL and get an analysis + 3 redesign directions, each with a paste-ready build prompt. It's the app version of [[website-redesigner-skill]].

Files (in `C:\Users\honey\OneDrive\Desktop\pod-play-connect`):
- `supabase/functions/redesign/index.ts` — Deno edge function: fetches the URL (regex HTML extraction, no DOM), builds a functionality inventory, calls the Vercel AI Gateway (`https://ai-gateway.vercel.sh/v1/chat/completions`, secret `AI_GATEWAY_API_KEY`, `AI_MODEL` default `anthropic/claude-sonnet-4-6`) → returns `{analysis, directions[], engine}`. Heuristic fallback with no key. Fail-open IP rate-limit (20/hr) using the service-role client.
- `supabase/migrations/20260808185214_redesign_usage.sql` — optional rate-limit table (RLS on, no anon policies; function uses service role).
- `supabase/config.toml` — `[functions.redesign] verify_jwt = false` so logged-out visitors can call it.
- `src/pages/Redesign.tsx` — public page; calls `supabase.functions.invoke('redesign')`; renders analysis + 3 token-driven "visual concept" cards (palette/type rendered client-side, not AI hero HTML) with copy-build-prompt.
- `src/App.tsx` — public `/redesign` route added in BOTH auth branches (visitors + logged-in).
- `src/pages/Landing.tsx` — "Website Redesigner" card in "Apps I've Built" (internal `<Link to="/redesign">`; added `AppItem` type + `MotionLink`).

**Not deployed / not committed.** To go live the user runs (Supabase CLI): `supabase link --project-ref djdahryxrwbsncdrezfw`, `supabase secrets set AI_GATEWAY_API_KEY=…`, `supabase functions deploy redesign`, `supabase db push`. Verified: front-end type-checks (tsc exit 0) and `/redesign` renders (dev server port 8080). Live redesign call untested (needs deploy + key).
