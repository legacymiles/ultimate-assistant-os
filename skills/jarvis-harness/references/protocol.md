# The protocol

Everything here is what the bridge actually sends, read off
`tools/jarvis-bridge/harness.mjs` and `src/lib/new-jarvis/harness/`. Where a
field exists only to prevent a specific wrong drawing, that is said.

## Transport

Every route is `POST` to `http://127.0.0.1:42020`, JSON in and JSON out, with
`Authorization: Bearer <token>` on all of them except `/health`. The token lives
in `tools/jarvis-bridge/out/token.txt` and reaches a page through `pair.cmd`,
which puts it in `localStorage` under `new-jarvis:bridge-token`.

From a page, go through `call()` in `src/lib/new-jarvis/bridge.ts` — it attaches
the token, and it fails with a sentence the owner can act on rather than a
status code.

## Routes

### `harness/list`
No body. Returns what this machine can run.

```json
{
  "harnesses": [
    { "id": "claude",   "label": "...", "blurb": "...", "available": true,  "why": "" },
    { "id": "deepseek", "label": "...", "blurb": "...", "available": false, "why": "dsh is not installed at …" }
  ],
  "worktreeRoot": "C:/Users/honey/.jarvis-harness/worktrees",
  "defaultRepo": "C:/Users/honey/OneDrive/Desktop/claude code files"
}
```

`why` is written to be shown verbatim. There are exactly two:

- `The Claude Agent SDK is not installed — run \`npm install\` in tools/jarvis-bridge.`
- `dsh is not installed at <DSH_DIR>. Install @deepseek-ai/dsh there, or set DSH_DIR.`

Never paraphrase them into "unavailable". The string is the fix.

### `harness/start`

```json
{ "harness": "claude" | "deepseek", "title": "...", "repo": "...", "strict": false, "laneWrites": false, "model": "" }
```

Returns `{ session }`. Starting an unavailable harness fails with **that
harness's `why` as the error message**, status 400 — so a surface that shows the
error already shows the fix.

`repo` defaults to `JARVIS_REPO`. `model` is Claude-only; dsh picks its own.

### `harness/say`

`{ id, text }` → `{ ok, cursor }`. Fails 409 on an ended thread. Text is sent to
the child as a turn; the answer arrives through events, not here.

### `harness/events`

`{ id, since }` → `{ events, cursor, dropped, session }`.

`events` are everything with `seq > since`. **`dropped: true` means reset the
view and re-ask from 0** — the reader's cursor predates the ring (6,000 events)
and cannot be caught up. Patching instead leaves a hole mid-transcript that
nothing afterwards reveals.

### `harness/decide`

`{ id, gateId, allow }` → `{ ok, stale }`. `stale: true` is **normal**, not an
error: two tabs, or a tap on a card already answered.

### `harness/preview` · `harness/preview/stop`

`{ id, port }` → `{ port, url, pid, ready, reused }`.

`ready: false` is not a failure — Next's first compile in a cold worktree can
outlast the 180s wait. Keep showing "still compiling" and poll the URL.
Asking twice returns the running server (`reused: true`) rather than starting a
second one.

### `harness/status` · `harness/diff`

`status` → `{ session, work }`. `diff` → `{ patch, truncated, work, session }`.
`work` is `{ exists, files[], added, removed, dirty }` from `git status` in the
worktree. The patch is clipped at 180,000 characters and says so.

### `harness/land`

`{ id, message, merge, attribution }` → `{ committed, merged, sha, why, ... }`.

It commits on the branch, and **merges only when the base checkout is clean**.
`merged: false` with a populated `why` is the expected outcome on a dirty base —
show the `why`, which names the files that stopped it. This is not an error.

### `harness/discard`

`{ id, keepBranch }` → `{ ok }`. Stops the child, refuses every parked gate,
stops the preview server, removes the worktree and (unless `keepBranch`) deletes
the branch. **Irreversible — always behind a confirm that says what it deletes.**

### `harness/threads`

No body → `{ threads: [summary] }`. Threads are held in memory and are lost on a
bridge restart. That is the honest lifetime; a surface should say so rather than
showing a thread that no longer exists.

## Events

One flat, append-only stream per thread. Every event has `seq` (monotonic) and
`at` (ms). **Unknown kinds are ignored, never thrown** — that is what lets the
bridge add a kind without breaking a deployed page.

| kind | carries | note |
|---|---|---|
| `status` | `status`, `detail`, `model`, `sessionId` | `starting` → `ready` → `thinking` / `waiting` / `idle` / `ended` |
| `user` | `text` | the turn as sent |
| `text` | `text` | a delta. Concatenate. |
| `thinking` | `text` | a delta |
| `tool` | `callId`, `name`, `title`, `kind`, `path`, `command` | a call started |
| `tool_end` | `callId`, `status`, `output` | `ok` / `failed` |
| `allowed` | `name`, `title` | passed without asking |
| `gate` | the whole card | something is parked on an answer |
| `gate_done` | `gateId`, `allow`, `how` | `how`: `owner` / `timeout` / `stopped` / `discarded` |
| `turn_end` | `ms`, `usd` | |
| `usage` | `used`, `size` | dsh reports a context window; Claude does not |
| `plan` | `text`, `status` | |
| `note` | `text` | the worktree line, warnings, the preview URL |
| `error` | `text` | |

### The fold

`reduceEvents(prev, events)` in `model.ts` turns the stream into `{ turns[],
notes[], liveGate, usd, used, size, detail }`. Reuse it. It is tested, and three
of the things it does are not obvious:

**Text arrives twice.** Hundreds of deltas, and then the finished assistant
message. Appending both prints the answer a character at a time and then again
whole.

**dsh denies its own write before asking.** Under the read-only sandbox the first
attempt returns "file access denied … escalation available", the model retries
the identical call with `sandbox_permissions` set, and only *that* retry raises
the permission request. Drawn literally, every DeepSeek edit shows a red failed
step above the one that worked, which reads as a broken harness rather than one
asking politely. The denial is folded into the retry as `escalating`.

**It returns the same object when nothing changed.** The poll runs every few
hundred milliseconds and an empty batch must not re-render a long transcript.
