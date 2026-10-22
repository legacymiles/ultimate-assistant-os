import { describe, expect, it } from "vitest";
import {
  type Attachment,
  type Composition,
  type Reading,
  MAX_LINKS,
  MAX_VIDEOS,
  hasEvidence,
  isBulk,
  jobsFor,
  needsReading,
  parseLinks,
  readingBrief,
  rejectFile,
  summarise,
} from "./compose";

function img(reading: Reading = "auto", name = "photo.jpg"): Attachment {
  return { id: `i${Math.random()}`, kind: "image", name, dataUrl: "data:image/jpeg;base64,x", reading };
}

function vid(id = "v1", name = "clip.mp4"): Attachment {
  return { id, kind: "video", name, dataUrl: "data:video/mp4;base64,x", reading: "auto" };
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

  it("takes several videos for a bulk read, each under 20 MB, up to the limit", () => {
    expect(rejectFile({ type: "video/mp4", size: 5_000_000 }, compose())).toBeNull();
    expect(rejectFile({ type: "video/mp4", size: 40_000_000 }, compose())).toMatch(/20 MB/);
    expect(rejectFile({ type: "video/mp4", size: 1000 }, compose({ attachments: [vid()] }))).toBeNull();
    const full = compose({ attachments: Array.from({ length: MAX_VIDEOS }, (_, i) => vid(`v${i}`)) });
    expect(rejectFile({ type: "video/mp4", size: 1000 }, full)).toMatch(/limit/);
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

describe("parseLinks", () => {
  it("finds every link in a column, a comma list or a share sheet's sentence", () => {
    expect(parseLinks("https://www.tiktok.com/@a/video/1\nhttps://youtu.be/xyz")).toEqual([
      "https://www.tiktok.com/@a/video/1",
      "https://youtu.be/xyz",
    ]);
    expect(parseLinks("https://a.com/x, https://b.com/y;https://c.com/z")).toHaveLength(3);
    expect(parseLinks("Check this out! https://www.instagram.com/reel/abc/ so good"))
      .toEqual(["https://www.instagram.com/reel/abc/"]);
  });

  it("accepts a link without https and ignores plain words", () => {
    expect(parseLinks("tiktok.com/@cook/video/9 dinner tonight e.g.")).toEqual(["https://tiktok.com/@cook/video/9"]);
  });

  it("keeps each link once, in the order pasted", () => {
    expect(parseLinks("https://a.com/1\nhttps://b.com/2\nhttps://a.com/1/")).toEqual(["https://a.com/1", "https://b.com/2"]);
  });

  it("stops at the limit", () => {
    const many = Array.from({ length: MAX_LINKS + 5 }, (_, i) => `https://a.com/${i}`).join("\n");
    expect(parseLinks(many)).toHaveLength(MAX_LINKS);
  });
});

describe("isBulk and jobsFor", () => {
  it("one link, one video, photos and a note stay ONE read about one dish", () => {
    const c = compose({ link: "https://www.tiktok.com/@a/video/1", note: "for six", attachments: [vid(), img()] });
    expect(isBulk(c)).toBe(false);
    const jobs = jobsFor(c);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ link: "https://www.tiktok.com/@a/video/1", videoId: "v1" });
    expect(jobs[0].photoIds).toHaveLength(1);
  });

  it("several links become one read each", () => {
    const c = compose({ link: "https://www.tiktok.com/@a/video/1\nhttps://youtu.be/b" });
    expect(isBulk(c)).toBe(true);
    const jobs = jobsFor(c);
    expect(jobs.map((j) => j.label)).toEqual(["that TikTok link", "that YouTube link"]);
    expect(jobs.every((j) => j.photoIds.length === 0 && !j.videoId)).toBe(true);
  });

  it("several videos become one read each, and the photos one more together", () => {
    const c = compose({ attachments: [vid("v1", "tacos.mp4"), vid("v2", "pasta.mp4"), img(), img()] });
    const jobs = jobsFor(c);
    expect(jobs.map((j) => j.label)).toEqual(["tacos.mp4", "pasta.mp4", "your photos"]);
    expect(jobs[2].photoIds).toHaveLength(2);
    expect(new Set(jobs.map((j) => j.id)).size).toBe(jobs.length);
  });

  it("says a bulk read reads each on its own and that every recipe comes back to be kept or skipped", () => {
    const c = compose({ link: "https://a.com/1\nhttps://b.com/2", note: "no dairy", attachments: [vid()] });
    expect(summarise(c)).toBe(
      "Reading two links and one video, each on its own, with your note applied to every one. Every recipe found comes back for you to keep or skip.",
    );
  });
});
