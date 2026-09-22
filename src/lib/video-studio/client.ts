// ---------------------------------------------------------------------------
// The browser's side of the studio. Every call the UI makes lives here, so a
// component never builds a URL or reads a response shape.
// ---------------------------------------------------------------------------

import type { Capability, MethodMeta, ProductionPlan, Project, VideoBrief } from "./types";

export interface MethodCard extends MethodMeta {
  skillTitle: string;
  goodAt: string[];
  capability: Capability;
}

export interface RunnerState {
  hasToken: boolean;
  lastSeen: string | null;
  online: boolean;
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: init?.body ? { "Content-Type": "application/json", ...(init?.headers ?? {}) } : init?.headers,
  });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!res.ok) {
    const message = (body as { error?: string } | null)?.error ?? `Request failed (${res.status})`;
    throw new Error(message);
  }
  return body as T;
}

export function loadMethods(): Promise<{ methods: MethodCard[]; runner: RunnerState }> {
  return call("/api/video-studio/methods");
}

export function loadProjects(): Promise<{ projects: Project[] }> {
  return call("/api/video-studio/projects");
}

export function loadProject(id: string): Promise<{ project: Project; versions: Project[] }> {
  return call(`/api/video-studio/projects/${id}`);
}

export function makePlan(
  brief: VideoBrief,
  methodId: string,
  mode: "manual" | "director",
): Promise<{ plan: ProductionPlan }> {
  return call("/api/video-studio/plan", { method: "POST", body: JSON.stringify({ brief, methodId, mode }) });
}

export function createProject(
  brief: VideoBrief,
  methodId: string,
  mode: "manual" | "director",
  plan: ProductionPlan | null,
): Promise<{ project: Project }> {
  return call("/api/video-studio/projects", {
    method: "POST",
    body: JSON.stringify({ brief, methodId, mode, plan }),
  });
}

function action<T = { project: Project }>(id: string, body: Record<string, unknown>): Promise<T> {
  return call(`/api/video-studio/projects/${id}`, { method: "POST", body: JSON.stringify(body) });
}

export const renderProject = (id: string) => action(id, { action: "render" });
export const renderScene = (id: string, sceneIndex: number) => action(id, { action: "render-scene", sceneIndex });
export const savePlan = (id: string, plan: ProductionPlan) => action(id, { action: "plan", plan });
export const saveBrief = (id: string, brief: VideoBrief) => action(id, { action: "brief", brief });
export const changeMethod = (id: string, methodId: string) => action(id, { action: "method", methodId });
export const duplicateProject = (id: string, methodId: string) => action(id, { action: "duplicate", methodId });

export function deleteProject(id: string): Promise<{ ok: true }> {
  return call(`/api/video-studio/projects/${id}`, { method: "DELETE" });
}

export function videoUrl(id: string, scene?: number): string {
  return scene === undefined
    ? `/api/video-studio/projects/${id}/video`
    : `/api/video-studio/projects/${id}/video?scene=${scene}`;
}

export function runnerState(): Promise<RunnerState> {
  return call("/api/video-studio/runner-token");
}

export function mintRunnerToken(): Promise<RunnerState & { token: string }> {
  return call("/api/video-studio/runner-token", { method: "POST" });
}
