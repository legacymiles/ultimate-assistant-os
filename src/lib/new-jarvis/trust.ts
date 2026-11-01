// ---------------------------------------------------------------------------
// How much Jarvis is trusted to do without being asked.
//
// actions.ts decides what a call IS. This decides whether the owner has to
// look at it first, and those are different questions. The old answer to the
// second one was "every call with an effect", which reads as careful and is
// the reason a single "build me X" ended in a hundred taps on Do it. The
// comment at the top of actions.ts already says what that costs — "an agent
// that asks permission forty times to fill in a form is an agent the owner
// turns off" — and then the policy did it anyway, because `confirm` was being
// used for two jobs at once: "this has an effect" and "stop and ask".
//
// Split in two here. Having an effect is normal; an assistant that can only
// read is a search box. What stops the run is the short list of acts that
// spend money, send something outward, or destroy something — and that list
// does not grow with the size of the job, so a forty-step build asks nothing
// and a single "pay this invoice" still asks.
//
// Three levels, because the right amount of nerve is not a constant:
//
//   ask      — every effect waits. For watching a job you do not trust yet.
//   trusted  — the default. Effects run; grave things ask.
//   auto     — only the never-without-asking core below ever stops the run.
//
// `alwaysAsk` is enforced at EVERY level, auto included. A level that could
// be set to "delete things and buy things silently" is not a setting, it is a
// trap with a label on it.
// ---------------------------------------------------------------------------

import type { BridgeOp, Verdict } from "./actions";

export type Trust = "ask" | "trusted" | "auto";

export const TRUSTS: { id: Trust; label: string; hint: string }[] = [
  { id: "ask", label: "Ask", hint: "Ask before anything with an effect. Slowest, most watchable." },
  { id: "trusted", label: "Trusted", hint: "Get on with it. Only grave things stop to ask." },
  { id: "auto", label: "Auto", hint: "Nothing stops except money, sending, and deleting." },
];

export const DEFAULT_TRUST: Trust = "trusted";

export const TRUST_KEY = "new-jarvis:trust";
export const ALLOWED_KEY = "new-jarvis:always-allowed";

/**
 * Shell commands that destroy, publish, or reach past this machine.
 *
 * Checked on the whole command line rather than the first word, because the
 * dangerous half lives after a pipe as often as before one — and a chain is
 * exactly what `commandOnlyReads` already refuses to vouch for.
 */
const SHELL_GRAVE = [
  /\b(rm|rmdir|del|erase|Remove-Item|rimraf|shred|Clear-Disk|format)\b/i,
  /\bgit\s+push\b/i,
  /\b(npm|pnpm|yarn)\s+publish\b/i,
  /\b(shutdown|restart-computer|reboot|logoff)\b/i,
  /\bgit\s+(reset\s+--hard|clean\s+-[a-z]*f)/i,
  /\b(dd|mkfs|diskpart)\b/i,
];

/**
 * Words on a control that mean the click cannot be taken back AND cannot be
 * waved through at any level.
 *
 * A tighter list than actions.ts's IRREVERSIBLE on purpose. That one is about
 * consequence of any kind, and it includes "confirm", "accept", "agree",
 * "apply", "register" — the clicks a job legitimately makes a dozen of. These
 * are the ones that move money or say something in the owner's name, where
 * being asked once is the entire value of having a gate.
 */
const CLICK_NEVER = [
  /\b(send|submit|post|publish|tweet|reply|share)\b/i,
  /\b(buy|order|purchase|pay|checkout|subscribe|donate|place\s+order)\b/i,
  /\b(delete|remove|destroy|erase|wipe)\b/i,
  /\b(cancel\s+(account|subscription)|close\s+account|deactivate)\b/i,
];

/**
 * The acts that wait for a yes at every level, Auto included.
 *
 * Money, anything that leaves the machine with the owner's name on it,
 * destroying something there is no undo for, and the one path that handles
 * values nothing else has seen (`hub/record_capture`).
 */
export function alwaysAsk(op: BridgeOp): boolean {
  const { route, args } = op;
  const name = String(args.name ?? args.text ?? args.ref ?? "");

  switch (route) {
    case "hub/record_capture":
      return true;
    case "vault/write":
      return args.overwrite === true;
    case "shell":
      return SHELL_GRAVE.some((re) => re.test(String(args.command ?? "")));
    case "browser/click":
      return CLICK_NEVER.some((re) => re.test(name));
    case "browser/type":
      return args.submit === true;
    case "files/write":
      // Reaching out of the app's own folders to replace a file is not the
      // kind of write a build does; it is the kind a mistake does.
      return /(\.env|\.credentials|id_rsa|\.ssh[\\/]|settings\.json)/i.test(String(args.path ?? ""));
    default:
      return false;
  }
}

