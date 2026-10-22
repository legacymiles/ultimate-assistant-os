// ---------------------------------------------------------------------------
// The agent keeps itself working — the owner should never have to.
//
// What broke it before: the hub folder moved out of OneDrive (Oct 2026), the
// "start at sign-in" shortcut still pointed at the old folder, and the npm
// packages didn't come along. The PC was on, Jarvis was open, and nothing was
// listening. So every time it starts, the agent now:
//
//   1. points the Startup shortcut at THIS folder (wherever it lives now)
//   2. registers jarvis-agent:// so the website's "Start" button can launch it
//   3. installs its own packages and browser if they are missing, then
//      restarts itself so they are picked up
//
// All of it is Windows-only and best-effort: a failure is logged and reported
// on /health, never fatal — the agent still answers with what it has.
// ---------------------------------------------------------------------------

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const isWindows = process.platform === "win32";

/** What /health reports about setup, for the page to show in plain words. */
export const setup = { state: "ready", why: "" };

function run(command, cwd) {
  return new Promise((done) => {
    // One command string (no args array) — shell:true with args is deprecated.
    const child = spawn(command, { cwd, shell: true, windowsHide: true, stdio: "ignore" });
    child.on("error", () => done(1));
    child.on("exit", (code) => done(code ?? 1));
  });
}

function ps(script) {
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  return run(`powershell -NoProfile -NonInteractive -EncodedCommand ${encoded}`);
}

async function ensureStartup(here) {
  const vbs = join(here, "start-hidden.vbs").replace(/'/g, "''");
  const dir = here.replace(/'/g, "''");
  // Rewritten every start: cheap, and it is what follows the folder if it moves again.
  const code = await ps(
    [
      "$lnk = Join-Path $env:APPDATA 'Microsoft\\Windows\\Start Menu\\Programs\\Startup\\New Jarvis agent.lnk'",
      "$s = (New-Object -ComObject WScript.Shell).CreateShortcut($lnk)",
      "$s.TargetPath = 'wscript.exe'",
      `$s.Arguments = '"${vbs}"'`,
      `$s.WorkingDirectory = '${dir}'`,
      "$s.Description = 'New Jarvis local agent'",
      "$s.Save()",
    ].join("; "),
  );
  if (code !== 0) console.error("  self-heal: could not update the Startup shortcut");
}

async function ensureProtocol(here) {
  const vbs = join(here, "start-hidden.vbs");
  const key = "HKCU\\Software\\Classes\\jarvis-agent";
  const cmd = `wscript.exe \\"${vbs}\\"`;
  const steps = [
    `reg add "${key}" /ve /d "URL:New Jarvis agent" /f`,
    `reg add "${key}" /v "URL Protocol" /d "" /f`,
    `reg add "${key}\\shell\\open\\command" /ve /d "${cmd}" /f`,
  ];
  for (const s of steps) {
    if ((await run(s)) !== 0) {
      console.error("  self-heal: could not register jarvis-agent:// (the website's Start button)");
      return;
    }
  }
}

function hasPackages(here) {
  return (
    existsSync(join(here, "node_modules", "playwright", "package.json")) &&
    existsSync(join(here, "node_modules", "@anthropic-ai", "claude-agent-sdk", "package.json"))
  );
}

/**
 * Install what is missing, then restart so the new packages load. Returns
 * true when a restart was started (the caller should exit soon after).
 */
async function ensurePackages(here) {
  if (hasPackages(here)) return false;
  setup.state = "installing";
  setup.why = "Setting itself up on this PC (one time, a few minutes).";
  console.log("  self-heal: packages missing — installing them now…");
  const npm = await run("npm install --no-audit --no-fund", here);
  if (npm !== 0 || !hasPackages(here)) {
    setup.state = "failed";
    setup.why = "It couldn't install its packages. Check that Node.js is installed and this PC is online, then restart it.";
    console.error("  self-heal: npm install failed");
    return false;
  }
  console.log("  self-heal: downloading the browser it drives (about 150 MB, once)…");
  await run("npx --yes playwright install chromium", here);
  console.log("  self-heal: done — restarting to load them");
  return true;
}

/** Run on every start. Never throws. */
export async function selfHeal(here, restart) {
  if (!isWindows) return;
  try {
    await ensureStartup(here);
    await ensureProtocol(here);
    if (await ensurePackages(here)) restart();
  } catch (e) {
    console.error("  self-heal:", e?.message ?? e);
  }
}
