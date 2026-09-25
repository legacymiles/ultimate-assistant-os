import { describe, expect, it } from "vitest";
import { facesFor } from "./panels";
import { cleanStoryboard, type Storyboard } from "./storyboard";

const PLATE = "data:image/jpeg;base64,PLATE";
const SHEET = "data:image/jpeg;base64,SHEET";

function board(over: Record<string, unknown> = {}): Storyboard {
  return cleanStoryboard({
    title: "T",
    world: "a cramped house",
    plate: PLATE,
    cast: [
      { id: "b", name: "BABY", look: "one year old", subject: 1 },
      { id: "m", name: "MOTHER", look: "grey-skinned", subject: null, sheet: SHEET },
    ],
    shots: [
      { title: "Cut 1", action: "MOTHER steps out as he turns", duration_sec: 5, references: [1], link: "open" },
      { title: "Cut 2", action: "he runs on", duration_sec: 5, references: [], link: "continuous" },
    ],
    ...over,
  } as unknown as Record<string, unknown>)!;
}

const uploads = [{ label: "Subject 1", dataUrl: "data:image/jpeg;base64,BABY" }];

describe("what a panel is drawn from", () => {
  // A panel drawn without the plate predicts a film that will not happen: the
  // render gets the set, so the sheet must too.
  it("attaches the set to a shot that opens cold", () => {
    expect(facesFor(board(), 0, uploads).map((f) => f.label)).toEqual(["Subject 1", "MOTHER", "THE SET"]);
  });

  // A panel has no inherited frames, so withholding its references the way the
  // RENDER does leaves it drawing strangers in a different house.
  it("still gives a continued shot the faces and the set", () => {
    const labels = facesFor(board(), 1, uploads).map((f) => f.label);
    expect(labels).toContain("Subject 1");
    expect(labels).toContain("THE SET");
  });

  it("keeps the faces when there is no plate yet", () => {
    const b = board({ plate: undefined });
    expect(facesFor(b, 0, uploads).map((f) => f.label)).toEqual(["Subject 1", "MOTHER"]);
  });

  it("never drops the set to make room for a fourth face", () => {
    const b = board({
      cast: [
        { id: "b", name: "BABY", look: "one", subject: 1 },
        { id: "m", name: "MOTHER", look: "x", subject: null, sheet: SHEET },
        { id: "f", name: "FATHER", look: "y", subject: null, sheet: SHEET },
        { id: "g", name: "GRAN", look: "z", subject: null, sheet: SHEET },
      ],
      shots: [
        { title: "Cut 1", action: "MOTHER FATHER and GRAN all step out", duration_sec: 5, references: [1], link: "open" },
      ],
    });
    const labels = facesFor(b, 0, uploads).map((f) => f.label);
    expect(labels).toHaveLength(4);
    expect(labels[3]).toBe("THE SET");
  });
});
