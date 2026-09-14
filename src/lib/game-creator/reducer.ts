// Pure state transitions for one owner's list of games. No I/O here: the
// store loads the list, runs one of these, and saves the result, so every rule
// about how a game moves through the pipeline is testable on its own.

import {
  MAX_LOG_LINES,
  MAX_SCREENSHOTS,
  type Game,
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
  input: { id: string; ownerId: string; prompt: string; template: TemplateId; now: string },
): Game[] {
  const game: Game = {
    id: input.id,
    ownerId: input.ownerId,
    prompt: input.prompt.trim(),
    template: input.template,
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
      if (u.status === "ready" || u.status === "failed") next.finishedAt = now;
    }
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
  return update(games, id, (g) => ({ ...g, status: "failed", error, note: "Build stopped", finishedAt: now, updatedAt: now }));
}

/** Put a failed game back in the queue. Active or ready games are left alone. */
export function retryGame(games: Game[], id: string, now: string): Game[] {
  return update(games, id, (g) => {
    if (g.status !== "failed") return g;
    const { error: _e, finishedAt: _f, startedAt: _s, ...rest } = g;
    return { ...rest, status: "queued", note: "Queued again", updatedAt: now };
  });
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
