// ---------------------------------------------------------------------------
// Music Creator — the AI Producer.
//
// The user's words are the STARTING POINT, not the final prompt. This module
// turns a basic idea ("dark club song, crazy hook, singing behind the rapper")
// or an advanced production prompt into what a music model can act on:
//
//   user idea
//     → 1. PRODUCER   reads the intent and designs the record (plan)
//     → 2. ENGINEER   writes the style (≤1,000 chars), lyrics, vocal and
//                     arrangement direction from that plan
//     → 3. QC         checks it in code (below), not on the model's word
//     → 4. REVISE     one targeted rewrite naming the exact failures
//     → music generator
//
// Priority order, the owner's: PRODUCTION > VIBE > MELODY > VOCALS > LYRICS.
// So the plan is made before a single lyric is written.
//
// The optimiser is OPTIONAL on every prompt — Song Creator can send the
// user's style and lyrics to the engine exactly as typed. Nothing here runs
// unless they ask for it.
//
// Pure: prompts, checks, the style fitter and the offline producer. The route
// (src/app/api/music-creator/produce) does the fetching.
// ---------------------------------------------------------------------------

export const STYLE_LIMIT = 1000;
/** Below this a detailed style is leaving useful space on the table. */
export const STYLE_FLOOR = 380;

export type LyricsMode = "keep" | "polish" | "write";

export interface ProduceInput {
  /** What the user typed as the style — a basic idea or a full production prompt. */
  style: string;
  /** The user's lyrics, if any. */
  lyrics: string;
  /** keep = sing mine exactly · polish = improve mine · write = write new ones. */
  lyricsMode: LyricsMode;
  /** Lean on the owner's taste profile (TASTE) where the idea leaves gaps. */
  useTaste: boolean;
  title?: string;
}

/** The producer's read of the idea — shown to the user as "what the producer heard". */
export interface ProducerPlan {
  /** basic = a simple idea to expand · advanced = a detailed prompt to clean up, not rewrite. */
  mode: "basic" | "advanced";
  /** The idea restated in one line, in the user's own terms. */
  intent: string;
  /** The things that must survive any optimisation, quoted/paraphrased from the user. */
  mustKeep: string[];
  genre: string;
  era: string;
  mood: string;
  energy: string;
  tempo: string;
  vocalist: string;
  hook: string;
  melody: string;
  drums: string;
  bass: string;
  instruments: string;
  behindLead: string;
  vocalProduction: string;
  build: string;
  stripBack: string;
  peak: string;
  surprise: string;
  identity: string;
  /** What gets REMOVED so the important moment hits harder. */
  remove: string;
  /** Reference songs the user named, translated into original production concepts. */
  references: { name: string; takeaway: string }[];
  missing: string[];
  assumptions: string[];
  contradictions: string[];
}

export interface ArrangementStep {
  section: string;
  /** 1-10 */
  energy: number;
  what: string;
}

export interface QcCheck {
  id: string;
  group: "intent" | "production" | "melody" | "vocals" | "style" | "lyrics" | "generation";
  label: string;
  pass: boolean;
  /** What to tell the model when it fails. */
  fix: string;
}

export interface Production {
  engine: "ai" | "local";
  original: { style: string; lyrics: string };
  plan: ProducerPlan;
  /** The full optimised instruction, readable by a human or another generator. */
  optimizedPrompt: string;
  /** ≤ 1,000 characters, always. */
  style: string;
  lyrics: string;
  title: string;
  vocalDirection: string;
  productionDirection: string;
  arrangement: ArrangementStep[];
  checks: QcCheck[];
  revisions: number;
  warnings: string[];
}

// ----- the owner's taste -----------------------------------------------------
//
// CONCEPTS to extract, never things to copy: no artist voice, identity, melody
// or lyric, and no artist or song name ever lands in the style prompt.

export const TASTE = `THE OWNER'S TASTE — production concepts they respond to. Use them only to fill gaps the
request leaves open; the request always wins. Extract concepts, never copy a voice, melody, lyric or song,
and never write an artist or song name into any output field.
- Timeless party R&B/hip-hop (T-Pain "I'm in Luv wit a Stripper"): nightlife atmosphere, one simple melodic
  idea repeated until it is addictive, commercial hook instinct.
- Dancefloor electronic (Regard "Ride It"): hypnotic groove, strong melodic repetition, polished club
  movement, instant identity.
- Party bounce (Zeddy Will "Back Back"): aggressive rhythm, bounce, infectious chant-like vocal moments.
- FAVOURITE — evolving emotional electronic (EMBRZ "Breathe"): beautiful melodies, spacious textures,
  cinematic builds, emotional payoff, production that DEVELOPS instead of sitting on one loop.
- The "barely hear it" vocal (Kanye West "Through the Wire", G Herbo "Went Legit"): a sung hook partly
  buried — distant, filtered, band-passed, pitched, chopped, reverb- or tape-soaked, layered under the
  lead — hard to understand yet melodically powerful. The vocal becomes part of the production.
- Rap over a sung layer (Trendy K "No Regrets", YFG Fatso "Roll Out" for rap energy/attitude): the rapper
  stays in front while singing lives underneath — held notes, harmonies, answers, doubles, a distant hook.
- Hates: robotic, perfectly quantized vocals delivered the same way every section; intro → loop → verse →
  same loop arrangements; songs that sound like a pile of genre presets.`;

