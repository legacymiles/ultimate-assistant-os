"use client";

// Browser-side calls for both screens. Every failure comes back as an Error
// whose message is a sentence a person can read — never a status code dump.

import type { ClientProject, PortalView } from "./types";

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { cache: "no-store", ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  } catch {
    throw new Error("Couldn't reach the server — check your connection and try again.");
  }
  const body = (await res.json().catch(() => null)) as (T & { error?: string; signIn?: boolean; wrongAccount?: boolean; viewerEmail?: string }) | null;
  if (!res.ok) {
    throw new ApiError(body?.error || `The server answered ${res.status}. Try again in a moment.`, res.status, {
      signIn: body?.signIn === true,
      wrongAccount: body?.wrongAccount === true,
      viewerEmail: body?.viewerEmail ?? null,
    });
  }
  return body as T;
}

/** A failed call, with what the screen needs to decide what to show. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly flags: { signIn: boolean; wrongAccount: boolean; viewerEmail: string | null },
  ) {
    super(message);
  }
}

export interface MySite {
  token: string;
  name: string;
  version: string | null;
  building: string | null;
  pending: number;
  updatedAt: string;
}

// ----- the client's link ------------------------------------------------------

export const portal = {
  load: (token: string) => call<PortalView>(`/api/client-review/portal/${token}`),
  mine: () => call<{ sites: MySite[]; email: string | null }>("/api/client-review/portal/mine"),
  act: (token: string, action: Record<string, unknown>) =>
    call<PortalView>(`/api/client-review/portal/${token}`, { method: "POST", body: JSON.stringify(action) }),
};

// ----- the owner's console ------------------------------------------------------

export interface AdminState {
  projects: ClientProject[];
  events: import("./types").AdminEvent[];
  storage: { persistent: boolean; reason: string };
  push: boolean;
  ai: boolean;
  lanes: { standard: string[]; uncensored: string[] };
}

export interface BriefOut {
  brief: string;
  model: string;
  lane: "standard" | "uncensored";
  rerouted: boolean;
  note?: string;
}

export const admin = {
  load: () => call<AdminState>("/api/client-review/admin"),
  feed: () => call<{ events: import("./types").AdminEvent[] }>("/api/client-review/admin?feed=1"),
  act: <T = { project: ClientProject }>(action: Record<string, unknown>) =>
    call<T>("/api/client-review/admin", { method: "POST", body: JSON.stringify(action) }),
};

/** Web Push wants the VAPID key as bytes. */
export function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
