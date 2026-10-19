import "server-only";

// Who a queue request belongs to, and what its folder is called.

import { memoryContext } from "@/lib/jarvis/server/memory";
import { PROJECTS } from "@/lib/catalog";
import { WORKFLOWS } from "@/lib/studio/workflows";
import { PINNED_TASKS } from "../tasks";
import { INBOX } from "../requests";

/**
 * The signed-in account, "local" when Supabase is not configured at all (local
 * demo mode — apps must work with no keys), or null when it is configured and
 * nobody is signed in.
 */
export async function browserUid(): Promise<string | null> {
  const configured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  if (!configured) return "local";
  const ctx = await memoryContext();
  return ctx.available ? ctx.userId : null;
}

/** "flow:animate-my-character" → "Animate my character", for agents and toasts. */
export function folderName(folder: string): string {
  if (folder === INBOX) return "Inbox";
  const [kind, ...rest] = folder.split(":");
  const id = rest.join(":");
  if (kind === "app") return PROJECTS.find((p) => p.slug === id)?.title ?? id;
  if (kind === "flow") return WORKFLOWS.find((w) => w.id === id)?.name ?? id;
  if (kind === "task") return PINNED_TASKS.find((t) => t.id === id)?.name ?? id;
  if (kind === "skill") return `${id} skill`;
  return folder;
}
