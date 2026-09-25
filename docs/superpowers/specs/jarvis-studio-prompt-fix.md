# Fix how Jarvis Studio prompts. You built this, and it failed.

You wrote Jarvis Studio's shot-prompt builder. Film `muerupfa35yv` — seven shots, 49.5s,
horror selected in the UI — came out as a nappy advert. Before you touch anything, understand
that this is not a tuning problem. The architecture cannot express a horror film.

## The ten failures

1. The hero child's identity drifts into a different child for 20s, then snaps back.
2. Every room is lit with warm daylight. Nothing is concealed anywhere in the film.
3. The zombies stand upright with good posture; one of them smiles.
4. The hero is calmly drinking a bottle throughout, including while fleeing.
5. No escalation — he ends in the same state he started in.
6. Every shot is a locked-off wide at adult height.
7. The opening shot is a frozen photograph for 6.6s; the film ends on a frozen frame.
8. Audio runs near-silent, then clips at full scale, then drops away — a 38 dB swing.
9. The ending is happy: sunlit lawn, threat forgotten.
10. Brightness jumps +64% at one cut and −31% at the next.

## The root cause

**Every one of those ten is a thing the plan has no field for.** A film cannot contain what the
plan cannot describe. Whatever you leave unspecified, the model fills with the statistical
average — and the average of "baby in a house" is a lifestyle commercial. It did not ignore you.
You never said any of it.

Four structural faults produced all ten:

**A. Genre is decorative.** `board.look` is interpolated into one sentence as a bare adjective:
`A 6-second horror single take`. One word, competing with several hundred words of scene
description that describe a pleasant house. The word loses. Genre currently changes nothing
about what is required of a shot.

**B. Genre was catalogued as a look. — FIXED, see "What shipped" below.**
Corrects an earlier draft of this brief, which claimed the plan had no fields for light, threat
behaviour or escalation. It does: `action`, `beats`, `carry`, `endsOn`, `location`,
`turnsAt`/`turnsInto` and `mood` all exist, and the camera deck's precedence order
(TEMPO → STYLE → GENRE → ERA → LIGHTING/PALETTE → CAMERA) was already live when the film
rendered. The fields were not the gap.

The gap was that **all seventeen genres in the deck were written purely as cinematography** —
framing, light and colour — so genre reached `mood`, `lighting` and `grade` and stopped there.
Nothing told the planner what a horror film must *contain*. Horror's own text ended with
"a held beat too long before anything moves", and a planner obeyed it: the opening shot is a
frozen photograph for 6.6 seconds.

**C. Shots are written as scenes, not events.** `shot.action` describes a situation that exists.
A situation renders as a photograph — which is literally what shot 1 is. Nothing in the pipeline
requires a shot to contain a change of state.

**D. Identity is anchored where it is convenient, not where it is needed.** References are
correctly withheld from chained shots (they fight the continued context), but the replacement
anchor was never built — `image_end` appears nowhere in the repo. So a three-shot chain runs
with nothing holding the face. Worse, when the sheet's cast is empty, `refsFor` silently falls
back to a 180×180 thumbnail from the photo library, and the render proceeds as if it were fine.
That silent fallback is how an empty storyboard sheet produced a finished film.

## What shipped (2026-09-24)

Genre now carries a story doctrine as well as a look. Done:

- `CinemaOption.story` — a new optional field, genres only, enforced by test.
- A story doctrine written for all 17 genres: what the opposing force does, what the
  protagonist registers and loses, how the pressure moves, how it is allowed to end.
