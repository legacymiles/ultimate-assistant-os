// ---------------------------------------------------------------------------
// Smart Shot — the browser's calls to the routes. The planner and the panel
// painter are this app's own; video goes through Auteur's render door, which
// already picks the user's RunPod H3, MiniMax hosted, the gateway or an
// animatic placeholder.
// ---------------------------------------------------------------------------

"use client";

import type { PanelSpec } from "./panels";
import type { Brief, Plan, Upload } from "./types";

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
    if (res.status === 413) throw new Error("The images are too large together. Remove one and try again.");
    throw new Error(`The server answered ${res.status} with something unreadable.`);
  }
  if (!res.ok || typeof json.error === "string") throw new Error(String(json.error ?? `Request failed (${res.status}).`));
  return json as T;
}

export interface PlanResult {
  plan: Plan;
  engine: "ai" | "heuristic";
  warning?: string;
}

export function requestPlan(brief: Brief, uploads: Upload[], signal?: AbortSignal) {
  return post<PlanResult>("/api/smart-shot/plan", { brief, uploads }, signal);
}

export interface PanelResult {
  image: string;
  placeholder?: boolean;
  refusal?: string;
}

export function requestPanel(spec: PanelSpec, caption: string, signal?: AbortSignal) {
  return post<PanelResult>("/api/smart-shot/panel", { ...spec, caption }, signal);
}

// ----- video, through Auteur's door -----

export interface RenderStart {
  engine: "minimax" | "placeholder";
  mode: "async" | "inline" | "done";
  taskId?: string;
  videoBase64?: string;
}

export interface RenderStatus {
  status: "queued" | "generating" | "done" | "error";
  url?: string;
  videoBase64?: string;
  error?: string;
  note?: string;
}

export function startRender(body: {
  prompt: string;
  durationSec: number;
  aspectRatio: string;
  resolution: "768P" | "2K";
  references: { label: string; kind: "image"; dataUrl: string }[];
}) {
  return post<RenderStart>("/api/auteur/generate", { action: "create", ...body });
}

export function renderStatus(taskId: string) {
  return post<RenderStatus>("/api/auteur/generate", { action: "status", taskId });
}

export async function downloadRender(taskId: string): Promise<Blob> {
  const res = await fetch("/api/auteur/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "download", taskId }),
  });
  if (!res.ok) throw new Error(`Download failed (${res.status}).`);
  return res.blob();
}

export function videoBackend() {
  return post<{ id: string; label: string; async: boolean }>("/api/auteur/generate", { action: "backend" });
}
