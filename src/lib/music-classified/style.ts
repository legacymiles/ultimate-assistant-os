// ---------------------------------------------------------------------------
// Style prompt — every song gets one: a description of THAT recording, as
// accurate as possible, written so an AI song generator can reproduce its
// sound. Hard ceiling 1,000 characters. No lyrics, no names.
//
// The model is asked to WRITE to the limit, a quality gate checks every
// draft, and a failing draft goes back for a rewrite with the failures named.
// Cutting text off is only the last-resort safety net, and it is flagged.
//
// Pure: prompts, checks and the offline builder. The route does the fetching.
// ---------------------------------------------------------------------------

import { levelInfo } from "./levels";
import type { Song, SongStyle } from "./types";

export const STYLE_LIMIT = 1000;
/** Below this the prompt is leaving useful detail on the table. */
export const STYLE_FLOOR = 600;

/** What the style route answers with. */
export interface StyleResponse {
  style: SongStyle;
  warning?: string;
}

/** Facts about the recording that decide which checks apply. */
export interface StyleFacts {
  identity: string;
  /** False for instrumentals — the vocal checks are skipped. */
  vocals: boolean;
  /** False for beatless music — the drums check only asks for bass/low end. */
  drums: boolean;
}

// ----- quality gate ----------------------------------------------------------

/** Words that take space and say nothing about how a record sounds. */
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

/** Names the prompt must not carry: generators reject them, and the sound is what's wanted. */
export function forbiddenNames(song: Pick<Song, "title" | "artist" | "album" | "profile">): string[] {
  const names = new Set<string>();
  const add = (s: string | undefined) => {
    const t = (s ?? "").trim();
    if (t.length >= 3) names.add(t);
  };
  // "Drake & Future", "X feat. Y" → each artist.
  for (const a of (song.artist ?? "").split(/\s*(?:,|&|\bx\b|\bfeat\.?|\bft\.?|\bwith\b|\band\b)\s*/i)) add(a);
  // A one-word title ("Breathe") is too likely to be an ordinary instruction.
  const title = song.title.replace(/\s*[([].*?[)\]]\s*/g, " ").trim();
  if (title.split(/\s+/).length >= 2) add(title);
  if (song.album && song.album.split(/\s+/).length >= 2 && !/single|ep$/i.test(song.album))
    add(song.album.replace(/\s*-\s*(single|ep)$/i, ""));
  for (const a of song.profile?.similarArtists ?? []) add(a);
  return [...names];
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
  /off[\s-]grid|behind the beat|ahead of the beat|laid[\s-]back|loose|imperfect|unquantized|drawl|drag/i,
  /phras|cadence|flow/i,
  /grit|rasp|strain|crack|falsetto|belt|croon|murmur|chant/i,
  /backing|background vocal|bgv|choir|gang vocal/i,
  /throw/i,
];
const VOCAL_FX = [
  /reverb|verb\b|plate|hall|room/i,
  /delay|echo|slapback/i,
  /filter|band[\s-]?pass|low[\s-]?pass|telephone|radio/i,
  /distort|saturat|tape|crush|lo[\s-]?fi/i,
  /pitch|formant|chop|vocoder|auto[\s-]?tune|tuned|dry\b|close[\s-]mic/i,
];
const MOVEMENT = [
  /drop(s|ped)? out|strip(s|ped)?|mute|drums? (cut|vanish|fall away|disappear|out)|no drums|beat (cuts|stops)/i,
  /breakdown|bridge/i,
  /silence|stop(s)? dead|cut to nothing/i,
  /build|riser|swell|lift/i,
  /intro|outro/i,
  /(returns?|comes? back|slams? back|back in)/i,
  /(second|2nd|final|last) (chorus|hook|drop|verse)|verse 2|v2|chorus 2/i,
  /switch(es)?|flip(s)?|half[\s-]time|double[\s-]time/i,
  /filter(ed)? (sweep|open|close)|filtered/i,
  /(enters?|joins?|adds?|introduce)/i,
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
        !["sound", "sounds", "which", "their", "about", "there", "every", "record", "track", "under", "their"].includes(
          w,
        ),
    );

