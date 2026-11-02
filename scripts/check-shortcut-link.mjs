#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Is this shared iPhone Shortcut safe to hand to everyone?
//
//     node scripts/check-shortcut-link.mjs https://www.icloud.com/shortcuts/<id>
//
// A shared Shortcut is a file anyone with the link can download, and whatever
// is typed into its actions travels with it. The first "Send to Jarvis" link
// shipped with a live push key inside both of its URL actions — the link was
// public, so the key was public, and anyone who had it could push photos into
// the owner's Jarvis and call the clean-up endpoint. Nothing about the URL
// shows that; you have to download the thing and read it.
//
// So this does. It fetches the Shortcut Apple is actually serving, pulls every
// readable string out of the plist, and says whether a key, a token or a
// password is sitting in it — plus whether the import question that asks the
// installer for their own key is present, since without it the Shortcut is
// unusable by anyone but its author.
//
// Exit 0 = clean. Exit 1 = do not publish this link.
// ---------------------------------------------------------------------------

const link = process.argv[2];
if (!link) {
  console.error("Usage: node scripts/check-shortcut-link.mjs <icloud shortcut link>");
  process.exit(2);
}

const id = /\/shortcuts\/([0-9a-f]{8,})/i.exec(link)?.[1];
if (!id) {
  console.error(`Not an iCloud Shortcut link: ${link}`);
  console.error("Expected https://www.icloud.com/shortcuts/<id>");
  process.exit(2);
}

/** Printable ASCII runs, which is every label, URL and typed value in the plist. */
function strings(buf, min = 4) {
  const out = [];
  let cur = "";
  for (const b of buf) {
    if (b >= 0x20 && b < 0x7f) cur += String.fromCharCode(b);
    else {
      if (cur.length >= min) out.push(cur);
      cur = "";
    }
  }
  if (cur.length >= min) out.push(cur);
  return out;
}

const get = async (url, as) => {
  const r = await fetch(url, { headers: { "User-Agent": "jarvis-shortcut-check" } });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} for ${url}`);
  return as === "json" ? r.json() : Buffer.from(await r.arrayBuffer());
};

const record = await get(`https://www.icloud.com/shortcuts/api/records/${id}`, "json");
const name = record?.fields?.name?.value ?? "(unnamed)";
const download = record?.fields?.shortcut?.value?.downloadURL;
if (!download) {
  console.error("Apple served no downloadURL for that id — the link is probably no longer shared.");
  process.exit(1);
}

const plist = await get(download);
const found = strings(plist);
const problems = [];

// A key or token with a value typed in. `?key=` alone is right and expected:
// it is what the installer's own key gets appended to by the variable.
for (const s of found) {
  for (const m of s.matchAll(/[?&](key|token|secret|password)=([^&\s"']+)/gi)) {
    problems.push(`${m[1]}=${m[2]} is typed into the Shortcut — in: ${s}`);
  }
}
// A bare header token, which is how the first version of this leaked.
const headerAt = found.findIndex((s) => /x-dashboard-token/i.test(s));
if (headerAt >= 0) {
  const neighbours = found.slice(headerAt + 1, headerAt + 4).filter((s) => /^[A-Za-z0-9_-]{16,}$/.test(s));
  if (neighbours.length) problems.push(`an X-Dashboard-Token header with a value: ${neighbours.join(", ")}`);
}

const urls = [...new Set(found.flatMap((s) => s.match(/https?:\/\/[^\s"'<>]+/g) ?? []))];
const asks = found.some((s) => /WFWorkflowImportQuestions/i.test(s));
const questions = found.filter((s) => /paste|your key|jarvis key/i.test(s));

console.log(`Shortcut:  ${name}`);
console.log(`Downloaded ${plist.length.toLocaleString()} bytes from Apple`);
console.log(`\nURLs inside it:`);
for (const u of urls) console.log(`  ${u}`);
console.log(`\nImport question: ${asks ? "yes" : "NO — iOS will not ask the installer for anything"}`);
if (questions.length) for (const q of questions) console.log(`  asks: ${q}`);

if (problems.length) {
  console.log(`\nDO NOT PUBLISH — ${problems.length} secret${problems.length > 1 ? "s" : ""} inside:`);
  for (const p of problems) console.log(`  ${p}`);
  console.log(`\nClear that value in Shortcuts, Stop Sharing this link, then share a new one.`);
  process.exit(1);
}

if (!asks) {
  console.log(`\nNo secret in it, but no import question either: whoever installs this gets a`);
  console.log(`Shortcut with an empty key and no prompt, and has to find the Text action`);
  console.log(`themselves. Add the import question before publishing the link.`);
  process.exit(1);
}

console.log(`\nClean. Safe to publish: no key, token or password inside, and iOS asks the`);
console.log(`installer for their own.`);
