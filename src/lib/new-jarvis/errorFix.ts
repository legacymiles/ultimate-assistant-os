// ---------------------------------------------------------------------------
// An error that tells the owner to go and do something, and a button that
// takes them there.
//
// "Claude isn't signed in on this PC. Open Claude Code (type `claude` in a
// terminal), sign in with /login, then try again." is a correct sentence and a
// dead end: it names a terminal the owner now has to find, a command to
// remember, and a slash command to type, and it does all that inside an
// assistant that can open a terminal itself. The instruction is the admission.
//
// So the known ones carry a fix. The message still says what is wrong — it is
// not replaced by a button, because an owner who wants to do it by hand should
// still be told how — but next to it is the thing that does it.
//
// Matched on the words, deliberately. These strings are produced on the PC by
// tools/jarvis-bridge/brain.mjs, which is updated separately and may be older
// than the website; recognising the sentence costs nothing when it matches and
// nothing when it doesn't, where a new error CODE would need every agent
// updated before a single button appeared.
// ---------------------------------------------------------------------------

export interface ErrorFix {
  /** The button. A verb, what it does, not "Fix this". */
  label: string;
  /**
   * "launch" starts something on the PC (bridge system/launch).
   * "url" opens a page in the browser Jarvis drives (bridge browser/open).
   */
  kind: "launch" | "url";
  /** The program for "launch", the address for "url". */
  target: string;
  /** Arguments for "launch". */
  args?: string[];
  /** One line under the button: what will happen, and what is left to do. */
  then: string;
}

/**
 * `cmd /k` rather than `/c`: the window has to STAY open. The whole point is
 * that the owner arrives inside Claude Code with a prompt in front of them, and
 * a window that runs the command and closes is a flash of text and no login.
 */
const CLAUDE_TERMINAL: ErrorFix = {
  label: "Open Claude Code",
  kind: "launch",
  target: "cmd.exe",
  args: ["/k", "claude"],
  then: "A terminal opens with Claude Code running. Type /login, sign in, then ask me again.",
};

const CLAUDE_INSTALL: ErrorFix = {
  label: "Open the download page",
  kind: "url",
  target: "https://claude.com/code",
  then: "Install it, sign in with your Claude account, then ask me again.",
};

/**
 * The fix for a message, or null when there isn't one worth offering.
 *
 * Null is the common and correct answer. A button that reloads the page or
 * "tries again" is noise next to an error that already says to try again, and
 * teaches the owner that the buttons here do nothing.
 */
export function fixFor(message: string): ErrorFix | null {
  const m = (message ?? "").toLowerCase();
  if (!m) return null;

  // Not installed is checked FIRST: both sentences mention signing in, and
  // sending someone to a terminal for a program they do not have is a worse
  // dead end than the one being replaced.
  if (m.includes("isn't installed on this pc") || m.includes("claude.com/code")) {
    return CLAUDE_INSTALL;
  }
  if (m.includes("isn't signed in on this pc") || (m.includes("sign in") && m.includes("/login"))) {
    return CLAUDE_TERMINAL;
  }
  return null;
}

/** The bridge route a fix runs through. */
export function routeForFix(fix: ErrorFix): { route: string; args: Record<string, unknown> } {
  return fix.kind === "launch"
    ? { route: "system/launch", args: { target: fix.target, args: fix.args ?? [] } }
    : { route: "browser/open", args: { url: fix.target } };
}
