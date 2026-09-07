// Run with:  node --test src/lib/auteur/director/director.test.ts
// (Node 24 strips the types itself; these modules use only relative imports.)

import assert from "node:assert/strict";
import { test } from "node:test";
import { composeH3Prompt, labelReferences } from "./h3prompt";
import { heuristicBreakdown, heuristicDevelop, shotCountFor } from "./heuristic";
import { applyPatch, heuristicRetake } from "./retake";
import type { Project, Reference } from "../types";

function project(seed: Partial<Project> = {}): Project {
  return {
    id: "p1",
    title: "",
    idea: "Create a cinematic romantic short film about a couple who meet in New York.",
    templateId: "short-film",
    genreIds: ["romance"],
    aspectRatio: "16:9",
    targetDurationSec: 60,
    status: "draft",
    concept: null,
    characters: [],
    worlds: [],
    style: null,
    scenes: [],
    references: [],
    audio: null,
    notes: "",
    createdAt: "",
    updatedAt: "",
    ...seed,
  };
}

function developed(seed: Partial<Project> = {}): Project {
  const p = project(seed);
  const d = heuristicDevelop(p);
  return { ...p, title: d.title, concept: d.concept, characters: d.characters, worlds: d.worlds, style: d.style, status: "developed" };
}

test("develop reads a couple and a city out of the idea", () => {
  const d = heuristicDevelop(project());
  assert.equal(d.characters.length, 2);
  assert.ok(d.worlds.some((w) => w.name === "New York"));
  assert.ok(d.concept.structure.length >= 4);
  assert.match(d.style.palette, /gold/i);
});

test("develop keeps a named character and attaches a character reference", () => {
  const ref: Reference = {
    id: "r1", kind: "character", name: "maya.jpg", mime: "image/jpeg", mediaId: "m1",
    scope: { level: "project" }, description: "a woman in her 30s with a green raincoat", described: true, tags: [], createdAt: "",
  };
  const d = heuristicDevelop(project({ idea: "A thriller where Maya chases a thief through Tokyo", genreIds: ["thriller"], references: [ref] }));
  const maya = d.characters.find((c) => c.name === "Maya");
  assert.ok(maya);
  assert.deepEqual(maya!.referenceIds, ["r1"]);
  assert.match(maya!.description, /green raincoat/);
  assert.ok(d.worlds.some((w) => w.name === "Tokyo"));
});

test("breakdown hits the template's shot budget and writes continuity", () => {
  const p = developed();
  const scenes = heuristicBreakdown(p);
  const shots = scenes.flatMap((s) => s.shots);
  assert.equal(shots.length, shotCountFor(p));
  assert.equal(scenes.length, p.concept!.structure.length);
  assert.equal(shots[0].camera.framing, "wide");
  assert.ok(shots.slice(1).every((s) => s.continuity.length > 0));
  assert.ok(shots.every((s) => s.durationSec >= 4 && s.durationSec <= 15));
});

test("the H3 brief is a production brief, not a caption", () => {
  const p = developed();
  const scenes = heuristicBreakdown(p);
  const scene = scenes[1];
  const shot = scene.shots[0];
  const out = composeH3Prompt({ ...p, scenes }, scene, shot);
  assert.match(out.text, /^integrated_multimodal_description: \[Shot 1\]/);
  assert.match(out.text, /The camera .* amplitude at .* speed|The camera is locked off/);
  assert.match(out.text, /overall_soundscape: /);
  assert.match(out.text, /non_diegetic_music: /);
  assert.match(out.text, /Nora/);
  assert.match(out.text, /red wool coat/);
  assert.match(out.text, /No subtitles/);
  assert.equal(out.references.length, 0);
});

