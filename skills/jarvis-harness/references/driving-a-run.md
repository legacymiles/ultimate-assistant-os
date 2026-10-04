# Driving a run from a page

One thread, then several. The several-at-once shape is what the Website
Redesigner's bake-off uses: N lanes, each building the same brief with a
different design skill, each in its own worktree, compared side by side.

## One thread

`useHarness` already does this. Use it rather than re-deriving it:

```ts
const h = useHarness({ paired });

await h.start({ harness: "deepseek", title: "Rebuild the settings page" });
await h.say(brief);
// h.view.turns, h.gate, h.work, h.diff all follow on their own.
await h.decide(h.gate.gateId, true);
await h.land({ message: "...", merge: true });
```

## Several at once

Do **not** reach for a second `useHarness` per lane — it owns a cursor, a poll
timer and an "open thread" that fight each other N ways. Compose the same bridge
calls and keep one fold per lane.

```ts
import { call } from "@/lib/new-jarvis/bridge";
import { emptyThread, reduceEvents } from "@/lib/new-jarvis/harness/model";
import type { HarnessId, ThreadSummary, ThreadView } from "@/lib/new-jarvis/harness/types";

interface Lane {
  skill: string;              // the design skill this lane is testing
  id: string;                 // thread id, "" until it starts
  cursor: number;
  view: ThreadView;
  summary: ThreadSummary | null;
  port: number;
  url: string;
  error: string;              // shown, never swallowed
}
```

### Starting the lanes

Start them in sequence, not with `Promise.all`. Each start cuts a git worktree
from the same base, and git serialises on the index anyway — firing three at once
buys nothing and turns one failure into three confusing ones.

```ts
for (const lane of lanes) {
  try {
    const { session } = await call<{ session: ThreadSummary }>("harness/start", {
      harness,                        // whichever the owner toggled
      title: `${target.name} · ${lane.skill}`,
      laneWrites: true,               // see the gate section of SKILL.md
    });
    lane.id = session.id;
    lane.summary = session;
    await call("harness/say", { id: session.id, text: buildBrief(target, facts, lane.skill) });
  } catch (err) {
    // The lane stays in the list, carrying why. A lane that vanishes is a
    // result the owner cannot review.
    lane.error = (err as Error).message;
  }
}
```

### Polling

Round-robin one lane per tick rather than polling every lane on every tick. With
three lanes thinking, a per-lane 450ms poll is ~7 requests a second at the bridge
for no extra information.

```ts
const tick = async () => {
  const live = lanes.filter((l) => l.id && l.summary?.status !== "ended");
  if (!live.length) return stop();

  const lane = live[turn++ % live.length];
  const res = await call<{
    events: HarnessEvent[]; cursor: number; dropped: boolean; session: ThreadSummary;
  }>("harness/events", { id: lane.id, since: lane.cursor });

  if (res.dropped) {
    // Start over for this lane. A hole in a transcript is worse than a reload.
    lane.view = emptyThread;
    lane.cursor = 0;
    return;
  }
  lane.view = reduceEvents(lane.view, res.events);
  lane.cursor = res.cursor;
  lane.summary = res.session;
};

// Pace off the busiest lane, reusing the existing table.
const slowest = Math.min(...live.map((l) => pollEvery(l.summary?.status ?? "none") ?? Infinity));
```

### Serving each lane

One port per lane, assigned by the page, after the lane has stopped working —
not while it is still editing files.

```ts
const res = await call<{ url: string; ready: boolean }>("harness/preview", {
  id: lane.id,
  port: 3311 + i,
});
lane.url = res.url;
// res.ready === false just means Next is still compiling. Keep the pane in a
// "compiling" state and re-ask; do not report it as a failure.
```

A `409` from this route means the port is already held. Surface the message —
it names the port — rather than silently trying another, or two lanes end up
framed at the same build while the other is invisible.

### Picking the winner

```ts
await call("harness/land", { id: winner.id, message, merge: true, attribution });
for (const lane of lanes) {
  if (lane.id && lane.id !== winner.id) await call("harness/discard", { id: lane.id });
}
```

Both behind **one** confirm that names what it deletes. Never automatic: a
discard destroys a worktree and a branch, and the losing lane is often the one
with the idea worth stealing.

## The rules a surface must keep

1. **Assume the bridge is off.** `probe` never throws; `call` fails with a
   sentence. Grey the button, say why, and offer the briefs for pasting.
2. **Show the toggle and the `why` verbatim.** A greyed harness with no reason is
   a bug report the owner cannot file.
3. **A failed lane stays on screen** with its error. Not retried silently.
4. **Poll by status, round-robin across lanes.**
5. **One confirm before anything is deleted.**
