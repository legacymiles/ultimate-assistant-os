"use client";

// ---------------------------------------------------------------------------
// Jarvis ↔ the old Dashboard: what he can see, and the three things he can do.
//
// Folders, the Dashboard calendar and the family Lists moved into Jarvis, but
// their data did not move: folders and events live in this browser
// (localStorage, synced through app_state), Lists lives on the server. So:
//
//   · SEEING — `dashboardDigest()` summarises all three into the chat's
//     extra context, every question. Saved logins are never in it: the same
//     rule the folder assistant follows, a password never reaches a model.
//   · DOING — the agent may *propose* dashboard_add_note, dashboard_add_event
//     and lists_add_item. Like every other write they stop the loop and wait
//     for the owner's yes; on that yes, `runDashboardTool` performs them here,
//     in the browser, because that is where two of the three stores live.
// ---------------------------------------------------------------------------

import { createItem, getData } from "@/lib/recall/store";
import { createEvent, getEvents } from "@/lib/recall/calendar/store";
import { compareEvents, todayKey } from "@/lib/recall/calendar/types";
import { listsApi } from "@/lib/recall/lists/client";
import { getPhotos } from "@/lib/recall/photos/store";
import { ROLE_LABELS } from "@/lib/recall/photos/types";
import type { Folder } from "@/lib/recall/types";
import type { Priority } from "@/lib/recall/lists/types";

export const DASHBOARD_TOOL_NAMES = ["dashboard_add_note", "dashboard_add_event", "lists_add_item"];

export function isDashboardTool(name: string): boolean {
  return DASHBOARD_TOOL_NAMES.includes(name);
}

/** "Recipes / Desserts" — the path a person would say out loud. */
function pathOf(folders: Folder[], f: Folder): string {
  const parts = [f.name];
  let cur = f.parentId ? folders.find((x) => x.id === f.parentId) : undefined;
  for (let guard = 0; cur && guard < 12; guard += 1) {
    parts.unshift(cur.name);
    cur = cur.parentId ? folders.find((x) => x.id === cur!.parentId) : undefined;
  }
  return parts.join(" / ");
}

/** Case- and punctuation-blind match on a folder's name or full path. */
export function findFolder(folders: Folder[], name: string): Folder | undefined {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9/]+/g, "");
  const want = norm(name);
  if (!want) return undefined;
  return (
    folders.find((f) => norm(pathOf(folders, f)) === want) ??
    folders.find((f) => norm(f.name) === want) ??
    folders.find((f) => norm(f.name).includes(want))
  );
}

/**
 * Everything Jarvis should know about the Dashboard side, in a few thousand
 * characters. Lists are fetched from the server, so this is async; a failed
 * fetch drops that section and says so rather than implying the lists are empty.
 */
