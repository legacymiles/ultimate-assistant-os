// ---------------------------------------------------------------------------
// Recall — the assistant (client side).
//
// This started as "search my notes and answer". It is now the one place that
// sees ALL THREE of the user's surfaces at once — the knowledge base, the
// calendar, and the people the photo triage knows about — because that is what
// separates an assistant from a search box. "When am I free before the game?"
// needs the calendar; "where did I put the photos of the kids?" needs both the
// folder tree and the people list; "put that on my calendar" needs to write.
//
// The retrieval half is still local: candidate items are scored here and only
// the shortlist is sent, so the whole knowledge base never leaves the browser.
// With no AI key the assistant degrades to an extractive answer plus a couple
// of safely-parsed commands, so it still finds things offline.
// ---------------------------------------------------------------------------

import { retrieveForQuestion } from "./search";
import { folderPaths } from "./classify";
import { folderPathString } from "./store";
import { getEvents, upcoming } from "./calendar/store";
import { formatDayKey, formatTime, todayKey } from "./calendar/types";
import type { CalendarEvent } from "./calendar/types";
import { getPhotos, getQueue } from "./photos/store";
import { ROLE_LABELS } from "./photos/types";
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

/**
 * The offline answer. It now covers the calendar too: with no key, "what's on
 * this week" is answerable from local data alone and it would be a poor
 * assistant that shrugged at it.
 */