test("references switch the brief to the six-section reference form in send order", () => {
  const refs: Reference[] = [
    { id: "c", kind: "character", name: "nora.png", mime: "image/png", mediaId: "m1", scope: { level: "project" }, description: "woman, red coat", described: true, tags: [], createdAt: "" },
    { id: "v", kind: "video", name: "move.mp4", mime: "video/mp4", mediaId: "m2", scope: { level: "project" }, description: "slow dolly", described: true, tags: [], createdAt: "" },
    { id: "a", kind: "audio", name: "song.mp3", mime: "audio/mpeg", mediaId: "m3", scope: { level: "project" }, description: "piano ballad", described: true, tags: [], createdAt: "" },
  ];
  const p = developed({ references: refs });
  const scenes = heuristicBreakdown(p);
  const out = composeH3Prompt({ ...p, scenes }, scenes[0], scenes[0].shots[0]);
  assert.deepEqual(out.references.map((r) => r.label), ["Subject 1", "Video 1", "Audio 1"]);
  assert.match(out.text, /^subject_definitions:\n<Subject 1> is Nora/);
  assert.match(out.text, /summary: \[reference generation \+ audio reuse\]/);
  assert.match(out.text, /retention_analysis:\n<Subject 1> \(appears in \[Shot 1\]\): fully_preserved/);
  assert.match(out.text, /detailed_description: \[Shot 1\]/);
  assert.match(out.text, /Nora \(<Subject 1>\)/);
  assert.match(out.text, /Match the camera motion and pacing of <Video 1>/);
  assert.match(out.text, /non_diegetic_music: Use the referenced audio/);
});

test("shot-level references only reach their own shot", () => {
  const ref: Reference = { id: "car", kind: "object", name: "car.jpg", mime: "image/jpeg", mediaId: "m9", scope: { level: "shot", shotId: "" }, description: "a red 1967 Mustang", described: true, tags: [], createdAt: "" };
  const p = developed();
  const scenes = heuristicBreakdown(p);
  const target = scenes[0].shots[0];
  ref.scope = { level: "shot", shotId: target.id };
  const full = { ...p, scenes, references: [ref] };
  assert.match(composeH3Prompt(full, scenes[0], target).text, /Mustang/);
  assert.doesNotMatch(composeH3Prompt(full, scenes[1], scenes[1].shots[0]).text, /Mustang/);
});

test("labelReferences honours H3's limits", () => {
  const many: Reference[] = Array.from({ length: 14 }, (_, i) => ({
    id: `i${i}`, kind: "image", name: `${i}.jpg`, mime: "image/jpeg", mediaId: `m${i}`, scope: { level: "project" }, description: "x", described: true, tags: [], createdAt: "",
  }));
  assert.equal(labelReferences(many).labelled.length, 9);
});

test("dialogue becomes a lip-sync tag", () => {
  const p = developed();
  const scenes = heuristicBreakdown(p);
  const shot = { ...scenes[0].shots[0], dialogue: "Nora: Don't go." };
  const out = composeH3Prompt({ ...p, scenes }, scenes[0], shot);
  assert.match(out.text, /\(S1\) Nora says: <d>\[English\] Don't go\.<\/d>/);
});

test("retakes patch only what was asked", () => {
  const p = developed();
  const scenes = heuristicBreakdown(p);
  const shot = scenes[1].shots[0];
  const closer = heuristicRetake("Make the camera closer.", shot, p.characters);
  assert.ok(closer.camera?.framing);
  assert.notEqual(closer.camera!.framing, shot.camera.framing);
  assert.equal(closer.lighting, undefined);

  const darker = heuristicRetake("Make this scene darker", shot, p.characters);
  assert.match(darker.lighting!, /low-key/);
  assert.equal(darker.camera, undefined);

  const outfit = heuristicRetake("Change her outfit to a green silk dress. Keep everything else the same.", shot, p.characters);
  const nora = p.characters.find((c) => c.name === "Nora")!;
  assert.match(outfit.characterOverrides![nora.id], /green silk dress/);
  assert.doesNotMatch(outfit.characterOverrides![nora.id], /red wool coat/);
  assert.match(outfit.characterOverrides![nora.id], /dark curls/);

  const angry = heuristicRetake("Make him look angry", shot, p.characters);
  assert.match(angry.expression!, /angry/);

  const patched = applyPatch(shot, darker);
  assert.equal(patched.action, shot.action);
  assert.equal(patched.camera.framing, shot.camera.framing);
  assert.match(patched.lighting, /low-key/);
});
