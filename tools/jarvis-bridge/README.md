# jarvis-bridge — the half of New Jarvis that can touch this PC

```cmd
tools\jarvis-bridge\install.cmd
```

**Run that once.** It installs the dependencies, downloads the browser New Jarvis
drives, starts the agent now and at every Windows sign-in with no console window,
and opens Jarvis, which **pairs itself** (`GET /pair` hands the token only to the
hub's own origin on a preflighted request — no token to copy).

**It keeps itself working** (`selfheal.mjs`, every start): re-points the Startup
shortcut at wherever this folder now lives, registers `jarvis-agent://` so
Jarvis's **Connect** button can start it with one tap, and installs its own
packages and Chromium if they are missing, then restarts. This is what broke in
Oct 2026: the folder moved out of OneDrive, the shortcut kept pointing at the
old place, and a static SDK import crashed the agent without its packages. After it, `/apps/new-jarvis` can open real pages in a
browser that keeps your logins, run commands, read and write files, list and focus
windows, and see your screen.

Undo the sign-in part with `uninstall-autostart.cmd`. Re-pair any time with
`pair.cmd`. `start.cmd` opens it in a visible window when you want to watch the
log; the hidden one writes to `out\bridge.log`.

## Why it exists

New Jarvis runs on Vercel, and Vercel cannot reach this desk. Your browser can.
So the page posts to `127.0.0.1:42020` and this process does the things a web
page is not allowed to do. Same trick as `tools\studio-bridge`, different job.

**The site is built to work with this switched off.** Every capability is
reported through `/health`, and New Jarvis greys out what is missing and says
which one, rather than offering a button that cannot work. With the agent off it
still thinks, remembers and answers.

## What it can do

| | |
|---|---|
| `POST /shell` | One PowerShell command, with its real output and exit code. Bounded output, bounded time. |
| `POST /browser/*` | `open`, `read`, `click`, `type`, `press`, `scroll`, `navigate`, `tabs`, `screenshot`, `close`, `quit`. |
| `POST /files/*` | `list`, `read`, `write`. |
| `POST /system/*` | `windows`, `focus`, `launch`, `screenshot`, `info`, `clipboard/read`, `clipboard/write`. |
| `POST /harness/*` | `list`, `start`, `say`, `events`, `decide`, `interrupt`, `stop`, `threads`, `status`, `diff`, `land`, `discard`. A coding agent in its own worktree. |
| `POST /mcp/*` | `list`, `tools`, `call`, `save`, `remove`, `enable`, `restart`. MCP servers as child processes, and their tools. |
| `POST /cli/*` | `list` (what is installed, with versions), `install` (npm, winget, pip or uv). |
| `GET /health` | No auth. What is installed and whether the browser is up. |
| `GET /status` | Everything the page's panels draw. |

### The browser is headed, and it keeps a profile

It launches a real Chromium with a profile in `out\browser-profile`, not a
throwaway headless one, for two reasons. A browser that forgets every login can
read public pages and nothing else, which rules out most of what you would
actually ask for — so you sign in **once, by hand**, and every later run is
already signed in. And an agent clicking through a site you cannot watch is a
thing you switch off after the first surprise, so you can watch it.

`JARVIS_BRIDGE_HEADLESS=1` turns the window off for unattended runs.

Elements are addressed by `ref` — a number stamped onto the page during a
`read`. **You must `read` before you `click` or `type`**: refs only exist after a
read, and they go stale when the page changes. That is deliberate. A CSS
selector or a text match breaks silently between the model deciding and the
click landing; a stale ref is an error we can report instead of a wrong element
we quietly clicked.

### Coding harnesses, and why they are shaped differently

Everything else here does one bounded thing and answers. A coding harness runs
for ten minutes, talks while it works, stops in the middle to ask permission,
and the page driving it is a tab that may be closed and reopened on a phone
before it finishes. So a harness thread LIVES in this process: `/harness/start`
cuts it a git worktree and starts a child in it, and the rest of the group is
how a page reads and steers that child.

Two harnesses, one shape:

| | |
|---|---|
| `claude` | Claude Code through the Agent SDK, imported here rather than spawned as a CLI. The SDK's `canUseTool` is a function call in this process, which is the only reason a permission prompt can be carried to a page and answered there. |
| `deepseek` | dsh's `acp` profile over Agent Client Protocol on stdio. |

Where dsh lives is **discovered**, not hard-coded: `DSH_DIR`, then `~/deepseek-harness`, then
`~/Projects/deepseek-harness`, then the desktop app's bundled copy. A root can be a checkout
(with `node_modules/@deepseek-ai/dsh`) or the package folder itself. The package is started as
`node <bin.js> --profile acp`, so it needs no `npx`, no PATH entry and no network.

**Events are polled, not streamed.** `EventSource` cannot set an
`Authorization` header, so an SSE route would need its own door, and a long
response dies silently every time this laptop sleeps. A ring with a monotonic
cursor survives sleep, reload, and a second tab reading the same thread — and
says `dropped` when a reader has fallen too far behind to be caught up
honestly, instead of handing back a transcript with a hole in it.

**A gate is a parked promise.** The harness's permission hook is blocked on it,
so nothing has happened when the card appears and nothing happens if it is
never answered. The card carries the PATCH, built from the tool's own
arguments, so the thing approved is a change you have read rather than a tool
name you recognise. Unanswered gates refuse after twenty minutes.

#### Making DeepSeek ask

Out of the box dsh asks for nothing: its default preset is `workspace-write`,
under which any write inside the session folder is simply allowed. Probed
against a scratch folder it read a file, rewrote it and ran a shell command
without sending the client a single request, and `session/new` exposes no
approval setting.

The switch is an environment variable. The acp profile composes
dsh-sandbox-policy as `mode: process.env.DSH_PERMISSION_MODE ?? 'workspace-write'`,
so the child is started with `DSH_PERMISSION_MODE=read-only`. Every write is
then outside the sandbox: dsh denies it once, tells the model escalation is
available, the model retries the identical call with `sandbox_permissions`, and
THAT escalation arrives as `session/request_permission` — which becomes the
gate. Nothing outside this child process is configured, so `dsh web` is
unaffected.

A permission request carries only a `toolCallId`, so every `tool_call`
notification is remembered and the gate is drawn from the remembered call.
Otherwise the card would say "approve call_00_RwSj…" and mean nothing.

#### The worktree, and the junction that bit

Threads work in `~/.jarvis-harness/worktrees/<name>`, outside the repository
and outside OneDrive, on a flat `jarvis-<name>` branch. Flat because git stores
refs as paths and this repository already has a branch called `jarvis`, which
makes every `jarvis/...` ref impossible to create.

`node_modules` is a directory junction back to the main checkout, because a
fresh install per thread is two minutes and a gigabyte and without it the
harness cannot run the repo's own typecheck or tests. `.next` is NOT shared.

**That junction is dangerous and the code guards it.** `git worktree remove
--force` recursed INTO the junction rather than unlinking it, started deleting
the main checkout's packages, emptied `node_modules/.bin` and stopped — every
npm binary in the repo went with it. `removeWorktree` now `rmdir`s the reparse
point first, and refuses to remove the worktree at all if it cannot, because
leaving a stale folder is better than eating the real `node_modules`.

#### Landing refuses rather than guesses

`/harness/land` commits on the thread's branch and merges into the base only
when the base checkout is clean and on that branch. Several Claude sessions run
on this folder at once and it is almost never clean; merging on a button press
is how one thread eats somebody else's afternoon. When it stops, it names the
files that stopped it.

#### A build is checked before it is called built

A durable build (App Builder, a Client Review edit) used to be finished when
the agent printed its `Repo:`/`Live:` lines. Now that line is a **claim**. When
a turn ends on it, the bridge checks the folder itself — `harness-verify.mjs`
decides what, `harness-verify-run.mjs` does it:

install (a project folder only, never a worktree: its `node_modules` is the
junction above) → typecheck → lint (advice, never a failure) → its own tests →
build → start it on a free port → open its pages in a hidden browser, plus the
home page at 390 px → open the `Live:` address.

A new project is crawled link by link, up to 25 pages. A worktree of an
existing site is not: it opens the home page and the pages the thread was
started with (`verifyPaths`), because following the hub's home page would fail
an edit for an error that was already there.

Everything the gate starts gets `scrubEnv()`'s environment, not the bridge's:
the bridge holds every key on this PC and a generated app must not. A worktree
of the hub still reads the `.env.local` that was copied into it, as every
preview always has.

**What happens to the result** (`harness-verify-loop.mjs`):

- **Pass** — the job is `done`.
- **Fail** — the failures go back to the agent as one `<checks_failed>`
  message, at most three times, stopping early when the same checks fail twice
  running. Then the job is `unverified`, the page says "Built, but the checks
  are failing", and the owner has **Check again** and **Use it anyway**.
- **Could not look** — no browser on this PC, the runner itself broke, or a
  check ran past an hour. That is not the build's fault, so nothing is sent to
  the agent; the build is `unverified` and says why. It is never a pass.

One check runs at a time across every thread. A thread that may not run
commands unasked gets one card, "Run the checks on this build", once.

**Who a turn was for decides what its end means.** A repair the gate sent keeps
its round count. A message the owner types calls off a check in flight; if the
agent then changes something, the old verdict is dropped and the next finish
line is checked with fresh rounds; if it only answered a question, the verdict
stands (and a check the question interrupted is run again).

**A restart** mid-check checks again; mid-repair it checks where the repair got
to. Either way the fresh model session is given the brief with the first thing
the gate tells it. The runner is loaded on first use, so a mistake in it costs
one check, never the bridge's boot — but a fixed runner needs a bridge restart.

The crawl only navigates. It never clicks, types or submits, skips links that
look like actions (`/logout`, `/delete/3`), and never uses the signed-in
profile in `out/browser-profile`. The live address is fetched only if it is a
public one.

Reports and two screenshots are in `out/verify/<thread>/<run>/`. The 24/7
runner asks for one check (`POST /harness/verify`) before a `SHIP: auto` run
lands; anything but a pass turns auto into review.

**Switching it off.** Put a file named `verify-off` in `out/` (any contents).
New durable builds are then finished on their own word, as before, and the
24/7 runner ships without asking for a check. A check asked for by hand still
runs, as a look that changes nothing on the job.

| What you see | What it means |
|---|---|
| "The checks could not run … the hidden browser could not start" | Chromium is not installed for this Playwright: `npx playwright install chromium` in this folder, then restart the bridge. |
| "There was nothing to check" | The folder has no `package.json` scripts and no `index.html`. |
| A build sits on "Checking it works" | Another build is being checked; one runs at a time. |
| Builds are "Built" without being checked | The gate is off: `out/verify-off` exists. Delete it; the next build is checked. |
| "The agent is still working" on Check again | A check mid-turn would grade a half-written folder. It is checked when the turn ends. |

Known limits: pages past the 25-page cap, behind a login, or reachable only by
a click are not opened; errors that appear more than a few seconds after load
are missed; the phone check covers the home page only. With two messages
queued at once, a turn's end can be read as the next message's. On DeepSeek a
turn that throws sends no end-of-turn, so a failed repair reads "fixing" until
the owner next types.

### MCP servers and the PC's CLIs

An MCP server is a command that speaks JSON-RPC over stdio. `POST /mcp/save` stores one in
`out/mcp.json` — beside the bridge, never in the repository, because that file is where a
server's own tokens live. `POST /mcp/tools` initialises it and lists what it offers;
`POST /mcp/call` runs one tool and returns its text. The child is kept between calls and
killed when the bridge exits. Adding a server is an arbitrary program, so the page gates it
as a grave action.

`POST /cli/list` checks a fixed list of the tools this hub actually reaches for (git, gh,
vercel, supabase, node, python, uv, docker, claude, dsh, ffmpeg…) and reports each one's real
path and version — the answer to "is `gh` installed here?" without guessing. `POST
/cli/install` installs one through npm, winget, pip or uv.

## What is holding the door

Any page in any tab can send a request to `127.0.0.1`. The browser will not let
that page *read* the answer without CORS — but a plain `fetch` still **arrives**,
and by then the command has run. An origin check alone therefore protects
nothing.

So:

1. **A token, on every route but `/health`.** It goes in `Authorization`, which
   is a non-simple header, which forces a CORS preflight — and the preflight is
   where an unknown origin is turned away *before* the request body, and
   therefore the command, is ever delivered. Requests without a valid token are
   refused whatever origin they claim.
2. **An origin allowlist**: the live hub, and any localhost dev server.
3. **Bound to `127.0.0.1`**, never the network interface.
4. **A short refusal list** for the irreversible — formatting a drive,
   `diskpart`, deleting `HKLM` keys, wiping shadow copies, shutting down. It is
   short on purpose: shell quoting has infinite ways to spell the same thing, so
   a long blocklist buys a false sense of safety. It catches the honest spelling
   of a catastrophe. **The token is what actually keeps the machine safe.**

The token lives in `out\token.txt` and reaches the page through the URL
**fragment** (`#pair=…`), which no browser ever sends to a server — not to
Vercel, not to a proxy, not into an access log. The page stores it and strips it
from the address bar immediately.

Above all this sits the page's own gate, and how much it stops for is the Trust
setting under the command line. **Trusted** is the default: it reads freely,
writes and runs the ordinary things without asking, and still parks on money,
on anything sent or published in your name, on deleting, on `git push`, and on
any write that leaves the thread's own worktree. **Ask** parks on every effect;
**Auto** parks on that short core and nothing else. A gate you answer with
"Always" stops asking for that shape of call. That gate is the one you read;
the list above is the one that holds when something bypasses it.

## When something is wrong

| What you see | What it means |
|---|---|
| "The local agent is not running on this PC." | Nothing is listening on 42020. Run `start.cmd` and read the window. |
| "Running, but New Jarvis is not paired with it yet." | It is up; this browser has no token. Run `pair.cmd`. |
| Browser row says "off" | Chromium is not downloaded. `npx playwright install chromium` here. |
| `Port 42020 is already taken` | It is already running. That is the normal case. |
| Nothing in `out\bridge.log` | The hidden start could not launch node. Run `start.cmd` to see the error. |

Stopping it: `uninstall-autostart.cmd` stops it **by the port it holds**, not by
its command line. Started from the Startup shortcut the command line carries the
full script path and matching it works; started from `start.cmd` it is only
`node server.mjs`, matches nothing, and a kill written that way reports success
while the agent keeps running.

---

## Keys — entered once, used by every harness run

The `.env.local` at the root of the repo this helper runs from is the one key
file on this PC. Jarvis › Profile › Connections saves there, and `keys.mjs`
makes it the only place a key ever has to go:

- **On start** it fills any blank key from the `.env.local` of every other
  checkout of this repo on the PC (found by GitHub origin under `~/Projects`,
  `C:\dev` and this repo's parent). It never overwrites a key you set here.
- **It loads the file into the helper's own environment**, so every harness
  thread, the brain and the 24/7 runner inherit the keys — and it re-reads the
  file before each new thread and each 24/7 run, so a key saved in Connections
  reaches the next run without a restart.
- Claude Code's login variables (`ANTHROPIC_*`, `CLAUDE_CODE_*`) are never
  loaded from it — that would override your subscription.
- `GET /health` lists which key NAMES the harness has. Values are never logged.

## 24/7 agents — carrying on when this PC wakes

`agents-wake.mjs` is the other half of the hub's **24/7 agents** tab. The hub
stores a goal and never pushes; this is the thing on the PC that notices it has
power and asks *"is there anything I can do?"*.

```bash
node agents-wake.mjs            # run forever (what the Startup shortcut runs)
node agents-wake.mjs --once     # one cycle, then exit
node agents-wake.mjs --dry-run  # say what it would do, start nothing
node agents-wake.mjs --install  # put it in Startup
node agents-wake.mjs --off      # stop it starting at sign-in
```

It is **its own process**, with its own Startup shortcut and its own log
(`out/agents.log`), for the reason the picture drawer is its own service: a
render that wedges must not be able to take the harness down with it. It edits
none of the bridge's files.

**It works with the browser shut.** Nothing here needs Jarvis to be open.

### How it knows the laptop woke

Windows gives a plain Node process no wake event, so it uses the one signal it
has: a heartbeat every 20 seconds. A beat that should have fired 20 seconds ago
firing three hours late *is* the lid having been shut, and that is the moment
the owner means by "as soon as the laptop opens". Otherwise it asks every three
minutes — one small request, no model runs.

### What it is allowed to do

Nobody is awake to approve anything, so a run does **not** use the harness gate
(which asks). It uses `agents-unattended.mjs`, a different policy:

> **Allow or block. Never ask.**

- **Allowed**: reading anywhere; the render tools (`node`, `python`, `ffmpeg`,
  Blender, Unreal, read-only `git`, `curl` **to this machine only**); writing
  inside the folder that agent was given; its own bookkeeping on the hub.
- **Blocked**: committing, pushing, installing software, deleting, admin
  rights, reaching another machine, piping the internet into a shell, editing
  the owner's checkout, and **any tool the policy has not heard of** — blocked
  by default, not by omission.

A blocked agent is told to call `agent_note` with `blocked: true`, so the
refusal reaches the owner's screen instead of becoming a silent failure.

Two things that a real unattended run found, and which the tests now pin:

- On Windows the agent reaches for the **PowerShell** tool, not Bash. A policy
  that only knew about Bash refused everything — safe, but useless.
- **Redirection** (`node x.mjs > C:/dev/app/src/page.tsx`) runs an allowed
  program and still overwrites a file. Checking only the program misses it.

### Powered by

Each agent runs on the model picked in its **Powered by** dropdown. The brief
carries it as `POWERED BY: <pick>`, and `harness-models.mjs` is the one place
that turns it into a model and a login:

| Pick | Runs on |
|---|---|
| `default` | your Claude plan, Claude Code's default model |
| `claude-subscription:claude-opus-5-5` (etc.) | your Claude plan, that model |
| `openrouter:anthropic/claude-opus-5.5` (etc.) | the Claude API through OpenRouter, paid per token on your key |
| `deepseek` | the DeepSeek harness (dsh) — always through the bridge, below |

The OpenRouter picks need **`OPENROUTER_API_KEY`**, either in the environment
of whatever starts the runner and the bridge, or in the repo's `.env.local`
(read from there, never copied). Without it the run doesn't start, and the
agent is handed back with that sentence on it.

### Agents that edit your apps — need the bridge running

An agent with `EDITS APPS: …` in its brief (or one powered by DeepSeek) does
**not** run in the runner's own process. It runs as a **harness thread in the
bridge**, in a git worktree of this repo, so you can read it in the Harness
console like any other thread and nothing touches the checkout you have open.

- The runner starts it with `POST /harness/start-unattended`, which needs the
  pairing token **and** `out/agents-secret.txt` — a fresh secret the bridge
  writes each time it starts and hands to nobody. A web page can't reach that
  route (it is refused outright when a request carries an `Origin`), because
  an unattended thread writes inside its worktree without asking.
- The thread follows `agents-unattended.mjs` with the worktree as its only
  write root. DeepSeek's adapter parks gates instead, so the runner answers
  each one by the same rules within seconds rather than letting it time out.
- When the turn ends (or runs past the time limit and is interrupted), the
  runner commits it: **`SHIP: review`** commits on the thread's branch and
  marks the agent blocked with "Changes are ready…" for you to land;
  **`SHIP: auto`** lands it and, if the merge went in, `git push`es the base.
  Auto falls back to review when the run timed out, when the agent marked
  itself blocked, or when your checkout has uncommitted work (landing never
  merges into a dirty base). The outcome is recorded with `agent_ran`, and the
  thread is kept, never discarded, so the work is always reviewable.
- **If the bridge isn't running**, the agent is handed back with "the PC helper
  (Jarvis bridge) isn't running…" and resumes on a later wake once it is.

### Limits worth knowing

- A lease is 20 minutes. `agent_note` renews it, so a long render must report
  progress or another machine may decide this one died.
- An agent without `EDITS APPS` will not change the owner's repo. One whose
  last step is "put it in the app" will block there, on purpose, and wait for
  a human — or for you to give it the app in Jarvis.
- `AGENTS_MAX_RUNS_PER_HOUR` (default 8) stops a confused agent spinning all
  night. Drop a file named `agents-off` beside this one to pause it entirely.
