// ---------------------------------------------------------------------------
// Capturing into the vault from a device that cannot see it.
//
// The vault lives on the owner's PC. A phone has no bridge to it, so a thought
// captured on a phone has to be queued and applied later. That queue is a
// Supabase TABLE, deliberately not a field on the synced store: `saveSynced`
// is whole-blob last-write-wins and says in its own header that it does not
// merge, so a phone that never reloaded would push a stale blob, resurrect an
// op that had already been applied, and the replay would overwrite a newer
// file. `state = 'applied'` has to be a row fact that no blob can undo.
//
// Two ops, and only two:
//
//   create — write a note at a path that does not exist yet.
//   append — add to the end of an existing note.
//
// There is no `replace`. A device that cannot read the file cannot know what it
// is replacing, so a blind full-body write is the conflict generator; refusing
// it is what makes this queue safe rather than merely eventual. Appends commute,
// which is why the one operation we do allow against a file we cannot see is
// the one whose result does not depend on the order it arrives in.
//
// ## Why idempotency is by marker and not by hash
//
// The plan called for a `base_hash` check on every op. That is right for
// `create` and wrong for `append`: appending to a file that changed since we
// last looked is exactly the safe case, so failing it on a hash mismatch would
// reject the very operation we chose append for. What append actually needs is
// protection against being applied TWICE — a retried request, a resumed sweep —
// and a hash cannot give that, because the second apply sees a legitimately
// different file. So every applied op leaves an invisible marker carrying its
// own id, and an op whose marker is already in the file is a no-op. `baseHash`
// is still recorded, because it is what tells the owner what the capturing
// device believed when a conflict note has to be written.
// ---------------------------------------------------------------------------

import { normalizePath } from "./parse";

export type OpKind = "create" | "append";

export type OpState = "pending" | "applied" | "conflict";

export interface VaultOp {
  /** Stable, assigned at capture time. Also the idempotency marker. */
  id: string;
  /** Vault-relative, assigned at capture time so `external_id` is stable before the file exists. */
  path: string;
  op: OpKind;
  body: string;
  /** What the capturing device believed the file hashed to, or null for a create. Diagnostic. */
  baseHash: string | null;
  state: OpState;
  createdAt: string;
  appliedAt?: string | null;
}

export type Outcome =
  /** The file was created. */
  | "created"
  /** Text was added to the end of an existing file. */
  | "appended"
  /** Already applied — the marker was found. Nothing was written. */
  | "noop"
  /** Something else owns this path. A sibling note was written instead; nothing was overwritten. */
  | "conflict";

export interface ApplyResult {
  outcome: Outcome;
  /** The path to write. Differs from `op.path` only on a conflict. */
  path: string;
  /** The full new contents, or null when nothing should be written. */
  text: string | null;
}

/** The invisible marker an applied op leaves behind. Comments are not rendered by Obsidian. */
export function marker(id: string): string {
  return `<!-- jarvis-op:${id} -->`;
}

/** True when this op has already been applied to this file. */
export function alreadyApplied(existing: string, id: string): boolean {
  return existing.includes(marker(id));
}

// --- naming ----------------------------------------------------------------

/**
 * A filename-safe slug.
 *
 * Windows forbids `\ / : * ? " < > |` outright and chokes on trailing dots and
 * spaces, so this is stricter than a URL slug: the output has to survive being
 * a real file on the owner's disk, not just look tidy.
 */
