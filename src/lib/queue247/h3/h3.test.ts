import { describe, expect, it } from "vitest";
import type { Blueprint } from "@/lib/h3-lab/model";
import { describedLength } from "@/lib/h3-lab/lint";
import { buildTask } from "../engine";
import { keyframeTimes, parseCutLines, parseFfmpegDuration, parseProbe, parseSceneCuts, sceneDetectArgs } from "./scenes";
import { applyChanges, cleanChanges, matches, parseChangeText, NO_CHANGES } from "./changes";
import { blueprintFrom, buildRecreation, pacingOf, toStoryboard } from "./storyboard";
import { applyAxes, variations } from "./variations";
import { h3TaskInput, H3_STEPS } from "./task";
import { frameKey, ownsUpload, uploadExt, uploadKey, uploadProblem } from "./upload";

// ---- ffmpeg output, shaped like the real thing ------------------------------------------

function sceneLine(n: number, t: number, score: number): string {
  return [
    `[Parsed_metadata_2 @ 0x55d5c] frame:${n}    pts:${Math.round(t * 12800)}  pts_time:${t}`,
    `[Parsed_metadata_2 @ 0x55d5c] lavfi.scene_score=${score.toFixed(6)}`,
    `[Parsed_showinfo_3 @ 0x55d60] n:${n} pts:${Math.round(t * 12800)} pts_time:${t} duration:512 duration_time:0.04 fmt:yuv420p cl:left sar:1/1 s:320x180 i:P iskey:0 type:P checksum:2B1C6E4F plane_checksum:[1F2A 5E1B 6A0C] mean:[93 125 130]`,
  ].join("\n");
}

const BANNER = `Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'source.mp4':
  Duration: 00:00:38.20, start: 0.000000, bitrate: 2310 kb/s
  Stream #0:0[0x1](und): Video: h264 (High), yuv420p, 1920x1080, 25 fps`;

describe("scene detection", () => {
  it("reads cut times and scores from showinfo + metadata lines", () => {
    const stderr = [BANNER, sceneLine(0, 3.2, 0.61), sceneLine(1, 7.84, 0.45)].join("\n");
    expect(parseCutLines(stderr)).toEqual([
      { t: 3.2, score: 0.61 },
      { t: 7.84, score: 0.45 },
    ]);
    expect(parseFfmpegDuration(stderr)).toBeCloseTo(38.2);
  });

  it("turns cuts into shots covering the whole video", () => {
    const stderr = [sceneLine(0, 3.2, 0.61), sceneLine(1, 7.84, 0.45), sceneLine(2, 20, 0.9)].join("\n");
    const shots = parseSceneCuts(stderr, 38.2);
    expect(shots).toEqual([
      { start: 0, end: 3.2, cutStrength: 0 },
      { start: 3.2, end: 7.84, cutStrength: 0.61 },
      { start: 7.84, end: 20, cutStrength: 0.45 },
      { start: 20, end: 38.2, cutStrength: 0.9 },
    ]);
  });

  it("merges shots shorter than minShot by dropping the weaker neighbouring cut", () => {
    // 5.0 → 5.3 is a 0.3 s flash: the cut at 5.3 (0.35) is weaker than 5.0 (0.8), so it goes.
    const stderr = [sceneLine(0, 5, 0.8), sceneLine(1, 5.3, 0.35), sceneLine(2, 10, 0.5)].join("\n");
    const shots = parseSceneCuts(stderr, 12, 0.6);
    expect(shots.map((s) => [s.start, s.end])).toEqual([
      [0, 5],
      [5, 10],
      [10, 12],
    ]);
    expect(shots.every((s) => s.end - s.start >= 0.6)).toBe(true);
  });

  it("drops a too-short last shot and cuts at the very start or end", () => {
    const stderr = [sceneLine(0, 0, 0.9), sceneLine(1, 4, 0.5), sceneLine(2, 9.8, 0.7)].join("\n");
    const shots = parseSceneCuts(stderr, 10);
    expect(shots.map((s) => [s.start, s.end])).toEqual([
      [0, 4],
      [4, 10],
    ]);
  });

  it("caps at 40 shots, keeping the strongest cuts", () => {
    const lines: string[] = [];
    for (let i = 1; i < 60; i++) lines.push(sceneLine(i, i * 1.5, i % 3 === 0 ? 0.9 : 0.4));
    const shots = parseSceneCuts(lines.join("\n"), 95);
    expect(shots).toHaveLength(40);
    expect(shots[0].start).toBe(0);
    expect(shots[shots.length - 1].end).toBe(95);
    // Every 0.9 cut survived (19 of them).
    expect(shots.filter((s) => s.cutStrength === 0.9)).toHaveLength(19);
  });

  it("falls back to the banner duration and survives no cuts at all", () => {
    expect(parseSceneCuts(BANNER, 0)).toEqual([{ start: 0, end: 38.2, cutStrength: 0 }]);
    expect(parseSceneCuts("", 0)).toEqual([]);
  });

  it("picks keyframe times inside the shot, fewer for very short shots", () => {
    expect(keyframeTimes({ start: 2, end: 6 })).toEqual([2.15, 4, 5.85]);
    expect(keyframeTimes({ start: 0, end: 0.7 })).toHaveLength(2);
    expect(keyframeTimes({ start: 1, end: 1.3 })).toEqual([1.15]);
    for (const t of keyframeTimes({ start: 10, end: 11 })) expect(t > 10 && t < 11).toBe(true);
  });

  it("reads ffprobe JSON", () => {
    const json = JSON.stringify({ streams: [{ width: 1080, height: 1920, r_frame_rate: "30000/1001", avg_frame_rate: "30000/1001" }], format: { duration: "21.433" } });
    expect(parseProbe(json)).toEqual({ duration: 21.433, width: 1080, height: 1920, fps: 29.97 });
    expect(parseProbe("not json")).toEqual({ duration: 0, width: 0, height: 0, fps: 0 });
  });

  it("scans downscaled frames with the scene filter and metadata", () => {
    const args = sceneDetectArgs("/tmp/in.mp4", 600);
    expect(args.join(" ")).toContain("-t 600 -i /tmp/in.mp4");
    expect(args.join(" ")).toContain("select='gt(scene,0.32)',metadata=print,showinfo");
  });
});

