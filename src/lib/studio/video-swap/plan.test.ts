import { describe, expect, it } from "vitest";
import {
  blankDraft,
  blankPerson,
  briefText,
  checkSwap,
  draftFromPrompt,
  humanMinutes,
  jobOf,
  leftToRight,
  parseJob,
  pictures,
  pipeline,
  placeUploads,
  readPrompt,
  sideOf,
  titleFor,
  totalMinutes,
  type ClipMeta,
  type SwapDraft,
} from "./plan";

const CLIP: ClipMeta = { name: "dance.mp4", duration: 10, width: 720, height: 1280, size: 8_000_000 };
const IMG = (n: number) => `data:image/jpeg;base64,${"A".repeat(10)}${n}`;

function twoPeople(): SwapDraft {
  const d = blankDraft();
  d.people = [
    { ...blankPerson(IMG(2), "b"), x: 0.8, y: 0.3 },
    { ...blankPerson(IMG(1), "a"), x: 0.2, y: 0.35 },
  ];
  d.scene = { ...d.scene, image: IMG(9), prompt: "a rooftop in Tokyo at night" };
  return d;
}

describe("readPrompt", () => {
  it("pulls the new world out of the line", () => {
    const r = readPrompt("Swap the dancer with my avatar and change the background to a neon rooftop in Tokyo at night, vertical");
    expect(r.scenePrompt).toBe("neon rooftop in Tokyo at night");
    expect(r.aspect).toBe("9:16");
    expect(r.keepBackground).toBe(false);
  });
  it("hears 'keep the background'", () => {
    const r = readPrompt("replace the guy with me but keep the background");
    expect(r.keepBackground).toBe(true);
    expect(r.scenePrompt).toBe("");
  });
  it("knows a background-only request", () => {
    expect(readPrompt("just change the background to a beach").backgroundOnly).toBe(true);
    expect(readPrompt("swap the girl with my character, background a beach").backgroundOnly).toBe(false);
  });
  it("reads quality and camera words", () => {
    const r = readPrompt("HD please, put them in a kitchen with a slow push in");
    expect(r.quality).toBe("hd");
    expect(r.motion).toBe("push");
    expect(r.scenePrompt).toContain("kitchen");
  });
});

describe("placeUploads", () => {
  it("takes the clip as the driving video and pictures as the new characters", () => {
    const p = placeUploads(["image", "video", "image"], "swap both dancers with these two");
    expect(p).toEqual({ clip: 1, characters: [0, 2], background: null });
  });
  it("makes the last picture the background when the line talks about one", () => {
    const p = placeUploads(["video", "image", "image"], "replace him with picture 1 and use this background");
    expect(p).toEqual({ clip: 0, characters: [1], background: 2 });
  });
  it("one picture + a background-only line = the background", () => {
    const p = placeUploads(["video", "image"], "only change the background to this");
    expect(p.background).toBe(1);
    expect(p.characters).toEqual([]);
  });
  it("one picture + a swap line stays a character even when a background is described", () => {
    const p = placeUploads(["video", "image"], "swap the guy with me, background a beach");
    expect(p.characters).toEqual([1]);
    expect(p.background).toBeNull();
  });
});

describe("people", () => {
  it("orders left to right, the way the PC numbers faces", () => {
    expect(leftToRight(twoPeople().people).map((p) => p.id)).toEqual(["a", "b"]);
  });
  it("names the side of the frame", () => {
    expect(sideOf(0.1)).toBe("on the left");
    expect(sideOf(0.5)).toBe("in the middle");
    expect(sideOf(0.9)).toBe("on the right");
    expect(sideOf(-1)).toBe("not marked");
  });
});

