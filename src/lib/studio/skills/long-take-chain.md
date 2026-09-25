# Long-take chain

A way of BUILDING a stitched film, not a subject for one. Any story can be shot this way; what
this workflow fixes is the *shape* — how long each shot runs, how shots join, and what is anchored
by a picture rather than by a sentence.

**The whole thesis in one line: every defect in a stitched film happens at a join, so build the
film with as few joins as it can survive on.**

A 45-second film is either eight 5-second shots — seven joins — or three 15-second shots — two.
Same film. A quarter of the risk and a third of the renders. Measured on a real 8-shot film: a
character teleported across a cut, a hallway became a living room between two shots, and exposure
climbed 21% end to end. Every one of those happened at a join.

## What this workflow does differently

| | The ordinary way | Long-take chain |
|---|---|---|
| Shot length | 4–6 s, whatever the beat needs | **12–15 s**, the top of H3's window |
| Joins in 45 s | seven | **two** |
| Default `link` | `cut` | **`continuous`** |
| Anchored by picture | faces | **faces AND the set** |
| Work done by | cutting | **beats inside one shot** |

## Tool usage

| Tool | When |
|---|---|
| `studio_form` | Round 1 (the story), Round 2 (the shape), Round 3 (approval) |
| `studio_storyboard` | After Round 2 — the board is the deliverable |
| `studio_generate` | Only for a single ≤15 s piece with no joins at all |

## Round 1 — The story (form)

Ask what the film IS before deciding how it is built. `studio_form` "The film":

- `story` — "What happens, start to finish" — `textarea`, required
- `change` — "By the end, what is different?" — `text`, required
- `runtime` — `choice`: 15 s (one shot, no joins) · 30 s · 45 s · 60 s · 90 s+
- `cast` — "Who must stay recognisable, and do you have photos?" — `textarea` + `image`
- `place` — "Where does it happen? One place or several?" — `text`
- `look` — `choice` of 3–4 named directions you write from the story, never an open field

Pre-fill anything already said. Never ask twice.

## Round 2 — The shape (form)

This is the round that makes it this workflow. Show the owner the arithmetic, then let them choose:

- `shape` — `choice`, with the join count spelled out for THEIR runtime:
  - "Fewest joins — 3 shots of 15 s, 2 joins (recommended)"
  - "Balanced — 5 shots of 9 s, 4 joins"
  - "Cut like a trailer — 9 shots of 5 s, 8 joins"
- `cuts` — "Which moments must be a hard CUT rather than carrying on?" — `textarea`.
  Explain the cost in one line: a cut buys a new angle and re-invents where everyone is standing.
- `anchor` — `choice`: "Draw the set plate and cast sheets before rendering (recommended)" ·
  "Render from descriptions only"

Say what you recommend and why, in your message, in two sentences. Then build the board.

## Round 3 — The board, the gate, approval

Write the board, run the pre-flight gate, show the findings, and hand the sheet over. The owner
approves the drawn sheet, not the JSON. Then `studio_generate` is NOT used — the sheet renders the
film.

## Global constraints

**Shot length.** Plan at 12–15 s. Drop below that only when the CUT is the point: a reaction, a
hard insert, a beat that has to land alone. A shot that is short for no reason is a join you chose
to pay for.

**Beats do the cutting.** A 15-second shot needs a beat roughly every 2 seconds — seven of them.
That list is what a long shot uses instead of cuts: something is due at 0 s, something else at
2 s, and the shot cannot drift into a held pose because it has appointments to keep.

**`link` picks the engine.** This is the core of the workflow and it is not a stylistic note:

- `open` / `cut` → **Ref2VA.** Handed pictures: the cast sheets, the uploads, the set plate. No
  motion. It re-invents everything it is not shown a picture of — including the blocking.
- `continuous` → **FL2VA.** Handed the previous clip's real frames, so motion *and audio* cross
  the join. It inherits where everyone is standing, for free. But it takes **no reference
  pictures**, so identity is only what it inherited.

Default to `continuous`. Cut when the audience should feel a jump, and when the chain has run to
**two** — past that nothing is holding the faces and they drift.

**Anchor the room, not just the people.** The set plate is the location drawn empty and wide, and
it is attached to every shot that opens cold, exactly as a cast sheet is. A description holds a
space about as well as it holds a face, which is to say not at all.

**Generate longer than the slot.** A clip opens with a warm-up the model spends establishing the
shot — measured at 9× and 15× slower than the shot's own body over its first six frames. That head
gets trimmed, and trimming costs duration, so a shot that must PLAY for 14 s is PLANNED at 15.

**The film-wide fields are repeated word for word into every shot.** `mood`, `world`, `wardrobe`,
`lighting`, `grade`, `lens`, `look`. That repetition is the only reason separate generations read
as one film, and a paraphrase is a different film.

**Sound.** The render makes its own audio. Write `soundscape` always. Write `music` as `"none"`
for any film with a hard cut in it — a score described in the prompt is generated afresh by every
shot that reads it, so a film with cuts changes music at every join; the score belongs under the
finished edit instead, in one piece.

**The grade may not survive the render.** Measured: H3 at 832×480 renders a bright naturalistic
interior whatever the prompt says about crushed blacks and no fill light. Write the grade anyway —
it steers the drawn panels and the set plate — but expect to apply it to the stitched film
afterwards, where it is one filter chain and consistent across every shot by construction.

## Quality gate

Before the render, read the board and check:

- Is the average shot length **over 10 seconds**? If not, this is not this workflow.
- Does every shot over 6 s carry **at least three beats**?
- Is every `cut` one you could justify out loud to the owner as a moment they should FEEL?
- Is there a **set plate**, and a picture holding every face?
- Does no chain of `continuous` shots run past **two**?
- Does every shot name something that physically changes inside its own seconds?

After the render, measure before touching anything: `node scripts/continuity.mjs report *.mp4`.
The joins are usually not the worst defect — dead shots are — and fixing the wrong one costs an
hour of GPU.