// ---- a blueprint like the Lab's analysis produces --------------------------------------

function sampleBlueprint(): Blueprint {
  return {
    id: "bp-test",
    sourceName: "diner.mp4",
    durationSec: 12,
    width: 1920,
    height: 1080,
    createdAt: "2026-11-25T00:00:00.000Z",
    detection: "ffmpeg-scdet",
    engine: "ai",
    genre: "movie-scene",
    style: "Gritty 35mm film look, teal and orange grade, handheld realism",
    editingRhythm: "3 shots, average 4.0s",
    sound: "Diner hum, coffee machine hiss",
    characters: [
      { label: "Person A", description: "a tall man in a red leather jacket, short dark hair" },
      { label: "Person B", description: "a young woman in a waitress uniform with a ponytail" },
    ],
    environments: [{ label: "diner", description: "a narrow 1960s diner with a long counter and red stools" }],
    shots: [
      {
        index: 0,
        start: 0,
        end: 4,
        keyframes: ["u/t/f1-1.jpg", "u/t/f1-2.jpg", "u/t/f1-3.jpg"],
        cutStrength: 0,
        characters: ["Person A"],
        positions: "Person A sits at the counter, centre frame",
        actions: "Person A slides a coin across the counter",
        dialogue: "",
        emotion: "tense",
        camera: { angle: "medium shot, eye level", move: "push-in", amount: "small", speed: "slow" },
        lighting: "Warm tungsten practicals, deep shadows behind the counter",
        environment: "diner",
        props: "a coin, a coffee cup, smoke from a cigarette",
        transitionIn: "cut",
      },
      {
        index: 1,
        start: 4,
        end: 5,
        keyframes: ["u/t/f2-1.jpg"],
        cutStrength: 0.62,
        characters: ["Person B"],
        positions: "Person B behind the counter",
        actions: "Person B looks up sharply",
        dialogue: "We're closed.",
        emotion: "wary",
        camera: { angle: "close-up, low angle", move: "static", amount: "small", speed: "slow" },
        lighting: "Hard backlight from the window",
        environment: "diner",
        props: "",
        transitionIn: "cut",
      },
      {
        index: 2,
        start: 5,
        end: 12,
        keyframes: [],
        cutStrength: 0.48,
        characters: ["Person A", "Person B"],
        positions: "Person A on the left, Person B on the right",
        actions: "Person B pours coffee as Person A leans in",
        dialogue: "",
        emotion: "uneasy",
        camera: { angle: "wide two-shot", move: "track", amount: "medium", speed: "slow" },
        lighting: "Neon sign flicker through the window",
        environment: "diner",
        props: "coffee pot",
        transitionIn: "match cut",
      },
    ],
  };
}

