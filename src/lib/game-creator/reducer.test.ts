import { describe, expect, it } from "vitest";
import {
  addGame,
  addMessage,
  addScreenshot,
  applyProgress,
  claimNext,
  failGame,
  normaliseSkills,
  removeGame,
  requestLaunch,
  retryGame,
  takeLaunches,
  takePendingMessages,
} from "./reducer";
import { MAX_LOG_LINES, MAX_SCREENSHOTS, type Game } from "./types";

const T0 = "2026-09-14T10:00:00.000Z";
const T1 = "2026-09-14T10:01:00.000Z";
const T2 = "2026-09-14T10:02:00.000Z";

function seed(): Game[] {
  let games: Game[] = [];
  games = addGame(games, { id: "old", ownerId: "u", prompt: "a racing game", template: "Vehicle", now: T0 });
  games = addGame(games, { id: "new", ownerId: "u", prompt: "a horror game", template: "Auto", now: T1 });
  return games;
}

describe("addGame", () => {
  it("puts the newest game first, queued, with empty log and shots", () => {
    const games = seed();
    expect(games.map((g) => g.id)).toEqual(["new", "old"]);
    expect(games[0]).toMatchObject({ status: "queued", log: [], screenshots: [], createdAt: T1, updatedAt: T1 });
  });

  it("trims the prompt", () => {
    const games = addGame([], { id: "x", ownerId: "u", prompt: "  hi  ", template: "Auto", now: T0 });
    expect(games[0].prompt).toBe("hi");
  });
});

describe("claimNext", () => {
  it("claims the OLDEST queued game and marks it designing", () => {
    const { games, game } = claimNext(seed(), T2);
    expect(game?.id).toBe("old");
    expect(game).toMatchObject({ status: "designing", startedAt: T2, updatedAt: T2 });
    expect(games.find((g) => g.id === "new")?.status).toBe("queued");
  });

  it("returns null when nothing is queued", () => {
    let games = seed();
    games = claimNext(games, T2).games;
    games = claimNext(games, T2).games;
    expect(claimNext(games, T2).game).toBeNull();
  });
});

describe("applyProgress", () => {
  it("merges manifest, design, note and paths", () => {
    const games = applyProgress(seed(), "old", {
      status: "building",
      note: "Spawner",
      design: "# Design",
      manifest: { title: "Drift King", controls: ["W — throttle"], cut: [{ feature: "Online", reason: "No backend" }] },
      paths: { uproject: "C:\\g\\DriftKing.uproject" },
    }, T2);
    const g = games.find((x) => x.id === "old")!;
    expect(g).toMatchObject({
      status: "building",
      note: "Spawner",
      design: "# Design",
      title: "Drift King",
      controls: ["W — throttle"],
      cut: [{ feature: "Online", reason: "No backend" }],
      paths: { uproject: "C:\\g\\DriftKing.uproject" },
      updatedAt: T2,
    });
  });

  it("appends log lines with timestamps and keeps only the newest MAX_LOG_LINES", () => {
    let games = seed();
    const many = Array.from({ length: MAX_LOG_LINES + 20 }, (_, i) => `line ${i}`);
    games = applyProgress(games, "old", { lines: many }, T2);
    const log = games.find((g) => g.id === "old")!.log;
    expect(log).toHaveLength(MAX_LOG_LINES);
    expect(log[0].line).toBe("line 20");
    expect(log.at(-1)).toEqual({ t: T2, line: `line ${MAX_LOG_LINES + 19}` });
  });

  it("sets finishedAt when the game becomes ready, and a manifest exe lands in paths", () => {
    const games = applyProgress(seed(), "old", { status: "ready", manifest: { packagedExe: "C:\\g\\x.exe" } }, T2);
    const g = games.find((x) => x.id === "old")!;
    expect(g.finishedAt).toBe(T2);
    expect(g.paths?.packagedExe).toBe("C:\\g\\x.exe");
  });

  it("never moves a finished game back to an active status", () => {
    let games = applyProgress(seed(), "old", { status: "ready" }, T1);
    games = applyProgress(games, "old", { status: "building", lines: ["late line"] }, T2);
    const g = games.find((x) => x.id === "old")!;
    expect(g.status).toBe("ready");
    expect(g.log.at(-1)?.line).toBe("late line");
  });

  it("ignores an unknown game id", () => {
    const before = seed();
    expect(applyProgress(before, "nope", { status: "ready" }, T2)).toEqual(before);
  });
});

describe("failGame / retryGame / removeGame", () => {
  it("fails with an error and a finish time", () => {
    const g = failGame(seed(), "old", "Editor crashed", T2).find((x) => x.id === "old")!;
    expect(g).toMatchObject({ status: "failed", error: "Editor crashed", finishedAt: T2 });
  });

  it("failing replaces an in-progress note, so a card never says 'Queued again' on a failed build", () => {
    let games = failGame(seed(), "old", "boom", T0);
    games = retryGame(games, "old", T1);
    games = failGame(games, "old", "boom again", T2);
    expect(games.find((x) => x.id === "old")!.note).toBe("Build stopped");
  });

  it("retry puts a failed game back in the queue and clears the error", () => {
    let games = failGame(seed(), "old", "boom", T1);
    games = retryGame(games, "old", T2);
    const g = games.find((x) => x.id === "old")!;
    expect(g).toMatchObject({ status: "queued", updatedAt: T2 });
    expect(g.error).toBeUndefined();
    expect(g.finishedAt).toBeUndefined();
    expect(g.startedAt).toBeUndefined();
  });

  it("retry leaves an active game alone", () => {
    const games = retryGame(seed(), "old", T2);
    expect(games.find((x) => x.id === "old")?.updatedAt).toBe(T0);
  });

  it("removes a game", () => {
    expect(removeGame(seed(), "old").map((g) => g.id)).toEqual(["new"]);
  });
});

