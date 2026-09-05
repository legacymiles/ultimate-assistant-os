// ---------------------------------------------------------------------------
// STD Safe — the browser's side of the API.
//
// Every mutating call answers with the whole dashboard, so the components never
// patch local state by hand. One shape in, one shape out: the status card, the
// timeline and the inbox cannot drift out of sync with each other because they
// are all read from the same object.
// ---------------------------------------------------------------------------

import type { DerivedStatus } from "./status";
import type { ParsedDraft } from "./parse";
import type { PublicUser, Result, TestRecord, Verification } from "./types";

export interface InboxRequest {
  id: string;
  status: "pending" | "approved" | "denied" | "expired";
  createdAt: string;
  respondedAt?: string;
  grantExpiresAt?: string;
  who: PublicUser;
}

export interface Dashboard {
  me: PublicUser & { code: string };
  records: TestRecord[];
  status: DerivedStatus;
  inbox: { incoming: InboxRequest[]; outgoing: InboxRequest[] };
  storage: { persistent: boolean; reason: string };
}

export interface SharedView {
  who: PublicUser;
  status: DerivedStatus;
  grantExpiresAt: string;
  records: Array<{ collectedAt: string; lab: string; panelName: string; verification: Verification }>;
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: "same-origin", ...init });
  let body: Record<string, unknown> = {};
  try {
    body = await res.json();
  } catch {
    // A non-JSON body means the route failed before it could answer properly.
  }
  if (!res.ok || body.ok === false) {
    throw new ApiError(String(body.error ?? "Something went wrong."), res.status);
  }
  return body as T;
}

function post<T>(url: string, payload: unknown): Promise<T> {
  return call<T>(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

// ----- auth ----------------------------------------------------------------

export function signUp(handle: string, password: string, displayName?: string): Promise<Dashboard> {
  return post("/api/std-safe/auth", { action: "signup", handle, password, displayName });
}

export function signIn(handle: string, password: string): Promise<Dashboard> {
  return post("/api/std-safe/auth", { action: "signin", handle, password });
}

export function signOut(): Promise<unknown> {
  return post("/api/std-safe/auth", { action: "signout" });
}

// ----- dashboard -----------------------------------------------------------

export function loadDashboard(): Promise<Dashboard> {
  return call<Dashboard>("/api/std-safe/me");
}

export function rotateCode(): Promise<Dashboard> {
  return post("/api/std-safe/me", { action: "rotate" });
}

export function rename(displayName: string): Promise<Dashboard> {
  return post("/api/std-safe/me", { action: "rename", displayName });
}

// ----- records -------------------------------------------------------------

export interface ParseResponse {
  draft: ParsedDraft;
  note: string;
  fileId: string | null;
  fileName: string;
  verification: Verification;
  storageWarning: string;
}

export async function parseReport(file: File): Promise<ParseResponse> {
  const form = new FormData();
  form.append("file", file);
  return call<ParseResponse>("/api/std-safe/parse", { method: "POST", body: form });
}

export interface SaveRecordInput {
  collectedAt: string;
  reportedAt?: string;
  lab: string;
  panelName: string;
  verification: Verification;
  fileId?: string;
  fileName?: string;
  results: Result[];
  note?: string;
}

export function saveRecord(input: SaveRecordInput): Promise<Dashboard> {
  return post("/api/std-safe/records", input);
}

export function deleteRecord(id: string): Promise<Dashboard> {
  return call<Dashboard>(`/api/std-safe/records?id=${encodeURIComponent(id)}`, { method: "DELETE" });
}

// ----- requests ------------------------------------------------------------

export function askByCode(code: string): Promise<Dashboard & { request: InboxRequest }> {
  return post("/api/std-safe/requests", { code });
}

export function answerRequest(id: string, approve: boolean): Promise<Dashboard> {
  return call<Dashboard>("/api/std-safe/requests", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, approve }),
  });
}

export function revokeGrant(id: string): Promise<Dashboard> {
  return call<Dashboard>(`/api/std-safe/requests?id=${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function loadView(id: string): Promise<{ view: SharedView }> {
  return call<{ view: SharedView }>(`/api/std-safe/view?id=${encodeURIComponent(id)}`);
}
