import { describe, expect, it } from "vitest";
import {
  applyRead,
  askAgain,
  decide,
  emptyDoc,
  ingest,
  keyOf,
  localItems,
  normalizeDoc,
  parseItems,
  readIncoming,
  spendDaily,
  stuck,
  systemPrompt,
  viewNote,
  DAILY_AI_CAP,
  type NotesDoc,
} from "./engine";

const NOW = new Date("2026-10-25T23:00:00Z");

function withNote(body = "Mom bday Nov 12", title = "Mom bday") {
  return ingest(emptyDoc(), { title, body, created: "Oct 25, 2026 at 7:40 PM" }, NOW);
}

describe("readIncoming — whatever the Shortcut sends", () => {
  it("reads JSON fields however they were named", () => {
    const n = readIncoming({ Title: "Groceries", Body: "milk\neggs", Folder: "Notes", "Creation Date": "Oct 1, 2026", "Last Modified Date": "Oct 2, 2026" });
    expect(n).toMatchObject({ title: "Groceries", body: "milk\neggs", folder: "Notes", created: "Oct 1, 2026", modified: "Oct 2, 2026" });
  });
  it("takes a plain text body as the note, first line as the title", () => {
    expect(readIncoming("Call dentist\nbefore Friday")).toMatchObject({ title: "Call dentist", body: "Call dentist\nbefore Friday" });
  });
  it("ignores setup words typed in place of a variable", () => {
    const n = readIncoming({ title: "Repeat Item > tap it > Name", body: "Call dentist Friday", created: "Repeat Item → Creation Date" });
    expect(n).toMatchObject({ title: "Call dentist Friday", body: "Call dentist Friday", created: undefined });
    expect(readIncoming({ body: "Repeat Item" })).toBeNull();
  });
  it("fixes a note's title when the corrected Shortcut sends it again", () => {
    let { doc } = ingest(emptyDoc(), { title: "Call dentist Friday", body: "Call dentist Friday" }, NOW);
    const again = ingest(doc, { title: "Dentist", body: "Call dentist Friday", created: "Oct 27, 2026" }, NOW);
    expect(again.out.kind).toBe("same");
    expect(again.doc.notes).toHaveLength(1);
    expect(again.doc.notes[0].title).toBe("Dentist");
    doc = again.doc;
  });
  it("spots many notes glued into one push", async () => {
    const { isBatched } = await import("./engine");
    expect(isBatched({ title: "a\nb", body: "x", folder: "Notes\nNotes", created: "Oct 1\nOct 2" })).toBe(true);
    expect(isBatched({ title: "Groceries", body: "milk\neggs", folder: "Notes", created: "Oct 1, 2026" })).toBe(false);
  });
  it("never saves Jarvis's own earlier answer as a note", async () => {
    const { isEcho } = await import("./engine");
    expect(isEcho({ title: "push", body: '{"error":"No note came through.","ok":false}' })).toBe(true);
    expect(isEcho({ body: "Buy milk" })).toBe(false);
  });
  it("takes the note from a field with an unexpected name", () => {
    expect(readIncoming({ "Repeat Item": "Call mom tonight" })).toMatchObject({ body: "Call mom tonight", title: "Call mom tonight" });
  });
  it("describes what arrived without its words", async () => {
    const { describeArrival } = await import("./engine");
    expect(describeArrival({ body: "" }, "application/json")).toBe('Jarvis got: JSON with "body" (empty).');
    expect(describeArrival({ body: "secret stuff" }, "application/json")).not.toContain("secret");
  });
  it("refuses an empty note", () => {
    expect(readIncoming({ title: "", body: "  " })).toBeNull();
    expect(readIncoming(null)).toBeNull();
  });
});

describe("ingest — no duplicates, edits noticed", () => {
  it("adds a new note at the top, waiting to be read", () => {
    const { doc, out } = withNote();
    expect(out.kind).toBe("new");
    expect(doc.notes[0].status).toBe("reading");
  });
  it("the same note sent again is a no-op", () => {
    const { doc } = withNote();
    const again = ingest(doc, { title: "Mom bday", body: "Mom bday Nov 12", created: "Oct 25, 2026 at 7:40 PM" }, NOW);
    expect(again.out.kind).toBe("same");
    expect(again.doc.notes).toHaveLength(1);
  });
  it("an edited note is read again and keeps what was decided", () => {
    let { doc } = withNote();
    const id = doc.notes[0].id;
    doc = applyRead(doc, id, parseItems([{ action: "birthday", name: "Mom", when: "Nov 12", confidence: 0.9 }]));
    doc = decide(doc, { noteId: id, itemId: doc.notes[0].items[0].id, decision: "approve" }, NOW);
    const edited = ingest(doc, { title: "Mom bday", body: "Mom bday Nov 12\nget cake", created: "Oct 25, 2026 at 7:40 PM" }, NOW);
    expect(edited.out.kind).toBe("edited");
    expect(edited.doc.notes).toHaveLength(1);
    expect(edited.doc.notes[0].status).toBe("reading");
    expect(edited.doc.notes[0].items.map((i) => i.state)).toEqual(["done"]);
  });
  it("keys the same note the same way", () => {
    expect(keyOf({ title: "A", created: "x", body: "1" })).toBe(keyOf({ title: " a ", created: "X", body: "2" }));
  });
});

