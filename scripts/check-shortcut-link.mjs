#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Is this shared iPhone Shortcut safe to hand out, and will it work?
//
//     node scripts/check-shortcut-link.mjs https://www.icloud.com/shortcuts/<id>
//
// A shared Shortcut is a file anyone with the link can download, and whatever
// is typed into its actions travels with it. The first "Send to Jarvis" link
// shipped with a live push key in its URL actions and a token in a header —
// public link, public credentials — and nothing about the URL showed it.
//
// The second attempt leaked the same token and was also broken in ways no
// amount of looking at the phone would have caught: the key the installer
// pastes was never wired into either URL, Combine Text was empty, and the
// clean-up POST pointed back at the sending link. So this does not scan for
// strings. It parses the binary property list Apple is serving and reads the
// Shortcut the way Shortcuts does — which action feeds which, and what is
// typed where.
//
// Exit 0 = safe and wired correctly. Exit 1 = do not publish this link.
// ---------------------------------------------------------------------------

const target = process.argv[2];
if (!target) {
  console.error("Usage: node scripts/check-shortcut-link.mjs <icloud shortcut link | path to a .shortcut file>");
  process.exit(2);
}
// A local file as well as a link, so a Shortcut can be checked before it is
// ever shared — including one this repo generated.
const isFile = !/^https?:/i.test(target);
const id = isFile ? null : /\/shortcuts\/([0-9a-f]{8,})/i.exec(target)?.[1];
if (!isFile && !id) {
  console.error(`Not an iCloud Shortcut link: ${target}\nExpected https://www.icloud.com/shortcuts/<id>`);
  process.exit(2);
}

// --- Apple's binary property list -----------------------------------------
// Nothing in the dependency tree reads one, and the whole point of this check
// is to read what is in the file rather than trust a description of it.
function parseBplist(buf) {
  if (buf.subarray(0, 8).toString("latin1") !== "bplist00") throw new Error("not a binary plist");
  const t = buf.length - 32;
  const offSize = buf[t + 6];
  const refSize = buf[t + 7];
  const count = Number(buf.readBigUInt64BE(t + 8));
  const top = Number(buf.readBigUInt64BE(t + 16));
  const tableAt = Number(buf.readBigUInt64BE(t + 24));

  const uint = (at, size) => {
    let n = 0;
    for (let i = 0; i < size; i++) n = n * 256 + buf[at + i];
    return n;
  };
  const offsets = [];
  for (let i = 0; i < count; i++) offsets.push(uint(tableAt + i * offSize, offSize));

  const seen = new Map();
  function obj(index) {
    if (seen.has(index)) return seen.get(index);
    let at = offsets[index];
    const marker = buf[at++];
    const kind = marker >> 4;
    let len = marker & 0x0f;

    // A length of 0xF means the real length is the next object, always an int.
    const extended = () => {
      const m = buf[at++];
      const size = 1 << (m & 0x0f);
      const n = uint(at, size);
      at += size;
      return n;
    };

    let value;
    if (kind === 0x0) value = len === 0 ? null : len === 8 ? false : len === 9 ? true : undefined;
    else if (kind === 0x1) {
      const size = 1 << len;
      value = size === 8 ? Number(buf.readBigInt64BE(at)) : uint(at, size);
    } else if (kind === 0x2) value = len === 2 ? buf.readFloatBE(at) : buf.readDoubleBE(at);
    else if (kind === 0x3) value = new Date(978307200000 + buf.readDoubleBE(at) * 1000);
    else if (kind === 0x4) {
      if (len === 0x0f) len = extended();
      value = buf.subarray(at, at + len);
    } else if (kind === 0x5) {
      if (len === 0x0f) len = extended();
      value = buf.subarray(at, at + len).toString("latin1");
    } else if (kind === 0x6) {
      if (len === 0x0f) len = extended();
      value = Buffer.from(buf.subarray(at, at + len * 2)).swap16().toString("utf16le");
    } else if (kind === 0x8) value = { uid: uint(at, len + 1) };
    else if (kind === 0xa || kind === 0xc) {
      if (len === 0x0f) len = extended();
      value = [];
      seen.set(index, value);
      for (let i = 0; i < len; i++) value.push(obj(uint(at + i * refSize, refSize)));
    } else if (kind === 0xd) {
      if (len === 0x0f) len = extended();
      value = {};
      seen.set(index, value);
      for (let i = 0; i < len; i++) {
        const k = obj(uint(at + i * refSize, refSize));
        value[k] = obj(uint(at + len * refSize + i * refSize, refSize));
      }
    } else throw new Error(`unknown plist marker 0x${marker.toString(16)}`);
    seen.set(index, value);
    return value;
  }
  return obj(top);
}

