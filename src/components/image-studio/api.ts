"use client";

import type { RefInput } from "@/lib/image-studio/prompt";

interface Base {
  agentId: string;
  prompt: string;
  refs: RefInput[];
}

async function post<T>(url: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  let json: Record<string, unknown> = {};
  try {
    json = await res.json();
  } catch {
    if (res.status === 413) throw new Error("The reference images are too large together. Remove one and try again.");
    throw new Error(`The server answered ${res.status} with something unreadable.`);
  }
  if (!res.ok || typeof json.error === "string") throw new Error(String(json.error ?? `Request failed (${res.status}).`));
  return json as T;
}

export interface RewriteResult {
  prompt: string;
  offline?: boolean;
  warning?: string;
}

export function rewrite(req: Base & { soften?: boolean }, signal?: AbortSignal) {
  return post<RewriteResult>("/api/image-studio/rewrite", req, signal);
}

export interface GenerateResult {
  image?: string;
  refusal?: string;
  offline?: boolean;
  model?: string;
}

export function generateOne(req: Base & { variant: number }, signal?: AbortSignal) {
  return post<GenerateResult>("/api/image-studio/generate", req, signal);
}
