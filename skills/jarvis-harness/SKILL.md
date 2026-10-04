---
name: jarvis-harness
description: >
  Hand real coding work to a background agent — Claude Code or DeepSeek (dsh) — running in its own
  git worktree on this machine, driven from a web page or from a Claude Code session, with every
  risky step stopping at a gate the owner answers and a landing step that commits or throws the work
  away. This is the "Jarvis harness", the "Claude DeepSeek harness", the "super agent brain harness":
  the thing that lets an app in the hub BUILD something instead of printing a prompt for someone to
  paste. Use this WHENEVER work should be done by a background agent rather than in this
  conversation; whenever a feature needs to kick off a build, a refactor or a redesign from a button;
  whenever several agents must work at once without touching each other's files (bake-off lanes,
  parallel builders, a gauntlet squad); whenever a thread needs its work served so it can be clicked
  through; and whenever something about a harness is WRONG — a model shows as unavailable, a thread
  will not start, DeepSeek shows a failed step above the one that worked, a transcript has a hole in
  it, a gate never arrives, a port is held by nothing visible, or a lane dies mid-build. Also use it
  before adding any new surface that drives a harness, so the new surface reuses the one event model
  rather than inventing a second.
---

# The Jarvis harness

A coding agent that is not in this conversation. It lives in the local bridge
(`tools/jarvis-bridge`), works in its own git worktree, talks while it works,
stops for permission on anything that cannot be undone, and ends by either
committing its branch or being thrown away whole.

The point of it: an app can **build** something. Before this, every app in the
hub that involved code could only produce a prompt for the owner to paste into
Claude Code by hand. A page that can start a thread closes that gap.

## The two models are peers, not a primary and a fallback

| | Claude | DeepSeek |
|---|---|---|
| id | `claude` | `deepseek` |
| needs | `@anthropic-ai/claude-agent-sdk` in `tools/jarvis-bridge` | `dsh` installed at `DSH_DIR` (default `C:/Users/honey/deepseek-harness`) |
| route in | Agent SDK, in-process | a child process speaking Agent Client Protocol on stdio |
| costs | per token, reported per turn as `usd` | the owner's own dsh setup |

`listHarnesses()` checks the two **independently**. Either one being missing says
nothing about the other, and a run works end to end on whichever is installed.
So:

- **Never** describe DeepSeek as what happens when Claude is unavailable. A
  bake-off, a build, a refactor — all of it runs entirely on dsh if that is what
  is installed, and entirely on Claude if that is.
- **Never** hide an unavailable harness. Grey it and print its `why` string
  **verbatim**: those strings are written to be actionable (`run npm install in
  tools/jarvis-bridge`, `install @deepseek-ai/dsh there, or set DSH_DIR`). A
  picker that silently omits a model teaches the owner the feature is broken.
- A thread is steered **from a page or from a Claude Code session** — that is
  about where the instructions come from, and is a separate question from which
  of the two models is doing the work. Do not conflate them.

## The shape

```
POST /harness/start   → a thread: a worktree, a branch, a child process
POST /harness/say     → a turn
POST /harness/events  → everything since a cursor
POST /harness/decide  → answer the one parked gate
POST /harness/preview → serve this worktree on a port
POST /harness/land    → commit the branch, merge if the base is clean
POST /harness/discard → stop it, delete the worktree and the branch
```

Three design facts that any new surface has to respect, because the obvious
alternatives were tried and failed:

**Events are polled from a ring with a monotonic cursor, not streamed.** A
long-lived SSE response cannot carry the bridge's token (the browser will not
set a header on `EventSource`) and dies silently when the laptop sleeps, which
is this machine's normal state. Polling survives a sleep, a reload, and a second
device reading the same thread.

**`dropped` is the field that matters on a poll.** A reader whose cursor predates
the ring cannot be caught up. Quietly handing it the oldest kept events leaves a
hole mid-transcript that nothing afterwards reveals, so `dropped` means *reset
the view*, not *patch it*.

**A gate is a parked promise, not a question in the transcript.** The adapter's
permission hook is blocked on it, so when the card appears nothing has happened
yet, and if the card is never answered nothing ever happens. It times out after
20 minutes by **refusing**. This is the only arrangement in which "I approved it"
and "it happened" cannot come apart.

## The gate

