// ---------------------------------------------------------------------------
// The ready-made "Send to Jarvis" Shortcut.
//
// Setting the phone up by hand is an eight-block build in Apple's Shortcuts
// app, and every block is somewhere to get it wrong: a typed word where a blue
// variable chip belongs, the sending link pasted into the clean-up action, a
// File field left as Text. Every one of those has actually happened. A
// Shortcut built once and shared removes the whole class of mistake — iOS asks
// the installer a single question on import, they paste one key, and all three
// URL actions fill themselves in from it.
//
// The link lives in the repo rather than in an env var because it is a plain
// iCloud address with no secret in it, and because pasting it here is then the
// entire setup: no dashboard visit, no redeploy dance. The env var still wins
// when it is set, so a replacement Shortcut can be tried before it is
// committed.
// ---------------------------------------------------------------------------

/**
 * Paste the shared Shortcut's iCloud link here.
 *
 * It has to be a Shortcut whose key sits in ONE empty Text action at the very
 * top with an import question attached, and whose three URL actions end in
 * `?key=` followed by that action's variable. A key typed into the Shortcut
 * instead is handed to everyone who installs it, so before pasting a link
 * here, run it past the thing that checks:
 *
 *     node scripts/check-shortcut-link.mjs <link>
 *
 * Empty is a supported state: the guide then teaches the manual build, which
 * is what every user got before this existed.
 */
const SHARED_SHORTCUT = "";

export const SHORTCUT_LINK = process.env.NEXT_PUBLIC_IPHONE_SHORTCUT_URL || SHARED_SHORTCUT;

/**
 * Only an iCloud Shortcuts link can be installed by tapping it. Anything else
 * — a typo, a shortened link, a Drive file — renders as a button that opens a
 * dead end, so the guide checks before offering it and teaches the manual
 * build instead.
 */
export function isShortcutLink(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return false;
  }
  if (u.protocol !== "https:") return false;
  const host = u.hostname.toLowerCase();
  if (host !== "icloud.com" && !host.endsWith(".icloud.com")) return false;
  // `/shortcuts/<32 hex>`; the id is what Apple signs, and a link without one
  // opens the Shortcuts marketing page rather than an installable Shortcut.
  return /^\/shortcuts\/[0-9a-f]{8,}\/?$/i.test(u.pathname);
}

/** Is there a Shortcut to hand out, or does the guide teach the build? */
export const READY_MADE = isShortcutLink(SHORTCUT_LINK);
