// ---------------------------------------------------------------------------
// In Queue requests — the things the owner (or any signed-in user) asks for,
// filed in a folder per app, workflow or skill.
//
// The board in queue.ts answers "is this thing finished?". Requests answer the
// other half: "what do I want done to it next?". Clicking a row opens its
// folder, which reads like a chat: a box at the top to type into, and every
// request below it, newest first.
//
// The queue is self-cleaning. A request is never ticked and left lying there:
// when it is completed — by a Claude Code session through the jarvis-memory
// connector's queue_complete, or by the owner's own tick — it LEAVES the queue
// and goes into a short "finished" log, so the folder only ever holds what is
// still to do. The log keeps the last FINISHED_KEEP entries for FINISHED_DAYS
// days so "did that get done?" has an answer, then forgets them by itself.
//
// Everything here is pure: the server store (server/requestsStore.ts), the
// API route, the connector and the browser hook all fold through these
// functions, so they cannot disagree about what a request is.
// ---------------------------------------------------------------------------

/** `open` = waiting; `working` = an agent called queue_start on it. */
export type RequestStatus = "open" | "working";

export interface QueueRequest {
  id: string;
  /**
   * The queue row it belongs to — `flow:animate-my-character`, `app:jarvis`,
   * `skill:felix` — or INBOX for an idea not filed under anything yet.
   */
  folder: string;
  text: string;
  /** Downscaled JPEG data URLs, at most MAX_IMAGES. */
  images: string[];
  status: RequestStatus;
  createdAt: string;
  /** Who filed it: "you", "studio", or a connector client name. */
  from: string;
  startedAt?: string;
  /** Who picked it up ("claude-code", "vps", …). */
  startedBy?: string;
  /** Plain-English notes added while it is worked on ("needs ffmpeg"). */
  notes: { at: string; text: string; by: string }[];
  /** A finished video the agent uploaded for it (Kids Animation Flow). */
  video?: RequestVideo;
}

export interface RequestVideo {
  /** Storage key, always `videoKey(uid, id)` — never a path an agent chose. */
  key: string;
  at: string;
  by: string;
}

export interface FinishedRequest {
  id: string;
  folder: string;
  text: string;
  doneAt: string;
  /** "you" or the agent that finished it. */
  by: string;
  /** One line on what came of it, from whoever finished it. */
  result?: string;
  video?: RequestVideo;
}

export interface RequestsDoc {
  requests: QueueRequest[];
  finished: FinishedRequest[];
}

export const INBOX = "inbox";
export const MAX_IMAGES = 4;
export const MAX_TEXT = 4000;
/** One image after downscaling; a bigger one is refused rather than stored. */
export const MAX_IMAGE_CHARS = 900_000;
export const FINISHED_KEEP = 40;
export const FINISHED_DAYS = 14;

export const EMPTY_DOC: RequestsDoc = { requests: [], finished: [] };

/** A short id, readable when an agent quotes it back ("q-7k2m9x"). */
export function newRequestId(rand: () => number = Math.random): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  let s = "";
  for (let i = 0; i < 6; i++) s += alphabet[Math.floor(rand() * alphabet.length)];
  return `q-${s}`;
}

/** Whatever was stored, as a well-formed doc — a corrupt row never crashes the board. */
export function normalizeDoc(raw: unknown): RequestsDoc {
  const r = (raw ?? {}) as Partial<RequestsDoc>;
  const requests = Array.isArray(r.requests)
    ? r.requests.filter((q): q is QueueRequest => Boolean(q && typeof q.id === "string" && typeof q.text === "string"))
        .map((q): QueueRequest => ({
          ...q,
          folder: typeof q.folder === "string" && q.folder ? q.folder : INBOX,
          images: Array.isArray(q.images) ? q.images.filter((i) => typeof i === "string").slice(0, MAX_IMAGES) : [],
          status: q.status === "working" ? "working" : "open",
          createdAt: typeof q.createdAt === "string" ? q.createdAt : new Date(0).toISOString(),
          notes: Array.isArray(q.notes) ? q.notes : [],
          from: typeof q.from === "string" ? q.from : "you",
        }))
    : [];
  const finished = Array.isArray(r.finished)
    ? r.finished.filter((f): f is FinishedRequest => Boolean(f && typeof f.id === "string"))
    : [];
  return { requests, finished };
}

/**
 * One message box, several requests.
 *
 * The owner asked to be able to type several requests at once. A message whose
 * every non-empty line is a list item ("- add dark mode", "2. fix the login")
 * is split into one request per line; anything else — a paragraph, a request
 * that happens to span two lines — stays ONE request, because cutting a
 * thought in half is worse than leaving a list together.
 */
