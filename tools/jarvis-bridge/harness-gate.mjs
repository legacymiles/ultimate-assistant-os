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

/**
 * Tools that execute.
 *
 * `PowerShell` is not a synonym we invented: on Windows the Claude Code SDK
 * reports its shell tool under that name, and the old list only knew `Bash`.
 * An unknown name made every command look like an opaque "other" act, so even
 * a trusted build stopped on `node -v` — the first command it runs — and the
 * only way past it was a tap per command. `Pwsh` and `Shell` are the same tool
 * under the names other adapters use.
 */
const RUNNERS = new Set(["Bash", "PowerShell", "Pwsh", "Shell", "KillShell", "KillBash"]);

/** Commands that look, even though they arrive through a runner. */
const SAFE_COMMAND =
  /^\s*(git\s+(status|diff|log|show|branch|rev-parse|ls-files|blame)|ls|dir|cat|type|head|tail|wc|find|grep|rg|echo|pwd|node\s+--version|npm\s+(ls|view|run\s+(lint|typecheck|test))|npx\s+(tsc|vitest|eslint)|tsc|vitest|pnpm\s+(ls|view))\b/i;

/**
 * The Jarvis connector's own tools, which are bookkeeping rather than a reach
 * into the owner's machine.
 *
 * A build is told to read the workflow's findings and record what it did; those
 * calls wrote only to Jarvis's own memory rows. Treating them as opaque MCP
 * actions (the old default) stopped every trusted build at its first
 * `get_findings`, with a permission card nobody was watching. The names are
 * the same allow-list the unattended runner already uses, so both paths agree.
 */
const SAFE_MCP =
  /^mcp__[a-z0-9_-]*(jarvis[-_]?memory)[a-z0-9_-]*__(agent_|queue_|log_activity|add_finding|get_findings|get_router|search_memory|get_skill|list_skills)/i;

/**
 * The Playwright plugin's looking-only browser tools.
 *
 * A build reads reference sites with the browser the same way it reads them
 * with WebFetch: navigate, snapshot, screenshot, read the console. Those are
 * reads, and gating them made a trusted build stop on its second page. Clicking
 * and typing stay gated — a click can submit something, and that is the line
 * this allow-list must not cross.
 */
const SAFE_BROWSER_MCP =
  /^mcp__[a-z0-9_-]*playwright[a-z0-9_-]*__browser_(navigate|snapshot|take_screenshot|console_messages|network_requests|wait_for|tabs|resize|close|find|evaluate)$/i;

/**
 * Driving a page the build itself is making — clicking the toy, typing in the
 * form, pressing a key — is how a build verifies its own app. It is allowed
 * only inside a build lane (`laneWrites`), never in an ordinary chat thread.
 */
const BUILD_BROWSER_MCP =
  /^mcp__[a-z0-9_-]*playwright[a-z0-9_-]*__browser_(click|type|press_key|hover|select_option|drag|mouse_[a-z_]+|keyboard_[a-z_]+)$/i;

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
 * Is THIS push the dangerous kind?
 *
 * Gating every `git push` was wrong, and it was the most expensive wrong thing
 * here: a build pushing its OWN branch is not a deploy, it is the step that
 * produces the pull request. Gating it made the one card that had to be
 * answered the one most likely to be missed — and a missed card times out into
 * a refusal, so the build threw its finished work away at the last step.
 *
 * Still grave, because these reach work that is not this build's:
 *   - a force push, in any spelling, including a leading `+` on the refspec
 *   - a push naming main or master as the TARGET
 *   - deleting a remote branch
 */
export function pushIsGrave(command) {
  const c = String(command ?? "");
  if (/--force\b|--force-with-lease\b|(^|\s)-f(\s|$)/i.test(c)) return true;
  if (/--delete\b|--prune\b/i.test(c)) return true;
  // `+refs/heads/x:refs/heads/y` is a force push wearing a different hat.
  if (/\s\+[^\s:]+:/.test(c)) return true;
  // main or master as the DESTINATION, in the shapes git accepts.
  if (/:\s*(refs\/heads\/)?(main|master)\b/i.test(c)) return true;
  if (/\bpush\b[^|;&]*\s(origin|upstream)\s+(main|master)\s*$/i.test(c)) return true;
  // `git push origin :branch` deletes it.
  if (/\s:[^\s:]+\s*$/.test(c)) return true;
  return false;
}

/** Tools that are the same ACT under different names. */
const FAMILIES = new Map([
  ["Write", "write-a-file"],
  ["Edit", "write-a-file"],
  ["MultiEdit", "write-a-file"],
  ["NotebookEdit", "write-a-file"],
]);

/**
 * The key an "Always" answer is remembered under.
 *
 * Write, Edit and MultiEdit are one action wearing three names. Saying
 * "always" to Write and then being asked again about Edit of the SAME FILE is
 * not a second question, it is the first one again — which is exactly what
 * happened, on exactly that file. Everything else is its own key, because for
 * an MCP tool the name IS the unit of risk.
 */
