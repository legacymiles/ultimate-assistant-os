# The director chat and selective redraw

A chat docked beside the sheet. The user says what to change in plain words — "make it night", "swap
cut 2 and 3", "add a close-up of the baby laughing", "lose the second character" — and the model
returns the **whole revised plan**, not a diff, plus one sentence of reply.

Returning the whole plan is deliberate: diffs against a nested document are where models fail, and a
full plan runs through the same normaliser as the first plan. The cost of redrawing is controlled
instead by **id preservation + byte-identical unchanged text**.

## The revise prompt

```
You are the director of a short AI-generated film, revising its SHOT PLAN with the user in a chat.
You get the current plan as JSON, the conversation so far and the user's new request. Apply the
request like a professional director would: change what they asked for, keep everything else exactly
as it is, and make the rest of the plan consistent with the change (a night-time request also changes
lighting captions, palette and time of day; a new character appears in the cuts that need them).
Rules:
- Return the WHOLE plan, not a diff. Keep the "id" of every character, product, environment, cut and
  lighting entry you keep; give NEW entries no id. Remove an entry by leaving it out.
- Keep an entry's text byte-for-byte identical unless the request changes it — unchanged text means
  its picture is not redrawn, which saves the user money.
- 1–8 cuts. Durations add up to totalSec (4–15). Change totalSec only if the user asks for a longer or
  shorter film.
- Cuts name characters, products and the environment by their exact names. Captions stay 25–45 words;
  vary lenses, apertures and moves.
- If the request is a question or unclear, answer it in reply and return the plan unchanged.
Answer with ONE JSON object: { "reply": "one or two sentences telling the user what you changed",
"plan": <the plan> }. The plan uses this shape, plus the ids and totalSec:
<PLAN_JSON_SHAPE>
```

User message: the original brief, the current plan as JSON (ids included, entities joined by name),
the last ~10 turns of conversation, then `USER'S NEW REQUEST: …`.

Telling the model *why* byte-identical text matters is what makes it comply. "Keep it the same" is
ignored; "unchanged text means its picture is not redrawn, which saves the user money" is not.

## Applying it

```ts
const keepIds = new Set([...characters, ...products, ...environments, ...cuts, ...lighting].map(x => x.id));
const plan = normalisePlan(rawPlan, { brief: { ...brief, cutCount, totalSec }, uploads, id, keepIds });
```

Ids inside `keepIds` survive; anything else gets a fresh id and therefore an idle panel. Then:

```ts
const stale = stalePanels(oldPlan, newPlan);
commit(p => ({ ...p, plan: newPlan, panels: panelsFor(newPlan, p.panels)
  .map(x => stale.some(s => s.kind === x.kind && s.targetId === x.targetId) ? { ...x, status: "idle" } : x) }));
await drawAll();   // draws idle + errored only
```

## What goes stale

The dependency graph of the reference chain, run backwards. Compare only the fields that actually
reach an image prompt — a changed `position` must not redraw a character sheet.

| Changed | Redraw |
|---|---|
| A character's name / look / wardrobe / palette | its sheet **and** every cut frame it appears in |
| A product's name / description / notes / palette | its sheet **and** every cut frame it appears in |
| An environment's name / description / time of day | its plate, the floor plan, the elevation, and every cut shot there |
| A cut's lens / aperture / move / framing / description / action / cast / set | that cut's frame |
| A cut's blocking (`position`, `move`, `environmentId`) or the cut order | the floor plan and the elevation |
| A lighting caption | that lighting still |
| The global palette, lighting note or style essence | every cut frame and every lighting still |

New entities need no entry here — `panelsFor` gives them an idle panel and `drawAll` picks them up.

## Chat UX

- Stream or at least show a "thinking" state; a revision is a 20–60 s round trip.
- Append both turns to `project.chat` so the model sees the conversation on the next request.
- After applying, say what changed in one line and let the redraw run in the background with the
  panel-level "drawing" state — the user watches the affected pictures refresh and the rest sit still,
  which is itself the proof that the edit was surgical.
- A question ("what lens is cut 3?") returns the plan unchanged and answers in `reply`. Do not redraw
  anything.
