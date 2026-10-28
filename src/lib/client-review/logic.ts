// ---------------------------------------------------------------------------
// Client Review — the rules, as pure functions.
//
// Everything that decides what may happen lives here, with no I/O, so the two
// routes (the owner's and the client's) cannot drift apart and the whole flow
// is testable without a database: draft → sent → approved → next version.
//
// Every mutation takes a project and returns a changed copy, or throws a
// ReviewError whose message is fit to show a person.
// ---------------------------------------------------------------------------

import type {
  AdminEvent,
  ClientNotice,
  ClientProject,
  ContentLane,
  EditRequest,
  PortalView,
  RequestBatch,
  RequestPin,
  ReviewIndex,
  ReviewVersion,
} from "./types";

export class ReviewError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

/** Longest single request a client can send. A request, not an essay. */
export const MAX_REQUEST_CHARS = 2000;
/** Unsent drafts per version before the client is asked to send some. */
export const MAX_DRAFTS = 40;
/** Notices / events kept before the oldest are dropped. */
const KEEP_NOTICES = 50;
const KEEP_EVENTS = 200;

export function rid(prefix = ""): string {
  const bytes = new Uint8Array(9);
  crypto.getRandomValues(bytes);
  return prefix + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** The link's secret: long enough that guessing one is not a plan. */
export function newToken(): string {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(36).padStart(2, "0"))
    .join("")
    .slice(0, 28);
}

export function isToken(v: unknown): v is string {
  return typeof v === "string" && /^[a-z0-9]{16,40}$/.test(v);
}

function clone<T>(v: T): T {
  return structuredClone(v);
}

function touch(p: ClientProject, now: string): ClientProject {
  p.updatedAt = now;
  return p;
}

function clean(text: unknown, max: number, what: string): string {
  const s = typeof text === "string" ? text.replace(/\r\n/g, "\n").trim() : "";
  if (!s) throw new ReviewError(`Write ${what} first.`);
  if (s.length > max) throw new ReviewError(`That ${what} is too long — keep it under ${max} characters.`);
  return s;
}

/** An http(s) URL, or "" — anything else is refused rather than framed. */
export function cleanUrl(raw: unknown): string {
  const s = typeof raw === "string" ? raw.trim() : "";
  if (!s) return "";
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
  } catch {
    throw new ReviewError("That doesn't look like a website address.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new ReviewError("Only http and https website addresses can be shown.");
  }
  return url.toString();
}

function cleanPin(raw: unknown): RequestPin | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Partial<RequestPin>;
  const x = Number(r.x);
  const y = Number(r.y);
  const viewport = Number(r.viewport);
  if (![x, y].every((n) => Number.isFinite(n) && n >= 0 && n <= 1)) return undefined;
  return {
    x: Math.round(x * 1000) / 1000,
    y: Math.round(y * 1000) / 1000,
    viewport: Number.isFinite(viewport) && viewport > 0 ? Math.round(viewport) : 0,
  };
}

/**
 * The client's GitHub repo as "owner/name". Takes what people paste — the
 * repo page, the clone URL, "owner/name" — and refuses anything else, because
 * Claude Code clones and pushes to exactly this string.
 */
