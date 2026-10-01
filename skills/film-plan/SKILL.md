---
name: film-plan
description: Interview a short prompt into a complete multi-shot film plan, then gate it before any GPU time. Runs as numbered rounds — inventory, spine, cast, sound, board — each asked as a form, so a one-line idea becomes a plan with nothing assumed. Places EVERY resource the owner handed over (the written idea, uploaded photos and saved character faces, reference videos, a music or voice track, the camera panel, chosen workflows, the output spec) into a named field of one Storyboard object, or declines it out loud. Use this WHENEVER a film, video, short, ad, music video, trailer or any multi-shot sequence is being planned in Jarvis Studio, Smart Shot Videos, Music Video Studio or any AI video pipeline; whenever someone attaches assets and asks for a video; whenever a storyboard, shot plan or board is being built, re-planned or edited; and above all whenever a finished film came back ignoring something that was set — a genre that only reached the colour grade, a face that drifted into someone else, a track the cuts ignored, an attached photo that never appeared on screen, a shot that rendered as a frozen photograph, a film that came back silent. Also use it as the pre-flight gate immediately before rendering.
---

# Film plan

> ### Which skill is this?
>
> **This is JARVIS STUDIO'S IN-APP PLANNING FLOW** — the owner types an idea in the Studio tab,
> attaches photos, and expects a storyboard sheet and a render gate back.
>
> | | job |
> |---|---|
> | `film-plan` | brief + resources -> one Storyboard object, plus the pre-flight gate |
> | `shot-plan-storyboard` | draw that object as the editable paper sheet |
>
> **It does NOT decide how a prompt is worded, nor how a film longer than a few shots holds
> together.** Both belong to the video prompting stack — `h3-long-story` for the shape of a
> film across minutes, `h3-cinematic-prompt` for the sentences, `h3-prompt` for the format, `h3-stitched-film` for
> how many clips and how they chain, `h3-scene-continuity` to measure the result.
>
> Measured, and worth being honest about: the one film planned end-to-end through this flow came
> back mediocre, while the clips that worked were written directly with the stack. This flow
> earns its place by turning resources into a plan a person can EDIT, not by making the picture
> better. Use it for that, and let the stack write the words.


This skill turns **a short prompt into a long film**. It is the planning layer between what the
owner said and the two skills either side of it:

```
prompt + resources
   │
   ▼
FILM-PLAN            rounds → ONE Storyboard object → the gate
   │                 (this skill: what the film IS)
   ▼
SHOT-PLAN-STORYBOARD draws that object as the editable sheet
   │                 (the panels, the reference chain, the sheet UI)
   ▼
   owner edits ──▶ back through the gate ──▶ render
   │
   ▼
H3-SCENE-CONTINUITY  handover, trim, exposure, seam — after the clips exist
```

Three skills, one object. `film-plan` owns the plan. `shot-plan-storyboard` owns the picture of
the plan. `h3-scene-continuity` owns everything after the render — **except** its §2/§4
constraints, which are plan-time and live here (§7 below). None of the three may hold a second
description of the film.

## The one rule

> **Every resource the owner provided is an instruction. Each one lands in a named field of the
> plan, or is declined out loud in one line. Nothing is silently averaged away.**

Every failure in this skill is that rule broken: something was set, nothing carried it, and the
model filled the gap with the statistical average of the subject matter. The average of "baby in
a house" is a nappy advert. The average of "woman at a window" is a stock photo. The model did
not disobey — it was never told.