export function familyOf(name) {
  const n = String(name ?? "");
  return FAMILIES.get(n) ?? n;
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
  } else if (RUNNERS.has(name)) {
    title = clip(command.split("\n")[0], 160) || "Run a command";
    why = String(input.description ?? "");
    if (/\b(rm|del|rmdir|Remove-Item)\b/i.test(command)) {
      risk = "grave";
      why = "This deletes files. It cannot be undone from here.";
    } else if (/\bgit\s+push\b/i.test(command)) {
      const grave = pushIsGrave(command);
      risk = grave ? "grave" : "act";
      why = grave
        ? "This pushes to a protected branch or forces history, which reaches work that is not this build's."
        : "This pushes the thread's own branch, which is what opens the pull request. It does not deploy.";
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

  return {
    kind,
    title,
    why,
    risk,
    path,
    command,
    // An MCP server's tool is the one thing here whose reach cannot be read
    // off its arguments, so the policy below treats it as its own category
    // rather than as an ordinary command. Jarvis's own connector has a named,
    // bookkeeping-only allow-list (SAFE_MCP) instead.
    mcp: name.startsWith("mcp__"),
    mcpSafe: SAFE_MCP.test(name) || SAFE_BROWSER_MCP.test(name),
    mcpBuildSafe: BUILD_BROWSER_MCP.test(name),
    patch: previewPatch(name, input, cwd),
  };
}

/**
 * Whether `path` — already relative-ised by `describeTool` — stays inside the
 * thread's worktree.
 *
 * `rel()` above shortens a path under the worktree and leaves every other path
 * at its full spelling, so "inside" is readable off the result: a bare relative
 * path is inside, and anything absolute is not. The `..` test is the one that
 * matters, because `src/../../../.env.local` is relative, is inside by the
 * naive reading, and is the owner's real env file.
 *
 * Empty is NOT inside. A write whose path the gate could not find is a write
 * nobody can vouch for.
 */
export function insideWorktree(path) {
  const p = String(path ?? "").replace(/\\/g, "/").trim();
  if (!p) return false;
  if (p.startsWith("/") || /^[a-z]:\//i.test(p) || p.startsWith("//")) return false;
  return !p.split("/").includes("..");
}

/**
 * Can this call be allowed without asking?
 *
 * Both adapters ask this, so the policy is stated once. Three rules, in order:
 *
 *   `strict` gates everything, including reads. It is the mode for watching a
 *   thread you do not trust yet.
 *
 *   Reads pass. Gating them is one tap per file the model opens, which trains
 *   the owner to stop reading the gates that matter.
 *
 *   `laneWrites` additionally passes a WRITE whose path is inside the thread's
 *   own worktree. It exists for the Redesigner's bake-off, where three threads
 *   build a whole app at once and the alternative is several hundred taps — at
 *   which point nobody reads the patches and the gate is decoration. It is off
 *   by default and never inferred: a caller has to ask for it.
 *
 * What `laneWrites` deliberately does NOT pass: anything that RUNS (a shell
 * command can write wherever it likes, and `npm install` reaches the junctioned
 * node_modules the main checkout shares), anything an MCP server does, and any
 * write that resolves outside the worktree — which is the exact event the
 * worktree exists to catch.
 *
 * `trust` is the fourth rule and the one a thread actually sets, because the
 * three above left an ordinary job — write a file, run the build, commit —
 * asking for permission at every single step, and a gate that fires forty
 * times in a row is not read by the time it matters. It widens what passes;
 * it never widens it past these two, at any level:
 *
 *   a grave act (deleting, pushing, changing installed packages) always asks;
 *   a write outside the worktree always asks.
 *
 * Deliberately defaulted to "ask" HERE, so the policy on its own is the strict
 * one and a caller that forgets to pass anything gets the careful answer.
 * startThread() is where a thread's default of "trusted" lives.
 */
export function autoAllow(described, { strict = false, laneWrites = false, trust = "ask", project = false } = {}) {
  // The owner's explicit "do the work, do not ask" switch. The bridge's
  // catastrophic-command refusal is still enforced at the shell boundary.
  if (trust === "full") return true;
  if (strict) return false;
  if (described.kind === "read") return true;
  if (described.risk === "grave") {
    // Installing a brand-new project's own dependencies is the build, not a
    // change to the owner's checkout. A worktree's install reaches the shared
    // node_modules through the junction, so that one keeps asking.
    if (project && described.kind === "run" && /\bnpm\s+(install|i|ci)\b/i.test(described.command)) return true;
    return false;
  }

  if (described.kind === "write") {
    if (!insideWorktree(described.path)) return false;
    return laneWrites || trust === "trusted" || trust === "auto";
  }

  if (described.kind === "run") {
    // An MCP tool's reach is not readable from here, so it is the one acting
    // category that stays behind a gate until the owner says Auto — except
    // Jarvis's own bookkeeping connector, which writes only memory/queue rows
    // and is what every build is told to use, and the page interactions a
    // build uses to verify its own preview.
    if (described.mcp) {
      if (described.mcpSafe) return true;
      if (described.mcpBuildSafe && (project || laneWrites)) return true;
      return trust === "auto";
    }
    return trust === "trusted" || trust === "auto";
  }

  return trust === "auto";
}

/**
 * The sentence on a refusal, phrased so the model does something useful next.
 *
 * A timeout is told apart from a no on purpose. They are opposite facts — one
 * is a decision, the other is nobody being there — and a build that reports
 * "the owner refused" when nobody ever saw the card is lying about its own
 * failure. That is how twenty minutes of silence became a finished build with
 * no pull request and no explanation.
 */
export function denialMessage(title, how = "owner") {
  if (how === "timeout") {
    return (
      `Nobody answered the permission card for this within the time limit, so it was refused automatically: ${title}. ` +
      `This is NOT a decision against it — nobody saw it. Do not carry on as though it had been declined: ` +
      `say plainly in your final message that this step never ran because the card went unanswered, and name the step.`
    );
  }
  return (
    `The owner refused this: ${title}. Do not retry it or work around it. ` +
    `Say what you would have done and ask for a different approach.`
  );
}