export function cleanRepo(raw: unknown): string | undefined {
  const s = typeof raw === "string" ? raw.trim() : "";
  if (!s) return undefined;
  const m =
    /^(?:https?:\/\/)?(?:www\.)?github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?(?:[?#].*)?$/i.exec(s) ??
    /^git@github\.com:([\w.-]+)\/([\w.-]+?)(?:\.git)?$/i.exec(s) ??
    /^([\w.-]+)\/([\w.-]+?)(?:\.git)?$/.exec(s);
  if (!m || m[1].startsWith(".") || m[2].startsWith(".")) {
    throw new ReviewError("Add the repo as owner/name — for example legacymiles/glow-spa-site — or paste its GitHub link.");
  }
  return `${m[1]}/${m[2]}`;
}

/** The Vercel project's name (or its dashboard link, which ends in it). */
export function cleanVercelProject(raw: unknown): string | undefined {
  const s = typeof raw === "string" ? raw.trim() : "";
  if (!s) return undefined;
  const fromUrl = /vercel\.com\/[\w.-]+\/([\w.-]+)/i.exec(s)?.[1];
  const name = (fromUrl ?? s).toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{0,99}$/.test(name)) {
    throw new ReviewError("Add the Vercel project's name — the one in its dashboard link (vercel.com/<team>/<project>).");
  }
  return name;
}

/** A branch name a git host will take: "jarvis/glow-spa-v3". */
export function branchFor(p: Pick<ClientProject, "name">, versionNumber: string): string {
  const slug =
    p.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "site";
  return `jarvis/${slug}-${versionNumber.toLowerCase().replace(/[^a-z0-9.]+/g, "")}`;
}

export function cleanLane(raw: unknown): ContentLane {
  return raw === "standard" || raw === "uncensored" ? raw : "auto";
}

// ----- versions --------------------------------------------------------------

/** "v1" → 1. Anything unparseable counts as 0 so it never wins "newest". */
export function versionOrdinal(n: string): number {
  const m = /(\d+)(?:\.(\d+))?/.exec(n);
  if (!m) return 0;
  return Number(m[1]) + (m[2] ? Number(m[2]) / 1000 : 0);
}

export function nextVersionNumber(versions: ReviewVersion[]): string {
  const top = versions.reduce((max, v) => Math.max(max, Math.floor(versionOrdinal(v.number))), 0);
  return `v${top + 1}`;
}

export function sortVersions(versions: ReviewVersion[]): ReviewVersion[] {
  return [...versions].sort(
    (a, b) => versionOrdinal(a.number) - versionOrdinal(b.number) || a.createdAt.localeCompare(b.createdAt),
  );
}

/** The version the client looks at: the newest one that has a site to show. */
export function currentVersion(p: ClientProject): ReviewVersion | null {
  const live = sortVersions(p.versions).filter((v) => v.siteUrl && v.status !== "building");
  return live[live.length - 1] ?? null;
}

export function buildingVersion(p: ClientProject): ReviewVersion | null {
  const b = sortVersions(p.versions).filter((v) => v.status === "building");
  return b[b.length - 1] ?? null;
}

// ----- creating ----------------------------------------------------------------

export interface NewProjectInput {
  name: unknown;
  clientName?: unknown;
  siteUrl?: unknown;
  summary?: unknown;
  lane?: unknown;
  timelineProjectId?: unknown;
  inviteEmail?: unknown;
  repo?: unknown;
  vercelProject?: unknown;
}

export function createProject(input: NewProjectInput, now = new Date().toISOString()): ClientProject {
  const name = clean(input.name, 120, "project name");
  const clientName = typeof input.clientName === "string" ? input.clientName.trim().slice(0, 120) : "";
  const siteUrl = cleanUrl(input.siteUrl);
  const v1: ReviewVersion = {
    id: rid("ver_"),
    number: "v1",
    siteUrl,
    summary: typeof input.summary === "string" ? input.summary.trim().slice(0, 4000) : "",
    status: "review",
    createdAt: now,
    readyAt: siteUrl ? now : undefined,
  };
  return {
    id: rid("crp_"),
    token: newToken(),
    name,
    clientName,
    timelineProjectId:
      typeof input.timelineProjectId === "string" && input.timelineProjectId ? input.timelineProjectId : undefined,
    lane: cleanLane(input.lane),
    inviteEmail: cleanEmail(input.inviteEmail),
    repo: cleanRepo(input.repo),
    vercelProject: cleanVercelProject(input.vercelProject),
    versions: [v1],
    requests: [],
    batches: [],
    settings: { notify: false },
    pushSubs: [],
    notices: [],
    createdAt: now,
    updatedAt: now,
  };
}

// ----- the client's side ---------------------------------------------------------

/** Can the client add to this version right now? */
function writableVersion(p: ClientProject, versionId: unknown): ReviewVersion {
  const v = p.versions.find((x) => x.id === versionId);
  if (!v) throw new ReviewError("That version no longer exists — refresh the page.", 404);
  if (v.status !== "review") {
    throw new ReviewError("This version is closed — Jarvis is already working on the next one.", 409);
  }
  return v;
}

export function addRequest(
  src: ClientProject,
  input: { versionId: unknown; text: unknown; pin?: unknown },
  now = new Date().toISOString(),
): { project: ClientProject; request: EditRequest } {
  const p = clone(src);
  const v = writableVersion(p, input.versionId);
  const drafts = p.requests.filter((r) => r.versionId === v.id && r.status === "draft").length;
  if (drafts >= MAX_DRAFTS) throw new ReviewError(`That's ${MAX_DRAFTS} unsent requests — send these to Jarvis first.`);
  const request: EditRequest = {
    id: rid("req_"),
    versionId: v.id,
    text: clean(input.text, MAX_REQUEST_CHARS, "request"),
    pin: cleanPin(input.pin),
    status: "draft",
    createdAt: now,
  };
  p.requests.push(request);
  return { project: touch(p, now), request };
}

function ownDraft(p: ClientProject, id: unknown): EditRequest {
  const r = p.requests.find((x) => x.id === id);
  if (!r) throw new ReviewError("That request no longer exists.", 404);
  if (r.status !== "draft") throw new ReviewError("That request has already gone to Jarvis, so it can't be changed here.", 409);
  return r;
}

export function editDraft(
  src: ClientProject,
  input: { id: unknown; text: unknown; pin?: unknown },
  now = new Date().toISOString(),
): ClientProject {
  const p = clone(src);
  const r = ownDraft(p, input.id);
  r.text = clean(input.text, MAX_REQUEST_CHARS, "request");
  if (input.pin !== undefined) r.pin = cleanPin(input.pin);
  return touch(p, now);
}

export function deleteDraft(src: ClientProject, id: unknown, now = new Date().toISOString()): ClientProject {
  const p = clone(src);
  const r = ownDraft(p, id);
  p.requests = p.requests.filter((x) => x.id !== r.id);
  return touch(p, now);
}

/** "Send to Jarvis": every draft on this version goes to the owner as one batch. */
export function sendToJarvis(
  src: ClientProject,
  versionId: unknown,
  now = new Date().toISOString(),
): { project: ClientProject; batch: RequestBatch } {
  const p = clone(src);
  const v = writableVersion(p, versionId);
  const drafts = p.requests.filter((r) => r.versionId === v.id && r.status === "draft");
  if (!drafts.length) throw new ReviewError("Add at least one edit request before sending.");
  const batch: RequestBatch = {
    id: rid("bat_"),
    versionId: v.id,
    requestIds: drafts.map((r) => r.id),
    sentAt: now,
    status: "pending",
  };
  for (const r of drafts) {
    r.status = "sent";
    r.sentAt = now;
    r.batchId = batch.id;
  }
  p.batches.push(batch);
  return { project: touch(p, now), batch };
}

export function setNotify(src: ClientProject, notify: boolean, now = new Date().toISOString()): ClientProject {
  const p = clone(src);
  p.settings = { ...p.settings, notify };
  if (!notify) p.pushSubs = [];
  return touch(p, now);
}

export function addPushSub(src: ClientProject, raw: unknown, now = new Date().toISOString()): ClientProject {
  const s = raw as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } } | null;
  if (
    !s ||
    typeof s.endpoint !== "string" ||
    !/^https:\/\//.test(s.endpoint) ||
    typeof s.keys?.p256dh !== "string" ||
    typeof s.keys?.auth !== "string"
  ) {
    throw new ReviewError("This browser sent a notification subscription that couldn't be read.");
  }
  const p = clone(src);
  p.pushSubs = [
    ...p.pushSubs.filter((x) => x.endpoint !== s.endpoint),
    { endpoint: s.endpoint, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth }, addedAt: now },
  ].slice(-5);
  p.settings = { ...p.settings, notify: true };
  return touch(p, now);
}

