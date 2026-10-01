---
name: h3-long-story
description: Plan a film of 30 seconds to several minutes out of 5-second video-model generations so it reads as ONE film instead of a pile of clips. Use this WHENEVER someone asks for a short film, a story, a narrative sequence, a music video, a trailer, or says a finished cut "feels like different movies", "isn't consistent", "doesn't make sense" or "looks like random clips". Written after a 60-second horror short came back as twelve unrelated fragments with five different lead actors in it.
---

# H3 long story

> ### Which skill is this?
>
> **This is the STORY layer.** It sits above the prompting stack and decides the shape of the
> film before a single prompt is written.
>
> | | job |
> |---|---|
> | `h3-long-story` | **the film** — scenes, casting, continuity, what the cut has to survive |
> | `h3-stitched-film` | one scene — how many clips, how they chain, the action budget |
> | `h3-cinematic-prompt` | one clip — the sentences that go to the model |
> | `h3-scene-continuity` | measure what came back (`continuity.mjs`) |
>
> Work downward. A film planned here still has every prompt written by `h3-cinematic-prompt`.

Anything longer than about fifteen seconds is a **story problem**, not a prompting problem. The
prompts can all be good and the film still fail, and that is exactly what happened to the film
this skill was written from.

## The evidence this is built on

A 60-second horror short, twelve beats, each beat its own drawn still with the lead's photograph
attached, each prompt individually decent. Watched back at two frames a second:

| what was planned | what came back |
|---|---|
| one man, twelve beats | **five visibly different men** |
| a trolley rolls across frame and hits a pillar | a row of parked trolleys, motionless |
| light banks cut out one by one down the row | every light stays on for five seconds |
| he slams a crash bar with both hands, it bursts | he leans on a door with one hand |
| a creature drops down the stairwell shaft | a figure falls, then two bystanders appear, then an empty stairwell |
| a gaunt creature lunges at the lens | a four-armed cartoon gremlin, grinning, frozen for four seconds |
| his shaking hands at the lock | **a white man's hairy forearm** |

Nothing in that table is a wording failure. Every one is a planning failure, and each has a rule.

## The five laws

### 1. A cut costs identity. Chain, don't cut.

This is the whole skill in one line.

A reference photograph anchors **frame one** and then dissolves over the clip. Measured on a
single unbroken 5-second generation: the lead's face at 0.0s and at 4.5s are different men —
different nose, different jaw, different build. Nobody cut anything; the drift happened *inside*
one clip.

So every cut pays that cost again from scratch, and twelve cuts spent it twelve times.

> **Plan in SCENES of 2-4 chained clips, not in shots.** A chained clip inherits real frames from
> the one before it, so identity, wardrobe, light and location carry across the join for free.
> That is the only mechanism that holds a person together for longer than five seconds.

A 60-second film is **four or five scenes**, not twelve beats. Each scene is one location, one
continuous run of time, and 10-20 seconds long. Cuts happen *between* scenes, where the audience
expects a change anyway and drift reads as a new setup rather than a new actor.

### 2. Cast by shot size, not by face.

Identity survives in inverse proportion to how much of the person is in frame.

| shot | how the lead held up |
|---|---|
| hands, boots, back of a head | perfect — nothing to get wrong |
| over-shoulder, profile, backlit | good |
| mid-shot, face lit, frontal | **drifted inside the clip** |
| centred frontal portrait | drifted badly, and the shot was dead besides |

So **the fewer frontal face shots a film contains, the more consistent it looks.** Write the
face into two or three deliberate moments and shoot everything else off it — hands, shoulder,
silhouette, feet, reflection, the thing he is looking at.

The one shot in that film with no identity problem was a pair of boots. The one that put a white
forearm into a Black man's film was a close-up of hands, written without ever saying whose.

> **Every prompt that shows any part of a person names that person's skin, build and wardrobe —
> including the ones with no face in them.** A hand is a person. A prompt that says "close on his
> hands" has not cast anybody, so the model casts somebody.

### 3. Props do not act. Only what is already moving keeps moving.

`h3-stitched-film` records that nothing enters from off-frame. The longer finding is worse:

**Nothing in the world starts doing anything.** Not a trolley, not a light, not a door. A scripted
world event is the single most reliable way to lose a beat, and losing it silently is the problem
— the shot still renders, still looks fine, and the story point is simply not in it.

| written | rendered |
|---|---|
| a trolley rolls across frame and hits a pillar | trolleys, parked |
| the lights cut out one by one down the row | lights, on |
| bins crash down behind him | bins, already fallen, untouched |
| a windscreen bursts as a body lands on it | **this one worked** |

The one that worked was the one where the impact was **already underway in the drawn first
frame**. That is the rule:

> **Anything the world does must be visibly mid-event in the opening frame, or it will not
> happen.** Draw the still with the glass already breaking, the light already dark, the bin
> already tipping. The model finishes events; it does not start them.

