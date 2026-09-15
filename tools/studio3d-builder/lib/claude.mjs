import { spawn } from "node:child_process";

// Run Claude Code headless on one video job and turn its stream-json output
// into short, human-readable log lines for the production log.

export function buildPrompt({ project, jobDir, capabilities }) {
  const caps = capabilities ?? {};
  const have = [
    caps.blender?.found ? `Blender ${caps.blender.version ?? ""} at ${caps.paths?.blender}`.trim() : "Blender: NOT FOUND",
    caps.blenderMcp ? "Blender MCP server: registered (tools named mcp__blender__*) — needs the Blender window open with the add-on connected" : "Blender MCP server: not registered — use Blender in background mode (-b -P script.py)",
    `Mixamo library: ${caps.paths?.mixamoLibrary} (${caps.mixamo?.clips?.length ?? 0} clips, ${caps.mixamo?.characters ?? 0} characters)`,
    caps.cascadeur?.found ? `Cascadeur: installed at ${caps.paths?.cascadeur}${caps.cascadeurMcp ? " (cascadeur MCP registered)" : " (no MCP — use the Blender fallback for custom motion)"}` : "Cascadeur: NOT INSTALLED — animate Cascadeur actions with the Blender fallback",
  ];
  return [
    "Use the animation-director skill to produce this animated video end to end on this PC: build the scenes in Blender, apply Mixamo clips and Cascadeur motion as the plan routes them, render every scene, and encode the final video.",
    "",
    `Project id: ${project.id}`,
    `Job folder (your working directory): ${jobDir}`,
    "The full brief and the director's approved plan are in job.json in the job folder. Follow the plan: its scenes, timing, cameras and tool routing.",
    "",
    "What this PC has:",
    ...have.map((h) => `- ${h}`),
    "",
    "This is an unattended render started from the 3D Studio Video Creator app. Nobody can answer questions: make sensible decisions,",
    "keep the render achievable on this machine, and record anything you change or leave out in report.json under `cut`.",
    "Write studio/status.json at the start of every stage, save look-dev stills to studio/stills/, render the video to",
    "studio/render/final.mp4, and finish by writing studio/report.json. If something blocks you completely, write report.json",
    'with stage "failed" and an error, then stop.',
  ].join("\n");
}

/** One-line summary of a tool call, without dumping its arguments. */
export function describeToolUse(block) {
  const name = String(block?.name ?? "tool");
  const input = block?.input ?? {};
  const short = name.replace(/^mcp__[^_]+(?:_[^_]+)*?__/, "");
  if (/^mcp__blender/.test(name)) return `→ Blender: ${short}`;
  if (/^mcp__cascadeur/.test(name)) return `→ Cascadeur: ${short}`;
  if (short === "Bash" || short === "PowerShell") {
    const cmd = String(input.command ?? "");
    if (/blender(\.exe)?["']?\s/i.test(cmd)) {
      const script = cmd.match(/-P\s+"?([^"\s]+\.py)/i)?.[1];
      return `→ Blender (background)${script ? `: ${script.split(/[\\/]/).pop()}` : ""}`;
    }
    return `→ ${short}: ${cmd.replace(/\s+/g, " ").slice(0, 90)}`;
  }
  if (["Write", "Edit", "Read"].includes(short) && input.file_path) return `→ ${short} ${String(input.file_path).split(/[\\/]/).slice(-2).join("/")}`;
  return `→ ${short}`;
}

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

/** Spawn `claude -p` and stream its events. Resolves with {code, result, lastLines, aborted}. */
export function runClaude({ prompt, cwd, model, onLine, signal }) {
  return new Promise((resolve) => {
    // The prompt goes in on stdin: on Windows `claude` is an npm .cmd shim run
    // through the shell, which would mangle a multi-line argument with quotes.
    const args = ["-p", "--output-format", "stream-json", "--verbose", "--permission-mode", "bypassPermissions"];
    if (model && /^[\w.:-]+$/.test(model)) args.push("--model", model);

    const child = spawn("claude", args, { cwd, shell: process.platform === "win32", windowsHide: true, env: process.env, stdio: ["pipe", "pipe", "pipe"] });
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
      resolve({ code: -1, result, lastLines, aborted: false });
    });
    child.on("close", (code) => {
      signal?.removeEventListener("abort", onAbort);
      resolve({ code, result, lastLines, aborted: Boolean(signal?.aborted) });
    });
  });
}