// ----- what the music engine can take ---------------------------------------

const ENGINE_RULES = `THE MUSIC ENGINE (YuE2; the style is also pasted into Suno-style engines):
- style: ONE paragraph of comma/semicolon-separated production language, hard maximum 1,000 characters.
  Order clauses by importance, most important first. No section tags, no lyrics, no artist or song names,
  no sentences addressed to the model ("create", "make", "please").
- lyrics: section tags alone on their own line — [Intro] [Verse] [Pre-Chorus] [Chorus] [Post-Chorus]
  [Hook] [Bridge] [Breakdown] [Outro] — with the sung words beneath, blank line between sections.
  EVERY character outside a tag is performed, so never put production notes, instrument cues, stage
  directions or "(x2)" in the lyrics. Backing vocals / ad-libs go in parentheses ONLY when they are
  words to be sung, e.g. "(oh, don't stop)".`;

const FILLER_RULE = `Never use filler that tells a generator nothing: "professional production", "high quality",
"amazing vocals", "catchy and emotional", "modern sound", "radio-ready", "epic", "banger", "hit".
Use production language it can act on. BAD: "a professional modern amazing club track". BETTER:
"punchy four-on-the-floor drums, elastic sub-bass, hypnotic synth motif, restrained verses, rising
pre-chorus tension, wider chorus with layered background vocals, short drum dropout before the final hook".`;

// ----- stage 1: the producer -------------------------------------------------

export function producerSystem(useTaste: boolean): string {
  return `You are a record producer who has actually made records. A user has an idea for a song. Before anything
is written, you design the RECORD. Priorities: PRODUCTION > VIBE > MELODY > VOCALS > LYRICS.

The user's idea is the source of truth; you are the producer helping execute it. Never change what they asked
for (a fun party song must not become a sad ballad). You may add what serves it: groove, bass movement,
background harmonies, vocal layering, intro concept, chorus dynamics, transitions.

First decide the MODE:
- "basic": a simple idea — expand it with smart, specific decisions.
- "advanced": the user already wrote a detailed production prompt — keep their decisions and wording where
  they are good, fix contradictions and vague spots, fill only real gaps. Do not rewrite good instructions
  into generic AI language.

Ask yourself like a producer: What is the identity of this record? What is the hook, and what makes a
listener remember it — could they recognise it without the full instrumental? What happens underneath the
lead? Is a vocal used as an instrument? Where does the energy change, strip back, build, and peak? Where is
the surprise? What makes the second chorus different from the first? What makes the intro recognisable?
What can be REMOVED so the important moment hits harder (good production is not only adding)?

Be contextual — do not force one formula. A stripped emotional song may need very little. A club song
needs constant rhythmic movement. A rap song needs vocal layering and beat pockets. Electronic music needs
evolving textures. Pick only the techniques that fit (drum/bass variation, percussion entrances, counter
melodies, beat drops, silence, filtered transitions, reverb/delay throws, half-time moments, fake drops,
new background vocals, an altered final chorus, a different outro).

Vocal tools you know: buried / distant / filtered / band-passed / heavily reverberated / distorted /
chopped / pitched / layered / whispered background hooks; rap in front with singing underneath (held
notes, harmonies, doubles, call-and-response, sung phrases, ad-libs). Human delivery: natural phrasing,
timing variation, breaths, changing intensity, doubles, different delivery per section.

If the user names reference songs, analyse what is useful in them (tempo, groove, drums, bass, chords,
melody, vocal treatment, hook construction, sound design, dynamics, transitions, use of silence) and
translate that into ORIGINAL instructions.
${useTaste ? `\n${TASTE}\n` : ""}
Answer ONLY with JSON:
{"mode":"basic"|"advanced","intent":string,"mustKeep":[string],"genre":string,"era":string,"mood":string,
"energy":string,"tempo":string (a BPM, and feel e.g. half-time),"vocalist":string,"hook":string,
"melody":string,"drums":string,"bass":string,"instruments":string,"behindLead":string,
"vocalProduction":string,"build":string,"stripBack":string,"peak":string,"surprise":string,
"identity":string,"remove":string,"references":[{"name":string,"takeaway":string}],
"missing":[string],"assumptions":[string],"contradictions":[string]}
Every string is one or two concrete lines, not an essay. "mustKeep" lists the user's non-negotiables.`;
}