export function dropPushSubs(src: ClientProject, endpoints: string[]): ClientProject {
  if (!endpoints.length) return src;
  const p = clone(src);
  const gone = new Set(endpoints);
  p.pushSubs = p.pushSubs.filter((s) => !gone.has(s.endpoint));
  return p;
}

export function markNoticesRead(src: ClientProject, now = new Date().toISOString()): ClientProject {
  if (!src.notices.some((n) => !n.read)) return src;
  const p = clone(src);
  p.notices = p.notices.map((n) => ({ ...n, read: true }));
  return touch(p, now);
}

export function pushNotice(p: ClientProject, title: string, body: string, now: string): ClientNotice {
  const notice: ClientNotice = { id: rid("ntc_"), at: now, title, body, read: false };
  p.notices = [...p.notices, notice].slice(-KEEP_NOTICES);
  return notice;
}

// ----- the owner's side --------------------------------------------------------------

export function updateProjectMeta(
  src: ClientProject,
  patch: {
    name?: unknown;
    clientName?: unknown;
    lane?: unknown;
    timelineProjectId?: unknown;
    archived?: unknown;
    inviteEmail?: unknown;
    repo?: unknown;
    vercelProject?: unknown;
  },
  now = new Date().toISOString(),
): ClientProject {
  const p = clone(src);
  if (patch.name !== undefined) p.name = clean(patch.name, 120, "project name");
  if (patch.clientName !== undefined) p.clientName = String(patch.clientName ?? "").trim().slice(0, 120);
  if (patch.lane !== undefined) p.lane = cleanLane(patch.lane);
  if (patch.timelineProjectId !== undefined) {
    p.timelineProjectId =
      typeof patch.timelineProjectId === "string" && patch.timelineProjectId ? patch.timelineProjectId : undefined;
  }
  if (patch.archived !== undefined) p.archived = patch.archived === true;
  if (patch.inviteEmail !== undefined) p.inviteEmail = cleanEmail(patch.inviteEmail);
  if (patch.repo !== undefined) p.repo = cleanRepo(patch.repo);
  if (patch.vercelProject !== undefined) p.vercelProject = cleanVercelProject(patch.vercelProject);
  return touch(p, now);
}

