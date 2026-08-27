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

function requestToken(): Promise<string> {
  return new Promise((resolve, reject) => {
    const tokenClient = (window as any).google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPE,
      callback: (resp: any) => {
        if (resp?.access_token) resolve(resp.access_token as string);
        else reject(new Error("Drive authorization was cancelled."));
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
