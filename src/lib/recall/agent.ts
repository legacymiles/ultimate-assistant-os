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

import { retrieveContext, buildOutline, shareable } from "./rag";
import { buildAgentPrompt, parseAgentJson, type AgentPromptInput, type Turn } from "./agentPrompt";
import { readChatModel } from "@/lib/new-jarvis/useChatModel";
import { isSubscription, modelLabel, subscriptionModel } from "@/lib/new-jarvis/chatModels";
import { call as bridgeCall } from "@/lib/new-jarvis/bridge";
import { folderPaths } from "./classify";
import { folderPathString } from "./store";
import { getEvents, upcoming } from "./calendar/store";
import { formatDayKey, formatTime, todayKey } from "./calendar/types";
import type { CalendarEvent } from "./calendar/types";
import { getPhotos, getQueue } from "./photos/store";
import { ROLE_LABELS } from "./photos/types";
import { isSensitiveField, profileCompleteness } from "./profiles";
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
  const profileMatch = question.match(
    /(?:create|add|make|start)\s+(?:a\s+)?profile\s+(?:for|of|about)\s+(?:my\s+)?(.{2,60})/i,
  );
  if (profileMatch) {
    const subject = profileMatch[1].replace(/\b(?:please|thanks)\b/gi, "").trim();
    if (subject) {
      const kind = /\b(llc|inc|corp|business|company|brand|agency|store|shop)\b/i.test(subject)
        ? "business"
        : "person";
      actions.push({
        type: "create_profile",
        kind,
        displayName: subject.replace(/^["']|["']$/g, ""),
        role: kind === "person" ? "other" : undefined,
        fields: [],
        accounts: [],
        tags: [],
      });
    }
  }
  return actions;
}

/**
 * The offline answer. It now covers the calendar too: with no key, "what's on
 * this week" is answerable from local data alone and it would be a poor
 * assistant that shrugged at it.
 */
/**
 * What the assistant says when no model is configured.
 *
 * This exists because the SILENT fallback was itself the bug. With no key the
 * route returned null, the keyword search answered instead, and the reply read
 * as a stupid AI rather than an absent one — a user reported exactly that after
 * asking it to move a folder and getting a search hit back. A degraded mode
 * that does not announce itself is indistinguishable from a broken feature.
 */
export function degradedNotice(): string {
  return [
    "AI is off - this is a keyword search, not an answer.",
    "This server has no AI key. Pick \"Claude · my subscription\" in the model menu " +
      "(uses your PC's Jarvis agent), or set OPENROUTER_API_KEY (or AI_GATEWAY_API_KEY) " +
      "in .env.local and restart the dev server.",
  ].join("\n");
}

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

export interface AskOptions {
  /** The shared Jarvis model pick. Defaults to the stored pick every chat uses. */
  model?: string;
  /** Earlier turns of this chat, oldest first. */
  history?: Turn[];
}

type Parsed = NonNullable<ReturnType<typeof parseAgentJson>>;
type Round =
  | { ok: true; parsed: Parsed; model: string; brain: "subscription" | "cloud"; note?: string }
  | { ok: false; noKey?: boolean; error?: string };

/**
 * One call through the shared Jarvis harness. "Claude · my subscription" goes
 * to the PC agent's /brain/claude (the same brain the main chat uses); every
 * other pick goes to the cloud route with that model. If the PC agent can't be
 * reached, the cloud answers and the reply says so.
 */
async function oneRound(payload: AgentPromptInput, model: string): Promise<Round> {
  let note: string | undefined;
  if (isSubscription(model)) {
    try {
      const { system, user } = buildAgentPrompt(payload);
      const r = await bridgeCall<{ text?: string; model?: string }>("brain/claude", {
        system,
        tools: [],
        raw: true,
        model: subscriptionModel(model),
        messages: [{ role: "user", content: user }],
      });
      const text = String(r.text ?? "").trim();
      const parsed = parseAgentJson(text);
      if (parsed) return { ok: true, parsed, model: String(r.model ?? model), brain: "subscription" };
      // Not JSON: Claude answered in prose. Still an answer — keep it.
      if (text) return { ok: true, parsed: { answer: text, citations: [], actions: [], read: [] }, model: String(r.model ?? model), brain: "subscription" };
    } catch (e) {
      note = `Your PC's Claude wasn't reachable (${e instanceof Error ? e.message : String(e)}), so the cloud model answered.`;
    }
  }
  try {
    const res = await fetch("/api/recall", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, stage: "agent", model: isSubscription(model) ? "" : model }),
    });
    const out = (await res.json().catch(() => ({}))) as {
      reply?: { answer?: string; citations?: string[]; actions?: unknown[]; read?: string[] } | null;
      noKey?: boolean;
      error?: string;
      model?: string;
    };
    const r = out.reply;
    if (r && (r.answer?.trim() || r.read?.length || r.actions?.length)) {
      return {
        ok: true,
        parsed: {
          answer: String(r.answer ?? "").trim(),
          citations: (r.citations ?? []).map(String),
          actions: r.actions ?? [],
          read: (r.read ?? []).map(String),
        },
        model: out.model ?? model,
        brain: "cloud",
        note,
      };
    }
    if (out.noKey) return { ok: false, noKey: true, error: note };
    return { ok: false, error: out.error ?? (res.ok ? "The model sent an empty answer." : `The Folders route answered ${res.status}.`) };
  } catch (e) {
    return { ok: false, error: `Couldn't reach the Folders route: ${e instanceof Error ? e.message : String(e)}` };
  }
}

