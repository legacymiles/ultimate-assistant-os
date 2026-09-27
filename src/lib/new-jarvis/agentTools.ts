// ---------------------------------------------------------------------------
// The tools New Jarvis's agent can reach, and where each one actually runs.
//
// The unusual part: none of these run on the server. They run in the OWNER'S
// BROWSER, because the bridge listens on 127.0.0.1 and Vercel cannot see this
// desk — only the tab can. So the loop here is client-driven: the route decides
// the next call, the page makes it, and the result comes back up as the next
// message. That inversion is why New Jarvis needs its own loop instead of
// reusing src/lib/jarvis/server/agent.ts, whose read tools all run server-side.
//
// Descriptions are written for the model and they are blunt on purpose. A tool
// description that oversells what it can do produces an agent that confidently
// tries the wrong thing and reports success.
// ---------------------------------------------------------------------------

export interface AgentTool {
  name: string;
  /**
   * Where this runs.
   *
   *   "bridge" — the local agent on 127.0.0.1, so it needs the PC.
   *   "hub"    — the owner's own stores, in this tab, with no agent at all.
   *              Memory, the Life Record, folders, lists and the calendar keep
   *              working when the bridge is down, which is most of the time.
   */
  kind: "bridge" | "hub";
  /** The bridge route, or a "hub/…" key the page dispatches on. */
  route: string;
  description: string;
  parameters: Record<string, unknown>;
  /**
   * Which capability must be up for this to be offered. Undefined means it
   * always is — which is what makes the hub tools survive a stopped agent.
   */
  needs?: "browser" | "shell" | "files" | "system";
}

import { FIELD_BY_KEY } from "@/lib/jarvis/record/types";

const str = (description: string) => ({ type: "string", description });

/**
 * The Record's real field keys, handed to the model.
 *
 * Without them it invents plausible ones — "council_tax_account" for a council
 * tax page — and the write silently matches nothing and saves nothing, which
 * looks from the outside exactly like the feature not working.
 */
export const RECORD_KEYS = [...FIELD_BY_KEY.keys()].sort();
const KEY_LIST = RECORD_KEYS.join(", ");