If a beat needs a thing to *begin*, that beat is a cut to a new drawn frame, not a moment inside
a clip.

### 4. Creatures need a photograph, not adjectives.

*"A gaunt grey-skinned creature with milk-white eyes and bared wet teeth"* returned a grinning
four-armed cartoon that would not be out of place on a cereal box, held rigid for four seconds.
It is the shot that sank the film, and it sank it in the horror genre specifically, where one
unserious frame retires the whole thing.

Adjective stacks about a face are a request for the model's *average* of those adjectives, and the
average of horror adjectives on the open web is a Halloween mask.

> **Design the creature as a reference image first, look at it, and only then write shots.** Same
> as a human cast member. If the still is cartoonish, every clip made from it will be, and no
> prompt wording recovers it.

And keep the monster **partial**. Silhouette, a hand, a shape behind glass, a shoulder passing
the lens. The film's best horror frame was a shape pressed against frosted glass; its worst was
the same creature fully lit, centre frame, for four seconds.

### 5. Design the joins, don't discover them.

A cut between two shots that share nothing is what "it feels like different movies" means. Each
scene boundary needs at least one thing carried across on purpose:

- **camera hand-off** — scene A ends craning up behind him; scene B opens behind him, high
- **frame match** — A ends on a doorway shape; B opens on a doorway shape
- **motion match** — A ends with movement to screen-left; B opens moving screen-left
- **sound bridge** — B's soundscape starts under A's last second

Write the hand-off into the outgoing prompt AND the incoming drawn frame. It is not something to
find in the edit; by the edit there is nothing to find.

## Planning order

1. **Break the story into scenes**, each one location and one continuous run of time. A minute is
   four or five. If a scene exceeds ~20 seconds, split the location.
2. **Cast everything visually first** — one high-resolution portrait per human, one design still
   per creature, one plate per location. *Look at them.* Every one of them is the ceiling for
   every shot built on it. A 180x180 thumbnail cannot anchor a face; draw a large portrait from
   it first and use that.
3. **Write the shot list per scene** — clip 1 drawn and referenced, clips 2-4 chained. Mark each
   shot's SIZE, and count the frontal face shots. More than two or three in a minute is a
   consistency problem already written down.
4. **Write the hand-off** between each pair of adjacent scenes before writing the prompts.
5. **Draw scene one's opening frame and render scene one only.** Look at it. Everything downstream
   inherits its look. Stop here if it is wrong — this is the cheapest moment in the whole film to
   start again.
6. **Render the rest, one scene at a time**, checking the first clip of each.
7. **`continuity.mjs report` across every clip.** No `locked` landings, no `DEAD SHOT`, joins
   under ~1.5.
8. **Watch it.** At two frames a second on a contact sheet, six across — 30 frames is 15 seconds,
   so a minute is four sheets:

   ```bash
   ffmpeg -v error -ss 0 -t 15 -i film-cut.mp4 -vf "fps=2,scale=320:-1,tile=6x5" -frames:v 1 sheet-0.jpg
   ```

   Stills chosen by hand will flatter the film; a regular grid will not. Every failure in the
   table at the top of this file was invisible in the chosen stills and obvious in the grid.

## What a good scene looks like

```
SCENE 3 — the alley, 15s, three chained clips
  CAST     MAN — dark skin, freckles, black goatee, dark jacket over grey hoodie
  PLATE    alley-wet.png (drawn: brick, one bare bulb, bins already tipped, steam)
  HAND-OFF in:  scene 2 ends moving screen-left; this opens moving screen-left
  HAND-OFF out: ends on the shape of a doorway, held

  3a  drawn frame + MAN reference
      ACTION  he runs into the alley past tipped bins
      SIZE    wide, back of him — no face
      MOVE    the camera flies down the alley behind him
  3b  chained
      ACTION  he glances back over his shoulder without stopping
      SIZE    over-shoulder — the one face beat in this scene
      MOVE    the camera stays behind his shoulder
  3c  chained
      ACTION  he reaches a door at the end and hits it
      SIZE    wide, back of him
      MOVE    the camera keeps flying, the door filling frame
```

Three clips, one face beat, one location, both hand-offs written, every prompt short and plain.

## Reading the film back

| what you see | the law it broke |
|---|---|
| different people playing one part | 1 — cuts where scenes belonged |
| a face that changes inside one shot | 2 — too many frontal mid-shots |
| a story point that simply is not there | 3 — a prop was asked to act |
| a monster that is funny | 4 — adjectives instead of a design |
| "it feels like different movies" | 5 — no hand-offs |
| a shot that stops moving and waits | the action budget — `h3-stitched-film` |

## Related

`h3-stitched-film` — the scene: clip count, chaining mechanics, the action budget, joins.
`h3-cinematic-prompt` — the sentences. Plain captions, one action, a big plain camera move.
`h3-scene-continuity` — `continuity.mjs`, measuring a finished cut.
