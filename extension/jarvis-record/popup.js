// ---------------------------------------------------------------------------
// The popup: the only thing that ever starts a read of a page.
//
// There is no persistent content script and no match pattern. content.js is
// injected here, on a click, under `activeTab` — a permission the browser
// grants for that one tab and revokes when it navigates away. The extension
// therefore cannot watch anything in the background even if it wanted to, and
// that is a property of the manifest rather than a promise in a comment.
// ---------------------------------------------------------------------------

const els = {
  site: document.getElementById("site"),
  setup: document.getElementById("setup"),
  main: document.getElementById("main"),
  save: document.getElementById("save"),
  fill: document.getElementById("fill"),
  status: document.getElementById("status"),
  detail: document.getElementById("detail"),
  openOptions: document.getElementById("openOptions"),
  connectSocial: document.getElementById("connectSocial"),
};

function say(text, tone = "") {
  els.status.textContent = text;
  els.status.className = `status ${tone}`.trim();
}

function detail(lines) {
  els.detail.innerHTML = "";
  for (const line of lines.slice(0, 8)) {
    const li = document.createElement("li");
    li.textContent = line;
    els.detail.appendChild(li);
  }
}

async function config() {
  const { hubUrl, token, secrets } = await chrome.storage.local.get(["hubUrl", "token", "secrets"]);
  return { hubUrl: hubUrl || "http://localhost:3240", token: token || "", secrets: secrets || {} };
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

/** Inject content.js, then talk to it. Injecting twice is harmless. */
async function scan(tab) {
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
  return chrome.tabs.sendMessage(tab.id, { type: "scan" });
}

async function api(hubUrl, path, token, init = {}) {
  const res = await fetch(`${hubUrl}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `${path} failed (${res.status})`);
  return data;
}

async function init() {
  const tab = await activeTab();
  els.site.textContent = tab?.url ? new URL(tab.url).hostname : "No page";

  const { token } = await config();
  els.setup.classList.toggle("hidden", Boolean(token));
  els.main.classList.toggle("hidden", !token);

  const restricted = !tab?.url || /^(chrome|edge|about|chrome-extension):/i.test(tab.url);
  if (restricted && token) {
    els.save.disabled = true;
    els.fill.disabled = true;
    say("Browsers do not let extensions read their own pages. Open the application first.", "warn");
  }
}

els.openOptions?.addEventListener("click", () => chrome.runtime.openOptionsPage());

els.save.addEventListener("click", async () => {
  els.save.disabled = true;
  els.fill.disabled = true;
  detail([]);
  say("Reading the form…");

  try {
    const { hubUrl, token } = await config();
    const tab = await activeTab();
    const page = await scan(tab);

    const filled = (page.fields ?? []).filter((f) => f.value);
    if (!filled.length) {
      say("Nothing is filled in on this page yet. Fill the form, then press this.", "warn");
      return;
    }

    say(`Working out what ${filled.length} answer${filled.length === 1 ? "" : "s"} mean…`);
    const { map, by, note } = await api(hubUrl, "/api/jarvis/record/map", token, {
      method: "POST",
      body: JSON.stringify({ domain: page.site, fields: page.fields }),
    });

    const values = filled
      .filter((f) => map[f.ref])
      .map((f) => ({
        key: map[f.ref],
        value: f.value,
        label: f.label || f.placeholder || f.name,
        by: by?.[f.ref] ?? "name",
        confidence: by?.[f.ref] === "autocomplete" ? 1 : by?.[f.ref] === "model" ? 0.6 : 0.7,
      }));

    if (!values.length) {
      say("None of the filled fields matched anything in your Record.", "warn");
      if (note) detail([note]);
      return;
    }

    const result = await api(hubUrl, "/api/jarvis/record/capture/push", token, {
      method: "POST",
      body: JSON.stringify({ site: page.site, title: page.title, values }),
    });

    const skipped = filled.length - values.length;
    say(`Sent ${result.saved} to Jarvis. Confirm them in Record.`, "good");
    detail([
      ...values.slice(0, 6).map((v) => `${v.key} — ${v.value.slice(0, 40)}`),
      skipped ? `${skipped} field${skipped === 1 ? "" : "s"} did not match anything and were left alone.` : "",
      note || "",
    ].filter(Boolean));
  } catch (e) {
    say(e.message || "That did not work.", "bad");
  } finally {
    els.save.disabled = false;
    els.fill.disabled = false;
  }
});

/**
 * Find a value for a mapped key.
 *
 * The matcher answers "jobs.employer" — the form asked about a job, not about
 * a numbered one — while the snapshot holds "jobs.1.employer", because it has
 * to say WHICH job. Entry 1 is the most recent, which is what a form means by
 * "most recent employer", so a bare group key resolves to it.
 */
function resolve(values, key) {
  if (values[key]) return values[key];
  const parts = key.split(".");
  if (parts.length === 2) return values[`${parts[0]}.1.${parts[1]}`] ?? "";
  return "";
}

els.fill.addEventListener("click", async () => {
  els.save.disabled = true;
  els.fill.disabled = true;
  detail([]);
  say("Reading the form…");

  try {
    const { hubUrl, token, secrets } = await config();
    const tab = await activeTab();
    const page = await scan(tab);

    if (!page.fields?.length) {
      say("No form fields on this page.", "warn");
      return;
    }

    const [{ map }, snap] = await Promise.all([
      api(hubUrl, "/api/jarvis/record/map", token, {
        method: "POST",
        body: JSON.stringify({ domain: page.site, fields: page.fields }),
      }),
      api(hubUrl, "/api/jarvis/record/snapshot/pull", token),
    ]);

    // The server's snapshot never contains a Social Security number, a licence
    // number or a member ID — publishSnapshot strips them before storing. Those
    // live only in this extension, if the owner chose to put them here, and are
    // merged in at the last possible moment.
    const values = { ...(snap.values ?? {}), ...secrets };

    const plan = {};
    const missing = [];
    for (const f of page.fields) {
      const key = map[f.ref];
      if (!key) continue;
      if (f.value) continue; // Never overwrite something already typed.
      const value = resolve(values, key);
      if (value) plan[f.ref] = value;
      else missing.push(f.label || f.name || key);
    }

    if (!Object.keys(plan).length) {
      say(
        missing.length
          ? "Nothing in your Record fits this form yet."
          : "Every field this form asks for is already filled in.",
        "warn",
      );
      if (missing.length) detail([`Still missing: ${missing.slice(0, 6).join(", ")}`]);
      return;
    }

    const result = await chrome.tabs.sendMessage(tab.id, { type: "fill", plan });
    const failed = result.failed ?? [];

    say(
      `Filled ${result.filled}. Check every answer before you submit.`,
      failed.length ? "warn" : "good",
    );
    detail([
      ...failed.slice(0, 4).map((f) => `Would not take: ${f.label || f.ref} (${f.value})`),
      missing.length ? `Not in your Record: ${missing.slice(0, 5).join(", ")}` : "",
    ].filter(Boolean));
  } catch (e) {
    say(e.message || "That did not work.", "bad");
  } finally {
    els.save.disabled = false;
    els.fill.disabled = false;
  }
});

/**
 * "Connect Facebook & Instagram": send the sign-in this browser already has to
 * the hub, so video imports can open reels that are only shown to signed-in
 * people.
 *
 * The cookies permission is optional and asked for HERE, on the click, only
 * for those two sites — the extension cannot read any cookie until the owner
 * says yes to Chrome's own prompt, and never reads any other site's.
 */
const SOCIAL = [
  { site: "facebook", label: "Facebook", url: "https://www.facebook.com/" },
  { site: "instagram", label: "Instagram", url: "https://www.instagram.com/" },
];

els.connectSocial?.addEventListener("click", async () => {
  els.connectSocial.disabled = true;
  detail([]);
  try {
    const granted = await chrome.permissions.request({
      permissions: ["cookies"],
      origins: ["https://*.facebook.com/*", "https://*.instagram.com/*"],
    });
    if (!granted) {
      say("Chrome needs your OK to read the Facebook and Instagram sign-in. Press the button again and choose Allow.", "warn");
      return;
    }
    const { hubUrl, token } = await config();
    const lines = [];
    let sent = 0;
    for (const s of SOCIAL) {
      const cookies = await chrome.cookies.getAll({ url: s.url });
      if (!cookies.length) {
        lines.push(`${s.label}: not signed in on this browser — skipped.`);
        continue;
      }
      try {
        await api(hubUrl, "/api/social-import/cookies/push", token, {
          method: "POST",
          body: JSON.stringify({ site: s.site, cookies }),
        });
        sent++;
        lines.push(`${s.label}: connected.`);
      } catch (e) {
        lines.push(`${s.label}: ${e.message}`);
      }
    }
    say(
      sent ? "Done. Paste the link in Jarvis again and it will open now." : "Sign in to Facebook or Instagram in this browser first, then press this again.",
      sent ? "good" : "warn",
    );
    detail(lines);
  } catch (e) {
    say(e.message || "That did not work.", "bad");
  } finally {
    els.connectSocial.disabled = false;
  }
});

init();
