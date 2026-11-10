import { describe, expect, it } from "vitest";
import { emptyThread } from "@/lib/new-jarvis/harness/model";
import type { ThreadView, ToolRow, Turn } from "@/lib/new-jarvis/harness/types";
import { blockerAdvice, feedItems, finishOf, shortPath, standingOf, START_GRACE_MS, toolLine } from "./liveBuild";

function tool(over: Partial<ToolRow>): ToolRow {
  return { callId: "c1", name: "Read", title: "", kindOf: "read", path: "", command: "", status: "ok", output: "", at: 1, ...over };
}
function turn(over: Partial<Turn>): Turn {
  return {
    id: "t1",
    at: 1,
    prompt: "",
    text: "",
    thinking: "",
    tools: [],
    gates: [],
    plan: [],
    notes: [],
    status: "done",
    ms: 0,
    usd: 0,
    error: "",
    ...over,
  };
}
function view(turns: Turn[]): ThreadView {
  return { ...emptyThread(), turns };
}

describe("the feed", () => {
  it("shortens long paths to the part a person recognises", () => {
    expect(shortPath("C:\\dev\\repo\\src\\components\\client-review\\ClientPortal.tsx")).toBe(
      "…/components/client-review/ClientPortal.tsx",
    );
    expect(shortPath("src/a.ts")).toBe("src/a.ts");
  });

  it("names a tool call by what it did and what it touched", () => {
    expect(toolLine(tool({ kindOf: "write", path: "src/app/page.tsx" }))).toEqual({ verb: "Edit", target: "src/app/page.tsx" });
    expect(toolLine(tool({ kindOf: "run", command: "npx vitest run\n--reporter dot" }))).toEqual({ verb: "Run", target: "npx vitest run" });
    // The title already says the verb; it is not said twice.
    expect(toolLine(tool({ kindOf: "read", title: "Read package.json" }))).toEqual({ verb: "Read", target: "package.json" });
  });

  it("never shows the brief, but does show what the owner said to the build later", () => {
    const items = feedItems(
      view([
        turn({ id: "t1", prompt: "<the whole brief>", tools: [tool({ path: "a.ts" })], text: "Looking at the header." }),
        turn({ id: "t2", prompt: "make it blue instead", text: "On it.", status: "running" }),
      ]),
    );
    expect(items.map((i) => i.kind)).toEqual(["tool", "say", "you", "say"]);
    expect(items.some((i) => i.kind === "you" && i.text.includes("brief"))).toBe(false);
    expect(items.at(-1)).toMatchObject({ kind: "say", live: true });
  });

  it("never shows the bridge's resume envelope as something the owner typed", () => {
    const items = feedItems(
      view([
        turn({ id: "t1", prompt: "<the whole brief>", text: "Half done." }),
        turn({
          id: "t2",
          prompt: "<resuming>\nThe PC's Jarvis helper restarted…\n</resuming>\n\n<the_job>\n<the whole brief>\n</the_job>",
          text: "Picking it back up.",
          status: "running",
        }),
      ]),
    );
    expect(items.map((i) => i.kind)).toEqual(["say", "say"]);
    expect(items.some((i) => i.kind === "you")).toBe(false);
  });

  it("keeps the PR and Preview lines out of the prose", () => {
    const items = feedItems(
      view([turn({ text: "Done — headline is bigger.\n\nPR: https://github.com/o/r/pull/1\nPreview: https://x.vercel.app" })]),
    );
    expect(items).toEqual([{ kind: "say", id: "t1-say", text: "Done — headline is bigger.", live: false }]);
  });

  it("keeps only the newest rows", () => {
    const tools = Array.from({ length: 200 }, (_, i) => tool({ callId: `c${i}`, path: `f${i}.ts` }));
    const items = feedItems(view([turn({ tools })]), 50);
    expect(items).toHaveLength(50);
    expect(items.at(-1)).toMatchObject({ target: "f199.ts" });
  });
});

