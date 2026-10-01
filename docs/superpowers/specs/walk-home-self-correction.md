# WALK HOME — self-correction

A paste-ready correction prompt for the next pass at the 60-second zombie-chase
short, written after watching the 9-shot / 46-second cut at 2 fps with
frame-level passes on the two worst moments.

## What is already fixed — do not undo it

- **One man for the whole film.** Scenes of 2-3 chained clips, with cuts only at
  scene boundaries, held the lead's identity across 46 seconds and 5 locations.
  The previous 12-cut version had 5 different men. Keep the scene structure.
- **Casting by body part.** The close shot on a hand named his skin and cuff, and
  it came back a dark brown hand in a black cuff instead of the white forearm the
  previous film produced. Keep naming the person in every shot that shows any
  part of them.
- **The creature pre-placed in the alley plate** rather than entering from
  off-frame. Keep that; the arrival problem is solved even though the creature
  itself is not.

## The six corrections

### 1. Never end a shot on an empty frame

**What happened.** Shot 6 was written as "a hand slams the door bar and the door
swings out". The action completes, the hand leaves frame, and the shot ends on
two and a half seconds of empty wet street. Shot 7 chained off that empty frame,
had nothing to continue, invented a man from scratch, and rendered him as a
**3D cartoon** for a second and a half before morphing back to photoreal.

**The rule.** A chained shot inherits whatever the previous shot's last frame
contains. An empty last frame is not merely a weak handover — it is a blank
cheque, and the model spends it on a different style as readily as a different
face.

**The fix.** Every shot that is chained *from* must end with the subject visibly
in frame and still moving. Write the outgoing action so it is unfinished at the
cut: not "he pushes the door open" but "he pushes through the door and keeps
going". If a shot's action genuinely completes and exits, the next shot is a CUT
with its own drawn plate, never a chain.

### 2. Check the plate for the creature, not just for the face

The gaunt grey design was generated, reviewed and attached as a reference to the
alley plate. The plate drew **an ordinary man in a dark jacket**, and that is what
is in the film — he reads as a jogging partner, not a pursuer.

Designing the creature first is necessary and not sufficient. Review every plate
the creature appears in, against the design, before rendering — the same check
already applied to the lead's face. If the plate shows a normal man, redraw the
plate; no shot prompt recovers it.

Make the difference structural rather than adjectival: different silhouette
(taller, thinner, wrong proportions), different clothing (torn, soaked, wrong for
weather), different gait named in the prompt, and keep it in shadow.

### 3. Direct the chase, because nothing is threatening anybody

Across 46 seconds nothing closes in and nobody is afraid. One backward glance is
the only acknowledgement that anything is wrong. This is a directing failure, not
a model limit.

Per scene, write one explicit **threat beat** and one explicit **reaction beat**,
and put them in the prompt as plain actions:

- threat: something he can see is nearer than it was, or a sound makes him move
- reaction: he flinches, stumbles, drops something, looks back without stopping

Avoid anything that depends on closing distance over time, which is measured not
to render. Use a cut to show proximity instead: wide, then a much closer shot of
the same thing.

### 4. Check the plate's DIRECTION of travel, not only the shot size

The stairwell plate was written "going DOWN the stairs away from the camera" and
drew him **climbing up toward the lens**. He then ascends for ten seconds in a
scene whose job is descent.

The plate check is two questions, not one: is the face hidden as planned, **and
is he moving the way the story needs**. Verify both before rendering. Say the
direction twice in the plate prompt, once as the camera's view and once as his.

### 5. A back-view shot still needs an event

Shot 1 was flagged dead by the renderer: a still picture of a scene rather than
something happening in it. It is the shot redrawn to show the back of his head —
a man walking away from a slow crane has no event in it.

Hiding the face removes the thing the eye was tracking, so the shot must be given
something else to do: a world event already underway in the plate (a light dying,
water sheeting, a door swinging), a faster or larger camera move, or a shorter
duration. Fixing identity and fixing motion pull against each other, and both
have to be solved in the same shot.

### 6. Vary the pace

Roughly a third of the running time is one man moving through a space at one
speed in one register, and every shot is the same length. Give at least two shots
a visibly larger camera move, make one scene's shots noticeably shorter than the
rest, and cut one beat on an impact rather than on a completed action.

## For the skills

`h3-long-story` gains a sixth law — **a chained shot must inherit a frame with
the subject in it** — stated as the style risk, not just the continuity risk,
because the observed failure was a style collapse.

Its plate-review step becomes three checks rather than one: shot size, direction
of travel, and every non-human cast member against its design.