Silence is the enemy, not disobedience. A resource dropped *loudly* ("your reference photo is
180px, too small to hold a face") costs ten seconds. Dropped *quietly* it costs an hour of GPU
and a film to throw away.

---

# Part 1 — the rounds

A short prompt does not contain a film. "Make me a short about a guy who finds a door in the
woods" is a premise; a film is 12 decisions the owner has opinions about and has not been asked.
So **ask**, in rounds, and never more than one round at a time.

Each round is ONE form. In Jarvis Studio that is the `studio_form` tool — every question goes
through it, never plain text. Write your read of the idea as your message text in the same turn;
the form carries only the choices.

**The rounds adapt.** Skip a round whose answer the owner already gave — in the prompt, in an
attachment, on the camera deck, or in an earlier round. A form that asks something already
answered is the single fastest way to make the owner stop using this. Say what you took as given
in the lead-in: *"You set anamorphic and 2.39 on the deck, so I'm not asking about glass."*

### Round 1 — Inventory and read (no form; your message)

Before anything, list what you were actually given. Do it explicitly, because the resources that
get dropped are overwhelmingly the ones nobody wrote down:

```
IDEA       the brief, in the owner's words
IMAGES     N uploads + M saved characters (@-mentioned, faces attached)
VIDEO      N references — and for each: style, motion, or continuation?
AUDIO      a track? measured how? master or bed? any speech to lip-sync?
PANEL      every rail the owner touched, by name
WORKFLOWS  the Studio skills selected, each with its own doctrine
OUTPUT     aspect, total runtime, shot count
```

Then say, in two or three sentences, what you think the film IS — the emotional read, not a
summary. Anything the owner touched and you cannot place is a decision you are about to make for
them by accident; say that too.

### Round 2 — The spine

The one round you can never skip, because it is the round that makes the film *a film* rather
than a mood. Form fields:

| Field | Ask it as | Why it must be asked |
|---|---|---|
| **What changes** | "By the end, what is different?" — 3 options + free text | A film that ends where it began has not happened |
| **Whose film** | the protagonist, in 5 words | Decides every framing |
| **The turn** | "What is the moment it stops being one kind of film?" | Without it the middle is filler |
| **Ending** | earned / ironic / unresolved / relief | Genre obliges an ending; ask before assuming |
| **Runtime** | 15s · 30s · 60s · 90s+ | Decides shot count, and §6 |

Do not offer "surprise me" as the only option on **what changes**. If the owner genuinely has no
preference, propose one concretely and let them reject it — a named proposal they can say no to
gets a better answer than an open question.

### Round 3 — The world and the look

Skip every rail the camera deck already set. Ask only what is still open:

- **Genre** — and mean it. This is the setting most often half-applied (§5).
- **Style** — what the world is made of: live action, cel anime, stop-motion, 3D render, archive.
- **Era** — stock, wardrobe, props.
- **Location** — one place or several? Each new place costs identity.
- **Palette / lighting** — offer named looks, not hex; you write the hex.

Offer 3–4 concrete named directions rather than open fields wherever you can. "Cold municipal
fluorescent / sodium-orange night exterior / single-source window daylight" gets a real answer;
"what lighting?" gets "cinematic".

### Round 4 — The cast

For each person or hero object that must stay recognisable:

- Is there an upload or a saved character, or is this invented?
- **Invented is fine and needs no upload** — write `look` richly enough that the words alone hold
  the face, and leave `subject: null`. A prompt-only film is a first-class film.
- Does anyone **change** during the film — infection, injury, age, a mask removed? That is
  `turnsAt` / `turnsInto` on the cast member, never a line in a shot's action.
- What is the opposing force, and is it described by **behaviour** or only by appearance? A
  threat with no behaviour renders as a costume.

### Round 5 — Sound

Never skip this round, and never fill it silently. See Part 4.

### Round 6 — The board, then the gate

Write the plan (Part 3), run the gate (Part 5), show the findings, then hand off to
`shot-plan-storyboard` to draw it. The owner approves the drawn sheet, not the JSON.

**Rounds are not an interrogation.** Five forms for a 15-second clip is a worse experience than
guessing. Scale: under ~20 seconds, fold rounds 2–5 into ONE form and propose defaults for
everything else. Over a minute, run them all — at that length a wrong assumption costs an hour.

---

# Part 2 — the ledger

Each resource binds something specific. This table is the skill's spine.

| Resource | What it binds | Where it lands | How it dies quietly |
|---|---|---|---|
| The idea | the spine | `logline`, shot order | rewritten into something more generic |
| Uploaded photo | identity | `cast[].look` + `cast[].subject` + `shots[].references` | never attached; or attached at thumbnail size |
| Saved character | identity | same, faces auto-attached | the fallback fires and grabs the wrong person |
| Reference video | *depends — see below* | three different places | treated as "style" when it was meant as motion |
| Music / voice track | **the clock** (§5) | shot durations, cut points | the picture drifts off the track after cut 3 |
| Speech | the shot's content | `shots[].dialogue` + that shot's length | the line is longer than the shot and is cut off |
| Tempo | the edit | shot count, lengths, beat density | spent on adjectives instead of durations |
| Style | what it is made of | `look` | quietly rendered as photography |
| Genre | **the story and the look** | `mood` + every shot's `action` | reaches the grade only |
| Era | stock, wardrobe, props | `look`, `lens`, `wardrobe` | folded away as "vintage" |
| Lighting / Palette | where light is, what colour | `lighting`, `grade`, `palette` | overridden by what the location suggests |
| Camera body / lens / aperture | the glass | `lens`, `lensMm`, `aperture` | replaced by a generic cinematic look |
| Camera moves | the shot that carries them | `move` + `cameraNote` | named but not specified, so rendered plain |
| A chosen workflow | its shot's whole approach | that shot's `action` and `beats` | the workflow's doctrine never reaches the shot |
| Aspect / runtime | the container | `aspectRatio`, total duration | the film comes out a different length |

**Reference video is three different jobs** and confusing them is the most common resource error:

- *Style reference* — borrow its grade, light and texture; **never** its people or its action.
- *Motion reference* — copy the action or the choreography; the subject stays yours.
- *Continuation source* — this is literally the previous shot, handed over as real frames.

Say which one you are using, in the sentence that introduces the attachment. A model handed
several images or clips with no roles assigned averages them, which is how a reference face and
a style plate merge into a person who is neither.

→ `references/resources.md` for the per-type rules in depth.

---

# Part 3 — the plan is ONE object

The plan is a single `Storyboard` object and it is the single source of truth. The sheet renders
it, the panels are drawn from it, the shot prompts compile from it, the director chat rewrites
it. The moment a panel is drawn from one description while the video prompt is written from
another, the picture and the film stop describing the same shoot.

**The contract is `Storyboard` in `src/lib/studio/storyboard.ts`** (Ultimate Assistant OS). That
file is authoritative; this is the shape, so you can write a valid plan without reading it:

```jsonc
{
  "title": "…", "logline": "…",
  "world":    "one sentence that fingerprints the location",
  "look":     "what the film is made of — 'live action, anamorphic, sunlit'",
  "mood":     "the GENRE DOCTRINE — how this film is shot, framed and paced",
  "lens": "ANAMORPHIC PRIME SET", "lighting": "…", "grade": "…",
  "wardrobe": "what everyone is wearing",
  "palette": ["#0b0d10", "#c8461f", "#e8e2d4", "#2f4858"],   // 4–6 hexes
  "aspectRatio": "16:9",                                      // 16:9 | 9:16 | 1:1
  "soundscape": "…", "music": "…",                            // Part 4 — never empty
  "cast": [{
    "id": "c1", "name": "FATHER",        // shouted, like a call sheet
    "look": "everything a frame must keep: face, build, hair, skin, marks",
    "subject": 2,                        // upload number, or null for invented
    "turnsAt": null, "turnsInto": ""     // the shot a character CHANGES
  }],
  "shots": [{
    "id": "s1", "title": "Cut 1 — the arrival",
    "durationSec": 6,                    // 4–15, H3's window
    "lensMm": 35, "aperture": "f/2",
    "move": "slow push-in",
    "cameraNote": "the MECHANICS behind the label — travel, focal at each end, what stays locked",
    "framing": "wide", "location": "the clearing",
    "action": "what PHYSICALLY HAPPENS across these seconds",
    "beats": [{ "at": 0, "text": "…" }, { "at": 3, "text": "…" }],
    "dialogue": "FATHER: line",          // "" when nobody speaks
    "link": "open",                      // open | continuous | cut
    "carry": "what must survive from the shot before",
    "endsOn": "the frame this shot finishes on",
    "references": [2]                    // upload numbers; [] when invented
  }]
}
```

Six rules govern the writing, whatever the resources:

1. **The film-wide fields are repeated word for word into every shot.** `mood`, `world`,
   `wardrobe`, `lighting`, `grade`, `lens`, `look` — that repetition is the only reason a dozen
   separate generations read as one film. Write each once, concretely, and never contradict it
   in a shot's action. **A paraphrase is a different film.**
2. **No shot is a held pose.** Every shot names something that physically *changes* inside its
   own seconds — true at the end, not true at the start. A shot written as a situation that
   merely exists ("a baby sits in a living room") renders as a still photograph, because that is
   literally what it asked for. Write the event: "the baby stops drinking and turns toward the
   hallway."
3. **Every cut costs something.** Shot N leaves the protagonist worse off, or closer to the
   thing, or with one fewer way out, than shot N−1. If you cannot say what a shot took away, it
   is a held pose with a camera move on it.
4. **A long shot needs a clock.** `beats` roughly every 2 seconds. A shot given seconds and no
   beat list fills them with whatever it likes, which is usually nothing.
5. **Ids are stable.** A revision returns the whole plan keeping the ids it did not change —
   that is what lets `shot-plan-storyboard` redraw only the stale panels instead of everything.
6. **A look field is decided, never defaulted.** `lensMm`, `aperture`, `move`, `lighting`,
   `grade` and `palette` are filled with a value you can defend in one clause — *"85mm, because
   she is alone in a room full of people"*. `35` on every shot is not a lens decision, it is the
   absence of one, and `"soft cinematic lighting"` is a request for the model to choose, which it
   does, flatly. **This is the rule that decides whether the film comes back basic**, and it is
   the only one with no visible symptom until the render exists —
   read `references/cinematography.md` before filling them.

---

# Part 4 — sound

**Every film generates its own audio.** H3 renders video *and* audio together (`Ref2VA` /
`FL2VA` — the VA is the point), and so does every current model worth using. A finished film that
comes back silent, or scored by accident, is a planning failure, not a model limitation.

So sound is **planned, not left**. Three fields, none of which may be empty:

| Field | What it is | Written as |
|---|---|---|
| `soundscape` | the diegetic world — what the microphone in the scene hears | "Wind through dry grass, distant motorway hum, footsteps on gravel, in stereo." |
| `music` | the score *under* the film, or the literal string `"none"` | "Low sustained cello, no percussion until the turn." |
| `shots[].dialogue` | the line spoken in that shot, `"NAME: line"` | "" when nobody speaks |

Rules:

- **`"none"` is a decision, not a gap.** Write it deliberately for a film that should be scored
  by its own silence, and say in your message that you did. An empty string is the model's
  choice; `"none"` is yours.
- **Sound escalates with the film.** If every cut costs something (Part 3 rule 3), the soundscape
  should say so. A single `soundscape` line for a 90-second film that goes from a quiet kitchen
  to a burning one is the same failure as one `mood` for two genres — write the change into the
  shots' `action` and `beats`, which is where the model hears it.
- **Speech must fit its shot.** Ordinary speech runs about 2.5 words per second. A line longer
  than its shot is cut off *at the source* and cannot be recovered in the edit. Lengthen the
  shot or shorten the line — before anything else is decided.
- **Never claim to have heard anything.** When the owner attaches a track it arrives as measured
  numbers (tempo, key, tone), not as a listen. Use the measurements; do not describe the music.

### The one exception — Music Video Studio

**Music Video Studio is the music-video workflow: the owner's track is the master.** There, and only
there, the attached audio outranks everything, the film is cut *to* it, and the model's own audio
is not used — the track is laid under the finished film. That is what "the clock" means in §5 and
it is the only mode it fires in.

Everywhere else — every ordinary film, ad, short, trailer, explainer — **there is no clock**,
the model makes the sound, and `soundscape` / `music` / `dialogue` are how you decide what it
makes.

---

# Part 5 — the precedence ladder

When two resources pull against each other, this is the order. Higher wins the pixels; lower is
expressed *through* it rather than dropped. Dropping is the failure — re-expression is the job.

0. **THE CLOCK — only in Music Video Studio, or whenever the owner attached a track they want the
   film cut to.** It is measured reality, not taste, and nothing negotiates with it: every cut's
   length is its distance to the next musical event. **Most films have no clock. Skip straight to
   1 and do not invent one.**
1. **SPEECH.** Lip sync supersedes the prompt inside its own shot. A line that cannot finish in
   the seconds available is a *length* problem, decided before anything below it.
2. **IDENTITY.** Who and what must stay recognisable. Faces and hero objects outrank every look
   setting, because a beautiful film of the wrong person is a failure and a plain film of the
   right one is not.
3. **TEMPO.** The edit — how many cuts, how long, how many beats each. Not a look at all, which
   is why it is decided before every look below it.
4. **STYLE.** What the world is made of. It survives everything under it and everything under it
   is re-expressed inside it: hard noir light in cel-shaded anime is *painted* hard light, not a
   photograph.
5. **GENRE.** What happens, and how it is shot. It outranks the location's own suggestion — a
   horror film in a sunlit family house is a horror film, and the house is lit, graded *and
   populated* as one from frame one.
6. **ERA**, then **LIGHTING / PALETTE**, then **CAMERA**. Real, but they serve everything above.

**Moves are not in the ladder** — they never compete. They mix with everything and with each
other, in the order the owner wrote them.

When something genuinely cannot survive the ladder (film grain on a blueprint; a golden-hour
lighting chip under a horror genre), say which one you set aside and why, in one line, in your
message. Never quietly render the compromise.

---

# Part 6 — the shape of the render

**This is the rule that decides whether the film is one generation or many, and it is the one
thing the three skills used to disagree about.**

A video model renders a single continuous window — for H3 that is **4–15 seconds**. Everything
longer is assembled. So:

| Total runtime | Shape | Who owns it |
|---|---|---|
| **≤ 15 s** | **ONE generation.** Multiple cuts go inside one prompt as a `[Shot 1] … [Shot N]` block; the model cuts internally. This is what OpenArt Smart Shot does — 5 cuts, 2–4 s each, one 15 s render — and it is why its faces never drift: there is only one generation to drift in. | `shot-plan-storyboard` §4 |
| **> 15 s** | **One generation per shot, chained and stitched.** Each shot is its own render; `link` decides how it joins; ffmpeg cuts them together. | `storyboard.ts` + `h3-scene-continuity` |

Both are correct. Neither is a fallback for the other. Choose by runtime in Round 2 and **say
which one you chose in your message**, because it changes what the owner is approving: a 15 s
plan is approved once, a 90 s plan is approved shot by shot.

The long form is strictly harder, and everything in Part 7 exists because of it.

---

# Part 7 — continuity, decided at plan time

`h3-scene-continuity` owns the film *after* the clips exist. But four of its findings cannot be
fixed afterwards, because they are facts about the plan. Build them in here:

- **Generate longer than the slot.** A generated clip opens with a warm-up the model spends
  establishing the shot — measured at 9× and 15× slower than the shot's own body over its first
  six frames. That head gets trimmed, and trimming costs duration. So a shot that must *play* for
  5 seconds is *planned* at 6. Never trim a shot below its planned length, especially in a film
  cut to a track.
- **Cap the chain at 2.** A shot linked `continuous` is rendered from the previous shot's frames
  and therefore **cannot take reference photos** — the handed-over context and the photos are two
  answers to the same question, and the model visibly splits the difference. So a run of
  continued shots has nothing holding identity but what it inherited. Measured on a real film, a
  three-shot chain turned a Black toddler into a fair-haired one and back. Cut back to a
  referenced shot every 2.
- **Anchor every few shots, not every shot.** An end-frame anchor forces a shot to converge on a
  known-good image, resetting identity and quality. On every shot it turns the film into a series
  of dissolves between stills.
- **One continuous action is a chain, not a series of cuts.** A chase, a fall, a run through a
  building — those are `continuous` shots sharing one `location` string. Cuts are for when the
  audience should feel one.

---

# Part 8 — the gate

Run this before any GPU time. It is cheap, and every item on it is something that has actually
ruined a finished film.

```bash
node scripts/preflight.mjs board.json
```

In the Ultimate Assistant OS hub the same checks run as `preflight()` in
`src/lib/studio/preflight.ts`, wired into the sheet's render button — the owner sees the findings
before an hour of GPU starts, and errors block.

**Run it on the plan the owner is actually about to render**, not the first draft. The owner edits
the sheet, and an edit can break a good plan — a shortened shot that no longer fits its line, a
new cut that extends a chain past 2.

The script reports what it can check mechanically: held-pose shots, flat escalation, chains too
long to hold a face, references below the resolution floor, unplaced resources, speech that
cannot fit its shot, empty sound fields, and shots outside the model's window. Read
`references/preflight.md` for what each finding means.

What the script cannot check, you check by reading:

- Does every inventory line from Round 1 appear somewhere in the plan?
- Does the ending do what the genre obliges, or does it hand the audience relief it did not earn?
- Is the threat/opposing force described by **behaviour**, or only by appearance?
- Does the sound change as the film does?

---

## Failure modes, and what they actually mean

| Symptom | What went wrong |
|---|---|
| Correctly graded, wrong film | Genre reached `mood` and the look fields, and never reached the shots |
| A different face halfway through | A chain ran past 2 with no identity anchor; refs are withheld from continued shots and nothing replaced them |
| An attached photo never appears | It was never placed in `shots[].references`, or a silent fallback substituted something else |
| A shot renders as a photograph | Its action described a situation, not an event |
| The film ends where it began | No cut was made to cost anything; there is no pressure curve |
| The film came back silent, or wrongly scored | `soundscape` / `music` left empty — the model was never told, so it chose |
| A spoken line is cut off | The line was longer than the shot; audio never generated cannot be recovered later |
| The picture drifts off the song | Shots planned by feel instead of measured against the track (Music Video Studio only) |
| A named camera move renders plain | `move` was named and `cameraNote` left empty — the label alone reads as the ordinary move |
| The sheet and the film describe different shoots | Something other than the plan held a description |
| Every setting was used and it still feels generic | The resources were listed rather than ranked; nothing was allowed to win |
| Nothing is wrong with it and it looks like stock footage | The look fields were defaulted, not decided — rule 6, and `references/cinematography.md` |
| A planned lighting change never happened | It was written as a second lighting description; only an event in `action` renders |
| The owner was asked six forms for a 12-second clip | Rounds were run at full length on a short film — see Part 1 |

## Reference files

| File | Read it when |
|---|---|
| `references/resources.md` | Placing any single resource — the per-type rules in depth |
| `references/cinematography.md` | Filling any look field — lens, light, blocking, move, colour, coverage. **Read it whenever a film came back "basic", flat or generic** |
| `references/preflight.md` | Reading the gate's findings, or checking a plan by hand |

Related skills: **shot-plan-storyboard** draws this plan as the editable sheet and owns the
reference chain that keeps the panels on-model. **h3-scene-continuity** owns the film after the
render. Both read the same `Storyboard` object this skill writes; neither may hold a second
description of the film.
