import { describe, expect, it } from "vitest";
import {
  alreadyApplied,
  namedNotePath,
  noteFileName,
  applyOp,
  capturePath,
  conflictPath,
  describeFlush,
  marker,
  pending,
  pendingMirror,
  renderAppend,
  renderCapture,
  slug,
  stamp,
  type VaultOp,
} from "./ops";

const NOW = Date.parse("2026-10-02T14:23:00.000Z");

const op = (patch: Partial<VaultOp> = {}): VaultOp => ({
  id: "op-1",
  path: "inbox/note.md",
  op: "create",
  body: "A captured thought.",
  baseHash: null,
  state: "pending",
  createdAt: new Date(NOW).toISOString(),
  ...patch,
});

describe("slug", () => {
  it("strips every character Windows forbids in a filename", () => {
    expect(slug('a\\b/c:d*e?f"g<h>i|j')).toBe("a-b-c-d-e-f-g-h-i-j");
  });

  it("strips the characters Obsidian treats as link syntax", () => {
    // A `#` or `[` in a filename makes the note's own wikilink unparseable.
    expect(slug("Idea #3 [draft] ^block")).toBe("idea-3-draft-block");
  });

  it("never ends in a dot or a dash, which Windows cannot store", () => {
    expect(slug("trailing...")).toBe("trailing");
    expect(slug("a -- b --")).toBe("a-b");
  });

  it("falls back to a usable name rather than an empty one", () => {
    expect(slug("///")).toBe("note");
    expect(slug("")).toBe("note");
  });

  it("truncates without leaving a dangling dash", () => {
    expect(slug("word ".repeat(40), 12).endsWith("-")).toBe(false);
  });
});

describe("noteFileName — the name a wikilink can still find", () => {
  it("keeps spaces and case, so [[Jarvis Studio]] resolves to the file it just wrote", () => {
    // The bug this exists to prevent: slugging the title to "jarvis-studio"
    // leaves every link that asked for "Jarvis Studio" still dangling, which
    // is exactly what writing the note was supposed to fix.
    expect(noteFileName("Jarvis Studio")).toBe("Jarvis Studio");
    expect(namedNotePath("Jarvis Studio")).toBe("notes/Jarvis Studio.md");
  });

  it("strips only what a filename or a link cannot contain", () => {
    expect(noteFileName('A/B:C*D?E"F<G>H|I')).toBe("A B C D E F G H I");
    expect(noteFileName("Idea #3 [draft]")).toBe("Idea 3 draft");
  });

  it("never ends in a dot or a space, which Windows cannot store", () => {
    expect(noteFileName("Trailing...")).toBe("Trailing");
    expect(noteFileName("Trailing   ")).toBe("Trailing");
  });

  it("falls back to a usable name rather than an empty one", () => {
    expect(noteFileName("///")).toBe("Untitled");
  });

  it("resolves end to end: a ghost written this way stops being a ghost", async () => {
    const { buildGraph } = await import("./resolve");
    const before = buildGraph([{ path: "a.md", hash: "x", raw: "see [[Jarvis Studio]]" }]);
    expect(before.nodes.filter((n) => n.kind === "ghost")).toHaveLength(1);

    const after = buildGraph([
      { path: "a.md", hash: "x", raw: "see [[Jarvis Studio]]" },
      { path: namedNotePath("Jarvis Studio"), hash: "y", raw: "# Jarvis Studio" },
    ]);
    expect(after.nodes.filter((n) => n.kind === "ghost")).toHaveLength(0);
    expect(after.edges).toHaveLength(1);
  });
});

