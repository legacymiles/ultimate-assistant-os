import { spawn, execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { DEFAULT_PORT, editorExe, stateDir } from "./paths.mjs";
import { EpicClient, ping } from "./epic.mjs";

// The Unreal Editor's lifecycle, as the bridge sees it.
//
// There is at most one editor per bridge: Epic's MCP server binds a fixed port,
// and one game is built at a time. Which editor is running is recorded in
// <projects>/.game-creator/editor.json so a restarted bridge (a new Claude
// session) re-attaches instead of launching a second copy.

const RECORD = () => path.join(stateDir(), "editor.json");

export function mcpUrl(port = DEFAULT_PORT) {
  return `http://127.0.0.1:${port}/mcp`;
}

async function readRecord() {
  try {
    return JSON.parse(await fs.readFile(RECORD(), "utf8"));
  } catch {
    return null;
  }
}

async function writeRecord(rec) {
  await fs.mkdir(stateDir(), { recursive: true });
  if (rec) await fs.writeFile(RECORD(), JSON.stringify(rec, null, 2), "utf8");
  else await fs.rm(RECORD(), { force: true });
}

/** Whether a Windows process with this pid exists. */
export function pidAlive(pid) {
  if (!pid) return Promise.resolve(false);
  try {
    process.kill(pid, 0);
    return Promise.resolve(true);
  } catch (err) {
    return Promise.resolve(err.code === "EPERM");
  }
}

/** Every running UnrealEditor.exe pid (there should be at most one). */
export function editorPids() {
  return new Promise((resolve) => {
    execFile("tasklist", ["/FI", "IMAGENAME eq UnrealEditor.exe", "/FO", "CSV", "/NH"], (err, stdout) => {
      if (err) return resolve([]);
      const pids = [...String(stdout).matchAll(/"UnrealEditor\.exe","(\d+)"/gi)].map((m) => Number(m[1]));
      resolve(pids);
    });
  });
}

/**
 * What is running right now: the recorded editor if its process is alive, plus
 * whether its MCP server answers. Clears a stale record.
 */
export async function status() {
  const rec = await readRecord();
  if (rec && !(await pidAlive(rec.pid))) {
    await writeRecord(null);
    return { running: false, mcpReady: false, others: await editorPids() };
  }
  if (!rec) {
    const others = await editorPids();
    // An editor we did not launch may still be serving MCP (opened by hand).
    const ready = others.length ? await ping(mcpUrl()) : false;
    return { running: others.length > 0, mcpReady: ready, pid: others[0], external: others.length > 0, others };
  }
  return { running: true, mcpReady: await ping(mcpUrl(rec.port)), ...rec };
}

export function projectLogPath(uproject) {
  const dir = path.dirname(uproject);
  const name = path.basename(uproject, ".uproject");
  return path.join(dir, "Saved", "Logs", `${name}.log`);
}

export async function logTail(uproject, { lines = 60, grep } = {}) {
  let text;
  try {
    text = await fs.readFile(projectLogPath(uproject), "utf8");
  } catch {
    return "(no editor log yet)";
  }
  let rows = text.split(/\r?\n/);
  if (grep) {
    const re = new RegExp(grep, "i");
    rows = rows.filter((r) => re.test(r));
  }
  return rows.slice(-lines).join("\n");
}

/**
 * Launch the editor on a project with Epic's MCP server started.
 * Refuses when a different editor is already running, rather than fighting it
 * for the port.
 */
export async function launch(uproject, { port = DEFAULT_PORT } = {}) {
  const current = await status();
  if (current.running) {
    const same = current.uproject && path.resolve(current.uproject).toLowerCase() === path.resolve(uproject).toLowerCase();
    if (same) return { ...current, alreadyRunning: true };
    throw new Error(
      `Another Unreal Editor is already running (pid ${current.pid}${current.uproject ? `, ${current.uproject}` : ""}). ` +
        "Close it first with unreal_close_editor.",
    );
  }
  await fs.access(uproject);
  const child = spawn(
    editorExe(),
    [uproject, "-ModelContextProtocolStartServer", `-ModelContextProtocolPort=${port}`, "-NoSplash"],
    { detached: true, stdio: "ignore", windowsHide: false },
  );
  child.unref();
  const rec = { pid: child.pid, uproject: path.resolve(uproject), port, startedAt: new Date().toISOString() };
  await writeRecord(rec);
  return rec;
}

/**
 * Poll until Epic's MCP server answers. The first launch of a project compiles
 * shaders and can take many minutes; later launches take about a minute.
 */
export async function waitReady({ port = DEFAULT_PORT, pid, uproject, timeoutMs = 20 * 60_000, onTick } = {}) {
  const start = Date.now();
  for (;;) {
    if (await ping(mcpUrl(port))) return { readyAfterMs: Date.now() - start };
    if (pid && !(await pidAlive(pid))) {
      await writeRecord(null);
      const tail = uproject ? await logTail(uproject, { lines: 40 }) : "";
      throw new Error(`The editor exited before its MCP server started.\n${tail}`);
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error(`The editor did not start its MCP server within ${Math.round(timeoutMs / 60000)} minutes.`);
    }
    onTick?.(Date.now() - start);
    await new Promise((r) => setTimeout(r, 5000));
  }
}

/**
 * Save everything, then end the editor.
 *
 * Epic's toolset has no "quit" tool and its script sandbox cannot reach the
 * Unreal API, so the clean part is saving every dirty asset through the MCP
 * server; the process is then ended. Saved assets are all that matters for a
 * Blueprint project, and it is what the packager reads.
 */
export async function close({ graceMs = 3000 } = {}) {
  const current = await status();
  const pid = current.pid;
  if (!current.running || !pid) {
    await writeRecord(null);
    return { closed: false, reason: "No editor was running." };
  }

  let saved = null;
  if (current.mcpReady) {
    try {
      const c = new EpicClient(mcpUrl(current.port ?? DEFAULT_PORT));
      await c.initialize();
      await c.callToolset("editor_toolset.toolsets.asset.AssetTools", "save_assets", { asset_paths: [] }, { timeoutMs: 120_000 });
      saved = true;
      await c.close();
    } catch (err) {
      saved = `save failed: ${err.message}`;
    }
  }

  await new Promise((r) => setTimeout(r, graceMs));
  await new Promise((resolve) => execFile("taskkill", ["/PID", String(pid), "/T", "/F"], () => resolve()));
  for (let i = 0; i < 30 && (await pidAlive(pid)); i++) await new Promise((r) => setTimeout(r, 500));
  await writeRecord(null);
  return { closed: true, pid, saved };
}