// ----- who may open the link ------------------------------------------------------

export function cleanEmail(raw: unknown): string | undefined {
  const s = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (!s) return undefined;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) throw new ReviewError("That doesn't look like an email address.");
  return s;
}

export interface Viewer {
  id: string;
  email: string;
  owner: boolean;
}

/**
 * May this signed-in person open this project? The owner always may. A client
 * claims an unclaimed link the first time they open it (when the owner named
 * an email, only that email can); after that only they may.
 *
 * Returns the project unchanged, or a claimed copy that the caller must save.
 */
export function admit(src: ClientProject, viewer: Viewer, now = new Date().toISOString()): { project: ClientProject; claimed: boolean } {
  if (viewer.owner) return { project: src, claimed: false };
  const email = viewer.email.trim().toLowerCase();
  if (src.clientUserId) {
    if (src.clientUserId === viewer.id) return { project: src, claimed: false };
    throw new ReviewError(
      "This website belongs to another account. Sign in with the account you used before, or ask for a new link.",
      403,
    );
  }
  if (src.inviteEmail && src.inviteEmail !== email) {
    throw new ReviewError(`This link is for ${maskEmail(src.inviteEmail)}. Sign in with that account.`, 403);
  }
  const p = clone(src);
  p.clientUserId = viewer.id;
  p.clientUserEmail = email;
  p.claimedAt = now;
  return { project: touch(p, now), claimed: true };
}