describe("storyboard", () => {
  it("maps the blueprint into storyboard shots with camera, angle, colour, vfx and pacing", () => {
    const sb = toStoryboard(sampleBlueprint());
    expect(sb.shots).toHaveLength(3);
    expect(sb.totalDuration).toBe(12);
    expect(sb.grade).toContain("teal and orange grade");
    const [a, b, c] = sb.shots;
    expect(a).toMatchObject({ n: 1, duration: 4, angle: "eye level", movement: "push-in, small amplitude, slow", pacing: "slow", frames: ["u/t/f1-1.jpg", "u/t/f1-2.jpg", "u/t/f1-3.jpg"] });
    expect(a.vfx).toContain("smoke");
    expect(a.color).toContain("warm");
    expect(b).toMatchObject({ angle: "low angle", movement: "static (locked off)", pacing: "fast" });
    expect(c.transition).toBe("match cut");
    expect(c.subjects).toEqual(["Person A", "Person B"]);
  });

  it("pacing follows the measured length", () => {
    expect([pacingOf(0.8), pacingOf(2), pacingOf(6)]).toEqual(["fast", "medium", "slow"]);
  });

  it("builds a Lab blueprint from measured shots + an analysis draft", () => {
    const bp = blueprintFrom({
      id: "bp-x",
      name: "clip.mp4",
      probe: { duration: 10, width: 1080, height: 1920 },
      shots: [
        { start: 0, end: 4, cutStrength: 0 },
        { start: 4, end: 10, cutStrength: 0.5 },
      ],
      frames: [["k1"], ["k2", "k3"]],
      draft: {
        genre: "music-video",
        style: "neon",
        editingRhythm: "",
        sound: "",
        characters: [],
        environments: [],
        shots: [0, 1].map(() => ({ characters: [], positions: "", actions: "dances", dialogue: "", emotion: "", camera: { angle: "", move: "static" as const, amount: "medium" as const, speed: "medium" as const }, lighting: "", environment: "", props: "", transitionIn: "cut" })),
      },
      engine: "offline",
      now: "2026-11-25T00:00:00.000Z",
    });
    expect(bp.detection).toBe("ffmpeg-scdet");
    expect(bp.shots[1]).toMatchObject({ index: 1, start: 4, end: 10, keyframes: ["k2", "k3"], actions: "dances" });
    expect(bp.editingRhythm).toBe("2 shots, average 5.0s");
  });
});

