import { describe, expect, it } from "vitest";
import { parseReply, systemPrompt } from "./agent";
import { applyChanges, describeChanges, sanitizeChanges } from "./changes";
import { offlineBrain } from "./offline";
import { seedProfiles } from "./seed";
import { findItem, mediaUnder, nextDate, parentOf, search, whereLabel } from "./tree";

const data = seedProfiles();

describe("search", () => {
  it("finds the supplier email for the printing business", () => {
    const top = search(data, "What email do I use for my printing suppliers?")[0];
    expect(top.type).toBe("item");
    if (top.type === "item") expect(top.item.v).toBe("northside.supply@gmail.com");
  });

  it("finds the gas code at work", () => {
    const top = search(data, "What is the gas code at my job?")[0];
    expect(top.type === "item" && top.item.k).toBe("Gas code");
  });

  it("finds the heat press DTF setting four levels down", () => {
    const top = search(data, "What are my heat press settings for DTF?")[0];
    expect(top.type === "item" && top.item.k).toBe("DTF transfers");
  });

  it("can be narrowed to one profile", () => {
    const hits = search(data, "email", "son");
    expect(hits.every((h) => whereLabel(data, h.node.id).startsWith("MY SON"))).toBe(true);
  });

  it("never searches a hidden profile", () => {
    const hidden = structuredClone(data);
    hidden.nodes.shell.hidden = true;
    const hits = search(hidden, "gas code");
    expect(hits.some((h) => h.node.id === "shell")).toBe(false);
  });
});

describe("the tree", () => {
  it("knows each profile's home and path", () => {
    expect(parentOf(data, "heatpress")).toBe("equipment");
    expect(whereLabel(data, "heatpress")).toBe("MY BUSINESSES › NORTHSIDE PRINTS › EQUIPMENT › HEAT PRESS");
  });

  it("collects photos from everything inside a profile", () => {
    const own = data.nodes.son.media.length;
    expect(mediaUnder(data, "son").length).toBeGreaterThan(own);
  });

  it("finds the next date on or after today", () => {
    expect(nextDate(data, "son", "2026-11-18")?.item.k).toBe("Dentist");
    expect(nextDate(data, "son", "2026-12-05")?.item.k).toBe("Winter break starts");
  });
});

describe("changes", () => {
  it("creates a profile and files rows into it by ref, then undoes all of it", () => {
    const set = [
      { op: "add_node" as const, ref: "new:1", parent: "school", name: "Mr. Chen", kind: "person" as const, label: "Teacher" },
      { op: "add_item" as const, node: "new:1", section: "Contact", k: "Email", v: "chen@lincoln-elem.org" },
    ];
    const r = applyChanges(data, set);
    expect(r.skipped).toEqual([]);
    const id = r.created["new:1"];
    expect(r.data.nodes.school.children).toContain(id);
    expect(r.data.nodes[id].initials).toBe("MC");
    expect(r.data.nodes[id].sections[0].items[0].v).toBe("chen@lincoln-elem.org");
    const back = applyChanges(r.data, r.undo);
    expect(back.data.nodes[id]).toBeUndefined();
    expect(back.data.nodes.school.children).toEqual(data.nodes.school.children);
  });

  it("moves a profile and moves it back", () => {
    const r = applyChanges(data, [{ op: "move_node", node: "teacher", parent: "school" }]);
    expect(parentOf(r.data, "teacher")).toBe("school");
    expect(parentOf(applyChanges(r.data, r.undo).data, "teacher")).toBe("son");
  });

  it("refuses to move a profile inside itself", () => {
    const r = applyChanges(data, [{ op: "move_node", node: "prints", parent: "heatpress" }]);
    expect(r.skipped.length).toBe(1);
    expect(parentOf(r.data, "prints")).toBe("biz");
  });

  it("changes a value and restores it", () => {
    const gas = data.nodes.shell.sections[0].items[0];
    const r = applyChanges(data, [{ op: "set_item", item: gas.id, v: "5520" }]);
    expect(findItem(r.data, gas.id)?.item.v).toBe("5520");
    expect(findItem(applyChanges(r.data, r.undo).data, gas.id)?.item.v).toBe("4471");
  });

  it("removes the last row of a section along with the section, and puts both back", () => {
    const cleat = data.nodes.soccer.sections.find((s) => s.title === "Gear")!.items[0];
    const r = applyChanges(data, [{ op: "remove_item", item: cleat.id }]);
    expect(r.data.nodes.soccer.sections.some((s) => s.title === "Gear")).toBe(false);
    const back = applyChanges(r.data, r.undo).data;
    expect(back.nodes.soccer.sections.find((s) => s.title === "Gear")?.items[0].v).toBe(cleat.v);
  });

  it("skips ids a model invented instead of guessing", () => {
    const r = applyChanges(data, [{ op: "add_item", node: "nope", section: "Notes", k: "x", v: "y" }]);
    expect(r.skipped.length).toBe(1);
    expect(r.data).toEqual(data);
  });

  it("does not let a brain send internal ops", () => {
    expect(sanitizeChanges([{ op: "delete_node", node: "son" }, { op: "forget", id: "x" }, { op: "archive_node", node: "son" }])).toEqual([{ op: "archive_node", node: "son" }]);
  });

  it("describes a change set before it is saved", () => {
    const lines = describeChanges(data, [
      { op: "add_node", ref: "new:1", parent: "school", name: "Mr. Chen", kind: "person" },
      { op: "add_item", node: "new:1", section: "Contact", k: "Email", v: "x@y.z" },
    ]);
    expect(lines[0].where).toBe("MY SON › SCHOOL");
    expect(lines[1].where).toBe("› MR. CHEN");
  });
});

