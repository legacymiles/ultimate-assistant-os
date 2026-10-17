// ---------------------------------------------------------------------------
// What the owner attaches to a Chat request, and how it reaches the model.
//
// The Chat tab takes pictures, clips, sound, PDFs and text files, and the
// model is meant to actually perceive them — watch the clip, hear the track,
// read the PDF — not be told their names. So each one becomes a real
// content part on the user's message (image_url, video_url, input_audio,
// file), and src/lib/ai/models.ts `mediaIn` sees those parts and routes the
// request to a model that can read them.
//
// The constraint that shapes all of it is the request body: a Vercel function
// takes about 4.5 MB, and a phone video is fifty. So a file either travels
// INLINE (pictures shrunk in the browser, small sound and PDFs) or is uploaded
// to Storage first and travels as a `stored` reference that the agent route
// swaps for the real part on the server, where no body cap applies.
//
// Everything here is pure, so the decisions are unit tested; the browser half
// (reading, shrinking, uploading) is attachClient.ts.
// ---------------------------------------------------------------------------

export type AttachKind = "image" | "video" | "audio" | "pdf" | "text";

export type AttachState = "reading" | "uploading" | "ready" | "failed";

export interface ChatAttachment {
  id: string;
  name: string;
  kind: AttachKind;
  mime: string;
  /** Bytes of the original file. */
  size: number;
  /** A small picture for the chip and the block: the image, a clip's frame, a waveform. */
  thumb?: string;
  /** A picture the model can see: the shrunk image, or a frame out of the clip. */
  picture?: string;
  /** The original bytes as a data: URL, when small enough to ride in the request. */
  inline?: string;
  /** Text files: the text itself. */
  text?: string;
  /** Too big to ride along: where it was uploaded. */
  key?: string;
  /** Measured facts the model is told in words (audio). */
  note?: string;
  durationSec?: number;
  state: AttachState;
  error?: string;
}

/** OpenAI-shaped content parts, plus `stored`, which only this hub understands. */
export type WirePart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }
  | { type: "input_audio"; input_audio: { data: string; format: string } }
  | { type: "video_url"; video_url: { url: string } }
  | { type: "file"; file: { filename: string; file_data: string } }
  | { type: "stored"; stored: { key: string; name: string; mime: string; kind: AttachKind } };

export const MAX_ATTACHMENTS = 8;
/** Storage's per-object ceiling on the free plan. */
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
/** One file may ride inline up to this, before base64. */
export const INLINE_FILE_BYTES = 1.5 * 1024 * 1024;
/** Everything inline in one request, before base64 (×1.37 must stay under ~4.5 MB). */
export const INLINE_BUDGET_BYTES = 2.6 * 1024 * 1024;
/** Characters of one text file the model is given. */
export const TEXT_CHARS = 60_000;

/** What the file picker offers. */
export const ACCEPT_ATTACHMENTS = [
  "image/*",
  "video/*",
  "audio/*",
  "application/pdf",
  "text/*",
  ".md,.markdown,.csv,.tsv,.json,.yaml,.yml,.xml,.log,.txt",
  ".ts,.tsx,.js,.jsx,.mjs,.py,.mq4,.mq5,.ps1,.sh,.sql,.html,.css",
].join(",");

const TEXT_EXT = /\.(md|markdown|csv|tsv|json|ya?ml|xml|log|txt|ini|toml|env\.example|tsx?|jsx?|mjs|cjs|py|mq[45]|mqh|ps1|sh|bat|sql|html?|css|scss)$/i;

/** Which kind a file is, or null for one the model has no way to read. */
export function kindOf(mime: string, name: string): AttachKind | null {
  const m = (mime || "").toLowerCase();
  if (m.startsWith("image/")) return "image";
  if (m.startsWith("video/")) return "video";
  if (m.startsWith("audio/")) return "audio";
  if (m === "application/pdf" || /\.pdf$/i.test(name)) return "pdf";
  if (m.startsWith("text/") || m === "application/json" || m === "application/xml" || TEXT_EXT.test(name)) return "text";
  return null;
}

/** Why a file was turned away, in words the owner can act on. */
export function refusal(name: string, size: number, kind: AttachKind | null): string | null {
  if (!kind) {
    return `${name} isn't something the model can read. Pictures, clips, audio, PDFs and text files work — export a Word or Excel file to PDF first.`;
  }
  if (size > MAX_UPLOAD_BYTES) {
    return `${name} is ${mb(size)}; the limit is ${mb(MAX_UPLOAD_BYTES)}. Trim it, or send a shorter clip.`;
  }
  return null;
}

