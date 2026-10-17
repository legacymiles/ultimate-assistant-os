"use client";

// ---------------------------------------------------------------------------
// The browser half of Chat attachments: read the file, make what the model
// sees, and upload the bytes that are too big to ride in the request.
//
// Pictures, clip frames and the audio measurements come from the same code the
// Studio chat already uses (lib/jarvis/chatImages.ts), so a picture is shrunk
// one way across the hub.
// ---------------------------------------------------------------------------

import { useCallback, useRef, useState } from "react";
import { toAttachment } from "@/lib/jarvis/chatImages";
import {
  INLINE_FILE_BYTES,
  MAX_ATTACHMENTS,
  kindOf,
  needsUpload,
  refusal,
  TEXT_CHARS,
  type ChatAttachment,
} from "./attachments";

function dataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("The browser could not read that file."));
    r.readAsDataURL(file);
  });
}

/** Put the bytes in Storage (or on the local hub's disk) and return the key. */
export async function uploadAttachment(file: File, signal?: AbortSignal): Promise<string> {
  const mime = file.type || "application/octet-stream";
  const res = await fetch("/api/new-jarvis/attachments", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: file.name, mime, size: file.size }),
    signal,
  });
  const target = (await res.json().catch(() => ({}))) as { key?: string; url?: string; error?: string };
  if (!res.ok || !target.key || !target.url) throw new Error(target.error ?? `Upload could not start (${res.status}).`);
  const put = await fetch(target.url, {
    method: "PUT",
    headers: { "Content-Type": mime, "x-upsert": "true" },
    body: file,
    signal,
  });
  if (!put.ok) throw new Error(`Upload failed (${put.status}).`);
  return target.key;
}

const uid = () => `a_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

/**
 * The tray of attachments under the command line.
 *
 * Each file shows up at once as a chip in "reading" state, so a 40 MB clip is
 * visibly on its way rather than looking like the button did nothing.
 */
export function useAttachments() {
  const [items, setItems] = useState<ChatAttachment[]>([]);
  const itemsRef = useRef<ChatAttachment[]>([]);
  const set = useCallback((fn: (list: ChatAttachment[]) => ChatAttachment[]) => {
    setItems((list) => {
      const next = fn(list);
      itemsRef.current = next;
      return next;
    });
  }, []);
  const patch = useCallback(
    (id: string, p: Partial<ChatAttachment>) => set((list) => list.map((a) => (a.id === id ? { ...a, ...p } : a))),
    [set],
  );

  const add = useCallback(
    async (files: File[]) => {
      const room = MAX_ATTACHMENTS - itemsRef.current.length;
      for (const file of files.slice(0, Math.max(0, room))) {
        const id = uid();
        const kind = kindOf(file.type, file.name);
        const why = refusal(file.name || "That file", file.size, kind);
        const base: ChatAttachment = {
          id,
          name: file.name || "attachment",
          kind: kind ?? "text",
          mime: file.type || "application/octet-stream",
          size: file.size,
          state: why ? "failed" : "reading",
          ...(why ? { error: why } : {}),
        };
        set((list) => [...list, base]);
        if (why || !kind) continue;

        try {
          const p: Partial<ChatAttachment> = {};
          if (kind === "text") {
            p.text = (await file.text()).slice(0, TEXT_CHARS + 1);
          } else if (kind === "image" || kind === "video" || kind === "audio") {
            const seen = await toAttachment(file, id);
            p.thumb = seen.thumb;
            if (kind !== "audio") p.picture = seen.full;
            if (seen.durationSec) p.durationSec = seen.durationSec;
            if (seen.note) p.note = seen.note;
          }

          // Inline budget is what the OTHER ready attachments already carry.
          const used = itemsRef.current
            .filter((a) => a.id !== id && a.inline)
            .reduce((n, a) => n + a.size, 0);
          if (!needsUpload(kind, file.size, used)) {
            if (kind !== "image" && kind !== "text" && file.size <= INLINE_FILE_BYTES) p.inline = await dataUrl(file);
            patch(id, { ...p, state: "ready" });
            continue;
          }

          patch(id, { ...p, state: "uploading" });
          try {
            const key = await uploadAttachment(file);
            patch(id, { key, state: "ready" });
          } catch (e) {
            const msg = e instanceof Error ? e.message : "Upload failed.";
            // A clip still has its frame, which is worth sending; saying so is
            // better than dropping it or pretending the whole clip went.
            if (kind === "video" && p.picture) patch(id, { state: "ready", error: `${msg} Only a still frame will be sent.` });
            else patch(id, { state: "failed", error: msg });
          }
        } catch (e) {
          patch(id, { state: "failed", error: e instanceof Error ? e.message : "Could not read that file." });
        }
      }
    },
    [patch, set],
  );

  const remove = useCallback((id: string) => set((list) => list.filter((a) => a.id !== id)), [set]);
  const clear = useCallback(() => set(() => []), [set]);
  const busy = items.some((a) => a.state === "reading" || a.state === "uploading");

  return { items, add, remove, clear, busy, itemsRef };
}

/** Files out of a paste or a drop. */
export function droppedFiles(list: DataTransfer | null): File[] {
  return list ? Array.from(list.files) : [];
}
