// ---------------------------------------------------------------------------
// One session, many versions.
//
// Shared by Mashup and Remix because both answer the same requirement in the
// owner's words: "all edits that create a finished song in 1 session will be in
// that project session". So a revision never opens a new project — it appends a
// record here, holding the exact style and lyrics that produced it.
//
// That is what makes v3 reproducible after v4 replaced it on the screen, and
// what lets any version be re-rendered or downloaded later. Overwriting the
// take instead would make "make the chorus bigger" a one-way door, and the
// whole point of prompting for changes is that it is not.
// ---------------------------------------------------------------------------

/** How a finished version was made. Mashup has two routes; Remix has one. */
export type VersionMethod = "generated" | "layered";

export interface MashupVersion {
  n: number;
  /** The `Render` on this project that this version is. */
  renderId: string;
  title: string;
  /** The prompt that asked for this version. Empty on v1. */
  change: string;
  method: VersionMethod;
  style: string;
  lyrics: string;
  at: number;
}

export function readVersions(data: Record<string, unknown> | undefined): MashupVersion[] {
  const raw = data?.versions;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((v): v is MashupVersion => !!v && typeof v === "object" && typeof (v as MashupVersion).renderId === "string")
    .map((v) => ({ ...v, n: Number(v.n) || 0 }))
    .sort((x, y) => y.n - x.n);
}

/** The next version number in a session. Always one past the highest seen. */
export function nextVersionNumber(versions: MashupVersion[]): number {
  return versions.reduce((max, v) => Math.max(max, v.n), 0) + 1;
}