const get = async (url, as) => {
  const r = await fetch(url, { headers: { "User-Agent": "jarvis-shortcut-check" } });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} for ${url}`);
  return as === "json" ? r.json() : Buffer.from(await r.arrayBuffer());
};

let name = target;
let bytes;
if (isFile) {
  bytes = await (await import("node:fs/promises")).readFile(target);
} else {
  const record = await get(`https://www.icloud.com/shortcuts/api/records/${id}`, "json");
  const download = record?.fields?.shortcut?.value?.downloadURL;
  if (!download) {
    console.error("Apple served no downloadURL for that id — the link is probably no longer shared.");
    process.exit(1);
  }
  name = record.fields?.name?.value ?? "(unnamed)";
  bytes = await get(download);
}
const plist = parseBplist(bytes);
const actions = plist.WFWorkflowActions ?? [];
const problems = [];
const warnings = [];

const short = (ident = "") => String(ident).split(".").pop();
/** What is typed into a field, as opposed to a blue variable chip. */
const literal = (v) => (typeof v === "string" ? v : typeof v?.Value?.string === "string" ? v.Value.string : "");
/** Which action's output a field reads from, if any. */
const wiredTo = (v) => {
  const ranges = v?.Value?.attachmentsByRange;
  const first = ranges && Object.values(ranges)[0];
  return first?.OutputUUID ?? v?.Value?.OutputUUID ?? null;
};
const fields = (dict) => dict?.Value?.WFDictionaryFieldValueItems ?? [];
const params = (a) => a?.WFWorkflowActionParameters ?? {};
const byUuid = new Map(actions.map((a, i) => [params(a).UUID, i]));
const names = actions.map((a) => short(a.WFWorkflowActionIdentifier));

console.log(`Shortcut: ${name}\n`);
console.log("Actions, in order:");
actions.forEach((a, i) => {
  const p = params(a);
  const extra = p.WFURLActionURL !== undefined ? ` ${literal(p.WFURLActionURL)}` : p.WFHTTPMethod ? ` ${p.WFHTTPMethod}` : "";
  console.log(`  ${String(i).padStart(2)}  ${names[i]}${extra}`);
});

// 1. The import question is the whole mechanism. Without it nobody is ever
//    asked for a key, and every install runs with an empty one.
const asks = (plist.WFWorkflowImportQuestions ?? []).filter((q) => q.ParameterKey === "WFTextActionText");
let keyHolder = null;
if (!asks.length) problems.push("No import question — iOS never asks the installer for their key.");
else {
  const q = asks[0];
  keyHolder = params(actions[q.ActionIndex]).UUID ?? null;
  console.log(`\nImport question: "${q.Text}" → action ${q.ActionIndex} (${names[q.ActionIndex]})`);
}

// 2. Every "?key=" has to be answered by the chip, and only by the chip. A
//    URL that merely looks right on the phone can be any of three things: the
//    key typed in (which ships to everyone), nothing at all (every install
//    sends an empty key), or the chip (correct).
const CHIP = "￼";
actions.forEach((a, i) => {
  const url = params(a).WFURLActionURL;
  if (url === undefined) return;
  const text = literal(url);
  const at = text.search(/[?&]key=/);
  if (at < 0) return;
  const answer = text.slice(text.indexOf("=", at) + 1);
  if (!answer) {
    problems.push(`Action ${i}'s URL stops at "?key=" with nothing after it — the pasted key is never used.`);
  } else if (answer !== CHIP) {
    problems.push(`Action ${i}'s URL has key=${answer.replace(CHIP, "<chip>")} typed into it.`);
  } else {
    const to = wiredTo(url);
    if (keyHolder && to !== keyHolder)
      problems.push(`Action ${i}'s URL reads from action ${byUuid.get(to) ?? "?"}, not the box the import question fills.`);
  }
});

