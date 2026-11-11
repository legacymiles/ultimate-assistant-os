// ---------------------------------------------------------------------------
// Build jobs: the builds that must outlive the tab that asked for them.
//
// A harness thread lives in this process, which is right for a chat and wrong
// for a build. A build is hours of work; the bridge restarts when it installs
// its own packages, when Windows wakes it, and when the owner closes the lid.
// Every one of those used to take the thread with it, and the page was left
// saying "starting the build" against a thread that no longer existed.
//
// So a durable build is written down here, in out/build-jobs.json, before the
// agent is told anything. The record has what is needed to start the same job
// again — the brief, the worktree, and the id the page and the server already
// know — and the recent transcript, so a resumed page still shows what
// happened rather than an empty log.
//
// The rule this file exists to keep: only the owner stops a build. A closed
// tab, a sleeping laptop and a bridge restart are not the owner.
// ---------------------------------------------------------------------------

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Where the record lives. Next to the bridge, under the folder it owns. */
export const DEFAULT_JOBS_FILE = path.join(HERE, "out", "build-jobs.json");

/**
 * How much of a build is kept.
 *
 * Enough for the page's feed (it draws the last eighty items) and enough to
 * show what happened if the page is opened fresh after a restart. Not the
 * whole transcript: a two-hour build writes tens of thousands of deltas.
 */
const MAX_EVENTS = 500;

/** Text is capped so one long assistant message cannot bloat the file. */
const MAX_TEXT = 8_000;

/**
 * The lines a build is told to finish on.
 *
 * `Preview:` and `PR:` are a client edit; `Repo:` and `Live:` are a brand-new
 * app. Seeing either pair means the agent reached its own finish, so there is
 * nothing left for a restart to resume.
 */
export const FINISH_LINE = /^\s*(?:Preview|Live|Repo|PR):\s*(?:https?:\/\/\S+|none)\s*$/im;

/** A stopped build is never resumed, however it stopped. */
const LIVE = new Set(["running"]);

/**
 * A limit is a pause, not a death.
 *
 * Claude Code says "You've hit your session limit · resets 12:20am". Treating
 * that as a failed build threw away hours of work at exactly the moment the
 * work could simply wait. The job stays live, and the harness schedules the
 * continue for after the reset.
 */
const RETRYABLE = /session limit|rate.?limit|usage limit|quota|too many requests|resets?\s+\d{1,2}:\d{2}/i;

/**
 * How long to wait before asking again, from the limit message itself.
 *
 * The bridge runs on the owner's PC in the owner's timezone, so an unqualified
 * "12:20am" is the local clock. Minutes are added as a buffer; an unparseable
 * limit waits half an hour rather than hammering a door that is closed.
 */
export function retryDelay(text, nowMs = Date.now()) {
  const m = /resets?\s+(\d{1,2}):(\d{2})\s*(am|pm)/i.exec(String(text || ""));
  if (!m) return 30 * 60_000;
  const hour = (Number(m[1]) % 12) + (m[3].toLowerCase() === "pm" ? 12 : 0);
  const at = new Date(nowMs);
  at.setHours(hour, Number(m[2]), 0, 0);
  let ms = at.getTime() - nowMs + 60_000;
  if (ms <= 0) ms += 24 * 60 * 60_000;
  return Math.min(Math.max(ms, 60_000), 6 * 60 * 60_000);
}

const SAVE_SOON_MS = 1_200;