export const AGENT_TOOLS: AgentTool[] = [
  // --- browser ------------------------------------------------------------
  {
    name: "browser_open",
    kind: "bridge",
    route: "browser/open",
    needs: "browser",
    description:
      "Open a URL in the owner's automation browser. It keeps a real profile, so sites they have signed into stay signed in. Returns the tab id and title.",
    parameters: {
      type: "object",
      properties: { url: str("The address. A bare domain is fine.") },
      required: ["url"],
    },
  },
  {
    name: "browser_read",
    kind: "bridge",
    route: "browser/read",
    needs: "browser",
    description:
      "Read the current page: its visible text plus every clickable and typable control, each with a ref. You MUST call this before clicking or typing — refs only exist after a read, and they go stale when the page changes.",
    parameters: {
      type: "object",
      properties: { tabId: str("Which tab. Defaults to the most recent.") },
    },
  },
  {
    name: "browser_click",
    kind: "bridge",
    route: "browser/click",
    needs: "browser",
    description:
      "Click a control by the ref from browser_read. Always pass `name` as well — the owner's confirmation gate shows it, and a click on something irreversible is stopped for their yes.",
    parameters: {
      type: "object",
      properties: {
        ref: str("A ref from the last browser_read, e.g. ref_12."),
        name: str("The control's visible label, copied from the read."),
        tabId: str("Which tab."),
      },
      required: ["ref", "name"],
    },
  },
  {
    name: "browser_type",
    kind: "bridge",
    route: "browser/type",
    needs: "browser",
    description:
      "Type into a field by its ref. Set submit only when the form really should be sent — that stops for the owner's yes. Never type a password, a card number or a government ID.",
    parameters: {
      type: "object",
      properties: {
        ref: str("A ref from the last browser_read."),
        value: str("The text to put in the field."),
        name: str("The field's visible label."),
        submit: { type: "boolean", description: "Press Enter afterwards." },
        tabId: str("Which tab."),
      },
      required: ["ref", "value"],
    },
  },
  {
    name: "browser_scroll",
    kind: "bridge",
    route: "browser/scroll",
    needs: "browser",
    description: "Scroll the page. Read again afterwards — new controls get new refs.",
    parameters: {
      type: "object",
      properties: {
        direction: { type: "string", enum: ["up", "down"] },
        tabId: str("Which tab."),
      },
    },
  },
  {
    name: "browser_navigate",
    kind: "bridge",
    route: "browser/navigate",
    needs: "browser",
    description: "Go back, forward, or reload.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["back", "forward", "reload"] },
        tabId: str("Which tab."),
      },
      required: ["action"],
    },
  },
  {
    name: "page_fields",
    kind: "bridge",
    route: "browser/fields",
    needs: "browser",
    description:
      "List the form fields on the page — their keys, labels, whether they are filled, and a MASKED preview. "
      + "You never see the values themselves, by design. Use this to decide which fields are worth keeping, "
      + "then call record_capture with their keys; the value goes from the page to the owner's Record without "
      + "passing through you. This is the only way to save something sensitive, and the right way to save anything "
      + "read off a form.",
    parameters: { type: "object", properties: { tabId: str("Which tab.") } },
  },
  {
    name: "browser_tabs",
    kind: "bridge",
    route: "browser/tabs",
    needs: "browser",
    description: "List the open tabs with their ids, titles and URLs.",
    parameters: { type: "object", properties: {} },
  },

  // --- the machine --------------------------------------------------------
  {
    name: "shell_run",
    kind: "bridge",
    route: "shell",
    needs: "shell",
    description:
      "Run one PowerShell command on the owner's PC and read its output. Anything that is not a plain read stops for their yes. Prefer one simple command over a chained pipeline — a chain always asks, because nothing can vouch for what comes after the pipe.",
    parameters: {
      type: "object",
      properties: {
        command: str("The command."),
        cwd: str("Where to run it. Defaults to their home folder."),
      },
      required: ["command"],
    },
  },
  {
    name: "files_list",
    kind: "bridge",
    route: "files/list",
    needs: "files",
    description: "List a folder on the owner's PC.",
    parameters: { type: "object", properties: { path: str("Absolute path.") }, required: ["path"] },
  },
  {
    name: "files_read",
    kind: "bridge",
    route: "files/read",
    needs: "files",
    description: "Read a text file on the owner's PC. Long files come back truncated, and say so.",
    parameters: { type: "object", properties: { path: str("Absolute path.") }, required: ["path"] },
  },
  {
    name: "files_write",
    kind: "bridge",
    route: "files/write",
    needs: "files",
    description:
      "Write a text file on the owner's PC, replacing whatever is there. Always stops for their yes. Read it first if you mean to edit rather than replace.",
    parameters: {
      type: "object",
      properties: { path: str("Absolute path."), text: str("The full new contents.") },
      required: ["path", "text"],
    },
  },
  {
    name: "system_windows",
    kind: "bridge",
    route: "system/windows",
    needs: "system",
    description: "List the windows open on the owner's PC, with their process ids.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "system_focus",
    kind: "bridge",
    route: "system/focus",
    needs: "system",
    description: "Bring a window to the front by its pid, from system_windows.",
    parameters: { type: "object", properties: { pid: { type: "number" } }, required: ["pid"] },
  },
  {
    name: "system_launch",
    kind: "bridge",
    route: "system/launch",
    needs: "system",
    description: "Start a program or open a file with its default app. Stops for the owner's yes.",
    parameters: {
      type: "object",
      properties: { target: str("An executable, a document, or a URL.") },
      required: ["target"],
    },
  },
  {
    name: "system_screenshot",
    kind: "bridge",
    route: "system/screenshot",
    needs: "system",
    description: "Take a picture of the owner's screen so you can see what they see.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "system_info",
    kind: "bridge",
    route: "system/info",
    needs: "system",
    description: "Read this PC: hostname, user, OS, memory.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "clipboard_read",
    kind: "bridge",
    route: "system/clipboard/read",
    needs: "system",
    description: "Read what the owner has copied.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "clipboard_write",
    kind: "bridge",
    route: "system/clipboard/write",
    needs: "system",
    description: "Put text on the owner's clipboard, replacing what was there. Stops for their yes.",
    parameters: {
      type: "object",
      properties: { text: str("The text to copy.") },
      required: ["text"],
    },
  },
  // --- the owner's own stores -------------------------------------------
  // No `needs`: these run in this tab against the same data /apps/jarvis
  // uses, so they keep working when the local agent is stopped.
  {
    name: "record_capture",
    kind: "hub",
    route: "hub/record_capture",
    description:
      "Save fields you listed with page_fields into the owner's Life Record. Name the field keys and say which "
      + "Record field each one is. You are naming keys, not values — the value is taken from the copy this tab "
      + "already holds and written locally, so it never reaches you. Use this for anything a form asked for: "
      + "account numbers, reference numbers, addresses, employer details. "
      + `The Record field key you map to must be one of: ${KEY_LIST}. If nothing fits, say so instead of inventing a key.`,
    parameters: {
      type: "object",
      properties: {
        map: {
          type: "object",
          description: "Page field key → Record field key, e.g. {\"acct\":\"council_tax_account\"}.",
          additionalProperties: { type: "string" },
        },
        because: str("Where this came from, shown beside each value in the Record."),
      },
      required: ["map"],
      // The Record key must be one of these; anything else matches no field
      // and saves nothing.
      "x-record-keys": KEY_LIST,
    },
  },
  {
    name: "record_set",
    kind: "hub",
    route: "hub/record_set",
    description:
      "Write facts the owner has TOLD you into their Life Record — address, household, income, work history, "
      + "schools, references. Never a value they did not give you. Sensitive keys are refused here by design; "
      + "use record_capture for those, which never shows you the value. "
      + `The Record field key must be one of: ${KEY_LIST}.`,
    parameters: {
      type: "object",
      properties: {
        fields: { type: "object", description: "Record field key → value.", additionalProperties: { type: "string" } },
        because: str("Where this came from."),
      },
      required: ["fields"],
    },
  },
  {
    name: "propose_memory",
    kind: "hub",
    route: "hub/propose_memory",
    description:
      "Propose a durable memory when the owner states something lasting — a preference, a decision, a lesson, a "
      + "fact about how they work. It is a PROPOSAL: it waits on the Memory tab for their yes. Do not propose "
      + "something already in memory, and do not propose passing detail that will not matter next month.",
    parameters: {
      type: "object",
      properties: {
        title: str("A short name for it."),
        content: str("The fact itself, in one or two sentences."),
        origin: str("Where it came from, e.g. 'from the page you had open'."),
      },
      required: ["title", "content"],
    },
  },
  {
    name: "dashboard_add_note",
    kind: "hub",
    route: "hub/dashboard_add_note",
    description: "Save a note into one of the owner's folders.",
    parameters: {
      type: "object",
      properties: { title: str("Note title."), body: str("The note."), folder: str("Folder name.") },
      required: ["title", "body"],
    },
  },
  {
    name: "lists_add_item",
    kind: "hub",
    route: "hub/lists_add_item",
    description: "Add an entry to one of the owner's shared lists.",
    parameters: {
      type: "object",
      properties: {
        text: str("The entry."),
        list: str("Which list. Defaults to To-Do."),
        priority: str("high, medium or low."),
        private: { type: "boolean", description: "Keep it visible only to them." },
      },
      required: ["text"],
    },
  },
  {
    name: "dashboard_add_event",
    kind: "hub",
    route: "hub/dashboard_add_event",
    description: "Put something on the owner's calendar, with a reminder.",
    parameters: {
      type: "object",
      properties: { title: str("What it is."), date: str("YYYY-MM-DD."), time: str("HH:MM, optional.") },
      required: ["title", "date"],
    },
  },
];

