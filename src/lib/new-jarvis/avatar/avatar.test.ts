import { describe, expect, it } from "vitest";
import { COLOURS, actionsFromToolArgs, emotionFromText, parseAvatarCommand } from "./commands";
import { DEFAULT_LOOK, FACES, FORMS, PRESETS, clampLook, faceBetween, formRadius, norm, surfacePoint } from "./looks";
import { INITIAL_STATE, applyActions, clampPrefs, emotionAt } from "./state";
import { REST, charIndexAt, visemeForChar, visemeFromSpectrum, visemeFromText } from "./visemes";

const lookOf = (text: string) => parseAvatarCommand(text)?.actions.find((a) => a.type === "look");

describe("parseAvatarCommand — the owner's examples", () => {
  it("turns into a blue holographic wolf", () => {
    const cmd = parseAvatarCommand("Turn yourself into a blue holographic wolf.");
    expect(cmd).not.toBeNull();
    expect(lookOf("Turn yourself into a blue holographic wolf.")).toMatchObject({ patch: { form: "wolf", material: "holo", primary: COLOURS.blue } });
    expect(cmd!.reply).toMatch(/blue holographic wolf/);
  });

  it("looks happier for a moment, without changing the look", () => {
    const cmd = parseAvatarCommand("Make yourself look happier.")!;
    expect(cmd.actions).toEqual([{ type: "emotion", emotion: "happy", seconds: 12 }]);
  });

  it("changes only the eyes to glowing red", () => {
    const look = lookOf("Change your eyes to glowing red.");
    expect(look).toMatchObject({ patch: { eye: COLOURS.red, eyeGlow: 2 } });
    expect((look as { patch: Record<string, unknown> }).patch.primary).toBeUndefined();
  });

  it("becomes a futuristic robot", () => {
    expect(lookOf("Become a futuristic robot")).toMatchObject({ patch: { form: "robot", material: "metal" } });
  });

  it("gets smaller and floats", () => {
    expect(lookOf("Make yourself smaller and float")).toMatchObject({ patch: { float: 1.8 }, relative: { scale: 0.75 } });
  });
});

describe("parseAvatarCommand — leaves everything else to the chat", () => {
  it.each([
    "What's on my calendar this week?",
    "Become a better cook by reading my recipes",
    "Change the button on my website to blue",
    "Turn the lights on",
    "Make yourself a note to buy a red dress",
    "Remind yourself to email Sarah tomorrow",
    "Can you change your website's button to blue",
    "",
  ])("ignores %j", (t) => {
    expect(parseAvatarCommand(t)).toBeNull();
  });

  it("starts and stops transforming", () => {
    expect(parseAvatarCommand("keep transforming")!.actions).toEqual([{ type: "cycle", on: true }]);
    expect(parseAvatarCommand("stop morphing and stay like this")!.actions).toEqual([{ type: "cycle", on: false }]);
  });

  it("goes back to normal", () => {
    expect(parseAvatarCommand("go back to normal")!.actions).toEqual([{ type: "reset" }]);
  });

  it("does a gesture", () => {
    expect(parseAvatarCommand("give yourself a spin")!.actions).toContainEqual({ type: "gesture", gesture: "spin" });
  });
});

describe("actionsFromToolArgs", () => {
  it("checks what the model sends", () => {
    const cmd = actionsFromToolArgs({ form: "dragon", primary: "orange", eye: "#00ff00", scale: 9, material: "lava" });
    const look = cmd.actions.find((a) => a.type === "look") as { patch: Record<string, unknown> };
    expect(look.patch).toMatchObject({ form: "dragon", primary: COLOURS.orange, eye: "#00ff00", scale: 1.4 });
    expect(look.patch.material).toBeUndefined();
  });

  it("refuses a model link that is not a GLB/GLTF", () => {
    const cmd = actionsFromToolArgs({ model: "javascript:alert(1)" });
    expect(cmd.actions).toEqual([]);
  });

  it("keeps a real GLB link", () => {
    const cmd = actionsFromToolArgs({ model: "https://example.com/fox.glb" });
    expect(cmd.actions[0]).toEqual({ type: "look", patch: { model: "https://example.com/fox.glb" } });
  });
});

describe("emotionFromText", () => {
  it("reads the tone of an answer", () => {
    expect(emotionFromText("Sorry, I couldn't reach the calendar.").emotion).toBe("sad");
    expect(emotionFromText("Done — added it for Friday.").emotion).toBe("happy");
    expect(emotionFromText("Done! All set.").emotion).toBe("excited");
    expect(emotionFromText("Which one did you mean?")).toEqual({ emotion: "thinking", gesture: "tilt" });
    expect(emotionFromText("It is 4pm.").emotion).toBe("neutral");
  });
});

