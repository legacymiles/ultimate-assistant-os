# Placing each resource

The per-type rules. Read the section for whatever you are holding.

- [Images and faces](#images-and-faces)
- [Reference video](#reference-video)
- [Audio](#audio)
- [Speech and lip sync](#speech-and-lip-sync)
- [The camera panel](#the-camera-panel)
- [Chosen workflows](#chosen-workflows)
- [Output spec](#output-spec)

---

## Images and faces

An uploaded photo is a promise that this exact person or object appears. Breaking it is the most
visible failure a film can have, because faces are what an audience checks.

**Attach by role, always.** A model handed several pictures with no instructions averages them.
Every attachment is introduced by what it is *for*: "Image 1 is the character sheet for GIRL —
this is the same person; keep face, hair and wardrobe identical." / "Image 3 is a style
reference — borrow its colour and light only; do not copy its people."

**There is a resolution floor.** A face crop of a couple of hundred pixels cannot anchor a
face in a wider frame — there is not enough of the person in it. If the only reference available
is a thumbnail, say so and ask for a real one. Rendering anyway produces a film that is
approximately the right person, which reads as uncanny rather than as a likeness.

**Never let a fallback fire silently.** Pipelines often substitute *something* when a shot names
no reference — the first saved character, the last upload, a library thumbnail. That
convenience is how an empty cast sheet still produces a finished film: the render proceeds, the
face is wrong, and nothing in the process said a word. An empty cast on a film with people in it
is an error to raise, not a gap to fill.

**References and continuation are two answers to the same question.** A shot being continued
from real frames of the previous shot already contains the identity; attaching reference photos
on top makes the model visibly split the difference. So references belong on shots that *open*
something, and continued shots are held steady a different way:

- Give the chain a fixed frame to converge onto (an end-frame anchor), reusing a known-good
  frame, every few shots rather than every shot.
- Cap how long a chain runs before cutting back to a shot that does carry references. Identity
  drifts gradually, so the fix is frequency, not strength.
- Pick the handover frame by whether the face is **legible in it** — not by its position in the
  clip. A dark, motion-blurred, backlit final frame carries position and no identity, and the
  next shot has nothing to hold.

**A character who changes during the film** — infection, injury, age, a mask removed — is not a
line in a shot's action. It belongs in the cast's own transformation fields, because the
character's look is repeated verbatim into every shot precisely so it cannot drift, which
silently makes a change written anywhere else never happen.

---

## Reference video

Decide which of the three jobs it is doing before you place it. Saying "here is a reference
video" without a role is how a style plate's actor walks into your film.

**Style reference.** Its grade, light, texture and energy. Explicitly *not* its people, its
location or its action. Lands in `look`, `grade`, `lighting`.

**Motion reference.** Its action, choreography or camera behaviour, performed by *your* subject
in *your* set. Lands in the relevant shot's `action`, `beats` and `cameraNote`. This is the one
most often mislabelled as style, after which the film borrows the wrong half.

**Continuation source.** Not a reference at all — it is the previous shot, handed over as real
frames so motion and sound cross the join. Lands in the shot's link, not in its references. Hand
over the *trimmed* clip: if the context frames are all the previous shot's frozen tail, the model
continues a standstill.

---

## Audio

**A track is the clock, and it outranks everything.** When a film is cut to a piece of audio,
shot lengths are not a taste decision — each one is the distance to the next musical event.
Plan the cut points against measured positions in the track, then write shots to fill them.
Doing it the other way round (write shots, hope they fit) drifts, and drift compounds: every
later shot inherits every earlier shot's error.

**Measure it; do not describe it.** Tempo, bar lines, downbeats and section boundaries are
measurable locally and exactly. Most language models cannot actually hear an audio file, so an
impression of a track is a guess dressed as data. If the measurements are not available, say the
film is being cut by feel — do not imply precision that is not there.

**Master versus bed** changes what is negotiable:

- *Master* — the film was cut to this track. It plays at its own level, unlooped; the clips' own
  audio is dropped; every clip is trimmed back to the slot it was planned for. The picture may
  not drift from the thing it was measured against.
- *Bed* — ducked underneath, looped to fit, mixed beneath whatever sound the clips generated.
  Shot lengths are free.

**Levels are a planning decision too.** Separately generated clips each invent their own audio,
and unmatched they lurch — near-silence in one shot, distortion in the next. Decide the intended
level per shot at plan time and normalise at the cut. A film that clips is not shippable.

---

## Speech and lip sync

**Lip sync supersedes the prompt inside its shot.** When a shot carries a spoken line, the line
is the shot's content and everything else accommodates it.

**The line must be able to finish inside the shot.** Count it: ordinary speech runs about two to
three words a second. A twelve-word line needs five seconds of shot, plus room to breathe before
and after. A line that overruns is not fixable later — audio that was never generated cannot be
recovered in the edit, and a word cut off at the source stays cut off.

**One line per shot.** Two people talking is two shots, or one shot with one line and a reaction
carrying the rest.

**Put the line where the face is.** A line spoken in a wide shot where the mouth is thirty pixels
across wastes the lip sync entirely. If a shot has speech, it needs framing that shows a mouth.

---

## The camera panel

Every rail the owner touched is binding, and each has exactly one home in the plan. The full
precedence ladder is in SKILL.md; these are the placement notes that catch people out.

**Tempo is the edit, not an adjective.** Spend it on shot count, shot lengths and beat density.
A fast tempo means short cuts and a beat every second or two; a slow one means long holds and
few. Writing "fast-paced" into a description and then planning eight-second shots is tempo
being acknowledged and ignored.

**Style decides the medium, so it is the first thing in every prompt.** When another setting
looks like it fights the style, it almost never does — translate it instead of dropping either:
a fisheye in a cut-paper world is a cut-paper fisheye; a 1970s era on a kart racer is a kart
racer with 1970s cars and colours.

**Genre is the one that gets half-applied,** and it is worth understanding exactly how. Genre
descriptions are usually written as cinematography — framing, negative space, palette — so they
reach the grade and the framing and stop there. But a genre also obliges things to *happen*:
what the opposing force does and how its behaviour is wrong, what the protagonist registers and
loses, how the pressure rises cut by cut, and how the film is allowed to end. Plan both halves.
A horror film planned as a pleasant scene and then graded dark is a correctly graded film of the
wrong story — everything looks right and nothing is frightening.

**A named move renders as the ordinary move its words describe.** "Dolly zoom" alone comes back
a plain zoom, every time. Whatever the move, write the mechanics beside the name: travel
distance, the focal length at each end, what stays locked in frame, what the background does.

---

## Chosen workflows

A selected workflow — a lip-sync pass, a reaction cut-out, a micro-expression study, a product
turnaround — carries its own doctrine, and that doctrine governs the shot it applies to more
specifically than the film-wide fields do.

Fold it into that shot's `action`, `beats` and framing rather than mentioning it by name. The
render does not know what your workflow is called; it knows what you described. A workflow
named in the plan and not expressed in a shot is a resource that was selected and dropped.

Where a workflow's doctrine contradicts a film-wide field inside its own shot, the workflow wins
locally and the film-wide field resumes at the next shot — and say so in one line, so the owner
knows their setting was deliberately bent rather than lost.

---

## Output spec

Aspect ratio, total runtime and shot count are a container, and they constrain the plan rather
than decorate it.

Most video models render a fixed window — a handful of seconds at a time. A minute of film is
therefore a dozen separate generations, and asking for thirty seconds in one shot does not make
a thirty-second shot exist. Plan within the window.

When a runtime is fixed, decide early whether the shot count or the shot lengths absorb it, and
generate each shot slightly longer than its slot so there is surplus to trim a warm-up out of.
Trimming a shot below its planned length is what puts a film off its music.