/**
 * The verdict, with grave things named as grave.
 *
 * actions.ts classifies `shell` as a plain act whatever the command is — which
 * is right for its own job, because what a command does is not knowable from
 * its name. But the gate card shows `why`, and "This runs on your PC as you"
 * in front of `rm -rf` is a sentence that does not do its one job. Upgraded
 * here rather than there so the two policies stay one import apart.
 */
export function escalate(op: BridgeOp, verdict: Verdict): Verdict {
  if (!alwaysAsk(op)) return verdict;
  if (verdict.risk === "grave") return verdict;
  if (op.route === "shell") {
    return { ...verdict, risk: "grave", confirm: true, why: "This destroys or publishes something. It cannot be undone from here." };
  }
  return { ...verdict, risk: "grave", confirm: true };
}

/**
 * The key an "always allow these" answer is filed under.
 *
 * Coarse enough that one yes covers the next thirty calls of the same shape,
 * narrow enough that it never covers a different shape: a shell key carries
 * the verb, so saying yes to `git commit` forever says nothing about `git
 * push`. Empty means this call is not the kind that can be remembered — the
 * card hides the button rather than offering a promise it would not keep.
 */
export function gateKind(op: BridgeOp): string {
  if (alwaysAsk(op)) return "";
  if (op.route === "shell") {
    const parts = String(op.args.command ?? "").trim().toLowerCase().split(/\s+/);
    const head = parts[0] ?? "";
    if (!head) return "";
    const second = parts[1] ?? "";
    const verbed = ["git", "npm", "pnpm", "yarn", "docker", "node", "python"].includes(head);
    return verbed && second ? `shell:${head} ${second}` : `shell:${head}`;
  }
  return op.route;
}

/**
 * Does this call stop the run?
 *
 * Order matters: the core wins over every level and over every remembered yes,
 * so no amount of clicking "always" in a hurry can ever add `git push` to the
 * list of things that happen quietly.
 */
export function needsGate(
  op: BridgeOp,
  verdict: Verdict,
  { trust = DEFAULT_TRUST, allowed = [] }: { trust?: Trust; allowed?: string[] } = {},
): boolean {
  if (alwaysAsk(op)) return true;
  if (!verdict.confirm) return false;

  const kind = gateKind(op);
  if (kind && allowed.includes(kind)) return false;

  if (trust === "ask") return true;
  if (trust === "trusted") return verdict.risk === "grave";
  return false;
}

/**
 * A kind, in the owner's words.
 *
 * The button says "stop asking about X", and X has to be something they can
 * picture. "hub/lists_add_item" is a route name — true, and no use at all to
 * the person deciding whether to hand over a standing yes.
 */
const KIND_WORDS: Record<string, string> = {
  "files/write": "writing files",
  "vault/append": "adding to your notes",
  "vault/write": "writing new notes",
  "hub/lists_add_item": "adding things to your lists",
  "hub/dashboard_add_note": "saving notes",
  "hub/dashboard_add_event": "putting things on your calendar",
  "hub/record_set": "saving to your Life Record",
  "system/launch": "opening programs",
  "system/clipboard/write": "changing your clipboard",
  "browser/press": "pressing Enter on a page",
  "browser/click": "clicks like that",
  "browser/quit": "closing the browser",
};

export function describeKind(kind: string): string {
  if (!kind) return "";
  if (kind.startsWith("shell:")) return kind.slice(6) + " commands";
  return KIND_WORDS[kind] ?? kind;
}

// --- remembering ----------------------------------------------------------
//
// localStorage rather than the account, deliberately: "I trust this PC to run
// shell commands" is a statement about THIS machine, and syncing it would
// carry a yes given on the owner's own desktop onto a borrowed laptop.

export function readTrust(): Trust {
  try {
    const raw = localStorage.getItem(TRUST_KEY);
    return raw === "ask" || raw === "trusted" || raw === "auto" ? raw : DEFAULT_TRUST;
  } catch {
    return DEFAULT_TRUST;
  }
}

export function writeTrust(trust: Trust): void {
  try {
    localStorage.setItem(TRUST_KEY, trust);
  } catch {
    /* a private window is still allowed to use the assistant */
  }
}

export function readAllowed(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(ALLOWED_KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter((k): k is string => typeof k === "string") : [];
  } catch {
    return [];
  }
}

export function writeAllowed(kinds: string[]): void {
  try {
    localStorage.setItem(ALLOWED_KEY, JSON.stringify([...new Set(kinds)].slice(0, 60)));
  } catch {
    /* as above */
  }
}
