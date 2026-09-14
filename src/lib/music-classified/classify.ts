// ---------------------------------------------------------------------------
// Filing a song: the prompts, turning a model's JSON into a clean draft, and
// the no-key fallback. Pure — the routes do the fetching.
//
// Where the model's "hearing" comes from matters and the prompt says so: it
// knows most released music from training, the catalogue record pins down
// WHICH recording, and when the preview was measured, tempo and key are handed
// over as ground truth so the model interprets rather than guesses.
// ---------------------------------------------------------------------------

import { closestPlace } from "@/lib/dashboard/places";
import type { Identity } from "./identify";
import { clampLevel, isLens, LENSES, LEVELS } from "./levels";
import type {
  Confidence,
  LensId,
  Measured,
  Song,
  SongDraft,
  SoundProfile,
  Tree,
} from "./types";

// ----- tree helpers ---------------------------------------------------------

export function allGenres(tree: Tree): string[] {
  const out: string[] = [];
  for (const genres of Object.values(tree)) {
    for (const g of Object.keys(genres)) if (!out.includes(g)) out.push(g);
  }
  return out;
}

export function allSubgenres(tree: Tree, genre: string): string[] {
  const out: string[] = [];
  for (const genres of Object.values(tree)) {
    for (const s of genres[genre] ?? []) if (!out.includes(s)) out.push(s);
  }
  return out;
}

/** The library's existing names, so a new song lands in a playlist you already have. */
export function treeContext(tree: Tree): string {
  const lines: string[] = [];
  for (const lvl of LEVELS) {
    const genres = tree[lvl.n];
    if (!genres || !Object.keys(genres).length) continue;
    const parts = Object.entries(genres).map(([g, subs]) => (subs.length ? `${g} (${subs.join(", ")})` : g));
    lines.push(`  ${lvl.n}: ${parts.join("; ")}`);
  }
  return lines.length
    ? `The user's library already has these playlists (level: genre (sub-genres)):\n${lines.join("\n")}\n` +
        "Reuse an existing genre or sub-genre name EXACTLY when it fits; only invent a new one when none does.\n"
    : "The library is empty, so you are naming its first playlists — use short, common genre names.\n";
}

export function measuredBrief(m: Measured | undefined): string {
  if (!m) return "";
  return (
    "Measured from the song's 30-second preview (treat as ground truth, but tempo detectors can be off by exactly half or double — correct that if you know the song):\n" +
    `  tempo ${m.bpm} BPM (confidence ${Math.round(m.bpmConfidence * 100)}%), key ${m.key} (confidence ${Math.round(m.keyConfidence * 100)}%)\n` +
    `  brightness: ${m.brightness}; percussion: ${m.percussion}; dynamics: ${m.dynamics}; density: ${m.density}\n`
  );
}

const LADDER = LEVELS.map((l) => `  ${l.n} ${l.name} — ${l.feel} (typically ${l.bpm} BPM)`).join("\n");

// ----- classify -------------------------------------------------------------

export const CLASSIFY_SYSTEM =
  "You are a music analyst with encyclopedic knowledge of recorded music across every genre and era. " +
  "You file songs into a personal library and describe how they sound so the owner can learn to make music like them. " +
  "Be specific and concrete — name actual drum sounds, instruments, vocal techniques and production moves, not adjectives. " +
  "Be honest about what you know: if you don't recognise the exact recording, say so via the confidence field and reason from the artist and genre. " +
  "Never invent lyrics. Return only JSON.";

export function classifyPrompt(input: {
  identity: Identity;
  measured?: Measured;
  tree: Tree;
  lenses: LensId[];
}): string {
  const { identity: s, measured, tree, lenses } = input;
  const chosen = LENSES.filter((l) => lenses.includes(l.id));
  return (
    `Song: "${s.title}"${s.artist ? ` by ${s.artist}` : ""}\n` +
    (s.album ? `Album: ${s.album}\n` : "") +
    (s.year ? `Released: ${s.year}\n` : "") +
    (s.sourceGenre ? `Store genre label: ${s.sourceGenre}\n` : "") +
    (s.matched ? "" : "Note: this title was NOT confirmed in a music catalogue.\n") +
    measuredBrief(measured) +
    "\nEnergy ladder — pick ONE level. It is about energy and hype, not tempo alone (half-time trap with double-time hats can be an 8):\n" +
    LADDER +
    "\n\n" +
    treeContext(tree) +
    filingTail(chosen)
  );
}

