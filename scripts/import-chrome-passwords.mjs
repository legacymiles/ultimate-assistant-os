// ---------------------------------------------------------------------------
// Chrome → Jarvis: one-time password import.
//
//   node scripts/import-chrome-passwords.mjs status
//   node scripts/import-chrome-passwords.mjs setup            (dry run)
//   node scripts/import-chrome-passwords.mjs setup --apply
//   node scripts/import-chrome-passwords.mjs import chrome.csv
//   node scripts/import-chrome-passwords.mjs import chrome.csv --apply
//   node scripts/import-chrome-passwords.mjs migrate --apply
//
// Why this exists: Recall holds the MAP of a login (site, username, 2FA) and
// the vault holds only the sealed secret. Chrome already holds the secrets, so
// the job is a one-time move — not a second place to type them.
//
// The one irreversible moment is Chrome's own export, which is a plaintext CSV.
// So this tool never writes that CSV anywhere, never prints a password, and
// shreds nothing it did not create. Delete the CSV yourself when the run
// verifies.
//
// Storage is the app's own: public.app_state rows keyed (user_id, key), with
// keys `recall:v1` (the map) and `jarvis-vault` (the sealed secrets). No new
// table, no new crypto. `src/lib/passwords/crypto.ts` and `vault.ts` are pure,
// so they are imported directly and there is exactly one implementation of the
// format — a re-implementation here would drift the first time either changes.
// ---------------------------------------------------------------------------

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";

import {
  createEnvelope,
  unlockWithPassword,
  unlockWithRecovery,
  encryptSecret,
  decryptSecret,
  newRecoveryKey,
} from "../src/lib/passwords/crypto.ts";
import {
  emptyVault,
  coerceVault,
  canAcceptSecrets,
  putSecret,
  markExported,
  setEnvelope,
  count,
  recoverySheet,
  vaultState,
} from "../src/lib/passwords/vault.ts";

// --- the app's own id / time helpers, copied verbatim ----------------------
// `src/lib/utils.ts` is browser-safe but pulls nothing heavy; copied rather
// than imported because uid() must produce the same shape elsewhere.

function uid(prefix = "id") {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
}
const nowIso = () => new Date().toISOString();

// --- args ------------------------------------------------------------------

const argv = process.argv.slice(2);
const cmd = argv[0];
const apply = argv.includes("--apply");
const confirmSaved = argv.includes("--confirm-saved");
const LOCAL_DIR = (() => {
  const i = argv.indexOf("--dir");
  return i > -1 ? argv[i + 1] : null;
})();

/** Every bare argument that is not a flag or the value of `--dir`. */
function positional() {
  const out = [];
  for (let i = 1; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--dir") {
      i += 1;
      continue;
    }
    if (a.startsWith("--")) continue;
    out.push(a);
  }
  return out;
}

/** CSVs given on the command line, or every chrome-passwords*.csv beside us. */
async function csvTargets() {
  const given = positional();
  if (given.length) return given;
  const { readdir } = await import("node:fs/promises");
  let files = [];
  try {
    files = (await readdir(process.cwd())).filter((f) => /^chrome-passwords.*\.csv$/i.test(f)).sort();
  } catch {}
  return files.map((f) => path.join(process.cwd(), f));
}

const KNOWN = new Set(["status", "setup", "run", "import", "migrate"]);
if (!KNOWN.has(cmd)) {
  console.log(
    "usage: node scripts/import-chrome-passwords.mjs <status|setup|run|import|migrate> [csv…] [--apply] [--dir <localDir>]",
  );
  process.exit(1);
}

const OWNER = "698ff77a-21e5-47a3-9973-358546b97ebc"; // jackstaxx25@gmail.com
const VAULT_KEY = "jarvis-vault";
const RECALL_KEY = "recall:v1";
const FOLDER = "Passwords";

// --- storage: Supabase, or a local dir for rehearsal -----------------------
//
// `--dir` exists so the whole pipeline can be exercised against throwaway JSON
// before it is pointed at the real rows. Same code path either way.