describe("state", () => {
  it("keeps a chosen look and stops cycling", () => {
    const s = applyActions(INITIAL_STATE, [{ type: "look", patch: { form: "robot" } }], 0);
    expect(s.prefs).toMatchObject({ custom: true, cycle: false, look: { form: "robot" } });
  });

  it("builds on what is showing while it cycles", () => {
    const dragon = PRESETS.find((p) => p.look.form === "dragon")!.look;
    const s = applyActions({ ...INITIAL_STATE, showing: dragon }, [{ type: "look", patch: { eye: "#ff0000" } }], 0);
    expect(s.prefs.look).toMatchObject({ form: "dragon", eye: "#ff0000" });
  });

  it("scales relative to the current size, within limits", () => {
    let s = INITIAL_STATE;
    for (let i = 0; i < 5; i += 1) s = applyActions(s, [{ type: "look", patch: {}, relative: { scale: 0.75 } }], 0);
    expect(s.prefs.look.scale).toBe(0.5);
  });

  it("lets an emotion expire", () => {
    const s = applyActions(INITIAL_STATE, [{ type: "emotion", emotion: "angry", seconds: 2 }], 1000);
    expect(emotionAt(s, 2000)).toBe("angry");
    expect(emotionAt(s, 3001)).toBe("neutral");
  });

  it("resets to the default and transforms again", () => {
    const s = applyActions(applyActions(INITIAL_STATE, [{ type: "look", patch: { form: "cat" } }], 0), [{ type: "reset" }], 0);
    expect(s.prefs).toMatchObject({ custom: false, cycle: true, look: DEFAULT_LOOK });
  });

  it("loads broken saved prefs safely", () => {
    expect(clampPrefs({ look: { form: "unicorn", primary: "red" }, seconds: 1 })).toMatchObject({ look: { form: "humanoid", primary: DEFAULT_LOOK.primary }, seconds: 3, cycle: true });
    expect(clampPrefs(null).look).toEqual(DEFAULT_LOOK);
  });
});

describe("looks", () => {
  it("has a face for every form and a sane radius everywhere", () => {
    expect(FACES).toHaveLength(FORMS.length);
    for (let f = 0; f < FORMS.length; f += 1) {
      for (const d of [norm([0, 0, 1]), norm([1, 0, 0]), norm([0, 1, 0]), norm([0, -1, 0]), norm([0.3, -0.5, 0.8])]) {
        const r = formRadius(f, d);
        expect(r).toBeGreaterThan(0.3);
        expect(r).toBeLessThan(2.2);
      }
    }
  });

  it("pins values the GLSL port must match", () => {
    expect(formRadius(6, norm([1, 2, 3]))).toBeCloseTo(0.9, 6);
    expect(formRadius(0, [0, 1, 0])).toBeCloseTo(1, 3);
    expect(formRadius(1, [0, 0, 1])).toBeCloseTo(0.8, 2);
  });

  it("morphs the face smoothly between forms", () => {
    const mid = faceBetween(0, 1, 0.5);
    expect(mid.eyeSize[0]).toBeCloseTo((FACES[0].eyeSize[0] + FACES[1].eyeSize[0]) / 2);
    const p = surfacePoint(0, 2, 0, FACES[0].mouth);
    expect(Math.hypot(...p)).toBeCloseTo(formRadius(0, FACES[0].mouth));
  });

  it("clamps a bad look", () => {
    expect(clampLook({ scale: 50, glow: -1, model: "https://x.com/a.glb" })).toMatchObject({ scale: 1.4, glow: 0, model: "https://x.com/a.glb" });
  });

  it("cycles through distinct presets", () => {
    expect(new Set(PRESETS.map((p) => p.look.form)).size).toBeGreaterThanOrEqual(8);
  });
});

describe("visemes", () => {
  it("rests on silence", () => {
    expect(visemeFromSpectrum(new Uint8Array(256))).toEqual(REST);
  });

  it("opens on loud low energy and spreads on strong highs", () => {
    const low = new Uint8Array(256);
    for (let i = 1; i < 11; i += 1) low[i] = 230;
    const v = visemeFromSpectrum(low);
    expect(v.open).toBeGreaterThan(0.4);
    const ee = new Uint8Array(256);
    for (let i = 1; i < 5; i += 1) ee[i] = 120;
    for (let i = 19; i < 43; i += 1) ee[i] = 220;
    expect(visemeFromSpectrum(ee).wide).toBeGreaterThan(0.5);
  });

  it("walks the text from the last word boundary", () => {
    expect(charIndexAt("hello", 0)).toBe(0);
    expect(charIndexAt("hello world", 100, { charIndex: 6, atMs: 100 })).toBe(6);
    expect(charIndexAt("hi", 10_000)).toBe(-1);
    expect(visemeFromText("oh", 0)).toEqual(visemeForChar("o"));
    expect(visemeForChar("m").open).toBe(0);
  });
});
