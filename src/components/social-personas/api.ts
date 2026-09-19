// Thin client for /api/social-personas/*. Every call returns { ok, data | error }
// so the UI can show the server's own words.

import type { Brain, Idea, Persona, Post, SocialPlatform } from "@/lib/social-personas/types";
import type { PostAnalysis } from "@/lib/social-personas/logic";

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
  platforms: Record<SocialPlatform, { configured: boolean; env: [string, string]; setupUrl: string }>;
}

/** What the model needs — chat history and old idea days stay on the device. */
function lean(p: Persona): Persona {
  return { ...p, chat: [], ideaDays: [], posts: p.posts.map((x) => ({ ...x, thumbnail: null })) };
}

export const api = {
  status: () => call<Status>("status"),
  sync: (connectionId: string) =>
    call<{ platform: SocialPlatform; handle: string; displayName: string; url: string; followers: number | null; posts: Post[] }>("sync", { connectionId }),
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
};