export function mb(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * Whether a file's bytes must go to Storage rather than in the request.
 *
 * Pictures never do: the browser shrinks them to a few hundred KB, and that is
 * what the model reads. Text never does: only its words travel. Everything
 * else rides inline while it is small and the request still has room, and is
 * uploaded otherwise.
 */
export function needsUpload(kind: AttachKind, size: number, inlineUsed: number): boolean {
  if (kind === "image" || kind === "text") return false;
  return size > INLINE_FILE_BYTES || inlineUsed + size > INLINE_BUDGET_BYTES;
}

/** The format name input_audio wants, from a MIME type or a file name. */
export function audioFormat(mime: string, name: string): string {
  const m = (mime || "").toLowerCase();
  const ext = (name.match(/\.([a-z0-9]+)$/i)?.[1] ?? "").toLowerCase();
  if (m.includes("mpeg") || m.includes("mp3") || ext === "mp3") return "mp3";
  if (m.includes("wav") || ext === "wav") return "wav";
  if (m.includes("flac") || ext === "flac") return "flac";
  if (m.includes("ogg") || ext === "ogg" || ext === "oga") return "ogg";
  if (m.includes("aac") || ext === "aac") return "aac";
  if (m.includes("aiff") || ext === "aiff" || ext === "aif") return "aiff";
  if (m.includes("webm") || ext === "webm") return "webm";
  if (m.includes("mp4") || m.includes("m4a") || ext === "m4a") return "m4a";
  return ext || "mp3";
}

const base64Of = (dataUrl: string) => dataUrl.slice(dataUrl.indexOf(",") + 1);

function line(a: ChatAttachment, n: number): string {
  const bits: string[] = [a.kind === "pdf" ? "PDF" : a.kind];
  if (a.durationSec) bits.push(`${a.durationSec}s`);
  bits.push(mb(a.size));
  let s = `${n}. ${a.name} — ${bits.join(", ")}`;
  if (a.kind === "video" && !a.key && !a.inline) s += " (only a still frame from it could be sent)";
  if (a.kind === "text") s += " (its text is below)";
  if (a.note) s += `\n   Measured: ${a.note.replace(/\n/g, " ")}`;
  return s;
}

/**
 * The user turn, as content parts.
 *
 * The text part leads, and carries a numbered list of what is attached so
 * "the second clip" means something to the model and to the owner reading
 * the answer. Text files are pasted under it, fenced and capped.
 */
export function toParts(command: string, attachments: ChatAttachment[]): WirePart[] {
  const ready = attachments.filter((a) => a.state === "ready");
  if (!ready.length) return [{ type: "text", text: command }];

  const head = [
    command.trim() || "Look at what I attached.",
    "",
    `Attached (${ready.length}):`,
    ...ready.map((a, i) => line(a, i + 1)),
  ];
  for (const a of ready.filter((x) => x.kind === "text" && x.text)) {
    const body = a.text!.length > TEXT_CHARS ? `${a.text!.slice(0, TEXT_CHARS)}\n… (cut at ${TEXT_CHARS} characters)` : a.text!;
    head.push("", `--- ${a.name} ---`, "```", body, "```");
  }

  const parts: WirePart[] = [{ type: "text", text: head.join("\n") }];
  for (const a of ready) {
    if (a.kind === "text") continue;
    if (a.key) {
      parts.push({ type: "stored", stored: { key: a.key, name: a.name, mime: a.mime, kind: a.kind } });
      continue;
    }
    switch (a.kind) {
      case "image":
        if (a.picture) parts.push({ type: "image_url", image_url: { url: a.picture } });
        break;
      case "video":
        if (a.inline) parts.push({ type: "video_url", video_url: { url: a.inline } });
        else if (a.picture) parts.push({ type: "image_url", image_url: { url: a.picture } });
        break;
      case "audio":
        if (a.inline) parts.push({ type: "input_audio", input_audio: { data: base64Of(a.inline), format: audioFormat(a.mime, a.name) } });
        break;
      case "pdf":
        if (a.inline) parts.push({ type: "file", file: { filename: a.name, file_data: a.inline } });
        break;
    }
  }
  return parts;
}

/**
 * What an earlier turn looks like in the history.
 *
 * Attachments are not resent with every later request — that is how one video
 * becomes a request too big to send. The model is told they were there.
 */
export function historyText(command: string, attachments: { name: string; kind: AttachKind }[] | undefined): string {
  if (!attachments?.length) return command;
  return `${command}\n[Attached then, not resent: ${attachments.map((a) => `${a.name} (${a.kind})`).join(", ")}]`;
}

/** The part of an attachment a saved block keeps: enough to show what was sent. */
export interface AttachmentShown {
  name: string;
  kind: AttachKind;
  thumb?: string;
}

export function shown(attachments: ChatAttachment[]): AttachmentShown[] {
  return attachments
    .filter((a) => a.state === "ready")
    .map((a) => ({ name: a.name, kind: a.kind, ...(a.thumb ? { thumb: a.thumb } : {}) }));
}
