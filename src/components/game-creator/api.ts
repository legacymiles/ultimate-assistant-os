import type { BuildSkill, Game, TemplateId } from "@/lib/game-creator/types";

export interface BuilderInfo {
  linked: boolean;
  lastSeen: string | null;
  /** Game-building skills the PC reported; the game is built with exactly one. */
  skills?: BuildSkill[];
  defaultSkill?: string | null;
  /** The PC has an OpenRouter key, so non-Claude models can build. */
  openrouter?: boolean;
}

async function json<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `Request failed (${res.status})`);
  return body as T;
}

export async function fetchGames(): Promise<{ games: Game[]; builder: BuilderInfo }> {
  return json(await fetch("/api/game-creator/games", { cache: "no-store" }));
}

export async function fetchGame(id: string): Promise<Game> {
  return (await json<{ game: Game }>(await fetch(`/api/game-creator/games/${encodeURIComponent(id)}`, { cache: "no-store" }))).game;
}

export async function createGame(
  prompt: string,
  template: TemplateId,
  skill?: string | null,
  model?: string | null,
): Promise<Game> {
  const res = await fetch("/api/game-creator/games", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, template, ...(skill ? { skill } : {}), ...(model ? { model } : {}) }),
  });
  return (await json<{ game: Game }>(res)).game;
}

/** Ask the PC's builder to open the game (play) or its Unreal project (open). */
export async function launchGame(id: string, action: "play" | "open"): Promise<Game> {
  const res = await fetch(`/api/game-creator/games/${encodeURIComponent(id)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action }),
  });
  return (await json<{ game: Game }>(res)).game;
}

/** Write to the agent: goes to the running build, or starts a follow-up build of a finished game. */
export async function sendMessage(id: string, text: string): Promise<Game> {
  const res = await fetch(`/api/game-creator/games/${encodeURIComponent(id)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "message", text }),
  });
  return (await json<{ game: Game }>(res)).game;
}

export async function retryGame(id: string): Promise<Game> {
  const res = await fetch(`/api/game-creator/games/${encodeURIComponent(id)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "retry" }),
  });
  return (await json<{ game: Game }>(res)).game;
}

export async function deleteGame(id: string): Promise<void> {
  await json(await fetch(`/api/game-creator/games/${encodeURIComponent(id)}`, { method: "DELETE" }));
}

export async function mintBuilderToken(): Promise<string> {
  return (await json<{ token: string }>(await fetch("/api/game-creator/builder-token", { method: "POST" }))).token;
}

export function shotUrl(gameId: string, index: number): string {
  return `/api/game-creator/shots/${encodeURIComponent(gameId)}/${index}`;
}

/** "3 min ago", "yesterday" — for cards and the builder heartbeat. */
export function ago(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "never";
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

/** A builder that has asked for work in the last minute is considered online. */
export function builderOnline(builder: BuilderInfo | null, now = Date.now()): boolean {
  return Boolean(builder?.lastSeen && now - Date.parse(builder.lastSeen) < 60_000);
}
