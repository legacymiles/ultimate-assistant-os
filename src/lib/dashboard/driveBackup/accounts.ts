/* eslint-disable @typescript-eslint/no-explicit-any */
// ---------------------------------------------------------------------------
// Google Drive backup accounts — every connected account, what Google says
// about its storage, and exactly which backed-up files live in it.
//
// Nothing here is estimated. Storage comes from Drive's own `about` endpoint
// (storageQuota: limit, usage, usageInDrive, usageInDriveTrash) for that
// account; the inventory is a live listing of the files this app created in
// that account (drive.file scope — the app can only see its own backups),
// with each file's real folder path rebuilt from its Drive parents.
//
// The registry is synced so the dashboard reads the same on every device.
// Tokens are NOT in it: they stay in memory, per account (lib/recall/drive).
// ---------------------------------------------------------------------------

import { loadLocal, saveSynced } from "@/lib/sync/appState";
import { accessToken, activeDriveEmail, connectGoogleAccount, driveJson, setActiveDriveEmail, tokenForAccount, whoIs } from "@/lib/recall/drive";
import type { Item } from "@/lib/recall/types";
import { APP_VALUE, LIST_KINDS } from "./plan";
import type { BackupSummary } from "./run";

export const ACCOUNTS_KEY = "drive-backup-accounts:v1";
const FOLDER_MIME = "application/vnd.google-apps.folder";
/** Enough for a big library, small enough to sync. */
const MAX_FILES = 2500;

export interface DriveQuota {
  /** Bytes. null = unlimited (some Workspace plans). */
  limit: number | null;
  usage: number;
  usageInDrive: number;
  usageInTrash: number;
}

export interface BackedUpFile {
  id: string;
  name: string;
  /** "Ultimate Assistant OS › Folders › Trading" — the real path on Drive. */
  path: string;
  mime: string;
  /** "item:<id>" for a Folders item, as the backup wrote it. */
  key?: string;
  modified?: string;
  size?: number;
  link?: string;
}

export interface AccountRun {
  finishedAt: string;
  created: number;
  updated: number;
  moved: number;
  unchanged: number;
  failed: { name: string; error: string }[];
  notBackedUp: { title: string; reason: string }[];
  notOnThisDevice: number;
}

export interface DriveAccount {
  email: string;
  name?: string;
  photo?: string;
  quota?: DriveQuota;
  /** When storage + inventory were last read from Google. */
  checkedAt?: string;
  /** The "Ultimate Assistant OS" folder in this account. */
  rootId?: string | null;
  inventory?: { files: BackedUpFile[]; folders: number; truncated: boolean };
  lastRun?: AccountRun;
  /** The last run that finished with nothing failed. */
  lastSuccessAt?: string;
  lastError?: string;
}

export interface AccountsState {
  accounts: DriveAccount[];
  /** Where new backups go. */
  target: string | null;
}

const EMPTY: AccountsState = { accounts: [], target: null };

export function getAccounts(): AccountsState {
  try {
    const s = loadLocal<AccountsState>(ACCOUNTS_KEY, EMPTY);
    return { accounts: Array.isArray(s?.accounts) ? s.accounts : [], target: s?.target ?? null };
  } catch {
    return { ...EMPTY };
  }
}

function save(next: AccountsState): AccountsState {
  saveSynced(ACCOUNTS_KEY, next);
  setActiveDriveEmail(next.target);
  return next;
}

/** Make the stored backup target the account every Drive call uses. */
export function restoreActiveAccount(): void {
  setActiveDriveEmail(getAccounts().target);
}

export function upsertAccount(state: AccountsState, patch: DriveAccount): AccountsState {
  const email = patch.email.toLowerCase();
  const others = state.accounts.filter((a) => a.email !== email);
  const before = state.accounts.find((a) => a.email === email);
  return { ...state, accounts: [...others, { ...before, ...patch, email }].sort((a, b) => a.email.localeCompare(b.email)) };
}

// ----- reading Google -------------------------------------------------------

