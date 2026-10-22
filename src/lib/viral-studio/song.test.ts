import { describe, expect, it } from "vitest";

import { judgeSound, songFromCredit, songLine } from "./song";

describe("songFromCredit", () => {
  it("takes a real song credit", () => {
    expect(songFromCredit({ title: "Not Like Us", artist: "Kendrick Lamar" })).toEqual({ title: "Not Like Us", artist: "Kendrick Lamar", via: "post" });
  });
  it("drops (Official Video) noise", () => {
    expect(songFromCredit({ title: "Espresso (Official Video)", artist: "Sabrina Carpenter" })?.title).toBe("Espresso");
  });
  it("refuses the poster's own sound in any wording", () => {
    for (const title of ["original sound - mike", "Original Audio", "som original - ana", "sonido original"]) {
      expect(songFromCredit({ title, artist: "someone" })).toBeNull();
    }
    expect(songFromCredit({ title: "Funny bit", artist: "joe", original: true })).toBeNull();
  });
});

describe("judgeSound", () => {
  it("prefers the credit, then what was heard", () => {
    expect(judgeSound({ title: "Song A", artist: "X" }, { title: "Song B", artist: "Y", via: "listen" }).song?.title).toBe("Song A");
    expect(judgeSound({ title: "original sound - x", artist: "x" }, { title: "Song B", artist: "Y", via: "listen" })).toEqual({
      kind: "song",
      song: { title: "Song B", artist: "Y", via: "listen" },
    });
  });
  it("calls an original sound with nothing heard 'original' — no subtitle", () => {
    expect(judgeSound({ title: "original sound - x", artist: "x" }, null)).toEqual({ kind: "original" });
  });
  it("is honest when it can't tell", () => {
    expect(judgeSound(null, null)).toEqual({ kind: "unknown" });
  });
});

describe("songLine", () => {
  it("reads Artist — Song", () => {
    expect(songLine({ title: "Song", artist: "Artist", via: "listen" })).toBe("Artist — Song");
    expect(songLine({ title: "Song", artist: "", via: "post" })).toBe("Song");
    expect(songLine(undefined)).toBe("");
  });
});
