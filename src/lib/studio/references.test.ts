import { describe, expect, it } from "vitest";
import { pick } from "./render";
import {
  draftSource,
  MAX_SUBJECTS,
  MAX_TRACKS,
  numberReferences,
  pickTrack,
  REFERENCE_PATTERN,
  referenceToken,
  referencesIn,
  searchReferences,
  TRACK_PATTERN,
  trackToken,
  tracksIn,
  turnSources,
  type ReferenceMention,
} from "./references";

const refs = (n: number): ReferenceMention[] =>
  Array.from({ length: n }, (_, i) => ({
    n: i + 1,
    token: referenceToken(i + 1),
    label: `Subject ${i + 1}`,
    kind: "image" as const,
    thumb: `thumb-${i + 1}`,
    name: `photo-${i + 1}.jpg`,
  }));

const tracks = (n: number): ReferenceMention[] =>
  Array.from({ length: n }, (_, i) => ({
    n: i + 1,
    token: trackToken(i + 1),
    label: `Audio ${i + 1}`,
    kind: "audio" as const,
    thumb: `wave-${i + 1}`,
    name: `song-${i + 1}.mp3`,
  }));

describe("naming an upload in the prompt", () => {
  it("reads both the token the owner types and the phrase a skill writes", () => {
    expect(referencesIn("@Subject2 walks away from Subject 5")).toEqual([2, 5]);
    expect(referencesIn("subject-3 is holding it")).toEqual([3]);
  });

  it("keeps the order written and drops repeats", () => {
    expect(referencesIn("@Subject3 then @Subject1 then @Subject3")).toEqual([3, 1]);
  });

  it("ignores things that only look like one", () => {
    expect(referencesIn("the subject of the photo")).toEqual([]);
    expect(referencesIn("subjects 4 and 5")).toEqual([]);
  });

  it("matches what the render pipeline actually attaches", () => {
    // The whole point of the token: what the owner types is what the job gets.
    const uploads = ["a", "b", "c", "d", "e"];
    const job = { title: "t", prompt: "@Subject2 hands it to @Subject4", useReferences: true };
    expect(pick(job, uploads).map((r) => r.label)).toEqual(["Subject 2", "Subject 4"]);
  });

  it("falls back to the first four when the prompt names none", () => {
    const uploads = ["a", "b", "c", "d", "e"];
    expect(pick({ title: "t", prompt: "a wide shot", useReferences: true }, uploads)).toHaveLength(4);
  });

  it("attaches nothing when the job opts out", () => {
    expect(pick({ title: "t", prompt: "@Subject1", useReferences: false }, ["a"])).toEqual([]);
  });
});

describe("the @ menu", () => {
  it("offers everything for an empty query", () => {
    expect(searchReferences("", refs(3))).toHaveLength(3);
  });

  it("finds one by its number, its token or its file name", () => {
    const all = refs(12);
    expect(searchReferences("2", all).map((r) => r.n)).toEqual([2]);
    expect(searchReferences("subject1", all).map((r) => r.n)).toEqual([1, 10, 11, 12]);
    expect(searchReferences("photo-7", all).map((r) => r.n)).toEqual([7]);
  });

  it("returns nothing rather than everything when there is no match", () => {
    expect(searchReferences("zzz", refs(3))).toEqual([]);
  });

  it("keeps the two families apart, and offers both for a bare number", () => {
    const all = [...refs(3), ...tracks(2)];
    expect(searchReferences("sub", all).map((r) => r.token)).toEqual(["Subject1", "Subject2", "Subject3"]);
    expect(searchReferences("aud", all).map((r) => r.token)).toEqual(["Audio1", "Audio2"]);
    // What the owner means by "track" is what the code calls audio.
    expect(searchReferences("track2", all).map((r) => r.token)).toEqual(["Audio2"]);
    // A number is ambiguous on purpose: both Subject 2 and Audio 2 exist.
    expect(searchReferences("2", all).map((r) => r.token)).toEqual(["Subject2", "Audio2"]);
    expect(searchReferences("song-1", all).map((r) => r.token)).toEqual(["Audio1"]);
  });
});