const BY_NAME = new Map(AGENT_TOOLS.map((t) => [t.name, t]));

export function toolByName(name: string): AgentTool | undefined {
  return BY_NAME.get(name);
}

/** The bridge route a tool name maps to, or "" when it is not one of ours. */
export function routeFor(name: string): string {
  return BY_NAME.get(name)?.route ?? "";
}

/**
 * The tools to offer, given what the bridge can actually do right now.
 *
 * A tool the agent cannot run must never appear: offered browser control with
 * no Chromium installed, the model spends the whole turn trying to open a page
 * and then explains its failure, instead of saying at the start that browser
 * control is off.
 */
export function toolsFor(caps: Partial<Record<NonNullable<AgentTool["needs"]>, boolean>>): AgentTool[] {
  // A tool with no `needs` is a hub tool and is always offered — that is what
  // keeps memory, the Record, folders, lists and the calendar alive when the
  // local agent is stopped, which is most of the time.
  return AGENT_TOOLS.filter((t) => !t.needs || caps[t.needs] === true);
}

/** Whether this call runs against the owner's own stores rather than the PC. */
export function isHubTool(name: string): boolean {
  return BY_NAME.get(name)?.kind === "hub";
}

/** OpenAI-shaped function definitions for the model. */
export function toApiTools(tools: AgentTool[]): unknown[] {
  return tools.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}

