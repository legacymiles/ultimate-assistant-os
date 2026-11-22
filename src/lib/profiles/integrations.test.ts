import { describe, expect, it } from "vitest";
import { outline } from "./agent";
import { applyChanges } from "./changes";
import { classifyIntake, intakeName, isNewProfileAsk } from "./intake";
import { importRecallProfiles, syncLifeRecord, withoutExamples } from "./imports";
import { offlineBrain } from "./offline";
import { libraryMediaFor, mirrorPlan, noteBody } from "./recallBridge";
import { emptyProfiles, ROOT, seedProfiles } from "./seed";
import type { Found } from "./found";
import type { LifeRecord } from "@/lib/jarvis/record/types";
import type { RecallData } from "@/lib/recall/types";

const now = "2026-11-18T12:00:00.000Z";

describe("new-profile intake", () => {
  it("tells a business from a son from a girlfriend, and asks each its own questions", () => {
    const biz = classifyIntake("create a profile for my t-shirt printing business");
    expect(biz.type).toBe("business");
    expect(biz.questions.join(" ")).toMatch(/equipment/i);
    expect(biz.questions.join(" ")).toMatch(/which email/i);
    expect(classifyIntake("make a profile for my 3d printing business").type).toBe("business");
    expect(classifyIntake("add my son's teacher").type).toBe("teacher");
    const son = classifyIntake("create a profile for my son");
    const gf = classifyIntake("create a profile for my girlfriend");
    expect(son.questions).not.toEqual(gf.questions);
    expect(classifyIntake("add my job at the gas station").type).toBe("job");
  });

  it("names the profile from the request", () => {
    expect(intakeName("create a profile for my t-shirt printing business")).toBe("T-shirt printing business");
    expect(intakeName("make a profile for my son Leo")).toBe("Leo");
    expect(intakeName("create a profile for my girlfriend")).toBe("My girlfriend");
  });

  it("knows a request for a profile from a fact", () => {
    expect(isNewProfileAsk("create a profile for my t-shirt printing business")).toBe(true);
    expect(isNewProfileAsk("add my 3d printing business")).toBe(true);
    expect(isNewProfileAsk("add my son's shoe size is 3Y")).toBe(false);
    expect(isNewProfileAsk("what is the gas code at my job")).toBe(false);
  });

  it("offline: files a business inside My Businesses, with what was found elsewhere, and asks about equipment", () => {
    const data = seedProfiles();
    const found: Found[] = [{ id: "rec:x1", source: "Folders", title: "Bambu X1 receipt", text: "Bought Mar 2026 from Micro Center, $1,199", where: "RECEIPTS" }];
    const r = offlineBrain(data, "create a profile for my 3d printing business", ROOT, "all", found);
    expect(r.actions.changes?.[0]).toMatchObject({ op: "add_node", parent: "biz", name: "3d printing business", label: "Business" });
    expect(r.actions.changes?.[1]).toMatchObject({ op: "add_item", node: "new:1", section: "Found elsewhere", k: "Bambu X1 receipt" });
    expect(r.text).toMatch(/equipment/i);
    const saved = applyChanges(data, r.actions.changes!);
    expect(saved.data.nodes.biz.children).toContain(saved.created["new:1"]);
  });

  it("offline: a teacher goes inside the school", () => {
    const r = offlineBrain(seedProfiles(), "add a profile for my son's teacher Mr. Chen", "son");
    expect(r.actions.changes?.[0]).toMatchObject({ op: "add_node", parent: "school", kind: "person" });
  });
});

