// ---------------------------------------------------------------------------
// Soundprint — the descriptive vocabulary the whole app runs on.
//
// Three jobs:
//   1. Chips in the UI so you can build a prompt by hand.
//   2. The offline (no API key) prompt builder's raw material.
//   3. Grounding for the model — we hand it these families so it names real
//      subgenres instead of inventing mush like "emotional guitar music".
//
// Everything here is *descriptive*. No artist names: AI music platforms filter
// them, and a good texture description beats a name every time.
// ---------------------------------------------------------------------------

export interface GenreFamily {
  family: string;
  /** Subgenres, specific enough to actually steer a generation. */
  genres: string[];
}

export const GENRE_FAMILIES: GenreFamily[] = [
  {
    family: "Rock",
    genres: [
      "alternative rock",
      "post-grunge",
      "grunge",
      "hard rock",
      "classic rock",
      "arena rock",
      "garage rock",
      "psychedelic rock",
      "prog rock",
      "art rock",
      "southern rock",
      "blues rock",
      "stoner rock",
      "desert rock",
      "surf rock",
      "glam rock",
      "punk rock",
      "pop punk",
      "post-punk",
      "post-hardcore",
      "emo",
      "midwest emo",
      "screamo",
      "math rock",
      "noise rock",
      "shoegaze",
      "dream pop",
      "slowcore",
      "post-rock",
      "indie rock",
      "jangle pop",
      "britpop",
      "new wave",
    ],
  },
  {
    family: "Metal",
    genres: [
      "heavy metal",
      "thrash metal",
      "death metal",
      "melodic death metal",
      "black metal",
      "atmospheric black metal",
      "doom metal",
      "sludge metal",
      "groove metal",
      "nu metal",
      "alternative metal",
      "metalcore",
      "deathcore",
      "djent",
      "progressive metal",
      "power metal",
      "symphonic metal",
      "folk metal",
      "industrial metal",
      "blackgaze",
    ],
  },
  {
    family: "Pop",
    genres: [
      "synth-pop",
      "electropop",
      "dance-pop",
      "indie pop",
      "bedroom pop",
      "dream pop",
      "hyperpop",
      "art pop",
      "chamber pop",
      "baroque pop",
      "power pop",
      "teen pop",
      "adult contemporary",
      "city pop",
      "j-pop",
      "k-pop",
      "afropop",
      "latin pop",
      "sophisti-pop",
      "new romantic",
    ],
  },
  {
    family: "Hip-hop",
    genres: [
      "boom bap",
      "trap",
      "drill",
      "UK drill",
      "conscious hip-hop",
      "jazz rap",
      "lo-fi hip-hop",
      "cloud rap",
      "phonk",
      "memphis rap",
      "g-funk",
      "west coast hip-hop",
      "east coast hip-hop",
      "southern hip-hop",
      "crunk",
      "grime",
      "afroswing",
      "emo rap",
      "horrorcore",
      "abstract hip-hop",
      "boom bap revival",
    ],
  },
  {
    family: "R&B / Soul",
    genres: [
      "neo-soul",
      "contemporary R&B",
      "90s R&B",
      "quiet storm",
      "alternative R&B",
      "PBR&B",
      "northern soul",
      "southern soul",
      "motown",
      "funk",
      "p-funk",
      "disco",
      "nu-disco",
      "boogie",
      "gospel",
      "doo-wop",
    ],
  },
  {
    family: "Electronic",
    genres: [
      "house",
      "deep house",
      "tech house",
      "progressive house",
      "melodic house",
      "acid house",
      "techno",
      "minimal techno",
      "detroit techno",
      "trance",
      "psytrance",
      "drum and bass",
      "liquid dnb",
      "jungle",
      "breakbeat",
      "UK garage",
      "2-step",
      "future garage",
      "dubstep",
      "riddim",
      "ambient",
      "dark ambient",
      "downtempo",
      "trip-hop",
      "IDM",
      "glitch",
      "synthwave",
      "darksynth",
      "vaporwave",
      "chillwave",
      "electro",
      "EBM",
      "industrial",
      "hardstyle",
      "gabber",
      "footwork",
      "lo-fi house",
    ],
  },
  {
    family: "Folk / Country",
    genres: [
      "folk",
      "indie folk",
      "freak folk",
      "americana",
      "alt-country",
      "country rock",
      "outlaw country",
      "bluegrass",
      "old-time",
      "country pop",
      "bro-country",
      "singer-songwriter",
      "acoustic ballad",
      "celtic folk",
      "sea shanty",
      "appalachian",
    ],
  },
  {
    family: "Jazz / Blues",
    genres: [
      "bebop",
      "hard bop",
      "cool jazz",
      "modal jazz",
      "free jazz",
      "jazz fusion",
      "smooth jazz",
      "big band",
      "swing",
      "bossa nova",
      "samba jazz",
      "delta blues",
      "chicago blues",
      "electric blues",
      "jazz noir",
      "spiritual jazz",
    ],
  },
  {
    family: "Latin / Caribbean",
    genres: [
      "reggaeton",
      "latin trap",
      "salsa",
      "bachata",
      "merengue",
      "cumbia",
      "bossa nova",
      "samba",
      "MPB",
      "tango",
      "flamenco",
      "reggae",
      "roots reggae",
      "dub",
      "dancehall",
      "soca",
      "afrobeats",
      "amapiano",
      "highlife",
    ],
  },
  {
    family: "Cinematic / Score",
    genres: [
      "orchestral score",
      "epic trailer",
      "minimal piano",
      "neoclassical",
      "chamber strings",
      "dark orchestral",
      "hybrid orchestral",
      "western score",
      "noir score",
      "horror score",
      "ambient score",
      "choral",
      "requiem",
      "sacred minimalism",
    ],
  },
  {
    family: "World / Traditional",
    genres: [
      "qawwali",
      "hindustani classical",
      "carnatic",
      "gamelan",
      "taiko",
      "throat singing",
      "andean folk",
      "klezmer",
      "balkan brass",
      "fado",
      "rai",
      "desert blues",
      "gnawa",
      "ethio-jazz",
    ],
  },
  {
    family: "Experimental",
    genres: [
      "drone",
      "noise",
      "musique concrète",
      "field recording collage",
      "modular synthesis",
      "generative ambient",
      "sound art",
      "plunderphonics",
      "breakcore",
      "digital hardcore",
      "witch house",
      "deconstructed club",
    ],
  },
];

