import { describe, expect, it } from "vitest";
import {
  durationOf,
  formatDuration,
  formatSize,
  isVideoFile,
  isBlankFrame,
  isVideoItem,
  posterTime,
  retryPosterTime,
  titleFrom,
  totalDuration,
  totalSize,
  videosRoot,
  VIDEOS_ROOT,
} from "./videos";
import type { Item, RecallData } from "../types";

function item(patch: Partial<Item>): Item {
  return {
    id: "itm1",
    title: "Clip",
    body: "",
    summary: "",
    kind: "file",
    source: "manual",
    folderId: "f1",
    tags: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...patch,
  } as Item;
}

describe("recognising a video", () => {
  it("takes the MIME type when the browser gives one", () => {
    expect(isVideoFile({ name: "clip", type: "video/quicktime" })).toBe(true);
  });

  it("falls back to the extension, which is all a .MOV from an iPhone has", () => {
    expect(isVideoFile({ name: "IMG_4471.MOV", type: "" })).toBe(true);
    expect(isVideoFile({ name: "holiday.mkv" })).toBe(true);
  });

  it("refuses photos and documents", () => {
    expect(isVideoFile({ name: "receipt.jpg", type: "image/jpeg" })).toBe(false);
    expect(isVideoFile({ name: "lease.pdf", type: "application/pdf" })).toBe(false);
  });

  it("reads a filed item by what was written at import", () => {
    expect(isVideoItem(item({ attachment: { name: "a.mp4", type: "", size: 1, category: "video" } }))).toBe(true);
  });

  it("still recognises an older item whose category was never set", () => {
    expect(isVideoItem(item({ attachment: { name: "a.mov", type: "", size: 1 } }))).toBe(true);
    expect(isVideoItem(item({ attachment: { name: "a.png", type: "image/png", size: 1 } }))).toBe(false);
    expect(isVideoItem(item({ attachment: null }))).toBe(false);
  });
});

describe("formatDuration", () => {
  it("pads the seconds so a column of times lines up", () => {
    expect(formatDuration(7)).toBe("0:07");
    expect(formatDuration(67)).toBe("1:07");
    expect(formatDuration(271)).toBe("4:31");
  });

  it("pads the minutes only once there is an hour in front of them", () => {
    expect(formatDuration(3723)).toBe("1:02:03");
    expect(formatDuration(3600)).toBe("1:00:00");
  });

  it("says nothing rather than zero when the length is unknown", () => {
    expect(formatDuration(null)).toBe("—");
    expect(formatDuration(undefined)).toBe("—");
    expect(formatDuration(NaN)).toBe("—");
  });
});

describe("formatSize", () => {
  it("scales the unit and keeps one decimal only where it reads", () => {
    expect(formatSize(800)).toBe("800 B");
    expect(formatSize(831_488)).toBe("812 KB");
    expect(formatSize(1_500_000)).toBe("1.4 MB");
    expect(formatSize(43_000_000)).toBe("41 MB");
    expect(formatSize(2_400_000_000)).toBe("2.2 GB");
  });

  it("has an unknown state", () => {
    expect(formatSize(undefined)).toBe("—");
  });
});

describe("posterTime", () => {
  it("skips past the opening black of a normal clip", () => {
    expect(posterTime(60)).toBe(3);
    expect(posterTime(20)).toBe(3);
  });

  it("clears a one-second fade-up even on a short clip", () => {
    // The case that shipped a black tile: 10% of six seconds is 0.6s, which is
    // still inside the fade.
    expect(posterTime(6)).toBeGreaterThan(1);
    expect(posterTime(4)).toBe(1.2);
  });

  it("never seeks past the end of a very short one", () => {
    expect(posterTime(0.8)).toBeCloseTo(0.4);
    expect(posterTime(1.4)).toBeCloseTo(0.7);
  });

  it("stays at the start when the length is not known yet", () => {
    expect(posterTime(NaN)).toBe(0);
    expect(posterTime(0)).toBe(0);
  });
});

