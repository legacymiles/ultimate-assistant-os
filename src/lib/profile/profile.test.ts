import { describe, expect, it } from "vitest";
import {
  applyDrafts, birthdays, buildQueue, childrenOf, chainTo, confirmField, descendants,
  emptyStore, ensurePath, looksLikeQuestion, newField, pathOf, removeNode, roots,
  search, seedNodes, spawn, undoWrite,
} from "./model";
import { buildMap, isSecret, redactForAi } from "./redact";
import { aboutLines, heuristicAbout } from "./about";
import { suggestPacks } from "./packs";
import type { ProfileStore } from "./types";

function seeded(): ProfileStore {
  return { ...emptyStore(), nodes: seedNodes(), basics: { ...emptyStore().basics, name: "Sam" } };
}

describe("the seeded tree", () => {
  it("creates the seven root tiles", () => {
    const n = seedNodes();
    expect(roots(n).map((r) => r.name)).toEqual([
      "Me", "People", "Money", "Work", "Business", "Home", "Legal & Docs",
    ]);
  });

  it("gives a packed node the pack's fields and children", () => {
    const made = spawn("Acme", null, "job");
    const job = made[0];
    expect(job.pack).toBe("job");
    expect(job.fields.map((f) => f.label)).toContain("Door code");
    expect(made.slice(1).map((n) => n.name).sort()).toEqual(["Pay stubs", "Reviews"]);
  });

  it("spawns the business sub-tree the owner described", () => {
    const made = spawn("Honey DTF", null, "business");
    const kids = made.slice(1).map((n) => n.name);
    expect(kids).toEqual(
      expect.arrayContaining(["Website & Domains", "Email & Logins", "Equipment", "Vendors", "Clients", "Taxes"]),
    );
  });
});

describe("paths and deletion", () => {
  it("builds a breadcrumb and survives a cyclic parent pointer", () => {
    let nodes = seedNodes();
    const work = roots(nodes).find((r) => r.name === "Work")!;
    const made = spawn("Acme", work.id, "job");
    nodes = [...nodes, ...made];
    expect(pathOf(nodes, made[0].id)).toBe("Work › Acme");

    // A corrupted store must not hang the render.
    const cyclic = nodes.map((n) => (n.id === work.id ? { ...n, parentId: made[0].id } : n));
    expect(() => chainTo(cyclic, made[0].id)).not.toThrow();
  });

  it("deleting a folder takes its descendants with it", () => {
    let nodes = seedNodes();
    const work = roots(nodes).find((r) => r.name === "Work")!;
    nodes = [...nodes, ...spawn("Acme", work.id, "job")];
    const before = nodes.length;
    expect(descendants(nodes, work.id).length).toBeGreaterThan(5);
    const after = removeNode(nodes, work.id);
    expect(after.length).toBeLessThan(before);
    expect(after.some((n) => n.name === "Pay stubs")).toBe(false);
  });
});

describe("ensurePath", () => {
  it("adopts a pack onto a seeded folder instead of creating a twin", () => {
    const store = seeded();
    const { nodes, id } = ensurePath(store.nodes, ["Work", "Current Job"], "job");
    const work = roots(nodes).find((r) => r.name === "Work")!;
    // One "Current Job", not two.
    expect(childrenOf(nodes, work.id).filter((c) => c.name === "Current Job")).toHaveLength(1);
    expect(nodes.find((n) => n.id === id)!.pack).toBe("job");
  });

  it("creates missing parents as plain folders and packs only the leaf", () => {
    const store = seeded();
    const { nodes, id } = ensurePath(store.nodes, ["Business", "Honey DTF", "Equipment", "DTF printer"], "equipment");
    expect(pathOf(nodes, id)).toBe("Business › Honey DTF › Equipment › DTF printer");
    expect(nodes.find((n) => n.id === id)!.pack).toBe("equipment");
    expect(nodes.find((n) => n.name === "Honey DTF")!.pack).toBe("");
  });
});

describe("applyDrafts", () => {
  it("writes AI values as unconfirmed, records a mark, and undoes cleanly", () => {
    const store = seeded();
    const { store: next, marks } = applyDrafts(store, [
      {
        path: ["Business", "Honey DTF", "Equipment", "DTF printer"],
        pack: "equipment",
        fields: [{ label: "Make & model", value: "Epson F2270" }],
      },
    ]);
    const printer = next.nodes.find((n) => n.name === "DTF printer")!;
    const made = printer.fields.find((f) => f.label === "Make & model")!;
    expect(made.value).toBe("Epson F2270");
    expect(made.source).toBe("ai");
    expect(made.confirmed).toBe(false);
    expect(marks).toHaveLength(1);
    expect(marks[0].where).toContain("DTF printer · Make & model");

    const undone = undoWrite(next, marks[0].id);
    const after = undone.nodes.find((n) => n.name === "DTF printer")!;
    expect(after.fields.find((f) => f.label === "Make & model")!.value).toBe("");
  });

  it("skips a draft value identical to what is already there", () => {
    let store = seeded();
    store = applyDrafts(store, [{ path: ["Home", "Property"], pack: "property", fields: [{ label: "Address", value: "12 Main St" }] }]).store;
    const second = applyDrafts(store, [{ path: ["Home", "Property"], pack: "property", fields: [{ label: "Address", value: "12 Main St" }] }]);
    expect(second.marks).toHaveLength(0);
  });
});