export function splitRequests(text: string): string[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return [];
  const item = /^(?:[-*•–]|\d{1,2}[.)]|\[\s?\])\s+/;
  if (lines.length >= 2 && lines.every((l) => item.test(l))) {
    return lines.map((l) => l.replace(item, "").trim()).filter(Boolean);
  }
  const whole = text.trim();
  return whole ? [whole] : [];
}

export interface NewRequest {
  folder?: string;
  text: string;
  images?: string[];
  from?: string;
}

export class RequestError extends Error {}

/**
 * File new requests, newest first. No duplicates: the same words in the same
 * folder while the first is still open are not filed twice (a double-tap, a
 * retried send, an agent re-filing what it already filed).
 */
export function addRequests(
  doc: RequestsDoc,
  input: NewRequest,
  now = new Date(),
  makeId: () => string = () => newRequestId(),
): { doc: RequestsDoc; added: QueueRequest[] } {
  const folder = (input.folder ?? "").trim() || INBOX;
  const images = (input.images ?? []).filter((i) => typeof i === "string" && i.startsWith("data:image/"));
  if (images.length > MAX_IMAGES) throw new RequestError(`At most ${MAX_IMAGES} pictures per request.`);
  if (images.some((i) => i.length > MAX_IMAGE_CHARS)) {
    throw new RequestError("That picture is too big to keep. Try a smaller one.");
  }
  const parts = splitRequests(String(input.text ?? "").slice(0, MAX_TEXT));
  if (parts.length === 0 && images.length === 0) throw new RequestError("Type what you want done first.");
  const texts = parts.length ? parts : ["(picture)"];

  const seen = new Set(doc.requests.filter((r) => r.folder === folder).map((r) => norm(r.text)));
  const added: QueueRequest[] = [];
  texts.forEach((text, i) => {
    if (seen.has(norm(text))) return;
    seen.add(norm(text));
    added.push({
      id: makeId(),
      folder,
      text,
      // Pictures go with the first request of a split message — they were
      // attached to the message, and the first line is what they illustrate.
      images: i === 0 ? images : [],
      status: "open",
      // Later lines a millisecond older, so a split list keeps its own order
      // when the board sorts newest first.
      createdAt: new Date(now.getTime() - i).toISOString(),
      from: input.from || "you",
      notes: [],
    });
  });
  return { doc: { ...doc, requests: [...added, ...doc.requests] }, added };
}

function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

function find(doc: RequestsDoc, id: string): QueueRequest | undefined {
  return doc.requests.find((r) => r.id === id);
}

/** An agent picked it up. Shown on the request as "Working on it". */
export function startRequest(doc: RequestsDoc, id: string, by: string, now = new Date()): RequestsDoc {
  const r = find(doc, id);
  if (!r) throw new RequestError(`No open request ${id} — it may already be finished.`);
  return {
    ...doc,
    requests: doc.requests.map((q) =>
      q.id === id ? { ...q, status: "working" as const, startedAt: now.toISOString(), startedBy: by } : q,
    ),
  };
}

export function noteRequest(doc: RequestsDoc, id: string, text: string, by: string, now = new Date()): RequestsDoc {
  const r = find(doc, id);
  if (!r) throw new RequestError(`No open request ${id}.`);
  const line = text.trim().slice(0, 600);
  if (!line) return doc;
  return {
    ...doc,
    requests: doc.requests.map((q) =>
      q.id === id ? { ...q, notes: [...q.notes, { at: now.toISOString(), text: line, by }] } : q,
    ),
  };
}

/** Where a request's finished video lives in storage. One per request, overwritten on a re-render. */
export function videoKey(uid: string, id: string): string {
  return `queue/${uid.replace(/[^a-zA-Z0-9-]/g, "")}/${id.replace(/[^a-z0-9-]/g, "")}.mp4`;
}

/** The agent uploaded the video: record it on the request (open or already finished). */
export function attachVideo(doc: RequestsDoc, id: string, key: string, by: string, now = new Date()): RequestsDoc {
  const video: RequestVideo = { key, at: now.toISOString(), by };
  if (doc.requests.some((r) => r.id === id)) {
    return { ...doc, requests: doc.requests.map((r) => (r.id === id ? { ...r, video } : r)) };
  }
  if (doc.finished.some((f) => f.id === id)) {
    return { ...doc, finished: doc.finished.map((f) => (f.id === id ? { ...f, video } : f)) };
  }
  throw new RequestError(`No request ${id}.`);
}

/** Back to waiting — the agent gave up on it, or the owner wants it redone. */
export function releaseRequest(doc: RequestsDoc, id: string): RequestsDoc {
  return {
    ...doc,
    requests: doc.requests.map((q) =>
      q.id === id ? { ...q, status: "open" as const, startedAt: undefined, startedBy: undefined } : q,
    ),
  };
}

