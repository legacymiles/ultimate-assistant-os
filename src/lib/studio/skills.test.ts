import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { answerText, cleanForm, missing } from "./forms";
import { pick } from "./render";
import { WORKFLOWS } from "./workflows";

const DIR = path.join(__dirname, "skills");

/**
 * Files in this folder that are NOT workflows.
 *
 * A workflow skill is a card the owner picks and runs as rounds. `film-plan` is
 * the doctrine underneath all of them — where each resource lands, what the
 * render gate refuses, how sound is decided — so it loads on every Studio
 * request rather than being chosen, and it has no rounds of its own to follow.
 * Anything added here must be loaded deliberately by a route, because nothing
 * else will ever read it.
 */
const DOCTRINE = new Set(["film-plan"]);

const all = readdirSync(DIR).filter((f) => f.endsWith(".md") && f !== "README.md");
const files = all.filter((f) => !DOCTRINE.has(f.replace(/\.md$/, "")));

describe("studio skill files", () => {
  it("exist for every workflow, and every file is a workflow or declared doctrine", () => {
    const ids = new Set(WORKFLOWS.map((w) => w.id));
    const have = new Set(files.map((f) => f.replace(/\.md$/, "")));
    expect([...ids].filter((id) => !have.has(id))).toEqual([]);
    expect([...have].filter((id) => !ids.has(id))).toEqual([]);
  });

  it("has a file for every declared doctrine", () => {
    const have = new Set(all.map((f) => f.replace(/\.md$/, "")));
    expect([...DOCTRINE].filter((id) => !have.has(id))).toEqual([]);
  });

  // The doctrine is prose, not rounds, so it gets its own contract: it must
  // carry the rules the board is written against, because the whole reason it
  // is loaded is that a plan written without them reaches the grade and
  // nothing else.
  it("film-plan states the rules a board is written against", () => {
    const text = readFileSync(path.join(DIR, "film-plan.md"), "utf8");
    expect(text).toMatch(/^# /);
    expect(text).toContain("studio_form");
    for (const rule of ["soundscape", "Music Video Studio", "held pose", "endsOn", "2.5 words"]) {
      expect(text).toContain(rule);
    }
    expect(text.split(/\s+/).length).toBeGreaterThan(700);
  });

  for (const f of files) {
    it(`${f} follows the contract`, () => {
      const text = readFileSync(path.join(DIR, f), "utf8");
      expect(text).toMatch(/^# /);
      expect(text).toMatch(/##\s+Round 1/i);
      expect(text).toMatch(/##\s+Round 2/i);
      expect(text).toMatch(/##\s+Round 3/i);
      expect(text).toMatch(/##\s+(Global constraints|Quality gate)/i);
      expect(text).toContain("studio_form");
      expect(text).toContain("studio_generate");
      // Only the two Studio tools; the Dreamina/other-platform tool names must not leak in.
      expect(text).not.toMatch(/generate_form_for_info_collection|dreamina_cli|multi_modal2video|text2video|image2video\b/);
      expect(text.split(/\s+/).length).toBeGreaterThan(700);
    });
  }
});

describe("studio forms", () => {
  it("cleans a model-written form", () => {
    const form = cleanForm({
      title: "Actor card",
      fields: [
        { id: "appearance", label: "Appearance", type: "text", required: true },
        { id: "version", label: "Version", type: "choice", options: ["A", "B"] },
        { id: "bad", label: "No options", type: "multi" },
        { id: "x", label: "", type: "text" },
        { id: "photo", label: "Photo", type: "image", required: true },
      ],
    })!;
    expect(form.fields.map((f) => `${f.id}:${f.type}`)).toEqual([
      "appearance:text",
      "version:choice",
      "bad:text",
      "photo:image",
    ]);
    expect(cleanForm({ title: "x", fields: [] })).toBeNull();
    expect(missing(form, { appearance: "" }, {})).toEqual(["Appearance", "Photo"]);
    expect(answerText(form, { appearance: "lead", version: "B", bad: "" }, { photo: 2 })).toBe(
      "[Form: Actor card]\nAppearance: lead\nVersion: B\nNo options: (left blank)\nPhoto: 2 images attached",
    );
  });
});

describe("studio render references", () => {
  const refs = ["d1", "d2", "d3", "d4", "d5"];
  it("keeps conversation-wide Subject numbers", () => {
    expect(pick({ title: "", prompt: "Subject 3 walks in", useReferences: true }, refs)).toEqual([
      { label: "Subject 3", dataUrl: "d3" },
    ]);
    expect(pick({ title: "", prompt: "x", useReferences: true, references: [2, 5] }, refs).map((r) => r.label)).toEqual([
      "Subject 2",
      "Subject 5",
    ]);
    expect(pick({ title: "", prompt: "no names", useReferences: true }, refs)).toHaveLength(4);
    expect(pick({ title: "", prompt: "Subject 1", useReferences: false }, refs)).toEqual([]);
  });
});
