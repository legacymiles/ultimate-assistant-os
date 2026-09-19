// ---------------------------------------------------------------------------
// The library — local-first, synced across devices through app_state.
// Every mutator returns the fresh library so components just setLib(result).
//
// Reference songs (the ones you love) and your own music share one `songs`
// array, told apart by `kind`. Only reference songs build the level › genre ›
// sub-genre tree the Library sidebar shows; your own music is browsed by artist.
// ---------------------------------------------------------------------------

import { saveSynced } from "@/lib/sync/appState";
import { scopedKey } from "@/lib/sync/identity";
import { nowIso, uid } from "../utils";
import { clampLevel, isLens, STARTER_LENSES } from "./levels";
import type { Blueprint, LensId, Library, Song, SongDraft, StyleRecord, Tree } from "./types";

/** Also the app_state sync key. */
export const KEY = "music-classified:v1";

const empty = (): Library => ({ songs: [], tree: {}, blueprints: [], styles: [], defaultLenses: [...STARTER_LENSES] });

/** Enough history to be useful, small enough to keep syncing cheap. */
const STYLE_HISTORY = 60;

const isOwn = (s: { kind?: string }) => s.kind === "own";

function withLeaf(tree: Tree, level: number, genre: string, subgenre?: string): Tree {
  const genres = { ...(tree[level] ?? {}) };
  const subs = [...(genres[genre] ?? [])];
  if (subgenre && !subs.includes(subgenre)) subs.push(subgenre);
  genres[genre] = subs;
  return { ...tree, [level]: genres };
}

function withSongLeaf(tree: Tree, s: Song): Tree {
  return isOwn(s) ? tree : withLeaf(tree, s.level, s.genre, s.subgenre);
}

/**
 * Every genre name in use, own music included — what a new filing should snap
 * onto, so "R&B" in your uploads and "R&B" in your favourites stay one name.
 */
export function fullTree(lib: Library): Tree {
  return lib.songs.reduce<Tree>((t, s) => withLeaf(t, s.level, s.genre, s.subgenre), lib.tree);
}

function clean(raw: Partial<Library> | null): Library {
  if (!raw || typeof raw !== "object") return empty();
  const songs = (Array.isArray(raw.songs) ? raw.songs : [])
    .filter((s): s is Song => Boolean(s && s.id && s.title))
    .map((s) => ({
      ...s,
      level: clampLevel(s.level),
      genre: s.genre || "Unsorted",
      subgenre: s.subgenre || "General",
      links: Array.isArray(s.links) ? s.links : [],
      tags: Array.isArray(s.tags) ? s.tags : [],
      descriptions: s.descriptions && typeof s.descriptions === "object" ? s.descriptions : {},
      notes: s.notes ?? "",
    }));
  // Every reference song's leaf is guaranteed to exist, on top of any empty playlists kept.
  let tree: Tree = raw.tree && typeof raw.tree === "object" ? raw.tree : {};
  for (const s of songs) tree = withSongLeaf(tree, s);
  const lenses = (Array.isArray(raw.defaultLenses) ? raw.defaultLenses : []).filter(isLens);
  return {
    songs,
    tree,
    blueprints: Array.isArray(raw.blueprints) ? raw.blueprints : [],
    styles: (Array.isArray(raw.styles) ? raw.styles : []).filter((s): s is StyleRecord => Boolean(s?.id && s.prompt)),
    defaultLenses: lenses.length ? lenses : [...STARTER_LENSES],
  };
}

function load(): Library {
  if (typeof window === "undefined") return empty();
  try {
    const raw = window.localStorage.getItem(scopedKey(KEY));
    return raw ? clean(JSON.parse(raw)) : empty();
  } catch {
    return empty();
  }
}

function save(lib: Library): Library {
  saveSynced(KEY, lib);
  return lib;
}

export function getLibrary(): Library {
  return load();
}

const sameSong = (a: { title: string; artist: string }, b: { title: string; artist: string }) =>
  a.title.trim().toLowerCase() === b.title.trim().toLowerCase() &&
  a.artist.trim().toLowerCase() === b.artist.trim().toLowerCase();

/** A reference song already in the library. Own uploads never count — two takes can share a title. */
export function findDuplicate(lib: Library, draft: { title: string; artist: string }): Song | undefined {
  return lib.songs.find((s) => !isOwn(s) && sameSong(s, draft));
}