describe("what a finished build means", () => {
  it("is still running until the thread says done", () => {
    expect(finishOf("working", view([]))).toEqual({ kind: "running" });
    expect(finishOf("asking", view([]))).toEqual({ kind: "running" });
  });

  it("publishes the preview it printed", () => {
    const v = view([turn({ text: "All done.\nPR: https://github.com/o/r/pull/7\nPreview: https://r-git-x.vercel.app/apps/foo" })]);
    expect(finishOf("done", v)).toEqual({
      kind: "publish",
      url: "https://r-git-x.vercel.app/apps/foo",
      pr: "https://github.com/o/r/pull/7",
    });
  });

  it("publishes a NEW App Builder build from its Repo/Live lines", () => {
    const v = view([turn({ text: "Built.\nRepo: https://github.com/o/buildflip\nLive: https://buildflip.example" })]);
    expect(finishOf("done", v)).toEqual({
      kind: "publish",
      url: "https://buildflip.example",
      repo: "https://github.com/o/buildflip",
    });
  });

  it("says why when there is no preview, in the build's own words", () => {
    const v = view([turn({ text: "PR: https://github.com/o/r/pull/7\nPreview: none\nThe Vercel deploy failed on a type error." })]);
    expect(finishOf("done", v)).toEqual({
      kind: "no-preview",
      why: "The Vercel deploy failed on a type error.",
      pr: "https://github.com/o/r/pull/7",
    });
    expect(finishOf("done", view([turn({ text: "Finished." })]))).toMatchObject({ kind: "no-preview" });
  });

  it("never publishes a made-up address", () => {
    const v = view([turn({ text: "Preview: see the PR" })]);
    expect(finishOf("done", v).kind).toBe("no-preview");
  });

  it("explains a build that died", () => {
    expect(finishOf("lost", view([]))).toMatchObject({ kind: "failed", why: expect.stringContaining("restarted") });
    expect(finishOf("failed", view([turn({ error: "Not signed in" })]))).toEqual({ kind: "failed", why: "Not signed in" });
  });
});

describe("standingOf — is anything actually building it?", () => {
  const since = "2026-11-09T12:00:00.000Z";
  const at = Date.parse(since);

  it("watches a version that has a thread on this PC", () => {
    expect(standingOf({ threadId: "th_1", since }, at + 60_000)).toEqual({ kind: "watching" });
  });

  it("gives a fresh build a moment to report its thread", () => {
    expect(standingOf({ since }, at + 5_000)).toEqual({ kind: "starting" });
    expect(standingOf(null, at)).toEqual({ kind: "starting" });
  });

  it("calls a version with nothing behind it stuck, not building", () => {
    const out = standingOf({ since }, at + START_GRACE_MS + 1_000);
    expect(out.kind).toBe("stalled");
    expect(out.kind === "stalled" && out.why).toContain("Nothing is running");
  });

  it("repeats why the last try failed, however long ago it was", () => {
    const out = standingOf({ since, error: { message: "No GitHub repo is set." } }, at + 1_000);
    expect(out).toEqual({ kind: "stalled", why: "It never started. The last try said: No GitHub repo is set." });
  });

  it("treats an unreadable date as too fresh to call stuck", () => {
    expect(standingOf({ since: "not a date" }, at)).toEqual({ kind: "starting" });
  });
});

describe("blockerAdvice — the words, and whether a press can fix it", () => {
  it("offers the press for everything a press can fix", () => {
    for (const r of ["blocked-by-browser", "pc-off", "not-paired"] as const) {
      const a = blockerAdvice(r);
      expect(a.canConnect).toBe(true);
      // The press is on this page, so the words must point at it and not at a
      // button on another screen.
      expect(a.text).toContain("Connect to my PC");
    }
  });

  it("does not offer a press for what a press cannot fix", () => {
    expect(blockerAdvice("repo-not-here").canConnect).toBe(false);
    expect(blockerAdvice("no-repo").canConnect).toBe(false);
    expect(blockerAdvice("no-repo").text).toContain("Ship");
  });

  it("never tells the owner to press Build again", () => {
    for (const r of ["blocked-by-browser", "pc-off", "not-paired", "repo-not-here", "no-repo"] as const) {
      expect(blockerAdvice(r).text).not.toMatch(/press build/i);
    }
  });
});
