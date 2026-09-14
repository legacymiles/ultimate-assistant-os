import { spawn } from "node:child_process";

// Run Claude Code headless on one game and turn its stream-json output into
// short, human-readable log lines for the gallery.

export function buildPrompt(game) {
  const template = game.template && game.template !== "Auto" ? game.template : null;
  return [
    "Use the unreal-game-builder skill to build this game end to end in Unreal Engine 5.8 on this PC.",
    "",
    `Game id (pass it to unreal_new_project as id): ${game.id}`,
    template ? `Template the user chose: ${template}` : "Template: choose the one that fits best.",
    "",
    "The user's prompt:",
    '"""',
    game.prompt,
    '"""',
    "",
    "This is an unattended build started from the Game Creator app. Nobody can answer questions:",
    "make sensible decisions yourself, keep the scope achievable, and record anything you leave out",
    "in game.json under `cut`. Write GameCreator/status.json at the start of every stage, take the",
    "screenshots the skill asks for, package the game, and finish by writing GameCreator/game.json.",
    "If something blocks you completely, write game.json with stage \"failed\" and an error, then stop.",
  ].join("\n");
}

/** One-line summary of a tool call, without dumping its arguments. */
export function describeToolUse(block) {
  const name = String(block?.name ?? "tool");
  const input = block?.input ?? {};
  if (name === "call_tool" || name.endsWith("__call_tool")) {
    const ts = String(input.toolset_name ?? "").split(".").pop();
    return `→ ${ts ? `${ts}.` : ""}${input.tool_name ?? "?"}`;
  }
  const short = name.replace(/^mcp__[^_]+(?:_[^_]+)*?__/, "");
  if (short === "unreal_new_project") return `→ new project "${input.name ?? ""}" (${input.template ?? "FirstPerson"})`;
  if (short === "unreal_screenshot") return `→ screenshot ${input.name ?? ""}${input.view ? ` (${input.view})` : ""}`;
  if (["Write", "Edit", "Read"].includes(short) && input.file_path) {
    return `→ ${short} ${String(input.file_path).split(/[\\/]/).slice(-2).join("/")}`;
  }
  return `→ ${short}`;
}

/** Turn one stream-json event into zero or more log lines. */
export function linesFromEvent(ev) {
  const out = [];
  if (ev?.type === "assistant" && Array.isArray(ev.message?.content)) {
    for (const block of ev.message.content) {
      if (block.type === "text" && block.text?.trim()) {
        for (const para of block.text.trim().split(/\n{2,}/)) out.push(para.replace(/\s+/g, " ").slice(0, 600));
      } else if (block.type === "tool_use") {
        out.push(describeToolUse(block));
      }
    }
  } else if (ev?.type === "result") {
    out.push(ev.is_error ? `Claude stopped with an error: ${ev.result ?? ev.subtype ?? ""}` : "Claude finished.");
  }
  return out;
}

/**
 * Spawn `claude -p` and stream its events. Resolves with {code, result, lastLines}.
 * `onLine` receives readable lines; `signal` aborts the run (time limit).
 */
export function runClaude({ prompt, cwd, model, onLine, signal }) {
  return new Promise((resolve) => {
    // The prompt goes in on stdin, never as an argument. On Windows `claude` is
    // an npm .cmd shim, so it must run through the shell, and the shell joins
    // arguments without escaping: a multi-line prompt with quotes in it arrives
    // mangled. Only fixed flags pass through the command line.
    const args = ["-p", "--output-format", "stream-json", "--verbose", "--permission-mode", "bypassPermissions"];
    if (model && /^[\w.:-]+$/.test(model)) args.push("--model", model);

    const child = spawn("claude", args, {
      cwd,
      shell: process.platform === "win32",
      windowsHide: true,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    child.stdin.on("error", () => {});
    child.stdin.end(prompt);
    const lastLines = [];
    let result = null;
    let buffer = "";

    const emit = (line) => {
      lastLines.push(line);
      if (lastLines.length > 40) lastLines.shift();
      onLine?.(line);
    };

    child.stdout.on("data", (chunk) => {
      buffer += String(chunk);
      let nl;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const raw = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!raw) continue;
        let ev;
        try {
          ev = JSON.parse(raw);
        } catch {
          emit(raw.slice(0, 400));
          continue;
        }
        if (ev.type === "result") result = ev;
        for (const line of linesFromEvent(ev)) emit(line);
      }
    });
    child.stderr.on("data", (chunk) => {
      for (const line of String(chunk).split(/\r?\n/)) if (line.trim()) emit(`stderr: ${line.trim().slice(0, 400)}`);
    });

    const onAbort = () => child.kill();
    signal?.addEventListener("abort", onAbort, { once: true });

    child.on("error", (err) => {
      emit(`Could not start Claude Code: ${err.message}`);
      resolve({ code: -1, result, lastLines });
    });
    child.on("close", (code) => {
      signal?.removeEventListener("abort", onAbort);
      resolve({ code, result, lastLines, aborted: Boolean(signal?.aborted) });
    });
  });
}