// 3. A credential typed into a Text box, a header, a form field or a URL.
//
// The Text box is the one that nearly got away. It used to be checked only
// when an import question pointed at it, which is exactly backwards: a
// Shortcut with no import question is the one where the author has typed
// their own key in to make it work, and sharing it is how that key gets out.
// The fields are named rather than scanned, because a UUID is sixteen
// characters of the same alphabet and every action has one.
const CREDENTIAL = /^[A-Za-z0-9_-]{16,}$/;
const TYPED_TEXT = ["WFTextActionText", "text"];
actions.forEach((a, i) => {
  const p = params(a);
  for (const field of TYPED_TEXT) {
    const value = literal(p[field]);
    if (value && CREDENTIAL.test(value))
      problems.push(`Action ${i} (${names[i]}) has "${value}" typed into it — a credential, shipped to everyone who installs this.`);
  }
  for (const [what, dict] of [
    ["header", p.WFHTTPHeaders],
    ["form field", p.WFFormValues],
  ])
    for (const f of fields(dict)) {
      const value = literal(f.WFValue);
      if (value && CREDENTIAL.test(value))
        problems.push(`Action ${i} has a ${what} "${literal(f.WFKey)}" holding "${value}" — a credential, shipped to everyone.`);
    }
  // `key=` is covered above, chip and all; this is for the others.
  for (const m of literal(p.WFURLActionURL).matchAll(/[?&](token|secret|password)=([^&￼]+)/gi))
    problems.push(`Action ${i}'s URL has ${m[1]}=${m[2]} typed into it.`);
});

// 4. Wiring that is legal and does nothing. These are the failures that cost
//    days, because the Shortcut runs and reports success either way.
actions.forEach((a, i) => {
  const p = params(a);
  if (names[i] === "combine" && !wiredTo(p.text) && !literal(p.text))
    problems.push(`Action ${i} is a Combine Text with an empty box — it combines nothing, so the clean-up sends no names.`);
  if (names[i] !== "downloadurl") return;
  const from = byUuid.get(wiredTo(p.WFURL));
  if (from === undefined) return;
  if (from > i) warnings.push(`Action ${i} takes its URL from action ${from}, which runs after it.`);
  if (names[from] !== "url") return;
  const target = literal(params(actions[from]).WFURLActionURL);
  if (fields(p.WFFormValues).some((f) => literal(f.WFKey) === "names") && /\/inbox\/push\?/.test(target))
    problems.push(`Action ${i} posts the photo names to the SENDING link (action ${from}), not the clean-up one — nothing is ever deleted.`);
});

const endpoints = actions.map((a) => literal(params(a).WFURLActionURL));
if (!endpoints.some((u) => /\/inbox\/cursor/.test(u)))
  warnings.push("No bookmark (…/inbox/cursor) link — each run re-sends the newest photos instead of picking up where it left off.");
const limit = actions.map(params).find((p) => p.WFContentItemLimitNumber)?.WFContentItemLimitNumber;
if (limit !== undefined && limit < 10)
  warnings.push(`Find Photos is limited to ${limit} photos a run — low enough to fall behind the camera roll.`);

if (warnings.length) {
  console.log(`\nWorth fixing:`);
  for (const w of warnings) console.log(`  · ${w}`);
}
if (problems.length) {
  console.log(`\nDO NOT PUBLISH — ${problems.length} problem${problems.length > 1 ? "s" : ""}:`);
  for (const p of problems) console.log(`  · ${p}`);
  console.log(`\nFix those in Shortcuts, Stop Sharing this link, then share a new one.`);
  process.exit(1);
}
console.log(`\nClean. No credential inside it, the import question asks for the key, and every`);
console.log(isFile ? `link is wired to the answer. Safe to import and share.` : `link is wired to the answer. Safe to publish.`);
