import type { Song } from "./types";

export type SortBy = "added" | "title" | "artist" | "level" | "genre" | "bpm";
export type SortDir = "asc" | "desc";

/** What narrows the view. Empty fields mean "all". `artist` is used on the My Music tab. */
export interface Scope {
  level?: number;
  genre?: string;
  subgenre?: string;
  artist?: string;
}

const norm = (s: string) => s.trim().toLowerCase();

export function inScope(songs: Song[], scope: Scope): Song[] {
  return songs.filter(
    (s) =>
      (!scope.artist || norm(s.artist) === norm(scope.artist)) &&
      (scope.level === undefined || s.level === scope.level) &&
      (!scope.genre || s.genre === scope.genre) &&
      (!scope.subgenre || s.subgenre === scope.subgenre),
  );
}

/** "all", "3", "3/R&B/Slow jam", "artist:Nova", "artist:Nova/7". */
export function scopeKey(scope: Scope): string {
  return [
    scope.artist && `artist:${scope.artist}`,
    scope.level ?? (scope.artist ? undefined : "all"),
    scope.genre,
    scope.subgenre,
  ]
    .filter((p) => p !== undefined && p !== "")
    .join("/");
}

/** Artists by song count, grouping spellings that differ only in case. */
export function artistsOf(songs: Song[]): { name: string; count: number }[] {
  const map = new Map<string, { name: string; count: number }>();
  for (const s of songs) {
    const name = s.artist.trim() || "Unknown artist";
    const entry = map.get(norm(name)) ?? { name, count: 0 };
    entry.count++;
    map.set(norm(name), entry);
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/** Every word must appear somewhere in the song — title, sound, notes or any description. */
export function searchSongs(songs: Song[], query: string): Song[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return songs;
  return songs.filter((s) => {
    const hay = [
      s.title,
      s.artist,
      s.album,
      s.fileName,
      s.genre,
      s.subgenre,
      s.notes,
      s.profile.key,
      s.profile.vocals,
      s.profile.production,
      s.profile.era,
      ...s.tags,
      ...s.profile.mood,
      ...s.profile.instruments,
      ...s.profile.similarArtists,
      ...Object.values(s.descriptions),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

export function sortSongs(songs: Song[], by: SortBy, dir: SortDir): Song[] {
  const sign = dir === "asc" ? 1 : -1;
  const text = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "base" });
  return songs.slice().sort((a, b) => {
    let c = 0;
    if (by === "added") c = a.addedAt.localeCompare(b.addedAt);
    else if (by === "title") c = text(a.title, b.title);
    else if (by === "artist") c = text(a.artist, b.artist);
    else if (by === "level") c = a.level - b.level || text(a.genre, b.genre);
    else if (by === "genre") c = text(a.genre, b.genre) || text(a.subgenre, b.subgenre);
    else if (by === "bpm") {
      // Unknown tempo sorts last in both directions.
      if (a.profile.bpm === null) return 1;
      if (b.profile.bpm === null) return -1;
      c = a.profile.bpm - b.profile.bpm;
    }
    return c * sign || text(a.title, b.title);
  });
}