/** Genre instructions, lens briefs and the JSON shape — shared by every filing prompt. */
function filingTail(chosen: typeof LENSES): string {
  return (
    "\nWithin the level, file it under a GENRE playlist (e.g. R&B, Hip-Hop, Pop, House, Afrobeats, Rock) and a more specific SUB-GENRE " +
    "that says what kind of that genre it is (e.g. \"90s slow jam\", \"alt-R&B\", \"Jersey club\", \"melodic trap\").\n\n" +
    (chosen.length
      ? "Write one description per lens, 70–140 words each (hard limit 150):\n" +
        chosen.map((l) => `  "${l.id}": ${l.brief}`).join("\n") +
        "\n\n"
      : "") +
    "JSON shape:\n{\n" +
    '  "level": 1-10,\n' +
    '  "levelReason": "one sentence: why this level",\n' +
    '  "genre": "…", "subgenre": "…",\n' +
    '  "confidence": "known" | "inferred" | "guess",\n' +
    '  "profile": { "bpm": number|null, "key": "e.g. F minor or empty", "energy": 0-100, "mood": ["…"], "instruments": ["…"], ' +
    '"vocals": "…", "production": "one sentence", "era": "e.g. late-2010s", "similarArtists": ["…"] },\n' +
    '  "tags": ["3-8 short searchable sound tags"],\n' +
    `  "descriptions": { ${chosen.map((l) => `"${l.id}": "…"`).join(", ")} }\n}`
  );
}

// ----- the user's own music -------------------------------------------------

export const LISTEN_SYSTEM =
  "You are a record producer and A&R with sharp ears. You are hearing an original, unreleased song made by the user or an artist they work with — " +
  "it exists nowhere else, so describe only what you actually hear, never what a famous song sounds like. " +
  "Be specific and concrete: name drum sounds, instruments, vocal techniques, arrangement and production moves. " +
  "For similarArtists, name established artists whose sound this is close to. Return only JSON.";

export interface ArtistSongSummary {
  title: string;
  level: number;
  genre: string;
  subgenre: string;
}

export function listenPrompt(ctx: {
  title: string;
  artist: string;
  measured?: Measured;
  tree: Tree;
  lenses: LensId[];
  artistSongs: ArtistSongSummary[];
  /** False when no audio could be attached — the model works from measurements only. */
  heard: boolean;
}): string {
  const chosen = LENSES.filter((l) => ctx.lenses.includes(l.id));
  const catalogue = ctx.artistSongs
    .slice(0, 40)
    .map((s) => `  - "${s.title}": level ${s.level} › ${s.genre} › ${s.subgenre}`)
    .join("\n");
  return (
    `Song: "${ctx.title}" by ${ctx.artist} — the user's own music.\n` +
    (ctx.heard
      ? "The attached audio is the loudest ~40 seconds of the song. Listen to it.\n"
      : 'No audio could be attached this time: work from the measurements only and set "confidence" to "guess".\n') +
    measuredBrief(ctx.measured) +
    (catalogue
      ? `\n${ctx.artist}'s other songs are already filed as:\n${catalogue}\n` +
        "An artist's songs usually share a sound, so reuse these genre and sub-genre names unless this song clearly differs.\n"
      : "") +
    "\nEnergy ladder — pick ONE level. It is about energy and hype, not tempo alone:\n" +
    LADDER +
    "\n\n" +
    treeContext(ctx.tree) +
    filingTail(chosen)
  );
}

const str = (v: unknown, max = 400) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const strList = (v: unknown, max = 8) =>
  Array.isArray(v)
    ? [...new Set(v.map((x) => str(x, 60)).filter(Boolean))].slice(0, max)
    : [];
const num = (v: unknown, lo: number, hi: number): number | null => {
  const n = Number(v);
  return v === null || v === "" || !Number.isFinite(n) ? null : Math.min(hi, Math.max(lo, Math.round(n)));
};

/** Snap a proposed name onto one the library already uses, else keep it tidy. */
export function snapGenre(tree: Tree, genre: string, subgenre: string) {
  const g = sameName(genre, allGenres(tree)) ?? titleCase(genre || "Unsorted");
  const s = sameName(subgenre, allSubgenres(tree, g)) ?? (subgenre ? subgenre.trim() : "General");
  return { genre: g, subgenre: s };
}

/**
 * Music spells one genre many ways — "R&B", "RnB", "R and B"; "Hip-Hop",
 * "hip hop". Folding those first catches what edit distance can't (RnB vs R&B
 * is too short a word for a typo allowance), then closestPlace handles typos.
 */
export function genreKey(s: string): string {
  return s
    .toLowerCase()
    .replace(/\br\s*(?:&|'?n'?|and)\s*b\b/g, "rnb")
    .replace(/\bhip[\s-]*hop\b/g, "hiphop")
    .replace(/\s*&\s*|\s+and\s+/g, "and")
    .replace(/[^a-z0-9]/g, "");
}