export function producerUser(input: ProduceInput): string {
  const lines = [`USER'S STYLE / IDEA (verbatim):\n${input.style.trim() || "(empty — they only gave lyrics)"}`];
  if (input.lyrics.trim()) {
    lines.push(`USER'S LYRICS (${input.lyricsMode === "keep" ? "must be sung exactly as written" : input.lyricsMode === "polish" ? "improve, keep their voice and ideas" : "reference only — new lyrics will be written"}):\n${input.lyrics.trim()}`);
  }
  if (input.title?.trim() && input.title !== "Untitled") lines.push(`Working title: ${input.title.trim()}`);
  return lines.join("\n\n");
}

// ----- stage 2: the prompt engineer + songwriter ----------------------------

export function engineerSystem(lyricsMode: LyricsMode): string {
  const lyricTask =
    lyricsMode === "keep"
      ? `LYRICS: the user's lyrics are sung EXACTLY as written. Return them unchanged in "lyrics". Put your vocal ideas in vocalDirection instead.`
      : `LYRICS: write complete, finished lyrics — never "[insert chorus]" or "..." or instructions. Use the
sections the song needs (e.g. Intro, Verse, Pre-Chorus, Chorus, Verse 2, Bridge/Breakdown, Final Chorus,
Outro — not rigid). Lyrics serve the production concept: personality, natural spoken-rhythm phrasing,
rhythmic variation between sections, a hook worth repeating, intentional repetition, concrete images.
No generic AI poetry (no "neon dreams", "shattered hearts", "we rise", "in the night we come alive"
clichés). Verse 2 should not mirror verse 1. The final chorus may add a line, an answer or a lift.
${lyricsMode === "polish" ? "The user wrote a draft: keep their ideas, voice and best lines; fix what is weak." : ""}
For rap + singing: the rap verses are dense and rhythmic; sung background phrases can appear in parentheses.`;

  return `You are the prompt engineer and songwriter working under a record producer. You get the user's original
idea and the producer's plan. You turn the plan into what the music model can act on.

${ENGINE_RULES}

STYLE (≤ 1,000 characters — HARD limit; plan it to fit, never write long and cut): genre + era, vibe,
energy, tempo in BPM, the melodic identity/motif, lead vocal character and delivery, what sits behind the
lead, vocal production, drums, bass behaviour, key instruments/textures/sound design, the arrangement
arc (where it strips back, builds, drops, peaks, what changes for the final chorus), mix character.
Most important first, so if anything is ever dropped it is the least important clause. Aim for 700-980
characters for a produced song; a deliberately bare song may be shorter.
${FILLER_RULE}

Keep the user's intent (the producer's "mustKeep") visibly present in the style.

${lyricTask}

VOCAL DIRECTION: 3-6 lines. Lead delivery per section (it must change between sections), doubles,
harmonies, ad-libs, breaths, what the background voices do, any "barely hear it" treatment. Written
against robotic delivery.

PRODUCTION DIRECTION: 3-6 lines of concrete production moves — the surprises, what drops out and why,
transitions, the final-chorus change, the outro.

ARRANGEMENT: the song section by section with energy 1-10 and what changes there. It must EVOLVE — no
two sections described the same way.

OPTIMIZED PROMPT: one complete paragraph (can be longer than the style) that a human or any music
generator could read as the full production brief: identity, groove, hook, vocal arrangement, dynamics,
arrangement arc, sound design, mix. Better, not just longer.

Answer ONLY with JSON:
{"title":string,"optimizedPrompt":string,"style":string,"lyrics":string,"vocalDirection":string,
"productionDirection":string,"arrangement":[{"section":string,"energy":number,"what":string}]}`;
}

export function engineerUser(input: ProduceInput, plan: ProducerPlan): string {
  return [
    `ORIGINAL IDEA (verbatim, the source of truth):\n${input.style.trim() || "(none — lyrics only)"}`,
    input.lyrics.trim() ? `USER'S LYRICS:\n${input.lyrics.trim()}` : "USER'S LYRICS: none",
    `PRODUCER'S PLAN:\n${JSON.stringify(plan, null, 1)}`,
  ].join("\n\n");
}

// ----- stage 4: targeted revision -------------------------------------------

export function reviseSystem(lyricsMode: LyricsMode): string {
  return `You are the same prompt engineer. Your draft failed quality control. Fix ONLY the listed failures
and keep everything else, including the user's intent. ${lyricsMode === "keep" ? "The lyrics are the user's own — leave them exactly as they are." : ""}

${ENGINE_RULES}
${FILLER_RULE}

Answer ONLY with the same JSON shape as the draft:
{"title":string,"optimizedPrompt":string,"style":string,"lyrics":string,"vocalDirection":string,
"productionDirection":string,"arrangement":[{"section":string,"energy":number,"what":string}]}`;
}

export function reviseUser(draft: Omit<Production, "checks" | "engine" | "revisions" | "warnings" | "original" | "plan">, failures: QcCheck[], plan: ProducerPlan): string {
  return [
    `FAILURES TO FIX:\n${failures.map((f) => `- ${f.label}: ${f.fix}`).join("\n")}`,
    `USER'S NON-NEGOTIABLES: ${plan.mustKeep.join("; ") || plan.intent}`,
    `DRAFT:\n${JSON.stringify(draft, null, 1)}`,
  ].join("\n\n");
}

