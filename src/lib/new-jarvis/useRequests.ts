"use client";

// ---------------------------------------------------------------------------
// In Queue requests in the browser.
//
// The server document is the truth, because Claude Code on the PC or VPS
// completes requests through the connector and the board has to notice by
// itself: it re-reads every POLL_MS while the page is visible and whenever it
// comes back into view. No refresh button — a finished request just leaves.
//
// Signed out, or on a host that cannot keep the document, the same pure
// functions run over localStorage instead, so the folder still works on this
// device and says so.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadLocal, saveLocal } from "@/lib/sync/appState";
import {
  EMPTY_DOC,
  addRequests,
  completeRequest,
  normalizeDoc,
  openCounts,
  releaseRequest,
  removeRequest,
  reopenRequest,
  RequestError,
  type QueueRequest,
  type RequestsDoc,
} from "./requests";

const LOCAL_KEY = "nj.queue-requests.v1";
const POLL_MS = 15_000;

export interface UseRequests {
  doc: RequestsDoc;
  counts: Record<string, number>;
  /** Total waiting, across every folder. */
  total: number;
  /** False until the first read lands. */
  ready: boolean;
  /** True when this device is the only place they are kept. */
  localOnly: boolean;
  error: string | null;
  add: (folder: string, text: string, images?: string[]) => Promise<QueueRequest[]>;
  complete: (id: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  reopen: (id: string) => Promise<void>;
  release: (id: string) => Promise<void>;
}

type Action =
  | { action: "add"; folder: string; text: string; images: string[] }
  | { action: "complete" | "remove" | "reopen" | "release"; id: string };

function applyLocal(doc: RequestsDoc, a: Action): { doc: RequestsDoc; added: QueueRequest[] } {
  switch (a.action) {
    case "add":
      return addRequests(doc, { folder: a.folder, text: a.text, images: a.images });
    case "complete":
      return { doc: completeRequest(doc, a.id, "you"), added: [] };
    case "remove":
      return { doc: removeRequest(doc, a.id), added: [] };
    case "reopen":
      return { doc: reopenRequest(doc, a.id), added: [] };
    case "release":
      return { doc: releaseRequest(doc, a.id), added: [] };
  }
}

export function useRequests(): UseRequests {
  const [doc, setDoc] = useState<RequestsDoc>(EMPTY_DOC);
  const [ready, setReady] = useState(false);
  const [localOnly, setLocalOnly] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const local = useRef(false);

  const pull = useCallback(async () => {
    try {
      const res = await fetch("/api/new-jarvis/requests", { cache: "no-store" });
      const data = (await res.json()) as { doc?: unknown; error?: string };
      if (!res.ok || !data.doc) throw new Error(data.error || "unavailable");
      local.current = false;
      setLocalOnly(false);
      setDoc(normalizeDoc(data.doc));
      setError(null);
    } catch {
      // Not signed in, or no server storage: keep them on this device.
      local.current = true;
      setLocalOnly(true);
      setDoc(normalizeDoc(loadLocal<RequestsDoc>(LOCAL_KEY, EMPTY_DOC)));
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    void pull();
    const tick = () => {
      if (document.visibilityState === "visible") void pull();
    };
    const timer = setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    window.addEventListener("focus", tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
      window.removeEventListener("focus", tick);
    };
  }, [pull]);

  const send = useCallback(async (a: Action): Promise<QueueRequest[]> => {
    setError(null);
    if (local.current) {
      try {
        const r = applyLocal(normalizeDoc(loadLocal<RequestsDoc>(LOCAL_KEY, EMPTY_DOC)), a);
        saveLocal(LOCAL_KEY, r.doc);
        setDoc(r.doc);
        return r.added;
      } catch (e) {
        setError(e instanceof RequestError ? e.message : "Couldn't save that.");
        return [];
      }
    }
    try {
      const res = await fetch("/api/new-jarvis/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(a),
      });
      const data = (await res.json()) as { doc?: unknown; added?: QueueRequest[]; error?: string };
      if (!res.ok || !data.doc) {
        setError(data.error || "Couldn't save that.");
        return [];
      }
      setDoc(normalizeDoc(data.doc));
      return data.added ?? [];
    } catch {
      setError("Couldn't reach Jarvis. Check your connection and try again.");
      return [];
    }
  }, []);

  const counts = useMemo(() => openCounts(doc), [doc]);

  return {
    doc,
    counts,
    total: doc.requests.length,
    ready,
    localOnly,
    error,
    add: (folder, text, images = []) => send({ action: "add", folder, text, images }),
    complete: async (id) => void (await send({ action: "complete", id })),
    remove: async (id) => void (await send({ action: "remove", id })),
    reopen: async (id) => void (await send({ action: "reopen", id })),
    release: async (id) => void (await send({ action: "release", id })),
  };
}

/**
 * A picked file → a JPEG data URL no wider or taller than `max`, so four of
 * them fit in one request and a phone photo does not cost megabytes.
 */
export async function shrinkImage(file: File | Blob, max = 1280, quality = 0.82): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("That file isn't a picture this browser can open."));
      el.src = url;
    });
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const c = canvas.getContext("2d");
    if (!c) throw new Error("This browser can't resize pictures.");
    // Character art with a transparent background keeps it when it still fits
    // — that transparency is what lets a drawing be cut into puppet parts.
    if (file.type === "image/png") {
      c.drawImage(img, 0, 0, canvas.width, canvas.height);
      const png = canvas.toDataURL("image/png");
      if (png.length <= 880_000) return png;
      c.clearRect(0, 0, canvas.width, canvas.height);
    }
    // Otherwise a JPEG, with transparent areas landing on white rather than black.
    c.fillStyle = "#ffffff";
    c.fillRect(0, 0, canvas.width, canvas.height);
    c.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", quality);
  } finally {
    URL.revokeObjectURL(url);
  }
}
