import { spawn, execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { editorExe } from "./paths.mjs";
import { watchSdkChecks } from "./sdkcheck.mjs";

// Screenshots of the game as a player sees it: first-person arms and weapon,
// HUD, post-process, no editor icons. The editor's CaptureViewport cannot do
// that (it renders the level viewport, sprites and all), so this launches the
// game itself — the packaged exe, or the project in standalone -game mode —
// and has the engine screenshot its own window after a delay.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function newestPng(dir, since) {
  let best = null;
  async function walk(d) {
    let entries;
    try {
      entries = await fs.readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.name.toLowerCase().endsWith(".png")) {
        const st = await fs.stat(p);
        if (st.mtimeMs >= since && st.size > 0 && (!best || st.mtimeMs > best.mtime)) best = { file: p, mtime: st.mtimeMs };
      }
    }
  }
  await walk(dir);
  return best?.file ?? null;
}

function killTree(pid) {
  return new Promise((resolve) => execFile("taskkill", ["/PID", String(pid), "/T", "/F"], () => resolve()));
}

/**
 * Launch the game, wait `seconds` of play, save one screenshot with the HUD
 * into <project>/GameCreator/shots/<name>.png. `packaged` uses the packaged
 * exe (what players get); otherwise the project runs in -game mode, which
 * reflects the last SAVED state of the level and assets.
 */
export async function gameShot(project, { name, caption, seconds = 10, packaged = false, timeoutMs = 360_000 } = {}) {
  const started = Date.now();
  // The engine delays a queued screenshot by frames; ~30 fps while the level warms up.
  const frames = Math.max(30, Math.round(seconds * 30));
  const exec = `r.HighResScreenshotDelay ${frames},shot showui`;
  const common = ["-windowed", "-ResX=1600", "-ResY=900", "-ForceRes", "-nosound", "-NoVerifyGC", `-ExecCmds=${exec}`];

  let cmd;
  let args;
  let shotRoot;
  if (packaged) {
    if (!project.packagedExe) throw new Error("This game has not been packaged yet; use packaged:false.");
    cmd = project.packagedExe;
    args = common;
    shotRoot = path.dirname(project.packagedExe);
  } else {
    cmd = editorExe();
    args = [project.uproject, "-game", ...common];
    shotRoot = path.join(path.dirname(project.uproject), "Saved", "Screenshots");
  }

  const child = spawn(cmd, args, { stdio: "ignore", windowsHide: false });
  const stopSdkWatch = watchSdkChecks({ everyMs: 15_000 });
  let exited = false;
  child.on("exit", () => (exited = true));
  try {
    while (Date.now() - started < timeoutMs) {
      await sleep(2000);
      const png = await newestPng(shotRoot, started);
      if (png) {
        await sleep(1500); // let the writer finish
        const safe = String(name).replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 60) || "game";
        const dir = path.join(project.projectDir, "GameCreator", "shots");
        await fs.mkdir(dir, { recursive: true });
        const out = path.join(dir, `${safe}.png`);
        await fs.copyFile(png, out);
        if (caption) {
          const capFile = path.join(dir, "captions.json");
          let caps = {};
          try {
            caps = JSON.parse(await fs.readFile(capFile, "utf8"));
          } catch {
            /* first caption */
          }
          caps[`${safe}.png`] = caption;
          await fs.writeFile(capFile, JSON.stringify(caps, null, 2), "utf8");
        }
        return { saved: out, caption: caption ?? null, afterSeconds: Math.round((Date.now() - started) / 1000) };
      }
      if (exited) throw new Error("The game closed before taking the screenshot (crash, or the map failed to load). Check the log.");
    }
    throw new Error(`No screenshot after ${Math.round(timeoutMs / 1000)} s.`);
  } finally {
    stopSdkWatch();
    if (!exited && child.pid) await killTree(child.pid);
  }
}
