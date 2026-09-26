// ---------------------------------------------------------------------------
// Talking to the extension from this page.
//
// The extension runs one content script, on this hub's origin only, whose whole
// job is to answer these two messages (extension/jarvis-record/connect.js). It
// exists so that two questions have real answers instead of instructions:
//
//   · is the extension actually installed in THIS browser, and
//   · can we hand it a fresh token without anyone copying anything?
//
// A ping is answered with whether a token exists, never with the token itself.
// This page can replace the connection — that is the point — but cannot read it
// back out.
// ---------------------------------------------------------------------------

export interface ExtensionState {
  installed: boolean;
  /** It holds a hub address and a token. */
  configured: boolean;
  /**
   * That token still opens the door.
   *
   * Separate from `configured` because minting a token anywhere kills every
   * older one — download the extension on a second computer and the first one
   * is holding a dead key while still believing it is connected.
   */
  works: boolean;
  version?: string;
  hubUrl?: string;
}

interface Reply {
  jarvisRecord?: number;
  direction?: string;
  to?: string;
  type?: string;
  version?: string;
  hubUrl?: string;
  configured?: boolean;
  works?: boolean;
  error?: string;
}

const NOT_INSTALLED: ExtensionState = { installed: false, configured: false, works: false };

/**
 * The content script stamps the document at document_start, so this is true
 * before React has rendered anything — which is what lets the first paint show
 * the truth instead of "checking…".
 */
export function extensionMark(): string | null {
  if (typeof document === "undefined") return null;
  return document.documentElement.getAttribute("data-jarvis-record");
}

/**
 * Post one message and wait for its answer. Silence means not installed.
 *
 * The window is generous because a ping now costs the extension one round trip
 * to the hub — it is answering whether its token still WORKS, not just whether
 * it has one. Nothing waits on this: the page only pings at all when the
 * content script has already stamped the document.
 */
function ask(payload: Record<string, unknown>, timeout: number): Promise<Reply | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  const id = `jr-${Math.random().toString(36).slice(2)}`;

  return new Promise((resolve) => {
    let done = false;
    const finish = (reply: Reply | null) => {
      if (done) return;
      done = true;
      window.removeEventListener("message", onMessage);
      window.clearTimeout(timer);
      resolve(reply);
    };

    const onMessage = (event: MessageEvent) => {
      if (event.source !== window) return;
      const data = event.data as Reply | null;
      if (!data || data.jarvisRecord !== 1 || data.direction !== "up" || data.to !== id) return;
      finish(data);
    };

    const timer = window.setTimeout(() => finish(null), timeout);
    window.addEventListener("message", onMessage);
    window.postMessage({ jarvisRecord: 1, direction: "down", id, ...payload }, window.location.origin);
  });
}

export async function pingExtension(timeout = 4000): Promise<ExtensionState> {
  const reply = await ask({ type: "ping" }, timeout);
  if (!reply || reply.type !== "pong") return NOT_INSTALLED;
  return {
    installed: true,
    configured: Boolean(reply.configured),
    works: Boolean(reply.works),
    version: reply.version,
    hubUrl: reply.hubUrl,
  };
}

/**
 * Hand the extension this hub and a token.
 *
 * Used for a freshly loaded copy that has no token, and for rotating one: the
 * old token stops working the moment the server mints the new one, so the push
 * has to succeed or the owner is told to download again.
 */
export async function configureExtension(token: string, timeout = 2000): Promise<string | null> {
  const reply = await ask({ type: "configure", hubUrl: window.location.origin, token }, timeout);
  if (!reply) return "This browser does not have the extension loaded.";
  if (reply.type === "configured") return null;
  return reply.error ?? "The extension refused the token.";
}
