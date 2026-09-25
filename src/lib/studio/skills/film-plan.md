# Film plan — the doctrine under every multi-shot film

This is not a workflow the owner picked. It is how a film is planned here, and it applies under
whatever workflow is leading. Where a workflow's own rounds conflict with these, the workflow
wins on craft and this wins on **shape** — what lands in which field, and what stops a render.

## The one rule

**Every resource the owner provided is an instruction. Each one lands in a named field of the
board, or is declined out loud in one line. Nothing is silently averaged away.**

Every failure is that rule broken: something was set, nothing carried it, and the model filled
the gap with the average of the subject matter. The average of "baby in a house" is a nappy
advert. The model did not disobey — it was never told.

A resource dropped *loudly* ("that photo is 180px, too small to hold a face") costs ten seconds.
Dropped *quietly* it costs an hour of the owner's GPU and a film they throw away.

## Rounds — a short prompt does not contain a film

"A short about a guy who finds a door in the woods" is a premise. A film is a dozen decisions the
owner has opinions about and has not been asked. So ask, through `studio_form`, one round at a
time. Skip any round already answered by the prompt, an attachment, the camera deck or an earlier
round, and say what you took as given.

1. **Inventory and read** — no form. List what you were given: idea, images (uploads + saved
   characters), video references (style? motion? continuation?), audio, every camera-deck rail
   touched, the workflows picked, aspect and runtime. Then say in two or three sentences what you
   think the film IS — the emotional read, not a summary. Anything you cannot place is a decision
   you are about to make for them by accident; say so.
2. **The spine** — never skipped. What is different by the end; whose film it is; the moment it
   stops being one kind of film; how it ends; total runtime. If the owner has no preference on
   "what changes", propose one concretely rather than asking an open question.
3. **World and look** — only the rails the deck has not already set. Offer 3–4 named directions,
   never an open field: "cold municipal fluorescent / sodium-orange night exterior / single-source
   window daylight" gets a real answer; "what lighting?" gets "cinematic".
4. **Cast** — for each person or hero object that must stay recognisable: upload, saved character,
   or invented? **Invented needs no upload and is a first-class film** — write `look` richly
   enough that the words hold the face, and leave `subject` null. Anyone who *changes* during the
   film goes in `turnsAt`/`turnsInto`, never in a shot's action.
   **`look` must state appearance outright — skin tone, age, build, hair, face — for every single
   character, invented or not.** Whatever it leaves out, the model fills in with its own default,
   and the default does not know your film: a sheet drawn from "a woman in her early thirties, the
   baby's mother" came back white beside a Black baby. A relationship is not a description. If two
   characters are family, say so in BOTH their looks.
   **But past two shots an invented face needs a drawn anchor.** Every shot is generated
   separately, so a face held only by words is re-imagined by each one and quietly becomes someone
   else — the single reason a long prompt-only film comes back inconsistent. The sheet draws one
   reference sheet per invented character from their `look`, and attaches that one picture to every
   shot they appear in. Tell the owner to draw it; the render gate will not start a long film
   without it.
5. **Sound** — see below. Never skipped, never filled silently.
6. **The board**, then the gate, then hand the sheet over to be drawn.

**Scale the rounds to the film.** Under ~20 seconds, fold 2–5 into ONE form and propose defaults.
Over a minute, run them all — at that length a wrong assumption costs an hour. Five forms for a
12-second clip is a worse experience than guessing.

## Where each resource lands

| Resource | Lands in | How it dies quietly |
|---|---|---|
| The idea | `logline`, shot order | rewritten into something more generic |
| Uploaded photo / saved character | `cast[].look` + `cast[].subject` + `shots[].references` | never attached, or attached at thumbnail size |
| Reference video | *three different jobs — see below* | treated as style when it was meant as motion |
| Speech | `shots[].dialogue` + that shot's length | the line is longer than the shot and is cut off |
| Tempo | shot count, lengths, beat density | spent on adjectives instead of durations |
| Style | `look` | quietly rendered as photography |
| Genre | `mood` **and every shot's `action`** | reaches the grade only |
| Era | `look`, `lens`, `wardrobe` | folded away as "vintage" |
| Lighting / palette | `lighting`, `grade`, `palette` | overridden by what the location suggests |
| Camera moves | `move` **and `cameraNote`** | named but not specified, so rendered plain |
| A chosen workflow | its shot's `action` and `beats` | the workflow's doctrine never reaches the shot |
| Aspect / runtime | `aspectRatio`, total duration | the film comes out a different length |