/**
 * An assistant turn, safe to send back to the provider.
 *
 * Echoing the provider's own message verbatim is what makes a client-driven
 * tool loop work at all (a rebuilt one loses the fields a Responses-API
 * provider matches its tool result against). But verbatim includes the keys it
 * set to null — `reasoning` is the one seen in the wild — and sending those
 * back is rejected with "Invalid input: expected string, received null" at
 * `messages.N.reasoning`, which kills the run several steps in, after real work
 * has already happened.
 *
 * So: keep every key the provider sent, drop the ones it left null. That is
 * narrower than rebuilding the message and it fixes the only thing wrong with
 * echoing it.
 */
export function sanitizeAssistant<T extends Record<string, unknown>>(message: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(message)) {
    if (v === null) continue;
    out[k] = v;
  }
  return out as Partial<T>;
}

/**
 * What the owner is told when the model call fails.
 *
 * The provider's own payload is not an error message. Concatenating it into a
 * sentence hands over a schema path like `messages.2.reasoning` — which names
 * neither the problem nor the recovery, and is the exact failure "degrade,
 * never fail" exists to forbid. The detail belongs in the server log, where it
 * is useful; the block gets one line in the product's voice.
 */
export function modelFailure(status: number): string {
  if (status === 401 || status === 403) {
    // Measured, not assumed: OpenRouter answers 401 for an exhausted balance,
    // not 402, so a message that only mentions the key sends the owner to
    // check a key that is perfectly fine.
    return "The AI provider turned the request away — usually an empty balance, sometimes the key. Check the OpenRouter credit first, then OPENROUTER_API_KEY in .env.local.";
  }
  if (status === 402) {
    return "The AI provider is out of credit. Top it up and run this again.";
  }
  if (status === 429) {
    return "The AI provider is rate-limiting this key. Wait a moment and run it again.";
  }
  if (status === 408 || status === 504) {
    return "The model took too long to answer. Running it again usually works.";
  }
  if (status >= 500) {
    // Scoped to the round that failed, not to the run. This sentence can land
    // under a ledger showing three completed shell steps, and an unscoped
    // "nothing was touched" would contradict what is on screen.
    return "The AI provider is having trouble, so this run stopped here. The steps above already ran; nothing new was touched. Try again in a minute.";
  }
  if (status === 400) {
    // A 400 is ours, not theirs. Say so rather than implying the owner did
    // something wrong, and say what survived.
    return "This run hit a bad request building the next step, so it stopped here. The steps above already ran; the details are in the server log.";
  }
  return `The model could not be reached (${status}). The steps above already ran; try this one again.`;
}
