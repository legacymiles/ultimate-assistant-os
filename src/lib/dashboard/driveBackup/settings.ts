import { scopedKey } from "@/lib/sync/identity";
import type { BackupSummary } from "./run";

// ---------------------------------------------------------------------------
// Drive backup settings for this browser.
//
// Kept on the device rather than synced, because linking is a Google consent
// given in THIS browser. Which files are already backed up is not stored here
// at all — each run asks Drive, where every file carries its Dashboard id — so
// clearing this, or backing up from another device, never duplicates anything.
// ---------------------------------------------------------------------------

const KEY = "dashboard-drive-backup:v1";

export interface DriveBackupSettings {
  /** True once the user has approved Google Drive in this browser. */
  linked: boolean;
  /** Back up on its own, shortly after changes, while Dashboard is open. */
  auto: boolean;
  /** The "Ultimate Assistant OS" folder on Drive, for the Open in Drive link. */
  rootId: string | null;
  last: BackupSummary | null;
}

const DEFAULTS: DriveBackupSettings = { linked: false, auto: true, rootId: null, last: null };

export function getDriveBackupSettings(): DriveBackupSettings {
  try {
    const raw = localStorage.getItem(scopedKey(KEY));
    return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<DriveBackupSettings>) } : { ...DEFAULTS };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveDriveBackupSettings(patch: Partial<DriveBackupSettings>): DriveBackupSettings {
  const next = { ...getDriveBackupSettings(), ...patch };
  try {
    localStorage.setItem(scopedKey(KEY), JSON.stringify(next));
  } catch {
    /* storage full or blocked: the setting simply lasts for this visit */
  }
  return next;
}