describe("bringing existing profiles in", () => {
  const record: LifeRecord = {
    version: 1,
    updatedAt: now,
    fields: {
      legal_first: { value: "Jordan", updatedAt: now, source: "you" },
      ssn: { value: "123-45-6789", updatedAt: now, source: "you" },
    },
    groups: {
      jobs: [{ id: "j1", values: { title: "Shift lead", employer: "Riverside Shell" }, updatedAt: now, source: "you" }],
    },
  };

  it("syncs the Life record into a real My Profile, clears the examples, and turns jobs into job profiles", () => {
    const r = syncLifeRecord(seedProfiles(), record);
    expect(r.changed).toBeGreaterThan(0);
    expect(r.data.examples).toBe(false);
    expect(Object.values(r.data.nodes).some((n) => n.example)).toBe(false);
    const me = r.data.nodes.me;
    const rows = me.sections.flatMap((s) => s.items);
    expect(rows.find((i) => i.k === "Legal first name")?.v).toBe("Jordan");
    const ssn = rows.find((i) => i.v === "123-45-6789");
    expect(ssn?.secret && ssn?.noAi).toBe(true);
    const jobs = Object.values(r.data.nodes).find((n) => n.name === "My Jobs")!;
    expect(r.data.nodes[jobs.children[0]].name).toBe("Shift lead — Riverside Shell");
  });

  it("is idempotent, and updates a value in place when the record changes", () => {
    const first = syncLifeRecord(emptyProfiles(), record).data;
    expect(syncLifeRecord(first, record).changed).toBe(0);
    const changed = { ...record, fields: { ...record.fields, legal_first: { value: "Jordan A.", updatedAt: now, source: "you" as const } } };
    const again = syncLifeRecord(first, changed);
    const rows = again.data.nodes.me.sections.flatMap((s) => s.items).filter((i) => i.k === "Legal first name");
    expect(rows).toHaveLength(1);
    expect(rows[0].v).toBe("Jordan A.");
  });

  it("never sends a withheld value to a model", () => {
    const d = syncLifeRecord(emptyProfiles(), record).data;
    expect(outline(d)).not.toContain("123-45-6789");
    expect(outline(d)).toContain("[withheld");
  });

  it("imports each Dashboard profile once, businesses into My Businesses", () => {
    const recall: Pick<RecallData, "profiles"> = {
      profiles: [
        { id: "rp1", kind: "business", displayName: "Inkwell Tees", folderId: "f1", fields: [{ id: "a", label: "Supplier email", value: "ink.supply@gmail.com", type: "email" }], accounts: [{ id: "x", label: "Shopify", provider: "Shopify", kind: "saas", login: "orders@inkwell.co", password: "hunter2", createdAt: now, updatedAt: now }], tags: [], createdAt: now, updatedAt: now },
        { id: "rp2", kind: "person", role: "child", displayName: "Leo", folderId: "f2", fields: [], accounts: [], tags: [], createdAt: now, updatedAt: now },
      ],
    };
    const r = importRecallProfiles(emptyProfiles(), recall);
    expect(r.count).toBe(2);
    const biz = Object.values(r.data.nodes).find((n) => n.name === "Inkwell Tees")!;
    expect(r.data.nodes[Object.values(r.data.nodes).find((n) => n.name === "My Businesses")!.id].children).toContain(biz.id);
    expect(biz.recall).toMatchObject({ profileId: "rp1", folderId: "f1" });
    const pw = biz.sections.flatMap((s) => s.items).find((i) => i.v === "hunter2");
    expect(pw?.noAi).toBe(true);
    expect(importRecallProfiles(r.data, recall).count).toBe(0);
  });

  it("keeps what the owner added when the examples go", () => {
    const d = applyChanges(seedProfiles(), [{ op: "add_node", ref: "new:1", parent: "school", name: "Mr. Chen", kind: "person" }]);
    const clean = withoutExamples(d.data);
    const chen = Object.values(clean.nodes).find((n) => n.name === "Mr. Chen")!;
    expect(clean.nodes[ROOT].children).toContain(chen.id);
  });
});

