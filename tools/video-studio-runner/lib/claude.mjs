import { spawn } from "node:child_process";

/**
 * Run Claude Code headless on one job.
 *
 * Only fixed flags go on the command line: on Windows `claude` is an npm .cmd
 * shim run through the shell, which mangles quoted arguments. The prompt goes
 * in on stdin as a stream-json user message.
 */
export function runClaude({ prompt, cwd, model, openrouterKey, onLine, signal }) {
  return new Promise((resolve) => {
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
    if (model && /^[\w.:/-]+$/.test(model)) args.push("--model", model);

    const child = spawn("claude", args, {
      cwd,
      shell: process.platform === "win32",
      windowsHide: true,
      env: claudeEnv(model, openrouterKey),
      stdio: ["pipe", "pipe", "pipe"],
    });
    child.stdin.on("error", () => {});

    const tail = [];
    let buffer = "";
    let result = null;

    const emit = (line) => {
      tail.push(line);
      if (tail.length > 40) tail.shift();
      onLine?.(line);
    };

    child.stdout.on("data", (chunk) => {
      buffer += chunk.toString();
      let nl;
      while ((nl = buffer.indexOf("\n")) !== -1) {
        const raw = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        if (!raw.trim()) continue;
        let event;
        try {
          event = JSON.parse(raw);
        } catch {
          emit(raw.slice(0, 400));
          continue;
        }
        if (event.type === "result") {
          result = event;
          continue;
        }
        for (const part of event?.message?.content ?? []) {
          if (part.type === "text" && part.text?.trim()) {
            for (const line of part.text.split(/\r?\n/)) if (line.trim()) emit(line.trim().slice(0, 400));
          } else if (part.type === "tool_use" && part.name) {
            emit(`· ${part.name}`);
          }
        }
      }
    });

    child.stderr.on("data", (chunk) => {
      for (const line of chunk.toString().split(/\r?\n/)) if (line.trim()) emit(line.trim().slice(0, 400));
    });

    const abort = () => child.kill();
    signal?.addEventListener("abort", abort, { once: true });

    child.on("error", (err) => {
      signal?.removeEventListener("abort", abort);
      resolve({ ok: false, error: `Could not start Claude Code: ${err.message}`, tail });
    });

    child.on("close", (code) => {
      signal?.removeEventListener("abort", abort);
      if (signal?.aborted) {
        resolve({ ok: false, error: "The job hit the runner's time limit and was stopped.", tail });
        return;
      }
      if (result?.is_error || code !== 0) {
        const message = result?.result || tail.slice(-6).join(" · ") || `Claude Code exited with code ${code}`;
        resolve({ ok: false, error: String(message).slice(0, 1000), tail });
        return;
      }
      resolve({ ok: true, summary: String(result?.result ?? "").slice(0, 1000), tail });
    });

    child.stdin.write(
      `${JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "text", text: prompt }] } })}\n`,
    );
    child.stdin.end();
  });
}

/**
 * A non-Anthropic model id means the session has to be pointed at OpenRouter,
 * which Claude Code only does through these headers.
 */
function claudeEnv(model, openrouterKey) {
  const env = { ...process.env };
  const isOpenRouter = model && !/^claude|^anthropic\//.test(model);
  if (isOpenRouter && openrouterKey) {
    env.ANTHROPIC_BASE_URL = "https://openrouter.ai/api/v1";
    env.ANTHROPIC_AUTH_TOKEN = openrouterKey;
    env.ANTHROPIC_CUSTOM_HEADERS = `HTTP-Referer: https://ultimate-assistant-os.vercel.app\nX-Title: Video Studio Arena`;
  }
  return env;
}
