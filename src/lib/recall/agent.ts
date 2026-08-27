// ---------------------------------------------------------------------------
// Recall — the "find, answer + act" agent (client side).
// Retrieves candidate items locally, then asks the AI Gateway (via /api/recall)
// to synthesise a cited answer and optionally propose actions. With no key it
// falls back to a local extractive answer + a couple of safe parsed commands,
// so the agent still finds and answers offline.
// ---------------------------------------------------------------------------

import { retrieveForQuestion } from "./search";
import { folderPaths } from "./classify";
import { folderPathString } from "./store";
import type { AgentAction, AgentReply, Item, RecallData } from "./types";

/** Parse a few safe commands from plain text so "act" works even offline. */
function heuristicActions(question: string): AgentAction[] {
  const actions: AgentAction[] = [];
  const folderMatch = question.match(
    /(?:make|create|add|new)\s+(?:a\s+)?(?:folder|category)\s+(?:called\s+|named\s+|for\s+)?["']?([\w &/-]{1,40})/i,
  );
  if (folderMatch) {
    const path = folderMatch[1]
      .split(/\s*\/\s*|\s*›\s*/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (path.length) actions.push({ type: "create_folder", path });
  }
  return actions;
}

function heuristicAnswer(question: string, candidates: Item[], folders: RecallData["folders"]): string {
  if (candidates.length === 0) {
    return "I couldn't find anything saved about that yet. Capture a note and I'll be able to answer next time.";
  }
  const top = candidates.slice(0, 3);
  const lead =
    candidates.length === 1
      ? "I found one relevant note:"
      : `I found ${candidates.length} relevant notes. The most relevant:`;
  const lines = top.map((it) => {
    const where = folderPathString(folders, it.folderId);
    return `• ${it.title} — ${it.summary || it.body.slice(0, 120)} (in ${where})`;
  });
  return `${lead}\n${lines.join("\n")}`;
}

export async function askAgent(question: string, data: RecallData): Promise<AgentReply> {
  const candidates = retrieveForQuestion(question, data, 6);

  try {
    const res = await fetch("/api/recall", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        stage: "agent",
        question,
        candidates: candidates.map((it) => ({
          id: it.id,
          title: it.title,
          summary: it.summary,
          body: it.body.slice(0, 1200),
          folder: folderPathString(data.folders, it.folderId),
          tags: it.tags,
        })),
        folderPaths: folderPaths(data.folders),
      }),
    });
    if (res.ok) {
      const out = (await res.json()) as { reply?: Partial<AgentReply> | null };
      const r = out.reply;
      if (r && typeof r.answer === "string" && r.answer.trim()) {
        return {
          answer: r.answer.trim(),
          citations: sanitizeCitations(r.citations, candidates),
          actions: sanitizeActions(r.actions, data),
          engine: "ai",
        };
      }
    }
  } catch {
    /* fall through to heuristic */
  }

  return {
    answer: heuristicAnswer(question, candidates, data.folders),
    citations: candidates.slice(0, 3).map((c) => c.id),
    actions: heuristicActions(question),
    engine: "heuristic",
  };
}

function sanitizeCitations(input: unknown, candidates: Item[]): string[] {
  const ids = new Set(candidates.map((c) => c.id));
  if (!Array.isArray(input)) return [];
  return input.map(String).filter((id) => ids.has(id)).slice(0, 6);
}

/** Keep only well-formed actions that reference real items. */
function sanitizeActions(input: unknown, data: RecallData): AgentAction[] {
  if (!Array.isArray(input)) return [];
  const itemIds = new Set(data.items.map((i) => i.id));
  const out: AgentAction[] = [];
  for (const raw of input as Record<string, unknown>[]) {
    const type = String(raw?.type ?? "");
    const path = Array.isArray(raw?.path) ? (raw.path as unknown[]).map(String).filter(Boolean) : [];
    const tags = Array.isArray(raw?.tags) ? (raw.tags as unknown[]).map(String).filter(Boolean) : [];
    const itemId = typeof raw?.itemId === "string" ? raw.itemId : "";
    switch (type) {
      case "create_folder":
        if (path.length) out.push({ type, path });
        break;
      case "move_item":
        if (itemId && itemIds.has(itemId) && path.length) out.push({ type, itemId, path });
        break;
      case "add_tags":
        if (itemId && itemIds.has(itemId) && tags.length) out.push({ type, itemId, tags });
        break;
      case "remove_tags":
        if (itemId && itemIds.has(itemId) && tags.length) out.push({ type, itemId, tags });
        break;
      case "create_note":
        if (typeof raw?.title === "string" && typeof raw?.body === "string")
          out.push({ type, title: raw.title, body: raw.body, path, tags });
        break;
    }
    if (out.length >= 6) break;
  }
  return out;
}