/** "dana@glowspa.com" → "d***@glowspa.com": enough to recognise, not to harvest. */
export function maskEmail(email: string): string {
  const [user, domain] = email.split("@");
  return `${user.slice(0, 1)}***@${domain ?? ""}`;
}

/** The owner frees a link so a different account can claim it. */
export function releaseClaim(src: ClientProject, now = new Date().toISOString()): ClientProject {
  const p = clone(src);
  p.clientUserId = undefined;
  p.clientUserEmail = undefined;
  p.claimedAt = undefined;
  p.pushSubs = [];
  return touch(p, now);
}

export function rotateToken(src: ClientProject, now = new Date().toISOString()): ClientProject {
  const p = clone(src);
  p.token = newToken();
  return touch(p, now);
}

/** The owner rewords, rejects, or re-approves one request inside a pending batch. */
export function reviewRequest(
  src: ClientProject,
  input: { id: unknown; status?: unknown; adminText?: unknown; adminNote?: unknown },
  now = new Date().toISOString(),
): ClientProject {
  const p = clone(src);
  const r = p.requests.find((x) => x.id === input.id);
  if (!r) throw new ReviewError("That request no longer exists.", 404);
  if (r.status === "draft") throw new ReviewError("The client hasn't sent that one yet.", 409);
  if (input.status === "approved" || input.status === "rejected" || input.status === "sent") r.status = input.status;
  if (input.adminText !== undefined) {
    const t = typeof input.adminText === "string" ? input.adminText.trim().slice(0, MAX_REQUEST_CHARS) : "";
    r.adminText = t && t !== r.text ? t : undefined;
  }
  if (input.adminNote !== undefined) {
    const n = typeof input.adminNote === "string" ? input.adminNote.trim().slice(0, 600) : "";
    r.adminNote = n || undefined;
  }
  return touch(p, now);
}

export function setBrief(
  src: ClientProject,
  input: { batchId: unknown; brief: unknown; model?: string; lane?: "standard" | "uncensored" },
  now = new Date().toISOString(),
): ClientProject {
  const p = clone(src);
  const b = p.batches.find((x) => x.id === input.batchId);
  if (!b) throw new ReviewError("That batch no longer exists.", 404);
  b.brief = typeof input.brief === "string" ? input.brief.trim().slice(0, 20_000) : "";
  if (input.model !== undefined) b.briefModel = input.model;
  if (input.lane !== undefined) b.briefLane = input.lane;
  return touch(p, now);
}

/** The text that gets built for a request: the owner's rewording when there is one. */
export function buildText(r: EditRequest): string {
  return r.adminText || r.text;
}

/** A plain brief, for when no AI is configured or the owner wants to start from scratch. */
export function plainBrief(p: ClientProject, batch: RequestBatch): string {
  const from = p.versions.find((v) => v.id === batch.versionId);
  const reqs = batch.requestIds
    .map((id) => p.requests.find((r) => r.id === id))
    .filter((r): r is EditRequest => !!r && r.status !== "rejected");
  const lines = reqs.map((r, i) => {
    const where = r.pin ? ` (pinned at ${Math.round(r.pin.x * 100)}% across, ${Math.round(r.pin.y * 100)}% down)` : "";
    return `${i + 1}. ${buildText(r)}${where}`;
  });
  return [
    `Edits for ${p.name}${from ? ` — from ${from.number}` : ""}`,
    from?.siteUrl ? `Current site: ${from.siteUrl}` : "",
    "",
    ...lines,
  ]
    .filter((l, i) => l || i === 2)
    .join("\n");
}

/**
 * Approve a batch: the version it was sent against closes, the next one opens
 * as "building", and the approved requests move onto it as the work list.
 *
 * Every other pending batch on the same version is approved with it, because
 * once the version closes there is nothing left for them to be sent against.
 */
