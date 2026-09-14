#!/usr/bin/env node
// Game Creator builder — runs on the PC that has Unreal Engine 5.8.
//
//   npm run builder          keep checking the hub for queued games and build them
//   npm run builder:once     build at most one game, then exit
//
// For each game: claim it from the hub, run Claude Code headless with the
// unreal-game-builder skill, stream Claude's progress and the project folder's
// files (design, screenshots, manifest) back to the hub, and mark the game
// ready or failed. One game at a time — there is one Unreal Editor.

import { config } from "./lib/env.mjs";
import { HubClient } from "./lib/hub.mjs";
import { buildPrompt, runClaude } from "./lib/claude.mjs";
import { watchGame } from "./lib/watch.mjs";

const cfg = config();
const once = process.argv.includes("--once");
const hub = new HubClient(cfg);

const log = (...a) => console.log(new Date().toLocaleTimeString(), ...a);

async function buildOne(game) {
  log(`Building "${game.prompt.slice(0, 80)}" (${game.id})`);

  // Claude's narration, batched so a chatty run is a few posts a second at most.
  let pending = [];
  const flush = async () => {
    if (!pending.length) return;
    const lines = pending.splice(0, 200);
    try {
      await hub.progress(game.id, { lines });
    } catch (err) {
      log("progress post failed:", err.message);
      pending.unshift(...lines.slice(-50));
    }
  };
  const flushTimer = setInterval(flush, 2000);

  let finalManifest = null;
  let project = null;
  const watcher = watchGame({
    projectsRoot: cfg.projectsRoot,
    gameId: game.id,
    onChange: async (change) => {
      try {
        if (change.type === "project") {
          project = change.project;
          await hub.progress(game.id, {
            status: "building",
            lines: [`Project created: ${project.uproject}`],
            paths: { uproject: project.uproject, projectDir: project.projectDir },
          });
        } else if (change.type === "status" && change.status) {
          await hub.progress(game.id, { status: change.status === "ready" || change.status === "failed" ? undefined : change.status, note: change.note });
        } else if (change.type === "design") {
          await hub.progress(game.id, { design: change.design });
        } else if (change.type === "screenshot") {
          await hub.screenshot(game.id, change.file, change.caption);
          log("uploaded", change.file);
        } else if (change.type === "manifest") {
          finalManifest = change.manifest;
          await hub.progress(game.id, { manifest: change.manifest });
        } else if (change.type === "error") {
          log("watch error:", change.error?.message ?? change.error);
        }
      } catch (err) {
        log(`sync ${change.type} failed:`, err.message);
      }
    },
  });

  const limit = new AbortController();
  const timer = setTimeout(() => limit.abort(), cfg.maxMinutes * 60_000);

  const run = await runClaude({
    prompt: buildPrompt(game),
    cwd: cfg.projectsRoot,
    model: cfg.model,
    signal: limit.signal,
    onLine: (line) => {
      pending.push(line);
      if (process.stdout.isTTY) console.log("  ", line.slice(0, 160));
    },
  });

  clearTimeout(timer);
  await watcher.stop();
  clearInterval(flushTimer);
  await flush();

  const stage = String(finalManifest?.stage ?? "").toLowerCase();
  if (stage === "ready") {
    await hub.progress(game.id, { status: "ready", note: "Ready to play", manifest: finalManifest });
    log("Ready:", finalManifest.title ?? game.id);
    return;
  }

  const reason = run.aborted
    ? `The build ran past the ${cfg.maxMinutes}-minute limit and was stopped.`
    : stage === "failed"
      ? finalManifest.error ?? "The skill reported that the build failed."
      : run.code !== 0
        ? `Claude Code exited with code ${run.code}.`
        : "Claude finished without writing a ready game.json.";
  const tail = run.lastLines.slice(-20).join("\n");
  await hub.fail(game.id, `${reason}\n\nLast output:\n${tail}`);
  log("Failed:", reason);
}

async function main() {
  log(`Builder started. Hub: ${cfg.hubUrl}. Projects: ${cfg.projectsRoot}`);
  for (;;) {
    let game = null;
    try {
      game = await hub.claim();
    } catch (err) {
      log("claim failed:", err.message);
    }

    if (game) {
      try {
        await buildOne(game);
      } catch (err) {
        log("build crashed:", err);
        await hub.fail(game.id, `The builder crashed: ${err.message}`).catch(() => {});
      }
      if (once) return;
      continue; // look for the next game straight away
    }

    if (once) {
      log("Nothing queued.");
      return;
    }
    await new Promise((r) => setTimeout(r, cfg.pollMs));
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