`autoAllow()` in `harness-gate.mjs` is the whole policy, asked by both adapters
so they cannot drift:

- **reads pass.** Gating them is one tap per file the model opens, which trains
  the owner to stop reading the gates that matter.
- **`strict: true` gates everything,** reads included. For a thread not yet
  trusted.
- **`laneWrites: true` additionally passes a write whose path is inside the
  thread's own worktree.** For parallel lanes, where gating every write is
  several hundred taps and the gate becomes decoration. Off by default, never
  inferred — a caller asks for it.

What `laneWrites` still stops, and these are the point of it: anything that
**runs** (a shell command writes wherever it likes, and `npm install` reaches the
`node_modules` junction the main checkout shares), anything from an **MCP
server**, and any write that resolves **outside** the worktree — which is the
exact event the worktree exists to catch.

`risk: "grave"` is reserved for deleting, pushing and changing packages. Do not
widen it: a gate that shouts at every edit is a gate nobody reads.

## The worktree

Each thread gets one under `~/.jarvis-harness/worktrees`, on its own branch cut
from the base. Three details are load-bearing:

- They live **outside the repo**, because the repo's Desktop path is redirected
  into OneDrive and a worktree inside it hands OneDrive a second full tree to
  fight the compiler over.
- `node_modules` is a **directory junction** back to the main checkout — not a
  copy, not an install. Without it `npx tsc` and `npx vitest` do not run, so the
  harness cannot check its own work. **`.next` is NOT shared**, which is what
  makes a per-worktree dev server safe.
- `.env.local` is **copied**, never junctioned. A harness that truncates a
  junctioned env file has deleted every key on the machine.

Landing **never merges into a dirty base**. It commits on the branch and merges
only when the base checkout has nothing to lose; when it stops, it names the
files that stopped it.

## Serving a thread's work

`POST /harness/preview {id, port}` runs the repo's own
`scripts/dev-preview.mjs <port> --no-auth` with its cwd set to the worktree. Use
that script rather than `next dev` directly — it already sets the separate
`NEXT_DIST_DIR`, the separate data directories and the blank app password, so a
preview can never write into the real store or hold the sign-in wall up.

It is idempotent: asking twice returns the server already running. It waits for
the port to actually **answer** before reporting ready, because Next's first
compile in a cold worktree is tens of seconds and a framed port before then
reads as a broken build.

Stopping it uses `taskkill /T` on Windows. `child.kill()` is not enough: under a
shell, `npx next dev` is cmd.exe → node → next, and killing the shell leaves
next alive holding the port.

## Driving a run from a page

Use `useHarness` (`src/lib/new-jarvis/harness/useHarness.ts`) for a single
thread. For several at once, compose the same bridge calls and fold each lane
with the **existing** `reduceEvents` — do not write a second reducer. See
`references/driving-a-run.md`.

Rules for any surface that drives this:

1. **Assume the bridge is off**, because most of the time it is. Say so plainly
   and offer the briefs or prompts for pasting. Never 500, never a dead button.
2. **Show the harness toggle and the `why`.** Per the above.
3. **A failed lane stays on screen** with its error text. Not retried silently,
   not removed — a disappearing lane is a result the owner cannot review.
4. **Never auto-discard.** Landing one thread and discarding its siblings is one
   confirm, shown as what it deletes.
5. **Poll by status, not by clock** — reuse `pollEvery`. With several lanes,
   round-robin so N lanes do not cost N times the requests.

## Driving one from a Claude Code session

The bridge is HTTP on `127.0.0.1:42020` and needs its pairing token. From a
session, `curl` it directly, or read `tools/jarvis-bridge/README.md` for the
token's location. Starting a thread from inside a session is the right move when
the work should proceed **without** this conversation holding it open — a long
build, or something to be watched from a phone.

## When something is wrong

Read `references/troubleshooting.md` before guessing. Every entry there is a
real failure with its real symptom: a model showing unavailable, DeepSeek drawing
a failed step above the one that worked, a transcript with a hole in it, a gate
that never arrives, a port held by nothing visible, a thread that vanished on a
bridge restart.

## Reference

- `references/protocol.md` — every route, every event kind, and the exact fold
  from events into turns.
- `references/driving-a-run.md` — a multi-lane run, end to end, in the shape the
  Redesigner's bake-off uses.
- `references/troubleshooting.md` — failures by symptom.