describe("mirroring into the Dashboard", () => {
  const empty: RecallData = { folders: [], items: [], profiles: [] };

  it("never mirrors the examples", () => {
    expect(mirrorPlan(seedProfiles(), empty).changed).toBe(false);
  });

  it("still mirrors something real the owner put inside an example", () => {
    const d = applyChanges(seedProfiles(), [{ op: "add_node", ref: "a", parent: "biz", name: "Layer Labs", kind: "thing" }]).data;
    const plan = mirrorPlan(d, empty);
    const root = plan.recall.folders.find((f) => f.name === "Profiles")!;
    expect(plan.recall.folders.find((f) => f.name === "Layer Labs")?.parentId).toBe(root.id);
    expect(plan.recall.folders.some((f) => f.name === "My Businesses")).toBe(false);
  });

  it("gives each real profile a folder under Profiles, nested, with a note that leaves private rows out", () => {
    const d = applyChanges(emptyProfiles(), [
      { op: "add_node", ref: "new:1", parent: ROOT, name: "My Jobs", kind: "thing" },
      { op: "add_node", ref: "new:2", parent: "new:1", name: "Riverside Shell", kind: "thing" },
      { op: "add_item", node: "new:2", section: "Access", k: "Gas code", v: "4471", secret: true },
      { op: "add_item", node: "new:2", section: "Contacts", k: "Manager", v: "Dana" },
    ]).data;
    const plan = mirrorPlan(d, empty);
    expect(plan.changed).toBe(true);
    const root = plan.recall.folders.find((f) => f.name === "Profiles" && f.parentId === null)!;
    const jobs = plan.recall.folders.find((f) => f.name === "My Jobs")!;
    const shell = plan.recall.folders.find((f) => f.name === "Riverside Shell")!;
    expect(jobs.parentId).toBe(root.id);
    expect(shell.parentId).toBe(jobs.id);
    const note = plan.recall.items.find((i) => i.folderId === shell.id)!;
    expect(note.body).toContain("Manager: Dana");
    expect(note.body).not.toContain("4471");
  });

  it("moves and renames the folder when the profile moves, instead of making a second one", () => {
    let d = applyChanges(emptyProfiles(), [
      { op: "add_node", ref: "a", parent: ROOT, name: "Son", kind: "person" },
      { op: "add_node", ref: "b", parent: ROOT, name: "Ms. Lee", kind: "person" },
    ]);
    const [son, lee] = [d.created.a, d.created.b];
    const first = mirrorPlan(d.data, empty);
    const linked = { ...d.data, nodes: { ...d.data.nodes } };
    for (const [id, link] of Object.entries(first.links)) linked.nodes[id] = { ...linked.nodes[id], recall: link };
    d = applyChanges(linked, [{ op: "move_node", node: lee, parent: son }, { op: "rename_node", node: lee, name: "Ms. Lee (teacher)" }]);
    const second = mirrorPlan(d.data, first.recall);
    const folders = second.recall.folders.filter((f) => f.name.startsWith("Ms. Lee"));
    expect(folders).toHaveLength(1);
    expect(folders[0].name).toBe("Ms. Lee (teacher)");
    expect(folders[0].parentId).toBe(first.links[son].folderId);
  });

  it("puts uploaded photos in Photos › the profile (one way), and only offers library pictures for picking", () => {
    const d = applyChanges(emptyProfiles(), [
      { op: "add_node", ref: "a", parent: ROOT, name: "Leo", kind: "person" },
    ]);
    const id = d.created.a;
    d.data.nodes[id].media = [{ id: "m1", kind: "photo", src: "data:image/jpeg;base64,AAAA", caption: "Goal" }];
    const plan = mirrorPlan(d.data, empty);
    const photosRoot = plan.recall.folders.find((f) => f.role === "photos")!;
    const leoPhotos = plan.recall.folders.find((f) => f.parentId === photosRoot.id && f.name === "Leo")!;
    expect(plan.recall.items.some((i) => i.kind === "image" && i.folderId === leoPhotos.id)).toBe(true);
    expect(plan.media.m1).toBeTruthy();

    const node = { ...d.data.nodes[id], recall: plan.links[id], media: [{ ...d.data.nodes[id].media[0], recallItemId: plan.media.m1 }] };
    const extra: RecallData = {
      ...plan.recall,
      items: [...plan.recall.items, { id: "pic2", title: "Beach", body: "", summary: "", kind: "image", source: "manual", folderId: leoPhotos.id, tags: [], attachment: { name: "b", type: "image/jpeg", size: 1, url: "data:image/jpeg;base64,BBBB", category: "image" }, createdAt: now, updatedAt: now }],
    };
    // Library pictures are offered for picking, never merged into the profile.
    const back = libraryMediaFor(node, extra);
    expect(back.map((m) => m.caption)).toEqual(["Beach"]);
    expect(back.every((m) => m.fromRecall)).toBe(true);
    expect(node.media.map((m) => m.id)).toEqual(["m1"]);
  });

  it("writes nothing into the note for a profile with only private rows", () => {
    const d = applyChanges(emptyProfiles(), [
      { op: "add_node", ref: "a", parent: ROOT, name: "Vault", kind: "thing" },
      { op: "add_item", node: "a", section: "Access", k: "PIN", v: "1234", secret: true },
    ]).data;
    expect(noteBody(d.nodes[Object.keys(d.nodes).find((k) => d.nodes[k].name === "Vault")!])).toBe("");
  });
});