/** Flat list of every subgenre — used for matching text against the library. */
export const ALL_GENRES: string[] = GENRE_FAMILIES.flatMap((f) => f.genres);

export const MOODS: string[] = [
  "melancholic",
  "wistful",
  "hopeful",
  "yearning",
  "bittersweet",
  "triumphant",
  "anthemic",
  "tender",
  "intimate",
  "reflective",
  "nostalgic",
  "brooding",
  "ominous",
  "menacing",
  "tense",
  "cathartic",
  "euphoric",
  "hypnotic",
  "dreamy",
  "hazy",
  "serene",
  "spacious",
  "restless",
  "urgent",
  "defiant",
  "swaggering",
  "playful",
  "sensual",
  "desolate",
  "reverent",
  "warm",
  "cold",
  "raw",
  "polished",
];

export const INSTRUMENTS: string[] = [
  "clean electric guitar",
  "arpeggiated electric guitar",
  "chorus-drenched guitar",
  "acoustic guitar",
  "fingerpicked acoustic",
  "12-string acoustic",
  "distorted rhythm guitar",
  "palm-muted guitar",
  "slide guitar",
  "lead guitar melody",
  "nylon-string guitar",
  "grand piano",
  "felt piano",
  "upright piano",
  "electric piano",
  "Rhodes",
  "Wurlitzer",
  "Hammond organ",
  "church organ",
  "analog synth pad",
  "warm synth bass",
  "arpeggiated synth",
  "modular bleeps",
  "mellotron",
  "string section",
  "solo cello",
  "solo violin",
  "viola",
  "double bass",
  "electric bass",
  "fretless bass",
  "808 bass",
  "sub bass",
  "acoustic drum kit",
  "brushed drums",
  "live breakbeat",
  "808 drum machine",
  "909 drum machine",
  "trap hi-hats",
  "handclaps",
  "tambourine",
  "shaker",
  "congas",
  "djembe",
  "timpani",
  "orchestral percussion",
  "brass section",
  "muted trumpet",
  "saxophone",
  "flute",
  "clarinet",
  "harmonica",
  "banjo",
  "mandolin",
  "fiddle",
  "pedal steel",
  "harp",
  "kalimba",
  "music box",
  "choir",
  "gospel choir",
  "vocal chops",
  "field recordings",
  "vinyl crackle",
  "tape hiss",
];

