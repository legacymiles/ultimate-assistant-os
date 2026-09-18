import { spawn } from "node:child_process";
import { FALLBACK_SKILL } from "./skills.mjs";

// Run Claude Code headless on one game and turn its stream-json output into
// short, human-readable log lines for the gallery.

/** The instruction that pins the build to exactly one game-building skill. */
function skillLines(skill) {
  return [
    `Build skill: ${skill}. Your FIRST action must be the Skill tool with skill "${skill}"; follow it for`,
    "the whole build. Do not load any other game-building skill (gauntlet-loop is the one extra skill",
    "you use, as the quality gate below).",
  ];
}

const CHAT_LINES = [
  "The owner can write to you from the Game Creator app while you work; their messages arrive as new",
  'user turns starting with "Message from the owner". Answer each one in one or two plain sentences',
  "first (they read your text in the app's chat), then act on it. Never stop to wait for an answer:",
  "if you need a decision, say what you are assuming and carry on.",
];

export function buildPrompt(game) {
  const skill = game.skill || FALLBACK_SKILL;
  const template = game.template && game.template !== "Auto" ? game.template : null;
  return [
    ...skillLines(skill),
    "",
    "Build this game end to end in Unreal Engine 5.8 on this PC.",
    "",
    `Game id (pass it to unreal_new_project as id): ${game.id}`,
    template ? `Template the user chose: ${template}` : "Template: choose the one that fits best.",
    "",
    "The user's prompt:",
    '"""',
    game.prompt,
    '"""',
    "",
    "This build runs unattended from the Game Creator app. Make sensible decisions yourself, keep the",
    "scope achievable, and record anything you leave out in game.json under `cut`. Write",
    "GameCreator/status.json at the start of every stage, take the screenshots the skill asks for,",
    "package the game, and finish by writing GameCreator/game.json.",
    "",
    ...CHAT_LINES,
    "",
    "Looks: follow the skill's references/realism.md whenever the prompt wants a real, gritty, AAA or",
    "named-game look, and for every shooter — template variant, Poly Haven models and surfaces via",
    "unreal_find_assets / unreal_add_assets, lighting, fog, post-process, animated enemies. No",
    "prototype grid material or orange blocks may be visible in the finished game.",
    "",
    "Quality gate: once the game is playable and before packaging, run the gauntlet-loop skill on it.",
    "The critics judge ONLY unreal_game_shot images (the real game: weapon, HUD, post-process) taken",
    "fresh each round at several moments of play (spawn, mid-combat, another angle), never editor",
    "viewport captures. The builders fix the ranked issues in Unreal, save, and re-shoot. Keep going",
    "until the skill's pass bar is met or every retry round is used; do not package after a failing",
    "round while rounds remain. Put the final scores and rounds used in game.json under `gauntlet`.",
    'If something blocks you completely, write game.json with stage "failed" and an error, then stop.',
  ].join("\n");
}

/** How one owner message is handed to Claude. */
export function ownerMessage(text) {
  return `Message from the owner (sent from the Game Creator app):\n"""\n${text}\n"""`;
}

/**
 * A follow-up build: the owner asked for changes to a finished game. With a
 * saved session the conversation continues (Claude remembers the build);
 * without one Claude starts fresh on the existing project.
 */
