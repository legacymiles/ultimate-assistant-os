// ---------------------------------------------------------------------------
// Who may have which page photographed. Pure, so it can be tested without
// starting the drawer (see src/lib/mockup/guard.test.ts).
// ---------------------------------------------------------------------------

/** Loopback, private ranges and .local — the places a web page must not make us look. */
export function isPrivateHost(host) {
  const h = String(host || "").toLowerCase().replace(/^\[|\]$/g, "");
  if (!h || h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return true;
  if (h === "::1" || h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe80")) return h.includes(":");
  const m = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 127 || a === 10 || a === 0 || (a === 169 && b === 254) || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
}

/**
 * May this caller have this page photographed?
 *
 * A request with no Origin is a program on this PC (the chat command) and may
 * photograph anything, including a dev server on localhost. A web page may
 * photograph public sites and its OWN origin only — otherwise any site the
 * owner visited could read their router's admin page through us.
 */
export function shotAllowed(target, origin) {
  let u;
  try {
    u = new URL(target);
  } catch {
    return "That isn't a web address.";
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return "Only http and https pages can be photographed.";
  if (!origin) return "";
  let o = null;
  try {
    o = new URL(origin);
  } catch {
    /* treated as a stranger */
  }
  if (o && o.origin === u.origin) return "";
  if (o && isPrivateHost(o.hostname) && isPrivateHost(u.hostname)) return "";
  return isPrivateHost(u.hostname) ? "A web page can't ask for a private address to be photographed." : "";
}

