// ---------------------------------------------------------------------------
// DTF print station — pure helpers.
//
// Everything here is free of I/O so it can be tested (src/lib/dtf/
// station-lib.test.ts runs it with the repo's vitest). station.mjs does the
// fetching, writing, watching and launching; this file decides names, folder
// layout, how server and local state merge, and which status reports are
// allowed. It mirrors src/lib/dtf/server/jobs.ts canJobMove for the moves the
// station can make — the website re-checks every one, this only stops the
// station from sending a report it already knows will be refused.
// ---------------------------------------------------------------------------

import path from "node:path";

/**
 * What ColorboxRIP owns — the export deliberately does none of these. Copied
 * from LANCELOT_M1630_PRO.ripOwns (src/lib/dtf/printers.ts) as the offline
 * fallback; the website sends the live list with every poll, and a test keeps
 * the two equal.
 */
export const DEFAULT_RIP_OWNS = [
  "RGB → CMYK conversion (the ICC profile in ColorboxRIP)",
  "White ink generation, choke and underbase",
  "Ink limits and density",
  "Mirroring for film (set in the RIP's job settings)",
  "Print mode, passes and head settings",
];

export const DEFAULT_CONFIG = {
  siteUrl: "",
  token: "",
  exportDir: "C:\\DTF\\Print Jobs",
  colorboxRipPath: "",
  openMode: "reveal",
  pollSeconds: 15,
  port: 7316,
};

/** Station-local statuses beyond the website's. */
export const LOCAL_ONLY = ["withdrawn"];

const STATION_MOVES = {
  queued: ["downloaded", "failed"],
  downloaded: ["opened", "printed", "failed"],
  opened: ["opened", "printed", "failed"],
};

/**
 * May the station report `to` for a job whose status (as the station knows
 * it) is `from`? Re-opening an opened job is allowed (the operator clicked
 * Open twice); the website treats a repeat as a no-op.
 * @param {string} from
 * @param {string} to
 * @returns {boolean}
 */
export function canStationReport(from, to) {
  const list = /** @type {Record<string, string[]>} */ (STATION_MOVES)[from];
  return Array.isArray(list) && list.includes(to);
}

const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;

/**
 * One Windows-safe path segment: no reserved characters, no control
 * characters, no trailing dot or space, no device names, never "..".
 * @param {unknown} name
 * @param {string} [fallback]
 * @returns {string}
 */
