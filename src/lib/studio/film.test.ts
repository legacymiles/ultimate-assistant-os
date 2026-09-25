import { describe, expect, it } from "vitest";
import { filmPayload } from "./film";
import { cleanStoryboard, type Storyboard } from "./storyboard";

const board = (): Storyboard =>
  cleanStoryboard({
    title: "Mud",
    aspect_ratio: "9:16",
    wardrobe: "soaked olive tank top",
    cast: [
      { id: "f", name: "FATHER", look: "shaved head", subject: 1 },
      { id: "b", name: "BABY", look: "three months old", subject: 2 },
    ],
    shots: [
      { title: "Cut 1", action: "he wades", duration_sec: 5, references: [1, 2], link: "cut" },
      { title: "Cut 2", action: "she wakes", duration_sec: 6, references: [1], link: "continuous" },
      { title: "Cut 3", action: "he looks back", duration_sec: 7, references: [2], link: "cut" },
    ],
  })!;

const subjects = ["data:image/jpeg;base64,AAA", "data:image/jpeg;base64,BBB"];

describe("filmPayload", () => {
  it("sends one shot per cut, in order, with the woven prompt", () => {
    const p = filmPayload({ board: board(), subjects, characters: [] });
    const shots = p.shots as { title: string; prompt: string; link: string }[];
    expect(shots.map((s) => s.title)).toEqual(["Cut 1", "Cut 2", "Cut 3"]);
    expect(shots[0].prompt).toContain("subject_definitions:");
    expect(shots[1].prompt).toContain("integrated_multimodal_description:");
    expect(p.aspectRatio).toBe("9:16");
  });

  it("attaches the photos a cut names, labelled with who they are", () => {
    const shots = filmPayload({ board: board(), subjects, characters: [] }).shots as {
      refs: { label: string; dataUrl: string }[];
    }[];
    expect(shots[0].refs).toEqual([
      { label: "FATHER", dataUrl: subjects[0] },
      { label: "BABY", dataUrl: subjects[1] },
    ]);
    expect(shots[2].refs).toEqual([{ label: "BABY", dataUrl: subjects[1] }]);
  });

  it("attaches nothing to a chained shot — the frame it opens on is the person", () => {
    const shots = filmPayload({ board: board(), subjects, characters: [] }).shots as { refs: unknown[] }[];
    expect(shots[1].refs).toEqual([]);
  });

  it("falls back to the photo library when a cut named no upload", () => {
    const b = board();
    b.shots[0].references = [];
    const shots = filmPayload({
      board: b,
      subjects,
      characters: [{ token: "brandy", name: "Brandy", images: ["data:image/jpeg;base64,CCC"] }],
    }).shots as { refs: { label: string }[] }[];
    expect(shots[0].refs).toEqual([{ label: "Brandy", dataUrl: "data:image/jpeg;base64,CCC" }]);
  });

  it("skips a reference number nothing was ever uploaded for", () => {
    const b = board();
    const shots = filmPayload({ board: b, subjects: [subjects[0]], characters: [] }).shots as { refs: unknown[] }[];
    expect(shots[0].refs).toHaveLength(1);
  });

  it("carries the owner's track only when there is one", () => {
    expect(filmPayload({ board: board(), subjects, characters: [] }).soundtrack).toBeUndefined();
    expect(
      filmPayload({ board: board(), subjects, characters: [], soundtrack: "data:audio/mpeg;base64,DDD" }).soundtrack,
    ).toBe("data:audio/mpeg;base64,DDD");
  });
});

