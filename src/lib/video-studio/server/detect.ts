import "server-only";
import { promises as fs } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { Capability, CapabilityState, Requirement } from "../types";

// ---------------------------------------------------------------------------
// Real capability detection.
//
// Every probe in this file looks at the machine. Nothing here guesses, and
// nothing here reports "ready" because a method sounds like it should be. A
// method whose dependency is missing says which dependency and how to get it —
// that is a result the owner can act on, which a green tick over a broken
// integration is not.
//
// Probes are cached for a few seconds because the methods endpoint runs all of
// them on every poll and `where blender` is a process spawn.
// ---------------------------------------------------------------------------

const run = promisify(execFile);

const TTL_MS = 15_000;
const cache = new Map<string, { at: number; value: boolean }>();

async function cached(key: string, probe: () => Promise<boolean>): Promise<boolean> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  let value = false;
  try {
    value = await probe();
  } catch {
    value = false;
  }
  cache.set(key, { at: Date.now(), value });
  return value;
}

/** True when any of these environment variables is set to something. */
export function hasEnv(...names: string[]): boolean {
  return names.some((n) => Boolean((process.env[n] ?? "").trim()));
}

/** True when the command resolves on PATH. */
export function commandExists(command: string): Promise<boolean> {
  return cached(`cmd:${command}`, async () => {
    const finder = process.platform === "win32" ? "where" : "which";
    await run(finder, [command], { timeout: 4000 });
    return true;
  });
}

/** True when any of these paths exists. Globs are not supported; prefixes are. */
export function pathExists(...candidates: string[]): Promise<boolean> {
  return cached(`path:${candidates.join("|")}`, async () => {
    for (const candidate of candidates) {
      try {
        await fs.stat(candidate);
        return true;
      } catch {
        // keep looking
      }
    }
    return false;
  });
}

/** True when a directory holds at least one entry whose name starts with `prefix`. */
export function dirHasPrefix(dir: string, prefix: string): Promise<boolean> {
  return cached(`prefix:${dir}:${prefix}`, async () => {
    const entries = await fs.readdir(dir);
    return entries.some((e) => e.startsWith(prefix));
  });
}

/**
 * True when an MCP server of this name is registered with Claude Code.
 *
 * Registered is not the same as connected — the server could be registered and
 * failing to start — so every summary built from this says "registered", and
 * the executing agent checks the live tools before doing anything. It is still
 * the strongest signal available from a web process.
 */
export function mcpRegistered(name: string): Promise<boolean> {
  return cached(`mcp:${name}`, async () => {
    const file = process.env.CLAUDE_CONFIG_PATH || path.join(os.homedir(), ".claude.json");
    const raw = await fs.readFile(file, "utf8");
    const config = JSON.parse(raw) as {
      mcpServers?: Record<string, unknown>;
      projects?: Record<string, { mcpServers?: Record<string, unknown> }>;
    };
    if (config.mcpServers && name in config.mcpServers) return true;
    for (const project of Object.values(config.projects ?? {})) {
      if (project?.mcpServers && name in project.mcpServers) return true;
    }
    return false;
  });
}

/** True when a Claude Code skill folder of this name exists. */
export function skillInstalled(name: string): Promise<boolean> {
  const roots = [
    path.join(os.homedir(), ".claude", "skills", name),
    path.resolve("skills", name),
    path.resolve(".claude", "skills", name),
  ];
  return pathExists(...roots);
}

// ----- engine-specific probes ------------------------------------------------

/** Blender: PATH, BLENDER_PATH, or a standard Windows/macOS install. */
export async function blenderInstalled(): Promise<boolean> {
  const configured = (process.env.BLENDER_PATH ?? "").trim();
  if (configured && (await pathExists(configured))) return true;
  if (await commandExists("blender")) return true;
  if (process.platform === "win32") {
    return dirHasPrefix("C:\\Program Files\\Blender Foundation", "Blender").catch(() => false);
  }
  return pathExists("/Applications/Blender.app/Contents/MacOS/Blender");
}

