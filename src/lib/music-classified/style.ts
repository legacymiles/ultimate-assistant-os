// ---------------------------------------------------------------------------
// Style Prompt — the producer mode. A casual description of a song (plus any
// references, genres, eras, vibes) becomes a production/style prompt for an
// open-source music generator. No lyrics, ever.
//
// The one hard rule is the 1,000-character ceiling. The model is asked to
// WRITE to the limit (plan first, then compress), the quality gate below
// checks every draft, and a failing draft goes back for a rewrite with the
// exact failures named. Cutting text off is only the last-resort safety net,
// and the UI says so when it happened.
//
// Pure: prompts, checks and the offline builder. The route does the fetching.
// ---------------------------------------------------------------------------

import { levelInfo } from "./levels";
import type { Song } from "./types";

export const STYLE_LIMIT = 1000;
/** Below this the prompt is leaving useful space on the table. */
export const STYLE_FLOOR = 600;

export interface StyleBrief {
  /** The freeform description — the only field that is ever needed. */
  describe: string;
  idea?: string;
  genre?: string;
  era?: string;
  refSongs?: string;
  refArtists?: string;
  mood?: string;
  /** 1–10 on the app's energy ladder; null = let the producer decide. */
  energy?: number | null;
  vocal?: string;
  instruments?: string;
  production?: string;
  avoid?: string;
  /** Lean on the owner's taste profile (TASTE below). */
  useTaste?: boolean;
}

/** A reference the user typed that is already filed in their library — its profile goes along. */
export interface LibraryRef {
  title: string;
  artist: string;
  subgenre: string;
  level: number;
  bpm: number | null;
  key: string;
  production: string;
  vocals: string;
  instruments: string[];
  tags: string[];
}

/** The producer's decisions before compression — shown to the user as "Producer notes". */
export interface StylePlan {
  genre: string;
  era: string;
  emotion: string;
  groove: string;
  melody: string;
  hook: string;
  vocalist: string;
  behindVocal: string;
  stripDown: string;
  build: string;
  peak: string;
  verse2: string;
  chorusReturn: string;
  surprise: string;
  identity: string;
}

export const PLAN_FIELDS: {
  id: keyof StylePlan;
  label: string;
  ask: string;
}[] = [
  { id: "genre", label: "Genre", ask: "What is the genre / sub-genre?" },
  { id: "era", label: "Era", ask: "What era or sonic period?" },
  { id: "emotion", label: "Emotion", ask: "What is the emotional identity?" },
  {
    id: "groove",
    label: "Groove",
    ask: "What is the main groove (tempo, swing, drum pocket, bass rhythm)?",
  },
  {
    id: "melody",
    label: "Melody",
    ask: "What is the main melodic idea (motif, contour, intervals, what instrument)?",
  },
  { id: "hook", label: "Hook", ask: "What makes the hook memorable?" },
  {
    id: "vocalist",
    label: "Lead vocal",
    ask: "What should the vocalist sound like and how should they phrase?",
  },
  {
    id: "behindVocal",
    label: "Behind the vocal",
    ask: "What happens behind the lead vocal?",
  },
  {
    id: "stripDown",
    label: "Strip-down",
    ask: "Where does the production strip down, and what drops out?",
  },
  { id: "build", label: "Build", ask: "Where and how does it build?" },
  {
    id: "peak",
    label: "Biggest moment",
    ask: "Where is the biggest moment and what makes it bigger?",
  },
  {
    id: "verse2",
    label: "Verse 2 change",
    ask: "What changes between verse 1 and verse 2?",
  },
  {
    id: "chorusReturn",
    label: "Chorus return",
    ask: "What changes when the chorus returns?",
  },
  {
    id: "surprise",
    label: "Surprise",
    ask: "What production surprise makes it feel human-produced?",
  },
  {
    id: "identity",
    label: "Sonic identity",
    ask: "What single element (or combination) makes this record recognizable?",
  },
];

/** What the style route answers with. */
export interface StyleResponse {
  prompt: string;
  chars: number;
  plan: StylePlan;
  checks: StyleCheck[];
  source: "ai" | "offline";
  revisions: number;
  trimmed: boolean;
  warning?: string;
}