describe("naming a track in the prompt", () => {
  it("reads the token the owner types and the label a note carries", () => {
    expect(tracksIn("score it with @Audio2")).toEqual([2]);
    expect(tracksIn('[Audio 1] Audio reference "song.mp3" — 3:12 long.')).toEqual([1]);
    expect(tracksIn("audio-3 under the cut")).toEqual([3]);
  });

  it("does not answer for the other family, in either direction", () => {
    expect(tracksIn("@Subject2 walks away")).toEqual([]);
    expect(referencesIn("@Audio2 under the cut")).toEqual([]);
    // Both in one sentence, each read by its own family.
    expect(referencesIn("@Subject3 dances to @Audio1")).toEqual([3]);
    expect(tracksIn("@Subject3 dances to @Audio1")).toEqual([1]);
  });

  it("ignores things that only look like one", () => {
    expect(tracksIn("the audio is quiet")).toEqual([]);
    expect(tracksIn("2 audio files")).toEqual([]);
  });

  it("is global, so repeated use does not skip matches", () => {
    expect(TRACK_PATTERN.flags).toContain("g");
    tracksIn("@Audio1");
    expect(tracksIn("@Audio1")).toEqual([1]);
  });
});

describe("which track scores the film", () => {
  const three = [{ n: 1 }, { n: 2 }, { n: 3 }];

  it("takes the one the owner named", () => {
    expect(pickTrack(["make the film with @Audio2"], three)).toEqual({ n: 2 });
  });

  it("lets the newest word win, because texts arrive newest first", () => {
    expect(pickTrack(["now use @Audio3", "earlier: @Audio1"], three)).toEqual({ n: 3 });
  });

  it("falls back to the newest track when nothing was named", () => {
    expect(pickTrack(["make the film"], three)).toEqual({ n: 3 });
  });

  it("skips a number that names no track rather than scoring nothing", () => {
    // "@Audio9" is a typo, not an instruction to leave the cut silent.
    expect(pickTrack(["use @Audio9", "use @Audio1"], three)).toEqual({ n: 1 });
    expect(pickTrack(["use @Audio9"], three)).toEqual({ n: 3 });
  });

  it("has nothing to score with when no track was attached", () => {
    expect(pickTrack(["use @Audio1"], [])).toBeUndefined();
  });
});

describe("the pattern itself", () => {
  it("is global, so repeated use does not skip matches", () => {
    expect(REFERENCE_PATTERN.flags).toContain("g");
    // A global regex carries lastIndex; referencesIn must not be affected by it.
    referencesIn("@Subject1");
    expect(referencesIn("@Subject1")).toEqual([1]);
  });
});

// The gallery's browser half (IndexedDB, poster capture) needs a DOM and this
// suite runs in node, so only its pure helpers are covered here. The store
// round-trip and the missing-bytes fallback were checked in the browser.
describe("gallery labels", () => {
  it("names a download after the title, safely", async () => {
    const { fileNameFor, prettyBytes } = await import("./gallery");
    expect(fileNameFor({ title: "Shot 1 — the hook", medium: "video" } as never)).toBe("Shot-1-the-hook.mp4");
    expect(fileNameFor({ title: "Flat lay / hero", medium: "image" } as never)).toBe("Flat-lay-hero.png");
    expect(fileNameFor({ title: "***", medium: "image" } as never)).toBe("studio.png");
    expect(prettyBytes(900)).toBe("900 B");
    expect(prettyBytes(2048)).toBe("2 KB");
    expect(prettyBytes(2411724)).toBe("2.3 MB");
  });
});

