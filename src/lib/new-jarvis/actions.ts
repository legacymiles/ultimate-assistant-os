// ---------------------------------------------------------------------------
// What New Jarvis may do by itself, and what it has to ask about first.
//
// The rule in src/lib/jarvis/tools.ts is the right one and this is its
// extension to a bridge that can touch the machine: read freely, confirm
// anything with an effect outside the app. But a bridge makes the old
// verb-prefix test useless, because the dangerous half of browser control is
// not a differently-named tool — it is the same `click` on a different button.
//
// So the classification here is per-operation, and for a click it reads the
// button. Confirming every click would be the safe-looking answer and it is
// the wrong one: an agent that asks permission forty times to fill in a form
// is an agent the owner turns off, and an agent nobody uses protects nothing.
// What gets confirmed is the small set of clicks that cannot be undone.
// ---------------------------------------------------------------------------

export type Risk = "read" | "act" | "grave";

export interface BridgeOp {
  /** The bridge route, e.g. "browser/click" or "shell". */
  route: string;
  args: Record<string, unknown>;
}

export interface Verdict {
  risk: Risk;
  /** Whether the owner sees a gate before this runs. */
  confirm: boolean;
  /** One sentence, in the owner's language, of what is about to happen. */
  summary: string;
  /** Why it is being asked about, shown under the summary. Empty when free. */
  why: string;
}

/** Routes that only ever look. Everything not listed is treated as an action. */
const READ_ROUTES = new Set([
  "status",
  "browser/read",
  "browser/tabs",
  "browser/screenshot",
  "browser/scroll",
  "files/list",
  "files/read",
  "system/windows",
  "system/info",
  "system/screenshot",
  "system/clipboard/read",
]);

/**
 * Words on a control that mean the click cannot be taken back.
 *
 * Deliberately about consequence, not about danger-sounding language: "delete"
 * and "pay" are here, "advanced" and "settings" are not. A list that fires on
 * everything trains the owner to click through the gate without reading it,
 * which is strictly worse than having no gate.
 */
const IRREVERSIBLE = [
  /\b(send|submit|post|publish|tweet|reply|share)\b/i,
  /\b(buy|order|purchase|pay|checkout|subscribe|donate|place\s+order)\b/i,
  /\b(delete|remove|destroy|erase|wipe|cancel\s+(account|subscription))\b/i,
  /\b(confirm|accept|agree|authorize|authorise|approve|i\s+agree)\b/i,
  /\b(sign\s*out|log\s*out|deactivate|close\s+account)\b/i,
  /\b(apply|book|reserve|register|sign\s*up|create\s+account)\b/i,
];

/** Shell commands that only report. The leading word decides; anything else acts. */
const READ_COMMANDS = [
  "dir", "ls", "type", "cat", "get-content", "get-childitem", "get-process",
  "get-date", "get-location", "pwd", "whoami", "hostname", "echo", "where",
  "which", "tree", "findstr", "select-string", "test-path", "get-item",
  "systeminfo", "ipconfig", "ping", "node", "python",
];

/** `git status` looks; `git push` does not. Second word decides for these. */
const SUBCOMMAND_READS: Record<string, string[]> = {
  git: ["status", "log", "diff", "show", "branch", "remote", "config", "blame"],
  npm: ["ls", "list", "outdated", "view", "why"],
  docker: ["ps", "images", "logs", "inspect"],
};

function firstWords(command: string): [string, string] {
  const parts = String(command).trim().toLowerCase().split(/\s+/);
  return [parts[0] ?? "", parts[1] ?? ""];
}

