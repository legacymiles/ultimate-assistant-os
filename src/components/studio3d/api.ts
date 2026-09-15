import type { Brief, DirectorPlan, StudioCapabilities, VideoProject } from "@/lib/studio3d/types";

export interface BuilderInfo {
  linked: boolean;
  lastSeen: string | null;
  capabilities: StudioCapabilities | null;
}

async function json<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `Request failed (${res.status})`);
  return body as T;
}

const base = "/api/studio3d/projects";

export async function fetchProjects(): Promise<{ projects: VideoProject[]; builder: BuilderInfo }> {
  return json(await fetch(base, { cache: "no-store" }));
}

export async function fetchProject(id: string): Promise<VideoProject> {
  return (await json<{ project: VideoProject }>(await fetch(`${base}/${encodeURIComponent(id)}`, { cache: "no-store" }))).project;
}

export async function fetchBuilder(): Promise<BuilderInfo> {
  return json(await fetch("/api/studio3d/builder-token", { cache: "no-store" }));
}

export async function createProject(prompt: string, brief: Brief): Promise<VideoProject> {
  const res = await fetch(base, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt, brief }) });
  return (await json<{ project: VideoProject }>(res)).project;
}

export async function savePlan(id: string, plan: DirectorPlan): Promise<VideoProject> {
  const res = await fetch(`${base}/${encodeURIComponent(id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ plan }) });
  return (await json<{ project: VideoProject }>(res)).project;
}

export async function projectAction(id: string, action: "render" | "cancel" | "redirect", note?: string): Promise<VideoProject> {
  const res = await fetch(`${base}/${encodeURIComponent(id)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, note }) });
  return (await json<{ project: VideoProject }>(res)).project;
}

export async function deleteProject(id: string): Promise<void> {
  await json(await fetch(`${base}/${encodeURIComponent(id)}`, { method: "DELETE" }));
}

export async function mintToken(): Promise<string> {
  return (await json<{ token: string }>(await fetch("/api/studio3d/builder-token", { method: "POST" }))).token;
}

export function mediaUrl(id: string, which: "video" | number, download = false): string {
  return `/api/studio3d/media/${encodeURIComponent(id)}/${which}${download ? "?download=1" : ""}`;
}

export function ago(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "never";
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

/** A builder that asked for work in the last minute is online. */
export function builderOnline(builder: BuilderInfo | null, now = Date.now()): boolean {
  return Boolean(builder?.lastSeen && now - Date.parse(builder.lastSeen) < 60_000);
}

export function formatSec(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
