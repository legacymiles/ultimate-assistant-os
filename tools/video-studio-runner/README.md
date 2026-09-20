# Video Studio Arena runner

Runs on the PC that has the engines. The website queues a job; this claims it,
renders it with Claude Code and that engine's skill, and uploads the result.

Four of the five shipped engines need a real local install, so the website
cannot render them itself:

| Engine | Needs |
|---|---|
| Remotion | Node 18+, the `remotion-*` skills |
| HyperFrames | Node 22+, the `hyperframes*` skills |
| Unreal Engine | UE 5.7+, the `unreal` MCP, the cinematic bridge, the `unreal-cinematics` skill |
| Blender | Blender 4+, the `blender` MCP, the `blender-*` skills |
| H3 | *nothing here — it renders on the server* |

## Setup

```bash
cd tools/video-studio-runner
npm install
cp .env.example .env
```

Put the token from **Video Studio Arena › Integrations** into `.env` as
`HUB_TOKEN`, and the hub's URL as `HUB_URL`. Then:

```bash
npm run runner
```

It polls every few seconds. That poll is also what makes the method cards in
the app say **Ready to run** instead of **Not connected** — the app reports
the runner offline when it has not been seen for two minutes.

`npm run runner:once` renders a single job and exits, which is the easy way to
watch one job end to end. `start-runner.cmd` is the double-click version.

## Pointing it at the deployed hub

Tokens are per account. The token in `.env` was minted from the LOCAL hub, where
the account is `local`. To drive https://ultimate-assistant-os.vercel.app instead,
open its Integrations page while signed in, mint a token there, and put that one
in `.env` with the deployed `HUB_URL`.

## What a job looks like on disk

```
<VIDEO_STUDIO_WORK_DIR>/<projectId>/
  job.json          the brief, the plan, every scene's engine directive
  out/
    scene-1.mp4     uploaded the moment it stops growing
    scene-2.mp4
    final.mp4       optional — the hub joins the scenes when this is absent
```

The runner watches `out/` and uploads each clip as it settles, so the website's
status list reflects work that actually finished rather than a timer.

## Honesty rules

The prompt tells the session, and this program enforces, that:

- a missing engine, MCP or key is **reported by name and the job fails** — no
  substituting a different engine, no placeholder passed off as the video;
- a session that writes no video to `out/` is a **failure**, even if it exited
  cleanly and said nice things;
- every `STATUS: scene <n> …` line becomes a real status line in the app.

## Uploads

A rendered video is routinely far over the 10 MB Next.js keeps of any request
body that goes through middleware. The runner picks a route automatically: a
signed Supabase Storage link on a deployed hub, an 8 MB chunked upload on a
local one, and a single multipart POST only for small files.
