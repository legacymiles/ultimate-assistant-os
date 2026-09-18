import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { runUat } from "./paths.mjs";
import { REQUIRED_PLUGINS } from "./project.mjs";
import { watchSdkChecks } from "./sdkcheck.mjs";

// Package a project into a standalone Windows game with Unreal's automation
// tool. A Blueprint-only project needs no C++ compiler: BuildCookRun stages the
// engine's prebuilt game binaries with the cooked content.

async function findExe(dir) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  // The launcher exe sits at the top of the staged folder; the real binary is
  // under <Project>/Binaries/Win64. Prefer the top-level one: it sets up paths.
  const top = entries.find((e) => e.isFile() && e.name.toLowerCase().endsWith(".exe") && !/crashreport/i.test(e.name));
  if (top) return path.join(dir, top.name);
  for (const e of entries) {
    if (e.isDirectory()) {
      const hit = await findExe(path.join(dir, e.name));
      if (hit) return hit;
    }
  }
  return null;
}

/** Plugins limited to editor targets never affect how the game is built. */
function editorOnly(plugin) {
  const allow = plugin.TargetAllowList;
  return Array.isArray(allow) && allow.length > 0 && allow.every((t) => t === "Editor");
}

/**
 * Package from a .uproject that lists only editor-only plugins, then put the
 * original back — always, even if packaging throws.
 *
 * AutomationTool treats a Blueprint project as code-based whenever it enables
 * a runtime plugin the engine does not enable by default. The log says it
 * plainly: "has no code, but is being treated as a code-based project ...
 * because: GameplayStateTree plugin is enabled" — and the stock FirstPerson
 * template enables that one itself. A code-based package run then needs either
 * a compiled <Project>Editor.target (never built here) or UnrealBuildTool with
 * the .NET Framework SDK (not installed). Editor-only plugins are not counted.
 *
 * So for the duration of the run every runtime plugin is removed, the
 * MCP/toolset plugins included. The ones removed are reported, because a game
 * that really uses one will show cook errors for it.
 */
export async function withPackagingUproject(uproject, run) {
  const original = await fs.readFile(uproject, "utf8");
  const doc = JSON.parse(original);
  const plugins = doc.Plugins ?? [];
  const removed = plugins.filter((p) => REQUIRED_PLUGINS.includes(p.Name) || !editorOnly(p)).map((p) => p.Name);
  doc.Plugins = plugins.filter((p) => !removed.includes(p.Name));
  const backup = `${uproject}.gamecreator-backup`;
  await fs.writeFile(backup, original, "utf8");
  await fs.writeFile(uproject, JSON.stringify(doc, null, "\t"), "utf8");
  try {
    return await run(removed);
  } finally {
    await fs.writeFile(uproject, original, "utf8");
    await fs.rm(backup, { force: true });
  }
}

export async function packageGame(uproject, opts = {}) {
  return withPackagingUproject(uproject, async (removed) => {
    const result = await runBuildCookRun(uproject, opts);
    return { ...result, pluginsLeftOutOfPackage: removed.filter((n) => !REQUIRED_PLUGINS.includes(n)) };
  });
}

async function runBuildCookRun(uproject, { outDir, onLine, timeoutMs = 60 * 60_000 } = {}) {
  const projectDir = path.dirname(uproject);
  const archive = outDir ?? path.join(projectDir, "Packaged");
  await fs.mkdir(archive, { recursive: true });

  const args = [
    "BuildCookRun",
    `-project=${uproject}`,
    "-noP4",
    "-platform=Win64",
    "-clientconfig=Development",
    "-cook",
    // No -build. A Blueprint-only project on a launcher engine stages the
    // engine's prebuilt UnrealGame binaries. -build makes UAT run
    // UnrealBuildTool on <Project>Editor, which fails without the .NET
    // Framework SDK ("RulesError: Could not find NetFxSDK install dir").
    "-stage",
    "-pak",
    "-archive",
    `-archivedirectory=${archive}`,
    "-unattended",
    "-utf8output",
    // No -nocompileeditor / -skipbuildeditor: with those, UAT looks for a
    // <Project>Editor.target in the project's Binaries, which a Blueprint-only
    // project on a launcher engine never has ("Could not find file ...target").
  ];

  const tail = [];
  const code = await new Promise((resolve) => {
    // RunUAT.bat is a batch file, so it has to go through cmd. Paths contain
    // spaces; quoting each argument keeps cmd from splitting them.
    const quoted = [`"${runUat()}"`, ...args.map((a) => `"${a}"`)].join(" ");
    const child = spawn("cmd.exe", ["/d", "/s", "/c", `"${quoted}"`], { windowsVerbatimArguments: true, windowsHide: true });
    const timer = setTimeout(() => child.kill(), timeoutMs);
    // The cook runs the engine's SDK check, which can hang forever here (sdkcheck.mjs).
    const stopSdkWatch = watchSdkChecks();
    const feed = (buf) => {
      for (const line of String(buf).split(/\r?\n/)) {
        if (!line.trim()) continue;
        tail.push(line);
        if (tail.length > 200) tail.shift();
        onLine?.(line);
      }
    };
    child.stdout.on("data", feed);
    child.stderr.on("data", feed);
    child.on("close", (c) => {
      clearTimeout(timer);
      stopSdkWatch();
      resolve(c);
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      stopSdkWatch();
      tail.push(String(err));
      resolve(-1);
    });
  });

  const exe = code === 0 ? await findExe(path.join(archive, "Windows")) ?? (await findExe(archive)) : null;
  const errors = tail.filter((l) => /error|failed|exception/i.test(l)).slice(-25);
  return { ok: code === 0 && Boolean(exe), exitCode: code, exe, archive, errors, logTail: tail.slice(-60).join("\n") };
}