/** Whether this shell command is known to only report. Unknown means it acts. */
export function commandOnlyReads(command: string): boolean {
  const raw = String(command ?? "");
  // A pipeline or a chain can hide anything after the part we recognised, so
  // only a single simple command is ever eligible.
  if (/[;&|>]|\$\(|`/.test(raw)) return false;
  const [head, second] = firstWords(raw);
  if (!head) return false;
  const subs = SUBCOMMAND_READS[head];
  if (subs) return subs.includes(second);
  return READ_COMMANDS.includes(head);
}

function truncate(text: string, n = 70): string {
  const s = String(text ?? "").replace(/\s+/g, " ").trim();
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function hostOf(url: unknown): string {
  try {
    return new URL(String(url)).host;
  } catch {
    return String(url ?? "");
  }
}

/**
 * The gate's verdict for one bridge call.
 *
 * Always returns a summary, including for the free ones: the same sentence is
 * what the run log shows afterwards, so a step reads the same whether it was
 * confirmed or not.
 */
export function classify(op: BridgeOp): Verdict {
  const { route, args } = op;
  const free = (summary: string): Verdict => ({ risk: "read", confirm: false, summary, why: "" });
  const gate = (risk: Risk, summary: string, why: string): Verdict => ({ risk, confirm: true, summary, why });

  switch (route) {
    case "browser/read":
      return free("Read the page.");
    case "browser/tabs":
      return free("List the open tabs.");
    case "browser/screenshot":
      return free("Take a picture of the page.");
    case "browser/scroll":
      return free(`Scroll ${String(args.direction ?? "down")}.`);
    case "files/list":
      return free(`List ${truncate(String(args.path ?? ""))}.`);
    case "files/read":
      return free(`Read ${truncate(String(args.path ?? ""))}.`);
    case "system/windows":
      return free("List the open windows.");
    case "system/info":
      return free("Check this PC.");
    case "system/screenshot":
      return free("Take a picture of the screen.");
    case "system/clipboard/read":
      return free("Read the clipboard.");
    case "status":
      return free("Check the local agent.");

    case "browser/open":
    case "browser/navigate": {
      const action = String(args.action ?? "");
      if (action === "back") return free("Go back.");
      if (action === "forward") return free("Go forward.");
      if (action === "reload") return free("Reload the page.");
      return free(`Open ${truncate(hostOf(args.url), 50)}.`);
    }

    case "browser/click": {
      const name = String(args.name ?? args.text ?? args.ref ?? "that control");
      const hit = IRREVERSIBLE.find((re) => re.test(name));
      if (hit) {
        return gate("grave", `Click "${truncate(name, 50)}".`, "This one cannot be undone from here.");
      }
      return free(`Click "${truncate(name, 50)}".`);
    }

    case "browser/press": {
      const key = String(args.key ?? "");
      // Enter in a form is a submit wearing a keyboard's clothes.
      if (/^enter$/i.test(key)) return gate("act", "Press Enter.", "In a form this submits it.");
      return free(`Press ${key}.`);
    }

    case "browser/type": {
      const name = String(args.name ?? args.ref ?? "a field");
      const typed = truncate(String(args.value ?? ""), 40);
      if (args.submit) {
        return gate("grave", `Type "${typed}" into ${name} and submit.`, "Submitting sends it.");
      }
      return free(`Type "${typed}" into ${name}.`);
    }

    case "shell": {
      const command = String(args.command ?? "");
      if (commandOnlyReads(command)) return free(`Run \`${truncate(command, 60)}\`.`);
      return gate("act", `Run \`${truncate(command, 60)}\`.`, "This runs on your PC as you.");
    }

    case "files/write":
      return gate(
        "act",
        `Write ${truncate(String(args.path ?? ""), 60)}.`,
        "This replaces whatever is in that file.",
      );

    case "system/launch":
      return gate("act", `Open ${truncate(String(args.target ?? ""), 50)}.`, "This starts a program on your PC.");

    case "system/focus":
      return free("Bring that window to the front.");

    case "system/clipboard/write":
      return gate(
        "act",
        `Copy "${truncate(String(args.text ?? ""), 40)}" to the clipboard.`,
        "This replaces what you had copied.",
      );

    case "browser/close":
      return free("Close that tab.");
    case "browser/quit":
      return gate("act", "Close the browser.", "Anything half-filled in it is lost.");

    default:
      // An unknown route is an action. Getting this wrong in the safe direction
      // costs one needless confirmation; the other way runs something nobody
      // classified.
      return gate("act", `Run ${route}.`, "New Jarvis does not recognise this one.");
  }
}

/** Convenience for the run log, where every step needs its one line. */
export function summarise(op: BridgeOp): string {
  return classify(op).summary;
}
