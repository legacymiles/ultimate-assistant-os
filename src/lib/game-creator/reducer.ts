// Pure state transitions for one owner's list of games. No I/O here: the
// store loads the list, runs one of these, and saves the result, so every rule
// about how a game moves through the pipeline is testable on its own.

import {
  MAX_LOG_LINES,
  MAX_MESSAGES,
  MAX_SCREENSHOTS,
  isSkillName,
  type BuildSkill,
  type BuilderSkills,
  type Game,
  type GameMessage,
  type LaunchAction,
  type GameShot,
  type ProgressUpdate,
  type TemplateId,
} from "./types";

const FINISHED = new Set(["ready", "failed"]);

function update(games: Game[], id: string, fn: (g: Game) => Game): Game[] {
  let hit = false;
  const next = games.map((g) => {
    if (g.id !== id) return g;
    hit = true;
    return fn(g);
  });
  return hit ? next : games;
}

export function addGame(
  games: Game[],
  input: { id: string; ownerId: string; prompt: string; template: TemplateId; skill?: string; model?: string; now: string },
): Game[] {
  const game: Game = {
    id: input.id,
    ownerId: input.ownerId,
    prompt: input.prompt.trim(),
    template: input.template,
    ...(input.skill ? { skill: input.skill } : {}),
    ...(input.model ? { model: input.model } : {}),
    createdAt: input.now,
    updatedAt: input.now,
    status: "queued",
    log: [],
    screenshots: [],
  };
  return [game, ...games];
}

/** The oldest queued game becomes "designing". First come, first built. */
export function claimNext(games: Game[], now: string): { games: Game[]; game: Game | null } {
  const queued = games
    .filter((g) => g.status === "queued")
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const target = queued[0];
  if (!target) return { games, game: null };
  const next = update(games, target.id, (g) => ({
    ...g,
    status: "designing",
    note: "Picked up by your PC",
    startedAt: now,
    updatedAt: now,
  }));
  return { games: next, game: next.find((g) => g.id === target.id) ?? null };
}

export function applyProgress(games: Game[], id: string, u: ProgressUpdate, now: string): Game[] {
  return update(games, id, (g) => {
    const next: Game = { ...g, updatedAt: now };

    // A finished game keeps its outcome. Late log lines from a builder that is
    // still shutting down are welcome; a late "building" is not.
    if (u.status && !FINISHED.has(g.status)) {
      next.status = u.status;
      if (u.status === "ready" || u.status === "failed") {
        next.finishedAt = now;
        next.followUp = false;
      }
    }
    if (u.sessionId) next.sessionId = u.sessionId;
    if (u.skillUsed !== undefined) next.skillUsed = u.skillUsed;
    if (u.note !== undefined) next.note = u.note;
    if (u.design !== undefined) next.design = u.design;

    if (u.lines?.length) {
      const added = u.lines.map((line) => ({ t: now, line }));
      next.log = [...g.log, ...added].slice(-MAX_LOG_LINES);
    }

    const m = u.manifest;
    if (m) {
      if (m.title !== undefined) next.title = m.title;
      if (m.summary !== undefined) next.summary = m.summary;
      if (m.genre !== undefined) next.genre = m.genre;
      if (m.controls !== undefined) next.controls = m.controls;
      if (m.features !== undefined) next.features = m.features;
      if (m.cut !== undefined) next.cut = m.cut;
    }

    const paths = {
      ...g.paths,
      ...u.paths,
      ...(m?.uproject ? { uproject: m.uproject } : {}),
      ...(m?.packagedExe ? { packagedExe: m.packagedExe } : {}),
    };
    if (Object.keys(paths).length) next.paths = paths;

    return next;
  });
}

export function failGame(games: Game[], id: string, error: string, now: string): Game[] {
  // The note describes the last thing in progress ("Queued again", "Spawner");
  // once the build has stopped it would read as if it were still going.
  return update(games, id, (g) => ({
    ...g,
    status: "failed",
    error,
    note: "Build stopped",
    followUp: false,
    finishedAt: now,
    updatedAt: now,
  }));
}

/** Put a failed game back in the queue. Active or ready games are left alone. */
export function retryGame(games: Game[], id: string, now: string): Game[] {
  return update(games, id, (g) => {
    if (g.status !== "failed") return g;
    const { error: _e, finishedAt: _f, startedAt: _s, ...rest } = g;
    return { ...rest, status: "queued", note: "Queued again", updatedAt: now };
  });
}