// The defect behind two unusable films: a cast the film invented had no
// picture at all, so every cut re-imagined the face from the words.
describe("a cast the film invented", () => {
  const SHEET = "data:image/jpeg;base64,SHEET";
  const invented = (sheet?: string): Storyboard =>
    cleanStoryboard({
      title: "The clearing",
      wardrobe: "olive work coat",
      cast: [{ id: "c1", name: "WALKER", look: "late 30s, lean", subject: null, ...(sheet ? { sheet } : {}) }],
      shots: [
        { title: "Cut 1", action: "he stops", duration_sec: 5, references: [], link: "open" },
        { title: "Cut 2", action: "he runs", duration_sec: 5, references: [], link: "continuous" },
        { title: "Cut 3", action: "he turns", duration_sec: 5, references: [], link: "cut" },
      ],
    })!;

  const refsOf = (b: Storyboard) =>
    (filmPayload({ board: b, subjects: [], characters: [] }).shots as { refs: unknown[] }[]).map((s) => s.refs.length);

  it("goes out with no picture on any shot when nothing was drawn", () => {
    expect(refsOf(invented())).toEqual([0, 0, 0]);
  });

  it("attaches the drawn sheet to every shot that is not chained", () => {
    // Shot 2 is continuous: it opens on real frames of shot 1, and a picture on
    // top of that is a second answer to the same question.
    expect(refsOf(invented(SHEET))).toEqual([1, 0, 1]);
  });

  it("attaches the sheet itself, labelled with the character's name", () => {
    const shots = filmPayload({ board: invented(SHEET), subjects: [], characters: [] }).shots as {
      refs: { label: string; dataUrl: string }[];
      prompt: string;
    }[];
    expect(shots[0].refs[0]).toEqual({ label: "WALKER", dataUrl: SHEET });
    // ...and the prompt names the picture that is really going with it.
    expect(shots[0].prompt).toContain("WALKER");
  });

  it("prefers a real upload over a drawn sheet — never both", () => {
    const board = cleanStoryboard({
      title: "T",
      cast: [{ id: "c1", name: "WALKER", look: "lean", subject: 1, sheet: SHEET }],
      shots: [{ title: "Cut 1", action: "he stops", duration_sec: 5, references: [1], link: "open" }],
    })!;
    const refs = (filmPayload({ board, subjects: ["data:image/jpeg;base64,REAL"], characters: [] }).shots as {
      refs: { dataUrl: string }[];
    }[])[0].refs;
    expect(refs).toHaveLength(1);
    expect(refs[0].dataUrl).toBe("data:image/jpeg;base64,REAL");
  });
});

// The case this film actually is: one face photographed, the rest invented.
// Stopping at the first picture found anchors the baby and abandons everyone
// else — which is the same drift, just harder to see.
describe("a mixed cast", () => {
  const SHEET = "data:image/jpeg;base64,MOTHERSHEET";
  const mixed = (action: string): Storyboard =>
    cleanStoryboard({
      title: "Milk",
      cast: [
        { id: "b", name: "BABY", look: "one year old", subject: 1 },
        { id: "m", name: "MOTHER", look: "grey-skinned, jaw slack", subject: null, sheet: SHEET },
      ],
      shots: [{ title: "Cut 1", action, duration_sec: 5, references: [1], link: "open" }],
    })!;

  const refs = (b: Storyboard) =>
    (filmPayload({ board: b, subjects: ["data:image/jpeg;base64,BABY"], characters: [] }).shots as {
      refs: { label: string }[];
    }[])[0].refs.map((r) => r.label);

  it("attaches the invented sheet alongside the upload when the shot names her", () => {
    expect(refs(mixed("The baby drops the bottle as MOTHER steps into the doorway."))).toEqual(["BABY", "MOTHER"]);
  });

  it("leaves her out of a shot that does not name her", () => {
    expect(refs(mixed("The baby drops the bottle and turns toward the hallway."))).toEqual(["BABY"]);
  });

  it("matches the name whatever case the action is written in", () => {
    expect(refs(mixed("The baby drops the bottle as his mother steps into the doorway."))).toEqual(["BABY", "MOTHER"]);
  });

  it("does not match a name that is only part of a longer word", () => {
    expect(refs(mixed("The baby drops the bottle and the mothership hums overhead."))).toEqual(["BABY"]);
  });
});
