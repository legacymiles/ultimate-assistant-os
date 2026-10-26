"use client";

// ---------------------------------------------------------------------------
// iPhone Notes in the browser: the live view, and running an approved item.
//
// An item only runs from here, after the owner tapped Approve. It runs FIRST,
// and only once it worked is the yes recorded — so a to-do that failed to save
// never shows as done, and never teaches Jarvis that the guess was right.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from "react";
import { listsApi } from "@/lib/recall/lists/client";
import { createEvent } from "@/lib/recall/calendar/store";
import { addBirthday } from "@/lib/birthdays/store";
import { createItem, ensureFolderPath } from "@/lib/recall/store";
import { askJarvis } from "@/lib/new-jarvis/askEvent";
import type { Decision, NoteItem, NoteView } from "./engine";

export interface NotesView {
  notes: NoteView[];
  learning: { decisions: number; accepted: number };
  push: string;
  pushError: string;
  lastPushAt: string | null;
  ai: boolean;
  now: string;
}

const API = "/api/iphone-notes";
/** New notes show up by themselves (checklist A1). */
const POLL_MS = 20_000;

async function call(init?: RequestInit, query = ""): Promise<NotesView> {
  let res: Response;
  try {
    res = await fetch(`${API}${query}`, { cache: "no-store", ...init, headers: init?.body ? { "Content-Type": "application/json" } : undefined });
  } catch {
    throw new Error("No connection — check your internet and try again.");
  }
  const body = (await res.json().catch(() => ({}))) as NotesView & { error?: string };
  if (!res.ok) throw new Error(body.error || "Something went wrong. Try again.");
  return body;
}

const post = (body: Record<string, unknown>) => call({ method: "POST", body: JSON.stringify(body) });

export function useIphoneNotes() {
  const [view, setView] = useState<NotesView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);

  const load = useCallback(async () => {
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
      const v = await call(undefined, `?tz=${encodeURIComponent(tz)}`);
      if (alive.current) {
        setView(v);
        setError(null);
      }
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : "Couldn't load your notes.");
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    void load();
    const t = window.setInterval(() => document.visibilityState === "visible" && void load(), POLL_MS);
    window.addEventListener("focus", load);
    return () => {
      alive.current = false;
      window.clearInterval(t);
      window.removeEventListener("focus", load);
    };
  }, [load]);

  // Notes still being read come back in a few seconds; check sooner while any are.
  const reading = view?.notes.some((n) => n.status === "reading") ?? false;
  useEffect(() => {
    if (!reading) return;
    const t = window.setTimeout(() => void load(), 4000);
    return () => window.clearTimeout(t);
  }, [reading, view, load]);

  const act = useCallback(async (body: Record<string, unknown>) => {
    const v = await post(body);
    setView(v);
    return v;
  }, []);

  return { view, error, load, act, setError };
}

export function decideItem(act: (b: Record<string, unknown>) => Promise<NotesView>, d: Decision) {
  return act({ action: "decide", ...d });
}

/** What Approve will do, in one line, for the button's label and the toast. */
export function actionLine(i: NoteItem): string {
  switch (i.action) {
    case "todo":
      return `Add to your to-do${i.date ? ` (due ${i.date})` : ""}`;
    case "event":
      return `Add to your calendar on ${i.date}${i.time ? ` at ${i.time}` : ""}`;
    case "birthday":
      return `Add ${i.name}'s birthday (${i.when})`;
    case "memory":
      return "Save to Jarvis's memory";
    case "queue":
      return "Send to In Queue to build";
    case "task":
      return "Have Jarvis do it in chat";
    case "save":
      return `Save to Folders › iPhone Notes${i.folder ? ` › ${i.folder}` : ""}`;
    case "nothing":
      return "Mark as nothing to do";
  }
}

/**
 * Run an approved item for real. Throws a plain-English message when it
 * can't, so the page keeps the card waiting and says why.
 */
export async function runItem(note: Pick<NoteView, "title" | "body">, i: NoteItem, opts: { inJarvis: boolean }): Promise<string> {
  const source = `From your iPhone note "${note.title}"`;
  switch (i.action) {
    case "todo":
      await listsApi.addItem({ listId: "todo", text: i.text || i.label, dueDate: i.date ?? undefined, note: source });
      return `Added to your to-do: ${i.text || i.label}`;
    case "event": {
      if (!i.date) throw new Error("This event has no date — add one before approving.");
      createEvent({
        title: i.label || i.text,
        date: i.date,
        time: i.time ?? null,
        location: i.location,
        notes: `${source}.\n\n${note.body.slice(0, 1500)}`,
        reminders: i.time ? [1440, 60] : [1440],
        source: "agent",
      });
      return `On your calendar: ${i.label} — ${i.date}${i.time ? ` ${i.time}` : ""}`;
    }
    case "birthday": {
      const r = addBirthday({ name: i.name || i.label, relation: i.relation, date: i.when, notes: source });
      if ("error" in r) throw new Error(r.error);
      return `Birthday saved: ${i.name} (${i.when})`;
    }
    case "memory": {
      const res = await fetch("/api/jarvis/memory/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memories: [{ source: "note", title: i.label || i.text.slice(0, 80), content: i.text, origin: "iphone-notes", tags: ["iphone-notes"] }] }),
      });
      const j = (await res.json().catch(() => ({}))) as { available?: boolean; error?: string; reason?: string };
      if (!res.ok) throw new Error(j.error || "Couldn't save it to memory.");
      if (j.available === false) throw new Error(j.reason || "Memory isn't set up on this account yet.");
      return "Saved to Jarvis's memory";
    }
    case "queue": {
      const res = await fetch("/api/new-jarvis/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "add", text: `${i.text}\n\n(${source})` }),
      });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error || "Couldn't add it to In Queue.");
      return "Sent to In Queue";
    }
    case "task": {
      const text = `${i.text}\n\n(${source}: ${note.body.slice(0, 1200)})`;
      if (opts.inJarvis) {
        askJarvis({ text, send: true, mode: "do" });
        return "Jarvis is on it in chat";
      }
      // Outside Jarvis there is no chat to hand it to: it waits in In Queue instead.
      const res = await fetch("/api/new-jarvis/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "add", text }),
      });
      if (!res.ok) throw new Error("Couldn't hand that job over.");
      return "Sent to In Queue — open Jarvis to run it";
    }
    case "save": {
      const path = ["iPhone Notes", ...(i.folder ? i.folder.split(/\s*›\s*/).filter(Boolean).slice(0, 2) : [])];
      const { folderId } = ensureFolderPath(path);
      createItem({ title: i.label || note.title, body: note.body, summary: i.text.slice(0, 280), kind: "note", source: "manual", folderId, tags: ["iphone-notes"] });
      return `Saved to Folders › ${path.join(" › ")}`;
    }
    case "nothing":
      return "Marked as nothing to do";
  }
}
