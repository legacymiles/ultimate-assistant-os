// ---------------------------------------------------------------------------
// The one page this extension will talk to: your own hub.
//
// Two jobs, both of which exist so that setting this up is a click rather than
// a copy and a paste:
//
//   · it marks the page, so Jarvis can SEE that the extension is installed
//     instead of asking you whether it is, and
//   · it accepts a hub address and a token from that page, so rotating a token
//     is one button in Jarvis and nothing at all here.
//
// The match pattern is your hub and nothing else — written into the manifest
// when you downloaded this — so no other site can reach any of it. A ping is
// answered with whether a token exists, never with the token: a page on your
// hub can REPLACE the connection, which is the point, but cannot read it back
// out.
// ---------------------------------------------------------------------------

const VERSION = chrome.runtime.getManifest().version;

// Read synchronously by the page, so the status shows the truth on first paint.
document.documentElement.setAttribute("data-jarvis-record", VERSION);

function reply(to, payload) {
  window.postMessage({ jarvisRecord: 1, direction: "up", to, ...payload }, window.location.origin);
}

/**
 * Does the token still open the door?
 *
 * Holding a token and holding a WORKING token are different things: minting one
 * anywhere — another computer, another download — kills every older one. Without
 * this the page would happily say "connected" while every save came back 401,
 * which is the worst of both answers. The snapshot is the cheapest authenticated
 * read there is, and carries nothing sensitive.
 */
async function stillWorks(hubUrl, token) {
  try {
    const res = await fetch(`${hubUrl}/api/jarvis/record/snapshot/pull`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    // Only a refusal is a no. A hub that is down or offline says nothing about
    // whether the token is good, so it is not called stale.
    return res.status === 401 ? false : true;
  } catch {
    return true;
  }
}

window.addEventListener("message", async (event) => {
  if (event.source !== window) return;
  const msg = event.data;
  if (!msg || msg.jarvisRecord !== 1 || msg.direction !== "down") return;

  try {
    if (msg.type === "ping") {
      const { hubUrl, token } = await chrome.storage.local.get(["hubUrl", "token"]);
      const works = token && hubUrl ? await stillWorks(hubUrl, token) : false;
      reply(msg.id, {
        type: "pong",
        version: VERSION,
        configured: Boolean(token),
        works,
        hubUrl: hubUrl || "",
      });
      return;
    }

    if (msg.type === "configure") {
      const hubUrl = String(msg.hubUrl || "").replace(/\/+$/, "");
      const token = String(msg.token || "");
      if (!hubUrl || !token) {
        reply(msg.id, { type: "error", error: "That was missing the hub address or the token." });
        return;
      }
      await chrome.storage.local.set({ hubUrl, token });
      reply(msg.id, { type: "configured", version: VERSION, hubUrl });
      return;
    }
  } catch (e) {
    reply(msg.id, { type: "error", error: e?.message || "The extension could not be reached." });
  }
});
