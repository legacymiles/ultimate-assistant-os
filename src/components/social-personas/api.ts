// Thin client for /api/social-personas/*. Every call returns { ok, data | error }
// so the UI can show the server's own words.

import type { Brain, ConnectablePlatform, DraftMedia, Idea, Persona, Post } from "@/lib/social-personas/types";
import type { PostAnalysis } from "@/lib/social-personas/logic";
import type { Job } from "@/lib/social-personas/queue";

type Result<T> = { ok: true; data: T } | { ok: false; error: string; status: number; extra?: Record<string, unknown> };

async function call<T>(path: string, body?: unknown): Promise<Result<T>> {
  try {
    const res = await fetch(`/api/social-personas/${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: json.error || `Request failed (${res.status})`, status: res.status, extra: json };
    return { ok: true, data: json as T };
  } catch (err) {
    return { ok: false, error: (err as Error).message || "Network error", status: 0 };
  }
}

export interface Status {
  ai: boolean;
  /** Uploaded videos are kept where the platforms can fetch them (needed for auto-post). */
  storage: boolean;
  platforms: Record<ConnectablePlatform, { configured: boolean; env: [string, string]; setupUrl: string; postSetup: string }>;
}

/** A queue job as the browser sees it (no uid / connection id). */
export type PublicJob = Omit<Job, "uid" | "connectionId">;

export interface ScheduleRequest {
  personaId: string;
  draftId: string;
  accountId: string;
  connectionId: string;
  platform: ConnectablePlatform;
  title: string;
  caption: string;
  media: DraftMedia | null;
  runAt: string;
}

/** What the model needs — chat history and old idea days stay on the device. */
function lean(p: Persona): Persona {
  return { ...p, chat: [], ideaDays: [], posts: p.posts.map((x) => ({ ...x, thumbnail: null })) };
}

export const api = {
  status: () => call<Status>("status"),
  sync: (connectionId: string) =>
    call<{ platform: ConnectablePlatform; handle: string; displayName: string; url: string; followers: number | null; posts: Post[] }>("sync", { connectionId }),
  disconnect: (connectionId: string) => call<{ ok: true }>("disconnect", { connectionId }),
  analyze: (input: { link?: string; caption?: string; niche?: string }) =>
    call<{
      analysis: PostAnalysis;
      post: { url: string; platform: string; caption: string; thumbnail: string | null; author: string };
      watched: boolean;
      trail: string[];
    }>("analyze", input),
  brain: (p: Persona) => call<{ brain: Brain; warning?: string }>("brain", { persona: lean(p) }),
  ideas: (p: Persona, opts: { day: string; count?: number; direction?: string; previous?: string[] }) =>
    call<{ ideas: Idea[]; by: "ai" | "heuristic"; warning?: string }>("ideas", { persona: lean(p), ...opts }),
  chat: (p: Persona) => call<{ reply: string; offline?: boolean }>("chat", { persona: { ...lean(p) }, messages: p.chat }),
  schedule: (jobs: ScheduleRequest[], now = false) => call<{ jobs: PublicJob[] }>("schedule", { jobs, now }),
  unschedule: (draftId: string, accountIds?: string[]) => call<{ jobs: PublicJob[] }>("unschedule", { draftId, accountIds }),
  queue: (run = false) => call<{ jobs: PublicJob[] }>(`queue${run ? "?run=1" : ""}`),
  /** Upload a video/photo for a post. Reports progress 0–1. */
  upload: async (file: File, onProgress?: (f: number) => void): Promise<{ ok: true; media: DraftMedia } | { ok: false; error: string }> => {
    const r = await call<{ key: string; uploadUrl?: string; local?: boolean }>("media", { name: file.name, type: file.type, size: file.size });
    if (!r.ok) return { ok: false, error: r.error };
    const target = r.data.uploadUrl ?? `/api/social-personas/media?key=${encodeURIComponent(r.data.key)}`;
    const ok = await new Promise<boolean>((resolve) => {
      const x = new XMLHttpRequest();
      x.open("PUT", target);
      x.setRequestHeader("Content-Type", file.type);
      x.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
      x.onload = () => resolve(x.status >= 200 && x.status < 300);
      x.onerror = () => resolve(false);
      x.send(file);
    });
    if (!ok) return { ok: false, error: "The upload didn't finish. Check your connection and try again." };
    return { ok: true, media: { key: r.data.key, name: file.name, size: file.size, type: file.type } };
  },
  removeMedia: (key: string) => fetch(`/api/social-personas/media?key=${encodeURIComponent(key)}`, { method: "DELETE" }).catch(() => null),
};
