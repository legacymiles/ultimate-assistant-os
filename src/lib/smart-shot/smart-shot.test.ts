import { describe, expect, it } from "vitest";
import { heuristicPlan } from "./plan/heuristic";
import { normalisePlan, readJson, renumber } from "./plan/schema";
import { EMPTY_MEDIA, cameraSentence, composeFullH3Prompt, composeH3Prompt, dialogueLine, orderReferences } from "./h3prompt";
import { panelsFor } from "./panels";
import { perCutSeconds, standaloneSeconds } from "./constants";
import type { Brief, Upload } from "./types";

const brief: Brief = { prompt: "A girl cycles a coastal road. A boy passes her. She looks back.", cutCount: 5, totalSec: 15, aspectRatio: "16:9", look: "live-action", quality: "medium" };
const uploads: Upload[] = [
  { id: "up1", role: "character", name: "GIRL", dataUrl: "data:image/jpeg;base64,AAA", description: "young woman, dark ponytail" },
  { id: "up2", role: "location", name: "COASTAL ROAD", dataUrl: "data:image/jpeg;base64,BBB", description: "two-lane road above the sea" },
];
let n = 0;
const id = (p: string) => `${p}${++n}`;

describe("plan normalisation", () => {
  it("coerces a messy answer into a full sheet", () => {
    const raw = readJson('Here you go:\n```json\n{"title":"Coast","characters":[{"name":"girl","look":"…","palette":["c89a5a","#3B7DD8","#12345a"]}],"environments":[{"name":"Coastal Road — Main","description":"road"}],"cuts":[{"title":"x","lensMm":"75mm","aperture":"T2.8","move":"Dolly In","framing":"CU","characterNames":["Girl"],"environmentName":"coastal road","description":"a"}]}\n```');
    const plan = normalisePlan(raw, { brief, uploads, id });
    expect(plan.characters[0].name).toBe("GIRL");
    expect(plan.characters[0].uploadId).toBe("up1"); // matched by name
    expect(plan.characters[0].palette).toEqual(["#c89a5a", "#3b7dd8", "#12345a"]);
    expect(plan.cuts).toHaveLength(5); // padded to the brief
    expect(plan.cuts[0]).toMatchObject({ title: "Cut 1", lensMm: 75, aperture: "f/2.8", move: "dolly-in", framing: "close-up" });
    expect(plan.cuts[0].characterIds).toEqual([plan.characters[0].id]);
    expect(plan.cuts[0].environmentId).toBe(plan.environments[0].id);
    expect(plan.lighting).toHaveLength(4);
    expect(plan.lensNote).toBe("ANAMORPHIC PRIME");
  });

  it("makes the cut durations add up to the film length", () => {
    const plan = normalisePlan({ cuts: [{ durationSec: 9 }, { durationSec: 9 }, { durationSec: 9 }] }, { brief: { ...brief, cutCount: 3, totalSec: 10 }, uploads, id });
    expect(plan.cuts.map((c) => c.durationSec).reduce((a, b) => a + b, 0)).toBe(10);
    expect(perCutSeconds(15, 5)).toBe(3);
    expect(standaloneSeconds(3)).toBe(4);
  });

  it("adds a character for every character upload the model forgot", () => {
    const plan = normalisePlan({ characters: [], cuts: [] }, { brief, uploads, id });
    expect(plan.characters.map((c) => c.uploadId)).toContain("up1");
    expect(plan.environments[0].uploadId).toBe("up2");
  });

  it("builds a product sheet from a product upload and points cuts at it", () => {
    const ups: Upload[] = [{ id: "up9", role: "object", name: "THE BAR", dataUrl: "data:image/jpeg;base64,CCC", description: "dark chocolate bar in gold foil" }];
    const plan = normalisePlan({ products: [{ name: "The Bar", description: "chocolate", notes: [{ label: "texture", text: "velvety" }] }], cuts: [{ productNames: ["the bar"] }] }, { brief: { ...brief, cutCount: 3 }, uploads: ups, id });
    expect(plan.products[0]).toMatchObject({ name: "THE BAR", uploadId: "up9", notes: [{ label: "TEXTURE", text: "velvety" }] });
    expect(plan.cuts[0].productIds).toEqual([plan.products[0].id]);
    expect(plan.cuts[2].productIds).toEqual([plan.products[0].id]); // padded cuts follow the hero
    expect(panelsFor(plan).some((p) => p.kind === "product")).toBe(true);
  });

  it("heuristic plan matches the brief's cut count and varies lenses", () => {
    const plan = heuristicPlan(brief, uploads, id);
    expect(plan.cuts).toHaveLength(5);
    expect(new Set(plan.cuts.map((c) => c.lensMm)).size).toBeGreaterThan(2);
    expect(plan.characters[0].name).toBe("GIRL");
    expect(plan.environments[0].name).toMatch(/COASTAL ROAD/);
    expect(panelsFor(plan).filter((p) => p.kind === "cut")).toHaveLength(5);
  });

  it("heuristic plan for a commercial has a product and no invented cast", () => {
    const plan = heuristicPlan({ ...brief, prompt: "A premium dark chocolate bar commercial on a dark wooden table, slow product reveal." }, [], id);
    expect(plan.products).toHaveLength(1);
    expect(plan.characters).toHaveLength(0);
    expect(plan.cuts[0].productIds).toEqual([plan.products[0].id]);
  });

  it("renumbers cuts after a reorder", () => {
    const plan = heuristicPlan(brief, uploads, id);
    const swapped = renumber([plan.cuts[1], plan.cuts[0], ...plan.cuts.slice(2)]);
    expect(swapped.map((c) => c.title)).toEqual(["Cut 1", "Cut 2", "Cut 3", "Cut 4", "Cut 5"]);
    expect(swapped[0].id).toBe(plan.cuts[1].id);
  });
});