/** Drive's about response → the numbers the dashboard shows. */
export function parseAbout(json: any): { email: string; name?: string; photo?: string; quota: DriveQuota } {
  const q = json?.storageQuota ?? {};
  const n = (v: unknown) => (v === undefined || v === null || v === "" ? null : Number(v));
  return {
    email: String(json?.user?.emailAddress ?? "").toLowerCase(),
    name: json?.user?.displayName || undefined,
    photo: json?.user?.photoLink || undefined,
    quota: {
      limit: n(q.limit),
      usage: n(q.usage) ?? 0,
      usageInDrive: n(q.usageInDrive) ?? 0,
      usageInTrash: n(q.usageInDriveTrash) ?? 0,
    },
  };
}

interface RawFile {
  id: string;
  name: string;
  mimeType: string;
  parents?: string[];
  appProperties?: Record<string, string>;
  modifiedTime?: string;
  size?: string;
  webViewLink?: string;
}

/** Rebuild each backed-up file's folder path from its Drive parents. */
export function buildInventory(raw: RawFile[]): { files: BackedUpFile[]; folders: number; rootId: string | null; truncated: boolean } {
  const byId = new Map(raw.map((f) => [f.id, f]));
  const folders = raw.filter((f) => f.mimeType === FOLDER_MIME);
  const root = folders.find((f) => f.appProperties?.dashboardKey === "root") ?? folders.find((f) => !f.parents?.some((p) => byId.has(p)));
  const pathOf = (f: RawFile): string => {
    const parts: string[] = [];
    let cur = f.parents?.[0] ? byId.get(f.parents[0]) : undefined;
    for (let guard = 0; cur && guard < 40; guard += 1) {
      parts.unshift(cur.name);
      cur = cur.parents?.[0] ? byId.get(cur.parents[0]) : undefined;
    }
    return parts.join(" › ") || "My Drive";
  };
  const files = raw
    .filter((f) => f.mimeType !== FOLDER_MIME)
    .map<BackedUpFile>((f) => ({
      id: f.id,
      name: f.name,
      path: pathOf(f),
      mime: f.mimeType,
      key: f.appProperties?.dashboardKey,
      modified: f.modifiedTime,
      size: f.size ? Number(f.size) : undefined,
      link: f.webViewLink,
    }))
    .sort((a, b) => (b.modified ?? "").localeCompare(a.modified ?? ""));
  return { files: files.slice(0, MAX_FILES), folders: folders.length, rootId: root?.id ?? null, truncated: files.length > MAX_FILES };
}

async function readAccount(email: string, token: string): Promise<DriveAccount> {
  const about = parseAbout(
    await driveJson("https://www.googleapis.com/drive/v3/about?fields=user(emailAddress,displayName,photoLink),storageQuota", token),
  );
  const q = `trashed = false and appProperties has { key='dashboardApp' and value='${APP_VALUE}' }`;
  const fields = "nextPageToken,files(id,name,parents,mimeType,appProperties,modifiedTime,size,webViewLink)";
  const raw: RawFile[] = [];
  let pageToken = "";
  do {
    const res = await driveJson(
      "https://www.googleapis.com/drive/v3/files" +
        `?q=${encodeURIComponent(q)}&fields=${encodeURIComponent(fields)}&pageSize=1000` +
        (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""),
      token,
    );
    raw.push(...((res.files ?? []) as RawFile[]));
    pageToken = res.nextPageToken ?? "";
  } while (pageToken && raw.length < MAX_FILES * 2);
  const inv = buildInventory(raw);
  return {
    email: about.email || email,
    name: about.name,
    photo: about.photo,
    quota: about.quota,
    checkedAt: new Date().toISOString(),
    rootId: inv.rootId,
    inventory: { files: inv.files, folders: inv.folders, truncated: inv.truncated },
    lastError: undefined,
  };
}

/** Sign in another Google account and read it. The first one becomes the backup target. */
export async function addAccount(): Promise<AccountsState> {
  const { email, token } = await connectGoogleAccount();
  const acct = await readAccount(email, token);
  let state = upsertAccount(getAccounts(), acct);
  if (!state.target) state = { ...state, target: acct.email };
  return save(state);
}

