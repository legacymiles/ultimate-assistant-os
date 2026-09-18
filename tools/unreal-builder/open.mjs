#!/usr/bin/env node
// Handles ueos:// links from the Game Creator page.
//
//   ueos://open?id=<gameId>   open the game's project in the Unreal Editor
//   ueos://play?id=<gameId>   launch the packaged game (or the project in -game mode)
//
// Windows passes the whole URL as the first argument. The id is looked up in
// the bridge's registry; nothing from the URL is ever used as a path or a
// command, so a crafted link can only open a game this PC already built.

import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./lib/env.mjs";
import { projectForGame } from "./lib/watch.mjs";

const ENGINE = process.env.UE_ENGINE_DIR || "C:\\Program Files\\Epic Games\\UE_5.8";

export function parseLink(raw) {
  let url;
  try {
    url = new URL(String(raw ?? ""));
  } catch {
    return null;
  }
  if (url.protocol !== "ueos:") return null;
  // ueos://open?id=x parses with host "open"; ueos:open?id=x with pathname "open".
  const action = (url.hostname || url.pathname).replace(/^\/+|\/+$/g, "").toLowerCase();
  const id = url.searchParams.get("id") ?? "";
  if (!["open", "play"].includes(action)) return null;
  if (!/^[A-Za-z0-9-]{8,64}$/.test(id)) return null;
  return { action, id };
}

async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const link = parseLink(process.argv[2]);
  if (!link) {
    console.error("Not a Game Creator link:", process.argv[2]);
    process.exit(2);
  }
  const { projectsRoot } = config();
  const game = await projectForGame(projectsRoot, link.id);
  if (!game) {
    console.error(`No game ${link.id} on this PC.`);
    process.exit(3);
  }

  const editor = path.join(ENGINE, "Engine", "Binaries", "Win64", "UnrealEditor.exe");
  if (link.action === "play" && game.packagedExe && (await exists(game.packagedExe))) {
    spawn(game.packagedExe, [], { detached: true, stdio: "ignore", cwd: path.dirname(game.packagedExe) }).unref();
  } else if (link.action === "play") {
    spawn(editor, [game.uproject, "-game", "-windowed", "-ResX=1600", "-ResY=900"], { detached: true, stdio: "ignore" }).unref();
  } else {
    spawn(editor, [game.uproject, "-ModelContextProtocolStartServer"], { detached: true, stdio: "ignore" }).unref();
  }
}

// fileURLToPath, not URL.pathname: this folder has spaces ("claude code files"), which the
// pathname keeps as %20, so the check never matched and every link silently did nothing.
if (process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === path.resolve(fileURLToPath(import.meta.url)).toLowerCase()) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
