# App Builder

Route: `/apps/app-builder` · Category: AI · Live

Record reviewed: never — seeded from the edit log on 2026-11-13

> **This file is the truth about this app.** Read it before changing the app and update it in the
> same commit. Everything above the "From the code" block is written by hand and kept; that block
> is rewritten from the code by `npm run apps:records`, and `npm run check:records` (part of
> `npm run verify`) fails when it is stale. Edit prompt: `npm run change-it -- app-builder "what to change"`.

## What it does

Type an app idea — one line or a full brief — or drop a screen recording or screenshots of an app or workflow you want recreated or changed. The super agent watches recordings frame by frame with their narration and takes them apart (screens, flow, behaviour, data), asks what the app is for, then proposes a feature list built around that purpose. Accept, deny or edit each feature by throwing it into or out of the Orbit, in the table, or by telling the agent in chat. Build it sends the whole brief to In Queue for Claude Code on your PC or VPS, which runs video-analyzer and rea when there is a recording, then felix, prompt-enhancer, the right design skill, software-factory and claude-security; or send each feature to the board as a Felix card. Jarvis chat and Camera Autopilot route every new-app request here.

## Features

_Seeded from this app's edit log. Rewrite it into plain features the next time the app is edited, then set Record reviewed._

- **Idea or screen recording → super agent → features → build** — New Jarvis App plugin at /apps/app-builder. Type an app idea (simple or detailed) or drop a screen recording / screenshots of an app or workflow: - the super agent watches recordings (ordered frames …
- **Plans now say how you'll know each feature works** — Planning was the weak link: a feature was a title, what it does and why, and nothing in it said how anyone would know it works. So every board card got the same generic acceptance criteria, the build…
- **Ship takes a move live on one press, if the checks pass** — One press now means the press and nothing else. The panel records the pull request the moment Claude says `PR:`, and then, if the PC's own gate passed, lands it with `shipThread` — main merged in, br…
- **One press moves an app in, and the press is followed** — Moving BuildFlip 2 into the hub took a press and then an hour by hand. Four separate things made that happen, and each is fixed here rather than worked around:
- **Built only after your PC has checked it, with the failing checks on screen**
- **Ship hands a site over in two presses, and the picker is one A-Z list** — Ship was a screen of controls that shipped nothing. Everything that only configures a project - the repo and Vercel fields, the brief model, the timeline link, New link, Release, Archive, Delete - is…
- **Drop the dead BuildFlip/Build ROI copies from old browsers**
- **Keep going when the tab closes, the bridge restarts, or a limit hits** — A build was a harness thread in the bridge and a row on the server, but nothing on the PC remembered it. Closing the tab left the thread running invisibly; a bridge restart (an update, a wake, a rein…
- **Watch it build opens the app's own building stage**
- **Finish in an existing folder, and stop gating its own tools**
- **Show three mockups of the build before it exists, and let the pick steer it** — Three design directions are drawn from the accepted feature list as real HTML and shown side by side in App Builder, and on the Client Review waiting screen where the client used to see only an orb w…
- **A workbench in the chat — coding agents, GitHub, Vercel, Supabase, MCP, CLIs** — The chat could browse, read and run, but it could not hand a multi-file job to an agent that writes, tests and commits, and it had no way to reach the services an app actually ships through. Both are…
- **Answer a permission once per tool, not once per call** — autoAllow has one line for MCP tools:
- **Build the edits here, on main, with the model you picked** — Approve & build started a thread and then changed nothing. The bridge cuts each worktree from its own checkout's HEAD, and that checkout sits on a long-running branch 270 commits behind origin/main w…
- **The "it's being built" screen could never appear** — Reported as "I pressed build it and no pop up screen appeared".

## Must keep working

_The flows a user would notice breaking. Sign-in, data rules, routes and keys are listed from the code below by themselves._

## Requested, not built yet

_Nothing waiting._

<!-- code:start -->
## From the code

_Rewritten by `npm run apps:records` from the source — do not edit by hand. `npm run check:records` fails when it is out of date._

### Where it lives

- Page `/apps/app-builder` — owner's sign-in
- `src/app/api/app-builder/`
- `src/components/app-builder/`
- `src/lib/app-builder/`

### Sign-in & who can use it

- _No sign-in code of its own; the hub middleware decides access (see routes below)._

### Server routes

| Methods | Route | Who can call it |
|---|---|---|
| POST | `/api/app-builder` | owner's sign-in |

### Data & database rules

- Saved data `app-builder:v1` — `src/lib/app-builder/useAppBuilder.ts`

### Keys & outside services

- AI calls through `src/lib/ai/provider.ts` — `src/app/api/app-builder/route.ts`

### Tests

- `src/lib/app-builder/absorb.test.ts`
- `src/lib/app-builder/build.test.ts`
- `src/lib/app-builder/clientEdit.test.ts`
- `src/lib/app-builder/depth.test.ts`
- `src/lib/app-builder/engine.test.ts`
- `src/lib/app-builder/look.test.ts`
- `src/lib/app-builder/pickedMockup.test.ts`
- `src/lib/app-builder/plan.test.ts`
- `src/lib/app-builder/planCheck.test.ts`
- `src/lib/app-builder/redesign.test.ts`
<!-- code:end -->