function sameName(wanted: string, known: string[]): string | null {
  if (!wanted.trim()) return null;
  const k = genreKey(wanted);
  return known.find((n) => genreKey(n) === k) ?? closestPlace(wanted, known);
}

function titleCase(s: string): string {
  // Leave acronyms and stylised names ("R&B", "EDM", "K-Pop") alone.
  return s
    .trim()
    .split(/\s+/)
    .map((w) => (w === w.toLowerCase() ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

export function coerceDescriptions(v: unknown, lenses: LensId[]): Partial<Record<LensId, string>> {
  const out: Partial<Record<LensId, string>> = {};
  if (!v || typeof v !== "object") return out;
  for (const [k, text] of Object.entries(v as Record<string, unknown>)) {
    if (isLens(k) && lenses.includes(k) && str(text, 3000)) out[k] = str(text, 3000);
  }
  return out;
}

export function coerceDraft(
  raw: Record<string, unknown>,
  ctx: { identity: Identity; measured?: Measured; tree: Tree; lenses: LensId[] },
): SongDraft {
  const { identity: s, measured, tree, lenses } = ctx;
  const p = (raw.profile && typeof raw.profile === "object" ? raw.profile : {}) as Record<string, unknown>;
  const { genre, subgenre } = snapGenre(tree, str(raw.genre, 40), str(raw.subgenre, 60));
  const confidence: Confidence = ["known", "inferred", "guess"].includes(raw.confidence as string)
    ? (raw.confidence as Confidence)
    : "inferred";

  const profile: SoundProfile = {
    // The model may fix a half/double-time detector error, so its BPM wins when
    // it is exactly that; otherwise the measurement stands.
    bpm: reconcileBpm(measured?.bpm, num(p.bpm, 30, 300)),
    key: str(p.key, 30) || (measured && measured.keyConfidence >= 0.5 ? measured.key : ""),
    energy: num(p.energy, 0, 100),
    mood: strList(p.mood),
    instruments: strList(p.instruments, 12),
    vocals: str(p.vocals, 200),
    production: str(p.production, 300),
    era: str(p.era, 40),
    similarArtists: strList(p.similarArtists, 6),
  };

  return {
    ...identityFields(s),
    level: clampLevel(raw.level),
    genre,
    subgenre,
    levelReason: str(raw.levelReason, 300),
    profile,
    measured,
    confidence,
    tags: strList(raw.tags, 10).map((t) => t.toLowerCase()),
    descriptions: coerceDescriptions(raw.descriptions, lenses),
    filedBy: "ai",
  };
}

export function reconcileBpm(measured: number | undefined, model: number | null): number | null {
  if (!measured) return model;
  if (!model) return Math.round(measured);
  const ratio = model / measured;
  if (Math.abs(ratio - 2) < 0.08 || Math.abs(ratio - 0.5) < 0.04) return model;
  return Math.round(measured);
}

function identityFields(s: Identity): Pick<Song, "title" | "artist" | "album" | "year" | "sourceGenre" | "artwork" | "links"> {
  return {
    title: s.title || "Untitled",
    artist: s.artist,
    album: s.album,
    year: s.year,
    sourceGenre: s.sourceGenre,
    artwork: s.artwork,
    links: s.link ? [s.link] : [],
  };
}

// ----- the no-key fallback --------------------------------------------------

/** iTunes genre label → a starting genre name and a typical level. */
const STORE_GENRES: [RegExp, string, number][] = [
  [/ambient|new age|meditat/i, "Ambient", 1],
  [/classical|piano|soundtrack|score/i, "Instrumental", 2],
  [/r&b|soul/i, "R&B", 3],
  [/jazz|blues/i, "Jazz & Blues", 3],
  [/singer|folk|acoustic/i, "Singer-Songwriter", 3],
  [/country/i, "Country", 4],
  [/reggae(?!ton)|dancehall/i, "Reggae", 4],
  [/gospel|christian/i, "Gospel", 4],
  [/k-?pop|j-?pop|pop/i, "Pop", 5],
  [/afro/i, "Afrobeats", 6],
  [/hip.?hop|rap/i, "Hip-Hop", 6],
  [/alternative|indie/i, "Alternative", 5],
  [/latin|reggaeton/i, "Latin", 7],
  [/house|dance|disco/i, "Dance", 7],
  [/electronic|edm|techno|trance/i, "Electronic", 7],
  [/punk/i, "Punk", 8],
  [/rock/i, "Rock", 6],
  [/metal|hardcore/i, "Metal", 9],
  [/drum|bass|dubstep|hardstyle/i, "Bass Music", 9],
];

export function bpmLevel(bpm: number): number {
  // Lower edge of levels 2–10, following the ladder's typical ranges.
  const edges = [70, 85, 95, 105, 112, 120, 130, 150, 170];
  const i = edges.findIndex((e) => bpm < e);
  return i === -1 ? 10 : i + 1;
}

export function heuristicDraft(ctx: {
  identity: Identity;
  measured?: Measured;
  tree: Tree;
  lenses: LensId[];
}): SongDraft {
  const { identity: s, measured, tree } = ctx;
  const hit = STORE_GENRES.find(([re]) => re.test(s.sourceGenre ?? ""));
  let level = hit?.[2] ?? 5;
  if (measured && measured.bpmConfidence >= 0.3) {
    let fromTempo = bpmLevel(measured.bpm);
    if (/none|no |sparse|little|minimal/i.test(measured.percussion)) fromTempo -= 2;
    level = clampLevel((level + fromTempo) / 2);
  }
  const { genre, subgenre } = snapGenre(tree, hit?.[1] ?? s.sourceGenre ?? "Unsorted", "General");
  const facts = [
    measured ? `${measured.bpm} BPM, ${measured.key}` : null,
    measured?.percussion,
    measured?.brightness,
  ].filter(Boolean);

  return {
    ...identityFields(s),
    level,
    genre,
    subgenre,
    levelReason: measured
      ? `Estimated offline from the store genre and the measured tempo (${measured.bpm} BPM).`
      : "Estimated offline from the store genre only — no AI key and no preview to measure.",
    profile: {
      bpm: measured ? Math.round(measured.bpm) : null,
      key: measured && measured.keyConfidence >= 0.5 ? measured.key : "",
      energy: null,
      mood: [],
      instruments: [],
      vocals: "",
      production: "",
      era: s.year ? `${s.year.slice(0, 3)}0s` : "",
      similarArtists: [],
    },
    measured,
    confidence: "guess",
    tags: facts.length ? [String(facts[1] ?? "")].filter(Boolean) : [],
    descriptions: facts.length
      ? { listener: `Measured from the preview: ${facts.join("; ")}. Add an AI key for a full description.` }
      : {},
    filedBy: "offline",
  };
}

// ----- more lenses for a song already filed ---------------------------------

export function describePrompt(song: Song, lenses: LensId[]): string {
  const chosen = LENSES.filter((l) => lenses.includes(l.id));
  const p = song.profile;
  return (
    `Song: "${song.title}"${song.artist ? ` by ${song.artist}` : ""}${song.year ? ` (${song.year})` : ""}\n` +
    `Filed as: level ${song.level} (${song.levelReason}) › ${song.genre} › ${song.subgenre}\n` +
    `Known profile: ${[p.bpm && `${p.bpm} BPM`, p.key, p.mood.join(", "), p.instruments.join(", "), p.vocals, p.production]
      .filter(Boolean)
      .join("; ")}\n` +
    measuredBrief(song.measured) +
    "\nWrite one description per lens, 70–140 words each (hard limit 150):\n" +
    chosen.map((l) => `  "${l.id}": ${l.brief}`).join("\n") +
    `\n\nJSON: { "descriptions": { ${chosen.map((l) => `"${l.id}": "…"`).join(", ")} } }`
  );
}

// ----- a playlist's blueprint -----------------------------------------------

export function blueprintPrompt(scopeLabel: string, songs: Song[]): string {
  const lines = songs.slice(0, 60).map((s) => {
    const p = s.profile;
    return `- "${s.title}" — ${s.artist} [${s.subgenre}] ${[p.bpm && `${p.bpm}bpm`, p.key, p.mood.slice(0, 3).join("/"), p.instruments.slice(0, 4).join("/")]
      .filter(Boolean)
      .join(" · ")}`;
  });
  return (
    `Playlist: ${scopeLabel} (${songs.length} songs the user loves)\n${lines.join("\n")}\n\n` +
    "Find what these songs have in COMMON — the shared DNA that explains why this person likes them — and turn it into a guide for writing and producing an original song that belongs in this playlist. " +
    "Cover: tempo & groove range, harmony/key tendencies, drums, bass, signature sounds, vocal approach, song structure, mood, and the 3 moves that matter most. " +
    "Call out any outlier song that doesn't fit. Keep the whole guide under 450 words — dense and specific, no filler. " +
    "Finish with a 'Style prompt:' line (comma-separated, no artist names).\n\n" +
    'JSON: { "text": "the guide, using short headed sections separated by blank lines" }'
  );
}
