// ---------------------------------------------------------------------------
// Conversations in Chat.
//
// A block is one request and everything Jarvis did for it. A thread is a run
// of blocks that belong together — what the side panel lists and what the
// model is given as context. Kept on this device beside the blocks, for the
// same reason the blocks are: a run records what was done from this browser.
// ---------------------------------------------------------------------------

import type { Block } from "./types";

export interface Thread {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

export const THREADS_KEY = "new-jarvis:threads";
/** Where blocks from before there were conversations go. */
export const EARLIER_THREAD = "t_earlier";
export const MAX_THREADS = 60;

export function newThreadId(): string {
  return `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

/** A title from the first thing asked: one line, cut at a word, no trailing punctuation. */
export function titleFrom(command: string, max = 46): string {
  const line = command.replace(/\s+/g, " ").trim();
  if (!line) return "New chat";
  if (line.length <= max) return line.replace(/[.?!,;:]+$/, "") || line;
  const cut = line.slice(0, max);
  const at = cut.lastIndexOf(" ");
  return `${(at > max * 0.6 ? cut.slice(0, at) : cut).replace(/[.?!,;:]+$/, "")}…`;
}

export function reviveThreads(raw: unknown): Thread[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((t): t is Record<string, unknown> => Boolean(t) && typeof t === "object")
    .filter((t) => typeof t.id === "string")
    .map((t) => ({
      id: String(t.id),
      title: typeof t.title === "string" && t.title.trim() ? t.title : "New chat",
      createdAt: typeof t.createdAt === "number" ? t.createdAt : Date.now(),
      updatedAt: typeof t.updatedAt === "number" ? t.updatedAt : typeof t.createdAt === "number" ? t.createdAt : Date.now(),
    }))
    .slice(0, MAX_THREADS);
}

/**
 * Blocks saved before there were conversations get one: "Earlier", so nothing
 * that was on the screen yesterday disappears today.
 */
export function adoptLegacy(blocks: Block[], threads: Thread[]): { blocks: Block[]; threads: Thread[] } {
  const loose = blocks.filter((b) => !b.thread);
  if (!loose.length) return { blocks, threads };
  const newest = Math.max(...loose.map((b) => b.createdAt));
  const oldest = Math.min(...loose.map((b) => b.createdAt));
  const has = threads.some((t) => t.id === EARLIER_THREAD);
  return {
    blocks: blocks.map((b) => (b.thread ? b : { ...b, thread: EARLIER_THREAD })),
    threads: has ? threads : [...threads, { id: EARLIER_THREAD, title: "Earlier chats", createdAt: oldest, updatedAt: newest }],
  };
}

/** Threads newest-first, under Today / Yesterday / Previous 7 days / Older. */
export function groupThreads(threads: Thread[], now = Date.now()): { label: string; items: Thread[] }[] {
  const day = new Date(now);
  day.setHours(0, 0, 0, 0);
  const today = day.getTime();
  const yesterday = today - 86_400_000;
  const week = today - 7 * 86_400_000;
  const buckets: [string, (t: number) => boolean][] = [
    ["Today", (t) => t >= today],
    ["Yesterday", (t) => t >= yesterday && t < today],
    ["Previous 7 days", (t) => t >= week && t < yesterday],
    ["Older", (t) => t < week],
  ];
  const sorted = [...threads].sort((a, b) => b.updatedAt - a.updatedAt);
  return buckets
    .map(([label, fits]) => ({ label, items: sorted.filter((t) => fits(t.updatedAt)) }))
    .filter((g) => g.items.length);
}