function toCandidate(it: Item, data: RecallData) {
  return {
    id: it.id,
    title: it.title,
    summary: it.summary,
    body: it.body.slice(0, 2400),
    // The text read out of the file itself — this is what lets the agent
    // answer from the CONTENTS of a PDF or a screenshot, not its name.
    extract: it.extract?.slice(0, 2400),
    kind: it.kind,
    folder: folderPathString(data.folders, it.folderId),
    tags: it.people?.length ? [...it.tags, ...it.people.map((p) => `person:${p}`)] : it.tags,
  };
}

export async function askAgent(question: string, data: RecallData, opts: AskOptions = {}): Promise<AgentReply> {
  const model = opts.model ?? readChatModel();
  const candidates = retrieveContext(question, data, 8);
  const allEvents = getEvents();
  const soon = upcoming(allEvents, 25);
  const photos = getPhotos();
  const pendingCount = getQueue().filter((p) => p.status === "ready").length;

  // Only non-sensitive values leave the browser. SSNs, EINs and passwords stay
  // on the device; the assistant sees the label and knows it is missing/known,
  // which is enough to ask the right question without shipping the secret.
  const profilePayload = (data.profiles ?? []).map((profile) => {
    const completeness = profileCompleteness(profile);
    const details = profile.fields
      .filter((f) => f.value.trim() && !isSensitiveField(f))
      .map((f) => `${f.label}: ${f.value.trim()}`)
      .slice(0, 14)
      .join("; ");
    const accounts = profile.accounts.map((a) => {
      const bits = [
        a.label,
        a.provider ? `(${a.provider})` : "",
        a.openedDate ? `opened ${a.openedDate}` : "",
        a.renewalDate ? `renews ${a.renewalDate}` : "",
        a.value ? `value ${a.currency ?? "USD"} ${a.value}` : "",
      ].filter(Boolean);
      return bits.join(" ");
    });
    return {
      id: profile.id,
      displayName: profile.displayName,
      kind: profile.kind,
      role: profile.role,
      headline: profile.headline,
      folder: folderPathString(data.folders, profile.folderId),
      details,
      missing: completeness.missing.map((f) => f.label),
      accounts,
    };
  });

  const shortlist = new Set(candidates.map((c) => c.id));
  const outline = buildOutline(data, { skip: shortlist });
  const payload: AgentPromptInput = {
    question,
    candidates: candidates.map((it) => toCandidate(it, data)),
    folderPaths: folderPaths(data.folders),
    // Folder ids so the agent can propose rename/move/merge/delete on them.
    folders: data.folders.map((f) => ({ id: f.id, path: folderPathString(data.folders, f.id) })),
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
    profiles: profilePayload,
    outline: outline.entries,
    outlineOmitted: outline.omitted,
    history: opts.history?.slice(-8),
  };

  let round = await oneRound(payload, model);
  let used = candidates;

  // Second pass: the model read the outline and asked for the items it needs.
  if (round.ok && round.parsed.read.length) {
    const byId = new Map(shareable(data.items).map((i) => [i.id, i]));
    const extra: Item[] = [];
    for (const id of round.parsed.read) {
      const it = byId.get(id);
      if (it && !shortlist.has(it.id)) extra.push(it);
    }
    if (extra.length) {
      used = [...candidates, ...extra];
      const again = await oneRound(
        {
          ...payload,
          candidates: used.map((it) => toCandidate(it, data)),
          outline: buildOutline(data, { skip: new Set(used.map((i) => i.id)) }).entries,
          finalPass: true,
        },
        model,
      );
      if (again.ok) round = again;
    }
  }

  if (round.ok && (round.parsed.answer || round.parsed.actions.length)) {
    return {
      answer: [round.parsed.answer || "Here's what I propose:", round.note].filter(Boolean).join("\n\n"),
      citations: sanitizeCitations(round.parsed.citations, shareable(data.items)),
      actions: sanitizeActions(round.parsed.actions, data, allEvents),
      engine: "ai",
      model: round.model,
      brain: round.brain,
    };
  }

  const hits = heuristicAnswer(question, used, data.folders, soon);
  if (!round.ok && !round.noKey) {
    return {
      answer: `${round.error ?? "The AI call failed."}\n\nMeanwhile, a plain search found:\n${hits}`,
      citations: used.slice(0, 3).map((c) => c.id),
      actions: [],
      engine: "error",
      model: modelLabel(model),
    };
  }
  return {
    answer: [degradedNotice(), hits].join("\n\n"),
    citations: used.slice(0, 3).map((c) => c.id),
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
const PROFILE_FIELD_TYPES = [
  "text",
  "email",
  "phone",
  "date",
  "ssn",
  "number",
  "money",
  "url",
  "login",
  "secret",
  "note",
] as const;

const PROFILE_ACCOUNT_KINDS = [
  "account",
  "brokerage",
  "retirement",
  "crypto",
  "domain",
  "hosting",
  "saas",
  "subscription",
  "other",
] as const;

function optionalText(value: unknown): string | undefined {
  const text = typeof value === "string" ? value.trim() : "";
  return text || undefined;
}

export function sanitizeActions(input: unknown, data: RecallData, events: CalendarEvent[]): AgentAction[] {
  if (!Array.isArray(input)) return [];
  const itemIds = new Set(data.items.map((i) => i.id));
  const folderIds = new Set(data.folders.map((f) => f.id));
  const profileIds = new Set((data.profiles ?? []).map((p) => p.id));
  const eventIds = new Set(events.map((e) => e.id));
  const out: AgentAction[] = [];

  for (const raw of input as Record<string, unknown>[]) {
    const type = String(raw?.type ?? "");
    const path = Array.isArray(raw?.path) ? (raw.path as unknown[]).map(String).filter(Boolean) : [];
    const tags = Array.isArray(raw?.tags) ? (raw.tags as unknown[]).map(String).filter(Boolean) : [];
    const itemId = typeof raw?.itemId === "string" ? raw.itemId : "";
    const folderId = typeof raw?.folderId === "string" ? raw.folderId : "";
    const profileId = typeof raw?.profileId === "string" ? raw.profileId : "";
    const eventId = typeof raw?.eventId === "string" ? raw.eventId : "";
    const title = typeof raw?.title === "string" ? raw.title.trim() : "";
    const displayName = typeof raw?.displayName === "string" ? raw.displayName.trim() : "";
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
        if (title && typeof raw?.body === "string") {
          const reason = optionalText(raw?.reason);
          out.push({ type, title, body: raw.body, path, tags, ...(reason ? { reason } : {}) });
        }
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

      case "create_profile": {
        const kind = String(raw?.kind ?? "");
        if (kind !== "person" && kind !== "business") break;
        if (!displayName) break;
        const fields = Array.isArray(raw?.fields)
          ? (raw.fields as Record<string, unknown>[])
              .map((f) => {
                const type = String(f?.type ?? "text") as (typeof PROFILE_FIELD_TYPES)[number];
                return {
                  label: String(f?.label ?? "").trim(),
                  value: String(f?.value ?? "").trim(),
                  type: PROFILE_FIELD_TYPES.includes(type) ? type : ("text" as const),
                };
              })
              .filter((f) => f.label)
              .slice(0, 24)
          : [];
        const accounts = Array.isArray(raw?.accounts)
          ? (raw.accounts as Record<string, unknown>[])
              .map((a) => {
                const accountKind = String(a?.kind ?? "other") as (typeof PROFILE_ACCOUNT_KINDS)[number];
                return {
                  label: String(a?.label ?? "").trim(),
                  provider: optionalText(a?.provider),
                  kind: PROFILE_ACCOUNT_KINDS.includes(accountKind) ? accountKind : "other",
                  openedDate: optionalText(a?.openedDate),
                  renewalDate: optionalText(a?.renewalDate),
                  login: optionalText(a?.login),
                  value: optionalText(a?.value),
                  currency: optionalText(a?.currency),
                  url: optionalText(a?.url),
                };
              })
              .filter((a) => a.label)
              .slice(0, 12)
          : [];
        out.push({
          type,
          kind,
          displayName,
          role: optionalText(raw?.role),
          fields,
          accounts,
          tags: Array.isArray(raw?.tags)
            ? Array.from(new Set(raw.tags.map(String).filter(Boolean))).slice(0, 8)
            : [],
        });
        break;
      }

      case "update_profile_field": {
        const label = typeof raw?.label === "string" ? raw.label.trim() : "";
        const value = typeof raw?.value === "string" ? raw.value.trim() : "";
        if (profileIds.has(profileId) && label && value) out.push({ type, profileId, label, value });
        break;
      }

      case "add_profile_account": {
        const label = typeof raw?.label === "string" ? raw.label.trim() : title;
        if (!profileIds.has(profileId) || !label) break;
        const accountKind = String(raw?.kind ?? "other") as (typeof PROFILE_ACCOUNT_KINDS)[number];
        out.push({
          type,
          profileId,
          label,
          provider: optionalText(raw?.provider),
          kind: PROFILE_ACCOUNT_KINDS.includes(accountKind) ? accountKind : "other",
          openedDate: optionalText(raw?.openedDate),
          renewalDate: optionalText(raw?.renewalDate),
          login: optionalText(raw?.login),
          value: optionalText(raw?.value),
          currency: optionalText(raw?.currency),
          url: optionalText(raw?.url),
        });
        break;
      }

      case "delete_profile":
        if (profileIds.has(profileId)) out.push({ type, profileId });
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
  // A save creates its own missing folders, so a separate "create folder" for
  // the same path (or a parent of it) is a second button doing nothing new.
  const norm = (p: string[]) => p.map((x) => x.trim().toLowerCase());
  const savePaths = out.filter((a): a is Extract<AgentAction, { type: "create_note" }> => a.type === "create_note").map((a) => norm(a.path));
  return out.filter(
    (a) =>
      a.type !== "create_folder" ||
      !savePaths.some((sp) => norm(a.path).length <= sp.length && norm(a.path).every((x, i) => x === sp[i])),
  );
}
