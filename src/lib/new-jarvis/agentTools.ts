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
  /** The bridge route this maps to. */
  route: string;
  description: string;
  parameters: Record<string, unknown>;
  /** Which capability must be up for this to be offered at all. */
  needs: "browser" | "shell" | "files" | "system";
}

const str = (description: string) => ({ type: "string", description });

export const AGENT_TOOLS: AgentTool[] = [
  // --- browser ------------------------------------------------------------
  {
    name: "browser_open",
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
    name: "browser_tabs",
    route: "browser/tabs",
    needs: "browser",
    description: "List the open tabs with their ids, titles and URLs.",
    parameters: { type: "object", properties: {} },
  },

  // --- the machine --------------------------------------------------------
  {
    name: "shell_run",
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
    route: "files/list",
    needs: "files",
    description: "List a folder on the owner's PC.",
    parameters: { type: "object", properties: { path: str("Absolute path.") }, required: ["path"] },
  },
  {
    name: "files_read",
    route: "files/read",
    needs: "files",
    description: "Read a text file on the owner's PC. Long files come back truncated, and say so.",
    parameters: { type: "object", properties: { path: str("Absolute path.") }, required: ["path"] },
  },
  {
    name: "files_write",
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
    route: "system/windows",
    needs: "system",
    description: "List the windows open on the owner's PC, with their process ids.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "system_focus",
    route: "system/focus",
    needs: "system",
    description: "Bring a window to the front by its pid, from system_windows.",
    parameters: { type: "object", properties: { pid: { type: "number" } }, required: ["pid"] },
  },
  {
    name: "system_launch",
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
    route: "system/screenshot",
    needs: "system",
    description: "Take a picture of the owner's screen so you can see what they see.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "system_info",
    route: "system/info",
    needs: "system",
    description: "Read this PC: hostname, user, OS, memory.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "clipboard_read",
    route: "system/clipboard/read",
    needs: "system",
    description: "Read what the owner has copied.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "clipboard_write",
    route: "system/clipboard/write",
    needs: "system",
    description: "Put text on the owner's clipboard, replacing what was there. Stops for their yes.",
    parameters: {
      type: "object",
      properties: { text: str("The text to copy.") },
      required: ["text"],
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
export function toolsFor(caps: Partial<Record<AgentTool["needs"], boolean>>): AgentTool[] {
  return AGENT_TOOLS.filter((t) => caps[t.needs] === true);
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
    return "The AI provider rejected the key. Check OPENROUTER_API_KEY, then run this again.";
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
    return "The AI provider is having trouble. Nothing on your PC was touched — run this again in a minute.";
  }
  if (status === 400) {
    // A 400 is ours, not theirs. Say so rather than implying the owner did
    // something wrong, and say what survived.
    return "This run hit a bad request building the next step, so it stopped here. The steps above already ran; the details are in the server log.";
  }
  return `The model could not be reached (${status}). The steps above already ran.`;
}
