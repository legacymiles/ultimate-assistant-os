// ---------------------------------------------------------------------------
// Password agent — the local process the browser extension talks to.
//
//   node scripts/password-agent.mjs
//
// Why this exists. The vault's data key is deliberately memory-only, which is
// the right call but leaves a gap: a browser extension runs in its own context
// and cannot reach the hub tab's memory, so it cannot seal a captured password
// and has nowhere legitimate to put a plaintext one. This process is that
// somewhere — it holds the key in memory for as long as it runs, and seals
// captures itself. It is the smallest thing that makes automatic capture
// possible without inventing a second encryption key.
//
// Trust model, stated plainly:
//   - binds 127.0.0.1 only, never a LAN address
//   - CORS answers chrome-extension:// origins only, so a web page's fetch is
//     refused and cannot read the response even if it guesses the port
//   - a token is required for the endpoints that touch secrets, so another
//     local process cannot silently unlock the vault with guesses
//   - the key lives in memory and is dropped on lock, on exit, and after the
//     idle timeout. Nothing writes it to disk.
//
// What it is NOT: a second vault. It reads and writes the same `jarvis-vault`
// and `recall:v1` rows as the importer, using the same crypto module. Losing
// this process loses nothing.
// ---------------------------------------------------------------------------

import http from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import crypto from "node:crypto";
import path from "node:path";

import { unlockWithPassword, encryptSecret, decryptSecret } from "../src/lib/passwords/crypto.ts";
import { emptyVault, coerceVault, canAcceptSecrets, putSecret, vaultState } from "../src/lib/passwords/vault.ts";

const PORT = Number(process.env.JARVIS_PW_PORT || 9555);
const OWNER = "698ff77a-21e5-47a3-9973-358546b97ebc";
const VAULT_KEY = "jarvis-vault";
const RECALL_KEY = "recall:v1";
const FOLDER = "Passwords";
const IDLE_MS = 30 * 60 * 1000; // lock after 30 quiet minutes
const TOKEN_FILE = path.join(process.env.USERPROFILE || process.env.HOME || ".", ".jarvis", "agent-token");

// --- the one piece of state that matters -----------------------------------

let dek = null; // CryptoKey, memory only
let idleTimer = null;
let unlockedAt = null;

function lock(reason = "locked") {
  dek = null;
  unlockedAt = null;
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
  log(`locked (${reason})`);
}

function touch() {
  if (!dek) return;
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => lock("idle"), IDLE_MS);
}

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// --- storage (same rows as the importer) -----------------------------------

function parseEnv(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

let sbPromise = null;
async function db() {
  if (sbPromise) return sbPromise;
  sbPromise = (async () => {
    // `--dir` runs the whole agent against JSON files, so the capture path can
    // be exercised without a real vault or real rows.
    const dirIdx = process.argv.indexOf("--dir");
    if (dirIdx > -1) {
      const dir = process.argv[dirIdx + 1];
      const fileFor = (key) => path.join(dir, `${key.replace(/[:/]/g, "_")}.json`);
      return {
        async read(key, fallback) {
          try {
            return JSON.parse((await readFile(fileFor(key), "utf8")).replace(/^\uFEFF/, ""));
          } catch {
            return fallback;
          }
        },
        async write(key, value) {
          await mkdir(dir, { recursive: true });
          await writeFile(fileFor(key), JSON.stringify(value, null, 2), "utf8");
        },
      };
    }

    let cfg;
    try {
      cfg = parseEnv(await readFile(path.join(process.cwd(), ".env.local"), "utf8"));
    } catch {
      throw new Error("No .env.local — start this from the project root.");
    }
    const { createClient } = await import("@supabase/supabase-js");
    const sb = createClient(cfg.NEXT_PUBLIC_SUPABASE_URL, cfg.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });
    return {
      async read(key, fallback) {
        const { data, error } = await sb.from("app_state").select("data").eq("user_id", OWNER).eq("key", key);
        if (error) throw new Error(`read ${key}: ${error.message}`);
        if (!data?.length) return fallback;
        return typeof data[0].data === "string" ? JSON.parse(data[0].data) : data[0].data;
      },
      async write(key, value) {
        const { error } = await sb
          .from("app_state")
          .upsert({ user_id: OWNER, key, data: value, updated_at: new Date().toISOString() }, { onConflict: "user_id,key" });
        if (error) throw new Error(`write ${key}: ${error.message}`);
      },
    };
  })();
  return sbPromise;
}