// ----- parsing what the model returned ---------------------------------------

const str = (v: unknown, max = 600) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const strList = (v: unknown, n = 8) => (Array.isArray(v) ? v.map((x) => str(x, 240)).filter(Boolean).slice(0, n) : []);

export function readPlan(raw: Record<string, unknown>, input: ProduceInput): ProducerPlan {
  const refs = Array.isArray(raw.references) ? raw.references : [];
  return {
    mode: raw.mode === "advanced" ? "advanced" : "basic",
    intent: str(raw.intent, 300) || input.style.trim().slice(0, 300),
    mustKeep: strList(raw.mustKeep),
    genre: str(raw.genre),
    era: str(raw.era),
    mood: str(raw.mood),
    energy: str(raw.energy),
    tempo: str(raw.tempo),
    vocalist: str(raw.vocalist),
    hook: str(raw.hook),
    melody: str(raw.melody),
    drums: str(raw.drums),
    bass: str(raw.bass),
    instruments: str(raw.instruments),
    behindLead: str(raw.behindLead),
    vocalProduction: str(raw.vocalProduction),
    build: str(raw.build),
    stripBack: str(raw.stripBack),
    peak: str(raw.peak),
    surprise: str(raw.surprise),
    identity: str(raw.identity),
    remove: str(raw.remove),
    references: refs
      .filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
      .map((r) => ({ name: str(r.name, 120), takeaway: str(r.takeaway, 300) }))
      .filter((r) => r.name)
      .slice(0, 6),
    missing: strList(raw.missing),
    assumptions: strList(raw.assumptions),
    contradictions: strList(raw.contradictions),
  };
}

export type Draft = Omit<Production, "checks" | "engine" | "revisions" | "warnings" | "original" | "plan">;

export function readDraft(raw: Record<string, unknown>, input: ProduceInput): Draft {
  const arrangement = Array.isArray(raw.arrangement) ? raw.arrangement : [];
  return {
    title: str(raw.title, 80) || "Untitled",
    optimizedPrompt: typeof raw.optimizedPrompt === "string" ? raw.optimizedPrompt.replace(/\s+/g, " ").trim().slice(0, 4000) : "",
    style: normalizeStyle(typeof raw.style === "string" ? raw.style : ""),
    lyrics:
      input.lyricsMode === "keep" && input.lyrics.trim()
        ? input.lyrics // the user's own words are never touched in keep mode
        : tidyLyrics(typeof raw.lyrics === "string" ? raw.lyrics : ""),
    vocalDirection: typeof raw.vocalDirection === "string" ? raw.vocalDirection.trim().slice(0, 1500) : "",
    productionDirection: typeof raw.productionDirection === "string" ? raw.productionDirection.trim().slice(0, 1500) : "",
    arrangement: arrangement
      .filter((a): a is Record<string, unknown> => !!a && typeof a === "object")
      .map((a) => ({
        section: str(a.section, 40) || "Section",
        energy: Math.max(1, Math.min(10, Math.round(Number(a.energy) || 5))),
        what: str(a.what, 400),
      }))
      .slice(0, 16),
  };
}

// ----- the style ------------------------------------------------------------

export function charCount(s: string): number {
  return Array.from(s).length;
}

