"use client";

// ---------------------------------------------------------------------------
// The browser's door to DTF Studio's server, plus a small on-device file store
// so someone who has not signed in can still upload, design and come back to
// a draft. Local files live in IndexedDB as `local:<id>`; signing in uploads
// them and rewrites the design to the stored copies.
// ---------------------------------------------------------------------------

import type { AiReply, AssetKind, AssetRef, CustomerOrderView, DesignProject, ReadinessReport, ShippingDetails } from "./types";

export interface Capabilities {
  signedIn: boolean;
  email: string | null;
  owner: boolean;
  local: boolean;
  payments: "stripe" | "stripe-test" | "manual";
  ai: "live" | "offline";
  email_sending: boolean;
  storage: "cloud" | "local";
  shopName: string;
  pickupNote: string;
  safeWidthMm: number;
}

async function json<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, (body as { error?: string }).error ?? `Request failed (${res.status}).`);
  return body as T;
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export const api = {
  capabilities: () => fetch("/api/dtf/capabilities", { cache: "no-store" }).then((r) => json<Capabilities>(r)),
  projects: () => fetch("/api/dtf/me/projects", { cache: "no-store" }).then((r) => json<{ projects: DesignProject[] }>(r)),
  project: (id: string) => fetch(`/api/dtf/me/projects/${id}`, { cache: "no-store" }).then((r) => json<{ project: DesignProject }>(r)),
  saveProject: (project: DesignProject) =>
    fetch("/api/dtf/me/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ project }) }).then((r) =>
      json<{ project: DesignProject }>(r),
    ),
  deleteProject: (id: string) => fetch(`/api/dtf/me/projects/${id}`, { method: "DELETE" }).then((r) => json<{ ok: true }>(r)),
  upload: async (blob: Blob, kind: AssetKind, name: string, sourceAssetId?: string): Promise<{ asset: AssetRef }> => {
    // Large files go straight to storage through a signed URL (a function
    // body can't exceed 4.5 MB in production); small ones through the route.
    if (blob.size > 3_500_000) {
      const sign = await fetch("/api/dtf/me/assets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phase: "sign", kind, mime: blob.type, size: blob.size }),
      }).then((r) => json<{ mode: "signed" | "direct"; assetId?: string; uploadUrl?: string; staging?: string }>(r));
      if (sign.mode === "signed" && sign.uploadUrl) {
        const put = await fetch(sign.uploadUrl, { method: "PUT", body: blob, headers: { "Content-Type": blob.type || "application/octet-stream", "x-upsert": "true" } });
        if (!put.ok) throw new ApiError(put.status, "The upload didn't go through. Try again.");
        return fetch("/api/dtf/me/assets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phase: "confirm", kind, staging: sign.staging, assetId: sign.assetId, name, sourceAssetId }),
        }).then((r) => json<{ asset: AssetRef }>(r));
      }
    }
    const fd = new FormData();
    fd.append("file", blob, name);
    fd.append("kind", kind);
    if (sourceAssetId) fd.append("sourceAssetId", sourceAssetId);
    return fetch("/api/dtf/me/assets", { method: "POST", body: fd }).then((r) => json<{ asset: AssetRef }>(r));
  },
  ai: (body: {
    project: DesignProject;
    message: string;
    history: { role: "user" | "assistant"; content: string }[];
    referenceAssetIds: string[];
    readiness?: ReadinessReport;
    selectedLayerId?: string | null;
  }) => fetch("/api/dtf/me/ai", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => json<AiReply>(r)),
  checkout: (body: { lines: { project: DesignProject; quantity: number; mockups?: Record<string, string>; readiness?: ReadinessReport }[]; shipping: ShippingDetails; note?: string }) =>
    fetch("/api/dtf/me/checkout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) =>
      json<{ order: CustomerOrderView; checkoutUrl: string | null }>(r),
    ),
  orders: () => fetch("/api/dtf/me/orders", { cache: "no-store" }).then((r) => json<{ orders: CustomerOrderView[] }>(r)),
  order: (id: string, sessionId?: string | null) =>
    fetch(`/api/dtf/me/orders/${id}${sessionId ? `?session_id=${encodeURIComponent(sessionId)}` : ""}`, { cache: "no-store" }).then((r) =>
      json<{ order: CustomerOrderView }>(r),
    ),
  deleteAccountData: () => fetch("/api/dtf/me/account", { method: "DELETE" }).then((r) => json<{ projects: number; files: number; keptForOrders: number }>(r)),
};