describe("addScreenshot", () => {
  it("appends, skips a file already uploaded, and caps the list", () => {
    let games = seed();
    games = addScreenshot(games, "old", { key: "u/old/1.png", file: "01.png", caption: "Wide" }, T1);
    games = addScreenshot(games, "old", { key: "u/old/2.png", file: "01.png" }, T1);
    expect(games.find((g) => g.id === "old")!.screenshots).toEqual([{ key: "u/old/1.png", file: "01.png", caption: "Wide", at: T1 }]);

    for (let i = 0; i < MAX_SCREENSHOTS + 5; i++) {
      games = addScreenshot(games, "old", { key: `k${i}`, file: `f${i}.png` }, T2);
    }
    expect(games.find((g) => g.id === "old")!.screenshots).toHaveLength(MAX_SCREENSHOTS);
  });
});

describe("messages to the agent", () => {
  it("waits for the running build without changing its status", () => {
    let games = claimNext(seed(), T1).games;
    games = addMessage(games, "old", { id: "m1", text: "  make it night  " }, T2);
    const g = games.find((x) => x.id === "old")!;
    expect(g.status).toBe("designing");
    expect(g.followUp).toBeFalsy();
    expect(g.messages).toEqual([{ id: "m1", text: "make it night", at: T2, state: "pending" }]);
  });

  it("re-queues a finished game as a follow-up and clears the old outcome", () => {
    let games = failGame(seed(), "new", "boom", T1);
    games = addMessage(games, "new", { id: "m1", text: "try again with fog" }, T2);
    const g = games.find((x) => x.id === "new")!;
    expect(g).toMatchObject({ status: "queued", followUp: true });
    expect(g.error).toBeUndefined();
    expect(g.finishedAt).toBeUndefined();
  });

  it("hands pending messages over once, oldest first", () => {
    let games = seed();
    games = addMessage(games, "new", { id: "a", text: "one" }, T1);
    games = addMessage(games, "new", { id: "b", text: "two" }, T2);
    const first = takePendingMessages(games, "new", T2);
    expect(first.messages.map((m) => m.id)).toEqual(["a", "b"]);
    const second = takePendingMessages(first.games, "new", T2);
    expect(second.messages).toEqual([]);
    expect(second.games.find((g) => g.id === "new")!.messages!.every((m) => m.state === "delivered")).toBe(true);
  });

  it("clears the follow-up flag when the follow-up build finishes", () => {
    let games = applyProgress(seed(), "new", { status: "ready" }, T1);
    games = addMessage(games, "new", { id: "m", text: "faster zombies" }, T1);
    games = claimNext(games, T2).games;
    games = applyProgress(games, "new", { status: "ready", sessionId: "abc12345-x", skillUsed: true }, T2);
    expect(games.find((g) => g.id === "new")).toMatchObject({ status: "ready", followUp: false, sessionId: "abc12345-x", skillUsed: true });
  });
});

describe("normaliseSkills", () => {
  it("keeps valid unique names and a default that is one of them", () => {
    const s = normaliseSkills(
      { skills: [{ name: "unreal-game-builder", description: "d" }, "godot-builder", { name: "bad name!" }, "godot-builder"], defaultSkill: "godot-builder" },
      T0,
    )!;
    expect(s.skills.map((x) => x.name)).toEqual(["unreal-game-builder", "godot-builder"]);
    expect(s.defaultSkill).toBe("godot-builder");
  });

  it("falls back to the first skill when the default is unknown, and null when none", () => {
    expect(normaliseSkills({ skills: ["a-skill"], defaultSkill: "nope" }, T0)!.defaultSkill).toBe("a-skill");
    expect(normaliseSkills({ skills: [] }, T0)!.defaultSkill).toBeNull();
    expect(normaliseSkills(null, T0)).toBeNull();
  });
});

describe("addGame skill", () => {
  it("records the chosen skill", () => {
    const games = addGame([], { id: "x", ownerId: "u", prompt: "zombie shooter", template: "Auto", skill: "unreal-game-builder", now: T0 });
    expect(games[0].skill).toBe("unreal-game-builder");
  });
});

describe("play / open from the website", () => {
  it("hands each launch to the builder once", () => {
    let games = requestLaunch(seed(), "old", "play", T1);
    expect(games.find((g) => g.id === "old")!.launch).toEqual({ action: "play", at: T1, state: "pending" });
    const first = takeLaunches(games, T2);
    expect(first.launches).toEqual([{ gameId: "old", action: "play" }]);
    expect(first.games.find((g) => g.id === "old")!.launch).toMatchObject({ state: "sent", sentAt: T2 });
    expect(takeLaunches(first.games, T2).launches).toEqual([]);
  });

  it("a newer press replaces an older one", () => {
    let games = requestLaunch(seed(), "old", "play", T1);
    games = requestLaunch(games, "old", "open", T2);
    expect(takeLaunches(games, T2).launches).toEqual([{ gameId: "old", action: "open" }]);
  });
});