describe("changes", () => {
  it("parses plain words into characters, outfits, locations, style and extra", () => {
    const c = parseChangeText(
      [
        "Person A -> Maya, a grey-haired fisherwoman in her sixties",
        "outfit: red leather jacket -> yellow oilskin raincoat",
        "Person B's outfit -> a black tuxedo",
        "location: diner -> a lighthouse kitchen at night",
        "style: hand-drawn anime, soft pastel grade",
        "keep it under 30 seconds",
      ].join("\n"),
    );
    expect(c.characters).toEqual([{ from: "Person A", to: "Maya, a grey-haired fisherwoman in her sixties" }]);
    expect(c.outfits).toEqual([
      { from: "red leather jacket", to: "yellow oilskin raincoat" },
      { from: "Person B", to: "a black tuxedo" },
    ]);
    expect(c.locations).toEqual([{ from: "diner", to: "a lighthouse kitchen at night" }]);
    expect(c.style).toBe("hand-drawn anime, soft pastel grade");
    expect(c.extra).toBe("keep it under 30 seconds");
  });

  it("reads unprefixed swaps by their words and verb forms", () => {
    const c = parseChangeText("replace the kitchen with a beach bar; swap the man for a robot; his jacket becomes a hoodie");
    expect(c.locations[0]).toEqual({ from: "the kitchen", to: "a beach bar" });
    expect(c.characters[0]).toEqual({ from: "the man", to: "a robot" });
    expect(c.outfits[0]).toEqual({ from: "his jacket", to: "a hoodie" });
  });

  it("cleans JSON changes and accepts a string", () => {
    expect(cleanChanges({ characters: [{ from: "A", to: "" }, { from: " B ", to: "x" }], style: 5 })).toEqual({ ...NO_CHANGES, characters: [{ from: "B", to: "x" }], style: "5" });
    expect(cleanChanges("style: noir").style).toBe("noir");
  });

  it("matches labels exactly and descriptions loosely, never Person A to Person B", () => {
    expect(matches("Person A", "Person A", "")).toBe(true);
    expect(matches("a", "Person A", "")).toBe(true);
    expect(matches("Person A", "Person B", "a young woman")).toBe(false);
    expect(matches("the man in the red jacket", "Person A", "a tall man in a red leather jacket")).toBe(true);
    expect(matches("everyone", "Person B", "")).toBe(true);
  });

  it("applies changes: new people from the owner's words, outfits, places, style", () => {
    const bp = sampleBlueprint();
    const a = applyChanges(bp, parseChangeText("Person A -> Maya, a grey-haired fisherwoman\nPerson B's outfit -> a black tuxedo\nlocation: diner -> a lighthouse kitchen\nstyle: anime\ncoffee pot -> teapot\nPerson Z -> nobody"), "2026-11-25T00:00:00.000Z");
    const maya = a.characters.find((c) => c.id === a.castMap["Person A"])!;
    expect(maya.name).toBe("Maya");
    expect(maya.face).toBe("Maya, a grey-haired fisherwoman");
    expect(maya.face).not.toContain("red leather"); // never the reference's look
    const b = a.characters.find((c) => c.id === a.castMap["Person B"])!;
    expect(b.wardrobe).toBe("a black tuxedo");
    expect(a.environments[0].description).toBe("a lighthouse kitchen");
    expect(a.blueprint.style).toBe("anime");
    expect(a.blueprint.shots[2].props).toBe("teapot");
    expect(bp.shots[2].props).toBe("coffee pot"); // input untouched
    expect(a.unmatched.join(" ")).toContain("Person Z");
  });
});

describe("recreation prompts", () => {
  it("compiles one H3 prompt per shot with the new cast and place, in the Lab's format", () => {
    const rec = buildRecreation(sampleBlueprint(), parseChangeText("Person A -> Maya, a grey-haired fisherwoman\nlocation: diner -> a lighthouse kitchen\nextra: no smoking"), "Diner — recreated", "2026-11-25T00:00:00.000Z");
    expect(rec.prompts).toHaveLength(3);
    for (const p of rec.prompts) {
      expect(p.prompt).toMatch(/^integrated_multimodal_description: \[Shot 1\]/);
      expect(p.prompt).toContain("overall_soundscape:");
      expect(p.prompt).not.toContain("Person A");
      expect(p.lint.filter((f) => f.code === "too-long")).toEqual([]);
    }
    expect(rec.prompts[0].prompt).toContain("MAYA");
    expect(rec.prompts[0].prompt).toContain("LIGHTHOUSE KITCHEN");
    expect(rec.prompts[0].prompt).toContain("no smoking");
    expect(rec.prompts[1].prompt).toContain("We're closed.");
    expect(rec.production.title).toBe("Diner — recreated");
  });
});