function heuristicAnswer(
  question: string,
  candidates: Item[],
  folders: RecallData["folders"],
  events: CalendarEvent[],
): string {
  const asksAboutTime = /\b(calendar|schedule|event|when|upcoming|today|tomorrow|this week|next week|birthday|appointment)\b/i.test(
    question,
  );
  if (asksAboutTime && events.length) {
    const lines = events
      .slice(0, 5)
      .map((e) => `• ${e.title} — ${formatDayKey(e.date)}${e.time ? `, ${formatTime(e.time)}` : ""}${e.location ? ` (${e.location})` : ""}`);
    const head = `Coming up:\n${lines.join("\n")}`;
    if (candidates.length === 0) return head;
    return `${head}\n\nFrom your notes:\n${candidates
      .slice(0, 2)
      .map((it) => `• ${it.title} — ${it.summary || it.body.slice(0, 100)}`)
      .join("\n")}`;
  }

  if (candidates.length === 0) {
    return asksAboutTime
      ? "Nothing on the calendar yet, and I couldn't find a note about that either."
      : "I couldn't find anything saved about that yet. Capture a note and I'll be able to answer next time.";
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
  const allEvents = getEvents();
  const soon = upcoming(allEvents, 25);
  const photos = getPhotos();
  const pendingCount = getQueue().filter((p) => p.status === "ready").length;

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
          // The text read out of the file itself — this is what lets the agent
          // answer from the CONTENTS of a PDF or a screenshot, not its name.
          extract: it.extract?.slice(0, 2000),
          kind: it.kind,
          folder: folderPathString(data.folders, it.folderId),
          tags: it.tags,
        })),
        folderPaths: folderPaths(data.folders),
        // Folder ids so the agent can propose rename/move/merge/delete on them.
        folders: data.folders.map((f) => ({
          id: f.id,
          path: folderPathString(data.folders, f.id),
        })),
        // The assistant has no clock of its own; without today, every "next
        // Tuesday" it writes to the calendar lands on the wrong day.
        today: todayKey(),
        events: soon.map((e) => ({
          id: e.id,
          title: e.title,
          date: e.date,
          time: e.time ?? null,
          location: e.location ?? null,
          notes: e.notes?.slice(0, 200) ?? null,
        })),
        people: photos.people.map((p) => ({ id: p.id, name: p.name, role: ROLE_LABELS[p.role] })),
        photoCategories: photos.categories.map((c) => c.name),
        pendingPhotos: pendingCount,
      }),
    });
    if (res.ok) {
      const out = (await res.json()) as { reply?: Partial<AgentReply> | null };
      const r = out.reply;
      if (r && typeof r.answer === "string" && r.answer.trim()) {
        return {
          answer: r.answer.trim(),
          citations: sanitizeCitations(r.citations, candidates),
          actions: sanitizeActions(r.actions, data, allEvents),
          engine: "ai",
        };
      }
    }
  } catch {
    /* fall through to heuristic */
  }

  return {
    answer: heuristicAnswer(question, candidates, data.folders, soon),
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

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

function cleanTime(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  return TIME_RE.test(s) ? s : null;
}

function cleanReminders(v: unknown): number[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v
    .map((n) => Math.round(Number(n)))
    .filter((n) => Number.isFinite(n) && n >= 0 && n <= 20160);
  return out.length ? Array.from(new Set(out)).slice(0, 4) : undefined;
}

/**
 * Keep only well-formed actions that reference things that actually exist.
 *
 * This is a trust boundary, not a formality. Everything here is confirmed by
 * the user before it runs, but a malformed action would render as a chip the
 * user cannot understand and then do something else — so an action that does
 * not name a real item, folder or event is dropped rather than repaired.
 */
function sanitizeActions(input: unknown, data: RecallData, events: CalendarEvent[]): AgentAction[] {
  if (!Array.isArray(input)) return [];
  const itemIds = new Set(data.items.map((i) => i.id));
  const folderIds = new Set(data.folders.map((f) => f.id));
  const eventIds = new Set(events.map((e) => e.id));
  const out: AgentAction[] = [];

  for (const raw of input as Record<string, unknown>[]) {
    const type = String(raw?.type ?? "");
    const path = Array.isArray(raw?.path) ? (raw.path as unknown[]).map(String).filter(Boolean) : [];
    const tags = Array.isArray(raw?.tags) ? (raw.tags as unknown[]).map(String).filter(Boolean) : [];
    const itemId = typeof raw?.itemId === "string" ? raw.itemId : "";
    const folderId = typeof raw?.folderId === "string" ? raw.folderId : "";
    const eventId = typeof raw?.eventId === "string" ? raw.eventId : "";
    const title = typeof raw?.title === "string" ? raw.title.trim() : "";
    const date = typeof raw?.date === "string" ? raw.date.trim() : "";

    switch (type) {
      case "create_folder":
        if (path.length) out.push({ type, path });
        break;
      case "move_item":
        if (itemIds.has(itemId) && path.length) out.push({ type, itemId, path });
        break;
      case "move_items": {
        const ids = Array.isArray(raw?.itemIds)
          ? (raw.itemIds as unknown[]).map(String).filter((id) => itemIds.has(id))
          : [];
        if (ids.length && path.length) out.push({ type, itemIds: ids, path });
        break;
      }
      case "add_tags":
      case "remove_tags":
        if (itemIds.has(itemId) && tags.length) out.push({ type, itemId, tags });
        break;
      case "create_note":
        if (title && typeof raw?.body === "string")
          out.push({ type, title, body: raw.body, path, tags });
        break;
      case "rename_item":
        if (itemIds.has(itemId) && title) out.push({ type, itemId, title });
        break;
      case "edit_note":
        if (itemIds.has(itemId) && typeof raw?.body === "string")
          out.push({ type, itemId, body: raw.body });
        break;
      case "rename_folder":
        if (folderIds.has(folderId) && typeof raw?.name === "string" && raw.name.trim())
          out.push({ type, folderId, name: raw.name.trim() });
        break;
      case "move_folder":
        if (folderIds.has(folderId)) out.push({ type, folderId, path });
        break;
      case "merge_folders": {
        const sourceId = typeof raw?.sourceId === "string" ? raw.sourceId : "";
        const targetPath = Array.isArray(raw?.targetPath)
          ? (raw.targetPath as unknown[]).map(String).filter(Boolean)
          : [];
        if (folderIds.has(sourceId) && targetPath.length) out.push({ type, sourceId, targetPath });
        break;
      }
      case "delete_item":
        if (itemIds.has(itemId)) out.push({ type, itemId });
        break;
      case "delete_folder":
        if (folderIds.has(folderId)) out.push({ type, folderId });
        break;

      case "create_event":
        // No date, no event. Defaulting to today would put a made-up commitment
        // on the calendar, which is worse than not proposing one.
        if (title && DATE_RE.test(date))
          out.push({
            type,
            title,
            date,
            time: cleanTime(raw?.time),
            endTime: cleanTime(raw?.endTime),
            location: typeof raw?.location === "string" ? raw.location.trim() : undefined,
            notes: typeof raw?.notes === "string" ? raw.notes.trim() : undefined,
            reminders: cleanReminders(raw?.reminders),
          });
        break;
      case "update_event":
        if (eventIds.has(eventId))
          out.push({
            type,
            eventId,
            title: title || undefined,
            date: DATE_RE.test(date) ? date : undefined,
            time: raw?.time === undefined ? undefined : cleanTime(raw.time),
            location: typeof raw?.location === "string" ? raw.location.trim() : undefined,
            notes: typeof raw?.notes === "string" ? raw.notes.trim() : undefined,
            reminders: cleanReminders(raw?.reminders),
          });
        break;
      case "delete_event":
        if (eventIds.has(eventId)) out.push({ type, eventId });
        break;

      case "add_person": {
        const name = typeof raw?.name === "string" ? raw.name.trim() : "";
        if (name) out.push({ type, name, role: String(raw?.role ?? "other") });
        break;
      }
    }
    if (out.length >= 8) break;
  }
  return out;
}
