import type { Game, TemplateId } from "@/lib/game-creator/types";

export interface BuilderInfo {
  linked: boolean;
  lastSeen: string | null;
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

export async function createGame(prompt: string, template: TemplateId): Promise<Game> {
  const res = await fetch("/api/game-creator/games", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, template }),
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
