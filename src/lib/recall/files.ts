// ---------------------------------------------------------------------------
// Recall — file storage + reading.
//
// Blobs go to IndexedDB, never localStorage. localStorage holds ~5MB total and
// a single PDF or a phone photo would eat it; IndexedDB gives us hundreds of MB
// and hands back real Blobs for preview and download.
//
// What we store vs. what we READ are different things. Everything is stored.
// Everything except video is also read into `item.extract`, which is what the
// search index and the agent actually reason over — the whole point of the RAG
// is that you do not have to remember what was inside the file.
// ---------------------------------------------------------------------------

const DB_NAME = "recall-files";
const DB_VERSION = 1;
const STORE = "blobs";

/** Refuse anything that would be miserable to hold in the browser. */
export const MAX_FILE_BYTES = 100 * 1024 * 1024; // 100MB

export type FileCategory = "image" | "video" | "pdf" | "doc" | "sheet" | "file";

export function categorize(name: string, type = ""): FileCategory {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (type.startsWith("image/") || ["png", "jpg", "jpeg", "gif", "webp", "avif", "svg"].includes(ext))
    return "image";
  if (type.startsWith("video/") || ["mp4", "mov", "webm", "avi", "mkv", "m4v"].includes(ext))
    return "video";
  if (type === "application/pdf" || ext === "pdf") return "pdf";
  if (["docx", "doc", "odt", "rtf", "txt", "md", "markdown", "json", "csv", "log"].includes(ext))
    return ext === "csv" ? "sheet" : "doc";
  if (type.startsWith("text/")) return "doc";
  return "file";
}

/** Video is stored but never read — everything else we try to extract. */
export function isReadable(category: FileCategory): boolean {
  return category !== "video" && category !== "file";
}

// ----- IndexedDB -----------------------------------------------------------

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("This browser has no IndexedDB, so files cannot be stored."));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Could not open the file store."));
  });
}

function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = fn(t.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error("File store operation failed."));
        t.oncomplete = () => db.close();
      }),
  );
}

export async function putFile(id: string, blob: Blob): Promise<void> {
  await tx("readwrite", (s) => s.put(blob, id));
}

export async function getFile(id: string): Promise<Blob | null> {
  const out = await tx<Blob | undefined>("readonly", (s) => s.get(id));
  return out ?? null;
}

export async function deleteFile(id: string): Promise<void> {
  await tx("readwrite", (s) => s.delete(id));
}

/** Every blob key currently held — used to sweep orphans. */
export async function allFileIds(): Promise<string[]> {
  const keys = await tx<IDBValidKey[]>("readonly", (s) => s.getAllKeys());
  return keys.map(String);
}

/** Drop blobs no item references any more. */
export async function pruneOrphans(referenced: Set<string>): Promise<number> {
  let removed = 0;
  for (const id of await allFileIds()) {
    if (!referenced.has(id)) {
      await deleteFile(id);
      removed++;
    }
  }
  return removed;
}

/** Open a stored file in a new tab; the object URL is revoked afterwards. */
export async function openStoredFile(fileId: string, name: string): Promise<void> {
  const blob = await getFile(fileId);
  if (!blob) throw new Error("That file is no longer in local storage.");
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.target = "_blank";
  a.rel = "noopener";
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

// ----- reading -------------------------------------------------------------

const INLINE_PREVIEW_MAX_DIM = 320;

/** A small JPEG thumbnail for the row — kept in localStorage, so keep it tiny. */
export function thumbnail(file: File): Promise<string | undefined> {
  return new Promise((resolve) => {
    if (!file.type.startsWith("image/")) return resolve(undefined);
    const reader = new FileReader();
    reader.onerror = () => resolve(undefined);
    reader.onload = () => {
      const img = new window.Image();
      img.onerror = () => resolve(undefined);
      img.onload = () => {
        const scale = Math.min(1, INLINE_PREVIEW_MAX_DIM / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext("2d");
        if (!ctx) return resolve(undefined);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.7));
      };
      img.src = String(reader.result ?? "");
    };
    reader.readAsDataURL(file);
  });
}

function readAsText(file: File): Promise<string> {
  return new Promise((resolve) => {
    const r = new FileReader();
    r.onerror = () => resolve("");
    r.onload = () => resolve(String(r.result ?? ""));
    r.readAsText(file);
  });
}

export interface Extraction {
  text: string;
  status: "ok" | "unsupported" | "failed";
}

/**
 * Pull readable text out of a file.
 * Plain text is read in the browser; PDFs and Word docs go to the server (which
 * has pdf-parse and mammoth); images go to a vision model when a key is set.
 * Video is declared unsupported rather than silently returning nothing.
 */
export async function extractText(file: File, category: FileCategory): Promise<Extraction> {
  if (category === "video") return { text: "", status: "unsupported" };

  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (["txt", "md", "markdown", "json", "csv", "log"].includes(ext) || file.type.startsWith("text/")) {
    const text = (await readAsText(file)).trim();
    return text ? { text, status: "ok" } : { text: "", status: "failed" };
  }

  try {
    const form = new FormData();
    form.append("file", file);
    form.append("category", category);
    const res = await fetch("/api/recall/extract", { method: "POST", body: form });
    if (!res.ok) return { text: "", status: "failed" };
    const data = (await res.json()) as { text?: string; status?: Extraction["status"] };
    const text = (data.text ?? "").trim();
    return { text, status: data.status ?? (text ? "ok" : "failed") };
  } catch {
    return { text: "", status: "failed" };
  }
}