export function slug(text: string, max = 48): string {
  const base = text
    .normalize("NFC")
    .replace(/[\\/:*?"<>|#^[\]]/g, " ")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
  const cut = base.slice(0, max).replace(/-+$/, "");
  return cut.toLowerCase() || "note";
}

/**
 * A filename that a `[[wikilink]]` will still resolve to.
 *
 * This is NOT `slug()`, and the difference is the whole point. Links resolve by
 * basename, so a note written for `[[Jarvis Studio]]` must be called
 * `Jarvis Studio.md` — slugging it to `jarvis-studio` leaves every link that
 * asked for it still dangling, which is precisely the problem writing it was
 * meant to solve. So only the characters that cannot be in a filename, or that
 * would break the link syntax itself, are removed; spaces and case survive.
 */
export function noteFileName(title: string, max = 80): string {
  const cleaned = title
    .normalize("NFC")
    // Forbidden by Windows, plus the characters Obsidian reads as link syntax.
    .replace(/[\\/:*?"<>|#^[\]]/g, " ")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    // Windows cannot store a name ending in a dot or a space.
    .replace(/[. ]+$/, "");
  return cleaned.slice(0, max).replace(/[. ]+$/, "") || "Untitled";
}

/** Where a note written for a named link belongs. */
export function namedNotePath(title: string, folder = "notes"): string {
  return normalizePath(`${folder}/${noteFileName(title)}.md`);
}

/** `2026-10-02-1423` in the capturing device's own timezone, because that is the day the owner means. */
export function stamp(now: number): string {
  const d = new Date(now);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

/**
 * Where a captured thought lands.
 *
 * The path is decided HERE, at capture time, rather than when the bridge gets
 * round to writing it — which is what makes `external_id` stable before the
 * file exists, lets the note be searchable immediately as a pending mirror row,
 * and makes the eventual write an idempotent create-at-path.
 */
export function capturePath(title: string, now: number, folder = "inbox"): string {
  return normalizePath(`${folder}/${stamp(now)}-${slug(title)}.md`);
}

/** The sibling a conflict is written to. Readable on purpose: it has to be obvious in Obsidian's file list. */
export function conflictPath(path: string, now: number): string {
  const norm = normalizePath(path);
  const ext = /\.(md|markdown)$/i.exec(norm);
  const stem = ext ? norm.slice(0, -ext[0].length) : norm;
  const d = new Date(now);
  const p = (n: number) => String(n).padStart(2, "0");
  const when = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}${p(d.getMinutes())}`;
  return `${stem} (conflict ${when})${ext ? ext[0] : ".md"}`;
}

// --- writing ---------------------------------------------------------------

function yamlValue(value: string): string {
  // Quote anything that YAML would read as something other than a plain string.
  return /^[\w][\w .\-/]*$/.test(value) ? value : JSON.stringify(value);
}

/**
 * Compose a new note: frontmatter, a title heading, the body, and the marker.
 *
 * The frontmatter mirrors the structure the researched vault uses — a
 * `captured` timestamp, a `source` naming where it came from, and `status` so
 * the owner can see at a glance which notes arrived unattended and have not
 * been filed yet.
 */
export function renderCapture(input: {
  title: string;
  body: string;
  now: number;
  id: string;
  origin?: string;
  tags?: string[];
}): string {
  const lines = ["---", `title: ${yamlValue(input.title)}`, `captured: ${new Date(input.now).toISOString()}`];
  if (input.origin) lines.push(`source: ${yamlValue(input.origin)}`);
  lines.push("status: inbox");
  if (input.tags?.length) lines.push(`tags: [${input.tags.map((t) => yamlValue(t)).join(", ")}]`);
  lines.push("---", "", `# ${input.title}`, "", input.body.trim(), "", marker(input.id), "");
  return lines.join("\n");
}

/** The block an append adds. Separated by a rule so successive captures stay readable. */
export function renderAppend(input: { body: string; now: number; id: string; origin?: string }): string {
  const when = new Date(input.now).toISOString();
  const from = input.origin ? ` · ${input.origin}` : "";
  return ["", "---", "", `**${when}**${from}`, "", input.body.trim(), "", marker(input.id), ""].join("\n");
}

/**
 * Work out what writing one op should actually do.
 *
 * `existing` is the file's current contents, or null when there is no file.
 * Nothing here touches a disk — the bridge does that — so every outcome,
 * including the two that protect data, is testable without one.
 */
export function applyOp(existing: string | null, op: VaultOp, now: number): ApplyResult {
  const path = normalizePath(op.path);

  // A replay of an op already in the file. The commonest case after a retried
  // request or a resumed sweep, and it must write nothing at all.
  if (existing !== null && alreadyApplied(existing, op.id)) {
    return { outcome: "noop", path, text: null };
  }

  // Idempotency is guaranteed HERE rather than trusted to the caller. The
  // renderers already add the marker, but an op enqueued with a plain body
  // would otherwise be un-replayable — and the failure mode is nasty: every
  // retry would see a file it does not recognise and litter the vault with
  // conflict siblings.
  const body = op.body.includes(marker(op.id)) ? op.body : `${op.body.replace(/\s*$/, "\n")}\n${marker(op.id)}\n`;

  if (op.op === "create") {
    if (existing === null || !existing.trim()) {
      return { outcome: "created", path, text: body };
    }
    // The path was assigned at capture time and something else now owns it.
    // Never overwrite: write a sibling that links back, so both survive and
    // the owner can merge them in Obsidian where they can see both.
    const target = conflictPath(path, now);
    const note = [
      "---",
      `title: ${yamlValue(`Conflict: ${path}`)}`,
      `captured: ${new Date(now).toISOString()}`,
      "status: conflict",
      `conflicts_with: "[[${path}]]"`,
      "---",
      "",
      `This was captured for \`${path}\`, but that note already existed and was not`,
      "overwritten. Merge whichever parts of this you want into it, then delete this file.",
      "",
      "---",
      "",
      op.body.trim(),
      "",
      marker(op.id),
      "",
    ].join("\n");
    return { outcome: "conflict", path: target, text: note };
  }

  // append
  if (existing === null) {
    // Nothing to append to. Appending to a file that does not exist is a
    // create — refusing would silently drop the capture, which is worse than
    // creating a note the owner can see and move.
    return { outcome: "created", path, text: body.replace(/^\n+/, "") };
  }

  // A hash mismatch is NOT a conflict here: appending to a file that changed
  // since this device last looked is precisely the case append was chosen for.
  const joined = existing.replace(/\s*$/, "\n") + body;
  return { outcome: "appended", path, text: joined };
}

/** A captured note's mirror row, so it is searchable before it ever reaches disk. */
export function pendingMirror(op: VaultOp, title: string): {
  source: "vault";
  title: string;
  content: string;
  origin: string;
  externalId: string;
  capturedAt: string;
  meta: { pending: true; opId: string };
} {
  return {
    source: "vault",
    title,
    content: op.body,
    origin: "captured, waiting for your PC",
    externalId: normalizePath(op.path),
    capturedAt: op.createdAt,
    meta: { pending: true, opId: op.id },
  };
}

/** Ops still waiting, oldest first — the order they must be applied in. */
export function pending(ops: VaultOp[]): VaultOp[] {
  return ops
    .filter((o) => o.state === "pending")
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id.localeCompare(b.id));
}

/** A one-line, honest account of a flush. */
export function describeFlush(results: { outcome: Outcome }[]): string {
  if (!results.length) return "Nothing was waiting.";
  const count = (o: Outcome) => results.filter((r) => r.outcome === o).length;
  const parts: string[] = [];
  const created = count("created");
  const appended = count("appended");
  const conflicts = count("conflict");
  const noops = count("noop");
  if (created) parts.push(`${created} written`);
  if (appended) parts.push(`${appended} added to`);
  if (noops) parts.push(`${noops} already there`);
  if (!parts.length && !conflicts) return "Nothing was waiting.";
  let line = parts.join(", ") || "Nothing new";
  if (conflicts) {
    line += `. ${conflicts} could not be written because the note already existed — ${
      conflicts === 1 ? "a sibling note was" : "sibling notes were"
    } saved instead, and nothing was overwritten`;
  }
  return `${line}.`;
}
