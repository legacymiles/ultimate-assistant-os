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
