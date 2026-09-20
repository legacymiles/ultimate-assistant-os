---
name: game-creator-app
description: "Game Creator at /apps/game-creator — prompt → Unreal game built on the user's PC by a local builder running claude -p with the unreal-game-builder skill; gallery of games with screenshots and ueos:// open/play links"
metadata: 
  node_type: memory
  type: project
  originSessionId: 12b57f3a-535a-416f-829e-2c051bad14ec
  modified: 2026-09-19T01:26:33.891Z
---

Built 2026-09-14 at the user's request ("the OS is just a place to use my prompts and store all
the games... screenshot and info and a link to the actual game"). Spec
`docs/superpowers/specs/2026-09-13-game-creator-design.md`, plan in `docs/superpowers/plans/`.

**The website never touches Unreal.** Vercel cannot run UE. The site queues prompts and shows
games; `tools/unreal-builder` (`npm run builder`, env `tools/unreal-builder/.env` with HUB_URL +
BUILDER_TOKEN) runs on the PC, claims the oldest queued game, runs
`claude -p ... --output-format stream-json --verbose --permission-mode bypassPermissions`, tails
Claude's stream into the log, and watches `<project>/GameCreator/` (status.json, Design.md,
shots/*.png + captions.json, game.json) to post progress. Engine side: [[unreal-bridge-mcp]].

**Data:** one server doc `game-creator` (tokens hashed, lastSeen, games per uid) via docStore;
screenshots in bucket `game-shots` via blobStore, served only through the session-gated
`/api/game-creator/shots/:id/:n`. Local dev writes `.data/` (gitignored). Writes are serialised
in-process (`mutate` promise chain) because builder progress posts race browser edits.

**Auth:** four builder routes (`builder/claim|progress|screenshot|fail`) are session-exempt by
EXACT path in `src/middleware.ts` `TOKEN_AUTH_PATHS` (joined the Dashboard inbox push path); every
other game-creator route stays behind the login wall.

**Playing a game:** no downloads, by user choice. Game page buttons are `ueos://play?id=` /
`ueos://open?id=`, handled by `tools/unreal-builder/open.mjs`, registered per-user in
HKCU\Software\Classes\ueos by `npm run builder:install`. The handler only accepts open/play + a
plain id and resolves paths from the PC registry, never from the URL.

**Deployed-site caveat:** the builder must reach the hub. Against production it needs HUB_URL
= the Vercel URL; the builder paths are exempt from the login wall so that works. `ueos://` links
only work on the PC that built the game.

Preview config `game-creator-preview-3223` (--no-auth) in `.claude/launch.json`.

**2026-09-18 update (blocker below is FIXED: CLI is on the Max plan; builder .env has HUB_URL =
production + token; builder runs via `npm run builder`).**
- Skills: builder scans ~/.claude/skills for SKILL.md frontmatter `game-creator: true`
  (`game-creator-default: true` = default; env BUILDER_DEFAULT_SKILL overrides), reports them on
  every claim; app shows a "Build skill" dropdown, one skill per game; prompt forces the Skill tool
  first and the builder flags skillUsed true/false from Claude's tool calls.
- Chat: game page "Chat with the agent" tab. Builder runs `claude -p --input-format stream-json`
  and keeps stdin open; pending messages (route builder/messages, token-exempt in middleware) are
  injected mid-run. Verified: a mid-turn message is FOLDED into the current turn (no extra result),
  so never count turns — on each result, send new messages or close stdin. A message on a finished
  game re-queues it as `followUp` and the builder `--resume`s the saved sessionId.
- Realism: bridge got variants (FirstPerson+ArenaShooter; its StateTree AI + spawner actors are
  excluded or the cook fails), `unreal_find_assets`/`unreal_add_assets` (Poly Haven CC0 via Python
  commandlet), `unreal_game_shot` (real game view via -ExecCmds "r.HighResScreenshotDelay N,shot
  showui"; editor CaptureViewport shows light-bulb icons and no weapon). Variant levels need their
  __ExternalActors__ copied or they load empty. Build.bat ValidatePlatforms hangs forever on this PC
  at random → lib/sdkcheck.mjs watchdog kills it after 2 min (editor start, import, game shot, cook).
  Skill guide: references/realism.md. DeadCity (2.8/10) was built before all this.

**BLOCKER as of 2026-09-14 — needs the user, not code.** The first real end-to-end build
(prompt typed in the UI, claimed by the builder in 16 s) failed in 24 s because headless
`claude -p` on this PC returns "Credit balance is too low". `claude auth status` shows a
claude.ai login with an org "/login managed key" and `subscriptionType: null`, i.e. empty API
credit, not a Pro/Max subscription. No ANTHROPIC_API_KEY anywhere; a user-level
ANTHROPIC_AUTH_TOKEN exists but does not help. The desktop app session works; the CLI does not.
Fix is the user re-running `claude /login` with their subscription account (or adding API
credit). Then retry the failed game from its page. Everything up to that point is verified:
bridge + Epic tools, PIE, player screenshots, packaging (exe ran), all API routes, gallery UI.
The failed game and builder `.env` (HUB_URL=http://localhost:3223) belong to the local preview.

Commits: fa47a49 (feature), 049f7a6, and the stdin fix. NOT pushed — main also carries other
sessions' unpushed commits, and a push auto-deploys production.

**2026-09-18 — model picker + OpenRouter.** New-game form has a Model dropdown (`BUILD_MODELS` in src/lib/game-creator/types.ts): Claude ids run on the plan via `--model`; ids with a slash (openai/…, google/…) run Claude Code through OpenRouter, offered only when the builder reports OPENROUTER_API_KEY (now in tools/unreal-builder/.env, copied from .env.local). GOTCHA: with a claude.ai login on this PC the CLI silently drops ANTHROPIC_AUTH_TOKEN for a custom ANTHROPIC_BASE_URL (OpenRouter 401 "Missing Authentication header", CLI retries forever with no output) — `claudeEnv()` in tools/unreal-builder/lib/claude.mjs also sets ANTHROPIC_CUSTOM_HEADERS="Authorization: Bearer <key>", verified with DeepSeek doing a real Bash tool call. Also passing a prompt as a CLI arg under shell:true on Windows produces nothing; use stdin. The hub's AI panel "Runs on" switch (plan/OpenRouter) reaches the builder in the claim response (`ai`); a plan failure (credit/limit/login, `planProblem()`) retries once through OpenRouter (anthropic/<same model>). The builder must be RESTARTED to pick up this code — it was mid-build when shipped.
