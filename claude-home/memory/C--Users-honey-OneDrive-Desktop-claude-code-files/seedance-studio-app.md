---
name: seedance-studio-app
description: Seedance Studio at /apps/seedance-studio — CapCut-style timeline prompt builder for Seedance 2 video
metadata: 
  node_type: memory
  type: project
  originSessionId: 0c8cbeff-8c02-4e5c-8682-7ba90e3fb85c
---

**Seedance Studio** is a hub app at `/apps/seedance-studio` (catalog slug `seedance-studio`, category Video). A CapCut-style timeline editor / prompt builder for **Seedance 2**: a Song/audio track above a Video-segments track; each segment is a prompt block with mood + video-effect dropdowns, a duration slider (5–10s), and optional image/video reference uploads. Add via "+", reorder, delete; Generate renders each block into a clip on the timeline; a scrubbing playhead plays the reel back.

Key facts:
- **Real generation is wired** via the AI SDK's `experimental_generateVideo` with model `bytedance/seedance-2.0` through the **Vercel AI Gateway** (route `src/app/api/seedance/route.ts`). Seedance 2.0 is natively on the gateway — no separate provider account, just `AI_GATEWAY_API_KEY`. Installed the `ai` package (v7) for this.
- **Without a key** it returns a deterministic **placeholder** clip (mood-derived gradient, `posterHue`) so the editor is fully usable offline — same resilience pattern as the rest of the hub.
- Design: **dark** editor (hub tokens) + CapCut **cyan `#00cae0`** accent (added as `--color-accent`/`--color-accent-2` in globals.css). The capcut-design skill is light-themed (CapCut's marketing site); the editor is dark to match both the real CapCut editor and the hub.
- Persistence is **structure-only localStorage** (`src/lib/seedance/repo.ts`) — media/rendered clips are session-only object URLs (never persisted, avoids quota). User chose "real API + Postgres"; Postgres is the intended production store (wire once a `DATABASE_URL` exists) and media → Vercel Blob.
- Playback is **timestamp-based** (derives playhead from a start time) so the rate stays correct despite React StrictMode double-mounting intervals in dev.
- **Scalable timeline**: Timeline.tsx owns a `pxPerSec` zoom (3–800) with Fit/±/slider/%, and an adaptive ruler (0.1s ticks at max zoom → seconds → m:ss). Segments are **drag-resizable** via a right-edge handle (editor range 1–15s; route clamps to Seedance's 5–10s).
- Each segment has a **type**: `broll` (default) or `lipsync` (the subject sings that slice of the song — composePrompt adds the lip-sync instruction; audio-driven sync via the gateway is the next step once a key exists). ~23 moods, ~25 effects.

Built with [[interactive-web-studio-skill]] + capcut-design. Spec'd via [[blueprint-app]].
