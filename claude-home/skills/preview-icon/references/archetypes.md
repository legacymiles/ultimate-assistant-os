# Archetypes — deciding what the clip shows

Every preview icon resolves to exactly one of five archetypes. This is the decision layer: it
turns "make a video for this app" into a specific, filmable event.

Contents:
- [Why archetypes rather than judgement](#why-archetypes-rather-than-judgement)
- [Picking one](#picking-one)
- [The five](#the-five)
- [Prompt assembly](#prompt-assembly)
- [Worked examples](#worked-examples)
- [Failure modes](#failure-modes)

## Why archetypes rather than judgement

Clips get generated weeks apart, for apps that have nothing in common, by a model with no memory
of the last one. Left to free judgement, each prompt drifts toward whatever the description
suggests and the grid ends up a bag of unrelated stock footage.

An archetype fixes the *shape* of the shot — how many objects, what they do, where the camera is,
how the motion resolves — while leaving the *subject* free. That is the split that keeps a set
coherent without making it monotonous.

## Picking one

Read what the app does and find its verb. The verb picks the archetype, not the category.

| If the app... | Archetype |
|---|---|
| takes one thing and returns a different thing | Transformation |
| gathers many things and puts them in order | Accumulation |
| examines a thing and reports something about it | Interrogation |
| produces something where there was nothing | Emission |
| is a place you move through | Inhabitation |

Two tie-breakers worth knowing, because they come up constantly:

- **Transformation vs Emission.** If the user brings an input, it is Transformation. If the user
  brings only words, it is Emission. Image Studio takes your photo (Transformation); Music Creator
  makes a song from a description (Emission).
- **Interrogation vs Accumulation.** If the output is a *judgement* about the items, it is
  Interrogation. If the output is the items, *arranged*, it is Accumulation. AI Rankings scores
  (Interrogation); Dashboard files (Accumulation).

When an app honestly does two, pick the one a stranger would name first. The icon has 2.5 seconds
and one job.

## The five

### Transformation

**The event:** one subject, already in frame, visibly becomes something else. A single continuous
change with a clear before and after.

**Camera:** locked off or a slow push. The subject is doing the work; moving the camera too steals
attention from the change.

**Resolution:** the change completes, then settles, so the loop point lands on stillness.

**Subject vocabulary:** paper becoming glass, sketch becoming solid, matte becoming polished,
fractured becoming whole, monochrome flooding with colour, coarse becoming fine.

### Accumulation

**The event:** many small identical things, scattered and drifting, converge into a single ordered
form — a stack, a grid, a column, one object.

**Camera:** slow pull back, so the order is revealed as the frame widens. This is the one
archetype where pulling back is worth it, because order only reads once you see the whole.

**Resolution:** the last piece lands. Hold.

**Subject vocabulary:** cards, tiles, receipts, slips, shards, motes, leaves, coins. Identical
objects read as "many"; varied objects read as "mess".

### Interrogation

**The event:** one subject sits still while something sweeps across or through it — a scan line, a
band of light, a grid, a ripple — leaving marks, highlights or a readout in its wake.

**Camera:** locked off. The sweep supplies all the motion the shot needs.

**Resolution:** the sweep exits frame and the marks fade, which loops cleanly by construction.
This is the most reliably loopable of the five; prefer it when an app is ambiguous.

**Subject vocabulary:** a sweeping plane of light, a travelling grid, a ripple front, a band of
scan lines, concentric rings expanding from a probe point.

### Emission

**The event:** an empty, dark frame. Form condenses out of nothing — particles gathering, light
knitting into shape, liquid rising into a solid.

**Camera:** locked off or the gentlest drift. Emptiness is the whole first beat; do not fill it.

**Resolution:** the form reaches coherence and holds for a moment before the loop restarts, so the
cycle reads as breathing rather than stuttering.

**Subject vocabulary:** particles, filaments, smoke coalescing, liquid metal rising, light
threading itself into a shape.

### Inhabitation

**The event:** a camera moves through a real place. Nothing transforms; the space is the subject.

**Camera:** one continuous travelling move — forward, or a slow arc. Never a cut. Cuts cannot loop.

**Resolution:** end where you began, or on a symmetrical framing, so the wrap is not jarring.

**Subject vocabulary:** corridors, tracks, terrain, interiors, a vehicle, a figure seen at
distance. This is the archetype that earns MiniMax H3.

## Prompt assembly

Build every prompt in this order. The structure matters because video models weight early tokens
most heavily, and the subject is what has to survive.

```
<subject, concrete and singular>
<the event, in one clause, using the archetype vocabulary>
<camera behaviour for that archetype>
<the two hues, named as light sources>
<house style block, appended verbatim from house-style.md>
```

Two constraints to carry into every prompt, because they are what make the file usable rather
than merely pretty:

- **One continuous move, no cuts.** A cut cannot be looped and the model will happily insert one
  if the prompt implies a sequence.
- **Subject large in frame, generous empty margin.** The clip is seen at 200px. A subject that
  fills a third of the frame disappears; a subject that fills two thirds survives.

Negative prompt, on every render:

```
text, letters, words, numbers, watermark, logo, user interface, app window, browser, screen,
monitor, phone, buttons, menus, cursor, human face, hands, crowd, fast cuts, camera shake, zoom blur
```

`screen` and `monitor` are in there deliberately. Without them the model reaches for a glowing
rectangle the moment a prompt sounds like software, which is exactly the failure this whole skill
is built to avoid.

## Worked examples

Each is the subject-and-event portion; `plan.mjs` appends camera, hues and house style.

**Music Creator — Emission.** A single studio condenser microphone in a dark room, dust suspended
in a narrow beam; a waveform of light blooms outward from it in slow concentric rings, resolving
into a steady pulse.

**Multi-Order Calculator — Accumulation.** Dozens of small paper receipts drifting in dark space,
sliding together edge to edge and collapsing into a single clean stack that settles flat.

**Website Redesigner — Transformation.** A rough paper wireframe sheet lying flat; ink and creases
dissolve as the sheet turns to polished glass, edges catching a hard rim light.

**AI Rankings — Interrogation.** A row of identical matte blocks standing in a dark field; a band
of light sweeps across them left to right, and in its wake each block rises to a different height.

**God's Eye View — Interrogation.** A dark planet turning slowly; a thin sensor sweep crawls across
the terminator, illuminating fine terrain detail that fades behind it.

**Slippery Escape — Inhabitation.** A low forward camera move down a wet, dimly lit concrete
corridor, reflections stretching along the floor, an opening ahead growing closer.

**Skills Library — Accumulation.** Identical blank cards fanning out across dark space into a tight
grid; one card lifts slightly and catches the light.

**Voice Studio — Transformation.** A smooth column of liquid metal standing upright; it ripples
from the base upward and resolves into a crisp faceted form.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Garbled text crawling over everything | prompt implied software or a document | strengthen the negative prompt; make the subject a physical object |
| Reads as a generic abstract loop | subject too vague ("data", "energy", "ideas") | name a real object with a material |
| Unreadable at 200px | too many objects, subject too small | one subject, two thirds of frame |
| Visible jump at the loop point | the event was still moving at the cut | end on stillness; `finish.mjs` crossfades, but it cannot rescue motion mid-stride |
| Looks like a different product's icon | ignored the app's hues | pass `hue` from the catalog entry |
| A cut appeared mid-clip | prompt described a sequence of beats | collapse to a single continuous event |
