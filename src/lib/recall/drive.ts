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

/**
 * True when Drive can be used at all.
 *
 * Only the client id is required, and that distinction matters: signing in and
 * uploading need `CLIENT_ID` alone, while ONLY the Picker — choosing files OUT
 * of Drive — needs the developer key as well. Requiring both here is what used
 * to make the Photos tab announce "Google Drive isn't set up" on a deployment
 * where the Folders tab was happily backing up.
 */
export function driveConfigured(): boolean {
  return Boolean(CLIENT_ID);
}

/** True when the Picker can be opened too. Needs the developer key on top. */
export function drivePickerConfigured(): boolean {
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
export async function ensureLibraries(): Promise<void> {
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
        } else reject(new Error(explainGoogleError(resp?.error, resp?.error_description)));
      },
      // Without this, a blocked or closed Google window left the promise pending
      // forever: the caller never heard back, and the backup card spun on
      // "Checking what is already on Drive…" with no explanation at all.
      error_callback: (err: any) => reject(new Error(explainGoogleError(err?.type, err?.message))),
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
  if (!drivePickerConfigured()) {
    throw new Error(
      "Picking files out of Drive also needs NEXT_PUBLIC_GOOGLE_API_KEY. Backing up works without it.",
    );
  }
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
// files this app created or the user hand-picked. Dashboard can therefore write
// a full backup without ever being able to read the rest of the user's Drive.
// No broader scope is requested, and none is needed.
//
// This file stops at the TOKEN. What actually gets written — folders, files,
// versions, and the ids that stop a rename becoming a second copy — lives in
// lib/dashboard/driveBackup, and there is exactly one of it: photos and notes
// go into the same tree, in the same shape, through the same code.
// ---------------------------------------------------------------------------

/** A live token, from cache when one is still good. */
export async function accessToken(): Promise<string> {
  if (cachedToken && cachedToken.expires > Date.now()) return cachedToken.token;
  await ensureLibraries();
  return requestToken();
}

/** Ask Drive to authorize now, so a long backup does not stall on consent. */
export async function primeDriveAuth(): Promise<void> {
  if (!driveConfigured()) throw new Error("Google Drive is not configured.");
  await accessToken();
}

export async function driveJson(url: string, token: string, init?: RequestInit): Promise<any> {
  const res = await fetch(url, {
    ...init,
    headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Drive ${res.status}: ${await res.text()}`);
  return res.json();
}

/** True when the client id needed to sign in exists. Backing up does not need the Picker's API key. */
export function driveClientConfigured(): boolean {
  return driveConfigured();
}

/**
 * True while a Drive approval from this visit is still valid.
 *
 * An automatic backup checks this first. Asking Google for a new token opens a
 * consent window, and a window that pops up with no click behind it is blocked
 * by the browser — so an automatic run waits for the user instead.
 */
export function driveTokenLive(): boolean {
  return Boolean(cachedToken && cachedToken.expires > Date.now());
}

/**
 * A Google sign-in failure, in words the user can act on.
 *
 * The raw codes ("popup_failed_to_open", "access_denied") mean nothing to
 * someone who just clicked a button, and most of them point at one specific
 * setting in Google Cloud Console — so the message names that setting.
 */
export function explainGoogleError(code?: string, detail?: string): string {
  switch (code) {
    case "popup_failed_to_open":
      return "Your browser blocked Google's sign-in window. Allow pop-ups for this site, then tap the button again.";
    case "popup_closed":
      return (
        "Google's sign-in window closed before finishing. If it showed an error such as " +
        "origin_mismatch or access denied, fix that setting in Google Cloud and try again."
      );
    case "access_denied":
      return (
        "Google refused access. In Google Cloud, open OAuth consent screen, then Test users, " +
        "and add the Google account you are signing in with."
      );
    case "origin_mismatch":
    case "invalid_request":
      return (
        "Google does not recognise this website. In Google Cloud, open Credentials, edit the " +
        `OAuth client, and add ${typeof window === "undefined" ? "this site's address" : window.location.origin} ` +
        "under Authorized JavaScript origins."
      );
    default:
      return `Google sign-in failed${code ? ` (${code})` : ""}${detail ? `: ${detail}` : ""}.`;
  }
}