describe("the confirm queue", () => {
  it("asks about two birthdays, a lapsed date, and an unconfirmed AI write", () => {
    let store = seeded();
    const people = roots(store.nodes).find((r) => r.name === "People")!;
    store = {
      ...store,
      nodes: [
        ...store.nodes,
        { ...spawn("Maya", people.id, "person")[0], fields: [newField("Birthday", "date", "1990-06-03", "you")] },
        { ...spawn("Maya (work)", people.id, "person")[0], fields: [newField("Birthday", "date", "1991-07-04", "you")] },
      ],
    };
    store = applyDrafts(store, [{ path: ["Money", "Cards", "Visa"], pack: "card", fields: [{ label: "Expires", value: "2020-01-01" }] }]).store;

    const q = buildQueue(store.nodes, new Date("2026-10-30"));
    expect(q[0].kind).toBe("conflict");
    expect(q[0].options).toEqual(expect.arrayContaining(["1990-06-03", "1991-07-04"]));
    expect(q.some((i) => i.kind === "stale")).toBe(true);
    expect(q.some((i) => i.kind === "unconfirmed")).toBe(true);
  });

  it("does not invent a conflict for labels that legitimately repeat", () => {
    let store = seeded();
    const work = roots(store.nodes).find((r) => r.name === "Work")!;
    store = {
      ...store,
      nodes: [
        ...store.nodes,
        { ...spawn("Acme", work.id, "job")[0], fields: [newField("Employer", "text", "Acme", "you")] },
        { ...spawn("Globex", work.id, "job")[0], fields: [newField("Employer", "text", "Globex", "you")] },
      ],
    };
    expect(buildQueue(store.nodes).some((i) => i.kind === "conflict")).toBe(false);
  });

  it("confirming a field removes it from the queue", () => {
    let store = seeded();
    store = applyDrafts(store, [{ path: ["Home", "Property"], pack: "property", fields: [{ label: "Payment", value: "1800" }] }]).store;
    const node = store.nodes.find((n) => n.name === "Property")!;
    const field = node.fields.find((f) => f.label === "Payment")!;
    expect(buildQueue(store.nodes).some((i) => i.fieldId === field.id)).toBe(true);
    store = confirmField(store, node.id, field.id);
    expect(buildQueue(store.nodes).some((i) => i.fieldId === field.id)).toBe(false);
  });
});

describe("search", () => {
  it("finds a node by a field VALUE, not just its name", () => {
    let store = seeded();
    store = applyDrafts(store, [{ path: ["Home", "Vehicles", "The van"], pack: "vehicle", fields: [{ label: "Plate", value: "XYZ-421" }] }]).store;
    const hits = search(store.nodes, "xyz-421");
    expect(hits[0].node.name).toBe("The van");
    expect(hits[0].path).toBe("Home › Vehicles › The van");
  });

  it("never matches on a secret value", () => {
    let store = seeded();
    store = applyDrafts(store, [{ path: ["Work", "Current Job"], pack: "job", fields: [{ label: "Door code", value: "907741" }] }]).store;
    expect(search(store.nodes, "907741")).toHaveLength(0);
    // The label is still findable — you can navigate to it, you just cannot grep it out.
    expect(search(store.nodes, "door code").length).toBeGreaterThan(0);
  });

  it("tells a question from a filter word", () => {
    expect(looksLikeQuestion("when is maya's birthday?")).toBe(true);
    expect(looksLikeQuestion("what do i pay for internet")).toBe(true);
    expect(looksLikeQuestion("printer")).toBe(false);
  });
});

