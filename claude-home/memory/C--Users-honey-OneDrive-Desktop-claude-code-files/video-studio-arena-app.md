---
name: video-studio-arena-app
description: "/apps/video-studio-arena is the one home for video creation — five engine plugins (Remotion, HyperFrames, Unreal, Blender, H3), real capability detection, and a local runner for the four engines the website can't render"
metadata: 
  node_type: memory
  type: project
  originSessionId: a253e276-881a-4318-9f90-ba0bbf094d6f
  modified: 2026-09-20T00:00:16.273Z
---

**Video Studio Arena** (`/apps/video-studio-arena`, code under `src/{components,lib}/video-studio`)
is the owner's single home for video creation, built 2026-09-19 so video ideas stop scattering into
one app per engine. Flow: Prompt → Choose Method → Production Plan → Generate → Preview.

**Plugin architecture is the point.** Adding an engine = a folder
`src/lib/video-studio/methods/<id>/{meta.ts,skill.ts,server.ts}` plus one line in
`registry.ts` and one in `server/registry.ts`. Nothing in the UI, routes or run loop knows the five
shipped engines by name. `methods/README.md` is the checklist.

**Two transports, and the difference is honest:**
- `transport: "server"` — H3 only. Renders inside the Next route, reusing the existing
  `src/lib/auteur/server/video` backends (RunPod → MiniMax → AI Gateway). Polling the project from
  the browser is what *advances* the run, so the spend stops when the user stops watching.
- `transport: "agent"` — Remotion, HyperFrames, Unreal, Blender. The site queues a job; the
  **studio runner** (`tools/video-studio-runner`, same token pattern as game-creator) claims it on
  the PC, runs `claude -p` with that engine's skill, and uploads each `out/scene-<n>.mp4` as it
  settles. Runner routes are middleware-exempt by exact path.

**Capability detection is real, never optimistic** (`server/detect.ts`): env keys, `where <cmd>`,
install paths, MCP servers read out of `~/.claude.json`, skill folders, runner last-seen. A missing
piece is named on the card with how to fix it. Verified on this PC: Unreal Engine + Epic MCP found,
the cinematic bridge absent; Blender absent but its MCP registered; H3 ready via RunPod.

**Two model calls, deliberately separate:** an engine-agnostic plan the user reads and approves,
then a per-engine optimiser (each method's own `optimiserSystem`) that rewrites every scene in that
engine's terms. The raw prompt never reaches an engine. Both fall back offline.

**ffmpeg is installed** (Gyan.FFmpeg 9.0.1 via winget, 2026-09-19) and `FFMPEG_PATH` is set in
`.env.local` — needed because installing it edits the user PATH and a dev server started earlier
keeps the old environment. Assembly uses the concat **filter**, not the demuxer: two engines return
different resolutions and frame rates, and the demuxer silently stretches or truncates everything
after the first clip. Verified joining 640x360@24 + 1280x720@30 + 1080x1920@25 into 1920x1080@30 at
the exact summed duration, with silence generated for mute scenes so narration is not dropped.

**The runner is configured** at `tools/video-studio-runner/.env` (gitignored), `HUB_URL`
= localhost:3000, token minted for the local `local` account — a deployed hub needs its own token
minted while signed in. `start-runner.cmd` is the double-click launcher. With it running,
Remotion + HyperFrames + H3 report ready; Unreal still wants the cinematic bridge and Blender is
not installed.

Related: [[smart-shot-videos-app]], [[auteur-app]], [[game-creator-app]], [[video-engine-skills]].