// ----- the owner's taste ------------------------------------------------------
// Not references to copy — the production ideas the owner responds to. Edit
// here to retune the producer.

export const TASTE = {
  references: [
    {
      artist: "T-Pain",
      song: "I'm in Luv (wit a Stripper)",
      likes:
        "timeless party R&B/hip-hop, one simple melodic idea repeated until it is addictive, nightlife atmosphere, commercial hook instinct",
    },
    {
      artist: "Regard",
      song: "Ride It",
      likes: "instant dance energy, hypnotic repeated melody, polished club groove that makes you move",
    },
    {
      artist: "Zeddy Will",
      song: "Back Back",
      likes:
        "modern party bounce, aggressive rhythm, infectious vocal chants and energetic delivery — physical and fun",
    },
    {
      artist: "EMBRZ",
      song: "Breathe",
      likes:
        "FAVOURITE production: emotional electronic atmosphere, beautiful melodies, spacious evolving textures, cinematic builds, strong sound design, a track that DEVELOPS instead of sitting on one loop",
    },
  ],
  concepts: [
    {
      name: "The barely-hear-it vocal hook",
      from: "the treatment in Kanye West's Through the Wire and G Herbo's Went Legit",
      how: "a sung hook that is partly buried — distant, filtered, band-passed, pitched or chopped, drenched in reverb or tape saturation, layered under the lead — hard to fully understand but melodically powerful, like a memory, a radio transmission or a ghost singer behind the song",
    },
    {
      name: "Rap over sung layer",
      from: "the approach in Trendy K's No Regrets",
      how: "the rapper keeps going in the foreground while a melodic singer sits underneath — holding a note, answering the rapper, repeating a phrase, harmonizing, or becoming texture — without the rap stopping for it",
    },
  ],
  hates: [
    "robotic, perfectly quantized vocals that sing every line the same way",
    "intro → one loop → verse → same loop → chorus → same loop arrangements",
    "songs that sound like a collection of genre presets",
  ],
};

// ----- quality gate ----------------------------------------------------------

/** Words that take space and say nothing about how a record is made. */
const FILLER: RegExp[] = [
  /\bprofessional(ly)?\b/i,
  /\bamazing\b/i,
  /\bcatchy\b/i,
  /\bhigh[\s-]quality\b/i,
  /\bmodern (sound|production|vibe|feel)\b/i,
  /\bincredible\b/i,
  /\bawesome\b/i,
  /\bepic\b/i,
  /\bstunning\b/i,
  /\bworld[\s-]class\b/i,
  /\btop[\s-]notch\b/i,
  /\bradio[\s-]ready\b/i,
  /\bhit (song|record)\b/i,
  /\bgreat (vocals?|production|song|sound)\b/i,
  /\bbeautiful vocals?\b/i,
  /\bamazing vocals?\b/i,
  /\bwell[\s-]produced\b/i,
  /\bstate[\s-]of[\s-]the[\s-]art\b/i,
];