/** Re-read storage and inventory for one account (asks Google only if its token expired). */
export async function refreshAccount(email: string, opts: { interactive?: boolean } = {}): Promise<AccountsState> {
  try {
    const token = await tokenForAccount(email, opts);
    return save(upsertAccount(getAccounts(), await readAccount(email, token)));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    save(upsertAccount(getAccounts(), { email, lastError: msg }));
    throw e;
  }
}

export function setTarget(email: string): AccountsState {
  return save({ ...getAccounts(), target: email.toLowerCase() });
}

/** Forget an account here. Its backups stay in its Drive, untouched. */
export function forgetAccount(email: string): AccountsState {
  const s = getAccounts();
  const accounts = s.accounts.filter((a) => a.email !== email.toLowerCase());
  return save({ accounts, target: s.target === email.toLowerCase() ? (accounts[0]?.email ?? null) : s.target });
}

/** File a finished backup run under the account it went to. */
export function recordRun(email: string, summary: BackupSummary): AccountsState {
  const run: AccountRun = {
    finishedAt: summary.finishedAt,
    created: summary.created,
    updated: summary.updated,
    moved: summary.moved,
    unchanged: summary.unchanged,
    failed: summary.failed.slice(0, 50),
    notBackedUp: summary.notBackedUp.slice(0, 50),
    notOnThisDevice: summary.notOnThisDevice.length,
  };
  const before = getAccounts().accounts.find((a) => a.email === email.toLowerCase());
  return save(
    upsertAccount(getAccounts(), {
      email,
      rootId: summary.rootId ?? before?.rootId ?? null,
      lastRun: run,
      lastSuccessAt: summary.failed.length === 0 ? summary.finishedAt : before?.lastSuccessAt,
    }),
  );
}

/**
 * After any backup run: file the run under the account it went to and re-read
 * that account's storage and inventory with the still-live token. A backup
 * made before accounts existed (one unnamed Google login) is adopted here —
 * the account is named from Drive itself and becomes the backup target.
 */
export async function afterBackup(summary: BackupSummary): Promise<AccountsState> {
  const token = await accessToken();
  const email = activeDriveEmail() ?? (await whoIs(token));
  const s = getAccounts();
  if (!s.accounts.some((a) => a.email === email) || !s.target) save({ ...upsertAccount(s, { email }), target: s.target ?? email });
  recordRun(email, summary);
  try {
    return save(upsertAccount(getAccounts(), await readAccount(email, token)));
  } catch {
    return getAccounts();
  }
}

// ----- what the dashboard shows ---------------------------------------------

export interface Coverage {
  /** Folders item id → where its backup lives. */
  where: Map<string, { email: string; file: BackedUpFile }[]>;
  backedUp: number;
  missing: Item[];
}

/** Which Folders items are on which account — matched by the id each backup carries. */
export function coverage(items: Item[], accounts: DriveAccount[]): Coverage {
  const where = new Map<string, { email: string; file: BackedUpFile }[]>();
  for (const a of accounts) {
    for (const f of a.inventory?.files ?? []) {
      const id = f.key?.startsWith("item:") ? f.key.slice(5) : null;
      if (!id) continue;
      const list = where.get(id) ?? [];
      list.push({ email: a.email, file: f });
      where.set(id, list);
    }
  }
  // Links, to-dos and logins travel as one list doc per folder ("list:<folder>").
  const lists = new Map<string, { email: string; file: BackedUpFile }[]>();
  for (const a of accounts)
    for (const f of a.inventory?.files ?? [])
      if (f.key?.startsWith("list:")) lists.set(f.key.slice(5), [...(lists.get(f.key.slice(5)) ?? []), { email: a.email, file: f }]);
  for (const i of items) {
    if (!LIST_KINDS.has(i.kind) || where.has(i.id)) continue;
    const hit = lists.get(i.folderId ? `folder:${i.folderId}` : "unfiled");
    if (hit) where.set(i.id, hit);
  }
  const eligible = items;
  const missing = eligible.filter((i) => !where.has(i.id));
  return { where, backedUp: eligible.length - missing.length, missing };
}

export function formatBytes(n: number | null | undefined): string {
  if (n === null || n === undefined) return "Unlimited";
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB", "PB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2)} ${units[i]}`;
}
