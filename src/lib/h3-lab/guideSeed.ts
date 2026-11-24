// ---------------------------------------------------------------------------
// Master Prompt Guide v1 — the seed.
//
// A superset of the owner's `h3-prompt` skill (everything in it survives),
// reconciled with MiniMax's official prompt guides (base-en / ref-en in
// MiniMax-AI/MiniMax-H3), the measured long-video rules from seesee75's
// ComfyUI-MiniMaxH3-Director paper (rules only — the code is GPL and not
// used), and what this PC's WanGP install actually does. Where the owner's
// skills contradicted each other, the section says which rule wins and why.
// ---------------------------------------------------------------------------

import type { GuideSection } from "./model";
import { GENRES } from "./genres";
import { KNOBS } from "./strategy";

const CORE: GuideSection[] = [
  {
    id: "core",
    title: "What H3 reads",
    body: `**H3 reads a production brief, not a caption — and it renders everything the brief describes.** The way to break it is to describe too much.

- Two checkpoints. **FL2VA** takes 0, 1 or 2 pictures (text-only, first frame, last frame, both). **Ref2VA** takes up to 9 pictures, 3 videos and 3 audio clips (12 files total) as references.
- Clips are 4-15 s at 24 fps; audio (32 kHz stereo) is ALWAYS generated, so the brief always says what it is.
- MiniMax's hosted service runs a prompt pre-processor (H3-Context-IR) that the open weights do not have. Locally, the prompt you write is exactly what the model gets — the format below is how you do that pre-processor's job by hand.

**The one failure to prevent:** a prompt that puts a person in more than one position gets you two of that person. Measured: an 8,031-character dolly-zoom prompt that described the mother both "small at the far end of the hallway" and "huge behind both shoulders" rendered two mothers. A good prompt for that shot is under 1,500 characters.

**One position each AND one verb each.** Everything that should be doing something gets one position and one action that runs for the whole shot — a chase written as "the adults behind him" renders two people standing still. A lone subject still needs the world to change around them ("she reads, and the strip light above her stutters"). A product cannot act, so the verb belongs to what acts on it (light, steam, a hand, the camera). An empty landscape changes through weather, light, traffic or water — or it renders as a photograph.`,
  },
  {
    id: "format-base",
    title: "Format — no references (T2VA, I2VA, FL2VA, L2VA)",
    body: `Three fields, in this order:

\`\`\`
integrated_multimodal_description: <the shots, then the closing block>
overall_soundscape: <1-4 sentences: ambience, foley, non-verbal sounds — no dialogue here>
non_diegetic_music: <1-3 sentences: instruments, tempo, dynamics — no mood words; or "No music; natural sound only">
\`\`\`

When a frame is attached, a **keyframe line goes first**, then one blank line:

- First frame (I2VA): \`For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.\`
- First + last (FL2VA): \`How the reference pictures align with the target video — Picture 1 (from Shot 1) aligns with the 0.00-second mark; Picture 2 (from Shot N) aligns with the S.SS-second mark.\`
- Last only (L2VA): the same line with the last picture at the end.

**FL2VA: describe the path between the frames, not the two frames** — first-frame state → what changes → the difference narrowing → last-frame state. Prefer a single shot. **I2VA:** anchor on the first frame → the action starts → develops → result.`,
  },
  {
    id: "format-ref",
    title: "Format — with references (Ref2VA)",
    body: `Six sections, in this order:

\`\`\`
subject_definitions:
<Subject 1> is GIRL: <1-2 sentences of look>, wearing <1 sentence>. Retention: fully_preserved.
<Subject 2> is the set KITCHEN: <1-2 sentences>. Retention: partially_preserved.
summary: [reference generation] <title> — N shots, Ts: <cut titles, framings, moves>
retention_analysis:
<Subject 1> (appears in [Shot 1]): fully_preserved - the identity, face, hair, skin and wardrobe of GIRL are retained exactly.
<Subject 2> (appears in [Shot 1]): partially_preserved - layout, materials, dressing and light are retained; the camera may see new angles of it.
detailed_description: <the shot blocks, then the closing block>
overall_soundscape: …
non_diegetic_music: …
\`\`\`

- Every attached file is \`<Subject N>\` **in attach order** (MiniMax also uses \`<Picture N>\`, \`<Video N>\`, \`<Audio N>\` — the lab compiles \`<Subject N>\` for pictures). Every one is defined AND given a retention line. Defining a picture that was never attached is worse than nothing.
- The summary's task tag names the inputs: \`[reference generation]\`, \`[reference generation + audio reference]\`.
- **Retention is not interchangeable:** character / hero product → \`fully_preserved\` (retained exactly). Set / environment → \`partially_preserved\` (the camera may see new angles). Storyboard frame / sheet / style image → \`attribute_transfer\` (composition or grade only, none of its content). Audio: \`fully_copy\`, \`partially_copy\`, \`reference\`, \`weak_reference\`.
- A style reference marked fully_preserved puts its people in your film; an environment marked fully_preserved locks the camera. These are the two most expensive mistakes.
- **Reference order: identity first** — H3 weighs earlier references more. Characters, products, environments, storyboard/sheet, style. Nine pictures at most.
- MiniMax's band for \`detailed_description\` in a generation task is 350-500 words — the upper bound, not a target.`,
  },
  {
    id: "camera",
    title: "Camera",
    body: `**A camera move is one sentence: type + amplitude + speed (+ focus).** Never metres, never focal lengths, never a multi-part move. A 900-character camera note with distances and lens changes renders as a plain push-in every time, because described end-states get composited instead of performed.

Official types (MiniMax base-en): zoom in/out, push in / pull out, pan left/right, truck left/right, tilt up/down, pedestal up/down, arc shot, tracking shot, static shot, shake slightly/strongly, POV, roll clockwise/counter-clockwise. The owner's prose forms that were verified with Smart Shot:

| move | prose |
|---|---|
| static | is locked off, perfectly still |
| handheld | is handheld, drifting gently with the operator's breath |
| dolly-in | dollies in on a smooth slider |
| push-in / pull-out | pushes in / pulls out |
| track | tracks alongside the subject |
| pan / tilt | pans across the scene / tilts up or down |
| crane-up / crane-down | rises / descends on a crane |
| arc | arcs around the subject in a clean, polished curve |
| orbit | orbits slowly around the subject |
| rack-focus | holds still while focus racks from the foreground to the subject |
| dolly-zoom | dollies in while zooming out, holding the subject's size as the background stretches |

**Reconciled rule (the skills disagreed):** MiniMax writes "with small/large amplitude" and "at slow/fast speed" and **omits the modifier for medium/normal** — so the lab writes medium by leaving it out, not by the word "medium". Bracket tags like \`[Push in]\` are Hailuo-02 syntax and are ignored by H3. Whether plain, big, beat-tied moves ("whips a full half-circle as he turns") beat the official sentence is an open experiment (knob: Camera wording).

Amplitude: static and rack-focus are always small; crane, orbit and arc large; otherwise close-up small, wide large. Speed is slow unless the shot is ≤3 s. Dark scenes move less in H3 — keep moves smaller there. A big move competes with a subject that is travelling; pick one to carry the energy.`,
  },
  {
    id: "structure",
    title: "Shot structure and length",
    body: `**Descriptive detail is written ONCE, in the first shot block. Later shots name the subject and stop.** First block: the look (first two sentences), the wardrobe (first sentence), the set (first two sentences), time of day, palette, the first lighting captions, the style. Every later block: name + label, framing, camera sentence, what happens. Repeating the look invites H3 to re-establish the character instead of continuing them. Truncate at sentence boundaries.

**A shot block:** \`[Shot N] <style, first block only>. A <framing> shot, <lens feel in words> frames SUBJECT (<Subject 1>) in SET (<Subject 2>), <duration> seconds. <camera sentence> <what happens — 2-3 clauses that physically change> <dialogue>\`
Say the lens in words: across 72 curated H3 prompts 4% named a focal length and none an aperture, while 42% stated depth of field in words ("wide-angle, shallow depth of field").

**A 15-second generation is a scene, and H3 will cut inside it.** Timed blocks — \`[Shot 1]\` opens with style and composition, no timestamp; then \`[Shot N] At MM:SS.mmm, the camera cuts to…\` with strictly increasing times — produce distinct shots with identity and grade held, because it is one render. **The timestamps are a clock:** something is due at 4 s and something else at 7 s, so the render has appointments to keep.

**Reconciled rule:** one action and one camera move **per cut** — not per generation. A cut must add new information; for a small framing change use a camera move instead. No more than three timed beats in a shot.

**Length:** about 1,500 characters per shot is the ceiling (h3-prompt); caption-style prose of ~300-500 characters per cut is the floor that still lands (h3-cinematic-prompt). Which band wins per genre is an open experiment (knob: Length budget).`,
  },
  {
    id: "character-continuity",
    title: "Character continuity",
    body: `- Never rely on "the same character". Name the identity explicitly: skin tone, face shape, distinguishing marks with their SIDE ("scar over the LEFT eyebrow"), hair colour + length + style, wardrobe pieces and colours, build.
- Give each character a stable NAME and a \`<Subject N>\` label and use both every time.
- A shot chained on frames takes no reference pictures, so keep **one clause** of identity ("BABY, the one-year-old in the grey cardigan") — enough that a weak handover degrades instead of collapsing into a different person, not so much that it invites a rebuild.
- Cast by shot size: every prompt names skin, build and wardrobe even in a shot of hands (h3-long-story law 2).
- Creatures and stylised characters need a designed reference picture; adjectives alone morph.
- Two people in physical contact (grappling, tangled embraces, carrying a toddler) is the most fragile thing H3 does — limbs merge. Prefer simple contact or keep bodies apart.
- Whether full repetition per shot, define-once, or define-once + anchor clause holds identity best is an open experiment (knob: Identity handling).`,
  },
  {
    id: "environment-continuity",
    title: "Environment continuity",
    body: `- Name the set once with a stable NAME and, when a plate is attached, \`partially_preserved\` retention — so the camera may move.
- State what must not change: door positions, windows, the main furniture and which way it faces, light sources and their colour.
- Light direction and time of day are part of the set; a scene keeps both unless the script changes them.
- Signage and text garble — describe panels and screens without readable text.
- Whether explicit layout ("door on the far-left wall, sofa facing the window") stops furniture drift better than mood-only description is an open experiment (knob: Set description).`,
  },
  {
    id: "action",
    title: "Action and choreography",
    body: `- **Anything that must happen is mid-event in the first frame.** H3 ignores slow wind-ups, things entering from off-frame, a gap closing over time, and how fast a body moves. Props do not start actions.
- One dominant action per clip; packing in events makes H3 freeze.
- Write the change, not the situation — a shot describing a state renders as a still photograph.
- For fights and stunts: who acts, on whom, from which side (screen left/right), and the result. Full-body framing so technique is visible. Avoid two-body grappling.
- A supplied audio track (\`audio_guide\`, \`audio_prompt_type: "A"\`) keeps motion going; written dialogue alone lets motion fade.
- Whether ordered choreography beats beat a single verb-led action is an open experiment (knob: Action writing).`,
  },
  {
    id: "dialogue",
    title: "Dialogue and performance",
    body: `\`(S1) GIRL says: <d>[English] Don't go.</d>\`

- Speaker ids are stable per film: (S1), (S2), (S1,S2) for both. Describe the voice OUTSIDE the tag ("in a low, cracked whisper").
- Lines are verbatim and untranslated inside \`<d>[Language] …</d>\`; H3 lip-syncs them.
- About **2.5 words per second** — a line longer than its shot is cut off and cannot be recovered.
- Voiceover: "says in an off-screen voiceover" and state that the character's lips stay closed.
- \`<scenetrans>\` marks a line that crosses a cut; \`<cutoff>\` marks speech cut off at the end.
- On-screen text, when wanted, goes in double quotes verbatim — but prefer adding text in the edit.
- Performance lives in visible physiology: the smallest change that shows the feeling ("the corner of his mouth tightens").`,
  },
  {
    id: "sound",
    title: "Sound",
    body: `Sound is never optional: H3 always generates audio, so an empty soundscape means the model picks.

\`\`\`
overall_soundscape: <the scene's own sound>. No dialogue except what is written, no music in the ambience.
non_diegetic_music: No music; natural sound only.
\`\`\`

Write \`non_diegetic_music\` as a score only when the film is **one unbroken generation**. A score in a prompt is generated afresh by every shot that reads it, so a film of many generations changes music at every join — lock the master track in the edit. Chained parts lose audio quality after about 4 joins (seesee75 Director measurement); lock the song instead of chaining audio further.`,
  },
  {
    id: "long-form",
    title: "Beyond 15 seconds — chaining",
    body: `- Plan in scenes; chain inside a scene, cut between scenes. **At most 2 continued shots in a row**, then a fresh anchor (the skills disagreed — h3-long-story said 2-4; the measured cap of 2 wins).
- A chained generation takes **no reference images** — references and a continuation answer the same question — so it keeps one identity clause in the prose. Prompt a continued shot as **a transition, not a scene**: describe what changes from where it is.
- WanGP chaining: \`video_source\` + \`sliding_window_overlap\` (1+17k frames, e.g. 35) carries ~1.5 s of real motion AND audio across the join. \`image_start\` (\`image_prompt_type: "S"\`) pins one frame but starts from rest with no audio. \`"SV"\` does both.
- **One boundary, used twice:** the last frame the audience sees and the frame the next shot continues from must be the same frame.
- Every render has a warm-up and a landing (a frozen ending). Plan each shot longer than its slot and trim both; measure before fixing (\`continuity.mjs report\`).
- Measured by the Director paper: a pinned head holds the old action ~2.4 s — do not schedule a new beat in the first ~2.5 s after a join; a shot change in a part's last 2 s gets cut twice; a shot that opens on its own first-frame picture should start an unpinned part.
- Frame lattice: WanGP's H3 takes 107 + 17k frames (124, 141 … 362 per window) at 24 fps; the official lattice is length % 17 == 5.`,
  },
  {
    id: "closing",
    title: "The closing block",
    body: `After the last shot block, in this order: mood keywords · the style essence sentence · cinematography notes as one semicolon-joined line · the match-the-frame instruction when a storyboard frame or sheet is attached · and always:

> Impeccable subject consistency across every shot. No subtitles, no on-screen text, no logos, no extra people.

When a sheet is attached, say "never show the sheet, its text or its layout", or it draws the storyboard.`,
  },
  {
    id: "runtime",
    title: "This PC's H3 (WanGP in Pinokio)",
    body: `- Models on disk: \`minimax_h3_ref2va_pruned\` and \`minimax_h3_fl2va_pruned\` (pruned 20B int8), plus the 4-step turbo LoRAs for each and the two-phase latent upscaler. The 33B, PDD, VDN and ControlNet variants are NOT downloaded.
- **The text encoder is Qwen3-VL-32B at Q2_K (2-bit) — it decides prompt ADHERENCE, not picture quality.** When precise wording ("scrambles" vs "runs") does not land, suspect the encoder before the wording. Only Q2_K is on disk.
- Quality rungs: **turbo** = 4 steps + turbo LoRA, 832×480, one phase (~5.7 min per 124-frame clip on the RTX 3050). **hi** = 20 steps, \`guidance_phases: 2\` to 1664×960 through the learned upscaler (phase 2 is a fixed 3-step pass and costs no step budget).
- The lab compares prompts at ONE rung (paired, same seed) — a prompt result measured at turbo is not evidence about hi.
- Prompt line breaks become separate prompts in WanGP — the compiler flattens newlines to spaces before sending.`,
  },
  {
    id: "failures",
    title: "Documented failure patterns",
    body: `| Symptom | Cause | Fix |
|---|---|---|
| Two of one person | Subject described in two positions (before/after of a move) | One position per person per shot; describe the move once |
| Nothing happens / calm walk instead of a chase | Someone has a position but no verb | One position AND one verb for everything that should act |
| Dolly-zoom renders as push-in | Camera note with distances and focal lengths | One camera sentence from the vocabulary |
| A still photograph | The shot describes a situation, not a change | Write what physically changes, 2-3 clauses |
| Character rebuilt mid-film | Look repeated in later blocks | Detail once; later blocks name and stop |
| Style ref's people appear | Style image marked fully_preserved | attribute_transfer |
| Camera locked to one angle | Environment marked fully_preserved | partially_preserved |
| Music changes at every join | Score written into a multi-generation film | Natural sound per shot; score in the edit |
| Dialogue cut off | Line longer than the shot (~2.5 words/s) | Shorten the line or lengthen the shot |
| The storyboard sheet is drawn | No "never show the sheet" line | Add it to the closing block |
| Freezing mid-clip | Too many events packed in one clip | One dominant action per cut |
| Slow-start action never lands | Wind-up or off-frame entrance | Start mid-event in frame one |
| Merged limbs | Two bodies in close contact | Keep contact simple or bodies apart |`,
  },
  {
    id: "checklist",
    title: "Checklist before rendering",
    body: `1. Is anyone described in more than one position? Cut until they are in one.
2. Is the camera in more than one state per cut? One move from the vocabulary.
3. More than three timed beats in a shot? Merge them.
4. Am I describing something an attached picture already shows? Delete the words.
5. Is every attached file defined and given the right retention?
6. Is descriptive detail repeated after the first shot block?
7. Does every shot name something that physically changes, and does everything that should act have a verb?
8. Is the soundscape written, and is non_diegetic_music right for the number of generations?
9. Continued shot — have I described the change rather than the scene?
10. Does the lens or framing change anywhere, and does any shot hold static? A film where every shot moves at one focal length was never directed.
11. Is it under ~1,500 characters per shot?
12. Does the genre module's continuity list hold (who stands where, what is broken, what is worn)?`,
  },
];