export function sanitizeSegment(name, fallback = "untitled") {
  let s = String(name ?? "")
    // eslint-disable-next-line no-control-regex
    .replace(/[<>:"/\\|?*\u0000-\u001f\u007f]+/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "");
  if (s.length > 120) s = s.slice(0, 120).replace(/[. ]+$/g, "");
  if (!s || /^\.+$/.test(s)) s = fallback;
  const stem = s.split(".")[0];
  if (RESERVED.test(stem)) s = `_${s}`;
  return s;
}

/**
 * A safe file name that always ends in `ext`.
 * @param {unknown} name
 * @param {string} [ext]
 * @returns {string}
 */
export function sanitizeFilename(name, ext = ".png") {
  const raw = String(name ?? "");
  const stem = raw.toLowerCase().endsWith(ext) ? raw.slice(0, -ext.length) : raw;
  return `${sanitizeSegment(stem, "print")}${ext}`;
}

/** The state key for one job. */
export function jobKey(orderId, jobId) {
  return `${orderId}/${jobId}`;
}

/**
 * Where a job lives on disk: <exportDir>\<orderNumber>\<file>.png, with the
 * order's job.json and PRODUCTION.txt beside it.
 * @param {string} exportDir
 * @param {{ orderNumber: string; suggestedFilename: string; side?: string; jobId?: string }} job
 */
export function jobPaths(exportDir, job) {
  const dir = path.join(exportDir, sanitizeSegment(job.orderNumber, "order"));
  const name = sanitizeFilename(job.suggestedFilename || `${job.orderNumber}_${job.side ?? "print"}_${job.jobId ?? ""}`);
  return {
    dir,
    png: path.join(dir, name),
    part: path.join(dir, `${name}.part`),
    jobJson: path.join(dir, "job.json"),
    production: path.join(dir, "PRODUCTION.txt"),
  };
}

/**
 * True when `candidate` resolves to `root` itself or somewhere beneath it.
 * Case-insensitive on Windows. Use on every path that came from a request.
 * @param {string} root
 * @param {string} candidate
 * @param {boolean} [win]
 */
export function isInside(root, candidate, win = process.platform === "win32") {
  const p = win ? path.win32 : path.posix;
  const r = p.resolve(root);
  const c = p.resolve(candidate);
  const rel = p.relative(win ? r.toLowerCase() : r, win ? c.toLowerCase() : c);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${p.sep}`) && !p.isAbsolute(rel));
}

/**
 * Wait before the next attempt after `failures` consecutive failures:
 * doubles from the poll interval, capped (5 min by default).
 * @param {number} failures
 * @param {number} baseMs
 * @param {number} [maxMs]
 */
export function backoffMs(failures, baseMs, maxMs = 5 * 60_000) {
  if (failures <= 0) return baseMs;
  const n = Math.min(failures, 16);
  return Math.min(maxMs, baseMs * 2 ** n);
}

/**
 * Validate and fill a station config. Returns plain-English problems; an empty
 * token is not a problem (the station runs and shows "not paired").
 * @param {Record<string, unknown>} raw
 */
export function normalizeConfig(raw) {
  /** @type {string[]} */
  const errors = [];
  /** @type {string[]} */
  const warnings = [];
  const c = { ...DEFAULT_CONFIG, ...(raw && typeof raw === "object" ? raw : {}) };
  const siteUrl = String(c.siteUrl ?? "").trim().replace(/\/+$/, "");
  if (!/^https?:\/\/[^\s/]+/i.test(siteUrl)) {
    errors.push('siteUrl must be the website address, like "https://yourshop.example".');
  } else if (/^http:/i.test(siteUrl) && !/^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|$|\/)/i.test(siteUrl)) {
    warnings.push("siteUrl uses http://, so the station token travels unencrypted. Use https:// for a real shop.");
  }
  const exportDir = String(c.exportDir ?? "").trim();
  if (!exportDir) errors.push("exportDir must be a folder path, like C:\\DTF\\Print Jobs.");
  else if (!path.isAbsolute(exportDir)) errors.push("exportDir must be a full path that starts with a drive letter.");
  const openMode = c.openMode === "argument" ? "argument" : "reveal";
  if (c.openMode !== undefined && c.openMode !== "reveal" && c.openMode !== "argument") {
    warnings.push('openMode must be "reveal" or "argument"; using "reveal".');
  }
  const poll = Number(c.pollSeconds);
  const pollSeconds = Number.isFinite(poll) ? Math.max(5, Math.min(300, Math.round(poll))) : 15;
  const port = Number(c.port);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) errors.push("port must be a whole number between 1024 and 65535.");
  const colorboxRipPath = String(c.colorboxRipPath ?? "").trim();
  if (openMode === "argument" && !colorboxRipPath) errors.push('openMode "argument" needs colorboxRipPath set to the ColorboxRIP .exe.');
  return {
    config: {
      siteUrl,
      token: String(c.token ?? "").trim(),
      exportDir,
      colorboxRipPath,
      openMode,
      pollSeconds,
      port: Number.isInteger(port) ? port : DEFAULT_CONFIG.port,
    },
    errors,
    warnings,
  };
}

/**
 * HTTP header values must be Latin-1. A folder name with other characters is
 * sent percent-encoded rather than crashing the poll.
 * @param {string} value
 */
export function headerSafe(value) {
  // eslint-disable-next-line no-control-regex
  return /^[\u0020-\u007e]*$/.test(value) ? value : encodeURIComponent(value);
}

/**
 * @typedef {{
 *   version: number;
 *   localKey: string;
 *   jobs: Record<string, any>;
 *   printer: { id?: string; name?: string; rip?: string; ripOwns: string[] } | null;
 *   lastSyncAt: string | null;
 * }} StationState
 */

/**
 * A fresh, empty state.
 * @returns {StationState}
 */
export function emptyState() {
  return { version: 1, localKey: "", jobs: {}, printer: null, lastSyncAt: null };
}

/**
 * Accept whatever was on disk; anything unrecognisable becomes empty fields
 * rather than a crash.
 * @param {unknown} raw
 * @returns {StationState}
 */
export function normalizeState(raw) {
  const s = emptyState();
  if (!raw || typeof raw !== "object") return s;
  const r = /** @type {Record<string, any>} */ (raw);
  if (typeof r.localKey === "string") s.localKey = r.localKey;
  if (r.jobs && typeof r.jobs === "object") {
    for (const [k, v] of Object.entries(r.jobs)) {
      if (v && typeof v === "object" && v.job && typeof v.job === "object") {
        s.jobs[k] = { local: {}, ...v, key: k, pending: Array.isArray(v.pending) ? v.pending : [] };
      }
    }
  }
  if (r.printer && typeof r.printer === "object") s.printer = r.printer;
  if (typeof r.lastSyncAt === "string") s.lastSyncAt = r.lastSyncAt;
  return s;
}

/**
 * Merge the website's job list into local state (returns a new state).
 *
 * - A job the website lists is upserted; the website's status wins unless the
 *   station still holds an unsent report for it (then the local status stands
 *   until the report lands or is refused).
 * - A job the station knew but the website no longer lists is kept: if the
 *   station's last status was printed or failed that is the reason; otherwise
 *   the owner took it out of the queue (or cancelled the order) and it is
 *   marked "withdrawn". Nothing on disk is deleted.
 *
 * @param {StationState} state
 * @param {Array<Record<string, any>>} serverJobs
 * @param {string} nowIso
 * @returns {StationState}
 */
export function mergeServerJobs(state, serverJobs, nowIso) {
  /** @type {Record<string, any>} */
  const jobs = {};
  const seen = new Set();
  for (const sj of serverJobs) {
    const key = jobKey(sj.orderId, sj.jobId);
    seen.add(key);
    const prev = state.jobs[key];
    const pending = prev?.pending ?? [];
    const status = pending.length ? prev.status : sj.status;
    jobs[key] = {
      key,
      job: sj,
      status,
      serverStatus: sj.status,
      local: prev?.local ?? {},
      pending,
      firstSeenAt: prev?.firstSeenAt ?? nowIso,
      updatedAt: prev && prev.serverStatus === sj.status && prev.status === status ? prev.updatedAt : nowIso,
      lastError: prev?.lastError ?? null,
      withdrawnAt: null,
    };
  }
  for (const [key, prev] of Object.entries(state.jobs)) {
    if (seen.has(key)) continue;
    const done = prev.status === "printed" || prev.status === "failed" || prev.status === "withdrawn";
    if (done || (prev.pending && prev.pending.length)) {
      jobs[key] = prev;
    } else {
      jobs[key] = { ...prev, status: "withdrawn", withdrawnAt: nowIso, updatedAt: nowIso };
    }
  }
  return { ...state, jobs, lastSyncAt: nowIso };
}

/**
 * Should the station fetch this job's file now?
 * - queued on the website and no "downloaded" report already waiting → yes
 *   (a re-queue after a problem fetches a fresh copy);
 * - downloaded / opened on the website but the station has no record of the
 *   file (new PC, lost state) → yes, so the folder matches the website;
 * - the operator asked for it again → yes.
 * @param {Record<string, any>} entry
 */
export function needsDownload(entry) {
  if (!entry || entry.status === "withdrawn") return false;
  if (entry.local?.redownload) return true;
  const waiting = (entry.pending ?? []).some((p) => p.status === "downloaded");
  if (entry.serverStatus === "queued") return !waiting;
  if (entry.serverStatus === "downloaded" || entry.serverStatus === "opened") return !entry.local?.file;
  return false;
}

/**
 * Drop finished or withdrawn jobs older than `keepMs` with nothing left to send.
 * @param {StationState} state
 * @param {number} nowMs
 * @param {number} [keepMs]
 * @returns {StationState}
 */
export function pruneState(state, nowMs, keepMs = 7 * 24 * 3600_000) {
  /** @type {Record<string, any>} */
  const jobs = {};
  for (const [k, e] of Object.entries(state.jobs)) {
    const finished = e.status === "printed" || e.status === "failed" || e.status === "withdrawn";
    const age = nowMs - Date.parse(e.updatedAt ?? e.firstSeenAt ?? "");
    if (finished && !(e.pending ?? []).length && Number.isFinite(age) && age > keepMs) continue;
    jobs[k] = e;
  }
  return { ...state, jobs };
}

/** "28.0 × 31.5 cm" */
export function cm(w, h) {
  const f = (n) => (Number.isFinite(Number(n)) ? Number(n).toFixed(1) : "?");
  return `${f(w)} × ${f(h)} cm`;
}

export function formatBytes(n) {
  const b = Number(n) || 0;
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

/** Where the transfer goes, in press-operator words. */
export function pressLine(job) {
  const top = Number(job.pressTopCm);
  const off = Number(job.pressCenterOffsetCm);
  const across =
    !Number.isFinite(off) || Math.abs(off) < 0.05
      ? "centred"
      : `${Math.abs(off).toFixed(1)} cm ${off > 0 ? "right" : "left"} of centre (as you look at the garment)`;
  return `Top edge ${Number.isFinite(top) ? top.toFixed(1) : "?"} cm below the collar, ${across}`;
}

/**
 * PRODUCTION.txt for one order folder: everything the operator needs at the
 * printer and the press, and the RIP checklist. CRLF so Notepad shows it right.
 * @param {Array<Record<string, any>>} entries every job of one order the station knows
 * @param {string[]} ripOwns
 * @param {string} nowIso
 */
export function productionText(entries, ripOwns, nowIso) {
  const first = entries[0]?.job ?? {};
  const L = [];
  L.push(`DTF PRODUCTION SHEET — ${first.orderNumber ?? ""}`);
  L.push("=".repeat(60));
  L.push(`Customer:        ${first.customerName || "—"}`);
  L.push(`Garment:         ${first.garment ?? "—"}`);
  L.push(`Colour:          ${first.colorName ?? "—"} (${first.colorHex ?? "—"})`);
  L.push(`Size:            ${first.size ?? "—"}`);
  L.push(`Quantity:        ${first.quantity ?? 1}`);
  L.push(`Written:         ${nowIso}`);
  L.push("");
  entries.forEach((e, i) => {
    const j = e.job;
    L.push(`PRINT ${i + 1} of ${entries.length} — ${j.sideLabel} · ${j.zoneLabel}`);
    L.push("-".repeat(60));
    if (entries.some((x) => x.job.garment !== j.garment || x.job.size !== j.size || x.job.colorName !== j.colorName)) {
      L.push(`Garment:         ${j.garment} · ${j.colorName} (${j.colorHex}) · size ${j.size} · qty ${j.quantity}`);
    }
    L.push(`File:            ${e.local?.file ? path.basename(e.local.file) : sanitizeFilename(j.suggestedFilename)}`);
    L.push(`Artwork size:    ${cm(j.artworkWidthCm, j.artworkHeightCm)}`);
    if (j.file) {
      L.push(`Pixels / DPI:    ${j.file.widthPx} × ${j.file.heightPx} px at ${j.file.dpi} DPI (${formatBytes(j.file.bytes)})`);
      if (j.file.minSourceDpi != null) L.push(`Lowest source:   ${Math.round(j.file.minSourceDpi)} DPI effective`);
      if (j.file.upsampled) {
        L.push("WARNING:         Some artwork was UPSAMPLED to reach print DPI. Check edges and");
        L.push("                 fine detail at 100% before printing.");
      }
    }
    L.push(`Placement:       ${j.sideLabel}, ${j.zoneLabel}`);
    L.push(`Press position:  ${pressLine(j)}`);
    L.push(`Website status:  ${j.statusLabel ?? j.status}`);
    L.push("");
  });
  const notes = String(first.productionNotes ?? "").trim();
  const customerNote = String(first.customerNote ?? "").trim();
  L.push("PRODUCTION NOTES");
  L.push("-".repeat(60));
  L.push(notes || "(none)");
  if (customerNote) {
    L.push("");
    L.push("CUSTOMER NOTE");
    L.push("-".repeat(60));
    L.push(customerNote);
  }
  L.push("");
  L.push("BEFORE YOU PRINT — ColorboxRIP owns these. The file does NONE of them:");
  L.push("-".repeat(60));
  for (const r of ripOwns.length ? ripOwns : DEFAULT_RIP_OWNS) L.push(`[ ] ${r}`);
  L.push("");
  L.push("Verify the profile, white, mirror and ink limits in ColorboxRIP before");
  L.push("printing. The PNG is artwork only: sRGB, transparent background, exact size.");
  L.push("Nothing here prints by itself.");
  return L.join("\r\n") + "\r\n";
}

/**
 * job.json for one order folder: the website's metadata for every job plus
 * where the station put each file.
 */
export function orderJson(entries, printer, nowIso) {
  const first = entries[0]?.job ?? {};
  return {
    writtenAt: nowIso,
    orderId: first.orderId,
    orderNumber: first.orderNumber,
    printer: printer ?? null,
    jobs: entries.map((e) => ({
      ...e.job,
      stationStatus: e.status,
      savedAs: e.local?.file ?? null,
      sha256: e.local?.sha256 ?? null,
      downloadedAt: e.local?.downloadedAt ?? null,
    })),
  };
}

/** True when the bytes start with the PNG signature. */
export function isPng(buf) {
  return (
    buf &&
    buf.length > 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  );
}

/**
 * Parse a Cookie header.
 * @param {string | undefined} header
 * @returns {Record<string, string>}
 */
export function parseCookies(header) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const part of String(header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i < 1) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    try {
      out[k] = decodeURIComponent(v);
    } catch {
      out[k] = v;
    }
  }
  return out;
}

/**
 * Only answer requests addressed to this machine by loopback name — stops a
 * web page on another site from reaching the station through DNS rebinding.
 * @param {string | undefined} host
 * @param {number} port
 */
export function isLoopbackHost(host, port) {
  const h = String(host ?? "").toLowerCase();
  return h === `127.0.0.1:${port}` || h === `localhost:${port}` || h === `[::1]:${port}`;
}