/** Music-review voice instead of instructions. */
const REVIEW_VOICE =
  /\b(this (song|track|record)|the (song|track) (features|has|is|brings)|listeners?\b|you('ll| will) (feel|hear|love)|reminiscent of|evokes|takes you on)\b/i;

export interface StyleCheck {
  id: string;
  label: string;
  pass: boolean;
  /** What to tell the model when it fails. */
  fix: string;
}

export function charCount(s: string): number {
  return Array.from(s).length;
}

/** One paragraph, straight quotes, no markdown, no "Style prompt:" label. */
export function normalizePrompt(raw: string): string {
  return (
    raw
      .replace(/^\s*(style( prompt)?|prompt)\s*:\s*/i, "")
      // Markdown emphasis only — "#" and "_" stay, since F# minor is a key.
      .replace(/\*\*|`/g, "")
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'")
      .replace(/\s*\n+\s*/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim()
      .replace(/^"(.*)"$/, "$1")
  );
}

/** Artist and song names the prompt must not carry (generators reject them, and it's the idea we want, not the copy). */
export function forbiddenNames(brief: StyleBrief): string[] {
  const names = new Set<string>();
  const add = (s: string) => {
    const t = s.trim().replace(/^["']|["']$/g, "");
    if (t.length >= 3) names.add(t);
  };
  for (const a of splitList(brief.refArtists)) add(a);
  for (const line of splitList(brief.refSongs)) {
    // "Went Legit - G Herbo (the buried hook)" → title + artist, the note dropped.
    const bare = line.replace(/\s*[([].*?[)\]]\s*/g, " ").trim();
    const m = bare.match(/^(.+?)\s+(?:by|—|–|-)\s+(.+)$/i);
    const title = m ? m[1] : bare;
    if (m) add(m[2]);
    // One common word ("Breathe") is too likely to be an ordinary instruction.
    if (title.trim().split(/\s+/).length >= 2) add(title);
  }
  if (brief.useTaste !== false) {
    for (const r of TASTE.references) add(r.artist);
    for (const a of ["Kanye West", "Kanye", "G Herbo", "Trendy K"]) add(a);
    for (const t of ["Through the Wire", "Went Legit", "No Regrets", "Back Back", "Ride It"]) add(t);
  }
  return [...names];
}

function splitList(s: string | undefined): string[] {
  return (s ?? "")
    .split(/[\n,;]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function countHits(text: string, patterns: RegExp[]): number {
  return patterns.filter((p) => p.test(text)).length;
}

const HUMAN_VOCAL = [
  /breath/i,
  /ad[\s-]?libs?/i,
  /doubl/i,
  /harmon/i,
  /stack/i,
  /whisper/i,
  /call[\s-]and[\s-]response|answer/i,
  /off[\s-]grid|behind the beat|ahead of the beat|laid[\s-]back|loose|imperfect|unquantized|push(es|ing)? and pull/i,
  /phras/i,
  /(intensity|dynamics?) (rises?|builds?|shifts?|changes?)|from (a )?(whisper|murmur)|grit|strain|crack/i,
  /backing|background vocal|bgv|choir|gang vocal|chant/i,
  /throw/i,
];
const VOCAL_FX = [
  /reverb|verb\b/i,
  /delay|echo/i,
  /filter|band[\s-]?pass|low[\s-]?pass|telephone|radio/i,
  /distort|saturat|tape|crush|lo[\s-]?fi/i,
  /pitch|formant|chop|vocoder|auto[\s-]?tune|tuned/i,
];
const MOVEMENT = [
  /drop(s|ped)? out|strip(s|ped)?|mute|drums? (cut|vanish|fall away|disappear)|no drums|without drums|beat (cuts|stops)/i,
  /breakdown/i,
  /silence|dead air|stop(s)? dead|cut to nothing/i,
  /fake[\s-]drop/i,
  /build|riser|swell/i,
  /(returns?|comes? back|slams? back|back in) (harder|bigger|wider|fuller|with)/i,
  /(second|2nd|final|last) (chorus|hook|drop|verse)|verse 2|v2|chorus 2/i,
  /switch(es)?|flip(s)?|changes? to|half[\s-]time|double[\s-]time/i,
  /filter(ed)? (sweep|open|close)|filtered (intro|drop|beat|instrumental)|high[\s-]?pass(ed)? (beat|drums|mix)/i,
  /new (percussion|layer|synth|counter|drum|element)|introduce|enters|adds? a|joins/i,
];
const MELODY = [
  /melod/i,
  /motif/i,
  /hook/i,
  /topline/i,
  /counter[\s-]?melod/i,
  /riff|lead line|arp/i,
  /interval|minor|major|pentatonic|modal|chord|progression/i,
];
const DRUMS = /drum|kick|snare|hi[\s-]?hats?|hats\b|perc|808|clap|rim|shaker|toms?\b|breakbeat|four[\s-]on/i;
const BASS = /bass|808|sub\b|sub[\s-]bass|low[\s-]end/i;

const content = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter(
      (w) =>
        w.length >= 5 &&
        !["sound", "sounds", "which", "their", "about", "there", "every", "record", "track"].includes(w),
    );

export function checkStyle(prompt: string, brief: StyleBrief, identity = ""): StyleCheck[] {
  const n = charCount(prompt);
  const filler = FILLER.filter((re) => re.test(prompt)).map((re) => prompt.match(re)?.[0] ?? "");
  const names = forbiddenNames(brief).filter((name) => new RegExp(`\\b${escapeRe(name)}\\b`, "i").test(prompt));
  const idWords = content(identity);
  const idHits = idWords.filter((w) => prompt.toLowerCase().includes(w)).length;
  const quoted = prompt.match(/"([^"]+)"/g)?.filter((q) => q.split(/\s+/).length > 3) ?? [];

  return [
    {
      id: "length",
      label: `≤ ${STYLE_LIMIT.toLocaleString()} characters`,
      pass: n <= STYLE_LIMIT,
      fix: `It is ${n} characters — over the ${STYLE_LIMIT} hard limit. Rewrite it tighter (merge clauses, drop the least important decisions); do not just chop the end.`,
    },
    {
      id: "space",
      label: "Uses the space",
      pass: n >= STYLE_FLOOR,
      fix: `It is only ${n} characters. Spend the room up to ~950 on more concrete production decisions.`,
    },
    {
      id: "identity",
      label: "Clear sonic identity",
      pass: Boolean(identity.trim()) && (idWords.length < 2 || idHits >= Math.min(2, idWords.length)),
      fix: "The signature element that makes the record recognizable must be stated explicitly and early in the prompt.",
    },
    {
      id: "drums-bass",
      label: "Real production (drums + bass)",
      pass: DRUMS.test(prompt) && BASS.test(prompt),
      fix: "Name the actual drum sounds/pattern AND what the bass or 808 does rhythmically.",
    },
    {
      id: "melody",
      label: "Melodic information",
      pass: countHits(prompt, MELODY) >= 2,
      fix: "Say what the melody or motif is (instrument, contour, repetition, counter-melody, harmony colour).",
    },
    {
      id: "vocal",
      label: "Human vocal behaviour",
      pass: countHits(prompt, HUMAN_VOCAL) >= 2,
      fix: "Describe human vocal behaviour: loose phrasing off the grid, breaths, changing intensity, doubles/harmonies, ad-libs, backing vocals or call-and-response — never one flat quantized take.",
    },
    {
      id: "vocal-fx",
      label: "Vocal production",
      pass: countHits(prompt, VOCAL_FX) >= 1,
      fix: "Say how the vocals are treated (reverb/delay throws, filtering, saturation, pitch/chops) as part of the production.",
    },
    {
      id: "movement",
      label: "Arrangement movement",
      pass: countHits(prompt, MOVEMENT) >= 3,
      fix: "Add arrangement movement with WHERE it happens: e.g. drums strip before the hook, new percussion in verse 2, a fake drop, the final chorus returns harder or wider.",
    },
    {
      id: "filler",
      label: "No generic filler",
      pass: filler.length === 0,
      fix: `Remove filler that says nothing about how it's made: ${filler.map((f) => `"${f}"`).join(", ")}.`,
    },
    {
      id: "names",
      label: "No artist or song names",
      pass: names.length === 0,
      fix: `Remove the names ${names.map((f) => `"${f}"`).join(", ")} — translate what they contribute into production language instead.`,
    },
    {
      id: "voice",
      label: "Instructions, not a review",
      pass: !REVIEW_VOICE.test(prompt),
      fix: "Write it as direct instructions to a music generator, not a description or review of a song.",
    },
    {
      id: "no-lyrics",
      label: "No lyrics",
      pass: quoted.length === 0 && !/\blyrics?\s*:/i.test(prompt),
      fix: "Remove the lyric lines/quoted phrases — this mode is sound and production only.",
    },
  ];
}

export const failures = (checks: StyleCheck[]) => checks.filter((c) => !c.pass);

/**
 * The safety net, never the plan: if a draft is still over the limit after
 * the rewrites, end it at the last full clause that fits.
 */
export function fitToLimit(prompt: string, limit = STYLE_LIMIT): string {
  const chars = Array.from(prompt);
  if (chars.length <= limit) return prompt;
  const head = chars.slice(0, limit).join("");
  const cut = Math.max(head.lastIndexOf(". "), head.lastIndexOf("; "), head.lastIndexOf(", "));
  const out = (cut > limit * 0.6 ? head.slice(0, cut) : head.slice(0, head.lastIndexOf(" "))).replace(
    /[\s,;:—-]+$/,
    "",
  );
  return /[.!]$/.test(out) ? out : `${out}.`;
}

// ----- the prompts -------------------------------------------------------------

export const STYLE_SYSTEM = [
  "You are a record producer and arranger — the one in the room who knows WHY a record sounds good. " +
    "A client describes a song in casual words and references. You make every production decision, then write a STYLE PROMPT for an open-source AI music generator.",
  "",
  "The style prompt describes HOW THE SONG SHOULD SOUND AND BE PRODUCED. It never contains lyrics.",
  "",
  "Priorities, in order: 1 production, 2 vibe/energy, 3 melody, 4 vocals.",
  "",
  "How you think:",
  '- Translate feelings into mechanisms. "The intro is crazy" is not an instruction; "filtered, pitched vocal chop over a lone pad, two bars of silence, then the kick and sub land together" is.',
  "- Every record needs a SONIC IDENTITY — the one thing that makes it recognizable (a vocal texture, a bass groove, a motif, a drum bounce, a synth, a transition, an atmosphere). Decide it and state it early.",
  "- Real records MOVE. Never intro → loop → verse → same loop → chorus. Choose the movement that fits: drums drop out, bass cut, new percussion layer, counter-melody, drum pattern switch, filtered instrumental, a beat of silence, vocal throw, a new synth, bass rhythm change, breakdown, fake drop, the beat returning harder, an altered final chorus. Say WHERE each happens. Not every song needs all of them.",
  "- Vocals are an instrument and must sound human: loose phrasing behind/ahead of the beat, audible breaths, intensity that rises and falls, doubles on key words, stacked harmonies, ad-libs, backing vocals, call-and-response, whispers, reverb/delay throws, filtering, saturation, pitch effects where they fit. Never one clean quantized voice singing every line the same way.",
  '- Know the "barely-hear-it" hook: a sung hook that is buried — distant, band-passed, pitched, chopped, drenched in reverb or tape — under the lead, hard to make out yet melodically powerful, like a memory, a radio transmission or a ghost singer. Use it when it fits.',
  "- Know rap over a sung layer: the rapper keeps going while a melodic singer sits underneath — holding a note, answering, repeating a phrase, harmonizing, or becoming texture.",
  "- Name concrete things: tempo in BPM, key or tonal centre, drum sounds and pattern (e.g. four-on-the-floor kick, off-beat open hats, half-time snare on 3, bouncy syncopated 808), bass behaviour, chord colour, lead sounds, textures, stereo placement, mix target.",
  "",
  "How you write the style prompt:",
  `- HARD MAXIMUM ${STYLE_LIMIT} characters including spaces. Aim for 880–980. Write it to fit — plan the priorities first, then compress. Never write long and trim.`,
  '- One dense paragraph of comma/semicolon-separated clauses in imperative producer language. Short ALL-CAPS tags (e.g. "VOX:") only if they save words.',
  "- Every character must carry a musical decision. BANNED filler: professional, amazing, catchy, high quality, modern sound, incredible, epic, great vocals, radio-ready, polished production (unless you say what makes it polished).",
  "- NO artist names, NO song titles, NO lyrics, NO quoted lines. Extract the ideas behind any reference; never copy an identity, voice, melody or lyric.",
  '- Instructions for a generator, not a review: no "this song", "listeners", "evokes", "you will feel".',
  "- Skip categories that do not matter for this song; spend the space where it matters.",
  "",
  "Before answering, run this check on your own draft and rewrite until every answer is yes: ≤1000 characters? actual production? clear sonic identity? human vocal behaviour? arrangement movement with locations? melodic information? no filler? no copying of the reference? at least one intentional production/dynamic surprise? reads as instructions to a generator?",
  "",
  "Return only JSON.",
].join("\n");

export function tasteBlock(): string {
  return (
    "\nThe client's taste (use as a lens on what they respond to — extract the production ideas, never copy the songs or name them):\n" +
    TASTE.references.map((r) => `- ${r.artist} "${r.song}": ${r.likes}`).join("\n") +
    "\n" +
    TASTE.concepts.map((c) => `- ${c.name} (${c.from}): ${c.how}`).join("\n") +
    `\n- Hates: ${TASTE.hates.join("; ")}.\n`
  );
}

function refLine(r: LibraryRef): string {
  return (
    `- "${r.title}" — ${r.artist} (already in their library: level ${r.level}, ${r.subgenre}` +
    [
      r.bpm && `${r.bpm} BPM`,
      r.key,
      r.production,
      r.vocals && `vocals: ${r.vocals}`,
      r.instruments.slice(0, 5).join("/"),
      r.tags.slice(0, 6).join(", "),
    ]
      .filter(Boolean)
      .map((x) => `; ${x}`)
      .join("") +
    ")"
  );
}

export function stylePrompt(brief: StyleBrief, libraryRefs: LibraryRef[] = []): string {
  const e = brief.energy ? levelInfo(brief.energy) : null;
  const field = (label: string, v?: string) => (v?.trim() ? `${label}: ${v.trim()}\n` : "");
  return (
    `The client says:\n"""${brief.describe.trim() || "(nothing freeform — work from the fields)"}"""\n\n` +
    field("Song idea / concept", brief.idea) +
    field("Genre", brief.genre) +
    field("Era", brief.era) +
    field("Reference songs", brief.refSongs) +
    field("Reference artists", brief.refArtists) +
    field("Mood", brief.mood) +
    (e ? `Energy: ${e.n}/10 "${e.name}" — ${e.feel} (typically ${e.bpm} BPM)\n` : "") +
    field("Vocal type", brief.vocal) +
    field("Instruments", brief.instruments) +
    field("Production ideas", brief.production) +
    field("Avoid", brief.avoid) +
    (libraryRefs.length
      ? `\nWhat their music library already knows about those references:\n${libraryRefs.map(refLine).join("\n")}\n`
      : "") +
    (brief.useTaste !== false ? tasteBlock() : "") +
    "\nFor every reference, work out what the client actually likes about it and turn that into mechanisms. " +
    "Answer each producer question in the plan (short, concrete), then compress those decisions into the style prompt.\n\n" +
    "JSON shape:\n{\n" +
    '  "plan": {\n' +
    PLAN_FIELDS.map((f) => `    "${f.id}": "${f.ask}"`).join(",\n") +
    "\n  },\n" +
    `  "prompt": "the style prompt, ≤${STYLE_LIMIT} characters"\n}`
  );
}

export function revisePrompt(prompt: string, failed: StyleCheck[], plan: StylePlan): string {
  return (
    `Your style prompt (${charCount(prompt)} characters):\n"""${prompt}"""\n\n` +
    `Your producer plan:\n${PLAN_FIELDS.map((f) => `- ${f.label}: ${plan[f.id]}`).join("\n")}\n\n` +
    "It failed the quality check:\n" +
    failed.map((f) => `- ${f.label}: ${f.fix}`).join("\n") +
    `\n\nRewrite the whole style prompt so it passes every check and keeps the plan's strongest decisions. HARD MAXIMUM ${STYLE_LIMIT} characters — aim for 880–980. ` +
    'JSON: { "prompt": "…" }'
  );
}

export function coercePlan(v: unknown): StylePlan {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const out = {} as StylePlan;
  for (const f of PLAN_FIELDS) out[f.id] = typeof o[f.id] === "string" ? (o[f.id] as string).trim().slice(0, 400) : "";
  return out;
}

// ----- matching references to the library ------------------------------------

/** Reference songs the user typed that are already filed — their profile makes the brief sharper. */
export function libraryRefsFor(brief: StyleBrief, songs: Song[]): LibraryRef[] {
  const text = `${brief.refSongs ?? ""}\n${brief.describe}\n${brief.refArtists ?? ""}`.toLowerCase();
  return songs
    .filter((s) => s.kind !== "own" && s.title.length >= 3 && text.includes(s.title.toLowerCase()))
    .slice(0, 8)
    .map((s) => ({
      title: s.title,
      artist: s.artist,
      subgenre: `${s.genre} › ${s.subgenre}`,
      level: s.level,
      bpm: s.profile.bpm,
      key: s.profile.key,
      production: s.profile.production,
      vocals: s.profile.vocals,
      instruments: s.profile.instruments,
      tags: s.tags,
    }));
}

// ----- offline (no AI key) ------------------------------------------------------

const has = (s: string, re: RegExp) => re.test(s);

/**
 * A rule-built draft for when no model is reachable. It is a starting point,
 * not a producer — the UI labels it — but it still follows the same rules:
 * mechanisms over adjectives, human vocals, arrangement movement, ≤1000.
 */
export function offlineStyle(brief: StyleBrief): {
  prompt: string;
  plan: StylePlan;
} {
  const all = Object.values(brief)
    .filter((v) => typeof v === "string")
    .join(" ")
    .toLowerCase();
  const energy =
    brief.energy ??
    (has(all, /club|dance|party|hype|hard|bounce|turn up/) ? 7 : has(all, /sad|slow|chill|calm|soft/) ? 3 : 5);
  const lvl = levelInfo(energy);
  const bpm =
    {
      1: 68,
      2: 72,
      3: 86,
      4: 94,
      5: 104,
      6: 112,
      7: 124,
      8: 140,
      9: 150,
      10: 172,
    }[lvl.n] ?? 110;
  const dark = has(all, /dark|moody|night|sad|emotional|cinematic/);
  const genre =
    brief.genre?.trim() ||
    (has(all, /club|dance|house/)
      ? "club-driven electronic hip-hop"
      : has(all, /r&b|rnb/)
        ? "nocturnal R&B"
        : "melodic hip-hop");
  const era = brief.era?.trim() ? `, ${brief.era.trim()}` : "";
  const rap = has(all, /rap|rapper|bars/);
  const buried = has(all, /buried|distant|underneath|behind|ghost|barely|muffled/) || brief.useTaste !== false;
  const sung = has(all, /sing|sung|melodic|hook/);

  const parts = [
    `${genre}${era}, ${bpm} BPM, ${dark ? "minor key (F# minor)" : "bright minor-major blend"}`,
    buried
      ? "identity: a distant, band-passed, reverb-soaked sung hook buried under the lead like a half-remembered radio signal"
      : "identity: a 4-note pitched synth motif that repeats until it sticks",
    energy >= 7
      ? "bouncy syncopated 808 locked to a punchy kick, off-beat open hats, crisp clap on 2 and 4"
      : "half-time drums, dusty snare on 3, sparse ghost hats, round sub following the root",
    "wide detuned pad under plucked arp; minor chords with a borrowed major lift in the hook",
    rap && sung
      ? "VOX: rapper up front with loose off-grid phrasing and breaths, while a melodic singer holds and answers underneath without the rap stopping"
      : "VOX: lead with loose phrasing, audible breaths, rising intensity, doubled key words, stacked harmonies and ad-libs",
    "vocal delay throws at line ends, tape-saturated backing chant",
    "intro filtered to a pad and the buried hook; drums and bass drop out for a bar of silence before the first hook, then land together",
    "verse 2 adds a shaker layer and switches the 808 rhythm",
    "fake drop before the last chorus",
    "final chorus returns harder with wider harmonies and a new counter-melody",
    "mix: heavy low end, dry upfront lead, wide reverbs",
  ];
  if (brief.avoid?.trim()) parts.push(`avoid ${brief.avoid.trim()}`);

  const plan = coercePlan({
    genre,
    era: brief.era ?? "",
    emotion: brief.mood ?? (dark ? "dark but moving" : "bright and physical"),
    groove: parts[2],
    melody: "4-note motif / plucked arp",
    hook: parts[1],
    vocalist: parts[4],
    behindVocal: buried ? "buried distant sung hook" : "backing chant",
    stripDown: "bar of silence before first hook",
    build: "filtered intro → drums land",
    peak: "final chorus",
    verse2: "shaker + 808 rhythm switch",
    chorusReturn: "wider harmonies + counter-melody",
    surprise: "fake drop",
    identity: parts[1].replace(/^identity:\s*/, ""),
  });
  let prompt = "";
  for (const p of parts) {
    const next = prompt ? `${prompt}; ${p}` : p;
    if (charCount(next) + 1 > STYLE_LIMIT) break;
    prompt = next;
  }
  return { prompt: `${prompt}.`, plan };
}
