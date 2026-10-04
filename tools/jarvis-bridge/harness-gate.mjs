// ---------------------------------------------------------------------------
// Turning a tool call into something a person can agree to.
//
// A terminal harness asks "Bash(npm test)? (y/n)". That is answerable because
// you are already in the terminal, in the folder, holding the context. On a
// page in another room, the same prompt is unanswerable — so every gate here
// has to carry its own evidence: which file, which lines, which command, and
// what it cannot undo.
//
// The patch preview is the point of the whole feature. An Edit's arguments
// already contain the before and after text, so the gate can show the actual
// diff the tool is about to apply rather than the tool's name and a path. You
// are approving a change you have read, which is a different act from
// approving a tool you have heard of.
// ---------------------------------------------------------------------------

/** Tools that only look. These never gate. */
const READERS = new Set([
  "Read", "Glob", "Grep", "LS", "NotebookRead", "WebFetch", "WebSearch",
  "TodoWrite", "Task", "Agent", "ExitPlanMode", "BashOutput", "SlashCommand", "Skill",
]);

/** Tools that change files. */
const WRITERS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit", "ApplyPatch"]);

/** Tools that execute. */
const RUNNERS = new Set(["Bash", "KillShell", "KillBash"]);

/** Commands that look, even though they arrive through a runner. */
const SAFE_COMMAND =
  /^\s*(git\s+(status|diff|log|show|branch|rev-parse|ls-files|blame)|ls|dir|cat|type|head|tail|wc|find|grep|rg|echo|pwd|node\s+--version|npm\s+(ls|view|run\s+(lint|typecheck|test))|npx\s+(tsc|vitest|eslint)|tsc|vitest|pnpm\s+(ls|view))\b/i;

export function toolKind(name, input = {}) {
  if (WRITERS.has(name)) return "write";
  if (RUNNERS.has(name)) {
    const cmd = String(input.command ?? "");
    return SAFE_COMMAND.test(cmd) && !/[;&|>]/.test(cmd) ? "read" : "run";
  }
  if (READERS.has(name)) return "read";
  // An MCP tool or a plugin tool is an unknown quantity by definition, and the
  // safe reading of an unknown is that it acts.
  return name.startsWith("mcp__") ? "run" : "other";
}

/**
 * The path as it reads inside the thread's own worktree.
 *
 * A harness works several folders deep inside the worktree root, and a gate
 * that prints that absolute path in full wraps its own title over three lines
 * and buries the only part that matters. Relative to the worktree the same
 * gate says `src/lib/foo.ts`, which is also how the owner thinks about it.
 *
 * A path NOT under the worktree keeps its full spelling on purpose: a write
 * outside the thread's own folder is the one case worth being alarmed by, and
 * shortening it is exactly the wrong instinct there.
 */
const rel = (p, cwd) => {
  const s = String(p ?? "").replace(/\\/g, "/");
  const root = String(cwd ?? "").replace(/\\/g, "/").replace(/\/+$/, "");
  if (root && s.toLowerCase().startsWith(`${root.toLowerCase()}/`)) return s.slice(root.length + 1);
  return s;
};

const clip = (s, n) => {
  const t = String(s ?? "");
  return t.length > n ? `${t.slice(0, n)}\n… ${t.length - n} more characters` : t;
};

/**
 * A unified-ish patch for a change that has not happened yet.
 *
 * Not produced by git — there is nothing on disk to diff against — so the
 * hunks are built straight from the tool's own before/after strings. It is
 * labelled as a preview for that reason: it shows the edit, not the file.
 */
function previewPatch(name, input, cwd) {
  const path = rel(input.file_path ?? input.path ?? "", cwd);
  if (name === "Write" || name === "ApplyPatch") {
    const body = String(input.content ?? input.contents ?? "");
    const lines = body.split("\n");
    return [
      `--- ${path || "(new file)"}`,
      `+++ ${path || "(new file)"}`,
      `@@ new file, ${lines.length} line${lines.length === 1 ? "" : "s"} @@`,
      ...lines.slice(0, 400).map((l) => `+${l}`),
      lines.length > 400 ? `… ${lines.length - 400} more lines` : "",
    ].filter(Boolean).join("\n");
  }
  if (name === "Edit" || name === "MultiEdit") {
    const edits = Array.isArray(input.edits)
      ? input.edits
      : [{ old_string: input.old_string, new_string: input.new_string }];
    const out = [`--- ${path}`, `+++ ${path}`];
    for (const e of edits.slice(0, 12)) {
      const before = String(e?.old_string ?? "").split("\n");
      const after = String(e?.new_string ?? "").split("\n");
      out.push(`@@ -${before.length} +${after.length} @@`);
      out.push(...before.slice(0, 120).map((l) => `-${l}`));
      out.push(...after.slice(0, 120).map((l) => `+${l}`));
    }
    if (edits.length > 12) out.push(`… ${edits.length - 12} more edits in this call`);
    return out.join("\n");
  }
  return "";
}

/**
 * Everything the gate card draws, from a tool name and its arguments.
 *
 * `risk: "grave"` is reserved for the two things that are not merely a change
 * — deleting and pushing — because a gate that shouts at every edit teaches
 * the owner to approve without reading, which is worse than no gate.
 */
export function describeTool(name, input = {}, cwd = "") {
  const kind = toolKind(name, input);
  const path = rel(input.file_path ?? input.path ?? "", cwd);
  const command = String(input.command ?? "");

  let title = name;
  let why = "";
  let risk = kind === "read" ? "read" : "act";

  if (name === "Write") {
    title = `Write ${path}`;
    why = "Replaces the whole file, or creates it.";
  } else if (name === "Edit" || name === "MultiEdit") {
    const n = Array.isArray(input.edits) ? input.edits.length : 1;
    title = `Edit ${path}`;
    why = n > 1 ? `${n} replacements in one file.` : "One replacement.";
  } else if (name === "NotebookEdit") {
    title = `Edit notebook ${path}`;
  } else if (name === "Bash") {
    title = clip(command.split("\n")[0], 160) || "Run a command";
    why = String(input.description ?? "");
    if (/\b(rm|del|rmdir|Remove-Item)\b/i.test(command)) {
      risk = "grave";
      why = "This deletes files. It cannot be undone from here.";
    } else if (/\bgit\s+push\b/i.test(command)) {
      risk = "grave";
      why = "This pushes to the remote, which deploys.";
    } else if (/\bgit\s+(commit|merge|reset|checkout|rebase)\b/i.test(command)) {
      why = why || "This moves git history in the thread's worktree.";
    } else if (/\bnpm\s+(install|i|uninstall|update)\b|\bpnpm\s+(add|remove)\b/i.test(command)) {
      why = why || "This changes installed packages — and node_modules is shared with your main checkout.";
      risk = "grave";
    }
  } else if (name.startsWith("mcp__")) {
    title = `${name.split("__").slice(1).join(" › ")}`;
    why = "A tool from an MCP server. What it touches is not something this gate can read.";
  }

  return { kind, title, why, risk, path, command, patch: previewPatch(name, input, cwd) };
}

/** The sentence on a refusal, phrased so the model does something useful next. */
export function denialMessage(title) {
  return (
    `The owner refused this: ${title}. Do not retry it or work around it. ` +
    `Say what you would have done and ask for a different approach.`
  );
}
