import "server-only";

// ---------------------------------------------------------------------------
// Which connector Jarvis uses, and the normalising that keeps the rest of the
// app ignorant of it.
//
// Composio today. The Google-direct connector will slot in here when the free
// tool-call allowance stops being enough: same interface, no change anywhere
// else. That is the whole reason this file exists.
// ---------------------------------------------------------------------------

import { composioConnector } from "./composio";
import type { Connector, NormalisedEvent, NormalisedMessage } from "./types";

export * from "./types";
export { KNOWN_APPS } from "./composio";

export function connector(): Connector {
  return composioConnector();
}

/** First string found at any of these paths, else "". */
function pick(obj: unknown, keys: string[]): string {
  if (!obj || typeof obj !== "object") return "";
  const o = obj as Record<string, unknown>;
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "string" && v.trim()) return v;
    if (typeof v === "number") return String(v);
  }
  return "";
}

/** Anything that looks like a list of records inside a tool's reply. */
function rows(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) return result as Record<string, unknown>[];
  if (!result || typeof result !== "object") return [];
  const o = result as Record<string, unknown>;
  for (const k of ["messages", "items", "events", "data", "results", "threads", "response_data"]) {
    const v = o[k];
    if (Array.isArray(v)) return v as Record<string, unknown>[];
    if (v && typeof v === "object") {
      const nested = rows(v);
      if (nested.length) return nested;
    }
  }
  return [];
}

/**
 * Messages out of whatever shape the app returned.
 *
 * Deliberately forgiving: Gmail, Outlook and Slack disagree about every field
 * name, and a missing subject is a blank subject, never an invented one.
 */
export function normaliseMessages(app: string, result: unknown): NormalisedMessage[] {
  return rows(result)
    .map((r, i) => {
      const body =
        pick(r, ["messageText", "snippet", "body", "text", "preview", "content", "bodyPreview"]) || "";
      const from = pick(r, ["sender", "from", "user", "fromEmail", "from_email", "author"]) || "unknown";
      const subject = pick(r, ["subject", "title", "threadName", "channel"]) || "(no subject)";
      const at =
        pick(r, ["messageTimestamp", "date", "receivedDateTime", "ts", "timestamp", "created_at"]) || "";
      return {
        id: pick(r, ["messageId", "id", "message_id", "threadId", "ts"]) || `${app}-${i}`,
        app,
        from,
        subject,
        body,
        at: at && !Number.isNaN(Date.parse(at)) ? new Date(at).toISOString() : new Date().toISOString(),
        link: pick(r, ["link", "url", "permalink", "webLink"]) || undefined,
      };
    })
    .filter((m) => m.subject !== "(no subject)" || m.body.trim().length > 0);
}

/** Local YYYY-MM-DD and HH:MM out of whatever the calendar returned. */
function splitWhen(value: string): { date: string; time: string } {
  if (!value) return { date: "", time: "" };
  const t = Date.parse(value);
  if (Number.isNaN(t)) {
    // An all-day event arrives as a bare date.
    return /^\d{4}-\d{2}-\d{2}$/.test(value) ? { date: value, time: "" } : { date: "", time: "" };
  }
  const d = new Date(t);
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const time = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return { date, time: value.length <= 10 ? "" : time };
}

export function normaliseEvents(app: string, result: unknown): NormalisedEvent[] {
  return rows(result)
    .map((r, i) => {
      const startRaw =
        pick(r, ["start_datetime", "startTime", "start_time"]) ||
        pick(r.start, ["dateTime", "date"]) ||
        pick(r, ["start"]);
      const endRaw =
        pick(r, ["end_datetime", "endTime", "end_time"]) || pick(r.end, ["dateTime", "date"]) || pick(r, ["end"]);
      const s = splitWhen(startRaw);
      const e = splitWhen(endRaw);
      return {
        id: pick(r, ["id", "eventId", "event_id", "iCalUID"]) || `${app}-${i}`,
        app,
        title: pick(r, ["summary", "title", "subject", "name"]) || "(untitled)",
        date: s.date,
        start: s.time,
        end: e.time,
        timezone:
          pick(r, ["timezone", "timeZone"]) ||
          pick(r.start, ["timeZone"]) ||
          Intl.DateTimeFormat().resolvedOptions().timeZone,
        where: pick(r, ["location", "where"]) || undefined,
        notes: pick(r, ["description", "notes"]) || undefined,
      };
    })
    .filter((e) => e.date);
}

/** The first tool whose name suggests it does `what`, or null. */
export function findTool(tools: { name: string }[], app: string, what: RegExp): string | null {
  const match = tools.find((t) => t.name.startsWith(`${app}.`) && what.test(t.name));
  return match?.name ?? null;
}
