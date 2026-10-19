import { describe, expect, it } from "vitest";
import {
  annotate,
  countQueue,
  deriveState,
  evidenceFor,
  filterQueue,
  flagsIn,
  proofIn,
  rule,
  sortQueue,
  toRows,
  type QueueFact,
  type QueueVerdicts,
} from "./queue";

function app(signals: QueueFact["signals"], id = "app:x"): QueueFact {
  return { id, kind: "app", name: "X", blurb: "", group: "Apps", signals };
}
function flow(signals: QueueFact["signals"], id = "flow:x"): QueueFact {
  return { id, kind: "workflow", name: "X", blurb: "", group: "video", signals };
}
function skill(signals: QueueFact["signals"], id = "skill:x"): QueueFact {
  return { id, kind: "skill", name: "X", blurb: "", group: "Personal", signals };
}

describe("flagsIn", () => {
  it("catches the unfinished words", () => {
    expect(flagsIn("still a TODO here")).toContain("todo");
    expect(flagsIn("this is untested")).toContain("untested");
    expect(flagsIn("work in progress")).toContain("work in progress");
    expect(flagsIn("not   verified yet")).toContain("not verified");
  });

  it("does not fire on a word that merely contains one", () => {
    // "WIP" inside "equipped", "todo" inside "mastodon".
    expect(flagsIn("fully equipped mastodon")).toEqual([]);
  });

  it("is quiet on clean text", () => {
    expect(flagsIn("A finished, shipped skill.")).toEqual([]);
  });
});

describe("proofIn", () => {
  it("reads a gauntlet score", () => {
    expect(proofIn("gauntleted 5 rounds (final 7.9)")).toMatch(/gauntleted/i);
  });

  it("reads a verification that carries a measurement", () => {
    // All four are real lines out of the owner's own skills.
    expect(proofIn("Verified against its model API: 447 models, output")).toMatch(/447/);
    expect(proofIn("VERIFIED on 24GB: accurate, ~3s (cached) for 8s audio")).toMatch(/24GB/);
    expect(proofIn("verified against UE 5.8")).toBeDefined();
    expect(proofIn("shipped and verified")).toBeDefined();
  });

  // The regression that matters. These are instructions telling the reader to
  // verify, not records of anyone having verified — an earlier pass read them
  // as proof and marked four skills green that had never been run.
  it("does not read an instruction to verify as proof of a run", () => {
    expect(proofIn("verified with screenshots, and anything you could not")).toBeUndefined();
    expect(proofIn("Verified on small phone, large phone, and tablet")).toBeUndefined();
    expect(proofIn("Everything here is verified on this branch, not from taste")).toBeUndefined();
    expect(proofIn("verified by rendering and listening")).toBeUndefined();
  });

  it("does not read a skill that teaches gauntleting as one that was gauntleted", () => {
    expect(proofIn("The gauntlet loop pushes any output (a website, an app, a 3D hero)")).toBeUndefined();
    expect(proofIn("## Gauntlet (runs automatically after Stage 4)")).toBeUndefined();
  });

  it("quotes the whole measurement rather than stopping at a decimal point", () => {
    expect(proofIn("verified in 0.8s on the laptop")).toBe("verified in 0.8s on the laptop");
    expect(proofIn("Verified 2026-09-27 against a local run")).toMatch(/2026-09-27/);
  });

  it("a bare number after 'scored' is not a score", () => {
    expect(proofIn("scored 17 shots across the sequence")).toBeUndefined();
    expect(proofIn("scored 8.6 out of 10")).toBeDefined();
  });

  it("returns undefined when nothing claims a run", () => {
    expect(proofIn("Use this whenever someone wants a video.")).toBeUndefined();
  });
});

describe("deriveState — apps", () => {
  it("is amber while the catalog says coming soon", () => {
    expect(deriveState(app({ comingSoon: true, hasPage: true, testFiles: 3 })).state).toBe("wip");
  });

  it("is amber with no page, whatever else is true", () => {
    expect(deriveState(app({ hasPage: false, testFiles: 9 })).state).toBe("wip");
  });

  it("is amber when it runs but nothing tests it", () => {
    const { state, why } = deriveState(app({ hasPage: true, testFiles: 0 }));
    expect(state).toBe("wip");
    expect(why).toMatch(/nothing tests it/);
  });

  it("is green when shipped, present and tested", () => {
    const { state, why } = deriveState(app({ hasPage: true, testFiles: 2, tests: 31 }));
    expect(state).toBe("done");
    expect(why).toMatch(/31 test cases/);
  });
});

