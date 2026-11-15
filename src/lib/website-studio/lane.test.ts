import { describe, expect, it } from "vitest";
import { EMPTY_THREAD, type ThreadView, type ToolRow, type Turn } from "@/lib/new-jarvis/harness/types";
import { editChecklist, laneFor, laneOf, readyLine, wantsFactory } from "./lane";

const tool = (over: Partial<ToolRow>): ToolRow => ({
  callId: Math.random().toString(36),
  name: "Bash",
  title: "",
  kindOf: "run",
  path: "",
  command: "",
  status: "ok",
  output: "",
  at: 0,
  ...over,
});

const turn = (tools: ToolRow[], plan: Turn["plan"] = []): Turn => ({
  id: "t1",
  at: 0,
  prompt: "make it blue",
  text: "",
  thinking: "",
  tools,
  gates: [],
  plan,
  notes: [],
  status: "running",
  ms: 0,
  usd: 0,
  error: "",
});

const view = (t: Turn): ThreadView => ({ ...EMPTY_THREAD, turns: [t] });

describe("which lane an edit takes", () => {
  it("takes the quick lane unless Software Factory is switched on", () => {
    expect(laneFor(false)).toBe("quick");
    expect(laneFor(true)).toBe("full");
  });

  it("reads the lane off the thread, and keeps Software Factory off a quick edit", () => {
    const quick = view({ ...turn([]), prompt: ["<role>…</role>", "<speed>", "This is a QUICK EDIT", "</speed>"].join("\n") });
    const build = view({ ...turn([]), prompt: ["<ship_first>", "…", "</ship_first>"].join("\n") });
    expect(laneOf(quick)).toBe("quick");
    expect(wantsFactory(quick)).toBe(false);
    expect(laneOf(build)).toBe("full");
    expect(wantsFactory(build)).toBe(true);
  });
});

describe("the checklist the owner watches", () => {
  it("ticks the quick lane off from the tools it ran", () => {
    const items = editChecklist(
      view(
        turn([
          tool({ name: "Read", kindOf: "read", path: "src/components/x/x.css" }),
          tool({ name: "Edit", kindOf: "write", path: "src/components/x/x.css" }),
          tool({ command: "npx tsc -p tsconfig.json --noEmit" }),
        ]),
      ),
      "quick",
      { live: false, running: true },
    );
    expect(items.map((i) => i.state)).toEqual(["done", "done", "done", "done", "now", "todo", "todo", "todo"]);
    expect(items.at(-1)?.text).toBe("Live on the site");
  });

  it("does not tick a step whose command failed", () => {
    const items = editChecklist(view(turn([tool({ command: "npx tsc --noEmit", status: "failed" })])), "quick", { live: false, running: true });
    expect(items.find((i) => i.text === "Check it compiles")?.state).not.toBe("done");
  });

  it("treats a merge as proof of everything before it", () => {
    const items = editChecklist(view(turn([tool({ command: "gh pr merge 29 --squash --delete-branch" })])), "quick", { live: false, running: false });
    expect(items.slice(0, -1).every((i) => i.state === "done")).toBe(true);
    expect(items.at(-1)?.state).toBe("todo");
  });

  it("shows Claude's own task list when it keeps one", () => {
    const items = editChecklist(
      view(turn([], [
        { text: "Find the button", status: "completed" },
        { text: "Make it blue", status: "in_progress" },
      ])),
      "quick",
      { live: false, running: true },
    );
    expect(items).toEqual([
      { text: "Find the button", state: "done" },
      { text: "Make it blue", state: "now" },
      { text: "Live on the site", state: "todo" },
    ]);
  });

  it("is all ticked once the version is live", () => {
    const items = editChecklist(view(turn([])), "quick", { live: true, running: false });
    expect(items.every((i) => i.state === "done")).toBe(true);
  });
});

describe("the stop before commit", () => {
  it("ticks Ready for you to look when the edit stopped on READY, and nothing after it", () => {
    const t = {
      ...turn([
        tool({ kindOf: "write", path: "src/app/globals.css", title: "Edit globals.css" }),
        tool({ kindOf: "run", command: "npx tsc -p tsconfig.json --noEmit", title: "Bash" }),
      ]),
      text: "Done.\nREADY: the app is purple",
    };
    const items = editChecklist(view(t), "quick", { live: false, running: false });
    const by = Object.fromEntries(items.map((i) => [i.text, i.state]));
    expect(by["Ready for you to look"]).toBe("done");
    expect(by["Commit and push"]).toBe("todo");
    expect(readyLine(view(t))).toBe("the app is purple");
  });
});