/** One paragraph, no label, no markdown, straight quotes. */
export function normalizeStyle(raw: string): string {
  return raw
    .replace(/^\s*(style( prompt)?|prompt)\s*:\s*/i, "")
    .replace(/\*\*|`/g, "")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s*\n+\s*/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim()
    .replace(/^"(.*)"$/, "$1");
}

/**
 * The last-resort guarantee of ≤ 1,000 characters.
 *
 * The model is asked to write to the limit and a long draft goes back for a
 * rewrite first. If it is STILL long, whole clauses are dropped from the end —
 * the prompt orders clauses most-important-first, so the tail is what matters
 * least — and a clause is never cut mid-word. Returns whether it had to.
 */
export function fitStyle(style: string, limit = STYLE_LIMIT): { style: string; dropped: number } {
  let text = normalizeStyle(style);
  if (charCount(text) <= limit) return { style: text, dropped: 0 };
  const clauses = text.split(/(?<=[,;.])\s+/);
  let dropped = 0;
  while (clauses.length > 1 && charCount(clauses.join(" ").replace(/[,;]\s*$/, "")) > limit) {
    clauses.pop();
    dropped++;
  }
  text = clauses.join(" ").replace(/[,;]\s*$/, "").trim();
  // One monster clause with no separators at all: end on a word boundary.
  if (charCount(text) > limit) {
    text = Array.from(text).slice(0, limit).join("");
    text = text.slice(0, text.lastIndexOf(" ") > 0 ? text.lastIndexOf(" ") : undefined).trim();
    dropped++;
  }
  return { style: text, dropped };
}

/** Phrases that take space and tell a music model nothing. */
export const FILLER: RegExp[] = [
  /\bprofessional(ly)?( production| sound| mix)?\b/i,
  /\bhigh[\s-]quality\b/i,
  /\bamazing\b/i,
  /\bcatchy and emotional\b/i,
  /\bmodern (sound|production|vibe|feel)\b/i,
  /\bincredible\b/i,
  /\bawesome\b/i,
  /\bradio[\s-]ready\b/i,
  /\bworld[\s-]class\b/i,
  /\btop[\s-]notch\b/i,
  /\bhit (song|record)\b/i,
  /\bbanger\b/i,
  /\bgreat (vocals?|production|song|sound)\b/i,
  /\bwell[\s-]produced\b/i,
  /\bstate[\s-]of[\s-]the[\s-]art\b/i,
];

export function fillerIn(text: string): string[] {
  return FILLER.map((re) => text.match(re)?.[0]).filter((m): m is string => !!m);
}

// ----- lyrics ---------------------------------------------------------------

const SECTION_TAG = /^\s*\[([^\]]+)\]\s*$/;

/** Parenthetical stage directions on their own line are notes, not words — YuE2 would sing them. */
export function tidyLyrics(lyrics: string): string {
  return lyrics
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter((line) => !/^\s*[({[]?\s*(note|production|instrument\w*|guitar|drums?|synth|beat|bass|fx)\s*:/i.test(line))
    .filter((line) => !/^\s*\((instrumental|beat drops?|drop|pause|silence|music|x\d|repeat)[^)]*\)\s*$/i.test(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function sectionTags(lyrics: string): string[] {
  return lyrics
    .split("\n")
    .map((l) => l.match(SECTION_TAG)?.[1]?.trim())
    .filter((t): t is string => !!t);
}

const PLACEHOLDER = /\[(insert|add|your|repeat)[^\]]*\]|\binsert (chorus|verse|lyrics)\b|\blorem ipsum\b|^\s*(…|\.\.\.)\s*$|\bTBD\b/im;

// ----- intent preservation ---------------------------------------------------
//
// Concepts a user can ask for, each with the words that show it survived. If
// the user's idea mentions one and neither the style nor the optimised prompt
// does, the optimiser lost it — which is the one failure the owner cares most
// about ("never turn a party song into a sad ballad").

export const CONCEPTS: { id: string; label: string; ask: RegExp; keep: RegExp }[] = [
  { id: "club", label: "club / party", ask: /\b(club|party|dance ?floor|rave|night ?club)\b/i, keep: /\b(club|party|dance|dancefloor|four-on-the-floor|nightlife|rave)\w*/i },
  { id: "dark", label: "dark", ask: /\b(dark|sinister|menacing|gloomy|moody)\b/i, keep: /\b(dark|minor|sinister|menac|moody|ominous|shadow|gloom|nocturn)\w*/i },
  { id: "rap", label: "rap", ask: /\b(rap|rapper|rapping|bars|hip[- ]?hop|trap|drill)\b/i, keep: /\b(rap|hip[- ]?hop|trap|drill|bars|flow|rhym)\w*/i },
  { id: "sung", label: "singing", ask: /\b(sing|singing|sung|singer|melodic vocal|harmon)\w*/i, keep: /\b(sing|sung|singer|melod|harmon|vocal|croon|choir|hum)\w*/i },
  { id: "hook", label: "the hook", ask: /\bhook\b/i, keep: /\bhook/i },
  { id: "sad", label: "sad / emotional", ask: /\b(sad|heartbreak|emotional|melanchol|cry|lonely)\w*/i, keep: /\b(sad|heartbr|emotion|melanchol|ache|lonel|bittersweet|tender|yearn|wistful|mournful)\w*/i },
  { id: "fun", label: "fun / upbeat", ask: /\b(fun|happy|upbeat|joyful|feel[- ]good)\b/i, keep: /\b(fun|happy|upbeat|joy|bright|feel-good|playful|euphor|uplift|carefree)\w*/i },
  { id: "surprise", label: "production surprises", ask: /\bsurpris\w*|\bunexpected\b/i, keep: /\b(surpris|unexpected|drop ?out|fake drop|switch|twist|silence|stop|cut)\w*/i },
  { id: "electronic", label: "electronic", ask: /\b(edm|electronic|house|techno|synth)\w*/i, keep: /\b(edm|electronic|house|techno|synth|electro)\w*/i },
  { id: "rnb", label: "R&B", ask: /\b(r ?& ?b|rnb|soul)\b/i, keep: /\b(r&b|rnb|r & b|soul)\w*/i },
  { id: "acoustic", label: "acoustic", ask: /\bacoustic\b/i, keep: /\bacoustic\b/i },
  { id: "buried", label: "buried / background vocal", ask: /\b(buried|behind the|background (vocal|singing)|barely hear|distant vocal|underneath)\b/i, keep: /\b(buried|behind|background|distant|underneath|under the|filtered|low in the mix|ghost)\w*/i },
];

export function askedConcepts(idea: string) {
  return CONCEPTS.filter((c) => c.ask.test(idea));
}

// ----- quality control ---------------------------------------------------------

export function runQc(input: ProduceInput, plan: ProducerPlan, draft: Draft): QcCheck[] {
  const checks: QcCheck[] = [];
  const add = (c: QcCheck) => checks.push(c);
  const both = `${draft.style} ${draft.optimizedPrompt}`;
  const chars = charCount(draft.style);

  // INTENT
  const lost = askedConcepts(input.style).filter((c) => !c.keep.test(both));
  add({
    id: "intent",
    group: "intent",
    label: "Original idea preserved",
    pass: lost.length === 0,
    fix: `The user asked for ${lost.map((c) => c.label).join(", ")} — it must be clearly present in the style and the optimized prompt.`,
  });

  // PRODUCTION
  add({
    id: "arrangement",
    group: "production",
    label: "Arrangement evolves (no looped sections)",
    pass: draft.arrangement.length >= 3 && new Set(draft.arrangement.map((a) => a.what.toLowerCase())).size === draft.arrangement.length,
    fix: "Give at least 4 arrangement steps, each describing what CHANGES there; no two sections described the same way.",
  });
  const energies = draft.arrangement.map((a) => a.energy);
  add({
    id: "dynamics",
    group: "production",
    label: "Intentional dynamic changes",
    pass: energies.length < 3 || Math.max(...energies) - Math.min(...energies) >= 3,
    fix: "The energy curve is flat. Plan a real strip-back and a real peak (energy range of at least 3).",
  });
  add({
    id: "specific",
    group: "production",
    label: "Production is specific (drums, bass, sound design)",
    pass: /\b(drum|kick|snare|hat|808|percussion|beat|groove)\w*/i.test(draft.style) && /\b(bass|808|sub)\w*/i.test(draft.style),
    fix: "Name the drum behaviour and the bass behaviour in the style.",
  });

  // MELODY
  add({
    id: "melody",
    group: "melody",
    label: "A memorable melodic idea is named",
    pass: /\b(motif|melod|hook|riff|lead|topline|arpegg|counter-?melod|refrain)\w*/i.test(draft.style),
    fix: "Name the melodic identity in the style (the motif, riff or hook and what plays or sings it).",
  });

  // VOCALS
  const instrumental = /\binstrumental\b/i.test(input.style) && !input.lyrics.trim();
  add({
    id: "vocal-specific",
    group: "vocals",
    label: "Vocal direction is specific",
    pass: instrumental || (/\b(vocal|voice|singer|rapper|rap|sung|sing)\w*/i.test(draft.style) && draft.vocalDirection.length >= 60),
    fix: "Describe the lead vocal's character and delivery in the style, and give real per-section vocal direction.",
  });
  add({
    id: "human",
    group: "vocals",
    label: "Guards against robotic delivery",
    pass: instrumental || /\b(breath|double|harmon|ad-?lib|imperfect|behind the beat|loose|dynamic|intensity|layer|whisper|phrasing)\w*/i.test(`${draft.vocalDirection} ${draft.style}`),
    fix: "Add human delivery cues: breaths, doubles, harmonies, ad-libs, changing intensity between sections.",
  });

  // STYLE
  add({
    id: "limit",
    group: "style",
    label: `Style ≤ ${STYLE_LIMIT.toLocaleString()} characters`,
    pass: chars > 0 && chars <= STYLE_LIMIT,
    fix: `The style is ${chars} characters. Rewrite it to at most ${STYLE_LIMIT} by compressing — merge clauses, cut adjectives — not by dropping the most important ideas.`,
  });
  add({
    id: "space",
    group: "style",
    label: "Character space used well",
    pass: chars >= STYLE_FLOOR || /\b(minimal|stripped|sparse|bare|solo)\b/i.test(plan.identity + input.style),
    fix: `The style is only ${chars} characters. Use the space (aim 700-980) for melody, vocal treatment, arrangement arc and mix.`,
  });
  const filler = fillerIn(draft.style);
  add({
    id: "filler",
    group: "style",
    label: "No generic filler",
    pass: filler.length === 0,
    fix: `Replace filler (${filler.join(", ")}) with concrete production language.`,
  });
  add({
    id: "tempo",
    group: "style",
    label: "Tempo given",
    pass: /\b\d{2,3}\s?bpm\b/i.test(draft.style),
    fix: "State the tempo in BPM in the style.",
  });
  const names = plan.references.map((r) => r.name).flatMap((n) => n.split(/\s+[-–—]\s+|\s+by\s+|"|,/)).map((s) => s.trim()).filter((s) => s.length > 3);
  const leaked = names.filter((n) => draft.style.toLowerCase().includes(n.toLowerCase()));
  add({
    id: "names",
    group: "style",
    label: "No artist or song names",
    pass: leaked.length === 0,
    fix: `Remove ${leaked.join(", ")} from the style; describe the production concept instead.`,
  });

  // LYRICS
  if (input.lyricsMode !== "keep" || !input.lyrics.trim()) {
    const tags = sectionTags(draft.lyrics);
    add({
      id: "lyrics-complete",
      group: "lyrics",
      label: "Complete, finished lyrics",
      pass: instrumental || (tags.length >= 3 && !PLACEHOLDER.test(draft.lyrics) && draft.lyrics.split("\n").filter((l) => l.trim() && !SECTION_TAG.test(l)).length >= 12),
      fix: "Write the whole song — every section finished, at least 3 sections, no placeholders or '...'.",
    });
    add({
      id: "lyrics-hook",
      group: "lyrics",
      label: "Has a chorus / hook that repeats",
      pass: instrumental || tags.some((t) => /chorus|hook|refrain/i.test(t)),
      fix: "Add a [Chorus] or [Hook] section — the memorable, repeated part.",
    });
  }
  add({
    id: "lyrics-clean",
    group: "generation",
    label: "Nothing unsingable in the lyrics",
    pass: tidyLyrics(draft.lyrics) === draft.lyrics.trim() || input.lyricsMode === "keep",
    fix: "Remove production notes and stage directions from the lyrics — the engine sings every word.",
  });
  add({
    id: "prompt",
    group: "generation",
    label: "Optimized prompt written",
    pass: draft.optimizedPrompt.length >= 200,
    fix: "Write the full optimized prompt paragraph.",
  });
  return checks;
}

// ----- the offline producer --------------------------------------------------
//
// No AI key: a real, rule-based producer rather than a pretend one. It reads
// the concepts in the idea, picks production decisions from a small palette
// that fits them, and writes a legal ≤1,000-char style. It cannot write lyrics,
// so it keeps the user's or leaves a tagged scaffold — and says so.

interface Palette {
  genre: string;
  tempo: string;
  drums: string;
  bass: string;
  melody: string;
  texture: string;
}

const PALETTES: { when: RegExp; p: Palette }[] = [
  {
    when: /\b(drill)\b/i,
    p: { genre: "dark UK/NY drill", tempo: "142 BPM half-time feel", drums: "sliding 808 patterns, skippy hats, syncopated snares", bass: "gliding 808 bass that answers the vocal", melody: "haunting minor-key choir or string motif", texture: "cold reverb, sparse piano stabs" },
  },
  {
    when: /\b(trap|rap|rapper|hip[- ]?hop)\b/i,
    p: { genre: "modern hip-hop / trap", tempo: "140 BPM with a half-time bounce", drums: "punchy kick, crisp snare on 3, rolling triplet hats with drops", bass: "distorted 808 that slides into the downbeats", melody: "a short, repeating minor-key synth or bell motif", texture: "dark pads, vinyl-warm samples" },
  },
  {
    when: /\b(house|techno|edm|club|dance ?floor|rave)\b/i,
    p: { genre: "club house / electronic dance", tempo: "124 BPM", drums: "four-on-the-floor kick, open hats on the off-beat, clap on 2 and 4, shuffled percussion", bass: "elastic rolling bassline locked to the kick", melody: "a hypnotic, repeating synth hook that stays in the head", texture: "filter sweeps, side-chained pads" },
  },
  {
    when: /\b(r ?& ?b|rnb|soul|slow jam)\b/i,
    p: { genre: "R&B", tempo: "92 BPM", drums: "laid-back swung drums, finger snaps, soft rimshot", bass: "warm round bass with slides", melody: "a sung topline hook built on one simple, addictive phrase", texture: "Rhodes chords, lush vocal stacks" },
  },
  {
    when: /\b(ballad|acoustic|piano|folk)\b/i,
    p: { genre: "intimate acoustic ballad", tempo: "74 BPM", drums: "no drums at first, brushed kit later", bass: "soft upright bass entering in the second verse", melody: "a singable melody that climbs into the chorus", texture: "felt piano, close-mic guitar, room tone" },
  },
  {
    when: /\b(electronic|synth|ambient|cinematic)\b/i,
    p: { genre: "emotional melodic electronic", tempo: "118 BPM", drums: "soft kick building to a full beat, glitched percussion", bass: "deep sub pulses that swell into the drop", melody: "a beautiful lead melody played on a warm pluck, echoed by a vocal chop", texture: "wide evolving pads, granular textures, long reverb tails" },
  },
];

const DEFAULT_PALETTE: Palette = {
  genre: "modern pop",
  tempo: "104 BPM",
  drums: "tight programmed drums with live percussion accents",
  bass: "melodic bass that moves with the chords",
  melody: "a clear, repeating hook motif carried by the lead voice and a synth",
  texture: "warm pads, clean guitar or keys",
};

export function offlineProduce(input: ProduceInput): Production {
  const idea = input.style.trim();
  const asked = new Set(askedConcepts(idea).map((c) => c.id));
  const palette = PALETTES.find((x) => x.when.test(idea))?.p ?? DEFAULT_PALETTE;
  const rap = asked.has("rap");
  const sung = asked.has("sung") || asked.has("buried");
  const mood = [asked.has("dark") && "dark, nocturnal", asked.has("fun") && "fun, playful", asked.has("sad") && "aching, emotional"].filter(Boolean).join(", ");
  const bpm = idea.match(/\b\d{2,3}\s?bpm\b/i)?.[0];

  const vocal = rap
    ? sung
      ? "confident rap lead in front with a melodic singer underneath: held notes, harmonies and a distant sung hook that answers the bars"
      : "confident, rhythmic rap lead with punch-ins and ad-libs"
    : "expressive lead vocal with natural phrasing and breaths";
  const behind = asked.has("buried") || (rap && sung)
    ? "background hook partly buried: filtered, reverb-soaked, layered and slightly pitched so it reads as texture"
    : "doubles and harmonies enter on the chorus";
  const arc = asked.has("surprise")
    ? "restrained verse, rising pre-chorus, full-drum drop out right before the hook, filtered breakdown with a delay throw, final chorus adds a new counter-melody and extra vocal layers"
    : "stripped intro, verse with room, pre-chorus lift, wider chorus, bass drops out in the bridge, bigger final chorus";

  // A second concept the palette does not already carry is blended in, so
  // "club song with a rapper" is club-ready hip-hop, not just hip-hop.
  const flavour = [
    asked.has("club") && !/club|dance/i.test(palette.genre) && "club-ready party",
    asked.has("electronic") && !/electronic/i.test(palette.genre) && "electronic-leaning",
    asked.has("rnb") && !/r&b/i.test(palette.genre) && "R&B-tinged",
  ].filter(Boolean);
  const clauses = [
    [mood, ...flavour, palette.genre].filter(Boolean).join(" "),
    bpm ?? palette.tempo,
    palette.melody,
    vocal,
    behind,
    palette.drums,
    palette.bass,
    palette.texture,
    arc,
    "human delivery with breaths and changing intensity between sections",
    "wide, punchy mix with space around the vocal",
  ];
  const { style } = fitStyle(clauses.join(", "));

  const arrangement: ArrangementStep[] = [
    { section: "Intro", energy: 3, what: "the hook motif alone, filtered — the record's identity in the first bars" },
    { section: "Verse 1", energy: 4, what: `${rap ? "rap" : "lead vocal"} over drums and bass only, space left for the words` },
    { section: "Pre-Chorus", energy: 6, what: "filter opens, percussion enters, tension rises" },
    { section: "Chorus", energy: 8, what: `the hook lands; ${behind}` },
    { section: "Verse 2", energy: 5, what: "new percussion and a counter-line — not a copy of verse 1" },
    { section: "Bridge", energy: 3, what: "bass drops out, vocals and texture only" },
    { section: "Final Chorus", energy: 10, what: "everything back plus an extra vocal layer and a new melodic answer" },
    { section: "Outro", energy: 3, what: "the hook motif alone again, fading into reverb" },
  ];

  const lyrics =
    input.lyrics.trim() ||
    ["[Intro]", "", "[Verse]", idea ? idea.split(/[.!?]/)[0] : "…", "", "[Chorus]", "", "[Verse]", "", "[Bridge]", "", "[Chorus]"].join("\n");

  const plan: ProducerPlan = {
    mode: idea.length > 300 ? "advanced" : "basic",
    intent: idea || "(lyrics only)",
    mustKeep: [...asked].map((id) => CONCEPTS.find((c) => c.id === id)!.label),
    genre: palette.genre,
    era: "",
    mood,
    energy: asked.has("club") || asked.has("fun") ? "high" : "",
    tempo: bpm ?? palette.tempo,
    vocalist: vocal,
    hook: palette.melody,
    melody: palette.melody,
    drums: palette.drums,
    bass: palette.bass,
    instruments: palette.texture,
    behindLead: behind,
    vocalProduction: behind,
    build: "pre-chorus lift into a wider chorus",
    stripBack: "bridge: bass out",
    peak: "final chorus",
    surprise: asked.has("surprise") ? "drum dropout before the hook, filtered breakdown" : "",
    identity: palette.melody,
    remove: "the bass in the bridge, so the final chorus hits harder",
    references: [],
    missing: ["Written without an AI key: rule-based, and it cannot write lyrics."],
    assumptions: [],
    contradictions: [],
  };

  const draft: Draft = {
    title: input.title && input.title !== "Untitled" ? input.title : "Untitled",
    optimizedPrompt: `${style}. Arrangement: ${arrangement.map((a) => `${a.section} — ${a.what}`).join("; ")}.`,
    style,
    lyrics: input.lyricsMode === "keep" ? input.lyrics : lyrics,
    vocalDirection: `${vocal}. ${behind}. Verses conversational and close; chorus fuller with doubles; final chorus adds ad-libs and harmonies.`,
    productionDirection: arc,
    arrangement,
  };

  return {
    engine: "local",
    original: { style: input.style, lyrics: input.lyrics },
    plan,
    ...draft,
    checks: runQc(input, plan, draft),
    revisions: 0,
    warnings: ["No AI key is configured, so the rule-based producer built this. Lyrics are yours or a tagged scaffold."],
  };
}