export function addSong(draft: SongDraft): { lib: Library; id: string; duplicate: boolean } {
  const lib = load();
  const existing = isOwn(draft) ? undefined : findDuplicate(lib, draft);
  if (existing) {
    // Same song from a second link: keep the filing, remember the link.
    const links = [...new Set([...existing.links, ...draft.links])];
    return { lib: updateSong(existing.id, { links }), id: existing.id, duplicate: true };
  }
  const at = nowIso();
  const song: Song = { ...draft, id: uid("song"), notes: "", addedAt: at, updatedAt: at };
  return {
    lib: save({ ...lib, songs: [song, ...lib.songs], tree: withSongLeaf(lib.tree, song) }),
    id: song.id,
    duplicate: false,
  };
}

export function updateSong(id: string, patch: Partial<Omit<Song, "id" | "addedAt">>): Library {
  const lib = load();
  const songs = lib.songs.map((s) =>
    s.id === id
      ? { ...s, ...patch, level: clampLevel(patch.level ?? s.level), updatedAt: nowIso() }
      : s,
  );
  const moved = songs.find((s) => s.id === id);
  return save({ ...lib, songs, tree: moved ? withSongLeaf(lib.tree, moved) : lib.tree });
}

export function toggleFavorite(id: string): Library {
  const song = load().songs.find((s) => s.id === id);
  return song ? updateSong(id, { favorite: !song.favorite }) : load();
}

/** Replace a song's filing with a fresh analysis, keeping notes, links, favourite and the added date. */
export function reanalyze(id: string, draft: SongDraft): Library {
  const lib = load();
  const old = lib.songs.find((s) => s.id === id);
  if (!old) return lib;
  return updateSong(id, {
    ...draft,
    links: [...new Set([...old.links, ...draft.links])],
    // Same song: lenses the new pass did not cover keep their old text. A
    // different song (a wrong match corrected) must not inherit any of it.
    descriptions: sameSong(old, draft) ? { ...old.descriptions, ...draft.descriptions } : draft.descriptions,
    notes: old.notes,
    favorite: old.favorite,
  });
}

/**
 * Merge descriptions into whatever the song holds NOW. Lenses are written by
 * parallel requests, so spreading a stale copy of the song would let the last
 * reply to land erase the ones before it.
 */
export function mergeDescriptions(id: string, descriptions: Song["descriptions"]): Library {
  const song = load().songs.find((s) => s.id === id);
  if (!song) return load();
  return updateSong(id, { descriptions: { ...song.descriptions, ...descriptions } });
}

export function deleteSong(id: string): Library {
  const lib = load();
  return save({ ...lib, songs: lib.songs.filter((s) => s.id !== id) });
}

export function addGenre(level: number, genre: string): Library {
  const lib = load();
  if (!genre.trim()) return lib;
  return save({ ...lib, tree: withLeaf(lib.tree, level, genre.trim()) });
}

export function addSubgenre(level: number, genre: string, subgenre: string): Library {
  const lib = load();
  if (!subgenre.trim()) return lib;
  return save({ ...lib, tree: withLeaf(lib.tree, level, genre, subgenre.trim()) });
}

/** Drop playlists that hold no reference songs. */
export function pruneEmpty(): Library {
  const lib = load();
  return save({ ...lib, tree: lib.songs.reduce<Tree>(withSongLeaf, {}) });
}

export function setDefaultLenses(lenses: LensId[]): Library {
  const lib = load();
  return save({ ...lib, defaultLenses: lenses.filter(isLens) });
}

export function saveBlueprint(bp: Blueprint): Library {
  const lib = load();
  return save({ ...lib, blueprints: [bp, ...lib.blueprints.filter((b) => b.scope !== bp.scope)] });
}

export function saveStyle(record: StyleRecord): Library {
  const lib = load();
  return save({ ...lib, styles: [record, ...lib.styles.filter((s) => s.id !== record.id)].slice(0, STYLE_HISTORY) });
}

export function deleteStyle(id: string): Library {
  const lib = load();
  return save({ ...lib, styles: lib.styles.filter((s) => s.id !== id) });
}

export function exportJson(): string {
  return JSON.stringify(load(), null, 2);
}

export function importJson(raw: string): Library {
  const parsed = JSON.parse(raw) as Partial<Library>;
  if (!Array.isArray(parsed?.songs)) throw new Error("Not a Music Classified export — no `songs` array.");
  return save(clean(parsed));
}