export const PRODUCTION: string[] = [
  "sparse arrangement",
  "wide stereo image",
  "close and dry",
  "cavernous reverb",
  "plate reverb",
  "spring reverb",
  "long tape delay",
  "slapback echo",
  "sidechain pumping",
  "heavy compression",
  "open dynamics",
  "lo-fi and saturated",
  "tape saturation",
  "analog warmth",
  "crisp digital clarity",
  "gritty and unpolished",
  "glossy radio mix",
  "vintage 70s production",
  "80s gated reverb",
  "90s alt-rock mix",
  "2000s loudness-war master",
  "modern streaming master",
  "bit-crushed textures",
  "low-pass filtered",
  "high-passed and thin",
  "bass-heavy low end",
  "scooped mids",
  "warm midrange focus",
  "room-mic ambience",
  "one-take live feel",
  "layered overdubs",
  "double-tracked guitars",
  "swelling dynamics",
  "sudden drop-outs",
  "builds to a full band",
  "never brings in drums",
];

export const VOCAL_TRAITS: string[] = [
  "male tenor",
  "male baritone",
  "male bass",
  "female alto",
  "female soprano",
  "female mezzo",
  "androgynous timbre",
  "child-like tone",
  "raspy",
  "gravelly",
  "smoky",
  "breathy",
  "airy",
  "nasal",
  "warm and rounded",
  "thin and reedy",
  "powerful chest voice",
  "falsetto",
  "head voice",
  "whispered",
  "spoken word",
  "half-sung half-spoken",
  "belted",
  "strained at the top",
  "cracked and emotional",
  "restrained and controlled",
  "conversational phrasing",
  "behind the beat",
  "ahead of the beat",
  "melismatic runs",
  "straight-toned",
  "heavy vibrato",
  "no vibrato",
  "doubled vocals",
  "stacked harmonies",
  "close harmony",
  "call and response",
  "gang vocals",
  "screamed",
  "growled",
  "auto-tuned",
  "vocoded",
  "drenched in reverb",
  "dry and upfront",
  "lo-fi telephone filter",
];

/** Structure meta-tags most AI music platforms understand in the lyrics field. */
export const STRUCTURE_TAGS: string[] = [
  "[Intro]",
  "[Verse]",
  "[Pre-Chorus]",
  "[Chorus]",
  "[Post-Chorus]",
  "[Bridge]",
  "[Breakdown]",
  "[Instrumental]",
  "[Guitar Solo]",
  "[Outro]",
];

// ---------------------------------------------------------------------------
// Matching free text against the library.
//
// Exact substring matching is useless here — people write "clean, arpeggiated
// guitar", not "clean electric guitar". So we score on token overlap and back
// it with a hint table that expands everyday words into real descriptors.
// ---------------------------------------------------------------------------

export interface VocabularyMatch {
  genres: string[];
  moods: string[];
  instruments: string[];
  production: string[];
  vocalTraits: string[];
}

const STOP = new Set(["and", "of", "the", "a", "an", "with", "in", "on", "to", "no"]);

function termTokens(term: string): string[] {
  return term
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t && !STOP.has(t));
}

function textTokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** Shared prefix used for stem comparison — never shorter than 4 characters. */
function stem(s: string): string {
  return s.slice(0, Math.max(4, s.length - 2));
}

/**
 * Loose stem match so "arpeggiated" finds "arpeggio" and plurals line up.
 *
 * Both sides must be at least 5 characters. Without that floor, a stray "a"
 * (from "make a song") or "t" (from "wasn't") becomes a one-letter prefix that
 * matches every term starting with that letter — which is exactly how an
 * arpeggiated-guitar request ended up tagged "throat singing" and "timpani".
 */
