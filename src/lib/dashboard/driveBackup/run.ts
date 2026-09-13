import { getFile } from "@/lib/recall/files";
import type { Folder, Item } from "@/lib/recall/types";
import { createEntry, listAppEntries, updateEntry } from "./driveApi";
import { APP_VALUE, GOOGLE_DOC, buildPlan } from "./plan";

// ---------------------------------------------------------------------------
// Carry out a backup plan against the user's Drive.
//
// One file at a time, on purpose: a backup is a background chore, and dozens
// of parallel uploads is the reliable way to hit Drive's rate limit and lose
// half of them. One failure never stops the rest — it is reported, and the
// next run tries it again, because its version on Drive was never updated.
// ---------------------------------------------------------------------------

const FOLDER_MIME = "application/vnd.google-apps.folder";

export interface BackupProgress {
  stage: "scanning" | "folders" | "files" | "done";
  done: number;
  total: number;
  current?: string;
}

export interface BackupSummary {
  rootId: string | null;
  created: number;
  updated: number;
  moved: number;
  unchanged: number;
  /** Photos and files whose bytes live on another device, so this one cannot upload them. */
  notOnThisDevice: string[];
  notBackedUp: { title: string; reason: string }[];
  failed: { name: string; error: string }[];
  finishedAt: string;
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : "Drive refused the change";
}

export async function runBackup(
  folders: readonly Folder[],
  items: readonly Item[],
  onProgress?: (p: BackupProgress) => void,
): Promise<BackupSummary> {
  onProgress?.({ stage: "scanning", done: 0, total: 0 });
  const plan = buildPlan(folders, items, await listAppEntries(APP_VALUE));

  const summary: BackupSummary = {
    rootId: null,
    created: 0,
    updated: 0,
    moved: 0,
    unchanged: 0,
    notOnThisDevice: [],
    notBackedUp: plan.notBackedUp,
    failed: [],
    finishedAt: "",
  };
  const driveIds = new Map<string, string>();

  // ----- folders, parents first ------------------------------------------------
  let done = 0;
  for (const step of plan.folders) {
    onProgress?.({ stage: "folders", done: done++, total: plan.folders.length, current: step.name });
    const parentId = step.parentKey ? driveIds.get(step.parentKey) : undefined;
    if (step.parentKey && !parentId) {
      summary.failed.push({ name: step.name, error: "its parent folder could not be made" });
      continue;
    }
    try {
      if (!step.existing) {
        const id = await createEntry({
          name: step.name,
          mimeType: FOLDER_MIME,
          ...(parentId ? { parents: [parentId] } : {}),
          appProperties: step.props,
        });
        driveIds.set(step.key, id);
        summary.created++;
        continue;
      }
      const id = step.existing.id;
      driveIds.set(step.key, id);
      // Renamed or moved in Dashboard: the SAME Drive folder follows, found by
      // its Dashboard id, so nothing is duplicated.
      const currentParent = step.existing.parents?.[0];
      const rename = step.existing.name !== step.name;
      const move = Boolean(parentId && currentParent && currentParent !== parentId);
      if (rename || move) {
        await updateEntry(
          id,
          rename ? { name: step.name } : {},
          move ? { addParent: parentId, removeParent: currentParent } : {},
        );
        summary.moved++;
      }
    } catch (err) {
      summary.failed.push({ name: step.name, error: message(err) });
    }
  }
  summary.rootId = driveIds.get("root") ?? null;

  // ----- files -----------------------------------------------------------------
  done = 0;
  for (const step of plan.files) {
    onProgress?.({ stage: "files", done: done++, total: plan.files.length, current: step.name });
    const parentId = driveIds.get(step.parentKey);
    if (!parentId) {
      summary.failed.push({ name: step.name, error: "its folder could not be made" });
      continue;
    }
    try {
      const existing = step.existing;
      const currentParent = existing?.parents?.[0];
      const move = Boolean(existing && currentParent && currentParent !== parentId);
      const rename = Boolean(existing && existing.name !== step.name);
      if (existing && !step.changed && !move && !rename) {
        summary.unchanged++;
        continue;
      }

      let media: { body: Blob | string; mime: string } | undefined;
      if (!existing || step.changed) {
        if (step.source.type === "blob") {
          const blob = await getFile(step.source.fileId);
          if (!blob) {
            // Left unversioned on Drive, so the device that holds it uploads it.
            summary.notOnThisDevice.push(step.name);
            continue;
          }
          media = { body: blob, mime: step.source.mime || blob.type || "application/octet-stream" };
        } else {
          media = { body: step.source.text, mime: "text/plain" };
        }
      }

      if (!existing) {
        await createEntry(
          {
            name: step.name,
            parents: [parentId],
            ...(step.source.type === "doc" ? { mimeType: GOOGLE_DOC } : {}),
            appProperties: step.props,
          },
          media,
        );
        summary.created++;
      } else {
        await updateEntry(
          existing.id,
          { name: step.name, appProperties: step.props },
          { ...(move && currentParent ? { addParent: parentId, removeParent: currentParent } : {}), media },
        );
        if (step.changed) summary.updated++;
        else summary.moved++;
      }
    } catch (err) {
      summary.failed.push({ name: step.name, error: message(err) });
    }
  }

  summary.finishedAt = new Date().toISOString();
  onProgress?.({ stage: "done", done: plan.files.length, total: plan.files.length });
  return summary;
}
