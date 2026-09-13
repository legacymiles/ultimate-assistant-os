/* eslint-disable @typescript-eslint/no-explicit-any */
import { accessToken, driveClientConfigured, driveJson } from "@/lib/recall/drive";
import type { DriveEntry } from "./plan";

// ---------------------------------------------------------------------------
// The handful of Drive calls the backup needs: list this app's files, create
// one, and change one (rename, move, replace its contents).
//
// Still the `drive.file` scope, deliberately. It lets the app see and change
// only files it created itself — so a backup can never read, move or delete
// anything else in the user's Drive, including a folder they happen to have
// named "Ultimate Assistant OS" by hand.
// ---------------------------------------------------------------------------

/** Signing in needs only the client id; the Picker's API key is not used here. */
export function backupConfigured(): boolean {
  return driveClientConfigured();
}

export function folderUrl(id: string): string {
  return `https://drive.google.com/drive/folders/${id}`;
}

/**
 * A failed Drive request, in words the user can act on.
 *
 * Drive answers a misconfigured project with a long JSON error. The one that
 * matters most on first setup — the Drive API was never switched on for the
 * Google Cloud project — is common, and fixable in one click once named.
 */
export function explainDriveFailure(message: string): string {
  if (/accessNotConfigured|has not been used in project|Drive API.*disabled|SERVICE_DISABLED/i.test(message)) {
    return (
      "The Google Drive API is not turned on for your Google Cloud project. In Google Cloud, open " +
      "APIs & Services, then Library, enable Google Drive API, wait a minute, and try again."
    );
  }
  if (/Drive 401/.test(message)) {
    return "Google's approval expired. Tap the button again to re-approve.";
  }
  if (/Drive 403/.test(message) && /insufficient|scope/i.test(message)) {
    return "Google did not grant Drive access. Tap the button again and allow access when Google asks.";
  }
  return message;
}

/** Every live file and folder carrying this app's marker. */
export async function listAppEntries(appValue: string): Promise<DriveEntry[]> {
  const token = await accessToken();
  const q = `trashed = false and appProperties has { key='dashboardApp' and value='${appValue}' }`;
  const fields = "nextPageToken,files(id,name,parents,mimeType,appProperties)";
  const out: DriveEntry[] = [];
  let pageToken = "";
  do {
    const url =
      "https://www.googleapis.com/drive/v3/files" +
      `?q=${encodeURIComponent(q)}&fields=${encodeURIComponent(fields)}&pageSize=1000` +
      (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : "");
    const res = await driveJson(url, token);
    out.push(...((res.files ?? []) as DriveEntry[]));
    pageToken = res.nextPageToken ?? "";
  } while (pageToken);
  return out;
}

interface Media {
  body: Blob | string;
  mime: string;
}

function multipart(metadata: object, media: Media): Blob {
  const boundary = `uaos${Math.random().toString(36).slice(2)}`;
  return new Blob(
    [
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`,
      `--${boundary}\r\nContent-Type: ${media.mime}\r\n\r\n`,
      media.body,
      `\r\n--${boundary}--\r\n`,
    ],
    { type: `multipart/related; boundary=${boundary}` },
  );
}

/** Create a file or folder. Returns its Drive id. */
export async function createEntry(
  meta: { name: string; parents?: string[]; mimeType?: string; appProperties: Record<string, string> },
  media?: Media,
): Promise<string> {
  const token = await accessToken();
  if (!media) {
    const res = await driveJson("https://www.googleapis.com/drive/v3/files?fields=id", token, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(meta),
    });
    return res.id as string;
  }
  const res = await driveJson(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id",
    token,
    { method: "POST", body: multipart(meta, media) },
  );
  return res.id as string;
}

/** Rename, move, retag and/or replace the contents of an existing file. */
export async function updateEntry(
  id: string,
  meta: { name?: string; appProperties?: Record<string, string> },
  opts: { addParent?: string; removeParent?: string; media?: Media } = {},
): Promise<void> {
  const token = await accessToken();
  const params = new URLSearchParams({ fields: "id" });
  if (opts.addParent) params.set("addParents", opts.addParent);
  if (opts.removeParent) params.set("removeParents", opts.removeParent);

  if (!opts.media) {
    await driveJson(`https://www.googleapis.com/drive/v3/files/${id}?${params}`, token, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(meta),
    });
    return;
  }
  params.set("uploadType", "multipart");
  await driveJson(`https://www.googleapis.com/upload/drive/v3/files/${id}?${params}`, token, {
    method: "PATCH",
    body: multipart(meta, opts.media),
  });
}
