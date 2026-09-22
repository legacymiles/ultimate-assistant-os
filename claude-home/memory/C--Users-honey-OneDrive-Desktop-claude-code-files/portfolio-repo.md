---
name: portfolio-repo
description: "User's portfolio repo pod-play-connect (Vite SPA) and how the Assistant OS project was added to it"
metadata: 
  node_type: memory
  type: project
  originSessionId: c4341e2d-5775-477e-afc1-f29f84248b69
  modified: 2026-08-14T19:35:27.289Z
---

**SUPERSEDED (2026-08-14):** the portfolio is NOT pod-play-connect — it's the Next.js OS hub. See [[ultimate-assistant-os-portfolio]]. pod-play-connect is now just one showcased app. **Since 2026-09-18 the hub serves it itself**: a prebuilt Vite bundle in the hub's `public/pod-play-connect/` (tile `appUrl: "/pod-play-connect"`, SPA rewrite in `next.config.mjs`). The old `externalUrl: http://localhost:8080` tile was dead whenever the dev server wasn't running. To update it: in the pod repo, PowerShell `$env:POD_BASE="/pod-play-connect/"; npx vite build --outDir "<hub>/public/pod-play-connect" --emptyOutDir` (Git Bash mangles the `/pod-play-connect/` path), then commit + push the hub. **Since 2026-09-19 it no longer uses Lovable's Supabase project.** It used to talk to `djdahryxrwbsncdrezfw`, which **Lovable owns and this account cannot administer** — the owner's Supabase org (`legacymiles's Org`, the only one) does not list it, so every auth change they saved went to a project the app never read. That is why Google sign-in kept failing with "Unsupported provider: provider is not enabled". It now uses the **hub's own project `kiiwaiwrfslqankcsnkf`** with its 10 tables in a dedicated **`pod` schema** (the hub already owns `public.profiles` + `public.handle_new_user()`); signup trigger is `on_auth_user_created_pod` so the hub's own trigger is untouched, and the client pins `db: { schema: 'pod' }` so all 38 `.from()` call sites are unchanged. The `pod` schema must stay listed under Settings → Data API → Exposed schemas or PostgREST returns PGRST106. `supabase/install-into-pod-schema.sql` in the pod repo is what was applied. Lovable itself is fully removed (lovable-tagger, .lovable/, bun lockfiles, README); `.env` is no longer tracked in git. Its `/redesign` page is BROKEN — it invokes a `redesign` edge function that only existed in the Lovable project. The "OS embedded at apps/assistant-os/" plan below is abandoned. Keep this file only for the pod-play-connect facts (stack/location).

pod-play-connect (github.com/legacymiles/pod-play-connect) is a Lovable-built **Vite + React 18 + shadcn + react-router** SPA (a Spades card game + chat/groups social app), toolchain is **bun**. Working clone lives at `C:\Users\honey\OneDrive\Desktop\pod-play-connect`. Dev server runs on port 8080. Still hosts its own `/redesign` page ([[redesigner-portfolio-app]]).

On 2026-07-12 the entire current Next.js project (the [[projects-timeline]] "Ultimate Assistant OS" hub) was copied into it at **`apps/assistant-os/`** as a self-contained standalone app (excludes node_modules/.next/.env.local secrets; keeps .env.example). A launch card + "Apps I've Built" section was added to `src/pages/Landing.tsx`. Committed on branch `add-assistant-os-app` (commit 4f4591d); **not pushed**.

Key constraint: the hub is Next.js with **server-side AI routes**, so it can't run inside the Vite SPA — it must deploy separately (e.g. Vercel project with root dir `apps/assistant-os`), then set `ASSISTANT_OS_URL` in Landing.tsx (currently a localhost placeholder) to the live URL.

**Why:** cross-framework port would break the AI backend; a linked standalone app is the lossless approach.
**How to apply:** to make the portfolio card work live, deploy apps/assistant-os and wire its URL; the pod-play-connect package-lock.json is also stale vs package.json (needs `npm install`/`bun install` to reconcile).
