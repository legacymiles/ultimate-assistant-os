import { describe, expect, it } from "vitest";

import { addRequest, approveBatch, createProject, reviewRequest, sendToJarvis } from "../client-review/logic";
import type { ClientProject } from "../client-review/types";
import { joinEdits } from "../mockup/edit";
import { clientEditProject, editMasterPrompt, editQueueText, pickedMockupLine } from "./clientEdit";

const T = "2026-11-10T04:00:00.000Z";

function approved(texts = ["make the logo bigger", "pink buttons pls"]) {
  let p: ClientProject = createProject({ name: "Glow Spa", clientName: "Dana", siteUrl: "glowspa.vercel.app", repo: "legacymiles/glow-spa-site" }, T);
  const v1 = p.versions[0].id;
  for (const text of texts) p = addRequest(p, { versionId: v1, text }, T).project;
  const sent = sendToJarvis(p, v1, T);
  p = reviewRequest(sent.project, { id: p.requests[1]?.id, adminText: "Make the primary buttons blush pink (#F4C2C2)" }, T);
  const out = approveBatch(p, { batchId: sent.batch.id, brief: "" }, T);
  return { review: out.project, batchId: sent.batch.id };
}

const pickFor = (edit: string) => ({
  lane: "polished" as const,
  label: "Polished",
  edit,
  instruction: `${edit}; then give that section a premium finish`,
  tweaks: ["make the pink a touch warmer"],
});

describe("the picked edit mockup reaches the build", () => {
  it("a pick made for these edits travels into App Builder and both briefs", () => {
    const { review, batchId } = approved();
    const edit = joinEdits(["make the logo bigger", "Make the primary buttons blush pink (#F4C2C2)"]);
    const withPick = { ...review, look: { skill: "interactive-web-studio", at: T, by: "client" as const, edit: pickFor(edit) } };
    const p = clientEditProject(withPick, batchId, new Date(T), "ab_t");
    expect(p.look?.edit?.label).toBe("Polished");
    expect(pickedMockupLine(p)).toContain('Mockup picked (Flux 2, "Polished")');
    expect(editQueueText(p)).toContain("make the pink a touch warmer");
    const master = editMasterPrompt(p);
    expect(master).toContain("<picked_mockup>");
    expect(master).toContain("390 px");
  });

  it("a pick made for OTHER edits is left behind", () => {
    const { review, batchId } = approved();
    const stale = { ...review, look: { skill: "interactive-web-studio", at: T, by: "client" as const, edit: pickFor("make the footer dark") } };
    const p = clientEditProject(stale, batchId, new Date(T), "ab_t");
    expect(p.look).toBeUndefined();
    expect(pickedMockupLine(p)).toBe("");
    expect(editMasterPrompt(p)).not.toContain("<picked_mockup>");
  });
});