/**
 * Done: the request LEAVES the queue. This is the self-cleaning half — nothing
 * finished ever sits in a folder waiting to be cleared by hand.
 */
export function completeRequest(
  doc: RequestsDoc,
  id: string,
  by: string,
  result?: string,
  now = new Date(),
): RequestsDoc {
  const r = find(doc, id);
  if (!r) throw new RequestError(`No open request ${id} — it may already be finished.`);
  const entry: FinishedRequest = {
    id: r.id,
    folder: r.folder,
    text: r.text,
    doneAt: now.toISOString(),
    by,
    ...(result?.trim() ? { result: result.trim().slice(0, 600) } : {}),
    ...(r.video ? { video: r.video } : {}),
  };
  return prune({
    requests: doc.requests.filter((q) => q.id !== id),
    finished: [entry, ...doc.finished.filter((f) => f.id !== id)],
  }, now);
}

/** Thrown away unfinished — the owner changed their mind. Not logged as done. */
export function removeRequest(doc: RequestsDoc, id: string): RequestsDoc {
  return { ...doc, requests: doc.requests.filter((q) => q.id !== id) };
}

/** "That wasn't actually done" — back into its folder, at the top. */
export function reopenRequest(doc: RequestsDoc, id: string, now = new Date()): RequestsDoc {
  const f = doc.finished.find((x) => x.id === id);
  if (!f) throw new RequestError(`Nothing finished with id ${id}.`);
  const back: QueueRequest = {
    id: f.id,
    folder: f.folder,
    text: f.text,
    images: [],
    status: "open",
    createdAt: now.toISOString(),
    from: "you",
    notes: [{ at: now.toISOString(), text: "Reopened — it wasn't finished.", by: "you" }],
  };
  return { requests: [back, ...doc.requests], finished: doc.finished.filter((x) => x.id !== id) };
}

/** The finished log forgets on its own: FINISHED_DAYS old, or beyond FINISHED_KEEP. */
export function prune(doc: RequestsDoc, now = new Date()): RequestsDoc {
  const cutoff = now.getTime() - FINISHED_DAYS * 86_400_000;
  return {
    ...doc,
    finished: doc.finished
      .filter((f) => Date.parse(f.doneAt) >= cutoff)
      .slice(0, FINISHED_KEEP),
  };
}

/** A folder's requests, newest first. */
export function inFolder(doc: RequestsDoc, folder: string): QueueRequest[] {
  return doc.requests
    .filter((r) => r.folder === folder)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** How many requests each folder holds — what puts a count on a row. */
export function openCounts(doc: RequestsDoc): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of doc.requests) out[r.folder] = (out[r.folder] ?? 0) + 1;
  return out;
}

/**
 * The connector's view: plain text an agent can act on, one request per
 * block, newest first, with the folder spelled out so the agent knows which
 * app or skill it is about. Pictures are links, never inline bytes.
 */
export function describeForAgent(
  doc: RequestsDoc,
  folderName: (folder: string) => string,
  imageUrl: (id: string, n: number) => string,
  folder?: string,
): string {
  const list = folder ? inFolder(doc, folder) : [...doc.requests].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (!list.length) return folder ? `Nothing queued in ${folderName(folder)}.` : "The queue is empty.";
  const blocks = list.map((r) => {
    const lines = [
      `- ${r.id} · ${folderName(r.folder)} (${r.folder}) · ${r.status === "working" ? `working (${r.startedBy ?? "agent"})` : "open"} · filed ${r.createdAt.slice(0, 16).replace("T", " ")} by ${r.from}`,
      `  ${r.text.replace(/\n/g, "\n  ")}`,
    ];
    r.images.forEach((_, n) => lines.push(`  picture ${n + 1}: GET ${imageUrl(r.id, n)}`));
    if (r.video) lines.push(`  video uploaded ${r.video.at.slice(0, 16).replace("T", " ")}`);
    for (const note of r.notes) lines.push(`  note (${note.by}): ${note.text}`);
    return lines.join("\n");
  });
  return `${list.length} queued request${list.length === 1 ? "" : "s"}:\n${blocks.join("\n")}`;
}

/** A data URL's bytes and type, for the picture route. */
export function decodeImage(dataUrl: string): { type: string; bytes: Uint8Array<ArrayBuffer> } | null {
  const m = /^data:(image\/[a-z+.-]+);base64,(.+)$/i.exec(dataUrl);
  if (!m) return null;
  const bin = typeof Buffer !== "undefined" ? Buffer.from(m[2], "base64") : Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0));
  const bytes = new Uint8Array(new ArrayBuffer(bin.length));
  bytes.set(bin);
  return { type: m[1], bytes };
}