function fuzzyHas(tokens: string[], word: string): boolean {
  if (tokens.includes(word)) return true;
  if (word.length < 5) return false;
  return tokens.some(
    (t) => t.length >= 5 && (t.startsWith(stem(word)) || word.startsWith(stem(t))),
  );
}

/** Fraction of a term's words present in the text. */
function score(term: string, tokens: string[]): number {
  const tt = termTokens(term);
  if (!tt.length) return 0;
  let hit = 0;
  for (const t of tt) {
    if (tokens.includes(t)) hit += 1;
    else if (fuzzyHas(tokens, t)) hit += 0.7;
  }
  return hit / tt.length;
}

function rank(list: string[], tokens: string[], limit: number, min = 0.6): string[] {
  return list
    .map((term) => ({ term, s: score(term, tokens) }))
    .filter((x) => x.s >= min)
    // Best match first; on a tie prefer the more specific (longer) term.
    .sort((a, b) => b.s - a.s || b.term.length - a.term.length)
    .slice(0, limit)
    .map((x) => x.term);
}

interface Hint {
  genres?: string[];
  moods?: string[];
  instruments?: string[];
  production?: string[];
  vocalTraits?: string[];
}

/**
 * Everyday words → real descriptors. Ordered most-specific first; the first
 * hint to fire for a concept wins, so "acoustic guitar" beats the generic
 * guitar fallback.
 */