export function approveBatch(
  src: ClientProject,
  input: { batchId: unknown; brief?: unknown; summary?: unknown },
  now = new Date().toISOString(),
): { project: ClientProject; version: ReviewVersion; approved: EditRequest[] } {
  const p = clone(src);
  const b = p.batches.find((x) => x.id === input.batchId);
  if (!b) throw new ReviewError("That batch no longer exists.", 404);
  if (b.status !== "pending") throw new ReviewError("That batch has already been decided.", 409);
  const from = p.versions.find((v) => v.id === b.versionId);
  if (!from) throw new ReviewError("The version those edits were for no longer exists.", 404);

  const together = p.batches.filter((x) => x.versionId === b.versionId && x.status === "pending");
  const ids = new Set(together.flatMap((x) => x.requestIds));
  const approved: EditRequest[] = [];
  for (const r of p.requests) {
    if (!ids.has(r.id)) continue;
    if (r.status === "sent") r.status = "approved";
    if (r.status === "approved") approved.push(r);
  }
  if (!approved.length) throw new ReviewError("Every request in this batch is rejected — reject the batch instead.");

  if (typeof input.brief === "string") b.brief = input.brief.trim().slice(0, 20_000);
  const brief = b.brief || plainBrief(p, b);

  // An older "building" version that never shipped is folded into this one.
  for (const v of p.versions) if (v.status === "building") v.status = "superseded";

  const version: ReviewVersion = {
    id: rid("ver_"),
    number: nextVersionNumber(p.versions),
    siteUrl: "",
    summary:
      typeof input.summary === "string" && input.summary.trim()
        ? input.summary.trim().slice(0, 4000)
        : approved.map((r) => `• ${buildText(r)}`).join("\n"),
    status: "building",
    createdAt: now,
  };
  p.versions.push(version);
  // The version that was being reviewed stays the one on the client's screen
  // until the new one is ready, but nothing more can be added to it.
  from.status = "superseded";

  for (const x of together) {
    x.status = "approved";
    x.decidedAt = now;
    x.nextVersionId = version.id;
  }
  b.brief = brief;

  pushNotice(
    p,
    `Jarvis is building ${version.number}`,
    `${approved.length} of your edit request${approved.length === 1 ? " was" : "s were"} approved. We'll let you know when ${version.number} is ready.`,
    now,
  );
  return { project: touch(p, now), version, approved };
}

export function rejectBatch(
  src: ClientProject,
  input: { batchId: unknown; note?: unknown },
  now = new Date().toISOString(),
): ClientProject {
  const p = clone(src);
  const b = p.batches.find((x) => x.id === input.batchId);
  if (!b) throw new ReviewError("That batch no longer exists.", 404);
  if (b.status !== "pending") throw new ReviewError("That batch has already been decided.", 409);
  b.status = "rejected";
  b.decidedAt = now;
  const note = typeof input.note === "string" ? input.note.trim().slice(0, 600) : "";
  for (const r of p.requests) {
    if (!b.requestIds.includes(r.id)) continue;
    r.status = "rejected";
    if (note && !r.adminNote) r.adminNote = note;
  }
  pushNotice(p, "An update on your edit requests", note || "These requests won't be made as written — check the notes on each one.", now);
  return touch(p, now);
}

/**
 * The owner posts a version's URL and marks it ready: it becomes what the
 * client sees, older versions are superseded, and the requests it carried are done.
 */
