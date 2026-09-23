"use client";

// ---------------------------------------------------------------------------
// The library: what the owner has actually pulled down.
//
// Records the licence alongside the file, permanently. Six months from now,
// "can I put this under a client's video?" is a question about a row in this
// table, and a filename cannot answer it. The audio itself lives wherever the
// browser saves downloads — this is the provenance, not the storage.
// ---------------------------------------------------------------------------

import { loadLocal, saveSynced } from "@/lib/sync/appState";
import { nowIso, uid } from "@/lib/utils";
import { emptyLibrary, LIBRARY_KEY, type Grab, type LibraryState } from "./types";

export { LIBRARY_KEY };

export function loadLibrary(): LibraryState {
  const state = loadLocal<LibraryState>(LIBRARY_KEY, emptyLibrary());
  return { grabs: Array.isArray(state.grabs) ? state.grabs : [] };
}

function save(state: LibraryState): LibraryState {
  saveSynced(LIBRARY_KEY, state);
  return state;
}

/** Newest first, and the same file grabbed twice moves rather than duplicates. */
export function recordGrab(grab: Omit<Grab, "id" | "at">): LibraryState {
  const current = loadLibrary();
  const rest = current.grabs.filter((g) => g.fileUrl !== grab.fileUrl);
  return save({ grabs: [{ ...grab, id: uid(), at: nowIso() }, ...rest].slice(0, 500) });
}

export function forgetGrab(id: string): LibraryState {
  const current = loadLibrary();
  return save({ grabs: current.grabs.filter((g) => g.id !== id) });
}

export function clearLibrary(): LibraryState {
  return save(emptyLibrary());
}

/**
 * The credit lines every CC file in the library obliges, as one block.
 *
 * Attribution is the one thing about a CC download that is easy to lose and
 * expensive to be missing, so the app can hand it over whole.
 */
export function creditsText(grabs: Grab[]): string {
  const lines = grabs
    .filter((g) => g.licence.kind === "cc" || g.licence.kind === "public-domain")
    .map(
      (g) =>
        g.licence.attribution ??
        `"${g.title}" by ${g.artist} — ${g.licence.label}${g.licence.url ? " (" + g.licence.url + ")" : ""} via ${g.providerLabel}: ${g.pageUrl}`,
    );
  return [...new Set(lines)].join("\n");
}
