---
name: hub-v2-carousel
description: "Hub v2 — the rotating panel-stand carousel at / (?v=2), a second view of the same catalog alongside the untouched v1 gallery; the squeeze/wedge motion model and the one-live-iframe rule"
metadata: 
  node_type: memory
  type: project
  originSessionId: 03d9bc70-109b-4ba3-a594-233b0431a2d9
  modified: 2026-09-07T15:24:22.276Z
---

Added 2026-09-07. The hub home (`/`) now has **two** layouts, chosen by a small V1/V2 toggle top-right (`src/components/hub/HubShell.tsx`). See [[ultimate-assistant-os-portfolio]].

**v1 is untouched and is still the design everywhere else on the site.** v2 is a second *view of the same `catalog.ts`*, never a rewrite — it has its own stylesheet (`src/app/hub-v2.css`, imported by globals but sharing nothing) so v1 cannot inherit a line of it. Preference persists in `localStorage["hub:version"]`; `?v=1` / `?v=2` overrides it so a link can name a version. Version resolves client-side after mount (rendering v2 on the server would mean guessing a value the server can't read).

**The motion model** (`v2/useCarousel.ts`) — modelled on a desk rotary card file. Two numbers, neither constant:

- `squeeze` — how tightly the whole ring packs. 0.55 at rest, 0.30 spinning. Never 1: that is what makes the off-focus panels read as the *edges of stacked pages* rather than smaller flat cards.
- `push` (42°) — a wedge opened at the focus only, via `tanh(d/9)` so it saturates instantly and shoves everything that is *not* the focus. Big on purpose: it tips the neighbours onto a steep angle, and past ~6 panels a side it carries them beyond 90° where backface-culling retires them. That self-limiting fan is the "open book" look the user asked for.

Requested behaviours that are load-bearing, all verified in-browser:
1. **Arrows step exactly one.** They set an exact `target` rotation and spring to it, queueing off the *pending* target — injecting velocity instead made "next" skip 2–3.
2. **Hover-to-spin.** Cursor right of centre spins forward, left spins back, with a 34%-wide dead zone in the middle so the ring can rest. Excluded for `pointerType === "touch"` (a finger has no hover).
3. **Physics is delta-time**, not per-frame — frame-counted friction makes the same flick travel twice as far on a 144Hz screen.

**Two rules that are also performance rules:**
- Only the FOCUSED panel, only once SETTLED, mounts heavy content — one live iframe of the real app (`previewFor()` derives this; gated apps `recall`/`projects-timeline` are excluded). 27 iframes would melt a laptop, and "you only see the full page when you stop" is the intended feel — constraint and design agree.
- The rAF loop writes `transform` straight onto panel nodes via refs; React state publishes only when focus/settled/dragging change.

**Gotcha worth keeping:** opacity and filter go on the inner `.hubv2-panel__sheet`, never on `.hubv2-panel`. Both properties flatten an element out of its parent's `preserve-3d` context, and a flattened panel composites in DOM order instead of by depth.

Video panels are supported (`preview: { kind: "video", src: "/hub/x.mp4" }`) but no clips exist yet — live app iframes are the default.
