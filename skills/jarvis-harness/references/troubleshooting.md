# When something is wrong

By symptom, because that is what you have. Every entry is a failure that actually
happened.

---

## "A model shows as unavailable"

Not a bug. `harness/list` checks each harness independently and returns the
reason. There are two, and each one is its own fix:

**Claude** — `The Claude Agent SDK is not installed — run \`npm install\` in tools/jarvis-bridge.`
The bridge imports `@anthropic-ai/claude-agent-sdk` and it is missing.

**DeepSeek** — `dsh is not installed at <path>. Install @deepseek-ai/dsh there, or set DSH_DIR.`
The folder at `DSH_DIR` (default `C:/Users/honey/deepseek-harness`) does not
exist. Either install dsh there or point `DSH_DIR` at the real copy.

They are **peers**. One being unavailable does not stop the other, and a run on
DeepSeek touches no Anthropic code at all. If a surface reports "the harness is
unavailable" without naming which or why, the surface is wrong, not the bridge.

---

## "The thread will not start at all"

In order:

1. **Is the bridge running?** `GET /health` with no token. If nothing answers,
   nothing else matters — run `start.cmd`.
2. **Is this browser paired?** `/health` answers but every other route 401s. Run
   `pair.cmd`. The symptom on the page is "Running, but New Jarvis is not paired
   with it yet."
3. **Did the worktree fail to cut?** The error names it. Usually the base branch
   has a lock, or a previous worktree of the same name was deleted by hand
   without `git worktree prune`.

---

## "DeepSeek shows a red failed step above the one that worked"

Expected, and already handled — if you are using `reduceEvents`.

dsh runs under `DSH_PERMISSION_MODE=read-only`, which is the **only** mode in
which it asks about a write at all. Out of the box it asks nothing: its default
preset is `workspace-write` and a write inside the session folder is simply
allowed. So the sequence is: deny once → the model retries the identical call
with `sandbox_permissions` set → *that* retry raises the permission request.

Drawn literally, every DeepSeek edit looks like a broken harness. `reduceEvents`
folds the denial into the retry as `escalating`. If you see the double step, you
are drawing raw events instead of the fold. Do not "fix" it by loosening
`DSH_PERMISSION_MODE` — that does not make the thread gate less, it makes it not
gate.

---

## "The transcript has a hole in it"

The reader's cursor fell behind the 6,000-event ring. `harness/events` returned
`dropped: true` and the surface patched instead of resetting.

**Fix:** on `dropped`, set the view to `emptyThread` and the cursor to 0, and
re-ask. A reload is honest; a hole that nothing afterwards reveals is not.

---

## "A gate never arrives" / "the thread is stuck on waiting"

A gate is a parked promise — the child's permission hook is blocked on it, so a
thread in `waiting` is a thread where **nothing has happened yet**. That is the
correct state, not a hang.

If the card is not on screen: the page is reading `session.gate` from a stale
poll, or it answered and dropped the new `gate` event. `threadStatus` returns the
live `pendingGate`; re-read it.

If nobody answers, it **refuses** after 20 minutes and emits `gate_done` with
`how: "timeout"`. A timeout is a no, never a yes.

Answering an already-answered gate returns `{ stale: true }`. That is normal —
two tabs, or a tap on an old card — and is not an error to show.

---

## "A port is held by nothing visible"

`child.kill()` was used on a preview server somewhere, or the bridge was killed
with `taskkill /F` on its own PID only.

Under `shell: true`, `npx next dev` is cmd.exe → node → next. Killing the shell
leaves next alive, holding the port, parented to nothing. Nothing in Task
Manager's tree view explains it.

**Fix now:** `netstat -ano | findstr :3311` for the PID, then
`taskkill /PID <pid> /T /F`.

**Fix in code:** `harness-preview.mjs` already uses `taskkill /T`. If you add
another spawner, do the same.

---

## "The preview is a connection error"

Check `ready` from `harness/preview`. `ready: false` means the port had not
answered within 180 seconds — a cold worktree's first Next compile can exceed
that legitimately. Keep polling the URL and show "still compiling".

If the server **exited**, the error carries the tail of its log. Read it: the
common causes are a syntax error the lane just wrote, and a missing dependency it
added to `package.json` without installing (it cannot install — `node_modules` is
a junction to the main checkout and `npm install` is a `grave` gate).

---

## "Landing says it did not merge"

Read `why`. Landing commits on the branch and merges **only** when the base
checkout is clean; `why` names the files that stopped it. This is the designed
outcome, not a failure — the branch exists and holds the work. Commit or stash
the base and merge by hand, or land again.

This matters more in this repo than most: several Claude sessions run on this one
folder, so the base is dirty with somebody else's work most of the time.

---

## "A thread vanished"

Threads live in the bridge process's memory. A bridge restart ends all of them,
and `mustGet` then answers 404 with *"No such harness thread. It may have ended
with the bridge."*

The **worktree and branch survive** — the thread is gone, the work is not. Find
it under `~/.jarvis-harness/worktrees` and merge the branch by hand.

---

## "A lane died mid-build"

Keep it on screen with its error. The question "why did this skill's lane fail"
is itself a result of a bake-off, and a lane that silently disappears or restarts
destroys it.

Check its `error` events and, if it got far enough, its diff — a lane that failed
after writing ten files tells you something different from one that failed on the
first tool call.

---

## "It edited my real checkout"

This should be impossible and is worth treating as serious.

Every write passes `autoAllow` in `harness-gate.mjs`. With `laneWrites`, a write
is auto-allowed **only** when `insideWorktree(path)` is true — and that rejects
absolute paths, UNC paths, and any relative path containing a `..` segment
(`src/../../../.env.local` is the case it exists for). Shell commands are never
auto-allowed, because a command can write anywhere.

If it happened: `src/lib/new-jarvis/harness/lane-policy.test.ts` is the test for
exactly this. Add the path that got through as a failing case before changing
anything.
