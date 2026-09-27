// ---------------------------------------------------------------------------
// Who may talk to this bridge, and what it refuses to do for anyone.
//
// This process can run shell commands, read files and drive a browser on the
// owner's machine, which makes it a far more attractive target than the render
// bridge next door. Two facts drive everything here:
//
//   1. Any web page in any tab can send a request to 127.0.0.1. The browser
//      will not let that page READ our answer without CORS, but a plain form
//      or fetch still ARRIVES, and by then the command has run. A same-origin
//      check alone therefore protects nothing — the damage is done on arrival.
//
//   2. The browser only sends a preflight when a request carries a header it
//      considers non-simple. So the token goes in `Authorization`, which makes
//      every real call preflighted, and the preflight is where an unknown
//      origin is turned away BEFORE the request body is ever delivered.
//
// The token is the part that actually matters: origin headers are trivially
// absent on a non-browser client, so a request without a valid token is
// refused whatever it claims to be.
// ---------------------------------------------------------------------------

/** Pages allowed to drive this machine. Same shape as the studio bridge. */
export const ALLOWED_ORIGINS = [
  /^https:\/\/ultimate-assistant-os\.vercel\.app$/,
  /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/,
];

export function originAllowed(origin) {
  if (!origin) return false;
  return ALLOWED_ORIGINS.some((re) => re.test(origin));
}

/**
 * Constant-time-ish string compare.
 *
 * Node's `timingSafeEqual` throws on a length mismatch, which would itself leak
 * the token's length, so lengths are compared first and the loop always runs
 * over the expected token.
 */
export function tokenMatches(expected, given) {
  if (typeof given !== "string" || given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) diff |= expected.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0;
}

/** `Authorization: Bearer <token>` → the token, or "". */
export function bearer(headers) {
  const raw = headers.authorization || headers.Authorization || "";
  const m = /^Bearer\s+(.+)$/i.exec(String(raw).trim());
  return m ? m[1] : "";
}

// ---------------------------------------------------------------------------
// The commands this bridge will not run, whatever the page says.
//
// The page has its own confirm gate and it is the one the owner reads. This
// list is the second one, and it exists for the case the first is bypassed: a
// prompt injection that talks the agent into a command, a bug in the confirm
// card, a request that never came from the page at all. It is deliberately
// SHORT and aimed only at the irreversible — a long blocklist is a false sense
// of safety, because shell quoting has infinite ways to spell the same thing.
//
// What this catches is the honest spelling of a catastrophe. What actually
// keeps the machine safe is the token above.
// ---------------------------------------------------------------------------
const CATASTROPHIC = [
  { re: /\bformat\s+[a-z]:/i, why: "formats a drive" },
  { re: /\bdiskpart\b/i, why: "repartitions disks" },
  { re: /\bmkfs(\.\w+)?\b/i, why: "makes a new filesystem" },
  { re: /\brm\s+(-[a-z]*\s+)*-[a-z]*[rf][a-z]*\s+[/\\]\s*$/i, why: "deletes the filesystem root" },
  { re: /\b(rd|rmdir)\s+\/s\s+\/q\s+[a-z]:\\?\s*$/i, why: "deletes a whole drive" },
  { re: /Remove-Item\b[^|]*-Recurse[^|]*\b[a-z]:\\\s*$/i, why: "deletes a whole drive" },
  { re: /\breg\s+delete\s+HKLM/i, why: "deletes machine registry keys" },
  { re: /\b(shutdown|Stop-Computer|Restart-Computer)\b/i, why: "shuts the machine down mid-task" },
  { re: /\bcipher\s+\/w/i, why: "wipes free space irreversibly" },
  { re: /\bvssadmin\s+delete\s+shadows/i, why: "destroys restore points" },
  { re: /\bbcdedit\b/i, why: "edits the boot configuration" },
  { re: /\bnetsh\s+(winsock\s+reset|int\s+ip\s+reset)/i, why: "resets networking and drops the connection" },
];

/**
 * Why this command is refused, or "" when it may run.
 *
 * Returns the reason rather than a boolean so the refusal the owner sees names
 * the actual objection instead of "not allowed".
 */
export function refuseReason(command) {
  const cmd = String(command ?? "");
  if (!cmd.trim()) return "an empty command";
  const hit = CATASTROPHIC.find((c) => c.re.test(cmd));
  return hit ? hit.why : "";
}