describe("deriveState — workflows", () => {
  it("needs a brief before anything else counts", () => {
    expect(deriveState(flow({ hasBrief: false, hasArt: true, everUsed: true })).state).toBe("wip");
  });

  it("a brief alone is untried", () => {
    const { state, why } = deriveState(flow({ hasBrief: true }));
    expect(state).toBe("wip");
    expect(why).toMatch(/untried/);
  });

  it("card art proves it went through the pipeline", () => {
    expect(deriveState(flow({ hasBrief: true, hasArt: true })).state).toBe("done");
  });

  it("a real run outranks missing art", () => {
    const { state, why } = deriveState(flow({ hasBrief: true, everUsed: true }));
    expect(state).toBe("done");
    expect(why).toMatch(/actually run/);
  });
});

describe("deriveState — skills", () => {
  it("a stub is amber", () => {
    expect(deriveState(skill({ bodyLines: 12 })).state).toBe("wip");
  });

  it("written out but never proven is amber — the h3 case", () => {
    const { state, why } = deriveState(skill({ bodyLines: 400, mirrored: true }));
    expect(state).toBe("wip");
    expect(why).toMatch(/records a run that was judged/);
  });

  it("its own unfinished marker outranks its length", () => {
    const { state, why } = deriveState(
      skill({ bodyLines: 400, mirrored: true, proof: "gauntleted 7.9", flags: ["untested"] }),
    );
    expect(state).toBe("wip");
    expect(why).toMatch(/untested/);
  });

  it("proven but not committed is amber, because the deployed hub cannot see it", () => {
    const { state, why } = deriveState(
      skill({ bodyLines: 400, mirrored: false, proof: "gauntleted 7.9" }),
    );
    expect(state).toBe("wip");
    expect(why).toMatch(/repo skills/);
  });

  it("is green when written, proven and committed", () => {
    const { state, why } = deriveState(
      skill({ bodyLines: 400, mirrored: true, proof: "gauntleted 5 rounds (final 7.9)" }),
    );
    expect(state).toBe("done");
    expect(why).toMatch(/7\.9/);
  });
});

describe("evidenceFor", () => {
  it("gives apps the app checklist and skills the skill one", () => {
    expect(evidenceFor(app({ hasPage: true, testFiles: 1, tests: 4 })).map((e) => e.label)).toEqual([
      "Has a page",
      "Shipped, not coming-soon",
      "Tested — 4 cases",
      "No unfinished markers",
    ]);
    expect(evidenceFor(skill({ bodyLines: 80 })).map((e) => e.met)).toEqual([true, false, false, true]);
  });

  it("quotes the proof in the label when there is one", () => {
    const e = evidenceFor(skill({ bodyLines: 80, proof: "final 8.6" }));
    expect(e[1]).toEqual({ label: "Proven — final 8.6", met: true });
  });
});

describe("toRows", () => {
  const facts = [app({ hasPage: true, testFiles: 1, tests: 4 }, "app:a")];

  it("uses the derivation when the owner has not ruled", () => {
    const [row] = toRows(facts, {});
    expect(row.state).toBe("done");
    expect(row.byHand).toBe(false);
  });

  it("the owner's verdict wins and the row says the evidence disagrees", () => {
    const verdicts: QueueVerdicts = { "app:a": { state: "wip", at: "now" } };
    const [row] = toRows(facts, verdicts);
    expect(row.state).toBe("wip");
    expect(row.derived).toBe("done");
    expect(row.byHand).toBe(true);
    expect(row.why).toMatch(/You called it unfinished/);
  });

  it("a verdict that agrees reads as a confirmation", () => {
    const [row] = toRows(facts, { "app:a": { state: "done", at: "now" } });
    expect(row.why).toMatch(/^You confirmed this/);
  });

  it("carries the note through", () => {
    const [row] = toRows(facts, { "app:a": { state: "wip", note: "needs the key", at: "now" } });
    expect(row.note).toBe("needs the key");
  });

  it("a note-only entry leaves the state tracking the evidence", () => {
    const [row] = toRows(facts, { "app:a": { note: "needs the key", at: "now" } });
    expect(row.state).toBe("done");
    expect(row.byHand).toBe(false);
    expect(row.note).toBe("needs the key");
    expect(row.why).not.toMatch(/You/);
  });
});