export function markVersionReady(
  src: ClientProject,
  input: { versionId: unknown; siteUrl: unknown; summary?: unknown },
  now = new Date().toISOString(),
): { project: ClientProject; version: ReviewVersion } {
  const p = clone(src);
  const v = p.versions.find((x) => x.id === input.versionId);
  if (!v) throw new ReviewError("That version no longer exists.", 404);
  const url = cleanUrl(input.siteUrl);
  if (!url) throw new ReviewError("Add the website address for this version first.");
  v.siteUrl = url;
  if (typeof input.summary === "string" && input.summary.trim()) v.summary = input.summary.trim().slice(0, 4000);
  v.status = "review";
  v.readyAt = now;
  v.shippedBy = v.shippedBy ?? "owner";
  for (const other of p.versions) if (other.id !== v.id && other.status === "review") other.status = "superseded";

  const shipped = new Set(p.batches.filter((b) => b.nextVersionId === v.id).flatMap((b) => b.requestIds));
  for (const r of p.requests) if (shipped.has(r.id) && r.status === "approved") r.status = "done";

  pushNotice(p, `${v.number} is ready`, `Your updated website is ready to review. Open your link to see ${v.number}.`, now);
  return { project: touch(p, now), version: v };
}

// ----- App Builder: approved edits built without the owner ------------------------

/** Record that an approved batch was handed to App Builder and queued. */
export function noteBuild(
  src: ClientProject,
  input: { batchId: unknown; builderId: unknown; queueId?: unknown },
  now = new Date().toISOString(),
): ClientProject {
  const p = clone(src);
  const b = p.batches.find((x) => x.id === input.batchId);
  if (!b) throw new ReviewError("That batch no longer exists.", 404);
  if (b.status !== "approved" || !b.nextVersionId) throw new ReviewError("Approve the batch before building it.", 409);
  if (typeof input.builderId !== "string" || !input.builderId) throw new ReviewError("No App Builder project was given.");
  b.build = {
    builderId: input.builderId.slice(0, 80),
    queueId: typeof input.queueId === "string" && input.queueId ? input.queueId.slice(0, 80) : b.build?.queueId,
    at: now,
  };
  return touch(p, now);
}

/** The branch the next build starts from: the version on the client's screen, or main. */
export function baseBranchFor(p: ClientProject): string {
  return currentVersion(p)?.branch || "main";
}

/**
 * Claude Code finished an approved batch: post the preview it deployed as the
 * version being built, so the client is told and sees it on their link.
 *
 * Calling it twice with the same URL is harmless (a retried tool call); a
 * version that has already moved on is refused, so an old build can never
 * replace a newer one on the client's screen.
 */
export function shipPreview(
  src: ClientProject,
  input: { versionId: unknown; siteUrl: unknown; prUrl?: unknown; branch?: unknown; summary?: unknown },
  now = new Date().toISOString(),
): { project: ClientProject; version: ReviewVersion; already: boolean } {
  const v = src.versions.find((x) => x.id === input.versionId);
  if (!v) throw new ReviewError("No version with that id in this project — check version_id in the queue request.", 404);
  const url = cleanUrl(input.siteUrl);
  if (!url) throw new ReviewError("Give the preview's address (preview_url).");
  if (v.status !== "building") {
    if (v.siteUrl === url) return { project: src, version: v, already: true };
    throw new ReviewError(
      `${v.number} isn't being built any more (it's ${v.status === "review" ? "already on the client's screen" : "superseded by a newer version"}), so this preview was not posted.`,
      409,
    );
  }
  const prUrl = typeof input.prUrl === "string" && input.prUrl.trim() ? cleanUrl(input.prUrl) : undefined;
  const branch =
    typeof input.branch === "string" && /^[\w./-]{1,120}$/.test(input.branch.trim()) ? input.branch.trim() : undefined;
  const out = markVersionReady(src, { versionId: v.id, siteUrl: url, summary: input.summary }, now);
  const shipped = out.project.versions.find((x) => x.id === v.id)!;
  shipped.prUrl = prUrl ?? shipped.prUrl;
  shipped.branch = branch ?? shipped.branch;
  shipped.shippedBy = "claude-code";
  return { project: out.project, version: shipped, already: false };
}

