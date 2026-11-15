import { describe, expect, it } from "vitest";

import { makePlanTracker } from "./harness-plan.mjs";

describe("Claude's task list as a plan", () => {
  it("reads a TodoWrite list whole", () => {
    const track = makePlanTracker();
    expect(
      track("TodoWrite", {
        todos: [
          { content: "Find the button", status: "completed" },
          { content: "Make it blue", status: "in_progress" },
          { content: "Merge", status: "pending" },
        ],
      }),
    ).toEqual([
      { text: "Find the button", status: "completed" },
      { text: "Make it blue", status: "in_progress" },
      { text: "Merge", status: "pending" },
    ]);
  });

  it("builds the list from TaskCreate and ticks it with TaskUpdate", () => {
    const track = makePlanTracker();
    track("TaskCreate", { subject: "Find the button" });
    track("TaskCreate", { subject: "Make it blue" });
    expect(track("TaskUpdate", { taskId: "1", status: "completed" })).toEqual([
      { text: "Find the button", status: "completed" },
      { text: "Make it blue", status: "pending" },
    ]);
    expect(track("TaskUpdate", { taskId: "2", status: "deleted" })).toEqual([{ text: "Find the button", status: "completed" }]);
  });

  it("says nothing about any other tool, or an update to a task it never saw", () => {
    const track = makePlanTracker();
    expect(track("Bash", { command: "ls" })).toBeNull();
    expect(track("TaskUpdate", { taskId: "9", status: "completed" })).toBeNull();
  });
});
