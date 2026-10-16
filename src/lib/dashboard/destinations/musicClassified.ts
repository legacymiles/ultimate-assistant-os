import type { Destination } from "./types";

// ---------------------------------------------------------------------------
// Screenshot of a song → filed in Jarvis Audio Studio's Music Classifier.
//
// The case this serves: a now-playing screen, a playlist row, a Shazam result,
// a song someone posted. The owner's habit is that song images go to the
// Classifier, so the photo pipeline reads the title and artist and, on
// approval, runs the SAME identify → measure → classify path the Classifier's
// own search box runs. Nothing about filing a song is reimplemented here.
//
// The client modules are imported lazily inside commit(): this file is also
// read by the server route (for the prompt), and the classifier's api module
// is client-only.
// ---------------------------------------------------------------------------

export interface SongFields {
  title: string;
  artist: string;
  guessed: boolean;
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

export const musicClassifiedDestination: Destination<SongFields> = {
  id: "music-classified",
  label: "Audio Studio › Classifier",
  appSlug: "jarvis-audio-studio",

  hint:
    '"music-classified" — the photo shows a SONG: a now-playing screen, a ' +
    "playlist or track row, a Shazam/Spotify/Apple Music result, an album or " +
    "single cover with the track name, or a post naming a track. Route here " +
    "when the value of the image is WHICH SONG it is.",

  fields: [
    { name: "title", type: "string", describe: "The song title exactly as shown. Not the album name." },
    { name: "artist", type: "string", describe: "The main artist exactly as shown; \"\" if the image does not show one." },
    {
      name: "guessed",
      type: "boolean",
      describe: "true if the title or artist was inferred rather than read clearly from the image.",
    },
  ],

  parse(raw) {
    const r = (raw ?? {}) as Record<string, unknown>;
    const title = str(r.title);
    if (!title) return null;
    return { title, artist: str(r.artist), guessed: r.guessed === true };
  },

  preview(f) {
    return {
      title: f.artist ? `${f.title} — ${f.artist}` : f.title,
      where: "Audio Studio › Classifier",
      lines: ["Found in the music catalogue, measured, and filed by genre and level"],
      unverified: f.guessed ? "Title or artist was partly guessed from the image" : undefined,
    };
  },

  async commit(f) {
    const [{ identify, fileIdentity }, store] = await Promise.all([
      import("@/components/music-classified/api"),
      import("@/lib/music-classified/store"),
    ]);
    const { identity } = await identify(f.artist ? `${f.title} by ${f.artist}` : f.title);
    const lib = store.getLibrary();
    const dup = store.findDuplicate(lib, identity);
    if (dup) return; // already filed — the photo is still kept in Folders
    const { draft } = await fileIdentity(identity, lib.tree, [], () => {});
    store.addSong(draft);
  },
};
