import { describe, expect, it } from "vitest";
import {
  MOVED_IN,
  STUDIOS,
  getStudio,
  parseStudioHash,
  sectionFor,
  studioHash,
  type MountKey,
} from "./studios";
import { WORKFLOWS } from "./workflows";

describe("the wall", () => {
  it("draws seven studios, video first", () => {
    expect(STUDIOS).toHaveLength(7);
    expect(STUDIOS[0].id).toBe("video");
  });

  it("gives every studio ids that are unique and a hue on the wheel", () => {
    const ids = STUDIOS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of STUDIOS) {
      expect(s.hue).toBeGreaterThanOrEqual(0);
      expect(s.hue).toBeLessThan(360);
    }
  });

  it("never leaves a studio with nothing inside it", () => {
    for (const s of STUDIOS) expect(s.sections.length).toBeGreaterThan(0);
  });

  it("keeps section ids unique within a studio", () => {
    for (const s of STUDIOS) {
      const ids = s.sections.map((x) => x.id);
      expect(new Set(ids).size, `${s.id} has a duplicate section id`).toBe(ids.length);
    }
  });

  it("mounts each section exactly once across the whole wall, except the gallery", () => {
    // Two studios share the gallery on purpose — it is one component filtered by
    // what the studio made. Anything ELSE appearing twice means an app got
    // gathered into two studios, which is the bug this test exists to catch.
    const mounts = STUDIOS.flatMap((s) => s.sections.map((x) => x.mount));
    const twice = mounts.filter((m, i) => mounts.indexOf(m) !== i);
    expect(twice).toEqual(["gallery"]);
  });

  it("writes a blurb and a label on every section", () => {
    for (const s of STUDIOS) {
      for (const x of s.sections) {
        expect(x.label.length, `${s.id}/${x.id}`).toBeGreaterThan(0);
        expect(x.blurb.length, `${s.id}/${x.id}`).toBeGreaterThan(0);
        expect(x.icon.length, `${s.id}/${x.id}`).toBeGreaterThan(0);
      }
    }
  });
});

describe("the workflow wall, split in two", () => {
  it("partitions the catalog with nothing orphaned", () => {
    // Video Studio locks the wall to `video` and Image Studio to `image`. A
    // workflow of some third medium would be reachable from neither studio.
    const mediums = new Set(WORKFLOWS.map((w) => w.medium));
    expect([...mediums].sort()).toEqual(["image", "video"]);
  });

  it("gives both halves a home", () => {
    const mounts = STUDIOS.flatMap((s) => s.sections.map((x) => x.mount));
    expect(mounts).toContain<MountKey>("video-workflows");
    expect(mounts).toContain<MountKey>("image-workflows");
  });
});

describe("getStudio", () => {
  it("finds a studio by id", () => {
    expect(getStudio("money")?.name).toBe("Money Agent Studio");
  });

  it("returns null rather than throwing on a stale id", () => {
    expect(getStudio("seedance")).toBeNull();
  });
});

describe("sectionFor", () => {
  const video = getStudio("video")!;

  it("opens the section the link named", () => {
    expect(sectionFor(video, "arena").id).toBe("arena");
  });

  it("opens the first section when the link named none", () => {
    expect(sectionFor(video, null).id).toBe("workflows");
  });

  it("falls back to the first section when the link named one that is gone", () => {
    expect(sectionFor(video, "seedance-engine").id).toBe("workflows");
  });
});

describe("the forwarding addresses", () => {
  it("points every moved-in slug at a studio that exists", () => {
    for (const [slug, where] of Object.entries(MOVED_IN)) {
      const studio = getStudio(where.studio);
      expect(studio, `${slug} points at a studio that does not exist`).not.toBeNull();
      const section = studio!.sections.find((s) => s.id === where.section);
      expect(section, `${slug} points at ${where.studio}/${where.section}, which is not a section`)
        .toBeTruthy();
    }
  });
});

describe("studio hashes", () => {
  it("round-trips a studio and a section", () => {
    const parsed = parseStudioHash(studioHash("video", "arena"));
    expect(parsed).toEqual({ studio: "video", section: "arena" });
  });

  it("round-trips a studio on its own", () => {
    expect(parseStudioHash(studioHash("money"))).toEqual({ studio: "money", section: null });
  });

  it("reads a hash with no leading #", () => {
    expect(parseStudioHash("studio/audio/create")).toEqual({ studio: "audio", section: "create" });
  });

  it("refuses a hash that is not a studio", () => {
    expect(parseStudioHash("#skills")).toBeNull();
    expect(parseStudioHash("#studio/nope")).toBeNull();
    expect(parseStudioHash("")).toBeNull();
  });
});