/**
 * The owner writes to the agent. While the game is being built the message
 * waits for the builder to hand it to the running session. On a finished game
 * it re-queues the game as a follow-up: the builder continues the same Claude
 * session on the same project with the message as the next instruction.
 */
export function addMessage(games: Game[], id: string, msg: { id: string; text: string }, now: string): Game[] {
  return update(games, id, (g) => {
    const message: GameMessage = { id: msg.id, text: msg.text.trim(), at: now, state: "pending" };
    const messages = [...(g.messages ?? []), message].slice(-MAX_MESSAGES);
    if (!FINISHED.has(g.status)) return { ...g, messages, updatedAt: now };
    const { error: _e, finishedAt: _f, ...rest } = g;
    return {
      ...rest,
      messages,
      status: "queued",
      followUp: true,
      note: "Queued: the changes you asked for",
      updatedAt: now,
    };
  });
}

/** Hand every pending message to the builder, oldest first, marking them delivered. */
export function takePendingMessages(games: Game[], id: string, now: string): { games: Game[]; messages: GameMessage[] } {
  let taken: GameMessage[] = [];
  const next = update(games, id, (g) => {
    taken = (g.messages ?? []).filter((m) => m.state === "pending");
    if (!taken.length) return g;
    const messages = (g.messages ?? []).map((m) =>
      m.state === "pending" ? { ...m, state: "delivered" as const, deliveredAt: now } : m,
    );
    return { ...g, messages, updatedAt: now };
  });
  return { games: next, messages: taken };
}

/** The owner pressed Play / Open: remember it for the PC's next check-in. */
export function requestLaunch(games: Game[], id: string, action: LaunchAction, now: string): Game[] {
  return update(games, id, (g) => ({ ...g, launch: { action, at: now, state: "pending" }, updatedAt: now }));
}

/** Every pending launch, handed to the builder once (marked sent). */
export function takeLaunches(games: Game[], now: string): { games: Game[]; launches: { gameId: string; action: LaunchAction }[] } {
  const launches: { gameId: string; action: LaunchAction }[] = [];
  const next = games.map((g) => {
    if (g.launch?.state !== "pending") return g;
    launches.push({ gameId: g.id, action: g.launch.action });
    return { ...g, launch: { ...g.launch, state: "sent" as const, sentAt: now } };
  });
  return { games: launches.length ? next : games, launches };
}

export function removeGame(games: Game[], id: string): Game[] {
  return games.filter((g) => g.id !== id);
}

export function addScreenshot(
  games: Game[],
  id: string,
  shot: Omit<GameShot, "at">,
  now: string,
): Game[] {
  return update(games, id, (g) => {
    if (shot.file && g.screenshots.some((s) => s.file === shot.file)) return g;
    const screenshots = [...g.screenshots, { ...shot, at: now }].slice(-MAX_SCREENSHOTS);
    return { ...g, screenshots, updatedAt: now };
  });
}

/**
 * Clean up what a builder reports: unique valid names, and a default that is
 * always one of them (the reported default, else the first).
 */
export function normaliseSkills(input: unknown, now: string): BuilderSkills | null {
  const raw = (input ?? {}) as { skills?: unknown; defaultSkill?: unknown; openrouter?: unknown };
  if (!Array.isArray(raw.skills)) return null;
  const seen = new Set<string>();
  const skills: BuildSkill[] = [];
  for (const item of raw.skills.slice(0, 50)) {
    const name = typeof item === "string" ? item : (item as { name?: unknown })?.name;
    if (typeof name !== "string" || !isSkillName(name) || seen.has(name)) continue;
    seen.add(name);
    const description = (item as { description?: unknown })?.description;
    skills.push({ name, ...(typeof description === "string" ? { description: description.slice(0, 300) } : {}) });
  }
  const wanted = typeof raw.defaultSkill === "string" ? raw.defaultSkill : "";
  const defaultSkill = skills.some((x) => x.name === wanted) ? wanted : (skills[0]?.name ?? null);
  return { skills, defaultSkill, ...(raw.openrouter === true ? { openrouter: true } : {}), at: now };
}
