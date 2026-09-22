---
name: h3-scroll-world-skill
description: Owner's H3 port of oso95/scroll-world — cinematic scroll-scrubbed fly-through websites with MiniMax H3 video + OpenRouter stills; tested live 2026-09-19
metadata:
  type: project
---

Built 2026-09-19 at `~/.claude/skills/h3-scroll-world/` because the owner wanted "Seedance 2.5 cinematic website builders but with H3". Forked from **oso95/scroll-world** (MIT, 9.4k★; LICENSE.upstream kept). All Higgsfield/Monid/Seedance removed. Scripts (zero deps, keys from env → cwd .env.local → hub .env.local): `scripts/h3.mjs` (backends runpod → minimax → gateway, `--check`, `--dry-run`), `scripts/still.mjs` (OpenRouter `google/gemini-3.1-flash-image`, `--ref`, `--fit 1344x768`), `scripts/probe.mjs` (ffprobe stand-in; this PC has no ffmpeg/ffprobe on PATH, it uses the hub's `node_modules/ffmpeg-static/ffmpeg.exe`).

**Why:** owner's RunPod H3 worker takes first_frame ONLY (no last_frame), so architecture A (continuous forward take, each leg seeded by the previous leg's real last frame) is the default; architecture B (diorama connectors) needs MINIMAX_API_KEY (not set).

**Measured live:** RunPod 768P 16:9 output = 1344×768 @ 24 fps; a 6 s request → 5.88 s/141 frames; ~4.6 min on a warm worker; the still is SCALED (not cropped) to the canvas, frame 0 matches visually (25.7 dB). Hence `--fit`. Test clip: docs/screenshots/leg0.mp4. No connector (last_frame) probe has been run.

**How to apply:** use with [[cinematic-ui]]-style art direction (skill `cinematic-ui` installed same day, MIT). Both are listed in the Skills Library Web design guide — see [[skills-library-app]]. H3 prompt format facts live in [[auteur-app]].

**2026-09-19 (later) — upstream `scroll-world` re-installed alongside this fork.** The Redesigner dropdown listed `scroll-world` but nothing was on disk: it had been installed ~15:06 (sync hook auto-committed the roster entry), then deleted once this H3 fork existed, leaving an orphaned entry. Re-cloned oso95/scroll-world (MIT) to `~/.claude/skills/scroll-world/` with the **generation backend swapped to muapi** per the [[higgsfield-models-skill]] rule — upstream's two billers (Higgsfield CLI + Monid pay-per-clip) are both gone. Mapping lives in that skill's `references/backend.md`: stills `gpt-image-2-text-to-image`; legs `seedance-2-image-to-video`; connectors `seedance-2-first-last-frame` (the start+end-frame model the seam law needs — `images_list:[start,end]`, order matters); previz = the same two with `-fast`; Kling fallback is `kling-v3.0-4k-image-to-video` and takes `image_url`+`last_image`, NOT `images_list`.

**Which of the two to reach for:** `scroll-world` = Seedance 2 on muapi, does architecture B (dive + aerial connector) because it has a true first/last-frame model. `h3-scroll-world` = RunPod H3, first_frame ONLY, so architecture A. They are not interchangeable.

**Gotcha:** muapi has NO balance command, so never quote a remaining balance or upstream's credit/Monid pricing — render one clip, read `cost.value` off the result, extrapolate, re-confirm. `MUAPI_API_KEY` in the hub `.env.local` is present but **blank** as of this date (line 63) — the skill installs and validates but cannot render until a key is pasted.