describe("redaction", () => {
  it("never lets a secret value into the AI text", () => {
    let store = seeded();
    store = applyDrafts(store, [
      { path: ["Work", "Current Job"], pack: "job", fields: [{ label: "Door code", value: "907741" }, { label: "Employer", value: "Acme" }] },
      { path: ["Money", "Cards", "Visa"], pack: "card", fields: [{ label: "Full number", value: "4111111111111111" }] },
      // A credential typed into a plain text row is still a credential.
      { path: ["Me", "Identity & Documents", "Email"], pack: "", fields: [{ label: "Password", kind: "text", value: "hunter2" }] },
    ]).store;

    const text = redactForAi(store.nodes, store.basics);
    expect(text).not.toContain("907741");
    expect(text).not.toContain("4111111111111111");
    expect(text).not.toContain("hunter2");
    // The fact still has to be visible, or the model will claim it does not exist.
    expect(text).toContain("[held in vault]");
    expect(text).toContain("Acme");
  });

  it("flags credential-shaped labels whatever their kind", () => {
    expect(isSecret("Alarm code", "text")).toBe(true);
    expect(isSecret("Routing / BSB", "text")).toBe(true);
    expect(isSecret("Employer", "text")).toBe(false);
  });

  it("drops empty branches for the briefing, keeping the filled path whole", () => {
    let store = seeded();
    store = applyDrafts(store, [{ path: ["Work", "Current Job"], pack: "job", fields: [{ label: "Employer", value: "Acme Signs" }] }]).store;
    const brief = redactForAi(store.nodes, store.basics, { onlyFilled: true });

    // The parent of a filled node survives even though it holds no values itself.
    expect(brief).toContain("Work");
    expect(brief).toContain("Acme Signs");
    // Everything with nothing in it is gone, so the model cannot write
    // "Health folder is on file" into a briefing read on every turn.
    expect(brief).not.toContain("Health");
    expect(brief).not.toContain("Subscriptions");
    // The full read still shows the whole tree.
    expect(redactForAi(store.nodes, store.basics)).toContain("Health");
  });

  it("caps its output so a huge tree cannot blow the context window", () => {
    const store = seeded();
    expect(redactForAi(store.nodes, store.basics, { maxChars: 200 }).length).toBeLessThanOrEqual(220);
  });

  it("builds a Map of structure and rules, with no values in it", () => {
    let store = seeded();
    store = applyDrafts(store, [{ path: ["Work", "Current Job"], pack: "job", fields: [{ label: "Door code", value: "907741" }] }]).store;
    const map = buildMap(store.nodes, store.basics);
    expect(map).toContain("## Where things live");
    expect(map).toContain("Secrets never enter chat");
    expect(map).not.toContain("907741");
    expect(map).toContain("Current Job · Door code");
  });
});

describe("birthdays", () => {
  it("orders by the next occurrence, ignoring the year", () => {
    let store = seeded();
    const people = roots(store.nodes).find((r) => r.name === "People")!;
    store = {
      ...store,
      nodes: [
        ...store.nodes,
        { ...spawn("Early", people.id, "person")[0], fields: [newField("Birthday", "date", "1990-11-02", "you")] },
        { ...spawn("Later", people.id, "person")[0], fields: [newField("Birthday", "date", "1988-12-25", "you")] },
      ],
    };
    const list = birthdays(store.nodes, new Date("2026-10-30"));
    expect(list.map((b) => b.name)).toEqual(["Early", "Later"]);
    expect(list[0].inDays).toBe(3);
  });
});

describe("About Me", () => {
  it("puts allergies under hard constraints and cites the folder", () => {
    let store = seeded();
    store = applyDrafts(store, [{ path: ["Me", "Health"], pack: "health", fields: [{ label: "Allergies", value: "penicillin" }] }]).store;
    const doc = heuristicAbout(store);
    expect(doc.text).toContain("## Hard constraints");
    expect(doc.text).toContain("penicillin");
    const line = aboutLines(doc).find((l) => l.text.includes("penicillin"))!;
    expect(line.sources.length).toBe(1);
  });

  it("says how many credentials it is NOT showing", () => {
    let store = seeded();
    store = applyDrafts(store, [{ path: ["Work", "Current Job"], pack: "job", fields: [{ label: "Door code", value: "907741" }] }]).store;
    const doc = heuristicAbout(store);
    expect(doc.text).toContain("held in the vault");
    expect(doc.text).not.toContain("907741");
  });

  it("keeps a pinned line and never re-adds a vetoed one", () => {
    let store = seeded();
    store = applyDrafts(store, [{ path: ["Me", "Health"], pack: "health", fields: [{ label: "Allergies", value: "penicillin" }] }]).store;
    const first = heuristicAbout(store);
    const allergyLine = aboutLines(first).find((l) => l.text.includes("penicillin"))!.text;

    store = { ...store, about: { ...first, vetoed: [allergyLine], pinned: ["I answer email on Tuesdays."] } };
    const second = heuristicAbout(store);
    expect(second.text).not.toContain(allergyLine);
    expect(second.text).toContain("## Pinned by me");
    expect(second.text).toContain("I answer email on Tuesdays.");
  });

  it("stays within one page", () => {
    let store = seeded();
    for (let i = 0; i < 80; i += 1) {
      store = applyDrafts(store, [
        { path: ["People", "Friends & Family", `Friend ${i}`], pack: "person", fields: [{ label: "Birthday", value: "1990-06-03" }] },
      ]).store;
    }
    expect(heuristicAbout(store).text.length).toBeLessThanOrEqual(4_000);
  });
});

describe("pack suggestions", () => {
  it("routes the owner's own phrases to the right pack", () => {
    expect(suggestPacks("i just got a printer")[0].id).toBe("equipment");
    expect(suggestPacks("my business")[0].id).toBe("business");
    expect(suggestPacks("never say")[0].id).toBe("voice");
  });
});
