import { describe, expect, it } from "vitest";
import { NO_SPOTLIGHT, resolveSpotlight, seatsOnVideo, tapSpotlight } from "./videoSeats";

const table = [
  { seat: 0, userId: "me", isBot: false },
  { seat: 1, userId: "bot:1", isBot: true },
  { seat: 2, userId: "ana", isBot: false },
  { seat: 3, userId: "dee", isBot: false },
];

describe("seatsOnVideo", () => {
  it("maps each person on video to their seat, never bots", () => {
    const m = seatsOnVideo(table, [{ userId: "ana", camOn: true }, { userId: "bot:1", camOn: true }], { userId: "me", joined: true });
    expect([...m.entries()]).toEqual([[0, "me"], [2, "ana"]]);
  });
  it("leaves me off until I join", () => {
    const m = seatsOnVideo(table, [{ userId: "ana", camOn: true }], { userId: "me", joined: false });
    expect([...m.keys()]).toEqual([2]);
  });
});

describe("spotlight — only one enlarged at a time", () => {
  const feeds = [{ userId: "ana", camOn: false }, { userId: "dee", camOn: true }];

  it("picks someone else with their camera on before anyone else", () => {
    expect(resolveSpotlight(NO_SPOTLIGHT, ["me", "ana", "dee"], feeds, "me")).toEqual({ userId: "dee", chosen: false });
  });
  it("shows me when I'm alone on video", () => {
    expect(resolveSpotlight(NO_SPOTLIGHT, ["me"], [], "me").userId).toBe("me");
  });
  it("moves off me once someone else joins", () => {
    const s = resolveSpotlight({ userId: "me", chosen: false }, ["me", "dee"], feeds, "me");
    expect(s.userId).toBe("dee");
  });
  it("keeps a choice while that person is on video, and re-picks when they leave", () => {
    const chosen = tapSpotlight(NO_SPOTLIGHT, "ana");
    expect(resolveSpotlight(chosen, ["me", "ana", "dee"], feeds, "me")).toBe(chosen);
    expect(resolveSpotlight(chosen, ["me", "dee"], feeds, "me").userId).toBe("dee");
  });
  it("tapping the enlarged one shrinks it and it stays shrunk", () => {
    const off = tapSpotlight({ userId: "dee", chosen: true }, "dee");
    expect(off).toEqual({ userId: null, chosen: true });
    expect(resolveSpotlight(off, ["me", "dee"], feeds, "me")).toBe(off);
  });
  it("tapping another person swaps — never two enlarged", () => {
    expect(tapSpotlight({ userId: "dee", chosen: true }, "ana")).toEqual({ userId: "ana", chosen: true });
  });
  it("nobody on video means nothing enlarged", () => {
    expect(resolveSpotlight({ userId: "ana", chosen: true }, [], feeds, "me")).toBe(NO_SPOTLIGHT);
  });
});
