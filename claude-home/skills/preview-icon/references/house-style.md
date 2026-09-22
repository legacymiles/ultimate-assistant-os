# House style

A preview icon is never seen alone. It sits in a grid next to a dozen siblings, and the grid is
judged as one object. So the style is locked, and `plan.mjs` appends this block verbatim to every
prompt.

## The block

Appended to every prompt, after the subject, event, camera and hues:

```
Shot on a macro lens, shallow depth of field, single subject centred with generous empty margin.
Deep near-black background, no horizon, no set dressing. Lighting is a single soft key plus a hard
rim; the only colours in frame are the two named hues against black. High contrast, fine film
grain, no lens flare. One continuous camera move, no cuts, no speed ramps. Photoreal, physical
materials, tactile surfaces. Silent.
```

## Why each clause is there

**Macro lens, shallow depth of field.** Blurs whatever the model invents at the edges, which is
where generated video is weakest. It also makes a 512px clip feel intentional rather than cheap.

**Single subject, generous empty margin.** The clip is viewed at roughly 200px in a grid. Margin
is what lets the subject survive the downscale, and it gives the card room to breathe next to its
neighbours.

**Deep near-black background, no horizon, no set dressing.** Three jobs at once: the cards tile
against a dark hub without visible seams, the compressor spends its bitrate on the subject instead
of background detail, and the model is denied the empty space it would otherwise fill with
invented clutter.

**Single soft key plus hard rim.** A repeatable lighting setup is the strongest single signal that
separate renders belong together — stronger than colour, stronger than subject.

**Only the two named hues against black.** Ties each clip to the colour identity the app already
carries in `hue`, and keeps the grid from turning into a rainbow.

**High contrast, fine grain, no lens flare.** Contrast survives downscaling; flare is the most
common generated-video tell and reads as cheap.

**One continuous move, no cuts, no speed ramps.** A cut cannot be looped. Models insert them
readily whenever a prompt sounds like a sequence, so the instruction has to be explicit.

**Photoreal, physical materials, tactile surfaces.** Pushes away from the flat vector-motion look
that makes generated icons interchangeable.

**Silent.** The audio track gets stripped anyway, and asking for sound wastes model attention on
something no one will hear.

## Hues

Each catalog entry carries `hue: [h1, h2]` (0-360) already driving its CSS icon. `plan.mjs`
converts them to plain colour names and writes them into the prompt as light sources rather than
as paint:

```
lit by a deep amber key and a cold cyan rim
```

Naming them as *light* rather than *colour* matters. Ask for a "blue object" and you get a blue
object on a grey field; ask for a "cold blue rim light" and you get black, shape, and a blue edge
— which is the look.

The hue-to-name table lives in `scripts/plan.mjs` (`hueName`). Adjust it there if a colour reads
wrong; it is deliberately coarse, because precise colour names make video models literal-minded.

## What never appears

Enforced through the negative prompt on every render:

- Text, letters, numbers, watermarks, logos. Generated text is always garbage and instantly dates.
- Interfaces: app windows, browsers, screens, monitors, phones, buttons, menus, cursors. This is
  the core rule of the skill — see "depict the verb, not the screen" in SKILL.md.
- Human faces and hands. Faces are uncanny at small sizes and drag the icon toward stock footage;
  hands are where generated video fails most visibly.
- Fast cuts, camera shake, zoom blur. All three break the loop.

## Changing the style

The style is locked, not sacred. If you change it, re-render **every** icon — a grid with two
house styles in it looks like a mistake, while a grid with one unusual house style looks like a
decision. Keep the previous assets until the full set is regenerated and compared.
