// ---------------------------------------------------------------------------
// The two handover presses that need the PC.
//
// Both of them used to give up the moment the browser's direct route to
// 127.0.0.1 was shut, and both of them say "press Connect to my PC" — a button
// that was on a different screen. These tests hold the two things that fix:
// the press connects for itself, and it asks the PC where the site is only
// once there is a PC to ask.
// ---------------------------------------------------------------------------

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BridgeHealth } from "@/lib/new-jarvis/bridge";
import type { Blocker } from "./liveBuild";
import { createProject } from "./logic";
import type { ClientProject } from "./types";

const BLOCKED: BridgeHealth = {
  up: false,
  paired: false,
  needsLocalNetwork: true,
  needsRelay: true,
  problem: "Chrome is blocking this site from reaching your PC.",
};
const READY: BridgeHealth = { up: true, paired: true };

const probe = vi.fn<() => Promise<BridgeHealth>>();
const connectToPc = vi.fn<() => Promise<Blocker | null>>();
const call = vi.fn<(route: string, args?: Record<string, unknown>) => Promise<Record<string, unknown>>>();
const knownFolder = vi.fn<() => string>();

vi.mock("@/lib/new-jarvis/bridge", async () => {
  const actual = await vi.importActual<typeof import("@/lib/new-jarvis/bridge")>("@/lib/new-jarvis/bridge");
  return {
    ...actual,
    probe: () => probe(),
    call: (route: string, args?: Record<string, unknown>) => call(route, args),
    knownFolder: () => knownFolder(),
  };
});
vi.mock("./buildHere", () => ({ connectToPc: () => connectToPc() }));
vi.mock("@/lib/new-jarvis/harness/choice", () => ({ buildHarness: () => "claude-code" }));
vi.mock("@/lib/new-jarvis/trust", () => ({ readTrust: () => "ask" }));
vi.mock("@/lib/new-jarvis/useChatModel", () => ({ readChatModel: () => "" }));

const { siteFolder, startPluginsBuild } = await import("./handoverPc");

const T = "2026-11-10T04:00:00.000Z";

/** A site that was built on this PC in thread `th_1`, and has no repository. */
function builtHere(): ClientProject {
  const p = createProject({ name: "BuildFlip 2", clientName: "", siteUrl: "", repo: "" }, T);
  return {
    ...p,
    versions: [{ ...p.versions[0], status: "review", siteUrl: "https://buildflip-2.vercel.app" }],
    buildWatch: { threadId: "th_1", at: T, versionId: p.versions[0].id },
  } as ClientProject;
}

/** The bridge as it behaves on a machine where only the relay route works. */
function bridgeOnlyThroughRelay(): void {
  probe.mockResolvedValue(BLOCKED);
  connectToPc.mockImplementation(async () => {
    probe.mockResolvedValue(READY);
    knownFolder.mockReturnValue("C:\\dev\\jarvis-plugins-studios");
    return null;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  knownFolder.mockReturnValue("");
  call.mockImplementation(async (route) => {
    if (route === "harness/threads") return { threads: [{ id: "th_1", worktree: { path: "C:\\work\\buildflip-2" } }] };
    if (route === "harness/start") return { session: { id: "th_9", worktree: { path: "C:\\work\\move" } } };
    if (route === "shell") return { ok: true, exitCode: 0, stdout: "", stderr: "" };
    return {};
  });
});

describe("the move into the hub, when the browser has shut the direct route", () => {
  it("connects for itself instead of naming a button on another screen", async () => {
    bridgeOnlyThroughRelay();

    const out = await startPluginsBuild(builtHere(), { repo: "", liveUrl: "https://buildflip-2.vercel.app" });

    expect(connectToPc).toHaveBeenCalledTimes(1);
    expect(out.threadId).toBe("th_9");
  });

  it("asks the PC where the site was built AFTER connecting, not before", async () => {
    bridgeOnlyThroughRelay();
    const order: string[] = [];
    connectToPc.mockImplementation(async () => {
      order.push("connect");
      probe.mockResolvedValue(READY);
      knownFolder.mockReturnValue("C:\\dev\\jarvis-plugins-studios");
      return null;
    });
    call.mockImplementation(async (route) => {
      order.push(route);
      if (route === "harness/threads") return { threads: [{ id: "th_1", worktree: { path: "C:\\work\\buildflip-2" } }] };
      if (route === "harness/start") return { session: { id: "th_9", worktree: { path: "C:\\work\\move" } } };
      return { ok: true, exitCode: 0, stdout: "", stderr: "" };
    });

    await startPluginsBuild(builtHere(), { repo: "", liveUrl: "" });

    // The old order asked a shut bridge where the folder was, got nothing, and
    // refused a site that had one. Connecting has to come first.
    expect(order.indexOf("connect")).toBeLessThan(order.indexOf("harness/threads"));
  });

  it("puts that folder in the brief, so the move has a source", async () => {
    bridgeOnlyThroughRelay();

    await startPluginsBuild(builtHere(), { repo: "", liveUrl: "" });

    const started = call.mock.calls.find(([route]) => route === "harness/start");
    expect(String(started?.[1]?.brief)).toContain("C:\\work\\buildflip-2");
  });

  it("says the window did not open, and nothing about a build screen, when the relay is blocked too", async () => {
    probe.mockResolvedValue(BLOCKED);
    connectToPc.mockResolvedValue("blocked-by-browser");

    await expect(startPluginsBuild(builtHere(), { repo: "", liveUrl: "" })).rejects.toThrow(/Allow pop-ups for this site/);
    await expect(startPluginsBuild(builtHere(), { repo: "", liveUrl: "" })).rejects.not.toThrow(/on a build/);
  });

  it("still refuses when the site has neither a repository nor a folder left", async () => {
    probe.mockResolvedValue(READY);
    knownFolder.mockReturnValue("C:\\dev\\jarvis-plugins-studios");
    call.mockImplementation(async (route) => (route === "harness/threads" ? { threads: [] } : {}));

    await expect(startPluginsBuild(builtHere(), { repo: "", liveUrl: "" })).rejects.toThrow(/nothing to move in/);
  });

  it("does not ask the PC for a folder at all when the site has its own repository", async () => {
    probe.mockResolvedValue(READY);
    knownFolder.mockReturnValue("C:\\dev\\jarvis-plugins-studios");

    await startPluginsBuild(builtHere(), { repo: "legacymiles/buildflip-2", liveUrl: "" });

    expect(call.mock.calls.some(([route]) => route === "harness/threads")).toBe(false);
  });
});

describe("finding the folder a site was built in", () => {
  it("is empty when the project has never been built", async () => {
    const p = createProject({ name: "Nothing", clientName: "", siteUrl: "", repo: "" }, T);
    expect(await siteFolder(p)).toBe("");
    expect(call).not.toHaveBeenCalled();
  });

  it("is empty when the worktree has been discarded, rather than a guess at its path", async () => {
    call.mockImplementation(async () => ({ threads: [{ id: "th_other", worktree: { path: "C:\\work\\other" } }] }));
    expect(await siteFolder(builtHere())).toBe("");
  });
});