- `cinemaContext` emits a `THE GENRE` block that states those obligations and maps each one
  onto the plan field that carries it (`action`/`beats`, `turns_at`/`turns_into`, `carry`,
  shot order, the last shot's `ends_on`).
- Two universal rules in that block AND in the `studio_storyboard` tool description, so they
  apply even when the deck is untouched and the owner only said "make it horror" in chat:
  **NO SHOT IS A HELD POSE** (issue 7) and **EVERY CUT COSTS SOMETHING** (issues 5 and 9).
- Horror's look text no longer ends "before anything moves" — the beat is still held, but the
  thing the frame was hiding now has to move.
- `mood`'s field description rewritten to demand both halves.

That addresses issues 2, 3, 4, 5, 6, 7 and 9 at the planning stage. Issues 1, 8 and 10 are
render-stage and remain open below.

## The remaining changes

Each is stated with what "done" means. Do not mark one done without the check passing.

**1. Genre becomes a contract, not an adjective.**
Define each genre as: required per-shot fields, obligations the film must satisfy, and banned
defaults. Horror's contract: every shot names its single light source and what falls into
darkness; the threat is specified by behaviour, never by appearance alone; at least one shot
must deny relief. Banned: golden hour, ambient fill that reveals a whole room, a threat that is
upright and symmetrical, a resolved ending.
*Done when:* selecting horror and rendering with an unfilled contract is refused, and the
refusal names the missing fields.

**2. Add the missing fields to the plan.**
Per shot: `light` (source + what is lost to darkness), `threat` (where it is in frame, what it
does that is wrong), `heroState` (what the hero feels and does about it), `change` (what is
worse at the end than the start), `soundIntent`. Per film: `pressureCurve`, `endingKind`
(trap closed / never escaped / false relief / survived).
*Done when:* every new field reaches the compiled prompt as its own line, and unit tests assert
that.

**3. Shots must be events.**
Validate `shot.action` for a state change — something that is true after and was not true
before. Reject descriptions of standing arrangements.
*Done when:* "a baby sits in a living room" fails validation on the sheet, before any GPU time,
and "the baby stops drinking and turns toward the hallway" passes.

**4. Escalation is computed, shown, and enforced.**
Give each shot a tension value 1–10. Require non-decreasing across the film, with at most one
dip permitted and only when `endingKind` is `false relief`. Draw the curve on the sheet.
*Done when:* a flat curve blocks the render and the sheet shows where it went flat.

**5. Identity is pinned in every shot, including chained ones.**
Build `image_end` support and anchor each chain onto a known-good frame. Cap chains at two
shots before cutting back to a referenced shot. Pick the link frame by whether the face is
legible in it, not by its position — the current link frame is a dark, motion-blurred
silhouette, which is why the face had nothing to hold onto.
*Done when:* a seven-shot film with a three-shot chain holds one face end to end.

**6. Kill the silent fallback.**
Never substitute a photo-library thumbnail for a character reference. Enforce a minimum
reference resolution and refuse to render below it, naming what to upload.
*Done when:* rendering with an empty cast sheet is impossible, and the error says which
character needs a reference.

**7. Lighting continuity travels.**
Carry shot N's light description into shot N+1's prompt as the state to maintain or to depart
from deliberately. Exposure is a planning decision, not an encode-time correction — the ±10%
gain clamp cannot and should not fix a 64% swing.
*Done when:* consecutive shots in one location land within 15% mean luma without correction.

**8. Camera is prose with amplitude and speed.**
"Dollies in with medium amplitude at slow speed," never a bracket token. Every shot states its
height, and horror shots default to the hero's eye level rather than adult standing height.
*Done when:* no compiled prompt contains a camera token, and shot height is always present.

**9. Sound is specified per shot and matched at the stitch.**
Each shot declares its sound intent and its level relative to the film. Normalise to a single
integrated loudness at the cut, and refuse to ship a film containing clipping.
*Done when:* the loudness spread across shots is under 6 LU and no shot peaks at 0 dBFS.

**10. The film is measured against the plan before it is called done.**
Run the continuity reader on every finished film: dead shots, frozen heads and tails, exposure
swings, loudness swings. Report it on the sheet. Auto-flag failures for retake instead of
reporting success. Also fix the existing bug where the measured warm-up and landing trims are
computed correctly but never reach the encode — the finished film was 1188 frames against 1191
raw, so an 11-frame warm-up, a 13-frame warm-up and a 26-frame landing all shipped.
*Done when:* a film containing a dead shot cannot report `done` without saying so.

## Rules while you work

- Do not add a "horror mode" that appends adjectives to the prompt. That is the bug you are
  fixing, with more words.
- Do not fix this in the edit. Dead shots, absent threat and missing fear are generation
  failures; no amount of trimming and grading reaches them.
- Fix the plan and the compiler. Every fix belongs in a field the sheet exposes to the owner,
  so they can see it and change it before a single frame renders.
- The owner has said repeatedly that the storyboard sheet is the answer. It is — but only
  because the sheet is the plan made visible. A sheet with empty fields is worth nothing, which
  is why change 6 matters more than it looks.

## Acceptance test

Re-run the same brief — a toddler alone in a suburban house as the adults turn — against the
rebuilt pipeline. It passes when: one child throughout; no shot lit so you can see the whole
room; the threat is never fully shown in the light; the hero visibly registers fear and drops
the bottle; tension rises shot over shot; nothing opens or closes on a frozen frame; and the
ending does not hand the audience relief.

If it comes back looking like a nappy advert again, the contract in change 1 is not being
enforced — check that before touching anything else.
