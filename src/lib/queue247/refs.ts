// ---------------------------------------------------------------------------
// Reference pictures the owner attaches to a message for Jarvis — pure rules.
//
// The browser shrinks each picture (chatMedia.prepareMedia, 1024 px JPEG) and
// sends it as a data URL. The command route checks it here, stores it in the
// private `queue-247` bucket under refs/<uid>/, shows it to the planner model
// and lists the keys on every task that request files (config.references), so
// an executor can open the very picture the owner meant.
// ---------------------------------------------------------------------------

export const MAX_REFS = 6;
/** Decoded bytes per picture. The browser sends ~200 KB; this is the ceiling. */
export const MAX_REF_BYTES = 4 * 1024 * 1024;

const TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

export interface CleanRef {
  name: string;
  type: string;
  ext: string;
  base64: string;
  /** The data URL as received, for the planner model. */
  dataUrl: string;
}

const seg = (s: string) => s.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64) || "x";

export function parseDataUrl(s: unknown): { type: string; ext: string; base64: string } | null {
  if (typeof s !== "string") return null;
  const m = /^data:([a-z/+.-]+);base64,([A-Za-z0-9+/=\s]+)$/i.exec(s);
  if (!m) return null;
  const type = m[1].toLowerCase();
  const ext = TYPES[type];
  if (!ext) return null;
  return { type: type === "image/jpg" ? "image/jpeg" : type, ext, base64: m[2].replace(/\s/g, "") };
}

/** Bytes a base64 string decodes to. */
export function base64Bytes(b64: string): number {
  const pad = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - pad;
}

/**
 * Check what the browser sent. Returns the pictures that are fine and, when
 * any were dropped, one plain-English sentence saying why.
 */
export function cleanRefs(input: unknown): { refs: CleanRef[]; problem: string | null } {
  if (!Array.isArray(input) || !input.length) return { refs: [], problem: null };
  const refs: CleanRef[] = [];
  const problems: string[] = [];
  for (const raw of input.slice(0, MAX_REFS)) {
    const item = (raw ?? {}) as { dataUrl?: unknown; name?: unknown };
    const parsed = parseDataUrl(item.dataUrl);
    const name = (typeof item.name === "string" ? item.name : "picture").replace(/[\r\n]/g, " ").slice(0, 80) || "picture";
    if (!parsed) {
      problems.push(`${name} isn't a JPEG, PNG, WebP or GIF picture`);
      continue;
    }
    if (base64Bytes(parsed.base64) > MAX_REF_BYTES) {
      problems.push(`${name} is over 4 MB`);
      continue;
    }
    refs.push({ name, ...parsed, dataUrl: `data:${parsed.type};base64,${parsed.base64}` });
  }
  if (input.length > MAX_REFS) problems.push(`only the first ${MAX_REFS} pictures were kept`);
  return { refs, problem: problems.length ? `${problems.join("; ")}.` : null };
}

export function refKey(uid: string, random: string, ext: string): string {
  return `refs/${seg(uid)}/${seg(random)}.${ext}`;
}

/** Is this a reference-picture key that belongs to `uid`? */
export function ownsRef(uid: string, key: unknown): key is string {
  if (typeof key !== "string" || key.includes("..")) return false;
  const m = /^refs\/([^/]+)\/[A-Za-z0-9_-]+\.(jpg|png|webp|gif)$/.exec(key);
  return Boolean(m && m[1] === seg(uid));
}

/** The words appended to the planner's message when pictures came with it. */
export function refsNote(refs: { name: string }[]): string {
  if (!refs.length) return "";
  const list = refs.map((r, i) => `  picture ${i + 1}: ${r.name}`).join("\n");
  return [
    "",
    `The owner attached ${refs.length} reference picture${refs.length === 1 ? "" : "s"} to this message (shown after this text):`,
    list,
    "Look at them. Every task you file from this message keeps them as references, so say in the task's instruction which picture is for what, and describe what matters in words (a character's look, outfit, colours, setting, style) — for an h3-recreate task put that description into config.changes. If a picture changes nothing, say so in the reply.",
  ].join("\n");
}