describe("the agent protocol", () => {
  it("puts the whole outline and the page in the prompt", () => {
    const p = systemPrompt(data, "son");
    expect(p).toContain("#heatpress");
    expect(p).toContain("looking at: My Son");
  });

  it("splits words from the actions block", () => {
    const raw = 'Got it, I\'ll add her.\n\n```profiles-actions\n{"changes":[{"op":"add_node","parent":"#school","name":"Ms. Lee","ref":"new:1"}],"chips":["Add a phone","Skip"],"sources":["@x"]}\n```';
    const r = parseReply(raw);
    expect(r.text).toBe("Got it, I'll add her.");
    expect(r.actions.changes?.[0]).toMatchObject({ op: "add_node", parent: "school" });
    expect(r.actions.chips).toEqual(["Add a phone", "Skip"]);
    expect(r.actions.sources).toEqual(["x"]);
  });

  it("keeps the words when the block is broken", () => {
    const r = parseReply("Here you go.\n```profiles-actions\n{not json\n```");
    expect(r.text).toBe("Here you go.");
    expect(r.actions).toEqual({});
  });
});

describe("the offline brain", () => {
  it("answers the supplier email with its source", () => {
    const r = offlineBrain(data, "What email do I use for my printing suppliers?", "root");
    expect(r.text).toContain("northside.supply@gmail.com");
    expect(r.actions.sources?.length).toBeGreaterThan(0);
  });

  it("keeps a code hidden in the words while masking is on", () => {
    const r = offlineBrain(data, "What is the gas code at my job?", "root");
    expect(r.text).not.toContain("4471");
  });

  it("proposes the teacher move", () => {
    const r = offlineBrain(data, "Move my son's teacher profile into his school folder", "son");
    expect(r.actions.changes).toEqual([{ op: "move_node", node: "teacher", parent: "school" }]);
  });

  it("shows photos of my son", () => {
    expect(offlineBrain(data, "Show me pictures of my son", "root").actions.media).toBe("son");
  });

  it("turns 'remember' into a change of an existing row", () => {
    const r = offlineBrain(data, "Remember Leo's shoe size is 3Y", "root");
    expect(r.actions.changes?.[0]).toMatchObject({ op: "set_item", v: "3Y" });
  });

  it("files a new fact about someone as a new row", () => {
    const r = offlineBrain(data, "Remember Maya's favorite color is green", "root");
    expect(r.actions.changes?.[0]).toMatchObject({ op: "add_item", node: "gf", k: "Favorite color", v: "green" });
  });

  it("changes the gas code", () => {
    const r = offlineBrain(data, "Change the gas code to 5520", "root");
    expect(r.actions.changes?.[0]).toMatchObject({ op: "set_item", v: "5520" });
  });
});