**Reference video is three different jobs**, and confusing them is the most common resource
error. Say which one you are using in the sentence that introduces the attachment:

- *Style* — borrow its grade, light and texture; **never** its people or its action.
- *Motion* — copy the action or choreography; the subject stays yours.
- *Continuation* — it is literally the previous shot, handed over as real frames.

A model handed several images with no roles assigned averages them, which is how a reference face
and a style plate merge into a person who is neither.

## Sound — every film makes its own

The render produces video **and audio together**. A film that comes back silent, or scored by
accident, is a planning failure, not a model limitation. So:

- `soundscape` — what the microphone in the scene hears. Never empty.
- `music` — the score under the film, or the literal string `"none"`. **`"none"` is a decision;
  empty is the model's.** Write `"none"` deliberately and say you did.
- **A score cannot survive a cut.** `music` is a *description*, and each shot that reads it
  generates its own performance of it — so a film with hard cuts changes music at every join. The
  score is therefore dropped from the shot prompts the moment the film has a cut, and belongs
  under the finished edit instead, where it is one continuous recording. Write `music` anyway
  (it is what the owner attaches or commissions), and tell them it goes under the cut, not into
  the shots. A film that is ONE unbroken take keeps its score in the prompts, because there is
  only one generation of it and the audio crosses a chained join.
- `shots[].dialogue` — `"NAME: line"`, or empty when nobody speaks.
- Sound escalates with the film. One soundscape line for ninety seconds that go from a quiet
  kitchen to a burning one is the same failure as one genre for two films.
- Speech runs about **2.5 words per second**. A line longer than its shot is cut off *at the
  source* and cannot be recovered in the edit — lengthen the shot or shorten the line.
- When the owner attaches a track it arrives as measured numbers, not a listen. Use them; never
  claim to have heard it.

**The one exception: Seedance Studio.** There the owner's track is the master, the film is cut to
it, and the model's own audio is not used. That is the only mode where an attached track outranks
everything else. Every other film has no clock — do not invent one.

## Precedence, when two settings pull against each other

Higher wins the pixels; lower is re-expressed *through* it rather than dropped.

1. **Speech** — lip sync supersedes the prompt inside its own shot, and its length is decided
   before anything below.
2. **Identity** — faces and hero objects outrank every look setting. A beautiful film of the
   wrong person is a failure; a plain film of the right one is not.
3. **Tempo** — how many cuts and how long. Not a look, which is why it beats every look below.
4. **Style** — what the world is made of. Everything under it is re-expressed inside it: hard
   noir light in cel anime is *painted* hard light, not a photograph.
5. **Genre** — what happens and how it is shot. It outranks the location's own suggestion: a
   horror film in a sunlit family house is a horror film, lit, graded *and populated* as one from
   frame one.
6. **Era**, then **lighting / palette**, then **camera**.

*(A track, in Seedance Studio only, sits above all of these.)* **Moves never compete** — they mix
with everything, in the order the owner wrote them. When something genuinely cannot survive
(golden-hour light under a horror genre), say which one you set aside and why, in one line.

## Writing the shots

- **The film-wide fields are repeated word for word into every shot.** `mood`, `world`,
  `wardrobe`, `lighting`, `grade`, `lens`, `look` — that repetition is the only reason a dozen
  separate generations read as one film. **A paraphrase is a different film.**
- **No shot is a held pose.** Every shot names something that physically *changes* inside its own
  seconds. "A baby sits in a living room" renders as a still photograph, because that is literally
  what it asked for. Write the event: "the baby stops drinking and turns toward the hallway."
- **Every cut costs something.** Shot N leaves the protagonist worse off, closer to the thing, or
  with one fewer way out than shot N−1. If you cannot say what a shot took away, it is a held pose
  with a camera move on it.
- **A long shot needs a clock** — a beat roughly every two seconds.
- **Always write `endsOn`.** The next shot is told to open on it.

## Continuity, decided now and not afterwards

- **Generate longer than the slot.** A clip opens with a warm-up — measured at 9× and 15× slower
  than the shot's own body over its first six frames — which gets trimmed, and trimming costs
  duration. A shot that must play for 5 s is planned at 6.
- **Cap continued chains at 2.** A `continuous` shot renders from the previous shot's frames and
  therefore **takes no reference photos**; a longer run has nothing holding identity. Measured on
  a real film, a three-shot chain turned a Black toddler into a fair-haired one and back.
