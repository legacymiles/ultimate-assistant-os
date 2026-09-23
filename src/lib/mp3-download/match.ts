// ---------------------------------------------------------------------------
// Does this file sound like it is the song you confirmed?
//
// Nobody's open-licence catalogue is indexed by Apple's track id, so the only
// join available is the text of the title, the name of whoever made it, and
// how long it runs. That is enough to be useful and never enough to be sure —
// so the score is shown, with its reasons, and the owner makes the call. The
// scorer is deliberately pessimistic: a cover, a live take and a remaster all
// share a title, and none of them is the record you asked for.
// ---------------------------------------------------------------------------

import type { Candidate, Track } from "./types";

/** Bracketed qualifiers that describe the *release*, not the song. */
const NOISE =
  /\b(remaster(ed)?|remastered\s*\d{4}|\d{4}\s*remaster|mono|stereo|deluxe|edition|bonus track|album version|single version|radio edit|explicit|clean|official (audio|video|music video)|lyrics?|hd|hq|full song|free download)\b/g;

/**
 * "feat. X" — an artist credit, not part of the title.
 *
 * Two patterns, because one greedy one is a trap. A single
 * `[([]?…(feat|ft)…[^)\]]*` runs straight past the credit and swallows the
 * song: "The Weeknd ft. ROSALÍA - Blinding Lights [Remix]" lost everything up
 * to the first bracket and normalised to "the weeknd", so the real track
 * scored zero against it and every YouTube hit for a collaboration was
 * silently thrown away. The credit is removed, and nothing after it is.
 */