function genreBody(id: string): string {
  const m = GENRES.find((x) => x.id === id)!;
  const knobs = Object.entries(m.strategy)
    .map(([k, v]) => {
      const def = KNOBS.find((d) => d.knob === k);
      const val = def?.values.find((x) => x.value === v);
      return `${def?.label ?? k}: **${val?.label ?? v}**`;
    })
    .join(" · ");
  const weights = Object.entries(m.weights)
    .filter(([, w]) => (w ?? 0) >= 0.9)
    .map(([d]) => d)
    .join(", ");
  return [
    `*${m.essence}*`,
    "",
    ...m.rules.map((r) => `- ${r}`),
    "",
    `**Pacing:** ${m.pacing}`,
    `**Camera language:** ${m.camera.join(" · ")}`,
    `**Must hold across shots:** ${m.continuity.join("; ")}`,
    knobs ? `**Compiler settings:** ${knobs}` : "",
    weights ? `**Scored hardest on:** ${weights}` : "",
  ]
    .filter((l) => l !== "")
    .join("\n");
}

export function seedSections(): GuideSection[] {
  return [
    ...CORE,
    ...GENRES.map((m) => ({ id: `genre:${m.id}`, title: m.name, genre: m.id, body: genreBody(m.id) })),
  ];
}

export const CORE_SECTION_IDS = CORE.map((s) => s.id);
