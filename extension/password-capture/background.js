// ---------------------------------------------------------------------------
// Jarvis password capture — service worker.
//
// The only job: move a captured login from the page to the local agent, and
// hold it if the agent is locked.
//
// The queue is the awkward part. A capture happens the instant a form is
// submitted; if the agent is locked at that moment, there is nowhere safe to
// put a plaintext password. Two answers were available: keep it in
// chrome.storage until the agent unlocks (a plaintext password on disk, however
// briefly), or drop it and ask the user to unlock first (losing logins, and the
// user will not notice until the account is needed).
//
// This keeps it in chrome.storage.local, under a key that is wiped the moment a
// flush succeeds. That is the honest trade: it is plaintext, it is local to this
// Chrome profile, and it lives minutes rather than months. The alternative —
// silently losing logins — is worse, because it fails invisibly.
// ---------------------------------------------------------------------------

const AGENT = "http://127.0.0.1:9555";
const QUEUE_KEY = "pendingCaptures";

async function api(path, options = {}) {
  const res = await fetch(`${AGENT}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      // A service worker's fetch has no Origin header, so this is how the agent
      // tells the extension apart from a web page. A page that sets it forces a
      // preflight, which the agent refuses for non-extension origins.
      "X-Jarvis-Extension": "1",
      ...(options.headers || {}),
    },
  });
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = {};
  }
  return { status: res.status, ok: res.ok, body };
}

async function readQueue() {
  const got = await chrome.storage.local.get(QUEUE_KEY);
  return Array.isArray(got[QUEUE_KEY]) ? got[QUEUE_KEY] : [];
}

async function writeQueue(items) {
  await chrome.storage.local.set({ [QUEUE_KEY]: items.slice(-200) });
}

/** Try every queued capture. Called on unlock and on startup. */
async function flushQueue() {
  const queue = await readQueue();
  if (!queue.length) return { flushed: 0, left: 0 };
  const left = [];
  let flushed = 0;
  for (const entry of queue) {
    const r = await api("/capture", { method: "POST", body: JSON.stringify(entry) });
    if (r.ok) flushed += 1;
    else if (r.status === 423) {
      // Still locked: keep the rest, no point burning through them.
      left.push(entry);
    }
    // 4xx that is not "locked" means the entry is unusable; drop it rather than
    // retry forever.
  }
  await writeQueue(left);
  return { flushed, left: left.length };
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  (async () => {
    try {
      switch (msg?.type) {
        case "health":
          return reply(await api("/health"));

        case "status": {
          const r = await api("/status");
          const q = await readQueue();
          return reply({ ...r, queued: q.length });
        }

        case "unlock": {
          const r = await api("/unlock", { method: "POST", body: JSON.stringify({ password: msg.password }) });
          if (r.ok) {
            const f = await flushQueue();
            return reply({ ...r, flush: f });
          }
          return reply(r);
        }

        case "lock":
          return reply(await api("/lock", { method: "POST", body: "{}" }));

        case "capture": {
          const r = await api("/capture", { method: "POST", body: JSON.stringify(msg.payload) });
          if (r.status === 423) {
            const q = await readQueue();
            q.push(msg.payload);
            await writeQueue(q);
            return reply({ ok: false, queued: true, status: 423 });
          }
          return reply(r);
        }

        case "match":
          return reply(await api(`/match?host=${encodeURIComponent(msg.host)}`));

        case "secret":
          return reply(await api("/secret", { method: "POST", body: JSON.stringify({ id: msg.id }) }));

        case "flush":
          return reply({ ok: true, flush: await flushQueue() });

        default:
          return reply({ ok: false, error: "unknown message" });
      }
    } catch (e) {
      return reply({ ok: false, error: String(e?.message || e), offline: true });
    }
  })();
  return true; // async reply
});

// A browser restart should not strand queued captures.
chrome.runtime.onStartup?.addListener(() => {
  flushQueue();
});