describe("variations", () => {
  const base = buildRecreation(sampleBlueprint(), NO_CHANGES, "t", "2026-11-25T00:00:00.000Z").prompts;

  it("gives N different prompts, each with one camera sentence and a lens in words", () => {
    for (const shot of base) {
      const vars = variations(shot.prompt, 3);
      expect(vars).toHaveLength(3);
      expect(new Set(vars.map((v) => v.prompt)).size).toBe(3);
      expect(new Set(vars.map((v) => v.axes.camera)).size).toBe(3);
      expect(new Set(vars.map((v) => v.axes.lighting)).size).toBe(3);
      expect(new Set(vars.map((v) => v.axes.lens)).size).toBe(3);
      expect(new Set(vars.map((v) => v.axes.pacing)).size).toBe(3);
      for (const v of vars) {
        expect(v.prompt).not.toBe(shot.prompt);
        expect((v.prompt.match(/The camera /g) ?? []).length).toBe(1);
        expect(v.prompt).toMatch(/Shot on an? [^.]*lens/);
        expect(v.prompt).toContain("overall_soundscape:");
        expect(v.prompt).toContain("Impeccable subject consistency");
        expect(describedLength(v.prompt)).toBeLessThan(1500);
      }
    }
  });

  it("never repeats the original camera move", () => {
    const pushIn = base[0].prompt; // shot 1 pushes in
    expect(pushIn).toContain("pushes in");
    for (const v of variations(pushIn, 6)) expect(v.axes.camera).not.toBe("slow push-in");
  });

  it("replaces the shot's lighting sentence instead of stating light twice", () => {
    const v = variations(base[0].prompt, 1)[0];
    expect(v.prompt).not.toContain("Warm tungsten practicals");
    expect(v.prompt).toContain("Low-key light");
  });

  it("is deterministic and clamps n", () => {
    expect(variations(base[0].prompt, 2)).toEqual(variations(base[0].prompt, 2));
    expect(variations(base[0].prompt, 0)).toEqual([]);
    expect(variations(base[0].prompt, 99)).toHaveLength(6);
    expect(variations("", 3)).toEqual([]);
  });

  it("re-applying axes swaps the lens instead of stacking it", () => {
    const v = variations(base[0].prompt, 1)[0];
    const again = applyAxes(v.prompt, { camera: { key: "static", label: "locked off", moving: false, text: "The camera is locked off, perfectly still" }, lighting: "Soft light.", lens: "Shot on a long lens, shallow depth of field.", pacing: "Slow." });
    expect((again.match(/Shot on an? [^.]*lens/g) ?? []).length).toBe(1);
  });
});

describe("filing a task", () => {
  it("builds a valid once task for an upload", () => {
    const input = h3TaskInput({ videoKey: "uploads/u1/abc.mp4", changeText: "Person A -> Maya", changes: "Person A -> Maya", variations: 4, fileName: "diner.mp4" });
    expect(input).toMatchObject({ executor: "h3-recreate", agent: "H3 Recreation Agent", app: "h3-experiments", kind: "once", needs: ["ffmpeg", "ai", "storage"], steps: H3_STEPS });
    expect(input.config).toMatchObject({ videoKey: "uploads/u1/abc.mp4", variations: 4, title: "diner", changes: { characters: [{ from: "Person A", to: "Maya" }] } });
    const row = buildTask(input, new Date("2026-11-25T00:00:00Z"));
    expect(row.status).toBe("queued");
    expect(row.steps).toHaveLength(7);
    expect(row.instruction).toBe("Person A -> Maya");
  });

  it("adds ytdlp + web for a link and refuses no source", () => {
    const input = h3TaskInput({ url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" });
    expect(input.needs).toEqual(["ffmpeg", "ai", "storage", "ytdlp", "web"]);
    expect(input.config).toMatchObject({ url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", variations: 3, title: "youtube.com video" });
    expect(() => h3TaskInput({})).toThrow(/Upload a video or paste a link/);
  });
});

describe("uploads", () => {
  it("accepts the five video types up to 500 MB", () => {
    expect(uploadProblem({ filename: "a.mov", type: "video/quicktime", size: 1e6 })).toBeNull();
    expect(uploadProblem({ filename: "a", type: "video/webm", size: 1e6 })).toBeNull();
    expect(uploadProblem({ filename: "a.gif", type: "image/gif", size: 1e6 })).toMatch(/MP4, MOV, WebM/);
    expect(uploadProblem({ filename: "a.mp4", size: 600 * 1024 * 1024 })).toMatch(/limit is 500 MB/);
    expect(uploadProblem({ filename: "a.mp4", size: 0 })).toMatch(/empty/);
    expect(uploadExt({ filename: "CLIP.MKV" })).toBe("mkv");
  });

  it("keys uploads under the owner and refuses anyone else's", () => {
    const key = uploadKey("user-1", "mp4", "a1b2c3");
    expect(key).toBe("uploads/user-1/a1b2c3.mp4");
    expect(ownsUpload("user-1", key)).toBe(true);
    expect(ownsUpload("user-2", key)).toBe(false);
    expect(ownsUpload("user-1", "uploads/user-1/../user-2/x.mp4")).toBe(false);
    expect(ownsUpload("user-1", "uploads/user-1/x.exe")).toBe(false);
    expect(frameKey("user-1", "task-9", 3, 2)).toBe("user-1/task-9/f3-2.jpg");
  });
});