/** Unreal Engine: UNREAL_ENGINE_DIR, or an Epic Games launcher install. */
export async function unrealInstalled(): Promise<boolean> {
  const configured = (process.env.UNREAL_ENGINE_DIR ?? "").trim();
  if (configured && (await pathExists(configured))) return true;
  if (process.platform === "win32") {
    return dirHasPrefix("C:\\Program Files\\Epic Games", "UE_").catch(() => false);
  }
  return dirHasPrefix("/Users/Shared/Epic Games", "UE_").catch(() => false);
}

/** Node, which both code-render engines need on the machine that renders. */
export function nodeInstalled(): Promise<boolean> {
  return commandExists("node");
}

// ----- liveness --------------------------------------------------------------
//
// Installed is not running. Blender and Unreal both drive a LIVE application —
// the render happens inside an editor that has to be open — so a card that
// says "ready" because the software exists on disk is the same green tick over
// a broken integration this file exists to prevent. These two probes are what
// make "ready" mean a render started now would actually reach the engine.

/** True when something is listening on 127.0.0.1:<port>. */
export function portListening(port: number): Promise<boolean> {
  return cached(`port:${port}`, () => {
    return new Promise<boolean>((resolve) => {
      const socket = net.connect({ host: "127.0.0.1", port });
      const done = (value: boolean) => {
        socket.destroy();
        resolve(value);
      };
      socket.setTimeout(1500);
      socket.once("connect", () => done(true));
      socket.once("timeout", () => done(false));
      socket.once("error", () => done(false));
    });
  });
}

/** True when a process with this executable name is running. */
export function processRunning(name: string): Promise<boolean> {
  return cached(`proc:${name}`, async () => {
    if (process.platform === "win32") {
      const { stdout } = await run("tasklist", ["/FI", `IMAGENAME eq ${name}`, "/NH"], { timeout: 6000 });
      return stdout.toLowerCase().includes(name.toLowerCase());
    }
    await run("pgrep", ["-f", name], { timeout: 6000 });
    return true;
  });
}

/**
 * The ffmpeg to spawn: FFMPEG_PATH when set, else whatever is on PATH.
 *
 * The override exists because installing ffmpeg edits the user's PATH, and a
 * long-running dev server started before that edit keeps the old environment —
 * so "installed but the hub cannot see it" is a real state, and pointing at the
 * binary is a faster fix than restarting everything.
 */
export function ffmpegBin(): string {
  return (process.env.FFMPEG_PATH ?? "").trim() || "ffmpeg";
}

/** Whether the server can run ffmpeg — needed to join scenes and chain frames. */
export async function ffmpegAvailable(): Promise<boolean> {
  const configured = (process.env.FFMPEG_PATH ?? "").trim();
  if (configured) return pathExists(configured);
  return commandExists("ffmpeg");
}

// ----- building a Capability -------------------------------------------------

export function requirement(
  id: string,
  label: string,
  kind: Requirement["kind"],
  detail: string,
  met: boolean,
  howTo: string,
  optional = false,
): Requirement {
  return { id, label, kind, detail, met, howTo, optional };
}

/**
 * Roll a list of requirements into one state.
 *
 * The rule is blunt on purpose: every non-optional requirement met means
 * "ready", and anything else reports the kind of the FIRST unmet requirement,
 * so the card says the most actionable thing rather than a generic failure.
 */
export function rollUp(requirements: Requirement[], readySummary: string): Capability {
  const blocking = requirements.filter((r) => !r.optional && !r.met);
  if (blocking.length === 0) {
    return { state: "ready", summary: readySummary, requirements };
  }
  const first = blocking[0];
  const state: CapabilityState =
    first.kind === "api-key"
      ? "requires-api-key"
      : first.kind === "install" || first.kind === "gpu"
        ? "requires-installation"
        : "not-connected";
  const extra = blocking.length > 1 ? ` (+${blocking.length - 1} more)` : "";
  return { state, summary: `${first.label}: ${first.howTo}${extra}`, requirements };
}