// ----- on-device files -------------------------------------------------------------

const DB = "dtf-studio";
const STORE = "files";

function idb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export interface LocalFile {
  blob: Blob;
  name: string;
  mime: string;
  width: number;
  height: number;
}

export async function putLocal(id: string, file: LocalFile): Promise<void> {
  const db = await idb();
  if (!db) return;
  await new Promise<void>((res) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(file, id);
    tx.oncomplete = () => res();
    tx.onerror = () => res();
  });
}

export async function getLocal(id: string): Promise<LocalFile | null> {
  const db = await idb();
  if (!db) return null;
  return new Promise((res) => {
    const req = db.transaction(STORE).objectStore(STORE).get(id);
    req.onsuccess = () => res((req.result as LocalFile) ?? null);
    req.onerror = () => res(null);
  });
}

/** Object URLs for local files, created once per id per page load. */
const objectUrls = new Map<string, string>();
export async function localUrl(id: string): Promise<string | null> {
  const hit = objectUrls.get(id);
  if (hit) return hit;
  const f = await getLocal(id);
  if (!f) return null;
  const url = URL.createObjectURL(f.blob);
  objectUrls.set(id, url);
  return url;
}

// ----- drafts ---------------------------------------------------------------------------

const DRAFT_KEY = "dtf-studio:draft:v1";
const BAG_KEY = "dtf-studio:bag:v1";

/**
 * Store image layers as `local:<assetId>` (object URLs die with the page),
 * keep served URLs as they are.
 */
export function serializeDraft(p: DesignProject): string {
  return JSON.stringify({
    ...p,
    layers: p.layers.map((l) => (l.kind === "image" && l.src.startsWith("blob:") ? { ...l, src: `local:${l.assetId}` } : l)),
  });
}

export async function hydrateDraft(raw: string): Promise<DesignProject | null> {
  try {
    const p = JSON.parse(raw) as DesignProject;
    const layers = await Promise.all(
      p.layers.map(async (l) => {
        if (l.kind !== "image" || !l.src.startsWith("local:")) return l;
        const url = await localUrl(l.src.slice(6));
        return url ? { ...l, src: url } : null;
      }),
    );
    return { ...p, layers: layers.filter((l): l is NonNullable<typeof l> => l !== null) };
  } catch {
    return null;
  }
}

export function saveDraftLocal(p: DesignProject): void {
  try {
    localStorage.setItem(DRAFT_KEY, serializeDraft(p));
  } catch {
    /* storage full or blocked — the cloud copy (if signed in) still saves */
  }
}

export function loadDraftLocal(): string | null {
  try {
    return localStorage.getItem(DRAFT_KEY);
  } catch {
    return null;
  }
}

export interface BagLine {
  id: string;
  project: DesignProject;
  quantity: number;
  /** Mockup data URL for the bag thumbnail (uploaded as an asset at checkout). */
  thumb?: string;
  readiness?: ReadinessReport;
}

export function loadBag(): BagLine[] {
  try {
    const raw = localStorage.getItem(BAG_KEY);
    return raw ? (JSON.parse(raw) as BagLine[]) : [];
  } catch {
    return [];
  }
}

export function saveBag(lines: BagLine[]): void {
  try {
    localStorage.setItem(BAG_KEY, JSON.stringify(lines.map((l) => ({ ...l, project: JSON.parse(serializeDraft(l.project)) }))));
  } catch {
    /* ignore */
  }
}

/** Read an image file's pixel size in the browser. */
export async function imageSize(blob: Blob): Promise<{ width: number; height: number } | null> {
  try {
    if (blob.type === "image/svg+xml") {
      const text = await blob.text();
      const vb = text.match(/viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
      const w = text.match(/<svg[^>]*\bwidth\s*=\s*["']([\d.]+)(px)?["']/i);
      const h = text.match(/<svg[^>]*\bheight\s*=\s*["']([\d.]+)(px)?["']/i);
      if (w && h) return { width: Math.round(+w[1]), height: Math.round(+h[1]) };
      if (vb) return { width: Math.round(+vb[1]), height: Math.round(+vb[2]) };
      return { width: 1000, height: 1000 };
    }
    const bmp = await createImageBitmap(blob);
    const out = { width: bmp.width, height: bmp.height };
    bmp.close();
    return out;
  } catch {
    return null;
  }
}