const uid = (p = "id") =>
  `${p}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
const nowIso = () => new Date().toISOString();
const hostOf = (url) => {
  try {
    return new URL(url.startsWith("http") ? url : `https://${url}`).host.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
};

function ensureFolder(data) {
  const found = (data.folders || []).find((f) => f.name === FOLDER && !f.parentId);
  if (found) return found;
  const folder = { id: uid("fld"), name: FOLDER, parentId: null, color: null, createdAt: nowIso(), updatedAt: nowIso() };
  data.folders = [...(data.folders || []), folder];
  return folder;
}

// --- token -----------------------------------------------------------------

async function token() {
  if (process.env.JARVIS_AGENT_TOKEN) return process.env.JARVIS_AGENT_TOKEN;
  try {
    return (await readFile(TOKEN_FILE, "utf8")).trim();
  } catch {
    const t = crypto.randomBytes(24).toString("base64url");
    await mkdir(path.dirname(TOKEN_FILE), { recursive: true });
    await writeFile(TOKEN_FILE, t, { encoding: "utf8", mode: 0o600 });
    return t;
  }
}

// --- capture ---------------------------------------------------------------

/**
 * One captured login becomes a map entry plus a sealed secret.
 *
 * Idempotent by (host, username): filling the same form twice must not make two
 * folders' worth of duplicates. An existing credential is updated in place, and
 * its secret re-sealed only when the password actually changed.
 */
async function capture({ url, username, password, formAction }) {
  if (!password) throw new Error("empty password");
  const d = await db();
  const blob = coerceVault(await d.read(VAULT_KEY, emptyVault()));
  if (!blob.envelope) throw new Error("no vault yet — create it in Jarvis first");
  if (!canAcceptSecrets(blob)) throw new Error("vault recovery key not confirmed yet");

  const data = await d.read(RECALL_KEY, { folders: [], items: [] });
  data.items = data.items || [];
  const host = hostOf(url || formAction);
  const user = (username || "").trim();

  const existing = data.items.find(
    (i) => i.kind === "credential" && hostOf(i.url || i.fields?.url || "") === host &&
      (i.fields?.username || "").toLowerCase() === user.toLowerCase(),
  );

  const folder = ensureFolder(data);
  const item =
    existing ||
    {
      id: uid("itm"),
      title: host || "Login",
      body: "",
      summary: host ? `Login — ${host}` : "Login",
      kind: "credential",
      source: "manual",
      folderId: folder.id,
      tags: ["password", "captured"],
      url: url || null,
      fields: {},
      password: null,
      secret: null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };

  item.fields = { ...(item.fields || {}), username: user };
  if (user.includes("@")) item.fields.email = user;
  if (url) item.fields.url = url;
  item.updatedAt = nowIso();

  // Re-sealing on every fill would churn the vault for no reason; compare first.
  let changed = true;
  const current = blob.secrets[item.id];
  if (current) {
    const plain = await decryptSecret(dek, current);
    changed = plain !== password;
  }

  let nextBlob = blob;
  if (changed) nextBlob = putSecret(blob, item.id, await encryptSecret(dek, password));
  if (!existing) data.items.push(item);

  await d.write(VAULT_KEY, nextBlob);
  await d.write(RECALL_KEY, data);
  return { id: item.id, title: item.title, host, changed, created: !existing };
}

// --- http ------------------------------------------------------------------

async function readBody(req) {
  let raw = "";
  for await (const c of req) {
    raw += c;
    if (raw.length > 64 * 1024) throw new Error("body too large");
  }
  return raw ? JSON.parse(raw) : {};
}

const EXT_ORIGIN = /^chrome-extension:\/\//;

function cors(req, res) {
  const origin = req.headers.origin || "";
  if (EXT_ORIGIN.test(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Jarvis-Token, X-Jarvis-Extension");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Vary", "Origin");
  }
  // A plain web page gets no CORS headers, so the browser refuses to read the
  // response. That is the barrier that matters: an evil page cannot probe this.
  return EXT_ORIGIN.test(origin);
}

