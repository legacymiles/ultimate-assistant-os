import { describe, expect, it } from "vitest";
import { chunk, describePlan, isNoop, pathsToRead, planSweep, type MirrorRow } from "./diff";
import type { VaultEntry } from "./resolve";

/** A scanned file. */
const file = (path: string, hash = `h-${path}`): VaultEntry => ({ path, hash });

/** A mirror row already in the index. */
const row = (externalId: string, hash = `h-${externalId}`): MirrorRow => ({ externalId, hash, id: `id-${externalId}` });

/** n files and n matching rows, for the coverage tests. */
const vault = (n: number) => ({
  files: Array.from({ length: n }, (_, i) => file(`n${i}.md`)),
  rows: Array.from({ length: n }, (_, i) => row(`n${i}.md`)),
});

describe("the hash gate", () => {
  it("does nothing at all when the index already matches the vault", () => {
    // This is the steady state, and it is the whole reason a 2000-note vault
    // is viable: no bodies read, no embeddings bought, no rows written.
    const plan = planSweep([file("a.md"), file("b.md")], [row("a.md"), row("b.md")]);
    expect(plan.upsert).toEqual([]);
    expect(plan.remove).toEqual([]);
    expect(plan.unchanged).toBe(2);
    expect(isNoop(plan)).toBe(true);
    expect(describePlan(plan)).toBe("Nothing to do — the index already matches the vault.");
  });

  it("reads only the note whose hash moved", () => {
    const plan = planSweep([file("a.md", "changed"), file("b.md")], [row("a.md"), row("b.md")]);
    expect(pathsToRead(plan)).toEqual(["a.md"]);
    expect(plan.unchanged).toBe(1);
  });

  it("carries the existing row id onto a changed entry, so the write is an update not a duplicate", () => {
    const plan = planSweep([file("a.md", "changed")], [row("a.md")]);
    expect(plan.upsert[0].memoryId).toBe("id-a.md");
  });

  it("reads a row that has no recorded hash once, to backfill it rather than forever", () => {
    const plan = planSweep([file("a.md")], [{ externalId: "a.md", hash: "", id: "x" }]);
    expect(plan.rehashed).toBe(1);
    expect(pathsToRead(plan)).toEqual(["a.md"]);
  });

  it("treats a file the index has never seen as new", () => {
    const plan = planSweep([file("a.md"), file("new.md")], [row("a.md")]);
    expect(pathsToRead(plan)).toEqual(["new.md"]);
  });
});

describe("the delete phase", () => {
  it("removes a row whose file is gone", () => {
    const { files, rows } = vault(10);
    const plan = planSweep(files, [...rows, row("deleted.md")]);
    expect(plan.remove).toEqual(["deleted.md"]);
    expect(plan.refused).toBeNull();
  });

  it("turns a rename into one delete and one insert, with no row left behind", () => {
    const { files, rows } = vault(10);
    const plan = planSweep([...files, file("New Name.md")], [...rows, row("Old Name.md")]);
    expect(plan.remove).toEqual(["Old Name.md"]);
    expect(pathsToRead(plan)).toEqual(["New Name.md"]);
  });

  it("does not mistake a different spelling of the same path for a delete", () => {
    // The row was written with forward slashes; Windows scanned it with a
    // backslash. Same file. Treating it as a delete-plus-insert would churn an
    // embedding and lose the row id on every single sweep.
    const plan = planSweep([file("Notes\\A.md", "same")], [{ externalId: "Notes/A.md", hash: "same" }]);
    expect(plan.remove).toEqual([]);
    expect(plan.unchanged).toBe(1);
  });

  it("collapses a duplicate manifest path and says it did", () => {
    const plan = planSweep([file("A.md", "x"), file("a.md", "x")], []);
    expect(plan.upsert).toHaveLength(1);
    expect(plan.dropped).toHaveLength(1);
    expect(describePlan(plan)).toContain("1 duplicate path collapsed.");
  });
});

describe("refusing to delete — the guard that protects the index", () => {
  it("REFUSES when the scan found nothing at all", () => {
    // Almost always a wrong vault path or an unreadable folder. Essentially
    // never "every note was deleted at once".
    const { rows } = vault(40);
    const plan = planSweep([], rows);
    expect(plan.remove).toEqual([]);
    expect(plan.refused?.would).toBe(40);
    expect(plan.refused?.reason).toContain("wrong vault path");
  });

  it("REFUSES when the scan says it did not finish, however much it covered", () => {
    const { files, rows } = vault(40);
    const plan = planSweep(files.slice(0, 39), [...rows], { truncated: true });
    expect(plan.remove).toEqual([]);
    expect(plan.refused?.reason).toContain("did not finish");
  });

  it("REFUSES when the scan covered under half of what the index knows", () => {
    const { files, rows } = vault(100);
    const plan = planSweep(files.slice(0, 40), rows);
    expect(plan.remove).toEqual([]);
    expect(plan.refused?.would).toBe(60);
    expect(plan.refused?.reason).toContain("re-run the sweep");
  });

  it("allows it once coverage is over the threshold", () => {
    const { files, rows } = vault(100);
    const plan = planSweep(files.slice(0, 60), rows);
    expect(plan.remove).toHaveLength(40);
    expect(plan.refused).toBeNull();
  });

  it("does not apply the ratio to a tiny vault, where deleting one note is a third of it", () => {
    const plan = planSweep([file("a.md")], [row("a.md"), row("b.md"), row("c.md")]);
    expect(plan.remove.sort()).toEqual(["b.md", "c.md"]);
    expect(plan.refused).toBeNull();
  });

  it("still does the upsert half when the delete half is refused", () => {
    // A refusal protects existing rows; it must not also block new notes from
    // being indexed, or one bad scan would freeze the brain until it is fixed.
    const { rows } = vault(100);
    const plan = planSweep([file("brand-new.md")], rows);
    expect(pathsToRead(plan)).toEqual(["brand-new.md"]);
    expect(plan.remove).toEqual([]);
    expect(plan.refused).not.toBeNull();
  });

  it("says nothing about deleting when there was nothing to delete", () => {
    const plan = planSweep([], []);
    expect(plan.refused).toBeNull();
  });

  it("honours a stricter coverage threshold when one is asked for", () => {
    const { files, rows } = vault(100);
    expect(planSweep(files.slice(0, 80), rows, { minCoverage: 0.9 }).refused).not.toBeNull();
    expect(planSweep(files.slice(0, 95), rows, { minCoverage: 0.9 }).refused).toBeNull();
  });
});

describe("chunk", () => {
  it("splits work into batches the route can finish inside its limit", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("is empty for no work, so a caller can loop over it without a guard", () => {
    expect(chunk([], 25)).toEqual([]);
  });

  it("does not spin forever on a nonsense size", () => {
    expect(chunk([1, 2], 0)).toEqual([[1, 2]]);
  });
});

describe("describePlan", () => {
  it("reports every part of the work in one line", () => {
    const { files, rows } = vault(10);
    const plan = planSweep([...files.slice(0, 9), file("new.md")], [...rows, row("gone.md")]);
    const line = describePlan(plan);
    expect(line).toContain("to read");
    expect(line).toContain("to remove");
    expect(line).toContain("unchanged");
  });

  it("includes the refusal, so a declined delete is never silent", () => {
    const { rows } = vault(50);
    expect(describePlan(planSweep([], rows))).toContain("nothing was deleted");
  });
});