/** A whole bracketed credit: "(feat. X)", "[ft. X & Y]". */
const FEATURE_BRACKETED = /[([{]\s*(?:feat\.?|ft\.?|featuring|with)\b[^)\]}]*[)\]}]?/gi;
/** A bare credit: "… ft. X", stopping at the next delimiter, not the end. */
const FEATURE_INLINE = /\s(?:feat\.?|ft\.?|featuring)\s+[^([{\-–—|,]*/gi;

/**
 * Fold a title or artist to comparable tokens.
 *
 * Diacritics go (ROSALÍA vs ROSALIA), punctuation goes, bracketed release
 * noise goes, and "&"/"and" are unified — those three account for nearly every
 * false miss between two catalogues describing the same recording.
 */
export function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(FEATURE_BRACKETED, " ")
    .replace(FEATURE_INLINE, " ")
    .replace(/&/g, " and ")
    .replace(/[_\-–—/\.,'’"!?:;()[\]{}]/g, " ")
    .replace(NOISE, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const STOP = new Set(["the", "a", "an", "of", "and", "in", "on", "to", "for", "my", "your", "it"]);

export function tokens(text: string): string[] {
  return normalize(text)
    .split(" ")
    .filter((t) => t.length > 0 && !STOP.has(t));
}

/**
 * Share of the *reference* tokens present in the candidate, 0–1.
 *
 * Asymmetric on purpose. "Moonlight Sonata" inside "Moonlight Sonata, 3rd
 * Movement, live at Wigmore Hall" should still score high — the song is in
 * there. The reverse ("Moonlight" matching the full title) should not.
 */
export function coverage(reference: string, candidate: string): number {
  const want = tokens(reference);
  if (want.length === 0) return 0;
  const have = new Set(tokens(candidate));
  const hit = want.filter((t) => have.has(t)).length;
  return hit / want.length;
}

/** 1 when the runtimes match, falling to 0 by 30 seconds apart. */
export function durationCloseness(aMs: number, bMs: number): number {
  if (!aMs || !bMs) return 0;
  const deltaS = Math.abs(aMs - bMs) / 1000;
  if (deltaS <= 2) return 1;
  if (deltaS >= 30) return 0;
  return 1 - (deltaS - 2) / 28;
}

/** Strip a file extension and any leading "03 - " track number. */
export function cleanFileTitle(name: string): string {
  return name
    .replace(/\.[a-z0-9]{2,4}$/i, "")
    .replace(/^\s*\d{1,3}\s*[-._)]\s*/, "")
    .trim();
}

/**
 * Titles that announce themselves as NOT the original recording.
 *
 * The artist check alone does not catch these: a cover called "The Weeknd -
 * Blinding Lights (IMY2 Cover)" names the real artist in its own title, so it
 * scored a perfect 100 on a live search and outranked the actual record. What
 * gives it away is the word "cover", not the channel.
 *
 * Deliberately not a filter. A karaoke track or an instrumental is exactly
 * what somebody sometimes wants; it just must never outrank the real thing.
 */
const VARIANT =
  /\b(cover(ed)?\s*(by|version)?|karaoke|tribute|instrumental|acapella|a cappella|8d\s*audio|slowed|sped\s*up|nightcore|reverb|remake|piano\s*version|guitar\s*version|backing\s*track|made\s*famous\s*by)\b/i;

export interface Scored {
  score: number;
  reasons: string[];
}

/**
 * How confident we are that `candidate` is a file of `track`.
 *
 * Title carries most of it, artist confirms it, duration is the tie-breaker
 * that separates the record from a cover of it. A candidate that matches the
 * title but names a different artist is capped: that is what a cover looks
 * like, and handing it over as "the song" would be a lie the score should not
 * tell.
 */
export function scoreCandidate(
  track: Track,
  candidate: { title: string; creator: string; durationMs: number | null },
): Scored {
  const reasons: string[] = [];

  const titleHit = coverage(track.title, candidate.title);
  const artistHit = Math.max(
    coverage(track.artist, candidate.creator),
    // Plenty of uploads put the artist in the title: "Beethoven - Moonlight".
    coverage(track.artist, candidate.title),
  );
  const durHit =
    candidate.durationMs == null ? 0 : durationCloseness(track.durationMs, candidate.durationMs);

  let score = titleHit * 58 + artistHit * 27 + durHit * 15;

  if (titleHit >= 0.99) reasons.push("Title matches exactly");
  else if (titleHit >= 0.6) reasons.push(`Title ${Math.round(titleHit * 100)}% matched`);
  else reasons.push("Title barely matches");

  if (artistHit >= 0.99) reasons.push("Same artist");
  else if (artistHit >= 0.5) reasons.push("Artist partly matches");
  else reasons.push("Different artist — likely a cover");

  if (candidate.durationMs == null) reasons.push("Length unknown");
  else if (durHit >= 0.9) reasons.push("Same length");
  else if (durHit > 0) {
    const d = Math.round(Math.abs(track.durationMs - candidate.durationMs) / 1000);
    reasons.push(`${d}s ${candidate.durationMs > track.durationMs ? "longer" : "shorter"}`);
  } else reasons.push("Length is well off");

  // A strong title over a wrong name is the signature of a cover version.
  if (artistHit < 0.34) score = Math.min(score, 62);

  // And a title that says "cover" or "karaoke" is one even when it credits the
  // original artist, which is how a cover reached 100 on a real search.
  const variant = candidate.title.match(VARIANT);
  if (variant) {
    score = Math.min(score, 58);
    reasons.push(`Says "${variant[0].trim().toLowerCase()}" — not the original recording`);
  }

  return { score: Math.round(Math.max(0, Math.min(100, score))), reasons };
}

/** Best first, then the shorter runtime delta, then a stable id order. */
export function rank(candidates: Candidate[]): Candidate[] {
  return [...candidates].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}

// --- formatting ------------------------------------------------------------

export function formatDuration(ms: number | null): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function formatBytes(bytes: number | null): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes <= 0) return "—";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

export function releaseYear(iso: string): string {
  const y = iso.slice(0, 4);
  return /^\d{4}$/.test(y) ? y : "—";
}

/**
 * `Artist - Title.mp3`, safe on Windows and every other filesystem here.
 *
 * Both halves are optional: a pasted link often has a creator and no artist,
 * or a title and nothing else, and neither should produce a file called
 * " - .mp3".
 */
export function fileNameFrom(artist: string, title: string, format: string): string {
  const ext = (format || "mp3").toLowerCase().replace(/[^a-z0-9]/g, "") || "mp3";
  const safe = (s: string) =>
    s
      .replace(/[\\/:*?"<>|]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  const stem = [safe(artist), safe(title)].filter(Boolean).join(" - ") || "download";
  return `${stem}.${ext}`.slice(0, 180);
}

export function downloadName(track: Track, format: string): string {
  return fileNameFrom(track.artist, track.title, format);
}
