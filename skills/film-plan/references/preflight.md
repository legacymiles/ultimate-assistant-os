# The pre-flight gate

```bash
node scripts/preflight.mjs board.json          # a report
node scripts/preflight.mjs board.json --json   # the findings, for a UI
```

Exit code 1 means something blocking. The plan takes the shot list in either the API's
`snake_case` or the app's `camelCase`.

Two severities, and the distinction matters: **errors** are plans that cannot produce the film
they describe; **warnings** are plans that probably disappoint. Only errors fail the gate,
because a gate that cries wolf gets bypassed and then protects nothing.

## What each finding means

### ✗ Held pose — the action names no change of state

The shot describes a situation that already exists rather than something that happens, and a
situation renders as a still photograph. This is the largest single defect measured on real
films — on one, roughly a quarter of the running time was living photographs, including the
opening shot, which set the tone as "frozen" for six and a half seconds.

Fix by writing the event instead of the scene. Ask: what is true at the end of these seconds
that was not true at the start?

- ✗ "A baby sits on the living room rug drinking a bottle."
- ✓ "The baby stops drinking and turns toward a sound in the hallway."

The check is a smoke detector, not a critic — it looks for a verb that changes a state. It is
deliberately generous, so a shot it passes may still be weak, but a shot it flags is almost
always a photograph waiting to happen.

### ✗ Chain of N continued shots with no reference shot between

A continued shot inherits real frames from the one before it and therefore cannot also take
reference photos — the frames and the photos are two answers to the same question, and the model
splits the difference visibly. So across a chain, identity is held only by what was inherited,
and it drifts.

Measured on a real film: a three-shot chain running twenty seconds turned a Black toddler into a
fair-haired one, then snapped back at the next referenced cut, which read as the worst moment in
the film.

Fix by cutting back to a referenced shot sooner, or by anchoring the chain onto a known-good end
frame every few shots. Frequency beats strength — the drift is gradual.

### ✗ A cut with no references, in a film with a cast

A cut starts cold and re-invents the room, the light and the faces. With people in the film and
no reference named, whatever the pipeline substitutes is the face that renders — and pipelines
substitute silently. One real film ran its entire cast off a 180-pixel library thumbnail because
the cast sheet was empty and a fallback filled it without a word.

Fix by naming whose face the shot needs. If no adequate reference exists, that is the finding —
say so rather than rendering an approximation.

### ✗ `mood` is empty

`mood` carries the genre doctrine, and it is the field that decides whether a film is the kind
of film it claims to be. Empty, the genre reaches nothing; set to adjectives only, it reaches
the grade and stops, which produces a correctly lit film in which nothing of the genre happens.

Write both halves: how it is shot, **and** what it obliges to happen — what the opposing force
does, what the protagonist registers and loses, how the pressure rises, how it may end.

### ✗ Seconds outside the window

Most video models render a fixed window of a few seconds. Asking for thirty seconds in one shot
does not make a thirty-second shot exist; the request is silently reinterpreted and the plan's
arithmetic stops matching the film.

### ✗ N words in M seconds

Speech runs about two and a half words a second. A line that cannot finish inside its shot is
cut off at the source, and audio that was never generated cannot be recovered in the edit.
Lengthen the shot or shorten the line — this is a length problem, not a prompt problem.

### ! Only N of M cuts carry anything forward

Nothing here can read meaning, so this is a proxy: a plan where almost nothing is carried
between shots usually has no pressure curve. If you cannot say what a shot took away from the
protagonist, it is a held pose with a camera move on it, and the film will end where it began.

### ! Long shot with few beats

A shot given seconds and no clock fills them with a held pose. Give anything over about six
seconds a beat roughly every two seconds.

### ! A named move with no mechanics

"Dolly zoom" alone renders as a plain zoom, every time — the label reads as the ordinary move
its words describe. Write the travel distance, the focal length at each end, what stays locked
in frame and what the background does.

### ! No end frame

It is literally what the next shot is told to open on. Without it the next shot invents its own
starting point and the join stops being a join.

## What the script cannot check

These are the ones that need a person, and they are usually the ones that decide whether the
film is any good. Read the plan against them before rendering:

**Did every resource land?** Take the inventory from Step 1 of the skill and walk it. Each
upload, each saved character, each reference clip, each rail the owner touched, each chosen
workflow — find where it lives in the plan. Anything you cannot find is a decision you made for
the owner by accident.

**Is the opposing force described by behaviour?** Appearance alone renders as a person standing
in a room. What does it do that is *wrong* — the wrong speed, the wrong angle, a body doing
something a body should not?

**Does the protagonist register anything?** The audience takes its emotional temperature from
the character. A calm character in a frightening situation makes a calm film.

**Does the ending do what the genre obliges?** Or does it hand the audience relief that was not
earned? A horror film that ends on a sunlit lawn with everyone fine has resolved its tension and
become a different genre in its last shot.

**Does the light ever conceal anything?** If every room is fully visible, there is nowhere for
anything to be.
