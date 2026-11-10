// ---------------------------------------------------------------------------
// What THIS machine can actually do.
//
// The hub hands a 24/7 agent to a runner that says it can run it, so a runner
// that overstates itself is worse than one that is missing: the agent gets
// claimed, fails, and the owner's work sits still while a machine that could
// have done it is told there is nothing waiting. The connector's own wording
// is "only report what you have CHECKED", and this is the checking.
//
// So every capability here is a LOOK at the disk or a program that answered,
// never a guess from the platform or a config file saying it should be there.
//
// Pure where it matters: the rules take probe results, so they can be tested
// without a GPU in the room.
// ---------------------------------------------------------------------------

import { execFile } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

/** Run a program just to see whether it answers. Never throws. */
export function ran(bin, args = ["--version"], timeout = 6000) {
  return new Promise((resolve) => {
    execFile(bin, args, { timeout, windowsHide: true }, (err) => resolve(!err));
  });
}

/** The first of these that exists, or "". */
export function firstExisting(paths, exists = existsSync) {
  for (const p of paths) if (p && exists(p)) return p;
  return "";
}

/** Find an Unreal editor under any installed engine version. */
export function findUnreal(roots = ["C:/Program Files/Epic Games"], ls = readdirSync, exists = existsSync) {
  for (const root of roots) {
    let entries = [];
    try {
      entries = ls(root);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (!/^UE_/i.test(name)) continue;
      const exe = path.posix.join(String(root).replace(/\\/g, "/"), name, "Engine/Binaries/Win64/UnrealEditor.exe");
      if (exists(exe)) return exe;
    }
  }
  return "";
}

/** Find a Blender that is not on PATH, which is the normal Windows install. */
export function findBlender(roots = ["C:/Program Files/Blender Foundation"], ls = readdirSync, exists = existsSync) {
  for (const root of roots) {
    let entries = [];
    try {
      entries = ls(root);
    } catch {
      continue;
    }
    // Newest version first, so a machine with several uses the current one.
    for (const name of [...entries].sort().reverse()) {
      const exe = path.posix.join(String(root).replace(/\\/g, "/"), name, "blender.exe");
      if (exists(exe)) return exe;
    }
  }
  return "";
}

/**
 * Turn probe answers into the list the hub understands.
 *
 * Note what is NOT here: "gpu" is not reported directly. The hub already
 * treats a GPU tool as proof of a card (machineCan in agents.ts), and a
 * runner that claimed "gpu" because it saw a display adapter would be
 * claiming it can do work it has no tool for.
 */
export function needsFrom(found) {
  const have = ["shell"];
  if (found.pinokio) have.push("pinokio");
  if (found.blender) have.push("blender");
  if (found.unreal) have.push("unreal");
  if (found.ffmpeg) have.push("ffmpeg");
  // Only claimed on its own when there is a real card and no tool implied it.
  if (found.gpu && !found.pinokio && !found.blender && !found.unreal) have.push("gpu");
  return have;
}

/** One line for the log, so a machine that reports little says why. */
export function describeFound(found) {
  const on = Object.entries(found)
    .filter(([, v]) => v)
    .map(([k]) => k);
  return on.length ? on.join(", ") : "nothing heavy — it can still take agents that need only a terminal";
}

/**
 * Look at this machine.
 *
 * `env` lets a VPS override a path without code changes; everything else is
 * found by looking.
 */
export async function detect(env = process.env) {
  const wangpRoot = env.WANGP_ROOT || "C:/pinokio/api/wan/app";
  const blender = env.BLENDER_EXE || findBlender();
  const unreal = env.UNREAL_EDITOR || findUnreal();

  const found = {
    // The drawer does not have to be RUNNING: an agent's first step is to
    // start it. What matters is that the install is on this disk.
    pinokio: existsSync(path.join(wangpRoot, "shared", "api.py")),
    blender: Boolean(blender) || (await ran("blender")),
    unreal: Boolean(unreal),
    ffmpeg: await ran("ffmpeg", ["-version"]),
    gpu: await ran("nvidia-smi", ["--query-gpu=name", "--format=csv,noheader"]),
  };

  return { have: needsFrom(found), found, paths: { wangpRoot, blender, unreal } };
}