describe("app plugins", () => {
  it("resolves every allowed slug against the hub catalog", async () => {
    const { PLUGIN_SLUGS, studioPlugins } = await import("./plugins");
    const list = studioPlugins();
    expect(list.map((p) => p.slug)).toEqual([...PLUGIN_SLUGS]);
    for (const p of list) {
      expect(p.title).toBeTruthy();
      expect(p.href).toMatch(/^\//);
      // The catalog overviews are paragraphs; a card gets one sentence.
      expect(p.blurb.length).toBeLessThan(260);
      expect(p.blurb).not.toContain("\n");
    }
  });

  // An app that has moved has ONE definition, in the catalog, and ONE place it
  // is offered from. Losing the first turns the card into a dead slug; losing
  // the second is the duplicate the move was meant to end. Both halves hold for
  // a Toolbox app too, which is mounted inside Jarvis rather than linked out to.
  it("keeps every app that moved in the catalog and out of the hub", async () => {
    const { PROJECTS } = await import("@/lib/catalog");
    const { PLUGIN_SLUGS, TOOLBOX_SLUGS, hubProjects } = await import("./plugins");
    const moved = [...PLUGIN_SLUGS, ...TOOLBOX_SLUGS];
    const hub = hubProjects().map((p) => p.slug);
    for (const slug of moved) {
      expect(PROJECTS.some((p) => p.slug === slug)).toBe(true);
      expect(hub).not.toContain(slug);
    }
    // No slug is in both lists — an app is a door out or a tab, never both.
    expect(new Set(moved).size).toBe(moved.length);
    expect(hub.length).toBe(PROJECTS.length - moved.length);
  });
});

// ---------------------------------------------------------------------------
// The numbering itself, which three composers now share. A token typed in the
// Studio idea box has to mean the same file as the same token typed in chat,
// so what is tested here is that the count comes from the CONVERSATION and not
// from whichever tray happens to be on screen.
// ---------------------------------------------------------------------------

describe("counting a conversation's uploads", () => {
  it("counts pictures and tracks apart, so neither renumbers the other", () => {
    const out = numberReferences([
      { kind: "image", thumb: "a", name: "a.jpg" },
      { kind: "audio", thumb: "b", name: "b.mp3" },
      { kind: "video", thumb: "c", name: "c.mp4" },
      { kind: "audio", thumb: "d", name: "d.mp3" },
    ]);
    expect(out.map((r) => r.token)).toEqual(["Subject1", "Audio1", "Subject2", "Audio2"]);
    expect(out.map((r) => r.label)).toEqual(["Subject 1", "Audio 1", "Subject 2", "Audio 2"]);
  });

  it("continues the count rather than restarting it for a new composer", () => {
    // Three pictures already sent; the idea box adds a fourth. It must be
    // Subject 4 — the number the render will hand the job — not Subject 1.
    const sent = turnSources([
      { role: "you", images: ["1", "2"], imageInfo: [{ name: "one.jpg", kind: "image" }] },
      { role: "jarvis", images: ["rendered"] },
      { role: "you", images: ["3"] },
    ]);
    const drafting = [draftSource({ id: "x", kind: "image", thumb: "4", name: "four.jpg" })];
    const out = numberReferences([...sent, ...drafting]);
    expect(out.map((r) => r.token)).toEqual(["Subject1", "Subject2", "Subject3", "Subject4"]);
    // Only the one still in the tray carries an id, so only its tile finds a row.
    expect(out.filter((r) => r.id).map((r) => r.token)).toEqual(["Subject4"]);
  });

  it("leaves what Jarvis rendered back out of the numbering", () => {
    expect(turnSources([{ role: "jarvis", images: ["a", "b"] }])).toEqual([]);
  });

  it("reads a clip as a clip and keeps an audio note", () => {
    const out = numberReferences(
      turnSources([
        {
          role: "you",
          images: ["frame"],
          imageInfo: [{ name: "take.mp4", kind: "video", durationSec: 12 }],
          audio: [{ thumb: "wave", name: "song.mp3", durationSec: 200, note: "Tempo: 120 BPM" }],
        },
      ]),
    );
    expect(out[0]).toMatchObject({ token: "Subject1", kind: "video", durationSec: 12 });
    expect(out[1]).toMatchObject({ token: "Audio1", kind: "audio", note: "Tempo: 120 BPM" });
  });

  it("stops where the render stops rather than promising numbers nothing takes", () => {
    const many = numberReferences([
      ...Array.from({ length: MAX_SUBJECTS + 4 }, (_, i) => ({
        kind: "image" as const,
        thumb: String(i),
        name: `${i}.jpg`,
      })),
      ...Array.from({ length: MAX_TRACKS + 3 }, (_, i) => ({
        kind: "audio" as const,
        thumb: String(i),
        name: `${i}.mp3`,
      })),
    ]);
    expect(many.filter((r) => r.kind === "image")).toHaveLength(MAX_SUBJECTS);
    expect(many.filter((r) => r.kind === "audio")).toHaveLength(MAX_TRACKS);
  });

  it("gives the menu something to find every numbered upload by", () => {
    const out = numberReferences([
      { kind: "image", thumb: "a", name: "beach.jpg" },
      { kind: "audio", thumb: "b", name: "theme.mp3" },
    ]);
    expect(searchReferences("subject", out).map((r) => r.token)).toEqual(["Subject1"]);
    expect(searchReferences("aud", out).map((r) => r.token)).toEqual(["Audio1"]);
    expect(searchReferences("beach", out).map((r) => r.token)).toEqual(["Subject1"]);
    // A bare number means the number, in both families.
    expect(searchReferences("1", out).map((r) => r.token)).toEqual(["Subject1", "Audio1"]);
  });
});
