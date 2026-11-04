// Jarvis password capture — popup.
//
// Deliberately quiet: it reports state, takes the master password when the
// agent is locked, and fills a login on request. It never lists passwords.

const $ = (id) => document.getElementById(id);

let currentHost = "";
let unlocked = false;

const send = (msg) => new Promise((resolve) => chrome.runtime.sendMessage(msg, resolve));

function setDot(kind) {
  const dot = $("dot");
  dot.className = `dot ${kind}`;
}

async function hostOfTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url) return "";
  try {
    return new URL(tab.url).host.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function renderStatus(s) {
  if (!s || s.offline) {
    setDot("off");
    $("statusLine").textContent = "Agent offline";
    $("offlinePane").hidden = false;
    $("unlockPane").hidden = true;
    $("matchPane").hidden = true;
    $("lockBtn").disabled = true;
    return false;
  }

  const b = s.body || {};
  unlocked = Boolean(b.unlocked);
  setDot(unlocked ? "on" : "warn");

  const bits = [];
  bits.push(unlocked ? "Unlocked" : "Locked");
  if (typeof b.sealed === "number") bits.push(`${b.sealed} sealed`);
  if (typeof b.credentials === "number") bits.push(`${b.credentials} logins`);
  if (s.queued) bits.push(`${s.queued} waiting`);
  if (b.vault && b.vault !== "ready") bits.push(`vault ${b.vault}`);
  $("statusLine").textContent = bits.join(" · ");

  $("offlinePane").hidden = true;
  $("unlockPane").hidden = unlocked;
  $("matchPane").hidden = !unlocked;
  $("lockBtn").disabled = !unlocked;

  if (unlocked && s.queued) {
    // A queued capture means the agent was locked when a login was saved.
    send({ type: "flush" }).then(() => refresh());
  }
  return true;
}

function renderMatches(items) {
  const box = $("items");
  box.textContent = "";
  if (!items.length) {
    const p = document.createElement("div");
    p.className = "empty";
    p.textContent = "No saved login for this site yet.";
    box.append(p);
    return;
  }
  for (const it of items) {
    const card = document.createElement("div");
    card.className = "item";

    const t = document.createElement("div");
    t.className = "t";
    t.textContent = it.title || it.username || "Login";

    const u = document.createElement("div");
    u.className = "u";
    u.textContent = it.username || "(no username)";

    const btn = document.createElement("button");
    btn.textContent = "Fill";
    btn.className = "primary";
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      btn.textContent = "Fetching…";
      const secret = await send({ type: "secret", id: it.id });
      if (!secret?.ok) {
        btn.textContent = secret?.status === 423 ? "Locked" : "Failed";
        btn.disabled = false;
        return;
      }
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) return;
      chrome.tabs.sendMessage(
        tab.id,
        { type: "fill", username: it.username, password: secret.body.password },
        () => {
          btn.textContent = "Filled";
          setTimeout(() => window.close(), 600);
        },
      );
    });

    card.append(t, u, btn);
    box.append(card);
  }
}

async function refresh() {
  const s = await send({ type: "status" });
  const live = renderStatus(s);
  if (live) {
    currentHost = await hostOfTab();
    $("hostLine").textContent = currentHost ? `For ${currentHost}` : "No site in this tab";
    if (unlocked && currentHost) {
      const m = await send({ type: "match", host: currentHost });
      if (m?.ok) renderMatches(m.body.items || []);
      else renderMatches([]);
    }
  }
}

$("unlockBtn").addEventListener("click", async () => {
  const pw = $("pw").value;
  if (!pw) return;
  $("unlockBtn").disabled = true;
  $("unlockBtn").textContent = "Unlocking…";
  const r = await send({ type: "unlock", password: pw });
  $("pw").value = "";
  $("unlockBtn").disabled = false;
  $("unlockBtn").textContent = "Unlock";
  if (r?.ok) {
    $("unlockErr").textContent = r.flush?.flushed ? `Saved ${r.flush.flushed} waiting login(s).` : "";
    await refresh();
  } else {
    $("unlockErr").textContent = r?.body?.error || "Could not unlock.";
  }
});

$("lockBtn").addEventListener("click", async () => {
  await send({ type: "lock" });
  await refresh();
});

$("pw").addEventListener("keydown", (e) => {
  if (e.key === "Enter") $("unlockBtn").click();
});

refresh();
