// ---------------------------------------------------------------------------
// Claude's own task list, as the `plan` event the page already draws.
//
// dsh reports its plan over ACP and the page has drawn it since the first
// harness. Claude Code keeps the same list — TodoWrite on older builds,
// TaskCreate / TaskUpdate on newer ones — but as tool calls, so the Claude
// adapter never said a word about it and every Claude build showed a wall of
// tool lines with no idea how far along it was. This turns those calls into
// the same `{ kind: "plan", entries }` event, so a website edit shows the
// owner a checklist ticking itself off.
//
// Pure apart from the closure: no I/O, no clock.
// ---------------------------------------------------------------------------

const text = (v) => String(v ?? "").replace(/\s+/g, " ").trim();

/**
 * One tracker per thread. Call it with every tool_use; it returns the whole
 * list when that call changed it, and null otherwise.
 */
export function makePlanTracker() {
  /** @type {{ id: string; text: string; status: string }[]} */
  let tasks = [];
  let next = 1;
  const entries = () => tasks.map((t) => ({ text: t.text, status: t.status }));

  return function track(name, input = {}) {
    if (name === "TodoWrite") {
      if (!Array.isArray(input?.todos)) return null;
      tasks = input.todos
        .map((t, i) => ({ id: String(i + 1), text: text(t?.content ?? t?.activeForm), status: text(t?.status) || "pending" }))
        .filter((t) => t.text);
      next = tasks.length + 1;
      return entries();
    }
    if (name === "TaskCreate") {
      const t = text(input?.subject ?? input?.description);
      if (!t) return null;
      tasks.push({ id: String(next++), text: t, status: "pending" });
      return entries();
    }
    if (name === "TaskUpdate") {
      const id = text(input?.taskId ?? input?.id);
      const hit = tasks.find((t) => t.id === id);
      if (!hit) return null;
      if (input?.status === "deleted") {
        tasks = tasks.filter((t) => t !== hit);
        return entries();
      }
      if (input?.status) hit.status = text(input.status);
      if (input?.subject) hit.text = text(input.subject);
      return entries();
    }
    return null;
  };
}