function readFile(file) {
  try {
    // A file edited on Windows can carry a BOM; JSON.parse refuses it and the
    // silent fallback would forget every live build on the next boot.
    const raw = JSON.parse(readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
    if (!raw || !Array.isArray(raw.jobs)) return [];
    return raw.jobs.filter((j) => j && typeof j.id === "string" && j.id);
  } catch {
    // A missing file is the normal first run. A corrupt one is not worth
    // crashing the bridge over: the threads it described are gone anyway.
    return [];
  }
}

function compact(event) {
  if (!event || typeof event !== "object") return null;
  const kind = String(event.kind ?? "");
  if (!kind || kind === "thinking") return null;
  const row = { seq: Number(event.seq) || 0, at: Number(event.at) || Date.now(), kind };
  switch (kind) {
    case "text":
    case "user":
    case "note":
      row.text = String(event.text ?? "").slice(0, MAX_TEXT);
      break;
    case "error":
      row.message = String(event.message ?? event.text ?? "").slice(0, MAX_TEXT);
      break;
    case "tool":
      row.callId = event.callId;
      row.name = event.name;
      row.title = event.title;
      row.kindOf = event.kindOf;
      row.path = event.path;
      row.command = String(event.command ?? "").slice(0, MAX_TEXT);
      break;
    case "tool_end":
      row.callId = event.callId;
      row.ok = Boolean(event.ok);
      // The output is useful on screen but can be megabytes; a short tail is
      // enough to explain a failure after a resume.
      row.output = String(event.output ?? "").slice(-1_200);
      break;
    case "turn_end":
      row.ms = Number(event.ms) || 0;
      row.usd = Number(event.usd) || 0;
      row.error = String(event.error ?? "").slice(0, MAX_TEXT);
      break;
    case "status":
      row.status = event.status;
      row.detail = event.detail;
      row.model = event.model;
      row.sessionId = event.sessionId;
      break;
    case "gate":
    case "gate_done":
      Object.assign(row, event);
      break;
    default:
      Object.assign(row, event);
  }
  return row;
}

/**
 * A store for durable build jobs.
 *
 * A factory, not a module-level singleton alone, so tests can point it at a
 * temp file without touching the real jobs on this PC. `buildJobs` below is
 * the one the bridge uses.
 */
export function createJobStore({ file = DEFAULT_JOBS_FILE, now = Date.now } = {}) {
  let jobs = readFile(file);
  let timer = null;
  let dirty = false;

  const write = () => {
    try {
      mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify({ version: 1, jobs }, null, 2), "utf8");
      renameSync(tmp, file);
      dirty = false;
    } catch {
      // The build is still running; a failed disk write must not kill it. The
      // next save tries again, and a bridge restart is the worst case.
    }
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const soon = () => {
    dirty = true;
    if (timer) return;
    timer = setTimeout(write, SAVE_SOON_MS);
    // Never hold the process open for a save that can happen at the next one.
    timer.unref?.();
  };

  const find = (id) => jobs.find((j) => j.id === String(id ?? "")) ?? null;

  return {
    file,

    /** Reload from disk. Only used at startup; the bridge owns the file. */
    reload() {
      jobs = readFile(file);
      return jobs;
    },

    list() {
      return jobs.map((j) => ({ ...j }));
    },

    get(id) {
      const j = find(id);
      return j ? { ...j } : null;
    },

    /** Just the wake-up time, without copying the transcript on every poll. */
    retryAt(id) {
      return find(id)?.retryAt || "";
    },

    /** Write a job down before anything is started from it. */
    begin(job) {
      const existing = find(job.id);
      const next = {
        id: String(job.id),
        kind: job.kind || "build",
        title: String(job.title || "Build"),
        brief: String(job.brief || ""),
        // Not "running" until the caller has actually handed over the brief.
        // A client edit stands on main first, and resuming before that would
        // start it on whatever branch happened to be checked out.
        status: "starting",
        why: "",
        createdAt: job.createdAt ?? now(),
        updatedAt: now(),
        resumes: 0,
        seq: 0,
        events: [],
        worktree: job.worktree || null,
        args: job.args || {},
        sessionId: "",
        lastTurnEnded: false,
        turnText: "",
        lastError: "",
        // The bridge checks this build itself before it is called built. Null
        // means the old rule: finished when it prints its finish lines.
        verify: job.verify ? { state: "idle", run: 0, rounds: 0, failures: [], lastIds: [], report: "", why: "" } : null,
        claimed: false,
        claimedText: "",
        ...(existing || {}),
      };
      if (existing) Object.assign(existing, next);
      else jobs.push(next);
      write();
      return { ...next };
    },

    /**
     * Change a field that matters across a restart. These are written at once:
     * losing the fact that a build was stopped would resume it on the next
     * boot, which is worse than a slow disk write.
     */
    update(id, patch) {
      const j = find(id);
      if (!j) return null;
      Object.assign(j, patch, { updatedAt: now() });
      write();
      return { ...j };
    },

    /**
     * Record one event, and decide from it whether the build still needs
     * resuming. Returns the updated job, or null when this thread has no job.
     */
    appendEvent(id, event) {
      const j = find(id);
      if (!j) return null;
      const row = compact(event);
      if (!row) return { ...j };
      j.events.push(row);
      if (j.events.length > MAX_EVENTS) j.events.splice(0, j.events.length - MAX_EVENTS);
      j.seq = Math.max(j.seq || 0, row.seq || 0);
      j.updatedAt = now();

      if (row.kind === "user") {
        j.turnText = "";
        j.lastError = "";
        j.lastTurnEnded = false;
        j.claimed = false;
      } else if (row.kind === "text") {
        j.turnText = `${j.turnText || ""}${row.text || ""}`.slice(-40_000);
      } else if (row.kind === "error") {
        j.lastError = row.message || "The build stopped on an error.";
      } else if (row.kind === "turn_end") {
        j.lastTurnEnded = true;
        const why = row.error || j.lastError || "";
        if (why) {
          // A closed door with a reset time is a pause; anything else is a
          // build that genuinely failed.
          j.retry = RETRYABLE.test(why);
          j.status = j.retry ? "running" : "failed";
          j.why = why;
        } else if (FINISH_LINE.test(j.turnText || "")) {
          if (j.verify) {
            // It SAYS it is finished. harness.mjs sees this and runs the gate;
            // only a pass (or the owner) makes it done.
            j.claimed = true;
            j.claimedText = String(j.turnText || "").slice(-4_000);
          } else {
            j.status = "done";
            j.why = "It printed what it finished with.";
          }
        }
        j.turnText = "";
      } else if (row.kind === "status" && row.sessionId) {
        j.sessionId = row.sessionId;
      }
      soon();
      return { ...j };
    },

    /** Explicit owner stop. It is never undone by a later restart. */
    mark(id, status, why = "") {
      return this.update(id, { status, why });
    },

    /**
     * The brief has been handed over. Until this, a start is only a folder
     * that exists; there is nothing worth resuming yet.
     */
    arm(id) {
      const j = find(id);
      if (!j || j.status !== "starting") return j ? { ...j } : null;
      return this.update(id, { status: "running" });
    },

    remove(id) {
      const i = jobs.findIndex((j) => j.id === String(id ?? ""));
      if (i < 0) return false;
      jobs.splice(i, 1);
      write();
      return true;
    },

    /** Jobs a new bridge process should pick back up. */
    resumable() {
      const nowMs = now();
      return jobs
        .filter((j) => {
          if (!LIVE.has(j.status) || (j.resumes || 0) >= 5 || !j.brief) return false;
          // A build that has not reported in for a day is not going to finish
          // because a laptop booted; resuming it would resurrect old work.
          const at = Number(j.updatedAt || j.createdAt || 0);
          return !at || nowMs - at < 24 * 60 * 60 * 1000;
        })
        .map((j) => ({ ...j }));
    },

    flush() {
      if (dirty || timer) write();
    },
  };
}

/** The bridge's one store. Loaded on import, so a restart sees the file. */
export const buildJobs = createJobStore();

/**
 * What a resumed build is told.
 *
 * The brief is repeated because this may be a fresh model session — the SDK
 * child died with the bridge, and its context went with it. The folder did
 * not: it still holds every change the previous run made, and the one thing
 * this message must prevent is doing that work over again.
 */
export function resumePrompt(job) {
  const brief = String(job?.brief || "").trim();
  const wasMidTurn = !job?.lastTurnEnded;
  return [
    "<resuming>",
    wasMidTurn
      ? "The PC's Jarvis helper restarted while you were in the middle of this job. You are the same build, continued — not a new one."
      : "Your last turn ended before the job was reported finished. You are the same build, continued — not a new one.",
    "The folder below still contains every change made so far. BEFORE you change anything, run `git status` and `git diff --stat`, read the files you already touched, and work out what is done.",
    "Do not undo good work and do not start over. Finish the job.",
    "If a permission card was waiting when the helper restarted, it is gone; ask for what you need again.",
    "</resuming>",
    "",
    "<the_job>",
    brief,
    "</the_job>",
    "",
    "When it is finished, end your last message with the same final lines the job asks for.",
  ].join("\n");
}