export async function dashboardDigest(): Promise<string> {
  const out: string[] = [];
  const data = getData();
  const safe = data.items.filter((i) => i.kind !== "credential");

  // WHO THE PEOPLE ARE. This block exists because of a question Jarvis could not
  // answer: "who is Brandy?" The Photos tab knew — her name, her role, her face,
  // the folder of her pictures — and none of it ever reached the chat, so he
  // answered about a stranger or not at all. It leads the digest: a message is far
  // more often about a person than about a folder count.
  const photos = getPhotos();
  if (photos.people.length) {
    const counts = new Map<string, number>();
    for (const i of safe) for (const id of i.people ?? []) counts.set(id, (counts.get(id) ?? 0) + 1);
    const lines = photos.people.map((p) => {
      const n = counts.get(p.id) ?? 0;
      const bits = [
        `- ${p.name} — ${ROLE_LABELS[p.role].toLowerCase()}`,
        n ? `${n} photo${n === 1 ? "" : "s"} filed` : "no photos filed yet",
        p.refs.length ? `${p.refs.length} reference face${p.refs.length === 1 ? "" : "s"}` : "no reference face",
      ];
      // The description is the part worth spending tokens on: it is the only
      // thing here that answers "what does she look like?", and it is what a
      // Studio prompt is written from.
      const sheet = p.sheet?.appearance ? `\n    Looks like: ${p.sheet.appearance}` : "";
      const note = p.notes ? `\n    Note: ${p.notes}` : "";
      return `${bits.join(", ")}${note}${sheet}`;
    });
    out.push(
      "PEOPLE THE OWNER HAS NAMED (from the Photos tab). These are real people in their life. " +
        "Answer questions about them from this, and when the owner writes @their-name in a Studio " +
        `prompt it means this person.\n${lines.join("\n")}`,
    );
  }

  const described = photos.categories.filter((c) => c.sheet?.appearance);
  if (described.length) {
    out.push(
      `PHOTO FOLDERS THE OWNER TAUGHT BY EXAMPLE (@-mentionable in Studio too):\n${described
        .map((c) => `- ${c.name}: ${c.sheet?.appearance}`)
        .join("\n")}`,
    );
  }

  if (data.folders.length) {
    const counts = new Map<string, number>();
    for (const i of safe) if (i.folderId) counts.set(i.folderId, (counts.get(i.folderId) ?? 0) + 1);
    const lines = data.folders
      .map((f) => `- ${pathOf(data.folders, f)} (${counts.get(f.id) ?? 0})`)
      .sort()
      .slice(0, 80);
    out.push(`DASHBOARD FOLDERS (path, item count):\n${lines.join("\n")}`);
  }

  if (safe.length) {
    const recent = [...safe]
      .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""))
      .slice(0, 25)
      .map((i) => {
        const f = data.folders.find((x) => x.id === i.folderId);
        const gist = (i.summary || i.body || "").replace(/\s+/g, " ").slice(0, 110);
        return `- [${i.kind}] ${i.title}${f ? ` — in ${pathOf(data.folders, f)}` : ""}${gist ? `: ${gist}` : ""}`;
      });
    out.push(`MOST RECENT DASHBOARD ITEMS (saved logins are never shown to you):\n${recent.join("\n")}`);
  }

  // All of today, not upcoming(): that drops a 10:00 appointment at 11:00, and
  // "what's on today?" asked at lunch would then miss the morning.
  const today = todayKey();
  const events = getEvents()
    .filter((e) => e.date >= today)
    .sort(compareEvents)
    .slice(0, 15);
  if (events.length) {
    out.push(
      `EVENTS ON THE OWNER'S OWN CALENDAR, TODAY (${today}) ONWARD:\n${events
        .map((e) => `- ${e.date}${e.time ? ` ${e.time}` : ""} ${e.title}${e.location ? ` @ ${e.location}` : ""}`)
        .join("\n")}`,
    );
  }

  try {
    const board = await listsApi.load();
    const open = board.items.filter((i) => !i.done);
    const byList = board.lists
      .filter((l) => !l.hidden)
      .map((l) => {
        const rows = open.filter((i) => i.listId === l.id);
        if (!rows.length) return "";
        const who = (id: string) => board.members.find((m) => m.id === id)?.name ?? "someone";
        return `${l.name}: ${rows
          .slice(0, 15)
          .map((i) => `${i.text}${i.priority ? ` (${i.priority})` : ""}${i.dueDate ? ` due ${i.dueDate}` : ""} [${who(i.authorId)}${i.private ? ", private" : ""}]`)
          .join("; ")}`;
      })
      .filter(Boolean);
    out.push(
      `FAMILY LISTS (open items; list names: ${board.lists.filter((l) => !l.hidden).map((l) => l.name).join(", ")}):\n${
        byList.length ? byList.join("\n") : "(all lists are empty)"
      }`,
    );
  } catch {
    out.push("FAMILY LISTS: could not be read just now — do not assume they are empty.");
  }

  // 8000, up from 7000: the people block earns the extra room, and the chat
  // route still slices this whole context at 10000.
  return out.join("\n\n").slice(0, 8000);
}

function str(args: Record<string, unknown>, key: string): string {
  const v = args[key];
  return typeof v === "string" ? v.trim() : "";
}

/**
 * Carry out a confirmed dashboard action. Only ever called from a confirm
 * card's yes (chat or voice), never from the agent loop.
 */
export async function runDashboardTool(name: string, args: Record<string, unknown>): Promise<string> {
  if (name === "dashboard_add_note") {
    const data = getData();
    const folderName = str(args, "folder");
    const folder = folderName ? findFolder(data.folders, folderName) : undefined;
    const title = str(args, "title") || "Note from Jarvis";
    const body = str(args, "content");
    createItem({
      title,
      body,
      summary: body.slice(0, 200),
      kind: "note",
      source: "manual",
      folderId: folder?.id ?? null,
      tags: [],
    });
    return folder ? `Saved to ${folder.name}.` : folderName ? `No folder called "${folderName}" — saved to Unfiled.` : "Saved to Unfiled.";
  }

  if (name === "dashboard_add_event") {
    const date = str(args, "date");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("That event has no valid date.");
    const time = str(args, "time");
    const remind = Number(args.reminder_minutes);
    createEvent({
      title: str(args, "title"),
      date,
      time: /^\d{2}:\d{2}$/.test(time) ? time : null,
      location: str(args, "location"),
      notes: str(args, "notes"),
      reminders: Number.isFinite(remind) && remind >= 0 ? [remind] : [1440],
      source: "agent",
    });
    return "Added to your calendar.";
  }

  if (name === "lists_add_item") {
    const board = await listsApi.load();
    const want = str(args, "list").toLowerCase().replace(/[^a-z]/g, "");
    const list =
      board.lists.find((l) => l.name.toLowerCase().replace(/[^a-z]/g, "") === want) ??
      board.lists.find((l) => want && l.name.toLowerCase().replace(/[^a-z]/g, "").includes(want)) ??
      board.lists.find((l) => l.id === "todo")!;
    const p = str(args, "priority");
    const priority: Priority = p === "urgent" || p === "low" || p === "wish" ? p : null;
    const due = str(args, "due_date");
    await listsApi.addItem({
      listId: list.id,
      text: str(args, "text"),
      priority,
      dueDate: /^\d{4}-\d{2}-\d{2}$/.test(due) ? due : undefined,
      private: args.private === true,
    });
    return `Added to ${list.name}${args.private === true ? " (private)" : ""}.`;
  }

  throw new Error(`Unknown dashboard action ${name}.`);
}
