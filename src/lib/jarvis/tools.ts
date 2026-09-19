// ---------------------------------------------------------------------------
// Which of Jarvis's tools may run by themselves, and which need a yes.
//
// The owner's rule (spec §1): anything with an effect outside the app gets
// confirmed first. Getting that classification wrong in the unsafe direction
// means an email leaves without permission, so the rule here is deliberately
// pessimistic: a tool is confirmed unless it is *known* to be read-only.
//
// Connector tools arrive at runtime from Composio, with names this app has
// never seen, so the test has to work on a name and an optional metadata flag.
// ---------------------------------------------------------------------------

export interface ToolSpec {
  /** Full name as the model will call it, e.g. "gmail.find_email". */
  name: string;
  description: string;
  /** JSON-schema properties for the arguments. */
  parameters: Record<string, unknown>;
  /** Set when the connector states it plainly. Trusted over the name. */
  readOnlyHint?: boolean;
  /** Which app it belongs to, for the confirm card's badge. */
  app?: string;
}

/** Verbs that only ever look. Anything else is treated as an action. */
const READ_VERBS = [
  "get", "list", "find", "search", "read", "fetch", "lookup", "look_up",
  "retrieve", "check", "view", "count", "describe",
];

/**
 * True when this tool can run without asking.
 *
 * The connector's own hint wins when present. Otherwise the leading verb of
 * the tool name decides, and an unrecognised name is an action — which costs a
 * needless confirmation at worst, versus an unwanted send at best.
 */
export function isReadOnly(tool: { name: string; readOnlyHint?: boolean }): boolean {
  if (typeof tool.readOnlyHint === "boolean") return tool.readOnlyHint;
  const bare = tool.name.includes(".") ? tool.name.slice(tool.name.indexOf(".") + 1) : tool.name;
  const verb = bare.toLowerCase().split(/[_\-.]/)[0] ?? "";
  return READ_VERBS.includes(verb);
}

/** The app half of "gmail.find_email", for the confirm card. */
export function appOf(tool: { name: string; app?: string }): string {
  if (tool.app) return tool.app;
  return tool.name.includes(".") ? tool.name.slice(0, tool.name.indexOf(".")) : "jarvis";
}

/**
 * A one-line, human summary of what a call would do. Shown on the confirm card
 * above the exact arguments, so the owner can say yes without reading JSON.
 */
export function summarise(tool: string, args: Record<string, unknown>): string {
  const s = (k: string): string => {
    const v = args[k];
    return typeof v === "string" ? v : "";
  };
  const bare = tool.includes(".") ? tool.slice(tool.indexOf(".") + 1) : tool;
  if (/event/i.test(bare) && /create|add|schedule|book/i.test(bare)) {
    const when = [s("start"), s("date"), s("start_time")].filter(Boolean)[0] ?? "";
    return `Add "${s("title") || s("summary") || "an event"}" to your calendar${when ? ` on ${when}` : ""}.`;
  }
  if (/event/i.test(bare) && /update|move|reschedule|edit/i.test(bare)) {
    return `Change the event "${s("title") || s("event_id") || "selected"}" in your calendar.`;
  }
  if (/event/i.test(bare) && /delete|cancel|remove/i.test(bare)) {
    return `Delete "${s("title") || s("event_id") || "an event"}" from your calendar.`;
  }
  if (/mail|message|send|reply|dm|post/i.test(bare)) {
    const to = s("to") || s("recipient") || s("channel") || s("thread") || "";
    return `Send a message${to ? ` to ${to}` : ""}${s("subject") ? ` — "${s("subject")}"` : ""}.`;
  }
  return `Run ${tool}.`;
}

/** The tools Jarvis always has, independent of any connector. */
export const CORE_TOOLS: ToolSpec[] = [
  {
    name: "search_memory",
    description:
      "Search everything Jarvis remembers about the owner: their notes, past conversations, their " +
      "master Claude folder (CLAUDE.md, aios/), their skills, and anything synced from connected " +
      "apps. Use this before answering any question about the owner, their work, their decisions " +
      "or their history. Returns the memories with their sources and dates.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "What to look for, in natural language." },
        limit: { type: "number", description: "How many memories to return (default 8, max 20)." },
      },
      required: ["query"],
    },
    readOnlyHint: true,
    app: "jarvis",
  },
  {
    name: "propose_memory",
    description:
      "Propose something worth remembering long-term: a durable fact, preference, decision or " +
      "lesson the owner stated. It is NOT saved — the owner reviews it first. Never propose " +
      "passwords, keys or whole message histories, and never propose something you inferred " +
      "without saying so in the content.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "A short title, as a citation would show it." },
        content: { type: "string", description: "The fact itself, in one or two sentences." },
      },
      required: ["title", "content"],
    },
    readOnlyHint: true,
    app: "jarvis",
  },
];

/** The OpenAI-compatible shape both providers accept. */
export function toApiTools(tools: ToolSpec[]): unknown[] {
  return tools.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}
