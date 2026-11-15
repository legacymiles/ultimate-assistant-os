// ---------------------------------------------------------------------------
// Which address to frame. Kept apart from apps.ts so client pages can use it
// without pulling the whole app catalog into their bundle.
// ---------------------------------------------------------------------------

/**
 * Every address the live hub answers on. A build's "Preview:" line can name any
 * of them, and they all serve the same deployment.
 */
export const HUB_HOSTS: ReadonlySet<string> = new Set(["ultimate-assistant-os.vercel.app", "bighomieai.com", "www.bighomieai.com"]);

/**
 * The address to put in an <iframe> on a hub page.
 *
 * A hub app framed at another of the hub's addresses (the Website Studio on
 * bighomieai.com framing ultimate-assistant-os.vercel.app) is a different site
 * to the browser: the owner's session doesn't go with it, the frame shows the
 * login wall, and Google refuses to draw its sign-in page inside a frame — a
 * bare "403. That's an error." Framed as a path on this same site, the session
 * is already there and nobody has to sign in at all. Anything else (a client's
 * own website, a branch preview) is framed exactly as given.
 */
export function frameAddress(url: string, here?: string): string {
  if (!url || url.startsWith("/")) return url;
  try {
    const u = new URL(url);
    const hereHost = here ? new URL(here).host : "";
    if (HUB_HOSTS.has(u.host) || (hereHost && u.host === hereHost)) return `${u.pathname}${u.search}${u.hash}` || "/";
  } catch {
    // Not an address we can read; frame it as given.
  }
  return url;
}