- **Never attach references to a continued shot.** The handed-over frames and the photos are two
  answers to the same question and the model visibly splits the difference.
- **Every object the action touches must already be in the room.** A hazard, a piece of furniture,
  anything that falls or is knocked over — if it is not in the set plate when the room is drawn
  EMPTY, it appears from nowhere and the audience sees that instantly. Write the props into
  `world` first, redraw the plate, and only then write the action that uses them. Measured: a hall
  dresser written into `world` and toppled in shot 2, while the plate still showed a hallway with
  no dresser in it — the object materialised mid-shot.
- **The plate goes stale.** Change `world` or the locations and the plate is wrong until redrawn.
  Everything drawn from it inherits the mistake.
- **Anchor the ROOM as well as the faces.** A set plate — the location drawn empty and wide — is
  attached to every shot that opens cold, exactly as a cast sheet is. A description cannot hold a
  space any better than it can hold a face: measured on a real film, a hallway became a living
  room between two cuts, and an adult at the far end of it in one shot was beside the child in the
  next.
- **Every cut needs a picture of whoever is in it** — an upload, a saved character, or the drawn
  cast sheet. A cut with nobody attached starts cold and invents the face from the words.
- **One continuous action is a chain, not a series of cuts.** A chase, a fall, a run through a
  building: `continuous` shots sharing one `location`. Cuts are for when the audience should feel
  one.

### Choosing `link`: it picks the engine, not a style

The two render completely differently, and the choice is a trade:

| `link` | Engine | Handed | Use when |
|---|---|---|---|
| `open` / `cut` | **Ref2VA** | cast sheets, uploads, the set plate — pictures, no motion | the shot starts somewhere new, or a face must be re-established |
| `continuous` | **FL2VA** | the previous clip's real frames — motion and audio cross with them | the shot carries on from the one before, in the same space |

- **A `cut` re-invents everything it is not shown a picture of.** It gets the faces and the set,
  but the blocking — who is standing where — is invented fresh. A cut buys a new angle and costs
  you the arrangement of the room.
- **A `continuous` shot inherits that arrangement for free**, people where they were and moving as
  they were, but takes NO reference pictures: identity is only what it inherited. Two in a row is
  the limit.

So the default shape is **one `open`, then `continuous` for as long as the action really is
continuous, cutting back to a referenced shot only when the story needs a new angle or the chain
has run to two.** A film that is mostly `cut` re-invents its own set once per shot, and that is
exactly what it looks like.

## One generation, or many

| Runtime | Shape |
|---|---|
| **≤ 15 s** | ONE generation — the cuts go inside one prompt and the model cuts internally. Nothing for identity to drift between. |
| **longer** | One generation per shot, chained on `link` and stitched. |

Choose by runtime and **say which you chose**, because it changes what the owner is approving: a
15-second plan is approved once, a ninety-second plan shot by shot.

### Make the shots LONG. This is the single biggest lever you have.

**H3's window is 4–15 seconds, so plan at the top of it, not the bottom.** Every join is a place
the film can break — the room is re-invented, a face drifts, the exposure steps, the audio
restarts. A 45-second film is either:

- **eight 5-second shots → seven joins**, or
- **three 15-second shots → two joins.**

Same film, a quarter of the risk, a third of the renders. Everything that goes wrong in a stitched
film goes wrong *at the joins*, so the way to make one good is to have fewer of them.

A shot is only short when the CUT is the point — a reaction, a hard insert, a beat that must land
alone. Otherwise let one shot carry a whole stretch of the story, with its `beats` list doing the
work the cuts would have done. A 15-second shot with seven beats is ONE generation; the same
content as three cuts is three generations and two joins.

Measured on a real film: eight 5-second shots gave a character who teleported across a cut, a room
that changed between shots, and a 21% exposure climb — all of it at the joins.

## The gate

The sheet runs a pre-flight check and **will not start a render on a plan that cannot become the
film it describes** — held poses, chains past 2, speech that cannot fit its shot, empty sound,
shots outside the 4–15 s window, a cut with no references in a film whose cast has uploads. Those
appear on the sheet in red and the button says how many are left.

So write the board to pass it the first time. Then check by reading what the gate cannot:

- Does every line of your Round 1 inventory appear somewhere in the plan?
- Does the ending do what the genre obliges, or hand the audience relief it did not earn?
- Is the opposing force described by **behaviour**, or only by appearance?
- Does the sound change as the film does?