/** Add a version by hand (the owner shipped something without a request batch). */
export function addVersion(
  src: ClientProject,
  input: { siteUrl?: unknown; summary?: unknown; ready?: boolean },
  now = new Date().toISOString(),
): { project: ClientProject; version: ReviewVersion } {
  const p = clone(src);
  for (const v of p.versions) if (v.status === "building") v.status = "superseded";
  const version: ReviewVersion = {
    id: rid("ver_"),
    number: nextVersionNumber(p.versions),
    siteUrl: "",
    summary: typeof input.summary === "string" ? input.summary.trim().slice(0, 4000) : "",
    status: "building",
    createdAt: now,
  };
  p.versions.push(version);
  const url = cleanUrl(input.siteUrl);
  if (url && input.ready !== false) return markVersionReady(p, { versionId: version.id, siteUrl: url }, now);
  version.siteUrl = url;
  return { project: touch(p, now), version };
}

// ----- projection ---------------------------------------------------------------------

/** Everything the client's browser gets. No token, no briefs, no models, no push keys. */
export function portalView(p: ClientProject, vapidPublicKey: string | null): PortalView {
  const current = currentVersion(p);
  const building = buildingVersion(p);
  return {
    name: p.name,
    clientName: p.clientName,
    versions: sortVersions(p.versions)
      .filter((v) => v.siteUrl || v.status === "building")
      .map((v) => ({
        id: v.id,
        number: v.number,
        siteUrl: v.siteUrl,
        summary: v.summary,
        status: v.status,
        createdAt: v.createdAt,
        readyAt: v.readyAt,
      })),
    currentVersionId: current?.id ?? null,
    buildingVersionId: building?.id ?? null,
    requests: p.requests.map((r) => ({
      id: r.id,
      versionId: r.versionId,
      text: r.text,
      pin: r.pin,
      status: r.status,
      createdAt: r.createdAt,
      adminText: r.adminText,
      adminNote: r.adminNote,
    })),
    pending: p.batches.filter((b) => b.status === "pending").length,
    settings: p.settings,
    notices: p.notices.slice(-20),
    vapidPublicKey,
    ...(p.appSlug ? { isApp: true } : {}),
  };
}

// ----- the index and the owner's feed ------------------------------------------------

export function emptyIndex(): ReviewIndex {
  return { projects: [], events: [] };
}

export function indexEntry(p: ClientProject): ReviewIndex["projects"][number] {
  return {
    id: p.id,
    token: p.token,
    name: p.name,
    clientName: p.clientName,
    updatedAt: p.updatedAt,
    archived: p.archived,
    clientUserId: p.clientUserId,
    ...(p.appSlug ? { appSlug: p.appSlug } : {}),
  };
}

export function upsertIndex(src: ReviewIndex, p: ClientProject): ReviewIndex {
  const entry = indexEntry(p);
  const rest = src.projects.filter((x) => x.id !== p.id);
  return { ...src, projects: [entry, ...rest] };
}

export function removeFromIndex(src: ReviewIndex, id: string): ReviewIndex {
  return {
    projects: src.projects.filter((x) => x.id !== id),
    events: src.events.filter((e) => e.projectId !== id),
  };
}

export function pushEvent(
  src: ReviewIndex,
  p: ClientProject,
  kind: AdminEvent["kind"],
  detail: string,
  now = new Date().toISOString(),
): ReviewIndex {
  const event: AdminEvent = {
    id: rid("evt_"),
    kind,
    projectId: p.id,
    projectName: p.name,
    clientName: p.clientName,
    at: now,
    detail,
  };
  return { ...src, events: [...src.events, event].slice(-KEEP_EVENTS) };
}

export function batchDetail(p: ClientProject, batch: RequestBatch): string {
  const v = p.versions.find((x) => x.id === batch.versionId);
  const n = batch.requestIds.length;
  return `${n} edit request${n === 1 ? "" : "s"}${v ? ` for ${v.number}` : ""}`;
}