describe("checkSwap", () => {
  it("is clean for a full two-person swap with a new world", () => {
    expect(checkSwap(twoPeople(), CLIP)).toEqual([]);
  });
  it("asks for the clip", () => {
    expect(checkSwap(twoPeople(), null)[0]).toMatch(/driving video/);
  });
  it("needs something to change", () => {
    const d = blankDraft();
    d.scene.mode = "keep";
    expect(checkSwap(d, CLIP).join(" ")).toMatch(/nothing to change/);
  });
  it("one unmarked person is fine — the PC takes the main face", () => {
    const d = blankDraft();
    d.people = [blankPerson(IMG(1))];
    expect(checkSwap(d, CLIP)).toEqual([]);
  });
  it("two people must both be tapped", () => {
    const d = twoPeople();
    d.people[0] = { ...d.people[0], x: -1, y: -1 };
    expect(checkSwap(d, CLIP).join(" ")).toMatch(/tap each one/);
  });
  it("refuses an all-day clip", () => {
    expect(checkSwap(twoPeople(), { ...CLIP, duration: 120 }).join(" ")).toMatch(/Trim the clip/);
    const d = twoPeople();
    d.trim = { start: 10, end: 40 };
    expect(checkSwap(d, { ...CLIP, duration: 120 })).toEqual([]);
  });
  it("counts pictures against the request limit", () => {
    const d = twoPeople();
    d.people.push({ ...blankPerson(IMG(3)), x: 0.5, y: 0.5 }, { ...blankPerson(IMG(4)), x: 0.6, y: 0.5 });
    expect(checkSwap(d, CLIP).join(" ")).toMatch(/Up to 3 people|Up to 4 pictures/);
  });
});

describe("pipeline", () => {
  it("runs every stage for a swap with a new world", () => {
    const stages = pipeline(twoPeople(), CLIP);
    expect(stages.filter((s) => s.on).map((s) => s.id)).toEqual(["mask", "swap", "plate", "composite", "finish"]);
    // 10 s = two 5 s blocks: 2×60 swap + 2×6 plate + 3 composite + 1 mask + 1 finish
    expect(totalMinutes(twoPeople(), CLIP)).toBe(120 + 12 + 3 + 1 + 1);
  });
  it("skips the swap when it's background only", () => {
    const d = blankDraft();
    d.scene.image = IMG(1);
    expect(pipeline(d, CLIP).filter((s) => s.on).map((s) => s.id)).toEqual(["plate", "composite", "finish"]);
  });
  it("speaks in hours past an hour", () => {
    expect(humanMinutes(45)).toBe("~45 min");
    expect(humanMinutes(137)).toBe("~2 h 17 min");
    expect(humanMinutes(121)).toBe("~2 h");
  });
});

describe("the brief", () => {
  it("maps each person to their picture left to right, and the background last", () => {
    const d = twoPeople();
    const pics = pictures(d);
    expect(pics.map((p) => p.src)).toEqual([IMG(1), IMG(2), IMG(9)]);
    const job = jobOf(d, CLIP);
    expect(job.people.map((p) => [p.n, p.picture, p.side])).toEqual([
      [1, 1, "on the left"],
      [2, 2, "on the right"],
    ]);
    expect(job.scene).toMatchObject({ mode: "replace", picture: 3 });
  });
  it("reads back exactly what it wrote", () => {
    const d = twoPeople();
    d.request = "swap us into Tokyo";
    const text = briefText(d, CLIP);
    expect(text).toContain("viggle-motion-swap");
    expect(text).toContain("person 1:");
    expect(text).toContain("queue_complete video: true");
    expect(parseJob(text)).toEqual(jobOf(d, CLIP));
  });
  it("titles itself from what changes", () => {
    expect(titleFor(twoPeople())).toBe("2 character swaps · a rooftop in Tokyo at night");
  });
});

describe("draftFromPrompt", () => {
  it("seeds the people, the world and the shape", () => {
    const d = draftFromPrompt("swap the dancer with my avatar, background a rainy neon street, vertical", [IMG(1)], null);
    expect(d.people).toHaveLength(1);
    expect(d.people[0].image).toBe(IMG(1));
    expect(d.scene.prompt).toBe("rainy neon street");
    expect(d.aspect).toBe("9:16");
  });
});

describe("jobMinutes", () => {
  it("agrees with the draft's estimate once filed", async () => {
    const { jobMinutes } = await import("./plan");
    const d = twoPeople();
    expect(jobMinutes(jobOf(d, CLIP))).toBe(totalMinutes(d, CLIP));
  });
});
