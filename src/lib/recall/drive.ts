/* eslint-disable @typescript-eslint/no-explicit-any */
// ---------------------------------------------------------------------------
// Recall — Google Drive "pick & import".
// Uses Google Identity Services (token client, drive.file scope) + the Picker
// API so the user hand-selects exactly which files enter — the lightest OAuth
// footprint (no broad scopes, no background sync). Picked files are downloaded
// and handed to the normal capture pipeline.
//
// Requires two public env vars; without them the UI shows a friendly setup note
// instead of a broken button:
//   NEXT_PUBLIC_GOOGLE_CLIENT_ID   (OAuth 2.0 Web client id)
//   NEXT_PUBLIC_GOOGLE_API_KEY     (Picker developer key)
// ---------------------------------------------------------------------------

const CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "";
const API_KEY = process.env.NEXT_PUBLIC_GOOGLE_API_KEY ?? "";
const SCOPE = "https://www.googleapis.com/auth/drive.file";

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  /** Extracted text for docs/text files. */
  text?: string;
  /** Data URL for images. */
  dataUrl?: string;
  /** Human-openable link. */
  url?: string;
}

export function driveConfigured(): boolean {
  return Boolean(CLIENT_ID && API_KEY);
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(s);
  });
}

let pickerReady = false;
async function ensureLibraries(): Promise<void> {
  await Promise.all([
    loadScript("https://accounts.google.com/gsi/client"),
    loadScript("https://apis.google.com/js/api.js"),
  ]);
  if (!pickerReady) {
    await new Promise<void>((resolve) => (window as any).gapi.load("picker", () => resolve()));
    pickerReady = true;
  }
}

/**
 * Access tokens last an hour; caching one in memory is the difference between
 * a silent backup of forty photos and forty consent round-trips. Never
 * persisted — a token in localStorage is a token someone else can read.
 */
let cachedToken: { token: string; expires: number } | null = null;

function requestToken(): Promise<string> {
  return new Promise((resolve, reject) => {
    const tokenClient = (window as any).google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPE,
      callback: (resp: any) => {
        if (resp?.access_token) {
          const ttl = Number(resp.expires_in ?? 3600) * 1000;
          // Retire it a minute early rather than discovering it expired
          // halfway through a multi-file upload.
          cachedToken = { token: resp.access_token, expires: Date.now() + ttl - 60_000 };
          resolve(resp.access_token as string);
        } else reject(new Error("Drive authorization was cancelled."));
      },
    });
    tokenClient.requestAccessToken({ prompt: "" });
  });
}

function openPicker(token: string): Promise<any[]> {
  return new Promise((resolve) => {
    const google = (window as any).google;
    const view = new google.picker.DocsView(google.picker.ViewId.DOCS)
      .setIncludeFolders(true)
      .setSelectFolderEnabled(false);
    const picker = new google.picker.PickerBuilder()
      .enableFeature(google.picker.Feature.MULTISELECT_ENABLED)
      .setOAuthToken(token)
      .setDeveloperKey(API_KEY)
      .addView(view)
      .setCallback((data: any) => {
        if (data.action === google.picker.Action.PICKED) resolve(data.docs ?? []);
        else if (data.action === google.picker.Action.CANCEL) resolve([]);
      })
      .build();
    picker.setVisible(true);
  });
}

async function downloadFile(doc: any, token: string): Promise<DriveFile> {
  const id = doc.id as string;
  const name = (doc.name as string) ?? "Untitled";
  const mimeType = (doc.mimeType as string) ?? "application/octet-stream";
  const url = (doc.url as string) ?? `https://drive.google.com/file/d/${id}/view`;
  const auth = { Authorization: `Bearer ${token}` };

  try {
    if (mimeType.startsWith("application/vnd.google-apps.")) {
      // Native Google Doc — export to plain text.
      const res = await fetch(
        `https://www.googleapis.com/drive/v3/files/${id}/export?mimeType=text/plain`,
        { headers: auth },
      );
      return { id, name, mimeType, url, text: res.ok ? await res.text() : name };
    }
    if (mimeType.startsWith("image/")) {
      const res = await fetch(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`, { headers: auth });
      if (!res.ok) return { id, name, mimeType, url };
      const blob = await res.blob();
      const dataUrl = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result ?? ""));
        reader.readAsDataURL(blob);
      });
      return { id, name, mimeType, url, dataUrl };
    }
    if (mimeType.startsWith("text/") || mimeType === "application/json") {
      const res = await fetch(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`, { headers: auth });
      return { id, name, mimeType, url, text: res.ok ? await res.text() : name };
    }
  } catch {
    /* fall through to metadata-only */
  }
  // Unsupported binary (pdf, zip…): keep the name + link; classify on the name.
  return { id, name, mimeType, url, text: name };
}

/** Full flow: auth → picker → download each selection. Returns [] if cancelled. */
export async function pickFromDrive(): Promise<DriveFile[]> {
  if (!driveConfigured()) throw new Error("Google Drive is not configured.");
  await ensureLibraries();
  const token = await requestToken();
  const docs = await openPicker(token);
  const files: DriveFile[] = [];
  for (const doc of docs) files.push(await downloadFile(doc, token));
  return files;
}