export function followUpPrompt(game, messages, { resumed }) {
  const skill = game.skill || FALLBACK_SKILL;
  const asks = messages.map((m) => ownerMessage(m.text)).join("\n\n");
  const where = game.paths?.uproject
    ? `The project is ${game.paths.uproject} (game id ${game.id}).`
    : `The game id is ${game.id}; find its project with unreal_list_games.`;
  return [
    resumed
      ? "The owner has reviewed the game you built and asks for changes."
      : "The owner asks for changes to a game this pipeline already built. You have no memory of that build.",
    where,
    "",
    asks,
    "",
    ...(resumed ? [] : [...skillLines(skill), "", "The original prompt was:", '"""', game.prompt, '"""', ""]),
    "Reply to the owner in one or two sentences first, then make the changes in the existing project",
    "(do not create a new one). Write GameCreator/status.json at each stage, take fresh unreal_game_shot",
    `screenshots of what changed under NEW names (prefix "r${Date.now().toString(36).slice(-4)}-"; the app skips names it`,
    "already has), re-package, and finish by rewriting GameCreator/game.json with",
    '"stage": "ready" (keep its existing fields, update what changed). Run the gauntlet-loop again if the',
    "change affects how the game looks.",
    "",
    ...CHAT_LINES,
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
  if (short === "Skill") return `→ skill ${input.skill ?? ""}`;
  if (short === "unreal_new_project") {
    return `→ new project "${input.name ?? ""}" (${input.template ?? "FirstPerson"}${input.variant ? ` / ${input.variant}` : ""})`;
  }
  if (short === "unreal_screenshot") return `→ screenshot ${input.name ?? ""}${input.view ? ` (${input.view})` : ""}`;
  if (short === "unreal_game_shot") return `→ game screenshot ${input.name ?? ""}${input.packaged ? " (packaged)" : ""}`;
  if (short === "unreal_add_assets") {
    return `→ import assets (${(input.models ?? []).length} models, ${(input.surfaces ?? []).length} surfaces)`;
  }
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
 * Spawn `claude -p` in stream-json mode and keep its stdin open, so the
 * owner's messages can join the running session as new user turns.
 *
 * Returns {done, send, end}. `done` resolves with
 * {code, result, lastLines, aborted, sessionId}. Callbacks:
 *   onLine(line)     readable log line
 *   onSession(id)    Claude's session id (kept for --resume on follow-ups)
 *   onSkill(name)    Claude invoked the Skill tool with this skill
 *   onTurnEnd()      a turn finished; resolve to an array of texts to send
 *                    next, or [] to end the session
 * `send(text)` queues a message into the running session at any time.
 */
export function runClaude({ prompt, cwd, model, resume, onLine, onSession, onSkill, onTurnEnd, signal }) {
  let child = null;
  let open = true;

  const write = (text) => {
    if (!open || !child) return false;
    child.stdin.write(`${JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "text", text }] } })}\n`);
    return true;
  };
  const end = () => {
    if (!open || !child) return;
    open = false;
    child.stdin.end();
  };

  const done = new Promise((resolve) => {
    // Only fixed flags pass through the command line: on Windows `claude` is an
    // npm .cmd shim run through the shell, which mangles quoted arguments.
    // Every prompt goes in on stdin as a stream-json user message.
    const args = [
      "-p",
      "--input-format",
      "stream-json",
      "--output-format",
      "stream-json",
      "--verbose",
      "--permission-mode",
      "bypassPermissions",
    ];
    if (model && /^[\w.:-]+$/.test(model)) args.push("--model", model);
    if (resume && /^[\w-]{8,80}$/.test(resume)) args.push("--resume", resume);

    child = spawn("claude", args, {
      cwd,
      shell: process.platform === "win32",
      windowsHide: true,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    child.stdin.on("error", () => {});
    const lastLines = [];
    let result = null;
    let sessionId = null;
    let buffer = "";

    const emit = (line) => {
      lastLines.push(line);
      if (lastLines.length > 40) lastLines.shift();
      onLine?.(line);
    };

    // A message written mid-turn is folded into that turn (verified: it does not
    // get a result of its own), so there is no turn counting. When a turn ends,
    // send whatever the owner wrote since, or close stdin. A message written
    // just before stdin closes is still read and answered before Claude exits.
    const turnEnded = async () => {
      let next = [];
      try {
        next = (await onTurnEnd?.()) ?? [];
      } catch {
        next = [];
      }
      if (next.length && open) for (const text of next) write(text);
      else end();
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
        if (ev.type === "system" && ev.subtype === "init" && ev.session_id && ev.session_id !== sessionId) {
          sessionId = ev.session_id;
          onSession?.(sessionId);
        }
        if (ev.type === "assistant" && Array.isArray(ev.message?.content)) {
          for (const b of ev.message.content) {
            if (b.type === "tool_use" && b.name === "Skill" && b.input?.skill) onSkill?.(String(b.input.skill));
          }
        }
        for (const line of linesFromEvent(ev)) emit(line);
        if (ev.type === "result") {
          result = ev;
          void turnEnded();
        }
      }
    });
    child.stderr.on("data", (chunk) => {
      for (const line of String(chunk).split(/\r?\n/)) if (line.trim()) emit(`stderr: ${line.trim().slice(0, 400)}`);
    });

    const onAbort = () => child.kill();
    signal?.addEventListener("abort", onAbort, { once: true });

    child.on("error", (err) => {
      open = false;
      emit(`Could not start Claude Code: ${err.message}`);
      resolve({ code: -1, result, lastLines, sessionId });
    });
    child.on("close", (code) => {
      open = false;
      signal?.removeEventListener("abort", onAbort);
      resolve({ code, result, lastLines, aborted: Boolean(signal?.aborted), sessionId });
    });
  });

  write(prompt);
  return { done, send: write, end };
}