describe("filterQueue", () => {
  const rows = toRows(
    [
      { ...app({ hasPage: true, testFiles: 1, tests: 2 }, "app:ge"), name: "God's Eye View" },
      { ...skill({ bodyLines: 400, mirrored: true }, "skill:h3"), name: "h3 prompt", blurb: "video model" },
      { ...flow({ hasBrief: true, hasArt: true }, "flow:ad"), name: "UGC ad", group: "video" },
    ],
    {},
  );

  it("ignores case and punctuation", () => {
    expect(filterQueue(rows, { q: "gods eye", kinds: [], states: [] })).toHaveLength(1);
  });

  it("every term must match — AND, not OR", () => {
    expect(filterQueue(rows, { q: "h3 video", kinds: [], states: [] })).toHaveLength(1);
    expect(filterQueue(rows, { q: "h3 nonsense", kinds: [], states: [] })).toHaveLength(0);
  });

  it("filters by kind and by state", () => {
    expect(filterQueue(rows, { q: "", kinds: ["skill"], states: [] })).toHaveLength(1);
    expect(filterQueue(rows, { q: "", kinds: [], states: ["wip"] }).map((r) => r.id)).toEqual(["skill:h3"]);
  });

  it("unjudged hides the rows the owner has already ruled on", () => {
    const judged = toRows(
      [{ ...app({ hasPage: true, testFiles: 1 }, "app:a"), name: "A" }],
      { "app:a": { state: "wip", at: "now" } },
    );
    expect(filterQueue(judged, { q: "", kinds: [], states: [], unjudged: true })).toHaveLength(0);
  });
});

describe("sortQueue", () => {
  it("puts the queue first, then apps before skills before workflows", () => {
    const rows = toRows(
      [
        { ...flow({ hasBrief: true }, "flow:z"), name: "Z flow" },
        { ...app({ hasPage: true, testFiles: 1, tests: 1 }, "app:done"), name: "Done app" },
        { ...app({ hasPage: true, testFiles: 0 }, "app:wip"), name: "Wip app" },
        { ...skill({ bodyLines: 5 }, "skill:s"), name: "S skill" },
      ],
      {},
    );
    expect(sortQueue(rows).map((r) => r.id)).toEqual(["app:wip", "skill:s", "flow:z", "app:done"]);
  });
});

describe("countQueue", () => {
  it("counts overall and per kind", () => {
    const rows = toRows(
      [
        app({ hasPage: true, testFiles: 1, tests: 1 }, "app:a"),
        app({ hasPage: true, testFiles: 0 }, "app:b"),
        skill({ bodyLines: 5 }, "skill:s"),
      ],
      {},
    );
    const c = countQueue(rows);
    expect(c).toMatchObject({ total: 3, done: 1, wip: 2 });
    expect(c.byKind.app).toEqual({ total: 2, done: 1, wip: 1 });
    expect(c.byKind.workflow).toEqual({ total: 0, done: 0, wip: 0 });
  });
});

const GREEN_FACT = app({ hasPage: true, testFiles: 1, tests: 1 }, "app:a");
const rowWith = (v: QueueVerdicts) => toRows([GREEN_FACT], v)[0];