function parseEnv(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

async function storage() {
  if (LOCAL_DIR) {
    const read = async (key, fallback) => {
      try {
        const raw = await readFile(path.join(LOCAL_DIR, `${key.replace(/[:/]/g, "_")}.json`), "utf8");
        return JSON.parse(raw.replace(/^\uFEFF/, ""));
      } catch {
        return fallback;
      }
    };
    const write = async (key, value) => {
      await mkdir(LOCAL_DIR, { recursive: true });
      await writeFile(
        path.join(LOCAL_DIR, `${key.replace(/[:/]/g, "_")}.json`),
        JSON.stringify(value, null, 2),
        "utf8",
      );
    };
    return { read, write, label: `local:${LOCAL_DIR}` };
  }

  const cfg = parseEnv(await readFile("./.env.local", "utf8"));
  if (!cfg.NEXT_PUBLIC_SUPABASE_URL || !cfg.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("No Supabase config in .env.local. Run from the repo root, or use --dir for a rehearsal.");
  }
  const { createClient } = await import("@supabase/supabase-js");
  const sb = createClient(cfg.NEXT_PUBLIC_SUPABASE_URL, cfg.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  return {
    label: "supabase",
    async read(key, fallback) {
      const { data, error } = await sb.from("app_state").select("data").eq("user_id", OWNER).eq("key", key);
      if (error) throw new Error(`read ${key}: ${error.message}`);
      if (!data?.length) return fallback;
      const d = data[0].data;
      return typeof d === "string" ? JSON.parse(d) : d;
    },
    async write(key, value) {
      const { error } = await sb
        .from("app_state")
        .upsert({ user_id: OWNER, key, data: value, updated_at: new Date().toISOString() }, { onConflict: "user_id,key" });
      if (error) throw new Error(`write ${key}: ${error.message}`);
    },
  };
}

// --- the master password ---------------------------------------------------
//
// Read from a TTY when there is one. The env var exists for rehearsals and for
// a non-interactive run; it is then visible in that shell's history, which is
// why the prompt is the default.

function askHidden(question, envVar = "JARVIS_VAULT_MASTER") {
  return new Promise((resolve) => {
    if (envVar && process.env[envVar]) return resolve(process.env[envVar]);
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    process.stdout.write(question);
    const onData = (ch) => {
      if (ch.toString() === "\n" || ch.toString() === "\r" || ch.toString() === "\u0004") {
        process.stdin.removeListener("data", onData);
        process.stdout.write("\n");
        rl.close();
        resolve(buffer);
      } else if (ch.toString() === "\u0003") {
        process.exit(1);
      } else {
        buffer += ch.toString();
      }
    };
    let buffer = "";
    process.stdin.setRawMode?.(true);
    process.stdin.resume();
    process.stdin.on("data", onData);
  });
}

async function openVault(blob, passwordHint) {
  if (!blob.envelope) return null;
  if (!blob.envelope.saltMaster) throw new Error("vault envelope is malformed");
  const pw = passwordHint ?? (await askHidden("Master password: "));
  return (await unlockWithPassword(blob.envelope, pw)) || null;
}

// --- CSV -------------------------------------------------------------------

/**
 * Chrome's export: name,url,username,password,note — RFC4180 quoting, CRLF.
 *
 * Written by hand rather than with a dependency because the one thing that
 * matters is not mangling a password that contains a comma or a quote.
 */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  const s = text.replace(/^\uFEFF/, "");

  for (let i = 0; i < s.length; i += 1) {
    const c = s[i];
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i += 1;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i += 1;
      row.push(field);
      field = "";
      if (row.some((f) => f !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    if (row.some((f) => f !== "")) rows.push(row);
  }

  const header = (rows.shift() || []).map((h) => h.trim().toLowerCase());
  const at = (...names) => {
    for (const n of names) {
      const idx = header.indexOf(n);
      if (idx > -1) return idx;
    }
    return -1;
  };
  const iName = at("name", "title");
  const iUrl = at("url", "website", "login_uri");
  const iUser = at("username", "login_username", "user");
  const iPass = at("password", "login_password");
  const iNote = at("note", "notes");

  return rows
    .map((r) => ({
      name: (iName > -1 ? r[iName] : "") || "",
      url: (iUrl > -1 ? r[iUrl] : "") || "",
      username: (iUser > -1 ? r[iUser] : "") || "",
      password: (iPass > -1 ? r[iPass] : "") || "",
      note: (iNote > -1 ? r[iNote] : "") || "",
    }))
    .filter((e) => e.password || e.url);
}

// --- the map ---------------------------------------------------------------

function hostOf(url) {
  try {
    return new URL(url.startsWith("http") ? url : `https://${url}`).host.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** A folder named `Passwords` at the root, created once. */
function ensureFolder(data) {
  const found = (data.folders || []).find((f) => f.name === FOLDER && !f.parentId);
  if (found) return { folder: found, created: false };
  const folder = {
    id: uid("fld"),
    name: FOLDER,
    parentId: null,
    color: null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  data.folders = [...(data.folders || []), folder];
  return { folder, created: true };
}

function normalUrl(u) {
  return hostOf(u).toLowerCase();
}

function makeItem(entry, folderId) {
  const host = hostOf(entry.url);
  const title = (entry.name || host || entry.username || "Login").trim().slice(0, 120);
  const user = entry.username.trim();
  const fields = {};
  if (user) fields.username = user;
  if (user.includes("@")) fields.email = user;
  if (entry.url) fields.url = entry.url;
  if (entry.note) fields.notes = entry.note.slice(0, 2000);

  return {
    id: uid("itm"),
    title,
    body: entry.note || "",
    summary: host ? `Login — ${host}` : "Login",
    kind: "credential",
    source: "manual",
    folderId,
    tags: ["password", "imported"],
    url: entry.url || null,
    fields,
    password: null, // never stored in the clear, not even for a moment
    secret: null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
}

// --- commands --------------------------------------------------------------

async function status() {
  const st = await storage();
  const blob = coerceVault(await st.read(VAULT_KEY, emptyVault()));
  const data = await st.read(RECALL_KEY, { folders: [], items: [] });
  const creds = (data.items || []).filter((i) => i.kind === "credential");
  const cleared = creds.filter((i) => !i.password && !i.secret).length;
  const plain = creds.filter((i) => i.password).length;
  const legacy = creds.filter((i) => i.secret && !i.password).length;

  console.log(`storage            ${st.label}`);
  console.log(`vault state        ${vaultState(blob)}`);
  console.log(`secrets sealed     ${count(blob)}`);
  console.log(`recovery exported  ${blob.recoveryExportedAt ?? "no"}`);
  console.log(`recall folders     ${(data.folders || []).length}`);
  console.log(`recall items       ${(data.items || []).length}`);
  console.log(`credentials        ${creds.length}`);
  console.log(`  in the clear     ${plain}`);
  console.log(`  legacy-sealed    ${legacy}`);
  console.log(`  sealed or empty  ${cleared}`);
}

async function setup() {
  const st = await storage();
  const blob = coerceVault(await st.read(VAULT_KEY, emptyVault()));

  if (blob.envelope) {
    if (vaultState(blob) === "unconfirmed" && confirmSaved) {
      if (!apply) return console.log("Would mark the recovery key as saved. Re-run with --apply.");
      await st.write(VAULT_KEY, markExported(blob));
      return console.log("Recovery key marked as saved. The vault will now accept secrets.");
    }
    return console.log(
      `A vault already exists (state: ${vaultState(blob)}). Nothing to set up.\n` +
        (vaultState(blob) === "unconfirmed"
          ? "Its recovery key still needs confirming: run `setup --confirm-saved --apply` once you have it."
          : "Use `import <csv>` or `migrate` next."),
    );
  }

  const password = (await askHidden("Choose a master password: ")) || "";
  if (password.length < 8) {
    console.log("Refusing: use at least 8 characters. This one guards everything.");
    process.exit(1);
  }
  const again = process.env.JARVIS_VAULT_MASTER ? password : await askHidden("Repeat it: ");
  if (again !== password) {
    console.log("Those did not match. Nothing was written.");
    process.exit(1);
  }

  const made = await createEnvelope(password);
  const next = setEnvelope(emptyVault(), made.envelope); // gate stays SHUT

  console.log("\n" + "=".repeat(62));
  console.log(recoverySheet(made.recoveryKey));
  console.log("=".repeat(62));

  if (!apply) {
    console.log("Dry run: nothing written. Re-run with --apply to create the vault.");
    return;
  }

  const sheetPath = process.env.JARVIS_RECOVERY_SHEET || path.join(process.cwd(), "jarvis-vault-recovery.txt");
  await writeFile(sheetPath, recoverySheet(made.recoveryKey), "utf8");
  await st.write(VAULT_KEY, next);

  console.log(`Wrote ${sheetPath}`);
  console.log("Vault created with the gate SHUT — it will not accept a password until the key is confirmed.");
  console.log(`Next: move that file somewhere that is not this computer, then run:\n  node scripts/import-chrome-passwords.mjs setup --confirm-saved --apply`);
}

/**
 * Import Chrome's CSV.
 *
 * Order matters: every secret is sealed before anything is written, so a
 * failure part-way leaves the store untouched rather than half-migrated.
 */
async function importCsv(csvPath) {
  if (!csvPath) {
    console.log("usage: node scripts/import-chrome-passwords.mjs import <chrome-passwords.csv> [--apply]");
    process.exit(1);
  }
  const st = await storage();
  const blob = coerceVault(await st.read(VAULT_KEY, emptyVault()));

  if (!blob.envelope) {
    console.log("No vault yet. Run `setup --apply` first — an import with nowhere sealed to go would leave plaintext behind.");
    process.exit(1);
  }
  if (!canAcceptSecrets(blob)) {
    console.log("The vault's recovery gate is shut. Confirm the recovery key first: `setup --confirm-saved --apply`.");
    process.exit(1);
  }

  const opened = await openVault(blob);
  if (!opened) {
    console.log("Wrong master password. Nothing was written.");
    process.exit(1);
  }

  const parsed = parseCsv(await readFile(csvPath, "utf8"));
  // A row with no password is not something to seal; it is a site without a
  // saved login. Counted and reported rather than silently made into an empty
  // credential, because an empty credential looks like a bug later.
  const entries = parsed.filter((e) => e.password && e.password.length);
  const withoutPassword = parsed.length - entries.length;
  if (!entries.length) {
    console.log("No rows with a password. Is that a Chrome passwords CSV?");
    process.exit(1);
  }

  const data = await st.read(RECALL_KEY, { folders: [], items: [] });
  data.items = data.items || [];

  // What is already known, so a second run does not duplicate the map.
  const existing = new Map();
  for (const it of data.items) {
    if (it.kind !== "credential") continue;
    existing.set(`${normalUrl(it.url || it.fields?.url || "")}|${(it.fields?.username || "").toLowerCase()}`, it);
  }

  const { folder, created } = ensureFolder(data);
  const added = [];
  const skipped = [];
  let nextBlob = blob;

  for (const entry of entries) {
    const key = `${normalUrl(entry.url)}|${entry.username.toLowerCase()}`;
    const prior = existing.get(key);
    if (prior && nextBlob.secrets[prior.id]) {
      skipped.push(entry);
      continue;
    }
    const item = prior || makeItem(entry, folder.id);
    if (!prior) {
      data.items.push(item);
      existing.set(key, item);
    }
    if (entry.password) {
      nextBlob = putSecret(nextBlob, item.id, await encryptSecret(opened.dek, entry.password));
    }
    added.push({ item, entry });
  }

  // Prove every seal opens before the store is treated as done.
  let verified = 0;
  for (const { item, entry } of added) {
    const sealed = nextBlob.secrets[item.id];
    if (!sealed) continue;
    const back = await decryptSecret(opened.dek, sealed);
    if (back !== entry.password) throw new Error(`round-trip failed for ${item.title} — aborting before any write`);
    verified += 1;
  }

  console.log(`storage            ${st.label}`);
  console.log(`csv rows           ${parsed.length}`);
  console.log(`with a password    ${entries.length}${withoutPassword ? ` (${withoutPassword} skipped, no password)` : ""}`);
  console.log(`to seal            ${added.length}`);
  console.log(`already present    ${skipped.length}`);
  console.log(`folder             ${created ? `created "${FOLDER}"` : `reusing "${FOLDER}"`}`);
  console.log(`round-trip verified ${verified}/${added.length}`);

  if (!apply) {
    console.log("\nDry run: nothing written. Re-run with --apply.");
    return;
  }

  await backup(st, RECALL_KEY, VAULT_KEY);
  await st.write(VAULT_KEY, nextBlob);
  await st.write(RECALL_KEY, data);
  console.log(`\nWrote ${added.length} logins. Nothing was stored in the clear.`);
  console.log("Delete the CSV now — it is the only plaintext copy left.");
}

/**
 * Move passwords that are already in the clear into the vault.
 *
 * Seals and verifies every one first, then clears. A verification failure
 * aborts with the plaintext untouched rather than leaving a hole.
 */
async function migrate() {
  const st = await storage();
  const blob = coerceVault(await st.read(VAULT_KEY, emptyVault()));
  if (!blob.envelope) {
    console.log("No vault yet. Run `setup --apply` first.");
    process.exit(1);
  }
  if (!canAcceptSecrets(blob)) {
    console.log("The vault's recovery gate is shut. Confirm the recovery key first: `setup --confirm-saved --apply`.");
    process.exit(1);
  }

  const opened = await openVault(blob);
  if (!opened) {
    console.log("Wrong master password. Nothing was written.");
    process.exit(1);
  }

  const data = await st.read(RECALL_KEY, { folders: [], items: [] });
  const creds = (data.items || []).filter((i) => i.kind === "credential");
  const clearable = creds.filter((i) => i.password?.trim());
  const stranded = creds.filter((i) => i.secret && !i.password?.trim());

  console.log(`storage            ${st.label}`);
  console.log(`to seal + clear    ${clearable.length}`);
  console.log(`already sealed     ${creds.filter((i) => blob.secrets[i.id]).length}`);
  console.log(`legacy-stranded    ${stranded.length}${stranded.length ? " (only the retired master password can open these)" : ""}`);
  for (const s of stranded) console.log(`  stranded: ${s.title}`);

  if (!clearable.length) {
    console.log("\nNothing in the clear. Already done.");
    return;
  }

  let nextBlob = blob;
  for (const item of clearable) {
    nextBlob = putSecret(nextBlob, item.id, await encryptSecret(opened.dek, item.password));
  }

  let verified = 0;
  for (const item of clearable) {
    const back = await decryptSecret(opened.dek, nextBlob.secrets[item.id]);
    if (back !== item.password) throw new Error(`round-trip failed for ${item.title} — aborting, plaintext untouched`);
    verified += 1;
  }
  console.log(`round-trip verified ${verified}/${clearable.length}`);

  if (!apply) {
    console.log("\nDry run: nothing written. Re-run with --apply.");
    return;
  }

  await backup(st, RECALL_KEY, VAULT_KEY);
  for (const item of clearable) item.password = null; // sealed copy is verified
  await st.write(VAULT_KEY, nextBlob);
  await st.write(RECALL_KEY, data);
  console.log(`\nSealed and cleared ${clearable.length} passwords. The map kept only usernames and URLs.`);
}

/**
 * A local snapshot of both rows before the first write.
 *
 * This file CONTAINS PLAINTEXT PASSWORDS for whatever was still in the clear.
 * It exists for one purpose — putting the store back if a run goes wrong — and
 * should be deleted once the result is verified in the app.
 */
async function backup(st, ...keys) {
  const dir = process.env.JARVIS_BACKUP_DIR || path.join(process.cwd(), "backups");
  await mkdir(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const out = {};
  for (const k of keys) out[k] = await st.read(k, null);
  const file = path.join(dir, `pre-password-import-${stamp}.json`);
  await writeFile(file, JSON.stringify(out, null, 2), "utf8");
  console.log(`\nBackup: ${file}`);
  console.log("  ⚠ contains plaintext passwords — DELETE THIS FILE once the app looks right.");
}

/**
 * The whole job in one command, so the master password is typed once.
 *
 * Deliberately sequential and stop-on-first-failure: a vault whose recovery key
 * was not written down is worse than no vault, so the run refuses to seal
 * anything until the operator confirms they have the key somewhere else.
 */
async function run(csvPaths) {
  // No CSVs is a legitimate run: it sets up the vault and seals whatever is
  // already sitting in the clear. That is the first step for anyone who has
  // logins saved but has not exported Chrome yet, so refusing here would block
  // the one job that matters most.
  if (!csvPaths.length) {
    console.log("No Chrome CSV given — vault + existing plaintext only.\n");
  }
  const st = await storage();
  let blob = coerceVault(await st.read(VAULT_KEY, emptyVault()));
  let opened;

  if (!blob.envelope) {
    console.log("No vault yet — creating one.\n");
    const password = (await askHidden("Choose a master password (min 8 chars): ")) || "";
    if (password.length < 8) {
      console.log("Refusing: at least 8 characters. This one guards everything.");
      process.exit(1);
    }
    const again = process.env.JARVIS_VAULT_MASTER ? password : await askHidden("Repeat it: ");
    if (again !== password) {
      console.log("Those did not match. Nothing was written.");
      process.exit(1);
    }
    const made = await createEnvelope(password);
    blob = setEnvelope(emptyVault(), made.envelope);
    opened = { dek: made.dek, raw: made.raw };

    console.log("\n" + "=".repeat(62));
    console.log(recoverySheet(made.recoveryKey));
    console.log("=".repeat(62));

    const sheetPath = process.env.JARVIS_RECOVERY_SHEET || path.join(process.cwd(), "jarvis-vault-recovery.txt");
    if (apply) {
      await writeFile(sheetPath, recoverySheet(made.recoveryKey), "utf8");
      console.log(`Also written to: ${sheetPath}`);
    }
    console.log("\nMove that key somewhere that is NOT this computer (paper, USB, a safe).");
    const ack = (await askHidden("Type SAVED once you have it: ", "JARVIS_SAVE_ACK")).trim().toLowerCase();
    if (ack !== "saved") {
      console.log("Not confirmed, so nothing was sealed. Re-run when the key is written down.");
      process.exit(1);
    }
    if (apply) {
      blob = markExported(blob);
      await st.write(VAULT_KEY, blob);
    }
  } else {
    if (!canAcceptSecrets(blob)) {
      console.log("A vault exists but its recovery key was never confirmed — it will not accept secrets.");
      console.log("Write the key down, then run: setup --confirm-saved --apply");
      process.exit(1);
    }
    opened = await openVault(blob);
    if (!opened) {
      console.log("Wrong master password. Nothing was written.");
      process.exit(1);
    }
  }

  // --- import every CSV given ---------------------------------------------
  // Chrome keeps a separate password store per profile, so a real migration is
  // several exports. Reading them together means duplicates collapse here
  // rather than needing to be untangled afterwards.
  let totalRows = 0;
  let totalNoPassword = 0;
  const entries = [];
  for (const file of csvPaths) {
    let text;
    try {
      text = await readFile(file, "utf8");
    } catch {
      console.log(`Skipping unreadable file: ${file}`);
      continue;
    }
    const parsed = parseCsv(text);
    const withPassword = parsed.filter((e) => e.password && e.password.length);
    totalRows += parsed.length;
    totalNoPassword += parsed.length - withPassword.length;
    console.log(`  ${path.basename(file).padEnd(34)} ${withPassword.length} login(s)`);
    entries.push(...withPassword);
  }
  if (csvPaths.length && !entries.length) {
    console.log("\nNo rows with a password anywhere. Are those Chrome password exports?");
    process.exit(1);
  }

  const data = await st.read(RECALL_KEY, { folders: [], items: [] });
  data.items = data.items || [];
  const existing = new Map();
  for (const it of data.items) {
    if (it.kind !== "credential") continue;
    existing.set(`${normalUrl(it.url || it.fields?.url || "")}|${(it.fields?.username || "").toLowerCase()}`, it);
  }

  // Only make the folder when something is actually going into it — a vault
  // setup with no CSVs should not leave an empty "Passwords" folder behind.
  const { folder, created } = entries.length ? ensureFolder(data) : { folder: null, created: false };
  const added = [];
  let skipped = 0;
  let nextBlob = blob;

  for (const entry of entries) {
    const key = `${normalUrl(entry.url)}|${entry.username.toLowerCase()}`;
    const prior = existing.get(key);
    if (prior && nextBlob.secrets[prior.id]) {
      skipped += 1;
      continue;
    }
    const item = prior || makeItem(entry, folder.id);
    if (!prior) {
      data.items.push(item);
      existing.set(key, item);
    }
    nextBlob = putSecret(nextBlob, item.id, await encryptSecret(opened.dek, entry.password));
    added.push({ item, entry });
  }

  // --- seal and clear what was already in the clear ----------------------
  const clearable = data.items.filter((i) => i.kind === "credential" && i.password?.trim());
  for (const item of clearable) {
    nextBlob = putSecret(nextBlob, item.id, await encryptSecret(opened.dek, item.password));
  }
  const stranded = data.items.filter((i) => i.kind === "credential" && i.secret && !i.password?.trim());

  // --- prove every seal opens before anything is written -----------------
  let verified = 0;
  for (const { item, entry } of added) {
    const back = await decryptSecret(opened.dek, nextBlob.secrets[item.id]);
    if (back !== entry.password) throw new Error(`round-trip failed for ${item.title} — aborting, nothing written`);
    verified += 1;
  }
  for (const item of clearable) {
    const back = await decryptSecret(opened.dek, nextBlob.secrets[item.id]);
    if (back !== item.password) throw new Error(`round-trip failed for ${item.title} — aborting, nothing written`);
    verified += 1;
  }

  console.log(`\nstorage              ${st.label}`);
  console.log(`csv files            ${csvPaths.length}`);
  console.log(`csv rows             ${totalRows}${totalNoPassword ? ` (${totalNoPassword} with no password)` : ""}`);
  console.log(`new logins           ${added.length}`);
  console.log(`already known        ${skipped}`);
  console.log(`cleared from plain   ${clearable.length}`);
  if (added.length) console.log(`folder               ${created ? `created "${FOLDER}"` : `reusing "${FOLDER}"`}`);
  console.log(`round-trip verified  ${verified}`);
  if (stranded.length) {
    console.log(`stranded (old vault) ${stranded.length} — only the retired master password can open these:`);
    for (const s of stranded) console.log(`   ${s.title}`);
  }

  if (!apply) {
    console.log("\nDry run: nothing written. Re-run with --apply.");
    return;
  }

  await backup(st, RECALL_KEY, VAULT_KEY);
  for (const item of clearable) item.password = null;
  await st.write(VAULT_KEY, nextBlob);
  await st.write(RECALL_KEY, data);

  console.log(`\nDone. ${count(nextBlob)} secrets sealed, ${clearable.length} removed from the clear.`);
  const leftovers = [];
  if (csvPaths.length) leftovers.push("the CSV files");
  leftovers.push("the backup file above");
  console.log(`Now delete ${leftovers.join(" and ")} once the app looks right.`);
}

// --- go --------------------------------------------------------------------

try {
  if (cmd === "status") await status();
  else if (cmd === "setup") await setup();
  else if (cmd === "run") await run(await csvTargets());
  else if (cmd === "import") await importCsv(argv[1]?.startsWith("--") ? null : argv[1]);
  else if (cmd === "migrate") await migrate();
} catch (e) {
  console.error("FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
}