const KEYWORD_HINTS: [RegExp, Hint][] = [
  [/\barpegg/i, { instruments: ["arpeggiated electric guitar"], production: ["sparse arrangement"] }],
  [/\bfinger ?pick/i, { instruments: ["fingerpicked acoustic"] }],
  [/\bacoustic\b/i, { instruments: ["acoustic guitar"], genres: ["acoustic ballad", "singer-songwriter"] }],
  [/\bclean\b[\s\S]{0,20}\bguitar\b|\bguitar\b[\s\S]{0,20}\bclean\b/i, { instruments: ["clean electric guitar"] }],
  [/\bdistort|\bcrunch|\bheavy guitar\b/i, { instruments: ["distorted rhythm guitar"], genres: ["hard rock"] }],
  [/\bguitar\b/i, { instruments: ["clean electric guitar"] }],
  [/\bpiano\b/i, { instruments: ["grand piano"] }],
  [/\bkeys?\b|\brhodes\b/i, { instruments: ["Rhodes"] }],
  [/\borgan\b/i, { instruments: ["Hammond organ"] }],
  [/\bstrings?\b|\borchestr/i, { instruments: ["string section"], genres: ["orchestral score"] }],
  [/\bcello\b/i, { instruments: ["solo cello"] }],
  [/\bviolin\b|\bfiddle\b/i, { instruments: ["solo violin"] }],
  [/\bsynth/i, { instruments: ["analog synth pad"], genres: ["synth-pop"] }],
  [/\b808/i, { instruments: ["808 bass", "808 drum machine"], genres: ["trap"] }],
  [/\bbass\b/i, { instruments: ["electric bass"] }],
  [/\bsax/i, { instruments: ["saxophone"] }],
  [/\bbrass\b|\bhorns?\b|\btrumpet\b/i, { instruments: ["brass section"] }],
  [/\bchoir\b|\bchoral\b/i, { instruments: ["choir"] }],
  [/\bharmonica\b/i, { instruments: ["harmonica"] }],
  [/\bbanjo\b/i, { instruments: ["banjo"], genres: ["bluegrass"] }],

  [/\bsad\b|\bmelanchol|\bsorrow|\bheartbreak/i, { moods: ["melancholic", "bittersweet"] }],
  [/\bemotional\b|\blonging\b|\byearn/i, { moods: ["yearning", "tender"] }],
  [/\bnostalg/i, { moods: ["nostalgic", "wistful"] }],
  [/\bhappy\b|\bupbeat\b|\bjoyful\b/i, { moods: ["euphoric", "triumphant"] }],
  [/\bdark\b|\bmoody\b|\bsomber\b/i, { moods: ["brooding"] }],
  [/\bcreepy\b|\bsinister\b|\bscary\b/i, { moods: ["ominous", "menacing"] }],
  [/\bcalm\b|\bgentle\b|\bsoft\b|\bchill\b|\bmellow\b/i, { moods: ["serene", "tender"] }],
  [/\bepic\b|\bhuge\b|\bmassive\b|\banthem/i, { moods: ["anthemic", "triumphant"] }],
  [/\bangry\b|\baggressive\b|\bangst/i, { moods: ["defiant", "raw"] }],
  [/\bdreamy\b|\bethereal\b|\bfloaty\b/i, { moods: ["dreamy", "hazy"], genres: ["dream pop"] }],
  [/\bintimate\b|\bpersonal\b|\bclose\b/i, { moods: ["intimate"], production: ["close and dry"] }],
  [/\bhopeful\b|\buplifting\b/i, { moods: ["hopeful"] }],

  [/\batmospher|\bambient\b|\bspacey\b|\bspacious\b|\bspace\b|\bopen\b|\broom to breathe\b/i, { moods: ["spacious"], production: ["wide stereo image"] }],
  [/\breverb/i, { production: ["cavernous reverb"] }],
  [/\blo-?fi\b/i, { production: ["lo-fi and saturated"], genres: ["lo-fi hip-hop"] }],
  [/\bvintage\b|\bretro\b|\bold school\b/i, { production: ["analog warmth", "tape saturation"] }],
  [/\bpolished\b|\bradio\b|\bglossy\b/i, { production: ["glossy radio mix"] }],
  [/\braw\b|\bgritty\b|\bunpolished\b/i, { production: ["gritty and unpolished"] }],
  [/\bsparse\b|\bminimal\b|\bstripped\b|\bempty\b/i, { production: ["sparse arrangement"] }],
  [/\bbuild(s|ing)?\b|\bswell/i, { production: ["swelling dynamics"] }],

  [/\braspy\b|\brasp\b|\bgravel/i, { vocalTraits: ["raspy", "gravelly"] }],
  [/\bbreathy\b|\bwhisper/i, { vocalTraits: ["breathy", "whispered"] }],
  [/\bfalsetto\b/i, { vocalTraits: ["falsetto"] }],
  [/\bbelt(ed|ing)?\b|\bpowerful voice\b/i, { vocalTraits: ["belted", "powerful chest voice"] }],
  [/\bmale (singer|vocal|voice)\b/i, { vocalTraits: ["male tenor"] }],
  [/\bfemale (singer|vocal|voice)\b/i, { vocalTraits: ["female alto"] }],
  [/\bscream/i, { vocalTraits: ["screamed"] }],
  [/\brap(ping|per)?\b/i, { vocalTraits: ["conversational phrasing"], genres: ["boom bap"] }],
  [/\bharmon/i, { vocalTraits: ["stacked harmonies"] }],
];

function applyHints(text: string, into: VocabularyMatch): void {
  for (const [re, hint] of KEYWORD_HINTS) {
    if (!re.test(text)) continue;
    for (const key of Object.keys(hint) as (keyof Hint)[]) {
      for (const value of hint[key] ?? []) {
        if (!into[key].includes(value)) into[key].push(value);
      }
    }
  }
}

/**
 * Scan free text for anything in the library. Powers the offline analyser and
 * pre-seeds the chips from whatever you typed.
 */
export function matchVocabulary(text: string): VocabularyMatch {
  const tokens = textTokens(text);

  const out: VocabularyMatch = {
    // Genres need a higher bar — a stray "rock" shouldn't drag in ten subgenres.
    genres: rank(ALL_GENRES, tokens, 4, 0.75),
    moods: rank(MOODS, tokens, 5),
    instruments: rank(INSTRUMENTS, tokens, 6),
    production: rank(PRODUCTION, tokens, 5),
    vocalTraits: rank(VOCAL_TRAITS, tokens, 5),
  };

  applyHints(text, out);

  return {
    genres: out.genres.slice(0, 5),
    moods: out.moods.slice(0, 5),
    instruments: out.instruments.slice(0, 7),
    production: out.production.slice(0, 5),
    vocalTraits: out.vocalTraits.slice(0, 5),
  };
}