describe("rule", () => {
  it("records a verdict that disagrees with the guess", () => {
    expect(rule({}, rowWith({}), "wip", "T")).toEqual({
      "app:a": { state: "wip", note: undefined, at: "T" },
    });
  });

  // What "Back to the evidence" sends: the state the row is already holding.
  // The pip never sends this, because it always sends the opposite.
  it("re-asserting a hand-set state releases the row back to the evidence", () => {
    const v: QueueVerdicts = { "app:a": { state: "wip", at: "T" } };
    expect(rule(v, rowWith(v), "wip")).toEqual({});
  });

  it("the pip's toggle holds both states rather than releasing either", () => {
    // Two pip clicks on a row the evidence calls finished: first to unfinished,
    // then back — and the row is now CONFIRMED finished, not released.
    let v = rule({}, rowWith({}), "wip", "T");
    expect(v["app:a"].state).toBe("wip");
    v = rule(v, rowWith(v), "done", "U");
    expect(v["app:a"].state).toBe("done");
    expect(rowWith(v).byHand).toBe(true);
    expect(rowWith(v).why).toMatch(/^You confirmed this/);
  });

  it("a release keeps the note, and the row goes back to tracking the evidence", () => {
    const v: QueueVerdicts = { "app:a": { state: "wip", note: "needs a key", at: "T" } };
    const next = rule(v, rowWith(v), "wip", "U");
    expect(next["app:a"]).toEqual({ state: undefined, note: "needs a key", at: "U" });
    const after = toRows([GREEN_FACT], next)[0];
    expect(after.state).toBe("done");
    expect(after.byHand).toBe(false);
    expect(after.note).toBe("needs a key");
  });

  it("setting the other state from a released row holds it again", () => {
    const v: QueueVerdicts = { "app:a": { note: "needs a key", at: "T" } };
    const next = rule(v, rowWith(v), "wip", "U");
    expect(next["app:a"]).toEqual({ state: "wip", note: "needs a key", at: "U" });
  });
});

describe("annotate", () => {
  it("stores a note without taking the state over", () => {
    const next = annotate({}, rowWith({}), "  waiting on RunPod  ", "T");
    expect(next["app:a"]).toEqual({ state: undefined, note: "waiting on RunPod", at: "T" });
    expect(toRows([GREEN_FACT], next)[0].byHand).toBe(false);
  });

  it("clearing the only note removes the entry", () => {
    const v: QueueVerdicts = { "app:a": { note: "x", at: "T" } };
    expect(annotate(v, rowWith(v), "")).toEqual({});
  });

  it("clearing the note leaves a hand-set state standing", () => {
    const v: QueueVerdicts = { "app:a": { state: "wip", note: "x", at: "T" } };
    const next = annotate(v, rowWith(v), "", "U");
    expect(next["app:a"]).toEqual({ state: "wip", note: undefined, at: "U" });
  });
});

describe("pinned priorities", () => {
  it("sit above every other unfinished row until done", async () => {
    const { taskFacts } = await import("./tasks");
    const { toRows, sortQueue } = await import("./queue");
    const app = {
      id: "app:x",
      kind: "app" as const,
      name: "Aaa",
      blurb: "",
      group: "",
      signals: { hasPage: true, testFiles: 0 },
    };
    const rows = sortQueue(toRows([app, ...taskFacts()], {}));
    expect(rows[0].id).toBe("task:test-animate-my-character");
    expect(rows[1].id).toBe("task:iphone-setup-video");
    expect(rows[0].state).toBe("wip");
    const done = sortQueue(toRows([app, ...taskFacts([{ id: "t", name: "T", blurb: "", priority: 1, done: true }])], {}));
    expect(done[0].id).toBe("app:x");
  });
});

describe("rows with requests waiting", () => {
  const done = app({ hasPage: true, testFiles: 1, tests: 3 }, "app:done");
  const other = app({ hasPage: true, testFiles: 1, tests: 3 }, "app:other");

  it("are in the queue while requests wait, and go back once they are completed", () => {
    const verdicts: QueueVerdicts = { "app:done": { state: "done", at: "now" } };
    const [asked] = toRows([done], verdicts, { "app:done": 2 });
    expect(asked.state).toBe("wip");
    expect(asked.requests).toBe(2);
    expect(asked.why).toMatch(/^2 requests waiting/);
    const [cleared] = toRows([done], verdicts, {});
    expect(cleared.state).toBe("done");
  });

  it("sort to the top of the queue and can be filtered to", () => {
    const rows = sortQueue(toRows([flow({ hasBrief: false }), other], {}, { "app:other": 1 }));
    expect(rows[0].id).toBe("app:other");
    const only = filterQueue(rows, { q: "", kinds: [], states: [], asked: true });
    expect(only.map((r) => r.id)).toEqual(["app:other"]);
  });
});