describe("capturePath", () => {
  it("decides the path at capture time, so the note is addressable before it exists", () => {
    // This is what lets external_id be stable and the note be searchable
    // immediately, rather than only once the bridge gets round to writing it.
    expect(capturePath("A Big Idea", NOW)).toBe(`inbox/${stamp(NOW)}-a-big-idea.md`);
  });

  it("can land somewhere other than the inbox", () => {
    expect(capturePath("Jane", NOW, "people")).toMatch(/^people\//);
  });
});

describe("conflictPath", () => {
  it("names a readable sibling next to the original", () => {
    expect(conflictPath("notes/Idea.md", NOW)).toMatch(/^notes\/Idea \(conflict 2026-10-02 \d{4}\)\.md$/);
  });

  it("gives a path with no extension one, rather than producing a file Obsidian ignores", () => {
    expect(conflictPath("notes/Idea", NOW).endsWith(".md")).toBe(true);
  });
});

describe("applyOp — create", () => {
  it("writes the note when nothing is there", () => {
    const result = applyOp(null, op({ body: "hello" }), NOW);
    expect(result.outcome).toBe("created");
    expect(result.path).toBe("inbox/note.md");
    expect(result.text).toContain("hello");
  });

  it("treats a whitespace-only file as nothing, because that is what a touched file is", () => {
    expect(applyOp("\n  \n", op({ body: "hello" }), NOW).outcome).toBe("created");
  });

  it("NEVER overwrites an existing note — it writes a sibling that links back", () => {
    const result = applyOp("Someone else's note.", op({ body: "mine" }), NOW);
    expect(result.outcome).toBe("conflict");
    expect(result.path).not.toBe("inbox/note.md");
    expect(result.text).toContain("mine");
    // The link back is what makes the pair findable in Obsidian's graph.
    expect(result.text).toContain("[[inbox/note.md]]");
    expect(result.text).toContain("status: conflict");
  });

  it("is idempotent on replay even when the body was enqueued with no marker", () => {
    // applyOp adds the marker itself rather than trusting the caller to have
    // rendered one. Without that, every retry of a plain-bodied op would see a
    // file it did not recognise and litter the vault with conflict siblings.
    const o = op({ body: "hello" });
    const first = applyOp(null, o, NOW);
    expect(first.outcome).toBe("created");
    expect(first.text).toContain("hello");
    expect(applyOp(first.text, o, NOW)).toEqual({ outcome: "noop", path: "inbox/note.md", text: null });
  });

  it("appends only once when a plain-bodied append is replayed", () => {
    const o = op({ op: "append", body: "just text" });
    const once = applyOp("Base.", o, NOW);
    expect(once.outcome).toBe("appended");
    expect(applyOp(once.text, o, NOW).outcome).toBe("noop");
  });

  it("does not mistake a replay for a conflict, even though the file now exists", () => {
    // Without the marker this would look exactly like someone else owning the
    // path, and every retry would litter the vault with conflict siblings.
    const o = op({ body: renderCapture({ title: "T", body: "b", now: NOW, id: "op-1" }) });
    expect(applyOp(o.body, o, NOW).outcome).toBe("noop");
  });
});

describe("applyOp — append", () => {
  it("adds to the end of an existing note", () => {
    const result = applyOp("Existing body.", op({ op: "append", body: "\nmore" }), NOW);
    expect(result.outcome).toBe("appended");
    expect(result.text).toContain("Existing body.");
    expect(result.text).toContain("more");
  });

  it("appends to a file that changed since the device last saw it, because that is the safe case", () => {
    // A hash mismatch is NOT a conflict for an append. Appends commute — that
    // is the entire reason append is one of only two allowed ops.
    const o = op({ op: "append", body: "\nmine", baseHash: "what-the-phone-saw" });
    const result = applyOp("Body someone edited on the PC since.", o, NOW);
    expect(result.outcome).toBe("appended");
    expect(result.text).toContain("Body someone edited on the PC since.");
    expect(result.text).toContain("mine");
  });

  it("does not append twice when replayed", () => {
    const o = op({ op: "append", body: renderAppend({ body: "once", now: NOW, id: "op-1" }) });
    const once = applyOp("Base.", o, NOW);
    const twice = applyOp(once.text, o, NOW);
    expect(twice.outcome).toBe("noop");
    expect((once.text?.match(/once/g) ?? []).length).toBe(1);
  });

  it("creates the note rather than dropping the capture when there is nothing to append to", () => {
    // Silently losing a thought is worse than leaving a note the owner can move.
    const result = applyOp(null, op({ op: "append", body: "\n\norphaned thought" }), NOW);
    expect(result.outcome).toBe("created");
    // No leading blank lines — it is the whole file now, not a continuation.
    expect(result.text?.startsWith("orphaned thought")).toBe(true);
  });

  it("normalises the gap so repeated appends do not pile up blank lines", () => {
    const result = applyOp("Body.\n\n\n\n", op({ op: "append", body: "\nnext" }), NOW);
    expect(result.text?.startsWith("Body.\n\nnext")).toBe(true);
    expect(result.text).not.toContain("\n\n\n");
  });
});

describe("renderCapture", () => {
  it("writes frontmatter, a heading, the body and the marker", () => {
    const text = renderCapture({ title: "A Thought", body: "the body", now: NOW, id: "op-9", origin: "phone", tags: ["idea"] });
    expect(text).toContain("title: A Thought");
    expect(text).toContain("captured: 2026-10-02T14:23:00.000Z");
    expect(text).toContain("source: phone");
    expect(text).toContain("status: inbox");
    expect(text).toContain("tags: [idea]");
    expect(text).toContain("# A Thought");
    expect(text).toContain("the body");
    expect(text).toContain(marker("op-9"));
  });

  it("quotes a title YAML would otherwise misread", () => {
    expect(renderCapture({ title: "Costs: £40", body: "x", now: NOW, id: "i" })).toContain('title: "Costs: £40"');
  });

  it("produces a note the parser reads back identically", async () => {
    // The round trip is what guarantees a captured note shows the right title
    // and tags in the graph rather than its filename.
    const { parseNote } = await import("./parse");
    const text = renderCapture({ title: "Round Trip", body: "body with [[A Link]]", now: NOW, id: "i", tags: ["one"] });
    const note = parseNote("inbox/x.md", text);
    expect(note.title).toBe("Round Trip");
    expect(note.tags).toEqual(["one"]);
    expect(note.links.map((l) => l.target)).toEqual(["A Link"]);
  });
});

describe("alreadyApplied", () => {
  it("recognises its own marker and not a different op's", () => {
    expect(alreadyApplied(`body ${marker("a")}`, "a")).toBe(true);
    expect(alreadyApplied(`body ${marker("a")}`, "b")).toBe(false);
  });
});

describe("pendingMirror", () => {
  it("makes a captured note searchable immediately, flagged as not yet on disk", () => {
    // Without this a thought captured away from the PC is invisible until the
    // owner gets home, which defeats the point of capturing it.
    const row = pendingMirror(op({ path: "inbox/a.md", body: "text" }), "A Title");
    expect(row.source).toBe("vault");
    expect(row.externalId).toBe("inbox/a.md");
    expect(row.meta.pending).toBe(true);
    expect(row.origin).toContain("waiting");
  });
});

describe("pending", () => {
  it("returns only what is waiting, oldest first", () => {
    const ops = [
      op({ id: "c", createdAt: "2026-10-02T12:00:02.000Z" }),
      op({ id: "a", createdAt: "2026-10-02T12:00:00.000Z" }),
      op({ id: "done", state: "applied", createdAt: "2026-10-02T11:00:00.000Z" }),
      op({ id: "clash", state: "conflict", createdAt: "2026-10-02T11:30:00.000Z" }),
    ];
    expect(pending(ops).map((o) => o.id)).toEqual(["a", "c"]);
  });

  it("orders a same-millisecond pair deterministically", () => {
    const at = "2026-10-02T12:00:00.000Z";
    expect(pending([op({ id: "b", createdAt: at }), op({ id: "a", createdAt: at })]).map((o) => o.id)).toEqual(["a", "b"]);
  });
});

describe("describeFlush", () => {
  it("says nothing happened when nothing was waiting", () => {
    expect(describeFlush([])).toBe("Nothing was waiting.");
  });

  it("counts each outcome", () => {
    const line = describeFlush([{ outcome: "created" }, { outcome: "created" }, { outcome: "appended" }, { outcome: "noop" }]);
    expect(line).toBe("2 written, 1 added to, 1 already there.");
  });

  it("always names a conflict and says nothing was overwritten", () => {
    const line = describeFlush([{ outcome: "conflict" }]);
    expect(line).toContain("already existed");
    expect(line).toContain("nothing was overwritten");
  });
});
