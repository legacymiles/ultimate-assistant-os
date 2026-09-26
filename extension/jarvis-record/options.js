// Settings. Two stores, deliberately kept apart:
//
//   · hubUrl + token — how to reach Jarvis.
//   · secrets        — the numbers that never leave this computer. They are
//                      here rather than in the record's server snapshot
//                      because publishSnapshot strips them on purpose, and
//                      the extension is the last place they can live and
//                      still be typed into a form automatically.

const fields = ["hubUrl", "token"];
const secretKeys = ["ssn", "medicaid_id", "license_number"];

function flash(el, text) {
  el.textContent = text;
  setTimeout(() => {
    el.textContent = "";
  }, 2400);
}

async function load() {
  const stored = await chrome.storage.local.get(["hubUrl", "token", "secrets"]);
  document.getElementById("hubUrl").value = stored.hubUrl ?? "";
  document.getElementById("token").value = stored.token ?? "";
  for (const key of secretKeys) {
    document.getElementById(key).value = stored.secrets?.[key] ?? "";
  }
}

document.getElementById("save").addEventListener("click", async () => {
  const next = {};
  for (const f of fields) next[f] = document.getElementById(f).value.trim();
  // A trailing slash turns every request path into a double slash and every
  // response into a 404 that looks like a bad token.
  next.hubUrl = next.hubUrl.replace(/\/+$/, "");
  await chrome.storage.local.set(next);
  flash(document.getElementById("saved"), "Saved.");
});

document.getElementById("saveSecrets").addEventListener("click", async () => {
  const secrets = {};
  for (const key of secretKeys) {
    const value = document.getElementById(key).value.trim();
    if (value) secrets[key] = value;
  }
  await chrome.storage.local.set({ secrets });
  flash(document.getElementById("savedSecrets"), "Saved on this computer only.");
});

document.getElementById("clearSecrets").addEventListener("click", async () => {
  await chrome.storage.local.remove("secrets");
  for (const key of secretKeys) document.getElementById(key).value = "";
  flash(document.getElementById("savedSecrets"), "Erased.");
});

load();
