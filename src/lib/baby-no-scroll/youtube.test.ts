import { describe, expect, it } from "vitest";
import { describeTarget, embedParams, embedUrl, parseYouTube } from "./youtube";

const VID = "dQw4w9WgXcQ";
const LIST = "PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI";

describe("reading whatever the share sheet gave us", () => {
  it("takes every shape of link to one video", () => {
    for (const input of [
      `https://www.youtube.com/watch?v=${VID}`,
      `https://m.youtube.com/watch?v=${VID}&t=42s`,
      `https://youtu.be/${VID}`,
      `https://youtu.be/${VID}?t=42`,
      `https://www.youtube.com/shorts/${VID}`,
      `https://www.youtube.com/embed/${VID}`,
      `https://www.youtube.com/live/${VID}`,
      `https://www.youtube-nocookie.com/embed/${VID}`,
      // No protocol, which is what a copied link often is.
      `youtube.com/watch?v=${VID}`,
      // Whitespace from a share sheet, and the bare id.
      `  ${VID}  `,
    ]) {
      expect(parseYouTube(input), input).toEqual({ kind: "video", id: VID });
    }
  });

  it("takes a playlist on its own", () => {
    expect(parseYouTube(`https://www.youtube.com/playlist?list=${LIST}`)).toEqual({
      kind: "playlist",
      id: LIST,
    });
    expect(parseYouTube(LIST)).toEqual({ kind: "playlist", id: LIST });
  });

  // A video inside a playlist is the common case for a child's "put this on",
  // and both halves matter: it should START where the parent pointed and then
  // keep going, which means keeping the list rather than throwing it away.
  it("keeps the playlist a watch link was opened from", () => {
    expect(parseYouTube(`https://www.youtube.com/watch?v=${VID}&list=${LIST}&index=3`)).toEqual({
      kind: "video",
      id: VID,
      list: LIST,
    });
  });

  it("still plays a watch link that lost its video id but kept the list", () => {
    expect(parseYouTube(`https://www.youtube.com/watch?list=${LIST}`)).toEqual({
      kind: "playlist",
      id: LIST,
    });
  });

  it("refuses what it cannot play rather than guessing", () => {
    for (const input of [
      "",
      "   ",
      "not a link",
      "https://example.com/watch?v=dQw4w9WgXcQ",
      "https://vimeo.com/123456",
      // Right host, nothing playable on it.
      "https://www.youtube.com/",
      "https://www.youtube.com/@somechannel",
      "https://www.youtube.com/watch?v=tooshort",
      // Eleven characters is the rule, and twelve is not eleven.
      "https://youtu.be/dQw4w9WgXcQQ",
    ]) {
      expect(parseYouTube(input), input).toBeNull();
    }
  });
});

describe("the embed", () => {
  it("takes away every control a baby could reach", () => {
    const p = embedParams({ kind: "video", id: VID }, { loop: false });
    expect(p.controls).toBe("0");
    expect(p.disablekb).toBe("1");
    expect(p.fs).toBe("0");
    expect(p.rel).toBe("0");
    expect(p.iv_load_policy).toBe("3");
    expect(p.autoplay).toBe("1");
    expect(p.playsinline).toBe("1");
  });

  // YouTube only loops a single video when it is ALSO named as its own playlist.
  // Leaving that out is why "loop" silently does nothing on most embeds, and a
  // video that stops is the whole failure this app exists to prevent.
  it("names a single video as its own playlist in order to loop it", () => {
    const off = embedParams({ kind: "video", id: VID }, { loop: false });
    expect(off.loop).toBeUndefined();
    expect(off.playlist).toBeUndefined();

    const on = embedParams({ kind: "video", id: VID }, { loop: true });
    expect(on.loop).toBe("1");
    expect(on.playlist).toBe(VID);
  });

  it("loops a real playlist by the list itself, not by a self-reference", () => {
    const p = embedParams({ kind: "playlist", id: LIST }, { loop: true });
    expect(p.list).toBe(LIST);
    expect(p.listType).toBe("playlist");
    expect(p.loop).toBe("1");
    expect(p.playlist).toBeUndefined();
  });

  it("carries the list through when a video was opened from one", () => {
    const p = embedParams({ kind: "video", id: VID, list: LIST }, { loop: true });
    expect(p.list).toBe(LIST);
    expect(p.playlist).toBeUndefined();
  });

  it("serves the fallback iframe from the no-cookie host", () => {
    const url = embedUrl({ kind: "video", id: VID }, { loop: true });
    expect(url).toContain("https://www.youtube-nocookie.com/embed/" + VID);
    expect(url).toContain("controls=0");

    // A playlist has no video to be the path, so it is videoseries.
    expect(embedUrl({ kind: "playlist", id: LIST }, { loop: true })).toContain(
      "/embed/videoseries?",
    );
  });

  it("says plainly what it understood, for the setup screen", () => {
    expect(describeTarget({ kind: "video", id: VID })).toBe(`Video ${VID}`);
    expect(describeTarget({ kind: "playlist", id: LIST })).toBe(`Playlist ${LIST}`);
    expect(describeTarget({ kind: "video", id: VID, list: LIST })).toContain("playlist");
  });
});