describe("H3 brief", () => {
  const plan = heuristicPlan(brief, uploads, id);
  const cut = { ...plan.cuts[2], dialogue: "GIRL: Wait.", move: "push-in" as const, framing: "close-up" as const, lensMm: 100, aperture: "f/2", durationSec: 6 };
  const media = {
    ...EMPTY_MEDIA,
    characterSheets: [{ characterId: plan.characters[0].id, dataUrl: "data:image/png;base64,S" }],
    environmentPlates: [{ environmentId: plan.environments[0].id, dataUrl: "data:image/png;base64,E" }],
    cutFrame: "data:image/png;base64,F",
    sheet: "data:image/jpeg;base64,SHEET",
  };

  it("labels references in attach order: character, environment, frame", () => {
    const refs = orderReferences(plan, [cut], { ...media, sheet: undefined });
    expect(refs.map((r) => [r.label, r.source.kind])).toEqual([
      ["Subject 1", "character"],
      ["Subject 2", "environment"],
      ["Subject 3", "cut"],
    ]);
  });

  it("writes the six reference-mode sections in H3's order", () => {
    const out = composeH3Prompt(plan, cut, brief, media);
    const order = ["subject_definitions:", "summary: [reference generation]", "retention_analysis:", "detailed_description:", "overall_soundscape:", "non_diegetic_music:"];
    let last = -1;
    for (const key of order) {
      const at = out.text.indexOf(key);
      expect(at, key).toBeGreaterThan(last);
      last = at;
    }
    expect(out.text).toContain("<Subject 1> is GIRL");
    expect(out.text).toContain("Retention: fully_preserved");
    expect(out.text).toContain("[Shot 1]");
    expect(out.text).toContain("A close-up shot on a 100mm lens at f/2 frames GIRL (<Subject 1>)");
    expect(out.text).toContain("(S1) GIRL says: <d>[English] Wait.</d>");
    expect(out.text).not.toMatch(/\[Push in\]/);
    expect(out.text).not.toContain("shot plan sheet"); // a single cut never attaches the sheet
    expect(out.references).toHaveLength(3);
  });

  it("the whole film is one generation with a [Shot N] block per cut and the sheet attached", () => {
    const out = composeFullH3Prompt(plan, brief, media);
    for (let i = 1; i <= plan.cuts.length; i++) expect(out.text).toContain(`[Shot ${i}]`);
    expect(out.text).toContain("A 15-second film in 5 shots");
    expect(out.references.map((r) => r.source.kind)).toEqual(["character", "environment", "sheet"]);
    expect(out.text).toContain("<Subject 3> is the shot plan sheet");
    expect(out.text).toContain("<Subject 1> (appears in [Shot 1], [Shot 2], [Shot 3], [Shot 4], [Shot 5])");
    expect(out.text).not.toContain("storyboard frame for this shot");
    expect(out.text.indexOf("[Shot 2]")).toBeGreaterThan(out.text.indexOf("[Shot 1]"));
  });

  it("falls back to integrated_multimodal_description with no media", () => {
    const out = composeH3Prompt(plan, cut, brief, EMPTY_MEDIA);
    expect(out.text.startsWith("integrated_multimodal_description:")).toBe(true);
    expect(out.text).not.toContain("<Subject");
  });

  it("camera moves are prose with amplitude and speed", () => {
    expect(cameraSentence(cut, "GIRL")).toBe("The camera pushes in with small amplitude at slow speed toward GIRL.");
    expect(cameraSentence({ ...cut, move: "static" }, "GIRL")).toBe("The camera is locked off, perfectly still, holding on GIRL.");
    expect(cameraSentence({ ...cut, move: "rack-focus" }, "GIRL")).toContain("focus racks from the foreground to GIRL");
  });

  it("dialogue picks the speaker id from the cast", () => {
    expect(dialogueLine("GUY: Hey.", ["GIRL", "GUY"])).toBe("(S2) GUY says: <d>[English] Hey.</d>");
    expect(dialogueLine("", ["GIRL"])).toBe("");
  });

  it("never attaches more than nine images", () => {
    const many = { ...media, styles: Array.from({ length: 12 }, (_, i) => ({ name: `s${i}`, dataUrl: "data:image/png;base64,X" })) };
    expect(orderReferences(plan, [cut], many)).toHaveLength(9);
  });
});

describe("H3 brief text hygiene", () => {
  const plan = heuristicPlan(brief, uploads, id);
  plan.characters[0].look = "Around 17, slight build. Round face, dark eyes.";
  plan.characters[0].wardrobe = "Brick-red tee.";
  plan.environments[0].description = "A cracked road. Rusted rail.";
  const cut = { ...plan.cuts[0], action: "GIRL coasts into frame, then sits back." };
  const out = composeH3Prompt(plan, cut, brief, { ...EMPTY_MEDIA, characterSheets: [{ characterId: plan.characters[0].id, dataUrl: "data:image/png;base64,S" }] });
  it("never doubles punctuation when descriptions end with a full stop", () => {
    expect(out.text).not.toMatch(/\.\./);
    expect(out.text).not.toMatch(/\.,/);
  });
  it("does not prepend the actor when the action already names them", () => {
    expect(out.text).toContain("GIRL coasts into frame");
    expect(out.text).not.toContain("GIRL gIRL");
  });
});