describe("the second look, when the first frame was black", () => {
  it("goes properly into the clip rather than nudging forward", () => {
    expect(retryPosterTime(10)).toBe(4);
    expect(retryPosterTime(600)).toBe(8);
  });

  it("does not exist for a clip too short to have anywhere else to look", () => {
    expect(retryPosterTime(2)).toBeNull();
    expect(retryPosterTime(NaN)).toBeNull();
  });

  it("calls a black frame black and a dim one fine", () => {
    const frame = (r: number, g: number, b: number) =>
      new Uint8ClampedArray(Array.from({ length: 400 }, (_, i) => [r, g, b, 255][i % 4]));
    expect(isBlankFrame(frame(0, 0, 0))).toBe(true);
    expect(isBlankFrame(frame(6, 6, 6))).toBe(true);
    expect(isBlankFrame(frame(30, 20, 25))).toBe(false);
    expect(isBlankFrame(frame(255, 255, 255))).toBe(false);
  });

  it("treats an empty buffer as nothing to judge, not as black", () => {
    expect(isBlankFrame(new Uint8ClampedArray())).toBe(false);
  });
});

describe("durations read back off filed items", () => {
  const clips = [
    item({ id: "a", fields: { duration: "12.5" } }),
    item({ id: "b", fields: { duration: "30" } }),
    item({ id: "c", fields: {} }),
  ];

  it("reads the number the import wrote", () => {
    expect(durationOf(clips[0])).toBe(12.5);
  });

  it("treats a missing length as unknown, not as zero-length", () => {
    expect(durationOf(clips[2])).toBeNull();
  });

  it("totals what it knows without dropping the rest of the list", () => {
    expect(totalDuration(clips)).toBe(42.5);
    expect(formatDuration(totalDuration(clips))).toBe("0:43");
  });

  it("totals sizes across a folder", () => {
    expect(
      totalSize([
        item({ attachment: { name: "a.mp4", type: "", size: 1_000_000 } }),
        item({ attachment: { name: "b.mp4", type: "", size: 500_000 } }),
        item({ attachment: null }),
      ]),
    ).toBe(1_500_000);
  });
});

describe("titleFrom", () => {
  it("turns a filename into something readable", () => {
    expect(titleFrom("beach-day_final_v2.MOV")).toBe("beach day final v2");
    expect(titleFrom("IMG_4471.mp4")).toBe("IMG 4471");
  });

  it("keeps the filename when there is nothing else left", () => {
    expect(titleFrom(".mp4")).toBe(".mp4");
  });
});

describe("videosRoot", () => {
  const base = (folders: RecallData["folders"]): RecallData =>
    ({ folders, items: [], version: 1 }) as unknown as RecallData;

  const folder = (id: string, name: string, parentId: string | null, role?: "photos") =>
    ({ id, name, parentId, autoGenerated: false, role, createdAt: "2026-01-01T00:00:00.000Z" }) as RecallData["folders"][number];

  it("finds Videos under the managed Photos root", () => {
    const data = base([
      folder("p", "Photos", null, "photos"),
      folder("v", VIDEOS_ROOT, "p"),
    ]);
    expect(videosRoot(data)?.id).toBe("v");
  });

  it("finds it under a Photos root that predates the role flag", () => {
    const data = base([folder("p", "photos", null), folder("v", "videos", "p")]);
    expect(videosRoot(data)?.id).toBe("v");
  });

  it("ignores a Videos folder that lives somewhere else entirely", () => {
    const data = base([
      folder("p", "Photos", null, "photos"),
      folder("w", "Work", null),
      folder("v", "Videos", "w"),
    ]);
    expect(videosRoot(data)).toBeNull();
  });

  it("returns null before the Photos root exists", () => {
    expect(videosRoot(base([]))).toBeNull();
  });
});