describe("parseItems — the trust boundary", () => {
  it("drops unknown actions and items missing what they need", () => {
    const items = parseItems({ items: [{ action: "launch-rockets" }, { action: "todo", text: "" }, { action: "birthday", name: "Sam" }, { action: "todo", text: "Buy milk", confidence: 0.8 }] });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ action: "todo", text: "Buy milk", raw: 0.8, state: "waiting" });
  });
  it("turns a dateless event into a to-do instead of guessing a date", () => {
    const [i] = parseItems([{ action: "event", label: "Dinner with Sam", text: "Dinner with Sam", confidence: 0.9 }]);
    expect(i.action).toBe("todo");
    expect(i.raw).toBeLessThanOrEqual(0.5);
  });
  it("caps how many things one note can propose", () => {
    const many = Array.from({ length: 20 }, (_, n) => ({ action: "todo", text: `t${n}` }));
    expect(parseItems(many)).toHaveLength(6);
  });
});

describe("decide — nothing runs without a yes, and it learns", () => {
  function ready(): { doc: NotesDoc; noteId: string; itemId: string } {
    let { doc } = withNote("Buy milk", "Buy milk");
    const noteId = doc.notes[0].id;
    doc = applyRead(doc, noteId, parseItems([{ action: "todo", text: "Buy milk", confidence: 0.7 }]));
    return { doc, noteId, itemId: doc.notes[0].items[0].id };
  }
  it("a fresh read waits — nothing is done until decided", () => {
    const { doc } = ready();
    expect(doc.notes[0].items.every((i) => i.state === "waiting")).toBe(true);
  });
  it("approve marks it done and records a right guess", () => {
    const { doc, noteId, itemId } = ready();
    const next = decide(doc, { noteId, itemId, decision: "approve" }, NOW);
    expect(next.notes[0].items[0].state).toBe("done");
    expect(next.outcomes.at(-1)).toMatchObject({ kind: "todo", ok: true });
    expect(next.examples.at(-1)).toMatchObject({ action: "todo", ok: true });
  });
  it("approving an edited version counts as a miss for the guess", () => {
    const { doc, noteId, itemId } = ready();
    const next = decide(doc, { noteId, itemId, decision: "approve", changed: true, patch: { text: "Buy oat milk" } }, NOW);
    expect(next.notes[0].items[0].text).toBe("Buy oat milk");
    expect(next.outcomes.at(-1)?.ok).toBe(false);
  });
  it("a second tap can't count twice", () => {
    const { doc, noteId, itemId } = ready();
    const once = decide(doc, { noteId, itemId, decision: "decline" }, NOW);
    expect(decide(once, { noteId, itemId, decision: "approve" }, NOW).outcomes).toHaveLength(1);
  });
  it("the score falls after the owner declines this kind a few times", () => {
    let doc: NotesDoc = emptyDoc();
    for (let n = 0; n < 6; n++) {
      doc = ingest(doc, { title: `n${n}`, body: `buy thing ${n}` }, NOW).doc;
      const id = doc.notes[0].id;
      doc = applyRead(doc, id, parseItems([{ action: "todo", text: `thing ${n}`, confidence: 0.9 }]));
      doc = decide(doc, { noteId: id, itemId: doc.notes[0].items[0].id, decision: "decline" }, NOW);
    }
    doc = ingest(doc, { title: "new", body: "buy bread" }, NOW).doc;
    doc = applyRead(doc, doc.notes[0].id, parseItems([{ action: "todo", text: "bread", confidence: 0.9 }]));
    const v = viewNote(doc.notes[0], doc.outcomes);
    expect(v.items[0].confidence.score).toBeLessThan(60);
    expect(v.waiting).toBe(1);
  });
  it("'change it' declines the old guesses and keeps the owner's words for the re-read", () => {
    const { doc, noteId } = ready();
    const r = askAgain(doc, noteId, "this is for my wife, put it on the calendar Saturday");
    expect(r.note.instruction).toMatch(/calendar/);
    expect(r.note.items).toHaveLength(0);
    expect(r.doc.outcomes.at(-1)?.ok).toBe(false);
  });
});

describe("simple mode and housekeeping", () => {
  it("still proposes something useful without AI, scored low", () => {
    const items = localItems({ title: "Groceries", body: "- buy milk\n- eggs\n- bread" });
    expect(items.map((i) => i.text)).toEqual(["buy milk", "eggs", "bread"]);
    expect(items.every((i) => i.raw < 0.5 && i.engine === "simple")).toBe(true);
    expect(localItems({ title: "Jay birthday", body: "Jay birthday March 3" })[0].action).toBe("birthday");
  });
  it("tells the model today's date and the owner's recent habits", () => {
    const p = systemPrompt("2026-10-25", [{ note: "Mom bday", action: "birthday", label: "Mom", ok: true, at: "" }]);
    expect(p).toContain("2026-10-25");
    expect(p).toContain("approved");
  });
  it("caps AI reads per day", () => {
    let doc: NotesDoc = { ...emptyDoc(), daily: { day: "2026-10-25", count: DAILY_AI_CAP } };
    const r = spendDaily(doc, NOW);
    expect(r.allowed).toBe(false);
    doc = { ...emptyDoc(), daily: { day: "2026-10-24", count: DAILY_AI_CAP } };
    expect(spendDaily(doc, NOW).allowed).toBe(true);
  });
  it("finds reads that never finished", () => {
    const { doc } = withNote();
    expect(stuck(doc, new Date(NOW.getTime() + 5 * 60_000))).toHaveLength(1);
    expect(stuck(doc, NOW)).toHaveLength(0);
  });
  it("survives a junk stored doc", () => {
    expect(normalizeDoc("nope")).toEqual(emptyDoc());
    expect(normalizeDoc({ notes: [{ id: "x" }, 4] }).notes).toHaveLength(1);
  });
});
