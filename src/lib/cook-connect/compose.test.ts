import { describe, expect, it } from "vitest";
import {
  type Attachment,
  type Composition,
  type Reading,
  hasEvidence,
  needsReading,
  readingBrief,
  rejectFile,
  summarise,
} from "./compose";

function img(reading: Reading = "auto", name = "photo.jpg"): Attachment {
  return { id: `i${Math.random()}`, kind: "image", name, dataUrl: "data:image/jpeg;base64,x", reading };
}

function vid(): Attachment {
  return { id: "v1", kind: "video", name: "clip.mp4", dataUrl: "data:video/mp4;base64,x", reading: "auto" };
}

function compose(c: Partial<Composition> = {}): Composition {
  return { note: "", link: "", attachments: [], ...c };
}

describe("hasEvidence", () => {
  it("is false for an untouched composer", () => {
    expect(hasEvidence(compose())).toBe(false);
  });

  it("is false for whitespace alone", () => {
    expect(hasEvidence(compose({ note: "   \n " }))).toBe(false);
  });

  it("is true for any one of a note, a link or an attachment", () => {
    expect(hasEvidence(compose({ note: "lemon chicken" }))).toBe(true);
    expect(hasEvidence(compose({ link: "https://tiktok.com/x" }))).toBe(true);
    expect(hasEvidence(compose({ attachments: [img()] }))).toBe(true);
  });
});

describe("needsReading", () => {
  it("sends words alone to the draft route, which has a keyless fallback", () => {
    expect(needsReading(compose({ note: "a one-pan lemon chicken" }))).toBe(false);
  });

  it("sends anything with a link, a photo or a video to the reading route", () => {
    expect(needsReading(compose({ link: "https://tiktok.com/x" }))).toBe(true);
    expect(needsReading(compose({ attachments: [img()] }))).toBe(true);
    expect(needsReading(compose({ attachments: [vid()] }))).toBe(true);
  });

  it("still needs reading when a note comes WITH an attachment — the note never demotes it", () => {
    expect(needsReading(compose({ note: "make it for six", attachments: [img("dish")] }))).toBe(true);
  });
});

describe("summarise", () => {
  it("says nothing when there is nothing", () => {
    expect(summarise(compose())).toBe("");
  });

  it("writes from words alone, rather than claiming to read them", () => {
    expect(summarise(compose({ note: "lemon chicken" }))).toBe("Writing from your note.");
  });

  it("names the platform rather than printing the URL", () => {
    expect(summarise(compose({ link: "https://www.tiktok.com/@cook/video/123" })))
      .toBe("Reading that TikTok link.");
    expect(summarise(compose({ link: "https://youtu.be/abc" }))).toBe("Reading that YouTube link.");
    expect(summarise(compose({ link: "https://smittenkitchen.com/pasta" })))
      .toBe("Reading smittenkitchen.com.");
  });

  it("survives a link that is not yet a URL", () => {
    expect(summarise(compose({ link: "tiktok" }))).toBe("Reading that link.");
  });

  it("counts photos by how each one will be read", () => {
    expect(summarise(compose({ attachments: [img("dish"), img("dish"), img("written")] })))
      .toBe("Reading two photos of the dish and one photo of the writing.");
  });

  it("says out loud which photos nobody has given a reading", () => {
    expect(summarise(compose({ attachments: [img("dish"), img("auto")] })))
      .toBe("Reading one photo of the dish and one photo to work out.");
  });

  it("lists everything in the order it is read, note last", () => {
    expect(summarise(compose({
      note: "no dairy",
      link: "https://www.instagram.com/p/x",
      attachments: [vid(), img("dish")],
    }))).toBe("Reading that Instagram link, the video, one photo of the dish and your note.");
  });
});

describe("readingBrief", () => {
  it("is empty with no photos", () => {
    expect(readingBrief([])).toBe("");
  });

  it("numbers each photo so the instruction lines up with the image part sent", () => {
    const brief = readingBrief(["written", "dish"]);
    expect(brief).toContain("THE 2 PHOTOS ATTACHED");
    expect(brief).toMatch(/IMAGE 1: a picture of WRITING/);
    expect(brief).toMatch(/IMAGE 2: a photo of the finished dish/);
  });

  it("tells a transcription not to invent, and a dish photo not to pretend to read", () => {
    expect(readingBrief(["written"])).toContain("never substitute your own");
    expect(readingBrief(["dish"])).toContain("Do not pretend to read text that isn't there");
  });
});

describe("rejectFile", () => {
  it("takes photos up to the limit", () => {
    const four = compose({ attachments: [img(), img(), img(), img()] });
    expect(rejectFile({ type: "image/jpeg", size: 2_000_000 }, four)).toBeNull();
    const six = compose({ attachments: [img(), img(), img(), img(), img(), img()] });
    expect(rejectFile({ type: "image/png", size: 10_000 }, six)).toMatch(/limit/);
  });

  it("takes one video, under 20 MB", () => {
    expect(rejectFile({ type: "video/mp4", size: 5_000_000 }, compose())).toBeNull();
    expect(rejectFile({ type: "video/mp4", size: 40_000_000 }, compose())).toMatch(/20 MB/);
    expect(rejectFile({ type: "video/mp4", size: 1000 }, compose({ attachments: [vid()] })))
      .toMatch(/One video at a time/);
  });

  it("refuses a PDF, and says what it wanted", () => {
    expect(rejectFile({ type: "application/pdf", size: 1000 }, compose()))
      .toMatch(/neither a photo nor a video/);
  });

  it("does not count photos against the video slot, or the reverse", () => {
    const withVideo = compose({ attachments: [vid()] });
    expect(rejectFile({ type: "image/jpeg", size: 1000 }, withVideo)).toBeNull();
    const withPhotos = compose({ attachments: [img(), img()] });
    expect(rejectFile({ type: "video/mp4", size: 1000 }, withPhotos)).toBeNull();
  });
});
