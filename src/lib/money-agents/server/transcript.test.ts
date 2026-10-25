import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { parseTimedText, youTubeId } = await import("./transcript");

describe("YouTube captions", () => {
  it("reads both timed-text shapes", () => {
    expect(parseTimedText('<transcript><text start="1.5" dur="2">Hello &amp;amp; welcome</text><text start="4" dur="1">it&#39;s me</text></transcript>')).toEqual([
      { start: 1.5, text: "Hello & welcome" },
      { start: 4, text: "it's me" },
    ]);
    expect(parseTimedText('<timedtext><body><p t="2500" d="900">second <s>one</s></p></body></timedtext>')).toEqual([{ start: 2.5, text: "second one" }]);
  });

  it("finds the id however the link was copied", () => {
    expect(youTubeId("https://youtu.be/dQw4w9WgXcQ?si=x")).toBe("dQw4w9WgXcQ");
    expect(youTubeId("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=30")).toBe("dQw4w9WgXcQ");
    expect(youTubeId("https://example.com/video")).toBeNull();
  });
});