/** The key's tonic as it would appear in a prompt ("F# minor" → "F#"). */
function tonic(key: string): string | null {
  return key.match(/^\s*([A-G](?:#|b|♯|♭)?)/)?.[1] ?? null;
}

export function checkStyle(
  prompt: string,
  song: Pick<Song, "title" | "artist" | "album" | "profile">,
  facts: StyleFacts,
): StyleCheck[] {
  const n = charCount(prompt);
  const filler = FILLER.filter((re) => re.test(prompt)).map((re) => prompt.match(re)?.[0] ?? "");
  const names = forbiddenNames(song).filter((name) => new RegExp(`\\b${escapeRe(name)}\\b`, "i").test(prompt));
  const idWords = content(facts.identity);
  const idHits = idWords.filter((w) => prompt.toLowerCase().includes(w)).length;
  const quoted = prompt.match(/"([^"]+)"/g)?.filter((q) => q.split(/\s+/).length > 3) ?? [];
  const bpm = song.profile?.bpm;
  const key = tonic(song.profile?.key ?? "");

  const checks: StyleCheck[] = [
    {
      id: "length",
      label: `≤ ${STYLE_LIMIT.toLocaleString()} characters`,
      pass: n <= STYLE_LIMIT,
      fix: `It is ${n} characters — over the ${STYLE_LIMIT} hard limit. Rewrite it tighter (merge clauses, drop the least defining details); do not just chop the end.`,
    },
    {
      id: "space",
      label: "Uses the space",
      pass: n >= STYLE_FLOOR,
      fix: `It is only ${n} characters. Spend the room up to ~950 on more accurate detail about how this recording sounds.`,
    },
    {
      id: "tempo-key",
      label: "Tempo & key",
      pass: (!bpm || prompt.includes(String(bpm))) && (!key || new RegExp(`\\b${escapeRe(key)}(?![a-z])`).test(prompt)),
      fix: `State the tempo${bpm ? ` (${bpm} BPM)` : ""}${key ? ` and the key (${song.profile.key})` : ""} exactly.`,
    },
    {
      id: "identity",
      label: "Signature sound",
      pass: Boolean(facts.identity.trim()) && (idWords.length < 2 || idHits >= Math.min(2, idWords.length)),
      fix: "State the element that makes this recording recognizable, explicitly and early.",
    },
    {
      id: "drums-bass",
      label: facts.drums ? "Drums & bass" : "Low end",
      pass: (facts.drums ? DRUMS.test(prompt) : true) && BASS.test(prompt),
      fix: facts.drums
        ? "Name the actual drum sounds and pattern AND what the bass or 808 does rhythmically."
        : "Say what holds the low end (sub, bass line, drone) and how it moves.",
    },
    {
      id: "melody",
      label: "Melody & harmony",
      pass: countHits(prompt, MELODY) >= 2,
      fix: "Describe the melody or motif (instrument, contour, repetition) and the chord colour.",
    },
  ];
  if (facts.vocals) {
    checks.push(
      {
        id: "vocal",
        label: "Vocal delivery",
        pass: countHits(prompt, HUMAN_VOCAL) >= 2,
        fix: "Describe how the vocal is actually delivered: voice type, phrasing against the beat, breaths, intensity changes, doubles, harmonies, ad-libs, backing vocals.",
      },
      {
        id: "vocal-fx",
        label: "Vocal production",
        pass: countHits(prompt, VOCAL_FX) >= 1,
        fix: "Say how the vocals are treated in the mix (dry/close, reverb or delay, tuning, filtering, saturation).",
      },
    );
  }
  checks.push(
    {
      id: "movement",
      label: "Arrangement",
      pass: countHits(prompt, MOVEMENT) >= 2,
      fix: "Describe how this recording's arrangement moves: how it opens, what drops out or enters and where, how the hook or drop hits, how it ends.",
    },
    {
      id: "filler",
      label: "No generic filler",
      pass: filler.length === 0,
      fix: `Remove filler that says nothing about the sound: ${filler.map((f) => `"${f}"`).join(", ")}.`,
    },
    {
      id: "names",
      label: "No artist or song names",
      pass: names.length === 0,
      fix: `Remove the names ${names.map((f) => `"${f}"`).join(", ")} — describe the sound they stand for instead.`,
    },
    {
      id: "voice",
      label: "Generator instructions",
      pass: !REVIEW_VOICE.test(prompt),
      fix: "Write it as direct instructions to a music generator, not a review of a song.",
    },
    {
      id: "no-lyrics",
      label: "No lyrics",
      pass: quoted.length === 0 && !/\blyrics?\s*:/i.test(prompt),
      fix: "Remove lyric lines and quoted phrases — sound and production only.",
    },
  );
  return checks;
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
  "You are a record producer and engineer with encyclopedic knowledge of recorded music. " +
    "Given one specific recording, you write a STYLE PROMPT that makes an AI song generator produce something that sounds as close as possible to that exact recording.",
  "",
  "Accuracy first:",
  "- Describe THIS recording as it actually sounds — not the artist in general, not the genre in general, and never a 'better' version.",
  "- Measured tempo and key are ground truth. Use them exactly (a tempo detector may be off by exactly half or double; correct only that).",
  "- If you are unsure of a detail, leave it out rather than invent it; spend the space on what you are sure of.",
  "",
  "What to capture, most defining first: genre/sub-genre and era; tempo, key, time feel; the signature sound that makes the record recognizable; " +
    "drums (actual sounds and pattern) and bass/808 behaviour; chords and harmonic colour; main melodic motifs and lead sounds; textures and sound design; " +
    "the vocal — voice type, delivery, phrasing against the beat, breaths, intensity, doubles, harmonies, ad-libs, backing and buried vocals, and how the vocal is treated in the mix; " +
    "the arrangement — how it opens, what drops out or enters and where, how the hook or drop hits, what changes later, how it ends; mix character and stereo space. " +
    "Skip anything that does not define this record.",
  "",
  "How you write it:",
  `- HARD MAXIMUM ${STYLE_LIMIT} characters including spaces. Aim for 880–980. Write it to fit — prioritise, then compress. Never write long and trim.`,
  '- One dense paragraph of comma/semicolon-separated clauses a generator can act on. Short ALL-CAPS tags (e.g. "VOX:") only where they save words.',
  "- Every character must carry a musical fact. BANNED filler: professional, amazing, catchy, high quality, modern sound, incredible, epic, great vocals, radio-ready.",
  "- NO artist names, NO song or album titles, NO lyrics, NO quoted lines — generators reject names. Translate a named sound into its ingredients.",
  '- Instructions for a generator, not a review: no "this song", "listeners", "evokes", "you will feel".',
  "",
  "Check your draft before answering: ≤1000 characters? accurate to this recording? tempo and key stated? signature sound clear? drums/bass concrete? melody and harmony? vocal delivery and treatment (if it has vocals)? arrangement movement? no filler, names or lyrics? reads as instructions? Rewrite until every answer is yes.",
  "",
  "Return only JSON.",
].join("\n");

function list(label: string, items: string[]): string {
  return items.length ? `${label}: ${items.join(", ")}\n` : "";
}

export function songStylePrompt(song: Song): string {
  const p = song.profile;
  const m = song.measured;
  const own = song.kind === "own";
  const descriptions = Object.entries(song.descriptions)
    .filter(([, t]) => t)
    .map(([lens, t]) => `  [${lens}] ${String(t).slice(0, 900)}`)
    .join("\n");
  return (
    `Recording: "${song.title}"${song.artist ? ` by ${song.artist}` : ""}${song.year ? ` (${song.year})` : ""}\n` +
    (song.album ? `Album: ${song.album}\n` : "") +
    (own
      ? "This is the user's own unreleased song — it exists nowhere else. Describe ONLY what the notes below say about it; do not reach for any famous song.\n"
      : song.confidence === "guess"
        ? "The catalogue could not confirm this recording well — lean on the artist, era and filing below, and keep uncertain details out.\n"
        : "") +
    `Filed as: ${song.genre} › ${song.subgenre}; energy ${song.level}/10 (${levelInfo(song.level).name})${song.levelReason ? ` — ${song.levelReason}` : ""}\n` +
    (m
      ? `Measured from the audio (ground truth): ${m.bpm} BPM (confidence ${Math.round(m.bpmConfidence * 100)}%), key ${m.key} (confidence ${Math.round(m.keyConfidence * 100)}%); ` +
        `brightness ${m.brightness}; percussion ${m.percussion}; dynamics ${m.dynamics}; density ${m.density}\n`
      : "") +
    `Known profile: ${[p.bpm && `${p.bpm} BPM`, p.key, p.era, p.vocals && `vocals: ${p.vocals}`, p.production].filter(Boolean).join("; ")}\n` +
    list("Mood", p.mood) +
    list("Instruments", p.instruments) +
    list("Tags", song.tags) +
    (descriptions ? `Notes already written about it:\n${descriptions}\n` : "") +
    (p.bpm ? `\nUse ${p.bpm} BPM${p.key ? ` and ${p.key}` : ""} in the prompt.\n` : "") +
    "\nJSON shape:\n{\n" +
    '  "identity": "one line: the signature sound that makes this recording recognizable",\n' +
    '  "vocals": true | false,  // does the recording have vocals?\n' +
    '  "drums": true | false,   // does it have drums/percussion?\n' +
    `  "prompt": "the style prompt, ≤${STYLE_LIMIT} characters"\n}`
  );
}

export function revisePrompt(prompt: string, failed: StyleCheck[], facts: StyleFacts): string {
  return (
    `Your style prompt (${charCount(prompt)} characters):\n"""${prompt}"""\n\n` +
    `Signature sound you identified: ${facts.identity}\n\n` +
    "It failed the quality check:\n" +
    failed.map((f) => `- ${f.label}: ${f.fix}`).join("\n") +
    `\n\nRewrite the whole style prompt so it passes every check while staying accurate to the recording. HARD MAXIMUM ${STYLE_LIMIT} characters — aim for 880–980. ` +
    'JSON: { "prompt": "…" }'
  );
}

export function coerceFacts(raw: Record<string, unknown>): StyleFacts {
  return {
    identity: typeof raw.identity === "string" ? raw.identity.trim().slice(0, 300) : "",
    vocals: raw.vocals !== false,
    drums: raw.drums !== false,
  };
}

// ----- offline (no AI key) ------------------------------------------------------

/**
 * A draft built from the song's filed profile, for when no model is
 * reachable. Honest about what it knows, and still under the limit.
 */
export function offlineStyle(song: Song): { prompt: string; facts: StyleFacts } {
  const p = song.profile;
  const m = song.measured;
  const noDrums = /none|no |sparse|minimal/i.test(m?.percussion ?? "") || song.level <= 1;
  const instrumental = /instrumental|no vocal/i.test(p.vocals);
  const parts = [
    [song.subgenre !== "General" ? song.subgenre : "", song.genre, p.era].filter(Boolean).join(", "),
    [p.bpm && `${p.bpm} BPM`, p.key].filter(Boolean).join(", "),
    `energy ${song.level}/10 (${levelInfo(song.level).feel})`,
    p.mood.length ? `mood: ${p.mood.join(", ")}` : "",
    p.instruments.length ? `instruments: ${p.instruments.join(", ")}` : "",
    m ? `${m.percussion} percussion, ${m.brightness} tone, ${m.dynamics} dynamics, ${m.density} arrangement` : "",
    p.vocals ? `VOX: ${p.vocals}` : "",
    p.production,
    song.tags.length ? song.tags.join(", ") : "",
  ].filter(Boolean);
  let prompt = "";
  for (const part of parts) {
    const next = prompt ? `${prompt}; ${part}` : part;
    if (charCount(next) + 1 > STYLE_LIMIT) break;
    prompt = next;
  }
  const names = forbiddenNames(song);
  for (const n of names) prompt = prompt.replace(new RegExp(`\\b${escapeRe(n)}\\b`, "gi"), "").replace(/\s{2,}/g, " ");
  return {
    prompt: prompt ? `${prompt.trim()}.` : `${song.genre}.`,
    facts: {
      identity: p.production || p.instruments.slice(0, 2).join(" and "),
      vocals: !instrumental,
      drums: !noDrums,
    },
  };
}
