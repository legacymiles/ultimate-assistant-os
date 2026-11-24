import { describe, expect, it } from "vitest";
import {
  DEFAULT_PERFORMANCE, directionPrompt, expressionFor, leaksDirection, motionFor, sanitizeDirection, sanitizePerformance, speedFor,
} from "./performance";

describe("performance state", () => {
  it("cleans anything saved or sent", () => {
    expect(sanitizePerformance(null)).toEqual(DEFAULT_PERFORMANCE);
    const p = sanitizePerformance({ emotion: "furious", eyeContact: 40, headMotion: -3, notes: ["a", "a", " ", "b"], avoid: ["Politics"] });
    expect(p.emotion).toBe("neutral");
    expect(p.eyeContact).toBe(10);
    expect(p.headMotion).toBe(0);
    expect(p.notes).toEqual(["a", "b"]);
    expect(p.avoid).toEqual(["politics"]);
  });
  it("keeps only the newest standing notes", () => {
    const notes = Array.from({ length: 9 }, (_, i) => `note ${i}`);
    expect(sanitizePerformance({ notes }).notes).toEqual(notes.slice(-6));
  });
});

describe("the private direction block", () => {
  it("is empty when there's nothing to direct", () => {
    expect(directionPrompt(sanitizeDirection({ reactions: false }))).toBe("");
  });
  it("carries emotion, notes, one-offs, the viewer instruction and topics — and forbids mentioning any of it", () => {
    const p = directionPrompt(
      sanitizeDirection({ emotion: "sarcastic", notes: ["be a little more sarcastic"], next: ["make it funny"], instruction: "Tell them that's a ridiculous question", avoid: ["politics"] }),
    );
    expect(p).toMatch(/Never mention it/);
    expect(p).toMatch(/dry and sarcastic/);
    expect(p).toMatch(/Standing direction: be a little more sarcastic/);
    expect(p).toMatch(/For this reply only: make it funny/);
    expect(p).toMatch(/For this viewer: Tell them that's a ridiculous question/);
    expect(p).toMatch(/Stay away from: politics/);
  });
});

describe("a public line never gives the director away", () => {
  it("catches the giveaways", () => {
    expect(leaksDirection("My director says I should be nicer")).toBe(true);
    expect(leaksDirection("I've been told to ask where you're all from")).toBe(true);
    expect(leaksDirection("Per my instructions, hi Mike")).toBe(true);
  });
  it("lets ordinary lines through, movie talk included", () => {
    expect(leaksDirection("Mike, that's the most ridiculous question tonight")).toBe(false);
    expect(leaksDirection("Who's your favourite film director?")).toBe(false);
  });
});

describe("voice and face", () => {
  it("nudges speed by emotion, inside the TTS range", () => {
    expect(speedFor({ speed: 1 }, "excited")).toBe(1.06);
    expect(speedFor({ speed: 0.8 }, "calm")).toBe(0.8);
    expect(speedFor({ speed: 1.3 }, "excited")).toBe(1.3);
  });
  it("picks the face: one-off cue, then standing emotion, then the reply's mood", () => {
    expect(expressionFor("sarcastic", "happy", "surprised")).toBe("surprised");
    expect(expressionFor("sarcastic", "happy", null)).toBe("sarcastic");
    expect(expressionFor("neutral", "laughing", null)).toBe("playful");
    expect(expressionFor("neutral", null, null)).toBe("neutral");
  });
  it("turns eye contact and head movement into motion", () => {
    expect(motionFor({ headMotion: 10, eyeContact: 10 }, "neutral")).toMatchObject({ head: 1, away: 0, lean: 0 });
    expect(motionFor({ headMotion: 0, eyeContact: 0 }, "surprised")).toMatchObject({ head: 0, away: 1, lean: -1 });
    expect(motionFor({ headMotion: 5, eyeContact: 8 }, "excited").tempo).toBe(1.5);
  });
});