// ---------------------------------------------------------------------------
// Backup — the other direction.
//
// Picking files out of Drive needs `drive.file`; so does putting them back, and
// that is a happy accident worth stating: `drive.file` grants access ONLY to
// files this app created or the user hand-picked. Recall can therefore write a
// full photo backup without ever being able to read the rest of the user's
// Drive. No broader scope is requested, and none is needed.
// ---------------------------------------------------------------------------

const FOLDER_MIME = "application/vnd.google-apps.folder";

/** A live token, from cache when one is still good. */
async function accessToken(): Promise<string> {
  if (cachedToken && cachedToken.expires > Date.now()) return cachedToken.token;
  await ensureLibraries();
  return requestToken();
}

/** Ask Drive to authorize now, so a long backup does not stall on consent. */
export async function primeDriveAuth(): Promise<void> {
  if (!driveConfigured()) throw new Error("Google Drive is not configured.");
  await accessToken();
}

async function driveJson(url: string, token: string, init?: RequestInit): Promise<any> {
  const res = await fetch(url, {
    ...init,
    headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Drive ${res.status}: ${await res.text()}`);
  return res.json();
}

/**
 * The id of a folder with this name under `parentId`, creating it if needed.
 *
 * The lookup only ever sees app-created files (that is what `drive.file` means),
 * which is exactly right here: we want OUR "Recall Photos" folder, not a
 * same-named one the user made by hand.
 */
export async function ensureDriveFolder(name: string, parentId?: string | null): Promise<string> {
  const token = await accessToken();
  const q = [
    `name = '${name.replace(/'/g, "\'")}'`,
    `mimeType = '${FOLDER_MIME}'`,
    "trashed = false",
    parentId ? `'${parentId}' in parents` : "'root' in parents",
  ].join(" and ");
  const found = await driveJson(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=1`,
    token,
  );
  if (found.files?.[0]?.id) return found.files[0].id as string;

  const created = await driveJson("https://www.googleapis.com/drive/v3/files?fields=id", token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      mimeType: FOLDER_MIME,
      ...(parentId ? { parents: [parentId] } : {}),
    }),
  });
  return created.id as string;
}

/** Upload one blob into a Drive folder. Returns the new file's id. */
export async function uploadToDrive(
  blob: Blob,
  name: string,
  folderId: string,
): Promise<string> {
  const token = await accessToken();
  const boundary = `recall${Math.random().toString(36).slice(2)}`;
  const metadata = JSON.stringify({ name, parents: [folderId] });
  const body = new Blob(
    [
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`,
      `--${boundary}\r\nContent-Type: ${blob.type || "application/octet-stream"}\r\n\r\n`,
      blob,
      `\r\n--${boundary}--\r\n`,
    ],
    { type: `multipart/related; boundary=${boundary}` },
  );
  const out = await driveJson(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id",
    token,
    { method: "POST", body },
  );
  return out.id as string;
}

export interface BackupTarget {
  /** The blob to upload. */
  blob: Blob;
  name: string;
  /** Sub-folder under the backup root, e.g. "Me & My Son". "" = the root. */
  category: string;
}

export interface BackupProgress {
  done: number;
  total: number;
  current: string;
}

export interface BackupResult {
  rootId: string;
  uploaded: { name: string; driveId: string }[];
  failed: { name: string; error: string }[];
}

/**
 * Back a set of photos up to Drive, mirroring the category folders.
 *
 * Uploads run one at a time on purpose. A camera-roll backup is a background
 * chore, and firing dozens of parallel multipart uploads is the reliable way to
 * hit Drive's rate limiter and lose half the batch. One failure never stops the
 * run — it is collected and reported so the user can retry just those.
 */
export async function backupPhotos(
  targets: BackupTarget[],
  opts: { rootName?: string; mirrorCategories?: boolean; onProgress?: (p: BackupProgress) => void } = {},
): Promise<BackupResult> {
  if (!driveConfigured()) throw new Error("Google Drive is not configured.");
  const rootId = await ensureDriveFolder(opts.rootName ?? "Recall Photos", null);
  const subIds = new Map<string, string>();
  const result: BackupResult = { rootId, uploaded: [], failed: [] };

  let done = 0;
  for (const t of targets) {
    opts.onProgress?.({ done, total: targets.length, current: t.name });
    try {
      let parent = rootId;
      if (opts.mirrorCategories !== false && t.category) {
        const cached = subIds.get(t.category);
        parent = cached ?? (await ensureDriveFolder(t.category, rootId));
        subIds.set(t.category, parent);
      }
      const driveId = await uploadToDrive(t.blob, t.name, parent);
      result.uploaded.push({ name: t.name, driveId });
    } catch (err) {
      result.failed.push({ name: t.name, error: err instanceof Error ? err.message : "Upload failed" });
    }
    done++;
    opts.onProgress?.({ done, total: targets.length, current: t.name });
  }
  return result;
}