function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  const originOk = cors(req, res);
  if (req.method === "OPTIONS") {
    res.writeHead(originOk ? 204 : 403);
    return res.end();
  }

  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const route = url.pathname;
  const needToken = new Set(["/unlock", "/capture", "/secret", "/match"]);

  // A service worker's fetch carries NO Origin header, so origin alone cannot
  // identify the extension — that bug made the extension authorise itself out.
  // A custom header fixes it: a web page CAN set it, but doing so forces a CORS
  // preflight, and this server answers preflights only for extension origins.
  // So an evil page is blocked by the browser, while the extension gets in.
  const viaExtension = req.headers["x-jarvis-extension"] === "1";
  const trusted = originOk || viaExtension;

  try {
    if (needToken.has(route)) {
      const supplied = req.headers["x-jarvis-token"];
      if (!trusted && !supplied) throw Object.assign(new Error("origin not allowed"), { code: 403 });
      if (supplied && supplied !== (await token())) throw Object.assign(new Error("bad token"), { code: 401 });
    }

    if (route === "/health") return send(res, 200, { ok: true, service: "password-agent", version: 1 });

    if (route === "/status") {
      const d = await db();
      const blob = coerceVault(await d.read(VAULT_KEY, emptyVault()));
      const data = await d.read(RECALL_KEY, { folders: [], items: [] });
      return send(res, 200, {
        unlocked: Boolean(dek),
        unlockedAt,
        vault: vaultState(blob),
        sealed: Object.keys(blob.secrets || {}).length,
        credentials: (data.items || []).filter((i) => i.kind === "credential").length,
      });
    }

    if (route === "/unlock" && req.method === "POST") {
      const { password } = await readBody(req);
      const d = await db();
      const blob = coerceVault(await d.read(VAULT_KEY, emptyVault()));
      if (!blob.envelope) throw Object.assign(new Error("no vault yet — create one in Jarvis"), { code: 409 });
      const opened = await unlockWithPassword(blob.envelope, password || "");
      if (!opened) throw Object.assign(new Error("wrong master password"), { code: 401 });
      dek = opened.dek;
      unlockedAt = new Date().toISOString();
      touch();
      log("unlocked");
      return send(res, 200, { ok: true, unlocked: true });
    }

    if (route === "/lock" && req.method === "POST") {
      lock("requested");
      return send(res, 200, { ok: true, unlocked: false });
    }

    if (route === "/capture" && req.method === "POST") {
      if (!dek) throw Object.assign(new Error("agent is locked — unlock it to save a login"), { code: 423 });
      touch();
      const result = await capture(await readBody(req));
      log(`capture ${result.host}${result.changed ? "" : " (unchanged)"}`);
      return send(res, 200, { ok: true, ...result });
    }

    if (route === "/match") {
      const host = hostOf(url.searchParams.get("host") || "");
      if (!host) return send(res, 400, { error: "host required" });
      const d = await db();
      const data = await d.read(RECALL_KEY, { folders: [], items: [] });
      const hits = (data.items || [])
        .filter((i) => i.kind === "credential" && hostOf(i.url || i.fields?.url || "") === host)
        .map((i) => ({ id: i.id, title: i.title, username: i.fields?.username || "", url: i.url || i.fields?.url || "" }));
      return send(res, 200, { host, items: hits });
    }

    if (route === "/secret" && req.method === "POST") {
      if (!dek) throw Object.assign(new Error("agent is locked"), { code: 423 });
      touch();
      const { id } = await readBody(req);
      const d = await db();
      const blob = coerceVault(await d.read(VAULT_KEY, emptyVault()));
      const sealed = blob.secrets[id];
      if (!sealed) return send(res, 404, { error: "no such secret" });
      const plain = await decryptSecret(dek, sealed);
      if (plain === null) return send(res, 500, { error: "could not open secret" });
      // The one place a password leaves this process. Never logged.
      return send(res, 200, { id, password: plain });
    }

    return send(res, 404, { error: "no such route" });
  } catch (e) {
    const code = e.code || 500;
    if (code >= 500) log("error:", e.message);
    return send(res, code, { error: e.message });
  }
});

const t = await token();
server.listen(PORT, "127.0.0.1", () => {
  log(`password agent on http://127.0.0.1:${PORT}`);
  log(`token file: ${TOKEN_FILE}`);
  log("leave this running; Ctrl+C to stop (the key is dropped on exit)");
});

process.on("SIGINT", () => {
  lock("shutdown");
  process.exit(0);
});
