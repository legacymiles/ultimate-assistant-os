import { describe, it, expect } from "vitest";
import { CLASSIC, cleanTheme, defaultStyleDoc, PRESETS, TALK_CUES } from "./gameStyle";
import { bidCue, isChattyHand, pickTalk, roundCues, threatCues } from "./tableTalk";
import { recapRound } from "./spades";

const talk = CLASSIC.talk;

describe("table talk", () => {
  it("happens on some hands, not every hand, the same on every screen", () => {
    let chatty = 0;
    for (let i = 0; i < 400; i++) if (isChattyHand(talk, `m:${i}`)) chatty++;
    expect(chatty).toBeGreaterThan(400 * 0.35);
    expect(chatty).toBeLessThan(400 * 0.75);
    expect(isChattyHand(talk, "m:7")).toBe(isChattyHand(talk, "m:7"));
    expect(isChattyHand({ ...talk, on: false }, "m:7")).toBe(false);
  });

  it("only lets computer players talk, with a line from the theme", () => {
    const always = { ...talk, handChance: 1, lineChance: 1 };
    const line = pickTalk(always, "h", "bid:1", [{ seat: 1, cue: "bidHigh" }, { seat: 0, cue: "bidHigh" }], [1]);
    expect(line?.seat).toBe(1);
    expect(talk.lines.bidHigh).toContain(line?.text);
    expect(pickTalk(always, "h", "bid:0", [{ seat: 0, cue: "bidHigh" }], [1])).toBeNull();
    expect(pickTalk({ ...always, lineChance: 0 }, "h", "x", [{ seat: 1, cue: "steal" }], [1])).toBeNull();
  });

  it("reacts to big bids, small bids and nil", () => {
    expect(bidCue(0, null)).toBe("bidNil");
    expect(bidCue(6, null)).toBe("bidHigh");
    expect(bidCue(4, 4)).toBe("bidHigh");
    expect(bidCue(1, null)).toBe("bidLow");
    expect(bidCue(3, 2)).toBeNull();
  });

  it("knows who set whom and whose nil broke", () => {
    const recap = recapRound(1, { 0: 5, 1: 0, 2: 3, 3: 3 }, { 0: 4, 1: 1, 2: 2, 3: 6 });
    const cues = roundCues(recap);
    expect(cues).toContainEqual({ seat: 1, cue: "setThem" });
    expect(cues).toContainEqual({ seat: 0, cue: "gotSet" });
    expect(cues).toContainEqual({ seat: 2, cue: "nilBusted" });
    expect(threatCues([{ team: 2, need: 40, onBid: false }])).toContainEqual({ seat: 0, cue: "stopThem" });
  });

  it("is in every theme, and a stored theme is repaired (never chatty on every hand)", () => {
    for (const t of PRESETS) for (const cue of TALK_CUES) expect(t.talk.lines[cue].length).toBeGreaterThan(0);
    const doc = defaultStyleDoc();
    const old = { ...doc.themes[0], talk: { on: true, handChance: 5, lines: { bidHigh: ["Mine!", 3] } } };
    const clean = cleanTheme(JSON.parse(JSON.stringify(old)))!;
    expect(clean.talk.handChance).toBeLessThan(1);
    expect(clean.talk.lines.bidHigh).toEqual(["Mine!"]);
    expect(clean.talk.lines.steal).toEqual(CLASSIC.talk.lines.steal);
    const none = cleanTheme({ ...doc.themes[0], finalHand: undefined, talk: undefined })!;
    expect(none.finalHand.text).toBe("LAST CHANCE TO STOP THEM");
  });
});
